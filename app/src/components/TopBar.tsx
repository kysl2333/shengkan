import { useEffect, useState, type ReactNode } from "react";
import { getHealth } from "../api";

export type PageID = "library" | "studio" | "cast" | "master" | "settings";
type Theme = "light" | "dark";

const items: { id: PageID; label: string; icon: ReactNode }[] = [
  {
    id: "library",
    label: "项目",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
        <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14z" />
      </svg>
    ),
  },
  {
    id: "studio",
    label: "工作台",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </svg>
    ),
  },
  {
    id: "cast",
    label: "角色与音色",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19.5c0-3.1 2.5-5.3 5.5-5.3s5.5 2.2 5.5 5.3" />
        <path d="M16 5.6a3 3 0 0 1 0 5.6M17.4 14.4c2.1.5 3.6 2.2 3.6 4.4" />
      </svg>
    ),
  },
  {
    id: "master",
    label: "成片",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2.2" />
        <path d="M3 9.5h18M8 5v4.5M16 5v4.5" />
        <path d="M10.5 13.2 14 15l-3.5 1.8z" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "设置",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 7h9M18.5 7H20M4 17h3M12.5 17H20" />
        <circle cx="15.5" cy="7" r="2.1" />
        <circle cx="9.5" cy="17" r="2.1" />
      </svg>
    ),
  },
];

const SunIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);

const MoonIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
  </svg>
);

function initialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export default function TopBar({
  page,
  onNavigate,
}: {
  page: PageID;
  onNavigate: (p: PageID) => void;
}) {
  const [engine, setEngine] = useState({ online: false, model: false, gpu: "", version: "2.5" });
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("shengkan:theme", theme);
    } catch {
      /* 本地存储不可用时只影响下次启动 */
    }
  }, [theme]);

  useEffect(() => {
    let alive = true;
    const check = () => {
      getHealth()
        .then((h) => {
          if (!alive) return;
          setEngine({
            online: Boolean(h.ok),
            model: Boolean(h.ok && h.model_loaded),
            gpu: h.gpu
              ? `${h.gpu.used_gb ?? Math.max(0, h.gpu.total_gb - h.gpu.free_gb)}/${h.gpu.total_gb} GB`
              : "",
            version: h.version || "2.5",
          });
        })
        .catch(() => {
          if (alive) setEngine({ online: false, model: false, gpu: "", version: "2.5" });
        });
    };
    check();
    const timer = window.setInterval(check, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-rule" aria-hidden="true" />
        <span className="brand-mark">声栞</span>
        <span className="brand-sub">配音工作台</span>
      </div>

      <nav className="nav" aria-label="主导航">
        {items.map((item) => (
          <button
            key={item.id}
            className={page === item.id ? "active" : ""}
            onClick={() => onNavigate(item.id)}
            aria-current={page === item.id ? "page" : undefined}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <div className="theme-switch" role="group" aria-label="界面主题">
          <button
            className={theme === "light" ? "on" : ""}
            onClick={() => setTheme("light")}
            aria-label="日间模式"
            aria-pressed={theme === "light"}
            title="日间模式"
          >
            {SunIcon}
          </button>
          <button
            className={theme === "dark" ? "on" : ""}
            onClick={() => setTheme("dark")}
            aria-label="夜间模式"
            aria-pressed={theme === "dark"}
            title="夜间模式"
          >
            {MoonIcon}
          </button>
        </div>

        <div className="top-status">
          <div className="status-item" title="语音引擎连接状态">
            <span className={`dot ${engine.online ? "ok" : "warn"}`} />
            {engine.model ? `IndexTTS ${engine.version} 已加载` : engine.online ? "引擎在线" : "引擎未连接"}
          </div>
          {engine.gpu && (
            <div className="status-item">
              <span className="dot" />
              显存 {engine.gpu}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
