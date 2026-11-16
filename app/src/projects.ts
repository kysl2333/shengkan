import type { EngineConfig } from "./config";

export interface ProjectLine {
  id: number;
  speaker: string;
  text: string;
  stage?: string;
  paragraph?: number;
  emotion: string;
  speed: number;
  status: "done" | "dirty" | "pending";
  audio?: string;
  audioHistory?: string[];
  note?: string;
}

export interface CastVoiceHistory {
  name: string;
  voicePath?: string;
  cloudModel?: string;
  cloudVoice?: string;
  cloudName?: string;
  usedAt: string;
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
  voiceHistory?: CastVoiceHistory[];
}

export interface ProjectChapter {
  id: string;
  title: string;
  source: string;
  lines: ProjectLine[];
}

export interface Project {
  __storageVersion?: string;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  settings: Record<string, string>;
  casts: ProjectCast[];
  chapters: ProjectChapter[];
}

export interface ProjectSummary {
  __storageVersion?: string;
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
  size?: number;
}

export interface AppPaths {
  userData: string;
  documents: string;
  projects: string;
  voices: string;
  outputs: string;
  config: string;
  logs: string;
  engineLog: string;
}

export type ProjectAction = "rebuild" | "annotate";

export function castVoiceLabel(cast: ProjectCast) {
  if (cast.cloudName || cast.cloudVoice) {
    return `云音色 · ${cast.cloudName || cast.voice || "已绑定"}`;
  }
  if (cast.voicePath) return cast.voice || cast.voicePath;
  return "未配音";
}

export function pushCastVoiceHistory(cast: ProjectCast): CastVoiceHistory[] {
  const existing = cast.voiceHistory ?? [];
  const current = cast.cloudVoice || cast.cloudName
    ? {
        name: cast.cloudName || cast.voice || "云音色",
        cloudModel: cast.cloudModel,
        cloudVoice: cast.cloudVoice,
        cloudName: cast.cloudName,
      }
    : cast.voicePath
      ? { name: cast.voice || cast.voicePath, voicePath: cast.voicePath }
      : null;
  if (!current) return existing;
  const last = existing[0];
  if (
    last &&
    last.voicePath === current.voicePath &&
    last.cloudVoice === current.cloudVoice &&
    last.name === current.name
  ) {
    return existing;
  }
  return [{ ...current, usedAt: new Date().toISOString() }, ...existing].slice(0, 12);
}

const SPEED_LABELS: Record<string, number> = {
  很慢: 0.6,
  慢: 0.8,
  稍慢: 0.9,
  正常: 1,
  快: 1.2,
};

export function normalizeSpeed(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.min(2, Math.max(0.5, numeric));
  return SPEED_LABELS[String(value || "").trim()] ?? 1;
}

function normalizeProject(project: Project): Project {
  const seenCastIds = new Set<string>();
  const casts = (project.casts ?? []).map((cast, index) => {
    const base = cast.id || `cast-${index + 1}`;
    const id = seenCastIds.has(base) ? `${base}-${index + 1}` : base;
    seenCastIds.add(id);
    return { ...cast, id };
  });

  return {
    ...project,
    casts,
    chapters: (project.chapters ?? []).map((chapter) => ({
      ...chapter,
      lines: (chapter.lines ?? []).map((line) => ({
        ...line,
        speed: normalizeSpeed(line.speed),
      })),
    })),
  };
}

export function newCastId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `cast-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `cast-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
  emptyTrash: () => Promise<{ ok: boolean; count: number; failed: number }>;
  root: () => Promise<string>;
}

