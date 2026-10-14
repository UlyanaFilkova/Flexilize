const extensionApi = globalThis.browser ?? globalThis.chrome;
const RECORDS_KEY = "translationRecords";
const MAX_RECORDS = 5000;
const TRANSCRIPTION_TIMEOUT_MS = 4500;
const DICTIONARY_REQUEST_TIMEOUT_MS = 2500;
const WIKTIONARY_REQUEST_TIMEOUT_MS = 3500;
const CONTEXT_START = "\uE000";
const CONTEXT_END = "\uE001";
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

  const translationResult = await translateToRussian(text, sentence);

  const record = {
    id: createId(),
    text,
    sentence: sentence || text,
    translation: translationResult.text,
    translations: translationResult.alternatives,
    contextTranslation: translationResult.contextTranslation || null,
    sourceLanguage: "en",
    pageTitle: normalizeText(payload?.pageTitle, 500),
    pageUrl: normalizeUrl(payload?.pageUrl),
    createdAt: new Date().toISOString()
  };

  await saveRecord(record);

  return {
    ok: true,
    translation: translationResult.text,
    translations: translationResult.alternatives || [translationResult.text],
    contextTranslation: translationResult.contextTranslation || null,
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

async function translateToRussian(text, sentence) {
  if (/^[A-Za-z][A-Za-z'-]*$/.test(text)) {
    return translateWordToRussian(text, sentence);
  }

  const chunks = splitByUtf8Bytes(text, 450);
  const translatedChunks = [];
  let warning = null;

  for (const chunk of chunks) {
    const result = await translateChunk(chunk);
    translatedChunks.push(result.text);
    warning ||= result.warning;
  }

  const translation = translatedChunks.join(" ");
  return { text: translation, alternatives: [translation], warning };
}

async function translateWordToRussian(word, sentence) {
  const forms = englishWordForms(word);
  const markedContext = buildMarkedContext(sentence, word);
  const [results, contextResult, dictionaryTranslations] = await Promise.all([
    Promise.all(forms.map(async (form) => {
      try {
        return await translateChunk(form);
      } catch (_error) {
        return null;
      }
    })),
    markedContext ? translateContext(markedContext).catch(() => null) : null,
    fetchWiktionaryTranslations(word)
  ]);
  const successful = results.filter(Boolean);
  if (!successful.length && !contextResult?.selectedTranslation) {
    throw new Error("Сервис перевода временно недоступен");
  }

  const likelyPartOfSpeech = inferPartOfSpeech(word, sentence, dictionaryTranslations);
  const rankedDictionary = dictionaryTranslations
    .map((entry) => ({
      ...entry,
      score: contextMatchScore(entry.text, contextResult?.fullTranslation)
        + (entry.partOfSpeech === likelyPartOfSpeech ? 25 : 0)
    }))
    .sort((left, right) => right.score - left.score);
  const contextualDictionary = rankedDictionary.filter((entry) => entry.score >= 100);
  const otherDictionary = rankedDictionary.filter((entry) => entry.score < 100);
  const machineTranslations = successful.flatMap((result) => (
    dictionaryTranslations.length ? [result.text] : (result.alternatives || [result.text])
  ));
  const alternatives = uniqueRussianTranslations([
    contextResult?.selectedTranslation,
    ...contextualDictionary.map((entry) => entry.text),
    ...machineTranslations,
    ...otherDictionary.map((entry) => entry.text)
  ], word).slice(0, 6);
  const primary = alternatives[0] || successful[0]?.text || word;
  return {
    text: primary,
    alternatives: alternatives.length ? alternatives : [primary],
    contextTranslation: contextResult?.fullTranslation || null,
    warning: successful.find((result) => result.warning)?.warning || null
  };
}

async function fetchWiktionaryTranslations(word) {
  try {
    const query = new URLSearchParams({
      action: "query",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      titles: word.toLocaleLowerCase("en"),
      format: "json",
      formatversion: "2",
      origin: "*"
    });
    const response = await fetchWithTimeout(
      `https://en.wiktionary.org/w/api.php?${query}`,
      WIKTIONARY_REQUEST_TIMEOUT_MS
    );
    if (!response.ok) return [];
    const data = await response.json();
    const wikitext = data?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content;
    return typeof wikitext === "string" ? parseWiktionaryRussianTranslations(wikitext) : [];
  } catch (_error) {
    return [];
  }
}

function parseWiktionaryRussianTranslations(wikitext) {
  const englishStart = wikitext.search(/^==English==\s*$/m);
  if (englishStart < 0) return [];
  const afterEnglish = wikitext.slice(englishStart + "==English==".length);
  const nextLanguage = afterEnglish.search(/^==[^=].*==\s*$/m);
  const english = nextLanguage >= 0 ? afterEnglish.slice(0, nextLanguage) : afterEnglish;
  const headings = [...english.matchAll(/^===(Adjective|Adverb|Noun|Verb)===\s*$/gim)];
  const translations = [];

  headings.forEach((heading, index) => {
    const section = english.slice(heading.index, headings[index + 1]?.index ?? english.length);
    const templatePattern = /{{(?:t|t\+|t-check|t\+check|tt|tt\+|tt-check)\|ru\|([^|}]+)/gi;
    for (const match of section.matchAll(templatePattern)) {
      const text = cleanWiktionaryTerm(match[1]);
      if (text) translations.push({ text, partOfSpeech: heading[1].toLocaleLowerCase("en") });
    }
  });
  return translations;
}

function cleanWiktionaryTerm(value) {
  return String(value ?? "")
    .replace(/\[\[|\]\]/g, "")
    .normalize("NFD")
    .replace(/\u0301/g, "")
    .normalize("NFC")
    .trim();
}

function inferPartOfSpeech(word, sentence, translations) {
  const available = new Set(translations.map((entry) => entry.partOfSpeech));
  const words = String(sentence ?? "").match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const index = words.findIndex((item) => item.toLocaleLowerCase("en") === word.toLocaleLowerCase("en"));
  const previous = words[index - 1]?.toLocaleLowerCase("en");
  const next = words[index + 1]?.toLocaleLowerCase("en");
  const determiners = new Set(["a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their"]);
  const linkingVerbs = new Set(["am", "is", "are", "was", "were", "be", "been", "being", "seem", "seems", "feel", "feels", "look", "looks"]);

  if (available.has("verb") && previous === "to") return "verb";
  if (available.has("adjective") && linkingVerbs.has(previous) && !next) return "adjective";
  if (available.has("adjective") && next && !linkingVerbs.has(previous)) return "adjective";
  if (available.has("verb") && linkingVerbs.has(previous)) return "verb";
  if (available.has("noun") && determiners.has(previous)) return "noun";
  if (available.has("adverb") && (!next || word.toLocaleLowerCase("en").endsWith("ly"))) return "adverb";
  return null;
}

function contextMatchScore(translation, translatedContext) {
  if (!translation || !translatedContext) return 0;
  const contextWords = translatedContext.toLocaleLowerCase("ru").match(/[А-Яа-яЁё]+/gu) || [];
  const translationWords = translation.toLocaleLowerCase("ru").match(/[А-Яа-яЁё]+/gu) || [];
  return translationWords.some((candidate) => contextWords.some((contextWord) => (
    commonPrefixLength(candidate, contextWord) >= Math.min(7, candidate.length, contextWord.length)
    && commonPrefixLength(candidate, contextWord) >= 5
  ))) ? 100 : 0;
}

function commonPrefixLength(left, right) {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

async function translateContext(markedContext) {
  const result = await translateChunk(markedContext);
  const translated = result.text;
  const start = translated.indexOf(CONTEXT_START);
  const end = translated.indexOf(CONTEXT_END, start + 1);
  const selectedTranslation = start >= 0 && end > start
    ? translated.slice(start + CONTEXT_START.length, end).trim()
    : null;
  return {
    selectedTranslation,
    fullTranslation: translated.replaceAll(CONTEXT_START, "").replaceAll(CONTEXT_END, "").trim()
  };
}

function buildMarkedContext(sentence, word) {
  const context = normalizeText(sentence, 500);
  if (!context || context.toLocaleLowerCase("en") === word.toLocaleLowerCase("en")) return null;
  const index = context.toLocaleLowerCase("en").indexOf(word.toLocaleLowerCase("en"));
  if (index < 0) return null;

  const left = Math.max(0, index - 170);
  const right = Math.min(context.length, index + word.length + 170);
  const snippet = context.slice(left, right);
  const localIndex = index - left;
  return `${snippet.slice(0, localIndex)}${CONTEXT_START}${snippet.slice(localIndex, localIndex + word.length)}${CONTEXT_END}${snippet.slice(localIndex + word.length)}`;
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
  const exactMatches = Array.isArray(data?.matches)
    ? data.matches.filter((match) => {
      const segment = normalizeText(match?.segment, 1000).toLocaleLowerCase("en");
      const requested = normalizeText(text, 1000).toLocaleLowerCase("en");
      const score = Number(match?.match);
      return segment === requested && (!Number.isFinite(score) || score >= 0.7);
    })
    : [];
  const alternatives = [
    translated,
    ...exactMatches.map((match) => match?.translation)
  ].map((value) => decodeHtmlEntities(String(value ?? "")).trim()).filter(Boolean);
  return {
    text: translated,
    alternatives,
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
  let phonetic = String(value ?? "").trim();
  if (!phonetic) return null;
  if (isArpabet(phonetic)) phonetic = arpabetToIpa(phonetic);
  return /^[\/[].*[\/\]]$/.test(phonetic) ? phonetic : `/${phonetic}/`;
}

function isArpabet(value) {
  const tokens = value.trim().split(/\s+/);
  return tokens.length > 0 && tokens.every((token) => /^[A-Z]{1,3}[012]?$/.test(token));
}

function arpabetToIpa(value) {
  const phonemes = {
    AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ",
    B: "b", CH: "tʃ", D: "d", DH: "ð", EH: "ɛ", ER: "ɝ", EY: "eɪ",
    F: "f", G: "ɡ", HH: "h", IH: "ɪ", IY: "i", JH: "dʒ", K: "k",
    L: "l", M: "m", N: "n", NG: "ŋ", OW: "oʊ", OY: "ɔɪ", P: "p",
    R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", UH: "ʊ", UW: "u",
    V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ"
  };
  const vowels = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
  const output = [];
  let lastVowelIndex = -1;

  for (const token of value.trim().split(/\s+/)) {
    const match = token.match(/^([A-Z]+)([012])?$/);
    if (!match || !phonemes[match[1]]) continue;
    const [, code, stress] = match;

    if (vowels.has(code) && (stress === "1" || stress === "2")) {
      const stressIndex = lastVowelIndex >= 0 ? lastVowelIndex + 1 : 0;
      output.splice(stressIndex, 0, stress === "1" ? "ˈ" : "ˌ");
      if (lastVowelIndex >= stressIndex) lastVowelIndex += 1;
    }

    let symbol = phonemes[code];
    if (code === "AH" && stress === "0") symbol = "ə";
    if (code === "ER" && stress === "0") symbol = "ɚ";
    output.push(symbol);
    if (vowels.has(code)) lastVowelIndex = output.length - 1;
  }
  return output.join("");
}

function englishWordForms(word) {
  const value = word.toLocaleLowerCase("en");
  const forms = new Set([value]);

  if (value.endsWith("ied") && value.length > 4) forms.add(`${value.slice(0, -3)}y`);
  if (value.endsWith("ed") && value.length > 3) {
    const stem = value.slice(0, -2);
    forms.add(stem);
    forms.add(value.slice(0, -1));
    if (stem.at(-1) === stem.at(-2)) forms.add(stem.slice(0, -1));
  }
  if (value.endsWith("ing") && value.length > 5) {
    const stem = value.slice(0, -3);
    forms.add(stem);
    forms.add(`${stem}e`);
    if (stem.at(-1) === stem.at(-2)) forms.add(stem.slice(0, -1));
  }
  if (value.endsWith("ies") && value.length > 4) forms.add(`${value.slice(0, -3)}y`);
  if (value.endsWith("es") && value.length > 3) {
    forms.add(value.slice(0, -2));
    forms.add(value.slice(0, -1));
  } else if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) {
    forms.add(value.slice(0, -1));
  }

  return [...forms].slice(0, 4);
}

function uniqueRussianTranslations(values, sourceWord, maxWords = 3) {
  const source = sourceWord.toLocaleLowerCase("en");
  const seen = new Set();
  return values.filter((value) => {
    const translation = cleanTranslationCandidate(value);
    const key = translation.toLocaleLowerCase("ru");
    const wordCount = translation.split(/\s+/).length;
    if (!translation || key === source || wordCount > maxWords || !/[А-Яа-яЁё]/u.test(translation) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(cleanTranslationCandidate);
}

function cleanTranslationCandidate(value) {
  let translation = normalizeText(value, 500);
  if (!translation || /[{}]|\|\s*gender\s*\(/i.test(translation)) return "";
  const letters = translation.replace(/[^А-Яа-яЁё]/gu, "");
  if (letters.length > 1 && letters === letters.toLocaleUpperCase("ru")) {
    translation = translation.toLocaleLowerCase("ru");
  }
  return translation;
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
