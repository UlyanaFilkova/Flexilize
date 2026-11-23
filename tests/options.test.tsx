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
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    history.replaceState(null, "", "#settings");
    await import("../src/options/options");
    await screen.findByRole("heading", {name: "Настройки"});
  });

  it("shows all navigation sections and the selected section title", async () => {
    expect(screen.getByRole("button", {name: /Все настройки/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /^Активация$/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /^Языки$/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /^Звук$/})).toBeTruthy();
    const saving = screen.getByRole("button", {name: /^Сохранение$/});
    expect(screen.getByRole("button", {name: /^Звук$/}).nextElementSibling).toBe(saving);
    expect(screen.getByRole("button", {name: /^Расширенные настройки$/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /Как пользоваться/})).toBeTruthy();
    await userEvent.click(screen.getByRole("button", {name: /^Звук$/}));
    expect(screen.getByRole("heading", {name: "Звук"})).toBeTruthy();
  });

  it("keeps the banner and scrolls to settings sections on the same page", async () => {
    expect(screen.getByRole("heading", {name: "Context Translator"})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Активация"})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Языки"})).toBeTruthy();
    await userEvent.click(screen.getByRole("button", {name: /^Языки$/}));
    expect(screen.getByRole("heading", {name: "Языки"})).toBeTruthy();
    expect(location.hash).toBe("#settings/translation");
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({behavior: "smooth"})));
  });

  it("opens saving settings from navigation and saves its options", async () => {
    await userEvent.click(screen.getByRole("button", {name: /^Сохранение$/}));
    expect(screen.getByRole("heading", {name: "Сохранение"})).toBeTruthy();
    expect(location.hash).toBe("#settings/saving");
    const section = document.getElementById("settings-saving")!;
    expect(within(section).getByRole("spinbutton", {name: "Лимит записей в истории"})).toBeTruthy();
    expect(section.previousElementSibling?.id).toBe("settings-sound");
    expect(within(section).queryByRole("checkbox", {name: "Показывать окно перевода"})).toBeNull();

    await userEvent.click(screen.getByRole("checkbox", {name: "Включить автоматическое сохранение"}));
    await waitFor(() => expect(storageData[SETTINGS_KEY].autoSaveTranslations).toBe(false));
    await userEvent.click(screen.getByRole("checkbox", {name: "Включить ротацию истории"}));
    await waitFor(() => expect(storageData[SETTINGS_KEY].historyRotationEnabled).toBe(false));
  });

  it("scrolls to section anchors and returns all settings to the page top", async () => {
    const scrollYDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    const scrollTo = vi.mocked(window.scrollTo);
    Object.defineProperty(window, "scrollY", {configurable: true, value: 480});

    try {
      await userEvent.click(screen.getByRole("button", {name: /^Активация$/}));
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({behavior: "smooth"})));

      scrollTo.mockClear();
      Object.defineProperty(window, "scrollY", {configurable: true, value: 0});
      await userEvent.click(screen.getByRole("button", {name: /^Все настройки$/}));
      expect(scrollTo).toHaveBeenCalledWith({top: 0, behavior: "smooth"});
    } finally {
      if (scrollYDescriptor) Object.defineProperty(window, "scrollY", scrollYDescriptor);
      else Reflect.deleteProperty(window, "scrollY");
    }
  });

  it("automatically saves a custom history limit and rejects values outside the allowed range", async () => {
    const input = await waitFor(() => {
      const field = screen.getByRole("spinbutton", {name: "Лимит записей в истории"}) as HTMLInputElement;
      expect(field.disabled).toBe(false);
      return field;
    });
    for (const value of ["", "0", "5001", "1.5"]) {
      fireEvent.change(input, {target: {value}});
      expect(storageData[SETTINGS_KEY].historyRecordLimit).toBe(5000);
      expect(input.checkValidity()).toBe(false);
    }
    await userEvent.clear(input);
    await userEvent.type(input, "250");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("250");
    expect(within(input.closest(".history-limit-row")!).queryByRole("button")).toBeNull();
    await waitFor(() => expect(storageData[SETTINGS_KEY].historyRecordLimit).toBe(250));
    expect(screen.getByText(/При выключенной ротации.*250/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", {name: /Как пользоваться/}));
    expect(await screen.findByText(/— при лимите в 250 записей/)).toBeTruthy();
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
    const translationSection = document.getElementById("settings-translation")!;
    expect(within(translationSection).getByRole("heading", {name: "Переводчик"})).toBeTruthy();
    expect(within(translationSection).getByRole("heading", {name: "Интерфейс"})).toBeTruthy();
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
    expect(location.hash).toBe("#settings/advanced");
    const advanced = document.getElementById("settings-advanced")!;
    expect(within(advanced).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(advanced).queryByRole("region", {name: "Настройки сохранения"})).toBeNull();
    expect(within(advanced).queryByRole("spinbutton")).toBeNull();
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
