import {describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import russianCatalog from "../src/locales/ru.json";
import {formatRecordCount, getActiveLanguage, setActiveLanguage, subscribeInterfaceLanguage, INTERFACE_LANGUAGES, loadInterfaceLanguage, localizeDom, normalizeInterfaceLanguage, translate} from "../src/i18n";

function messageNumbers(value: string) {
  const normalized = value.normalize("NFKC")
    .replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) % 16))
    .replace(/٫/g, ".")
    .replace(/(?<=\d)[.,'\s٬](?=\d{3}(?:\D|$))/g, "");
  return (normalized.match(/\d+(?:[.,]\d+)?/g) || []).map((number) => Number(number.replace(",", "."))).sort((a, b) => a - b);
}

describe("interface localization", () => {
  it.each(INTERFACE_LANGUAGES)("keeps every %s message complete and consistent with the Russian catalog", async (language) => {
    const raw = readFileSync(`src/locales/${language}.json`, "utf8");
    const catalog = JSON.parse(raw) as Record<string, string>;
    await loadInterfaceLanguage(language);
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(russianCatalog).sort());
    const rawKeys = [...raw.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]);
    expect(rawKeys.length).toBe(new Set(rawKeys).size);
    for (const key of Object.keys(russianCatalog)) {
      const source = russianCatalog[key as keyof typeof russianCatalog];
      const localized = catalog[key];
      expect(localized, `${language}: ${key}`).toBeTruthy();
      expect(localized).toBe(localized.trim());
      expect(translate(source, language), `${language}: ${source}`).toBe(localized);
      expect((localized.match(/\{\w+\}/g) || []).sort()).toEqual((source.match(/\{\w+\}/g) || []).sort());
      expect(localized.match(/[{}]/g) || []).toEqual(source.match(/[{}]/g) || []);
      if (messageNumbers(source).length) expect(messageNumbers(localized), `${language}: ${key}`).toEqual(messageNumbers(source));
      expect(localized).not.toMatch(/ZXQ|QXZ|\|\|\||\uFFFD/u);
      for (const token of ["Context Translator", "Anki", "CSV", "TSV", "JSON", "TXT", "PDF", "XLSX", "HTML", "Markdown"]) {
        if (source.includes(token)) expect(localized, `${language}: ${key}`).toContain(token);
      }
      if (language !== "ru" && language !== "sr" && /[А-Яа-яЁё]/u.test(source)) expect(localized).not.toBe(source);
      if (key.startsWith("ui.onboarding-")) expect(localized).not.toMatch(/Ctrl\s*\+/u);
    }
    expect(catalog).not.toHaveProperty("ui.onboarding-target-language-prompt");
    expect(catalog["ui.hotkey-activation-description"]).not.toMatch(/[.。।]\s*$/u);
    expect(catalog["ui.onboarding-hotkey-description"]).not.toMatch(/[.。।]\s*$/u);

    const manifestLocale = language.replace("-", "_");
    const messages = JSON.parse(readFileSync(`_locales/${manifestLocale}/messages.json`, "utf8"));
    expect(Object.keys(messages).sort()).toEqual(["actionTitle", "extensionDescription", "extensionName"]);
    expect(messages.extensionName.message).toBe("Context Translator");
    for (const {message} of Object.values(messages) as Array<{message: string}>) {
      expect(message.trim()).toBeTruthy();
      expect(message).toBe(message.trim());
    }
  });

  it.each([
    ["ru", 2, "2 записи"], ["ru", 21, "21 запись"], ["ru", 22, "22 записи"], ["ru", 25, "25 записей"],
    ["cs", 2, "2 záznamy"], ["cs", 102, "102 záznamů"], ["sk", 4, "4 záznamy"], ["sk", 5, "5 záznamov"],
    ["sl", 2, "2 zapisa"], ["sl", 3, "3 zapisi"], ["sl", 5, "5 zapisov"], ["sl", 101, "101 zapis"],
    ["pl", 22, "22 rekordy"], ["pl", 12, "12 rekordów"], ["sr", 21, "21 запис"],
    ["ar", 2, "2 سجلان"], ["ar", 3, "3 سجلات"], ["ar", 11, "11 سجلًا"],
    ["fr", 0, "0 entrée"], ["en", 0, "0 records"]
  ] as const)("formats %s record counts correctly for %s", (language, count, expected) => {
    expect(formatRecordCount(count, language)).toBe(expected);
  });

  it("notifies language subscribers only on changes and respects unsubscription", () => {
    const initial = getActiveLanguage();
    const next = initial === "en" ? "de" : "en";
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeInterfaceLanguage(first);
    const stopSecond = subscribeInterfaceLanguage(second);
    try {
      setActiveLanguage(next);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      setActiveLanguage(next);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      stopFirst();
      setActiveLanguage(initial);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(2);
      stopSecond();
      setActiveLanguage(next);
      expect(second).toHaveBeenCalledTimes(2);
    } finally {
      stopFirst();
      stopSecond();
      setActiveLanguage(initial);
    }
  });

  it("normalizes the supported interface languages", () => {
    expect(normalizeInterfaceLanguage("en")).toBe("en");
    expect(normalizeInterfaceLanguage("ru")).toBe("ru");
    expect(normalizeInterfaceLanguage("de")).toBe("de");
    expect(normalizeInterfaceLanguage("uk", "en")).toBe("en");
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
    expect(translate("Обратный перевод (Ctrl + Shift + S)", "en")).toBe("Reverse translation (Ctrl + Shift + S)");
    expect(translate("Достигнут лимит в 500 символов.", "en")).toBe("The limit of 500 characters has been reached.");
  });

  it.each(INTERFACE_LANGUAGES.filter((language) => language !== "ru"))("translates updated interface labels in %s", async (language) => {
    await loadInterfaceLanguage(language);
    for (const source of ["Активация", "Языки", "Открыть меню", "Закрыть меню", "Настроить активацию", "При удалении данных расширения параметры вернутся к значениям по умолчанию."]) {
      const translated = translate(source, language);
      expect(translated, `${language}: ${source}`).not.toBe(source);
    }
  });

  it.each(INTERFACE_LANGUAGES.filter((language) => language !== "ru"))("translates the new settings and context menu labels in %s", async (language) => {
    await loadInterfaceLanguage(language);
    for (const source of [
      "Расширенные настройки",
      "Управляйте показом окна перевода и сохранением истории.",
      "Дополнительные параметры",
      "Интерфейс",
      "Сохранение истории",
      "Копировать",
      "Искать в интернете"
    ]) {
      expect(translate(source, language), `${language}: ${source}`).not.toBe(source);
    }
  });

  it.each(INTERFACE_LANGUAGES.filter((language) => language !== "ru"))("localizes feedback and browser help strings in %s", async (language) => {
    await loadInterfaceLanguage(language);
    for (const source of [
      "Проверьте настройку «Показывать окно перевода». Если включена активация горячими клавишами, после выделения нужно нажать назначенную комбинацию. Обновите вкладку после установки или обновления расширения.",
      "Расширения не запускаются на внутренних страницах браузера, таких как",
      "Опишите проблему или предложение. При желании приложите скриншоты.",
      "Ваш email или контакт для ответа (необязательно)",
      "Контактная информация",
      "Изображения",
      "Отправить",
      "Отправка…",
      "Отправка станет доступна после настройки защищённого сервера.",
      "Спасибо! Сообщение отправлено.",
      "Не удалось отправить сообщение. Попробуйте позже.",
      "Можно приложить не более 10 скриншотов.",
      "Прикрепляйте изображения PNG, JPEG или WebP.",
      "Общий размер скриншотов не должен превышать 20 МБ.",
      "Перетащите файлы сюда",
      "Перетащите изображения сюда или нажмите, чтобы выбрать",
      "PNG, JPEG или WebP · до 10 файлов · всего до 20 МБ",
      "Удалить файл"
    ]) {
      expect(translate(source, language), `${language}: ${source}`).not.toBe(source);
    }
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
    localizeDom(document, "he");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("switches existing text and attributes between languages and preserves external text updates", async () => {
    await loadInterfaceLanguage("de");
    document.body.innerHTML = '<button aria-label="Открыть настройки">Настройки</button>';
    const button = document.querySelector("button")!;
    for (const language of ["en", "de", "ru", "en"] as const) {
      localizeDom(document, language);
      expect(button.textContent).toBe(translate("Настройки", language));
      expect(button.getAttribute("aria-label")).toBe(translate("Открыть настройки", language));
    }
    button.textContent = "История";
    localizeDom(document, "de");
    expect(button.textContent).toBe(translate("История", "de"));
  });
});
