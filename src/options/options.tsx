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

type Page = "settings" | "history" | "help";
type HistorySection = "records" | "export";
type Route = "settings" | "history" | "export" | "help";
type Notice = {message: string; undo?: () => Promise<void>};

const routeHashes: Record<Route, string> = {
  settings: "#settings",
  history: "#history",
  export: "#export",
  help: "#help"
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
  const [page, setPage] = useState<Page>(initialRoute === "help" ? "help" : initialRoute === "settings" ? "settings" : "history");
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

  const openHelp = () => {
    setPage("help");
    window.history.replaceState(null, "", routeHashes.help);
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

  const settingsSectionTitle = settingsSidebarItems.find((item) => item.id === settingsSection)?.label || "Настройки";

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
          <div className="sidebar-heading sidebar-section-heading">Помощь</div>
          <nav>
            <button className={page === "help" ? "active" : ""} type="button" onClick={openHelp}>
              <HelpIcon /><span>Как пользоваться</span>
            </button>
          </nav>
          <div className="sidebar-footer"><span className="status-dot" aria-hidden="true" />Расширение активно</div>
        </aside>

        <main className="content">
          {page === "help" ? (
            <HelpView onOpenSettings={openSettingsSection} onOpenHistory={() => openHistorySection("records")} onOpenExport={() => openHistorySection("export")} />
          ) : page === "settings" ? (
            <>
              <PageHeading title={settingsSectionTitle} description="Настройте работу расширения под себя." />
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
            <h2>Показывать окно перевода</h2>
            <p>Если выключено, перевод от Context Translator не будет появляться на странице, но продолжит сохраняться в истории.</p>
            <p>Тогда вы сможете использовать другие расширения для мгновенного перевода, а Context Translator – для сохранения переводов.</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings?.showSelectionTranslationModal ?? true}
              disabled={!settings}
              onChange={(event) => settings && void persist({...settings, showSelectionTranslationModal: event.target.checked})}
            />
            <span aria-hidden="true" />
            <span className="sr-only">Показывать окно перевода</span>
          </label>
        </div>
        <div className="setting-row setting-row-secondary">
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

function HelpView({onOpenSettings, onOpenHistory, onOpenExport}: {onOpenSettings: (section: string) => void; onOpenHistory: () => void; onOpenExport: () => void}) {
  return (
    <div className="help-page">
      <PageHeading title="Как пользоваться" description="Практическое руководство: от первого перевода до личного словаря и экспорта в Anki." />

      <section className="help-hero" aria-labelledby="quick-start-title">
        <div className="help-hero-copy">
          <span className="help-kicker">Быстрый старт</span>
          <h2 id="quick-start-title">Первый перевод — за несколько секунд</h2>
          <ol className="quick-steps">
            <li><span>1</span><div><strong>Откройте обычную веб-страницу</strong><p>Статья, документация, письмо или учебный материал — подойдёт любой доступный сайт.</p></div></li>
            <li><span>2</span><div><strong>Выделите нужный текст</strong><p>Можно выбрать одно слово, фразу или целый абзац.</p></div></li>
            <li><span>3</span><div><strong>Изучите результат</strong><p>В окне появятся перевод, контекст, варианты значения, транскрипция и кнопка озвучивания.</p></div></li>
          </ol>
        </div>
        <div className="help-demo" aria-hidden="true">
          <div className="demo-browser-bar"><i /><i /><i /><span>example.com/article</span></div>
          <div className="demo-copy"><span /><span /><em>context matters</em><span /><span /></div>
          <div className="demo-translation"><small>EN → RU</small><strong>контекст имеет значение</strong><p>/ˈkɒntekst/</p><div><span>Слушать</span><span>Сохранено</span></div></div>
        </div>
      </section>

      <nav className="help-toc" aria-label="Содержание справки">
        <a href="#help-reading"><ReadingIcon /><span><strong>Чтение</strong><small>Перевод выделения</small></span></a>
        <a href="#help-writing"><KeyboardIcon /><span><strong>Переводчик</strong><small>Ввод своего текста</small></span></a>
        <a href="#help-listening"><SoundIcon /><span><strong>Произношение</strong><small>Транскрипция и звук</small></span></a>
        <a href="#help-vocabulary"><BookmarkIcon /><span><strong>Словарь</strong><small>История и экспорт</small></span></a>
      </nav>

      <section className="help-section" id="help-reading">
        <div className="help-section-heading"><span>Задача 01</span><h2>Читаете текст на иностранном языке</h2><p>Используйте перевод выделения, чтобы не переключаться между вкладками и не терять место в тексте.</p></div>
        <div className="help-card-grid">
          <article className="help-card"><div className="help-card-icon"><CursorIcon /></div><h3>Слово или короткая фраза</h3><ol><li>Выделите фрагмент мышью или клавиатурой.</li><li>Изучите основной и дополнительный перевод</li><li>Сверьте с переводом контекста.</li></ol><p className="help-tip"><strong>Совет:</strong> выделяйте слово прямо в предложении — расширение сохранит окружающий контекст вместе с переводом.</p></article>
          <article className="help-card"><div className="help-card-icon"><TextIcon /></div><h3>Предложение или абзац</h3><ol><li>Выделите текст целиком.</li><li>Для длинного фрагмента основным результатом станет перевод всего выделения.</li><li>Проверьте границы выделения, если смысл кажется неполным.</li></ol><p className="help-tip"><strong>Полезно для:</strong> статей, документации, учебников и деловой переписки.</p></article>
        </div>
        <div className="help-callout"><InfoIcon /><div><strong>Не хотите открывать окно при каждом выделении?</strong><p>Включите активацию горячими клавишами: тогда перевод запускается только после вашей комбинации. Это удобно при копировании и редактировании текста.</p></div><button type="button" onClick={() => onOpenSettings("general")}>Настроить клавиши</button></div>
      </section>

      <section className="help-section" id="help-writing">
        <div className="help-section-heading"><span>Задача 02</span><h2>Нужно перевести собственный текст</h2><p>Откройте отдельный переводчик поверх текущей страницы, напечатайте или вставьте текст и продолжайте работу в той же вкладке.</p></div>
        <div className="workflow-card">
          <div className="workflow-step"><span>1</span><div><h3>Вызовите переводчик</h3><p>Нажмите назначенную горячую клавишу. По умолчанию комбинацию можно посмотреть или изменить в настройках.</p></div></div>
          <div className="workflow-arrow" aria-hidden="true">→</div>
          <div className="workflow-step"><span>2</span><div><h3>Выберите языки</h3><p>Исходный язык и язык результата для переводчика настраиваются отдельно от перевода выделений.</p></div></div>
          <div className="workflow-arrow" aria-hidden="true">→</div>
          <div className="workflow-step"><span>3</span><div><h3>Введите текст</h3><p>Напечатайте фразу или вставьте её из буфера обмена, затем используйте готовый перевод.</p></div></div>
        </div>
        <button className="help-inline-link" type="button" onClick={() => onOpenSettings("translation")}><LanguagesIcon />Открыть настройки языков<ArrowIcon /></button>
      </section>

      <section className="help-section" id="help-listening">
        <div className="help-section-heading"><span>Задача 03</span><h2>Тренируете произношение и восприятие на слух</h2><p>Для поддерживаемых языков расширение показывает транскрипцию и озвучивает исходный фрагмент.</p></div>
        <div className="help-card-grid help-card-grid-three">
          <article className="help-mini-card"><span className="mini-card-number">01</span><h3>Посмотрите транскрипцию</h3><p>Она отображается рядом с исходным текстом, если доступна для выбранного языка и фрагмента.</p></article>
          <article className="help-mini-card"><span className="mini-card-number">02</span><h3>Прослушайте оригинал</h3><p>Нажмите кнопку звука в окне перевода и повторите фразу вслух.</p></article>
          <article className="help-mini-card"><span className="mini-card-number">03</span><h3>Подберите темп</h3><p>В разделе «Звук» установите скорость от 0,3× для разбора речи до 2× для тренировки.</p></article>
        </div>
        <button className="help-inline-link" type="button" onClick={() => onOpenSettings("sound")}><SoundIcon />Настроить звук и транскрипцию<ArrowIcon /></button>
      </section>

      <section className="help-section" id="help-vocabulary">
        <div className="help-section-heading"><span>Задача 04</span><h2>Собираете личный словарь</h2><p>Переводы сохраняются локально вместе с контекстом, источником и датой — их можно повторять, исправлять и выгружать.</p></div>
        <div className="vocabulary-layout">
          <article className="help-card vocabulary-main"><h3>Организуйте рабочий процесс</h3><ul className="check-list"><li><CheckIcon /><span><strong>Автосохранение</strong> — каждый перевод сразу попадает в историю.</span></li><li><CheckIcon /><span><strong>Ручное сохранение</strong> — в словарь попадают только выбранные вами записи.</span></li><li><CheckIcon /><span><strong>Редактирование</strong> — уточняйте перевод, контекст, транскрипцию и источник.</span></li><li><CheckIcon /><span><strong>Ротация</strong> — при лимите в 5000 записей старые переводы могут автоматически заменяться новыми.</span></li></ul></article>
          <div className="vocabulary-actions"><button type="button" onClick={onOpenHistory}><HistoryIcon /><span><strong>Открыть историю</strong><small>Просмотреть и отредактировать записи</small></span><ArrowIcon /></button><button type="button" onClick={() => onOpenSettings("saving")}><BookmarkIcon /><span><strong>Настроить сохранение</strong><small>Автосохранение и ротация истории</small></span><ArrowIcon /></button></div>
        </div>
      </section>

      <section className="help-section">
        <div className="help-section-heading"><span>Задача 05</span><h2>Переносите переводы в другие приложения</h2><p>Экспортируйте всю историю в подходящем формате. Файл создаётся по вашему запросу и сохраняется через браузер.</p></div>
        <div className="format-guide">
          <div><span>ANKI</span><h3>Для интервального повторения</h3><p>Anki CSV или Anki TSV — готовая основа для импорта карточек.</p></div>
          <div><span>XLSX · CSV · TSV</span><h3>Для таблиц и анализа</h3><p>Подойдут для Excel, Google Таблиц, сортировки и собственной обработки.</p></div>
          <div><span>PDF · HTML · MD · TXT</span><h3>Для чтения и печати</h3><p>Удобны для архива, заметок, печати и повторения без расширения.</p></div>
          <div><span>JSON</span><h3>Для резервной копии</h3><p>Сохраняет структурированные данные записей для технических сценариев.</p></div>
        </div>
        <button className="help-primary-action" type="button" onClick={onOpenExport}><DownloadIcon />Перейти к экспорту</button>
      </section>

      <section className="help-section help-troubleshooting">
        <div className="help-section-heading"><span>Если что-то не работает</span><h2>Частые вопросы</h2></div>
        <div className="faq-list">
          <details><summary>Окно перевода не появляется после выделения</summary><p>Проверьте настройку «Показывать окно перевода». Если включена активация горячими клавишами, после выделения нужно нажать назначенную комбинацию. Обновите вкладку после установки или обновления расширения. На служебных страницах браузера вида <code>chrome://…</code> расширения не запускаются.</p></details>
          <details><summary>Перевод или озвучивание не загружается</summary><p>Этим функциям нужен интернет. Проверьте соединение и повторите попытку. Некоторые сайты также могут ограничивать работу встроенных элементов; в таком случае откройте другой сайт и сравните результат.</p></details>
          <details><summary>Новая запись не появилась в истории</summary><p>Проверьте режим сохранения. При ручном режиме нажмите кнопку сохранения в окне перевода. Если ротация выключена и достигнут лимит 5000 записей, удалите ненужные записи или включите автоматическую ротацию.</p></details>
          <details><summary>Горячая клавиша конфликтует с сайтом или браузером</summary><p>Откройте «Горячие клавиши», нажмите кнопку с текущей комбинацией и задайте другую с Ctrl, Alt, Shift или Meta. Выбирайте сочетание, которое не используется браузером и текущим сайтом.</p></details>
          <details><summary>Где хранятся мои данные?</summary><p>История, настройки и кэш хранятся локально на вашем устройстве. Удаляйте отдельные записи в истории, очищайте весь список одной кнопкой или удалите данные расширения средствами браузера.</p></details>
        </div>
      </section>

      <footer className="help-footer"><div><span className="brand-mark" aria-hidden="true">A<span>а</span></span><p><strong>Готовы попробовать?</strong><br />Откройте любую статью и выделите незнакомую фразу.</p></div><button type="button" onClick={() => onOpenSettings("general")}>Проверить горячие клавиши</button></footer>
    </div>
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
function HelpIcon() { return <Icon><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.2 1-1.2 1.9M12 17h.01"/></Icon>; }
function ReadingIcon() { return <Icon><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H4V5.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h3V5.5Z"/></Icon>; }
function KeyboardIcon() { return <Icon><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M18 10h.01M7 14h.01M10 14h7"/></Icon>; }
function CursorIcon() { return <Icon><path d="m5 3 6.5 16 2.2-5.3L19 11.5 5 3Z"/></Icon>; }
function TextIcon() { return <Icon><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/></Icon>; }
function InfoIcon() { return <Icon><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></Icon>; }
function CheckIcon() { return <Icon><path d="m5 12 4 4L19 6"/></Icon>; }
function ArrowIcon() { return <Icon><path d="M5 12h14M14 7l5 5-5 5"/></Icon>; }

createRoot(document.getElementById("root")!).render(<App />);
