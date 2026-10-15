import type {TranslationRecord} from "./types";
import cyrillicFontUrl from "@fontsource/roboto/files/roboto-cyrillic-400-normal.woff";
import cyrillicBoldFontUrl from "@fontsource/roboto/files/roboto-cyrillic-700-normal.woff";
import latinFontUrl from "@fontsource/roboto/files/roboto-latin-400-normal.woff";
import latinBoldFontUrl from "@fontsource/roboto/files/roboto-latin-700-normal.woff";
import latinExtendedFontUrl from "@fontsource/roboto/files/roboto-latin-ext-400-normal.woff";
import latinExtendedBoldFontUrl from "@fontsource/roboto/files/roboto-latin-ext-700-normal.woff";
import fontkit from "@pdf-lib/fontkit";
import {strToU8, zipSync} from "fflate";
import {PDFDocument, rgb} from "pdf-lib";

export type ExportFormat =
  | "json"
  | "pdf"
  | "txt"
  | "csv"
  | "tsv"
  | "anki-csv"
  | "anki-tsv"
  | "xlsx"
  | "markdown"
  | "html";

type ExportColumn = {
  header: string
  value: (record: TranslationRecord) => string
};

const columns: ExportColumn[] = [
  { header: "createdAt", value: (record) => record.createdAt },
  { header: "sourceLanguage", value: (record) => record.sourceLanguage },
  { header: "text", value: (record) => record.text },
  { header: "transcription", value: (record) => record.transcription || "" },
  { header: "translation", value: (record) => record.translation },
  { header: "translations", value: (record) => record.translations.join(" | ") },
  { header: "contextTranslation", value: (record) => record.contextTranslation || "" },
  { header: "sentence", value: (record) => record.sentence },
  { header: "pageTitle", value: (record) => record.pageTitle },
  { header: "pageUrl", value: (record) => record.pageUrl }
];

const extensions: Record<ExportFormat, string> = {
  json: "json",
  pdf: "pdf",
  txt: "txt",
  csv: "csv",
  tsv: "tsv",
  "anki-csv": "csv",
  "anki-tsv": "tsv",
  xlsx: "xlsx",
  markdown: "md",
  html: "html"
};

export async function exportTranslationRecords(records: TranslationRecord[], format: ExportFormat) {
  const variant = format.startsWith("anki-") ? "-anki" : "";
  const filename = `context-translations${variant}-${dateStamp()}.${extensions[format]}`;

  if (format === "pdf") {
    await exportPdf(records, filename);
    return;
  }
  if (format === "xlsx") {
    await exportXlsx(records, filename);
    return;
  }

  const {content, mimeType} = createTextExport(records, format);
  downloadBlob(new Blob([content], { type: `${mimeType};charset=utf-8` }), filename);
}

function createTextExport(records: TranslationRecord[], format: Exclude<ExportFormat, "pdf" | "xlsx">) {
  if (format === "json") {
    return {
      content: JSON.stringify(records.map(toExportRecord), null, 2),
      mimeType: "application/json"
    };
  }
  if (format === "csv" || format === "tsv") {
    const delimiter = format === "csv" ? "," : "\t";
    return {
      content: `\uFEFF${createDelimited(records, delimiter)}`,
      mimeType: format === "csv" ? "text/csv" : "text/tab-separated-values"
    };
  }
  if (format === "anki-csv" || format === "anki-tsv") {
    const delimiter = format === "anki-csv" ? "," : "\t";
    return {
      content: `\uFEFF${createAnki(records, delimiter)}`,
      mimeType: format === "anki-csv" ? "text/csv" : "text/tab-separated-values"
    };
  }
  if (format === "markdown") {
    return { content: createMarkdown(records), mimeType: "text/markdown" };
  }
  if (format === "html") {
    return { content: createHtml(records), mimeType: "text/html" };
  }
  return { content: createPlainText(records), mimeType: "text/plain" };
}

function createDelimited(records: TranslationRecord[], delimiter: string) {
  const rows = [
    columns.map((column) => column.header),
    ...records.map((record) => columns.map((column) => column.value(record)))
  ];
  return rows.map((row) => row.map((value) => escapeDelimited(value, delimiter)).join(delimiter)).join("\r\n");
}

