import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {useDropzone} from "react-dropzone";
import browser from "webextension-polyfill";
import type {ExportFormat} from "../export";
import {
  clearTranslationRecords,
  deleteTranslationRecord,
  downloadTranslationRecords,
  exportFormats,
  formatRecordDate,
  getTranslationRecords,
  pluralizeRecords,
  recordHostname,
  restoreTranslationRecord,
  updateTranslationRecord
} from "../history";
import {errorMessage, type TranslationRecord} from "../types";
import {uniqueTranslationForms} from "../translation-variants";
import {MAX_HISTORY_RECORDS, MIN_HISTORY_RECORDS} from "../history-config";
import {isMobileDevice} from "../device";
import {getReviewStore} from "../review-store";
import {formatMessage, getActiveLanguage, loadInterfaceLanguage, observeLocalizedDom, setActiveLanguage, translate, type InterfaceLanguage} from "../i18n";
import {
  defaultSettings,
  formatShortcut,
  getExtensionSettings,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  normalizeSpeechRate,
  ONBOARDING_COMPLETED_KEY,
  saveExtensionSettings,
  shortcutFromKeyboardEvent,
  SPEECH_RATE_STEP,
  TRANSLATION_LANGUAGES,
  type ExtensionSettings
} from "../settings";
import {helpExamples} from "./help-examples";
import "./options.css";

type Page = "settings" | "history" | "help" | "review" | "welcome";
type HistorySection = "records" | "export";
type Route = "settings" | "history" | "export" | "help" | "review" | "welcome";
type Notice = {message: string; undo?: () => Promise<void>};

const interfaceLanguageOptions: ReadonlyArray<readonly [InterfaceLanguage, string]> = [
  ["ru", "Русский"], ["en", "English"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"],
  ["ja", "日本語"], ["nl", "Nederlands"], ["it", "Italiano"], ["pt", "Português"],
  ["id", "Bahasa Indonesia"], ["hi", "हिन्दी"], ["pl", "Polski"],
  ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"], ["ko", "한국어"], ["tr", "Türkçe"],
  ["vi", "Tiếng Việt"], ["cs", "Čeština"], ["ro", "Română"], ["sv", "Svenska"], ["da", "Dansk"],
  ["no", "Norsk"], ["fi", "Suomi"], ["hu", "Magyar"], ["el", "Ελληνικά"], ["ms", "Bahasa Melayu"], ["fil", "Filipino"],
  ["ar", "العربية"], ["fa", "فارسی"], ["he", "עברית"], ["ka", "ქართული"], ["hr", "Hrvatski"],
  ["sl", "Slovenščina"], ["sk", "Slovenčina"], ["sq", "Shqip"], ["sr", "Српски"]
];

function localizedLanguageOptions<T extends string>(options: ReadonlyArray<readonly [T, string]>, locale: string, useSelfNames = false) {
  const displayNames = new Intl.DisplayNames([locale], {type: "language"});
  const collator = new Intl.Collator(useSelfNames ? "en" : locale, {sensitivity: "base"});
  return options
    .map(([code, fallback]) => {
      const displayCode = code === "tl" ? "fil" : code;
      const label = useSelfNames
        ? new Intl.DisplayNames([displayCode], {type: "language"}).of(displayCode)
        : displayNames.of(displayCode);
      return [code, label || fallback] as const;
    })
    .sort((left, right) => collator.compare(left[1], right[1]));
}

const routeHashes: Record<Route, string> = {
  settings: "#settings",
  history: "#history",
  export: "#export",
  help: "#help",
  review: "#review",
  welcome: "#welcome"
};

const settingsSectionIds = new Set(["overview", "general", "translator", "translation", "sound", "saving", "advanced"]);
const settingsDetailParents = new Map([
  ["translator-shortcuts", "translator"],
  ["translator-languages", "translation"],
  ["translator-text", "translator"],
  ["speech-rate", "sound"]
]);

const settingsSidebarItems = [
  {id: "overview", label: "Все настройки", icon: <SettingsIcon />},
  {id: "general", label: "Активация", icon: <LightningIcon />},
  {id: "translator", label: "Переводчик", icon: <KeyboardIcon />},
  {id: "translation", label: "Языки", icon: <LanguagesIcon />},
  {id: "sound", label: "Звук", icon: <SoundIcon />},
  {id: "saving", label: "Сохранение", icon: <BookmarkIcon />},
  {id: "advanced", label: "Расширенные настройки", icon: <SlidersIcon />}
];

function routeFromHash(): Route {
  if (location.hash === routeHashes.settings || location.hash.startsWith(`${routeHashes.settings}/`)) return "settings";
  return (Object.entries(routeHashes).find(([, hash]) => hash === location.hash)?.[0] as Route) || "settings";
}

function settingsSectionFromHash() {
  const section = location.hash.startsWith(`${routeHashes.settings}/`)
    ? location.hash.slice(`${routeHashes.settings}/`.length)
    : "overview";
  return settingsDetailParents.get(section) || (settingsSectionIds.has(section) ? section : "overview");
}

function settingsScrollTarget(section: string) {
  const target = `settings-${section}`;
  if (document.getElementById(target)) return target;
  const parent = settingsDetailParents.get(section) || section;
  return `settings-${parent === "translator" && isMobileDevice() ? "general" : parent}`;
}

function resetScrollPosition() {
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0);
  }
}

function scrollToSettingsAnchor(id: string, center = false) {
  const anchor = document.getElementById(id);
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const marginTop = Number.parseFloat(getComputedStyle(anchor).marginTop) || 0;
  const stickyHeaderHeight = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().height || 0;
  if (center) {
    const topOffset = stickyHeaderHeight + Math.max(24, (window.innerHeight - stickyHeaderHeight - rect.height) / 2);
    window.scrollTo({top: Math.max(0, window.scrollY + rect.top - topOffset), behavior: "smooth"});
    return;
  }
  const marginTopPosition = window.scrollY + rect.top - marginTop;
  window.scrollTo({top: Math.max(0, marginTopPosition - stickyHeaderHeight + 16), behavior: "smooth"});
}

