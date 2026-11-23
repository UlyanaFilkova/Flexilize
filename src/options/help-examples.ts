import {getActiveLanguage, translate, type InterfaceLanguage} from "../i18n";

export function helpExamples(language: InterfaceLanguage = getActiveLanguage()) {
  const sourceLanguage = language === "en" ? "es" : "en";
  const spanish = sourceLanguage === "es";
  const targetDirection = ["ar", "fa", "he"].includes(language) ? "rtl" : "ltr";
  const displayNames = new Intl.DisplayNames([language], {type: "language"});
  const name = (code: string) => {
    const value = displayNames.of(code) || code;
    return value.charAt(0).toLocaleUpperCase(language) + value.slice(1);
  };
  const emailTemplate = spanish ? "¿Podrías enviar el documento {updated}?" : "Could you send the {updated} document?";
  const [emailPrefix, emailSuffix] = emailTemplate.split("{updated}");
  const updated = translate("ui.help-updated-word", language);
  const foreignWord = spanish ? "actualizado" : "updated";
  return {
    sourceLanguage,
    targetLanguage: language,
    targetDirection,
    sourceName: name(sourceLanguage),
    targetName: name(language),
    directionLabel: `${name(sourceLanguage)} → ${name(language)}`,
    directionCodes: `${sourceLanguage.toUpperCase()} → ${language.toUpperCase()}`,
    context: {source: spanish ? "Contexto" : "Context", translation: translate("Контекст", language), after: spanish ? " puede cambiar el significado." : " can change meaning."},
    selection: {
      source: spanish ? "el contexto importa" : "context matters",
      translation: translate("ui.context-matters", language),
      transcription: spanish ? "/el konˈteksto imˈpoɾta/" : "/ˈkɒntekst ˈmætəz/",
      title: spanish ? "Por qué importa el contexto" : "Why context matters",
      before: spanish ? "Las palabras se entienden mejor cuando " : "Words become clearer when ",
      after: spanish ? " en una frase real." : " in a real sentence."
    },
    email: {
      sourceLanguage: language,
      targetLanguage: sourceLanguage,
      sourceDirection: targetDirection,
      targetDirection: "ltr",
      sourceName: name(language),
      targetName: name(sourceLanguage),
      source: updated,
      translation: foreignWord,
      prefix: emailPrefix,
      suffix: emailSuffix,
      sentence: emailTemplate.replace("{updated}", foreignWord),
      subject: spanish ? "Archivos del proyecto" : "Project files"
    },
    speech: {
      source: spanish ? "Buenos días" : "Good morning",
      transcription: spanish ? "/ˈbwenos ˈdi.as/" : "/ɡʊd ˈmɔːnɪŋ/",
      translation: translate("ui.help-good-morning", language)
    },
    history: {
      source: spanish ? "averiguar" : "to figure out",
      translation: translate("ui.figure-out-understand", language),
      transcription: spanish ? "/aβeɾiˈɣwaɾ/" : "/tə ˈfɪɡər aʊt/",
      sentence: spanish ? "Necesito averiguar cómo funciona esta función." : "I need to figure out how this feature works."
    }
  };
}