function createAnki(records: TranslationRecord[], delimiter: string) {
  const separator = delimiter === "," ? "Comma" : "Tab";
  const directives = [
    `#separator:${separator}`,
    "#html:true",
    "#columns:Front,Back,Transcription,Context,ContextTranslation,Language,Source,Created"
  ];
  const rows = records.map((record) => {
    const alternatives = record.translations
      .filter((translation) => translation !== record.translation)
      .map(escapeHtml);
    const back = [
      `<strong>${escapeHtml(record.translation)}</strong>`,
      alternatives.length ? alternatives.join("<br>") : "",
      record.contextTranslation ? `<em>${escapeHtml(record.contextTranslation)}</em>` : ""
    ].filter(Boolean).join("<br>");
    const source = record.pageUrl
      ? `<a href="${escapeAttribute(record.pageUrl)}">${escapeHtml(record.pageTitle || record.pageUrl)}</a>`
      : escapeHtml(record.pageTitle);
    return [
      record.text,
      back,
      escapeHtml(record.transcription || ""),
      escapeHtml(record.sentence),
      escapeHtml(record.contextTranslation || ""),
      record.sourceLanguage,
      source,
      record.createdAt
    ]
      .map((value) => escapeDelimited(value, delimiter)).join(delimiter);
  });
  return [...directives, ...rows].join("\r\n");
}

function createPlainText(records: TranslationRecord[]) {
  return records.map((record, index) => [
    `${index + 1}. ${record.text}`,
    record.translation,
    record.transcription || "",
    record.translations.length > 1 ? `Варианты: ${record.translations.join(", ")}` : "",
    `Контекст: ${record.sentence}`,
    record.contextTranslation ? `Перевод контекста: ${record.contextTranslation}` : "",
    `Язык оригинала: ${record.sourceLanguage}`,
    record.pageTitle || record.pageUrl ? `Источник: ${[record.pageTitle, record.pageUrl].filter(Boolean).join(" — ")}` : "",
    `Сохранено: ${record.createdAt}`
  ].filter(Boolean).join("\n")).join("\n\n");
}

function createMarkdown(records: TranslationRecord[]) {
  const header = [
    "# История переводов",
    "",
    `Экспортировано записей: ${records.length}`,
    ""
  ];
  const entries = records.flatMap((record, index) => [
    `## ${index + 1}. **${escapeMarkdown(record.text)}**`,
    "",
    escapeMarkdown(record.translation),
    record.transcription ? `*${escapeMarkdown(record.transcription)}*` : "",
    "",
    record.translations.length > 1 ? `**Варианты:** ${record.translations.map(escapeMarkdown).join(", ")}` : "",
    `**Контекст:** ${escapeMarkdown(record.sentence)}`,
    record.contextTranslation ? `**Перевод контекста:** ${escapeMarkdown(record.contextTranslation)}` : "",
    `**Язык оригинала:** ${escapeMarkdown(record.sourceLanguage)}`,
    record.pageUrl
      ? `**Источник:** [${escapeMarkdown(record.pageTitle || record.pageUrl)}](${encodeURI(record.pageUrl)})`
      : record.pageTitle ? `**Источник:** ${escapeMarkdown(record.pageTitle)}` : "",
    `**Сохранено:** ${escapeMarkdown(record.createdAt)}`,
    ""
  ]);
  return [...header, ...entries].join("\n");
}