function App() {
  const initialRoute = routeFromHash();
  const [page, setPage] = useState<Page>(initialRoute === "welcome" ? "welcome" : initialRoute === "help" || initialRoute === "review" ? initialRoute : initialRoute === "settings" ? "settings" : "history");
  const [settingsSection, setSettingsSection] = useState(settingsSectionFromHash);
  const [historySection, setHistorySection] = useState<HistorySection>(initialRoute === "export" ? "export" : "records");
  const [records, setRecords] = useState<TranslationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(isMobileDevice);

  useEffect(() => {
    const updateDeviceType = () => setIsMobile(isMobileDevice());
    window.addEventListener("resize", updateDeviceType);
    return () => window.removeEventListener("resize", updateDeviceType);
  }, []);

  useEffect(() => {
    void getTranslationRecords()
      .then(setRecords)
      .catch((error) => setNotice({message: errorMessage(error, "Ошибка загрузки")}))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.undo ? 6000 : 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openHistorySection = (section: HistorySection) => {
    resetScrollPosition();
    setPage("history");
    setHistorySection(section);
    window.history.replaceState(null, "", routeHashes[section === "records" ? "history" : "export"]);
  };

  const openSettingsSection = (section: string) => {
    setPage("settings");
    setSettingsSection(settingsDetailParents.get(section) || section);
    window.history.replaceState(null, "", section === "overview" ? routeHashes.settings : `${routeHashes.settings}/${section}`);
    if (section === "overview") {
      window.scrollTo({top: 0, behavior: "smooth"});
    } else {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        scrollToSettingsAnchor(settingsScrollTarget(section), settingsDetailParents.has(section));
      }));
    }
  };

  useEffect(() => {
    if (page !== "settings" || settingsSection === "overview") return;
    const section = location.hash.slice(`${routeHashes.settings}/`.length);
    requestAnimationFrame(() => scrollToSettingsAnchor(settingsScrollTarget(section), settingsDetailParents.has(section)));
  }, []);

  const openHelp = () => {
    resetScrollPosition();
    setPage("help");
    window.history.replaceState(null, "", routeHashes.help);
  };

  const openReview = () => {
    resetScrollPosition();
    setPage("review");
    window.history.replaceState(null, "", routeHashes.review);
  };

  const completeOnboarding = () => {
    setPage("settings");
    setSettingsSection("overview");
    window.history.replaceState(null, "", routeHashes.settings);
    window.scrollTo({top: 0, behavior: "smooth"});
  };

  const removeRecord = async (record: TranslationRecord) => {
    const index = records.indexOf(record);
    try {
      await deleteTranslationRecord(record);
      setRecords((current) => current.filter((item) => item !== record));
      setNotice({
        message: "Запись удалена",
        undo: async () => {
          await restoreTranslationRecord(record, index);
          setRecords((current) => {
            const restored = [...current];
            restored.splice(Math.max(0, Math.min(index, restored.length)), 0, record);
            return restored;
          });
          setNotice({message: "Запись восстановлена"});
        }
      });
    } catch (error) {
      setNotice({message: errorMessage(error, "Ошибка удаления")});
    }
  };

  const updateRecord = async (original: TranslationRecord, updated: TranslationRecord) => {
    try {
      await updateTranslationRecord(original, updated);
      setRecords((current) => current.map((record) => record === original ? updated : record));
      setNotice({message: "Изменения сохранены"});
    } catch (error) {
      setNotice({message: errorMessage(error, "Не удалось сохранить запись")});
      throw error;
    }
  };

  const clearRecords = async () => {
    if (!records.length || !confirm(translate("Удалить все сохранённые переводы?"))) return;
    try {
      await clearTranslationRecords();
      setRecords([]);
      setNotice({message: "Список очищен"});
    } catch (error) {
      setNotice({message: errorMessage(error, "Ошибка очистки")});
    }
  };

  const exportRecords = async (format: ExportFormat) => {
    if (!records.length) return;
    setExporting(format);
    try {
      await downloadTranslationRecords(records, format);
      setNotice({message: `Файл ${exportFormats.find((item) => item.format === format)?.label} подготовлен`});
    } catch (error) {
      setNotice({message: errorMessage(error, "Не удалось подготовить файл")});
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className={`app-shell${mobileMenuOpen ? " mobile-menu-open" : ""}${page === "welcome" ? " onboarding-mode" : ""}`}>
      <header className="topbar">
        <div className="brand" aria-label="Context Translator">
          <span className="brand-mark" aria-hidden="true">A<span>а</span></span>
          <span>Context Translator</span>
        </div>
        <button className="mobile-menu-toggle" type="button" aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={mobileMenuOpen} aria-controls="options-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>
          {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      {mobileMenuOpen && <button className="mobile-menu-backdrop" type="button" aria-label="Закрыть меню" onClick={() => setMobileMenuOpen(false)} />}
      <div className="workspace">
        <aside className="sidebar" id="options-navigation" aria-label="Навигация">
          <div className="sidebar-heading">Переводы</div>
          <nav>
            <button className={page === "history" && historySection === "records" ? "active" : ""} type="button" onClick={() => { openHistorySection("records"); setMobileMenuOpen(false); }}>
              <HistoryIcon /><span>История</span>
            </button>
            <button className={page === "history" && historySection === "export" ? "active" : ""} type="button" onClick={() => { openHistorySection("export"); setMobileMenuOpen(false); }}>
              <DownloadIcon /><span>Экспорт</span>
            </button>
          </nav>
          <div className="sidebar-heading sidebar-section-heading">Настройки</div>
          <nav>
            {settingsSidebarItems.filter((item) => item.id !== "translator" || !isMobile).map((item) => (
              <button key={item.id} className={page === "settings" && settingsSection === item.id ? "active" : ""} type="button" onClick={() => { openSettingsSection(item.id); setMobileMenuOpen(false); }}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-heading sidebar-section-heading">Помощь</div>
          <nav>
            <button className={page === "help" ? "active" : ""} type="button" onClick={() => { openHelp(); setMobileMenuOpen(false); }}>
              <HelpIcon /><span>Как пользоваться</span>
            </button>
            <button className={page === "review" ? "active" : ""} type="button" onClick={() => { openReview(); setMobileMenuOpen(false); }}>
              <StarIcon /><span>{translate("Оценка и отзыв")}</span>
            </button>
          </nav>
          <div className="sidebar-footer"><span className="status-dot" aria-hidden="true" />Расширение активно</div>
        </aside>

        <main className="content">
          {page === "welcome" ? (
            <OnboardingView onComplete={completeOnboarding} />
          ) : page === "review" ? (
            <ReviewView />
          ) : page === "help" ? (
            <HelpView onOpenSettings={openSettingsSection} onOpenHistory={() => openHistorySection("records")} onOpenExport={() => openHistorySection("export")} />
          ) : page === "settings" ? (
            <div id="settings-top">
              <PageHeading title="Настройки" description="Настройте работу расширения под себя." />
              <SettingsBanner onOpenSection={openSettingsSection} />
              <ActivationAndTranslatorSettings isMobile={isMobile} />
              <div id="settings-translation" className="settings-scroll-anchor">
                <PageHeading title="Языки" description="" showEyebrow={false} />
                <TranslationSettings />
              </div>
              <div id="settings-sound" className="settings-scroll-anchor">
                <PageHeading title="Звук" description="" showEyebrow={false} />
                <SoundSettings />
              </div>
              <AdditionalSettings />
            </div>
          ) : historySection === "records" ? (
            <HistoryView records={records} loading={loading} onClear={clearRecords} onDelete={removeRecord} onUpdate={updateRecord} onOpenExport={() => openHistorySection("export")} />
          ) : (
            <ExportView recordsCount={records.length} exporting={exporting} onExport={exportRecords} />
          )}
        </main>
      </div>

      {notice && (
        <div className="page-notice" role="status" aria-live="polite">
          <span>{notice.message}</span>
          {notice.undo && <button type="button" onClick={() => void notice.undo?.()}>Отменить</button>}
        </div>
      )}
    </div>
  );
}

function PageHeading({title, description, action, showEyebrow = true}: {title: string; description: string; action?: ReactNode; showEyebrow?: boolean}) {
  return <div className="content-heading-row"><div className="content-heading">{showEyebrow && <span className="eyebrow">Context Translator</span>}<h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function ReviewView() {
  const store = getReviewStore(navigator.userAgent, getActiveLanguage());
  return (
    <div className="review-page">
      <PageHeading
        title={translate("Оценка и отзыв")}
        description={translate("Расскажите, как вам Context Translator. Ваша оценка и отзыв помогут другим пользователям и поддержат развитие расширения.")}
      />
      <section className="review-store-card">
        <div className="review-store-icon"><StarIcon /></div>
        <div className="review-store-copy">
          <h2>{translate("Оцените Context Translator")}</h2>
          <a className="review-store-action" href={store.url} target="_blank" rel="noreferrer">
            <span className="review-rating-star" aria-hidden="true">★</span>
            {translate("Оценить")}
          </a>
        </div>
      </section>
      <FeedbackForm />
    </div>
  );
}

const feedbackEndpoint = ((import.meta as ImportMeta & {env?: Record<string, string | undefined>}).env?.EXTENSION_PUBLIC_FEEDBACK_ENDPOINT || "").trim();
const feedbackMaxFiles = 10;
const feedbackMaxBytes = 20 * 1024 * 1024;

function FeedbackForm() {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [toast, setToast] = useState<{type: "success" | "error"; message: string} | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onDrop = (accepted: File[], rejected: Array<{errors: ReadonlyArray<{code: string}>}>) => {
    if (rejected.length) {
      const codes = rejected.flatMap((item) => item.errors.map((error) => error.code));
      setStatus(codes.includes("file-too-large")
        ? translate("Общий размер скриншотов не должен превышать 20 МБ.")
        : codes.includes("too-many-files")
          ? translate("Можно приложить не более 10 скриншотов.")
          : translate("Прикрепляйте изображения PNG, JPEG или WebP."));
    }
    if (!accepted.length) return;
    const selected = [...files, ...accepted];
    if (selected.length > feedbackMaxFiles) {
      setStatus(translate("Можно приложить не более 10 скриншотов."));
      return;
    }
    if (selected.reduce((total, file) => total + file.size, 0) > feedbackMaxBytes) {
      setStatus(translate("Общий размер скриншотов не должен превышать 20 МБ."));
      return;
    }
    setFiles(selected);
    setStatus("");
  };
  const {getRootProps, getInputProps, isDragActive, isDragReject} = useDropzone({
    onDrop,
    accept: {"image/png": [], "image/jpeg": [], "image/webp": []},
    maxFiles: feedbackMaxFiles,
    maxSize: feedbackMaxBytes,
    multiple: true
  });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!feedbackEndpoint || !message.trim()) return;
    setSending(true);
    setStatus("");
    setToast(null);
    const body = new FormData();
    body.set("message", message.trim());
    body.set("contact", contact.trim());
    body.set("contactLabel", translate("Контактная информация"));
    body.set("website", "");
    files.forEach((file) => body.append("screenshots", file, file.name));
    try {
      const response = await fetch(feedbackEndpoint, {method: "POST", body});
      if (!response.ok) throw new Error("feedback request failed");
      setMessage("");
      setContact("");
      setFiles([]);
      setToast({type: "success", message: translate("Спасибо! Сообщение отправлено.")});
    } catch {
      setToast({type: "error", message: translate("Не удалось отправить сообщение. Попробуйте позже.")});
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="feedback-card">
      {toast && <div className={`feedback-toast is-${toast.type}`} role={toast.type === "error" ? "alert" : "status"} aria-live={toast.type === "error" ? "assertive" : "polite"} aria-atomic="true">{toast.message}</div>}
      <div className="feedback-icon"><MessageIcon /></div>
      <div className="feedback-content">
        <h2>{translate("Обратная связь")}</h2>
        <p>{translate("Опишите проблему или предложение. При желании приложите скриншоты.")}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>{translate("Сообщение")}
            <textarea required rows={2} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} onInput={(event) => {
              const textarea = event.currentTarget;
              textarea.style.height = "auto";
              const style = window.getComputedStyle(textarea);
              const borderHeight = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
              const minimumHeight = Number.parseFloat(style.minHeight) || 74;
              textarea.style.height = `${Math.max(textarea.scrollHeight + borderHeight, minimumHeight)}px`;
            }} />
          </label>
          <label>{translate("Ваш email или контакт для ответа (необязательно)")}
            <input type="text" maxLength={500} value={contact} onChange={(event) => setContact(event.target.value)} />
          </label>
          <label className="feedback-honeypot" aria-hidden="true" tabIndex={-1}>Website
            <input tabIndex={-1} autoComplete="off" value="" onChange={() => undefined} />
          </label>
          <div className="feedback-upload-label">{translate("Изображения")}</div>
          <div {...getRootProps({className: `feedback-dropzone${isDragActive ? " is-drag-active" : ""}${isDragReject ? " is-drag-reject" : ""}`})}>
            <input {...getInputProps()} />
            <UploadIcon />
            <strong>{isDragActive ? translate("Перетащите файлы сюда") : translate("Перетащите изображения сюда или нажмите, чтобы выбрать")}</strong>
            <span>{translate("PNG, JPEG или WebP · до 10 файлов · всего до 20 МБ")}</span>
          </div>
          {status && <p className="feedback-status" role="status">{status}</p>}
          {files.length > 0 && <div className="feedback-preview-grid">
            {files.map((file, index) => <ScreenshotPreview key={`${file.name}-${file.size}-${file.lastModified}-${index}`} file={file} onRemove={() => setFiles((current) => current.filter((item) => item !== file))} />)}
          </div>}
          <button className="review-store-action" type="submit" disabled={!feedbackEndpoint || sending || !message.trim()}>
            {sending ? translate("Отправка…") : translate("Отправить")}
          </button>
        </form>
      </div>
    </section>
  );
}

function ScreenshotPreview({file, onRemove}: {file: File; onRemove: () => void}) {
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="feedback-preview-item">
      {previewUrl && <img src={previewUrl} alt={file.name} />}
      <span title={file.name}>{file.name}</span>
      <button type="button" aria-label={`${translate("Удалить файл")}: ${file.name}`} onClick={onRemove}><CloseIcon /></button>
    </div>
  );
}

function SettingsBanner({onOpenSection}: {onOpenSection: (section: string) => void}) {
  const example = helpExamples();
  return (
    <section className="settings-banner">
      <div className="settings-banner-copy">
        <span className="settings-banner-kicker">Персональные настройки</span>
        <h2>Context Translator</h2>
        <p>Настройте языки, горячие клавиши, звук и сохранение один раз — изменения применяются сразу на всех открытых страницах.</p>
        <button type="button" onClick={() => onOpenSection("general")}>Настроить активацию<ArrowIcon /></button>
      </div>
      <div className="settings-banner-visual" aria-hidden="true">
        <div className="banner-control banner-control-main"><SlidersIcon /><span><strong>Перевод по выделению</strong><small>Включено</small></span><i /></div>
        <div className="banner-control banner-control-language"><LanguagesIcon /><span translate="no"><strong>{example.sourceName}</strong><small>→ {example.targetName}</small></span></div>
        <div className="banner-control banner-control-sound"><SoundIcon /><span><strong>Скорость речи</strong><small>1,0×</small></span><b>−</b><em>+</em></div>
        <div className="banner-orbit banner-orbit-one" />
        <div className="banner-orbit banner-orbit-two" />
      </div>
    </section>
  );
}

function OnboardingView({onComplete}: {onComplete: () => void}) {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getExtensionSettings().then((stored) => {
      setSettings(stored);
    }).catch(() => setError("Не удалось загрузить текущие настройки.")).finally(() => setLoading(false));
  }, []);

  const languageOptions = localizedLanguageOptions(interfaceLanguageOptions, "en", true);

  const changeNativeLanguage = async (interfaceLanguage: InterfaceLanguage) => {
    if (loading || saving) return;
    const targetLanguage = interfaceLanguage === "fil" ? "tl" : interfaceLanguage;
    setSaving(true);
    setError("");
    try {
      await loadInterfaceLanguage(interfaceLanguage);
      await saveExtensionSettings({...settings, targetLanguage, interfaceLanguage});
      renderOptions(interfaceLanguage);
    } catch (_error) {
      setError("Не удалось сохранить настройки. Попробуйте ещё раз.");
      setSaving(false);
    }
  };

  const saveSetup = async () => {
    if (saving || loading) return;
    setSaving(true);
    setError("");
    try {
      await saveExtensionSettings(settings);
      await browser.storage.local.set({[ONBOARDING_COMPLETED_KEY]: true});
      onComplete();
    } catch (_error) {
      setError("Не удалось сохранить настройки. Попробуйте ещё раз.");
      setSaving(false);
    }
  };

  return (
    <div className="onboarding-page">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="onboarding-kicker">Первый запуск</div>
        <h1 id="onboarding-title">Быстрая настройка</h1>

        <label className="onboarding-field onboarding-language-field" htmlFor="onboarding-language">
          <span className="onboarding-field-title">Ваш родной язык?</span>
          <span className="onboarding-field-description">Язык интерфейса</span>
          <select
            id="onboarding-language"
            className="setting-select"
            value={settings.interfaceLanguage}
            disabled={loading || saving}
            onChange={(event) => void changeNativeLanguage(event.target.value as InterfaceLanguage)}
          >
            {languageOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>

        <fieldset className="onboarding-field onboarding-activation-field" disabled={loading || saving}>
          <legend className="onboarding-field-title">Как запускать перевод по выделению текста?</legend>
          <section className="settings-panel settings-panel-grouped activation-options-grid" aria-label="Способы запуска перевода">
            <SelectionActivationSettings settings={settings} persist={setSettings} isMobile={false} shortCopy />
          </section>
        </fieldset>

        {error && <div className="onboarding-error" role="alert">{error}</div>}
        <div className="onboarding-footer">
          <span>Настройки можно будет изменить в любое время.</span>
          <button className="onboarding-submit" type="button" disabled={loading || saving} onClick={() => void saveSetup()}>
            {saving ? "Сохранение…" : "Начать"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ActivationAndTranslatorSettings({isMobile}: {isMobile: boolean}) {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [recording, setRecording] = useState(false);
  const [translatorRecording, setTranslatorRecording] = useState(false);
  const [reverseTranslationRecording, setReverseTranslationRecording] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getExtensionSettings().then(setSettings).catch(() => setError("Не удалось загрузить настройки"));
  }, []);


  const persist = async (nextSettings: ExtensionSettings) => {
    setSettings(nextSettings);
    setError("");
    try {
      setSettings(await saveExtensionSettings(nextSettings));
    } catch (_error) {
      setError("Не удалось сохранить настройку");
    }
  };

  const captureShortcut = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || !settings) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      setError("");
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!shortcut) return;
    if (!shortcut.ctrl && !shortcut.alt && !shortcut.shift && !shortcut.meta) {
      setError("Добавьте к клавише Ctrl, Alt, Shift или Meta");
      return;
    }
    setRecording(false);
    void persist({...settings, activationShortcut: shortcut});
  };

  const captureTranslatorShortcut = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!translatorRecording || !settings) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setTranslatorRecording(false);
      setError("");
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!shortcut) return;
    if (!shortcut.ctrl && !shortcut.alt && !shortcut.shift && !shortcut.meta) {
      setError("Добавьте к клавише Ctrl, Alt, Shift или Meta");
      return;
    }
    setTranslatorRecording(false);
    void persist({...settings, translatorShortcut: shortcut});
  };

  const captureReverseTranslationShortcut = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!reverseTranslationRecording || !settings) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setReverseTranslationRecording(false);
      setError("");
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!shortcut) return;
    if (!shortcut.ctrl && !shortcut.alt && !shortcut.shift && !shortcut.meta) {
      setError("Добавьте к клавише Ctrl, Alt, Shift или Meta");
      return;
    }
    setReverseTranslationRecording(false);
    void persist({...settings, reverseTranslationShortcut: shortcut});
  };

  return (
    <>
      <div id="settings-general" className="settings-scroll-anchor">
        <PageHeading title="Активация" description="" showEyebrow={false} />
        <div className="settings-group settings-group-following">
          <h2 className="settings-group-title">Перевод по выделению</h2>
          <section className="settings-panel settings-panel-grouped activation-options-grid" aria-label="Перевод по выделению">
        <SelectionActivationSettings settings={settings} persist={persist} isMobile={isMobile} />

        {!isMobile && <div className={`setting-row setting-row-secondary activation-setting-row hotkey-activation-setting-row${settings?.hotkeyActivationEnabled ? "" : " setting-row-disabled"}`} aria-disabled={!settings?.hotkeyActivationEnabled}>
          <div className="setting-copy">
            <h2>Комбинация клавиш</h2>
            <p>Нажмите кнопку и введите новую комбинацию.</p>
          </div>
          <button
            className={recording ? "hotkey-button recording" : "hotkey-button"}
            type="button"
            disabled={!settings?.hotkeyActivationEnabled}
            onClick={() => { setRecording(true); setError(""); }}
            onBlur={() => setRecording(false)}
            onKeyDown={captureShortcut}
          >
            {recording ? "Нажмите клавиши…" : formatShortcut(settings?.activationShortcut || defaultSettings.activationShortcut)}
          </button>
        </div>}
          </section>
        </div>
      </div>
      {!isMobile && <div id="settings-translator" className="settings-scroll-anchor">
        <PageHeading title="Переводчик" description="" showEyebrow={false} />
        <div id="settings-translator-shortcuts" className="settings-group settings-group-following translator-shortcuts-settings-group">
          <section className="settings-panel settings-panel-grouped" aria-label="Переводчик">
            <div className="setting-row activation-setting-row">
              <div className="setting-copy">
                <h2>Горячая клавиша переводчика</h2>
                <p>Открывает отдельное окно для ввода и перевода текста.</p>
              </div>
              <ActivationIllustration kind="translator" shortcut={formatShortcut(settings?.translatorShortcut || defaultSettings.translatorShortcut)} />
              <button
                className={translatorRecording ? "hotkey-button recording" : "hotkey-button"}
                type="button"
                disabled={!settings}
                onClick={() => { setTranslatorRecording(true); setError(""); }}
                onBlur={() => setTranslatorRecording(false)}
                onKeyDown={captureTranslatorShortcut}
              >
                {translatorRecording ? "Нажмите клавиши…" : formatShortcut(settings?.translatorShortcut || defaultSettings.translatorShortcut)}
              </button>
            </div>
            <div className="setting-row setting-row-secondary activation-setting-row">
              <div className="setting-copy">
                <h2>Горячая клавиша обратного перевода</h2>
                <p>Меняет местами исходный язык и язык перевода.</p>
              </div>
              <ActivationIllustration kind="reverse" shortcut={formatShortcut(settings?.reverseTranslationShortcut || defaultSettings.reverseTranslationShortcut)} />
              <button
                className={reverseTranslationRecording ? "hotkey-button recording" : "hotkey-button"}
                type="button"
                disabled={!settings}
                onClick={() => { setReverseTranslationRecording(true); setError(""); }}
                onBlur={() => setReverseTranslationRecording(false)}
                onKeyDown={captureReverseTranslationShortcut}
              >
                {reverseTranslationRecording ? "Нажмите клавиши…" : formatShortcut(settings?.reverseTranslationShortcut || defaultSettings.reverseTranslationShortcut)}
              </button>
            </div>
            <div id="settings-translator-text" className="setting-row setting-row-secondary">
              <div className="setting-copy">
                <h2>Сохранять предыдущий текст при повторном открытии переводчика</h2>
                <p>При закрытии окна переводчика введенный текст и его перевод сохранятся и будут доступны при повторном открытии переводчика.</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings?.preserveTranslatorText ?? false}
                  disabled={!settings}
                  onChange={(event) => settings && void persist({...settings, preserveTranslatorText: event.target.checked})}
                />
                <span aria-hidden="true" />
                <span className="sr-only">Сохранять предыдущий текст при повторном открытии переводчика</span>
              </label>
            </div>
            {error && <div className="settings-error" role="alert">{error}</div>}
          </section>
        </div>
      </div>}
    </>
  );
}

