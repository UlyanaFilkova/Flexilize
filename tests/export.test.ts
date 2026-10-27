import {beforeEach, describe, expect, it, vi} from "vitest";
import {unzipSync, strFromU8} from "fflate";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {exportTranslationRecords, type ExportFormat} from "../src/export";
import {record} from "./fixtures";
import {storageData} from "./mocks/browser";
import {defaultSettings, SETTINGS_KEY} from "../src/settings";

async function blobBytes(blob: Blob) {
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  }));
}

async function blobText(blob: Blob) {
  return new TextDecoder().decode(await blobBytes(blob));
}

describe("exports", () => {
  let downloaded: Blob[];
  let anchors: HTMLAnchorElement[];

  beforeEach(() => {
    downloaded = [];
    anchors = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      downloaded.push(blob as Blob);
      return "blob:test";
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push(this);
    });
  });

  it.each<[ExportFormat, string, string]>([
    ["json", ".json", '"translation": "Привет"'],
    ["txt", ".txt", "Перевод контекста: Привет, мир!"],
    ["csv", ".csv", "createdAt,sourceLanguage,text"],
    ["tsv", ".tsv", "createdAt\tsourceLanguage\ttext"],
    ["anki-csv", ".csv", "#separator:Comma"],
    ["anki-tsv", ".tsv", "#separator:Tab"],
    ["markdown", ".md", "# История переводов"],
    ["html", ".html", "<!doctype html>"]
  ])("creates %s downloads", async (format, extension, expected) => {
    await exportTranslationRecords([record], format);
    expect(downloaded).toHaveLength(1);
    expect(anchors[0].download).toMatch(new RegExp(`context-translations.*\\d{4}-\\d{2}-\\d{2}\\${extension}$`));
    expect(await blobText(downloaded[0])).toContain(expected);
  });

  it("escapes spreadsheet formulas, delimiters, HTML and Markdown", async () => {
    const dangerous = {...record, text: '=HYPERLINK("bad")', translation: "<script>&", sentence: "a,b\nline"};
    await exportTranslationRecords([dangerous], "csv");
    const csv = await blobText(downloaded[0]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('"a,b\nline"');

    downloaded.length = 0;
    await exportTranslationRecords([dangerous], "html");
    expect(await blobText(downloaded[0])).toContain("&lt;script&gt;&amp;");

    downloaded.length = 0;
    await exportTranslationRecords([{...dangerous, text: "*term*"}], "markdown");
    expect(await blobText(downloaded[0])).toContain("\\*term\\*");
  });

  it("uses the selected interface language in readable exports", async () => {
    storageData[SETTINGS_KEY] = {...defaultSettings, interfaceLanguage: "en"};
    await exportTranslationRecords([record], "markdown");
    const markdown = await blobText(downloaded[0]);
    expect(markdown).toContain("# Translation history");
    expect(markdown).toContain("**Context translation:**");
  });

  it("loads non-English export catalogs on demand", async () => {
    storageData[SETTINGS_KEY] = {...defaultSettings, interfaceLanguage: "de"};
    await exportTranslationRecords([record], "markdown");
    const markdown = await blobText(downloaded[0]);
    expect(markdown).toContain("# Übersetzungsverlauf");
    expect(markdown).toContain("**Kontextübersetzung:**");
    expect(markdown).toContain("Exportierte Datensätze: 1");
  });

  it("creates a valid XLSX archive with escaped worksheet values", async () => {
    await exportTranslationRecords([{...record, text: "A&B <test>"}], "xlsx");
    const archive = unzipSync(await blobBytes(downloaded[0]));
    expect(Object.keys(archive)).toContain("xl/worksheets/sheet1.xml");
    const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("A&amp;B &lt;test&gt;");
    expect(sheet).toContain('autoFilter ref="A1:J2"');
  });

  it("creates a readable PDF with embedded Latin and Cyrillic fonts", async () => {
    const fontFiles = {
      "roboto-latin-400-normal.woff": "node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff",
      "roboto-latin-700-normal.woff": "node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff",
      "roboto-cyrillic-400-normal.woff": "node_modules/@fontsource/roboto/files/roboto-cyrillic-400-normal.woff",
      "roboto-cyrillic-700-normal.woff": "node_modules/@fontsource/roboto/files/roboto-cyrillic-700-normal.woff",
      "roboto-latin-ext-400-normal.woff": "node_modules/@fontsource/roboto/files/roboto-latin-ext-400-normal.woff",
      "roboto-latin-ext-700-normal.woff": "node_modules/@fontsource/roboto/files/roboto-latin-ext-700-normal.woff"
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const entry = Object.entries(fontFiles).find(([name]) => url.includes(name));
      if (!entry) return new Response(null, {status: 404});
      return new Response(await readFile(resolve(entry[1])), {status: 200});
    }));
    await exportTranslationRecords([record], "pdf");
    const bytes = await blobBytes(downloaded[0]);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(downloaded[0].type).toBe("application/pdf");
    expect(anchors[0].download).toMatch(/\.pdf$/);
  }, 10_000);
});
