import {useState, type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import "./options.css";

type Page = "settings" | "history";

const sidebarItems = [
  {id: "general", label: "Основные", icon: <SlidersIcon />},
  {id: "translation", label: "Перевод", icon: <LanguagesIcon />},
  {id: "saving", label: "Сохранение", icon: <BookmarkIcon />},
  {id: "export", label: "Экспорт", icon: <DownloadIcon />}
];

function App() {
  const [page, setPage] = useState<Page>("settings");
  const [section, setSection] = useState("general");

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Context Translator">
          <span className="brand-mark" aria-hidden="true">A<span>а</span></span>
          <span>Context Translator</span>
        </a>

        <nav className="page-switcher" aria-label="Разделы расширения">
          <button
            className={page === "settings" ? "active" : ""}
            type="button"
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => setPage("settings")}
          >
            <SettingsIcon />
            Настройки
          </button>
          <button
            className={page === "history" ? "active" : ""}
            type="button"
            aria-current={page === "history" ? "page" : undefined}
            onClick={() => setPage("history")}
          >
            <HistoryIcon />
            История
          </button>
        </nav>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Навигация по настройкам">
          <div className="sidebar-heading">Настройки</div>
          <nav>
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                className={page === "settings" && section === item.id ? "active" : ""}
                type="button"
                onClick={() => {
                  setPage("settings");
                  setSection(item.id);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <span className="status-dot" aria-hidden="true" />
            Расширение активно
          </div>
        </aside>

        <main className="content">
          <div className="content-heading">
            <span className="eyebrow">Context Translator</span>
            <h1>{page === "settings" ? "Настройки" : "История"}</h1>
            <p>
              {page === "settings"
                ? "Персонализируйте работу расширения под себя."
                : "Здесь будет отображаться история ваших переводов."}
            </p>
          </div>

          <section className="empty-panel" aria-label={page === "settings" ? "Область настроек" : "Область истории"}>
            <div className="empty-panel-accent" />
          </section>
        </main>
      </div>
    </div>
  );
}

function Icon({children}: {children: ReactNode}) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

function SettingsIcon() {
  return <Icon><path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.1A1.7 1.7 0 0 0 8.4 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-1.5-1H2.4V9.95h.1A1.7 1.7 0 0 0 4 8.85a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.86-2.86.06.06A1.7 1.7 0 0 0 8.4 4a1.7 1.7 0 0 0 1-1.5v-.1h4.05v.1A1.7 1.7 0 0 0 14.55 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19 8.4a1.7 1.7 0 0 0 1.5 1h.1v4.05h-.1A1.7 1.7 0 0 0 19.4 15Z"/></Icon>;
}

function HistoryIcon() {
  return <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></Icon>;
}

function SlidersIcon() {
  return <Icon><path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></Icon>;
}

function LanguagesIcon() {
  return <Icon><path d="M4 5h9M8.5 3v2M6 9c1.6 2.3 3.6 4 6.2 5.1M11.5 5C10.4 9.4 7.9 12.5 4 14.2M14 20l3-8 3 8M15 17.5h4"/></Icon>;
}

function BookmarkIcon() {
  return <Icon><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"/></Icon>;
}

function DownloadIcon() {
  return <Icon><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16"/></Icon>;
}

createRoot(document.getElementById("root")!).render(<App />);
