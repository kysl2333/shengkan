const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULTS = {
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.6-flash",
  apiKey: "",
  autoChapter: true,
  prompts: {
    chapter: "",
    annotate: "",
  },
};

const CHUNK_CHARS = 150000;
const TIMEOUT_MS = 300000;

let detectAbort = null;

function configFile() {
  return path.join(app.getPath("userData"), "ai.json");
}

function readAiConfig() {
  let saved = {};
  try {
    const raw = fs.readFileSync(configFile(), "utf8").replace(/^\uFEFF/, "");
    saved = JSON.parse(raw);
  } catch {
    /* 首次运行还没有配置 */
  }
  return {
    ...DEFAULTS,
    ...saved,
    prompts: { ...DEFAULTS.prompts, ...(saved.prompts || {}) },
    apiKey: saved.apiKey || process.env.MIMO_API_KEY || "",
  };
}

function writeAiConfig(cfg) {
  const next = { ...readAiConfig(), ...cfg };
  next.prompts = { ...DEFAULTS.prompts, ...(cfg.prompts || next.prompts || {}) };
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function normalizeBase(url) {
  return String(url || DEFAULTS.baseUrl).trim().replace(/\/+$/, "");
}

async function chatJSON(messages, options = {}) {
  const cfg = readAiConfig();
  if (!cfg.apiKey) {
    throw new Error("还没有配置 MiMo API Key，请到设置 → AI 服务里填写");
  }

  const body = {
    model: cfg.model,
    messages,
    temperature: options.temperature ?? 0.1,
    max_completion_tokens: options.maxTokens ?? 16384,
    stream: false,
    response_format: { type: "json_object" },
    // 分章/标注是结构化任务，关掉思考更快、更省 token，也避免 content 被思考吃光
    thinking: { type: options.thinking ? "enabled" : "disabled" },
  };

  const timeout = AbortSignal.timeout(options.timeout ?? TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  const r = await fetch(`${normalizeBase(cfg.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": cfg.apiKey,
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  const raw = await r.text();
  if (!r.ok) {
    let detail = raw.slice(0, 400);
    try {
      detail = JSON.parse(raw)?.error?.message || detail;
    } catch {
      /* 保留原始文本 */
    }
    throw new Error(`MiMo 请求失败 HTTP ${r.status}：${detail}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("MiMo 返回的不是 JSON");
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("MiMo 没有返回内容");

  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return { data: JSON.parse(cleaned), usage: data.usage };
  } catch {
    throw new Error(`模型输出不是合法 JSON：${cleaned.slice(0, 200)}`);
  }
}

function splitChunks(text) {
  if (text.length <= CHUNK_CHARS) return [{ text, offset: 0 }];

  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const lineEnd = text.indexOf("\n", end);
      if (lineEnd > -1 && lineEnd - end < 2000) end = lineEnd + 1;
    }
    chunks.push({ text: text.slice(offset, end), offset });
    offset = end;
  }
  return chunks;
}

const SYSTEM_PROMPT = `你是小说章节识别器。用户给你一段小说原文，你找出每一章的起始位置。

规则：
1. 只识别「章」级结构：第X章、第X回、Chapter X、序章、终章、番外、卷首。
2. 不要把卷内小节、场景标题、人物介绍、目录条目单独算一章。
3. 纯数字 1、2、3 如果是全书的大章编号可以保留；如果只是小节，合并到所属章节。
4. 跳过版权页、目录、简介、作者的话、登场人物、插图页。
5. 每章正文一般不少于 1500 字；短于 500 字的条目除非是序章或尾声，否则并入相邻章节。
6. 必须返回该章正文开头的原样片段作为 start，20-60 个汉字，必须与原文逐字一致，不要改写、不要加省略号、不要包含标题行。
7. 标题按原文照抄；原文没有标题、但内容明显分段时，可以起一个简短标题。
8. 不要遗漏主要章节，也不要编造原文不存在的章节。
9. 如果整段文本确实没有章节划分，返回一个章节，title 用「全文」。

只返回 JSON，不附带任何解释：
{"chapters":[{"title":"第一章 雨夜","start":"雨声压低了整条巷子，"}]}`;

