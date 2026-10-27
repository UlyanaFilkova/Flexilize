import {describe, expect, it} from "vitest";
import {loadInterfaceLanguage, localizeDom, normalizeInterfaceLanguage, translate} from "../src/i18n";

describe("interface localization", () => {
  it("normalizes the supported interface languages", () => {
    expect(normalizeInterfaceLanguage("en")).toBe("en");
    expect(normalizeInterfaceLanguage("ru")).toBe("ru");
    expect(normalizeInterfaceLanguage("de")).toBe("de");
    expect(normalizeInterfaceLanguage("unsupported")).toBe("ru");
  });

  it.each([
    ["de", "Einstellungen"], ["fr", "Paramètres"], ["es", "Configuración"], ["ja", "設定"],
    ["nl", "Instellingen"], ["it", "Impostazioni"], ["pt", "Configurações"],
    ["id", "Pengaturan"], ["hi", "सेटिंग्स"]
  ] as const)("loads the complete %s catalog", async (language, settingsLabel) => {
    await loadInterfaceLanguage(language);
    expect(translate("Настройки", language)).toBe(settingsLabel);
    expect(translate("Удалить перевод «hello»", language)).not.toMatch(/[А-Яа-яЁё]/u);
    expect(translate("Практическое руководство: от первого перевода до личного словаря и экспорта в Anki.", language)).not.toMatch(/[А-Яа-яЁё]/u);
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
