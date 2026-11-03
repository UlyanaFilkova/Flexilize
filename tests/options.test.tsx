import {beforeEach, describe, expect, it, vi} from "vitest";
import {fireEvent, screen, waitFor, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {defaultSettings, SETTINGS_KEY} from "../src/settings";

describe("options page", () => {
  let browserMock: typeof import("./mocks/browser")["browserMock"];
  let storageData: Record<string, any>;

  beforeEach(async () => {
    vi.resetModules();
    const mock = await import("./mocks/browser");
    browserMock = mock.browserMock;
    storageData = mock.storageData;
    document.body.innerHTML = '<div id="root"></div>';
    storageData[SETTINGS_KEY] = structuredClone(defaultSettings);
    browserMock.runtime.sendMessage.mockResolvedValue({ok: true, records: []});
    history.replaceState(null, "", "#settings");
    await import("../src/options/options");
    await screen.findByRole("heading", {name: "Настройки"});
  });

  it("shows all navigation sections and the selected section title", async () => {
    expect(screen.getByRole("button", {name: /Все настройки/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /^Активация$/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /^Языки$/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /^Звук$/})).toBeTruthy();
    expect(screen.queryByRole("button", {name: /^Сохранение$/})).toBeNull();
    expect(screen.getByRole("button", {name: /^Расширенные настройки$/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /Как пользоваться/})).toBeTruthy();
    await userEvent.click(screen.getByRole("button", {name: /^Звук$/}));
    expect(screen.getByRole("heading", {name: "Звук"})).toBeTruthy();
  });

  it("opens settings sections from the overview", async () => {
    expect(screen.getByRole("heading", {name: "Переводчик, который работает по вашим правилам"})).toBeTruthy();
    expect(screen.getByRole("region", {name: "Разделы настроек"})).toBeTruthy();
    await userEvent.click(screen.getByRole("button", {name: /Языки.*Языки и интерфейс/}));
    expect(screen.getByRole("heading", {name: "Языки"})).toBeTruthy();
  });

  it("opens advanced settings from the overview and saves its options", async () => {
    const overview = screen.getByRole("region", {name: "Разделы настроек"});
    await userEvent.click(within(overview).getByRole("button", {name: /Расширенные настройки/}));
    expect(screen.getByRole("heading", {name: "Расширенные настройки"})).toBeTruthy();
    expect(location.hash).toBe("#settings/advanced");

    await userEvent.click(screen.getByRole("checkbox", {name: "Включить автоматическое сохранение"}));
    await waitFor(() => expect(storageData[SETTINGS_KEY].autoSaveTranslations).toBe(false));
    await userEvent.click(screen.getByRole("checkbox", {name: "Включить ротацию истории"}));
    await waitFor(() => expect(storageData[SETTINGS_KEY].historyRotationEnabled).toBe(false));
  });

  it("resets page scroll when switching settings tabs", async () => {
    const scrollYDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollY", {configurable: true, value: 480});

    try {
      await userEvent.click(screen.getByRole("button", {name: /^Активация$/}));
      expect(scrollTo).toHaveBeenCalledWith(0, 0);

      scrollTo.mockClear();
      Object.defineProperty(window, "scrollY", {configurable: true, value: 0});
      await userEvent.click(screen.getByRole("button", {name: /^Расширенные настройки$/}));
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      if (scrollYDescriptor) Object.defineProperty(window, "scrollY", scrollYDescriptor);
      else Reflect.deleteProperty(window, "scrollY");
    }
  });

  it("shows a detailed help section and links it to settings", async () => {
    await userEvent.click(screen.getByRole("button", {name: /Как пользоваться/}));
    expect(screen.getByRole("heading", {name: "Как пользоваться"})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Первый перевод — за несколько секунд"})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Читаете текст на иностранном языке"})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Частые вопросы"})).toBeTruthy();
    expect(document.querySelectorAll(".help-visual-example")).toHaveLength(4);
    expect(location.hash).toBe("#help");

    await userEvent.click(screen.getByRole("button", {name: "Настроить клавиши"}));
    expect(screen.getByRole("heading", {name: "Активация"})).toBeTruthy();
    expect(location.hash).toBe("#settings/general");
  });

  it("keeps dependent shortcut visible and disabled until activation", async () => {
    await userEvent.click(screen.getByRole("button", {name: /^Активация$/}));
    const shortcut = screen.getByRole("button", {name: "Ctrl + Shift + ]"});
    expect((shortcut as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("checkbox", {name: "Включить активацию горячими клавишами"}));
    await waitFor(() => expect((shortcut as HTMLButtonElement).disabled).toBe(false));
    expect(storageData[SETTINGS_KEY].hotkeyActivationEnabled).toBe(true);
  });

  it("records a new translator shortcut", async () => {
    await userEvent.click(screen.getByRole("button", {name: /^Активация$/}));
    const button = screen.getByRole("button", {name: "Ctrl + Shift + '"});
    await userEvent.click(button);
    fireEvent.keyDown(button, {key: "T", code: "KeyT", ctrlKey: true, altKey: true});
    await waitFor(() => expect(storageData[SETTINGS_KEY].translatorShortcut.code).toBe("KeyT"));
    expect(button.textContent).toBe("Ctrl + Alt + T");
  });

  it("separates selection and standalone translator language settings", async () => {
    await userEvent.click(screen.getByRole("button", {name: /^Языки$/}));
    expect(screen.getByRole("heading", {name: "Перевод выделенного текста"})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Переводчик"})).toBeTruthy();
    expect(screen.queryByRole("heading", {name: "Языки и интерфейс"})).toBeNull();
    const selectionSettings = screen.getByRole("region", {name: "Перевод выделенного текста"});
    expect(within(selectionSettings).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Язык перевода выделенного текста"
    ]);
    await userEvent.selectOptions(screen.getByLabelText("Исходный язык переводчика"), "de");
    await userEvent.selectOptions(screen.getByLabelText("Язык перевода в переводчике"), "fr");
    await waitFor(() => expect(storageData[SETTINGS_KEY]).toMatchObject({translatorSourceLanguage: "de", translatorTargetLanguage: "fr"}));
  });

  it("can hide the selection translation window", async () => {
    await userEvent.click(screen.getByRole("button", {name: /^Расширенные настройки$/}));
    expect(screen.getByRole("region", {name: "Перевод"}).querySelectorAll(".setting-row").length).toBe(1);
    expect(screen.getByRole("region", {name: "Настройки сохранения"}).querySelectorAll(".setting-row").length).toBe(2);
    await userEvent.click(screen.getByRole("checkbox", {name: "Показывать окно перевода"}));
    await waitFor(() => expect(storageData[SETTINGS_KEY].showSelectionTranslationModal).toBe(false));
  });

  it("controls transcription, speech and dependent speed", async () => {
    await userEvent.click(screen.getByRole("button", {name: /^Звук$/}));
    const speech = screen.getByRole("checkbox", {name: "Включить озвучку"});
    const increase = screen.getByRole("button", {name: "Увеличить скорость озвучки"});
    await userEvent.click(speech);
    expect((increase as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(speech);
    await userEvent.click(increase);
    await waitFor(() => expect(storageData[SETTINGS_KEY].speechRate).toBe(1.1));
  });
});
