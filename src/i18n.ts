import englishCatalog from "./locales/en.json";
import russianCatalog from "./locales/ru.json";

export const INTERFACE_LANGUAGES = ["ru", "en", "de", "fr", "es", "ja", "nl", "it", "pt", "id", "hi", "pl", "zh-CN", "zh-TW", "ko", "tr", "vi", "cs", "ro", "sv", "da", "no", "fi", "hu", "el", "ms", "fil", "ar", "fa"] as const;
export type InterfaceLanguage = typeof INTERFACE_LANGUAGES[number];

let activeLanguage: InterfaceLanguage = "ru";
const loadedCatalogs: Partial<Record<InterfaceLanguage, Record<string, string>>> = {};
const en: Record<string, string> = englishCatalog;
const ru: Record<string, string> = russianCatalog;
const sourceToKey = Object.fromEntries(Object.entries(ru).map(([key, value]) => [value, key]));

/*
 * The UI still contains Russian source text in JSX and HTML. Resolve that text
 * through the Russian catalog while keeping all locale catalogs keyed by IDs.
 */
function lookupKey(value: string, catalog: Record<string, string>) {
  if (Object.hasOwn(catalog, value)) return value;
  return sourceToKey[value];
}

function lookupMessage(value: string, language: InterfaceLanguage) {
  const key = lookupKey(value, language === "ru" ? ru : en);
  if (!key) return undefined;
  if (language === "ru") return ru[key];
  return (language === "en" ? en[key] : loadedCatalogs[language]?.[key]) || en[key];
}



export function normalizeInterfaceLanguage(value: unknown, fallback: InterfaceLanguage = "ru"): InterfaceLanguage {
  return INTERFACE_LANGUAGES.includes(value as InterfaceLanguage) ? value as InterfaceLanguage : fallback;
}

export async function loadInterfaceLanguage(language: InterfaceLanguage) {
  if (language === "ru" || language === "en" || loadedCatalogs[language]) return;
  const loaders: Record<Exclude<InterfaceLanguage, "ru" | "en">, () => Promise<{default: Record<string, string>}>> = {
    de: () => import("./locales/de.json"), fr: () => import("./locales/fr.json"), es: () => import("./locales/es.json"),
    ja: () => import("./locales/ja.json"), nl: () => import("./locales/nl.json"), it: () => import("./locales/it.json"),
    pt: () => import("./locales/pt.json"), id: () => import("./locales/id.json"), hi: () => import("./locales/hi.json"),
    pl: () => import("./locales/pl.json"), "zh-CN": () => import("./locales/zh-CN.json"),
    "zh-TW": () => import("./locales/zh-TW.json"), ko: () => import("./locales/ko.json"), tr: () => import("./locales/tr.json"),
    vi: () => import("./locales/vi.json"), cs: () => import("./locales/cs.json"), ro: () => import("./locales/ro.json"),
    sv: () => import("./locales/sv.json"), da: () => import("./locales/da.json"), no: () => import("./locales/no.json"),
    fi: () => import("./locales/fi.json"), hu: () => import("./locales/hu.json"), el: () => import("./locales/el.json"),
    ms: () => import("./locales/ms.json"), fil: () => import("./locales/fil.json"), ar: () => import("./locales/ar.json"),
    fa: () => import("./locales/fa.json")
  };
  loadedCatalogs[language] = (await loaders[language]()).default;
}

export function setActiveLanguage(language: InterfaceLanguage) {
  activeLanguage = language;
}

export function getActiveLanguage() {
  return activeLanguage;
}

export function translate(value: string, language: InterfaceLanguage = activeLanguage): string {
  if (!value) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const text = value.trim();
  const exact = lookupMessage(text, language);
  if (exact) return `${leading}${exact}${trailing}`;
  const patterns: Array<[RegExp, (...parts: string[]) => string]> = [
    [/^(\d+) (?:запись|записи|записей)$/, (count) => formatRecordCount(Number(count), language)],
    [/^(\d+ (?:запись|записи|записей)) доступно для скачивания\.$/, (records) => formatMessage("{records} доступно для скачивания.", {records: translate(records, language)}, language)],
    [/^Скачать (.+)$/, (format) => formatMessage("Скачать {format}", {format}, language)],
    [/^Файл (.+) подготовлен$/, (format) => formatMessage("Файл {format} подготовлен", {format}, language)],
    [/^Удалить перевод «(.+)»$/, (term) => formatMessage("Удалить перевод «{term}»", {term}, language)],
    [/^Редактировать перевод «(.+)»$/, (term) => formatMessage("Редактировать перевод «{term}»", {term}, language)],
    [/^Текущая скорость (.+)$/, (rate) => formatMessage("Текущая скорость {rate}", {rate}, language)],
    [/^Код языка: (.+)$/, (code) => formatMessage("Код языка: {code}", {code}, language)],
    [/^Озвучить \((.+)\)$/, (code) => formatMessage("Озвучить ({code})", {code}, language)],
    [/^Ошибка озвучки: (.+)$/, (error) => formatMessage("Ошибка озвучки: {error}", {error}, language)],
    [/^Достигнут лимит в (\d+) переводов\. Скачайте сохранённые записи и очистите хранилище, чтобы сохранять новые\.$/, (count) => formatMessage("Достигнут лимит в {count} переводов. Скачайте сохранённые записи и очистите хранилище, чтобы сохранять новые.", {count}, language)],
    [/^При выключенной ротации новые записи не будут сохраняться в историю, пока достигнут лимит в (\d+)\.$/, (count) => formatMessage("При выключенной ротации новые записи не будут сохраняться в историю, пока достигнут лимит в {count}.", {count}, language)],
    [/^При добавлении новых переводов сверх лимита в (\d+) самые старые записи будут автоматически удалены из истории\. Таким образом, общее количество записей в истории будет остается равным (\d+)\.$/, (count) => formatMessage("При добавлении новых переводов сверх лимита в {count} самые старые записи будут автоматически удалены из истории. Таким образом, общее количество записей в истории будет остается равным {count}.", {count}, language)]
  ];
  for (const [pattern, replacement] of patterns) {
    const match = text.match(pattern);
    if (match) return `${leading}${replacement(...match.slice(1))}${trailing}`;
  }
  return value;
}

