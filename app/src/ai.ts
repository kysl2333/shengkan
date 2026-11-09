export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  autoChapter: boolean;
  prompts?: {
    chapter?: string;
    annotate?: string;
  };
}

export interface AiChapterMark {
  title: string;
  index: number;
}

export interface AiProgress {
  done: number;
  total: number;
  message: string;
}

export interface AnnotateInput {
  id: number;
  speaker: string;
  text: string;
}

export interface AnnotateChange {
  id: number;
  speaker: string;
  emotion: string;
  speed: string;
}

export interface AnnotateResult {
  changes: AnnotateChange[];
  cancelled: boolean;
  nextBatch: number;
}

export interface ExtractedCast {
  name: string;
  gender: string;
  age: string;
  desc: string;
}

const KEY = "shengkan:ai";
const DEFAULTS: AiConfig = {
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.6-flash",
  apiKey: "",
  autoChapter: true,
};

function bridge() {
  return typeof window !== "undefined" ? window.shengkan?.ai : undefined;
}

export async function getAiConfig(): Promise<AiConfig> {
  const b = bridge();
  if (b) return b.get();
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setAiConfig(cfg: AiConfig): Promise<AiConfig> {
  const b = bridge();
  if (b) return b.set(cfg);
  localStorage.setItem(KEY, JSON.stringify(cfg));
  return cfg;
}

export async function testAi(): Promise<{ ok: boolean; ms: number; model: string }> {
  const b = bridge();
  if (b) return b.test();
  throw new Error("AI 配置只在桌面版可用");
}

export async function getDefaultPrompts(): Promise<{ chapter: string; annotate: string }> {
  const b = bridge();
  if (b) return b.defaults();
  return { chapter: "", annotate: "" };
}

export function onAiProgress(cb: (p: AiProgress) => void) {
  return bridge()?.onProgress(cb) ?? (() => {});
}

export async function cancelAi(): Promise<boolean> {
  return bridge()?.cancel() ?? false;
}

export async function annotateLines(
  lines: AnnotateInput[],
  casts: string[],
  startBatch = 0
): Promise<AnnotateResult> {
  const b = bridge();
  if (!b) throw new Error("AI 标注只在桌面版可用");
  return b.annotate(lines, casts, startBatch);
}

export async function extractCasts(text: string): Promise<ExtractedCast[]> {
  const b = bridge();
  if (!b) throw new Error("AI 角色分析只在桌面版可用");
  return b.extractCasts(text);
}

export async function detectChapters(text: string): Promise<AiChapterMark[]> {
  const b = bridge();
  if (b) return b.detectChapters(text);

  const cfg = await getAiConfig();
  if (!cfg.apiKey) throw new Error("还没有配置 API Key");
  const r = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": cfg.apiKey,
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      max_completion_tokens: 16384,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      messages: [
        {
          role: "system",
          content:
            '你是小说章节识别器。找出每章正文开头的原样片段（20-60字）。只返回 JSON：{"chapters":[{"title":"...","start":"..."}]}',
        },
        { role: "user", content: text },
      ],
    }),
  });
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  const marks: AiChapterMark[] = [];
  for (const item of parsed.chapters || []) {
    const index = text.indexOf(String(item.start || ""));
    if (item.title && index >= 0) marks.push({ title: item.title, index });
  }
  if (!marks.length) throw new Error("AI 没有识别出章节");
  return marks;
}
