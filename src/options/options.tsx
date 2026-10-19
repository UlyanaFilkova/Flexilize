import {useEffect, useState, type ReactNode} from "react";
import {createRoot} from "react-dom/client";
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
import {MAX_HISTORY_RECORDS} from "../history-config";
import {
  defaultSettings,
  formatShortcut,
  getExtensionSettings,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  normalizeSpeechRate,
  saveExtensionSettings,
  shortcutFromKeyboardEvent,
  SPEECH_RATE_STEP,
  TRANSLATION_LANGUAGES,
  type ExtensionSettings
} from "../settings";
import "./options.css";

type Page = "settings" | "history";
type HistorySection = "records" | "export";
type Route = Page | "export";
type Notice = {message: string; undo?: () => Promise<void>};

const routeHashes: Record<Route, string> = {
  settings: "#settings",
  history: "#history",
  export: "#export"
};

const settingsSidebarItems = [
  {id: "general", label: "Горячие клавиши", icon: <SlidersIcon />},
  {id: "translation", label: "Перевод", icon: <LanguagesIcon />},
  {id: "sound", label: "Звук", icon: <SoundIcon />},
  {id: "saving", label: "Сохранение", icon: <BookmarkIcon />}
];

function routeFromHash(): Route {
  return (Object.entries(routeHashes).find(([, hash]) => hash === location.hash)?.[0] as Route) || "settings";
}

function App() {
  const initialRoute = routeFromHash();
  const [page, setPage] = useState<Page>(initialRoute === "settings" ? "settings" : "history");
  const [settingsSection, setSettingsSection] = useState("general");
  const [historySection, setHistorySection] = useState<HistorySection>(initialRoute === "export" ? "export" : "records");
  const [records, setRecords] = useState<TranslationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

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
    setPage("history");
    setHistorySection(section);
    window.history.replaceState(null, "", routeHashes[section === "records" ? "history" : "export"]);
  };

  const openSettingsSection = (section: string) => {
    setPage("settings");
    setSettingsSection(section);
    window.history.replaceState(null, "", routeHashes.settings);
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
    if (!records.length || !confirm("Удалить все сохранённые переводы?")) return;
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Context Translator">
          <span className="brand-mark" aria-hidden="true">A<span>а</span></span>
          <span>Context Translator</span>
        </div>

      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Навигация">
          <div className="sidebar-heading">Переводы</div>
          <nav>
            <button className={page === "history" && historySection === "records" ? "active" : ""} type="button" onClick={() => openHistorySection("records")}>
              <HistoryIcon /><span>История</span>
            </button>
            <button className={page === "history" && historySection === "export" ? "active" : ""} type="button" onClick={() => openHistorySection("export")}>
              <DownloadIcon /><span>Экспорт</span>
            </button>
          </nav>
          <div className="sidebar-heading sidebar-section-heading">Настройки</div>
          <nav>
            {settingsSidebarItems.map((item) => (
              <button key={item.id} className={page === "settings" && settingsSection === item.id ? "active" : ""} type="button" onClick={() => openSettingsSection(item.id)}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer"><span className="status-dot" aria-hidden="true" />Расширение активно</div>
        </aside>

        <main className="content">
          {page === "settings" ? (
            <>
              <PageHeading title="Настройки" description="Персонализируйте работу расширения под себя." />
              {settingsSection === "general"
                ? <GeneralSettings />
                : settingsSection === "translation"
                  ? <TranslationSettings />
                : settingsSection === "sound"
                  ? <SoundSettings />
                : settingsSection === "saving"
                  ? <SavingSettings />
                  : <section className="empty-panel" aria-label="Область настроек"><div className="empty-panel-accent" /></section>}
            </>
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

function PageHeading({title, description, action}: {title: string; description: string; action?: ReactNode}) {
  return <div className="content-heading-row"><div className="content-heading"><span className="eyebrow">Context Translator</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function GeneralSettings() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [recording, setRecording] = useState(false);
  const [translatorRecording, setTranslatorRecording] = useState(false);
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

  return (
    <>
      <div className="settings-group">
        <h2 className="settings-group-title">Перевод выделенного текста</h2>
        <section className="settings-panel settings-panel-grouped" aria-label="Горячие клавиши перевода выделенного текста">
      <div className="setting-row">
        <div className="setting-copy">
          <h2>Активация горячими клавишами</h2>
          <p>Перевод будет запускаться только после нажатия выбранной комбинации на выделенном тексте.</p>
        </div>
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
      </div>

      <div className={`setting-row setting-row-secondary${settings?.hotkeyActivationEnabled ? "" : " setting-row-disabled"}`} aria-disabled={!settings?.hotkeyActivationEnabled}>
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
      </div>
        </section>
      </div>
      <div className="settings-group settings-group-following">
        <h2 className="settings-group-title">Переводчик</h2>
        <section className="settings-panel settings-panel-grouped" aria-label="Горячая клавиша переводчика">
          <div className="setting-row">
            <div className="setting-copy">
              <h2>Горячая клавиша переводчика</h2>
              <p>Открывает отдельное окно для ввода и перевода текста.</p>
            </div>
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
          {error && <div className="settings-error" role="alert">{error}</div>}
        </section>
      </div>
    </>
  );
}

function TranslationSettings() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [error, setError] = useState("");

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

  const languageOptions = [...TRANSLATION_LANGUAGES]
    .sort((left, right) => left[1].localeCompare(right[1], "ru"))
    .map(([code, label]) => <option key={code} value={code}>{label}</option>);

  return (
    <>
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
      <div className="settings-group settings-group-following">
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

function SavingSettings() {
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
    <section className="settings-panel" aria-label="Настройки сохранения">
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
      <div className="setting-row setting-row-secondary">
        <div className="setting-copy">
          <h2>Ротация истории</h2>
          <p>При добавлении новых переводов сверх лимита в {MAX_HISTORY_RECORDS} самые старые записи будут автоматически удалены из истории. Таким образом, общее количество записей в истории будет остается равным {MAX_HISTORY_RECORDS}.</p>
          <p>При выключенной ротации новые записи не будут сохраняться в историю, пока достигнут лимит в {MAX_HISTORY_RECORDS}.</p>
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
      {error && <div className="settings-error" role="alert">{error}</div>}
    </section>
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
      <div className={`setting-row setting-row-secondary${settings?.speechEnabled ? "" : " setting-row-disabled"}`} aria-disabled={!settings?.speechEnabled}>
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
      <div className="record-sentence">{record.sentence || "—"}</div>
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

function Icon({children}: {children: ReactNode}) { return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>; }
function HistoryIcon() { return <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></Icon>; }
function SlidersIcon() { return <Icon><path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></Icon>; }
function LanguagesIcon() { return <Icon><path d="M4 5h9M8.5 3v2M6 9c1.6 2.3 3.6 4 6.2 5.1M11.5 5C10.4 9.4 7.9 12.5 4 14.2M14 20l3-8 3 8M15 17.5h4"/></Icon>; }
function BookmarkIcon() { return <Icon><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"/></Icon>; }
function SoundIcon() { return <Icon><path d="M5 9v6h4l5 4V5L9 9H5Z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"/></Icon>; }
function DownloadIcon() { return <Icon><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16"/></Icon>; }
function EditIcon() { return <Icon><path d="m4 16-.8 4.8L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></Icon>; }
function TrashIcon() { return <Icon><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></Icon>; }

createRoot(document.getElementById("root")!).render(<App />);
