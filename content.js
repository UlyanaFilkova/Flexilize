(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const HOST_ID = "context-translator-extension-host";
  const MAX_SELECTION_LENGTH = 1000;
  let host = null;
  let shadow = null;
  let currentText = "";
  let requestNumber = 0;
  let selectionTimer = null;
  let availableVoices = [];

  document.addEventListener("mouseup", scheduleSelection, true);
  document.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || event.key === "Shift") scheduleSelection();
  }, true);
  document.addEventListener("select", scheduleSelection, true);
  document.addEventListener("pointerdown", handleOutsidePointerDown, true);
  document.addEventListener("scroll", closeModal, true);
  window.addEventListener("blur", closeModal);

  if ("speechSynthesis" in window) {
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
  }

  function scheduleSelection() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(processSelection, 120);
  }

  async function processSelection() {
    const details = readSelection();
    if (!details || details.text === currentText) return;

    currentText = details.text;
    const ownRequest = ++requestNumber;
    showModal(details.rect, details.text);

    if (!extensionApi?.runtime?.sendMessage) {
      showError("API расширения недоступно на этой странице");
      return;
    }

    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "translate-selection",
        payload: {
          text: details.text,
          sentence: details.sentence,
          pageTitle: document.title,
          pageUrl: location.href
        }
      });

      if (ownRequest !== requestNumber || !shadow) return;
      if (!result?.ok) throw new Error(result?.error || "Не удалось выполнить перевод");
      renderResult(result, details.text);
      void loadTranscription(details.text, ownRequest);
    } catch (error) {
      if (ownRequest === requestNumber) showError(error?.message || "Ошибка перевода");
    }
  }

  function readSelection() {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
        const text = clean(active.value.slice(start, end));
        if (!text) return null;
        return {
          text: text.slice(0, MAX_SELECTION_LENGTH),
          sentence: sentenceAround(active.value, start, end),
          rect: active.getBoundingClientRect()
        };
      }
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = clean(selection.toString());
    if (!text || shadow?.contains(selection.anchorNode)) return null;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;

    return {
      text: text.slice(0, MAX_SELECTION_LENGTH),
      sentence: sentenceFromRange(range, text),
      rect
    };
  }

  function sentenceFromRange(range, selectedText) {
    const container = closestTextContainer(range.commonAncestorContainer);
    const fullText = clean(container?.innerText || container?.textContent || selectedText);
    if (!fullText) return selectedText;

    const selected = clean(selectedText);
    const index = fullText.toLocaleLowerCase().indexOf(selected.toLocaleLowerCase());
    if (index < 0) return trimContext(fullText, selected);
    return sentenceAround(fullText, index, index + selected.length);
  }

  function closestTextContainer(node) {
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (element && element !== document.body) {
      const text = clean(element.innerText || element.textContent || "");
      if (["P", "LI", "TD", "TH", "BLOCKQUOTE", "FIGCAPTION", "DIV", "ARTICLE"].includes(element.tagName)
        && text.length <= 3000) return element;
      element = element.parentElement;
    }
    return node.parentElement;
  }

  function sentenceAround(value, start, end) {
    const left = Math.max(
      value.lastIndexOf(".", start - 1),
      value.lastIndexOf("!", start - 1),
      value.lastIndexOf("?", start - 1),
      value.lastIndexOf("\n", start - 1)
    );
    const endings = [".", "!", "?", "\n"]
      .map((mark) => value.indexOf(mark, end))
      .filter((index) => index >= 0);
    const right = endings.length ? Math.min(...endings) + 1 : value.length;
    return clean(value.slice(left + 1, right)).slice(0, 3000) || clean(value.slice(start, end));
  }

  function trimContext(fullText, selected) {
    if (fullText.length <= 500) return fullText;
    const index = fullText.indexOf(selected);
    if (index < 0) return selected;
    return clean(fullText.slice(Math.max(0, index - 220), index + selected.length + 220));
  }

  function showModal(rect, text) {
    // Replacing a modal is part of the current request. Calling closeModal()
    // here used to increment requestNumber, so every response was immediately
    // treated as stale and renderResult() was never reached.
    removeModal();
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0";
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);

    shadow.innerHTML = `
      <style>${modalStyles()}</style>
      <section class="card" role="dialog" aria-label="Перевод выделенного текста">
        <div class="top">
          <div class="source"></div>
          <div class="transcription skeleton short"></div>
          <button class="speak" type="button" aria-label="Озвучить выделенный текст" title="Озвучить">▶</button>
        </div>
        <div class="divider"></div>
        <div class="translation skeleton"></div>
        <div class="status pending" role="status" aria-label="Обработка" title="Обработка">⏳</div>
      </section>`;

    shadow.querySelector(".source").textContent = text;
    shadow.querySelector(".speak").addEventListener("click", (event) => {
      event.stopPropagation();
      speak(text);
    });
    positionModal(rect);
  }

  function renderResult(result, text) {
    const translation = shadow.querySelector(".translation");
    translation.classList.remove("skeleton");
    translation.replaceChildren();
    const alternatives = Array.isArray(result.translations) && result.translations.length
      ? result.translations
      : [result.translation];
    alternatives.forEach((value) => {
      const item = document.createElement("div");
      item.className = "translation-option";
      item.textContent = value;
      translation.append(item);
    });
    if (result.contextTranslation) {
      const context = document.createElement("div");
      context.className = "context-translation";
      context.textContent = result.contextTranslation;
      translation.append(context);
    }
    const status = shadow.querySelector(".status");
    status.textContent = "✓";
    status.classList.remove("pending");
    status.setAttribute("aria-label", "Сохранено");
    status.title = result.warning || "Сохранено";
    shadow.querySelector(".speak").onclick = (event) => {
      event.stopPropagation();
      speak(text);
    };
  }

  async function loadTranscription(text, ownRequest) {
    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "get-transcription",
        payload: { text }
      });
      if (ownRequest !== requestNumber || !shadow) return;
      renderTranscription(result?.ok ? result.transcription : null);
    } catch (_error) {
      if (ownRequest === requestNumber && shadow) renderTranscription(null);
    }
  }

  function renderTranscription(value) {
    const transcription = shadow.querySelector(".transcription");
    transcription.classList.remove("skeleton", "short");
    transcription.textContent = value || "Транскрипция недоступна";
    transcription.classList.toggle("muted", !value);
  }

  function showError(message) {
    if (!shadow) return;
    shadow.querySelector(".transcription")?.remove();
    shadow.querySelector(".divider")?.remove();
    const translation = shadow.querySelector(".translation");
    translation.classList.remove("skeleton");
    translation.textContent = message;
    translation.classList.add("error");
    shadow.querySelector(".status")?.remove();
  }

  function speak(text) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      showError("Озвучка не поддерживается этим браузером");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const locale = "en-US";
    const voice = chooseVoice(locale);
    utterance.lang = voice?.lang || locale;
    utterance.voice = voice || null;
    utterance.rate = 0.92;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function refreshVoices() {
    availableVoices = window.speechSynthesis.getVoices();
  }

  function chooseVoice(locale) {
    const voices = availableVoices.length
      ? availableVoices
      : window.speechSynthesis.getVoices();
    const exactLocale = locale.toLocaleLowerCase();
    const baseLanguage = exactLocale.split("-")[0];

    return voices
      .filter((voice) => voice.lang.toLocaleLowerCase().split("-")[0] === baseLanguage)
      .sort((left, right) => voiceScore(right, exactLocale) - voiceScore(left, exactLocale))[0] || null;
  }

  function voiceScore(voice, exactLocale) {
    const name = voice.name.toLocaleLowerCase();
    let score = voice.lang.toLocaleLowerCase() === exactLocale ? 40 : 0;
    if (/google|microsoft.*(online|natural)|natural|enhanced|premium|siri/.test(name)) score += 35;
    if (!voice.localService) score += 20;
    if (voice.default) score += 5;
    if (/espeak|festival|pico/.test(name)) score -= 50;
    return score;
  }

  function positionModal(rect) {
    const card = shadow.querySelector(".card");
    const width = Math.min(420, window.innerWidth - 24);
    const preferredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12));
    card.style.width = `${width}px`;
    card.style.left = `${left}px`;

    requestAnimationFrame(() => {
      if (!card) return;
      const height = card.getBoundingClientRect().height;
      const below = rect.bottom + 10;
      const top = below + height <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - height - 10);
      card.style.top = `${top}px`;
    });
  }

  function handleOutsidePointerDown(event) {
    if (!host) return;
    const path = event.composedPath();
    if (!path.includes(host)) closeModal();
  }

  function closeModal() {
    requestNumber += 1;
    currentText = "";
    removeModal();
  }

  function removeModal() {
    host?.remove();
    host = null;
    shadow = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function modalStyles() {
    return `
      :host { color-scheme: light; }
      .card { position: fixed; box-sizing: border-box; padding: 12px 14px 22px; border: 1px solid rgba(15,23,42,.09); border-radius: 14px; background: #fff; box-shadow: 0 18px 50px rgba(15,23,42,.22), 0 3px 10px rgba(15,23,42,.1); color: #172033; font: 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .top { display: flex; align-items: center; gap: 9px; }
      .source { flex: 1 1 auto; min-width: 0; max-height: 64px; overflow: auto; font-size: 16px; font-weight: 650; overflow-wrap: anywhere; }
      .speak { flex: 0 0 32px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #e8f0ff; color: #2457d6; cursor: pointer; font-size: 12px; transition: background .15s, transform .15s; }
      .speak:hover { background: #d8e5ff; transform: scale(1.04); }
      .transcription { flex: 0 1 auto; min-width: 72px; max-width: 48%; min-height: 18px; overflow: hidden; color: #58677d; font: 14px/1.3 Georgia,serif; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
      .muted { font-family: inherit; font-size: 12px; color: #8a96a8; }
      .divider { height: 1px; margin: 8px 0; background: #e9edf3; }
      .translation { min-height: 20px; color: #172033; font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; }
      .translation-option { color: #172033; font-size: 16px; font-weight: 400; }
      .translation-option + .translation-option { margin-top: 2px; }
      .context-translation { margin-top: 6px; padding-top: 6px; border-top: 1px solid #edf0f4; color: #172033; font-size: 14px; font-style: normal; }
      .status { position: absolute; right: 14px; bottom: 8px; color: #27864a; font-size: 16px; font-weight: 700; line-height: 1; }
      .status.pending { color: #7b8798; font-size: 13px; font-weight: 400; }
      .error { color: #b42318; }
      .skeleton { border-radius: 5px; background: linear-gradient(90deg,#eef1f5 25%,#f7f8fa 50%,#eef1f5 75%); background-size: 200% 100%; color: transparent; animation: shimmer 1.2s infinite; }
      .skeleton.short { width: 96px; flex-basis: 96px; }
      @keyframes shimmer { to { background-position: -200% 0; } }
    `;
  }
})();