function SelectionActivationSettings({settings, persist, isMobile, shortCopy = false}: {
  settings: ExtensionSettings | null;
  persist: (settings: ExtensionSettings) => void | Promise<void>;
  isMobile: boolean;
  shortCopy?: boolean;
}) {
  return (
    <>
      <div className="setting-row activation-setting-row">
        <div className="setting-copy">
          <h2>{shortCopy ? "Автоматически при выделении" : "Автоматическая активация"}</h2>
          <p>{shortCopy ? "Перевод появится сразу после выделения текста." : "Переводить выделенный текст сразу после выделения. Включение отключит активацию кнопкой."}</p>
        </div>
        <ActivationIllustration kind="automatic" />
        <label className="switch">
          <input
            type="checkbox"
            checked={settings?.autoActivationEnabled ?? true}
            disabled={!settings}
            onChange={(event) => settings && void persist({...settings, autoActivationEnabled: event.target.checked, ...(event.target.checked ? {selectionButtonEnabled: false} : {})})}
          />
          <span aria-hidden="true" />
          <span className="sr-only">Включить автоматическую активацию</span>
        </label>
      </div>

      <div className="setting-row setting-row-secondary activation-setting-row">
        <div className="setting-copy">
          <h2>{shortCopy ? "Кнопкой рядом с выделением" : "Кнопка рядом с выделением"}</h2>
          <p>{shortCopy ? "Нажмите кнопку, которая появляется возле выделенного текста." : "Показывать кнопку запуска перевода рядом с выделенным текстом. Включение отключит автоматическую активацию."}</p>
        </div>
        <ActivationIllustration kind="button" />
        <label className="switch">
          <input
            type="checkbox"
            checked={settings?.selectionButtonEnabled || false}
            disabled={!settings}
            onChange={(event) => settings && void persist({...settings, selectionButtonEnabled: event.target.checked, ...(event.target.checked ? {autoActivationEnabled: false} : {})})}
          />
          <span aria-hidden="true" />
          <span className="sr-only">Включить кнопку рядом с выделением</span>
        </label>
      </div>
      {!isMobile && <div className="setting-row setting-row-secondary activation-setting-row">
        <div className="setting-copy">
          <h2>{shortCopy ? "Через контекстное меню" : "Активация через контекстное меню"}</h2>
          <p>{shortCopy ? "Щёлкните правой кнопкой по выделенному тексту и выберите перевод." : "Добавляет пункт «Context Translator» в контекстное меню браузера (открывается кликом правой кнопкой мыши по выделенному тексту)."}</p>
        </div>
        <ActivationIllustration kind="context" />
        <label className="switch">
          <input
            type="checkbox"
            checked={settings?.contextMenuEnabled || false}
            disabled={!settings}
            onChange={(event) => settings && void persist({...settings, contextMenuEnabled: event.target.checked})}
          />
          <span aria-hidden="true" />
          <span className="sr-only">Включить перевод через контекстное меню</span>
        </label>
      </div>}

      {!isMobile && <div className="setting-row setting-row-secondary activation-setting-row hotkey-activation-setting-row">
        <div className="setting-copy">
          <h2>{shortCopy ? "Горячими клавишами" : "Активация горячими клавишами"}</h2>
          <p>
            {shortCopy ? <>
              <span>Выделите текст и нажмите комбинацию клавиш</span>{" "}
              <span className="onboarding-shortcut-value" dir="ltr">{formatShortcut(settings?.activationShortcut || defaultSettings.activationShortcut)}</span>{"."}<br />
              <span>Комбинацию можно изменить в настройках.</span>
            </> : <>
              <span>Перевод текста будет запускаться только после нажатия выбранной комбинации клавиш</span>{" "}
              <span className="onboarding-shortcut-value" dir="ltr">{formatShortcut(settings?.activationShortcut || defaultSettings.activationShortcut)}</span>{"."}
            </>}
          </p>
        </div>
        <ActivationIllustration kind="shortcut" shortcut={formatShortcut(settings?.activationShortcut || defaultSettings.activationShortcut)} />
        <label className="switch">
          <input
            type="checkbox"
            checked={settings?.hotkeyActivationEnabled || false}
            disabled={!settings}
            onChange={(event) => settings && void persist({...settings, hotkeyActivationEnabled: event.target.checked})}
          />
          <span aria-hidden="true" />
          <span className="sr-only">Включить активацию горячими клавишами</span>
        </label>
      </div>}

    </>
  );
}

