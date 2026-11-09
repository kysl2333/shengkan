const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const ENGINE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "engine")
  : path.join(__dirname, "..", "..", "engine");

const FILE = path.join(ENGINE_DIR, "config.json");

const DEFAULTS = {
  mode: "gradio",
  gradioUrl: "http://192.168.3.68:7860",
  gradioApi: "gen_single",
  voiceLib: "",
  python: "",
  indexttsCodeDir: "",
  indexttsModelDir: "",
};

function readConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeConfig(cfg) {
  const next = { ...DEFAULTS, ...cfg };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { readConfig, writeConfig, ENGINE_DIR, FILE, DEFAULTS };
