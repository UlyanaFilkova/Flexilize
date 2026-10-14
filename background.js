const extensionApi = globalThis.browser ?? globalThis.chrome;
const RECORDS_KEY = "translationRecords";
const MAX_RECORDS = 5000;
const TRANSCRIPTION_TIMEOUT_MS = 4500;
const DICTIONARY_REQUEST_TIMEOUT_MS = 2500;
const transcriptionCache = new Map();

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "translate-selection") {
    handleSelection(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
    return true;
  }

  if (message?.type === "get-transcription") {
    handleTranscription(message.payload)
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

  const translationResult = await translateToRussian(text);

  const record = {
    id: createId(),
    text,
    sentence: sentence || text,
    translation: translationResult.text,
    sourceLanguage: "en",
    pageTitle: normalizeText(payload?.pageTitle, 500),
    pageUrl: normalizeUrl(payload?.pageUrl),
    createdAt: new Date().toISOString()
  };

  await saveRecord(record);

  return {
    ok: true,
    translation: translationResult.text,
    sourceLanguage: "en",
    saved: true,
    warning: translationResult.warning ?? null
  };
}

async function handleTranscription(payload) {
  const text = normalizeText(payload?.text, 500);
  if (!text) return { ok: true, transcription: null };

  const transcription = await settleWithin(
    getTranscription(text),
    TRANSCRIPTION_TIMEOUT_MS,
    null
  );
  return { ok: true, transcription };
}

async function translateToRussian(text) {
  const chunks = splitByUtf8Bytes(text, 450);
  const translatedChunks = [];
  let warning = null;

  for (const chunk of chunks) {
    const result = await translateChunk(chunk);
    translatedChunks.push(result.text);
    warning ||= result.warning;
  }

  return { text: translatedChunks.join(" "), warning };
}

async function getTranscription(text) {
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g);
  if (!words?.length || words.length > 30) return null;

  const phraseTranscription = await fetchDatamuseTranscription(words.join(" "));
  if (phraseTranscription) return phraseTranscription;

  const uniqueWords = [...new Set(words.map((word) => word.toLocaleLowerCase("en")))];
  const entries = await Promise.all(uniqueWords.map(async (word) => [word, await fetchEnglishPhonetic(word)]));
  const phoneticsByWord = new Map(entries);
  const phonetics = words.map((word) => phoneticsByWord.get(word.toLocaleLowerCase("en")) || null);
  return phonetics.some(Boolean)
    ? phonetics.map((phonetic, index) => phonetic || words[index]).join(" ")
    : null;
}

async function fetchDatamuseTranscription(text) {
  try {
    const query = new URLSearchParams({ sp: text, qe: "sp", md: "r", ipa: "1", max: "1" });
    const response = await fetchWithTimeout(
      `https://api.datamuse.com/words?${query}`,
      DICTIONARY_REQUEST_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const results = await response.json();
    const pronunciation = Array.isArray(results)
      ? results[0]?.tags?.find((tag) => tag.startsWith("pron:"))?.slice(5).trim()
      : null;
    return formatPhonetic(pronunciation);
  } catch (_error) {
    return null;
  }
}

async function translateChunk(text) {
  const query = new URLSearchParams({ q: text, langpair: "en|ru" });
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
    const response = await fetchWithTimeout(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`,
      DICTIONARY_REQUEST_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const entries = await response.json();
    const definitions = Array.isArray(entries) ? entries : [];
    const phonetic = definitions.find((entry) => entry?.phonetic)?.phonetic
      || definitions.flatMap((entry) => entry?.phonetics || []).find((item) => item?.text)?.text
      || null;
    const formatted = formatPhonetic(phonetic);
    if (transcriptionCache.size > 500) transcriptionCache.clear();
    transcriptionCache.set(key, formatted);
    return formatted;
  } catch (_error) {
    return null;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timeout);
  }
}

function formatPhonetic(value) {
  const phonetic = String(value ?? "").trim();
  if (!phonetic) return null;
  return /^[\/[].*[\/\]]$/.test(phonetic) ? phonetic : `/${phonetic}/`;
}

async function settleWithin(promise, timeoutMs, fallback) {
  let timeout;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
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
