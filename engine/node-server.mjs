import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readWav, resample, normalize, writeWav, writeZip } from "./wav.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "outputs");
fs.mkdirSync(OUT, { recursive: true });

const CONFIG_FILE = path.join(here, "config.json");
let fileConfig = {};
try {
  fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
} catch {
  /* 没有配置文件就用默认值 */
}

let GRADIO = (
  process.env.GRADIO_URL ||
  fileConfig.gradioUrl ||
  "http://192.168.3.68:7860"
).replace(/\/$/, "");
let GRADIO_API = process.env.GRADIO_API || fileConfig.gradioApi || "gen_single";
const VOICES =
  process.env.VOICE_LIB || fileConfig.voiceLib || path.join(here, "..", "voices");
const PORT = Number(process.env.ENGINE_PORT || 8290);

const uploadCache = new Map();

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*",
  });
  res.end(body);
}

function voiceMeta() {
  try {
    return JSON.parse(fs.readFileSync(path.join(VOICES, "meta.json"), "utf8"));
  } catch {
    return {};
  }
}

function cloudRecords() {
  try {
    return JSON.parse(fs.readFileSync(path.join(VOICES, "cloud.json"), "utf8"));
  } catch {
    return [];
  }
}

function walkWav(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "cloud") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkWav(p));
    else if (entry.name.toLowerCase().endsWith(".wav")) out.push(p);
  }
  return out;
}

