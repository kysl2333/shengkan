import { useEffect, useState } from "react";
import { getHealth } from "../api";
import { getEngineConfig, setEngineConfig, type EngineConfig } from "../config";
import { getAiConfig, setAiConfig, testAi, getDefaultPrompts, type AiConfig } from "../ai";
import { log, logInfo, openLog } from "../log";

const nav = ["AI 服务", "语音引擎", "开发与 MCP"];

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

export default function Settings() {
  const [tab, setTab] = useState("AI 服务");
  const [engine, setEngine] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState<EngineConfig | null>(null);
  const [cfgSaved, setCfgSaved] = useState("");
  const [aiCfg, setAiCfg] = useState<AiConfig | null>(null);
  const [aiSaved, setAiSaved] = useState("");
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTest, setAiTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [logPath, setLogPath] = useState("");
  const [promptDefaults, setPromptDefaults] = useState({ chapter: "", annotate: "" });

  useEffect(() => {
    getEngineConfig().then(setCfg).catch(() => {});
    getAiConfig().then(setAiCfg).catch(() => {});
    getDefaultPrompts().then(setPromptDefaults).catch(() => {});
    logInfo().then((info) => info && setLogPath(info.file)).catch(() => {});
  }, []);

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
      ? "远端 Gradio 不需要本机模型；本机模式需要 IndexTTS 代码和权重。改完重启软件生效。"
      : tab === "开发与 MCP"
        ? "开发日志记录导入、AI、编辑和生成过程；MCP 让外部 AI 通过 stdio 读写项目。"
        : "分章、角色标注和情绪判断都用 MiMo。填一次，之后所有项目共用。";

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
            <>

          <div className="setting-group">
            <Row label="服务地址" help="兼容 OpenAI 的 Base URL，末尾带 /v1。默认用小米 MiMo。">
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
            <Row label="API Key" help="MiMo 控制台创建的 sk- 开头密钥，只存在本机。">
              <input
                className="input"
                type="password"
                placeholder="sk-..."
                value={aiCfg?.apiKey ?? ""}
                onChange={(e) => aiCfg && setAiCfg({ ...aiCfg, apiKey: e.target.value })}
              />
            </Row>
            <Row label="模型" help="章节识别和台词标注都用这个模型。">
              <select
                className="select"
                value={aiCfg?.model ?? "mimo-v2.6-flash"}
                onChange={(e) => aiCfg && setAiCfg({ ...aiCfg, model: e.target.value })}
              >
                <option value="mimo-v2.6-flash">mimo-v2.6-flash</option>
                <option value="mimo-v2.6-pro">mimo-v2.6-pro</option>
              </select>
            </Row>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <button className="btn primary" onClick={saveAiCfg} disabled={!aiCfg}>保存 AI 配置</button>
              {aiSaved && <span className="test-result"><span className="dot ok" />{aiSaved}</span>}
            </div>
          </div>

          <div className="setting-group">
            <Row
              label="云 TTS 服务"
              help="关闭后云音色列表、云生成和设计音色都会停用；已经绑定的角色需要改用本地音色。"
            >
              <div
                className="check-row"
                style={{ cursor: "pointer" }}
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
                <span className={`check ${aiCfg?.cloudProviders?.mimo !== false ? "on" : ""}`}>
                  {aiCfg?.cloudProviders?.mimo !== false ? "✓" : " "}
                </span>
                小米 MiMo
              </div>
              <div className="tool-help">当前只接入了 MiMo；以后新增的云 TTS 会在这里逐个开关。</div>
            </Row>
          </div>

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
            <Row label="台词拆分" help="当前用规则拆分：引号内识别为台词，其余为旁白。">
              <div className="test-result"><span className="dot ok" />规则拆分 · 不消耗 token</div>
            </Row>
          </div>
          </>
          )}

          {tab === "语音引擎" && (
            <>
          <div className="setting-group">
            <Row label="引擎模式" help="远端 Gradio 不需要本机模型；本机模式需要 IndexTTS 代码和权重。">
              <div className="mode-cards">
                <div
                  className={`mode-card ${cfg?.mode === "gradio" ? "on" : ""}`}
                  onClick={() => cfg && setCfg({ ...cfg, mode: "gradio" })}
                >
                  <b>远端 Gradio</b>
                  <span>连另一台电脑的 WebUI，本机不用 Python。</span>
                </div>
                <div
                  className={`mode-card ${cfg?.mode === "local" ? "on" : ""}`}
                  onClick={() => cfg && setCfg({ ...cfg, mode: "local" })}
                >
                  <b>本机 IndexTTS</b>
                  <span>本机 Python + 模型，直接推理。</span>
                </div>
              </div>
            </Row>

            {cfg?.mode === "gradio" && (
              <>
                <Row label="远端地址" help="另一台电脑的 Gradio 地址，例如 http://192.168.3.68:7860。">
                  <input
                    className="input"
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
              </>
            )}

            {cfg?.mode === "local" && (
              <>
                <Row label="Python 路径" help="IndexTTS 的 venv python.exe。">
                  <input
                    className="input"
                    value={cfg.python}
                    onChange={(e) => setCfg({ ...cfg, python: e.target.value })}
                  />
                </Row>
                <Row label="代码目录" help="包含 indextts/infer_v2_5.py 的目录。">
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
              </>
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
            <Row label="开发日志" help="导入、AI 分章、角色标注和编辑操作都会写进这个文件，排查问题时直接发它。">
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
              </div>
            </Row>
          </div>

          <div className="setting-group">
            <Row label="MCP 服务器" help="让外部 AI 读取项目和修改台词。默认读最近修改的项目。">
              <div className="test-result"><span className="dot ok" />stdio · node mcp/server.mjs</div>
            </Row>
            <Row label="权限" help="MCP 客户端自己决定调用哪些工具；声栞不在应用内额外限制。">
              <div className="test-result" style={{ color: "var(--text-faint)" }}>
                由 MCP 客户端控制
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
