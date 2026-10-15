import browser from "webextension-polyfill";
import {
  errorMessage,
  type RecordsResponse,
  type SpeechAudioChunk,
  type SpeechAudioResponse,
  type TranslationRecord,
  type TranslateResponse
} from "./types";

(() => {
  const extensionApi = browser;
  const HOST_ID = "context-translator-extension-host";
  const INSTANCE_ATTRIBUTE = "data-context-translator-instance";
  const instanceId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const MAX_SELECTION_LENGTH = 1000;

  // Extension.js reloads the extension context during development, but DOM
  // created by the previous content-script instance can survive that reload.
  // Remove its inert modal before installing the new instance.
  document.getElementById(HOST_ID)?.remove();
  document.documentElement.setAttribute(INSTANCE_ATTRIBUTE, instanceId);

  let host: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let currentText = "";
  let requestNumber = 0;
  let completedTranslationRequest = 0;
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;
  let availableVoices: SpeechSynthesisVoice[] = [];
  let selectionRect: DOMRect | null = null;
  let speechRun = 0;
  let speechProgressFrame: number | null = null;
  let speechLoading = false;
  let audioContext: AudioContext | null = null;
  let remoteSpeech: {
    context: AudioContext
    sources: AudioBufferSourceNode[]
  } | null = null;

  document.addEventListener("mouseup", scheduleSelection, true);
  document.addEventListener("keyup", (event) => {
    const key = typeof event.key === "string" ? event.key : "";
    if (key.startsWith("Arrow") || key === "Shift") scheduleSelection();
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
    if (!isCurrentInstance()) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(processSelection, 60);
  }

  async function processSelection() {
    if (!isCurrentInstance()) return;
    const details = readSelection();
    if (!details || details.text === currentText) return;

    currentText = details.text;
    const ownRequest = ++requestNumber;
    showModal(details.rect, details.text);
    if (!isSingleEnglishWord(details.text)) {
      void loadTranslationPreview(details.text, ownRequest);
    }
    void loadTranscription(details.text, ownRequest);

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
      }) as TranslateResponse;

      if (ownRequest !== requestNumber || !shadow) return;
      if (!result?.ok || !result.translation) throw new Error(result?.error || "Не удалось выполнить перевод");
      completedTranslationRequest = ownRequest;
      renderResult(result as TranslateResponse & {translation: string});
    } catch (error) {
      if (ownRequest !== requestNumber) return;
      if (isInvalidatedContextError(error)) {
        closeModal();
        return;
      }
      showError(errorMessage(error, "Ошибка перевода"));
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
    if (!isCurrentInstance()) return;
    // Replacing a modal is part of the current request. Calling closeModal()
    // here used to increment requestNumber, so every response was immediately
    // treated as stale and renderResult() was never reached.
    removeModal();
    selectionRect = rect;
    const selectionWordCount = wordCount(text);
    const isLongSelection = text.length > 320 || selectionWordCount > 48;
    const showSpeechProgress = wordCount(text) > 10;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0";
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);

    shadow.innerHTML = `
      <style>${modalStyles()}</style>
      <section class="card${isLongSelection ? " long" : ""}${showSpeechProgress ? " speech-seekable" : ""}" role="dialog" aria-label="Перевод выделенного текста">
        <div class="top">
          <div class="source"></div>
          <div class="transcription skeleton short"></div>
          <button class="speak" type="button" aria-label="Озвучить выделенный текст" title="Озвучить">▶</button>
        </div>
        ${showSpeechProgress ? `
          <div class="speech-progress-row">
            <input class="speech-progress" type="range" min="0" max="${text.length}" value="0"
              aria-label="Позиция озвучки" title="Позиция озвучки">
          </div>` : ""}
        <div class="divider"></div>
        <div class="translation skeleton"></div>
        <div class="status pending" role="status" aria-label="Обработка" title="Обработка">⏳</div>
      </section>`;

    shadow.querySelector(".source").textContent = text;
    const speakButton = shadow.querySelector<HTMLButtonElement>(".speak");
    const progress = shadow.querySelector<HTMLInputElement>(".speech-progress");
    speakButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (isSpeechActive()) {
        stopSpeaking(speakButton);
        return;
      }
      const requestedPosition = progress ? Number(progress.value) : 0;
      speak(text, speakButton, requestedPosition >= text.length ? 0 : requestedPosition);
    });
    progress?.addEventListener("input", () => {
      if (isSpeechActive()) {
        stopSpeaking(speakButton);
      }
    });
    progress?.addEventListener("change", () => {
      const requestedPosition = Number(progress.value);
      if (requestedPosition >= text.length) {
        stopSpeaking(speakButton);
        return;
      }
      speak(text, speakButton, requestedPosition);
    });
    positionModal(rect);
  }

  function renderResult(result: TranslateResponse & {translation: string}) {
    renderTranslations(result);
    const status = shadow.querySelector<HTMLElement>(".status");
    if (result.saved === false) {
      status.remove();
    } else {
      status.textContent = "✓";
      status.classList.remove("pending");
      status.setAttribute("aria-label", "Сохранено");
      status.title = result.warning || "Сохранено";
    }
    if (result.storageLimitReached) showStorageLimitNotice(result.pendingRecord);
  }

  function showStorageLimitNotice(pendingRecord?: TranslationRecord) {
    if (!shadow || shadow.querySelector(".storage-limit")) return;
    const card = shadow.querySelector<HTMLElement>(".card");
    if (!card) return;

    const notice = document.createElement("div");
    notice.className = "storage-limit";
    const message = document.createElement("div");
    message.className = "storage-limit-message";
    message.textContent = "Достигнут лимит в 5 переводов. Скачайте сохранённые записи и очистите хранилище, чтобы сохранять новые.";
    const actions = document.createElement("div");
    actions.className = "storage-limit-actions";
    const exportButton = document.createElement("button");
    exportButton.className = "storage-limit-export";
    exportButton.type = "button";
    exportButton.textContent = "Скачать и очистить";
    exportButton.addEventListener("click", () => (
      void exportAndClearRecords(exportButton, notice, pendingRecord)
    ));
    const laterButton = document.createElement("button");
    laterButton.className = "storage-limit-later";
    laterButton.type = "button";
    laterButton.textContent = "Позже";
    laterButton.addEventListener("click", () => {
      notice.remove();
      if (selectionRect) positionModal(selectionRect);
    });
    actions.append(exportButton, laterButton);
    notice.append(message, actions);
    card.append(notice);
    if (selectionRect) positionModal(selectionRect);
  }

  async function exportAndClearRecords(
    button: HTMLButtonElement,
    notice: HTMLElement,
    pendingRecord?: TranslationRecord
  ) {
    button.disabled = true;
    try {
      const recordsResult = await extensionApi.runtime.sendMessage({ type: "get-records" }) as RecordsResponse;
      if (!recordsResult?.ok) throw new Error(recordsResult?.error || "Не удалось загрузить записи");
      const records = recordsResult.records || [];
      const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `context-translations-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const clearResult = await extensionApi.runtime.sendMessage(pendingRecord
        ? { type: "clear-and-save-record", payload: { record: pendingRecord } }
        : { type: "clear-records" }) as RecordsResponse;
      if (!clearResult?.ok) throw new Error(clearResult?.error || "Не удалось очистить хранилище");
      if (pendingRecord) {
        const card = shadow?.querySelector<HTMLElement>(".card");
        if (card && !card.querySelector(".status")) {
          const status = document.createElement("div");
          status.className = "status";
          status.textContent = "✓";
          status.setAttribute("role", "status");
          status.setAttribute("aria-label", "Сохранено");
          status.title = "Сохранено";
          card.append(status);
        }
      }
      notice.replaceChildren(document.createTextNode(pendingRecord
        ? "Хранилище очищено, текущий перевод сохранён"
        : "Переводы скачаны, хранилище очищено"));
      if (selectionRect) positionModal(selectionRect);
      setTimeout(() => {
        notice.remove();
        if (selectionRect) positionModal(selectionRect);
      }, 2200);
    } catch (error) {
      button.disabled = false;
      button.title = errorMessage(error, "Ошибка экспорта");
      const message = notice.querySelector<HTMLElement>(".storage-limit-message");
      if (message) message.textContent = errorMessage(error, "Не удалось скачать переводы");
    }
  }

  function renderTranslations(result: TranslateResponse & {translation: string}) {
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
    if (selectionRect) positionModal(selectionRect);
  }

  async function loadTranslationPreview(text, ownRequest) {
    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "translate-preview",
        payload: { text }
      }) as TranslateResponse;
      if (ownRequest !== requestNumber || completedTranslationRequest === ownRequest
        || !shadow || !result?.ok || !result.translation) return;
      renderTranslations(result as TranslateResponse & {translation: string});
    } catch (_error) {
      if (isInvalidatedContextError(_error)) closeModal();
      // The full contextual request below remains the source of other errors for the UI.
    }
  }

  async function loadTranscription(text, ownRequest) {
    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "get-transcription",
        payload: { text }
      }) as TranslateResponse;
      if (ownRequest !== requestNumber || !shadow) return;
      renderTranscription(result?.ok ? result.transcription : null);
    } catch (_error) {
      if (ownRequest !== requestNumber) return;
      if (isInvalidatedContextError(_error)) {
        closeModal();
        return;
      }
      if (shadow) renderTranscription(null);
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

  function speak(text: string, button: HTMLButtonElement, requestedPosition = 0) {
    if (isFirefox()) {
      void speakWithRemoteVoice(text, button, requestedPosition);
      return;
    }
    speakWithBrowserVoice(text, button, requestedPosition);
  }

  function speakWithBrowserVoice(text: string, button: HTMLButtonElement, requestedPosition = 0) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      showError("Озвучка не поддерживается этим браузером");
      return;
    }
    const progress = shadow?.querySelector<HTMLInputElement>(".speech-progress") || null;
    const startPosition = nearestWordStart(text, requestedPosition);
    const spokenText = text.slice(startPosition).trimStart();
    const leadingWhitespace = text.slice(startPosition).length - spokenText.length;
    const actualStart = startPosition + leadingWhitespace;
    const ownSpeechRun = ++speechRun;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText);
    const locale = "en-US";
    const voice = chooseVoice(locale);
    utterance.lang = voice?.lang || locale;
    utterance.voice = voice || null;
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.onstart = () => {
      if (ownSpeechRun !== speechRun) return;
      button.textContent = "■";
      button.title = "Остановить озвучку";
      button.setAttribute("aria-label", "Остановить озвучку");
      if (progress) {
        progress.value = String(actualStart);
        animateSpeechProgress(progress, text, spokenText, actualStart, ownSpeechRun);
      }
    };
    utterance.onboundary = (event) => {
      if (ownSpeechRun !== speechRun || !progress) return;
      progress.value = String(Math.max(
        Number(progress.value),
        Math.min(text.length, actualStart + event.charIndex)
      ));
    };
    utterance.onend = () => {
      if (ownSpeechRun !== speechRun) return;
      stopSpeechProgressAnimation();
      if (progress) progress.value = String(text.length);
      resetSpeakButton(button);
    };
    utterance.onerror = (event) => {
      if (ownSpeechRun !== speechRun) return;
      stopSpeechProgressAnimation();
      resetSpeakButton(button);
      if (event.error === "canceled" || event.error === "interrupted") return;
      button.title = `Ошибка озвучки: ${event.error}`;
      console.warn(`[Context Translator] Speech synthesis error: ${event.error}`);
    };
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking(button?: HTMLButtonElement) {
    speechRun += 1;
    speechLoading = false;
    stopSpeechProgressAnimation();
    stopRemoteSpeech();
    window.speechSynthesis.cancel();
    if (button) resetSpeakButton(button);
  }

  async function speakWithRemoteVoice(text: string, button: HTMLButtonElement, requestedPosition = 0) {
    const startPosition = nearestWordStart(text, requestedPosition);
    const spokenText = text.slice(startPosition).trimStart();
    const leadingWhitespace = text.slice(startPosition).length - spokenText.length;
    const actualStart = startPosition + leadingWhitespace;
    const progress = shadow?.querySelector<HTMLInputElement>(".speech-progress") || null;
    const context = getAudioContext();
    const ownSpeechRun = ++speechRun;

    stopRemoteSpeech();
    window.speechSynthesis.cancel();
    speechLoading = true;
    button.textContent = "■";
    button.title = "Остановить озвучку";
    button.setAttribute("aria-label", "Остановить озвучку");
    if (progress) progress.value = String(actualStart);

    // Calling resume directly from the click handler keeps Firefox's autoplay
    // permission while the audio itself is being downloaded.
    void context.resume();

    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "get-speech-audio",
        payload: { text: spokenText }
      }) as SpeechAudioResponse;
      if (ownSpeechRun !== speechRun) return;
      if (!result?.ok || !result.chunks?.length) {
        throw new Error(result?.error || "Не удалось загрузить озвучку");
      }

      const decoded = await Promise.all(result.chunks.map(async (chunk) => ({
        buffer: await context.decodeAudioData(base64ToArrayBuffer(chunk.audio)),
        chunk
      })));
      if (ownSpeechRun !== speechRun) return;

      await context.resume();
      const sources: AudioBufferSourceNode[] = [];
      const schedule: Array<{
        chunk: SpeechAudioChunk
        startTime: number
        endTime: number
      }> = [];
      let scheduledTime = context.currentTime + 0.04;

      decoded.forEach(({buffer, chunk}) => {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(scheduledTime);
        sources.push(source);
        schedule.push({ chunk, startTime: scheduledTime, endTime: scheduledTime + buffer.duration });
        scheduledTime += buffer.duration;
      });

      speechLoading = false;
      remoteSpeech = { context, sources };
      const lastSource = sources.at(-1);
      if (lastSource) {
        lastSource.onended = () => {
          if (ownSpeechRun !== speechRun) return;
          stopSpeechProgressAnimation();
          remoteSpeech = null;
          if (progress) progress.value = String(text.length);
          resetSpeakButton(button);
        };
      }
      animateRemoteSpeechProgress(progress, text, actualStart, schedule, ownSpeechRun);
    } catch (error) {
      if (ownSpeechRun !== speechRun) return;
      speechLoading = false;
      resetSpeakButton(button);
      console.warn(`[Context Translator] Remote speech synthesis failed: ${errorMessage(error, "unknown error")}`);
      // Firefox can still provide a local voice when the network TTS is unavailable.
      speakWithBrowserVoice(text, button, requestedPosition);
    }
  }

  function animateRemoteSpeechProgress(
    progress: HTMLInputElement | null,
    fullText: string,
    startPosition: number,
    schedule: Array<{chunk: SpeechAudioChunk; startTime: number; endTime: number}>,
    ownSpeechRun: number
  ) {
    if (!progress) return;
    stopSpeechProgressAnimation();

    const update = () => {
      if (ownSpeechRun !== speechRun || !remoteSpeech) return;
      const now = remoteSpeech.context.currentTime;
      const current = schedule.find((item) => now >= item.startTime && now < item.endTime);
      if (current) {
        const fraction = (now - current.startTime) / (current.endTime - current.startTime);
        const chunkPosition = current.chunk.start
          + Math.floor((current.chunk.end - current.chunk.start) * fraction);
        progress.value = String(Math.min(fullText.length, startPosition + chunkPosition));
      }
      speechProgressFrame = requestAnimationFrame(update);
    };
    speechProgressFrame = requestAnimationFrame(update);
  }

  function getAudioContext() {
    audioContext ||= new AudioContext();
    return audioContext;
  }

  function stopRemoteSpeech() {
    if (!remoteSpeech) return;
    remoteSpeech.sources.forEach((source) => {
      source.onended = null;
      try {
        source.stop();
      } catch (_error) {
        // A source that has already ended cannot be stopped again.
      }
      source.disconnect();
    });
    remoteSpeech = null;
  }

  function base64ToArrayBuffer(value: string) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function isSpeechActive() {
    return speechLoading || Boolean(remoteSpeech)
      || window.speechSynthesis.speaking || window.speechSynthesis.pending;
  }

  function isFirefox() {
    return navigator.userAgent.includes("Firefox/");
  }

  function animateSpeechProgress(
    progress: HTMLInputElement,
    fullText: string,
    spokenText: string,
    startPosition: number,
    ownSpeechRun: number
  ) {
    stopSpeechProgressAnimation();
    const startedAt = performance.now();
    const estimatedDuration = estimateSpeechDuration(spokenText);
    const remainingCharacters = fullText.length - startPosition;

    const update = (now: number) => {
      if (ownSpeechRun !== speechRun) return;
      const fraction = Math.min(0.98, (now - startedAt) / estimatedDuration);
      const estimatedPosition = startPosition + Math.floor(remainingCharacters * fraction);
      progress.value = String(Math.max(Number(progress.value), estimatedPosition));
      speechProgressFrame = requestAnimationFrame(update);
    };
    speechProgressFrame = requestAnimationFrame(update);
  }

  function stopSpeechProgressAnimation() {
    if (speechProgressFrame === null) return;
    cancelAnimationFrame(speechProgressFrame);
    speechProgressFrame = null;
  }

  function estimateSpeechDuration(value: string) {
    const wordsPerMinute = 165 * 0.92;
    return Math.max(1200, (wordCount(value) / wordsPerMinute) * 60_000);
  }

  function nearestWordStart(text: string, requestedPosition: number) {
    let position = Math.max(0, Math.min(Math.floor(requestedPosition), text.length));
    while (position > 0 && /[A-Za-z'-]/.test(text[position - 1])) position -= 1;
    return position;
  }

  function resetSpeakButton(button: HTMLButtonElement) {
    button.textContent = "▶";
    button.title = "Озвучить";
    button.setAttribute("aria-label", "Озвучить выделенный текст");
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
    const card = shadow.querySelector<HTMLElement>(".card");
    const preferredWidth = card.classList.contains("long")
      ? 760
      : isSingleEnglishWord(currentText) ? 420 : 620;
    const width = Math.min(preferredWidth, window.innerWidth - 24);
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
    if (!isCurrentInstance()) return;
    if (!host) return;
    const path = event.composedPath();
    if (!path.includes(host)) closeModal();
  }

  function closeModal() {
    if (!isCurrentInstance()) {
      host?.remove();
      host = null;
      shadow = null;
      return;
    }
    requestNumber += 1;
    currentText = "";
    removeModal();
  }

  function removeModal() {
    host?.remove();
    host = null;
    shadow = null;
    selectionRect = null;
    if ("speechSynthesis" in window) stopSpeaking();
  }

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function isSingleEnglishWord(value) {
    return /^[A-Za-z][A-Za-z'-]*$/.test(value);
  }

  function wordCount(value: string) {
    return value.trim() ? value.trim().split(/\s+/).length : 0;
  }

  function isInvalidatedContextError(error) {
    return /extension context invalidated/i.test(errorMessage(error, ""));
  }

  function isCurrentInstance() {
    return document.documentElement.getAttribute(INSTANCE_ATTRIBUTE) === instanceId;
  }

  function modalStyles() {
    return `
      :host { color-scheme: light; }
      .card { position: fixed; box-sizing: border-box; max-height: calc(100vh - 24px); padding: 12px 14px 22px; border: 1px solid rgba(15,23,42,.09); border-radius: 14px; background: #fff; box-shadow: 0 18px 50px rgba(15,23,42,.22), 0 3px 10px rgba(15,23,42,.1); color: #172033; font: 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .card.long { display: flex; min-height: min(320px,calc(100vh - 24px)); overflow: hidden; flex-direction: column; }
      .top { display: flex; align-items: center; gap: 9px; }
      .source { flex: 1 1 auto; min-width: 0; font-size: 16px; font-weight: 650; overflow-wrap: anywhere; white-space: normal !important; }
      .card.long .source { max-height: min(22vh,180px); overflow-x: hidden; overflow-y: auto; line-height: 1.45; }
      .speak { flex: 0 0 32px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #e8f0ff; color: #2457d6; cursor: pointer; font-size: 12px; transition: background .15s, transform .15s; }
      .speak:hover { background: #d8e5ff; transform: scale(1.04); }
      .speech-progress-row { display: flex; align-items: center; margin-top: 6px; padding: 0 2px; }
      .speech-progress { width: 100%; height: 16px; margin: 0; accent-color: #2457d6; cursor: pointer; }
      .transcription { flex: 0 1 auto; min-width: 72px; max-width: 48%; min-height: 18px; overflow: hidden; color: #58677d; font: 14px/1.3 Georgia,serif; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
      .card.speech-seekable .transcription { display: none; }
      .muted { font-family: inherit; font-size: 12px; color: #8a96a8; }
      .divider { height: 1px; margin: 8px 0; background: #e9edf3; }
      .translation { min-width: 0; min-height: 20px; color: #172033; font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; white-space: normal !important; }
      .card.long .translation { min-height: 120px; max-height: min(48vh,420px); overflow-x: hidden; overflow-y: auto; }
      .translation-option { min-width: 0; color: #172033; font-size: 16px; font-weight: 400; overflow-wrap: anywhere; white-space: normal !important; }
      .translation-option + .translation-option { margin-top: 2px; }
      .context-translation { margin-top: 6px; padding-top: 6px; border-top: 1px solid #edf0f4; color: #172033; font-size: 14px; font-style: normal; }
      .storage-limit { margin-top: 10px; padding: 10px; border: 1px solid #f2cf8d; border-radius: 10px; background: #fff8e8; color: #5f4515; font-size: 12px; line-height: 1.4; }
      .storage-limit-actions { display: flex; gap: 7px; margin-top: 8px; }
      .storage-limit-actions button { padding: 7px 10px; border: 0; border-radius: 8px; cursor: pointer; font: 600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .storage-limit-export { background: #2457d6; color: #fff; }
      .storage-limit-export:disabled { cursor: default; opacity: .55; }
      .storage-limit-later { background: #ece7dc; color: #5f5748; }
      .status { position: absolute; right: 14px; bottom: 8px; color: #27864a; font-size: 16px; font-weight: 700; line-height: 1; }
      .status.pending { color: #7b8798; font-size: 13px; font-weight: 400; }
      .error { color: #b42318; }
      .skeleton { border-radius: 5px; background: linear-gradient(90deg,#eef1f5 25%,#f7f8fa 50%,#eef1f5 75%); background-size: 200% 100%; color: transparent; animation: shimmer 1.2s infinite; }
      .skeleton.short { width: 96px; flex-basis: 96px; }
      @keyframes shimmer { to { background-position: -200% 0; } }
    `;
  }
})();
