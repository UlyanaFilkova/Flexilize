import browser from "webextension-polyfill";
import {
  errorMessage,
  type RecordsResponse,
  type SpeechAudioChunk,
  type SpeechAudioResponse,
  type TranslationRecord,
  type TranslateResponse
} from "./types";
import {uniqueTranslationForms} from "./translation-variants";
import {MAX_HISTORY_RECORDS} from "./history-config";
import {loadInterfaceLanguage, observeLocalizedDom} from "./i18n";
import {
  defaultSettings,
  formatShortcut,
  getExtensionSettings,
  matchesShortcut,
  normalizeSettings,
  SETTINGS_KEY,
  type ExtensionSettings
} from "./settings";

(() => {
  const extensionApi = browser;
  const HOST_ID = "context-translator-extension-host";
  const TRANSLATOR_HOST_ID = "context-translator-input-host";
  const INSTANCE_ATTRIBUTE = "data-context-translator-instance";
  const instanceId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const MAX_SELECTION_LENGTH = 1000;
  const SOURCE_LANGUAGES = [
    ["af", "Afrikaans"], ["sq", "Shqip"], ["ar", "العربية"], ["hy", "Հայերեն"],
    ["az", "Azərbaycan dili"], ["eu", "Euskara"], ["be", "Беларуская"], ["bn", "বাংলা"],
    ["bg", "Български"], ["ca", "Català"], ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"],
    ["hr", "Hrvatski"], ["cs", "Čeština"], ["da", "Dansk"], ["nl", "Nederlands"],
    ["en", "English"], ["et", "Eesti"], ["fi", "Suomi"], ["fr", "Français"],
    ["ka", "ქართული"], ["de", "Deutsch"], ["el", "Ελληνικά"], ["he", "עברית"],
    ["hi", "हिन्दी"], ["hu", "Magyar"], ["is", "Íslenska"], ["id", "Bahasa Indonesia"],
    ["ga", "Gaeilge"], ["it", "Italiano"], ["ja", "日本語"], ["kk", "Қазақша"],
    ["ko", "한국어"], ["lv", "Latviešu"], ["lt", "Lietuvių"], ["mk", "Македонски"],
    ["ms", "Bahasa Melayu"], ["mt", "Malti"], ["no", "Norsk"], ["fa", "فارسی"],
    ["pl", "Polski"], ["pt", "Português"], ["ro", "Română"], ["ru", "Русский"],
    ["sr", "Српски"], ["sk", "Slovenčina"], ["sl", "Slovenščina"], ["es", "Español"],
    ["sw", "Kiswahili"], ["sv", "Svenska"], ["th", "ไทย"], ["tr", "Türkçe"],
    ["uk", "Українська"], ["ur", "اردو"], ["uz", "O‘zbekcha"], ["vi", "Tiếng Việt"], ["tl", "Filipino"],
    ["cy", "Cymraeg"]
  ] as const;

  // Extension.js reloads the extension context during development, but DOM
  // created by the previous content-script instance can survive that reload.
  // Remove its inert modal before installing the new instance.
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(TRANSLATOR_HOST_ID)?.remove();
  document.documentElement.setAttribute(INSTANCE_ATTRIBUTE, instanceId);

  let host: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let translatorHost: HTMLDivElement | null = null;
  let translatorShadow: ShadowRoot | null = null;
  let translatorTimer: ReturnType<typeof setTimeout> | undefined;
  let translatorRequest = 0;
  let currentText = "";
  let currentSentence = "";
  let currentSourceLanguage = "en";
  let manuallySelectedLanguage = "";
  let languageInputDirty = false;
  let requestNumber = 0;
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
  let activationSettings: ExtensionSettings = defaultSettings;
  let activationSettingsReady = false;
  let pendingManualRecord: TranslationRecord | null = null;
  let manualSaveRequested = false;
  const deferredManualSaveRequests = new Set<number>();

  document.addEventListener("mouseup", scheduleSelection, true);
  document.addEventListener("keydown", handleTranslatorKeydown, true);
  document.addEventListener("keydown", handleActivationKeydown, true);
  document.addEventListener("keyup", (event) => {
    const key = typeof event.key === "string" ? event.key : "";
    if (key.startsWith("Arrow") || key === "Shift") scheduleSelection();
  }, true);
  document.addEventListener("select", scheduleSelection, true);
  document.addEventListener("pointerdown", handleOutsidePointerDown, true);
  document.addEventListener("scroll", closeModal, true);
  window.addEventListener("blur", closeModal);

  void getExtensionSettings()
    .then(async (settings) => {
      activationSettings = settings;
      await loadInterfaceLanguage(settings.interfaceLanguage);
    })
    .finally(() => { activationSettingsReady = true; });
  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    const speechWasEnabled = activationSettings.speechEnabled;
    const transcriptionWasEnabled = activationSettings.transcriptionEnabled;
    const previousInterfaceLanguage = activationSettings.interfaceLanguage;
    activationSettings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    activationSettingsReady = true;
    const translatorShortcutHint = translatorShadow?.querySelector<HTMLElement>(".translator-shortcut-hint");
    if (translatorShortcutHint) translatorShortcutHint.textContent = formatShortcut(activationSettings.translatorShortcut);
    const saveButton = shadow?.querySelector<HTMLButtonElement>(".save-translation");
    if (saveButton) saveButton.hidden = activationSettings.autoSaveTranslations;
    if (activationSettings.historyRotationEnabled) shadow?.querySelector(".storage-limit")?.remove();
    if (speechWasEnabled && !activationSettings.speechEnabled) {
      stopSpeaking();
      shadow?.querySelector(".speak")?.remove();
      shadow?.querySelector(".speech-progress-row")?.remove();
    }
    if (transcriptionWasEnabled && !activationSettings.transcriptionEnabled) {
      shadow?.querySelector(".transcription")?.remove();
    }
    if (previousInterfaceLanguage !== activationSettings.interfaceLanguage) {
      activationSettingsReady = false;
      void loadInterfaceLanguage(activationSettings.interfaceLanguage).finally(() => {
        closeModal();
        closeTranslator();
        activationSettingsReady = true;
      });
    }
  });

  if (window.speechSynthesis) {
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
  }

  function scheduleSelection() {
    if (!isCurrentInstance() || !activationSettingsReady || activationSettings.hotkeyActivationEnabled) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(processSelection, 60);
  }

  function handleTranslatorKeydown(event: KeyboardEvent) {
    if (!isCurrentInstance() || !activationSettingsReady || event.repeat
      || !matchesShortcut(event, activationSettings.translatorShortcut)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (translatorHost) {
      closeTranslator();
    } else {
      showTranslator();
    }
  }

  function showTranslator() {
    closeModal();
    translatorHost = document.createElement("div");
    translatorHost.id = TRANSLATOR_HOST_ID;
    translatorHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;inset:0";
    translatorShadow = translatorHost.attachShadow({mode: "closed"});
    document.documentElement.append(translatorHost);

    const languageOptions = SOURCE_LANGUAGES
      .map(([code, name]) => `<option value="${code}">${name}</option>`)
      .join("");
    translatorShadow.innerHTML = `
      <style>${translatorStyles()}</style>
      <div class="backdrop">
        <section class="translator" role="dialog" aria-modal="true" aria-label="Переводчик">
          <header><strong>Переводчик</strong><span class="drag-handle" aria-hidden="true"><svg viewBox="0 0 18 12"><circle cx="5" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="13" cy="3" r="1.4"/><circle cx="5" cy="9" r="1.4"/><circle cx="9" cy="9" r="1.4"/><circle cx="13" cy="9" r="1.4"/></svg></span><span class="translator-header-actions"><span class="translator-shortcut-hint" title="Горячая клавиша переводчика"></span><button class="close" type="button" aria-label="Закрыть">×</button></span></header>
          <div class="languages">
            <select class="source-language" aria-label="Исходный язык">${languageOptions}</select>
            <button class="swap" type="button" aria-label="Поменять языки местами" title="Поменять языки местами">⇄</button>
            <select class="target-language" aria-label="Язык перевода">${languageOptions}</select>
          </div>
          <div class="panes">
            <div class="translator-pane">
              <textarea class="translator-input" maxlength="1000" placeholder="Введите текст" aria-label="Текст для перевода"></textarea>
              <button class="copy copy-input" type="button" aria-label="Копировать весь исходный текст" title="Копировать всё"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>
            </div>
            <div class="translator-pane">
              <div class="translator-output" role="status" aria-live="polite" data-placeholder="Перевод"></div>
              <button class="copy copy-output" type="button" aria-label="Копировать весь перевод" title="Копировать всё"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>
            </div>
          </div>
          <div class="translator-status"></div>
        </section>
      </div>`;
    observeLocalizedDom(translatorShadow, activationSettings.interfaceLanguage);

    const backdrop = translatorShadow.querySelector<HTMLElement>(".backdrop")!;
    const dialog = translatorShadow.querySelector<HTMLElement>(".translator")!;
    const header = translatorShadow.querySelector<HTMLElement>("header")!;
    const panes = translatorShadow.querySelector<HTMLElement>(".panes")!;
    const input = translatorShadow.querySelector<HTMLTextAreaElement>(".translator-input")!;
    const source = translatorShadow.querySelector<HTMLSelectElement>(".source-language")!;
    const target = translatorShadow.querySelector<HTMLSelectElement>(".target-language")!;
    translatorShadow.querySelector<HTMLElement>(".translator-shortcut-hint")!.textContent = formatShortcut(activationSettings.translatorShortcut);
    source.value = activationSettings.translatorSourceLanguage;
    target.value = activationSettings.translatorTargetLanguage;

    const resizeTranslatorPanes = () => {
      input.style.height = "0px";
      const maximumHeight = Math.max(250, Math.min(520, window.innerHeight - 220));
      panes.style.height = `${Math.min(maximumHeight, Math.max(250, input.scrollHeight))}px`;
      input.style.height = "";
    };

    let offsetX = 0;
    let offsetY = 0;
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target as Element).closest("button")) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const startOffsetX = offsetX;
      const startOffsetY = offsetY;
      const startRect = dialog.getBoundingClientRect();
      header.setPointerCapture(event.pointerId);
      dialog.classList.add("dragging");

      const move = (moveEvent: PointerEvent) => {
        const deltaX = Math.max(8 - startRect.left, Math.min(
          moveEvent.clientX - startX,
          window.innerWidth - 8 - startRect.right
        ));
        const deltaY = Math.max(8 - startRect.top, Math.min(
          moveEvent.clientY - startY,
          window.innerHeight - 8 - startRect.bottom
        ));
        offsetX = startOffsetX + deltaX;
        offsetY = startOffsetY + deltaY;
        dialog.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
      };
      const stop = () => {
        dialog.classList.remove("dragging");
        header.removeEventListener("pointermove", move);
        header.removeEventListener("pointerup", stop);
        header.removeEventListener("pointercancel", stop);
      };
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", stop);
      header.addEventListener("pointercancel", stop);
    });

    const scheduleTranslation = (immediate = false) => {
      clearTimeout(translatorTimer);
      translatorTimer = setTimeout(() => void translateTypedText(), immediate ? 0 : 350);
    };
    backdrop.addEventListener("pointerdown", (event) => {
      if (!event.composedPath().includes(dialog)) closeTranslator();
    });
    translatorShadow.querySelector(".close")?.addEventListener("click", closeTranslator);
    translatorShadow.querySelector(".swap")?.addEventListener("click", () => {
      const selectionStart = input.selectionStart;
      const selectionEnd = input.selectionEnd;
      const previousSource = source.value;
      source.value = target.value;
      target.value = previousSource;
      scheduleTranslation(true);
      input.focus();
      input.setSelectionRange(selectionStart, selectionEnd);
    });
    const bindCopyButton = (selector: string, readText: () => string) => {
      const button = translatorShadow?.querySelector<HTMLButtonElement>(selector);
      if (!button) return;
      const copyIcon = button.innerHTML;
      button.addEventListener("click", async () => {
        const value = readText();
        if (!value) return;
        try {
          await copyToClipboard(value);
          button.textContent = "✓";
          setTimeout(() => {
            if (button.isConnected) button.innerHTML = copyIcon;
          }, 1200);
        } catch (_error) {
          // The browser can deny clipboard access on restricted pages.
        }
      });
    };
    bindCopyButton(".copy-input", () => input.value);
    bindCopyButton(".copy-output", () => translatorShadow?.querySelector<HTMLElement>(".translator-output")?.textContent || "");
    source.addEventListener("change", () => scheduleTranslation(true));
    target.addEventListener("change", () => scheduleTranslation(true));
    input.addEventListener("input", () => {
      resizeTranslatorPanes();
      scheduleTranslation();
    });
    translatorShadow.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") closeTranslator();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        scheduleTranslation(true);
      }
    });
    requestAnimationFrame(() => {
      resizeTranslatorPanes();
      input.focus();
    });
  }

  async function translateTypedText() {
    const input = translatorShadow?.querySelector<HTMLTextAreaElement>(".translator-input");
    const output = translatorShadow?.querySelector<HTMLElement>(".translator-output");
    const status = translatorShadow?.querySelector<HTMLElement>(".translator-status");
    const source = translatorShadow?.querySelector<HTMLSelectElement>(".source-language");
    const target = translatorShadow?.querySelector<HTMLSelectElement>(".target-language");
    if (!input || !output || !status || !source || !target) return;
    const text = input.value.trim();
    const ownRequest = ++translatorRequest;
    if (!text) {
      output.textContent = "";
      status.textContent = "";
      status.classList.remove("error");
      return;
    }
    output.classList.add("loading");
    status.classList.remove("error");
    status.textContent = "Переводим…";
    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "translate-preview",
        payload: {text, sentence: text, sourceLanguage: source.value, targetLanguage: target.value}
      }) as TranslateResponse;
      if (ownRequest !== translatorRequest || !translatorShadow) return;
      if (!result?.ok || !result.translation) throw new Error(result?.error || "Не удалось получить перевод");
      output.textContent = result.translation;
      status.textContent = result.warning || "";
    } catch (error) {
      if (ownRequest !== translatorRequest || !translatorShadow) return;
      output.textContent = "";
      status.textContent = errorMessage(error, "Не удалось получить перевод");
      status.classList.add("error");
    } finally {
      if (ownRequest === translatorRequest) output.classList.remove("loading");
    }
  }

  function closeTranslator() {
    clearTimeout(translatorTimer);
    translatorRequest += 1;
    translatorHost?.remove();
    translatorHost = null;
    translatorShadow = null;
  }

  async function copyToClipboard(value: string) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch (_error) {
        // Fall back to the legacy copy command when page permissions deny the Clipboard API.
      }
    }
    const field = document.createElement("textarea");
    field.value = value;
    field.style.cssText = "position:fixed;left:-9999px;top:-9999px";
    document.documentElement.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("Clipboard access denied");
  }

  function handleActivationKeydown(event: KeyboardEvent) {
    if (!isCurrentInstance() || !activationSettingsReady || !activationSettings.hotkeyActivationEnabled
      || event.repeat || !matchesShortcut(event, activationSettings.activationShortcut)) return;
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(selectionTimer);
    void processSelection();
  }

  async function processSelection() {
    if (!isCurrentInstance()) return;
    const details = readSelection();
    if (!details || details.text === currentText) return;

    currentText = details.text;
    currentSentence = details.sentence;

    if (!activationSettings.showSelectionTranslationModal) {
      removeModal();
      await saveSelectionInBackground(details.text, details.sentence);
      if (currentText === details.text && !host) currentText = "";
      return;
    }

    const ownRequest = ++requestNumber;
    showModal(details.rect, details.text, ownRequest);
    if (!extensionApi?.runtime?.sendMessage) {
      showError("API расширения недоступно на этой странице");
      return;
    }
    await loadTranslationStages(details.text, details.sentence, ownRequest);
  }

  async function saveSelectionInBackground(text: string, sentence: string) {
    if (!extensionApi?.runtime?.sendMessage) return;
    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "translate-selection",
        payload: {
          text,
          sentence,
          pageTitle: document.title,
          pageUrl: location.href,
          targetLanguage: activationSettings.targetLanguage,
          transcription: null,
          transcriptionLoaded: !activationSettings.transcriptionEnabled,
          save: true
        }
      }) as TranslateResponse;
      if (!result?.ok) throw new Error(result?.error || "Не удалось выполнить перевод");
    } catch (error) {
      if (!isInvalidatedContextError(error)) {
        console.warn(`[Context Translator] ${errorMessage(error, "Ошибка фонового перевода")}`);
      }
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

  function showModal(rect, text, ownRequest: number) {
    if (!isCurrentInstance()) return;
    // Replacing a modal is part of the current request. Calling closeModal()
    // here used to increment requestNumber, so every response was immediately
    // treated as stale and renderResult() was never reached.
    removeModal();
    currentSourceLanguage = "en";
    manuallySelectedLanguage = "";
    languageInputDirty = false;
    pendingManualRecord = null;
    manualSaveRequested = false;
    selectionRect = rect;
    const selectionWordCount = wordCount(text);
    const isLongSelection = text.length > 320 || selectionWordCount > 48;
    const showSpeechProgress = activationSettings.speechEnabled && wordCount(text) > 10;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0";
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);

    shadow.innerHTML = `
      <style>${modalStyles()}</style>
      <section class="card${isLongSelection ? " long" : ""}${showSpeechProgress ? " speech-seekable" : ""}" role="dialog" aria-label="Перевод выделенного текста">
        <div class="top">
          <div class="term-details">
            <div class="source"></div>
            ${activationSettings.transcriptionEnabled ? `<div class="transcription skeleton short${text.length > 42 ? " multiline" : ""}"></div>` : ""}
          </div>
          <div class="top-actions">
            ${activationSettings.speechEnabled ? `<button class="speak" type="button" aria-label="Озвучить выделенный текст" title="Озвучить">▶</button>` : ""}
            <button class="save-translation" type="button" ${activationSettings.autoSaveTranslations ? "hidden" : ""} disabled>Сохранить</button>
          </div>
        </div>
        ${showSpeechProgress ? `
          <div class="speech-progress-row">
            <input class="speech-progress" type="range" min="0" max="${text.length}" value="0"
              aria-label="Позиция озвучки" title="Позиция озвучки">
          </div>` : ""}
        <div class="divider"></div>
        <div class="translation skeleton"></div>
        <div class="translation-language">
          <label for="${HOST_ID}-language">Перевод с:</label>
          <div class="language-combobox">
            <input class="source-language" id="${HOST_ID}-language" placeholder="Определяется…"
              role="combobox" aria-label="Язык оригинала" aria-autocomplete="list"
              aria-controls="${HOST_ID}-languages" aria-expanded="false" autocomplete="off" spellcheck="false">
            <button class="language-clear" type="button" aria-label="Очистить язык" title="Очистить">×</button>
            <button class="language-toggle" type="button" aria-label="Показать все языки" title="Показать все языки">⌄</button>
            <div class="language-options" id="${HOST_ID}-languages" role="listbox" hidden></div>
          </div>
        </div>
      </section>`;

    shadow.querySelector(".source").textContent = text;
    observeLocalizedDom(shadow, activationSettings.interfaceLanguage);
    const speakButton = shadow.querySelector<HTMLButtonElement>(".speak");
    const progress = shadow.querySelector<HTMLInputElement>(".speech-progress");
    const languageInput = shadow.querySelector<HTMLInputElement>(".source-language");
    const languageClear = shadow.querySelector<HTMLButtonElement>(".language-clear");
    const languageToggle = shadow.querySelector<HTMLButtonElement>(".language-toggle");
    const saveButton = shadow.querySelector<HTMLButtonElement>(".save-translation");
    if (speakButton) speakButton.disabled = true;
    saveButton?.addEventListener("click", () => requestManualSave(saveButton, ownRequest));
    speakButton?.addEventListener("click", (event) => {
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
        stopSpeaking(speakButton || undefined);
      }
    });
    progress?.addEventListener("change", () => {
      const requestedPosition = Number(progress.value);
      if (requestedPosition >= text.length) {
        stopSpeaking(speakButton || undefined);
        return;
      }
      if (speakButton) speak(text, speakButton, requestedPosition);
    });
    languageInput?.addEventListener("input", () => {
      languageInputDirty = true;
      updateLanguageClearButton();
      openLanguageList(false);
    });
    languageInput?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeLanguageList();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openLanguageList(!languageInput.value);
        shadow?.querySelector<HTMLButtonElement>(".language-option")?.focus();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commitLanguageSelection(languageInput.value);
      }
    });
    languageClear?.addEventListener("click", () => {
      if (!languageInput) return;
      languageInput.value = "";
      languageInputDirty = true;
      updateLanguageClearButton();
      languageInput.focus();
      openLanguageList(true);
    });
    languageToggle?.addEventListener("click", () => {
      if (!languageInput) return;
      languageInput.focus();
      openLanguageList(true);
    });
    shadow.querySelector<HTMLElement>(".language-combobox")?.addEventListener("focusout", () => {
      setTimeout(() => {
        const active = shadow?.activeElement;
        const combobox = shadow?.querySelector<HTMLElement>(".language-combobox");
        if (!active || !combobox?.contains(active)) closeLanguageList();
      }, 0);
    });
    updateLanguageClearButton();
    positionModal(rect);
  }

  function languageCodeForInput(value: string) {
    const normalized = clean(value).toLocaleLowerCase("ru");
    if (!normalized) return "";
    const match = SOURCE_LANGUAGES.find(([code, name]) => (
      code.toLocaleLowerCase() === normalized
      || name.toLocaleLowerCase() === normalized
      || localizedLanguageName(code).toLocaleLowerCase("ru") === normalized
    ));
    return match?.[0] || "";
  }

  function commitLanguageSelection(value: string) {
    const language = languageCodeForInput(value);
    if (!language) return;
    const input = shadow?.querySelector<HTMLInputElement>(".source-language");
    if (input) input.value = languageName(language);
    languageInputDirty = false;
    updateLanguageClearButton();
    closeLanguageList();
    if (manuallySelectedLanguage === language) return;
    manuallySelectedLanguage = language;
    void reloadTranslation(language);
  }

  function openLanguageList(showAll: boolean) {
    if (!shadow) return;
    const input = shadow.querySelector<HTMLInputElement>(".source-language");
    const list = shadow.querySelector<HTMLElement>(".language-options");
    if (!input || !list) return;
    const filter = showAll ? "" : clean(input.value).toLocaleLowerCase();
    const matches = SOURCE_LANGUAGES
      .filter(([code, name]) => !filter || [
        code, name, localizedLanguageName(code)
      ].some((candidate) => candidate.toLocaleLowerCase().includes(filter)))
      .sort((left, right) => languageName(left[0]).localeCompare(languageName(right[0]), "ru"));
    list.replaceChildren();
    matches.forEach(([code, name]) => {
      const option = document.createElement("button");
      option.className = "language-option";
      option.type = "button";
      option.role = "option";
      option.textContent = languageName(code);
      option.addEventListener("click", () => commitLanguageSelection(code));
      option.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeLanguageList();
          input.focus();
        }
      });
      list.append(option);
    });
    list.hidden = false;
    shadow.querySelector(".card")?.classList.add("language-open");
    input.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      if (list.hidden) return;
      const controlRect = input.getBoundingClientRect();
      const listHeight = list.getBoundingClientRect().height;
      list.classList.toggle("above", controlRect.bottom + 4 + listHeight > window.innerHeight - 12
        && controlRect.top - 4 - listHeight >= 12);
    });
  }

  function closeLanguageList() {
    const input = shadow?.querySelector<HTMLInputElement>(".source-language");
    const list = shadow?.querySelector<HTMLElement>(".language-options");
    if (list) list.hidden = true;
    shadow?.querySelector(".card")?.classList.remove("language-open");
    input?.setAttribute("aria-expanded", "false");
  }

  function updateLanguageClearButton() {
    const input = shadow?.querySelector<HTMLInputElement>(".source-language");
    const button = shadow?.querySelector<HTMLButtonElement>(".language-clear");
    if (button) button.hidden = !input?.value;
  }

  async function reloadTranslation(sourceLanguage: string) {
    if (!shadow || !currentText) return;
    const ownRequest = ++requestNumber;
    const speakButton = shadow.querySelector<HTMLButtonElement>(".speak");
    stopSpeaking(speakButton || undefined);
    if (speakButton) speakButton.disabled = true;
    const translation = shadow.querySelector<HTMLElement>(".translation");
    translation?.replaceChildren();
    translation?.classList.remove("error");
    translation?.classList.add("skeleton");
    const transcription = shadow.querySelector<HTMLElement>(".transcription");
    transcription?.classList.remove("muted");
    transcription?.classList.add("skeleton", "short");
    if (transcription) transcription.textContent = "";

    await loadTranslationStages(currentText, currentSentence, ownRequest, sourceLanguage);
  }

  function renderResult(result: TranslateResponse & {translation: string}, displayedTranslation?: string) {
    setSpeechLanguage(result.sourceLanguage);
    renderTranslations(result, false, displayedTranslation);
    renderTranscription(result.transcription);
    pendingManualRecord = result.pendingRecord || null;
    const saveButton = shadow?.querySelector<HTMLButtonElement>(".save-translation");
    if (saveButton && !activationSettings.autoSaveTranslations) {
      if (!manualSaveRequested) {
        saveButton.disabled = false;
        saveButton.textContent = result.saved ? "✓ Сохранено" : "Сохранить";
      }
    }
    if (result.storageLimitReached) showStorageLimitNotice(result.pendingRecord);
  }

  function requestManualSave(button: HTMLButtonElement, ownRequest: number) {
    if (manualSaveRequested) return;
    manualSaveRequested = true;
    button.disabled = true;
    button.textContent = "✓ Сохранено";
    if (pendingManualRecord) {
      void persistManualRecord(button, pendingManualRecord, ownRequest);
    } else {
      deferredManualSaveRequests.add(ownRequest);
    }
  }

  async function persistManualRecord(button: HTMLButtonElement | null, record: TranslationRecord, ownRequest: number) {
    const hasActiveModal = ownRequest === requestNumber && button && shadow;
    if (hasActiveModal) pendingManualRecord = null;
    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "save-record",
        payload: {record}
      }) as TranslateResponse;
      if (!result?.ok) throw new Error(result?.error || "Не удалось сохранить перевод");
      if (result.storageLimitReached && !result.saved) {
        if (hasActiveModal && button) {
          manualSaveRequested = false;
          pendingManualRecord = result.pendingRecord || record;
          button.textContent = "Сохранить";
          button.disabled = false;
          showStorageLimitNotice(result.pendingRecord || record);
        }
        return;
      }
      if (hasActiveModal && button) button.textContent = "✓ Сохранено";
    } catch (error) {
      if (hasActiveModal && button) {
        manualSaveRequested = false;
        pendingManualRecord = record;
        button.disabled = false;
        button.textContent = "Сохранить";
        button.title = errorMessage(error, "Ошибка сохранения");
      }
    }
  }

  function showStorageLimitNotice(pendingRecord?: TranslationRecord) {
    if (!shadow || shadow.querySelector(".storage-limit")) return;
    const card = shadow.querySelector<HTMLElement>(".card");
    if (!card) return;

    const notice = document.createElement("div");
    notice.className = "storage-limit";
    const message = document.createElement("div");
    message.className = "storage-limit-message";
    message.textContent = `Достигнут лимит в ${MAX_HISTORY_RECORDS} переводов. Скачайте сохранённые записи и очистите хранилище, чтобы сохранять новые.`;
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

  function renderTranslations(
    result: TranslateResponse & {translation: string},
    contextPending = false,
    displayedTranslation?: string
  ) {
    const translation = shadow.querySelector(".translation");
    translation.classList.remove("skeleton");
    const alternatives = wordCount(currentText) <= 3 && Array.isArray(result.translations) && result.translations.length
      ? result.translations
      : [result.translation];
    const uniqueAlternatives = uniqueTranslationForms(displayedTranslation
      ? [displayedTranslation, ...alternatives]
      : alternatives);
    const displayedItem = displayedTranslation
      ? translation.querySelector<HTMLElement>(".translation-option")
      : null;
    const keepDisplayedItem = displayedItem?.textContent === uniqueAlternatives[0];
    if (keepDisplayedItem) {
      [...translation.children].forEach((child) => {
        if (child !== displayedItem) child.remove();
      });
    } else {
      translation.replaceChildren();
    }
    uniqueAlternatives.slice(keepDisplayedItem ? 1 : 0).forEach((value) => {
      const item = document.createElement("div");
      item.className = "translation-option";
      item.textContent = value;
      translation.append(item);
    });
    const context = document.createElement("div");
    context.className = "context-translation";
    context.textContent = result.contextTranslation || "";
    if (contextPending) context.classList.add("skeleton", "context-pending");
    translation.append(context);
    if (selectionRect) positionModal(selectionRect);
  }

  async function loadTranslationStages(text: string, sentence: string, ownRequest: number, requestedLanguage?: string) {
    let primaryRendered = false;
    const targetLanguage = activationSettings.targetLanguage;
    try {
      const preview = await extensionApi.runtime.sendMessage({
        type: "translate-preview",
        payload: {sentence, sourceLanguage: requestedLanguage, targetLanguage, text}
      }) as TranslateResponse;
      if (ownRequest !== requestNumber || !shadow) return;
      if (!preview?.ok || !preview.translation) throw new Error(preview?.error || "Не удалось выполнить перевод");

      const sourceLanguage = requestedLanguage || preview.sourceLanguage;
      setSpeechLanguage(sourceLanguage);
      renderTranslations(preview as TranslateResponse & {translation: string}, true);
      primaryRendered = true;
      const saveButton = shadow.querySelector<HTMLButtonElement>(".save-translation");
      if (saveButton && !activationSettings.autoSaveTranslations && !manualSaveRequested) {
        saveButton.disabled = false;
      }

      let transcription: string | null | undefined = null;
      if (activationSettings.transcriptionEnabled) {
        try {
          const transcriptionResult = await extensionApi.runtime.sendMessage({
            type: "get-transcription",
            payload: {language: sourceLanguage, text}
          }) as TranslateResponse;
          const requestIsActive = ownRequest === requestNumber && Boolean(shadow);
          if (!requestIsActive && !deferredManualSaveRequests.has(ownRequest)) return;
          if (transcriptionResult?.ok) transcription = transcriptionResult.transcription;
          if (requestIsActive) renderTranscription(transcription);
        } catch (error) {
          if (isInvalidatedContextError(error)) return closeModal();
          if (ownRequest === requestNumber && shadow) renderTranscription(null);
          if (ownRequest !== requestNumber && !deferredManualSaveRequests.has(ownRequest)) return;
        }
      }

      const result = await extensionApi.runtime.sendMessage({
        type: "translate-selection",
        payload: {
          text,
          sentence,
          pageTitle: document.title,
          pageUrl: location.href,
          sourceLanguage,
          targetLanguage,
          transcription,
          transcriptionLoaded: true,
          save: activationSettings.autoSaveTranslations
        }
      }) as TranslateResponse;
      if (!result?.ok || !result.translation) throw new Error(result?.error || "Не удалось выполнить контекстный перевод");
      const shouldSaveManually = deferredManualSaveRequests.delete(ownRequest);
      const activeButton = ownRequest === requestNumber
        ? shadow?.querySelector<HTMLButtonElement>(".save-translation") || null
        : null;
      if (ownRequest === requestNumber && shadow) {
        renderResult(result as TranslateResponse & {translation: string}, preview.translation);
      }
      if (shouldSaveManually && result.pendingRecord) {
        void persistManualRecord(activeButton, result.pendingRecord, ownRequest);
      }
    } catch (error) {
      deferredManualSaveRequests.delete(ownRequest);
      if (ownRequest !== requestNumber) return;
      if (isInvalidatedContextError(error)) return closeModal();
      if (primaryRendered) return;
      showError(errorMessage(error, "Ошибка перевода"));
    }
  }

  function setSpeechLanguage(language?: string) {
    if (language) currentSourceLanguage = language;
    const languageElement = shadow?.querySelector<HTMLInputElement>(".source-language");
    if (languageElement && language && !languageInputDirty) {
      languageElement.value = languageName(language);
      languageElement.title = `Код языка: ${language}`;
      updateLanguageClearButton();
    }
    const button = shadow?.querySelector<HTMLButtonElement>(".speak");
    if (button && language) {
      button.disabled = false;
      button.title = `Озвучить (${language})`;
    }
  }

  function languageName(language: string) {
    return localizedLanguageName(language);
  }

  function localizedLanguageName(language: string) {
    const normalized = String(language || "").replace(/_/g, "-").toLocaleLowerCase();
    let name = "";
    try {
      name = new Intl.DisplayNames(["ru"], { type: "language" }).of(normalized) || "";
    } catch (_error) {
      // The language code is still useful in browsers without Intl.DisplayNames.
    }
    const readableName = name
      ? `${name.charAt(0).toLocaleUpperCase("ru")}${name.slice(1)}`
      : normalized.toLocaleUpperCase();
    return readableName;
  }

  function renderTranscription(value) {
    const transcription = shadow?.querySelector<HTMLElement>(".transcription");
    if (!transcription) return;
    transcription.classList.remove("skeleton", "short");
    transcription.classList.toggle("multiline", Boolean(value && (value.length > 42 || currentText.length > 42)));
    transcription.textContent = value || "Транскрипция недоступна";
    transcription.classList.toggle("muted", !value);
  }

  function showError(message) {
    if (!shadow) return;
    renderTranscription(null);
    const translation = shadow.querySelector(".translation");
    translation.classList.remove("skeleton");
    translation.textContent = message;
    translation.classList.add("error");
  }

  function speak(text: string, button: HTMLButtonElement, requestedPosition = 0) {
    if (!activationSettings.speechEnabled) return;
    try {
      const context = getAudioContext();
      unlockAudioContext(context);
      void speakWithRemoteVoice(text, button, requestedPosition, context);
    } catch (error) {
      console.warn(`[Context Translator] Web Audio is unavailable: ${errorMessage(error, "unknown error")}`);
      speakWithBrowserVoice(text, button, requestedPosition);
    }
  }

  function speakWithBrowserVoice(text: string, button: HTMLButtonElement, requestedPosition = 0) {
    if (!window.speechSynthesis || !("SpeechSynthesisUtterance" in window)) {
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
    const locale = speechLocale(currentSourceLanguage);
    const voice = chooseVoice(locale);
    utterance.lang = voice?.lang || locale;
    utterance.voice = voice || null;
    utterance.rate = activationSettings.speechRate;
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
    window.speechSynthesis?.cancel();
    if (button) resetSpeakButton(button);
  }

  async function speakWithRemoteVoice(
    text: string,
    button: HTMLButtonElement,
    requestedPosition: number,
    context: AudioContext
  ) {
    const startPosition = nearestWordStart(text, requestedPosition);
    const spokenText = text.slice(startPosition).trimStart();
    const leadingWhitespace = text.slice(startPosition).length - spokenText.length;
    const actualStart = startPosition + leadingWhitespace;
    const progress = shadow?.querySelector<HTMLInputElement>(".speech-progress") || null;
    const ownSpeechRun = ++speechRun;

    stopRemoteSpeech();
    window.speechSynthesis?.cancel();
    speechLoading = true;
    button.textContent = "■";
    button.title = "Остановить озвучку";
    button.setAttribute("aria-label", "Остановить озвучку");
    if (progress) progress.value = String(actualStart);

    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "get-speech-audio",
        payload: { language: currentSourceLanguage, text: spokenText }
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

      if (context.state !== "running") await context.resume();
      if (context.state !== "running") throw new Error("Браузер не разрешил воспроизведение звука");
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
        source.playbackRate.value = activationSettings.speechRate;
        source.connect(context.destination);
        source.start(scheduledTime);
        sources.push(source);
        const playbackDuration = buffer.duration / activationSettings.speechRate;
        schedule.push({ chunk, startTime: scheduledTime, endTime: scheduledTime + playbackDuration });
        scheduledTime += playbackDuration;
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
      // A matching local voice remains available when network TTS is unavailable.
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
    const AudioContextConstructor = window.AudioContext
      || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio API is unavailable");
    if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextConstructor();
    return audioContext;
  }

  function unlockAudioContext(context: AudioContext) {
    // Chromium-based browsers may keep a newly created context suspended until
    // an audio source starts during a user gesture. A silent source makes the
    // first click unlock playback before the remote audio is downloaded.
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const silentBuffer = context.createBuffer(1, 1, context.sampleRate);
    const silentSource = context.createBufferSource();
    silentSource.buffer = silentBuffer;
    silentSource.connect(context.destination);
    silentSource.onended = () => silentSource.disconnect();
    silentSource.start(0);
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
      || Boolean(window.speechSynthesis?.speaking || window.speechSynthesis?.pending);
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
    const estimatedDuration = estimateSpeechDuration(spokenText, activationSettings.speechRate);
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

  function estimateSpeechDuration(value: string, speechRate: number) {
    const wordsPerMinute = 165 * speechRate;
    return Math.max(1200, (wordCount(value) / wordsPerMinute) * 60_000);
  }

  function nearestWordStart(text: string, requestedPosition: number) {
    let position = Math.max(0, Math.min(Math.floor(requestedPosition), text.length));
    while (position > 0 && /[\p{L}\p{M}'’ʼ-]/u.test(text[position - 1])) position -= 1;
    return position;
  }

  function speechLocale(language: string) {
    const normalized = String(language || "en").replace(/_/g, "-");
    return normalized.toLocaleLowerCase() === "en" ? "en-US" : normalized;
  }

  function resetSpeakButton(button: HTMLButtonElement) {
    button.textContent = "▶";
    button.title = `Озвучить (${currentSourceLanguage})`;
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
      : isSingleWord(currentText) ? 420 : 620;
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
    if (window.speechSynthesis) stopSpeaking();
  }

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function isSingleWord(value) {
    return /^[\p{L}\p{M}]+(?:['’ʼ-][\p{L}\p{M}]+)*$/u.test(value);
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

  function translatorStyles() {
    return `
      :host { color-scheme: light; }
      * { box-sizing: border-box; }
      button, select, textarea { font: inherit; }
      .backdrop { position: fixed; inset: 0; display: grid; padding: 24px; place-items: center; background: rgba(15,23,42,.28); font: 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .translator { display: flex; width: min(780px,100%); max-height: calc(100vh - 48px); overflow: hidden; flex-direction: column; border: 1px solid rgba(15,23,42,.1); border-radius: 16px; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.3); color: #172033; }
      header { position: relative; display: flex; height: 54px; flex: none; align-items: center; justify-content: space-between; padding: 0 16px 0 20px; border-bottom: 1px solid #e8ecf2; cursor: grab; touch-action: none; user-select: none; }
      .translator.dragging header { cursor: grabbing; }
      header strong { font-size: 16px; }
      .translator-header-actions { display: flex; align-items: center; gap: 8px; }
      .translator-shortcut-hint { padding: 5px 8px; border-radius: 7px; background: #f2f4f8; color: #7d8899; font-size: 10px; font-weight: 600; letter-spacing: .01em; white-space: nowrap; }
      .drag-handle { position: absolute; top: 50%; left: 50%; display: grid; width: 34px; height: 26px; place-items: center; transform: translate(-50%,-50%); color: #9aa5b5; pointer-events: none; }
      .drag-handle svg { width: 22px; height: 15px; fill: currentColor; }
      .close { display: grid; width: 34px; height: 34px; padding: 0; place-items: center; border: 0; border-radius: 9px; background: transparent; color: #6f7b8c; cursor: pointer; font-size: 24px; }
      .close:hover { background: #f1f4f8; color: #273245; }
      .languages { display: grid; grid-template-columns: 1fr 38px 1fr; flex: none; gap: 10px; padding: 14px 16px; border-bottom: 1px solid #e8ecf2; background: #fbfcfe; }
      select { appearance: none; min-width: 0; height: 38px; padding: 0 40px 0 12px; border: 1px solid #d8dee8; border-radius: 9px; outline: none; background-color: #fff; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='m1 1 5 5 5-5' fill='none' stroke='%237b8799' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-position: right 14px center; background-repeat: no-repeat; background-size: 12px 8px; color: #344054; }
      select:focus, textarea:focus { border-color: #6f8ff0; box-shadow: 0 0 0 3px rgba(49,91,232,.1); }
      .swap { border: 0; border-radius: 9px; background: #edf2ff; color: #315be8; cursor: pointer; font-size: 19px; }
      .panes { display: grid; grid-template-columns: 1fr 1fr; height: 250px; min-height: 0; overflow: hidden; flex: 0 1 auto; }
      .translator-pane { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
      .translator-input, .translator-output { width: 100%; height: 100%; min-height: 0; padding: 18px; border: 0; background: #fff; color: #172033; font-size: 17px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
      .translator-input { padding-bottom: 52px; overflow-y: auto; resize: none; outline: none; }
      .translator-output { padding-bottom: 52px; overflow-y: auto; border-left: 1px solid #e8ecf2; background: #fafbfe; }
      .translator-output:empty::before { color: #9aa3b1; content: attr(data-placeholder); }
      .translator-output.loading { color: #8792a4; }
      .copy { position: absolute; right: 12px; bottom: 12px; display: grid; width: 38px; height: 38px; padding: 0; place-items: center; border: 0; border-radius: 9px; background: transparent; color: #667386; cursor: pointer; font-size: 22px; }
      .copy-input { background: #fff; }
      .copy-output { background: #fafbfe; }
      .copy:hover { color: #315be8; }
      .copy svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .translator-status { min-height: 35px; flex: none; padding: 8px 18px; border-top: 1px solid #e8ecf2; color: #8792a4; font-size: 12px; }
      .translator-status.error { color: #b42318; }
      @media (max-width: 620px) { .backdrop { padding: 12px; } .translator-shortcut-hint { font-size: 9px; } .panes { grid-template-columns: 1fr; height: auto !important; max-height: calc(100vh - 190px); overflow-y: auto; } .translator-input, .translator-output { min-height: 150px; } .translator-output { border-top: 1px solid #e8ecf2; border-left: 0; } }
    `;
  }

  function modalStyles() {
    return `
      :host { color-scheme: light; }
      .card { position: fixed; box-sizing: border-box; max-height: calc(100vh - 24px); padding: 12px 14px; border: 1px solid rgba(15,23,42,.09); border-radius: 14px; background: #fff; box-shadow: 0 18px 50px rgba(15,23,42,.22), 0 3px 10px rgba(15,23,42,.1); color: #172033; font: 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .card.long { display: flex; min-height: min(320px,calc(100vh - 24px)); overflow: hidden; flex-direction: column; }
      .card.long.language-open { overflow: visible; }
      .top { display: flex; align-items: flex-start; gap: 9px; }
      .term-details { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: center; min-width: 0; gap: 9px; }
      .top-actions { display: flex; flex: none; align-items: center; gap: 9px; }
      .source { display: flex; flex: 1 1 auto; align-items: center; min-width: 0; min-height: 30px; font-size: 16px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; white-space: normal !important; }
      .card.long .source { max-height: min(22vh,180px); overflow-x: hidden; overflow-y: auto; line-height: 1.45; }
      .speak { flex: 0 0 32px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #e8f0ff; color: #2457d6; cursor: pointer; font-size: 12px; transition: background .15s, transform .15s; }
      .speak:hover { background: #d8e5ff; transform: scale(1.04); }
      .speak:disabled { cursor: wait; opacity: .55; transform: none; }
      .speech-progress-row { display: flex; align-items: center; margin-top: 6px; padding: 0 2px; }
      .speech-progress { width: 100%; height: 16px; margin: 0; accent-color: #2457d6; cursor: pointer; }
      .transcription { flex: 0 1 auto; min-width: 72px; max-width: 48%; min-height: 18px; overflow: hidden; color: #58677d; font: 14px/1.3 Georgia,serif; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
      .transcription.multiline { flex: 1 0 100%; max-width: 100%; min-height: 36px; overflow: visible; text-align: left; text-overflow: clip; white-space: normal; overflow-wrap: anywhere; }
      .transcription.multiline.short { width: 100%; flex-basis: 100%; }
      .card.speech-seekable .transcription { display: none; }
      .muted { font-family: inherit; font-size: 12px; color: #8a96a8; }
      .divider { height: 1px; margin: 4px 0; background: #e9edf3; }
      .translation-language { position: relative; z-index: 2; display: flex; align-items: center; justify-content: flex-end; gap: 7px; margin-top: 7px; color: #8994a5; font-size: 11px; line-height: 1.25; }
      .save-translation { flex: none; min-height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: #2457d6; color: #fff; cursor: pointer; font: 600 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .save-translation:hover:not(:disabled) { filter: brightness(.96); }
      .save-translation:disabled { cursor: default; opacity: .55; }
      .save-translation[hidden] { display: none; }
      .language-combobox { position: relative; width: 190px; }
      .source-language { box-sizing: border-box; width: 100%; height: 30px; padding: 0 56px 0 9px; border: 1px solid #dce3ed; border-radius: 8px; outline: none; background: #f8faff; color: #526078; font: 600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; text-overflow: ellipsis; }
      .source-language:focus { border-color: #7aa2ef; box-shadow: 0 0 0 3px rgba(36,87,214,.12); background: #fff; }
      .language-clear, .language-toggle { position: absolute; top: 1px; display: grid; width: 24px; height: 28px; padding: 0; place-items: center; border: 0; background: transparent; color: #7b8799; cursor: pointer; font: 16px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .language-clear { right: 29px; font-size: 18px; }
      .language-toggle { right: 5px; padding-bottom: 4px; font-size: 17px; }
      .language-clear:hover, .language-toggle:hover { color: #2457d6; }
      .language-clear[hidden] { display: none; }
      .language-options { position: absolute; top: calc(100% + 4px); right: 0; box-sizing: border-box; width: 100%; max-height: 220px; padding: 4px; overflow-x: hidden; overflow-y: auto; border: 1px solid #dce3ed; border-radius: 9px; background: #fff; box-shadow: 0 10px 28px rgba(15,23,42,.18); }
      .language-options.above { top: auto; bottom: calc(100% + 4px); }
      .language-options[hidden] { display: none; }
      .language-option { display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: transparent; color: #344259; cursor: pointer; font: 500 12px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; text-align: left; }
      .language-option:hover, .language-option:focus { outline: none; background: #edf3ff; color: #2457d6; }
      .translation { min-width: 0; min-height: 20px; color: #172033; font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; white-space: normal !important; }
      .card.long .translation { min-height: 120px; max-height: min(48vh,420px); overflow-x: hidden; overflow-y: auto; }
      .translation-option { min-width: 0; color: #172033; font-size: 16px; font-weight: 400; overflow-wrap: anywhere; white-space: normal !important; }
      .translation-option + .translation-option { margin-top: 2px; }
      .context-translation { min-height: 54px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #edf0f4; color: #172033; font-size: 14px; font-style: normal; }
      .context-translation.context-pending { height: 54px; border-top-color: transparent; }
      .storage-limit { margin-top: 10px; padding: 10px; border: 1px solid #f2cf8d; border-radius: 10px; background: #fff8e8; color: #5f4515; font-size: 12px; line-height: 1.4; }
      .storage-limit-actions { display: flex; gap: 7px; margin-top: 8px; }
      .storage-limit-actions button { padding: 7px 10px; border: 0; border-radius: 8px; cursor: pointer; font: 600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .storage-limit-export { background: #2457d6; color: #fff; }
      .storage-limit-export:disabled { cursor: default; opacity: .55; }
      .storage-limit-later { background: #ece7dc; color: #5f5748; }
      .error { color: #b42318; }
      .skeleton { border-radius: 5px; background: linear-gradient(90deg,#eef1f5 25%,#f7f8fa 50%,#eef1f5 75%); background-size: 200% 100%; color: transparent; animation: shimmer 1.2s infinite; }
      .translation.skeleton { min-height: 88px; }
      .skeleton.short { width: 96px; flex-basis: 96px; }
      @keyframes shimmer { to { background-position: -200% 0; } }
    `;
  }
})();