function ActivationIllustration({kind, shortcut = "Ctrl + Shift + ]"}: {kind: "window" | "automatic" | "button" | "context" | "shortcut" | "translator" | "reverse"; shortcut?: string}) {
  const example = helpExamples();
  return (
    <div className={`activation-illustration activation-illustration-${kind}`} aria-hidden="true">
      <div className="activation-preview-scene" aria-hidden="true">
        {kind === "translator" ? (
          <div className="activation-preview-translator-backdrop">
            <div className="activation-preview-translator">
              <div className="activation-preview-translator-title"><strong>Context Translator</strong><b>{shortcut}</b><i>×</i></div>
              <div className="activation-preview-languages" translate="no" dir="ltr"><i>{example.sourceName}</i><b>⇄</b><i>{example.targetName}</i></div>
              <div className="activation-preview-panes"><div /><div /></div>
            </div>
          </div>
        ) : kind === "reverse" ? (
          <div className="activation-preview-reverse">
            <p translate="no" dir="ltr"><span>{example.sourceName}</span><b>→</b><span>{example.targetName}</span></p>
            <p translate="no" dir="ltr"><span>{example.targetName}</span><b>→</b><span>{example.sourceName}</span></p>
            <i>{shortcut}</i>
          </div>
        ) : (
          <>
            <div className="activation-preview-toolbar"><i /><i /><i /><span /></div>
            <div className="activation-preview-page">
              <b />
              <p translate="no" lang={example.sourceLanguage} dir="ltr"><mark>{example.context.source}</mark>{kind !== "button" && example.context.after}</p>
              <i className="line-long" /><i className="line-medium" />
              <i className="line-short" />
            </div>
            {(kind === "window" || kind === "automatic" || kind === "shortcut") && <div className="activation-preview-result"><strong translate="no" lang={example.sourceLanguage}>{example.context.source}</strong><span /><b translate="no" lang={example.targetLanguage}>{example.context.translation}</b></div>}
            {kind === "button" && <>
              <div className="activation-preview-selection-button"><strong>A<span>a</span></strong></div>
              <svg className="activation-preview-selection-arrow" viewBox="0 0 24 12" aria-hidden="true">
                <path d="M1 6h21M17 1l5 5-5 5" />
              </svg>
              <div className="activation-preview-result activation-preview-button-result"><strong translate="no" lang={example.sourceLanguage}>{example.context.source}</strong><span /><b translate="no" lang={example.targetLanguage}>{example.context.translation}</b></div>
            </>}
            {kind === "context" && <div className="activation-preview-context-menu"><span>Копировать</span><b><img className="activation-preview-brand-icon" src="../icons/icon-32.png" alt="" />Context Translator</b><span>Искать в интернете</span></div>}
            {kind === "shortcut" && <div className="activation-preview-shortcut">{shortcut.split(" + ").map((key) => <span key={key}>{key}</span>)}<i>↵</i></div>}
          </>
        )}
      </div>
    </div>
  );
}

function TranslationSettings() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [error, setError] = useState("");
  const [changingLanguage, setChangingLanguage] = useState(false);

  useEffect(() => {
    void getExtensionSettings().then(setSettings).catch(() => setError("Не удалось загрузить настройки"));
  }, []);

  const persist = async (next: ExtensionSettings) => {
    if (!settings) return;
    const previous = settings;
    setSettings(next);
    setError("");
    try {
      setSettings(await saveExtensionSettings(next));
    } catch (_error) {
      setSettings(previous);
      setError("Не удалось сохранить настройку");
    }
  };

  const changeInterfaceLanguage = async (interfaceLanguage: InterfaceLanguage) => {
    if (!settings || changingLanguage || settings.interfaceLanguage === interfaceLanguage) return;
    const previous = settings;
    const next = {...settings, interfaceLanguage};
    setSettings(next);
    setError("");
    setChangingLanguage(true);
    try {
      await loadInterfaceLanguage(interfaceLanguage);
      await saveExtensionSettings(next);
      changeOptionsLanguage(interfaceLanguage);
    } catch (_error) {
      setSettings(previous);
      setError("Не удалось сохранить настройку");
    } finally {
      setChangingLanguage(false);
    }
  };

  const interfaceLocale = settings?.interfaceLanguage || "ru";
  const languageOptions = localizedLanguageOptions(TRANSLATION_LANGUAGES, interfaceLocale)
    .map(([code, label]) => <option key={code} value={code}>{label}</option>);
  const sortedInterfaceLanguageOptions = localizedLanguageOptions(interfaceLanguageOptions, interfaceLocale, true);

  return (
    <>
      <div className="settings-group">
        <h2 className="settings-group-title">Интерфейс</h2>
        <section className="settings-panel settings-panel-grouped" aria-label="Язык интерфейса">
          <div className="setting-row">
            <div className="setting-copy">
              <h2>Язык интерфейса</h2>
              <p>Язык кнопок, настроек и сообщений расширения.</p>
            </div>
            <select
              className="setting-select"
              aria-label="Язык интерфейса"
              value={settings?.interfaceLanguage || "ru"}
              disabled={!settings || changingLanguage}
              onChange={(event) => void changeInterfaceLanguage(event.target.value as InterfaceLanguage)}
            >
              {sortedInterfaceLanguageOptions.map(([language, label]) => <option key={language} value={language}>{label}</option>)}
            </select>
          </div>
          {error && <div className="settings-error" role="alert">{error}</div>}
        </section>
      </div>
      <div className="settings-group">
        <h2 className="settings-group-title">Перевод выделенного текста</h2>
        <section className="settings-panel settings-panel-grouped" aria-label="Перевод выделенного текста">
        <div className="setting-row">
          <div className="setting-copy">
            <h2>Язык перевода выделенного текста</h2>
            <p>Все выделенные тексты будут переводиться на выбранный язык.</p>
          </div>
          <select
            className="setting-select"
            aria-label="Язык перевода"
            value={settings?.targetLanguage || "ru"}
            disabled={!settings}
            onChange={(event) => settings && void persist({...settings, targetLanguage: event.target.value})}
          >
            {languageOptions}
          </select>
        </div>
        </section>
      </div>
      <div id="settings-translator-languages" className="settings-group settings-group-following">
        <h2 className="settings-group-title">Переводчик</h2>
        <section className="settings-panel settings-panel-grouped" aria-label="Переводчик">
        <div className="setting-row">
        <div className="setting-copy">
          <h2>Исходный язык переводчика</h2>
          <p>Язык текста при открытии отдельного окна переводчика.</p>
        </div>
        <select className="setting-select" aria-label="Исходный язык переводчика" value={settings?.translatorSourceLanguage || "en"} disabled={!settings} onChange={(event) => settings && void persist({...settings, translatorSourceLanguage: event.target.value})}>
          {languageOptions}
        </select>
      </div>
        <div className="setting-row setting-row-secondary">
        <div className="setting-copy">
          <h2>Язык перевода в переводчике</h2>
          <p>Язык результата при открытии отдельного окна переводчика.</p>
        </div>
        <select className="setting-select" aria-label="Язык перевода в переводчике" value={settings?.translatorTargetLanguage || "ru"} disabled={!settings} onChange={(event) => settings && void persist({...settings, translatorTargetLanguage: event.target.value})}>
          {languageOptions}
        </select>
      </div>
        {error && <div className="settings-error" role="alert">{error}</div>}
        </section>
      </div>
    </>
  );
}

