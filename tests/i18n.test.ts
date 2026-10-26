import {describe, expect, it} from "vitest";
import {localizeDom, normalizeInterfaceLanguage, translate} from "../src/i18n";

describe("interface localization", () => {
  it("normalizes the supported interface languages", () => {
    expect(normalizeInterfaceLanguage("en")).toBe("en");
    expect(normalizeInterfaceLanguage("ru")).toBe("ru");
    expect(normalizeInterfaceLanguage("de")).toBe("ru");
  });

  it("translates static and dynamic messages", () => {
    expect(translate("Настройки", "en")).toBe("Settings");
    expect(translate("2 записи", "en")).toBe("2 records");
    expect(translate("Удалить перевод «hello»", "en")).toBe("Delete translation “hello”");
    expect(translate("Настройки", "ru")).toBe("Настройки");
  });

  it("localizes text and accessibility attributes without changing translated records", () => {
    document.body.innerHTML = `
      <main><h1>Настройки</h1><button aria-label="Открыть настройки">Настройки</button>
      <span class="record-original">Перевод</span></main>`;
    localizeDom(document, "en");
    expect(document.querySelector("h1")?.textContent).toBe("Settings");
    expect(document.querySelector("button")?.getAttribute("aria-label")).toBe("Open settings");
    expect(document.querySelector(".record-original")?.textContent).toBe("Перевод");
    expect(document.documentElement.lang).toBe("en");
  });
});
