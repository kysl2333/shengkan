import { useEffect, useState } from "react";
import { getHealth } from "../api";
import { getEngineConfig, setEngineConfig, type EngineConfig } from "../config";
import { getAiConfig, setAiConfig, testAi, getDefaultPrompts, listModels, getAiConfigPath, type AiConfig, type ModelListResult } from "../ai";
import { revealFile } from "../projects";
import { clearLog, log, logInfo, openLog, type LogInfo } from "../log";

const nav = ["AI 服务", "语音引擎", "开发与 MCP"];

const AI_PROVIDERS = [
  {
    id: "mimo",
    name: "小米 MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-flash",
    note: "文本模型 · TTS 在 TTS AI",
  },
  {
    id: "qwen",
    name: "千问百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    note: "文本模型",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    note: "文本模型",
  },
  {
    id: "custom",
    name: "自定义",
    baseUrl: "",
    model: "",
    note: "自定义文本模型",
  },
] as const;

function Row({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-key">{label}</div>
        <div className="setting-help">{help}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function maskedAiConfig(cfg: AiConfig | null) {
  if (!cfg) return "";
  const copy = JSON.parse(JSON.stringify(cfg)) as AiConfig;
  const mask = (target?: { apiKey?: string }) => {
    if (target && target.apiKey) target.apiKey = "***";
  };
  mask(copy);
  mask(copy.mimoTts);
  mask(copy.qwenTts);
  mask(copy.customTts);
  return JSON.stringify(copy, null, 2);
}

function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function ModelPicker({
  value,
  onChange,
  baseUrl,
  apiKey,
  provider,
  kind,
  placeholder,
  help,
}: {
  value: string;
  onChange: (value: string) => void;
  baseUrl: string;
  apiKey: string;
  provider?: string;
  kind: "text" | "tts";
  placeholder: string;
  help: string;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function fetchModels() {
    setLoading(true);
    setError("");
    setNote("");
    try {
      const r: ModelListResult = await listModels({ baseUrl, apiKey, provider, kind });
      setModels(r.models);
      setNote(
        r.filtered
          ? `已按 ${kind === "tts" ? "TTS" : "文本"}模型过滤，共 ${r.total} 个模型`
          : `接口没有明确的 ${kind === "tts" ? "TTS" : "文本"}标记，已显示全部 ${r.total} 个模型`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="model-picker">
      <div className="input-row">
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          className="btn small"
          onClick={fetchModels}
          disabled={loading || !baseUrl.trim()}
        >
          {loading ? "获取中…" : "获取模型"}
        </button>
      </div>
      {error && <div className="import-error">{error}</div>}
      {note && !error && <div className="setting-help">{note}</div>}
      {models.length > 0 && (
        <div className="model-options">
          {models.map((model) => (
            <button
              key={model}
              type="button"
              className={model === value ? "on" : ""}
              onClick={() => onChange(model)}
            >
              {model}
            </button>
          ))}
        </div>
      )}
      {!models.length && !note && !error && <div className="setting-help">{help}</div>}
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState("AI 服务");
  const [aiSection, setAiSection] = useState<"text" | "tts">("text");
  const [engine, setEngine] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState<EngineConfig | null>(null);
  const [cfgSaved, setCfgSaved] = useState("");
  const [aiCfg, setAiCfg] = useState<AiConfig | null>(null);
  const [aiPath, setAiPath] = useState("");
  const [aiSaved, setAiSaved] = useState("");
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTest, setAiTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [logPath, setLogPath] = useState("");
  const [logMeta, setLogMeta] = useState<LogInfo | null>(null);
  const [logNotice, setLogNotice] = useState("");
  const [promptDefaults, setPromptDefaults] = useState({ chapter: "", annotate: "" });

  useEffect(() => {
    getEngineConfig().then(setCfg).catch(() => {});
    getAiConfig().then(setAiCfg).catch(() => {});
    getAiConfigPath().then(setAiPath).catch(() => {});
    getDefaultPrompts().then(setPromptDefaults).catch(() => {});
    logInfo().then((info) => {
      if (!info) return;
      setLogMeta(info);
      setLogPath(info.file);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== "开发与 MCP") return;
    logInfo().then((info) => {
      if (!info) return;
      setLogMeta(info);
      setLogPath(info.file);
    }).catch(() => {});
  }, [tab]);

  async function saveCfg() {
    if (!cfg) return;
    await setEngineConfig(cfg);
    setCfgSaved("已保存，重启软件生效");
    window.setTimeout(() => setCfgSaved(""), 3000);
  }

  async function testEngine() {
    setTesting(true);
    try {
      const h = await getHealth();
      const gpu = h.gpu ? ` · ${h.gpu.name} ${h.gpu.free_gb}/${h.gpu.total_gb} GB` : "";
      setEngine({
        ok: h.ok,
        text: `${h.engine} · ${h.model_loaded ? "模型已加载" : "模型未加载"}${gpu}`,
      });
    } catch (e) {
      setEngine({ ok: false, text: `连接失败 · ${(e as Error).message}` });
    } finally {
      setTesting(false);
    }
  }

  async function saveAiCfg() {
    if (!aiCfg) return;
    await setAiConfig(aiCfg);
    setAiSaved("已保存");
    window.setTimeout(() => setAiSaved(""), 3000);
  }

  async function testAiCfg() {
    if (!aiCfg) return;
    setAiTesting(true);
    setAiTest(null);
    try {
      await setAiConfig(aiCfg);
      const r = await testAi();
      setAiTest({ ok: r.ok, text: `连接正常 · ${r.ms}ms · ${r.model}` });
    } catch (e) {
      setAiTest({ ok: false, text: (e as Error).message });
    } finally {
      setAiTesting(false);
    }
  }

  const title = tab === "语音引擎" ? "语音引擎" : tab === "开发与 MCP" ? "开发与 MCP" : "AI 服务";
  const desc =
    tab === "语音引擎"
      ? "本地 TTS 优先直接连地址或 API；Python 和模型路径只在完全自动化时再填。"
      : tab === "开发与 MCP"
        ? "开发日志记录导入、AI、编辑和生成过程；MCP 让外部 AI 通过 stdio 读写项目。"
        : "文本 AI 负责分章、角色和情绪；TTS AI 负责声音。两者可以用不同的服务商和 Key。";

  return (
    <section className="page active" id="page-settings">
      <nav className="settings-nav">
        {nav.map((n) => (
          <button key={n} className={tab === n ? "active" : ""} onClick={() => setTab(n)}>{n}</button>
        ))}
      </nav>

      <div className="settings-main">
        <div className="settings-inner">
          <h1 className="settings-title">{title}</h1>
          <p className="settings-desc">{desc}</p>

          {tab === "AI 服务" && (
            <div className="seg ai-section-switch">
              <button className={aiSection === "text" ? "on" : ""} onClick={() => setAiSection("text")}>
                文本 AI
              </button>
              <button className={aiSection === "tts" ? "on" : ""} onClick={() => setAiSection("tts")}>
                TTS AI
              </button>
            </div>
          )}

          {tab === "AI 服务" && (
            <>

          {aiSection === "text" && (
          <div className="setting-group">
            <Row
              label="文本 AI 服务商"
              help="只用于分章、角色分析、情绪和语速。TTS 在「TTS AI」里单独配置，两者可以用不同服务商。"
            >
              <div className="mode-cards">
                {AI_PROVIDERS.map((provider) => (
                  <div
                    key={provider.id}
                    className={`mode-card ${aiCfg?.provider === provider.id ? "on" : ""}`}
                    onClick={() =>
                      aiCfg &&
                      setAiCfg({
                        ...aiCfg,
                        provider: provider.id,
                        baseUrl: provider.baseUrl || aiCfg.baseUrl,
                        model: provider.model || aiCfg.model,
                      })
                    }
                  >
                    <b>{provider.name}</b>
                    <span>{provider.note}</span>
                  </div>
                ))}
              </div>
            </Row>
            <Row label="服务地址" help="兼容 OpenAI 的 Base URL，末尾带 /v1。">
              <div className="input-row">
                <input
                  className="input"
                  value={aiCfg?.baseUrl ?? ""}
                  onChange={(e) => aiCfg && setAiCfg({ ...aiCfg, baseUrl: e.target.value })}
                />
                <button className="btn small" onClick={testAiCfg} disabled={aiTesting || !aiCfg}>
                  {aiTesting ? "测试中" : "测试"}
                </button>
              </div>
              {aiTest && (
                <div className="test-result">
                  <span className={`dot ${aiTest.ok ? "ok" : "warn"}`} />
                  {aiTest.text}
                </div>
              )}
            </Row>
            <Row label="API Key" help="只存在本机，不会写进项目或安装包。">
              <input
                className="input"
                type="password"
                placeholder="sk-..."
                value={aiCfg?.apiKey ?? ""}
                onChange={(e) => aiCfg && setAiCfg({ ...aiCfg, apiKey: e.target.value })}
              />
            </Row>
            <Row label="文本模型" help="只显示文本模型；接口不区分时会显示全部。点「获取模型」从云端读取，不会消耗生成次数。">
              <ModelPicker
                value={aiCfg?.model ?? ""}
                onChange={(model) => aiCfg && setAiCfg({ ...aiCfg, model })}
                baseUrl={aiCfg?.baseUrl ?? ""}
                apiKey={aiCfg?.apiKey ?? ""}
                provider={aiCfg?.provider}
                kind="text"
                placeholder="mimo-v2.6-flash / qwen-plus / deepseek-chat"
                help="例如 mimo-v2.6-flash、qwen-plus、deepseek-chat，或自定义模型名。"
              />
            </Row>
            {aiCfg?.provider === "custom" && (
              <Row
                label="思考强度"
                help="只对自定义文本 AI 生效。勾选后发送 reasoning_effort；不勾选不传，使用模型默认设置。TTS 不参与思考。"
              >
                <div
                  className="check-row"
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    aiCfg &&
                    setAiCfg({
                      ...aiCfg,
                      customThinking: {
                        ...aiCfg.customThinking,
                        enabled: !aiCfg.customThinking?.enabled,
                      },
                    })
                  }
                >
                  <span className={`check ${aiCfg.customThinking?.enabled ? "on" : ""}`}>
                    {aiCfg.customThinking?.enabled ? "✓" : " "}
                  </span>
                  发送思考强度（不勾选用模型默认）
                </div>
                {aiCfg.customThinking?.enabled && (
                  <div className="seg" style={{ marginTop: 8, flex: "0 0 210px" }}>
                    {(["low", "medium", "high"] as const).map((level) => (
                      <button
                        key={level}
                        className={aiCfg.customThinking?.effort === level ? "on" : ""}
                        onClick={() =>
                          aiCfg &&
                          setAiCfg({
                            ...aiCfg,
                            customThinking: { ...aiCfg.customThinking, effort: level },
                          })
                        }
                      >
                        {level === "low" ? "低" : level === "medium" ? "中" : "高"}
                      </button>
                    ))}
                  </div>
                )}
              </Row>
            )}
          </div>
          )}

          {aiSection === "tts" && (
          <div className="setting-group">
            <Row
              label="云 TTS 服务"
              help="可以同时启用多个；关闭后对应云音色、试听和云生成都会停用。"
            >
              <div className="mode-cards">
                <div
                  className={`mode-card ${aiCfg?.cloudProviders?.mimo !== false ? "on" : ""}`}
                  onClick={() =>
                    aiCfg &&
                    setAiCfg({
                      ...aiCfg,
                      cloudProviders: {
                        ...aiCfg.cloudProviders,
                        mimo: aiCfg.cloudProviders?.mimo === false,
                      },
                    })
                  }
                >
                  <b>小米 MiMo</b>
                  <span>
                    {aiCfg?.cloudProviders?.mimo !== false ? "已启用" : "已关闭"} · 预置音色、设计音色和克隆
                  </span>
                </div>
                <div
                  className={`mode-card ${aiCfg?.qwenTts?.enabled ? "on" : ""}`}
                  onClick={() =>
                    aiCfg &&
                    setAiCfg({
                      ...aiCfg,
                      qwenTts: { ...aiCfg.qwenTts, enabled: !aiCfg.qwenTts?.enabled },
                    })
                  }
                >
                  <b>千问 TTS</b>
                  <span>
                    {aiCfg?.qwenTts?.enabled ? "已启用" : "已关闭"} · DashScope 原生 TTS
                  </span>
                </div>
                <div
                  className={`mode-card ${aiCfg?.customTts?.enabled ? "on" : ""}`}
                  onClick={() =>
                    aiCfg &&
                    setAiCfg({
                      ...aiCfg,
                      customTts: { ...aiCfg.customTts, enabled: !aiCfg.customTts?.enabled },
                    })
                  }
                >
                  <b>自定义 TTS</b>
                  <span>
                    {aiCfg?.customTts?.enabled ? "已启用" : "已关闭"} · OpenAI 兼容 /audio/speech
                  </span>
                </div>
              </div>
            </Row>

            {aiCfg?.cloudProviders?.mimo !== false && (
              <div className="tts-provider-panel">
              <div className="section-label">小米 MiMo</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
                <Row label="MiMo TTS Key" help="AI 服务商不是小米时，这里单独填 MiMo TTS 的 Key；留空则沿用上面的 AI Key。">
                  <input
                    className="input"
                    type="password"
                    value={aiCfg?.mimoTts?.apiKey ?? ""}
                    onChange={(e) =>
                      aiCfg &&
                      setAiCfg({
                        ...aiCfg,
                        mimoTts: { ...aiCfg.mimoTts, apiKey: e.target.value },
                      })
                    }
                  />
                </Row>
                <Row label="MiMo TTS 地址" help="默认 https://api.xiaomimimo.com/v1。">
                  <input
                    className="input"
                    value={aiCfg?.mimoTts?.baseUrl ?? ""}
                    onChange={(e) =>
                      aiCfg &&
                      setAiCfg({
                        ...aiCfg,
                        mimoTts: { ...aiCfg.mimoTts, baseUrl: e.target.value },
                      })
                    }
                  />
                </Row>
                <div className="tool-help">
                  预置音色使用 mimo-v2.5-tts；克隆和设计模型由音色卡决定，模型名随音色卡保存。
                </div>
              </div>
              </div>
            )}

            {aiCfg?.qwenTts?.enabled && (
              <div className="tts-provider-panel">
              <div className="section-label">千问 TTS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
                  <Row label="DashScope API Key" help="百炼控制台的 API Key。">
                    <input
                      className="input"
                      type="password"
                      value={aiCfg.qwenTts?.apiKey ?? ""}
                      onChange={(e) =>
                        aiCfg &&
                        setAiCfg({
                          ...aiCfg,
                          qwenTts: { ...aiCfg.qwenTts, apiKey: e.target.value },
                        })
                      }
                    />
                  </Row>
                  <Row label="DashScope 地址" help="默认 https://dashscope.aliyuncs.com。">
                    <input
                      className="input"
                      value={aiCfg.qwenTts?.baseUrl ?? ""}
                      onChange={(e) =>
                        aiCfg &&
                        setAiCfg({
                          ...aiCfg,
                          qwenTts: { ...aiCfg.qwenTts, baseUrl: e.target.value },
                        })
                      }
                    />
                  </Row>
                  <Row label="千问 TTS 模型" help="只显示 TTS 模型；接口不区分时会显示全部。获取模型不消耗 TTS 次数。">
                    <ModelPicker
                      value={aiCfg.qwenTts?.model ?? ""}
                      onChange={(model) => aiCfg && setAiCfg({ ...aiCfg, qwenTts: { ...aiCfg.qwenTts, model } })}
                      baseUrl={aiCfg.qwenTts?.baseUrl ?? ""}
                      apiKey={aiCfg.qwenTts?.apiKey ?? ""}
                      provider="qwen"
                      kind="tts"
                      placeholder="qwen3-tts-flash"
                      help="例如 qwen3-tts-flash、qwen-audio-3.1-tts-flash。"
                    />
                  </Row>
                  <Row label="千问 TTS 音色" help="例如 Cherry、longanhuan_v3.6，具体看百炼音色列表。">
                    <input
                      className="input"
                      value={aiCfg.qwenTts?.voice ?? ""}
                      onChange={(e) =>
                        aiCfg &&
                        setAiCfg({
                          ...aiCfg,
                          qwenTts: { ...aiCfg.qwenTts, voice: e.target.value },
                        })
                      }
                    />
                  </Row>
                  <Row label="语言" help="Chinese / English / Japanese / Auto 等。">
                    <input
                      className="input"
                      value={aiCfg.qwenTts?.languageType ?? ""}
                      onChange={(e) =>
                        aiCfg &&
                        setAiCfg({
                          ...aiCfg,
                          qwenTts: { ...aiCfg.qwenTts, languageType: e.target.value },
                        })
                      }
                    />
                  </Row>
                </div>
              </div>
            )}

            {aiCfg?.customTts?.enabled && (
              <div className="tts-provider-panel">
              <div className="section-label">自定义 TTS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
                  <Row label="TTS 名称" help="显示在云音色卡片上的名字。">
                    <input
                      className="input"
                      value={aiCfg.customTts?.name ?? ""}
                      onChange={(e) =>
                        aiCfg &&
                        setAiCfg({
                          ...aiCfg,
                          customTts: { ...aiCfg.customTts, name: e.target.value },
                        })
                      }
                    />
                  </Row>
                  <Row label="TTS 地址" help="兼容 OpenAI 的 Base URL，例如 https://api.openai.com/v1。">
                    <input
                      className="input"
                      placeholder="https://.../v1"
                      value={aiCfg.customTts?.baseUrl ?? ""}
                      onChange={(e) =>
                        aiCfg &&
                        setAiCfg({
                          ...aiCfg,
                          customTts: { ...aiCfg.customTts, baseUrl: e.target.value },
                        })
                      }
                    />
                  </Row>
                  <Row label="TTS API Key" help="只存在本机。">
                    <input
                      className="input"
                      type="password"
                      value={aiCfg.customTts?.apiKey ?? ""}
                      onChange={(e) =>
                        aiCfg &&
                        setAiCfg({
                          ...aiCfg,
                          customTts: { ...aiCfg.customTts, apiKey: e.target.value },
                        })
                      }
                    />
                  </Row>
                  <Row label="TTS 模型" help="只显示 TTS 模型；接口不区分时会显示全部。">
                    <ModelPicker
                      value={aiCfg.customTts?.model ?? ""}
                      onChange={(model) => aiCfg && setAiCfg({ ...aiCfg, customTts: { ...aiCfg.customTts, model } })}
                      baseUrl={aiCfg.customTts?.baseUrl ?? ""}
                      apiKey={aiCfg.customTts?.apiKey ?? ""}
                      provider="custom"
                      kind="tts"
                      placeholder="tts-1 / gpt-4o-mini-tts"
                      help="例如 tts-1、gpt-4o-mini-tts，或服务商提供的模型名。"
                    />
                  </Row>
                  <Row label="TTS 音色 ID" help="服务商的 voice 参数，例如 alloy、nova 或自定义 ID。">
                    <input
                      className="input"
                      value={aiCfg.customTts?.voice ?? ""}
                      onChange={(e) =>
                        aiCfg &&
                        setAiCfg({
                          ...aiCfg,
                          customTts: { ...aiCfg.customTts, voice: e.target.value },
                        })
                      }
                    />
                  </Row>
                </div>
              </div>
            )}
          </div>
          )}

          {aiSection === "text" && (
          <>
          <div className="setting-group">
            <Row label="分章提示词" help="留空用内置。要求模型只返回章节标题和正文起始片段，不要让模型改写正文。">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea
                  className="input prompt-textarea"
                  value={aiCfg?.prompts?.chapter || promptDefaults.chapter}
                  onChange={(e) =>
                    aiCfg &&
                    setAiCfg({ ...aiCfg, prompts: { ...aiCfg.prompts, chapter: e.target.value } })
                  }
                />
                <button
                  className="btn small"
                  onClick={() => aiCfg && setAiCfg({ ...aiCfg, prompts: { ...aiCfg.prompts, chapter: "" } })}
                >
                  恢复内置
                </button>
              </div>
            </Row>
            <Row label="角色标注提示词" help="分台词后用它判断角色、情绪和语速。可在这里加自己的角色规则。">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea
                  className="input prompt-textarea"
                  value={aiCfg?.prompts?.annotate || promptDefaults.annotate}
                  onChange={(e) =>
                    aiCfg &&
                    setAiCfg({ ...aiCfg, prompts: { ...aiCfg.prompts, annotate: e.target.value } })
                  }
                />
                <button
                  className="btn small"
                  onClick={() => aiCfg && setAiCfg({ ...aiCfg, prompts: { ...aiCfg.prompts, annotate: "" } })}
                >
                  恢复内置
                </button>
              </div>
            </Row>
            <div className="test-result" style={{ color: "var(--text-faint)" }}>
              提示词保存后，下一次 AI 分章或角色标注立即生效。
            </div>
          </div>

          <div className="setting-group">
            <Row label="章节识别" help="规则认不出章节时，导入页可以一键交给 AI；EPUB 优先用书内目录。">
              <div
                className="check-row"
                style={{ cursor: "pointer" }}
                onClick={() => aiCfg && setAiCfg({ ...aiCfg, autoChapter: !aiCfg.autoChapter })}
              >
                <span className={`check ${aiCfg?.autoChapter ? "on" : ""}`}>
                  {aiCfg?.autoChapter ? "✓" : " "}
                </span>
                导入时优先尝试 AI 识别章节
              </div>
            </Row>
            <Row
              label="标注思考模式"
              help="开启后整章交给 AI 深度思考，说话人判断更准，但会更慢；关闭后直接给结果。只有小米 MiMo 等支持 thinking 的模型会生效。"
            >
              <div
                className="check-row"
                style={{ cursor: "pointer" }}
                onClick={() =>
                  aiCfg && setAiCfg({ ...aiCfg, annotateThinking: aiCfg.annotateThinking === false })
                }
              >
                <span className={`check ${aiCfg?.annotateThinking !== false ? "on" : ""}`}>
                  {aiCfg?.annotateThinking !== false ? "✓" : " "}
                </span>
                整章深度思考（默认开）
              </div>
            </Row>
            <Row label="台词拆分" help="断句始终用规则，保证原文一字不改；AI 只负责角色、情绪和语速。让 AI 断句容易改写原文或漏句，所以不提供。">
              <div className="test-result"><span className="dot ok" />规则拆分 · 不消耗 token</div>
            </Row>
          </div>
          </>
          )}

          <div className="settings-actions">
            <button className="btn primary" onClick={saveAiCfg} disabled={!aiCfg}>保存 AI 配置</button>
            {aiSaved && <span className="test-result"><span className="dot ok" />{aiSaved}</span>}
          </div>
          <div className="setting-group">
            <Row
              label="AI 配置文件"
              help="下面是当前实际生效的配置，Key 已打码；保存上方表单后会实时更新。"
            >
              <div className="input-row">
                <input className="input" value={aiPath} readOnly placeholder="ai.json" />
                <button
                  className="btn small"
                  onClick={() => aiPath && revealFile(aiPath)}
                  disabled={!aiPath}
                >
                  打开目录
                </button>
              </div>
            </Row>
            <pre className="config-dump">{maskedAiConfig(aiCfg)}</pre>
          </div>
          </>
          )}

          {tab === "语音引擎" && (
            <>
          <div className="setting-group">
            <Row label="引擎模式" help="优先用 TTS 地址/API；只有本机要由声栞自己拉起 Python 推理时才用高级模式。">
              <div className="mode-cards">
                <div
                  className={`mode-card ${cfg?.mode === "gradio" ? "on" : ""}`}
                  onClick={() => cfg && setCfg({ ...cfg, mode: "gradio" })}
                >
                  <b>TTS 地址 / API</b>
                  <span>本地或局域网 WebUI，例如 127.0.0.1:7860；不用 Python。</span>
                </div>
                <div
                  className={`mode-card ${cfg?.mode === "local" ? "on" : ""}`}
                  onClick={() => cfg && setCfg({ ...cfg, mode: "local" })}
                >
                  <b>本机 Python（高级）</b>
                  <span>只有完全自动化时再用；需要 IndexTTS 代码和权重。</span>
                </div>
              </div>
            </Row>

            <Row label="IndexTTS 版本" help="本机 Python 模式按这里加载 infer_v2_5 或 infer_v2；Gradio 地址模式只用于显示版本。">
              <div className="mode-cards">
                <div
                  className={`mode-card ${cfg?.indexttsVersion !== "2.0" ? "on" : ""}`}
                  onClick={() => cfg && setCfg({ ...cfg, indexttsVersion: "2.5" })}
                >
                  <b>IndexTTS 2.5</b>
                  <span>支持语言、时长系数和情感向量。</span>
                </div>
                <div
                  className={`mode-card ${cfg?.indexttsVersion === "2.0" ? "on" : ""}`}
                  onClick={() => cfg && setCfg({ ...cfg, indexttsVersion: "2.0" })}
                >
                  <b>IndexTTS 2.0</b>
                  <span>兼容旧权重；不支持语速和 2.5 的多语言参数。</span>
                </div>
              </div>
            </Row>

            {cfg?.mode === "gradio" && (
              <>
                <Row label="TTS 服务地址" help="优先填这里。本地服务就写 http://127.0.0.1:7860，远端 WebUI 写局域网地址。">
                  <input
                    className="input"
                    placeholder="http://127.0.0.1:7860"
                    value={cfg.gradioUrl}
                    onChange={(e) => setCfg({ ...cfg, gradioUrl: e.target.value })}
                  />
                </Row>
                <Row label="API 名称" help="默认 gen_single；代理会自动从 /config 发现参数。">
                  <input
                    className="input"
                    value={cfg.gradioApi}
                    onChange={(e) => setCfg({ ...cfg, gradioApi: e.target.value })}
                  />
                </Row>
                <div className="tool-help" style={{ marginBottom: 10 }}>
                  只要服务以 WebUI / Gradio 运行，本机和远端一样填地址。地址方式启动更快，也不需要 Python 路径。
                </div>
              </>
            )}

            {cfg?.mode === "local" && (
              <details className="advanced-settings">
                <summary>高级：本机 Python、代码和模型路径</summary>
                <p className="setting-help">
                  只有本机要由声栞自己拉起 Python 推理时才需要填。已经在 7860 或其他端口跑着 WebUI 的话，切回上面的地址方式。
                </p>
                <Row label="Python 路径" help="IndexTTS 的 venv python.exe。">
                  <input
                    className="input"
                    value={cfg.python}
                    onChange={(e) => setCfg({ ...cfg, python: e.target.value })}
                  />
                </Row>
                <Row label="代码目录" help="包含 indextts/infer_v2_5.py 或 indextts/infer_v2.py 的目录。">
                  <input
                    className="input"
                    value={cfg.indexttsCodeDir}
                    onChange={(e) => setCfg({ ...cfg, indexttsCodeDir: e.target.value })}
                  />
                </Row>
                <Row label="模型目录" help="包含 config.yaml 的权重目录。">
                  <input
                    className="input"
                    value={cfg.indexttsModelDir}
                    onChange={(e) => setCfg({ ...cfg, indexttsModelDir: e.target.value })}
                  />
                </Row>
              </details>
            )}

            <Row label="音色库" help="参考音频目录，留空则用项目下的 voices。">
              <input
                className="input"
                value={cfg?.voiceLib ?? ""}
                onChange={(e) => cfg && setCfg({ ...cfg, voiceLib: e.target.value })}
              />
            </Row>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <button className="btn primary" onClick={saveCfg}>保存引擎配置</button>
              <button className="btn" onClick={testEngine} disabled={testing}>
                {testing ? "测试中" : "测试当前引擎"}
              </button>
              {cfgSaved && <span className="test-result"><span className="dot ok" />{cfgSaved}</span>}
            </div>
            {engine && (
              <div className="test-result" style={{ marginTop: 8 }}>
                <span className={`dot ${engine.ok ? "ok" : "warn"}`} />
                {engine.text}
              </div>
            )}
          </div>
          </>
          )}

          {tab === "开发与 MCP" && (
            <>
          <div className="setting-group">
            <Row label="开发日志" help="导入、AI 分章、角色标注和编辑操作都会写进这个文件，排查问题时直接发它。只存在本机，不写进项目或安装包。">
              <div className="log-box">
                <div className="input-row">
                  <input className="input" value={logPath} readOnly placeholder="还没有日志" />
                  <button
                    className="btn small"
                    onClick={async () => {
                      await openLog();
                      log("settings", "打开日志文件");
                    }}
                  >
                    打开
                  </button>
                  <button
                    className="btn small ghost"
                    onClick={async () => {
                      if (!window.confirm("清空开发日志？只会清空日志文件，不影响项目、音频和配置。")) return;
                      const r = await clearLog();
                      if (r) {
                        setLogMeta(r.info);
                        setLogNotice(`已清空，释放 ${formatBytes(r.freed)}`);
                        window.setTimeout(() => setLogNotice(""), 3000);
                      }
                    }}
                  >
                    清空
                  </button>
                </div>
                <div className="log-meta">
                  <span>{logMeta ? `当前 ${formatBytes(logMeta.totalSize ?? logMeta.size)} · 主日志 ${formatBytes(logMeta.size)}` : "还没有日志"}</span>
                  <span>超过 5 MB 自动轮转，保留 1 份备份；不会一直占空间。</span>
                </div>
                {logNotice && <div className="test-result"><span className="dot ok" />{logNotice}</div>}
              </div>
            </Row>
          </div>

          <div className="setting-group">
            <Row label="MCP 服务器" help="让外部 AI 读取项目、建项目、改台词、绑音色、生成音频和导出；默认读最近修改的项目。">
              <div className="test-result"><span className="dot ok" />stdio · node mcp/server.mjs</div>
            </Row>
            <Row label="权限" help="通过环境变量 SHENGKAN_MCP_PERMISSION 控制，默认 generate；改完需要重启 OpenCode/MCP 客户端。MCP 客户端决定调用哪个工具，声栞再做第二道限制。">
              <div className="mcp-permissions">
                <div><b>read</b><span>列项目、读项目、读台词、查音色和审计</span></div>
                <div><b>edit</b><span>只读 + 建项目/章节/台词/角色/音色 + 拆句</span></div>
                <div><b>generate</b><span>可改 + 生成单句/整章/整本 + 导出音频（默认）</span></div>
                <div><b>full</b><span>可生成 + 回收站 + 一键启动软件</span></div>
              </div>
            </Row>
            <Row label="可用工具" help="用 get_permissions 可以在会话里确认当前级别和完整工具列表。">
              <div className="tool-chips">
                {[
                  "create_project",
                  "add_chapter",
                  "replace_chapter_lines",
                  "bind_voice",
                  "read_project",
                  "read_lines",
                  "list_voices",
                  "get_health",
                  "generate_chapter",
                  "generate_project",
                  "export_audio",
                  "open_app",
                ].map((tool) => (
                  <span className="tool-chip" key={tool}>{tool}</span>
                ))}
              </div>
            </Row>
          </div>
          </>
          )}
        </div>
      </div>
    </section>
  );
}
