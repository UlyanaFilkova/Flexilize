import {describe, expect, it} from "vitest";
import {INTERFACE_LANGUAGES, loadInterfaceLanguage} from "../src/i18n";
import {helpExamples} from "../src/options/help-examples";

describe("localized help examples", () => {
  it.each(INTERFACE_LANGUAGES)("uses foreign-to-native reading examples and native-to-foreign writing for %s", async (language) => {
    await loadInterfaceLanguage(language);
    const example = helpExamples(language);
    expect(example.targetLanguage).toBe(language);
    expect(example.sourceLanguage).toBe(language === "en" ? "es" : "en");
    expect(example.sourceLanguage).not.toBe(example.targetLanguage);
    expect(example.directionCodes).toBe(`${example.sourceLanguage.toUpperCase()} → ${language.toUpperCase()}`);
    for (const sample of [example.context, example.selection, example.email, example.speech, example.history]) {
      expect(sample.source).toBeTruthy();
      expect(sample.translation).toBeTruthy();
      expect(sample.translation).not.toMatch(/^ui\./);
    }
    expect(example.email.sourceLanguage).toBe(language);
    expect(example.email.targetLanguage).toBe(example.sourceLanguage);
    expect(example.email.targetDirection).toBe("ltr");
    expect(example.email.sourceDirection).toBe(example.targetDirection);
    expect(example.email.prefix).toBeTruthy();
    expect(example.email.suffix).toBeTruthy();
    expect(example.email.prefix + example.email.translation + example.email.suffix).toBe(example.email.sentence);
    expect(example.email.sentence).not.toMatch(/[{}]/);
    expect(example.targetDirection).toBe(["ar", "fa", "he"].includes(language) ? "rtl" : "ltr");
  });

  it("uses Spanish originals with English translations for English speakers", () => {
    const example = helpExamples("en");
    expect(example.selection.source).toBe("el contexto importa");
    expect(example.selection.translation).toBe("context matters");
    expect(example.email.source).toBe("updated");
    expect(example.email.translation).toBe("actualizado");
    expect(example.email.sentence).toBe("¿Podrías enviar el documento actualizado?");
    expect(example.speech.source).toBe("Buenos días");
    expect(example.speech.translation).toBe("Good morning");
    expect(example.history.source).toBe("averiguar");
  });

  it("uses English originals with Russian translations for Russian speakers", () => {
    const example = helpExamples("ru");
    expect(example.email.source).toBe("обновленный");
    expect(example.email.translation).toBe("updated");
    expect(example.email.sentence).toBe("Could you send the updated document?");
    expect(example.selection.translation).toBe("контекст имеет значение");
  });
});
