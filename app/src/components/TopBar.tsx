import { useEffect, useState } from "react";
import { getHealth } from "../api";

export type PageID = "library" | "studio" | "cast" | "master" | "settings";

const items: { id: PageID; label: string }[] = [
  { id: "library", label: "项目" },
  { id: "studio", label: "工作台" },
  { id: "cast", label: "角色与音色" },
  { id: "master", label: "成片" },
  { id: "settings", label: "设置" },
];

export default function TopBar({
  page,
  onNavigate,
}: {
  page: PageID;
  onNavigate: (p: PageID) => void;
}) {
  const [engine, setEngine] = useState({ model: false, gpu: "" });

  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => {
        if (!alive) return;
        setEngine({
          model: h.model_loaded,
          gpu: h.gpu
            ? `${h.gpu.used_gb ?? Math.max(0, h.gpu.total_gb - h.gpu.free_gb)}/${h.gpu.total_gb} GB`
            : "",
        });
      })
      .catch(() => {});
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

      <nav className="nav">
        {items.map((item) => (
          <button
            key={item.id}
            className={page === item.id ? "active" : ""}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="top-status">
        <div className="status-item">
          <span className="dot ok" />
          {engine.model ? "IndexTTS 2.5 已加载" : "引擎在线"}
        </div>
        <div className="status-item">
          <span className="dot warn" />
          显存 {engine.gpu || "—"}
        </div>
        <div className="status-item">队列 0</div>
      </div>
    </header>
  );
}
