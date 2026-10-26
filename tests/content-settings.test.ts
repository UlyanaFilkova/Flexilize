import {describe, expect, it, vi} from "vitest";
import {fireEvent, waitFor} from "@testing-library/dom";
import {defaultSettings, SETTINGS_KEY} from "../src/settings";

describe("selection translator settings", () => {
  it("unlocks Web Audio on the first speech button click", async () => {
    vi.resetModules();
    const {browserMock, storageData} = await import("./mocks/browser");
    storageData[SETTINGS_KEY] = structuredClone(defaultSettings);

    const speechResponse = {
      ok: true as const,
      chunks: [{audio: "", end: 5, mimeType: "audio/mpeg", start: 0}]
    };
    let finishSpeechRequest!: (value: typeof speechResponse) => void;
    const speechRequest = new Promise<typeof speechResponse>((resolve) => {
      finishSpeechRequest = resolve;
    });
    browserMock.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "translate-preview") return {ok: true, translation: "Привет", sourceLanguage: "en"};
      if (message.type === "get-transcription") return {ok: true, transcription: null};
      if (message.type === "translate-selection") return {
        ok: true, translation: "Привет", translations: ["Привет"], contextTranslation: null,
        transcription: null, sourceLanguage: "en", saved: true
      };
      if (message.type === "get-speech-audio") return speechRequest;
      return {ok: true};
    });

    const start = vi.fn();
    const resume = vi.fn(async function (this: {state: AudioContextState}) {
      this.state = "running";
    });
    class MockAudioContext {
      state: AudioContextState = "suspended";
      sampleRate = 48_000;
      currentTime = 0;
      destination = {};
      resume = resume;
      createBuffer = vi.fn(() => ({}));
      decodeAudioData = vi.fn(async () => ({duration: 1}));
      createBufferSource = vi.fn(() => ({
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
        playbackRate: {value: 1},
        start
      }));
    }
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("speechSynthesis", {
      addEventListener: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => []), pending: false,
      resume: vi.fn(), speak: vi.fn(), speaking: false
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
    const speakButton = await waitFor(() => {
      const button = document.querySelector("#context-translator-extension-host")?.shadowRoot
        ?.querySelector<HTMLButtonElement>(".speak");
      expect(button?.disabled).toBe(false);
      return button!;
    });

    fireEvent.click(speakButton);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(0);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({type: "get-speech-audio"}));
    finishSpeechRequest(speechResponse);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });

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
