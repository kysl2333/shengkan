import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "data");
const PROJECTS = process.env.SHENGKAN_PROJECTS
  ? path.resolve(process.env.SHENGKAN_PROJECTS)
  : path.join(here, "..", "projects");
const TRASH = path.join(PROJECTS, ".trash");
const AUDIT = path.join(DATA, "audit.jsonl");
const ENGINE = process.env.SHENGKAN_ENGINE || "http://127.0.0.1:8290";

let currentFile = null;

const PROJECT_ARG = z
  .string()
  .optional()
  .describe("项目 id 或标题，不填用最近修改的项目");

const SPEED_LABELS = { 很慢: 0.6, 慢: 0.8, 稍慢: 0.9, 正常: 1, 快: 1.2 };

function normalizeSpeed(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.min(2, Math.max(0.5, numeric));
  return SPEED_LABELS[String(value || "").trim()] ?? 1;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function projectEntries(root, includeTrash = false) {
  const out = [];
  if (!fs.existsSync(root)) return out;

  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = path.join(root, dir.name);
    const isTrash = dir.name.startsWith(".") || full === TRASH;
    if (isTrash) {
      if (!includeTrash || full !== TRASH) continue;
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const file = path.join(full, sub.name, "project.json");
        if (!fs.existsSync(file)) continue;
        try {
          out.push({
            file,
            dir: path.join(full, sub.name),
            trashName: sub.name,
            project: readJson(file),
          });
        } catch {
          /* 跳过损坏的项目 */
        }
      }
      continue;
    }

    const file = path.join(full, "project.json");
    if (!fs.existsSync(file)) continue;
    try {
      out.push({ file, dir: full, project: readJson(file) });
    } catch {
      /* 跳过损坏的项目 */
    }
  }

  return out;
}

function projectSummary(entry) {
  const lines = entry.project.chapters.flatMap((c) => c.lines || []);
  return {
    id: entry.project.id,
    title: entry.project.title,
    chapters: entry.project.chapters.length,
    lines: lines.length,
    done: lines.filter((l) => l.status === "done" && l.audio).length,
    updatedAt: entry.project.updatedAt,
    file: entry.file,
    ...(entry.trashName ? { trashName: entry.trashName } : {}),
  };
}

function findProjectFile(query) {
  if (process.env.SHENGKAN_PROJECT) {
    const file = path.resolve(process.env.SHENGKAN_PROJECT);
    if (!fs.existsSync(file)) {
      throw new Error(`SHENGKAN_PROJECT 指向的文件不存在：${file}`);
    }
    return file;
  }

  const items = projectEntries(PROJECTS);
  if (!items.length) {
    throw new Error(
      "没有活动项目。请先在声栞项目库还原或新建一个项目；当前没有任何可读的 projects/<目录>/project.json。"
    );
  }

  if (query) {
    const hit = items.find(
      (x) =>
        x.project.id === query ||
        x.project.title === query ||
        path.basename(x.dir) === query
    );
    if (hit) return hit.file;
    throw new Error(`找不到项目：${query}`);
  }

  items.sort((a, b) => String(b.project.updatedAt).localeCompare(String(a.project.updatedAt)));
  return items[0].file;
}

function readProject(query) {
  const file = findProjectFile(query);
  let project;
  try {
    project = readJson(file);
  } catch (e) {
    throw new Error(`项目文件损坏，无法解析：${file}（${e.message}）`);
  }
  currentFile = file;
  return project;
}

function writeProject(project) {
  if (!currentFile) throw new Error("还没有打开项目，先调用 read_project");
  project.updatedAt = new Date().toISOString();
  try {
    fs.writeFileSync(currentFile, JSON.stringify(project, null, 2), "utf8");
  } catch (e) {
    throw new Error(`写入项目失败：${currentFile}（${e.message}）`);
  }
  return currentFile;
}

function audit(action, detail) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(
    AUDIT,
    JSON.stringify({ time: new Date().toISOString(), action, detail }) + "\n",
    "utf8"
  );
}