function listVoices(q) {
  if (!fs.existsSync(VOICES)) return [];
  const meta = voiceMeta();
  const cloud = cloudRecords();
  const out = [];
  for (const p of walkWav(VOICES)) {
    const relative = path.relative(VOICES, p).split(path.sep).join("/");
    const base = path.basename(p);
    const record = cloud.find(
      (r) => path.basename(String(r.voice || "")) === base || r.id === base.replace(/\.wav$/i, "")
    );
    const info =
      meta[relative] ||
      meta[base] ||
      (record
        ? {
            name: record.name,
            desc: record.desc,
            gender: record.gender,
            age: record.age,
            category: "AI 设计",
          }
        : {});
    const display = info.name || base.replace(/\.wav$/i, "");
    const haystack = `${relative} ${base} ${display} ${info.desc || ""} ${info.gender || ""} ${info.age || ""}`.toLowerCase();
    if (q && !haystack.includes(q.toLowerCase())) continue;
    const st = fs.statSync(p);
    out.push({
      name: base.replace(/\.wav$/i, ""),
      displayName: display,
      desc: info.desc || "",
      gender: info.gender || "",
      age: info.age || "",
      path: relative,
      category: info.category || "本地",
      size: st.size,
    });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function uploadVoice(localPath) {
  const st = fs.statSync(localPath);
  const key = `${localPath}:${st.mtimeMs}`;
  if (uploadCache.has(key)) return uploadCache.get(key);

  const form = new FormData();
  form.append(
    "files",
    new Blob([fs.readFileSync(localPath)], { type: "audio/wav" }),
    path.basename(localPath)
  );
  const r = await fetch(`${GRADIO}/gradio_api/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`上传参考音频失败: HTTP ${r.status}`);
  const list = await r.json();
  if (!list?.[0]) throw new Error("上传参考音频没有返回路径");
  uploadCache.set(key, list[0]);
  return list[0];
}

function resolveVoice(p) {
  if (!p) throw new Error("缺少参考音频");
  const root = path.resolve(VOICES);
  const raw = String(p);
  const candidates = path.isAbsolute(raw) ? [raw] : [path.join(root, raw)];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (!resolved.startsWith(root + path.sep)) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  throw new Error(`参考音频不存在: ${p}`);
}

let apiSpec = null;

const LABELS = {
  mode: ["情感控制方式", "Emotion Control", "Emotion Mode"],
  lang: ["语言", "Language"],
  weight: ["情感权重", "Emotion Weight", "Emotion Alpha"],
  emoText: ["情感描述文本", "Emotion Text", "Emotion Description"],
  maxTokens: ["分句最大Token数", "Max Token"],
  duration: ["时长系数", "Duration"],
  vec: [
    ["喜", "Happy", "Happiness"],
    ["怒", "Angry", "Anger"],
    ["哀", "Sad", "Sadness"],
    ["惧", "Fear", "Fearful"],
    ["厌恶", "Disgust", "Disgusted"],
    ["低落", "Depression", "Depressed"],
    ["惊喜", "Surprise", "Surprised"],
    ["平静", "Calm", "Neutral"],
  ],
};

function match(label, keys) {
  return keys.some((k) => label.includes(k));
}

async function discoverApi(force = false) {
  if (apiSpec && !force) return apiSpec;

  const r = await fetch(`${GRADIO}/config`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`读取远端 config 失败: HTTP ${r.status}`);
  const cfg = await r.json();
  const comps = new Map((cfg.components || []).map((c) => [c.id, c]));
  const dep = (cfg.dependencies || []).find(
    (d) => d.api_name === GRADIO_API || d.api_name === `/${GRADIO_API}`
  );
  if (!dep) throw new Error(`远端没有 ${GRADIO_API} API`);

  apiSpec = dep.inputs.map((id) => {
    const c = comps.get(id) || {};
    return {
      id,
      type: c.type,
      label: c.props?.label || "",
      value: c.props?.value,
    };
  });

  console.log(`[shengkan] discovered ${GRADIO_API}: ${apiSpec.length} inputs`);
  return apiSpec;
}

function buildData(spec, { remoteVoice, text, lang, vec, emoAlpha, emoText, durationFactor }) {
  const hasVec = vec.some((v) => v > 0);
  let audioCount = 0;
  let textCount = 0;

  return spec.map((p) => {
    const label = p.label || "";

    if (match(label, LABELS.mode)) {
      return hasVec ? "使用情感向量控制" : "与音色参考音频相同";
    }
    if (p.type === "audio") {
      audioCount += 1;
      if (audioCount === 1) {
        return { path: remoteVoice, meta: { _type: "gradio.FileData" } };
      }
      return null;
    }
    if (match(label, LABELS.lang)) return lang;
    if (match(label, LABELS.weight)) return Number(emoAlpha ?? 0.65);
    if (match(label, LABELS.emoText)) return emoText || "";
    if (match(label, LABELS.maxTokens)) return 120;
    if (match(label, LABELS.duration)) return durationFactor;

    for (let i = 0; i < LABELS.vec.length; i++) {
      if (match(label, LABELS.vec[i])) return vec[i];
    }

    if (p.type === "textbox") {
      textCount += 1;
      if (textCount === 1) return text;
      return emoText || "";
    }

    return p.value ?? null;
  });
}

async function remoteTTS({ text, voice, emoVector, emoAlpha, emoText, lang = "ZH", speed = 1 }) {
  const local = resolveVoice(voice);
  const remoteVoice = await uploadVoice(local);

  const vec =
    Array.isArray(emoVector) && emoVector.length === 8
      ? emoVector.map((v) => Number(v) || 0)
      : [0, 0, 0, 0, 0, 0, 0, 0];
  const rate = Math.min(2, Math.max(0.5, Number(speed) || 1));
  const durationFactor = 1 / rate;

  const spec = await discoverApi();
  const data = buildData(spec, {
    remoteVoice,
    text,
    lang,
    vec,
    emoAlpha,
    emoText,
    durationFactor,
  });

  const call = await fetch(`${GRADIO}/gradio_api/call/${GRADIO_API}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(30000),
  });
  if (!call.ok) throw new Error(`远端调用失败: HTTP ${call.status}`);
  const { event_id } = await call.json();
  if (!event_id) throw new Error("远端没有返回 event_id");

  const sse = await fetch(`${GRADIO}/gradio_api/call/${GRADIO_API}/${event_id}`, {
    signal: AbortSignal.timeout(180000),
  });
  const raw = await sse.text();
  const lines = raw.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  if (!lines.length) throw new Error("远端没有返回结果");

  let payload;
  try {
    payload = JSON.parse(lines[lines.length - 1].replace(/^data:\s*/, ""));
  } catch {
    throw new Error("远端结果不是 JSON");
  }

  const file = payload?.[0]?.value;
  if (!file?.url) throw new Error("远端没有生成音频");

  const audio = await fetch(file.url, { signal: AbortSignal.timeout(60000) });
  if (!audio.ok) throw new Error(`下载音频失败: HTTP ${audio.status}`);
  const buf = Buffer.from(await audio.arrayBuffer());
  const name = `${crypto.randomUUID()}.wav`;
  fs.writeFileSync(path.join(OUT, name), buf);

  return { file: path.join(OUT, name), url: `/v1/audio/${name}` };
}

const SPEECH_VERB =
  "说道|问道|答道|叫道|喊道|吼道|嚷道|笑道|骂道|哭道|怒道|冷声道|轻声道|沉声道|温声道|开口道|回答道|解释道|补充道|嘟囔道|喃喃道|反问|回答|开口|低声|嘀咕|嘟囔|喃喃|出声|应声|接口|接话|说|问|答|喊|笑|叫";

const BAD_NAMES = new Set([
  "旁白", "未知", "他们", "她们", "它们", "我们", "你们", "咱们", "自己", "大家",
  "有人", "那人", "这人", "对方", "此时", "这时", "那时", "于是", "然后", "但是",
  "所以", "因为", "如果", "虽然", "只是", "已经", "还是", "就是", "不是", "可以",
  "没有", "什么", "怎么", "这样", "那样", "一个", "两个", "三个", "一下", "一边",
  "作者", "插画", "插图", "制作", "制作信息", "简介", "目录", "译者", "翻译", "出版社",
  "编辑", "责编", "校对", "监修", "原案", "漫画", "动画", "声优", "封面", "书名",
  "版权", "登场", "人物", "角色", "主要", "序言", "前言", "后记",
]);

const ALLOWED_APPELLATIONS = new Set([
  "妈妈", "爸爸", "哥哥", "姐姐", "弟弟", "妹妹", "叔叔", "阿姨", "爷爷", "奶奶",
  "外婆", "外公", "舅舅", "舅妈", "姑姑", "姑父", "姨妈", "姨父", "师父", "师傅",
  "老师", "医生", "护士", "老板", "司机", "服务员", "店员", "警察", "军官", "士兵",
  "管家", "女仆", "执事", "同学", "学长", "学姐", "学弟", "学妹",
]);

// 人名开头不应该是代词、连词、副词或动作片段
const BAD_START = new Set(
  "他她它我你您咱这那其此谁每各某有没不别要会能可是在把被让给对从到跟与为以而但却并且或者所因虽如若由忽突又还也都就才只很太更最再已曾正刚快慢轻重低大小多少好坏看听想说问答喊笑走跑站坐躺拿放伸转抬压装帮替叫变完起停回过出进上下拉来去声音话语心眼嘴脸头身口脚日月天年时分秒含随神先见作后面人己哑指一道".split("")
);

// 人名结尾不应该是语气词、动作、方位或量词
const BAD_END = new Set(
  "的了着得地过来去下上里外中前后边旁处时候刻然么呢吧啊呀哦嗯声音话语心眼嘴脸头身口脚笔神住惑愣瞪愿笑道问喊回走站坐看听想起开关停成变完掉好坏快慢轻重高低大小多少一二三四五六七八九十百千万两几个位名条只件张次遍点分秒天年月日时主茬步先带装跟含随他她它我你您咱们没又就苦洞解吼常台".split("")
);

const CHINESE_NAME = /^[\u4e00-\u9fa5]{2,4}$/;

function isNameShape(name) {
  if (!name || !CHINESE_NAME.test(name)) return false;
  if (BAD_NAMES.has(name)) return false;
  if (ALLOWED_APPELLATIONS.has(name)) return true;
  if (BAD_START.has(name[0])) return false;
  if (BAD_END.has(name[name.length - 1])) return false;
  if (name[0] === name[1] && !ALLOWED_APPELLATIONS.has(name)) return false;
  return true;
}

function trimPunct(s) {
  return s.replace(/^[，。；、：\s]+/, "").replace(/\s+$/, "");
}

function nameBefore(text) {
  // 硬换行会把名字拆成两行，先去掉换行再匹配
  const flat = text.replace(/[\r\n]+/g, "");
  const tail = flat.slice(-30);
  const speech = new RegExp(`([\\u4e00-\\u9fa5]{2,4})\\s*(?:${SPEECH_VERB})\\s*[:：]?\\s*$`);
  const m = tail.match(speech);
  if (m && isNameShape(m[1])) return m[1];

  const colon = tail.match(/([\u4e00-\u9fa5]{2,4})\s*[:：]\s*$/);
  if (!colon) return "";
  const name = colon[1];
  if (!isNameShape(name)) return "";
  const idx = tail.lastIndexOf(name);
  const prev = idx > 0 ? tail[idx - 1] : "";
  if (prev && !/[。！？…”」』；：\n]/.test(prev) && !/[，、]/.test(prev)) return "";
  return name;
}

function nameAfter(text) {
  const head = text.replace(/^[\s，,。；;：:、]+/, "");
  const re = new RegExp(`^([\\u4e00-\\u9fa5]{2,4})\\s*(?:${SPEECH_VERB})`);
  const m = head.match(re);
  if (m && isNameShape(m[1])) return { name: m[1], length: m[0].length };
  const m2 = head.match(/^([\u4e00-\u9fa5]{2,4})\s*[:：]/);
  if (m2 && isNameShape(m2[1])) return { name: m2[1], length: m2[0].length };
  return null;
}

const QUOTE_RE = /“([^”]*)”|「([^」]*)」|『([^』]*)』|"([^"]*)"/g;

