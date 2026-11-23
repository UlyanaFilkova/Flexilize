import {beforeEach, describe, expect, it, vi} from "vitest";
import {act, fireEvent, screen, waitFor, within} from "@testing-library/react";
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
    expect(screen.getByRole("heading", {name: "Выделите фразу — и сразу увидите перевод"})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Читайте текст на иностранном языке"})).toBeTruthy();
    const reading = document.getElementById("help-reading")!;
    expect(reading.classList.contains("help-reading-hero")).toBe(true);
    expect(within(reading).getByRole("heading", {name: "Выделите фразу — и сразу увидите перевод"})).toBeTruthy();
    expect(reading.querySelectorAll(".help-selection-example")).toHaveLength(1);
    expect(reading.querySelectorAll(".help-card, .help-callout")).toHaveLength(0);
    expect(reading.nextElementSibling?.querySelectorAll(".help-card")).toHaveLength(2);
    expect(reading.nextElementSibling?.nextElementSibling?.classList.contains("help-callout")).toBe(true);
    expect(screen.getByRole("heading", {name: "Частые вопросы"})).toBeTruthy();
    expect(document.querySelectorAll(".help-visual-example")).toHaveLength(4);
    expect(document.querySelectorAll(".help-task-hero")).toHaveLength(6);
    expect(document.querySelectorAll(".help-task-hero .help-visual-example")).toHaveLength(4);
    expect(document.querySelectorAll(".help-task-hero .help-card-grid, .help-task-hero .workflow-card, .help-task-hero .vocabulary-layout, .help-task-hero .format-guide")).toHaveLength(0);
    expect(location.hash).toBe("#help");

    await userEvent.click(screen.getByRole("button", {name: "Настроить активацию перевода"}));
    expect(screen.getByRole("heading", {name: "Активация"})).toBeTruthy();
    expect(location.hash).toBe("#settings/general");
  });

  it.each([
    ["настройках", "translator-shortcuts", "Активация"],
    ["языки по умолчанию", "translator-languages", "Языки"],
    ["Настроить сохранение текста", "translator-text", "Активация"]
  ])("opens the exact translator settings group from the %s help link", async (name, detail, section) => {
    const anchorId = `settings-${detail}`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return {top: this.id === anchorId ? 500 : 0, height: 0} as DOMRect;
    });
    await userEvent.click(screen.getByRole("button", {name: /Как пользоваться/}));
    const link = screen.getByRole(detail === "translator-text" ? "button" : "link", {name});
    if (detail !== "translator-text") expect(link.getAttribute("href")).toBe(`#settings/${detail}`);
    vi.mocked(window.scrollTo).mockClear();
    await userEvent.click(link);
    expect(location.hash).toBe(`#settings/${detail}`);
    expect(screen.getByRole("button", {name: section}).classList.contains("active")).toBe(true);
    expect(document.getElementById(anchorId)).toBeTruthy();
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({top: 516, behavior: "smooth"}));
  });

  it("starts help demonstrations only when scrolled into view and stops them outside the viewport", async () => {
    const observers: Array<{callback: IntersectionObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn>}> = [];
    vi.stubGlobal("IntersectionObserver", class {
      target?: Element;
      disconnect = vi.fn();
      constructor(public callback: IntersectionObserverCallback) { observers.push(this); }
      observe(target: Element) { this.target = target; }
    });
    const before = structuredClone(storageData);
    await userEvent.click(screen.getByRole("button", {name: /Как пользоваться/}));
    expect(document.querySelectorAll(".help-visual-example")).toHaveLength(4);
    expect(document.querySelectorAll(".help-demo-playing")).toHaveLength(0);
    expect(observers).toHaveLength(2);
    expect(document.querySelector(".visual-translator-input")?.textContent).toBe("обновленный");
    expect(document.querySelector(".visual-translator-input")?.getAttribute("lang")).toBe("ru");
    expect(document.querySelector(".visual-translator-panes > div:last-child p")?.textContent).toBe("updated");
    expect(document.querySelector(".visual-page-draft")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Could you send the updated document?");
    const visibility = (index: number, ratio: number) => act(() => observers[index].callback([
      {target: observers[index].target, isIntersecting: ratio > 0, intersectionRatio: ratio} as IntersectionObserverEntry
    ], {} as IntersectionObserver));
    visibility(0, 0.1);
    expect(document.querySelectorAll(".help-demo-playing")).toHaveLength(0);
    visibility(0, 0.5);
    expect(observers[0].target!.classList.contains("help-demo-playing")).toBe(true);
    expect(observers[1].target!.classList.contains("help-demo-playing")).toBe(false);
    visibility(0, 0);
    visibility(1, 0.5);
    expect(observers[0].target!.classList.contains("help-demo-playing")).toBe(false);
    expect(observers[1].target!.classList.contains("help-demo-playing")).toBe(true);
    visibility(0, 0.5);
    expect(document.querySelectorAll(".help-demo-playing")).toHaveLength(2);
    for (const selector of [".help-speech-example", ".help-history-example"]) {
      expect(document.querySelector(selector)!.classList.contains("help-demo-playing")).toBe(false);
    }
    expect(document.querySelectorAll(".help-visual-example button")).toHaveLength(0);
    expect(storageData).toEqual(before);
    await userEvent.click(screen.getByRole("button", {name: /^Все настройки$/}));
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("keeps help demonstrations static when reduced motion is requested", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()})));
    await userEvent.click(screen.getByRole("button", {name: /Как пользоваться/}));
    expect(document.querySelectorAll(".help-visual-example")).toHaveLength(4);
    expect(document.querySelectorAll(".help-demo-playing")).toHaveLength(0);
    expect(screen.queryByRole("button", {name: "Посмотреть демонстрацию"})).toBeNull();
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
