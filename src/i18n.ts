import englishCatalog from "./locales/en.json";
import russianCatalog from "./locales/ru.json";

export const INTERFACE_LANGUAGES = ["ru", "en", "de", "fr", "es", "ja", "nl", "it", "pt", "id", "hi"] as const;
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
    pt: () => import("./locales/pt.json"), id: () => import("./locales/id.json"), hi: () => import("./locales/hi.json")
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
    pt: ["registro", "registros"], id: ["catatan", "catatan"], hi: ["रिकॉर्ड", "रिकॉर्ड"]
  };
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
    documentRoot.title = translate(documentRoot.title, language);
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