async function detectChapters(text, onProgress) {
  const source = String(text || "").trim();
  if (!source) throw new Error("文本为空");

  const chunks = splitChunks(source);
  const marks = [];
  const cfg = readAiConfig();
  const systemPrompt = String(cfg.prompts?.chapter || "").trim() || SYSTEM_PROMPT;
  detectAbort = new AbortController();

  try {
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({
        done: i,
        total: chunks.length,
        message: chunks.length > 1 ? `AI 正在识别第 ${i + 1}/${chunks.length} 段` : "AI 正在识别章节",
      });

      const { data } = await chatJSON(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `请识别下面这段原文的章节结构：\n\n${chunks[i].text}`,
          },
        ],
        { signal: detectAbort.signal }
      );

      const list = Array.isArray(data.chapters) ? data.chapters : [];
      for (const item of list) {
        const title = String(item?.title || "").trim();
        const start = String(item?.start || "").trim();
        if (!title) continue;

        let local = start ? chunks[i].text.indexOf(start) : -1;
        if (local < 0 && start) {
          local = findLoose(chunks[i].text, start);
        }
        if (local < 0) {
          local = chunks[i].text.indexOf(title);
        }
        if (local < 0) continue;

        marks.push({ title, index: chunks[i].offset + local });
      }
    }
  } catch (e) {
    if (e?.name === "AbortError" || detectAbort?.signal.aborted) {
      throw new Error("已停止 AI 识别");
    }
    throw e;
  } finally {
    detectAbort = null;
  }

  onProgress?.({ done: chunks.length, total: chunks.length, message: "章节识别完成" });

  marks.sort((a, b) => a.index - b.index);
  const deduped = marks.filter((m, i) => i === 0 || m.index !== marks[i - 1].index);
  if (!deduped.length) throw new Error("AI 没有识别出章节，可以改用规则识别或整本一章");
  return deduped;
}

const ANNOTATE_PROMPT = `你是有声书配音的角色标注助手。用户给你一章已经拆好的台词，每句有 id、speaker、text。

任务：
1. 找出说话人标错或标成「未知」的句子，根据上下文判断真实说话人。
2. speaker 只能从给定的角色列表里选，实在判断不了就保留「未知」。
3. speaker 是「旁白」的句子是叙述文字，不要改成角色。
4. 同时给出情绪，只能从：平静、高兴、愤怒、悲伤、害怕、厌恶、忧郁、惊讶、克制、试探、警惕、疲惫 里选。
5. 同时给出语速，只能从：很慢、慢、正常、稍慢、快 里选。
6. 只把真正有台词的人物当角色。作者、插画、制作信息、目录、简介、出版社、译者、编辑、页码、数字不是角色。
7. 日式引号「」里的对话，如果前后没有「某某说」，根据称呼、语气和上下文判断说话人；判断不了就保留「未知」。
8. 只返回需要修改的句子，不要返回全部。

只返回 JSON，不要解释：
{"lines":[{"id":12,"speaker":"堀北","emotion":"平静","speed":"正常"}]}`;

async function annotateLines(lines, casts, onProgress, startBatch = 0) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return { changes: [], cancelled: false, nextBatch: 0 };

  const names = (casts || []).map((c) => (typeof c === "string" ? c : c?.name)).filter(Boolean);
  const BATCH = 60;
  const batches = [];
  for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));

  const changes = [];
  let cancelled = false;
  let finished = Math.max(0, Math.min(startBatch, batches.length));
  detectAbort = new AbortController();

  const cfg = readAiConfig();
  const systemPrompt = String(cfg.prompts?.annotate || "").trim() || ANNOTATE_PROMPT;

  try {
    for (let i = finished; i < batches.length; i++) {
      onProgress?.({
        done: i,
        total: batches.length,
        message: `AI 正在标注角色 ${i + 1}/${batches.length}`,
      });

      const payload = {
        casts: names,
        lines: batches[i].map((l) => ({ id: l.id, speaker: l.speaker, text: l.text })),
      };

      const { data } = await chatJSON(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
        { signal: detectAbort.signal }
      );

      for (const item of Array.isArray(data.lines) ? data.lines : []) {
        const id = Number(item?.id);
        const speaker = String(item?.speaker || "").trim();
        const emotion = String(item?.emotion || "").trim();
        const speed = String(item?.speed || "").trim();
        if (!id) continue;
        if (speaker && speaker !== "未知" && !names.includes(speaker) && speaker !== "旁白") continue;
        changes.push({ id, speaker, emotion, speed });
      }

      finished = i + 1;
    }
  } catch (e) {
    if (e?.name === "AbortError" || detectAbort?.signal.aborted) {
      cancelled = true;
    } else {
      throw e;
    }
  } finally {
    detectAbort = null;
  }

  onProgress?.({
    done: finished,
    total: batches.length,
    message: cancelled ? "已停止，保留已完成结果" : "角色标注完成",
  });

  return { changes, cancelled, nextBatch: finished };
}

