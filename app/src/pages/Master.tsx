import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectLine } from "../projects";
import { revealFile } from "../projects";
import { exportAudio, zipAudio, audioUrl } from "../api";

const TRACK_CLASS = ["", "teal", "red"];
const HISTORY_PREFIX = "shengkan:exports:";

type Scope = "chapter" | "book" | "book-chapters";

interface ExportRecord {
  id: string;
  title: string;
  scope: Scope;
  files: { wav?: string; srt?: string; stems?: string; zip?: string };
  file?: string;
  duration?: number;
  createdAt: string;
}

function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function loadHistory(projectId: string): ExportRecord[] {
  try {
    const raw = localStorage.getItem(`${HISTORY_PREFIX}${projectId}`);
    return raw ? (JSON.parse(raw) as ExportRecord[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(projectId: string, records: ExportRecord[]) {
  try {
    localStorage.setItem(`${HISTORY_PREFIX}${projectId}`, JSON.stringify(records.slice(0, 30)));
  } catch {
    /* localStorage 满了就只保留内存 */
  }
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

function ExportPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.preload = "auto";
    const sync = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    audio.onloadedmetadata = sync;
    audio.ondurationchange = sync;
    audio.onloadeddata = sync;
    audio.ontimeupdate = () => setTime(audio.currentTime);
    audio.onplay = () => setPlaying(true);
    audio.onpause = () => setPlaying(false);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    audio.load();
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [src]);

  return (
    <div className="export-player">
      <button
        className="play-btn"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) audio.play().catch(() => setPlaying(false));
          else audio.pause();
        }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="time">{formatClock(time)} / {formatClock(duration)}</span>
      <input
        className="export-range"
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(time, duration || 0)}
        onChange={(e) => {
          const value = Number(e.target.value);
          setTime(value);
          if (audioRef.current) audioRef.current.currentTime = value;
        }}
      />
      <select
        className="select speed-select"
        value={rate}
        onChange={(e) => {
          const value = Number(e.target.value);
          setRate(value);
          if (audioRef.current) audioRef.current.playbackRate = value;
        }}
      >
        {[0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3].map((v) => (
          <option key={v} value={v}>{v.toFixed(2)}×</option>
        ))}
      </select>
    </div>
  );
}