function text(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

const PERMISSION_LEVELS = { read: 0, edit: 1, generate: 2, full: 3 };
const PERMISSION = String(process.env.SHENGKAN_MCP_PERMISSION || "generate").toLowerCase();
const PERMISSION_LABELS = {
  read: "只读：列项目、读项目、读台词、查审计",
  edit: "可改：只读 + 修改台词/角色/情绪/语速 + 拆句预览",
  generate: "可生成：可改 + 调 TTS 生成音频（默认）",
  full: "完全控制：可生成 + 查看回收站项目列表",
};

function allowed(action) {
  const need = PERMISSION_LEVELS[action] ?? 99;
  const have = PERMISSION_LEVELS[PERMISSION] ?? -1;
  return have >= need;
}

function deny(action) {
  return {
    ...text(
      `权限不足：当前 SHENGKAN_MCP_PERMISSION=${PERMISSION}，这个操作需要 ${action}。\n` +
        `可用级别：${Object.keys(PERMISSION_LEVELS).join(" / ")}。`
    ),
    isError: true,
  };
}

async function engineCall(endpoint, payload, timeout = 180000) {
  let response;
  try {
    response = await fetch(`${ENGINE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(`连不上本地引擎 ${ENGINE}：${e.message}`);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!response.ok) {
    throw new Error(data?.error || `引擎返回 HTTP ${response.status}`);
  }
  return data;
}

const server = new McpServer({ name: "shengkan", version: "0.3.0" });

server.tool(
  "get_permissions",
  "查看当前 MCP 权限级别、可用工具和限制。",
  {},
  async () => {
    const tools = ["list_projects", "read_project", "read_lines", "get_audit", "get_permissions"];
    if (allowed("edit")) tools.push("update_line", "split_chapter");
    if (allowed("generate")) tools.push("generate_line");
    if (allowed("full")) tools.push("list_projects(includeTrash=true)");
    return text({
      permission: PERMISSION,
      label: PERMISSION_LABELS[PERMISSION] || "未知级别",
      allowed: Object.fromEntries(
        Object.keys(PERMISSION_LEVELS).map((k) => [k, allowed(k)])
      ),
      tools,
      env: "SHENGKAN_MCP_PERMISSION=read|edit|generate|full",
    });
  }
);

server.tool(
  "list_projects",
  "列出声栞项目。默认只列活动项目，可选包含回收站。先调这个确认项目是否存在。",
  {
    includeTrash: z.boolean().optional().describe("是否包含 projects/.trash 里的项目"),
  },
  async ({ includeTrash = false }) => {
    if (includeTrash && !allowed("full")) return deny("full");
    const items = projectEntries(PROJECTS, includeTrash).sort((a, b) =>
      String(b.project.updatedAt).localeCompare(String(a.project.updatedAt))
    );
    return text({
      count: items.length,
      permission: PERMISSION,
      projects: items.map(projectSummary),
    });
  }
);

server.tool(
  "read_project",
  "读取项目标题、章节列表和角色。默认读最近修改的项目。",
  { project: PROJECT_ARG },
  async ({ project }) => {
    const p = readProject(project);
    return text({
      id: p.id,
      title: p.title,
      file: currentFile,
      permission: PERMISSION,
      updatedAt: p.updatedAt,
      casts: p.casts,
      chapters: p.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        lines: c.lines.length,
        pending: c.lines.filter((l) => l.status !== "done" || !l.audio).length,
      })),
    });
  }
);

server.tool(
  "read_lines",
  "读取某一章的全部台词，包含角色、情绪、语速、当前音频和历史音频。",
  { chapterId: z.string().describe("章节 id，例如 ch-03"), project: PROJECT_ARG },
  async ({ chapterId, project }) => {
    const p = readProject(project);
    const c = p.chapters.find((x) => x.id === chapterId);
    if (!c) return { ...text(`章节不存在: ${chapterId}`), isError: true };
    return text(c.lines.map((line) => ({ ...line, speed: normalizeSpeed(line.speed) })));
  }
);

server.tool(
  "update_line",
  "修改一句台词。只传需要改的字段。会写审计日志，可在软件里回滚。",
  {
    chapterId: z.string(),
    lineId: z.number(),
    text: z.string().optional(),
    speaker: z.string().optional(),
    emotion: z.string().optional(),
    speed: z.number().optional().describe("语速 0.5-2.0，1 是正常"),
    note: z.string().optional(),
    project: PROJECT_ARG,
  },
  async ({ chapterId, lineId, text: newText, speaker, emotion, speed, note, project }) => {
    if (!allowed("edit")) return deny("edit");
    if (
      newText === undefined &&
      speaker === undefined &&
      emotion === undefined &&
      speed === undefined &&
      note === undefined
    ) {
      return { ...text("没有要修改的字段"), isError: true };
    }

    const p = readProject(project);
    const c = p.chapters.find((x) => x.id === chapterId);
    const line = c?.lines.find((l) => l.id === lineId);
    if (!line) return { ...text(`找不到 ${chapterId} 的第 ${lineId} 句`), isError: true };

    const before = { ...line };
    if (newText !== undefined) line.text = newText;
    if (speaker !== undefined) line.speaker = speaker;
    if (emotion !== undefined) line.emotion = emotion;
    if (speed !== undefined) line.speed = normalizeSpeed(speed);
    if (note !== undefined) line.note = note;
    line.status = "dirty";

    writeProject(p);
    audit("update_line", { project: p.id, chapterId, lineId, before, after: line });
    return text({ ok: true, line });
  }
);

server.tool(
  "split_chapter",
  "调用本地引擎把原文拆成台词，只返回结果不写入。确认后再用 update_line 或手动导入。",
  { text: z.string().describe("要拆分的原文"), project: PROJECT_ARG },
  async ({ text: source, project }) => {
    if (!allowed("edit")) return deny("edit");
    try {
      const data = await engineCall("/v1/split", { text: source }, 60000);
      audit("split_chapter", { project, characters: source.length, segments: data.count });
      return text(data);
    } catch (e) {
      return { ...text(e.message), isError: true };
    }
  }
);

server.tool(
  "generate_line",
  "为一句台词生成音频。voicePath 必须是 voices 目录里的参考音频路径。生成前会保留上一版音频。",
  {
    chapterId: z.string(),
    lineId: z.number(),
    voicePath: z.string().describe("参考音频路径，通常在 voices 目录下"),
    project: PROJECT_ARG,
  },
  async ({ chapterId, lineId, voicePath, project }) => {
    if (!allowed("generate")) return deny("generate");
    const p = readProject(project);
    const c = p.chapters.find((x) => x.id === chapterId);
    const line = c?.lines.find((l) => l.id === lineId);
    if (!line) return { ...text("台词不存在"), isError: true };

    try {
      const data = await engineCall("/v1/tts", {
        text: line.text,
        voice: voicePath,
        lang: "ZH",
        speed: normalizeSpeed(line.speed),
      });

      const history = [...(line.audioHistory || [])];
      if (line.audio) history.push(line.audio);
      while (history.length > 1) {
        const dropped = history.shift();
        if (dropped) engineCall("/v1/audio-delete", { url: dropped }, 10000).catch(() => {});
      }
      line.audio = data.url;
      line.audioHistory = history;
      line.status = "done";

      writeProject(p);
      audit("generate_line", { project: p.id, chapterId, lineId, file: data.file });
      return text({ ok: true, file: data.file, url: data.url });
    } catch (e) {
      return { ...text(e.message), isError: true };
    }
  }
);

server.tool(
  "get_audit",
  "查看 AI 对项目做过的修改，最近 N 条。",
  { limit: z.number().optional().describe("默认 20，最大 200") },
  async ({ limit = 20 }) => {
    if (!fs.existsSync(AUDIT)) return text("还没有记录");
    const count = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = fs.readFileSync(AUDIT, "utf8").trim().split("\n").filter(Boolean).slice(-count);
    return text(rows.join("\n") || "还没有记录");
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
