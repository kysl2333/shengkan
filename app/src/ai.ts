export interface AiConfig {
  provider?: "mimo" | "qwen" | "deepseek" | "custom";
  baseUrl: string;
  model: string;
  apiKey: string;
  autoChapter: boolean;
  cloudProviders?: {
    mimo?: boolean;
  };
  customTts?: {
    enabled?: boolean;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    voice?: string;
  };
  mimoTts?: {
    baseUrl?: string;
    apiKey?: string;
  };
  prompts?: {
    chapter?: string;
    annotate?: string;
  };
}

export interface AiUsage {
  input: number;
  output: number;
  total: number;
  cached: number;
}

export const emptyAiUsage = (): AiUsage => ({ input: 0, output: 0, total: 0, cached: 0 });

export function addAiUsage(a: AiUsage, b?: AiUsage | null): AiUsage {
  if (!b) return a;
  return {
    input: a.input + (b.input || 0),
    output: a.output + (b.output || 0),
    total: a.total + (b.total || 0),
    cached: a.cached + (b.cached || 0),
  };
}

export interface AiChapterMark {
  title: string;
  index: number;
}

export interface AiChapterResult {
  marks: AiChapterMark[];
  usage: AiUsage;
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
  speed: number;
}

export interface AnnotateResult {
  changes: AnnotateChange[];
  cancelled: boolean;
  nextBatch: number;
  usage: AiUsage;
}

export interface ExtractedCast {
  name: string;
  gender: string;
  age: string;
  desc: string;
}

export interface ExtractedCastResult {
  casts: ExtractedCast[];
  usage: AiUsage;
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

export async function testAi(): Promise<{ ok: boolean; ms: number; model: string; provider?: string }> {
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

export async function extractCasts(text: string): Promise<ExtractedCastResult> {
  const b = bridge();
  if (!b) throw new Error("AI 角色分析只在桌面版可用");
  return b.extractCasts(text);
}

export async function detectChapters(text: string, toc: string[] = []): Promise<AiChapterResult> {
  const b = bridge();
  if (b) return b.detectChapters(text, toc);

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
            '你是小说章节识别器。找出每章正文开头的原样片段（20-60字）。只识别明确的章节标题，不要按纯数字、页码或小节切分。只返回 JSON：{"chapters":[{"title":"...","start":"..."}]}',
        },
        {
          role: "user",
          content: toc.length
            ? `出版社目录（优先按这些标题在正文定位，不要新增目录外章节）：\n${toc.slice(0, 120).join("\n")}\n\n${text}`
            : text,
        },
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
  const usage = data.usage || {};
  return {
    marks,
    usage: {
      input: Number(usage.prompt_tokens || 0),
      output: Number(usage.completion_tokens || 0),
      total: Number(usage.total_tokens || 0) || Number(usage.prompt_tokens || 0) + Number(usage.completion_tokens || 0),
      cached: Number(usage.prompt_tokens_details?.cached_tokens || 0),
    },
  };
}
