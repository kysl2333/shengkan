import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import projectStore from "../app/electron/project-store.cjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "data");
const PROJECTS = process.env.SHENGKAN_PROJECTS
  ? path.resolve(process.env.SHENGKAN_PROJECTS)
  : path.join(here, "..", "projects");
const TRASH = path.join(PROJECTS, ".trash");
const AUDIT = path.join(DATA, "audit.jsonl");
const ENGINE = process.env.SHENGKAN_ENGINE || "http://127.0.0.1:8290";

let currentFile = null;
const projectVersions = new WeakMap();

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
    const loaded = projectStore.read(file);
    project = loaded.project;
    projectVersions.set(project, { file, version: loaded.version });
  } catch (e) {
    throw new Error(`项目文件损坏，无法解析：${file}（${e.message}）`);
  }
  currentFile = file;
  return project;
}

function writeProject(project) {
  const source = projectVersions.get(project);
  if (!source) throw new Error("项目没有读取版本，请先读取项目后再保存");
  try {
    const saved = projectStore.write(
      source.file,
      { ...project, updatedAt: new Date().toISOString() },
      source.version
    );
    Object.assign(project, saved.project);
    projectVersions.set(project, { file: source.file, version: saved.version });
  } catch (e) {
    const error = new Error(`写入项目失败：${source.file}（${e.message}）`);
    error.code = e.code;
    throw error;
  }
  return source.file;
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
  read: "只读：列项目、读项目、读台词、查音色和审计",
  edit: "可改：只读 + 建项目/章节/台词/角色/音色 + 拆句预览",
  generate: "可生成：可改 + 生成单句/整章/整本 + 导出音频（默认）",
  full: "完全控制：可生成 + 回收站 + 一键启动软件",
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

function engineErrorMessage(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(engineErrorMessage).filter(Boolean).join("；");
  if (!value || typeof value !== "object") return "";
  const message = engineErrorMessage(value.error) || engineErrorMessage(value.detail) || engineErrorMessage(value.msg);
  const location = Array.isArray(value.loc) ? value.loc.map(String).join(".") : "";
  return message && location ? `${location}：${message}` : message;
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
    throw new Error(engineErrorMessage(data) || `引擎返回 HTTP ${response.status}`);
  }
  return data;
}

