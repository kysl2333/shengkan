const fs = require("node:fs");
const path = require("node:path");
const paths = require("./paths.cjs");

const ROOT = process.env.SHENGKAN_PROJECTS
  ? path.resolve(process.env.SHENGKAN_PROJECTS)
  : paths.PROJECTS;

const TRASH = path.join(ROOT, ".trash");

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function projectDir(id) {
  if (!/^[\w\u4e00-\u9fa5-]+$/.test(id)) {
    throw new Error("项目 id 不合法");
  }
  return path.join(ROOT, id);
}

function findDirById(id) {
  const direct = projectDir(id);
  if (fs.existsSync(path.join(direct, "project.json"))) return direct;
  ensureRoot();
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const dir = path.join(ROOT, d.name);
    const file = path.join(dir, "project.json");
    if (!fs.existsSync(file)) continue;
    try {
      if (readJson(file).id === id) return dir;
    } catch {
      /* ignore */
    }
  }
  return direct;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function summary(project, dir) {
  const lines = project.chapters.flatMap((c) => c.lines || []);
  const done = lines.filter((l) => l.status === "done" && l.audio).length;
  return {
    id: project.id,
    title: project.title,
    chapters: project.chapters.length,
    lines: lines.length,
    done,
    percent: lines.length ? Math.round((done / lines.length) * 100) : 0,
    updatedAt: project.updatedAt,
    dir,
  };
}

function dirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  } catch {
    /* 目录不可读就不计 */
  }
  return total;
}

function projectAudioFiles(project) {
  const names = new Set();
  for (const chapter of project.chapters || []) {
    for (const line of chapter.lines || []) {
      for (const url of [line.audio, ...(line.audioHistory || [])]) {
        const name = path.basename(String(url || ""));
        if (name) names.add(name);
      }
    }
  }
  return [...names];
}

function listProjects() {
  ensureRoot();
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => {
      const dir = path.join(ROOT, d.name);
      const file = path.join(dir, "project.json");
      if (!fs.existsSync(file)) return null;
      try {
        return summary(readJson(file), dir);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function loadProject(id) {
  const file = path.join(findDirById(id), "project.json");
  if (!fs.existsSync(file)) throw new Error(`项目不存在: ${id}`);
  return readJson(file);
}

function saveProject(project) {
  if (!project?.id) throw new Error("项目缺少 id");
  const dir = findDirById(project.id);
  fs.mkdirSync(dir, { recursive: true });
  project.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2), "utf8");
  return summary(project, dir);
}

function createProject(title) {
  const id = `p-${Date.now().toString(36)}`;
  const project = {
    id,
    title: title || "未命名项目",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: { engine: "http://127.0.0.1:8290" },
    casts: [],
    chapters: [],
  };
  saveProject(project);
  return project;
}

function trashProject(id) {
  const dir = findDirById(id);
  const file = path.join(dir, "project.json");
  if (!fs.existsSync(file)) throw new Error(`项目不存在: ${id}`);

  fs.mkdirSync(TRASH, { recursive: true });
  const target = path.join(TRASH, `${path.basename(dir)}__${Date.now()}`);
  fs.renameSync(dir, target);
  return { ok: true, trashName: path.basename(target) };
}

function listTrash() {
  fs.mkdirSync(TRASH, { recursive: true });
  return fs
    .readdirSync(TRASH, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(TRASH, d.name);
      const file = path.join(dir, "project.json");
      if (!fs.existsSync(file)) return null;
      try {
        const project = readJson(file);
        const stamp = Number(d.name.split("__").pop());
        return {
          ...summary(project, dir),
          trashName: d.name,
          size: dirSize(dir),
          deletedAt: new Date(
            Number.isFinite(stamp) ? stamp : fs.statSync(dir).mtimeMs
          ).toISOString(),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

function restoreProject(trashName) {
  const src = path.join(TRASH, path.basename(trashName));
  const file = path.join(src, "project.json");
  if (!fs.existsSync(file)) throw new Error("回收站里没有这个项目");

  const base = path.basename(trashName).split("__")[0] || `restored-${Date.now()}`;
  let target = path.join(ROOT, base);
  if (fs.existsSync(target)) target = path.join(ROOT, `${base}-restored-${Date.now()}`);
  fs.renameSync(src, target);
  return summary(readJson(path.join(target, "project.json")), target);
}

function deleteForever(trashName) {
  const target = path.join(TRASH, path.basename(trashName));
  const file = path.join(target, "project.json");
  if (!fs.existsSync(file)) throw new Error("回收站里没有这个项目");

  let project = null;
  try {
    project = readJson(file);
  } catch {
    /* 项目损坏也允许彻底删除 */
  }

  let removedAudio = 0;
  if (project) {
    for (const name of projectAudioFiles(project)) {
      const audio = path.join(paths.OUTPUTS, name);
      if (!fs.existsSync(audio)) continue;
      try {
        fs.unlinkSync(audio);
        removedAudio += 1;
      } catch {
        /* 单个音频删不掉不影响项目删除 */
      }
    }
  }

  fs.rmSync(target, { recursive: true, force: true });
  return { ok: true, removedAudio };
}

function emptyTrash() {
  fs.mkdirSync(TRASH, { recursive: true });
  let count = 0;
  let failed = 0;
  for (const entry of fs.readdirSync(TRASH, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      deleteForever(entry.name);
      count += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok: true, count, failed };
}

module.exports = {
  listProjects,
  loadProject,
  saveProject,
  createProject,
  trashProject,
  listTrash,
  restoreProject,
  deleteForever,
  emptyTrash,
  ROOT,
  TRASH,
};
