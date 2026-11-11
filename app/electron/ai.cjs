const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULTS = {
  provider: "mimo",
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.6-flash",
  apiKey: "",
  autoChapter: true,
  annotateThinking: true,
  cloudProviders: {
    mimo: true,
  },
  customTts: {
    enabled: false,
    name: "自定义 TTS",
    baseUrl: "",
    apiKey: "",
    model: "tts-1",
    voice: "alloy",
  },
  qwenTts: {
    enabled: false,
    baseUrl: "https://dashscope.aliyuncs.com",
    apiKey: "",
    model: "qwen3-tts-flash",
    voice: "Cherry",
    languageType: "Chinese",
  },
  mimoTts: {
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKey: "",
  },
  prompts: {
    chapter: "",
    annotate: "",
  },
  customThinking: {
    enabled: false,
    effort: "medium",
  },
};

const PROVIDERS = {
  mimo: {
    name: "小米 MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-flash",
    tts: true,
  },
  qwen: {
    name: "千问百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    tts: false,
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    tts: false,
  },
  custom: {
    name: "自定义",
    baseUrl: "",
    model: "",
    tts: false,
  },
};

const CHUNK_CHARS = 150000;
const TIMEOUT_MS = 300000;

const SPEED_LABELS = { 很慢: 0.6, 慢: 0.8, 稍慢: 0.9, 正常: 1, 快: 1.2 };

function normalizeSpeed(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.min(2, Math.max(0.5, numeric));
  return SPEED_LABELS[String(value || "").trim()] ?? 1;
}

function emptyUsage() {
  return { input: 0, output: 0, total: 0, cached: 0 };
}

function addUsage(total, usage) {
  if (!usage) return total;
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const sum = Number(usage.total_tokens ?? 0) || input + output;
  const cached = Number(
    usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0
  ) || 0;
  return {
    input: total.input + input,
    output: total.output + output,
    total: total.total + sum,
    cached: total.cached + cached,
  };
}

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
    cloudProviders: { ...DEFAULTS.cloudProviders, ...(saved.cloudProviders || {}) },
    customTts: { ...DEFAULTS.customTts, ...(saved.customTts || {}) },
    qwenTts: { ...DEFAULTS.qwenTts, ...(saved.qwenTts || {}) },
    mimoTts: { ...DEFAULTS.mimoTts, ...(saved.mimoTts || {}) },
    customThinking: { ...DEFAULTS.customThinking, ...(saved.customThinking || {}) },
    apiKey: saved.apiKey || process.env.MIMO_API_KEY || "",
  };
}

function writeAiConfig(cfg) {
  const next = { ...readAiConfig(), ...cfg };
  next.prompts = { ...DEFAULTS.prompts, ...(cfg.prompts || next.prompts || {}) };
  next.cloudProviders = {
    ...DEFAULTS.cloudProviders,
    ...(cfg.cloudProviders || next.cloudProviders || {}),
  };
  next.customTts = {
    ...DEFAULTS.customTts,
    ...(cfg.customTts || next.customTts || {}),
  };
  next.qwenTts = {
    ...DEFAULTS.qwenTts,
    ...(cfg.qwenTts || next.qwenTts || {}),
  };
  next.mimoTts = {
    ...DEFAULTS.mimoTts,
    ...(cfg.mimoTts || next.mimoTts || {}),
  };
  next.customThinking = {
    ...DEFAULTS.customThinking,
    ...(cfg.customThinking || next.customThinking || {}),
  };
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function normalizeBase(url) {
  return String(url || DEFAULTS.baseUrl).trim().replace(/\/+$/, "");
}

function cleanJsonText(content) {
  return String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

async function streamChat(r, onReasoning) {
  const decoder = new TextDecoder();
  const reader = r.body.getReader();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let pending = "";
  let usage = null;
  let finishReason = "";
  let lastEmit = 0;

  const flush = () => {
    if (!pending) return;
    const now = Date.now();
    if (now - lastEmit < 120) return;
    lastEmit = now;
    const chunk = pending;
    pending = "";
    onReasoning?.(chunk);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      if (json.usage) usage = json.usage;
      const choice = json.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta || {};
      const think = delta.reasoning_content ?? delta.reasoning;
      if (typeof think === "string" && think) {
        reasoning += think;
        pending += think;
        flush();
      }
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
      }
    }
  }

  if (pending) onReasoning?.(pending);
  return { content, reasoning, usage, finishReason };
}