// 原文按空行断开的半句话接回去：紧接名词/引号时不加标点，另起一句时补一个逗号当停顿。
const NO_GLUE_END = /[，,、；;：:（(“‘「『《【\s的之地得着过和与及或之者了把被让给在是有…—\-]$/;
const NO_GLUE_START = /^[“‘「『"”」』'）)\]】》」』，,、；;：:的之地得]/;

function joinContinuation(prevText, nextText) {
  const tail = prevText.replace(/\s+$/, "");
  if (NO_GLUE_END.test(tail) || NO_GLUE_START.test(nextText.trim())) {
    return `${prevText}${nextText}`;
  }
  return `${prevText}，${nextText}`;
}

function mergeContinuationSegments(segments) {
  const out = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.speaker === "旁白" && seg.speaker === "旁白") {
      // 上一段没有句末标点，说明原文把一句话拆成了多个空行，直接接回去。
      const tail = prev.text.trim().replace(/[”」』"'）)\]】]+$/, "");
      if (!/[。！？!?…：:；;]$/.test(tail)) {
        prev.text = joinContinuation(prev.text, seg.text);
        prev.confidence = Math.min(prev.confidence, seg.confidence);
        continue;
      }
    }
    out.push({ ...seg });
  }
  return out;
}

function splitText(text) {
  const segments = [];
  const blocks = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    const paragraph = blockIndex + 1;
    let pos = 0;
    let m;
    let quoted = false;
    QUOTE_RE.lastIndex = 0;

    while ((m = QUOTE_RE.exec(block)) !== null) {
      quoted = true;
      const before = block.slice(pos, m.index);
      const quote = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
      const after = block.slice(m.index + m[0].length);
      const trimmedBefore = before.trim();
      const trimmedAfter = after.trim();
      const afterHead = trimmedAfter.replace(/^[，,。；;：:、]+/, "");
      const speechMarker =
        new RegExp(`(?:${SPEECH_VERB})\\s*[，,：:]?\\s*$`).test(trimmedBefore) ||
        new RegExp(`^([\\u4e00-\\u9fa5]{2,4})\\s*(?:${SPEECH_VERB})`).test(afterHead) ||
        new RegExp(`^[他她它我你您]\\s*(?:${SPEECH_VERB})`).test(afterHead);
      const endsSentence = /[。！？!?…]$/.test(trimmedBefore);
      const continuesAfter = /^[的之者等地得，,、；;：:）)】\]》」』]/.test(trimmedAfter);
      // 引号只是句子里的术语/书名/招牌，或者后面还有“的/地/得/，”继续同一句话时，不拆成台词。
      const inlineQuote =
        !speechMarker &&
        quote.length > 0 &&
        ((trimmedBefore === "" && continuesAfter) ||
          (trimmedBefore !== "" && quote.length <= 20 && !endsSentence));
      const embedded = inlineQuote || (
        trimmedBefore !== "" &&
        !speechMarker &&
        quote.length > 0 &&
        quote.length <= 20 &&
        !endsSentence
      );
      if (embedded) continue;

      const beforeName = nameBefore(before);
      let beforeText = before;
      if (beforeName) {
        const idx = before.lastIndexOf(beforeName);
        if (idx >= 0) {
          beforeText = before.slice(0, idx);
        } else {
          const chars = beforeName.split("").join("\\s*");
          beforeText = before.replace(
            new RegExp(`${chars}\\s*(?:${SPEECH_VERB})?\\s*[:：]?\\s*$`),
            ""
          );
        }
      }
      beforeText = trimPunct(beforeText);
      if (beforeText) {
        segments.push({ speaker: "旁白", text: beforeText, emotion: "平静", confidence: 0.95, paragraph });
      }

      pos = m.index + m[0].length;
      if (!quote) continue;

      let speaker = beforeName;
      let confidence = speaker ? 0.9 : 0.45;

      if (!speaker) {
        const found = nameAfter(after);
        if (found) {
          speaker = found.name;
          confidence = 0.85;
          pos += found.length;
        }
      }

      segments.push({
        speaker: speaker || "未知",
        text: quote,
        emotion: "平静",
        confidence,
        paragraph,
      });
    }

    const rest = trimPunct(block.slice(pos));
    if (rest) {
      segments.push({ speaker: "旁白", text: rest, emotion: "平静", confidence: 0.95, paragraph });
    }
    if (!quoted && !rest) continue;
  }

  return mergeContinuationSegments(segments);
}