function createHtml(records: TranslationRecord[]) {
  const items = records.map((record) => `
    <article>
      <h2 class="term">${escapeHtml(record.text)}</h2>
      <div class="translation">${escapeHtml(record.translation)}</div>
      ${record.transcription ? `<div class="transcription">${escapeHtml(record.transcription)}</div>` : ""}
      ${record.translations.length > 1 ? `<p><b>Варианты:</b> ${record.translations.map(escapeHtml).join(", ")}</p>` : ""}
      <p class="context"><b>Контекст:</b> ${escapeHtml(record.sentence)}</p>
      ${record.contextTranslation ? `<p class="context-translation"><b>Перевод контекста:</b> ${escapeHtml(record.contextTranslation)}</p>` : ""}
      <p><b>Язык оригинала:</b> ${escapeHtml(record.sourceLanguage)}</p>
      <footer>
        ${record.pageUrl ? `<a href="${escapeAttribute(record.pageUrl)}">${escapeHtml(record.pageTitle || record.pageUrl)}</a>` : escapeHtml(record.pageTitle)}
        <time>${escapeHtml(record.createdAt)}</time>
      </footer>
    </article>`).join("");
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>История переводов</title><style>
body{max-width:900px;margin:40px auto;padding:0 20px;color:#172033;font:15px/1.55 system-ui,sans-serif}h1{margin-bottom:30px}article{padding:20px 0;border-top:1px solid #dce2ea}.term{margin:0;color:#2457c5;font-size:21px;font-weight:750}.translation{margin-top:3px;font-size:18px}.transcription{margin-top:3px;color:#65738a;font-family:Georgia,serif}.context{margin-top:14px}.context-translation{color:#536177}p{margin:7px 0}footer{display:flex;justify-content:space-between;gap:20px;margin-top:12px;color:#79869a;font-size:12px}a{color:#2457c5}time{white-space:nowrap}@media print{body{margin:0}article{break-inside:avoid}}
</style></head><body><h1>История переводов</h1>${items}</body></html>`;
}

async function exportPdf(records: TranslationRecord[], filename: string) {
  const [
    latinResponse,
    cyrillicResponse,
    latinBoldResponse,
    cyrillicBoldResponse,
    latinExtendedResponse,
    latinExtendedBoldResponse
  ] = await Promise.all([
    fetch(latinFontUrl),
    fetch(cyrillicFontUrl),
    fetch(latinBoldFontUrl),
    fetch(cyrillicBoldFontUrl),
    fetch(latinExtendedFontUrl),
    fetch(latinExtendedBoldFontUrl)
  ]);
  const fontResponses = [
    latinResponse,
    cyrillicResponse,
    latinBoldResponse,
    cyrillicBoldResponse,
    latinExtendedResponse,
    latinExtendedBoldResponse
  ];
  if (!fontResponses.every((response) => response.ok)) {
    throw new Error("Не удалось загрузить шрифт PDF");
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [
    latinFont,
    cyrillicFont,
    latinBoldFont,
    cyrillicBoldFont,
    latinExtendedFont,
    latinExtendedBoldFont
  ] = await Promise.all([
    pdf.embedFont(await latinResponse.arrayBuffer(), { subset: true }),
    pdf.embedFont(await cyrillicResponse.arrayBuffer(), { subset: true }),
    pdf.embedFont(await latinBoldResponse.arrayBuffer(), { subset: true }),
    pdf.embedFont(await cyrillicBoldResponse.arrayBuffer(), { subset: true }),
    pdf.embedFont(await latinExtendedResponse.arrayBuffer(), { subset: true }),
    pdf.embedFont(await latinExtendedBoldResponse.arrayBuffer(), { subset: true })
  ]);
  const fonts = {
    latin: latinFont,
    cyrillic: cyrillicFont,
    latinBold: latinBoldFont,
    cyrillicBold: cyrillicBoldFont,
    latinExtended: latinExtendedFont,
    latinExtendedBold: latinExtendedBoldFont
  };
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 42;
  const maxWidth = pageSize[0] - margin * 2;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const newPage = () => {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - margin;
  };
  const paragraph = (text: string, size: number, color, spacing = 5, bold = false) => {
    const lineHeight = size * 1.35;
    for (const line of wrapPdfText(text || "—", maxWidth, size, fonts, bold)) {
      if (y - lineHeight < margin) newPage();
      drawPdfText(page, line, margin, y - size, size, color, fonts, bold);
      y -= lineHeight;
    }
    y -= spacing;
  };

  paragraph("История переводов", 20, rgb(0.09, 0.13, 0.2), 2);
  paragraph(`Записей: ${records.length}`, 10, rgb(0.41, 0.46, 0.55), 12);
  records.forEach((record, index) => {
    if (y < margin + 90) newPage();
    paragraph(`${index + 1}. ${record.text}`, 14, rgb(0.14, 0.34, 0.77), 2, true);
    paragraph(record.translation, 12, rgb(0.09, 0.13, 0.2), 2);
    if (record.transcription) {
      paragraph(record.transcription, 10, rgb(0.4, 0.45, 0.54), 3);
    }
    if (record.translations.length > 1) {
      paragraph(`Варианты: ${record.translations.join(", ")}`, 9, rgb(0.18, 0.22, 0.3), 2);
    }
    paragraph(`Контекст: ${record.sentence}`, 9, rgb(0.33, 0.38, 0.47), 3);
    if (record.contextTranslation) {
      paragraph(`Перевод контекста: ${record.contextTranslation}`, 9, rgb(0.18, 0.22, 0.3), 3);
    }
    paragraph(`Язык оригинала: ${record.sourceLanguage}`, 8, rgb(0.48, 0.53, 0.61), 2);
    paragraph([record.pageTitle, record.pageUrl, record.createdAt].filter(Boolean).join(" | "), 8, rgb(0.48, 0.53, 0.61), 10);
  });

  const bytes = await pdf.save();
  downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
}

async function exportXlsx(records: TranslationRecord[], filename: string) {
  const rowValues = [
    columns.map((column) => column.header),
    ...records.map((record) => columns.map((column) => column.value(record)))
  ];
  const rows = rowValues.map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr" s="${rowIndex === 0 ? 1 : 2}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const lastRow = Math.max(rowValues.length, 1);
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Context Translator</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Переводы" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2864DC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:J${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="2" width="20" customWidth="1"/><col min="3" max="6" width="24" customWidth="1"/><col min="7" max="8" width="45" customWidth="1"/><col min="9" max="10" width="28" customWidth="1"/></cols><sheetData>${rows}</sheetData><autoFilter ref="A1:J${lastRow}"/></worksheet>`
  };
  const archive = zipSync(Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path, strToU8(content)])
  ), { level: 6 });
  downloadBlob(new Blob([archive as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }), filename);
}