function AdditionalSettings() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void getExtensionSettings().then(setSettings).catch(() => setError("Не удалось загрузить настройки"));
  }, []);

  const saveSetting = async (next: ExtensionSettings) => {
    if (!settings) return;
    const previous = settings;
    setSettings(next);
    setError("");
    try {
      setSettings(await saveExtensionSettings(next));
    } catch (_error) {
      setSettings(previous);
      setError("Не удалось сохранить настройку");
    }
  };

  return (
    <>
      <div id="settings-saving" className="settings-scroll-anchor">
        <PageHeading title="Сохранение" description="" showEyebrow={false} />
        <div className="settings-group">
          <h2 className="settings-group-title">Сохранение истории</h2>
          <section className="settings-panel settings-panel-grouped" aria-label="Настройки сохранения">
            <div className="setting-row">
              <div className="setting-copy">
                <h2>Автоматическое сохранение</h2>
                <p>Сохранять каждый выполненный перевод в истории автоматически.<br/>Если выключено, то сохранение происходит только по нажатию кнопки "Сохранить".</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings?.autoSaveTranslations ?? true}
                  disabled={!settings}
                  onChange={(event) => settings && void saveSetting({...settings, autoSaveTranslations: event.target.checked})}
                />
                <span aria-hidden="true" />
                <span className="sr-only">Включить автоматическое сохранение</span>
              </label>
            </div>
            <div className="setting-row setting-row-secondary history-limit-row">
              <div className="setting-copy">
                <h2><label htmlFor="history-record-limit">Лимит записей в истории</label></h2>
                <p id="history-record-limit-description">От 1 до 5000. При включённой ротации старые записи будут удаляться при сохранении нового перевода.</p>
              </div>
              <div className="history-limit-controls">
                <input
                  key={settings ? "loaded" : "loading"}
                  id="history-record-limit"
                  name="historyRecordLimit"
                  type="number"
                  min={MIN_HISTORY_RECORDS}
                  max={MAX_HISTORY_RECORDS}
                  step={1}
                  required
                  defaultValue={settings?.historyRecordLimit ?? MAX_HISTORY_RECORDS}
                  disabled={!settings}
                  aria-describedby="history-record-limit-description"
                  onChange={(event) => {
                    if (!settings || !event.currentTarget.checkValidity()) return;
                    void saveSetting({...settings, historyRecordLimit: event.currentTarget.valueAsNumber});
                  }}
                />
              </div>
            </div>
            <div className="setting-row setting-row-secondary">
              <div className="setting-copy">
                <h2>Ротация истории</h2>
                <p>{`При добавлении новых переводов сверх лимита в ${settings?.historyRecordLimit ?? MAX_HISTORY_RECORDS} самые старые записи будут автоматически удаляться из истории. Таким образом, общее количество записей в истории будет оставаться равным ${settings?.historyRecordLimit ?? MAX_HISTORY_RECORDS}.`}</p>
                <p>{`При выключенной ротации новые записи не будут сохраняться в историю, пока достигнут лимит в ${settings?.historyRecordLimit ?? MAX_HISTORY_RECORDS}. Старые будут оставаться в истории.`}</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings?.historyRotationEnabled ?? true}
                  disabled={!settings}
                  onChange={(event) => settings && void saveSetting({...settings, historyRotationEnabled: event.target.checked})}
                />
                <span aria-hidden="true" />
                <span className="sr-only">Включить ротацию истории</span>
              </label>
            </div>
          </section>
        </div>
      </div>
      <div id="settings-advanced" className="settings-scroll-anchor">
        <PageHeading title="Расширенные настройки" description="" showEyebrow={false} />
        <div className="settings-group">
          <h2 className="settings-group-title">Перевод</h2>
          <section className="settings-panel settings-panel-grouped" aria-label="Перевод">
            <div className="setting-row activation-setting-row">
              <div className="setting-copy">
                <h2>Показывать окно перевода</h2>
                <p>Если выключено, перевод от Context Translator не будет появляться на странице, но продолжит сохраняться в истории.</p>
                <p>Тогда вы сможете использовать другие расширения для мгновенного перевода, а Context Translator – для сохранения переводов.</p>
              </div>
              <ActivationIllustration kind="window" />
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings?.showSelectionTranslationModal ?? true}
                  disabled={!settings}
                  onChange={(event) => settings && void saveSetting({...settings, showSelectionTranslationModal: event.target.checked})}
                />
                <span aria-hidden="true" />
                <span className="sr-only">Показывать окно перевода</span>
              </label>
            </div>
          </section>
        </div>
      </div>
      {error && <div className="settings-error" role="alert">{error}</div>}
    </>
  );
}

function SoundSettings() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void getExtensionSettings().then(setSettings).catch(() => setError("Не удалось загрузить настройки"));
  }, []);

  const changeSpeechRate = async (direction: -1 | 1) => {
    if (!settings) return;
    const previous = settings;
    const speechRate = normalizeSpeechRate(settings.speechRate + direction * SPEECH_RATE_STEP);
    if (speechRate === settings.speechRate) return;
    const next = {...settings, speechRate};
    setSettings(next);
    setError("");
    try {
      setSettings(await saveExtensionSettings(next));
    } catch (_error) {
      setSettings(previous);
      setError("Не удалось сохранить настройку");
    }
  };

  const setSpeechEnabled = async (speechEnabled: boolean) => {
    if (!settings) return;
    const previous = settings;
    const next = {...settings, speechEnabled};
    setSettings(next);
    setError("");
    try {
      setSettings(await saveExtensionSettings(next));
    } catch (_error) {
      setSettings(previous);
      setError("Не удалось сохранить настройку");
    }
  };

  const setTranscriptionEnabled = async (transcriptionEnabled: boolean) => {
    if (!settings) return;
    const previous = settings;
    const next = {...settings, transcriptionEnabled};
    setSettings(next);
    setError("");
    try {
      setSettings(await saveExtensionSettings(next));
    } catch (_error) {
      setSettings(previous);
      setError("Не удалось сохранить настройку");
    }
  };

  const speechRate = settings?.speechRate ?? 1;

  return (
    <section className="settings-panel" aria-label="Настройки звука">
      <div className="setting-row">
        <div className="setting-copy">
          <h2>Транскрипция</h2>
          <p>Показывать транскрипцию выделенного текста.</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings?.transcriptionEnabled ?? true}
            disabled={!settings}
            onChange={(event) => void setTranscriptionEnabled(event.target.checked)}
          />
          <span aria-hidden="true" />
          <span className="sr-only">Включить транскрипцию</span>
        </label>
      </div>
      <div className="setting-row setting-row-secondary">
        <div className="setting-copy">
          <h2>Озвучка</h2>
          <p>Показывать кнопку воспроизведения озвучки для выделенного текста.</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings?.speechEnabled ?? true}
            disabled={!settings}
            onChange={(event) => void setSpeechEnabled(event.target.checked)}
          />
          <span aria-hidden="true" />
          <span className="sr-only">Включить озвучку</span>
        </label>
      </div>
      <div id="settings-speech-rate" className={`setting-row setting-row-secondary${settings?.speechEnabled ? "" : " setting-row-disabled"}`} aria-disabled={!settings?.speechEnabled}>
        <div className="setting-copy">
          <h2>Скорость озвучки</h2>
          <p>Скорость воспроизведения озвученного текста.</p>
        </div>
        <div className="stepper" role="group" aria-label="Скорость озвучки">
          <button
            type="button"
            aria-label="Уменьшить скорость озвучки"
            disabled={!settings?.speechEnabled || speechRate <= MIN_SPEECH_RATE}
            onClick={() => void changeSpeechRate(-1)}
          >−</button>
          <output aria-live="polite" aria-label={`Текущая скорость ${speechRate.toFixed(1)}`}>{speechRate.toFixed(1)}×</output>
          <button
            type="button"
            aria-label="Увеличить скорость озвучки"
            disabled={!settings?.speechEnabled || speechRate >= MAX_SPEECH_RATE}
            onClick={() => void changeSpeechRate(1)}
          >+</button>
        </div>
      </div>
      {error && <div className="settings-error" role="alert">{error}</div>}
    </section>
  );
}

function HistoryView({records, loading, onClear, onDelete, onUpdate, onOpenExport}: {records: TranslationRecord[]; loading: boolean; onClear: () => void; onDelete: (record: TranslationRecord) => void; onUpdate: (original: TranslationRecord, updated: TranslationRecord) => Promise<void>; onOpenExport: () => void}) {
  return (
    <>
      <PageHeading
        title="История переводов"
        description={loading ? "Загрузка…" : pluralizeRecords(records.length)}
        action={<div className="history-heading-actions"><button className="open-export" type="button" onClick={onOpenExport}><DownloadIcon />Экспорт</button><button className="clear-history" type="button" disabled={!records.length} onClick={onClear}><TrashIcon />Очистить историю</button></div>}
      />
      {!loading && !records.length ? (
        <section className="history-empty"><div className="empty-icon">Aa</div><strong>Пока пусто</strong><span>Выделите текст на любой странице — перевод появится здесь.</span></section>
      ) : (
        <ol className="history-list">
          {records.map((record, index) => <RecordCard key={`${record.createdAt}-${record.text}-${index}`} record={record} onDelete={() => onDelete(record)} onUpdate={(updated) => onUpdate(record, updated)} />)}
        </ol>
      )}
    </>
  );
}

function RecordCard({record, onDelete, onUpdate}: {record: TranslationRecord; onDelete: () => void; onUpdate: (updated: TranslationRecord) => Promise<void>}) {
  const [editing, setEditing] = useState(false);
  const alternatives = uniqueTranslationForms([record.translation, ...record.translations]).slice(1);

  if (editing) {
    return <RecordEditor record={record} onCancel={() => setEditing(false)} onSave={async (updated) => { await onUpdate(updated); setEditing(false); }} />;
  }

  return (
    <li className="history-record">
      <div className="record-pair"><div className="record-term-line"><span className="record-original">{record.text || "—"}</span>{record.transcription && <span className="record-transcription">{record.transcription}</span>}</div><span className="record-translation">{record.translation || "—"}</span></div>
      {alternatives.length > 0 && <div className="record-alternatives">{alternatives.join(", ")}</div>}
      <blockquote className="record-sentence">{record.sentence || "—"}</blockquote>
      <div className="record-meta">
        <time>{formatRecordDate(record.createdAt)}</time>
        {record.pageUrl && <a href={record.pageUrl} target="_blank" rel="noreferrer" title={record.pageUrl}>{record.pageTitle || recordHostname(record.pageUrl)}</a>}
        <span className="record-actions">
          <button className="edit-record" type="button" title="Редактировать запись" aria-label={`Редактировать перевод «${record.text}»`} onClick={() => setEditing(true)}><EditIcon /></button>
          <button className="delete-record" type="button" title="Удалить запись" aria-label={`Удалить перевод «${record.text}»`} onClick={onDelete}><TrashIcon /></button>
        </span>
      </div>
    </li>
  );
}