async function chatJSON(messages, options = {}) {
  const cfg = readAiConfig();
  if (!cfg.apiKey) {
    throw new Error("还没有配置 API Key，请到设置 → AI 服务里填写");
  }

  const isMimo = cfg.provider === "mimo" || /xiaomimimo/i.test(String(cfg.baseUrl || ""));
  const customEffort =
    !isMimo && cfg.provider === "custom" && cfg.customThinking?.enabled
      ? cfg.customThinking.effort || "medium"
      : "";
  const useStream = Boolean(options.stream);
  const body = {
    model: cfg.model,
    messages,
    stream: useStream,
    response_format: { type: "json_object" },
  };
  if (!(isMimo && options.thinking)) {
    body.temperature = options.temperature ?? 0.1;
  }
  if (isMimo) {
    body.max_completion_tokens = options.maxTokens ?? 16384;
    body.thinking = { type: options.thinking ? "enabled" : "disabled" };
    if (useStream) body.stream_options = { include_usage: true };
  } else {
    body.max_tokens = options.maxTokens ?? 16384;
    if (customEffort) body.reasoning_effort = customEffort;
  }

  const timeout = AbortSignal.timeout(options.timeout ?? TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  if (isMimo) headers["api-key"] = cfg.apiKey;

  let r;
  try {
    r = await fetch(`${normalizeBase(cfg.baseUrl)}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === "TimeoutError") {
      throw new Error(
        `AI 思考超时（${Math.round((options.timeout ?? TIMEOUT_MS) / 60000)} 分钟），可以重试或把本章拆短`
      );
    }
    throw e;
  }

  if (!r.ok) {
    const raw = await r.text();
    let detail = raw.slice(0, 400);
    try {
      detail = JSON.parse(raw)?.error?.message || detail;
    } catch {
      /* 保留原始文本 */
    }
    throw new Error(`AI 请求失败 HTTP ${r.status}：${detail}`);
  }

  let content = "";
  let usage = null;
  let finishReason = "";
  const type = r.headers.get("content-type") || "";

  if (useStream && type.includes("text/event-stream")) {
    const streamed = await streamChat(r, options.onReasoning);
    content = streamed.content;
    usage = streamed.usage;
    finishReason = streamed.finishReason;
  } else {
    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("AI 返回的不是 JSON");
    }
    const message = data.choices?.[0]?.message || {};
    content = message.content || "";
    usage = data.usage;
    finishReason = data.choices?.[0]?.finish_reason || "";
    const reasoning = message.reasoning_content ?? message.reasoning;
    if (typeof reasoning === "string" && reasoning.trim()) {
      options.onReasoning?.(reasoning);
    }
  }

  if (!content) {
    throw new Error(
      finishReason === "length"
        ? "思考占满了 max_completion_tokens，最终回答被截断；请缩短这一章或调高输出上限"
        : "AI 没有返回内容"
    );
  }

  const cleaned = cleanJsonText(content);

  try {
    return { data: JSON.parse(cleaned), usage };
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

const SYSTEM_PROMPT = `你是小说章节识别器。只识别章节结构，不分析角色，不拆台词，不改写正文。

规则：
1. 作者通常会在正文里直接写「第X章」「第X回」「第X节」；优先识别这些行。
2. 支持中文标记：第X章/回/节/卷/部/篇/集、序章、楔子、引子、前言、后记、尾声、终章、番外。
3. 支持英文标记：Chapter N、Part N、Prologue、Epilogue。
4. 支持日文标记：第X話、第X章、第X節、第X巻、序章、終章、番外編。
5. 纯数字 1、2、3、页码 P011、插图编号、目录条目、场景小标题都不是章节，不要单独切分；只有原文明确写成「第1章」并带正文结构时才保留。
6. 不要按目录页的页码或条目数量切分；目录只用来核对标题，正文里的章节标题才是边界。
7. 不要因为正文短就合并章节。少于 1500 字甚至少于 500 字的短章，只要是独立章节标记就保留。
8. 不要把卷内小节、场景标题、人物介绍、目录条目单独算一章。
9. 跳过版权页、目录、简介、作者的话、登场人物、插图页、制作信息。
10. 每章返回该章正文开头的原样片段作为 start，20-60 个汉字，必须与原文逐字一致，不要改写、不要加省略号、不要包含标题行。
11. 标题按原文照抄；原文没有标题、但内容明显分段时，可以起一个简短标题。
12. 不要遗漏主要章节，也不要编造原文不存在的章节。
13. 如果整段文本确实没有章节划分，返回一个章节，title 用「全文」。
14. 不要返回角色、情绪、语速、台词拆分；这些是后续独立步骤。

只返回 JSON，不附带任何解释：
{"chapters":[{"title":"第一章 雨夜","start":"雨声压低了整条巷子，"}]}`;

async function detectChapters(text, onProgress, toc = [], workTitle = "") {
  const source = String(text || "").trim();
  if (!source) throw new Error("文本为空");

  const titleHint = String(workTitle || "").trim()
    ? `作品名：${String(workTitle).trim()}\n\n`
    : "";

  const tocTitles = (Array.isArray(toc) ? toc : [])
    .map((title) => String(title || "").trim())
    .filter(Boolean)
    .slice(0, 120);
  const tocHint = tocTitles.length
    ? `出版社目录（优先按这些标题在正文里定位，不要新增目录外章节）：\n${tocTitles
        .map((title, i) => `${i + 1}. ${title}`)
        .join("\n")}\n\n`
    : "";

  const chunks = splitChunks(source);
  const marks = [];
  let usage = emptyUsage();
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

      const { data, usage: chunkUsage } = await chatJSON(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `${titleHint}${tocHint}请识别下面这段原文的章节结构：\n\n${chunks[i].text}`,
          },
        ],
        { signal: detectAbort.signal }
      );
      usage = addUsage(usage, chunkUsage);

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
  return { marks: deduped, usage };
}

const ANNOTATE_PROMPT = `你是有声书配音的角色标注助手。用户给你一章已经拆好的台词，每句有 id、speaker、text。

任务：
1. 用户会给你一整章已经拆好的台词和角色表，先通读整章，分析人物关系、称呼、语气、场景，再判断每句的说话人。
2. 只修改说话人标错或标成「未知」的句子；已经是「旁白」的叙述句不要改成角色。
3. speaker 只能从给定的角色列表里选；实在判断不了就保留「未知」。
4. 引号里的内容不自动等于台词。先看引号外的叙述框架：谁说、对谁说、在什么场景说。
5. 不要因为引号内容里出现了某个角色名，就把这句话判给这个角色。名字出现在台词内容里，不等于说话人就是他。
6. 电话、手机、对讲机、广播、电视、录音、新闻、扩音器、耳机里的声音，如果叙述没有明确指出说话人，标为「未知」，不要归给段落主角、旁白或某个在场角色。能确认身份时用身份名，例如「警察」「播音员」「店员」。
7. 如果一句话只是叙述中夹带的引号、术语、书名、招牌、短信内容、歌词或台词片段，不是独立说话，speaker 改成「旁白」；拿不准时保留「未知」或「旁白」，不要硬塞给某个角色。
8. 同一段叙述里既有旁白又有引号内容时，只有真正独立的说话句才标角色；不要把整段都标成同一个角色。
9. 对话标记要同时支持：
   - 中文：说、道、问、答、喊、叫、笑道、低声、开口、回答、补充、嘀咕、嘟囔；引号 “”、『』、「」、""。
   - 英文：said、asked、replied、answered、whispered、shouted、muttered、added；引号 ""、''。
   - 日文：言った、聞いた、答えた、叫んだ、呟いた、笑った；引号 「」、『』。
10. 同时给出情绪，只能从：平静、高兴、愤怒、悲伤、害怕、厌恶、忧郁、惊讶、克制、试探、警惕、疲惫 里选。
11. 同时给出语速，用 0.5-2.0 的数字：1 是正常，小于 1 更慢，大于 1 更快。不要用「慢/快/稍慢」这类词。
12. 如果 context 给出了作品名，可以结合你已知的该作品角色名和称呼；只能使用原文出现或明确指向本作的角色，不确定就保留「未知」，不要把其他作品的角色混进来。
13. 思考过程用简体中文，只列关键疑点：谁在场、称呼指向谁、是不是设备里的声音、哪些句子拿不准。不要复述原文，不要逐句解释，不要写完整推理报告。
14. 只返回需要修改的句子，不要返回全部，也不要返回你的思考过程。

只返回 JSON，不要解释：
{"lines":[{"id":12,"speaker":"堀北","emotion":"平静","speed":1.0}]}`;

const ANNOTATE_MAX_CHARS = 60000;

function chunkForAnnotation(lines, maxChars = ANNOTATE_MAX_CHARS) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    const cost = String(line.text || "").length + 48;
    if (current.length && size + cost > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += cost;
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

async function annotateLines(lines, casts, onProgress, startBatch = 0, context = "") {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return { changes: [], cancelled: false, nextBatch: 0, usage: emptyUsage() };

  const names = (casts || []).map((c) => (typeof c === "string" ? c : c?.name)).filter(Boolean);
  // 默认整章一次交给 AI；只有超出上下文预算的长章才按字符切段。
  const chunks = chunkForAnnotation(list);

  const changes = [];
  let usage = emptyUsage();
  let cancelled = false;
  const startAt = Number.isFinite(Number(startBatch)) ? Number(startBatch) : 0;
  let finished = Math.max(0, Math.min(startAt, chunks.length));
  detectAbort = new AbortController();

  const cfg = readAiConfig();
  const isMimo = cfg.provider === "mimo" || /xiaomimimo/i.test(String(cfg.baseUrl || ""));
  const thinking = cfg.annotateThinking !== false;
  const systemPrompt = String(cfg.prompts?.annotate || "").trim() || ANNOTATE_PROMPT;

  try {
    for (let i = finished; i < chunks.length; i++) {
      const whole = chunks.length === 1;
      onProgress?.({
        done: i,
        total: chunks.length,
        message: whole
          ? `AI 正在通读整章 ${chunks[i].length} 句…`
          : `AI 正在分析第 ${i + 1}/${chunks.length} 段（${chunks[i].length} 句）…`,
      });

      const payload = {
        context: String(context || ""),
        casts: names,
        lines: chunks[i].map((l) => ({ id: l.id, speaker: l.speaker, text: l.text })),
      };

      const { data, usage: chunkUsage } = await chatJSON(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
        {
          signal: detectAbort.signal,
          thinking,
          stream: true,
          timeout: 30 * 60 * 1000,
          maxTokens: isMimo ? 65536 : 16384,
          onReasoning: (chunk) =>
            onProgress?.({
              done: i,
              total: chunks.length,
              message: "AI 正在思考…",
              reasoning: chunk,
            }),
        }
      );
      usage = addUsage(usage, chunkUsage);

      for (const item of Array.isArray(data.lines) ? data.lines : []) {
        const id = Number(item?.id);
        const speaker = String(item?.speaker || "").trim();
        const emotion = String(item?.emotion || "").trim();
        const speed = normalizeSpeed(item?.speed);
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
    total: chunks.length,
    message: cancelled ? "已停止，保留已完成结果" : "角色标注完成",
  });

  return { changes, cancelled, nextBatch: finished, usage };
}

const CAST_PROMPT = `你是小说角色分析器。读下面这段原文，列出真正有台词的人物。

规则：
1. 先通读全文，分析人物关系、称呼和对话标记，再列出真正有台词的人物。
2. 只列人物。作者、插画、制作信息、目录、简介、出版社、译者、编辑、页码、数字、旁白都不是角色。
3. 不要把叙述中的句子片段当人名。以下都不是名字：「她回」「他想」「江宁一愣」「声音里带」「江宁回过神」「他忽然」「妈妈在二楼」。
4. 角色名应该是 2-6 个汉字（日式长名可以到 6 个），或首字母大写的英文名；不要带动作、副词、语气词、标点或整句话。
5. 引号里的内容不自动等于台词。不要因为引号里出现某个名字，就把这个名字列为说话角色；只有引号外的叙述能支持他在说话，才算有台词。
6. 电话、手机、对讲机、广播、电视、录音、新闻里的声音，如果没有明确人物，不要硬套在场角色；可以列成「警察」「播音员」这类身份名，或直接省略。
7. 同一人物只出现一次，用原文中最常用的称呼。
8. 对话标记要同时支持：
   - 中文：说、道、问、答、喊、叫、笑道、低声、开口、回答、补充、嘀咕、嘟囔；引号 “”、『』、「」、""。
   - 英文：said、asked、replied、answered、whispered、shouted、muttered、added；引号 ""、''。
   - 日文：言った、聞いた、答えた、叫んだ、呟いた、笑った；引号 「」、『』。
9. 没有名字但有台词的人物，用「OL女性」「店员」「路人男生」这类身份描述，不要编造人名。
10. 没有「某某说」的对话，根据称呼、语气和上下文推断说话人；同一段连续对话尽量归给在场人物，拿不准就不要列。
11. gender 只能是：男、女、未知；age 只能是：少年、青年、中年、老年、未知；desc 不超过 12 个字。
12. 没有可识别角色就返回空数组。
13. 如果用户给了作品名，可以结合你已知的该作品角色名和称呼；只能使用原文出现或明确指向本作的角色，不要把其他作品的角色混进来。

只返回 JSON，不要解释：
{"casts":[{"name":"堀北","gender":"女","age":"青年","desc":"冷静强势"}]}`;

async function extractCasts(text, onProgress, context = "") {
  const source = String(text || "").trim();
  if (!source) return [];

  const chunks = splitChunks(source);
  const map = new Map();
  let usage = emptyUsage();
  detectAbort = new AbortController();

  try {
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({
        done: i,
        total: chunks.length,
        message: chunks.length > 1 ? `AI 正在分析角色 ${i + 1}/${chunks.length}` : "AI 正在分析角色",
      });

      const { data, usage: chunkUsage } = await chatJSON(
        [
          { role: "system", content: CAST_PROMPT },
          { role: "user", content: `${context ? `作品/章节：${context}\n\n` : ""}${chunks[i].text}` },
        ],
        { signal: detectAbort.signal, maxTokens: 4096 }
      );
      usage = addUsage(usage, chunkUsage);

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
  return { casts: [...map.values()], usage };
}

const VOICE_DESIGN_PROMPT = `你是有声书音色设计师。根据用户给的角色或声音提示，设计一个适合的音色。

规则：
1. description 要具体：性别年龄、音色质感、语气、语速、角色感，1-4 句。
2. 不要使用「普通」「正常」这类模糊词，也不要写混响、EQ、压缩等后期处理。
3. previewText 是一段适合这个声音的试听台词，40-120 字，像这个角色会说的话，不要写旁白说明；这段音频之后可能被当作本地克隆的参考音频，所以要有情绪和停顿。
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
  return { ok: data?.ok === true, ms: Date.now() - started, model: readAiConfig().model, provider: readAiConfig().provider };
}

function defaultPrompts() {
  return { chapter: SYSTEM_PROMPT, annotate: ANNOTATE_PROMPT };
}

const TTS_MODEL_RE = /(tts|speech|voice|cosyvoice|sambert)/i;

async function listModels({ baseUrl, apiKey, provider = "custom", kind = "text" } = {}) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("先填写服务地址");
  const key = String(apiKey || "").trim();
  const headers =
    provider === "mimo"
      ? key
        ? { "api-key": key }
        : {}
      : key
        ? { Authorization: `Bearer ${key}` }
        : {};
  const urls = [`${base}/models`];
  if (!/\/v1$/i.test(base)) urls.push(`${base}/v1/models`);
  if (provider === "qwen" && !/compatible-mode/i.test(base)) {
    urls.push(`${base}/compatible-mode/v1/models`);
  }

  let lastError = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = `HTTP ${res.status}：${text.slice(0, 120)}`;
        continue;
      }
      const data = JSON.parse(text);
      const raw =
        data.data ||
        data.models ||
        data.output?.models ||
        data.result?.models ||
        [];
      const ids = [...new Set(
        (Array.isArray(raw) ? raw : [])
          .map((m) => (typeof m === "string" ? m : m?.id || m?.name || m?.model))
          .filter(Boolean)
      )];
      if (!ids.length) {
        lastError = "接口没有返回模型";
        continue;
      }
      const tts = ids.filter((id) => TTS_MODEL_RE.test(id));
      const textModels = ids.filter((id) => !TTS_MODEL_RE.test(id));
      const models = kind === "tts" ? (tts.length ? tts : ids) : (textModels.length ? textModels : ids);
      return {
        models,
        filtered: models.length !== ids.length,
        total: ids.length,
      };
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(`获取模型失败：${lastError || "没有可用接口"}`);
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
  listModels,
  configFile,
};
