import {describe, expect, it, vi} from "vitest";
import {fireEvent, waitFor} from "@testing-library/dom";
import {defaultSettings, SETTINGS_KEY} from "../src/settings";

describe("selection translator settings", () => {
  it("saves a selection in the background without showing the modal", async () => {
    vi.resetModules();
    const {browserMock, storageData} = await import("./mocks/browser");
    storageData[SETTINGS_KEY] = {
      ...structuredClone(defaultSettings),
      autoSaveTranslations: false,
      showSelectionTranslationModal: false
    };
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true, translation: "Привет", sourceLanguage: "en", saved: true
    });
    const input = document.createElement("textarea");
    input.value = "Hello!";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, 5);
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, toJSON: () => ({})
    });

    await import("../src/content");
    await waitFor(() => expect(document.documentElement.hasAttribute("data-context-translator-instance")).toBe(true));
    fireEvent.mouseUp(input);

    await waitFor(() => expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "translate-selection",
      payload: expect.objectContaining({text: "Hello", save: true})
    })));
    expect(document.querySelector("#context-translator-extension-host")).toBeNull();
    expect(browserMock.runtime.sendMessage.mock.calls.map(([message]) => message.type)).not.toContain("translate-preview");
  });

  it("requires the configured hotkey and omits disabled speech and transcription", async () => {
    vi.resetModules();
    const {browserMock, storageData} = await import("./mocks/browser");
    storageData[SETTINGS_KEY] = {
      ...structuredClone(defaultSettings),
      hotkeyActivationEnabled: true,
      speechEnabled: false,
      transcriptionEnabled: false
    };
    browserMock.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "translate-preview") return {ok: true, translation: "Привет", sourceLanguage: "en"};
      if (message.type === "translate-selection") return {
        ok: true, translation: "Привет", translations: ["Привет"], contextTranslation: "Привет!",
        transcription: null, sourceLanguage: "en", saved: true
      };
      return {ok: true};
    });
    const originalAttachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init) {
      return originalAttachShadow.call(this, {...init, mode: "open"});
    });
    const input = document.createElement("textarea");
    input.value = "Hello!";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, 5);
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, toJSON: () => ({})
    });
    await import("../src/content");
    await waitFor(() => expect(document.documentElement.hasAttribute("data-context-translator-instance")).toBe(true));

    fireEvent.mouseUp(input);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector("#context-translator-extension-host")).toBeNull();

    fireEvent.keyDown(input, {key: "]", code: "BracketRight", ctrlKey: true, shiftKey: true});
    const host = await waitFor(() => {
      const element = document.querySelector("#context-translator-extension-host") as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    await waitFor(() => expect(host.shadowRoot?.querySelector(".translation")?.textContent).toContain("Привет"));
    expect(host.shadowRoot?.querySelector(".speak")).toBeNull();
    expect(host.shadowRoot?.querySelector(".transcription")).toBeNull();
    expect(host.shadowRoot?.querySelector(".speech-progress")).toBeNull();
    expect(browserMock.runtime.sendMessage.mock.calls.map(([message]) => message.type)).not.toContain("get-transcription");
    expect(browserMock.runtime.sendMessage.mock.calls.map(([message]) => message.type)).not.toContain("get-speech-audio");
  });
});