function RecordEditor({record, onCancel, onSave}: {record: TranslationRecord; onCancel: () => void; onSave: (record: TranslationRecord) => Promise<void>}) {
  const [draft, setDraft] = useState({
    text: record.text,
    translation: record.translation,
    transcription: record.transcription || "",
    sentence: record.sentence,
    contextTranslation: record.contextTranslation || (record.text.trim().split(/\s+/).length > 3 ? record.translation : ""),
    pageTitle: record.pageTitle,
    pageUrl: record.pageUrl,
    translations: uniqueTranslationForms([record.translation, ...record.translations]).slice(1).join("\n")
  });
  const [saving, setSaving] = useState(false);
  const change = (field: keyof typeof draft, value: string) => setDraft((current) => ({...current, [field]: value}));

  const save = async () => {
    if (!draft.text.trim() || !draft.translation.trim()) return;
    const alternatives = draft.translations.split("\n").map((value) => value.trim()).filter(Boolean);
    const primaryTranslation = draft.translation.trim();
    const updated: TranslationRecord = {
      ...record,
      text: draft.text.trim(),
      translation: primaryTranslation,
      transcription: draft.transcription.trim() || null,
      sentence: draft.sentence.trim(),
      contextTranslation: draft.contextTranslation.trim() || null,
      pageTitle: draft.pageTitle.trim(),
      pageUrl: draft.pageUrl.trim(),
      translations: [primaryTranslation, ...alternatives.filter((value) => value !== primaryTranslation)]
    };
    setSaving(true);
    try { await onSave(updated); } finally { setSaving(false); }
  };

  return (
    <li className="history-record record-editor">
      <div className="editor-grid">
        <EditorField className="wide" label="Оригинал" value={draft.text} required onChange={(value) => change("text", value)} />
        <EditorField className="wide" label="Перевод" value={draft.translation} required onChange={(value) => change("translation", value)} />
        <EditorField className="wide" label="Транскрипция" value={draft.transcription} onChange={(value) => change("transcription", value)} />
        <EditorField className="wide" label="Контекст" value={draft.sentence} rows={3} onChange={(value) => change("sentence", value)} />
        <EditorField className="wide" label="Перевод контекста" value={draft.contextTranslation} rows={3} onChange={(value) => change("contextTranslation", value)} />
        <EditorField className="wide" label="Другие варианты перевода — по одному на строке" value={draft.translations} rows={3} onChange={(value) => change("translations", value)} />
        <EditorField label="Название источника" value={draft.pageTitle} onChange={(value) => change("pageTitle", value)} />
        <EditorField label="Ссылка на источник" value={draft.pageUrl} onChange={(value) => change("pageUrl", value)} />
      </div>
      <div className="editor-actions">
        <button className="cancel-edit" type="button" disabled={saving} onClick={onCancel}>Отмена</button>
        <button className="save-edit" type="button" disabled={saving || !draft.text.trim() || !draft.translation.trim()} onClick={() => void save()}>{saving ? "Сохранение…" : "Сохранить"}</button>
      </div>
    </li>
  );
}

function EditorField({label, value, onChange, rows = 2, required = false, className = ""}: {label: string; value: string; onChange: (value: string) => void; rows?: number; required?: boolean; className?: string}) {
  return (
    <label className={className}>
      <span>{label}</span>
      <textarea value={value} required={required} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ExportView({recordsCount, exporting, onExport}: {recordsCount: number; exporting: ExportFormat | null; onExport: (format: ExportFormat) => void}) {
  return (
    <>
      <PageHeading title="Экспорт" description={`${pluralizeRecords(recordsCount)} доступно для скачивания.`} />
      <section className="export-panel">
        <h2>Выберите формат</h2>
        <div className="export-grid">
          {exportFormats.map(({format, label}) => (
            <button key={format} type="button" disabled={!recordsCount || exporting !== null} onClick={() => onExport(format)}>
              <span className="format-icon">{label.split(" ").at(-1)?.slice(0, 4)}</span>
              <span><strong>{label}</strong><small>{exporting === format ? "Подготовка…" : "Скачать файл"}</small></span>
              <DownloadIcon />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function HelpView({onOpenSettings, onOpenHistory, onOpenExport}: {onOpenSettings: (section: string) => void; onOpenHistory: () => void; onOpenExport: () => void}) {
  const [historyRecordLimit, setHistoryRecordLimit] = useState(MAX_HISTORY_RECORDS);
  useEffect(() => {
    void getExtensionSettings().then((settings) => setHistoryRecordLimit(settings.historyRecordLimit)).catch(() => {});
  }, []);
  return (
    <div className="help-page">
<PageHeading title="Как пользоваться" description="Практическое руководство по использованию расширения" />

      <section className="help-section help-hero help-task-hero help-reading-hero" id="help-reading" aria-labelledby="help-reading-title">
        <div className="help-section-heading help-reading-heading"><h2 id="help-reading-title">Читайте текст на иностранном языке</h2><p>Используйте перевод выделения, чтобы мгновенно перевести любое слово или выражение прямо в тексте.</p></div>
        <div className="help-reading-overview">
          <div className="help-hero-copy">
            <h3 id="quick-start-title">Выделите фразу — и сразу увидите перевод</h3>
            <ol className="quick-steps">
              <li><span>1</span><div><strong>Откройте любую веб-страницу</strong><p>Статья, документация, письмо или учебный материал — подойдёт любой доступный сайт.</p></div></li>
              <li><span>2</span><div><strong>Выделите нужный текст</strong><p>Можно выбрать одно слово, фразу или целый абзац.</p></div></li>
              <li><span>3</span><div><strong>Ознакомьтесь с переводом</strong><p>В окне появятся перевод, транскрипция, озвучка и перевод контекста.</p></div></li>
            </ol>
          </div>
          <SelectionHelpExample />
        </div>
      </section>

      <div className="help-card-grid help-reading-details">
        <article className="help-card">
          <div className="help-card-heading"><div className="help-card-icon"><SoundIcon /></div><h3>Транскрипция и озвучка</h3></div>
          <p className="help-card-description">Транскрипция подскажет, как читается выделенное слово. А озвучка позволит услышать его произношение на заданной <a className="help-text-link" href="#settings/speech-rate" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenSettings("speech-rate"); }}>скорости</a>.</p>
        </article>
        <article className="help-card">
          <div className="help-card-heading"><div className="help-card-icon"><TextIcon /></div><h3>Перевод контекста</h3></div>
          <p className="help-card-description">Помимо перевода самого слова, вы увидите перевод всего предложения, в котором оно встретилось. Так проще понять значение слова в контексте.</p>
        </article>
      </div>
      <div className="help-callout"><InfoIcon /><div><strong>Не хотите, чтобы окно с переводом открывалось при каждом выделении?</strong><p>Настройте активацию перевода: горячими клавишами, кликом по отдельной кнопке или через контекстное меню.</p></div><button type="button" onClick={() => onOpenSettings("general")}>Настроить активацию перевода</button></div>

      <section className="help-section" id="help-writing">
        <div className="help-hero help-task-hero">
          <div className="help-section-heading"><h2>Вызывайте переводчик на любой странице</h2><p>Откройте переводчик поверх текущей страницы, выполните перевод и вернитесь к работе в той же вкладке</p></div>
          <TranslatorHelpExample />
        </div>
        <div className="workflow-card">
          <div className="workflow-step"><span>1</span><div><h3>Вызовите переводчик</h3><p>Используйте горячие клавиши. Посмотреть комбинацию клавиш по умолчанию или задать свою можно в <a className="help-text-link" href="#settings/translator-shortcuts" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenSettings("translator-shortcuts"); }}>настройках</a>.</p></div></div>
          <div className="workflow-arrow" aria-hidden="true">→</div>
          <div className="workflow-step"><span>2</span><div><h3>Выберите языки</h3><p>Вы можете задать <a className="help-text-link" href="#settings/translator-languages" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenSettings("translator-languages"); }}>языки по умолчанию</a>. Исходный язык и язык результата для переводчика настраиваются отдельно от языка перевода по выделению.</p></div></div>
          <div className="workflow-arrow" aria-hidden="true">→</div>
          <div className="workflow-step"><span>3</span><div><h3>Введите текст</h3><p>Напечатайте фразу или вставьте её из буфера обмена. Затем скопируйте перевод и используйте на странице.</p></div></div>
        </div>
        <div className="help-callout"><InfoIcon /><div><strong>Хотите видеть старый перевод при повторном открытии переводчика?</strong><p>Включите опцию «Сохранять предыдущий текст при повторном открытии переводчика». Введённый текст и его перевод будут доступны, когда вы снова откроете окно.</p></div><button type="button" onClick={() => onOpenSettings("translator-text")}>Настроить сохранение текста</button></div>
      </section>

      <section className="help-section" id="help-listening">
        <div className="help-hero help-task-hero">
          <div className="help-section-heading"><h2>Тренируйте произношение и восприятие на слух</h2><p>Расширение показывает транскрипцию и озвучивает исходный фрагмент.</p></div>
          <SpeechHelpExample />
          <LongSpeechHelpExample />
        </div>
        <div className="help-card-grid help-card-grid-three">
          <article className="help-mini-card"><span className="mini-card-number">01</span><h3>Посмотрите транскрипцию</h3><p>Она отображается рядом с исходным текстом, если доступна для выбранного языка.</p></article>
          <article className="help-mini-card"><span className="mini-card-number">02</span><h3>Прослушайте оригинал</h3><p>Нажмите кнопку озвучки в окне перевода рядом с транскрипцией.</p></article>
          <article className="help-mini-card"><span className="mini-card-number">03</span><h3>Подберите темп</h3><p>В разделе «Звук» в настройках установите скорость от 0,3× до 2×.</p></article>
        </div>
        <div className="help-callout"><InfoIcon /><div><strong>Не видите транскрипцию или кнопку озвучки?</strong><p>Проверьте, включены ли опции «Транскрипция» и «Озвучка» в разделе «Звук» в настройках.</p></div><button type="button" onClick={() => onOpenSettings("sound")}>Открыть настройки звука</button></div>
      </section>

      <section className="help-section" id="help-vocabulary">
        <div className="help-hero help-task-hero">
          <div className="help-section-heading"><h2>Собирайте личный словарь</h2><p>Переводы сохраняются у вас локально вместе с контекстом, транскрипцией, источником и датой.</p></div>
          <HistoryHelpExample />
        </div>
        <div className="vocabulary-layout">
          <article className="help-card vocabulary-main"><h3>Организуйте рабочий процесс</h3><ul className="check-list"><li><CheckIcon /><span><strong>Автосохранение</strong> — каждый перевод сразу попадает в историю.</span></li><li><CheckIcon /><span><strong>Ручное сохранение</strong> — в словарь попадают только выбранные вами записи.</span></li><li><CheckIcon /><span><strong>Редактирование</strong> — уточняйте перевод, контекст, транскрипцию и источник.</span></li><li><CheckIcon /><span><strong>Повторение</strong> — возвращайтесь к сохранённым словам в любой момент.</span></li></ul></article>
          <div className="vocabulary-actions"><button type="button" onClick={onOpenHistory}><HistoryIcon /><span><strong>Открыть историю</strong><small>Просмотреть и отредактировать записи</small></span><ArrowIcon /></button><button type="button" onClick={() => onOpenSettings("saving")}><BookmarkIcon /><span><strong>Настроить сохранение</strong><small>Автосохранение и ротация истории</small></span><ArrowIcon /></button></div>
        </div>
        <div className="help-callout"><InfoIcon /><div><strong>Хотите сохранять только нужные переводы?</strong><p>Отключите автосохранение в настройках. Появится кнопка «Сохранить» для ручного добавления в словарь в окне перевода.</p></div><button type="button" onClick={() => onOpenSettings("saving")}>Настроить сохранение</button></div>
      </section>

      <section className="help-section">
        <div className="help-hero help-task-hero">
          <div className="help-section-heading"><h2>Переносите переводы в другие приложения</h2><p>Экспортируйте всю историю в подходящем формате. Файл создаётся по вашему запросу и сохраняется через браузер.</p></div>
          <ExportHelpExample />
        </div>
        <div className="help-callout"><InfoIcon /><div><strong>Готовы скачать свой словарь?</strong><p>Откройте экспорт, выберите формат и скачайте файл со всей историей переводов.</p></div><button type="button" onClick={onOpenExport}>Перейти к экспорту</button></div>
      </section>

      <section className="help-section help-troubleshooting">
        <div className="help-hero help-task-hero">
          <div className="help-section-heading"><span>Если что-то не работает</span><h2>Частые вопросы</h2></div>
          <div className="faq-list">
            <details><summary>Окно перевода не появляется после выделения</summary><p>{translate("Проверьте настройку «Показывать окно перевода». Если включена активация горячими клавишами, после выделения нужно нажать назначенную комбинацию. Обновите вкладку после установки или обновления расширения.")} {translate("Расширения не запускаются на внутренних страницах браузера, таких как")} <code>chrome://…</code>.</p></details>
            <details><summary>Перевод или озвучивание не загружается</summary><p>Этим функциям нужен интернет. Проверьте соединение и повторите попытку. Некоторые сайты также могут ограничивать работу встроенных элементов; в таком случае откройте другой сайт и сравните результат.</p></details>
            <details><summary>Новая запись не появилась в истории</summary><p>{formatMessage("ui.check-the-saving-mode-in-manual-mode-click-save-in-the-translation-window-if-rotation-is-disabled-and-the-5-000-record-limit-has-been-reached-delete-unneeded-records-or-enable-automatic-rotation", {count: String(historyRecordLimit)})}</p></details>
            <details><summary>Горячая клавиша конфликтует с сайтом или браузером</summary><p>Откройте «Активация», нажмите кнопку с текущей комбинацией и задайте другую с Ctrl, Alt, Shift или Meta. Выбирайте сочетание, которое не используется браузером и текущим сайтом.</p></details>
            <details><summary>Где хранятся мои данные?</summary><p>История, настройки и кэш хранятся локально на вашем устройстве. Удаляйте отдельные записи в истории, очищайте весь список одной кнопкой или удалите данные расширения средствами браузера.</p></details>
          </div>
        </div>
      </section>

      <footer className="help-footer"><div><span className="brand-mark" aria-hidden="true">A<span>а</span></span><p><strong>Готовы попробовать?</strong><br />Откройте любую статью и выделите незнакомую фразу.</p></div><button type="button" onClick={() => onOpenSettings("general")}>Проверить горячие клавиши</button></footer>
    </div>
  );
}

function AnimatedHelpExample({className, children, onPlayingChange}: {className: string; children: ReactNode; onPlayingChange?: (playing: boolean) => void}) {
  const figureRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!preference) return;
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setInView(false);
    if (reducedMotion || !figureRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting && entry.intersectionRatio >= 0.25);
    }, {threshold: [0, 0.25], rootMargin: "-76px 0px 0px"});
    observer.observe(figureRef.current);
    return () => observer.disconnect();
  }, [reducedMotion]);
  useEffect(() => {
    onPlayingChange?.(inView && !reducedMotion);
  }, [inView, reducedMotion, onPlayingChange]);
  return (
    <figure ref={figureRef} className={`help-visual-example ${className}${inView && !reducedMotion ? " help-demo-playing" : ""}`}>
      {children}
    </figure>
  );
}

