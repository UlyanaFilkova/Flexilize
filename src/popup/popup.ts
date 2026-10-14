import browser from "webextension-polyfill";
import {errorMessage, type RecordsResponse, type TranslationRecord} from "../types";

const extensionApi = browser;
const listElement = document.querySelector<HTMLOListElement>("#records")!;
const emptyElement = document.querySelector<HTMLElement>("#empty")!;
const counterElement = document.querySelector<HTMLElement>("#counter")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear")!;
const jsonButton = document.querySelector<HTMLButtonElement>("#export-json")!;
const csvButton = document.querySelector<HTMLButtonElement>("#export-csv")!;
let records: TranslationRecord[] = [];

document.addEventListener("DOMContentLoaded", loadRecords);
clearButton.addEventListener("click", clearRecords);
jsonButton.addEventListener("click", () => exportFile("json"));
csvButton.addEventListener("click", () => exportFile("csv"));

async function loadRecords() {
  try {
    const result = await extensionApi.runtime.sendMessage({ type: "get-records" }) as RecordsResponse;
    if (!result?.ok) throw new Error(result?.error || "Не удалось загрузить записи");
    records = result.records || [];
    render();
  } catch (error) {
    showNotice(errorMessage(error, "Ошибка загрузки"));
  }
}

function render() {
  listElement.replaceChildren(...records.map(createRecordElement));
  emptyElement.hidden = records.length > 0;
  counterElement.textContent = pluralize(records.length);
  clearButton.disabled = records.length === 0;
  jsonButton.disabled = records.length === 0;
  csvButton.disabled = records.length === 0;
}

function createRecordElement(record: TranslationRecord) {
  const item = document.createElement("li");
  item.className = "record";

  const pair = document.createElement("div");
  pair.className = "pair";
  pair.append(
    textElement("span", "original", record.text),
    textElement("span", "arrow", "→"),
    textElement("span", "translated", record.translation)
  );

  const sentence = textElement("div", "sentence", record.sentence);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.append(textElement("time", "", formatDate(record.createdAt)));

  if (record.pageUrl) {
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = record.pageUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = record.pageTitle || hostname(record.pageUrl);
    link.title = record.pageUrl;
    meta.append(link);
  }

  item.append(pair, sentence, meta);
  return item;
}

async function clearRecords() {
  if (!records.length || !confirm("Удалить все сохранённые переводы?")) return;
  try {
    const result = await extensionApi.runtime.sendMessage({ type: "clear-records" }) as RecordsResponse;
    if (!result?.ok) throw new Error(result?.error || "Не удалось очистить список");
    records = [];
    render();
    showNotice("Список очищен");
  } catch (error) {
    showNotice(errorMessage(error, "Ошибка очистки"));
  }
}

function exportFile(format: "json" | "csv") {
  if (!records.length) return;
  const isJson = format === "json";
  const exportRecords = records.map(toExportRecord);
  const content = isJson ? JSON.stringify(exportRecords, null, 2) : toCsv(exportRecords);
  const mime = isJson ? "application/json" : "text/csv";
  const blob = new Blob([isJson ? content : `\uFEFF${content}`], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `context-translations-${dateStamp()}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showNotice(`Файл ${format.toUpperCase()} подготовлен`);
}

function toExportRecord(record: TranslationRecord): TranslationRecord {
  return {
    contextTranslation: record.contextTranslation,
    createdAt: record.createdAt,
    pageTitle: record.pageTitle,
    pageUrl: record.pageUrl,
    sentence: record.sentence,
    text: record.text,
    translation: record.translation,
    translations: record.translations
  };
}

function toCsv(items: TranslationRecord[]) {
  const columns: (keyof TranslationRecord)[] = [
    "contextTranslation", "createdAt", "pageTitle", "pageUrl",
    "sentence", "text", "translation", "translations"
  ];
  return [columns, ...items.map((item) => columns.map((column) => item[column] ?? ""))]
    .map((row) => row.map((value) => csvCell(Array.isArray(value) ? JSON.stringify(value) : value)).join(","))
    .join("\r\n");
}

function csvCell(value: unknown) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text || "—";
  return element;
}

function pluralize(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "запись"
    : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)
      ? "записи"
      : "записей";
  return `${count} ${word}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function hostname(value: string) {
  try { return new URL(value).hostname; } catch (_error) { return "Источник"; }
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function showNotice(message: string) {
  const notice = document.querySelector<HTMLElement>("#notice")!;
  notice.textContent = message;
  notice.classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("visible"), 2200);
}
