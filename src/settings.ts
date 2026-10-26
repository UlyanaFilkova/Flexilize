import browser from "webextension-polyfill";
import {normalizeInterfaceLanguage, type InterfaceLanguage} from "./i18n";

export const SETTINGS_KEY = "extensionSettings";

export interface ActivationShortcut {
  alt: boolean
  code: string
  ctrl: boolean
  key: string
  meta: boolean
  shift: boolean
}

export interface ExtensionSettings {
  autoSaveTranslations: boolean
  historyRotationEnabled: boolean
  hotkeyActivationEnabled: boolean
  interfaceLanguage: InterfaceLanguage
  showSelectionTranslationModal: boolean
  activationShortcut: ActivationShortcut
  speechEnabled: boolean
  transcriptionEnabled: boolean
  speechRate: number
  targetLanguage: string
  translatorShortcut: ActivationShortcut
  translatorSourceLanguage: string
  translatorTargetLanguage: string
}

export const MIN_SPEECH_RATE = 0.3;
export const MAX_SPEECH_RATE = 2;
export const SPEECH_RATE_STEP = 0.1;

export const TRANSLATION_LANGUAGES = [
  ["ru", "Русский"], ["en", "Английский"], ["de", "Немецкий"], ["fr", "Французский"],
  ["es", "Испанский"], ["it", "Итальянский"], ["pt", "Португальский"], ["pl", "Польский"],
  ["uk", "Украинский"], ["be", "Белорусский"], ["bg", "Болгарский"], ["cs", "Чешский"],
  ["sk", "Словацкий"], ["sl", "Словенский"], ["sr", "Сербский"], ["hr", "Хорватский"],
  ["nl", "Нидерландский"], ["sv", "Шведский"], ["no", "Норвежский"], ["da", "Датский"],
  ["fi", "Финский"], ["et", "Эстонский"], ["lv", "Латышский"], ["lt", "Литовский"],
  ["el", "Греческий"], ["tr", "Турецкий"], ["ro", "Румынский"], ["hu", "Венгерский"],
  ["ar", "Арабский"], ["he", "Иврит"], ["fa", "Персидский"], ["hi", "Хинди"],
  ["zh-CN", "Китайский (упрощённый)"], ["zh-TW", "Китайский (традиционный)"],
  ["ja", "Японский"], ["ko", "Корейский"], ["vi", "Вьетнамский"], ["id", "Индонезийский"],
  ["af", "Африкаанс"], ["sq", "Албанский"], ["hy", "Армянский"], ["az", "Азербайджанский"],
  ["eu", "Баскский"], ["bn", "Бенгальский"], ["ca", "Каталанский"], ["ka", "Грузинский"],
  ["is", "Исландский"], ["ga", "Ирландский"], ["kk", "Казахский"], ["mk", "Македонский"],
  ["ms", "Малайский"], ["mt", "Мальтийский"], ["sw", "Суахили"], ["th", "Тайский"],
  ["ur", "Урду"], ["uz", "Узбекский"], ["cy", "Валлийский"]
] as const;

export const defaultSettings: ExtensionSettings = {
  autoSaveTranslations: true,
  historyRotationEnabled: true,
  hotkeyActivationEnabled: false,
  interfaceLanguage: "ru",
  showSelectionTranslationModal: true,
  speechEnabled: true,
  transcriptionEnabled: true,
  speechRate: 1,
  targetLanguage: "ru",
  translatorSourceLanguage: "ru",
  translatorTargetLanguage: "en",
  activationShortcut: {
    alt: false,
    code: "BracketRight",
    ctrl: true,
    key: "]",
    meta: false,
    shift: true
  },
  translatorShortcut: {
    alt: false,
    code: "Quote",
    ctrl: true,
    key: "'",
    meta: false,
    shift: true
  }
};

export async function getExtensionSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored?.[SETTINGS_KEY]);
}

export async function saveExtensionSettings(settings: ExtensionSettings) {
  const normalized = normalizeSettings(settings);
  await browser.storage.local.set({[SETTINGS_KEY]: normalized});
  return normalized;
}

