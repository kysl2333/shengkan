import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getVoices, splitText, synthesize, audioUrl, deleteAudio, type Segment } from "../api";
import { annotateLines, cancelAi, onAiProgress, extractCasts, emptyAiUsage, addAiUsage } from "../ai";
import { cloudTTS } from "../cloud";
import { isRealCharacter, refineSpeakers } from "../import";
import { log } from "../log";
import { askText, showAiDone } from "../prompt";
import { castVoiceLabel, newCastId, pushCastVoiceHistory, type Project, type ProjectCast, type ProjectChapter, type ProjectLine, type ProjectAction } from "../projects";

type View = "lines" | "source";
type TaskState = "idle" | "running" | "done" | "checked";

const statusText = {
  done: "已生成",
  dirty: "待更新",
  pending: "待生成",
};

const EMOTION_VECTORS: Record<string, number[]> = {
  平静: [0, 0, 0, 0, 0, 0, 0, 1],
  高兴: [0.9, 0, 0, 0, 0, 0, 0.2, 0.1],
  愤怒: [0, 1, 0, 0, 0, 0, 0, 0],
  悲伤: [0, 0, 1, 0, 0, 0.3, 0, 0],
  害怕: [0, 0, 0, 1, 0, 0, 0, 0],
  厌恶: [0, 0, 0, 0, 1, 0, 0, 0],
  忧郁: [0, 0, 0.5, 0, 0, 1, 0, 0],
  惊讶: [0, 0, 0, 0, 0, 0, 1, 0],
  克制: [0, 0, 0.2, 0, 0, 0, 0, 0.8],
  试探: [0, 0, 0, 0.2, 0, 0, 0.2, 0.6],
  警惕: [0, 0, 0, 0.4, 0, 0, 0.1, 0.5],
  疲惫: [0, 0, 0.2, 0, 0, 0.5, 0, 0.3],
};

function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function lineStatusKey(chapterKey: string, lineId: number) {
  return `${chapterKey}:${lineId}`;
}

