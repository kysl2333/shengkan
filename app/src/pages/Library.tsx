import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary, TrashSummary, ProjectAction } from "../projects";
import {
  listTrash,
  loadProject,
  saveProject,
  trashProject,
  restoreProject,
  deleteForever,
  emptyTrash,
} from "../projects";
import {
  formatSize,
  isSupportedFile,
  readBookFile,
  splitChaptersRule,
  applyAiChapters,
  estimateSentences,
  mergeShortChapters,
  type ImportedChapter,
} from "../import";
import { detectChapters, cancelAi, getAiConfig, onAiProgress } from "../ai";
import { log } from "../log";
import { askText, showAiDone } from "../prompt";

const covers = ["cover-a", "cover-b", "cover-c", "cover-d"];
const ACCEPT = ".txt,.md,.markdown,.epub,.docx";

function hashText(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i += 97) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function hasFiles(event: React.DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

export default function Library({
  projects,
  onOpen,
  onCreate,
  onRefresh,
  droppedFile,
  onDroppedHandled,
}: {
  projects: ProjectSummary[];
  onOpen: (id: string, action?: ProjectAction) => void;
  onCreate: (
    title: string,
    chapters: ImportedChapter[],
    onProgress?: (message: string) => void
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
  droppedFile?: File | null;
  onDroppedHandled?: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [chapters, setChapters] = useState<ImportedChapter[]>([]);
  const [baseChapters, setBaseChapters] = useState<ImportedChapter[]>([]);
  const [mode, setMode] = useState<"auto" | "ai" | "single">("auto");
  const [source, setSource] = useState("");
  const [fileText, setFileText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [aiResult, setAiResult] = useState<{ hash: string; chapters: ImportedChapter[] } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; project: ProjectSummary } | null>(null);
  const [editTarget, setEditTarget] = useState<ProjectSummary | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashList, setTrashList] = useState<TrashSummary[]>([]);
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashError, setTrashError] = useState("");
  const dragDepth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!droppedFile) return;
    loadFile(droppedFile);
    onDroppedHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFile]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const totalLines = projects.reduce((a, p) => a + p.lines, 0);
  const totalDone = projects.reduce((a, p) => a + p.done, 0);
  const percent = totalLines ? Math.round((totalDone / totalLines) * 100) : 0;
  const minutes = Math.round((totalDone * 3.2) / 60);

  const chars = text.trim().length;
  const sentences = useMemo(() => (chars ? estimateSentences(text) : 0), [text, chars]);

  async function renameProject(p: ProjectSummary) {
    const value = await askText("项目名", p.title);
    if (!value?.trim() || value.trim() === p.title) return;
    try {
      const full = await loadProject(p.id);
      await saveProject({ ...full, title: value.trim() });
      setMenu(null);
      await onRefresh();
      log("project", "重命名项目", { id: p.id, title: value.trim() });
    } catch (error) {
      window.alert(`重命名未保存：${(error as Error).message}`);
    }
  }

  async function removeProject(p: ProjectSummary) {
    if (!window.confirm(`把「${p.title}」移到回收站？\n\n之后可以在回收站里还原或彻底删除。`)) return;
    try {
      await trashProject(p.id);
      setMenu(null);
      await onRefresh();
      log("project", "移到回收站", { id: p.id, title: p.title });
    } catch (e) {
      window.alert(`删除失败：${(e as Error).message}`);
    }
  }

  async function openTrash() {
    setTrashOpen(true);
    setTrashBusy(true);
    setTrashError("");
    try {
      setTrashList(await listTrash());
    } catch (e) {
      setTrashError((e as Error).message);
    } finally {
      setTrashBusy(false);
    }
  }

  async function restoreFromTrash(item: TrashSummary) {
    setTrashBusy(true);
    setTrashError("");
    try {
      await restoreProject(item.trashName);
      setTrashList(await listTrash());
      await onRefresh();
      log("project", "从回收站还原", { id: item.id, title: item.title });
    } catch (e) {
      setTrashError((e as Error).message);
    } finally {
      setTrashBusy(false);
    }
  }

  async function destroyFromTrash(item: TrashSummary) {
    if (!window.confirm(`彻底删除「${item.title}」？\n\n项目文件和相关音频都会删除，无法恢复。`)) return;
    setTrashBusy(true);
    setTrashError("");
    try {
      await deleteForever(item.trashName);
      setTrashList(await listTrash());
      log("project", "彻底删除项目", { id: item.id, title: item.title });
    } catch (e) {
      setTrashError((e as Error).message);
    } finally {
      setTrashBusy(false);
    }
  }

  async function clearTrash() {
    if (!trashList.length) return;
    if (!window.confirm(`清空回收站里的 ${trashList.length} 个项目？\n\n项目文件和相关音频都会删除，无法恢复。`)) return;
    setTrashBusy(true);
    setTrashError("");
    try {
      const result = await emptyTrash();
      setTrashList(await listTrash());
      await onRefresh();
      log("project", "清空回收站", { count: result.count, failed: result.failed });
    } catch (e) {
      setTrashError((e as Error).message);
    } finally {
      setTrashBusy(false);
    }
  }

  function resetImport() {
    setName("");
    setText("");
    setChapters([]);
    setBaseChapters([]);
    setMode("auto");
    setSource("");
    setFileText("");
    setBusy("");
    setError("");
    setAiResult(null);
  }

  function openImport() {
    if (!text.trim()) resetImport();
    setImportOpen(true);
  }

  async function loadFile(file: File) {
    if (!isSupportedFile(file.name)) {
      setError("只支持 .txt、.md、.epub、.docx 文件");
      return;
    }
    setImportOpen(true);
    setBusy(`正在读取 ${file.name}`);
    setError("");
    log("import", "开始读取文件", { name: file.name, size: file.size });
    try {
      const book = await readBookFile(file);
      setText(book.text);
      setFileText(book.text);
      setChapters(book.chapters);
      setBaseChapters(book.chapters);
      setName(book.title);
      setMode("auto");
      setSource(
        `${file.name} · ${formatSize(file.size)} · ${book.format.toUpperCase()}${
          book.tocCount ? ` · 目录 ${book.tocCount} 条` : ""
        }`
      );
      setAiResult(null);
      log("import", "文件解析完成", {
        format: book.format,
        chapters: book.chapters.length,
        toc: book.tocCount ?? 0,
        chars: book.text.length,
        title: book.title,
      });

      if (book.format === "epub" && (book.tocCount ?? 0) > 1 && book.chapters.length <= 1) {
        setError(
          `EPUB 目录有 ${book.tocCount} 条，但正文锚点定位失败。请用「AI 识别」或「整本一章」，或换一个 EPUB 版本。`
        );
      }

      const cfg = await getAiConfig();
      if (
        cfg.autoChapter &&
        book.chapters.length <= 1 &&
        (book.tocCount ?? 0) <= 1 &&
        book.text.length > 2000
      ) {
        setBusy("规则没认出章节，AI 正在识别");
        const off = onAiProgress((p) => setBusy(p.message));
        try {
          const result = await detectChapters(
            book.text,
            book.chapters.map((c) => c.title).filter(Boolean),
            book.title
          );
          const marks = result.marks;
          const next = applyAiChapters(book.text, marks);
          if (next.length > 1) {
            setChapters(next);
            setMode("ai");
            setAiResult({ hash: hashText(book.text), chapters: next });
            log("import", "自动 AI 分章完成", { chapters: next.length });
            showAiDone(
              "AI 分章完成",
              result.usage,
              `识别到 ${next.length} 章，可以核对后导入。`
            );
          }
        } catch (e) {
          log("import", "自动 AI 分章失败", { error: (e as Error).message });
          setError(`自动 AI 分章失败：${(e as Error).message}；已保留规则结果`);
        } finally {
          off();
        }
      }
    } catch (e) {
      log("import", "文件解析失败", { name: file.name, error: (e as Error).message });
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function handleText(value: string) {
    setText(value);
    setAiResult(null);
    if (value !== fileText) setBaseChapters([]);
    setChapters(value.trim() ? splitChaptersRule(value, name || "全文") : []);
    setMode("auto");
  }

  function applyAuto() {
    if (!text.trim()) return;
    if (baseChapters.length) {
      setChapters(baseChapters);
      setMode("auto");
      log("import", "恢复文件分章", { chapters: baseChapters.length });
      return;
    }
    const next = splitChaptersRule(text, name || "全文");
    setChapters(next);
    setMode("auto");
    log("import", "规则分章", { chapters: next.length, chars: text.length });
  }

  function mergeShort() {
    if (chapters.length < 2) return;
    const next = mergeShortChapters(chapters, 800);
    setChapters(next);
    setMode("auto");
    log("import", "合并短章", { before: chapters.length, after: next.length });
  }

  async function stopAi() {
    const stopped = await cancelAi();
    log("import", "请求停止 AI", { stopped });
  }

  async function runAi(force = false) {
    if (!text.trim() || busy) return;

    const hash = hashText(text);
    if (!force && aiResult?.hash === hash) {
      setChapters(aiResult.chapters);
      setMode("ai");
      log("import", "复用上次 AI 分章结果", { chapters: aiResult.chapters.length });
      return;
    }

    setBusy("AI 正在识别章节");
    setError("");
    log("import", "开始 AI 分章", { chars: text.length, force });
    const off = onAiProgress((p) => setBusy(p.message));
    try {
      const result = await detectChapters(
        text,
        baseChapters.map((c) => c.title).filter(Boolean),
        name.trim() || "未命名"
      );
      const marks = result.marks;
      const next = applyAiChapters(text, marks);
      if (!next.length) throw new Error("AI 没有识别出章节");
      setChapters(next);
      setMode("ai");
      setAiResult({ hash, chapters: next });
      log("import", "AI 分章完成", { marks: marks.length, chapters: next.length });
      showAiDone(
        "AI 分章完成",
        result.usage,
        `识别到 ${next.length} 章，可以核对后导入。`
      );
    } catch (e) {
      log("import", "AI 分章失败", { error: (e as Error).message });
      setError((e as Error).message);
    } finally {
      off();
      setBusy("");
    }
  }

  function useSingleChapter() {
    if (!text.trim()) return;
    setChapters([{ title: name.trim() || "全文", body: text.trim() }]);
    setMode("single");
    log("import", "整本一章", { chars: text.length });
  }

  async function doImport() {
    if (!text.trim()) {
      setError("先拖入文件或粘贴正文");
      return;
    }
    if (!chapters.length) {
      setError("还没有可导入的章节");
      return;
    }
    setBusy("正在创建项目");
    setError("");
    log("import", "开始导入项目", { title: name.trim(), chapters: chapters.length, chars: text.length });
    try {
      await onCreate(name.trim() || "未命名项目", chapters, setBusy);
      log("import", "导入完成", { chapters: chapters.length });
      setImportOpen(false);
      resetImport();
    } catch (e) {
      log("import", "导入失败", { error: (e as Error).message });
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section
      className="page active"
      id="page-library"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDropActive(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDropActive(false);
        }
      }}
      onDrop={async (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDropActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) await loadFile(file);
      }}
    >
      <div className="lib-head">
        <div>
          <h1 className="lib-title">项目</h1>
          <p className="lib-sub">把 .txt / .md / .epub / .docx 拖进这个页面，就能开始。</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={openTrash}>回收站</button>
          <button className="btn" onClick={openImport}>导入文本</button>
          <button className="btn primary" onClick={openImport}>新建项目</button>
        </div>
      </div>

      <div className="lib-stats">
        <div className="stat"><span className="stat-num">{projects.length}</span><span className="stat-label">个项目</span></div>
        <div className="stat"><span className="stat-num">{totalLines.toLocaleString()}</span><span className="stat-label">句台词</span></div>
        <div className="stat"><span className="stat-num">{percent}%</span><span className="stat-label">已生成</span></div>
        <div className="stat"><span className="stat-num">{minutes}m</span><span className="stat-label">成片时长</span></div>
      </div>

      <div className="projects">
        {projects.map((p, i) => (
          <article
            className="project"
            key={p.id}
            tabIndex={0}
            role="button"
            onClick={() => onOpen(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(p.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({
                x: Math.min(e.clientX, window.innerWidth - 190),
                y: Math.min(e.clientY, window.innerHeight - 150),
                project: p,
              });
            }}
          >
            <div className={`project-cover ${covers[i % covers.length]}`}>
              <span className="cover-tag">
                {p.percent === 100 ? "已完成" : p.percent > 0 ? "正在编辑" : "草稿"}
              </span>
              <span className="cover-title">{p.title}</span>
            </div>
            <div className="project-body">
              <div className="project-meta">
                <span>{p.chapters} 章 · {p.lines} 句</span>
                <span>{p.percent}%</span>
              </div>
              <div className={`progress ${p.percent === 100 ? "teal" : ""}`}>
                <i style={{ width: `${p.percent}%` }} />
              </div>
              <div className="project-foot">
                <span>{formatTime(p.updatedAt)}</span>
                <span>{p.done} / {p.lines} 句</span>
              </div>
            </div>
          </article>
        ))}

        <article
          className="project project-new"
          tabIndex={0}
          role="button"
          onClick={openImport}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openImport();
            }
          }}
        >
          <div className="project-new-inner">
            <span className="plus">＋</span>
            <b>新建项目</b>
            <span>拖入文件，或从空白开始</span>
          </div>
        </article>
      </div>

      <div className="recent">
        <div className="section-label" style={{ marginBottom: 10 }}>最近</div>
        {projects.slice(0, 3).map((p) => (
          <div className="recent-row" key={p.id}>
            <span>{p.title}</span>
            <span>{p.done === p.lines ? "全部生成完成" : `${p.lines - p.done} 句待生成`}</span>
            <span className="mono">{formatTime(p.updatedAt).slice(6)}</span>
            <span className="mono">{p.lines} 句</span>
          </div>
        ))}
        {!projects.length && (
          <div className="recent-row"><span>还没有项目</span><span>拖入一个 .epub、.docx 或 .txt 开始</span><span className="mono">—</span><span className="mono">0 句</span></div>
        )}
      </div>

      {dropActive && !importOpen && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <div className="drop-icon">⇩</div>
            <b>松手导入</b>
            <span>支持 .txt / .md / .epub / .docx</span>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) await loadFile(file);
        }}
      />

      {importOpen && (
        <div className="modal-mask">
          <div className="modal import-modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">导入剧本</div>
                <div className="modal-desc">拖入文件或用下面的输入框，导入前可以先核对章节。</div>
              </div>
              <button className="modal-close" aria-label="关闭" onClick={() => !busy && setImportOpen(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div
                className={`dropzone ${dropActive ? "active" : ""}`}
                role="button"
                tabIndex={0}
                aria-label="选择要导入的文件"
                onClick={() => !busy && fileRef.current?.click()}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !busy) {
                    e.preventDefault();
                    fileRef.current?.click();
                  }
                }}
                onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); setDropActive(true); } }}
                onDragLeave={(e) => { e.stopPropagation(); setDropActive(false); }}
                onDrop={async (e) => {
                  if (!hasFiles(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setDropActive(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) await loadFile(file);
                }}
              >
                <div className="dropzone-icon">{source ? "✓" : "⇩"}</div>
                <div className="dropzone-text">
                  {source || "把 .txt / .md / .epub / .docx 拖到这里，或点击选择文件"}
                </div>
                <div className="dropzone-sub">
                  {source ? "点击换一个文件" : "EPUB 按书内目录分章，DOCX 按段落提取正文，TXT 按「第X章」识别"}
                </div>
              </div>

              <div className="field">
                <div className="field-label"><span>项目名</span></div>
                <input
                  className="input"
                  value={name}
                  placeholder="默认取文件名"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="field">
                <div className="field-label">
                  <span>正文</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-faint)" }}>
                    {chars ? `${chars.toLocaleString()} 字` : "也可以直接粘贴"}
                  </span>
                </div>
                <textarea
                  className="input textarea import-textarea"
                  value={text}
                  placeholder="粘贴小说或剧本原文……"
                  onChange={(e) => handleText(e.target.value)}
                />
              </div>

              <div className="field">
                <div className="field-label"><span>章节识别</span></div>
                <div className="seg">
                  <button className={mode === "auto" ? "on" : ""} onClick={applyAuto}>
                    自动识别
                  </button>
                  <button className={mode === "ai" ? "on" : ""} onClick={() => runAi(false)} disabled={!!busy || !chars}>
                    AI 识别
                  </button>
                  <button className={mode === "single" ? "on" : ""} onClick={useSingleChapter} disabled={!chars}>
                    整本一章
                  </button>
                </div>
                <div className="import-tools">
                  <span>
                    {mode === "ai"
                      ? "来自 AI 识别"
                      : mode === "single"
                        ? "整本作为一章"
                        : baseChapters.length
                          ? "来自文件目录"
                          : "来自规则识别"}
                  </span>
                  <button className="btn ghost small" onClick={mergeShort} disabled={chapters.length < 2 || !!busy}>
                    合并 800 字以下短章
                  </button>
                </div>
                {aiResult && aiResult.hash === hashText(text) && (
                  <div className="ai-cache-row">
                    <span>上次 AI 结果：{aiResult.chapters.length} 章</span>
                    <button className="btn ghost small" onClick={() => runAi(true)} disabled={!!busy}>
                      重新识别
                    </button>
                  </div>
                )}
              </div>

              <div className="import-preview">
                <span className={`dot ${chapters.length > 1 ? "ok" : "warn"}`} />
                识别到 <b>{chapters.length}</b> 章 · <b>{chars.toLocaleString()}</b> 字 · 约 <b>{sentences.toLocaleString()}</b> 句
                {mode === "ai" && <span className="import-tag">AI</span>}
              </div>

              {chapters.length > 0 && (
                <div className="chapter-preview">
                  {chapters.map((c, i) => (
                    <div className="chapter-preview-row" key={`${c.title}-${i}`}>
                      <span className="chapter-preview-no">{String(i + 1).padStart(2, "0")}</span>
                      <span className="chapter-preview-title">{c.title}</span>
                      <span className="chapter-preview-len">{c.body.length.toLocaleString()} 字</span>
                    </div>
                  ))}
                </div>
              )}

              {busy && (
                <div className="import-busy">
                  <span className="spinner" />
                  {busy}
                  {busy.includes("AI") && (
                    <button className="btn ghost small" style={{ marginLeft: "auto" }} onClick={stopAi}>
                      停止
                    </button>
                  )}
                </div>
              )}
              {error && <div className="import-error">{error}</div>}
            </div>

            <div className="modal-foot">
              <button className="btn ghost" onClick={resetImport} disabled={!!busy}>清空</button>
              <button className="btn" onClick={() => setImportOpen(false)} disabled={!!busy}>关闭</button>
              <button className="btn primary" onClick={doImport} disabled={!!busy || !chars}>
                {busy ? "处理中…" : "导入"}
              </button>
            </div>
          </div>
        </div>
      )}

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button onClick={() => { onOpen(menu.project.id); setMenu(null); }}>打开</button>
          <button onClick={() => { renameProject(menu.project); }}>重命名</button>
          <button onClick={() => { setEditTarget(menu.project); setMenu(null); }}>编辑整本</button>
          <button className="danger" onClick={() => removeProject(menu.project)}>移到回收站</button>
        </div>
      )}

      {editTarget && (
        <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="modal edit-project-modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">编辑整本 · {editTarget.title}</div>
                <div className="modal-desc">整本操作会打开项目并开始执行，工作台会显示进度，可以随时停止。</div>
              </div>
              <button className="modal-close" aria-label="关闭" onClick={() => setEditTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <button
                className="edit-option"
                onClick={() => {
                  const target = editTarget;
                  setEditTarget(null);
                  onOpen(target.id, "rebuild");
                }}
              >
                <b>整本重拆章节（规则，不调用 AI）</b>
                <span>只按章节标题和引号规则重新拆台词，不新增、不删除、不改名任何角色，不消耗 token。对不上现有角色的说话人标成「未知」。</span>
              </button>
              <button
                className="edit-option"
                onClick={() => {
                  const target = editTarget;
                  setEditTarget(null);
                  onOpen(target.id, "annotate");
                }}
              >
                <b>整本角色标注 + 情绪 + 语速（AI）</b>
                <span>逐章用 AI 识别角色，再标注每句的情绪和语速；识别到的新角色会加入项目角色表，会消耗 token。</span>
              </button>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setEditTarget(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {trashOpen && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget && !trashBusy) setTrashOpen(false);
          }}
        >
          <div className="modal trash-modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">回收站</div>
                <div className="modal-desc">删除的项目先放这里，可以还原，也可以彻底删除；彻底删除会一并清理项目音频。</div>
              </div>
              <button className="modal-close" aria-label="关闭" onClick={() => !trashBusy && setTrashOpen(false)}>✕</button>
            </div>

            <div className="modal-body">
              {trashBusy && <div className="import-busy"><span className="spinner" />正在处理…</div>}
              {trashError && <div className="import-error">{trashError}</div>}
              {!trashBusy && !trashList.length && (
                <div className="cast-empty"><p>回收站是空的。</p></div>
              )}
              {trashList.map((item) => (
                <div className="trash-row" key={item.trashName}>
                  <div className="trash-info">
                    <b>{item.title}</b>
                    <span>
                      {item.chapters} 章 · {item.lines} 句
                      {item.size ? ` · ${formatSize(item.size)}` : ""} · 删除于 {formatTime(item.deletedAt)}
                    </span>
                  </div>
                  <div className="trash-actions">
                    <button className="btn small" onClick={() => restoreFromTrash(item)} disabled={trashBusy}>还原</button>
                    <button className="btn small danger" onClick={() => destroyFromTrash(item)} disabled={trashBusy}>彻底删除</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-foot">
              {trashList.length > 0 && (
                <button className="btn danger" onClick={clearTrash} disabled={trashBusy}>清空回收站</button>
              )}
              <button className="btn" onClick={() => setTrashOpen(false)} disabled={trashBusy}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
