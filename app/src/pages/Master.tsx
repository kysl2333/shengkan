import { useMemo, useState } from "react";
import type { Project } from "../projects";
import { exportAudio, audioUrl } from "../api";

const TRACK_CLASS = ["", "teal", "red"];

export default function Master({ project }: { project: Project | null }) {
  const [chapterId, setChapterId] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeMsg, setMergeMsg] = useState("");
  const [exportResult, setExportResult] = useState<{
    files: { wav: string; srt?: string; stems?: string };
    duration: number;
  } | null>(null);
  const [formats, setFormats] = useState<"all" | "wav" | "wav-srt">("all");
  const [loudness, setLoudness] = useState(-16);
  const [pauses, setPauses] = useState({ comma: 150, period: 350, paragraph: 500, role: 300 });

  const chapter =
    project?.chapters.find((c) => c.id === chapterId) ?? project?.chapters[0] ?? null;
  const lines = chapter?.lines ?? [];
  const ready = lines.filter((l) => l.audio);
  const missing = lines.length - ready.length;
  const emptyLines = lines.filter((l) => !l.text.trim()).length;
  const unbound = (project?.casts ?? []).filter(
    (c) => c.name !== "未知" && c.name !== "旁白" && !c.cloudVoice && !c.voicePath
  );

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

  async function handleExport() {
    if (!ready.length) {
      setMergeMsg("还没有生成任何句子");
      return;
    }
    setMerging(true);
    setMergeMsg("");
    try {
      const exportLines = ready.map((l) => ({
        file: l.audio!.split("/").pop()!,
        speaker: l.speaker,
        text: l.text,
      }));
      const pauseList = ready.slice(0, -1).map((line, i) => {
        const next = ready[i + 1];
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
      const fileFormats =
        formats === "all" ? ["wav", "srt", "stems"] : formats === "wav-srt" ? ["wav", "srt"] : ["wav"];

      const r = await exportAudio({
        lines: exportLines,
        pauses: pauseList,
        loudness,
        formats: fileFormats,
        output_name: project ? `${project.id}-${chapter?.id ?? "ch"}` : undefined,
      });
      setExportResult({ files: r.files, duration: r.duration });
      setMergeMsg(`已导出 ${r.duration} 秒 · ${r.lines} 句 · 响度 ${loudness} dB`);
    } catch (e) {
      setMergeMsg((e as Error).message);
    } finally {
      setMerging(false);
    }
  }

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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {project && project.chapters.length > 0 && (
            <select
              className="select"
              value={chapter?.id ?? ""}
              onChange={(e) => {
                setChapterId(e.target.value);
                setExportResult(null);
                setMergeMsg("");
              }}
            >
              {project.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <button className="btn small primary" onClick={handleExport} disabled={merging || !ready.length}>
            {merging ? "合成中…" : "导出"}
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
                    <span
                      key={c.id}
                      className={`clip ${t.cls}`}
                      style={{ width: `${c.width}%` }}
                      title={`第 ${c.id} 句`}
                    />
                  ))}
                </div>
              </div>
            ))}
            {!tracks.length && (
              <div className="recent-row"><span>还没有台词，先到工作台导入或拆分</span></div>
            )}
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
              <span>导出结果</span>
              {exportResult && (
                <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-faint)" }}>
                  {exportResult.duration} 秒
                </span>
              )}
            </div>
            {exportResult ? (
              <>
                <audio
                  controls
                  src={audioUrl(exportResult.files.wav)}
                  style={{ width: "100%", marginBottom: 8 }}
                />
                <div className="export-links">
                  <a href={audioUrl(exportResult.files.wav)} download>整轨 WAV</a>
                  {exportResult.files.srt && (
                    <a href={audioUrl(exportResult.files.srt)} download>SRT 字幕</a>
                  )}
                  {exportResult.files.stems && (
                    <a href={audioUrl(exportResult.files.stems)} download>分轨 ZIP</a>
                  )}
                </div>
              </>
            ) : (
              <div className="recent-row"><span>还没有导出记录</span></div>
            )}
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
            <div className="panel-title"><span>导出</span></div>
            <div className="field">
              <div className="field-label"><span>内容</span></div>
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
              <select
                className="select"
                value={loudness}
                onChange={(e) => setLoudness(Number(e.target.value))}
              >
                <option value={-16}>−16 dB · 网络内容</option>
                <option value={-23}>−23 dB · 广播</option>
                <option value={-14}>−14 dB · 流媒体</option>
              </select>
            </div>
            <div className="check-row"><span className="check on">✓</span>按句拼接，按标点插入停顿</div>
            <div className="check-row"><span className="check on">✓</span>输出 24 kHz 单声道 WAV</div>
            <button className="btn primary" style={{ width: "100%", marginTop: 12 }} onClick={handleExport} disabled={merging || !ready.length}>
              {merging ? "合成中…" : "导出成片"}
            </button>
            {mergeMsg && (
              <div className="test-result" style={{ marginTop: 8 }}>
                <span className={`dot ${exportResult ? "ok" : "warn"}`} />
                {mergeMsg}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