function DemoCursor() {
  return <svg className="help-demo-cursor" viewBox="0 0 24 28" aria-hidden="true"><path d="M3 2v21l5-5 4 8 4-2-4-8h8Z" fill="#fff" stroke="#315be8" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

function SelectionHelpExample() {
  const example = helpExamples();
  return (
    <AnimatedHelpExample className="help-selection-example">
      <div className="help-visual-canvas" aria-hidden="true">
        <div className="visual-browser">
          <div className="visual-browser-toolbar"><i /><i /><i /><span>learn.example.com/article</span></div>
          <div className="visual-article" translate="no" lang={example.sourceLanguage} dir="ltr">
            <b>{example.selection.title}</b>
            <span className="visual-line visual-line-long" /><span className="visual-line visual-line-medium" />
            <p>{example.selection.before}<mark>{example.selection.source}<DemoCursor /></mark>{example.selection.after}</p>
            <span className="visual-line visual-line-short" />
          </div>
          <div className="visual-selection-popup">
            <div className="visual-popup-source" translate="no" lang={example.sourceLanguage} dir="ltr"><span><strong>{example.selection.source}</strong><small>{example.selection.transcription}</small></span><em>▶</em></div>
            <div className="visual-popup-divider" />
            <strong className="visual-popup-result" translate="no" lang={example.targetLanguage} dir={example.targetDirection}>{example.selection.translation}</strong>
            <small translate="no" dir="ltr">{example.directionLabel}</small>
          </div>
        </div>
      </div>
    </AnimatedHelpExample>
  );
}

function exampleTypingStyle(text: string, direction: string): CSSProperties {
  return {
    "--typing-start": direction === "rtl" ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)",
    animationTimingFunction: `steps(${Math.max(1, [...text].length)}, end)`
  } as CSSProperties;
}

function TranslatorHelpExample() {
  const example = helpExamples();
  return (
    <AnimatedHelpExample className="help-translator-example">
      <figcaption>
        <strong>Откройте переводчик горячими клавишами</strong>
        <ul className="check-list help-translator-features">
          <li><CheckIcon /><span>Доступно <strong>{TRANSLATION_LANGUAGES.length} языков</strong> для перевода.</span></li>
          <li><CheckIcon /><span>Смена языков горячими клавишами.</span></li>
          <li><CheckIcon /><span>Сочетания клавиш можно настроить под себя.</span></li>
        </ul>
      </figcaption>
      <div className="help-visual-canvas visual-translator-scene" aria-hidden="true">
        <div className="visual-translator-page">
          <div className="visual-browser-toolbar"><i /><i /><i /><span>mail.example.com/inbox</span></div>
          <div className="visual-mail-title"><span><Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></Icon>Новое письмо</span><i>− ×</i></div>
          <div className="visual-mail-meta"><small>Кому</small><span className="visual-mail-recipient" translate="no" dir="ltr"><b>A</b>alex@example.com</span></div>
          <div className="visual-mail-meta"><small>Тема</small><span translate="no" lang={example.email.targetLanguage} dir={example.email.targetDirection}>{example.email.subject}</span></div>
          <div className="visual-compose-field">
            <small>Сообщение</small>
            <p className="visual-page-draft" lang={example.email.targetLanguage} translate="no" dir={example.email.targetDirection}>
              <span className="visual-draft-initial" style={exampleTypingStyle(example.email.prefix, example.email.targetDirection)}>{example.email.prefix}</span><span className="visual-draft-updated" style={exampleTypingStyle(example.email.translation, example.email.targetDirection)}>{example.email.translation}</span><span className="visual-draft-document" style={exampleTypingStyle(example.email.suffix, example.email.targetDirection)}>{example.email.suffix}</span>
            </p>
          </div>
          <div className="visual-mail-footer"><span>Отправить<ArrowIcon /></span><TrashIcon /></div>
        </div>
        <div className="visual-shortcut-keys"><small>Комбинация клавиш</small><span><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>'</kbd></span></div>
        <div className="visual-translator-window">
          <div className="visual-translator-header"><strong>Переводчик</strong><span>Ctrl + Shift + '</span><i>×</i></div>
          <div className="visual-language-row" dir="ltr"><span><bdi translate="no">{example.email.sourceName}</bdi><span aria-hidden="true">⌄</span></span><b>⇄</b><span><bdi translate="no">{example.email.targetName}</bdi><span aria-hidden="true">⌄</span></span></div>
          <div className="visual-translator-panes" dir="ltr">
            <div dir={example.targetDirection}><small>Исходный текст</small><p className="visual-translator-input" lang={example.email.sourceLanguage} translate="no" dir={example.email.sourceDirection} style={exampleTypingStyle(example.email.source, example.email.sourceDirection)}>{example.email.source}</p><i className="visual-copy-icon" /></div>
            <div dir={example.targetDirection}><small>Перевод</small><p lang={example.email.targetLanguage} translate="no" dir={example.email.targetDirection}>{example.email.translation}</p><i className="visual-copy-icon"><span className="visual-copy-check">✓</span><svg className="visual-copy-cursor" viewBox="0 0 24 28"><path d="M3 2v21l5-5 4 8 4-2-4-8h8Z" fill="#fff" stroke="#315be8" strokeWidth="1.8" strokeLinejoin="round" /></svg></i></div>
          </div>
        </div>
      </div>
    </AnimatedHelpExample>
  );
}

function SpeechHelpExample() {
  const example = helpExamples();
  return (
    <figure className="help-visual-example help-speech-example">
      <div className="help-visual-canvas" aria-hidden="true">
        <div className="visual-speech-card">
          <div className="visual-speech-top"><span translate="no" lang={example.sourceLanguage} dir="ltr"><strong>{example.speech.source}</strong><small>{example.speech.transcription}</small></span><i>■</i></div>
          <p className="visual-speech-translation" translate="no" lang={example.targetLanguage} dir={example.targetDirection}>{example.speech.translation}</p>
          <div className="visual-waveform">{[14, 25, 18, 34, 28, 43, 22, 38, 30, 18, 27, 13].map((height, index) => <span key={index} style={{height}} />)}</div>
          <div className="visual-speech-progress"><span /><i /></div>
          <div className="visual-speed"><span>Медленнее</span><strong>0,8×</strong><span>Быстрее</span></div>
        </div>
      </div>
      <figcaption>
        <strong>Практикуйтесь в удобном темпе</strong>
        <ul className="check-list help-translator-features">
          <li><CheckIcon /><span>Слушайте, следите за транскрипцией и меняйте темп</span></li>
          <li><CheckIcon /><span>Для сложной фразы начните с 0,8×, затем вернитесь к обычной скорости.</span></li>
        </ul>
      </figcaption>
    </figure>
  );
}