function castEngineInfo(cast?: ProjectCast) {
  const model = cast?.cloudModel || "";
  if (!cast?.cloudVoice || !model) {
    return { engine: "IndexTTS 2.5", detail: "本地或远端 Gradio", cloud: false, model: "" };
  }
  const engine = model.startsWith("mimo")
    ? "小米云 TTS"
    : model.startsWith("qwen:")
      ? "千问 TTS"
      : model.startsWith("custom:")
        ? "自定义 TTS"
        : "云 TTS";
  return { engine, detail: "云端生成，保留本地音频", cloud: true, model };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

function segmentsToLines(segments: Segment[]): ProjectLine[] {
  return segments.map((s, index) => ({
    id: index + 1,
    speaker: s.speaker,
    paragraph: s.paragraph,
    text: s.text,
    emotion: s.emotion || "平静",
    speed: 1,
    status: "pending" as const,
    audio: "",
  }));
}

// 规则重拆只换断句：文字完全相同的旧台词沿用原来的角色、情绪、语速和音频，避免重拆后全变旁白。
function carryOverLines(fresh: ProjectLine[], oldLines: ProjectLine[]) {
  const buckets = new Map<string, ProjectLine[]>();
  for (const line of oldLines) {
    const key = line.text.trim();
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(line);
    else buckets.set(key, [line]);
  }

  const kept = new Set<ProjectLine>();
  const lines = fresh.map((line) => {
    const match = buckets.get(line.text.trim())?.shift();
    if (!match) return line;
    kept.add(match);
    return {
      ...line,
      speaker:
        match.speaker === "未知" && line.speaker !== "未知" ? line.speaker : match.speaker,
      emotion: match.emotion || line.emotion,
      speed: match.speed ?? line.speed,
      status: match.status === "dirty" ? ("dirty" as const) : match.audio ? ("done" as const) : ("pending" as const),
      audio: match.audio,
      audioHistory: match.audioHistory,
      note: match.note,
    };
  });

  const keptAudio = new Set<string>();
  for (const line of kept) {
    if (line.audio) keptAudio.add(line.audio);
    line.audioHistory?.forEach((file) => keptAudio.add(file));
  }
  const staleAudio = oldLines
    .flatMap((line) => [line.audio, ...(line.audioHistory ?? [])])
    .filter((file): file is string => Boolean(file && !keptAudio.has(file)));

  return { lines, staleAudio };
}

export default function Studio({
  project,
  onSave,
  action,
  onActionDone,
}: {
  project: Project | null;
  onSave: (p: Project) => void;
  action?: ProjectAction | null;
  onActionDone?: () => void;
}) {
  const [chapterId, setChapterId] = useState(project?.chapters[0]?.id ?? "");
  const chapter = project?.chapters.find((c) => c.id === chapterId) ?? project?.chapters[0];
  const castList: ProjectCast[] = project?.casts ?? [];

  const [script, setScript] = useState<ProjectLine[]>(chapter?.lines ?? []);
  const [view, setView] = useState<View>("lines");
  const [current, setCurrent] = useState(1);
  const [task, setTask] = useState<TaskState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [speed, setSpeed] = useState(1);
  const [genState, setGenState] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [cancelableGen, setCancelableGen] = useState(false);
  const [genMsg, setGenMsg] = useState("");
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [genTarget, setGenTarget] = useState<{
    id: number;
    speaker: string;
    engine: string;
    detail: string;
    cloud: boolean;
  } | null>(null);
  const [flashLine, setFlashLine] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [speakerFor, setSpeakerFor] = useState<number | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
  const [aiThinking, setAiThinking] = useState("");
  const [aiElapsed, setAiElapsed] = useState(0);
  const aiClockRef = useRef<number | null>(null);
  const thinkingBoxRef = useRef<HTMLDivElement>(null);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [systemVoice, setSystemVoice] = useState("");
  const [lineMenu, setLineMenu] = useState<{ x: number; y: number; line: ProjectLine } | null>(null);
  const [audioSrc, setAudioSrc] = useState("");
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [auditionMode, setAuditionMode] = useState<"single" | "continuous">("single");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioRateRef = useRef(1);
  const continuousRef = useRef<{ queue: ProjectLine[]; index: number } | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [editingSource, setEditingSource] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [flashParagraph, setFlashParagraph] = useState(0);
  const [lineStatus, setLineStatus] = useState<Record<string, "generating" | "error" | "">>({});
  const [toast, setToast] = useState("");
  const [genDialog, setGenDialog] = useState(false);
  const [roleMenu, setRoleMenu] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const genStopRef = useRef(false);
  const ranActionRef = useRef("");
  const projectRef = useRef(project);
  const chapterIdRef = useRef(chapterId);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    chapterIdRef.current = chapterId;
  }, [chapterId]);

  useEffect(() => {
    const first = project?.chapters[0];
    if (first) {
      chapterIdRef.current = first.id;
      setChapterId(first.id);
      setScript(first.lines);
      setEditingSource(false);
      setSourceDraft("");
    }
  }, [project?.id]);

  // 章节切换时清掉只属于上一章的编辑态；生成状态按「章节 + 句号」隔离。
  useLayoutEffect(() => {
    setChecked(new Set());
    setEditing(null);
    setSpeakerFor(null);
    setLineMenu(null);
    setFlashParagraph(0);
  }, [chapterId]);

  useEffect(() => {
    const c = project?.chapters.find((x) => x.id === chapterId);
    if (c) setScript(c.lines);
  }, [chapterId, project?.chapters]);

  useEffect(() => {
    const el = thinkingBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [aiThinking]);

  useEffect(() => {
    if (!flashLine) return;
    const el = document.getElementById(`line-${flashLine}`);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    const timer = window.setTimeout(() => setFlashLine(0), 1800);
    return () => window.clearTimeout(timer);
  }, [flashLine]);

  useEffect(() => {
    return () => {
      stopAiClock();
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!action) {
      ranActionRef.current = "";
      return;
    }
    if (!project) return;
    const key = `${project.id}:${action}`;
    if (ranActionRef.current === key) return;
    ranActionRef.current = key;
    if (action === "rebuild") void rebuildAllLines(true);
    else void annotateAllChapters(true);
    onActionDone?.();
  }, [action, project?.id]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      setSystemVoices(list);
      setSystemVoice(
        (prev) => prev || list.find((v) => v.lang.toLowerCase().startsWith("zh"))?.name || ""
      );
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  useEffect(() => {
    if (!lineMenu) return;
    const close = () => setLineMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [lineMenu]);

  useEffect(() => {
    if (!aiMenuOpen) return;
    const close = () => setAiMenuOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAiMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [aiMenuOpen]);

  useEffect(() => {
    // 连续试听自己会切 current，不能在这里把刚加载的下一句暂停。
    if (continuousRef.current) return;
    audioRef.current?.pause();
    setAudioPlaying(false);
  }, [current]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const selected = script.find((l) => l.id === current) ?? script[0];
  const selectedCast = castList.find((c) => c.name === selected?.speaker);
  const selectedEngine = castEngineInfo(selectedCast);
  const genEngine = genTarget ?? {
    id: 0,
    speaker: "",
    engine: selectedEngine.engine,
    detail: selectedEngine.detail,
    cloud: selectedEngine.cloud,
  };

  // 切到原文时，定位到当前台词所在段并短暂高亮。
  useEffect(() => {
    if (view !== "source" || !selected?.paragraph) return;
    const el = document.getElementById(`source-p-${selected.paragraph}`);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    setFlashParagraph(selected.paragraph);
    const timer = window.setTimeout(() => setFlashParagraph(0), 2000);
    return () => window.clearTimeout(timer);
  }, [view, selected?.paragraph]);
  const unknownCount = script.filter((l) => l.speaker === "未知").length;
  const pendingCount = script.filter(
    (l) => l.text.trim() && (l.status !== "done" || !l.audio)
  ).length;
  const allCount = script.filter((l) => l.text.trim()).length;
  const chapterCastNames = [...new Set(script.map((l) => l.speaker))];
  const isProjectCast = (name: string) => project?.casts.some((c) => c.name === name) ?? false;
  const chapterCasts: ProjectCast[] = chapterCastNames
    .map((name) => {
      const found = castList.find((c) => c.name === name);
      return (
        found ?? {
          id: `chapter-${name}`,
          name,
          initial: name.slice(0, 1),
          desc: "待匹配音色",
          voice: "",
          voicePath: "",
          color: "#7d8fa8",
        }
      );
    })
    .sort((a, b) => {
      if (a.name === "旁白") return 1;
      if (b.name === "旁白") return -1;
      return 0;
    });

  const wave = useMemo(
    () =>
      Array.from({ length: 260 }, (_, i) => {
        const t = i / 260;
        const env = 0.45 + Math.sin(t * Math.PI) * 0.55;
        const grain =
          Math.abs(Math.sin(i * 0.83) * 0.55) +
          Math.abs(Math.sin(i * 0.27 + 1.3) * 0.3) +
          Math.abs(Math.sin(i * 1.9) * 0.15);
        const h = 2 + grain * 25 * env;
        return { h: Math.round(h * 10) / 10, peak: h > 22 };
      }),
    []
  );

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 4500);
  }

  function startAiClock() {
    const start = Date.now();
    setAiElapsed(0);
    if (aiClockRef.current) window.clearInterval(aiClockRef.current);
    aiClockRef.current = window.setInterval(() => {
      setAiElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
  }

  function stopAiClock() {
    if (!aiClockRef.current) return;
    window.clearInterval(aiClockRef.current);
    aiClockRef.current = null;
  }

  function dismissAiPanel() {
    setAiMsg("");
    setAiThinking("");
    setAiElapsed(0);
    setAiProgress({ done: 0, total: 0 });
  }

  function addLog(msg: string) {
    const d = new Date();
    const ts = `${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    setLogs((prev) => [...prev, `${ts} ${msg}`]);
  }

  function blockWhileGenerating(action: string) {
    if (genState !== "generating") return false;
    showToast(`正在生成音频，先停止再${action}`);
    return true;
  }

  function saveLines(next: ProjectLine[], casts?: ProjectCast[]) {
    if (chapterIdRef.current === chapter?.id) setScript(next);
    const base = projectRef.current;
    if (base && chapter) {
      const nextProject = {
        ...base,
        casts: casts ?? base.casts,
        chapters: base.chapters.map((c) =>
          c.id === chapter.id ? { ...c, lines: next } : c
        ),
      };
      projectRef.current = nextProject;
      onSave(nextProject);
    }
  }

  function clearChapterStatus(chapterKey: string) {
    setLineStatus((prev) => {
      const prefix = `${chapterKey}:`;
      const keys = Object.keys(prev).filter((key) => key.startsWith(prefix));
      if (!keys.length) return prev;
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  // 生成类异步操作只合并目标章节，避免用旧快照覆盖其他章节或把已删除的句子写回来。
  function saveChapterLines(
    targetChapterId: string,
    updater: (lines: ProjectLine[]) => ProjectLine[],
    casts?: ProjectCast[],
    persist = true
  ) {
    const base = projectRef.current;
    if (!base) return;
    const target = base.chapters.find((c) => c.id === targetChapterId);
    if (!target) return;
    const lines = updater(target.lines);
    const nextProject = {
      ...base,
      casts: casts ?? base.casts,
      chapters: base.chapters.map((c) =>
        c.id === targetChapterId ? { ...c, lines } : c
      ),
    };
    projectRef.current = nextProject;
    if (persist) onSave(nextProject);
    if (chapterIdRef.current === targetChapterId) setScript(lines);
  }

  function persistProject() {
    const base = projectRef.current;
    if (!base) return;
    onSave(base);
    const current = base.chapters.find((c) => c.id === chapterIdRef.current);
    if (current) setScript(current.lines);
  }

  function nextAudio(line: ProjectLine, url: string): ProjectLine {
    const history = [...(line.audioHistory || [])];
    if (line.audio) history.push(line.audio);
    while (history.length > 1) {
      const removed = history.shift();
      if (removed) deleteAudio(removed);
    }
    return { ...line, audio: url, audioHistory: history, status: "done" as const };
  }

  // 生成期间台词被改过，旧文本的音频不能挂到新文本上。
  function applyGeneratedAudio(current: ProjectLine, snapshot: ProjectLine, url: string): ProjectLine {
    const changed =
      current.text !== snapshot.text ||
      current.speaker !== snapshot.speaker ||
      current.emotion !== snapshot.emotion ||
      Number(current.speed) !== Number(snapshot.speed);
    if (changed) {
      deleteAudio(url);
      return { ...current, status: "dirty" as const };
    }
    return nextAudio(current, url);
  }

  function switchAudio(line: ProjectLine) {
    if (!line.audio || !line.audioHistory?.length) return;
    const prev = line.audioHistory[0];
    const rest = [line.audio, ...line.audioHistory.slice(1)];
    updateLine(line.id, { audio: prev, audioHistory: rest, status: "done" });
    setCurrent(line.id);
    setFlashLine(line.id);
    const label = `第 ${line.id} 句已切换到上一版配音`;
    setGenMsg(label);
    showToast(label);
    log("generate", "切换配音版本", { lineId: line.id, from: line.audio, to: prev });
    loadAndPlay(audioUrl(prev), undefined, true);
  }

  function updateLine(
    id: number,
    patch: Partial<ProjectLine>,
    casts?: ProjectCast[],
    persist = true
  ) {
    const next = script.map((l) =>
      l.id === id
        ? { ...l, ...patch, status: (patch.status ?? "dirty") as ProjectLine["status"] }
        : l
    );
    if (persist) {
      saveLines(next, casts);
      return;
    }
    // 拖动滑块时只更新界面和内存，松手后再落盘。
    setScript(next);
    const base = projectRef.current;
    if (base && chapter) {
      projectRef.current = {
        ...base,
        casts: casts ?? base.casts,
        chapters: base.chapters.map((c) =>
          c.id === chapter.id ? { ...c, lines: next } : c
        ),
      };
    }
  }

  function newCast(name: string): ProjectCast {
    return {
      id: newCastId(),
      name,
      initial: name.slice(0, 1),
      desc: "待匹配音色",
      voice: "",
      voicePath: "",
      color: "#7d8fa8",
    };
  }

  function jumpRoleTo(name: string, index: number) {
    const ids = script.filter((l) => l.speaker === name).map((l) => l.id);
    if (!ids.length) return;
    const at = Math.max(0, Math.min(ids.length - 1, index));
    const id = ids[at];
    setCurrent(id);
    setSpeakerFor(null);
    window.requestAnimationFrame(() => {
      document.getElementById(`line-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    log("edit", "跳转到角色台词", { name, lineId: id, index: at + 1 });
  }

  function jumpRole(name: string, dir: 1 | -1) {
    const ids = script.filter((l) => l.speaker === name).map((l) => l.id);
    if (!ids.length) return;
    const at = ids.indexOf(current);
    const next = at < 0 ? (dir > 0 ? 0 : ids.length - 1) : (at + dir + ids.length) % ids.length;
    jumpRoleTo(name, next);
  }

  function changeSpeaker(lineId: number, name: string) {    const clean = name.trim();
    if (!clean) return;
    const base = project?.casts ?? castList;
    const casts = base.some((c) => c.name === clean) ? undefined : [...base, newCast(clean)];
    updateLine(lineId, { speaker: clean }, casts);
    setSpeakerFor(null);
    log("edit", "切换说话人", { lineId, speaker: clean });
  }

  async function addRoleToChapter(name: string) {
    if (!project) return;
    if (blockWhileGenerating("添加本章角色")) return;
    const clean = name.trim();
    if (!clean) return;
    if (clean === "未知") {
      showToast("「未知」是占位，不是角色；请建一个真实角色名");
      return;
    }
    setRoleMenu(false);

    const casts = project.casts.some((c) => c.name === clean)
      ? undefined
      : [...project.casts, newCast(clean)];

    const id = Math.max(0, ...script.map((l) => l.id)) + 1;
    const line: ProjectLine = {
      id,
      speaker: clean,
      text: "",
      emotion: "平静",
      speed: 1,
      status: "pending",
      audio: "",
    };

    saveLines([...script, line], casts);
    setCurrent(id);
    setEditing(id);
    log("cast", "添加本章角色", { name: clean });
  }

  async function createRoleForChapter() {
    const name = await askText("新角色名");
    if (name?.trim()) await addRoleToChapter(name.trim());
  }

  function removeChapterRole(name: string) {
    if (name === "旁白" || name === "未知") return;
    const next = script.map((l) =>
      l.speaker === name ? { ...l, speaker: "未知", status: "dirty" as const } : l
    );
    saveLines(next);
    log("cast", "移除本章角色", { name });
  }

  function unbindCast(name: string) {
    if (!project) return;
    onSave({
      ...project,
      casts: project.casts.map((c) =>
        c.name === name
          ? {
              ...c,
              voiceHistory: pushCastVoiceHistory(c),
              voicePath: "",
              voice: "",
              cloudModel: undefined,
              cloudVoice: undefined,
              cloudName: undefined,
            }
          : c
      ),
    });
    log("cast", "解绑音色", { name });
  }

  function prependLine() {
    if (blockWhileGenerating("插入台词")) return;
    const id = Math.max(0, ...script.map((l) => l.id)) + 1;
    const line: ProjectLine = {
      id,
      speaker: "旁白",
      text: "",
      emotion: "平静",
      speed: 1,
      status: "pending",
      audio: "",
    };
    saveLines([line, ...script]);
    setEditing(id);
    setCurrent(id);
    log("edit", "在最前面插入台词", { id });
  }

  function deleteLine(id: number) {
    if (blockWhileGenerating("删除台词")) return;
    const next = script.filter((l) => l.id !== id);
    if (!next.length) {
      setGenMsg("至少保留一句台词");
      return;
    }
    const target = script.find((l) => l.id === id);
    if (target?.audio) deleteAudio(target.audio);
    target?.audioHistory?.forEach((file) => deleteAudio(file));
    saveLines(next);
    if (current === id) setCurrent(next[0].id);
    if (editing === id) setEditing(null);
    if (speakerFor === id) setSpeakerFor(null);
    setChecked((prev) => {
      if (!prev.has(id)) return prev;
      const cleared = new Set(prev);
      cleared.delete(id);
      return cleared;
    });
    setLineStatus((prev) => {
      const key = lineStatusKey(chapter?.id ?? "", id);
      if (!(key in prev)) return prev;
      const cleared = { ...prev };
      delete cleared[key];
      return cleared;
    });
    setLineMenu(null);
    log("edit", "删除台词", { id, left: next.length });
  }

  function insertLine(afterId?: number) {
    if (blockWhileGenerating("插入台词")) return;
    const id = Math.max(0, ...script.map((l) => l.id)) + 1;
    const line: ProjectLine = {
      id,
      speaker: selected?.speaker || "旁白",
      text: "",
      emotion: "平静",
      speed: 1,
      status: "pending",
      audio: "",
    };
    const at = afterId ? script.findIndex((l) => l.id === afterId) + 1 : script.length;
    const next = [...script.slice(0, at), line, ...script.slice(at)];
    saveLines(next);
    setEditing(id);
    setCurrent(id);
    log("edit", "插入台词", { afterId: afterId ?? null, id });
  }

  function openChapter(target: ProjectChapter) {
    chapterIdRef.current = target.id;
    setChapterId(target.id);
    setCurrent(target.lines[0]?.id ?? 1);
    setEditingSource(false);
    setSourceDraft("");
  }

  async function addChapter() {
    if (!project) return;
    if (blockWhileGenerating("新建章节")) return;
    const title = await askText("章节标题", `第 ${project.chapters.length + 1} 章`);
    if (!title?.trim()) return;
    const next: ProjectChapter = {
      id: `ch-${Date.now().toString(36)}`,
      title: title.trim(),
      source: "",
      lines: [],
    };
    onSave({ ...project, chapters: [...project.chapters, next] });
    chapterIdRef.current = next.id;
    setChapterId(next.id);
    setScript([]);
    setSourceDraft("");
    setEditingSource(true);
    log("chapter", "新建章节", { id: next.id, title: next.title });
  }

  async function renameChapter(target: ProjectChapter) {
    if (!project) return;
    const title = await askText("章节标题", target.title);
    if (!title?.trim() || title.trim() === target.title) return;
    onSave({
      ...project,
      chapters: project.chapters.map((c) =>
        c.id === target.id ? { ...c, title: title.trim() } : c
      ),
    });
    log("chapter", "重命名章节", { id: target.id, title: title.trim() });
  }

  async function deleteChapter(target: ProjectChapter) {
    if (!project) return;
    if (blockWhileGenerating("删除章节")) return;
    if (project.chapters.length <= 1) {
      setGenMsg("至少保留一章");
      return;
    }
    if (!window.confirm(`删除章节「${target.title}」？\n\n它下面的 ${target.lines.length} 句台词也会删除。`)) return;

    for (const line of target.lines) {
      if (line.audio) deleteAudio(line.audio);
      line.audioHistory?.forEach((file) => deleteAudio(file));
    }
    const rest = project.chapters.filter((c) => c.id !== target.id);
    clearChapterStatus(target.id);
    onSave({ ...project, chapters: rest });
    if (chapterId === target.id) {
      openChapter(rest[0]);
    }
    log("chapter", "删除章节", { id: target.id, title: target.title, lines: target.lines.length });
  }

  function beginEditSource() {
    setSourceDraft(chapter?.source ?? "");
    setEditingSource(true);
  }

  function saveSource() {
    if (!project || !chapter) return;
    onSave({
      ...project,
      chapters: project.chapters.map((c) =>
        c.id === chapter.id ? { ...c, source: sourceDraft } : c
      ),
    });
    setEditingSource(false);
    log("chapter", "保存原文", { id: chapter.id, chars: sourceDraft.length });
  }

  function toggleCheck(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runSplit() {
    if (task === "running") return;
    if (blockWhileGenerating("重拆台词")) return;
    const source = chapter?.source?.trim();
    if (!source) {
      setGenMsg("这一章没有原文，导入时保留原文才能重新拆分");
      return;
    }
    if (!window.confirm("规则重拆只按引号和分段断句，不调用 AI。文字完全相同的旧台词会保留原来的角色、情绪、语速和音频；新拆出的句子要再用「AI分析」或手动指派。继续？")) return;

    setTask("running");
    setLogs([]);
    setView("source");
    addLog(`读取原文 ${source.length.toLocaleString()} 字`);

    try {
      const r = await splitText(source);
      addLog(`规则拆分完成：${r.count} 句`);
      const fresh = segmentsToLines(r.segments);
      refineSpeakers(fresh, (project?.casts ?? []).map((c) => c.name));
      const { lines, staleAudio } = carryOverLines(fresh, chapter?.lines ?? []);
      staleAudio.forEach((file) => deleteAudio(file));
      const carried = lines.filter((line) => line.audio).length;
      if (carried) addLog(`沿用 ${carried} 句已有角色、情绪和音频`);

      const base = project?.casts ?? [];
      const casts = [...base];
      for (const line of lines) {
        if (isRealCharacter(line.speaker) && !casts.some((c) => c.name === line.speaker)) {
          casts.push(newCast(line.speaker));
        }
      }

      const low = r.segments.filter((s) => s.confidence < 0.7).length;
      if (low) addLog(`低置信度 ${low} 句，可用 AI 标注角色`);
      saveLines(lines, casts);
      if (chapter?.id) clearChapterStatus(chapter.id);
      if (chapterIdRef.current === chapter?.id) setCurrent(lines[0]?.id ?? 1);
      addLog(`写入完成：${lines.length} 句 · ${casts.length} 个角色`);
      setTask("done");
      log("split", "工作台重新拆分", { chapter: chapter?.title, lines: lines.length, casts: casts.length });
    } catch (e) {
      addLog(`拆分失败：${(e as Error).message}`);
      setTask("idle");
      log("split", "工作台拆分失败", { error: (e as Error).message });
    }
  }

  async function applyAnnotation(baseLines: ProjectLine[], baseCasts: ProjectCast[], context = "") {
    const roster = baseCasts
      .filter((c) => c.name && c.name !== "旁白")
      .map((c) => (c.desc && c.desc !== "待匹配音色" ? `${c.name}（${c.desc}）` : c.name))
      .join("、");
    const fullContext = [context, roster ? `角色表：${roster}` : ""].filter(Boolean).join("\n");
    const res = await annotateLines(
      baseLines.map((l) => ({ id: l.id, speaker: l.speaker, text: l.text })),
      baseCasts.map((c) => c.name),
      0,
      fullContext
    );

    let changed = 0;
    const next = baseLines.map((l) => {
      const hit = res.changes.find((c) => c.id === l.id);
      if (!hit) return l;
      const speaker =
        hit.speaker && (hit.speaker === "未知" || baseCasts.some((c) => c.name === hit.speaker))
          ? hit.speaker
          : l.speaker;
      const emotion = hit.emotion || l.emotion;
      const speedValue = Number.isFinite(Number(hit.speed))
        ? Math.min(2, Math.max(0.5, Number(hit.speed)))
        : l.speed;
      if (speaker === l.speaker && emotion === l.emotion && speedValue === l.speed) return l;
      changed += 1;
      return { ...l, speaker, emotion, speed: speedValue, status: "dirty" as const };
    });

    const casts = [...baseCasts];
    for (const line of next) {
      if (isRealCharacter(line.speaker) && !casts.some((c) => c.name === line.speaker)) {
        casts.push(newCast(line.speaker));
      }
    }

    return { next, casts, changed, res };
  }

  async function annotateWithAi() {
    if (annotating || !script.length) return;
    if (blockWhileGenerating("运行 AI 标注")) return;
    if (!castList.some((c) => c.name !== "旁白" && c.name !== "未知")) {
      setGenMsg("当前没有角色候选，先点「AI 重拆本章」");
      showToast("当前没有角色候选，先点「AI 重拆本章」");
      return;
    }

    setAnnotating(true);
    setTask("running");
    setLogs([]);
    setAiThinking("");
    startAiClock();
    setAiProgress({ done: 0, total: 1 });
    const segments = Math.max(1, Math.ceil(script.length / 220));
    addLog(
      `整章交给 AI：${script.length} 句 · ${castList.length} 个角色 · 开启思考${
        segments > 1 ? ` · 分 ${segments} 段` : ""
      }`
    );
    let failed = false;
    const off = onAiProgress((p) => {
      setAiMsg(p.message);
      setAiProgress({ done: p.done, total: p.total });
      if (p.reasoning) {
        setAiThinking((prev) => {
          const nextText = prev + p.reasoning;
          return nextText.length > 12000 ? nextText.slice(-12000) : nextText;
        });
      }
    });

    try {
      const { next, casts, changed, res } = await applyAnnotation(
        script,
        project?.casts ?? [],
        `${project?.title || ""} · ${chapter?.title || ""}`
      );
      saveLines(next, casts);

      if (res.cancelled) {
        addLog(`已停止，保留已完成部分：修改 ${changed} 句`);
      } else {
        addLog(`AI 标注完成：修改 ${changed} 句 · ${casts.length} 个角色`);
        setTask("done");
      }
      log("ai", "AI 标注角色完成", {
        changed,
        cancelled: res.cancelled,
        nextBatch: res.nextBatch,
        casts: casts.length,
      });
      showAiDone(
        res.cancelled ? "AI 标注已停止" : "AI 标注完成",
        res.usage,
        `修改 ${changed} 句 · ${casts.length} 个角色`
      );
    } catch (e) {
      failed = true;
      const msg = (e as Error).message;
      addLog(`AI 标注失败：${msg}`);
      setAiMsg(`AI 标注失败：${msg}`);
      setAiProgress({ done: 0, total: 0 });
      setTask("idle");
      log("ai", "AI 标注角色失败", { error: msg });
    } finally {
      off();
      setAnnotating(false);
      stopAiClock();
      if (!failed) {
        setAiMsg("");
        setAiThinking("");
        setAiProgress({ done: 0, total: 0 });
      }
    }
  }

  async function aiRebuildChapter() {
    if (blockWhileGenerating("重拆本章")) return;
    const source = chapter?.source?.trim();
    if (!source) {
      setGenMsg("这一章没有原文，导入时保留原文才能重拆");
      return;
    }
    if (!window.confirm("会先用规则重新拆句，再调 AI 分析角色、标注情绪和语速。\n\n思考模式通常需要 2–10 分钟；慢一些，但角色和语气判断更准。继续？")) return;

    setView("source");
    setTask("running");
    setLogs([]);
    setAnnotating(true);
    setAiThinking("");
    startAiClock();
    setAiProgress({ done: 0, total: 0 });
    addLog(`读取原文 ${source.length.toLocaleString()} 字`);

    let failed = false;
    const off = onAiProgress((p) => {
      setAiMsg(p.message);
      setAiProgress({ done: p.done, total: p.total });
      if (p.reasoning) {
        setAiThinking((prev) => {
          const nextText = prev + p.reasoning;
          return nextText.length > 12000 ? nextText.slice(-12000) : nextText;
        });
      }
    });

    try {
      const r = await splitText(source);
      const baseLines: ProjectLine[] = r.segments.map((s, j) => ({
        id: j + 1,
        speaker: s.speaker,
        paragraph: s.paragraph,
        text: s.text,
        emotion: s.emotion || "平静",
        speed: 1,
        status: "pending",
        audio: "",
      }));
      refineSpeakers(baseLines, (project?.casts ?? []).map((c) => c.name));

      const baseCasts = [...(project?.casts ?? [])];
      for (const line of baseLines) {
        if (isRealCharacter(line.speaker) && !baseCasts.some((c) => c.name === line.speaker)) {
          baseCasts.push(newCast(line.speaker));
        }
      }

      addLog(`规则拆分 ${baseLines.length} 句，开始 AI 分析角色`);
      let usage = emptyAiUsage();
      try {
        const extracted = await extractCasts(source, `${project?.title || ""} · ${chapter?.title || ""}`);
        usage = addAiUsage(usage, extracted.usage);
        let added = 0;
        for (const c of extracted.casts) {
          if (isRealCharacter(c.name) && !baseCasts.some((x) => x.name === c.name)) {
            baseCasts.push({
              ...newCast(c.name),
              desc: [c.gender, c.age, c.desc].filter(Boolean).join(" · ") || "待匹配音色",
            });
            added += 1;
          }
        }
        addLog(`AI 分析角色：新增 ${added} 个`);
      } catch (e) {
        addLog(`AI 角色分析失败，继续用规则结果：${(e as Error).message}`);
      }

      addLog("开始 AI 标注角色、情绪和语速（整章 · 开启思考）");
      const { next, casts, changed, res } = await applyAnnotation(
        baseLines,
        baseCasts,
        `${project?.title || ""} · ${chapter?.title || ""}`
      );
      usage = addAiUsage(usage, res.usage);
      for (const old of chapter?.lines ?? []) {
        if (old.audio) deleteAudio(old.audio);
        old.audioHistory?.forEach((file) => deleteAudio(file));
      }
      saveLines(next, casts);
      if (chapter?.id) clearChapterStatus(chapter.id);
      if (chapterIdRef.current === chapter?.id) setCurrent(next[0]?.id ?? 1);

      addLog(
        res.cancelled
          ? `已停止，保留 ${changed} 句修改`
          : `完成：${next.length} 句 · ${casts.length} 个角色 · 修改 ${changed} 句`
      );
      setTask(res.cancelled ? "idle" : "done");
      log("ai", "AI 重拆本章", {
        lines: next.length,
        casts: casts.length,
        changed,
        cancelled: res.cancelled,
      });
      showAiDone(
        res.cancelled ? "AI 重拆本章已停止" : "AI 重拆本章完成",
        usage,
        `${next.length} 句 · ${casts.length} 个角色 · 修改 ${changed} 句`
      );
    } catch (e) {
      failed = true;
      const msg = (e as Error).message;
      addLog(`AI 重拆失败：${msg}`);
      setAiMsg(`AI 重拆失败：${msg}`);
      setAiProgress({ done: 0, total: 0 });
      setTask("idle");
      log("ai", "AI 重拆失败", { error: msg });
    } finally {
      off();
      setAnnotating(false);
      stopAiClock();
      if (!failed) {
        setAiMsg("");
        setAiThinking("");
        setAiProgress({ done: 0, total: 0 });
      }
    }
  }

  async function rebuildAllLines(skipConfirm = false) {
    if (!project || annotating) return;
    if (blockWhileGenerating("整本重拆")) return;
    if (
      !skipConfirm &&
      !window.confirm(`会重新拆分全部 ${project.chapters.length} 章，只按章节标记拆台词，不新增、不删除、不改名任何角色；文字相同的台词保留角色、情绪、语速和音频。继续？`)
    ) {
      return;
    }

    genStopRef.current = false;
    setAnnotating(true);
    setTask("running");
    setLogs([]);
    setAiProgress({ done: 0, total: project.chapters.length });
    const off = onAiProgress((p) => setAiMsg(p.message));

    try {
      const chapters: ProjectChapter[] = [];
      const casts = project.casts ?? [];
      const known = new Set(casts.map((c) => c.name));
      let totalLines = 0;
      let stopped = false;

      for (let i = 0; i < project.chapters.length; i++) {
        if (genStopRef.current) {
          stopped = true;
          break;
        }
        const src = project.chapters[i];
        setAiMsg(`第 ${i + 1}/${project.chapters.length} 章 · ${src.title}`);
        setAiProgress({ done: i, total: project.chapters.length });

        if (!src.source.trim()) {
          chapters.push({ ...src, lines: [] });
          continue;
        }

        const r = await splitText(src.source);
        const fresh = segmentsToLines(r.segments);
        for (const line of fresh) {
          if (line.speaker !== "旁白" && !known.has(line.speaker)) line.speaker = "未知";
        }
        const { lines, staleAudio } = carryOverLines(fresh, src.lines);
        staleAudio.forEach((file) => deleteAudio(file));

        chapters.push({ ...src, lines });
        totalLines += lines.length;
        onSave({
          ...project,
          chapters: [...chapters, ...project.chapters.slice(i + 1)],
        });
      }

      const rest = project.chapters.slice(chapters.length);
      onSave({ ...project, chapters: [...chapters, ...rest] });
      setLineStatus({});
      if (chapters[0]) {
        chapterIdRef.current = chapters[0].id;
        setChapterId(chapters[0].id);
        setCurrent(chapters[0].lines[0]?.id ?? 1);
        setEditingSource(false);
        setSourceDraft("");
      }
      addLog(
        stopped
          ? `整本拆章节已停止：${chapters.length} 章 · ${totalLines} 句`
          : `整本拆章节完成：${chapters.length} 章 · ${totalLines} 句 · 角色未改动`
      );
      setTask(stopped ? "idle" : "done");
      log("ai", "整本拆章节完成", { chapters: chapters.length, lines: totalLines, stopped });
    } catch (e) {
      addLog(`整本拆章节失败：${(e as Error).message}`);
      setTask("idle");
      log("ai", "整本拆章节失败", { error: (e as Error).message });
    } finally {
      off();
      setAnnotating(false);
      setAiMsg("");
      setAiProgress({ done: 0, total: 0 });
    }
  }

  async function annotateAllChapters(skipConfirm = false) {
    if (!project || annotating) return;
    if (blockWhileGenerating("整本角色标注")) return;
    if (
      !skipConfirm &&
      !window.confirm(
        `会逐章分析角色、情绪和语速；单章思考通常需要 2–10 分钟。章节多时会调用很多次 AI，可以随时停止。继续？`
      )
    ) {
      return;
    }

    genStopRef.current = false;
    setAnnotating(true);
    setTask("running");
    setLogs([]);
    setAiThinking("");
    startAiClock();
    setAiProgress({ done: 0, total: project.chapters.length });
    let failed = false;
    const off = onAiProgress((p) => {
      setAiMsg(p.message);
      if (p.reasoning) {
        setAiThinking((prev) => {
          const nextText = prev + p.reasoning;
          return nextText.length > 12000 ? nextText.slice(-12000) : nextText;
        });
      }
    });

    try {
      let casts = (project.casts ?? []).filter(
        (c) => c.name === "旁白" || isRealCharacter(c.name)
      );
      const known = new Set(casts.map((c) => c.name));
      let usage = emptyAiUsage();
      const chapters: ProjectChapter[] = [];
      let changedTotal = 0;
      let processed = 0;
      let stopped = false;

      addLog("先分析整本角色表");
      try {
        const bookSource = project.chapters.map((c) => c.source).filter(Boolean).join("\n\n");
        if (bookSource.trim()) {
          const allCasts = await extractCasts(bookSource, project.title);
          usage = addAiUsage(usage, allCasts.usage);
          let added = 0;
          for (const c of allCasts.casts) {
            if (isRealCharacter(c.name) && !casts.some((x) => x.name === c.name)) {
              casts.push({
                ...newCast(c.name),
                desc: [c.gender, c.age, c.desc].filter(Boolean).join(" · ") || "待匹配音色",
              });
              known.add(c.name);
              added += 1;
            }
          }
          addLog(`整本角色分析：新增 ${added} 个`);
        }
      } catch (e) {
        addLog(`整本角色分析失败，继续逐章：${(e as Error).message}`);
      }

      for (let i = 0; i < project.chapters.length; i++) {
        if (genStopRef.current) {
          stopped = true;
          break;
        }

        const src = project.chapters[i];
        setAiMsg(`第 ${i + 1}/${project.chapters.length} 章 · ${src.title}`);
        setAiProgress({ done: i, total: project.chapters.length });

        if (!src.lines.length) {
          chapters.push(src);
          continue;
        }

        const srcLines = src.lines.map((line) =>
          line.speaker === "旁白" ||
          line.speaker === "未知" ||
          known.has(line.speaker)
            ? line
            : { ...line, speaker: "未知" }
        );

        setAiThinking("");
        try {
          const extracted = await extractCasts(
            src.source || "",
            `${project.title} · ${src.title}`
          );
          usage = addAiUsage(usage, extracted.usage);
          for (const c of extracted.casts) {
            if (isRealCharacter(c.name) && !casts.some((x) => x.name === c.name)) {
              casts.push({
                ...newCast(c.name),
                desc: [c.gender, c.age, c.desc].filter(Boolean).join(" · ") || "待匹配音色",
              });
              known.add(c.name);
            }
          }

          const { next, casts: nextCasts, changed, res } = await applyAnnotation(
            srcLines,
            casts,
            `${project.title} · ${src.title}`
          );
          usage = addAiUsage(usage, res.usage);
          casts = nextCasts;
          changedTotal += changed;
          processed += 1;
          chapters.push({ ...src, lines: next });

          onSave({
            ...project,
            casts,
            chapters: [...chapters, ...project.chapters.slice(i + 1)],
          });

          if (res.cancelled) {
            stopped = true;
            break;
          }
        } catch (e) {
          if ((e as Error).message.includes("停止")) {
            stopped = true;
            break;
          }
          addLog(`第 ${i + 1} 章标注失败：${(e as Error).message}`);
          chapters.push(src);
        }
      }

      const rest = project.chapters.slice(chapters.length);
      onSave({ ...project, casts, chapters: [...chapters, ...rest] });
      addLog(
        stopped
          ? `整本标注已停止：完成 ${processed} 章 · 修改 ${changedTotal} 句`
          : `整本标注完成：${processed} 章 · 修改 ${changedTotal} 句`
      );
      setTask(stopped ? "idle" : "done");
      log("ai", "整本标注角色完成", { processed, changedTotal, stopped });
      showAiDone(
        stopped ? "整本角色标注已停止" : "整本角色标注完成",
        usage,
        `完成 ${processed} 章 · 修改 ${changedTotal} 句`
      );
    } catch (e) {
      failed = true;
      const msg = (e as Error).message;
      addLog(`整本标注失败：${msg}`);
      setAiMsg(`整本标注失败：${msg}`);
      setAiProgress({ done: 0, total: 0 });
      setTask("idle");
      log("ai", "整本标注失败", { error: msg });
    } finally {
      off();
      setAnnotating(false);
      stopAiClock();
      if (!failed) {
        setAiMsg("");
        setAiThinking("");
        setAiProgress({ done: 0, total: 0 });
      }
    }
  }

  async function stopAi() {
    genStopRef.current = true;
    const stopped = await cancelAi();
    addLog(stopped ? "已请求停止，正在收尾…" : "当前没有正在运行的 AI 任务");
  }

  function lineIsCloud(line: ProjectLine) {
    const cast = castList.find((c) => c.name === line.speaker);
    return !!(cast?.cloudModel && cast.cloudVoice);
  }

  function generationLimit(lines: ProjectLine[]) {
    return lines.some(lineIsCloud) ? 2 : 1;
  }

  async function synthesizeLine(line: ProjectLine): Promise<string> {
    const cast = castList.find((c) => c.name === line.speaker);
    if (cast?.cloudModel && cast.cloudVoice) {
      const emotion = line.emotion && line.emotion !== "平静" ? `用${line.emotion}的语气` : "用自然平静的语气";
      const speed =
        Math.abs(Number(line.speed) - 1) > 0.01
          ? `，语速 ${Number(line.speed).toFixed(2)} 倍，1 是正常语速`
          : "";
      const r = await cloudTTS({
        text: line.text,
        model: cast.cloudModel,
        voice: cast.cloudVoice,
        instruction: `${emotion}${speed}。`,
      });
      return r.url;
    }

    let voice = cast?.voicePath;
    if (!voice) {
      const { voices } = await getVoices();
      if (!voices.length) throw new Error("音色库是空的，去角色页绑定一个音色");
      const desc = cast?.desc || "";
      const gender = desc.includes("女") ? "女" : desc.includes("男") ? "男" : "";
      const age = desc.includes("少年")
        ? "少年"
        : desc.includes("中年")
          ? "中年"
          : desc.includes("老年")
            ? "中老年"
            : "";
      const match =
        voices.find((v) => (!gender || v.gender === gender) && (!age || v.age === age)) ||
        voices.find((v) => !gender || v.gender === gender) ||
        voices[0];
      voice = match?.path;
    }
    if (!voice) throw new Error("没有可用的参考音频");
    const r = await synthesize({
      text: line.text,
      voice,
      lang: "ZH",
      speed: line.speed,
      emo_vector: EMOTION_VECTORS[line.emotion] || EMOTION_VECTORS["平静"],
      emo_alpha: 0.85,
    });
    return r.url;
  }

  function speakSystem(text: string) {
    if (!("speechSynthesis" in window)) {
      setGenMsg("当前系统不支持语音试听");
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    const voice =
      systemVoices.find((v) => v.name === systemVoice) ||
      systemVoices.find((v) => v.lang.toLowerCase().startsWith("zh"));
    if (voice) utterance.voice = voice;
    utterance.onerror = () => setGenMsg("系统语音播放失败，检查系统是否装了中文语音");
    synth.speak(utterance);
    log("tts", "系统语音试听", { chars: text.length, voice: voice?.name || "默认" });
  }

  function applyPlaybackRate(audio: HTMLAudioElement) {
    const rate = audioRateRef.current;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
  }

  function ensureAudio() {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.preload = "auto";
    const syncDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(audio.duration);
      }
    };
    audio.onloadedmetadata = syncDuration;
    audio.ondurationchange = syncDuration;
    audio.onloadeddata = syncDuration;
    audio.ontimeupdate = () => {
      setAudioTime(audio.currentTime);
      syncDuration();
    };
    audio.onplay = () => {
      applyPlaybackRate(audio);
      setAudioPlaying(true);
    };
    audio.onpause = () => setAudioPlaying(false);
    audio.onerror = () => {
      setAudioPlaying(false);
      setGenMsg("音频加载失败，文件可能已被删除");
    };
    audioRef.current = audio;
    return audio;
  }

  function loadAndPlay(src: string, onEnded?: () => void, force = false) {
    if (!src) return;
    const audio = ensureAudio();
    if (!force && audioSrc === src) {
      if (audio.paused) {
        applyPlaybackRate(audio);
        audio.play().catch(() => setAudioPlaying(false));
      } else {
        audio.pause();
      }
      return;
    }

    audio.pause();
    audio.onended = () => {
      setAudioPlaying(false);
      onEnded?.();
    };
    audio.src = src;
    setAudioSrc(src);
    setAudioTime(0);
    setAudioDuration(0);
    setAudioPlaying(true);
    audio.load();
    applyPlaybackRate(audio);
    audio.play().catch((e) => {
      setAudioPlaying(false);
      setGenMsg("播放被浏览器拦住了，再点一次播放键");
      log("audio", "播放失败", { src, error: (e as Error).message });
    });
  }

  function togglePlay() {
    if (!audioRef.current) {
      playCurrent();
      return;
    }
    if (audioRef.current.paused) {
      applyPlaybackRate(audioRef.current);
      audioRef.current.play().catch(() => {});
      setAudioPlaying(true);
    } else {
      audioRef.current.pause();
      setAudioPlaying(false);
    }
  }

  function playContinuous(queue: ProjectLine[], index: number) {
    if (index >= queue.length) {
      continuousRef.current = null;
      setGenMsg("连续试听播放完毕");
      return;
    }
    const line = queue[index];
    continuousRef.current = { queue, index };
    log("audio", "连续试听切到下一句", { index: index + 1, total: queue.length, lineId: line.id });
    setCurrent(line.id);
    setFlashLine(line.id);
    loadAndPlay(audioUrl(line.audio!), () => playContinuous(queue, index + 1), true);
  }

  function playCurrent() {
    if (auditionMode === "continuous") {
      const start = script.findIndex((l) => l.id === selected?.id);
      const queue = script.slice(Math.max(0, start)).filter((l) => l.audio);
      if (!queue.length) {
        setGenMsg("从当前句往后还没有生成音频");
        return;
      }
      playContinuous(queue, 0);
      return;
    }
    if (selected?.audio) {
      continuousRef.current = null;
      loadAndPlay(audioUrl(selected.audio));
    } else setGenMsg("这一句还没有生成音频");
  }

  function playLine(line: ProjectLine) {
    continuousRef.current = null;
    if (line.audio) loadAndPlay(audioUrl(line.audio));
    else setGenMsg(`第 ${line.id} 句还没有生成音频`);
  }

  function markGenTarget(line: ProjectLine) {
    const cast = castList.find((c) => c.name === line.speaker);
    const info = castEngineInfo(cast);
    setGenTarget({
      id: line.id,
      speaker: line.speaker,
      engine: info.engine,
      detail: info.detail,
      cloud: info.cloud,
    });
  }

  async function generateSingle(line: ProjectLine) {
    if (genState === "generating") {
      showToast("正在生成其他句子，先停止或等它完成");
      return;
    }
    const originChapter = chapter?.id ?? "";
    const statusKey = lineStatusKey(originChapter, line.id);
    setCancelableGen(false);
    setGenState("generating");
    setGenProgress({ done: 0, total: 1 });
    markGenTarget(line);
    setLineStatus((prev) => ({ ...prev, [statusKey]: "generating" }));
    setGenMsg(`正在生成第 ${line.id} 句…`);
    showToast(`正在生成第 ${line.id} 句 · ${line.speaker}`);
    try {
      const url = await withTimeout(
        synthesizeLine(line),
        240000,
        "生成超时（4 分钟），请检查网络或引擎后重试"
      );
      saveChapterLines(originChapter, (lines) =>
        lines.map((l) => (l.id === line.id ? applyGeneratedAudio(l, line, url) : l))
      );
      setGenState("done");
      setGenProgress({ done: 1, total: 1 });
      setLineStatus((prev) => ({ ...prev, [statusKey]: "" }));
      setGenMsg(`第 ${line.id} 句生成完成，正在播放`);
      showToast(`第 ${line.id} 句生成完成`);
      loadAndPlay(audioUrl(url));
    } catch (e) {
      setGenState("error");
      setLineStatus((prev) => ({ ...prev, [statusKey]: "error" }));
      setGenMsg((e as Error).message);
      showToast(`第 ${line.id} 句失败：${(e as Error).message}`);
      log("generate", "单句生成失败", {
        lineId: line.id,
        speaker: line.speaker,
        error: (e as Error).message,
      });
    }
  }

  function generateCurrent() {
    if (selected) generateSingle(selected);
  }

  async function generateChapter(target: ProjectChapter) {
    if (genState === "generating" || !project) return;
    const targets = target.lines.filter(
      (l) => l.text.trim() && (l.status !== "done" || !l.audio)
    );
    if (!targets.length) {
      setGenMsg(`「${target.title}」没有待生成的句子`);
      return;
    }
    if (
      !window.confirm(
        `生成本章「${target.title}」？\n\n会生成 ${targets.length} 句待生成或改动过的台词，已有音频且没改动的句子不会重跑。`
      )
    ) {
      return;
    }

    openChapter(target);
    setCurrent(targets[0].id);
    genStopRef.current = false;
    setCancelableGen(true);
    setGenState("generating");
    setGenProgress({ done: 0, total: targets.length });
    let ok = 0;
    let finished = 0;
    const limit = generationLimit(targets);

    await runPool(targets, limit, async (line) => {
      if (genStopRef.current) return;
      const statusKey = lineStatusKey(target.id, line.id);
      setGenMsg(`「${target.title}」 ${finished + 1}/${targets.length} · ${line.speaker}`);
      markGenTarget(line);
      setLineStatus((prev) => ({ ...prev, [statusKey]: "generating" }));
      try {
        const url = await withTimeout(
          synthesizeLine(line),
          240000,
          "生成超时（4 分钟），请检查网络或引擎后重试"
        );
        saveChapterLines(target.id, (lines) =>
          lines.map((l) => (l.id === line.id ? applyGeneratedAudio(l, line, url) : l)), undefined, false
        );
        ok++;
        setLineStatus((prev) => ({ ...prev, [statusKey]: "" }));
      } catch (e) {
        setLineStatus((prev) => ({ ...prev, [statusKey]: "error" }));
        log("generate", "生成失败", {
          lineId: line.id,
          speaker: line.speaker,
          error: (e as Error).message,
        });
        setGenMsg(`第 ${line.id} 句失败：${(e as Error).message}`);
      } finally {
        finished++;
        setGenProgress({ done: finished, total: targets.length });
      }
    });

    persistProject();
    setGenState(genStopRef.current ? "idle" : "done");
    setGenMsg(genStopRef.current ? `已停止：完成 ${ok} 句` : `「${target.title}」完成 ${ok} 句`);
    log("generate", "生成本章", { chapter: target.title, ok, total: targets.length });
  }

  async function generateChecked() {
    if (genState === "generating" || !checked.size) return;
    const targets = script.filter((l) => checked.has(l.id) && l.text.trim());
    if (!targets.length) return;
    const originChapter = chapter?.id ?? "";

    genStopRef.current = false;
    setCancelableGen(true);
    setGenState("generating");
    setGenProgress({ done: 0, total: targets.length });
    let ok = 0;
    let finished = 0;
    const limit = generationLimit(targets);

    await runPool(targets, limit, async (line) => {
      if (genStopRef.current) return;
      const statusKey = lineStatusKey(originChapter, line.id);
      setGenMsg(`生成勾选 ${finished + 1}/${targets.length} · 第 ${line.id} 句 · ${line.speaker}`);
      markGenTarget(line);
      setLineStatus((prev) => ({ ...prev, [statusKey]: "generating" }));
      try {
        const url = await withTimeout(
          synthesizeLine(line),
          240000,
          "生成超时（4 分钟），请检查网络或引擎后重试"
        );
        saveChapterLines(originChapter, (lines) =>
          lines.map((l) => (l.id === line.id ? applyGeneratedAudio(l, line, url) : l)), undefined, false
        );
        ok++;
        setLineStatus((prev) => ({ ...prev, [statusKey]: "" }));
      } catch (e) {
        setLineStatus((prev) => ({ ...prev, [statusKey]: "error" }));
        log("generate", "生成失败", {
          lineId: line.id,
          speaker: line.speaker,
          error: (e as Error).message,
        });
        setGenMsg(`第 ${line.id} 句失败：${(e as Error).message}`);
      } finally {
        finished++;
        setGenProgress({ done: finished, total: targets.length });
      }
    });

    setChecked(new Set());
    persistProject();
    setGenState(genStopRef.current ? "idle" : "done");
    setGenMsg(genStopRef.current ? `已停止：完成 ${ok} 句` : `勾选生成完成 ${ok} 句`);
    log("generate", "生成勾选", { ok, total: targets.length });
  }

  async function generateBatch(mode: "pending" | "all" = "pending") {
    if (genState === "generating") return;

    const currentScript = script;
    const originChapter = chapter?.id ?? "";
    const targets =
      mode === "all"
        ? currentScript.filter((l) => l.text.trim())
        : currentScript.filter((l) => l.text.trim() && (l.status !== "done" || !l.audio));
    if (!targets.length) {
      setGenMsg("没有待生成的句子");
      return;
    }

    genStopRef.current = false;
    setCancelableGen(true);
    setGenState("generating");
    const failedLines: ProjectLine[] = [];
    let ok = 0;
    let fail = 0;
    let finished = 0;
    let retried = 0;
    const limit = generationLimit(targets);
    setGenProgress({ done: 0, total: targets.length });

    await runPool(targets, limit, async (line) => {
      if (genStopRef.current) return;
      const statusKey = lineStatusKey(originChapter, line.id);
      setGenMsg(`正在生成 ${finished + 1}/${targets.length} · 第 ${line.id} 句 · ${line.speaker}`);
      markGenTarget(line);
      setLineStatus((prev) => ({ ...prev, [statusKey]: "generating" }));
      try {
        const url = await withTimeout(
          synthesizeLine(line),
          240000,
          "生成超时（4 分钟），请检查网络或引擎后重试"
        );
        saveChapterLines(originChapter, (lines) =>
          lines.map((l) => (l.id === line.id ? applyGeneratedAudio(l, line, url) : l)), undefined, false
        );
        ok++;
        setLineStatus((prev) => ({ ...prev, [statusKey]: "" }));
      } catch (e) {
        fail++;
        failedLines.push(line);
        setLineStatus((prev) => ({ ...prev, [statusKey]: "error" }));
        log("generate", "生成失败", {
          lineId: line.id,
          speaker: line.speaker,
          error: (e as Error).message,
        });
        setGenMsg(`第 ${line.id} 句失败：${(e as Error).message}`);
      } finally {
        finished++;
        setGenProgress({ done: finished, total: targets.length });
      }
    });

    if (!genStopRef.current && failedLines.length) {
      // 失败大多来自云端限流：重试改成串行并留出间隔，避免并发再次撞限。
      const retryTotal = failedLines.length;
      let retryDone = 0;
      setGenProgress({ done: 0, total: retryTotal });
      await runPool(failedLines, 1, async (line) => {
        if (genStopRef.current) return;
        const statusKey = lineStatusKey(originChapter, line.id);
        setGenMsg(`重试第 ${line.id} 句 · ${line.speaker}（${retryDone + 1}/${retryTotal}）`);
        markGenTarget(line);
        setLineStatus((prev) => ({ ...prev, [statusKey]: "generating" }));
        await sleep(700);
        try {
          const url = await withTimeout(
            synthesizeLine(line),
            240000,
            "生成超时（4 分钟），请检查网络或引擎后重试"
          );
          saveChapterLines(originChapter, (lines) =>
            lines.map((l) => (l.id === line.id ? applyGeneratedAudio(l, line, url) : l)), undefined, false
          );
          ok++;
          fail--;
          retried++;
          setLineStatus((prev) => ({ ...prev, [statusKey]: "" }));
        } catch (e) {
          setLineStatus((prev) => ({ ...prev, [statusKey]: "error" }));
          log("generate", "重试仍失败", {
            lineId: line.id,
            speaker: line.speaker,
            error: (e as Error).message,
          });
        } finally {
          retryDone++;
          setGenProgress({ done: retryDone, total: retryTotal });
        }
      });
    }

    const stopped = genStopRef.current;
    persistProject();

    if (stopped) {
      setGenState("idle");
      setGenMsg(`已取消：完成 ${ok} 句，剩余 ${targets.length - ok - fail} 句`);
      log("generate", "取消批量生成", { ok, fail, total: targets.length });
      return;
    }

    setGenState(fail ? "error" : "done");
    setGenMsg(
      fail
        ? `完成 ${ok} 句 · 重试成功 ${retried} 句 · 仍失败 ${fail} 句`
        : `完成 ${ok} 句${retried ? ` · 重试成功 ${retried} 句` : ""}`
    );
    log("generate", "批量生成完成", { ok, fail, retried, total: targets.length });
  }

  function stopGenerate() {
    genStopRef.current = true;
    setGenMsg("正在取消，已发出的请求会在返回后停下…");
    log("generate", "请求取消批量生成", {});
  }

  return (
    <section className="page active" id="page-studio">
      <div className="studio-head">
        <span className="crumb">
          <b>{project?.title ?? "未命名项目"}</b>
          <span className="sep">/</span>
          {chapter?.title ?? "—"}
        </span>
        <span className="crumb">
          {script.reduce((a, l) => a + l.text.length, 0)} 字 · {script.length} 句 ·{" "}
          {script.filter((l) => l.status !== "done" || !l.audio).length} 句待生成
          {unknownCount > 0 ? ` · ${unknownCount} 句待确认` : ""}
        </span>
        <div className="right">
          {checked.size > 0 && (
            <>
              <button className="btn small" onClick={generateChecked} disabled={genState === "generating"}>
                生成勾选配音 ({checked.size})
              </button>
              <button className="btn small ghost" onClick={() => setChecked(new Set())}>
                取消勾选
              </button>
            </>
          )}

          <div className="ai-menu-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              className={`btn small ai-trigger ${aiMenuOpen ? "open" : ""}`}
              onClick={() => setAiMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={aiMenuOpen}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
                <path d="M8 12h8" />
              </svg>
              AI分析
            </button>
            {aiMenuOpen && (
              <div className="ai-menu" role="menu">
                <div className="ai-menu-head">
                  <b>AI 分析</b>
                  <span>先分析角色和说话人，再补未知台词</span>
                  <span className="ai-menu-tip">
                    思考模式通常需要 2–10 分钟；慢一些，但角色和语气判断更准。
                  </span>
                </div>
                <button
                  role="menuitem"
                  disabled={annotating}
                  onClick={() => {
                    setAiMenuOpen(false);
                    void aiRebuildChapter();
                  }}
                >
                  <b>AI 重拆本章</b>
                  <span>整章交给 AI 思考：台词 + 角色 + 情绪 + 语速</span>
                </button>
                <button
                  role="menuitem"
                  disabled={annotating}
                  onClick={() => {
                    setAiMenuOpen(false);
                    void annotateWithAi();
                  }}
                >
                  <b>AI 标注角色</b>
                  <span>整章开启思考，只改说话人、情绪、语速</span>
                </button>
                <button
                  role="menuitem"
                  disabled={annotating || task === "running"}
                  onClick={() => {
                    setAiMenuOpen(false);
                    void runSplit();
                  }}
                >
                  <b>规则重拆</b>
                  <span>只按引号和分段拆句，不调用 AI；相同文字保留原标注</span>
                </button>
              </div>
            )}
          </div>

          <div className="seg" style={{ flex: "0 0 108px" }}>
            <button
              className={auditionMode === "single" ? "on" : ""}
              onClick={() => setAuditionMode("single")}
            >
              单句
            </button>
            <button
              className={auditionMode === "continuous" ? "on" : ""}
              onClick={() => setAuditionMode("continuous")}
            >
              连续
            </button>
          </div>
          <button className="btn small" onClick={playCurrent}>
            {auditionMode === "continuous" ? "连续试听" : "试听当前句"}
          </button>
          <button
            className="btn small primary"
            disabled={genState === "generating" && !cancelableGen}
            onClick={
              genState === "generating"
                ? cancelableGen
                  ? stopGenerate
                  : undefined
                : () => setGenDialog(true)
            }
          >
            {genState === "generating" ? (cancelableGen ? "取消生成" : "生成中…") : "生成配音"}
          </button>
        </div>
      </div>

      <div className="workflow-strip">
        <span className="workflow-label">推荐流程</span>
        <span className="workflow-step first">AI分析角色</span>
        <span className="workflow-arrow">→</span>
        <span className="workflow-step">补齐角色、指派未知台词</span>
        <span className="workflow-arrow">→</span>
        <span className="workflow-step">绑定音色</span>
        <span className="workflow-arrow">→</span>
        <span className="workflow-step">生成配音</span>
        <span className="workflow-arrow">→</span>
        <span className="workflow-step">成片导出</span>
      </div>

      <div className="studio-body">
        <aside className="rail-left">
          <div className="rail-block">
            <div className="section-label" style={{ marginBottom: 9 }}>章节</div>
            {(project?.chapters ?? []).map((c, i) => (
              <div
                key={c.id}
                className={`chapter ${chapter?.id === c.id ? "active" : ""}`}
                tabIndex={0}
                aria-current={chapter?.id === c.id ? "true" : undefined}
                onClick={() => openChapter(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget) {
                    openChapter(c);
                  }
                }}
              >
                <span className="chapter-no">{String(i + 1).padStart(2, "0")}</span>
                <span className="chapter-title">{c.title}</span>
                <span
                  className={`chapter-state ${
                    c.lines.length && c.lines.every((l) => l.audio) ? "done" : "part"
                  }`}
                />
                <div className="chapter-actions">
                  <button aria-label="生成本章" title="生成本章" onClick={(e) => { e.stopPropagation(); generateChapter(c); }}>▶</button>
                  <button aria-label="重命名章节" title="重命名" onClick={(e) => { e.stopPropagation(); renameChapter(c); }}>✎</button>
                  <button aria-label="删除章节" title="删除章节" onClick={(e) => { e.stopPropagation(); deleteChapter(c); }}>✕</button>
                </div>
              </div>
            ))}
            {!project?.chapters?.length && <div className="chapter-empty">还没有章节</div>}
            <button className="add-chapter" onClick={addChapter} disabled={!project}>＋ 新建章节</button>
          </div>
        </aside>

        <div className="script-wrap">
          <div className="script-head">
            <div>
              <div className="script-title">{chapter?.title ?? "—"}</div>
              <div className="script-meta">
                {script.length} 句 · {script.reduce((a, l) => a + l.text.length, 0)} 字 · 预计{" "}
                {Math.max(1, Math.round(script.reduce((a, l) => a + l.text.length, 0) / 3.6 / 60))} 分 · 双击台词编辑
              </div>
            </div>
            <div className="view-switch">
              <button className={view === "lines" ? "on" : ""} onClick={() => setView("lines")}>台词稿</button>
              <button className={view === "source" ? "on" : ""} onClick={() => setView("source")}>原文</button>
            </div>
          </div>

          {genState === "generating" && (
            <div className="gen-banner" role="status" aria-live="polite">
              <span className="gen-spinner" />
              <div className="gen-banner-text">
                <b>{genMsg || "正在生成配音…"}</b>
                <span>
                  {genTarget
                    ? `${genTarget.engine} · 第 ${genTarget.id} 句 · ${genTarget.speaker}`
                    : "准备中…"}
                  {cancelableGen ? " · 长时间没变化可停止后重试" : ""}
                </span>
              </div>
              {genProgress.total > 0 && (
                <div className="gen-banner-bar" aria-hidden="true">
                  <i
                    style={{
                      width: `${Math.round(
                        (genProgress.done / Math.max(1, genProgress.total)) * 100
                      )}%`,
                    }}
                  />
                </div>
              )}
              <span className="gen-banner-num">
                {genProgress.total > 0 ? `${genProgress.done}/${genProgress.total}` : "—"}
              </span>
              {cancelableGen && (
                <button className="btn small" onClick={stopGenerate}>
                  停止
                </button>
              )}
            </div>
          )}

          <div className={`script ${view === "lines" ? "" : "hidden"}`}>
            <div className="inner">
              <div className="add-line add-line-top">
                <button onClick={prependLine}>＋ 在最前面插入台词</button>
              </div>
              {script.map((line) => (
                <div
                  key={line.id}
                  id={`line-${line.id}`}
                  className={`line ${current === line.id ? "current" : ""} ${flashLine === line.id ? "flash" : ""}`}
                  tabIndex={0}
                  aria-current={current === line.id ? "true" : undefined}
                  onClick={() => {
                    setCurrent(line.id);
                    setSpeakerFor(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) {
                      setCurrent(line.id);
                      setSpeakerFor(null);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCurrent(line.id);
                    setLineMenu({
                      x: Math.min(e.clientX, window.innerWidth - 190),
                      y: Math.min(e.clientY, window.innerHeight - 180),
                      line,
                    });
                  }}
                >
                  <label className="line-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`选择第 ${line.id} 句`}
                      checked={checked.has(line.id)}
                      onChange={() => toggleCheck(line.id)}
                    />
                  </label>
                  <div
                    className="line-speaker"
                    role="button"
                    tabIndex={0}
                    aria-expanded={speakerFor === line.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSpeakerFor(speakerFor === line.id ? null : line.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setSpeakerFor(speakerFor === line.id ? null : line.id);
                      }
                    }}
                    title="点击更换角色"
                  >
                    {line.speaker}
                    {speakerFor === line.id && (
                      <div className="speaker-menu" onClick={(e) => e.stopPropagation()}>
                        {castList.map((c) => (
                          <button
                            key={c.id}
                            className={c.name === line.speaker ? "on" : ""}
                            onClick={() => changeSpeaker(line.id, c.name)}
                          >
                            {c.name}
                          </button>
                        ))}
                        <button
                          className="new"
                          onClick={async () => {
                            const name = await askText("新角色名");
                            if (name?.trim()) changeSpeaker(line.id, name);
                          }}
                        >
                          ＋ 新角色
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <div
                      className="line-text"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditing(line.id);
                      }}
                    >
                      {editing === line.id ? (
                        <textarea
                          className="line-edit"
                          defaultValue={line.text}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            const value = e.target.value.trim();
                            if (!value) deleteLine(line.id);
                            else updateLine(line.id, { text: value });
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              (e.target as HTMLTextAreaElement).blur();
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        <>
                          {line.stage && <span className="stage">（{line.stage}）</span>}
                          {line.text || <span className="line-empty">空白台词，双击输入</span>}
                        </>
                      )}
                    </div>
                    <div className="line-tags">
                      {line.speaker !== "旁白" && (
                        <span className={`tag kind ${line.speaker === "未知" ? "unknown" : ""}`}>
                          {line.speaker === "未知" ? "待确认角色 · 台词" : "台词"}
                        </span>
                      )}
                      {line.paragraph ? <span className="tag">第 {line.paragraph} 段</span> : null}
                      <span className="tag emotion">{line.emotion}</span>
                      <span className="tag speed">{Number(line.speed).toFixed(2)}×</span>
                      <span
                        className={`line-status ${
                          lineStatus[lineStatusKey(chapter?.id ?? "", line.id)] === "error" ? "error" : line.status
                        }`}
                      >
                        {lineStatus[lineStatusKey(chapter?.id ?? "", line.id)] === "generating" ? (
                          <><span className="spinner" />生成中</>
                        ) : lineStatus[lineStatusKey(chapter?.id ?? "", line.id)] === "error" ? (
                          <><span className="dot" />生成失败</>
                        ) : (
                          <>
                            <span className="dot" />
                            {line.note ?? (line.audio ? "已生成" : statusText[line.status])}
                          </>
                        )}
                      </span>
                      <div className="line-actions">
                        {line.audioHistory?.length ? (
                          <button
                            title={`切换上一版配音${line.audioHistory.length > 1 ? `（还有 ${line.audioHistory.length} 个历史版本）` : ""}`}
                            aria-label="切换上一个音频"
                            onClick={(e) => {
                              e.stopPropagation();
                              switchAudio(line);
                            }}
                          >
                            ⇄
                          </button>
                        ) : null}
                        <button title="生成这句" aria-label="生成这句" onClick={(e) => { e.stopPropagation(); generateSingle(line); }}>↻</button>
                        <button title="系统语音试听（临时）" aria-label="系统语音试听" onClick={(e) => { e.stopPropagation(); speakSystem(line.text); }}>♪</button>
                        <button title="在下方插入台词" aria-label="在下方插入台词" onClick={(e) => { e.stopPropagation(); insertLine(line.id); }}>＋</button>
                        <button title="删除这句" aria-label="删除这句" onClick={(e) => { e.stopPropagation(); deleteLine(line.id); }}>✕</button>
                      </div>
                      <button
                        className="line-play"
                        title="播放这句"
                        aria-label="播放这句"
                        onClick={(e) => {
                          e.stopPropagation();
                          playLine(line);
                        }}
                      >
                        {line.audio && audioSrc === audioUrl(line.audio) && audioPlaying ? "❚❚" : "▶"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="add-line">
                <button onClick={() => insertLine()}>＋ 在末尾新增一句台词</button>
              </div>
            </div>
          </div>

          <div className={`source-view ${view === "source" ? "on" : ""}`}>
            <div className="source-inner">
              <div className="source-toolbar">
                <span>原文 · {chapter?.title ?? "—"} · {chapter?.source.length ?? 0} 字</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>已拆 {script.length} 句 · {castList.length} 个角色</span>
                  {!editingSource ? (
                    <button className="btn ghost small" onClick={beginEditSource} disabled={!chapter}>编辑原文</button>
                  ) : (
                    <>
                      <button className="btn small" onClick={() => setEditingSource(false)}>取消</button>
                      <button className="btn small primary" onClick={saveSource}>保存原文</button>
                    </>
                  )}
                </div>
              </div>
              {editingSource ? (
                <textarea
                  className="input source-editor"
                  value={sourceDraft}
                  onChange={(e) => setSourceDraft(e.target.value)}
                  placeholder="在这里粘贴或编辑这一章的原文，保存后再拆分台词。"
                />
              ) : chapter?.source ? (
                chapter.source
                  .split(/\n\s*\n/)
                  .filter(Boolean)
                  .map((text, i) => (
                    <div
                      key={i}
                      id={`source-p-${i + 1}`}
                      className={`source-block ${flashParagraph === i + 1 ? "flash" : ""}`}
                    >
                      <p>{text}</p>
                      <div className="source-meta">第 {i + 1} 段</div>
                    </div>
                  ))
              ) : (
                <div className="source-empty">
                  <p>这一章还没有原文。</p>
                  <button className="btn small" onClick={beginEditSource}>粘贴原文</button>
                </div>
              )}
            </div>
          </div>

          <div className={`player ${audioPlaying ? "playing" : ""}`}>
            <button
              className="play-btn"
              onClick={togglePlay}
              title="播放 / 暂停"
              aria-label={audioPlaying ? "暂停播放" : "播放当前音频"}
            >
              {audioPlaying ? "❚❚" : "▶"}
            </button>
            <span className="time">{formatClock(audioTime)} / {formatClock(audioDuration)}</span>
            <div className="wave" title="点击或拖动跳转">
              {wave.map((b, i) => {
                const played = audioDuration > 0 && i / wave.length <= audioTime / audioDuration;
                return (
                  <i
                    key={i}
                    className={`${played ? "played" : ""} ${b.peak ? "peak" : ""}`}
                    style={{ height: `${b.h}px` }}
                  />
                );
              })}
              <input
                type="range"
                className="wave-seek"
                min={0}
                max={audioDuration > 0 ? audioDuration : 0}
                step={0.01}
                value={audioDuration > 0 ? Math.min(audioTime, audioDuration) : 0}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (!audioRef.current || !Number.isFinite(value)) return;
                  try {
                    audioRef.current.currentTime = value;
                    setAudioTime(value);
                  } catch {
                    setGenMsg("音频还没加载完，稍后再拖动");
                  }
                }}
                aria-label="播放进度"
              />
              <span
                className="wave-head"
                style={{
                  left: `${
                    audioDuration > 0
                      ? Math.min(100, Math.max(0, (audioTime / audioDuration) * 100))
                      : 0
                  }%`,
                }}
                aria-hidden="true"
              />
            </div>
            <div className="player-right">
              <span className="queue">
                <span className="vu"><i /><i /><i /><i /><i /></span>
                {script.filter((l) => l.status === "done" && l.audio).length} / {script.length}
              </span>
              <select
                className="select speed-select"
                defaultValue={audioRateRef.current}
                onChange={(e) => {
                  const rate = Number(e.target.value);
                  audioRateRef.current = rate;
                  if (audioRef.current) applyPlaybackRate(audioRef.current);
                }}
                title="播放倍速"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3].map((rate) => (
                  <option key={rate} value={rate}>{rate.toFixed(2)}×</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <aside className="rail-right">
              {(annotating || aiMsg || aiProgress.total > 0) && (
                <div className="right-block" id="taskBlock">
                  <div className="right-title">
                    <span className="section-label">AI 分析进度</span>
                    <span className={`task-state ${annotating || task === "running" ? "running" : "done"}`}>
                      {annotating ? "分析中" : task === "running" ? "进行中" : "就绪"}
                    </span>
                  </div>

                  {aiMsg || aiProgress.total > 0 ? (
                    <div className="tool-progress">
                      {aiProgress.total > 0 && (
                        <div className="task-bar" style={{ flex: 1 }}>
                          <i style={{ width: `${Math.round((aiProgress.done / aiProgress.total) * 100)}%` }} />
                        </div>
                      )}
                      <span>{aiMsg}</span>
                    </div>
                  ) : null}

                  {annotating && (
                    <div className="ai-wait-note">
                      思考模式通常需要 2–10 分钟；慢一些，但角色和语气判断更准。
                    </div>
                  )}

                  {(annotating || aiThinking) && (
                    <div className="ai-thinking">
                      <div className="ai-thinking-head">
                        <span>思考过程</span>
                        <span>
                          {annotating
                            ? `已思考 ${formatClock(aiElapsed)} · 仅展示`
                            : "已结束 · 不写入结果"}
                        </span>
                      </div>
                      <div className="ai-thinking-body" ref={thinkingBoxRef}>
                        {aiThinking ||
                          "角色分析阶段不展示思考；进入标注后，模型的思考会实时显示在这里，最终输出不会显示。"}
                      </div>
                    </div>
                  )}

                  {logs.length > 0 && (
                    <div className="task-log" style={{ maxHeight: 140 }}>
                      {logs.map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                  )}

                  {annotating && (
                    <button className="btn small" onClick={stopAi} style={{ width: "100%", marginTop: 8 }}>
                      停止 AI 分析
                    </button>
                  )}

                  {!annotating && (
                    <button className="btn small ghost" onClick={dismissAiPanel} style={{ width: "100%", marginTop: 8 }}>
                      关闭提示
                    </button>
                  )}
                </div>
              )}
              <div className="right-block">
                <div className="right-title">
                  <span className="section-label">当前台词</span>
                  <span className="kbd">第 {selected?.id ?? "—"} 句</span>
                </div>
                {selected && (
                  <>
                    <div className="current-line-box">
                      <b>{selected.speaker}</b>
                      <span>{selected.text || "（空白）"}</span>
                    </div>
                    <div className="current-line-actions">
                      <button className="btn small ghost" onClick={() => speakSystem(selected.text)}>
                        系统试听
                      </button>
                      <button className="btn small ghost" onClick={() => changeSpeaker(selected.id, "旁白")}>
                        设为旁白
                      </button>
                    </div>
                  </>
                )}

                <div className="block-divider" />

                <div className="right-title">
                  <span className="section-label">生成参数</span>
                  <span className="kbd">{selectedEngine.engine}</span>
                </div>

                <div className="field">
                  <div className="field-label"><span>音色</span><span style={{ color: "var(--text-faint)" }}>
                    {selectedCast?.cloudVoice ? "云端" : selectedCast?.voicePath ? "本地" : "自动匹配"}
                  </span></div>
                  <div className="value-line">
                    {selectedCast
                      ? selectedCast.cloudVoice || selectedCast.voicePath
                        ? castVoiceLabel(selectedCast)
                        : "未绑定 · 按角色性别年龄自动匹配"
                      : "按角色性别选参考音频"}
                  </div>
                </div>

                <div className="field">
                  <div className="field-label"><span>情绪</span><span style={{ color: "var(--copper-bright)" }}>{selected?.emotion ?? "平静"}</span></div>
                  <select
                    className="select"
                    value={selected?.emotion ?? "平静"}
                    onChange={(e) => selected && updateLine(selected.id, { emotion: e.target.value })}
                  >
                    {["平静", "高兴", "愤怒", "悲伤", "害怕", "厌恶", "忧郁", "惊讶", "克制", "试探", "警惕", "疲惫"].map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <div className="field-label"><span>语速</span><span style={{ color: "var(--copper-bright)" }}>
                    {Number(selected?.speed ?? speed).toFixed(2)}×
                  </span></div>
                  <div className="speed-row">
                    <input
                      className="slider"
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={Number(selected?.speed ?? speed)}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setSpeed(value);
                        if (selected) updateLine(selected.id, { speed: value }, undefined, false);
                      }}
                      onPointerUp={() => persistProject()}
                      onKeyUp={() => persistProject()}
                      onBlur={() => persistProject()}
                    />
                    <input
                      className="input speed-number"
                      type="number"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={Number(selected?.speed ?? speed)}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (!Number.isFinite(value)) return;
                        const next = Math.min(2, Math.max(0.5, value));
                        setSpeed(next);
                        if (selected) updateLine(selected.id, { speed: next });
                      }}
                    />
                  </div>
                  <div className="tool-help">0.5 最慢，1 正常，2 最快；云 TTS 和本地 IndexTTS 都支持。</div>
                </div>

                <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
                  <button className="btn small" style={{ flex: 1 }} onClick={playCurrent}>播放音频</button>
                  <button className="btn small primary" style={{ flex: 1 }} onClick={generateCurrent} disabled={genState === "generating"}>
                    {genState === "generating" ? "生成中…" : "重新生成"}
                  </button>
                </div>
              </div>

              <div className="right-block">
                <div className="right-title">
                  <span className="section-label">本章角色</span>
                  <button className="btn ghost small" onClick={() => setRoleMenu((v) => !v)}>
                    ＋ 添加角色
                  </button>
                </div>
                <p className="tool-help">
                  移除只改本章，不删项目角色。
                </p>

                {roleMenu && (
                  <div className="role-add-menu">
                    {castList
                      .filter((c) => !chapterCastNames.includes(c.name))
                      .map((c) => (
                        <button key={c.id} onClick={() => addRoleToChapter(c.name)}>{c.name}</button>
                      ))}
                    <button className="new" onClick={createRoleForChapter}>
                      ＋ 新建角色
                    </button>
                  </div>
                )}

                {chapterCasts.map((c) => {
                  const roleLines = script.filter((l) => l.speaker === c.name);
                  const count = roleLines.length;
                  const rolePos = roleLines.findIndex((l) => l.id === current);
                  return (
                    <div
                      key={c.name}
                      className={`cast-card ${c.name === selected?.speaker ? "active" : ""}`}
                    >
                      <div className="avatar">{c.initial}</div>
                      <div className="cast-info">
                        <span className="cast-name">{c.name}</span>
                        <span className="cast-desc">{castVoiceLabel(c)}</span>
                      </div>
                      <div className="cast-jump" onClick={(e) => e.stopPropagation()}>
                        <button
                          title="上一句"
                          aria-label="上一句"
                          onClick={() => jumpRole(c.name, -1)}
                          disabled={count < 2}
                        >
                          ▲
                        </button>
                        <input
                          className="cast-jump-input"
                          type="number"
                          min={1}
                          max={count}
                          value={rolePos >= 0 ? rolePos + 1 : 1}
                          onChange={(e) => jumpRoleTo(c.name, Number(e.target.value) - 1)}
                          title="输入第几句并跳转"
                          aria-label={`跳到${c.name}的第几句`}
                        />
                        <span>/{count}</span>
                        <button
                          title="下一句"
                          aria-label="下一句"
                          onClick={() => jumpRole(c.name, 1)}
                          disabled={count < 2}
                        >
                          ▼
                        </button>
                      </div>
                      <div className="cast-actions">
                        <button
                          title="把当前句换成这个角色"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selected) changeSpeaker(selected.id, c.name);
                          }}
                        >
                          设为当前句
                        </button>
                        {c.name !== "未知" && isProjectCast(c.name) && (
                          <button
                            title="解绑音色"
                            onClick={(e) => {
                              e.stopPropagation();
                              unbindCast(c.name);
                            }}
                          >
                            解绑
                          </button>
                        )}
                        {c.name !== "未知" && c.name !== "旁白" && (
                          <button
                            title="从本章移除"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeChapterRole(c.name);
                            }}
                          >
                            移除
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={`right-block gen-card ${genState === "generating" ? "active" : ""}`}>
                <div className="right-title"><span className="section-label">本次生成</span></div>
                <div className="engine-note">
                  <b>{genEngine.engine}</b>
                  {genEngine.cloud ? " · 云端生成，保留本地音频" : " · 本地或远端 Gradio"}<br />
                  {genTarget
                    ? `第 ${genTarget.id} 句 · ${genTarget.speaker}`
                    : "并发按音色自动调整 · 只跑待生成或改动过的句子"}
                  {genMsg && (
                    <div style={{ marginTop: 6, color: genState === "error" ? "var(--danger)" : "var(--teal)" }}>
                      {genMsg}
                    </div>
                  )}
                </div>
              </div>


        </aside>
      </div>

      {lineMenu && (
        <div
          className="context-menu"
          style={{ left: lineMenu.x, top: lineMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button onClick={() => { speakSystem(lineMenu.line.text); setLineMenu(null); }}>系统语音试听</button>
          <button onClick={() => { setSpeakerFor(lineMenu.line.id); setLineMenu(null); }}>换角色</button>
          <button onClick={() => { insertLine(lineMenu.line.id); setLineMenu(null); }}>在下方插入</button>
          <button className="danger" onClick={() => { deleteLine(lineMenu.line.id); setLineMenu(null); }}>删除这句</button>
        </div>
      )}

      {genDialog && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGenDialog(false);
          }}
        >
          <div className="modal gen-dialog">
            <div className="modal-head">
              <div>
                <div className="modal-title">生成配音</div>
                <div className="modal-desc">
                  本章共 {allCount} 句，{pendingCount} 句待生成或改动过。
                </div>
              </div>
              <button className="modal-close" aria-label="关闭" onClick={() => setGenDialog(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="tool-help" style={{ marginBottom: 12 }}>
                生成配音：按角色绑定的音色调用云 TTS 或本地 IndexTTS，不会改台词。已有音频会保留上一版，可随时切换回退。
              </p>
              <button
                className="edit-option"
                disabled={!pendingCount}
                onClick={() => {
                  setGenDialog(false);
                  void generateBatch("pending");
                }}
              >
                <b>生成未生成和改动过的（{pendingCount} 句）</b>
                <span>已有音频且没改动的句子不会重跑，最省时间。</span>
              </button>
              <button
                className="edit-option"
                onClick={() => {
                  setGenDialog(false);
                  void generateBatch("all");
                }}
              >
                <b>全部重新生成（{allCount} 句）</b>
                <span>所有台词重新生成；上一版音频会保留在历史里，可切换回退。</span>
              </button>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setGenDialog(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}