const TARGET_SR = 24000;

function loadClip(file) {
  const name = path.basename(String(file || ""));
  const p = path.join(OUT, name);
  if (!name || !fs.existsSync(p)) throw new Error(`找不到音频: ${file}`);
  const { sampleRate, samples } = readWav(p);
  return resample(samples, sampleRate, TARGET_SR);
}

function concat(chunks) {
  const length = chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function safeOutputName(name, prefix) {
  const clean = path
    .basename(String(name || ""))
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
  return clean || `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function srtTime(seconds) {
  let ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*",
    });
    return res.end();
  }

  try {
    if (url.pathname === "/v1/config") {
      if (req.method === "GET") {
        return json(res, { gradioUrl: GRADIO, gradioApi: GRADIO_API });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        if (body.gradioUrl) GRADIO = String(body.gradioUrl).trim().replace(/\/$/, "");
        if (body.gradioApi) GRADIO_API = String(body.gradioApi).trim();
        apiSpec = null;
        fs.writeFileSync(
          CONFIG_FILE,
          JSON.stringify({ gradioUrl: GRADIO, gradioApi: GRADIO_API }, null, 2),
          "utf8"
        );
        return json(res, { ok: true, gradioUrl: GRADIO, gradioApi: GRADIO_API });
      }
    }

    if (url.pathname === "/health") {
      let reachable = false;
      try {
        const r = await fetch(`${GRADIO}/config`, { signal: AbortSignal.timeout(4000) });
        reachable = r.ok;
      } catch {
        /* 远端暂时不可达 */
      }
      let spec = apiSpec;
      if (reachable && !spec) {
        try {
          spec = await discoverApi(true);
        } catch {
          spec = null;
        }
      }
      return json(res, {
        ok: reachable,
        engine: "node-gradio-proxy",
        mode: "gradio",
        gradio: GRADIO,
        api: GRADIO_API,
        inputs: spec?.length ?? 0,
        code_dir: "",
        model_dir: "",
        model_loaded: Boolean(reachable && spec),
        mock: false,
        gpu: null,
      });
    }

    if (url.pathname === "/v1/voices") {
      const voices = listVoices(url.searchParams.get("q") || undefined);
      return json(res, { voices, count: voices.length });
    }

    if (url.pathname === "/v1/voice-audio") {
      const p = resolveVoice(url.searchParams.get("path") || "");
      const buf = fs.readFileSync(p);
      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(buf);
    }

    if (url.pathname.startsWith("/v1/audio/")) {
      let decoded = url.pathname;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        /* 保留原路径 */
      }
      const name = path.basename(decoded);
      const p = path.join(OUT, name);
      if (!fs.existsSync(p)) return json(res, { error: "not found" }, 404);
      const type = name.endsWith(".srt")
        ? "text/plain; charset=utf-8"
        : name.endsWith(".zip")
          ? "application/zip"
          : "audio/wav";
      res.writeHead(200, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
      return res.end(fs.readFileSync(p));
    }

    if (url.pathname === "/v1/audio-delete" && req.method === "POST") {
      const body = await readBody(req);
      const name = path.basename(String(body.name || body.url || ""));
      if (!name) return json(res, { error: "缺少文件名" }, 400);
      const p = path.join(OUT, name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return json(res, { ok: true });
    }

    if (url.pathname === "/v1/voice-delete" && req.method === "POST") {
      const body = await readBody(req);
      const p = resolveVoice(String(body.path || ""));
      const trash = path.join(VOICES, ".trash");
      fs.mkdirSync(trash, { recursive: true });
      const dest = path.join(trash, `${path.basename(p)}-${Date.now()}`);
      fs.renameSync(p, dest);

      const meta = voiceMeta();
      const relative = path.relative(VOICES, p).split(path.sep).join("/");
      delete meta[relative];
      delete meta[path.basename(p)];
      fs.writeFileSync(path.join(VOICES, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

      return json(res, { ok: true, trash: dest });
    }

    if (url.pathname === "/v1/voice-update" && req.method === "POST") {
      const body = await readBody(req);
      const p = resolveVoice(String(body.path || ""));
      const relative = path.relative(VOICES, p).split(path.sep).join("/");
      const base = path.basename(p);
      const meta = voiceMeta();
      const current = meta[relative] || meta[base] || {};
      const next = { ...current };

      for (const key of ["name", "desc", "gender", "age"]) {
        if (body[key] !== undefined) next[key] = String(body[key]).trim();
      }

      meta[relative] = next;
      if (base !== relative) delete meta[base];
      fs.writeFileSync(path.join(VOICES, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

      return json(res, { ok: true, path: relative, meta: next });
    }

    if (url.pathname === "/v1/split" && req.method === "POST") {
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      const segments = text ? splitText(text) : [];
      return json(res, { segments, count: segments.length, characters: text.length, mode: "rules" });
    }

    if (url.pathname === "/v1/tts" && req.method === "POST") {
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      if (!text) return json(res, { error: "text 不能为空" }, 400);

      const r = await remoteTTS({
        text,
        voice: body.voice,
        emoVector: body.emo_vector,
        emoAlpha: body.emo_alpha,
        emoText: body.emo_text,
        lang: body.lang || "ZH",
        speed: body.speed,
      });
      return json(res, { ok: true, ...r, mode: "gradio" });
    }

    if (url.pathname === "/v1/merge" && req.method === "POST") {
      const body = await readBody(req);
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) return json(res, { error: "files 不能为空" }, 400);

      const chunks = [];
      let cursor = 0;
      for (let i = 0; i < files.length; i++) {
        const clip = loadClip(files[i]);
        chunks.push(clip);
        cursor += clip.length;
        const pause = Math.max(0, Number(body.pauses?.[i] || 0));
        if (pause > 0 && i < files.length - 1) {
          const silence = new Float32Array(Math.round(TARGET_SR * pause));
          chunks.push(silence);
          cursor += silence.length;
        }
      }

      const merged = concat(chunks);
      const name = safeOutputName(body.output_name, "merge");
      writeWav(path.join(OUT, `${name}.wav`), merged, TARGET_SR);
      return json(res, {
        ok: true,
        file: path.join(OUT, `${name}.wav`),
        url: `/v1/audio/${name}.wav`,
        duration: Math.round((merged.length / TARGET_SR) * 100) / 100,
        sample_rate: TARGET_SR,
      });
    }

    if (url.pathname === "/v1/export" && req.method === "POST") {
      const body = await readBody(req);
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length) return json(res, { error: "lines 不能为空" }, 400);

      const targetDb = Number.isFinite(Number(body.loudness)) ? Number(body.loudness) : -16;
      const formats = Array.isArray(body.formats) ? body.formats : ["wav", "srt", "stems"];
      const clips = lines.map((line) => ({
        samples: loadClip(line.file),
        speaker: String(line.speaker || "未知"),
        text: String(line.text || ""),
      }));

      const chunks = [];
      const entries = [];
      let cursor = 0;
      for (let i = 0; i < clips.length; i++) {
        chunks.push(clips[i].samples);
        const duration = clips[i].samples.length / TARGET_SR;
        entries.push({ start: cursor, end: cursor + duration, text: clips[i].text });
        cursor += duration;
        if (i < clips.length - 1) {
          const pause = Math.max(0, Number(body.pauses?.[i] || 0));
          if (pause > 0) {
            const silence = new Float32Array(Math.round(TARGET_SR * pause));
            chunks.push(silence);
            cursor += pause;
          }
        }
      }

      const master = normalize(concat(chunks), targetDb);
      const base = safeOutputName(body.output_name, "export");
      writeWav(path.join(OUT, `${base}.wav`), master, TARGET_SR);
      const files = { wav: `/v1/audio/${base}.wav` };

      if (formats.includes("srt")) {
        const rows = entries.map(
          (entry, i) =>
            `${i + 1}\n${srtTime(entry.start)} --> ${srtTime(entry.end)}\n${entry.text}\n`
        );
        fs.writeFileSync(path.join(OUT, `${base}.srt`), rows.join("\n"), "utf8");
        files.srt = `/v1/audio/${base}.srt`;
      }

      if (formats.includes("stems")) {
        const speakers = [];
        for (const clip of clips) {
          if (!speakers.includes(clip.speaker)) speakers.push(clip.speaker);
        }
        const zipEntries = [];
        for (const speaker of speakers) {
          const parts = [];
          for (const clip of clips) {
            if (clip.speaker !== speaker) continue;
            parts.push(clip.samples);
            parts.push(new Float32Array(Math.round(TARGET_SR * 0.25)));
          }
          const stem = normalize(concat(parts), targetDb);
          const stemName = `${safeOutputName(speaker, "speaker")}.wav`;
          writeWav(path.join(OUT, `${base}-${stemName}`), stem, TARGET_SR);
          zipEntries.push({
            name: stemName,
            data: fs.readFileSync(path.join(OUT, `${base}-${stemName}`)),
          });
        }
        writeZip(path.join(OUT, `${base}-stems.zip`), zipEntries);
        files.stems = `/v1/audio/${base}-stems.zip`;
      }

      return json(res, {
        ok: true,
        base,
        files,
        file: path.join(OUT, `${base}.wav`),
        duration: Math.round((master.length / TARGET_SR) * 100) / 100,
        lines: clips.length,
      });
    }

    if (url.pathname === "/v1/zip" && req.method === "POST") {
      const body = await readBody(req);
      const names = Array.isArray(body.files) ? body.files : [];
      if (!names.length) return json(res, { error: "files 不能为空" }, 400);
      const base = safeOutputName(body.output_name, "bundle");
      const entries = [];
      for (const name of names) {
        const file = path.join(OUT, path.basename(String(name || "")));
        if (fs.existsSync(file)) {
          entries.push({ name: path.basename(file), data: fs.readFileSync(file) });
        }
      }
      if (!entries.length) return json(res, { error: "没有可打包的音频" }, 400);
      const zipPath = path.join(OUT, `${base}.zip`);
      writeZip(zipPath, entries);
      return json(res, {
        ok: true,
        file: zipPath,
        url: `/v1/audio/${base}.zip`,
        count: entries.length,
      });
    }

    return json(res, { error: "not found" }, 404);
  } catch (e) {
    return json(res, { error: e.message || String(e) }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[shengkan] node proxy on http://127.0.0.1:${PORT} -> ${GRADIO}`);
  console.log(`[shengkan] voices: ${VOICES}`);
});