async function engineGet(endpoint, timeout = 15000) {
  let response;
  try {
    response = await fetch(`${ENGINE}${endpoint}`, {
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
    throw new Error(engineErrorMessage(data) || `引擎返回 HTTP ${response.status}`);
  }
  return data;
}

const EMOTION_VECTORS = {
  平静: [0, 0, 0, 0, 0, 0, 0, 1],
  高兴: [0.9, 0, 0, 0, 0, 0, 0.2, 0.1],
  愤怒: [0, 1, 0, 0, 0, 0, 0, 0],
  悲伤: [0, 0, 1, 0, 0, 0.3, 0, 0],
  害怕: [0, 0, 0, 1, 0, 0, 0, 0],
  厌恶: [0, 0, 0, 0, 1, 0, 0, 0],
  忧郁: [0, 0, 0.5, 0, 0, 1, 0, 0],
  惊讶: [0, 0, 0, 0, 0, 0, 1, 0],
  克制: [0, 0, 0.2, 0, 0, 0, 0, 0.8],
  试探: [0, 0, 0, 0.2, 0, 0, 0.2, 0.6],
  警惕: [0, 0, 0, 0.4, 0, 0, 0.1, 0.5],
  疲惫: [0, 0, 0.2, 0, 0, 0.5, 0, 0.3],
};

const CAST_COLORS = ["#2f6b57", "#a9763c", "#a94f38", "#465a6b", "#6b7d5e", "#8a6a4f"];

function newCast(name, index) {
  return {
    id: `cast-${Date.now().toString(36)}-${index}`,
    name,
    initial: name.slice(0, 1),
    desc: "待匹配音色",
    voice: "",
    voicePath: "",
    color: CAST_COLORS[index % CAST_COLORS.length],
  };
}

function ensureCasts(project, lines) {
  for (const line of lines) {
    const name = String(line.speaker || "").trim();
    if (!name || name === "旁白" || name === "未知") continue;
    if (project.casts.some((cast) => cast.name === name)) continue;
    project.casts.push(newCast(name, project.casts.length));
  }
}

function pushVoiceHistory(cast) {
  if (!cast.voicePath && !cast.cloudVoice) return cast.voiceHistory || [];
  const entry = {
    name: cast.cloudName || cast.voice || cast.voicePath,
    voicePath: cast.voicePath || "",
    cloudModel: cast.cloudModel || "",
    cloudVoice: cast.cloudVoice || "",
    cloudName: cast.cloudName || "",
    usedAt: new Date().toISOString(),
  };
  return [entry, ...(cast.voiceHistory || [])].slice(0, 12);
}

function findCast(project, key) {
  return project.casts.find((cast) => cast.id === key || cast.name === key);
}

async function buildChapter(project, title, source) {
  const data = await engineCall("/v1/split", { text: source }, 120000);
  const lines = (Array.isArray(data.segments) ? data.segments : []).map((segment, index) => ({
    id: index + 1,
    speaker: segment.speaker || "未知",
    paragraph: segment.paragraph ?? 1,
    text: segment.text,
    emotion: segment.emotion || "平静",
    speed: 1,
    status: "pending",
    audio: "",
  }));
  ensureCasts(project, lines);
  return {
    id: `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    title: title || "未命名章节",
    source,
    lines,
  };
}

function chapterSummary(chapter) {
  return {
    id: chapter.id,
    title: chapter.title,
    lines: chapter.lines.length,
    pending: chapter.lines.filter((line) => line.status !== "done" || !line.audio).length,
    characters: chapter.source.length,
  };
}

const server = new McpServer({ name: "shengkan", version: "0.4.0" });

server.tool(
  "get_permissions",
  "查看当前 MCP 权限级别、可用工具和限制。",
  {},
  async () => {
    const tools = [
      "get_permissions",
      "get_health",
      "list_voices",
      "list_projects",
      "read_project",
      "read_lines",
      "get_audit",
    ];
    if (allowed("edit")) {
      tools.push(
        "create_project",
        "update_project",
        "add_chapter",
        "update_chapter",
        "replace_chapter_lines",
        "add_line",
        "delete_line",
        "update_line",
        "add_cast",
        "update_cast",
        "bind_voice",
        "split_chapter"
      );
    }
    if (allowed("generate")) {
      tools.push("generate_line", "generate_chapter", "generate_project", "export_audio");
    }
    if (allowed("full")) {
      tools.push("trash_project", "restore_project", "open_app", "list_projects(includeTrash=true)");
    }
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
  "get_health",
  "查看声栞引擎是否在线、IndexTTS 版本、模型加载状态和显存。",
  {},
  async () => {
    try {
      return text(await engineGet("/health"));
    } catch (e) {
      return { ...text(e.message), isError: true };
    }
  }
);

server.tool(
  "list_voices",
  "列出本地音色库的参考音频，可按名字、性别、年龄过滤。",
  { q: z.string().optional().describe("搜索关键词") },
  async ({ q }) => {
    try {
      const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
      return text(await engineGet(`/v1/voices${suffix}`));
    } catch (e) {
      return { ...text(e.message), isError: true };
    }
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
  "读取项目标题、settings、章节列表和角色。默认读最近修改的项目。",
  { project: PROJECT_ARG },
  async ({ project }) => {
    const p = readProject(project);
    return text({
      id: p.id,
      title: p.title,
      file: currentFile,
      permission: PERMISSION,
      updatedAt: p.updatedAt,
      settings: p.settings,
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
  "create_project",
  "新建项目，可以直接带章节标题和原文；原文会用规则拆句并自动补旁白和角色。",
  {
    title: z.string().describe("书名或项目名"),
    chapters: z
      .array(
        z.object({
          title: z.string().describe("章节标题"),
          source: z.string().describe("这一章的原文"),
        })
      )
      .optional()
      .describe("初始章节；不填则创建空项目"),
  },
  async ({ title, chapters = [] }) => {
    if (!allowed("edit")) return deny("edit");
    try {
      const id = `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const project = {
        id,
        title: title || "未命名项目",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: { engine: ENGINE },
        casts: [
          {
            id: "cast-narrator",
            name: "旁白",
            initial: "旁",
            desc: "叙述 · 待匹配音色",
            voice: "",
            voicePath: "",
            color: CAST_COLORS[0],
          },
        ],
        chapters: [],
      };

      for (const chapter of chapters) {
        project.chapters.push(await buildChapter(project, chapter.title, chapter.source));
      }

      fs.mkdirSync(PROJECTS, { recursive: true });
      const dir = path.join(PROJECTS, id);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "project.json");
      const saved = projectStore.write(
        file,
        { ...project, updatedAt: new Date().toISOString() },
        null
      );
      Object.assign(project, saved.project);
      projectVersions.set(project, { file, version: saved.version });
      currentFile = file;
      audit("create_project", {
        project: id,
        title: project.title,
        chapters: project.chapters.length,
      });
      return text({
        id,
        title: project.title,
        file,
        casts: project.casts,
        chapters: project.chapters.map(chapterSummary),
      });
    } catch (e) {
      return { ...text(e.message), isError: true };
    }
  }
);

