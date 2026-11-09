const fs = require("node:fs");
const path = require("node:path");
const { app, shell } = require("electron");

const MAX_SIZE = 5 * 1024 * 1024;

function logFile() {
  return path.join(app.getPath("userData"), "logs", "app.log");
}

function rotate(file) {
  try {
    if (fs.statSync(file).size < MAX_SIZE) return;
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* 文件还不存在 */
  }
}

function write(scope, message, data) {
  const file = logFile();
  const extra = data === undefined ? "" : ` ${safe(data)}`;
  const line = `${new Date().toISOString()} [${scope}] ${message}${extra}\n`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotate(file);
    fs.appendFileSync(file, line, "utf8");
  } catch {
    /* 日志失败不影响主流程 */
  }
  console.log(line.trimEnd());
}

function safe(value) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  } catch {
    return String(value);
  }
}

function info() {
  const file = logFile();
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    /* 还没有日志 */
  }
  return { file, size };
}

async function open() {
  const file = logFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, "", "utf8");
  } catch {
    /* ignore */
  }
  await shell.openPath(file);
  return file;
}

module.exports = { write, info, open, logFile };
