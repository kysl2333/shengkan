const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const paths = require("./paths.cjs");
const { readConfig } = require("./config.cjs");

const ENGINE_DIR = paths.ENGINE_DIR;
const NODE_SERVER = path.join(ENGINE_DIR, "node-server.mjs");
const PY_SERVER = path.join(ENGINE_DIR, "server.py");
const PORT = Number(process.env.SHENGKAN_ENGINE_PORT || 8290);

let child = null;

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(600, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const NODE_BIN =
  process.env.SHENGKAN_NODE ||
  (fs.existsSync("C:\\Program Files\\nodejs\\node.exe")
    ? "C:\\Program Files\\nodejs\\node.exe"
    : "node");
const ENGINE_LOG = paths.ENGINE_LOG;

function logEngine(message) {
  try {
    fs.appendFileSync(ENGINE_LOG, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

async function ensureEngine() {
  if (await portOpen(PORT)) {
    return { started: false, reason: "already-running", port: PORT };
  }

  const cfg = readConfig();
  const mode = cfg.mode || "gradio";
  logEngine(`ensureEngine mode=${mode} node=${NODE_BIN} server=${NODE_SERVER}`);
  const out = (() => {
    try {
      return fs.openSync(ENGINE_LOG, "a");
    } catch {
      return "ignore";
    }
  })();

  if (mode === "local") {
    const python = cfg.python || process.env.SHENGKAN_PYTHON;
    if (!python || !fs.existsSync(python)) {
      return { started: false, reason: "python-not-found", python: python || "" };
    }
    if (!fs.existsSync(PY_SERVER)) {
      return { started: false, reason: "server-not-found", server: PY_SERVER };
    }
    const env = {
      ...process.env,
      ENGINE_PORT: String(PORT),
      PYTHONIOENCODING: "utf-8",
      OUTPUT_DIR: paths.OUTPUTS,
      VOICE_LIB: cfg.voiceLib || paths.VOICES,
      INDEXTTS_VERSION: cfg.indexttsVersion || "2.5",
      SHENGKAN_ENGINE_CONFIG: paths.CONFIG,
    };
    if (cfg.indexttsCodeDir) env.INDEXTTS_CODE_DIR = cfg.indexttsCodeDir;
    if (cfg.indexttsModelDir) env.INDEXTTS_MODEL_DIR = cfg.indexttsModelDir;
    child = spawn(python, [PY_SERVER], {
      cwd: ENGINE_DIR,
      env,
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    if (!fs.existsSync(NODE_SERVER)) {
      return { started: false, reason: "node-server-not-found", server: NODE_SERVER };
    }
    child = spawn(NODE_BIN, [NODE_SERVER], {
      cwd: ENGINE_DIR,
      env: {
        ...process.env,
        ENGINE_PORT: String(PORT),
        OUTPUT_DIR: paths.OUTPUTS,
        VOICE_LIB: cfg.voiceLib || paths.VOICES,
        INDEXTTS_VERSION: cfg.indexttsVersion || "2.5",
        SHENGKAN_ENGINE_CONFIG: paths.CONFIG,
        GRADIO_URL: process.env.GRADIO_URL || cfg.gradioUrl || "http://127.0.0.1:7860",
        GRADIO_API: process.env.GRADIO_API || cfg.gradioApi || "gen_single",
      },
      windowsHide: true,
      stdio: ["ignore", out, out],
    });
    child.on("error", (e) => logEngine(`spawn error: ${e.message}`));
  }

  child.on("exit", () => {
    child = null;
  });

  return { started: true, port: PORT, mode };
}

function stopEngine() {
  if (child && !child.killed) child.kill();
  child = null;
}

module.exports = { ensureEngine, stopEngine, PORT };
