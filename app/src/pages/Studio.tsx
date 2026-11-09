import { useEffect, useMemo, useRef, useState } from "react";
import { getVoices, splitText, synthesize, audioUrl, deleteAudio } from "../api";
import { annotateLines, cancelAi, onAiProgress, extractCasts } from "../ai";
import { cloudTTS } from "../cloud";
import { isRealCharacter } from "../import";
import { log } from "../log";
import { askText } from "../prompt";
import { castVoiceLabel, type Project, type ProjectCast, type ProjectChapter, type ProjectLine } from "../projects";

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

export default function Studio({
  project,
  onSave,
}: {
  project: Project | null;
  onSave: (p: Project) => void;
}) {
  const [chapterId, setChapterId] = useState(project?.chapters[0]?.id ?? "");
  const chapter = project?.chapters.find((c) => c.id === chapterId) ?? project?.chapters[0];
  const castList: ProjectCast[] = project?.casts ?? [];

  const [script, setScript] = useState<ProjectLine[]>(chapter?.lines ?? []);
  const [view, setView] = useState<View>("lines");
  const [current, setCurrent] = useState(1);
  const [task, setTask] = useState<TaskState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [speed, setSpeed] = useState("稍慢");
  const [genState, setGenState] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [genMsg, setGenMsg] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [speakerFor, setSpeakerFor] = useState<number | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [systemVoice, setSystemVoice] = useState("");
  const [lineMenu, setLineMenu] = useState<{ x: number; y: number; line: ProjectLine } | null>(null);
  const [audioSrc, setAudioSrc] = useState("");
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioRate, setAudioRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [editingSource, setEditingSource] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [lineStatus, setLineStatus] = useState<Record<number, "generating" | "error" | "">>({});
  const [toast, setToast] = useState("");
  const [roleMenu, setRoleMenu] = useState(false);
  const annBatchRef = useRef(0);
  const genStopRef = useRef(false);

  useEffect(() => {
    const first = project?.chapters[0];
    if (first) {
      setChapterId(first.id);
      setScript(first.lines);
    }
  }, [project?.id]);

  useEffect(() => {
    const c = project?.chapters.find((x) => x.id === chapterId);
    if (c) setScript(c.lines);
  }, [chapterId, project?.chapters]);

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
    audioRef.current?.pause();
    setAudioPlaying(false);
  }, [current]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const selected = script.find((l) => l.id === current) ?? script[0];
  const selectedCast = castList.find((c) => c.name === selected?.speaker);
  const unknownCount = script.filter((l) => l.speaker === "未知").length;
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
      return (
        script.filter((l) => l.speaker === b.name).length -
        script.filter((l) => l.speaker === a.name).length
      );
    });

  const wave = useMemo(
    () =>
      Array.from({ length: 120 }, (_, i) => {
        const t = i / 120;
        const env = Math.sin(t * Math.PI) * 0.6 + 0.4;
        const h = 3 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.7)) * 24 * env;
        return { h, peak: h > 22 };
      }),
    []
  );

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 4500);
  }

  function addLog(msg: string) {
    const d = new Date();
    const ts = `${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    setLogs((prev) => [...prev, `${ts} ${msg}`]);
  }

  function saveLines(next: ProjectLine[], casts?: ProjectCast[]) {
    setScript(next);
    if (project && chapter) {
      onSave({
        ...project,
        casts: casts ?? project.casts,
        chapters: project.chapters.map((c) =>
          c.id === chapter.id ? { ...c, lines: next } : c
        ),
      });
    }
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

  function switchAudio(line: ProjectLine) {
    if (!line.audio || !line.audioHistory?.length) return;
    const prev = line.audioHistory[0];
    const rest = [line.audio, ...line.audioHistory.slice(1)];
    updateLine(line.id, { audio: prev, audioHistory: rest, status: "done" });
  }

  function updateLine(id: number, patch: Partial<ProjectLine>, casts?: ProjectCast[]) {
    saveLines(
      script.map((l) =>
        l.id === id
          ? { ...l, ...patch, status: (patch.status ?? "dirty") as ProjectLine["status"] }
          : l
      ),
      casts
    );
  }

  function newCast(name: string): ProjectCast {
    return {
      id: `cast-${Date.now().toString(36)}`,
      name,
      initial: name.slice(0, 1),
      desc: "待匹配音色",
      voice: "",
      voicePath: "",
      color: "#7d8fa8",
    };
  }

  function changeSpeaker(lineId: number, name: string) {
    const clean = name.trim();
    if (!clean) return;
    const base = project?.casts ?? castList;
    const casts = base.some((c) => c.name === clean) ? undefined : [...base, newCast(clean)];
    updateLine(lineId, { speaker: clean }, casts);
    setSpeakerFor(null);
    log("edit", "切换说话人", { lineId, speaker: clean });
  }

  async function addRoleToChapter(name: string) {
    if (!project) return;
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
      speed: "正常",
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
    const id = Math.max(0, ...script.map((l) => l.id)) + 1;
    const line: ProjectLine = {
      id,
      speaker: "旁白",
      text: "",
      emotion: "平静",
      speed: "正常",
      status: "pending",
      audio: "",
    };
    saveLines([line, ...script]);
    setEditing(id);
    setCurrent(id);
    log("edit", "在最前面插入台词", { id });
  }

  function deleteLine(id: number) {
    const target = script.find((l) => l.id === id);
    if (target?.audio) deleteAudio(target.audio);
    target?.audioHistory?.forEach((file) => deleteAudio(file));
    const next = script.filter((l) => l.id !== id);
    if (!next.length) {
      setGenMsg("至少保留一句台词");
      return;
    }
    saveLines(next);
    if (current === id) setCurrent(next[0].id);
    log("edit", "删除台词", { id, left: next.length });
  }

  function insertLine(afterId?: number) {
    const id = Math.max(0, ...script.map((l) => l.id)) + 1;
    const line: ProjectLine = {
      id,
      speaker: selected?.speaker || "旁白",
      text: "",
      emotion: "平静",
      speed: "正常",
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

  async function addChapter() {
    if (!project) return;
    const title = await askText("章节标题", `第 ${project.chapters.length + 1} 章`);
    if (!title?.trim()) return;
    const next: ProjectChapter = {
      id: `ch-${Date.now().toString(36)}`,
      title: title.trim(),
      source: "",
      lines: [],
    };
    onSave({ ...project, chapters: [...project.chapters, next] });
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
    onSave({ ...project, chapters: rest });
    if (chapterId === target.id) {
      setChapterId(rest[0].id);
      setScript(rest[0].lines);
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
    const source = chapter?.source?.trim();
    if (!source) {
      setGenMsg("这一章没有原文，导入时保留原文才能重新拆分");
      return;
    }
    if (!window.confirm("重新拆分会用新结果替换这一章的台词，继续？")) return;

    setTask("running");
    setLogs([]);
    setView("source");
    addLog(`读取原文 ${source.length.toLocaleString()} 字`);

    try {
      const r = await splitText(source);
      addLog(`规则拆分完成：${r.count} 句`);
      for (const old of chapter?.lines ?? []) {
        if (old.audio) deleteAudio(old.audio);
        old.audioHistory?.forEach((file) => deleteAudio(file));
      }
      const lines = r.segments.map((s, j) => ({
        id: j + 1,
        speaker: s.speaker,
        text: s.text,
        emotion: s.emotion || "平静",
        speed: "正常",
        status: "pending" as const,
        audio: "",
      }));

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
      setCurrent(lines[0]?.id ?? 1);
      addLog(`写入完成：${lines.length} 句 · ${casts.length} 个角色`);
      setTask("done");
      log("split", "工作台重新拆分", { chapter: chapter?.title, lines: lines.length, casts: casts.length });
    } catch (e) {
      addLog(`拆分失败：${(e as Error).message}`);
      setTask("idle");
      log("split", "工作台拆分失败", { error: (e as Error).message });
    }
  }

  async function applyAnnotation(baseLines: ProjectLine[], baseCasts: ProjectCast[], startBatch = 0) {
    const res = await annotateLines(
      baseLines.map((l) => ({ id: l.id, speaker: l.speaker, text: l.text })),
      baseCasts.map((c) => c.name),
      startBatch
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
      const speedValue = ["很慢", "慢", "正常", "稍慢", "快"].includes(hit.speed) ? hit.speed : l.speed;
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
    if (!castList.some((c) => c.name !== "旁白" && c.name !== "未知")) {
      setGenMsg("当前没有角色候选，先点「AI 重拆本章」");
      showToast("当前没有角色候选，先点「AI 重拆本章」");
      return;
    }

    const batches = Math.ceil(script.length / 60);
    let startBatch = 0;
    if (annBatchRef.current > 0 && annBatchRef.current < batches) {
      const resume = window.confirm(
        `上次标注大概停在第 ${annBatchRef.current * 60} 句。\n\n确定：从停下的地方继续\n取消：全部重新标注`
      );
      if (resume) startBatch = annBatchRef.current;
      else annBatchRef.current = 0;
    }

    setAnnotating(true);
    setTask("running");
    setLogs([]);
    setAiProgress({ done: 0, total: batches });
    addLog(`准备标注 ${script.length} 句 · ${castList.length} 个角色`);
    const off = onAiProgress((p) => {
      setAiMsg(p.message);
      setAiProgress({ done: p.done, total: p.total });
    });

    try {
      const { next, casts, changed, res } = await applyAnnotation(
        script,
        project?.casts ?? [],
        startBatch
      );
      saveLines(next, casts);
      annBatchRef.current = res.cancelled ? res.nextBatch : 0;

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
    } catch (e) {
      addLog(`AI 标注失败：${(e as Error).message}`);
      setTask("idle");
      log("ai", "AI 标注角色失败", { error: (e as Error).message });
    } finally {
      off();
      setAnnotating(false);
      setAiMsg("");
      setAiProgress({ done: 0, total: 0 });
    }
  }

  async function aiRebuildChapter() {
    const source = chapter?.source?.trim();
    if (!source) {
      setGenMsg("这一章没有原文，导入时保留原文才能重拆");
      return;
    }
    if (!window.confirm("会先用规则重新拆句，再调 AI 分析角色、标注情绪和语速。继续？")) return;

    setView("source");
    setTask("running");
    setLogs([]);
    setAnnotating(true);
    setAiProgress({ done: 0, total: 0 });
    addLog(`读取原文 ${source.length.toLocaleString()} 字`);

    const off = onAiProgress((p) => {
      setAiMsg(p.message);
      setAiProgress({ done: p.done, total: p.total });
    });

    try {
      const r = await splitText(source);
      const baseLines: ProjectLine[] = r.segments.map((s, j) => ({
        id: j + 1,
        speaker: s.speaker,
        text: s.text,
        emotion: s.emotion || "平静",
        speed: "正常",
        status: "pending",
        audio: "",
      }));

      const baseCasts = [...(project?.casts ?? [])];
      for (const line of baseLines) {
        if (isRealCharacter(line.speaker) && !baseCasts.some((c) => c.name === line.speaker)) {
          baseCasts.push(newCast(line.speaker));
        }
      }

      addLog(`规则拆分 ${baseLines.length} 句，开始 AI 分析角色`);
      try {
        const extracted = await extractCasts(source);
        let added = 0;
        for (const c of extracted) {
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

      addLog("开始 AI 标注角色、情绪和语速");
      const { next, casts, changed, res } = await applyAnnotation(baseLines, baseCasts, 0);
      saveLines(next, casts);
      setCurrent(next[0]?.id ?? 1);
      annBatchRef.current = res.cancelled ? res.nextBatch : 0;

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
    } catch (e) {
      addLog(`AI 重拆失败：${(e as Error).message}`);
      setTask("idle");
      log("ai", "AI 重拆失败", { error: (e as Error).message });
    } finally {
      off();
      setAnnotating(false);
      setAiMsg("");
      setAiProgress({ done: 0, total: 0 });
    }
  }

  async function rebuildAllLines() {
    if (!project || annotating) return;
    if (!window.confirm(`会重新拆分全部 ${project.chapters.length} 章的台词，只拆句，不分析角色。继续？`)) return;

    genStopRef.current = false;
    setAnnotating(true);
    setTask("running");
    setLogs([]);
    setAiProgress({ done: 0, total: project.chapters.length });
    const off = onAiProgress((p) => setAiMsg(p.message));

    try {
      const chapters: ProjectChapter[] = [];
      const casts = [...(project.casts ?? [])];
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
        for (const old of src.lines) {
          if (old.audio) deleteAudio(old.audio);
          old.audioHistory?.forEach((file) => deleteAudio(file));
        }
        const lines: ProjectLine[] = r.segments.map((s, j) => ({
          id: j + 1,
          speaker: s.speaker,
          text: s.text,
          emotion: s.emotion || "平静",
          speed: "正常",
          status: "pending",
          audio: "",
        }));

        for (const line of lines) {
          if (isRealCharacter(line.speaker) && !casts.some((c) => c.name === line.speaker)) {
            casts.push(newCast(line.speaker));
          }
        }

        chapters.push({ ...src, lines });
        totalLines += lines.length;
        onSave({
          ...project,
          casts,
          chapters: [...chapters, ...project.chapters.slice(i + 1)],
        });
      }

      const rest = project.chapters.slice(chapters.length);
      onSave({ ...project, casts, chapters: [...chapters, ...rest] });
      if (chapters[0]) setChapterId(chapters[0].id);
      addLog(
        stopped
          ? `整本拆台词已停止：${chapters.length} 章 · ${totalLines} 句`
          : `整本拆台词完成：${chapters.length} 章 · ${totalLines} 句`
      );
      setTask(stopped ? "idle" : "done");
      log("ai", "整本拆台词完成", { chapters: chapters.length, lines: totalLines, stopped });
    } catch (e) {
      addLog(`整本拆台词失败：${(e as Error).message}`);
      setTask("idle");
      log("ai", "整本拆台词失败", { error: (e as Error).message });
    } finally {
      off();
      setAnnotating(false);
      setAiMsg("");
      setAiProgress({ done: 0, total: 0 });
    }
  }

  async function annotateAllChapters() {
    if (!project || annotating) return;
    if (
      !window.confirm(
        `会逐章分析角色、情绪和语速，跳过没有「未知」的章节。章节多时会调用很多次 AI，可以随时停止。继续？`
      )
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
      let casts = [...(project.casts ?? [])];
      const chapters: ProjectChapter[] = [];
      let changedTotal = 0;
      let processed = 0;
      let stopped = false;

      for (let i = 0; i < project.chapters.length; i++) {
        if (genStopRef.current) {
          stopped = true;
          break;
        }

        const src = project.chapters[i];
        setAiMsg(`第 ${i + 1}/${project.chapters.length} 章 · ${src.title}`);
        setAiProgress({ done: i, total: project.chapters.length });

        if (!src.lines.length || !src.lines.some((l) => l.speaker === "未知")) {
          chapters.push(src);
          continue;
        }

        try {
          const extracted = await extractCasts(src.source || "");
          for (const c of extracted) {
            if (isRealCharacter(c.name) && !casts.some((x) => x.name === c.name)) {
              casts.push({
                ...newCast(c.name),
                desc: [c.gender, c.age, c.desc].filter(Boolean).join(" · ") || "待匹配音色",
              });
            }
          }

          const { next, casts: nextCasts, changed, res } = await applyAnnotation(
            src.lines,
            casts,
            0
          );
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
    } catch (e) {
      addLog(`整本标注失败：${(e as Error).message}`);
      setTask("idle");
      log("ai", "整本标注失败", { error: (e as Error).message });
    } finally {
      off();
      setAnnotating(false);
      setAiMsg("");
      setAiProgress({ done: 0, total: 0 });
    }
  }

  async function stopAi() {
    genStopRef.current = true;
    const stopped = await cancelAi();
    addLog(stopped ? "已请求停止，正在收尾…" : "当前没有正在运行的 AI 任务");
  }

  async function synthesizeLine(line: ProjectLine): Promise<string> {
    const cast = castList.find((c) => c.name === line.speaker);
    if (cast?.cloudModel && cast.cloudVoice) {
      const emotion = line.emotion && line.emotion !== "平静" ? `用${line.emotion}的语气` : "用自然平静的语气";
      const speed = line.speed && line.speed !== "正常" ? `，语速${line.speed}` : "";
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

  function loadAndPlay(src: string) {
    if (!src) return;
    if (audioSrc === src && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
        setAudioPlaying(true);
      } else {
        audioRef.current.pause();
        setAudioPlaying(false);
      }
      return;
    }

    audioRef.current?.pause();
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.playbackRate = audioRate;
    audio.onloadedmetadata = () =>
      setAudioDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.ontimeupdate = () => setAudioTime(audio.currentTime);
    audio.onplay = () => setAudioPlaying(true);
    audio.onpause = () => setAudioPlaying(false);
    audio.onended = () => setAudioPlaying(false);
    setAudioSrc(src);
    setAudioTime(0);
    setAudioDuration(0);
    setAudioPlaying(true);
    audio.play().catch(() => setAudioPlaying(false));
  }

  function togglePlay() {
    if (!audioRef.current) {
      playCurrent();
      return;
    }
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
      setAudioPlaying(true);
    } else {
      audioRef.current.pause();
      setAudioPlaying(false);
    }
  }

  function playCurrent() {
    if (selected?.audio) loadAndPlay(audioUrl(selected.audio));
    else setGenMsg("这一句还没有生成音频");
  }

  function playLine(line: ProjectLine) {
    if (line.audio) loadAndPlay(audioUrl(line.audio));
    else setGenMsg(`第 ${line.id} 句还没有生成音频`);
  }

  function seekAudio(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    if (audioRef.current && audioDuration) audioRef.current.currentTime = pct * audioDuration;
  }

  function cycleRate() {
    const rates = [1, 1.2, 1.5, 0.8];
    const next = rates[(rates.indexOf(audioRate) + 1) % rates.length];
    setAudioRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  async function generateSingle(line: ProjectLine) {
    if (genState === "generating") {
      showToast("正在生成其他句子，先停止或等它完成");
      return;
    }
    setGenState("generating");
    setLineStatus((prev) => ({ ...prev, [line.id]: "generating" }));
    setGenMsg(`正在生成第 ${line.id} 句…`);
    showToast(`正在生成第 ${line.id} 句 · ${line.speaker}`);
    try {
      const url = await synthesizeLine(line);
      saveLines(
        script.map((l) => (l.id === line.id ? nextAudio(l, url) : l))
      );
      setGenState("done");
      setLineStatus((prev) => ({ ...prev, [line.id]: "" }));
      setGenMsg(`第 ${line.id} 句生成完成，正在播放`);
      showToast(`第 ${line.id} 句生成完成`);
      loadAndPlay(audioUrl(url));
    } catch (e) {
      setGenState("error");
      setLineStatus((prev) => ({ ...prev, [line.id]: "error" }));
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
    const targets = target.lines.filter((l) => l.status !== "done" || !l.audio);
    if (!targets.length) {
      setGenMsg(`「${target.title}」没有待生成的句子`);
      return;
    }

    setChapterId(target.id);
    setCurrent(targets[0].id);
    genStopRef.current = false;
    setGenState("generating");
    const next = [...target.lines];
    let ok = 0;

    for (let i = 0; i < targets.length; i++) {
      if (genStopRef.current) break;
      const line = targets[i];
      setGenMsg(`「${target.title}」 ${i + 1}/${targets.length} · ${line.speaker}`);
      try {
        const url = await synthesizeLine(line);
        const idx = next.findIndex((l) => l.id === line.id);
        next[idx] = nextAudio(next[idx], url);
        ok++;
      } catch (e) {
        log("generate", "生成失败", {
          lineId: line.id,
          speaker: line.speaker,
          error: (e as Error).message,
        });
        setGenMsg(`第 ${line.id} 句失败：${(e as Error).message}`);
      }
    }

    onSave({
      ...project,
      chapters: project.chapters.map((c) =>
        c.id === target.id ? { ...c, lines: next } : c
      ),
    });
    setScript(next);
    setGenState(genStopRef.current ? "idle" : "done");
    setGenMsg(genStopRef.current ? `已停止：完成 ${ok} 句` : `「${target.title}」完成 ${ok} 句`);
    log("generate", "生成本章", { chapter: target.title, ok, total: targets.length });
  }

  async function generateChecked() {
    if (genState === "generating" || !checked.size) return;
    const targets = script.filter((l) => checked.has(l.id));
    if (!targets.length) return;

    genStopRef.current = false;
    setGenState("generating");
    const next = [...script];
    let ok = 0;

    for (let i = 0; i < targets.length; i++) {
      if (genStopRef.current) break;
      const line = targets[i];
      setGenMsg(`生成勾选 ${i + 1}/${targets.length} · 第 ${line.id} 句 · ${line.speaker}`);
      try {
        const url = await synthesizeLine(line);
        const idx = next.findIndex((l) => l.id === line.id);
        next[idx] = nextAudio(next[idx], url);
        setScript([...next]);
        ok++;
      } catch (e) {
        log("generate", "生成失败", {
          lineId: line.id,
          speaker: line.speaker,
          error: (e as Error).message,
        });
        setGenMsg(`第 ${line.id} 句失败：${(e as Error).message}`);
      }
    }

    saveLines(next);
    setChecked(new Set());
    setGenState(genStopRef.current ? "idle" : "done");
    setGenMsg(genStopRef.current ? `已停止：完成 ${ok} 句` : `勾选生成完成 ${ok} 句`);
    log("generate", "生成勾选", { ok, total: targets.length });
  }

  async function generateBatch() {
    if (genState === "generating") return;

    let currentScript = script;
    if (script.some((l) => l.status === "done" && l.audio)) {
      const resume = window.confirm(
        "确定：只生成未完成和改动过的句子\n取消：全部重新生成"
      );
      if (!resume) {
        currentScript = script.map((l) => ({ ...l, status: "dirty" as const }));
        saveLines(currentScript);
      }
    }

    const targets = currentScript.filter((l) => l.status !== "done" || !l.audio);
    if (!targets.length) {
      setGenMsg("没有待生成的句子");
      return;
    }

    genStopRef.current = false;
    setGenState("generating");
    const next = [...currentScript];
    const failedLines: ProjectLine[] = [];
    let ok = 0;
    let fail = 0;
    let stopped = false;

    for (let i = 0; i < targets.length; i++) {
      if (genStopRef.current) {
        stopped = true;
        break;
      }
      const line = targets[i];
      setGenMsg(`正在生成 ${i + 1}/${targets.length} · 第 ${line.id} 句 · ${line.speaker}`);
      try {
        const url = await synthesizeLine(line);
        const idx = next.findIndex((l) => l.id === line.id);
        next[idx] = nextAudio(next[idx], url);
        setScript([...next]);
        ok++;
      } catch (e) {
        fail++;
        failedLines.push(line);
        setGenMsg(`第 ${line.id} 句失败：${(e as Error).message}`);
      }
    }

    if (!stopped) {
      for (const line of failedLines) {
        if (genStopRef.current) {
          stopped = true;
          break;
        }
        setGenMsg(`重试第 ${line.id} 句 · ${line.speaker}`);
        try {
          const url = await synthesizeLine(line);
          const idx = next.findIndex((l) => l.id === line.id);
          next[idx] = nextAudio(next[idx], url);
          setScript([...next]);
          ok++;
          fail--;
        } catch {
          /* 仍然失败，保留 */
        }
      }
    }

    saveLines(next);

    if (stopped) {
      setGenState("idle");
      setGenMsg(`已停止：完成 ${ok} 句，剩余 ${targets.length - ok - fail} 句`);
      log("generate", "停止批量生成", { ok, fail, total: targets.length });
      return;
    }

    setGenState(fail ? "error" : "done");
    setGenMsg(`完成 ${ok} 句${fail ? ` · 失败 ${fail} 句` : ""}`);
    log("generate", "批量生成完成", { ok, fail, total: targets.length });
  }

  function stopGenerate() {
    genStopRef.current = true;
    setGenMsg("正在停止，当前句完成后停下…");
    log("generate", "请求停止批量生成", {});
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
        </span>
        <div className="right">
          {checked.size > 0 && (
            <>
              <button className="btn small" onClick={generateChecked} disabled={genState === "generating"}>
                生成勾选 ({checked.size})
              </button>
              <button className="btn small ghost" onClick={() => setChecked(new Set())}>
                取消勾选
              </button>
            </>
          )}
          <button className="btn small" onClick={runSplit}>拆分台词</button>
          <button className="btn small" onClick={playCurrent}>试听当前句</button>
          <button
            className="btn small primary"
            onClick={genState === "generating" ? stopGenerate : generateBatch}
          >
            {genState === "generating" ? "停止生成" : "生成待生成"}
          </button>
        </div>
      </div>

      <div className="studio-body">
        <aside className="rail-left">
          <div className="rail-block">
            <div className="section-label" style={{ marginBottom: 9 }}>章节</div>
            {(project?.chapters ?? []).map((c, i) => (
              <div
                key={c.id}
                className={`chapter ${chapter?.id === c.id ? "active" : ""}`}
                onClick={() => {
                  setChapterId(c.id);
                  setCurrent(1);
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
                  <button title="生成本章" onClick={(e) => { e.stopPropagation(); generateChapter(c); }}>▶</button>
                  <button title="重命名" onClick={(e) => { e.stopPropagation(); renameChapter(c); }}>✎</button>
                  <button title="删除章节" onClick={(e) => { e.stopPropagation(); deleteChapter(c); }}>✕</button>
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

          <div className={`script ${view === "lines" ? "" : "hidden"}`}>
            <div className="inner">
              <div className="add-line add-line-top">
                <button onClick={prependLine}>＋ 在最前面插入台词</button>
              </div>
              {script.map((line) => (
                <div
                  key={line.id}
                  className={`line ${current === line.id ? "current" : ""}`}
                  onClick={() => {
                    setCurrent(line.id);
                    setSpeakerFor(null);
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
                      checked={checked.has(line.id)}
                      onChange={() => toggleCheck(line.id)}
                    />
                  </label>
                  <div
                    className="line-speaker"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSpeakerFor(speakerFor === line.id ? null : line.id);
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
                      <span className="tag emotion">{line.emotion}</span>
                      <span className="tag speed">{line.speed}</span>
                      <span
                        className={`line-status ${
                          lineStatus[line.id] === "error" ? "error" : line.status
                        }`}
                      >
                        {lineStatus[line.id] === "generating" ? (
                          <><span className="spinner" />生成中</>
                        ) : lineStatus[line.id] === "error" ? (
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
                            title="切换上一个音频"
                            onClick={(e) => {
                              e.stopPropagation();
                              switchAudio(line);
                            }}
                          >
                            ⇄
                          </button>
                        ) : null}
                        <button title="生成这句" onClick={(e) => { e.stopPropagation(); generateSingle(line); }}>⚡</button>
                        <button title="系统语音试听（临时）" onClick={(e) => { e.stopPropagation(); speakSystem(line.text); }}>🔊</button>
                        <button title="在下方插入台词" onClick={(e) => { e.stopPropagation(); insertLine(line.id); }}>＋</button>
                        <button title="删除这句" onClick={(e) => { e.stopPropagation(); deleteLine(line.id); }}>✕</button>
                      </div>
                      <button
                        className="line-play"
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
                    <div key={i} className="source-block">
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

          <div className="player">
            <button className="play-btn" onClick={togglePlay} title="播放 / 暂停">
              {audioPlaying ? "❚❚" : "▶"}
            </button>
            <span className="time">{formatClock(audioTime)} / {formatClock(audioDuration)}</span>
            <div className="wave" onClick={seekAudio} title="点击跳转">
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
            </div>
            <div className="player-right">
              <span className="queue">
                <span className="vu"><i /><i /><i /><i /><i /></span>
                {script.filter((l) => l.status === "done" && l.audio).length} / {script.length}
              </span>
              <button className="speed" onClick={cycleRate} title="切换倍速">
                {audioRate.toFixed(1)}×
              </button>
            </div>
          </div>
        </div>

        <aside className="rail-right">
              <div className="right-block" id="taskBlock">
                <div className="right-title">
                  <span className="section-label">本章工具</span>
                  <span className={`task-state ${task === "running" ? "running" : "done"}`}>
                    {annotating ? "标注中" : task === "running" ? "进行中" : "就绪"}
                  </span>
                </div>

                <div className="task-summary">
                  <span className="dot ok" />
                  <span>
                    {script.length} 句 · {castList.length} 个角色
                    {unknownCount > 0 ? ` · ${unknownCount} 句待确认` : ""}
                  </span>
                </div>

                <p className="tool-help">
                  规则认不准的说话人会标成「未知」。AI 标注只改说话人、情绪、语速，不重拆台词。整本先拆句，角色可以之后逐章分析。
                </p>

                <button
                  className="btn small primary"
                  style={{ width: "100%", marginTop: 8 }}
                  onClick={aiRebuildChapter}
                  disabled={annotating}
                >
                  AI 重拆本章（角色 + 情绪 + 语速）
                </button>

                <div style={{ display: "flex", gap: 7, marginTop: 7 }}>
                  <button className="btn small" style={{ flex: 1 }} onClick={annotateWithAi} disabled={annotating}>
                    AI 标注角色
                  </button>
                  {annotating ? (
                    <button className="btn small" onClick={stopAi}>停止</button>
                  ) : (
                    <button className="btn small" onClick={runSplit} disabled={task === "running"}>
                      仅规则重拆
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 7 }}>
                  <button
                    className="btn small"
                    onClick={rebuildAllLines}
                    disabled={annotating}
                  >
                    整本拆台词（不分析角色）
                  </button>
                  <button
                    className="btn small"
                    onClick={annotateAllChapters}
                    disabled={annotating}
                  >
                    整本 AI 标注角色（逐章）
                  </button>
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

                {logs.length > 0 && (
                  <div className="task-log" style={{ maxHeight: 140 }}>
                    {logs.map((l, i) => <div key={i}>{l}</div>)}
                  </div>
                )}
              </div>

              <div className="right-block">
                <div className="right-title">
                  <span className="section-label">本章角色</span>
                  <button className="btn ghost small" onClick={() => setRoleMenu((v) => !v)}>
                    ＋ 添加角色
                  </button>
                </div>
                <p className="tool-help">
                  只显示本章出现的角色。移除只把本章台词改成「未知」，不会删除项目角色。
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
                  const count = script.filter((l) => l.speaker === c.name).length;
                  return (
                    <div
                      key={c.name}
                      className={`cast-card ${c.name === selected?.speaker ? "active" : ""}`}
                      onClick={() => selected && changeSpeaker(selected.id, c.name)}
                    >
                      <div className="avatar">{c.initial}</div>
                      <div className="cast-info">
                        <span className="cast-name">{c.name}</span>
                        <span className="cast-desc">{castVoiceLabel(c)}</span>
                      </div>
                      <span className="cast-count">{count} 句</span>
                      <div className="cast-actions">
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
                    <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                      <button className="btn small" style={{ flex: 1 }} onClick={() => speakSystem(selected.text)}>
                        系统试听
                      </button>
                      <button className="btn small" style={{ flex: 1 }} onClick={() => changeSpeaker(selected.id, "旁白")}>
                        设为旁白
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="right-block">
                <div className="right-title">
                  <span className="section-label">生成参数</span>
                  <span className="kbd">IndexTTS 2.5</span>
                </div>

                <div className="field">
                  <div className="field-label"><span>音色</span><span style={{ color: "var(--text-faint)" }}>
                    {selectedCast?.cloudVoice ? "云端" : selectedCast?.voicePath ? "本地" : "自动匹配"}
                  </span></div>
                  <div className="input" style={{ opacity: 0.7, lineHeight: "32px" }}>
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
                    {selectedCast?.cloudVoice ? selected?.speed ?? speed : "仅云端"}
                  </span></div>
                  <div className="seg">
                    {["很慢", "慢", "正常", "稍慢", "快"].map((s) => (
                      <button
                        key={s}
                        className={(selected?.speed ?? speed) === s ? "on" : ""}
                        disabled={!selectedCast?.cloudVoice}
                        onClick={() => {
                          setSpeed(s);
                          if (selected) updateLine(selected.id, { speed: s });
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {!selectedCast?.cloudVoice && (
                    <div className="tool-help">本地 IndexTTS 暂不支持单独调节语速；情绪会通过情感向量生效。</div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
                  <button className="btn small" style={{ flex: 1 }} onClick={playCurrent}>播放音频</button>
                  <button className="btn small primary" style={{ flex: 1 }} onClick={generateCurrent} disabled={genState === "generating"}>
                    {genState === "generating" ? "生成中…" : "重新生成"}
                  </button>
                </div>
              </div>

              <div className="right-block">
                <div className="right-title"><span className="section-label">本次生成</span></div>
                <div className="engine-note">
                  <b>{selectedCast?.cloudVoice ? "小米云 TTS" : "IndexTTS 2.5"}</b>
                  {selectedCast?.cloudVoice ? " · 云端生成，保留本地音频" : " · 本地或远端 Gradio"}<br />
                  队列串行 · 只跑待生成或改动过的句子
                  {genMsg && (
                    <div style={{ marginTop: 6, color: genState === "error" ? "#c4553f" : "var(--teal)" }}>
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

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}
