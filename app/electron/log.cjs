const fs = require("node:fs");
const path = require("node:path");
const { app, shell } = require("electron");

const MAX_SIZE = 5 * 1024 * 1024;
const KEEP_BACKUPS = 1;

function logFile() {
  return path.join(app.getPath("userData"), "logs", "app.log");
}

function rotate(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_SIZE) return;
    const backup = `${file}.1`;
    if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
    fs.renameSync(file, backup);
    // 只保留一份备份；更旧的日志不占空间。
    for (let i = KEEP_BACKUPS + 1; i <= 3; i++) {
      const extra = `${file}.${i}`;
      if (fs.existsSync(extra)) fs.rmSync(extra, { force: true });
    }
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
  let backupSize = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    /* 还没有日志 */
  }
  try {
    backupSize = fs.statSync(`${file}.1`).size;
  } catch {
    /* 还没有备份 */
  }
  return {
    file,
    size,
    backupSize,
    totalSize: size + backupSize,
    maxSize: MAX_SIZE,
    keepBackups: KEEP_BACKUPS,
  };
}

async function clear() {
  const file = logFile();
  let freed = 0;
  for (const target of [file, `${file}.1`]) {
    try {
      if (!fs.existsSync(target)) continue;
      freed += fs.statSync(target).size;
      fs.writeFileSync(target, "", "utf8");
    } catch {
      /* 清不掉就保留 */
    }
  }
  return { ok: true, freed, info: info() };
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

module.exports = { write, info, clear, open, logFile };
