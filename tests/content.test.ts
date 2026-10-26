import {describe, expect, it, vi} from "vitest";
import {fireEvent, waitFor} from "@testing-library/dom";
import {defaultSettings, SETTINGS_KEY} from "../src/settings";

describe("standalone translator content UI", () => {
  it("opens, translates, swaps, copies, resizes and closes", async () => {
    vi.resetModules();
    const {browserMock, storageData} = await import("./mocks/browser");
    document.body.innerHTML = "<main>Page content</main>";
    storageData[SETTINGS_KEY] = {...structuredClone(defaultSettings), interfaceLanguage: "en"};
    browserMock.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "translate-preview") {
        return {ok: true, translation: message.payload.text === "Hello" ? "Привет" : `Перевод: ${message.payload.text}`, sourceLanguage: "en"};
      }
      if (message.type === "get-transcription") return {ok: true, transcription: "/həˈləʊ/"};
      if (message.type === "translate-selection") return {
        ok: true, translation: "Добрый день", translations: ["Добрый день", "Здравствуйте"],
        contextTranslation: "Привет, мир!", transcription: "/həˈləʊ/", sourceLanguage: "en", saved: true
      };
      return {ok: true};
    });
    const originalAttachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init) {
      return originalAttachShadow.call(this, {...init, mode: "open"});
    });
    await import("../src/content");
    await waitFor(() => expect(document.documentElement.hasAttribute("data-context-translator-instance")).toBe(true));
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "\"", code: "Quote", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }));
    const host = await waitFor(() => {
      const element = document.querySelector("#context-translator-input-host") as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    const shadow = host.shadowRoot!;
    expect(shadow.querySelector(".translator")?.getAttribute("aria-label")).toBe("Translator");
    expect(shadow.querySelector(".translator-input")?.getAttribute("placeholder")).toBe("Enter text");
    expect(shadow.querySelector(".translator-shortcut-hint")?.textContent).toBe("Ctrl + Shift + '");
    const input = shadow.querySelector(".translator-input") as HTMLTextAreaElement;
    expect((shadow.querySelector(".source-language") as HTMLSelectElement).value).toBe(defaultSettings.translatorSourceLanguage);
    expect((shadow.querySelector(".target-language") as HTMLSelectElement).value).toBe(defaultSettings.translatorTargetLanguage);

    fireEvent.input(input, {target: {value: "Hello"}});
    await waitFor(() => expect(shadow.querySelector(".translator-output")?.textContent).toBe("Привет"), {timeout: 1500});

    input.focus();
    input.setSelectionRange(1, 3);
    fireEvent.click(shadow.querySelector(".swap")!);
    expect(shadow.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    expect((shadow.querySelector(".source-language") as HTMLSelectElement).value).toBe(defaultSettings.translatorTargetLanguage);

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText}});
    fireEvent.click(shadow.querySelector(".copy-input")!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hello"));
    await waitFor(() => expect(shadow.querySelector(".copy-input")?.textContent).toBe("✓"));
    const outputText = shadow.querySelector(".translator-output")?.textContent;
    fireEvent.click(shadow.querySelector(".copy-output")!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(outputText));

    Object.defineProperty(input, "scrollHeight", {configurable: true, value: 400});
    fireEvent.input(input, {target: {value: "long text"}});
    expect((shadow.querySelector(".panes") as HTMLElement).style.height).toBe("400px");
    Object.defineProperty(input, "scrollHeight", {configurable: true, value: 5000});
    fireEvent.input(input);
    expect(Number.parseInt((shadow.querySelector(".panes") as HTMLElement).style.height)).toBeLessThanOrEqual(520);

    class TestPointerEvent extends MouseEvent { pointerId = 1; }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    const header = shadow.querySelector("header") as HTMLElement;
    const dialog = shadow.querySelector(".translator") as HTMLElement;
    header.setPointerCapture = vi.fn();
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 100, left: 100, top: 100, right: 880, bottom: 500, width: 780, height: 400, toJSON: () => ({})
    });
    fireEvent.pointerDown(header, {button: 0, clientX: 200, clientY: 150, pointerId: 1});
    fireEvent.pointerMove(header, {clientX: 240, clientY: 180, pointerId: 1});
    fireEvent.pointerUp(header, {pointerId: 1});
    expect(dialog.style.transform).toBe("translate(40px, 30px)");

    fireEvent.keyDown(input, {key: "Escape"});
    expect(document.querySelector("#context-translator-input-host")).toBeNull();

    const pageInput = document.createElement("textarea");
    pageInput.value = "Hello, world!";
    document.body.append(pageInput);
    pageInput.focus();
    pageInput.setSelectionRange(0, 5);
    vi.spyOn(pageInput, "getBoundingClientRect").mockReturnValue({
      x: 20, y: 20, left: 20, top: 20, right: 220, bottom: 60, width: 200, height: 40, toJSON: () => ({})
    });
    fireEvent.mouseUp(pageInput);
    const selectionHost = await waitFor(() => {
      const element = document.querySelector("#context-translator-extension-host") as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    }, {timeout: 1500});
    expect(selectionHost.shadowRoot?.querySelector(".card")?.getAttribute("aria-label")).toBe("Selected text translation");
    await waitFor(() => expect(selectionHost.shadowRoot?.querySelectorAll(".translation-option")).toHaveLength(3));
    expect([...selectionHost.shadowRoot!.querySelectorAll(".translation-option")].map((item) => item.textContent))
      .toEqual(["Привет", "Добрый день", "Здравствуйте"]);
    expect(selectionHost.shadowRoot?.querySelector(".transcription")?.textContent).toBe("/həˈləʊ/");
    expect(browserMock.runtime.sendMessage.mock.calls.map(([message]) => message.type)).toContain("translate-selection");
  }, 5000);
});
