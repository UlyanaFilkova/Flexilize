import browser from "webextension-polyfill";
import type {ExportFormat} from "./export";
import type {RecordsResponse, TranslationRecord} from "./types";
import {formatRecordCount, getActiveLanguage, translate, type InterfaceLanguage} from "./i18n";

const RECORDS_KEY = "translationRecords";

export const exportFormats: ReadonlyArray<{format: ExportFormat; label: string}> = [
  {format: "json", label: "JSON"},
  {format: "pdf", label: "PDF"},
  {format: "txt", label: "TXT"},
  {format: "csv", label: "CSV"},
  {format: "tsv", label: "TSV"},
  {format: "anki-csv", label: "Anki CSV"},
  {format: "anki-tsv", label: "Anki TSV"},
  {format: "xlsx", label: "XLSX"},
  {format: "markdown", label: "Markdown"},
  {format: "html", label: "HTML"}
];

export async function getTranslationRecords() {
  return getStoredTranslationRecords();
}

export async function deleteTranslationRecord(record: TranslationRecord) {
  await recordsFrom(await browser.runtime.sendMessage({
    type: "delete-record",
    payload: {createdAt: record.createdAt, sentence: record.sentence, text: record.text}
  }), "Не удалось удалить запись");
}

export async function updateTranslationRecord(original: TranslationRecord, record: TranslationRecord) {
  await recordsFrom(await browser.runtime.sendMessage({
    type: "update-record",
    payload: {
      original: {createdAt: original.createdAt, sentence: original.sentence, text: original.text},
      record
    }
  }), "Не удалось сохранить запись");
}

export async function restoreTranslationRecord(record: TranslationRecord, index: number) {
  await recordsFrom(await browser.runtime.sendMessage({
    type: "restore-record",
    payload: {index, record}
  }), "Не удалось восстановить запись");
}

export async function clearTranslationRecords() {
  await recordsFrom(await browser.runtime.sendMessage({type: "clear-records"}), "Не удалось очистить список");
}

export async function downloadTranslationRecords(records: TranslationRecord[], format: ExportFormat) {
  const {exportTranslationRecords} = await import("./export");
  await exportTranslationRecords(records, format);
}

export function formatLabel(format: ExportFormat) {
  return exportFormats.find((item) => item.format === format)?.label || format.toUpperCase();
}

export function pluralizeRecords(count: number, language: InterfaceLanguage = getActiveLanguage()) {
  if (language !== "ru") return formatRecordCount(count, language);
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "запись"
    : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)
      ? "записи"
      : "записей";
  return `${count} ${word}`;
}

export function formatRecordDate(value: string, language: InterfaceLanguage = getActiveLanguage()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(language, {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}).format(date);
}

export function recordHostname(value: string, language: InterfaceLanguage = getActiveLanguage()) {
  try { return new URL(value).hostname; } catch (_error) { return translate("Источник", language); }
}

function recordsFrom(value: unknown, fallback: string) {
  const result = value as RecordsResponse;
  if (!result?.ok) throw new Error(result?.error || fallback);
  return result.records || [];
}

async function getStoredTranslationRecords(): Promise<TranslationRecord[]> {
  const stored = await browser.storage.local.get(RECORDS_KEY);
  return Array.isArray(stored?.[RECORDS_KEY]) ? stored[RECORDS_KEY] as TranslationRecord[] : [];
}
