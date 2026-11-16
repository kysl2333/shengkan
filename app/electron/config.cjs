const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_DIR, CONFIG } = require("./paths.cjs");

const FILE = CONFIG;

const DEFAULTS = {
  mode: "gradio",
  gradioUrl: "http://127.0.0.1:7860",
  gradioApi: "gen_single",
  voiceLib: "",
  python: "",
  indexttsCodeDir: "",
  indexttsModelDir: "",
  indexttsVersion: "2.5",
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
