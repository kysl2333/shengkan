import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getVoices, ENGINE, deleteVoice, updateVoice, type VoiceItem } from "../api";
import {
  listCloudVoices,
  cloudTTS,
  designCloudPreview,
  saveCloudDesign,
  materializeCloudVoice,
  removeCloudVoice,
  updateCloudVoice,
  type CloudVoice,
  type CloudDesignPreview,
} from "../cloud";
import { isRealCharacter } from "../import";
import { log } from "../log";
import { askText } from "../prompt";
import { castVoiceLabel, type Project } from "../projects";

function VoiceWave() {
  const bars = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const h = 3 + Math.abs(Math.sin(i * 1.3) * Math.cos(i * 0.6)) * 16;
        return h;
      }),
    []
  );
  return (
    <div className="voice-wave">
      {bars.map((h, i) => <i key={i} style={{ height: `${h}px` }} />)}
    </div>
  );
}

function cloudGroup(voice: CloudVoice) {
  return voice.model.includes("voiceclone") ? "设计音色" : "小米预置";
}

export default function Cast({
  project,
  onSave,
}: {
  project: Project | null;
  onSave: (p: Project) => void;
}) {
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingPath, setPlayingPath] = useState("");
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; castId: string } | null>(null);
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [cloudVoices, setCloudVoices] = useState<CloudVoice[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudPreview, setCloudPreview] = useState("");
  const [designOpen, setDesignOpen] = useState(false);
  const [designPrompt, setDesignPrompt] = useState("");
  const [designDesc, setDesignDesc] = useState("");
  const [designText, setDesignText] = useState("你好，我是这个角色的声音。很高兴见到你。");
  const [designBusy, setDesignBusy] = useState(false);
  const [designPreview, setDesignPreview] = useState<CloudDesignPreview | null>(null);
  const [designPlaying, setDesignPlaying] = useState(false);
  const [designError, setDesignError] = useState("");
  const [notice, setNotice] = useState("");
  const designAudioRef = useRef<HTMLAudioElement | null>(null);
  const [bindMenu, setBindMenu] = useState<null | {
    x: number;
    y: number;
    kind: "local" | "cloud" | "localClone";
    voice: VoiceItem | CloudVoice;
  }>(null);

  useEffect(() => {
    getVoices()
      .then((r) => setVoices(r.voices))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (mode !== "cloud") return;
    setCloudLoading(true);
    listCloudVoices()
      .then(setCloudVoices)
      .catch((e) => setError((e as Error).message))
      .finally(() => setCloudLoading(false));
  }, [mode]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  useEffect(() => {
    if (!bindMenu) return;
    const close = () => setBindMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [bindMenu]);

  const allLines = project?.chapters.flatMap((c) => c.lines) ?? [];
  const countFor = (name: string) => allLines.filter((l) => l.speaker === name).length;
  const doneFor = (name: string) =>
    allLines.filter((l) => l.speaker === name && l.status === "done" && l.audio).length;

  const casts = [...(project?.casts ?? [])].sort((a, b) => {
    if (a.name === "旁白") return 1;
    if (b.name === "旁白") return -1;
    return countFor(b.name) - countFor(a.name);
  });
  const selected = casts.find((c) => c.id === selectedId) ?? casts[0] ?? null;
  const menuCast = menu ? casts.find((c) => c.id === menu.castId) : null;

  const keyword = q.trim().toLowerCase();
  const filtered = keyword
    ? voices.filter((v) =>
        `${v.name} ${v.displayName || ""} ${v.desc || ""} ${v.gender || ""} ${v.age || ""}`
          .toLowerCase()
          .includes(keyword)
      )
    : voices;
  const sortedLocal = [...filtered].sort((a, b) =>
    (a.category || "本地").localeCompare(b.category || "本地", "zh-CN")
  );
  const cloudFiltered = cloudVoices
    .filter((v) =>
      keyword
        ? `${v.name} ${v.desc} ${v.gender || ""} ${v.age || ""}`.toLowerCase().includes(keyword)
        : true
    )
    .sort((a, b) => cloudGroup(a).localeCompare(cloudGroup(b), "zh-CN"));

  function unbind(castId: string) {
    if (!project) return;
    onSave({
      ...project,
      casts: project.casts.map((c) =>
        c.id === castId
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
    log("cast", "解绑音色", { castId });
  }

  function openBindMenu(
    kind: "local" | "cloud" | "localClone",
    voice: VoiceItem | CloudVoice,
    event: React.MouseEvent<HTMLElement>
  ) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setBindMenu({
      x: Math.min(rect.left, window.innerWidth - 230),
      y: Math.min(rect.bottom + 4, window.innerHeight - 300),
      kind,
      voice,
    });
  }

  async function applyBind(castId: string) {
    if (!project || !bindMenu) return;
    const menu = bindMenu;
    setBindMenu(null);

    try {
      if (menu.kind === "local") {
        const voice = menu.voice as VoiceItem;
        onSave({
          ...project,
          casts: project.casts.map((c) =>
            c.id === castId
              ? {
                  ...c,
                  voicePath: voice.path,
                  voice: voice.displayName || voice.name,
                  cloudModel: undefined,
                  cloudVoice: undefined,
                  cloudName: undefined,
                }
              : c
          ),
        });
      } else if (menu.kind === "cloud") {
        const voice = menu.voice as CloudVoice;
        onSave({
          ...project,
          casts: project.casts.map((c) =>
            c.id === castId
              ? {
                  ...c,
                  voicePath: "",
                  voice: voice.name,
                  cloudModel: voice.model,
                  cloudVoice: voice.voice,
                  cloudName: voice.name,
                }
              : c
          ),
        });
      } else {
        const voice = menu.voice as CloudVoice;
        const local = await materializeCloudVoice(voice.id);
        if (!local.localPath) throw new Error("没有生成本地样本");
        onSave({
          ...project,
          casts: project.casts.map((c) =>
            c.id === castId
              ? {
                  ...c,
                  voicePath: local.localPath!,
                  voice: voice.name,
                  cloudModel: undefined,
                  cloudVoice: undefined,
                  cloudName: undefined,
                }
              : c
          ),
        });
        setVoices((await getVoices()).voices);
        setNotice(`已把「${voice.name}」保存为本地音色`);
        window.setTimeout(() => setNotice(""), 5000);
      }
      log("cast", "绑定音色到角色", {
        castId,
        kind: menu.kind,
        voice: (menu.voice as { name?: string }).name || "",
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function editLocal(voice: VoiceItem) {
    const name = await askText("音色名称", voice.displayName || voice.name);
    if (name === null) return;
    const desc = await askText("音色介绍", voice.desc || "");
    if (desc === null) return;
    await updateVoice(voice.path, { name: name.trim(), desc: desc.trim() });
    if (project) {
      const affected = project.casts.filter((c) => c.voicePath === voice.path);
      if (affected.length) {
        onSave({
          ...project,
          casts: project.casts.map((c) =>
            c.voicePath === voice.path ? { ...c, voice: name.trim() } : c
          ),
        });
      }
    }
    setVoices((await getVoices()).voices);
  }

  async function editCloud(voice: CloudVoice) {
    if (voice.model === "mimo-v2.5-tts") {
      window.alert("预置音色不能改名，先保存成设计音色");
      return;
    }
    const name = await askText("音色名称", voice.name);
    if (name === null) return;
    const desc = await askText("音色介绍", voice.desc || "");
    if (desc === null) return;
    await updateCloudVoice(voice.id, { name: name.trim(), desc: desc.trim() });
    if (project) {
      const affected = project.casts.filter(
        (c) => c.cloudVoice === voice.voice && c.cloudModel === voice.model
      );
      if (affected.length) {
        onSave({
          ...project,
          casts: project.casts.map((c) =>
            affected.some((a) => a.id === c.id)
              ? { ...c, cloudName: name.trim(), voice: name.trim() }
              : c
          ),
        });
      }
    }
    setCloudVoices(await listCloudVoices());
    setVoices((await getVoices()).voices);
  }

  async function previewCloud(voice: CloudVoice) {
    if (cloudPreview) return;
    audioRef.current?.pause();
    designAudioRef.current?.pause();
    setDesignPlaying(false);
    setPlayingPath("");
    setCloudPreview(voice.id);
    try {
      const r = await cloudTTS({
        text: "你好，这是音色试听。",
        model: voice.model,
        voice: voice.voice,
      });
      const audio = new Audio(`${ENGINE}${r.url}`);
      audioRef.current = audio;
      audio.onended = () => setCloudPreview("");
      audio.onerror = () => setCloudPreview("");
      await audio.play();
    } catch (e) {
      setError((e as Error).message);
      setCloudPreview("");
    }
  }

  function openDesign() {
    setDesignPrompt("");
    setDesignDesc("");
    setDesignText("你好，我是这个角色的声音。很高兴见到你。");
    setDesignPreview(null);
    setDesignError("");
    setDesignOpen(true);
  }

  function closeDesign() {
    designAudioRef.current?.pause();
    setDesignPlaying(false);
    setDesignOpen(false);
    setDesignPreview(null);
  }

  function playPreview(url?: string) {
    const src = url || designPreview?.previewUrl;
    if (!src) return;
    designAudioRef.current?.pause();
    audioRef.current?.pause();
    setPlayingPath("");
    setPaused(false);
    const audio = new Audio(`${ENGINE}${src}`);
    designAudioRef.current = audio;
    audio.onended = () => setDesignPlaying(false);
    audio.onerror = () => setDesignPlaying(false);
    setDesignPlaying(true);
    audio.play().catch(() => setDesignPlaying(false));
  }

  async function runDesignPreview(useManual = false) {
    if (designBusy) return;
    setDesignBusy(true);
    setDesignError("");
    try {
      const payload =
        !useManual && designPrompt.trim()
          ? { prompt: designPrompt.trim() }
          : { description: designDesc, previewText: designText };
      const preview = await designCloudPreview(payload);
      setDesignPreview(preview);
      setDesignDesc(preview.description);
      setDesignText(preview.previewText);
      playPreview(preview.previewUrl);
      log("cloud", "生成音色试听", { tempId: preview.tempId, name: preview.name });
    } catch (e) {
      setDesignError((e as Error).message);
    } finally {
      setDesignBusy(false);
    }
  }

  async function saveDesignPreview() {
    if (!designPreview) {
      setDesignError("先生成一段试听，再保存");
      return;
    }
    setDesignBusy(true);
    setDesignError("");
    try {
      const saved = await saveCloudDesign({
        tempId: designPreview.tempId,
        name: designPreview.name,
        description: designPreview.description,
        gender: designPreview.gender,
        age: designPreview.age,
      });
      setCloudVoices(await listCloudVoices());
      setVoices((await getVoices()).voices);
      closeDesign();
      setNotice(`已保存「${saved.name}」到云音色；需要本地参考音频再点「本地克隆」`);
      window.setTimeout(() => setNotice(""), 5000);
      log("cloud", "保存设计音色", { id: saved.id, name: saved.name });
    } catch (e) {
      setDesignError((e as Error).message);
    } finally {
      setDesignBusy(false);
    }
  }

  async function removeCloud(voice: CloudVoice) {
    if (voice.model === "mimo-v2.5-tts") {
      window.alert("预置音色是内置的，不能删除。需要本地参考音频请点「本地克隆」。");
      return;
    }
    if (!window.confirm(`删除云音色「${voice.name}」？\n\n音频会移到 voices/.trash，不会永久删除；已经克隆到本地的副本不受影响。`)) return;
    try {
      await removeCloudVoice(voice.id);
      if (project) {
        const bound = project.casts.some(
          (c) => c.cloudVoice === voice.voice && c.cloudModel === voice.model
        );
        if (bound) {
          onSave({
            ...project,
            casts: project.casts.map((c) =>
              c.cloudVoice === voice.voice && c.cloudModel === voice.model
                ? {
                    ...c,
                    cloudModel: undefined,
                    cloudVoice: undefined,
                    cloudName: undefined,
                    voice: c.voicePath ? c.voice : "",
                  }
                : c
            ),
          });
        }
      }
      setCloudVoices(await listCloudVoices());
      setVoices((await getVoices()).voices);
      log("cloud", "删除云音色", { id: voice.id, name: voice.name });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeLocal(voice: VoiceItem) {
    if (!window.confirm(`删除本地音色「${voice.displayName || voice.name}」？\n\n文件会移到 voices/.trash，不会永久删除。`)) return;
    try {
      await deleteVoice(voice.path);
      if (project) {
        const bound = project.casts.some((c) => c.voicePath === voice.path);
        if (bound) {
          onSave({
            ...project,
            casts: project.casts.map((c) =>
              c.voicePath === voice.path
                ? { ...c, voicePath: "", voice: c.cloudVoice ? c.voice : "" }
                : c
            ),
          });
        }
      }
      setVoices((await getVoices()).voices);
      log("cast", "删除本地音色", { path: voice.path });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleVoice(v: VoiceItem) {
    designAudioRef.current?.pause();
    setDesignPlaying(false);
    setCloudPreview("");
    const url = `${ENGINE}/v1/voice-audio?path=${encodeURIComponent(v.path)}`;
    if (playingPath === v.path && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
        setPaused(false);
      } else {
        audioRef.current.pause();
        setPaused(true);
      }
      return;
    }

    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      setPlayingPath("");
      setPaused(false);
    };
    audio.onplay = () => setPaused(false);
    audio.onpause = () => setPaused(true);
    setPlayingPath(v.path);
    setPaused(false);
    audio.play().catch(() => {
      setPlayingPath("");
      setPaused(false);
    });
  }

  async function renameCast(oldName: string) {
    if (!project) return;
    const value = await askText("角色名", oldName);
    if (!value?.trim() || value.trim() === oldName) return;
    const name = value.trim();
    const merged = project.casts.some((c) => c.name === name);

    const casts = merged
      ? project.casts.filter((c) => c.name !== oldName)
      : project.casts.map((c) =>
          c.name === oldName ? { ...c, name, initial: name.slice(0, 1) } : c
        );

    const chapters = project.chapters.map((c) => ({
      ...c,
      lines: c.lines.map((l) =>
        l.speaker === oldName ? { ...l, speaker: name, status: "dirty" as const } : l
      ),
    }));

    onSave({ ...project, casts, chapters });
    log("cast", "重命名角色", { from: oldName, to: name, merged });
  }

  function removeCast(name: string) {
    if (!project || name === "旁白") return;
    if (!window.confirm(`删除角色「${name}」？\n\n它的台词会改成「未知」，不会删台词。`)) return;

    const casts = project.casts.filter((c) => c.name !== name);
    const chapters = project.chapters.map((c) => ({
      ...c,
      lines: c.lines.map((l) =>
        l.speaker === name ? { ...l, speaker: "未知", status: "dirty" as const } : l
      ),
    }));

    onSave({ ...project, casts, chapters });
    log("cast", "删除角色", { name });
  }

  async function addCast() {
    if (!project) return;
    const value = await askText("新角色名");
    const name = value?.trim();
    if (!name) return;
    if (project.casts.some((c) => c.name === name)) {
      window.alert("已经有这个角色了");
      return;
    }
    const cast = {
      id: `cast-${Date.now().toString(36)}`,
      name,
      initial: name.slice(0, 1),
      desc: "待匹配音色",
      voice: "",
      voicePath: "",
      color: "#7d8fa8",
    };
    onSave({ ...project, casts: [...project.casts, cast] });
    setSelectedId(cast.id);
    log("cast", "新建角色", { name });
  }

  function cleanCasts() {
    if (!project) return;
    const bad = project.casts.filter((c) => c.name !== "旁白" && !isRealCharacter(c.name));
    if (!bad.length) {
      window.alert("没有发现明显无效的角色");
      return;
    }
    if (!window.confirm(`会删除 ${bad.length} 个无效角色，它们的台词改成「未知」。继续？`)) return;

    const names = new Set(bad.map((c) => c.name));
    const casts = project.casts.filter((c) => !names.has(c.name));
    const chapters = project.chapters.map((c) => ({
      ...c,
      lines: c.lines.map((l) =>
        names.has(l.speaker) ? { ...l, speaker: "未知", status: "dirty" as const } : l
      ),
    }));

    onSave({ ...project, casts, chapters });
    log("cast", "清理无效角色", { removed: [...names] });
  }

  return (
    <section className="page active" id="page-cast">
      <aside className="cast-left">
        <div className="cast-left-head">
          <h1 className="page-title">角色</h1>
          <p className="page-desc">角色来自当前项目，跨章节共享。换音色只影响之后的生成。</p>
        </div>

        {project && (
          <div className="role-actions">
            <button className="btn small" onClick={addCast}>＋ 新建角色</button>
            {selected && (
              <>
                <button className="btn small" onClick={() => renameCast(selected.name)}>重命名</button>
                <button
                  className="btn small"
                  onClick={() => unbind(selected.id)}
                  disabled={!selected.voicePath && !selected.cloudVoice}
                >
                  解绑音色
                </button>
                <button
                  className="btn small danger"
                  onClick={() => removeCast(selected.name)}
                  disabled={selected.name === "旁白"}
                >
                  从项目删除
                </button>
                <button className="btn small" onClick={cleanCasts}>清理无效角色</button>
              </>
            )}
          </div>
        )}

        {casts.length ? (
          <div className="role-list">
            {casts.map((c) => (
              <button
                key={c.id}
                className={`role-item ${selected?.id === c.id ? "active" : ""}`}
                onClick={() => setSelectedId(c.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({
                    x: Math.min(e.clientX, window.innerWidth - 190),
                    y: Math.min(e.clientY, window.innerHeight - 130),
                    castId: c.id,
                  });
                }}
              >
                <div className="role-top">
                  <div className="avatar" style={{ borderColor: c.color }}>{c.initial}</div>
                  <div>
                    <div className="role-name">{c.name}</div>
                    <div className="role-trait">{castVoiceLabel(c)}</div>
                  </div>
                  {selected?.id === c.id && <span className="role-current">当前</span>}
                </div>
                <div className="role-voice">
                  <span>{countFor(c.name)} 句</span>
                  <span className="mono">{doneFor(c.name)} 句已生成</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="cast-empty">
            <p>还没有角色。</p>
            <p>导入剧本并拆分台词后，角色会自动出现在这里。</p>
          </div>
        )}
      </aside>

      <div className="cast-right">
        <div className="voice-toolbar">
          <div className="seg" style={{ flex: "0 0 210px" }}>
            <button className={mode === "local" ? "on" : ""} onClick={() => setMode("local")}>
              本地音色
            </button>
            <button className={mode === "cloud" ? "on" : ""} onClick={() => setMode("cloud")}>
              云音色
            </button>
          </div>
          <input
            className="search"
            placeholder="搜音色、性别、年龄…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="voice-hint">
            {selected ? `正在给「${selected.name}」选音色` : "先在左侧选一个角色"}
          </span>
          {mode === "cloud" && (
            <button className="btn small" onClick={openDesign}>设计音色</button>
          )}
        </div>

        {notice && (
          <div className="test-result" style={{ padding: "0 16px 8px" }}>
            <span className="dot ok" />{notice}
          </div>
        )}

        {error && <div className="import-error">音色库读取失败：{error}</div>}

        <div className="voice-grid">
          {mode === "local"
            ? sortedLocal.map((v, index) => {
                const bound = selected?.voicePath === v.path && !selected?.cloudVoice;
                return (
                  <Fragment key={v.path}>
                    {(index === 0 ||
                      (sortedLocal[index - 1].category || "本地") !== (v.category || "本地")) && (
                      <div className="voice-group-label">{v.category || "本地"}</div>
                    )}
                    <div className={`voice-card ${bound ? "inuse" : ""}`}>
                    <div className="voice-card-top">
                      <div>
                        <div className="voice-name">{v.displayName || v.name}</div>
                        <div className="voice-tagline">{v.desc || "本地音色"}</div>
                      </div>
                    </div>
                    <div className="voice-tags">
                      {v.gender && <span>{v.gender}</span>}
                      {v.age && <span>{v.age}</span>}
                      <span>{v.category}</span>
                    </div>
                    <VoiceWave />
                    <div className="voice-foot">
                      <button
                        className={`voice-play ${playingPath === v.path ? "playing" : ""}`}
                        onClick={() => toggleVoice(v)}
                      >
                        {playingPath === v.path && !paused ? "❚❚" : "▶"}
                      </button>
                      <button
                        className={`voice-use ${bound ? "on" : ""}`}
                        onClick={(e) => openBindMenu("local", v, e)}
                        disabled={!project}
                      >
                        {bound ? "已绑定" : "用这个"}
                      </button>
                      <button className="voice-edit" onClick={() => editLocal(v)}>编辑</button>
                      <button className="voice-del" onClick={() => removeLocal(v)}>删除</button>
                    </div>
                    </div>
                  </Fragment>
                );
              })
            : cloudLoading
              ? <div className="cast-empty"><p>正在加载云音色…</p></div>
              : cloudFiltered.map((v, index) => {
                    const bound =
                      selected?.cloudModel === v.model && selected?.cloudVoice === v.voice;
                    const localBound = !!selected?.voicePath && selected.voicePath === v.localPath;
                    return (
                      <Fragment key={v.id}>
                        {(index === 0 ||
                          cloudGroup(cloudFiltered[index - 1]) !== cloudGroup(v)) && (
                          <div className="voice-group-label">{cloudGroup(v)}</div>
                        )}
                        <div className={`voice-card ${bound || localBound ? "inuse" : ""}`}>
                        <div className="voice-card-top">
                          <div>
                            <div className="voice-name">{v.name}</div>
                            <div className="voice-tagline">{v.desc}</div>
                          </div>
                        </div>
                        <div className="voice-tags">
                          {v.gender && <span>{v.gender}</span>}
                          {v.age && <span>{v.age}</span>}
                          <span>小米</span>
                          <span>{v.model.includes("voiceclone") ? "设计" : "预置"}</span>
                        </div>
                        <VoiceWave />
                        <div className="voice-foot">
                          <button
                            className={`voice-play ${cloudPreview === v.id ? "playing" : ""}`}
                            onClick={() => previewCloud(v)}
                            disabled={!!cloudPreview}
                          >
                            {cloudPreview === v.id ? "…" : "▶"}
                          </button>
                          <button
                            className={`voice-use ${bound ? "on" : ""}`}
                            onClick={(e) => openBindMenu("cloud", v, e)}
                            disabled={!project}
                          >
                            {bound ? "云配音中" : "云配音"}
                          </button>
                          <button
                            className={`voice-use ${localBound ? "on" : ""}`}
                            onClick={(e) => openBindMenu("localClone", v, e)}
                            disabled={!project || !!cloudPreview}
                          >
                            {localBound ? "本地中" : "本地克隆"}
                          </button>
                          {v.model !== "mimo-v2.5-tts" && (
                            <>
                              <button className="voice-edit" onClick={() => editCloud(v)}>编辑</button>
                              <button className="voice-del" onClick={() => removeCloud(v)}>删除</button>
                            </>
                          )}
                        </div>
                      </div>
                      </Fragment>
                    );
                  })}
        </div>

        {!loading && mode === "local" && !filtered.length && (
          <div className="cast-empty">
            <p>没有匹配的本地音色。</p>
            <p>检查 `voices` 目录，或切到「云音色」用小米预置音色。</p>
          </div>
        )}
      </div>

      {designOpen && (
        <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget && !designBusy) closeDesign(); }}>
          <div className="modal design-modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">设计云音色</div>
                <div className="modal-desc">先试听，满意再保存。取消不会写入音色库。</div>
              </div>
              <button className="modal-close" onClick={() => !designBusy && closeDesign()}>✕</button>
            </div>

            <div className="modal-body">
              <div className="field">
                <div className="field-label">
                  <span>1. 描述你想要的声音</span>
                  <span>可以只写一句</span>
                </div>
                <textarea
                  className="input textarea design-textarea"
                  value={designPrompt}
                  onChange={(e) => setDesignPrompt(e.target.value)}
                  placeholder="例：17 岁女高中生，性格冷静，声音偏低，说话不紧不慢，带一点疏离感。"
                />
              </div>

              <div className="design-actions">
                <button
                  className="btn primary"
                  onClick={() => runDesignPreview(false)}
                  disabled={designBusy || (!designPrompt.trim() && !designDesc.trim())}
                >
                  {designBusy ? "生成中…" : "AI 生成试听"}
                </button>
                <span className="design-hint">AI 会先扩写音色描述，再生成一段试听</span>
              </div>

              {designPreview && (
                <div className="design-preview">
                  <div className="design-preview-head">
                    <b>{designPreview.name}</b>
                    <div className="voice-tags">
                      {designPreview.gender && <span>{designPreview.gender}</span>}
                      {designPreview.age && <span>{designPreview.age}</span>}
                      <span>小米</span>
                      <span>设计</span>
                    </div>
                  </div>
                  <p>{designPreview.description}</p>
                  <div className="design-preview-actions">
                    <button className="btn small" onClick={() => playPreview()}>
                      {designPlaying ? "重新播放" : "试听"}
                    </button>
                    <button
                      className="btn small primary"
                      onClick={saveDesignPreview}
                      disabled={designBusy}
                    >
                      保存这个音色
                    </button>
                  </div>
                </div>
              )}

              <details className="design-manual">
                <summary>手动微调描述和试听文本</summary>
                <div className="field">
                  <div className="field-label"><span>音色描述</span></div>
                  <textarea
                    className="input textarea design-textarea"
                    value={designDesc}
                    onChange={(e) => setDesignDesc(e.target.value)}
                    placeholder="例：20 岁活泼少女，声音清亮，语速稍快，带一点南方口音。"
                  />
                </div>
                <div className="field">
                  <div className="field-label"><span>试听文本</span></div>
                  <textarea
                    className="input textarea design-textarea"
                    value={designText}
                    onChange={(e) => setDesignText(e.target.value)}
                  />
                </div>
                <button
                  className="btn small"
                  onClick={() => runDesignPreview(true)}
                  disabled={designBusy || !designDesc.trim()}
                >
                  用手动描述生成试听
                </button>
              </details>

              {designError && <div className="import-error">{designError}</div>}
              {designBusy && <div className="import-busy"><span className="spinner" />正在生成试听…</div>}
            </div>

            <div className="modal-foot">
              <button className="btn" onClick={closeDesign} disabled={designBusy}>取消</button>
              <button
                className="btn primary"
                onClick={saveDesignPreview}
                disabled={designBusy || !designPreview}
              >
                保存这个音色
              </button>
            </div>
          </div>
        </div>
      )}

      {menu && menuCast && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button onClick={() => { renameCast(menuCast.name); setMenu(null); }}>重命名</button>
          <button
            className="danger"
            disabled={menuCast.name === "旁白"}
            onClick={() => { removeCast(menuCast.name); setMenu(null); }}
          >
            删除角色
          </button>
        </div>
      )}

      {bindMenu && (
        <div
          className="context-menu bind-menu"
          style={{ left: bindMenu.x, top: bindMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="context-menu-title">绑定到角色</div>
          {casts.map((c) => (
            <button key={c.id} onClick={() => applyBind(c.id)}>
              <span>{c.name}</span>
              {c.voice && <span className="bind-current">{c.voice}</span>}
            </button>
          ))}
          <button
            className="new"
            onClick={() => {
              addCast();
              setBindMenu(null);
            }}
          >
            ＋ 新建角色
          </button>
        </div>
      )}
    </section>
  );
}
