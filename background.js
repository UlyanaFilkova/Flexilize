const extensionApi = globalThis.browser ?? globalThis.chrome;
const RECORDS_KEY = "translationRecords";
const MAX_RECORDS = 5000;
const transcriptionCache = new Map();

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "translate-selection") {
    handleSelection(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
    return true;
  }

  if (message?.type === "get-records") {
    getRecords()
      .then((records) => sendResponse({ ok: true, records }))
      .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
    return true;
  }

  if (message?.type === "clear-records") {
    clearRecords()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
    return true;
  }

  return false;
});

async function handleSelection(payload) {
  const text = normalizeText(payload?.text, 1000);
  const sentence = normalizeText(payload?.sentence, 3000);

  if (!text) {
    throw new Error("Не удалось прочитать выделенный текст");
  }

  const sourceLanguage = await detectLanguage(text);
  const [translationResult, transcription] = await Promise.all([
    translateToRussian(text, sourceLanguage),
    getTranscription(text, sourceLanguage)
  ]);

  const record = {
    id: createId(),
    text,
    sentence: sentence || text,
    translation: translationResult.text,
    sourceLanguage,
    pageTitle: normalizeText(payload?.pageTitle, 500),
    pageUrl: normalizeUrl(payload?.pageUrl),
    createdAt: new Date().toISOString()
  };

  await saveRecord(record);

  return {
    ok: true,
    translation: translationResult.text,
    transcription,
    sourceLanguage,
    saved: true,
    warning: translationResult.warning ?? null
  };
}

async function detectLanguage(text) {
  if (extensionApi?.i18n?.detectLanguage) {
    try {
      const result = await extensionApi.i18n.detectLanguage(text);
      const best = result?.languages?.find((item) => item.percentage >= 20);
      if (best?.language) return normalizeLanguage(best.language);
    } catch (_error) {
      // The translation provider still works with a conservative fallback.
    }
  }

  return /[А-Яа-яЁё]/u.test(text) ? "ru" : "en";
}

async function translateToRussian(text, sourceLanguage) {
  if (sourceLanguage === "ru") {
    return { text };
  }

  const chunks = splitByUtf8Bytes(text, 450);
  const translatedChunks = [];
  let warning = null;

  for (const chunk of chunks) {
    const result = await translateChunk(chunk, supportedMyMemoryLanguage(sourceLanguage));
    translatedChunks.push(result.text);
    warning ||= result.warning;
  }

  return { text: translatedChunks.join(" "), warning };
}

async function getTranscription(text, language) {
  if (language !== "en") return null;

  const words = text.match(/[A-Za-z][A-Za-z'-]*/g);
  if (!words?.length || words.length > 12) return null;
  const phonetics = await Promise.all(words.map(fetchEnglishPhonetic));
  return phonetics.some(Boolean)
    ? phonetics.map((phonetic, index) => phonetic || words[index]).join(" ")
    : null;
}

async function translateChunk(text, sourceLanguage) {
  const query = new URLSearchParams({ q: text, langpair: `${sourceLanguage}|ru` });
  const response = await fetch(`https://api.mymemory.translated.net/get?${query}`, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Сервис перевода временно недоступен (${response.status})`);
  }

  const data = await response.json();
  const translated = decodeHtmlEntities(data?.responseData?.translatedText ?? "").trim();
  if (!translated) throw new Error("Сервис перевода вернул пустой результат");
  return {
    text: translated,
    warning: Number(data?.responseStatus) === 200 ? null : "Перевод может быть неточным"
  };
}

async function fetchEnglishPhonetic(word) {
  const key = word.toLocaleLowerCase("en");
  if (transcriptionCache.has(key)) return transcriptionCache.get(key);

  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
    if (!response.ok) return null;
    const entries = await response.json();
    const entry = Array.isArray(entries) ? entries[0] : null;
    const phonetic = entry?.phonetic || entry?.phonetics?.find((item) => item?.text)?.text || null;
    if (transcriptionCache.size > 500) transcriptionCache.clear();
    transcriptionCache.set(key, phonetic);
    return phonetic;
  } catch (_error) {
    return null;
  }
}

async function saveRecord(record) {
  if (!extensionApi?.storage?.local) {
    throw new Error("Локальное хранилище недоступно");
  }

  const records = await getRecords();
  const duplicate = records[0]
    && records[0].text === record.text
    && records[0].sentence === record.sentence
    && Date.now() - new Date(records[0].createdAt).getTime() < 3000;

  if (!duplicate) records.unshift(record);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  await extensionApi.storage.local.set({ [RECORDS_KEY]: records });
}

async function getRecords() {
  if (!extensionApi?.storage?.local) return [];
  const stored = await extensionApi.storage.local.get(RECORDS_KEY);
  return Array.isArray(stored?.[RECORDS_KEY]) ? stored[RECORDS_KEY] : [];
}

async function clearRecords() {
  if (!extensionApi?.storage?.local) return;
  await extensionApi.storage.local.set({ [RECORDS_KEY]: [] });
}

function normalizeText(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href.slice(0, 3000) : "";
  } catch (_error) {
    return "";
  }
}

function normalizeLanguage(language) {
  return String(language).toLowerCase().split("-")[0];
}

function supportedMyMemoryLanguage(language) {
  const supported = new Set([
    "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hu",
    "it", "ja", "ko", "lt", "lv", "nl", "pl", "pt", "ro", "sk", "sl", "sv",
    "tr", "uk", "zh"
  ]);
  return supported.has(language) ? language : "en";
}

function splitByUtf8Bytes(text, limit) {
  const encoder = new TextEncoder();
  const chunks = [];
  let remaining = text.trim();

  while (encoder.encode(remaining).length > limit) {
    let end = Math.min(remaining.length, limit);
    while (end > 1 && encoder.encode(remaining.slice(0, end)).length > limit) end -= 1;
    const candidate = remaining.slice(0, end);
    const boundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "), candidate.lastIndexOf(", "), candidate.lastIndexOf(" "));
    if (boundary > Math.floor(end * 0.55)) end = boundary + 1;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readableError(error) {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}
