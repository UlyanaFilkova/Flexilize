const extensionApi = globalThis.browser ?? globalThis.chrome;
const listElement = document.querySelector("#records");
const emptyElement = document.querySelector("#empty");
const counterElement = document.querySelector("#counter");
const clearButton = document.querySelector("#clear");
const jsonButton = document.querySelector("#export-json");
const csvButton = document.querySelector("#export-csv");
let records = [];

document.addEventListener("DOMContentLoaded", loadRecords);
clearButton.addEventListener("click", clearRecords);
jsonButton.addEventListener("click", () => exportFile("json"));
csvButton.addEventListener("click", () => exportFile("csv"));

async function loadRecords() {
  try {
    const result = await extensionApi.runtime.sendMessage({ type: "get-records" });
    if (!result?.ok) throw new Error(result?.error || "Не удалось загрузить записи");
    records = result.records;
    render();
  } catch (error) {
    showNotice(error?.message || "Ошибка загрузки");
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

function createRecordElement(record) {
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
    const result = await extensionApi.runtime.sendMessage({ type: "clear-records" });
    if (!result?.ok) throw new Error(result?.error || "Не удалось очистить список");
    records = [];
    render();
    showNotice("Список очищен");
  } catch (error) {
    showNotice(error?.message || "Ошибка очистки");
  }
}

function exportFile(format) {
  if (!records.length) return;
  const isJson = format === "json";
  const content = isJson ? JSON.stringify(records, null, 2) : toCsv(records);
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

function toCsv(items) {
  const columns = ["text", "sentence", "translation", "sourceLanguage", "pageTitle", "pageUrl", "createdAt"];
  return [columns, ...items.map((item) => columns.map((column) => item[column] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text || "—";
  return element;
}

function pluralize(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "запись"
    : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)
      ? "записи"
      : "записей";
  return `${count} ${word}`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function hostname(value) {
  try { return new URL(value).hostname; } catch (_error) { return "Источник"; }
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

let noticeTimer;
function showNotice(message) {
  const notice = document.querySelector("#notice");
  notice.textContent = message;
  notice.classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("visible"), 2200);
}