function LongSpeechHelpExample() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const card = cardRef.current;
    if (!playing || !card) return;
    const wordElements = Array.from(card.querySelectorAll(".visual-long-speech-text > span"));
    const timing = {duration: 16000, iterations: Infinity};
    const animations = wordElements.map((word, index) => word.animate([
      {backgroundSize: "0% 100%", offset: 0},
      {backgroundSize: "0% 100%", offset: 0.12 + index / wordElements.length * 0.76},
      {backgroundSize: "100% 100%", offset: 0.12 + (index + 1) / wordElements.length * 0.76},
      {backgroundSize: "100% 100%", offset: 1}
    ], timing));
    for (const [selector, property] of [[".visual-long-speech-track > span", "width"], [".visual-long-speech-track > i", "left"]]) {
      const element = card.querySelector(selector);
      if (element) animations.push(element.animate([
        {[property]: "0%", offset: 0},
        {[property]: "0%", offset: 0.12},
        {[property]: "100%", offset: 0.88},
        {[property]: "100%", offset: 1}
      ], timing));
    }
    return () => animations.forEach(animation => animation.cancel());
  }, [playing]);
  const words = "Every day brings a new opportunity to learn something interesting. Take your time, listen to the whole sentence, and notice how the words connect. With a little practice, understanding spoken English becomes easier and more natural.".split(" ");
  return (
    <AnimatedHelpExample className="help-long-speech-example" onPlayingChange={setPlaying}>
      <figcaption>
        <strong>Слушайте фрагмент целиком</strong>
        <ul className="check-list help-translator-features">
          <li><CheckIcon /><span>Следите за подсветкой текста по мере озвучивания.</span></li>
          <li><CheckIcon /><span>Выбирайте, откуда продолжить чтение: нажмите на нужное место в тексте или переместите ползунок.</span></li>
        </ul>
      </figcaption>
      <div className="help-visual-canvas" aria-hidden="true">
        <div className="visual-long-speech-card" ref={cardRef}>
          <div className="visual-long-speech-heading"><span>Исходный текст · Английский</span><span className="visual-long-speech-button"><span className="visual-speech-play">▶</span><span className="visual-speech-stop">■</span><DemoCursor /></span></div>
          <p className="visual-long-speech-text" lang="en" dir="ltr" translate="no">{words.map((word, index) => <span key={index}>{word}{index < words.length - 1 ? " " : ""}</span>)}</p>
          <div className="visual-long-speech-controls"><SoundIcon /><div className="visual-long-speech-track"><span /><i /></div><span>1×</span></div>
        </div>
      </div>
    </AnimatedHelpExample>
  );
}

function HistoryHelpExample() {
  const example = helpExamples();
  return (
    <figure className="help-visual-example help-history-example">
      <div className="help-visual-canvas" aria-hidden="true">
        <div className="visual-history-window">
          <div className="visual-history-heading"><span><strong>История переводов</strong><small>24 записи</small></span><em>Экспорт</em></div>
          <div className="visual-history-record">
            <div><strong translate="no" lang={example.sourceLanguage} dir="ltr">{example.history.source}</strong><span translate="no" lang={example.targetLanguage} dir={example.targetDirection}>{example.history.translation}</span></div><i translate="no" dir="ltr">{example.history.transcription}</i>
            <p translate="no" lang={example.sourceLanguage} dir="ltr">{example.history.sentence}</p>
            <footer><div><span>example.com</span><span>Сегодня, 14:32</span></div><div className="visual-history-actions"><span><EditIcon /></span><span><TrashIcon /></span></div></footer>
          </div>
        </div>
      </div>
      <figcaption>
        <strong>Всё нужное для повторения хранится вместе</strong>
        <ul className="check-list help-translator-features">
          <li><CheckIcon /><span>Оригинал, перевод, контекст, источник и дата доступны в одной карточке.</span></li>
          <li><CheckIcon /><span>Редактируйте любое поле карточки, чтобы уточнять и дополнять записи.</span></li>
        </ul>
      </figcaption>
    </figure>
  );
}

function ExportHelpExample() {
  const [playing, setPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const variants = [
    {title: "Карточки для повторения", formats: ["Anki CSV", "Anki TSV"], description: "Импортируйте слова в Anki и повторяйте их по расписанию.", color: "#9b4b23", tint: "#fff2e8", kind: "anki"},
    {title: "Таблицы и анализ", formats: ["XLSX", "CSV", "TSV"], description: "Открывайте переводы в Excel и Google Таблицах, сортируйте и фильтруйте записи.", color: "#237a56", tint: "#eaf7ef", kind: "table"},
    {title: "Чтение и печать", formats: ["PDF", "HTML", "MD", "TXT"], description: "Сохраняйте словарь для чтения, заметок и печати.", color: "#315be8", tint: "#edf2ff", kind: "document"},
    {title: "Структурированные данные", formats: ["JSON"], description: "Используйте данные записей в собственных инструментах и технических сценариях.", color: "#8050b8", tint: "#f4edfc", kind: "json"}
  ];
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setActiveIndex(index => (index + 1) % variants.length), 3600);
    return () => window.clearTimeout(timer);
  }, [playing, activeIndex, selectionRevision, variants.length]);
  const active = variants[activeIndex];
  return (
    <AnimatedHelpExample className="help-export-example" onPlayingChange={setPlaying}>
      <div className="help-visual-canvas">
        <div className="visual-export-window" style={{"--export-accent": active.color, "--export-tint": active.tint} as CSSProperties}>
          <div className="visual-export-toolbar"><i /><i /><i /><span>Flexilize · Форматы экспорта</span></div>
          <div className="visual-export-content">
            <div className="visual-export-formats">
              {variants.map((variant, index) => <button type="button" key={variant.kind} className={index === activeIndex ? "visual-export-selected" : ""} aria-pressed={index === activeIndex} onClick={() => { setActiveIndex(index); setSelectionRevision(revision => revision + 1); }}>
                <b translate="no">{variant.formats.join(" · ")}</b><small>{variant.title}</small>
              </button>)}
            </div>
            <div className="visual-export-preview" key={active.kind}>
              <div className="visual-export-preview-copy">
                <div className="visual-export-preview-heading"><strong>{active.title}</strong><span translate="no">{active.formats[0]}</span></div>
                <p>{active.description}</p>
              </div>
              <div className={`visual-export-sample visual-export-sample-${active.kind}`} translate="no">
                {active.kind === "anki" && <div className="visual-export-flashcards"><div><small>Лицевая сторона</small><strong>journey</strong><span>/ˈdʒɜːni/</span></div><div><small>Обратная сторона</small><strong>путешествие</strong><span>Every journey starts with a single step.</span></div></div>}
                {active.kind === "table" && <table><thead><tr><th>Оригинал</th><th>Перевод</th></tr></thead><tbody><tr><td>journey</td><td>путешествие</td></tr><tr><td>discover</td><td>открывать</td></tr><tr><td>curiosity</td><td>любознательность</td></tr></tbody></table>}
                {active.kind === "document" && <div className="visual-export-document"><small>МОЙ СЛОВАРЬ</small><strong>journey — путешествие</strong><span>/ˈdʒɜːni/</span><p>Every journey starts with a single step.</p><i /><i /></div>}
                {active.kind === "json" && <pre>{'{\n  "text": "journey",\n  "translation": "путешествие",\n  "transcription": "/ˈdʒɜːni/",\n  "sentence": "Every journey starts…"\n}'}</pre>}
              </div>
            </div>
            <div className="visual-export-pagination">{variants.map((variant, index) => <i key={variant.kind} className={index === activeIndex ? "active" : ""} />)}</div>
          </div>
        </div>
      </div>
    </AnimatedHelpExample>
  );
}

function Icon({children}: {children: ReactNode}) { return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>; }
function MenuIcon() { return <Icon><path d="M4 6h16M4 12h16M4 18h16"/></Icon>; }
function CloseIcon() { return <Icon><path d="m6 6 12 12M18 6 6 18"/></Icon>; }
function HistoryIcon() { return <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></Icon>; }
function SlidersIcon() { return <Icon><path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></Icon>; }
function SettingsIcon() { return <Icon><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.4 1.6H9.55A1.7 1.7 0 0 0 8.4 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-1.6-1.4V9.55A1.7 1.7 0 0 0 4 8.4a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.46 3.6l.06.06A1.7 1.7 0 0 0 8.4 4a1.7 1.7 0 0 0 1.4-1.6h4.05A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 1.6 1.4v4.05A1.7 1.7 0 0 0 19.4 15Z"/></Icon>; }
function LanguagesIcon() { return <Icon><path d="M4 5h9M8.5 3v2M6 9c1.6 2.3 3.6 4 6.2 5.1M11.5 5C10.4 9.4 7.9 12.5 4 14.2M14 20l3-8 3 8M15 17.5h4"/></Icon>; }
function BookmarkIcon() { return <Icon><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"/></Icon>; }
function SoundIcon() { return <Icon><path d="M5 9v6h4l5 4V5L9 9H5Z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"/></Icon>; }
function DownloadIcon() { return <Icon><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16"/></Icon>; }
function EditIcon() { return <Icon><path d="m4 16-.8 4.8L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></Icon>; }
function TrashIcon() { return <Icon><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></Icon>; }
function HelpIcon() { return <Icon><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.2 1-1.2 1.9M12 17h.01"/></Icon>; }
function StarIcon() { return <Icon><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></Icon>; }
function MessageIcon() { return <Icon><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.6-3.2A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01"/></Icon>; }
function UploadIcon() { return <Icon><path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></Icon>; }
function ReadingIcon() { return <Icon><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H4V5.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h3V5.5Z"/></Icon>; }
function KeyboardIcon() { return <Icon><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M18 10h.01M7 14h.01M10 14h7"/></Icon>; }
function CursorIcon() { return <Icon><path d="m5 3 6.5 16 2.2-5.3L19 11.5 5 3Z"/></Icon>; }
function LightningIcon() { return <Icon><path d="m13 2-9 12h7l-1 8 11-13h-7l-1-7Z"/></Icon>; }
function TextIcon() { return <Icon><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/></Icon>; }
function InfoIcon() { return <Icon><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></Icon>; }
function CheckIcon() { return <Icon><path d="m5 12 4 4L19 6"/></Icon>; }
function ArrowIcon() { return <Icon><path d="M5 12h14M14 7l5 5-5 5"/></Icon>; }

const optionsRoot = createRoot(document.getElementById("root")!);
let stopLocalizing: (() => void) | undefined;
let optionsRenderVersion = 0;

function changeOptionsLanguage(language: InterfaceLanguage) {
  stopLocalizing?.();
  setActiveLanguage(language);
  document.title = translate("Context Translator — настройки", language);
  stopLocalizing = observeLocalizedDom(document, language);
}

function renderOptions(language: InterfaceLanguage) {
  changeOptionsLanguage(language);
  optionsRoot.render(<App key={++optionsRenderVersion} />);
}

async function startApp() {
  let language: InterfaceLanguage = "ru";
  try {
    language = (await getExtensionSettings()).interfaceLanguage;
  } catch (_error) {
    // Keep the default language when storage is unavailable.
  }
  await loadInterfaceLanguage(language);
  renderOptions(language);
}

void startApp();