server.tool(
  "update_project",
  "修改项目标题。",
  {
    project: PROJECT_ARG,
    title: z.string().describe("新的项目标题"),
  },
  async ({ project, title }) => {
    if (!allowed("edit")) return deny("edit");
    const p = readProject(project);
    p.title = title;
    writeProject(p);
    audit("update_project", { project: p.id, title });
    return text({ ok: true, id: p.id, title: p.title });
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
  "add_chapter",
  "添加一章。传 source 会用规则拆句并自动补角色；也可以直接传 lines 跳过拆句。",
  {
    project: PROJECT_ARG,
    title: z.string().describe("章节标题"),
    source: z.string().optional().describe("这一章原文；不传 lines 时必填"),
    lines: z
      .array(
        z.object({
          speaker: z.string(),
          text: z.string(),
          emotion: z.string().optional(),
          speed: z.number().optional(),
          paragraph: z.number().optional(),
        })
      )
      .optional()
      .describe("已经拆好的台词；传了就跳过规则拆句"),
    position: z.number().optional().describe("插入位置，0 是最前；不填追加到末尾"),
  },
  async ({ project, title, source, lines, position }) => {
    if (!allowed("edit")) return deny("edit");
    try {
      const p = readProject(project);
      let chapter;
      if (Array.isArray(lines) && lines.length) {
        const chapterLines = lines.map((line, index) => ({
          id: index + 1,
          speaker: String(line.speaker || "未知").trim() || "未知",
          paragraph: line.paragraph ?? 1,
          text: String(line.text || "").trim(),
          emotion: line.emotion || "平静",
          speed: normalizeSpeed(line.speed),
          status: "pending",
          audio: "",
        }));
        ensureCasts(p, chapterLines);
        chapter = {
          id: `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          title: title || "未命名章节",
          source: source || "",
          lines: chapterLines,
        };
      } else {
        if (!source?.trim()) return { ...text("source 和 lines 至少传一个"), isError: true };
        chapter = await buildChapter(p, title, source);
      }

      const at = Math.max(0, Math.min(p.chapters.length, Number(position ?? p.chapters.length)));
      p.chapters.splice(at, 0, chapter);
      writeProject(p);
      audit("add_chapter", {
        project: p.id,
        chapterId: chapter.id,
        title: chapter.title,
        lines: chapter.lines.length,
      });
      return text({ ok: true, chapter: chapterSummary(chapter), casts: p.casts });
    } catch (e) {
      return { ...text(e.message), isError: true };
    }
  }
);

server.tool(
  "update_chapter",
  "修改章节标题或原文。改原文不会自动重拆台词。",
  {
    project: PROJECT_ARG,
    chapterId: z.string(),
    title: z.string().optional(),
    source: z.string().optional(),
  },
  async ({ project, chapterId, title, source }) => {
    if (!allowed("edit")) return deny("edit");
    const p = readProject(project);
    const chapter = p.chapters.find((c) => c.id === chapterId);
    if (!chapter) return { ...text(`章节不存在: ${chapterId}`), isError: true };
    if (title !== undefined) chapter.title = title;
    if (source !== undefined) chapter.source = source;
    writeProject(p);
    audit("update_chapter", { project: p.id, chapterId, title, chars: source?.length });
    return text({ ok: true, chapter: chapterSummary(chapter) });
  }
);

server.tool(
  "replace_chapter_lines",
  "用新台词覆盖整章。会清理被替换台词的旧音频，适合 AI 自己拆句或大改后写入。",
  {
    project: PROJECT_ARG,
    chapterId: z.string(),
    lines: z.array(
      z.object({
        speaker: z.string(),
        text: z.string(),
        emotion: z.string().optional(),
        speed: z.number().optional(),
        paragraph: z.number().optional(),
      })
    ),
  },
  async ({ project, chapterId, lines }) => {
    if (!allowed("edit")) return deny("edit");
    const p = readProject(project);
    const chapter = p.chapters.find((c) => c.id === chapterId);
    if (!chapter) return { ...text(`章节不存在: ${chapterId}`), isError: true };

    const stale = chapter.lines.flatMap((line) => [line.audio, ...(line.audioHistory || [])]);
    chapter.lines = lines.map((line, index) => ({
      id: index + 1,
      speaker: String(line.speaker || "未知").trim() || "未知",
      paragraph: line.paragraph ?? 1,
      text: String(line.text || "").trim(),
      emotion: line.emotion || "平静",
      speed: normalizeSpeed(line.speed),
      status: "pending",
      audio: "",
    }));
    ensureCasts(p, chapter.lines);
    writeProject(p);
    await Promise.allSettled(
      stale
        .filter(Boolean)
        .map((url) => engineCall("/v1/audio-delete", { url }, 10000))
    );
    audit("replace_chapter_lines", {
      project: p.id,
      chapterId,
      staleAudio: stale.length,
      newLines: chapter.lines.length,
    });
    return text({ ok: true, chapter: chapterSummary(chapter), casts: p.casts });
  }
);

server.tool(
  "add_line",
  "在章节里插入一句台词。不填 afterLineId 就追加到末尾。",
  {
    project: PROJECT_ARG,
    chapterId: z.string(),
    speaker: z.string(),
    text: z.string(),
    emotion: z.string().optional(),
    speed: z.number().optional(),
    paragraph: z.number().optional(),
    afterLineId: z.number().optional(),
  },
  async ({ project, chapterId, speaker, text: lineText, emotion, speed, paragraph, afterLineId }) => {
    if (!allowed("edit")) return deny("edit");
    const p = readProject(project);
    const chapter = p.chapters.find((c) => c.id === chapterId);
    if (!chapter) return { ...text(`章节不存在: ${chapterId}`), isError: true };

    const id = Math.max(0, ...chapter.lines.map((line) => line.id)) + 1;
    const line = {
      id,
      speaker: String(speaker || "未知").trim() || "未知",
      paragraph: paragraph ?? 1,
      text: String(lineText || "").trim(),
      emotion: emotion || "平静",
      speed: normalizeSpeed(speed),
      status: "pending",
      audio: "",
    };
    const at = afterLineId
      ? chapter.lines.findIndex((item) => item.id === afterLineId) + 1
      : chapter.lines.length;
    chapter.lines.splice(at > 0 ? at : chapter.lines.length, 0, line);
    ensureCasts(p, [line]);
    writeProject(p);
    audit("add_line", { project: p.id, chapterId, lineId: id, speaker: line.speaker });
    return text({ ok: true, line });
  }
);

server.tool(
  "delete_line",
  "删除一句台词，并清理它的当前音频和历史音频。最后一章至少保留一句。",
  {
    project: PROJECT_ARG,
    chapterId: z.string(),
    lineId: z.number(),
  },
  async ({ project, chapterId, lineId }) => {
    if (!allowed("edit")) return deny("edit");
    const p = readProject(project);
    const chapter = p.chapters.find((c) => c.id === chapterId);
    if (!chapter) return { ...text(`章节不存在: ${chapterId}`), isError: true };
    if (chapter.lines.length <= 1) return { ...text("这一章至少保留一句，不能删除"), isError: true };

    const index = chapter.lines.findIndex((line) => line.id === lineId);
    if (index < 0) return { ...text("台词不存在"), isError: true };
    const [removed] = chapter.lines.splice(index, 1);
    writeProject(p);
    for (const url of [removed.audio, ...(removed.audioHistory || [])].filter(Boolean)) {
      await engineCall("/v1/audio-delete", { url }, 10000).catch(() => {});
    }
    audit("delete_line", { project: p.id, chapterId, lineId, text: removed.text });
    return text({ ok: true, removed });
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
  "add_cast",
  "新增项目角色，可以直接绑定本地或云音色。",
  {
    project: PROJECT_ARG,
    name: z.string(),
    desc: z.string().optional(),
    voicePath: z.string().optional().describe("本地参考音频，相对 voices 或绝对路径"),
    cloudModel: z.string().optional(),
    cloudVoice: z.string().optional(),
    cloudName: z.string().optional(),
    color: z.string().optional(),
  },
  async ({ project, name, desc, voicePath, cloudModel, cloudVoice, cloudName, color }) => {
    if (!allowed("edit")) return deny("edit");
    const p = readProject(project);
    const clean = String(name || "").trim();
    if (!clean) return { ...text("角色名不能为空"), isError: true };
    if (p.casts.some((cast) => cast.name === clean)) {
      return { ...text(`已经有角色「${clean}」`), isError: true };
    }
    const cast = newCast(clean, p.casts.length);
    if (desc) cast.desc = desc;
    if (color) cast.color = color;
    if (voicePath) {
      cast.voicePath = voicePath;
      cast.voice = path.basename(voicePath).replace(/\.wav$/i, "");
    }
    if (cloudVoice || cloudModel) {
      cast.cloudModel = cloudModel || "";
      cast.cloudVoice = cloudVoice || "";
      cast.cloudName = cloudName || cast.name;
      cast.voicePath = "";
      cast.voice = "";
    }
    p.casts.push(cast);
    writeProject(p);
    audit("add_cast", { project: p.id, cast });
    return text({ ok: true, cast });
  }
);

server.tool(
  "update_cast",
  "修改角色描述、颜色或音色绑定。改名会同步台词的 speaker。",
  {
    project: PROJECT_ARG,
    cast: z.string().describe("角色 id 或名字"),
    name: z.string().optional(),
    desc: z.string().optional(),
    voicePath: z.string().optional().describe("本地参考音频；传空字符串表示解绑"),
    cloudModel: z.string().optional(),
    cloudVoice: z.string().optional(),
    cloudName: z.string().optional(),
    color: z.string().optional(),
  },
  async ({ project, cast: key, name, desc, voicePath, cloudModel, cloudVoice, cloudName, color }) => {
    if (!allowed("edit")) return deny("edit");
    const p = readProject(project);
    const cast = findCast(p, key);
    if (!cast) return { ...text(`找不到角色：${key}`), isError: true };

    if (name !== undefined) {
      const clean = String(name).trim();
      if (!clean) return { ...text("角色名不能为空"), isError: true };
      if (clean !== cast.name && p.casts.some((item) => item.name === clean)) {
        return { ...text(`已经有角色「${clean}」`), isError: true };
      }
      const oldName = cast.name;
      if (clean !== oldName) {
        cast.name = clean;
        cast.initial = clean.slice(0, 1);
        for (const chapter of p.chapters) {
          for (const line of chapter.lines) {
            if (line.speaker === oldName) line.speaker = clean;
          }
        }
      }
    }
    if (desc !== undefined) cast.desc = desc;
    if (color !== undefined) cast.color = color;

    const bindLocal = voicePath !== undefined;
    const bindCloud = cloudModel !== undefined || cloudVoice !== undefined;
    if (bindLocal || bindCloud) {
      if (cast.voicePath || cast.cloudVoice) cast.voiceHistory = pushVoiceHistory(cast);
      if (bindLocal) {
        cast.voicePath = voicePath || "";
        cast.voice = voicePath ? path.basename(voicePath).replace(/\.wav$/i, "") : "";
        cast.cloudModel = "";
        cast.cloudVoice = "";
        cast.cloudName = "";
      } else {
        cast.cloudModel = cloudModel || "";
        cast.cloudVoice = cloudVoice || "";
        cast.cloudName = cloudName || cast.cloudName || cast.name;
        cast.voicePath = "";
        cast.voice = "";
      }
    }

    writeProject(p);
    audit("update_cast", { project: p.id, cast: key, after: cast });
    return text({ ok: true, cast });
  }
);

server.tool(
  "bind_voice",
  "给角色绑定本地音色或云音色。绑定新音色会把旧音色写进 voiceHistory。",
  {
    project: PROJECT_ARG,
    cast: z.string().describe("角色 id 或名字"),
    voicePath: z.string().optional().describe("本地参考音频，相对 voices 或绝对路径"),
    cloudModel: z.string().optional(),
    cloudVoice: z.string().optional(),
    cloudName: z.string().optional(),
  },
  async ({ project, cast: key, voicePath, cloudModel, cloudVoice, cloudName }) => {
    if (!allowed("edit")) return deny("edit");
    if (!voicePath && !cloudVoice) {
      return { ...text("voicePath 和 cloudVoice 至少传一个"), isError: true };
    }
    const p = readProject(project);
    const cast = findCast(p, key);
    if (!cast) return { ...text(`找不到角色：${key}`), isError: true };

    cast.voiceHistory = pushVoiceHistory(cast);
    if (voicePath) {
      cast.voicePath = voicePath;
      cast.voice = path.basename(voicePath).replace(/\.wav$/i, "");
      cast.cloudModel = "";
      cast.cloudVoice = "";
      cast.cloudName = "";
    } else {
      cast.cloudModel = cloudModel || "";
      cast.cloudVoice = cloudVoice || "";
      cast.cloudName = cloudName || cast.name;
      cast.voicePath = "";
      cast.voice = "";
    }

    writeProject(p);
    audit("bind_voice", { project: p.id, cast: key, voicePath, cloudModel, cloudVoice });
    return text({ ok: true, cast });
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
      const stale = [];
      if (line.audio) history.push(line.audio);
      while (history.length > 1) {
        const dropped = history.shift();
        if (dropped) stale.push(dropped);
      }
      line.audio = data.url;
      line.audioHistory = history;
      line.status = "done";

      writeProject(p);
      for (const url of stale) {
        engineCall("/v1/audio-delete", { url }, 10000).catch(() => {});
      }
      audit("generate_line", { project: p.id, chapterId, lineId, file: data.file });
      return text({ ok: true, file: data.file, url: data.url });
    } catch (e) {
      return { ...text(e.message), isError: true };
    }
  }
);

server.tool(
  "generate_chapter",
  "为整章待生成或改动的台词生成音频。只支持已绑定本地音色的角色；云音色会跳过并提示。",
  {
    project: PROJECT_ARG,
    chapterId: z.string(),
    mode: z.enum(["pending", "all"]).optional().describe("pending 只跑未生成/改动过的，all 全部重跑"),
    limit: z.number().optional().describe("最多生成几句，默认 20，最大 200"),
  },
  async ({ project, chapterId, mode = "pending", limit = 20 }) => {
    if (!allowed("generate")) return deny("generate");
    const p = readProject(project);
    const chapter = p.chapters.find((c) => c.id === chapterId);
    if (!chapter) return { ...text(`章节不存在: ${chapterId}`), isError: true };
    const max = Math.max(1, Math.min(200, Math.floor(limit)));
    const targets = chapter.lines
      .filter((line) => line.text.trim() && (mode === "all" || line.status !== "done" || !line.audio))
      .slice(0, max);
    if (!targets.length) return text({ ok: true, done: 0, message: "没有待生成的句子" });

    const result = { ok: 0, fail: 0, skipped: 0, errors: [], skippedLines: [] };
    for (const line of targets) {
      const cast = p.casts.find((item) => item.name === line.speaker);
      if (cast?.cloudModel && cast.cloudVoice) {
        result.skipped += 1;
        result.skippedLines.push({ lineId: line.id, speaker: line.speaker, reason: "云音色需要在软件里生成" });
        continue;
      }
      if (!cast?.voicePath) {
        result.skipped += 1;
        result.skippedLines.push({ lineId: line.id, speaker: line.speaker, reason: "没有绑定本地音色" });
        continue;
      }
      try {
        const data = await engineCall("/v1/tts", {
          text: line.text,
          voice: cast.voicePath,
          lang: "ZH",
          speed: normalizeSpeed(line.speed),
          emo_vector: EMOTION_VECTORS[line.emotion] || EMOTION_VECTORS["平静"],
          emo_alpha: 0.85,
        });
        const history = [...(line.audioHistory || [])];
        const stale = [];
        if (line.audio) history.push(line.audio);
        while (history.length > 1) {
          const dropped = history.shift();
          if (dropped) stale.push(dropped);
        }
        line.audio = data.url;
        line.audioHistory = history;
        line.status = "done";
        result.ok += 1;
        writeProject(p);
        for (const url of stale) {
          engineCall("/v1/audio-delete", { url }, 10000).catch(() => {});
        }
      } catch (e) {
        result.fail += 1;
        result.errors.push({ lineId: line.id, error: e.message });
      }
    }

    writeProject(p);
    audit("generate_chapter", {
      project: p.id,
      chapterId,
      ok: result.ok,
      fail: result.fail,
      skipped: result.skipped,
    });
    return text({ ...result, chapterId, total: targets.length });
  }
);

server.tool(
  "generate_project",
  "按章节顺序为整本生成音频。默认最多 50 句，适合一次性跑一小批；云音色会跳过。",
  {
    project: PROJECT_ARG,
    limit: z.number().optional().describe("最多生成几句，默认 50，最大 500"),
    mode: z.enum(["pending", "all"]).optional(),
  },
  async ({ project, limit = 50, mode = "pending" }) => {
    if (!allowed("generate")) return deny("generate");
    const p = readProject(project);
    const max = Math.max(1, Math.min(500, Math.floor(limit)));
    let remaining = max;
    const chapters = [];

    for (const chapter of p.chapters) {
      if (remaining <= 0) break;
      const targets = chapter.lines.filter(
        (line) => line.text.trim() && (mode === "all" || line.status !== "done" || !line.audio)
      );
      if (!targets.length) continue;
      const batch = targets.slice(0, remaining);
      remaining -= batch.length;
      const result = { chapterId: chapter.id, title: chapter.title, ok: 0, fail: 0, skipped: 0 };
      const stale = [];
      for (const line of batch) {
        const cast = p.casts.find((item) => item.name === line.speaker);
        if (cast?.cloudModel && cast.cloudVoice) {
          result.skipped += 1;
          continue;
        }
        if (!cast?.voicePath) {
          result.skipped += 1;
          continue;
        }
        try {
          const data = await engineCall("/v1/tts", {
            text: line.text,
            voice: cast.voicePath,
            lang: "ZH",
            speed: normalizeSpeed(line.speed),
            emo_vector: EMOTION_VECTORS[line.emotion] || EMOTION_VECTORS["平静"],
            emo_alpha: 0.85,
          });
          const history = [...(line.audioHistory || [])];
          if (line.audio) history.push(line.audio);
          while (history.length > 1) {
            const dropped = history.shift();
            if (dropped) stale.push(dropped);
          }
          line.audio = data.url;
          line.audioHistory = history;
          line.status = "done";
          result.ok += 1;
        } catch {
          result.fail += 1;
        }
      }
      writeProject(p);
      for (const url of stale) {
        engineCall("/v1/audio-delete", { url }, 10000).catch(() => {});
      }
      chapters.push(result);
    }

    audit("generate_project", { project: p.id, chapters });
    return text({ chapters, generated: chapters.reduce((sum, c) => sum + c.ok, 0) });
  }
);

server.tool(
  "export_audio",
  "把某一章或整本已生成的音频导出为 WAV、SRT 或分轨 ZIP。",
  {
    project: PROJECT_ARG,
    chapterId: z.string().optional().describe("不填导出整本"),
    outputName: z.string().optional(),
    formats: z
      .array(z.enum(["wav", "srt", "stems"]))
      .optional()
      .describe("默认 wav + srt + stems"),
    loudness: z.number().optional().describe("响度目标，默认 -16 dB"),
    pauses: z.array(z.number()).optional().describe("句间静音秒数，长度比句子少 1"),
  },
  async ({ project, chapterId, outputName, formats, loudness, pauses }) => {
    if (!allowed("generate")) return deny("generate");
    const p = readProject(project);
    const chapter = chapterId ? p.chapters.find((c) => c.id === chapterId) : null;
    if (chapterId && !chapter) return { ...text(`章节不存在: ${chapterId}`), isError: true };
    const source = chapter ? chapter.lines : p.chapters.flatMap((c) => c.lines);
    const usable = source.filter((line) => line.audio && line.text.trim());
    if (!usable.length) return { ...text("没有可导出的音频"), isError: true };

    try {
      const data = await engineCall(
        "/v1/export",
        {
          lines: usable.map((line) => ({
            file: line.audio.split("/").pop(),
            speaker: line.speaker,
            text: line.text,
          })),
          pauses: pauses || [],
          loudness: loudness ?? -16,
          formats: formats || ["wav", "srt", "stems"],
          output_name: outputName || `${p.title}${chapter ? `-${chapter.title}` : "-整本"}`,
        },
        600000
      );
      audit("export_audio", { project: p.id, chapterId, output: data.base, lines: usable.length });
      return text(data);
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

server.tool(
  "trash_project",
  "把项目移进回收站，不会永久删除。需要 full 权限。",
  { project: PROJECT_ARG },
  async ({ project }) => {
    if (!allowed("full")) return deny("full");
    const p = readProject(project);
    const dir = path.dirname(currentFile);
    const trashName = `${path.basename(dir)}__${Date.now()}`;
    fs.mkdirSync(TRASH, { recursive: true });
    fs.renameSync(dir, path.join(TRASH, trashName));
    currentFile = null;
    audit("trash_project", { project: p.id, title: p.title, trashName });
    return text({ ok: true, id: p.id, title: p.title, trashName });
  }
);

server.tool(
  "restore_project",
  "从回收站恢复项目。需要 full 权限。",
  { trashName: z.string().describe("list_projects(includeTrash=true) 返回的 trashName") },
  async ({ trashName }) => {
    if (!allowed("full")) return deny("full");
    const src = path.join(TRASH, path.basename(trashName));
    const file = path.join(src, "project.json");
    if (!fs.existsSync(file)) return { ...text("回收站里没有这个项目"), isError: true };

    fs.mkdirSync(PROJECTS, { recursive: true });
    const base = path.basename(trashName).split("__")[0] || `restored-${Date.now()}`;
    let target = path.join(PROJECTS, base);
    if (fs.existsSync(target)) target = path.join(PROJECTS, `${base}-restored-${Date.now()}`);
    fs.renameSync(src, target);
    const project = readJson(path.join(target, "project.json"));
    currentFile = path.join(target, "project.json");
    audit("restore_project", { project: project.id, title: project.title, dir: target });
    return text({ ok: true, id: project.id, title: project.title, file: currentFile });
  }
);

server.tool(
  "open_app",
  "启动声栞桌面程序（start.bat）。需要 full 权限，仅 Windows。",
  {},
  async () => {
    if (!allowed("full")) return deny("full");
    if (process.platform !== "win32") {
      return { ...text("只有 Windows 支持一键启动 start.bat"), isError: true };
    }
    const root = path.join(here, "..");
    const bat = path.join(root, "start.bat");
    if (!fs.existsSync(bat)) {
      return { ...text(`找不到启动脚本：${bat}`), isError: true };
    }
    const child = spawn("cmd.exe", ["/c", "start", "", bat], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    audit("open_app", { command: bat, pid: child.pid });
    return text({ ok: true, pid: child.pid, command: bat });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