export default function Master({ project }: { project: Project | null }) {
  const [chapterId, setChapterId] = useState("");
  const [scope, setScope] = useState<Scope>("chapter");
  const [merging, setMerging] = useState(false);
  const [mergeMsg, setMergeMsg] = useState("");
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [formats, setFormats] = useState<"all" | "wav" | "wav-srt">("all");
  const [loudness, setLoudness] = useState(-16);
  const [pauses, setPauses] = useState({ comma: 150, period: 350, paragraph: 500, role: 300 });

  const chapter =
    project?.chapters.find((c) => c.id === chapterId) ?? project?.chapters[0] ?? null;
  const lines = chapter?.lines ?? [];
  const ready = lines.filter((l) => l.audio && l.text.trim());
  const missing = lines.length - ready.length;
  const emptyLines = lines.filter((l) => !l.text.trim()).length;
  const unbound = (project?.casts ?? []).filter(
    (c) => c.name !== "未知" && c.name !== "旁白" && !c.cloudVoice && !c.voicePath
  );

  useEffect(() => {
    if (!project) return;
    const records = loadHistory(project.id);
    setHistory(records);
    setCurrentId(records[0]?.id ?? "");
    setMergeMsg("");
  }, [project?.id]);

  const tracks = useMemo(() => {
    const names: string[] = [];
    for (const line of lines) {
      if (!names.includes(line.speaker)) names.push(line.speaker);
    }
    return names.map((name, index) => {
      const own = lines.filter((l) => l.speaker === name);
      const total = own.reduce((sum, l) => sum + Math.max(1, l.text.length), 0);
      return {
        name,
        cls: TRACK_CLASS[index % TRACK_CLASS.length],
        clips: own.map((l) => ({
          id: l.id,
          width: Math.max(2, (Math.max(1, l.text.length) / total) * 100),
        })),
      };
    });
  }, [lines]);

  const checks = [
    {
      ok: lines.length > 0,
      text: lines.length > 0 ? `本章共 ${lines.length} 句` : "本章还没有台词",
    },
    {
      ok: missing === 0 && lines.length > 0,
      text:
        lines.length === 0
          ? "导入或拆分台词后才能导出"
          : missing === 0
            ? "全部句子都有音频"
            : `${missing} 句还没有音频`,
    },
    {
      ok: unbound.length === 0,
      text:
        unbound.length === 0
          ? "所有角色都绑定了音色"
          : `${unbound.map((c) => c.name).join("、")} 还没有绑定音色`,
    },
    {
      ok: emptyLines === 0,
      text: emptyLines === 0 ? "没有空台词" : `${emptyLines} 句空台词，字幕会是空的`,
    },
  ];
  const passed = checks.filter((c) => c.ok).length;

  function buildLines(source: ProjectLine[]) {
    return source
      .filter((l) => l.audio && l.text.trim())
      .map((l) => ({
        file: l.audio!.split("/").pop()!,
        speaker: l.speaker,
        text: l.text,
      }));
  }

  function buildPauses(source: ProjectLine[]) {
    const usable = source.filter((l) => l.audio && l.text.trim());
    return usable.slice(0, -1).map((line, i) => {
      const next = usable[i + 1];
      const ms =
        next && next.speaker !== line.speaker
          ? pauses.role
          : /[，、；：]$/.test(line.text)
            ? pauses.comma
            : /[。！？!?…]$/.test(line.text)
              ? pauses.period
              : pauses.paragraph;
      return ms / 1000;
    });
  }

  async function handleExport() {
    if (!project) return;
    if (!ready.length && scope === "chapter") {
      setMergeMsg("还没有生成任何句子");
      return;
    }

    setMerging(true);
    setMergeMsg("");
    try {
      let record: ExportRecord | null = null;

      if (scope === "chapter" && chapter) {
        const r = await exportAudio({
          lines: buildLines(chapter.lines),
          pauses: buildPauses(chapter.lines),
          loudness,
          formats: formats === "all" ? ["wav", "srt", "stems"] : formats === "wav-srt" ? ["wav", "srt"] : ["wav"],
          output_name: safeName(`${project.title}-${chapter.title}`),
        });
        record = {
          id: `export-${Date.now().toString(36)}`,
          title: `${project.title} · ${chapter.title}`,
          scope,
          files: r.files,
          file: r.file,
          duration: r.duration,
          createdAt: new Date().toISOString(),
        };
        setMergeMsg(`已导出 ${r.duration} 秒 · ${r.lines} 句 · 响度 ${loudness} dB`);
      } else if (scope === "book") {
        const all = project.chapters.flatMap((c) => c.lines);
        const exportable = all.filter((l) => l.audio && l.text.trim());
        if (!exportable.length) throw new Error("整本还没有可导出的音频");
        setMergeMsg("正在导出整本单轨…");
        const r = await exportAudio({
          lines: buildLines(all),
          pauses: buildPauses(all),
          loudness,
          formats: ["wav", "srt"],
          output_name: safeName(`${project.title}-整本`),
        });
        record = {
          id: `export-${Date.now().toString(36)}`,
          title: `${project.title} · 整本`,
          scope,
          files: r.files,
          file: r.file,
          duration: r.duration,
          createdAt: new Date().toISOString(),
        };
        setMergeMsg(`整本导出完成：${r.duration} 秒 · ${r.lines} 句`);
      } else {
        const targets = project.chapters.filter((c) =>
          c.lines.some((l) => l.audio && l.text.trim())
        );
        if (!targets.length) throw new Error("整本还没有可导出的音频");
        const names: string[] = [];
        let totalDuration = 0;
        for (let i = 0; i < targets.length; i++) {
          const c = targets[i];
          setMergeMsg(`正在导出第 ${i + 1}/${targets.length} 章 · ${c.title}`);
          const r = await exportAudio({
            lines: buildLines(c.lines),
            pauses: buildPauses(c.lines),
            loudness,
            formats: ["wav", "srt"],
            output_name: safeName(`${project.title}-${String(i + 1).padStart(2, "0")}-${c.title}`),
          });
          if (r.files.wav) names.push(r.files.wav);
          if (r.files.srt) names.push(r.files.srt);
          totalDuration += r.duration;
        }
        setMergeMsg("正在打包分章音频…");
        const zip = await zipAudio({
          files: names,
          output_name: safeName(`${project.title}-分章`),
        });
        record = {
          id: `export-${Date.now().toString(36)}`,
          title: `${project.title} · 分章（${targets.length} 章）`,
          scope,
          files: { zip: zip.url },
          file: zip.file,
          duration: Math.round(totalDuration * 100) / 100,
          createdAt: new Date().toISOString(),
        };
        setMergeMsg(`分章导出完成：${targets.length} 章 · ${zip.count} 个文件`);
      }

      if (record) {
        const next = [record, ...history].slice(0, 30);
        setHistory(next);
        setCurrentId(record.id);
        saveHistory(project.id, next);
      }
    } catch (e) {
      setMergeMsg((e as Error).message);
    } finally {
      setMerging(false);
    }
  }

  const current = history.find((r) => r.id === currentId) ?? history[0] ?? null;

  return (
    <section className="page active" id="page-master">
      <div className="master-head">
        <div>
          <h1 className="page-title">成片</h1>
          <p className="page-desc">
            {chapter ? (
              <>
                {chapter.title} · {lines.length} 句 · 已生成 {ready.length} 句
              </>
            ) : (
              "还没有章节"
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            className="select"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              setMergeMsg("");
            }}
          >
            <option value="chapter">当前章节</option>
            <option value="book">整本单轨</option>
            <option value="book-chapters">整本分章节 ZIP</option>
          </select>
          {scope === "chapter" && project && project.chapters.length > 0 && (
            <select
              className="select"
              value={chapter?.id ?? ""}
              onChange={(e) => {
                setChapterId(e.target.value);
                setMergeMsg("");
              }}
            >
              {project.chapters.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          )}
          <button className="btn small primary" onClick={handleExport} disabled={merging}>
            {merging ? "导出中…" : "开始导出"}
          </button>
        </div>
      </div>

      <div className="master-body">
        <div className="master-main">
          <div className="timeline">
            <div className="timeline-head">
              <span className="section-label">时间轴</span>
              <span className="script-meta" style={{ color: "var(--text-faint)" }}>
                按文本长度估算 · 导出后以实际音频为准
              </span>
            </div>
            <div className="ruler">
              <span>00:00</span><span>01:00</span><span>02:00</span><span>03:00</span>
              <span>04:00</span><span>05:00</span><span>06:12</span>
            </div>
            {tracks.map((t) => (
              <div className="track" key={t.name}>
                <div className="track-label">{t.name}</div>
                <div className="track-lane">
                  {t.clips.map((c) => (
                    <span key={c.id} className={`clip ${t.cls}`} style={{ width: `${c.width}%` }} title={`第 ${c.id} 句`} />
                  ))}
                </div>
              </div>
            ))}
            {!tracks.length && <div className="recent-row"><span>还没有台词</span></div>}
          </div>

          <div className="panel-box">
            <div className="panel-title">
              <span>质检</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--teal)" }}>
                {passed}/{checks.length} 项通过
              </span>
            </div>
            {checks.map((c) => (
              <div className="check-row" key={c.text}>
                <span className={`check ${c.ok ? "on" : ""}`}>{c.ok ? "✓" : " "}</span>
                {c.text}
              </div>
            ))}
          </div>

          <div className="panel-box">
            <div className="panel-title">
              <span>当前导出</span>
              {current && (
                <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-faint)" }}>
                  {current.duration ? `${current.duration} 秒` : ""}
                </span>
              )}
            </div>
            {current ? (
              <>
                <div className="export-title">{current.title}</div>
                {current.files.wav && <ExportPlayer src={audioUrl(current.files.wav)} />}
                <div className="export-links">
                  {current.files.wav && <a href={audioUrl(current.files.wav)} download>整轨 WAV</a>}
                  {current.files.srt && <a href={audioUrl(current.files.srt)} download>SRT 字幕</a>}
                  {current.files.stems && <a href={audioUrl(current.files.stems)} download>分轨 ZIP</a>}
                  {current.files.zip && <a href={audioUrl(current.files.zip)} download>分章 ZIP</a>}
                  {current.file && (
                    <button
                      className="btn ghost small"
                      onClick={() => revealFile(current.file!).catch((e) => setMergeMsg((e as Error).message))}
                    >
                      打开导出文件夹
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="recent-row"><span>还没有导出记录</span></div>
            )}
          </div>

          <div className="panel-box">
            <div className="panel-title">
              <span>项目导出历史</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-faint)" }}>
                {history.length} 条
              </span>
            </div>
            {history.map((item) => (
              <div className="export-history-row" key={item.id}>
                <div>
                  <b>{item.title}</b>
                  <span>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                </div>
                <div className="export-history-actions">
                  {item.files.wav && (
                    <button className="btn ghost small" onClick={() => setCurrentId(item.id)}>播放</button>
                  )}
                  {item.file && (
                    <button
                      className="btn ghost small"
                      onClick={() => revealFile(item.file!).catch((e) => setMergeMsg((e as Error).message))}
                    >
                      文件夹
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="master-side">
          <div className="panel-box">
            <div className="panel-title">
              <span>停顿</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-faint)" }}>毫秒</span>
            </div>
            {(
              [
                ["逗号", "comma"],
                ["句号", "period"],
                ["段落", "paragraph"],
                ["换角色", "role"],
              ] as const
            ).map(([label, key]) => (
              <div className="slider-row" key={key}>
                <span className="slider-label">{label}</span>
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={1200}
                  step={10}
                  value={pauses[key]}
                  onChange={(e) => setPauses((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                />
                <span className="slider-val">{pauses[key]}</span>
              </div>
            ))}
          </div>

          <div className="panel-box">
            <div className="panel-title"><span>导出设置</span></div>
            <div className="field">
              <div className="field-label"><span>当前章节内容</span></div>
              <select
                className="select"
                value={formats}
                onChange={(e) => setFormats(e.target.value as "all" | "wav" | "wav-srt")}
              >
                <option value="all">整轨 WAV + SRT + 分轨 ZIP</option>
                <option value="wav-srt">整轨 WAV + SRT</option>
                <option value="wav">只导出整轨 WAV</option>
              </select>
            </div>
            <div className="field">
              <div className="field-label"><span>响度</span></div>
              <select className="select" value={loudness} onChange={(e) => setLoudness(Number(e.target.value))}>
                <option value={-16}>−16 dB · 网络内容</option>
                <option value={-23}>−23 dB · 广播</option>
                <option value={-14}>−14 dB · 流媒体</option>
              </select>
            </div>
            <div className="check-row"><span className="check on">✓</span>整本单轨：全部章节拼成一条轨道</div>
            <div className="check-row"><span className="check on">✓</span>整本分章：一章一个 WAV，打包 ZIP</div>
            <button className="btn primary" style={{ width: "100%", marginTop: 12 }} onClick={handleExport} disabled={merging}>
              {merging ? "导出中…" : "导出成片"}
            </button>
            {mergeMsg && (
              <div className="test-result" style={{ marginTop: 8 }}>
                <span className={`dot ${current ? "ok" : "warn"}`} />
                {mergeMsg}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
