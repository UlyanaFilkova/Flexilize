import browser from "webextension-polyfill";
import {isRuntimeMessage, type TranslatePayload, type TranslationRecord} from "./types";

const extensionApi = browser;
const RECORDS_KEY = "translationRecords";
const TRANSLATION_RESULTS_KEY = "translationResultCacheV1";
const MAX_RECORDS = 5000;
const MAX_CACHED_TRANSLATIONS = 500;
const TRANSCRIPTION_TIMEOUT_MS = 4500;
const DICTIONARY_REQUEST_TIMEOUT_MS = 2500;
const WIKTIONARY_REQUEST_TIMEOUT_MS = 3500;
const TRANSLATION_REQUEST_TIMEOUT_MS = 4500;
const SPEECH_REQUEST_TIMEOUT_MS = 8000;
const CONTEXT_START = "<b>";
const CONTEXT_END = "</b>";
const transcriptionCache = new Map();
const translationCache = new Map<string, Promise<{
  text: string
  alternatives: string[]
  warning: string | null
}>>();
let translationCacheWrite = Promise.resolve();
let translationCooldownUntil = 0;

extensionApi.runtime.onMessage.addListener((message: unknown) => {
  if (!isRuntimeMessage(message)) return undefined;

  if (message?.type === "translate-selection") {
    return handleSelection(message.payload)
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }

  if (message?.type === "translate-preview") {
    return handleTranslationPreview(message.payload)
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }

  if (message?.type === "get-transcription") {
    return handleTranscription(message.payload)
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }

  if (message?.type === "get-speech-audio") {
    return handleSpeechAudio(message.payload)
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }

  if (message?.type === "get-records") {
    return getRecords()
      .then((records) => ({ ok: true, records }))
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }

  if (message?.type === "delete-record") {
    return deleteRecord(message.payload)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }

  if (message?.type === "restore-record") {
    return restoreRecord(message.payload)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }

  if (message?.type === "clear-and-save-record") {
    return clearAndSaveRecord(message.payload)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }

  if (message?.type === "clear-records") {
    return clearRecords()
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: readableError(error) }));
  }
});

async function handleTranslationPreview(payload: {text?: unknown}) {
  const text = normalizeText(payload?.text, 1000);
  if (!text) throw new Error("Не удалось прочитать выделенный текст");

  const result = await translateChunk(text);
  return {
    ok: true,
    translation: result.text,
    translations: result.alternatives,
    sourceLanguage: "en" as const,
    warning: result.warning
  };
}

async function handleSelection(payload: TranslatePayload) {
  const text = normalizeText(payload?.text, 1000);
  const sentence = normalizeText(payload?.sentence, 3000);

  if (!text) {
    throw new Error("Не удалось прочитать выделенный текст");
  }

  const translationResult = await translateToRussian(text, sentence);

  const record: TranslationRecord = {
    contextTranslation: translationResult.contextTranslation || null,
    createdAt: new Date().toISOString(),
    pageTitle: normalizeText(payload?.pageTitle, 500),
    pageUrl: normalizeUrl(payload?.pageUrl),
    sentence: sentence || text,
    text,
    translation: translationResult.text,
    translations: translationResult.alternatives
  };

  const storageResult = await saveRecord(record);

  return {
    ok: true,
    translation: translationResult.text,
    translations: translationResult.alternatives || [translationResult.text],
    contextTranslation: translationResult.contextTranslation || null,
    sourceLanguage: "en",
    saved: storageResult.saved,
    storageLimitReached: storageResult.limitReached,
    pendingRecord: storageResult.saved ? undefined : record,
    warning: translationResult.warning ?? null
  };
}

async function handleTranscription(payload: {text?: unknown}) {
  const text = normalizeText(payload?.text, 500);
  if (!text) return { ok: true, transcription: null };

  const transcription = await settleWithin(
    getTranscription(text),
    TRANSCRIPTION_TIMEOUT_MS,
    null
  );
  return { ok: true, transcription };
}

