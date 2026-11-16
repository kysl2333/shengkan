const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const REPO = path.join(__dirname, "..", "..");
const PACKAGED = app.isPackaged;
const DOCUMENTS = app.getPath("documents");
const USER_DATA = app.getPath("userData");

const ENGINE_DIR = PACKAGED
  ? path.join(process.resourcesPath, "engine")
  : path.join(REPO, "engine");
const PROJECTS = PACKAGED
  ? path.join(DOCUMENTS, "shengkan-projects")
  : path.join(REPO, "projects");
const VOICES = PACKAGED
  ? path.join(DOCUMENTS, "shengkan-voices")
  : path.join(REPO, "voices");
const OUTPUTS = PACKAGED
  ? path.join(USER_DATA, "outputs")
  : path.join(ENGINE_DIR, "outputs");
const CONFIG = PACKAGED
  ? path.join(USER_DATA, "engine.json")
  : path.join(ENGINE_DIR, "config.json");
const LOGS = PACKAGED ? path.join(USER_DATA, "logs") : ENGINE_DIR;
const ENGINE_LOG = path.join(LOGS, "engine.log");

function ensureDirs() {
  for (const dir of [PROJECTS, VOICES, OUTPUTS, LOGS]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDirs();

module.exports = {
  PACKAGED,
  REPO,
  DOCUMENTS,
  USER_DATA,
  ENGINE_DIR,
  PROJECTS,
  VOICES,
  OUTPUTS,
  CONFIG,
  LOGS,
  ENGINE_LOG,
  ensureDirs,
};