function wrapPdfText(text: string, maxWidth: number, size: number, fonts, bold = false) {
  const characters = [...String(text ?? "").replace(/\s+/g, " ").trim()];
  if (!characters.length) return [""];
  const lines: string[] = [];
  let line = "";
  let lastSpace = -1;
  for (const character of characters) {
    const candidate = line + character;
    if (measurePdfText(candidate, size, fonts, bold) <= maxWidth || !line) {
      line = candidate;
      if (character === " ") lastSpace = line.length - 1;
      continue;
    }
    if (lastSpace >= 0) {
      lines.push(line.slice(0, lastSpace).trimEnd());
      line = `${line.slice(lastSpace + 1)}${character}`;
    } else {
      lines.push(line);
      line = character;
    }
    lastSpace = line.lastIndexOf(" ");
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

function measurePdfText(text: string, size: number, fonts, bold = false) {
  return pdfTextRuns(text, fonts, bold).reduce((width, run) => (
    width + run.font.widthOfTextAtSize(run.text, size)
  ), 0);
}

function drawPdfText(page, text: string, x: number, y: number, size: number, color, fonts, bold = false) {
  let position = x;
  pdfTextRuns(text, fonts, bold).forEach((run) => {
    page.drawText(run.text, { x: position, y, size, font: run.font, color });
    position += run.font.widthOfTextAtSize(run.text, size);
  });
}

function pdfTextRuns(text: string, fonts, bold = false) {
  const runs: Array<{text: string; font: typeof fonts.latin}> = [];
  [...text].forEach((character) => {
    const isCyrillic = /[\u0400-\u052f]/u.test(character);
    const isExtendedLatin = /[\u0100-\u036f]/u.test(character);
    const font = bold
      ? (isCyrillic ? fonts.cyrillicBold : isExtendedLatin ? fonts.latinExtendedBold : fonts.latinBold)
      : (isCyrillic ? fonts.cyrillic : isExtendedLatin ? fonts.latinExtended : fonts.latin);
    const lastRun = runs.at(-1);
    if (lastRun?.font === font) lastRun.text += character;
    else runs.push({ text: character, font });
  });
  return runs;
}

function columnName(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function escapeXml(value: string) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
    })[character]!);
}

function escapeDelimited(value: string, delimiter: string) {
  const normalized = protectSpreadsheetCell(String(value ?? "").replace(/\r\n?/g, "\n"));
  return normalized.includes(delimiter) || /["\n]/.test(normalized)
    ? `"${normalized.replace(/"/g, '""')}"`
    : normalized;
}

function protectSpreadsheetCell(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeHtml(value: string) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function escapeMarkdown(value: string) {
  return String(value ?? "").replace(/([\\`*_{}\[\]<>|])/g, "\\$1").replace(/\r?\n/g, " ");
}

function toExportRecord(record: TranslationRecord): TranslationRecord {
  return {
    contextTranslation: record.contextTranslation,
    createdAt: record.createdAt,
    pageTitle: record.pageTitle,
    pageUrl: record.pageUrl,
    sentence: record.sentence,
    sourceLanguage: record.sourceLanguage,
    text: record.text,
    transcription: record.transcription,
    translation: record.translation,
    translations: record.translations
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