export function normalizeSettings(value: unknown): ExtensionSettings {
  const settings = value && typeof value === "object" ? value as Partial<ExtensionSettings> : {};
  const shortcut = settings.activationShortcut && typeof settings.activationShortcut === "object"
    ? settings.activationShortcut as Partial<ActivationShortcut>
    : {};
  const activationShortcut: ActivationShortcut = {
    alt: typeof shortcut.alt === "boolean" ? shortcut.alt : defaultSettings.activationShortcut.alt,
    code: typeof shortcut.code === "string" && shortcut.code ? shortcut.code : defaultSettings.activationShortcut.code,
    ctrl: typeof shortcut.ctrl === "boolean" ? shortcut.ctrl : defaultSettings.activationShortcut.ctrl,
    key: typeof shortcut.key === "string" && shortcut.key ? shortcut.key : defaultSettings.activationShortcut.key,
    meta: typeof shortcut.meta === "boolean" ? shortcut.meta : defaultSettings.activationShortcut.meta,
    shift: typeof shortcut.shift === "boolean" ? shortcut.shift : defaultSettings.activationShortcut.shift
  };
  const storedTranslatorShortcut = settings.translatorShortcut && typeof settings.translatorShortcut === "object"
    ? settings.translatorShortcut as Partial<ActivationShortcut>
    : {};
  const translatorShortcut: ActivationShortcut = {
    alt: typeof storedTranslatorShortcut.alt === "boolean" ? storedTranslatorShortcut.alt : defaultSettings.translatorShortcut.alt,
    code: typeof storedTranslatorShortcut.code === "string" && storedTranslatorShortcut.code ? storedTranslatorShortcut.code : defaultSettings.translatorShortcut.code,
    ctrl: typeof storedTranslatorShortcut.ctrl === "boolean" ? storedTranslatorShortcut.ctrl : defaultSettings.translatorShortcut.ctrl,
    key: typeof storedTranslatorShortcut.key === "string" && storedTranslatorShortcut.key ? storedTranslatorShortcut.key : defaultSettings.translatorShortcut.key,
    meta: typeof storedTranslatorShortcut.meta === "boolean" ? storedTranslatorShortcut.meta : defaultSettings.translatorShortcut.meta,
    shift: typeof storedTranslatorShortcut.shift === "boolean" ? storedTranslatorShortcut.shift : defaultSettings.translatorShortcut.shift
  };
  return {
    autoSaveTranslations: settings.autoSaveTranslations !== false,
    historyRotationEnabled: settings.historyRotationEnabled !== false,
    hotkeyActivationEnabled: settings.hotkeyActivationEnabled === true,
    interfaceLanguage: normalizeInterfaceLanguage(settings.interfaceLanguage),
    showSelectionTranslationModal: settings.showSelectionTranslationModal !== false,
    activationShortcut: hasModifier(activationShortcut) ? activationShortcut : defaultSettings.activationShortcut,
    speechEnabled: settings.speechEnabled !== false,
    transcriptionEnabled: settings.transcriptionEnabled !== false,
    speechRate: normalizeSpeechRate(settings.speechRate),
    targetLanguage: TRANSLATION_LANGUAGES.some(([code]) => code === settings.targetLanguage)
      ? String(settings.targetLanguage)
      : defaultSettings.targetLanguage,
    translatorShortcut: hasModifier(translatorShortcut) ? translatorShortcut : defaultSettings.translatorShortcut,
    translatorSourceLanguage: normalizeTranslationLanguage(settings.translatorSourceLanguage, defaultSettings.translatorSourceLanguage),
    translatorTargetLanguage: normalizeTranslationLanguage(settings.translatorTargetLanguage, defaultSettings.translatorTargetLanguage)
  };
}

function normalizeTranslationLanguage(value: unknown, fallback: string) {
  return TRANSLATION_LANGUAGES.some(([code]) => code === value) ? String(value) : fallback;
}

export function normalizeSpeechRate(value: unknown) {
  const rate = typeof value === "number" && Number.isFinite(value) ? value : defaultSettings.speechRate;
  const clamped = Math.max(MIN_SPEECH_RATE, Math.min(MAX_SPEECH_RATE, rate));
  return Number((Math.round(clamped / SPEECH_RATE_STEP) * SPEECH_RATE_STEP).toFixed(1));
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): ActivationShortcut | null {
  if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return null;
  return {
    alt: event.altKey,
    code: event.code,
    ctrl: event.ctrlKey,
    key: shortcutKeyLabel(event),
    meta: event.metaKey,
    shift: event.shiftKey
  };
}

export function matchesShortcut(event: KeyboardEvent, shortcut: ActivationShortcut) {
  return hasModifier(shortcut)
    && event.code === shortcut.code
    && event.altKey === shortcut.alt
    && event.ctrlKey === shortcut.ctrl
    && event.metaKey === shortcut.meta
    && event.shiftKey === shortcut.shift;
}

function hasModifier(shortcut: ActivationShortcut) {
  return shortcut.alt || shortcut.ctrl || shortcut.meta || shortcut.shift;
}

export function formatShortcut(shortcut: ActivationShortcut) {
  return [
    shortcut.ctrl && "Ctrl",
    shortcut.alt && "Alt",
    shortcut.shift && "Shift",
    shortcut.meta && "Meta",
    shortcut.key
  ].filter(Boolean).join(" + ");
}

function shortcutKeyLabel(event: KeyboardEvent) {
  if (event.code.startsWith("Key")) return event.code.slice(3);
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  const labels: Record<string, string> = {
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    Space: "Space"
  };
  return labels[event.code] || event.key;
}
