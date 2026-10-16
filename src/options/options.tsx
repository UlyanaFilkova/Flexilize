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
  {id: "general", label: "Основные", icon: <SlidersIcon />},
  {id: "translation", label: "Перевод", icon: <LanguagesIcon />},
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

  const openPage = (nextPage: Page) => {
    setPage(nextPage);
    if (nextPage === "history") setHistorySection("records");
    window.history.replaceState(null, "", routeHashes[nextPage]);
  };

  const openHistorySection = (section: HistorySection) => {
    setPage("history");
    setHistorySection(section);
    window.history.replaceState(null, "", routeHashes[section === "records" ? "history" : "export"]);
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

        <nav className="page-switcher" aria-label="Разделы расширения">
          <button className={page === "settings" ? "active" : ""} type="button" aria-current={page === "settings" ? "page" : undefined} onClick={() => openPage("settings")}>
            <SettingsIcon /> Настройки
          </button>
          <button className={page === "history" ? "active" : ""} type="button" aria-current={page === "history" ? "page" : undefined} onClick={() => openPage("history")}>
            <HistoryIcon /> История
          </button>
        </nav>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label={page === "settings" ? "Навигация по настройкам" : "Навигация по истории"}>
          <div className="sidebar-heading">{page === "settings" ? "Настройки" : "Переводы"}</div>
          <nav>
            {page === "settings" ? settingsSidebarItems.map((item) => (
              <button key={item.id} className={settingsSection === item.id ? "active" : ""} type="button" onClick={() => setSettingsSection(item.id)}>
                {item.icon}<span>{item.label}</span>
              </button>
            )) : (
              <>
                <button className={historySection === "records" ? "active" : ""} type="button" onClick={() => openHistorySection("records")}>
                  <HistoryIcon /><span>История</span>
                </button>
                <button className={historySection === "export" ? "active" : ""} type="button" onClick={() => openHistorySection("export")}>
                  <DownloadIcon /><span>Экспорт</span>
                </button>
              </>
            )}
          </nav>
          <div className="sidebar-footer"><span className="status-dot" aria-hidden="true" />Расширение активно</div>
        </aside>

        <main className="content">
          {page === "settings" ? (
            <>
              <PageHeading title="Настройки" description="Персонализируйте работу расширения под себя." />
              <section className="empty-panel" aria-label="Область настроек"><div className="empty-panel-accent" /></section>
            </>
          ) : historySection === "records" ? (
            <HistoryView records={records} loading={loading} onClear={clearRecords} onDelete={removeRecord} onUpdate={updateRecord} />
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

function HistoryView({records, loading, onClear, onDelete, onUpdate}: {records: TranslationRecord[]; loading: boolean; onClear: () => void; onDelete: (record: TranslationRecord) => void; onUpdate: (original: TranslationRecord, updated: TranslationRecord) => Promise<void>}) {
  return (
    <>
      <PageHeading
        title="История переводов"
        description={loading ? "Загрузка…" : pluralizeRecords(records.length)}
        action={<button className="clear-history" type="button" disabled={!records.length} onClick={onClear}><TrashIcon />Очистить историю</button>}
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

  if (editing) {
    return <RecordEditor record={record} onCancel={() => setEditing(false)} onSave={async (updated) => { await onUpdate(updated); setEditing(false); }} />;
  }

  return (
    <li className="history-record">
      <div className="record-pair"><span className="record-original">{record.text || "—"}</span><span className="record-translation">{record.translation || "—"}</span></div>
      {record.transcription && <div className="record-transcription">{record.transcription}</div>}
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
    contextTranslation: record.contextTranslation || "",
    pageTitle: record.pageTitle,
    pageUrl: record.pageUrl,
    translations: record.translations.join("\n")
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
function SettingsIcon() { return <Icon><path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.1A1.7 1.7 0 0 0 8.4 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-1.5-1H2.4V9.95h.1A1.7 1.7 0 0 0 4 8.85a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.86-2.86.06.06A1.7 1.7 0 0 0 8.4 4a1.7 1.7 0 0 0 1-1.5v-.1h4.05v.1A1.7 1.7 0 0 0 14.55 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19 8.4a1.7 1.7 0 0 0 1.5 1h.1v4.05h-.1A1.7 1.7 0 0 0 19.4 15Z"/></Icon>; }
function HistoryIcon() { return <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></Icon>; }
function SlidersIcon() { return <Icon><path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></Icon>; }
function LanguagesIcon() { return <Icon><path d="M4 5h9M8.5 3v2M6 9c1.6 2.3 3.6 4 6.2 5.1M11.5 5C10.4 9.4 7.9 12.5 4 14.2M14 20l3-8 3 8M15 17.5h4"/></Icon>; }
function BookmarkIcon() { return <Icon><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"/></Icon>; }
function DownloadIcon() { return <Icon><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16"/></Icon>; }
function EditIcon() { return <Icon><path d="m4 16-.8 4.8L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></Icon>; }
function TrashIcon() { return <Icon><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></Icon>; }

createRoot(document.getElementById("root")!).render(<App />);
