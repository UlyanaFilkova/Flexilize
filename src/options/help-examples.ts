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
    banner: {
      title: spanish ? "Por qué importa el contexto" : "Why context matters",
      before: spanish ? "Incluso las palabras conocidas pueden " : "Even familiar words can ",
      source: spanish ? "adquirir un significado diferente" : "take on a different meaning",
      after: spanish ? " según el contexto." : " depending on the context.",
      transcription: spanish ? "/adkiˈɾiɾ un siɡnifiˈkaðo difeˈɾente/" : "/teɪk ɒn ə ˈdɪfrənt ˈmiːnɪŋ/",
      translation: translate("ui.help-banner-phrase-translation", language),
      contextTranslation: translate("ui.help-banner-context-translation", language)
    },
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
    longSpeech: spanish
      ? "Cada día trae una nueva oportunidad para aprender algo interesante. Tómate tu tiempo, escucha la frase completa y fíjate en cómo se conectan las palabras. Con un poco de práctica, comprender el español hablado resulta más fácil y natural."
      : "Every day brings a new opportunity to learn something interesting. Take your time, listen to the whole sentence, and notice how the words connect. With a little practice, understanding spoken English becomes easier and more natural.",
    exportSample: {
      words: [
        {source: spanish ? "viaje" : "journey", translation: translate("ui.help-example-journey", language)},
        {source: spanish ? "descubrir" : "discover", translation: translate("ui.help-example-discover", language)},
        {source: spanish ? "curiosidad" : "curiosity", translation: translate("ui.help-example-curiosity", language)}
      ],
      transcription: spanish ? "/ˈbjaxe/" : "/ˈdʒɜːni/",
      sentence: spanish ? "Todo viaje comienza con un solo paso." : "Every journey starts with a single step."
    },
    history: {
      source: spanish ? "averiguar" : "to figure out",
      translation: translate("ui.figure-out-understand", language),
      transcription: spanish ? "/aβeɾiˈɣwaɾ/" : "/tə ˈfɪɡər aʊt/",
      sentence: spanish ? "Necesito averiguar cómo funciona esta función." : "I need to figure out how this feature works."
    }
  };
}