const CAST_PROMPT = `你是小说角色分析器。读下面这段原文，列出真正有台词的人物。

规则：
1. 只列人物。作者、插画、制作信息、目录、简介、出版社、译者、编辑、页码、数字、旁白都不是角色。
2. 不要把叙述中的句子片段当人名。
3. 同一人物只出现一次，用原文中最常用的称呼。
4. 没有「某某说」的对话，根据称呼、语气和上下文推断说话人；同一段连续对话尽量归给在场人物。
5. gender 只能是：男、女、未知；age 只能是：少年、青年、中年、老年、未知；desc 不超过 12 个字。
6. 没有可识别角色就返回空数组。

只返回 JSON，不要解释：
{"casts":[{"name":"堀北","gender":"女","age":"青年","desc":"冷静强势"}]}`;

async function extractCasts(text, onProgress) {
  const source = String(text || "").trim();
  if (!source) return [];

  const chunks = splitChunks(source);
  const map = new Map();
  detectAbort = new AbortController();

  try {
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({
        done: i,
        total: chunks.length,
        message: chunks.length > 1 ? `AI 正在分析角色 ${i + 1}/${chunks.length}` : "AI 正在分析角色",
      });

      const { data } = await chatJSON(
        [
          { role: "system", content: CAST_PROMPT },
          { role: "user", content: chunks[i].text },
        ],
        { signal: detectAbort.signal, maxTokens: 4096 }
      );

      for (const item of Array.isArray(data.casts) ? data.casts : []) {
        const name = String(item?.name || "").trim();
        if (!name || map.has(name)) continue;
        map.set(name, {
          name,
          gender: String(item?.gender || "未知").trim(),
          age: String(item?.age || "未知").trim(),
          desc: String(item?.desc || "").trim().slice(0, 20),
        });
      }
    }
  } catch (e) {
    if (e?.name === "AbortError" || detectAbort?.signal.aborted) {
      throw new Error("已停止 AI 角色分析");
    }
    throw e;
  } finally {
    detectAbort = null;
  }

  onProgress?.({ done: chunks.length, total: chunks.length, message: "角色分析完成" });
  return [...map.values()];
}

const VOICE_DESIGN_PROMPT = `你是有声书音色设计师。根据用户给的角色或声音提示，设计一个适合的音色。

规则：
1. description 要具体：性别年龄、音色质感、语气、语速、角色感，1-4 句。
2. 不要使用「普通」「正常」这类模糊词，也不要写混响、EQ、压缩等后期处理。
3. previewText 是一段适合这个声音的试听台词，15-60 字，像这个角色会说的话，不要写旁白说明。
4. name 是简短音色名，2-8 个字，不要用整段描述当名字。
5. gender 只能是：男、女、未知；age 只能是：少年、青年、中年、老年、未知。
6. 只返回 JSON，不要解释。

格式：
{"name":"清冷少女","gender":"女","age":"青年","description":"17 岁女高中生，声音偏低、清亮但不甜，语速偏慢，语气疏离克制。","previewText":"不用了，我一个人也可以。"}`;

async function suggestVoice(prompt) {
  const source = String(prompt || "").trim();
  if (!source) throw new Error("请先写一段角色或声音提示");

  const { data } = await chatJSON(
    [
      { role: "system", content: VOICE_DESIGN_PROMPT },
      { role: "user", content: source },
    ],
    { maxTokens: 1024 }
  );

  return {
    name: String(data.name || "AI 音色").trim().slice(0, 12),
    gender: ["男", "女", "未知"].includes(String(data.gender || "").trim())
      ? String(data.gender).trim()
      : "未知",
    age: ["少年", "青年", "中年", "老年", "未知"].includes(String(data.age || "").trim())
      ? String(data.age).trim()
      : "未知",
    description: String(data.description || "").trim(),
    previewText: String(data.previewText || "").trim(),
  };
}

function cancelDetect() {
  if (!detectAbort) return false;
  detectAbort.abort();
  return true;
}

function findLoose(text, needle) {
  const clean = (s) => s.replace(/[\s“”"'‘’、，。！？：；…—\-]/g, "");
  const target = clean(needle).slice(0, 24);
  if (!target) return -1;
  const compact = [];
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const c = clean(text[i]);
    if (!c) continue;
    compact.push(c);
    map.push(i);
  }
  const pos = compact.join("").indexOf(target);
  return pos < 0 ? -1 : map[pos];
}

async function testConnection() {
  const started = Date.now();
  const { data } = await chatJSON(
    [
      { role: "system", content: '只返回 JSON：{"ok":true}' },
      { role: "user", content: "ping" },
    ],
    { maxTokens: 128, timeout: 30000 }
  );
  return { ok: data?.ok === true, ms: Date.now() - started, model: readAiConfig().model };
}

function defaultPrompts() {
  return { chapter: SYSTEM_PROMPT, annotate: ANNOTATE_PROMPT };
}

module.exports = {
  readAiConfig,
  writeAiConfig,
  detectChapters,
  cancelDetect,
  annotateLines,
  extractCasts,
  suggestVoice,
  testConnection,
  defaultPrompts,
  configFile,
};
