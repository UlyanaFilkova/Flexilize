import {describe, expect, it} from "vitest";
import {INTERFACE_LANGUAGES, loadInterfaceLanguage, localizeDom, normalizeInterfaceLanguage, translate} from "../src/i18n";

describe("interface localization", () => {
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
});
