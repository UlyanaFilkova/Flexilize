import browser from "webextension-polyfill";
import type {ExportFormat} from "../export";
import {
  clearTranslationRecords,
  deleteTranslationRecord,
  downloadTranslationRecords,
  formatLabel,
  formatRecordDate,
  getTranslationRecords,
  pluralizeRecords,
  recordHostname,
  restoreTranslationRecord
} from "../history";
import {errorMessage, type TranslationRecord} from "../types";

const extensionApi = browser;
const listElement = document.querySelector<HTMLOListElement>("#records")!;
const emptyElement = document.querySelector<HTMLElement>("#empty")!;
const counterElement = document.querySelector<HTMLElement>("#counter")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settings")!;
const historyButton = document.querySelector<HTMLButtonElement>("#history")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
const formatSelect = document.querySelector<HTMLSelectElement>("#export-format")!;
let records: TranslationRecord[] = [];

clearButton.append(createTrashIcon());
settingsButton.append(createSettingsIcon());
document.addEventListener("DOMContentLoaded", loadRecords);
clearButton.addEventListener("click", clearRecords);
settingsButton.addEventListener("click", () => void extensionApi.runtime.openOptionsPage());
historyButton.addEventListener("click", () => void openHistory());
exportButton.addEventListener("click", () => void exportRecords());
formatSelect.addEventListener("change", updateExportButton);

async function openHistory() {
  await extensionApi.tabs.create({url: extensionApi.runtime.getURL("options/index.html#history")});
  window.close();
}

async function loadRecords() {
  try {
    records = await getTranslationRecords();
    render();
  } catch (error) {
    showNotice(errorMessage(error, "Ошибка загрузки"));
  }
}

function render() {
  listElement.replaceChildren(...records.map(createRecordElement));
  emptyElement.hidden = records.length > 0;
  counterElement.textContent = pluralizeRecords(records.length);
  clearButton.disabled = records.length === 0;
  exportButton.disabled = records.length === 0;
  formatSelect.disabled = records.length === 0;
}

function createRecordElement(record: TranslationRecord) {
  const item = document.createElement("li");
  item.className = "record";

  const pair = document.createElement("div");
  pair.className = "pair";
  const termLine = document.createElement("div");
  termLine.className = "term-line";
  termLine.append(textElement("span", "original", record.text));
  if (record.transcription) termLine.append(textElement("span", "record-transcription", record.transcription));
  pair.append(termLine, textElement("span", "translated", record.translation));
  const alternatives = record.translations.filter((translation) => translation && translation !== record.translation);
  if (alternatives.length) {
    pair.append(textElement("span", "translation-alternatives", alternatives.join(", ")));
  }
  const sentence = textElement("div", "sentence", record.sentence);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.append(textElement("time", "", formatRecordDate(record.createdAt)));

  if (record.pageUrl) {
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = record.pageUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = record.pageTitle || recordHostname(record.pageUrl);
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

  item.append(pair);
  item.append(sentence, meta);
  return item;
}

async function deleteRecord(record: TranslationRecord, button: HTMLButtonElement) {
  const recordIndex = records.indexOf(record);
  button.disabled = true;
  try {
    await deleteTranslationRecord(record);
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
      await restoreTranslationRecord(record, recordIndex);
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

function createSettingsIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const paths = [
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
    "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.4 1.6H9.55A1.7 1.7 0 0 0 8.4 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-1.6-1.4V9.55A1.7 1.7 0 0 0 4 8.4a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.46 3.6l.06.06A1.7 1.7 0 0 0 8.4 4a1.7 1.7 0 0 0 1.4-1.6h4.05A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 1.6 1.4v4.05A1.7 1.7 0 0 0 19.4 15Z"
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
    await clearTranslationRecords();
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
    await downloadTranslationRecords(records, format);
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

function updateExportButton() {
  exportButton.textContent = `Скачать ${formatLabel(formatSelect.value as ExportFormat)}`;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function showNotice(message: string) {
  const notice = document.querySelector<HTMLElement>("#notice")!;
  notice.replaceChildren(document.createTextNode(message));
  notice.classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("visible"), 2200);
}
