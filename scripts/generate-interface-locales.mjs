import {readFile, writeFile} from "node:fs/promises";
import {execFile as execFileCallback} from "node:child_process";
import {promisify} from "node:util";

const execFile = promisify(execFileCallback);

const targets = ["de", "fr", "es", "ja", "nl", "it", "pt", "id", "hi", "pl", "zh-CN", "zh-TW", "ko", "tr", "vi", "cs", "ro", "sv", "da", "no", "fi", "hu", "el", "ms", "fil", "ar", "fa"];
const sourcePath = new URL("../src/locales/en.json", import.meta.url);
const outputUrl = (locale) => new URL(`../src/locales/${locale}.json`, import.meta.url);
const english = JSON.parse(await readFile(sourcePath, "utf8"));

if (!Object.keys(english).length) throw new Error("English interface catalog was not found");

const separator = "|||";
const entries = Object.entries(english);
const chunks = [];
let chunk = [];
let length = 0;
for (const entry of entries) {
  if (chunk.length && length + entry[1].length > 220) {
    chunks.push(chunk);
    chunk = [];
    length = 0;
  }
  chunk.push(entry);
  length += entry[1].length + 1;
}
if (chunk.length) chunks.push(chunk);

async function translateChunk(locale, values) {
  const protectedValues = values.map((value) => value.replaceAll("Context Translator", "ZXQBRANDQXZ"));
  if (locale === "ar" || locale === "fa") {
    const translated = [];
    for (let start = 0; start < protectedValues.length; start += 8) {
      const group = protectedValues.slice(start, start + 8);
      const groupResults = await Promise.all(group.map(async (value) => {
        const {stdout} = await execFile("/usr/bin/curl", [
          "-sS", "--fail", "--max-time", "30", "--get",
          "--data-urlencode", "client=gtx", "--data-urlencode", "sl=en",
          "--data-urlencode", `tl=${locale}`, "--data-urlencode", "dt=t",
          "--data-urlencode", `q=${value}`,
          "https://translate.google.com/translate_a/single"
        ], {maxBuffer: 2_000_000});
        return JSON.parse(stdout)[0].map((part) => part[0]).join("");
      }));
      translated.push(...groupResults);
    }
    return translated.map((value, index) => restorePlaceholders(values[index], value.replaceAll("ZXQBRANDQXZ", "Context Translator")));
  }
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const {stdout} = await execFile("/usr/bin/curl", [
        "-sS", "--fail", "--max-time", "30", "--get",
        "--data-urlencode", "client=gtx", "--data-urlencode", "sl=en",
        "--data-urlencode", `tl=${locale}`, "--data-urlencode", "dt=t",
        "--data-urlencode", `q=${protectedValues.join(separator)}`,
        "https://translate.google.com/translate_a/single"
      ], {maxBuffer: 2_000_000});
      const body = JSON.parse(stdout);
      const translatedText = body[0].map((part) => part[0]).join("");
      const translated = translatedText.split(separator);
      if (translated.length !== values.length) {
        const individual = [];
        for (const value of protectedValues) {
          const {stdout: singleOutput} = await execFile("/usr/bin/curl", [
            "-sS", "--fail", "--max-time", "30", "--get",
            "--data-urlencode", "client=gtx", "--data-urlencode", "sl=en",
            "--data-urlencode", `tl=${locale}`, "--data-urlencode", "dt=t",
            "--data-urlencode", `q=${value}`,
            "https://translate.google.com/translate_a/single"
          ], {maxBuffer: 2_000_000});
          individual.push(JSON.parse(singleOutput)[0].map((part) => part[0]).join(""));
        }
        return individual.map((value, index) => restorePlaceholders(values[index], value.replaceAll("ZXQBRANDQXZ", "Context Translator")));
      }
      return translated.map((value, index) => restorePlaceholders(values[index], value.replaceAll("ZXQBRANDQXZ", "Context Translator")));
    } catch (error) {
      console.warn(`${locale} chunk retry ${attempt}: ${error.message}`);
      if (attempt === 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
}

function restorePlaceholders(source, translated) {
  const placeholders = [...source.matchAll(/\{\w+}/g)].map(([placeholder]) => placeholder);
  let index = 0;
  return translated.replace(/\{[^{}]+}/g, () => placeholders[index++] || "");
}

for (const locale of targets) {
  let catalog = {};
  try { catalog = JSON.parse(await readFile(outputUrl(locale), "utf8")); } catch (_error) { /* First run. */ }
  if (process.argv.includes("--refresh-ar-fa") && ["ar", "fa"].includes(locale)) catalog = {};
  const missingEntries = entries.filter(([key]) => !catalog[key]);
  if (!missingEntries.length) {
    console.log(`Skipped ${locale}`);
    continue;
  }
  const missingKeys = new Set(missingEntries.map(([key]) => key));
  const localeChunks = locale === "hi"
    ? missingEntries.map((entry) => [entry])
    : chunks.map((entriesChunk) => entriesChunk.filter(([key]) => missingKeys.has(key))).filter((entriesChunk) => entriesChunk.length);
  for (const entriesChunk of localeChunks) {
    const translated = await translateChunk(locale, entriesChunk.map(([, value]) => value));
    entriesChunk.forEach(([key], index) => { catalog[key] = translated[index]; });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  console.log(`Generated ${locale}`);
  await writeFile(outputUrl(locale), `${JSON.stringify(catalog, null, 2)}\n`);
}
