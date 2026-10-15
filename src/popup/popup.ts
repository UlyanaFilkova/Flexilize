import browser from "webextension-polyfill";
import {exportTranslationRecords, type ExportFormat} from "../export";
import {errorMessage, type RecordsResponse, type TranslationRecord} from "../types";

const extensionApi = browser;
const listElement = document.querySelector<HTMLOListElement>("#records")!;
const emptyElement = document.querySelector<HTMLElement>("#empty")!;
const counterElement = document.querySelector<HTMLElement>("#counter")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
const formatSelect = document.querySelector<HTMLSelectElement>("#export-format")!;
let records: TranslationRecord[] = [];

clearButton.append(createTrashIcon());
document.addEventListener("DOMContentLoaded", loadRecords);
clearButton.addEventListener("click", clearRecords);
exportButton.addEventListener("click", () => void exportRecords());
formatSelect.addEventListener("change", updateExportButton);

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
  exportButton.disabled = records.length === 0;
  formatSelect.disabled = records.length === 0;
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

  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-record";
  deleteButton.type = "button";
  deleteButton.append(createTrashIcon());
  deleteButton.title = "Удалить запись";
  deleteButton.setAttribute("aria-label", `Удалить перевод «${record.text}»`);
  deleteButton.addEventListener("click", () => void deleteRecord(record, deleteButton));
  meta.append(deleteButton);

  item.append(pair, sentence, meta);
  return item;
}

async function deleteRecord(record: TranslationRecord, button: HTMLButtonElement) {
  const recordIndex = records.indexOf(record);
  button.disabled = true;
  try {
    const result = await extensionApi.runtime.sendMessage({
      type: "delete-record",
      payload: {
        createdAt: record.createdAt,
        sentence: record.sentence,
        text: record.text
      }
    }) as RecordsResponse;
    if (!result?.ok) throw new Error(result?.error || "Не удалось удалить запись");
    records = records.filter((item) => item !== record);
    render();
    showUndoNotice(record, recordIndex);
  } catch (error) {
    button.disabled = false;
    showNotice(errorMessage(error, "Ошибка удаления"));
  }
}

function showUndoNotice(record: TranslationRecord, recordIndex: number) {
  const notice = document.querySelector<HTMLElement>("#notice")!;
  const message = document.createElement("span");
  message.textContent = "Запись удалена";
  const undoButton = document.createElement("button");
  undoButton.className = "undo-button";
  undoButton.type = "button";
  undoButton.textContent = "Отменить";
  undoButton.addEventListener("click", async () => {
    undoButton.disabled = true;
    try {
      const result = await extensionApi.runtime.sendMessage({
        type: "restore-record",
        payload: { index: recordIndex, record }
      }) as RecordsResponse;
      if (!result?.ok) throw new Error(result?.error || "Не удалось восстановить запись");
      const index = Math.max(0, Math.min(recordIndex, records.length));
      records.splice(index, 0, record);
      render();
      showNotice("Запись восстановлена");
    } catch (error) {
      undoButton.disabled = false;
      showNotice(errorMessage(error, "Ошибка восстановления"));
    }
  });
  notice.replaceChildren(message, undoButton);
  notice.classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("visible"), 6000);
}

function createTrashIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const paths = [
    "M3 6h18",
    "M8 6V4h8v2",
    "M19 6l-1 14H6L5 6",
    "M10 11v5",
    "M14 11v5"
  ];
  paths.forEach((data) => {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", data);
    icon.append(path);
  });
  return icon;
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

async function exportRecords() {
  if (!records.length) return;
  const format = formatSelect.value as ExportFormat;
  exportButton.disabled = true;
  formatSelect.disabled = true;
  try {
    await exportTranslationRecords(records, format);
    showNotice(`Файл ${formatLabel(format)} подготовлен`);
  } catch (error) {
    showNotice(errorMessage(error, "Не удалось подготовить файл"));
  } finally {
    exportButton.disabled = false;
    formatSelect.disabled = false;
  }
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

function updateExportButton() {
  exportButton.textContent = `Скачать ${formatLabel(formatSelect.value as ExportFormat)}`;
}

function formatLabel(format: ExportFormat) {
  if (format === "markdown") return "Markdown";
  if (format === "anki-csv") return "Anki CSV";
  if (format === "anki-tsv") return "Anki TSV";
  return format.toUpperCase();
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function showNotice(message: string) {
  const notice = document.querySelector<HTMLElement>("#notice")!;
  notice.replaceChildren(document.createTextNode(message));
  notice.classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("visible"), 2200);
}
