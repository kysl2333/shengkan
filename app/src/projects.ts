import type { EngineConfig } from "./config";

export interface ProjectLine {
  id: number;
  speaker: string;
  text: string;
  stage?: string;
  emotion: string;
  speed: string;
  status: "done" | "dirty" | "pending";
  audio?: string;
  audioHistory?: string[];
  note?: string;
}

export interface ProjectCast {
  id: string;
  name: string;
  initial: string;
  desc: string;
  voice: string;
  voicePath: string;
  color: string;
  cloudModel?: string;
  cloudVoice?: string;
  cloudName?: string;
}

export interface ProjectChapter {
  id: string;
  title: string;
  source: string;
  lines: ProjectLine[];
}

export interface Project {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  settings: Record<string, string>;
  casts: ProjectCast[];
  chapters: ProjectChapter[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  chapters: number;
  lines: number;
  done: number;
  percent: number;
  updatedAt: string;
  dir?: string;
}

export interface TrashSummary extends ProjectSummary {
  trashName: string;
  deletedAt: string;
}

export function castVoiceLabel(cast: ProjectCast) {
  if (cast.cloudName || cast.cloudVoice) {
    return `云 · ${cast.cloudName || cast.voice || "已绑定"}`;
  }
  if (cast.voicePath) return cast.voice || cast.voicePath;
  return "未配音";
}

interface ProjectsBridge {
  list: () => Promise<ProjectSummary[]>;
  load: (id: string) => Promise<Project>;
  save: (project: Project) => Promise<ProjectSummary>;
  create: (title: string) => Promise<Project>;
  trash: (id: string) => Promise<{ ok: boolean; trashName: string }>;
  trashList: () => Promise<TrashSummary[]>;
  restore: (trashName: string) => Promise<ProjectSummary>;
  deleteForever: (trashName: string) => Promise<{ ok: boolean }>;
  root: () => Promise<string>;
}

declare global {
  interface Window {
    shengkan?: {
      version: string;
      platform: string;
      projects: ProjectsBridge;
      config: {
        get: () => Promise<EngineConfig>;
        set: (cfg: EngineConfig) => Promise<EngineConfig>;
      };
      ai: {
        get: () => Promise<import("./ai").AiConfig>;
        set: (cfg: import("./ai").AiConfig) => Promise<import("./ai").AiConfig>;
        test: () => Promise<{ ok: boolean; ms: number; model: string }>;
        defaults: () => Promise<{ chapter: string; annotate: string }>;
        detectChapters: (text: string) => Promise<import("./ai").AiChapterMark[]>;
        cancel: () => Promise<boolean>;
        annotate: (
          lines: import("./ai").AnnotateInput[],
          casts: string[],
          startBatch?: number
        ) => Promise<import("./ai").AnnotateResult>;
        extractCasts: (text: string) => Promise<import("./ai").ExtractedCast[]>;
        onProgress: (cb: (p: import("./ai").AiProgress) => void) => () => void;
      };
      log: {
        write: (scope: string, message: string, data?: unknown) => void;
        info: () => Promise<{ file: string; size: number }>;
        open: () => Promise<string>;
      };
      cloud: {
        list: () => Promise<import("./cloud").CloudVoice[]>;
        tts: (payload: import("./cloud").CloudTTSPayload) => Promise<{ file: string; url: string }>;
        designPreview: (payload: {
          prompt?: string;
          description?: string;
          previewText?: string;
          name?: string;
        }) => Promise<import("./cloud").CloudDesignPreview>;
        saveDesign: (payload: {
          tempId: string;
          name: string;
          description: string;
          gender?: string;
          age?: string;
        }) => Promise<import("./cloud").CloudVoice>;
        materialize: (id: string) => Promise<import("./cloud").CloudVoice>;
        remove: (id: string) => Promise<{ ok: boolean; moved: string }>;
        update: (
          id: string,
          payload: { name?: string; desc?: string; gender?: string; age?: string }
        ) => Promise<import("./cloud").CloudVoice>;
      };
    };
  }
}

export function ipcAvailable() {
  return typeof window !== "undefined" && !!window.shengkan?.projects;
}

function fallbackProject(): Project {
  return {
    id: "local-empty",
    title: "未命名项目",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: { engine: "http://127.0.0.1:8290" },
    casts: [],
    chapters: [],
  };
}

function toSummary(p: Project): ProjectSummary {
  const lines = p.chapters.flatMap((c) => c.lines);
  const done = lines.filter((l) => l.status === "done" && l.audio).length;
  return {
    id: p.id,
    title: p.title,
    chapters: p.chapters.length,
    lines: lines.length,
    done,
    percent: lines.length ? Math.round((done / lines.length) * 100) : 0,
    updatedAt: p.updatedAt,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (ipcAvailable()) return window.shengkan!.projects.list();
  return [toSummary(fallbackProject())];
}

export async function loadProject(id: string): Promise<Project> {
  if (ipcAvailable()) return window.shengkan!.projects.load(id);
  const raw = localStorage.getItem("shengkan:project");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Project;
      if (parsed.id === id) return parsed;
    } catch {
      /* ignore */
    }
  }
  return fallbackProject();
}

