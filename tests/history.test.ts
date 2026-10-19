import {beforeEach, describe, expect, it} from "vitest";
import {
  clearTranslationRecords,
  deleteTranslationRecord,
  exportFormats,
  formatLabel,
  formatRecordDate,
  getTranslationRecords,
  pluralizeRecords,
  recordHostname,
  restoreTranslationRecord,
  updateTranslationRecord
} from "../src/history";
import {browserMock} from "./mocks/browser";
import {record} from "./fixtures";

describe("history API", () => {
  beforeEach(() => browserMock.runtime.sendMessage.mockReset());

  it("loads records", async () => {
    browserMock.runtime.sendMessage.mockResolvedValue({ok: true, records: [record]});
    await expect(getTranslationRecords()).resolves.toEqual([record]);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({type: "get-records"});
  });

  it("sends exact mutations", async () => {
    browserMock.runtime.sendMessage.mockResolvedValue({ok: true});
    await deleteTranslationRecord(record);
    await updateTranslationRecord(record, {...record, translation: "Добрый день"});
    await restoreTranslationRecord(record, 3);
    await clearTranslationRecords();
    expect(browserMock.runtime.sendMessage.mock.calls.map(([message]) => message.type))
      .toEqual(["delete-record", "update-record", "restore-record", "clear-records"]);
    expect(browserMock.runtime.sendMessage.mock.calls[0][0].payload).toEqual({
      createdAt: record.createdAt, sentence: record.sentence, text: record.text
    });
    expect(browserMock.runtime.sendMessage.mock.calls[2][0].payload).toEqual({index: 3, record});
  });

  it("uses backend and fallback errors", async () => {
    browserMock.runtime.sendMessage.mockResolvedValueOnce({ok: false, error: "Нет доступа"});
    await expect(getTranslationRecords()).rejects.toThrow("Нет доступа");
    browserMock.runtime.sendMessage.mockResolvedValueOnce(undefined);
    await expect(clearTranslationRecords()).rejects.toThrow("Не удалось очистить список");
  });
});

describe("history presentation helpers", () => {
  it.each([[0, "0 записей"], [1, "1 запись"], [2, "2 записи"], [5, "5 записей"], [11, "11 записей"], [21, "21 запись"], [24, "24 записи"]])(
    "pluralizes %s", (count, expected) => expect(pluralizeRecords(count)).toBe(expected)
  );

  it("formats labels and exposes every export format", () => {
    expect(formatLabel("anki-csv")).toBe("Anki CSV");
    expect(formatLabel("json")).toBe("JSON");
    expect(exportFormats).toHaveLength(10);
  });

  it("formats valid dates and safely handles invalid dates and URLs", () => {
    expect(formatRecordDate(record.createdAt)).not.toBe("");
    expect(formatRecordDate("not-a-date")).toBe("");
    expect(recordHostname(record.pageUrl)).toBe("example.com");
    expect(recordHostname("not a url")).toBe("Источник");
  });
});
