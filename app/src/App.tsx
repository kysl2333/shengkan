import { useEffect, useRef, useState } from "react";
import TopBar, { type PageID } from "./components/TopBar";
import Library from "./pages/Library";
import Studio from "./pages/Studio";
import Cast from "./pages/Cast";
import Master from "./pages/Master";
import Settings from "./pages/Settings";
import { splitText } from "./api";
import { refineSpeakers, type ImportedChapter } from "./import";
import { log } from "./log";
import {
  listProjects,
  loadProject,
  saveProject,
  createProject,
  type Project,
  type ProjectCast,
  type ProjectChapter,
  type ProjectLine,
  type ProjectSummary,
  type ProjectAction,
} from "./projects";

const CAST_COLORS = ["#2f6b57", "#a9763c", "#a94f38", "#465a6b", "#6b7d5e", "#8a6a4f"];

export default function App() {
  const [page, setPage] = useState<PageID>("library");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pendingAction, setPendingAction] = useState<ProjectAction | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
  const [saveError, setSaveError] = useState("");
  const [studioBusy, setStudioBusy] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const draftRef = useRef<Project | null>(null);
  const saveErrorRef = useRef("");
  const dragDepth = useRef(0);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!saveErrorRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, []);

  function hasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  useEffect(() => {
    listProjects()
      .then(async (list) => {
        setProjects(list);
        if (list[0]) {
          const p = await loadProject(list[0].id);
          setProject(p);
          setPage("studio");
        }
      })
      .catch((err) => console.error("加载项目失败", err));
  }, []);

  async function openProject(id: string, action?: ProjectAction) {
    if (saveErrorRef.current) return;
    try {
      const p = await loadProject(id);
      setProject(p);
      setPendingAction(action ?? null);
      setPage("studio");
    } catch (err) {
      window.alert(`打开项目失败：${(err as Error).message}`);
    }
  }

  async function refreshProjects() {
    const list = await listProjects();
    setProjects(list);
    if (project && !list.some((p) => p.id === project.id)) {
      if (list[0]) {
        const next = await loadProject(list[0].id);
        setProject(next);
      } else {
        setProject(null);
      }
    }
  }

  async function persist(next: Project) {
    draftRef.current = next;
    setProject(next);
    if (saveErrorRef.current) return false;
    try {
      const s = await saveProject(next);
      setProjects((prev) => {
        const rest = prev.filter((x) => x.id !== s.id);
        return [s, ...rest];
      });
      return true;
    } catch (err) {
      console.error("保存失败", err);
      const message = (err as Error).message || "项目保存失败";
      saveErrorRef.current = message;
      setSaveError(message);
      return false;
    }
  }

  function downloadDraft() {
    const draft = draftRef.current ?? project;
    if (!draft) return;
    const { __storageVersion: _version, ...content } = draft;
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.id}-draft-${Date.now()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function reloadSavedProject() {
    if (!project || studioBusy) return;
    try {
      const loaded = await loadProject(project.id);
      draftRef.current = loaded;
      setProject(loaded);
      saveErrorRef.current = "";
      setSaveError("");
      setReloadConfirm(false);
      setProjects(await listProjects());
    } catch (error) {
      const message = `重新载入失败：${(error as Error).message}`;
      saveErrorRef.current = message;
      setSaveError(message);
    }
  }

  async function create(
    title: string,
    sourceChapters: ImportedChapter[],
    onProgress?: (message: string) => void
  ) {
    let p = await createProject(title);
    const chapters: ProjectChapter[] = [];

    for (let i = 0; i < sourceChapters.length; i++) {
      const src = sourceChapters[i];
      onProgress?.(`正在拆分第 ${i + 1}/${sourceChapters.length} 章 · ${src.title}`);
      let lines: ProjectLine[] = [];

      try {
        const r = await splitText(src.body);
        lines = r.segments.map((s, j) => ({
          id: j + 1,
          speaker: s.speaker,
          paragraph: s.paragraph,
          text: s.text,
          emotion: s.emotion || "平静",
          speed: 1,
          status: "pending" as const,
          audio: "",
        }));
        log("split", "章节拆分完成", {
          chapter: src.title,
          segments: lines.length,
          unknown: lines.filter((l) => l.speaker === "未知").length,
        });
      } catch (err) {
        log("split", "章节拆分失败", { chapter: src.title, error: (err as Error).message });
        console.error("拆分失败，章节先留空", err);
      }

      chapters.push({
        id: `ch-${String(i + 1).padStart(2, "0")}`,
        title: src.title,
        source: src.body,
        lines,
      });
    }

    // 只保留全书出现 2 次以上、且形状像人名的说话人；单次出现的动作片段一律回到「未知」
    const allLines = chapters.flatMap((chapter) => chapter.lines);
    refineSpeakers(allLines, [], 2);

    const order: string[] = [];
    const seen = new Set<string>();
    for (const line of allLines) {
      if (line.speaker === "旁白" || line.speaker === "未知" || seen.has(line.speaker)) continue;
      seen.add(line.speaker);
      order.push(line.speaker);
    }

    const casts: ProjectCast[] = ["旁白", ...order].map((name, i) => ({
      id: `cast-${i + 1}`,
      name,
      initial: name.slice(0, 1),
      desc: name === "旁白" ? "叙述 · 待匹配音色" : "待匹配音色",
      voice: "",
      voicePath: "",
      color: CAST_COLORS[i % CAST_COLORS.length],
    }));

    log("split", "全部拆分完成", {
      chapters: chapters.length,
      lines: chapters.reduce((a, c) => a + c.lines.length, 0),
      casts: casts.map((c) => c.name),
    });

    p = { ...p, casts, chapters };
    onProgress?.("正在保存项目");
    await persist(p);
    setPage("studio");
  }

  return (
    <>
      <TopBar page={page} onNavigate={setPage} />
      {saveError && (
        <div className="save-conflict" role="alert">
          <div>
            <b>保存已暂停，当前内容尚未写入磁盘</b>
            <p>{saveError}</p>
            <span>当前草稿仍保留在本窗口。请先下载副本，再重新载入磁盘上的最新项目；关闭窗口会丢失未保存内容。</span>
          </div>
          <div className="save-conflict-actions">
            <button className="btn" onClick={downloadDraft}>下载草稿副本</button>
            <button className="btn" disabled={studioBusy} onClick={() => setReloadConfirm(true)}>
              {studioBusy ? "等待任务收尾…" : "重新载入最新项目"}
            </button>
          </div>
        </div>
      )}
      <main
        inert={!!saveError}
        onDragEnter={(e) => {
          if (page === "library" || !hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (page !== "library" && hasFiles(e)) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (page === "library" || !hasFiles(e)) return;
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(e) => {
          if (page === "library" || !hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) {
            setDropped(file);
            setPage("library");
          }
        }}
      >
        {page === "library" && (
          <Library
            projects={projects}
            onOpen={openProject}
            onCreate={create}
            onRefresh={refreshProjects}
            droppedFile={dropped}
            onDroppedHandled={() => setDropped(null)}
          />
        )}
        <Studio
          project={project}
          onSave={persist}
          action={pendingAction}
          onActionDone={() => setPendingAction(null)}
          active={page === "studio"}
          saveBlocked={!!saveError}
          onBusyChange={setStudioBusy}
        />
        {page === "cast" && <Cast project={project} onSave={persist} />}
        {page === "master" && <Master project={project} />}
        {page === "settings" && <Settings />}
      </main>
      {reloadConfirm && (
        <div className="modal-mask">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="reload-project-title">
            <div className="modal-head"><div className="modal-title" id="reload-project-title">重新载入最新项目？</div></div>
            <div className="modal-body">当前未保存内容将被磁盘版本替换。请确认已下载草稿副本；不会覆盖磁盘上的外部修改。</div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setReloadConfirm(false)}>保留当前草稿</button>
              <button className="btn primary" onClick={reloadSavedProject} disabled={studioBusy}>已保留副本，重新载入</button>
            </div>
          </div>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <div className="drop-icon">⇩</div>
            <b>松手导入</b>
            <span>支持 .txt / .md / .epub / .docx</span>
          </div>
        </div>
      )}
    </>
  );
}
