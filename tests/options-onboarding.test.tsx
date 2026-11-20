import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {defaultSettings, ONBOARDING_COMPLETED_KEY, SETTINGS_KEY} from "../src/settings";

describe("onboarding native language", () => {
  let storageData: Record<string, any>;
  let observers: MutationObserver[];
  const NativeMutationObserver = globalThis.MutationObserver;

  afterEach(() => {
    observers.forEach((observer) => observer.disconnect());
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    vi.resetModules();
    observers = [];
    vi.stubGlobal("MutationObserver", class extends NativeMutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        observers.push(this);
      }
    });
    const mock = await import("./mocks/browser");
    storageData = mock.storageData;
    document.body.innerHTML = '<div id="root"></div>';
    storageData[SETTINGS_KEY] = {...structuredClone(defaultSettings), interfaceLanguage: "ru", targetLanguage: "ru"};
    mock.browserMock.runtime.sendMessage.mockResolvedValue({ok: true, records: []});
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    history.replaceState(null, "", "#welcome");
    await import("../src/options/options");
    await screen.findByRole("heading", {name: "Быстрая настройка"});
    await waitFor(() => expect((document.querySelector("#onboarding-language") as HTMLSelectElement).disabled).toBe(false));
  });

  const selectLanguage = async (value: string, heading: string) => {
    const originalOrder = [...(document.querySelector("#onboarding-language") as HTMLSelectElement).options].map((option) => option.value);
    await userEvent.selectOptions(document.querySelector("#onboarding-language") as HTMLSelectElement, value);
    await screen.findByRole("heading", {name: heading});
    await waitFor(() => {
      const select = document.querySelector("#onboarding-language") as HTMLSelectElement;
      expect(select.disabled).toBe(false);
      expect(select.value).toBe(value);
      expect([...select.options].map((option) => option.value)).toEqual(originalOrder);
    });
  };

  it("immediately saves both languages, switches the UI repeatedly, and preserves activation choices", async () => {
    await userEvent.click(screen.getByRole("checkbox", {name: "Включить кнопку рядом с выделением"}));
    await selectLanguage("en", "Quick setup");
    expect(storageData[SETTINGS_KEY]).toMatchObject({interfaceLanguage: "en", targetLanguage: "en", selectionButtonEnabled: true, autoActivationEnabled: false});
    expect(screen.getByRole("button", {name: "Start"})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Button next to selection"})).toBeTruthy();
    for (const description of [
      "The translation appears as soon as you select text.",
      "Click the button that appears next to the selected text.",
      "Select text and press the assigned keyboard shortcut.",
      "Right-click the selected text and choose translation."
    ]) expect(screen.getByText(description)).toBeTruthy();
    expect(screen.queryByText(/Enabling this turns off/)).toBeNull();
    expect(document.documentElement.lang).toBe("en");
    expect(storageData[ONBOARDING_COMPLETED_KEY]).not.toBe(true);

    await selectLanguage("de", "Schnelleinrichtung");
    expect(storageData[SETTINGS_KEY]).toMatchObject({interfaceLanguage: "de", targetLanguage: "de", selectionButtonEnabled: true});
    expect(document.documentElement.lang).toBe("de");

    await selectLanguage("ru", "Быстрая настройка");
    expect(screen.getByRole("button", {name: "Начать"})).toBeTruthy();
    expect(document.documentElement.lang).toBe("ru");
    await userEvent.click(screen.getByRole("button", {name: "Начать"}));
    await waitFor(() => expect(storageData[ONBOARDING_COMPLETED_KEY]).toBe(true));
    expect(storageData[SETTINGS_KEY]).toMatchObject({interfaceLanguage: "ru", targetLanguage: "ru", selectionButtonEnabled: true});
  });

  it("offers interface languages with native names and maps Filipino to its translation code", async () => {
    const select = document.querySelector("#onboarding-language") as HTMLSelectElement;
    expect(select.options).toHaveLength(36);
    expect([...select.options].find((option) => option.value === "de")?.textContent).toBe("Deutsch");
    expect([...select.options].find((option) => option.value === "en")?.textContent).toBe("English");
    expect([...select.options].some((option) => option.value === "uk")).toBe(false);
    await selectLanguage("fil", "Mabilis na pag-setup");
    expect(storageData[SETTINGS_KEY]).toMatchObject({interfaceLanguage: "fil", targetLanguage: "tl"});
    await selectLanguage("en", "Quick setup");
    expect(storageData[SETTINGS_KEY]).toMatchObject({interfaceLanguage: "en", targetLanguage: "en"});
  });
});