export async function saveProject(project: Project): Promise<ProjectSummary> {
  if (ipcAvailable()) return window.shengkan!.projects.save(project);
  project.updatedAt = new Date().toISOString();
  localStorage.setItem("shengkan:project", JSON.stringify(project));
  return toSummary(project);
}

export async function createProject(title: string): Promise<Project> {
  if (ipcAvailable()) return window.shengkan!.projects.create(title);
  const project: Project = {
    ...fallbackProject(),
    id: `p-${Date.now().toString(36)}`,
    title: title || "未命名项目",
    chapters: [],
    casts: [],
  };
  localStorage.setItem("shengkan:project", JSON.stringify(project));
  return project;
}

const TRASH_KEY = "shengkan:trash";

function readTrash(): { project: Project; deletedAt: string }[] {
  try {
    return JSON.parse(localStorage.getItem(TRASH_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeTrash(items: { project: Project; deletedAt: string }[]) {
  localStorage.setItem(TRASH_KEY, JSON.stringify(items));
}

export async function trashProject(id: string): Promise<{ ok: boolean; trashName: string }> {
  if (ipcAvailable()) return window.shengkan!.projects.trash(id);
  const raw = localStorage.getItem("shengkan:project");
  if (!raw) throw new Error("项目不存在");
  const project = JSON.parse(raw) as Project;
  if (project.id !== id) throw new Error("项目不存在");
  const items = readTrash();
  items.push({ project, deletedAt: new Date().toISOString() });
  writeTrash(items);
  localStorage.removeItem("shengkan:project");
  return { ok: true, trashName: id };
}

export async function listTrash(): Promise<TrashSummary[]> {
  if (ipcAvailable()) return window.shengkan!.projects.trashList();
  return readTrash().map(({ project, deletedAt }) => ({
    ...toSummary(project),
    trashName: project.id,
    deletedAt,
  }));
}

export async function restoreProject(trashName: string): Promise<ProjectSummary> {
  if (ipcAvailable()) return window.shengkan!.projects.restore(trashName);
  const items = readTrash();
  const item = items.find((x) => x.project.id === trashName);
  if (!item) throw new Error("回收站里没有这个项目");
  localStorage.setItem("shengkan:project", JSON.stringify(item.project));
  writeTrash(items.filter((x) => x.project.id !== trashName));
  return toSummary(item.project);
}

export async function deleteForever(trashName: string): Promise<{ ok: boolean }> {
  if (ipcAvailable()) return window.shengkan!.projects.deleteForever(trashName);
  writeTrash(readTrash().filter((x) => x.project.id !== trashName));
  return { ok: true };
}
