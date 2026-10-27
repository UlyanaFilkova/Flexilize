import {describe, expect, it} from "vitest";
import manifest from "../src/manifest.json";
import packageJson from "../package.json";
import englishMessages from "../_locales/en/messages.json";
import russianMessages from "../_locales/ru/messages.json";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

describe("extension manifest", () => {
  it("keeps package and extension versions synchronized", () => {
    expect(manifest.version).toBe(packageJson.version);
  });

  it("registers content, background, popup and options entry points", () => {
    expect(manifest.content_scripts).toEqual(expect.arrayContaining([
      expect.objectContaining({matches: ["<all_urls>"], js: ["content.ts"]})
    ]));
    expect(manifest.background).toMatchObject({"chromium:service_worker": "background.ts", "firefox:scripts": ["background.ts"]});
    expect(manifest.options_ui.page).toBe("options/index.html");
    expect(manifest["chromium:action"].default_popup).toBe("popup/index.html");
    expect(manifest["firefox:browser_action"].default_popup).toBe("popup/index.html");
  });

  it("declares Russian and English browser metadata", () => {
    expect(manifest.default_locale).toBe("ru");
    expect(manifest.name).toBe("__MSG_extensionName__");
    expect(englishMessages.actionTitle.message).toBe("Saved translations");
    expect(russianMessages.actionTitle.message).toBe("Сохранённые переводы");
  });

  it("includes browser metadata for every interface language", () => {
    ["ru", "en", "de", "fr", "es", "ja", "nl", "it", "pt", "id", "hi"].forEach((locale) => {
      const messages = JSON.parse(readFileSync(resolve(`_locales/${locale}/messages.json`), "utf8"));
      expect(messages.extensionName.message).toBe("Context Translator");
      expect(messages.extensionDescription.message).toBeTruthy();
      expect(messages.actionTitle.message).toBeTruthy();
    });
  });

  it("declares storage and every remote provider used by the extension", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["storage", "unlimitedStorage"]));
    ["api.mymemory.translated.net", "api.dictionaryapi.dev", "api.datamuse.com", "translate.googleapis.com", "translate.google.com"]
      .forEach((host) => expect(manifest.host_permissions.some((permission) => permission.includes(host))).toBe(true));
  });

  it("exposes runnable local test commands and includes coverage in CI", () => {
    expect(packageJson.scripts.test).toContain("vitest");
    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
    expect(packageJson.scripts.ci).toBe(
      "npm run typecheck && npm run test:coverage && npm run build:chrome && npm run build:firefox",
    );
  });
});
