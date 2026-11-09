export interface ImportedChapter {
  title: string;
  body: string;
}

export interface ImportedBook {
  title: string;
  chapters: ImportedChapter[];
  text: string;
  format: "epub" | "txt" | "md" | "paste";
}

export interface AiChapterMark {
  title: string;
  index: number;
}

export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    /* 不是 UTF-8，继续试 GBK */
  }

  try {
    const gbk = new TextDecoder("gbk").decode(bytes);
    if (!gbk.includes("\uFFFD")) return gbk;
  } catch {
    /* 当前环境没有 GBK 解码器 */
  }

  return new TextDecoder("utf-8").decode(bytes);
}

const TITLE_PATTERNS = [
  /^第[0-9零〇一二三四五六七八九十百千万两]+[章回节卷部篇集][\s:：、.．\-—]*(.*)$/,
  /^(序章|楔子|引子|前言|序言|后记|尾声|终章|番外(?:篇)?)[\s:：、.．\-—]*(.*)$/,
  /^(chapter|part)\s+[0-9ivxlcdm]+[\s:：、.．\-—]*(.*)$/i,
];

function looksLikeTitle(line: string) {
  if (!line || line.length > 60) return false;
  if (/[。，；：]$/.test(line)) return false;
  return TITLE_PATTERNS.some((re) => re.test(line));
}

export function splitChaptersRule(text: string, fallbackTitle = "全文"): ImportedChapter[] {
  const source = text.replace(/\r\n?/g, "\n").trim();
  if (!source) return [];

  const lines = source.split("\n");
  const marks: { line: number; title: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!looksLikeTitle(line)) continue;
    marks.push({ line: i, title: line });
  }

  if (marks.length < 2 && !(marks.length === 1 && marks[0].line <= 3)) {
    return [{ title: fallbackTitle, body: source }];
  }

  const chapters: ImportedChapter[] = [];
  if (marks[0].line > 0) {
    const head = lines.slice(0, marks[0].line).join("\n").trim();
    if (head.length > 40) chapters.push({ title: "开篇", body: head });
  }

  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].line;
    const end = i + 1 < marks.length ? marks[i + 1].line : lines.length;
    const body = lines.slice(start + 1, end).join("\n").trim();
    if (body.length < 2) continue;
    chapters.push({ title: marks[i].title, body });
  }

  return chapters.length ? chapters : [{ title: fallbackTitle, body: source }];
}

function findTitleStart(text: string, title: string, bodyIndex: number) {
  const from = Math.max(0, bodyIndex - 600);
  const windowText = text.slice(from, bodyIndex + 80);
  const local = windowText.lastIndexOf(title);
  if (local < 0) return -1;
  const absolute = from + local;
  const lineStart = text.lastIndexOf("\n", absolute - 1) + 1;
  const prefix = text.slice(lineStart, absolute).trim();
  return prefix ? -1 : lineStart;
}

const SKIP_AI_CHAPTER =
  /^(制作信息|简介|目录|版权|封面|扉页|插图|插画|作者|登场人物|人物介绍|主要人物|角色介绍|译者|出版社|前言|序言|后记)/;

export function applyAiChapters(text: string, marks: AiChapterMark[]): ImportedChapter[] {
  const source = text.replace(/\r\n?/g, "\n");
  const usable = marks.filter(
    (m) => m.index >= 0 && m.index < source.length && !SKIP_AI_CHAPTER.test(m.title.trim())
  );
  const sourceMarks = usable.length ? usable : marks;

  const sorted = [...sourceMarks]
    .filter((m) => m.index >= 0 && m.index < source.length)
    .sort((a, b) => a.index - b.index);

  const starts = sorted.map((m) => {
    const titleStart = findTitleStart(source, m.title, m.index);
    return titleStart >= 0 && m.index - titleStart < 600 ? titleStart : m.index;
  });

  const chapters: ImportedChapter[] = [];
  if (starts[0] > 0) {
    const head = source.slice(0, starts[0]).trim();
    if (head.length > 40) chapters.push({ title: "开篇", body: head });
  }

  sorted.forEach((mark, i) => {
    const end = i + 1 < sorted.length ? starts[i + 1] : source.length;
    let body = source.slice(starts[i], end).trim();
    if (body.startsWith(mark.title)) body = body.slice(mark.title.length).trim();
    if (body.length < 2 && chapters.length > 0) return;
    chapters.push({ title: mark.title || `第 ${i + 1} 章`, body });
  });

  return chapters;
}

export function estimateSentences(text: string) {
  const parts = text.split(/[。！？!?…]+/).filter((s) => s.trim().length > 1);
  return parts.length || Math.round(text.length / 30);
}

export function chaptersFromText(text: string, title = "全文"): ImportedChapter[] {
  return splitChaptersRule(text, title);
}

const NON_CHARACTER =
  /^(作者|插画|插图|制作|制作信息|简介|目录|译者|翻译|出版社|编辑|责编|校对|监修|原案|漫画|动画|声优|CV|封面|书名|扉页|版权|登场|登场人物|人物|人物介绍|主要人物|角色介绍|序言|前言|后记|未知|旁白)$/i;

const BAD_NAME_CHARS = /[的了着是以为会能要把被让使对向从到不没很太都就才又再还也但因而所说问答喊笑称命措辞改变导将此们]/;

export function isRealCharacter(name: string) {
  const clean = String(name || "").trim();
  if (!clean) return false;
  if (NON_CHARACTER.test(clean)) return false;
  if (/^\d+$/.test(clean)) return false;
  if (clean.length < 2 || clean.length > 8) return false;
  if (BAD_NAME_CHARS.test(clean)) return false;
  return true;
}

export function mergeShortChapters(chapters: ImportedChapter[], minChars = 800): ImportedChapter[] {
  const out: ImportedChapter[] = [];
  for (const chapter of chapters) {
    if (chapter.body.length < minChars && out.length) {
      const prev = out[out.length - 1];
      prev.body = `${prev.body}\n\n${chapter.title}\n\n${chapter.body}`.trim();
    } else {
      out.push({ ...chapter });
    }
  }
  return out;
}
