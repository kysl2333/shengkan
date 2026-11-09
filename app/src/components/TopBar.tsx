import { useEffect, useState, type ReactNode } from "react";
import { getHealth } from "../api";

export type PageID = "library" | "studio" | "cast" | "master" | "settings";

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

export default function TopBar({
  page,
  onNavigate,
}: {
  page: PageID;
  onNavigate: (p: PageID) => void;
}) {
  const [engine, setEngine] = useState({ online: false, model: false, gpu: "" });

  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => {
        if (!alive) return;
        setEngine({
          online: Boolean(h.ok),
          model: h.model_loaded,
          gpu: h.gpu
            ? `${h.gpu.used_gb ?? Math.max(0, h.gpu.total_gb - h.gpu.free_gb)}/${h.gpu.total_gb} GB`
            : "",
        });
      })
      .catch(() => {
        if (alive) setEngine((prev) => ({ ...prev, online: false }));
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">声栞</span>
        <span className="brand-sub">voice studio</span>
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

      <div className="top-status">
        <div className="status-item" title="语音引擎连接状态">
          <span className={`dot ${engine.online ? "ok" : "warn"}`} />
          {engine.model ? "IndexTTS 2.5 已加载" : engine.online ? "引擎在线" : "引擎未连接"}
        </div>
        {engine.gpu && (
          <div className="status-item">
            <span className="dot" />
            显存 {engine.gpu}
          </div>
        )}
      </div>
    </header>
  );
}