async function handleSpeechAudio(payload: {text?: unknown}) {
  const text = normalizeText(payload?.text, 1000);
  if (!text) throw new Error("Не удалось прочитать текст для озвучки");

  const chunks = splitSpeechText(text, 180);
  const audioChunks = await Promise.all(chunks.map(async (chunk) => {
    const query = new URLSearchParams({
      client: "tw-ob",
      ie: "UTF-8",
      q: chunk.text,
      tl: "en-US"
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SPEECH_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`https://translate.google.com/translate_tts?${query}`, {
        signal: controller.signal,
        headers: { Accept: "audio/mpeg" }
      });
      if (!response.ok) throw new Error(`TTS вернул код ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        audio: bytesToBase64(bytes),
        end: chunk.end,
        mimeType: response.headers.get("content-type")?.split(";")[0] || "audio/mpeg",
        start: chunk.start
      };
    } finally {
      clearTimeout(timeout);
    }
  }));

  return { ok: true, chunks: audioChunks };
}

function splitSpeechText(text: string, maxLength: number) {
  const chunks: Array<{text: string; start: number; end: number}> = [];
  let position = 0;

  while (position < text.length) {
    while (/\s/.test(text[position] || "")) position += 1;
    if (position >= text.length) break;

    let end = Math.min(text.length, position + maxLength);
    if (end < text.length) {
      const candidate = text.slice(position, end);
      const sentenceBreak = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("! "), candidate.lastIndexOf("? "));
      const wordBreak = candidate.lastIndexOf(" ");
      const breakAt = sentenceBreak >= Math.floor(maxLength * 0.45) ? sentenceBreak + 1 : wordBreak;
      if (breakAt > 0) end = position + breakAt;
    }

    const chunkText = text.slice(position, end).trim();
    if (chunkText) chunks.push({ text: chunkText, start: position, end });
    position = end;
  }

  return chunks;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const blockSize = 0x8000;
  for (let index = 0; index < bytes.length; index += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + blockSize));
  }
  return btoa(binary);
}

interface TranslationResult {
  text: string
  alternatives: string[]
  contextTranslation?: string | null
  warning: string | null
}

async function translateToRussian(text: string, sentence: string): Promise<TranslationResult> {
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
  // The selected form plus its most likely lemma are enough for the machine
  // translator. Other variants still come from Wiktionary without spending
  // the limited translation quota.
  const forms = englishWordForms(word).slice(0, 2);
  const markedContext = buildMarkedContext(sentence, word);
  const collocation = buildContextCollocation(sentence, word);
  const [primaryResult, contextResult, dictionaryTranslations] = await Promise.all([
    translateChunk(forms[0]).catch(() => null),
    markedContext ? translateContext(markedContext).catch(() => null) : null,
    fetchWiktionaryTranslations(word)
  ]);
  const results = primaryResult ? [primaryResult] : [];
  if (forms[1] && !isUsefulMachineTranslation(primaryResult, word)) {
    const lemmaResult = await translateChunk(forms[1]).catch(() => null);
    if (lemmaResult) results.push(lemmaResult);
  }
  // Usually the marked context identifies the correct word directly. The
  // extra collocation requests are only useful when that marker was lost by
  // the translation service.
  const collocationTranslation = !contextResult?.selectedTranslation && collocation
    ? await translateCollocation(collocation).catch(() => null)
    : null;
  const successful = results.filter(Boolean);
  if (!successful.length && !contextResult?.selectedTranslation) {
    throw new Error("Сервис перевода временно недоступен");
  }

  const likelyPartOfSpeech = inferPartOfSpeech(word, sentence, dictionaryTranslations);
  const markedSelection = contextResult?.selectedTranslation
    && !isNeighborTranslation(contextResult.selectedTranslation, collocationTranslation?.neighbor)
    ? contextResult.selectedTranslation
    : null;
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
    ...contextualDictionary.map((entry) => entry.text),
    collocationTranslation?.selected,
    collocationTranslation?.phrase,
    markedSelection,
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

function isUsefulMachineTranslation(result, sourceWord) {
  const translated = normalizeText(result?.text, 500);
  return Boolean(translated)
    && translated.toLocaleLowerCase("en") !== sourceWord.toLocaleLowerCase("en")
    && /[А-Яа-яЁё]/u.test(translated);
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
  const selectedTranslation = translated.match(/<b(?:\s[^>]*)?>(.*?)<\/b>/i)?.[1]?.trim() || null;
  return {
    selectedTranslation,
    fullTranslation: translated.replace(/<\/?b(?:\s[^>]*)?>/gi, "").trim()
  };
}

function buildMarkedContext(sentence, word) {
  const context = normalizeText(sentence, 3000);
  if (!context || context.toLocaleLowerCase("en") === word.toLocaleLowerCase("en")) return null;
  const index = context.toLocaleLowerCase("en").indexOf(word.toLocaleLowerCase("en"));
  if (index < 0) return null;

  return `${context.slice(0, index)}${CONTEXT_START}${context.slice(index, index + word.length)}${CONTEXT_END}${context.slice(index + word.length)}`;
}

function buildContextCollocation(sentence, word) {
  const words = String(sentence ?? "").match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const index = words.findIndex((item) => item.toLocaleLowerCase("en") === word.toLocaleLowerCase("en"));
  if (index < 0) return null;
  const stopWords = new Set([
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "from",
    "with", "by", "as", "is", "are", "was", "were", "be", "been", "being", "that", "which",
    "who", "whom", "whose", "this", "these", "those", "it", "its"
  ]);
  const previous = words[index - 1];
  const next = words[index + 1];

  if (next && !stopWords.has(next.toLocaleLowerCase("en"))) {
    return { phrase: `${word} ${next}`, neighbor: next, targetAtStart: true };
  }
  if (previous && !stopWords.has(previous.toLocaleLowerCase("en"))) {
    return { phrase: `${previous} ${word}`, neighbor: previous, targetAtStart: false };
  }
  return null;
}

async function translateCollocation(collocation) {
  const [phraseResult, neighborResult] = await Promise.all([
    translateChunk(collocation.phrase),
    translateChunk(collocation.neighbor)
  ]);
  const phraseWords = phraseResult.text.match(/[А-Яа-яЁё-]+/gu) || [];
  const neighborWords = neighborResult.text.match(/[А-Яа-яЁё-]+/gu) || [];
  if (!phraseWords.length || phraseWords.length <= neighborWords.length) return null;

  const remaining = [...phraseWords];
  for (const neighborWord of neighborWords) {
    const relatedIndex = remaining.findIndex((phraseWord) => russianWordsRelated(phraseWord, neighborWord));
    if (relatedIndex >= 0) remaining.splice(relatedIndex, 1);
  }

  const selectedWords = remaining.length < phraseWords.length
    ? remaining
    : collocation.targetAtStart
      ? phraseWords.slice(0, phraseWords.length - neighborWords.length)
      : phraseWords.slice(neighborWords.length);
  return {
    selected: selectedWords.join(" "),
    phrase: phraseWords.join(" "),
    neighbor: neighborWords.join(" ")
  };
}

function isNeighborTranslation(value, neighbor) {
  if (!value || !neighbor) return false;
  const selectedWords = value.match(/[А-Яа-яЁё-]+/gu) || [];
  const neighborWords = neighbor.match(/[А-Яа-яЁё-]+/gu) || [];
  return selectedWords.length > 0
    && selectedWords.every((selected) => neighborWords.some((item) => russianWordsRelated(selected, item)));
}

function russianWordsRelated(left, right) {
  const first = left.toLocaleLowerCase("ru");
  const second = right.toLocaleLowerCase("ru");
  if (commonPrefixLength(first, second) >= 3) return true;
  const firstSkeleton = russianConsonantSkeleton(first);
  const secondSkeleton = russianConsonantSkeleton(second);
  return firstSkeleton.length >= 2
    && secondSkeleton.length >= 2
    && (firstSkeleton.startsWith(secondSkeleton) || secondSkeleton.startsWith(firstSkeleton));
}

function russianConsonantSkeleton(value) {
  return value
    .replace(/[аеёиоуыэюяьъй]/gu, "")
    .replace(/(.)\1+/gu, "$1");
}

async function getTranscription(text: string): Promise<string | null> {
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g);
  if (!words?.length || words.length > 30) return null;

  const phraseTranscription = await fetchDatamuseTranscription(words.join(" "));
  if (phraseTranscription) return phraseTranscription;

  const uniqueWords = [...new Set(words.map((word) => word.toLocaleLowerCase("en")))];
  const entries = await Promise.all(uniqueWords.map(async (word): Promise<[string, string | null]> => (
    [word, await fetchEnglishPhonetic(word)]
  )));
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
  const cacheKey = normalizeText(text, 3000);
  const cached = translationCache.get(cacheKey);
  if (cached) return cached;

  const request = resolveTranslationChunk(cacheKey);
  if (translationCache.size >= 250) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) translationCache.delete(oldestKey);
  }
  translationCache.set(cacheKey, request);

  try {
    return await request;
  } catch (error) {
    translationCache.delete(cacheKey);
    throw error;
  }
}

async function resolveTranslationChunk(text: string) {
  const saved = await findSavedTranslation(text);
  if (saved) return saved;

  const persisted = await getPersistedTranslation(text);
  if (persisted) return persisted;

  const result = await requestTranslationChunk(text);
  await persistTranslation(text, result);
  return result;
}

async function findSavedTranslation(text: string) {
  if (/<\/?b(?:\s[^>]*)?>/i.test(text)) return null;
  const key = normalizeText(text, 1000).toLocaleLowerCase("en");
  const records = await getRecords();
  const record = records.find((item) => item.text.toLocaleLowerCase("en") === key);
  if (!record?.translation) return null;
  return {
    text: record.translation,
    alternatives: record.translations.length ? record.translations : [record.translation],
    warning: null
  };
}

async function getPersistedTranslation(text: string) {
  if (!extensionApi?.storage?.local) return null;
  const stored = await extensionApi.storage.local.get(TRANSLATION_RESULTS_KEY);
  const cache = stored?.[TRANSLATION_RESULTS_KEY];
  const entry = cache && typeof cache === "object" ? cache[persistentTranslationKey(text)] : null;
  const translated = normalizeText(entry?.text, 3000);
  if (!translated) return null;
  const alternatives = Array.isArray(entry?.alternatives)
    ? entry.alternatives.map((item) => normalizeText(item, 1000)).filter(Boolean)
    : [];
  return {
    text: translated,
    alternatives: alternatives.length ? alternatives : [translated],
    warning: typeof entry?.warning === "string" ? entry.warning : null
  };
}

async function persistTranslation(text: string, result: {text: string; alternatives: string[]; warning: string | null}) {
  if (!extensionApi?.storage?.local) return;
  translationCacheWrite = translationCacheWrite.then(async () => {
    const stored = await extensionApi.storage.local.get(TRANSLATION_RESULTS_KEY);
    const current = stored?.[TRANSLATION_RESULTS_KEY];
    const cache = current && typeof current === "object" ? { ...current } : {};
    cache[persistentTranslationKey(text)] = { ...result, cachedAt: Date.now() };
    const entries = Object.entries(cache);
    if (entries.length > MAX_CACHED_TRANSLATIONS) {
      entries
        .sort((left: any, right: any) => Number(left[1]?.cachedAt || 0) - Number(right[1]?.cachedAt || 0))
        .slice(0, entries.length - MAX_CACHED_TRANSLATIONS)
        .forEach(([key]) => delete cache[key]);
    }
    await extensionApi.storage.local.set({ [TRANSLATION_RESULTS_KEY]: cache });
  }).catch(() => undefined);
  await translationCacheWrite;
}

async function requestTranslationChunk(text: string) {
  if (Date.now() < translationCooldownUntil) {
    return requestFallbackTranslation(text);
  }
  const query = new URLSearchParams({ q: text, langpair: "en|ru" });
  let response;
  try {
    response = await fetchWithTimeout(
      `https://api.mymemory.translated.net/get?${query}`,
      TRANSLATION_REQUEST_TIMEOUT_MS
    );
  } catch (_error) {
    return requestFallbackTranslation(text);
  }

  if (response.status === 429) {
    translationCooldownUntil = Date.now() + retryDelay(response.headers.get("retry-after"));
    return requestFallbackTranslation(text);
  }
  if (!response.ok) {
    return requestFallbackTranslation(text);
  }

  const data = await response.json();
  const responseStatus = Number(data?.responseStatus);
  if ([403, 429].includes(responseStatus)) {
    translationCooldownUntil = Date.now() + 15 * 60_000;
    return requestFallbackTranslation(text);
  }
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

async function requestFallbackTranslation(text: string) {
  try {
    const query = new URLSearchParams({
      client: "gtx",
      dt: "t",
      q: text,
      sl: "en",
      tl: "ru"
    });
    query.set("client", "dict-chrome-ex");
    const response = await fetchWithTimeout(
      `https://clients5.google.com/translate_a/t?${query}`,
      TRANSLATION_REQUEST_TIMEOUT_MS
    );
    if (!response.ok) throw new Error("fallback unavailable");
    const data = await response.json();
    const translated = Array.isArray(data)
      ? data.map((segment) => typeof segment === "string" ? segment : "").join("").trim()
      : "";
    if (!translated) throw new Error("fallback returned an empty translation");
    return { text: translated, alternatives: [translated], warning: null };
  } catch (_error) {
    throw new Error("Сейчас не удалось получить перевод. Проверьте интернет-соединение или попробуйте ещё раз позже.");
  }
}

function persistentTranslationKey(text: string) {
  return `text:${text}`;
}

function retryDelay(retryAfter: string | null) {
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, 60 * 60_000)
    : 5 * 60_000;
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
    const looksLikeNoisyTransliteration = /^[a-z]/.test(sourceWord)
      && /^[А-ЯЁ][а-яё-]+$/u.test(translation)
      && editDistance(transliterateRussian(translation), source) <= 1;
    if (!translation || key === source || wordCount > maxWords || looksLikeNoisyTransliteration
      || !/[А-Яа-яЁё]/u.test(translation) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(cleanTranslationCandidate);
}

function transliterateRussian(value) {
  const letters = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
    ы: "y", э: "e", ю: "yu", я: "ya", ь: "", ъ: ""
  };
  return [...value.toLocaleLowerCase("ru")].map((letter) => letters[letter] ?? letter).join("");
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = previous;
    }
  }
  return row[right.length];
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

async function saveRecord(record: TranslationRecord) {
  if (!extensionApi?.storage?.local) {
    throw new Error("Локальное хранилище недоступно");
  }

  const records = await getRecords();
  const duplicate = records[0]
    && records[0].text === record.text
    && records[0].sentence === record.sentence
    && Date.now() - new Date(records[0].createdAt).getTime() < 3000;

  if (duplicate) {
    return { saved: true, limitReached: records.length >= MAX_RECORDS };
  }
  if (records.length >= MAX_RECORDS) {
    return { saved: false, limitReached: true };
  }

  records.unshift(record);
  await extensionApi.storage.local.set({ [RECORDS_KEY]: records });
  return { saved: true, limitReached: records.length >= MAX_RECORDS };
}

async function getRecords(): Promise<TranslationRecord[]> {
  if (!extensionApi?.storage?.local) return [];
  const stored = await extensionApi.storage.local.get(RECORDS_KEY);
  return Array.isArray(stored?.[RECORDS_KEY])
    ? stored[RECORDS_KEY].map(normalizeStoredRecord)
    : [];
}

function normalizeStoredRecord(value): TranslationRecord {
  const translation = normalizeText(value?.translation, 3000);
  const translations = Array.isArray(value?.translations)
    ? value.translations.map((item) => normalizeText(item, 1000)).filter(Boolean)
    : [];
  return {
    contextTranslation: normalizeText(value?.contextTranslation, 3000) || null,
    createdAt: normalizeText(value?.createdAt, 100) || new Date(0).toISOString(),
    pageTitle: normalizeText(value?.pageTitle ?? value?.pageTitle, 500),
    pageUrl: normalizeUrl(value?.pageUrl),
    sentence: normalizeText(value?.sentence, 3000),
    text: normalizeText(value?.text, 1000),
    translation,
    translations: translations.length ? translations : (translation ? [translation] : [])
  };
}

async function clearRecords() {
  if (!extensionApi?.storage?.local) return;
  await extensionApi.storage.local.set({ [RECORDS_KEY]: [] });
}

async function deleteRecord(payload: {createdAt?: unknown; sentence?: unknown; text?: unknown}) {
  if (!extensionApi?.storage?.local) throw new Error("Локальное хранилище недоступно");
  const createdAt = normalizeText(payload?.createdAt, 100);
  const sentence = normalizeText(payload?.sentence, 3000);
  const text = normalizeText(payload?.text, 1000);
  if (!createdAt || !text) throw new Error("Не удалось определить запись");

  const records = await getRecords();
  const recordIndex = records.findIndex((record) => (
    record.createdAt === createdAt
    && record.text === text
    && record.sentence === sentence
  ));
  if (recordIndex < 0) throw new Error("Запись уже удалена");
  records.splice(recordIndex, 1);
  await extensionApi.storage.local.set({ [RECORDS_KEY]: records });
}

async function restoreRecord(payload: {index?: unknown; record?: unknown}) {
  if (!extensionApi?.storage?.local) throw new Error("Локальное хранилище недоступно");
  if (!payload?.record || typeof payload.record !== "object") {
    throw new Error("Не удалось восстановить запись");
  }

  const record = normalizeStoredRecord(payload.record);
  if (!record.createdAt || !record.text) throw new Error("Запись повреждена");
  const records = await getRecords();
  const alreadyRestored = records.some((item) => (
    item.createdAt === record.createdAt
    && item.text === record.text
    && item.sentence === record.sentence
  ));
  if (alreadyRestored) return;

  const requestedIndex = Number(payload.index);
  const index = Number.isInteger(requestedIndex)
    ? Math.max(0, Math.min(requestedIndex, records.length))
    : 0;
  records.splice(index, 0, record);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  await extensionApi.storage.local.set({ [RECORDS_KEY]: records });
}

async function clearAndSaveRecord(payload: {record?: unknown}) {
  if (!extensionApi?.storage?.local) throw new Error("Локальное хранилище недоступно");
  if (!payload?.record || typeof payload.record !== "object") {
    throw new Error("Не удалось сохранить текущий перевод");
  }
  const record = normalizeStoredRecord(payload.record);
  if (!record.createdAt || !record.text || !record.translation) {
    throw new Error("Текущая запись повреждена");
  }
  await extensionApi.storage.local.set({ [RECORDS_KEY]: [record] });
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

function readableError(error) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return /\b429\b|too many requests|quota|rate.?limit/i.test(message)
    ? "Перевод временно недоступен. Попробуйте ещё раз немного позже."
    : message;
}