function formatMessage(template: string, values: Record<string, string>, language: InterfaceLanguage) {
  const translated = lookupMessage(template, language) || template;
  return translated.replace(/\{(\w+)}/g, (_, key) => values[key] ?? `{${key}}`);
}

export function formatRecordCount(count: number, language: InterfaceLanguage = activeLanguage) {
  const labels: Record<InterfaceLanguage, [string, string]> = {
    ru: ["запись", "записей"], en: ["record", "records"], de: ["Eintrag", "Einträge"], fr: ["entrée", "entrées"],
    es: ["registro", "registros"], ja: ["件", "件"], nl: ["item", "items"], it: ["voce", "voci"],
    pt: ["registro", "registros"], id: ["catatan", "catatan"], hi: ["रिकॉर्ड", "रिकॉर्ड"],
    pl: ["rekord", "rekordów"], "zh-CN": ["条记录", "条记录"], "zh-TW": ["筆記錄", "筆記錄"],
    ko: ["건", "건"], tr: ["kayıt", "kayıt"], vi: ["bản ghi", "bản ghi"],
    cs: ["záznam", "záznamů"], ro: ["înregistrare", "înregistrări"], sv: ["post", "poster"], da: ["post", "poster"],
    no: ["oppføring", "oppføringer"], fi: ["merkintä", "merkintää"], hu: ["bejegyzés", "bejegyzés"],
    el: ["εγγραφή", "εγγραφές"], ms: ["catatan", "catatan"], fil: ["talaan", "talaan"],
    ar: ["سجل", "سجلات"], fa: ["رکورد", "رکورد"]
  };
  if (language === "ar") {
    if (count === 2) return `${count} سجلان`;
    if (count >= 3 && count <= 10) return `${count} سجلات`;
    if (count > 10) return `${count} سجلًا`;
  }
  if (["pl", "cs"].includes(language) && count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)) {
    return `${count} ${language === "pl" ? "rekordy" : "záznamy"}`;
  }
  const [one, many] = labels[language];
  return `${count} ${count === 1 ? one : many}`;
}

const excludedTextSelector = [
  ".record-original", ".record-translation", ".record-transcription", ".record-sentence", ".record-alternatives", ".record-meta a", ".original", ".translated",
  ".translation-alternatives", ".translation-option", ".sentence", ".original-text", ".translation", ".context-translation",
  ".translator-output", ".source", ".source-link", "time"
].join(",");

export function localizeDom(root: Document | ShadowRoot, language: InterfaceLanguage) {
  const isDocument = root.nodeType === 9;
  const documentNode = isDocument ? root as Document : root.ownerDocument;
  const walker = documentNode.createTreeWalker(root, 4);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest(excludedTextSelector)) node.nodeValue = translate(node.nodeValue || "", language);
    node = walker.nextNode();
  }
  const elements = root.querySelectorAll<HTMLElement>("[aria-label], [title], [placeholder], [data-placeholder]");
  elements.forEach((element) => {
    ["aria-label", "title", "placeholder", "data-placeholder"].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, translate(value, language));
    });
  });
  if (isDocument) {
    const documentRoot = root as Document;
    documentRoot.documentElement.lang = language;
    documentRoot.documentElement.dir = language === "ar" || language === "fa" ? "rtl" : "ltr";
    documentRoot.title = translate(documentRoot.title, language);
  } else {
    const host = (root as ShadowRoot).host;
    host.setAttribute("lang", language);
    host.setAttribute("dir", language === "ar" || language === "fa" ? "rtl" : "ltr");
  }
}

export function observeLocalizedDom(root: Document | ShadowRoot, language: InterfaceLanguage) {
  localizeDom(root, language);
  if (language === "ru") return () => undefined;
  const observer = new MutationObserver(() => {
    observer.disconnect();
    localizeDom(root, language);
    observer.observe(root, {attributes: true, attributeFilter: ["aria-label", "title", "placeholder", "data-placeholder"], childList: true, characterData: true, subtree: true});
  });
  observer.observe(root, {attributes: true, attributeFilter: ["aria-label", "title", "placeholder", "data-placeholder"], childList: true, characterData: true, subtree: true});
  return () => observer.disconnect();
}
