export interface ImportedChapter {
  title: string;
  body: string;
}

export interface ImportedBook {
  title: string;
  chapters: ImportedChapter[];
  text: string;
  format: "epub" | "txt" | "md" | "docx" | "paste";
  tocCount?: number;
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
  /^(制作信息|简介|目录|版权|封面|扉页|插图|插画|作者|登场人物|人物介绍|主要人物|角色介绍|译者|出版社|前言|序言|后记|\d+|P\d+)/i;

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

const ALLOWED_APPELLATIONS = new Set([
  "妈妈", "爸爸", "哥哥", "姐姐", "弟弟", "妹妹", "叔叔", "阿姨", "爷爷", "奶奶",
  "外婆", "外公", "舅舅", "舅妈", "姑姑", "姑父", "姨妈", "姨父", "师父", "师傅",
  "老师", "医生", "护士", "老板", "司机", "服务员", "店员", "警察", "军官", "士兵",
  "管家", "女仆", "执事", "同学", "学长", "学姐", "学弟", "学妹",
]);

const BAD_START = new Set(
  "他她它我你您咱这那其此谁每各某有没不别要会能可是在把被让给对从到跟与为以而但却并且或者所因虽如若由忽突又还也都就才只很太更最再已曾正刚快慢轻重低大小多少好坏看听想说问答喊笑走跑站坐躺拿放伸转抬压装帮替叫变完起停回过出进上下拉来去声音话语心眼嘴脸头身口脚日月天年时分秒含随神先见作后面人己哑指一道".split("")
);

const BAD_END = new Set(
  "的了着得地过来去下上里外中前后边旁处时候刻然么呢吧啊呀哦嗯声音话语心眼嘴脸头身口脚笔神住惑愣瞪愿笑道问喊回走站坐看听想起开关停成变完掉好坏快慢轻重高低大小多少一二三四五六七八九十百千万两几个位名条只件张次遍点分秒天年月日时主茬步先带装跟含随他她它我你您咱们没又就苦洞解吼常台".split("")
);

export function isRealCharacter(name: string) {
  const clean = String(name || "").trim();
  if (!clean) return false;
  if (NON_CHARACTER.test(clean)) return false;
  if (/^\d+$/.test(clean)) return false;
  if (/^[A-Za-z][A-Za-z .'-]{1,20}$/.test(clean)) return true;
  if (!/^[\u4e00-\u9fa5]{2,6}$/.test(clean)) return false;
  if (ALLOWED_APPELLATIONS.has(clean)) return true;
  if (BAD_START.has(clean[0])) return false;
  if (BAD_END.has(clean[clean.length - 1])) return false;
  if (clean[0] === clean[1] && !ALLOWED_APPELLATIONS.has(clean)) return false;
  return true;
}

export function refineSpeakers<T extends { speaker: string }>(
  lines: T[],
  knownNames: Iterable<string> = [],
  minCount = 2
) {
  const keep = new Set<string>(["旁白", "未知"]);
  for (const name of knownNames) {
    if (isRealCharacter(name)) keep.add(name);
  }

  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.speaker === "旁白" || line.speaker === "未知") continue;
    counts.set(line.speaker, (counts.get(line.speaker) || 0) + 1);
  }

  for (const line of lines) {
    if (line.speaker === "旁白" || line.speaker === "未知") continue;
    const name = line.speaker;
    const trusted = keep.has(name) || isRealCharacter(name);
    const enough = (counts.get(name) || 0) >= minCount;
    if (!trusted || (!keep.has(name) && !enough)) {
      line.speaker = "未知";
    }
  }
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
