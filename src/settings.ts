import browser from "webextension-polyfill";

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
  hotkeyActivationEnabled: boolean
  activationShortcut: ActivationShortcut
  targetLanguage: string
}

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
  hotkeyActivationEnabled: false,
  targetLanguage: "ru",
  activationShortcut: {
    alt: false,
    code: "BracketRight",
    ctrl: true,
    key: "]",
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
  return {
    autoSaveTranslations: settings.autoSaveTranslations !== false,
    hotkeyActivationEnabled: settings.hotkeyActivationEnabled === true,
    activationShortcut: hasModifier(activationShortcut) ? activationShortcut : defaultSettings.activationShortcut,
    targetLanguage: TRANSLATION_LANGUAGES.some(([code]) => code === settings.targetLanguage)
      ? String(settings.targetLanguage)
      : defaultSettings.targetLanguage
  };
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
