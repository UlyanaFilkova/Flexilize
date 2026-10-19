import {describe, expect, it} from "vitest";
import {
  defaultSettings,
  formatShortcut,
  getExtensionSettings,
  matchesShortcut,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  normalizeSettings,
  normalizeSpeechRate,
  saveExtensionSettings,
  SETTINGS_KEY,
  shortcutFromKeyboardEvent
} from "../src/settings";
import {storageData} from "./mocks/browser";

describe("settings", () => {
  it("returns every default for empty or invalid storage", () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings);
    expect(normalizeSettings("bad")).toEqual(defaultSettings);
  });

  it("normalizes booleans, languages, rates and both shortcuts", () => {
    const normalized = normalizeSettings({
      autoSaveTranslations: false,
      historyRotationEnabled: false,
      hotkeyActivationEnabled: true,
      speechEnabled: false,
      transcriptionEnabled: false,
      speechRate: 1.26,
      targetLanguage: "de",
      translatorSourceLanguage: "fr",
      translatorTargetLanguage: "es",
      activationShortcut: {ctrl: true, alt: false, shift: false, meta: false, code: "KeyK", key: "K"},
      translatorShortcut: {ctrl: false, alt: true, shift: true, meta: false, code: "KeyT", key: "T"}
    });
    expect(normalized).toMatchObject({
      autoSaveTranslations: false,
      historyRotationEnabled: false,
      hotkeyActivationEnabled: true,
      speechEnabled: false,
      transcriptionEnabled: false,
      speechRate: 1.3,
      targetLanguage: "de",
      translatorSourceLanguage: "fr",
      translatorTargetLanguage: "es"
    });
    expect(formatShortcut(normalized.activationShortcut)).toBe("Ctrl + K");
    expect(formatShortcut(normalized.translatorShortcut)).toBe("Alt + Shift + T");
  });

  it("rejects invalid languages and modifierless shortcuts", () => {
    const normalized = normalizeSettings({
      targetLanguage: "xx",
      translatorSourceLanguage: "xx",
      translatorTargetLanguage: 3,
      activationShortcut: {alt: false, code: "KeyA", ctrl: false, key: "A", meta: false, shift: false},
      translatorShortcut: {alt: false, code: "KeyB", ctrl: false, key: "B", meta: false, shift: false}
    });
    expect(normalized.targetLanguage).toBe(defaultSettings.targetLanguage);
    expect(normalized.translatorSourceLanguage).toBe(defaultSettings.translatorSourceLanguage);
    expect(normalized.activationShortcut).toEqual(defaultSettings.activationShortcut);
    expect(normalized.translatorShortcut).toEqual(defaultSettings.translatorShortcut);
  });

  it.each([
    [Number.NaN, 1], [Infinity, 1], [0, MIN_SPEECH_RATE], [99, MAX_SPEECH_RATE], [0.74, 0.7], [0.76, 0.8]
  ])("normalizes speech rate %s to %s", (input, expected) => {
    expect(normalizeSpeechRate(input)).toBe(expected);
  });

  it("loads and saves normalized settings", async () => {
    storageData[SETTINGS_KEY] = {speechRate: 1.44, targetLanguage: "uk"};
    expect(await getExtensionSettings()).toMatchObject({speechRate: 1.4, targetLanguage: "uk"});
    const saved = await saveExtensionSettings({...defaultSettings, speechRate: 7});
    expect(saved.speechRate).toBe(MAX_SPEECH_RATE);
    expect(storageData[SETTINGS_KEY]).toEqual(saved);
  });
});

describe("keyboard shortcuts", () => {
  function keyboard(init: KeyboardEventInit) {
    return new KeyboardEvent("keydown", init);
  }

  it("creates readable shortcuts for letters, digits and punctuation", () => {
    expect(shortcutFromKeyboardEvent(keyboard({key: "a", code: "KeyA", ctrlKey: true})))
      .toEqual({alt: false, code: "KeyA", ctrl: true, key: "A", meta: false, shift: false});
    expect(shortcutFromKeyboardEvent(keyboard({key: "!", code: "Digit1", shiftKey: true}))?.key).toBe("1");
    expect(shortcutFromKeyboardEvent(keyboard({key: "\"", code: "Quote", shiftKey: true}))?.key).toBe("'");
    expect(shortcutFromKeyboardEvent(keyboard({key: "Control", code: "ControlLeft"}))).toBeNull();
  });

  it("matches code and every modifier exactly", () => {
    const shortcut = defaultSettings.translatorShortcut;
    expect(matchesShortcut(keyboard({code: "Quote", ctrlKey: true, shiftKey: true}), shortcut)).toBe(true);
    expect(matchesShortcut(keyboard({code: "Quote", ctrlKey: true}), shortcut)).toBe(false);
    expect(matchesShortcut(keyboard({code: "KeyQ", ctrlKey: true, shiftKey: true}), shortcut)).toBe(false);
  });
});