declare global {
  interface Window {
    shengkan?: {
      version: string;
      platform: string;
      projects: ProjectsBridge;
      app: {
        paths: () => Promise<AppPaths>;
      };
      config: {
        get: () => Promise<EngineConfig>;
        set: (cfg: EngineConfig) => Promise<EngineConfig>;
      };
      ai: {
        get: () => Promise<import("./ai").AiConfig>;
        set: (cfg: import("./ai").AiConfig) => Promise<import("./ai").AiConfig>;
        path: () => Promise<string>;
        test: () => Promise<{ ok: boolean; ms: number; model: string; provider?: string }>;
        listModels: (payload: {
          baseUrl: string;
          apiKey: string;
          provider?: string;
          kind: "text" | "tts";
        }) => Promise<import("./ai").ModelListResult>;
        defaults: () => Promise<{ chapter: string; annotate: string }>;
        detectChapters: (text: string, toc?: string[], workTitle?: string) => Promise<import("./ai").AiChapterResult>;
        cancel: () => Promise<boolean>;
        annotate: (
          lines: import("./ai").AnnotateInput[],
          casts: string[],
          startBatch?: number,
          context?: string
        ) => Promise<import("./ai").AnnotateResult>;
        extractCasts: (text: string, context?: string) => Promise<import("./ai").ExtractedCastResult>;
        onProgress: (cb: (p: import("./ai").AiProgress) => void) => () => void;
      };
      log: {
        write: (scope: string, message: string, data?: unknown) => void;
        info: () => Promise<import("./log").LogInfo>;
        clear: () => Promise<{ ok: boolean; freed: number; info: import("./log").LogInfo }>;
        open: () => Promise<string>;
      };
      shell: {
        reveal: (file: string) => Promise<{ ok: boolean }>;
      };
      cloud: {
        list: () => Promise<import("./cloud").CloudVoice[]>;
        providers: () => Promise<import("./cloud").CloudProvider[]>;
        tts: (payload: import("./cloud").CloudTTSPayload) => Promise<{ file: string; url: string }>;
        sample: (
          id: string,
          options?: { refresh?: boolean }
        ) => Promise<import("./cloud").CloudSample>;
        designPreview: (payload: {
          prompt?: string;
          description?: string;
          previewText?: string;
          name?: string;
          provider?: string;
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

export async function revealFile(file: string) {
  const bridge = window.shengkan?.shell;
  if (!bridge) throw new Error("打开文件夹只在桌面版可用");
  return bridge.reveal(file);
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

interface SaveSession {
  version?: string;
  accepted: Set<string | undefined>;
  tail: Promise<unknown>;
  error?: Error;
}

const saveSessions = new Map<string, SaveSession>();

function beginSaveSession(project: Project) {
  saveSessions.set(project.id, {
    version: project.__storageVersion,
    accepted: new Set([project.__storageVersion]),
    tail: Promise.resolve(),
  });
  return project;
}

export async function loadProject(id: string): Promise<Project> {
  if (ipcAvailable()) return beginSaveSession(normalizeProject(await window.shengkan!.projects.load(id)));
  const raw = localStorage.getItem("shengkan:project");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Project;
      if (parsed.id === id) return normalizeProject(parsed);
    } catch {
      /* ignore */
    }
  }
  return normalizeProject(fallbackProject());
}

export async function saveProject(project: Project): Promise<ProjectSummary> {
  if (ipcAvailable()) {
    if (!saveSessions.has(project.id)) beginSaveSession(project);
    const session = saveSessions.get(project.id)!;
    const snapshot = JSON.parse(JSON.stringify(project)) as Project;
    const task = session.tail.then(async () => {
      if (session.error) throw session.error;
      if (saveSessions.get(project.id) !== session || !session.accepted.has(snapshot.__storageVersion)) {
        throw new Error("PROJECT_CONFLICT 项目会话已变化，请保留草稿并重新载入");
      }
      try {
        const result = await window.shengkan!.projects.save({ ...snapshot, __storageVersion: session.version });
        session.version = result.__storageVersion ?? session.version;
        session.accepted.add(session.version);
        return result;
      } catch (error) {
        session.error = error instanceof Error ? error : new Error(String(error));
        throw session.error;
      }
    });
    session.tail = task.catch(() => {});
    return task;
  }
  project.updatedAt = new Date().toISOString();
  localStorage.setItem("shengkan:project", JSON.stringify(project));
  return toSummary(project);
}

export async function createProject(title: string): Promise<Project> {
  if (ipcAvailable()) return beginSaveSession(await window.shengkan!.projects.create(title));
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

export async function emptyTrash(): Promise<{ ok: boolean; count: number; failed: number }> {
  if (ipcAvailable()) return window.shengkan!.projects.emptyTrash();
  writeTrash([]);
  return { ok: true, count: 0, failed: 0 };
}

export async function getAppPaths(): Promise<AppPaths | null> {
  if (ipcAvailable()) return window.shengkan!.app.paths();
  return null;
}
