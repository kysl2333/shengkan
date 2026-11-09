const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");
const ai = require("./ai.cjs");

const ENGINE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "engine")
  : path.join(__dirname, "..", "..", "engine");
const OUT = path.join(ENGINE_DIR, "outputs");
const VOICES = path.join(__dirname, "..", "..", "voices");
const CLOUD_DIR = path.join(VOICES, "cloud");
const CLOUD_JSON = path.join(VOICES, "cloud.json");
const PREVIEW_DIR = path.join(VOICES, ".preview");
const META_FILE = path.join(VOICES, "meta.json");
const TRASH_DIR = path.join(VOICES, ".trash");

const PRESETS = [
  {
    id: "mimo-bingtang",
    name: "冰糖",
    desc: "小米预置 · 中文女声 · 清亮自然",
    provider: "mimo",
    model: "mimo-v2.5-tts",
    voice: "冰糖",
    gender: "女",
    age: "青年",
  },
  {
    id: "mimo-moli",
    name: "茉莉",
    desc: "小米预置 · 中文女声 · 柔和",
    provider: "mimo",
    model: "mimo-v2.5-tts",
    voice: "茉莉",
    gender: "女",
    age: "青年",
  },
  {
    id: "mimo-suda",
    name: "苏打",
    desc: "小米预置 · 中文男声 · 清爽",
    provider: "mimo",
    model: "mimo-v2.5-tts",
    voice: "苏打",
    gender: "男",
    age: "青年",
  },
  {
    id: "mimo-baihua",
    name: "白桦",
    desc: "小米预置 · 中文男声 · 沉稳",
    provider: "mimo",
    model: "mimo-v2.5-tts",
    voice: "白桦",
    gender: "男",
    age: "中年",
  },
  {
    id: "mimo-mia",
    name: "Mia",
    desc: "小米预置 · 英文女声",
    provider: "mimo",
    model: "mimo-v2.5-tts",
    voice: "Mia",
    gender: "女",
    age: "青年",
  },
  {
    id: "mimo-chloe",
    name: "Chloe",
    desc: "小米预置 · 英文女声",
    provider: "mimo",
    model: "mimo-v2.5-tts",
    voice: "Chloe",
    gender: "女",
    age: "青年",
  },
  {
    id: "mimo-milo",
    name: "Milo",
    desc: "小米预置 · 英文男声",
    provider: "mimo",
    model: "mimo-v2.5-tts",
    voice: "Milo",
    gender: "男",
    age: "青年",
  },
  {
    id: "mimo-dean",
    name: "Dean",
    desc: "小米预置 · 英文男声",
    provider: "mimo",
    model: "mimo-v2.5-tts",
    voice: "Dean",
    gender: "男",
    age: "中年",
  },
];

function readCloud() {
  try {
    return JSON.parse(fs.readFileSync(CLOUD_JSON, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return [];
  }
}

function writeCloud(list) {
  fs.mkdirSync(VOICES, { recursive: true });
  fs.writeFileSync(CLOUD_JSON, JSON.stringify(list, null, 2), "utf8");
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function writeMeta(meta) {
  fs.mkdirSync(VOICES, { recursive: true });
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), "utf8");
}

function moveToTrash(file) {
  if (!fs.existsSync(file)) return "";
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  const dest = path.join(TRASH_DIR, `${path.basename(file)}-${Date.now()}`);
  fs.renameSync(file, dest);
  return dest;
}

function metaFor(record) {
  return {
    name: record.name,
    desc: record.desc,
    gender: record.gender || "",
    age: record.age || "",
    category: record.category || "AI 设计",
  };
}

function relPath(file) {
  return path.relative(VOICES, file).split(path.sep).join("/");
}

function safeName(name) {
  return String(name || "voice")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 20) || "voice";
}

function localSample(name, id) {
  return `${safeName(name)}-${id}.wav`;
}

function findLocalSample(id) {
  try {
    const suffix = `-${id}.wav`;
    const hit = fs
      .readdirSync(VOICES, { withFileTypes: true })
      .find((entry) => entry.isFile() && entry.name.endsWith(suffix));
    return hit?.name || "";
  } catch {
    return "";
  }
}

function list() {
  const all = [
    ...PRESETS,
    ...readCloud().map((item) => ({ ...item, provider: "mimo" })),
  ];

  return all.map((item) => {
    const local = findLocalSample(item.id);
    return {
      ...item,
      name: String(item.name || "AI 音色"),
      localPath: local || undefined,
    };
  });
}

async function materialize(id) {
  const item = list().find((voice) => voice.id === id);
  if (!item) throw new Error("找不到云音色");

  const local = findLocalSample(item.id) || localSample(item.name, item.id);
  const dest = path.join(VOICES, local);

  if (!fs.existsSync(dest)) {
    let src = item.voice;
    if (!src || !path.isAbsolute(src) || !fs.existsSync(src)) {
      const isEnglish = ["mimo-mia", "mimo-chloe", "mimo-milo", "mimo-dean"].includes(item.id);
      const text = isEnglish ? "Hello, this is a voice sample." : "你好，这是音色样本。";
      const r = await synthesize({ text, model: item.model, voice: item.voice });
      src = r.file;
    }
    fs.copyFileSync(src, dest);
  }

  const meta = readMeta();
  if (!meta[local]) {
    meta[local] = metaFor({
      ...item,
      name: `${item.name}（本地样本）`,
      category: item.model === "mimo-v2.5-tts" ? "小米预置" : "AI 克隆",
    });
    writeMeta(meta);
  }

  return { ...item, localPath: local };
}

function safeVoiceFile(file) {
  const resolved = path.resolve(String(file || ""));
  const root = path.resolve(VOICES);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("参考音频必须在 voices 目录里");
  }
  if (!fs.existsSync(resolved)) throw new Error(`参考音频不存在：${file}`);
  return resolved;
}

async function chatAudio({ model, messages, audio }) {
  const cfg = ai.readAiConfig();
  if (!cfg.apiKey) throw new Error("还没有配置 MiMo API Key，请到设置里填写");

  const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": cfg.apiKey,
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model, messages, audio, stream: false }),
    signal: AbortSignal.timeout(120000),
  });

  const raw = await r.text();
  if (!r.ok) {
    let detail = raw.slice(0, 400);
    try {
      detail = JSON.parse(raw)?.error?.message || detail;
    } catch {
      /* 保留原始文本 */
    }
    throw new Error(`云 TTS 请求失败 HTTP ${r.status}：${detail}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("云 TTS 返回的不是 JSON");
  }

  const encoded = data.choices?.[0]?.message?.audio?.data;
  if (!encoded) throw new Error("云 TTS 没有返回音频");
  return Buffer.from(encoded, "base64");
}

function instructionFor(payload) {
  const emotion = String(payload.instruction || "").trim();
  if (emotion) return emotion;
  return "";
}

async function synthesize(payload) {
  const text = String(payload.text || "").trim();
  if (!text) throw new Error("text 不能为空");

  const model = payload.model || "mimo-v2.5-tts";
  const voice = payload.voice;
  if (!voice) throw new Error("缺少音色");

  const messages = [];
  const instruction = instructionFor(payload);
  if (instruction) messages.push({ role: "user", content: instruction });
  messages.push({ role: "assistant", content: text });

  let voiceParam = voice;
  if (model === "mimo-v2.5-tts-voiceclone") {
    const file = safeVoiceFile(voice);
    const base64 = fs.readFileSync(file).toString("base64");
    const mime = file.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    voiceParam = `data:${mime};base64,${base64}`;
  }

  const buf = await chatAudio({
    model,
    messages,
    audio: { format: "wav", voice: voiceParam },
  });

  fs.mkdirSync(OUT, { recursive: true });
  const name = `cloud-${crypto.randomUUID()}.wav`;
  fs.writeFileSync(path.join(OUT, name), buf);
  return { file: path.join(OUT, name), url: `/v1/audio/${name}` };
}

async function designPreview(payload) {
  let suggestion = null;
  let description = String(payload.description || "").trim();
  let previewText = String(payload.previewText || "").trim();
  let name = String(payload.name || "").trim();

  if (payload.prompt) {
    suggestion = await ai.suggestVoice(payload.prompt);
    description = suggestion.description;
    previewText = suggestion.previewText;
    name = name || suggestion.name;
  }
  if (!description) throw new Error("请填写音色描述");
  if (!previewText) previewText = "你好，这是音色试听。";

  const buf = await chatAudio({
    model: "mimo-v2.5-tts-voicedesign",
    messages: [
      { role: "user", content: description },
      { role: "assistant", content: previewText },
    ],
    audio: { format: "wav" },
  });

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const tempId = `preview-${Date.now().toString(36)}`;
  const file = path.join(PREVIEW_DIR, `${tempId}.wav`);
  fs.writeFileSync(file, buf);

  return {
    tempId,
    name: name || "AI 音色",
    description,
    previewText,
    gender: suggestion?.gender || String(payload.gender || ""),
    age: suggestion?.age || String(payload.age || ""),
    previewUrl: `/v1/voice-audio?path=.preview/${tempId}.wav`,
  };
}

async function saveDesign(payload) {
  const tempId = path.basename(String(payload.tempId || ""));
  if (!tempId) throw new Error("缺少试听临时文件");
  const src = path.join(PREVIEW_DIR, `${tempId}.wav`);
  if (!fs.existsSync(src)) throw new Error("试听文件已失效，请重新生成");

  const id = `design-${Date.now().toString(36)}`;
  const dest = path.join(CLOUD_DIR, `${id}.wav`);
  fs.mkdirSync(CLOUD_DIR, { recursive: true });
  fs.copyFileSync(src, dest);

  const record = {
    id,
    name: String(payload.name || "AI 音色").slice(0, 12),
    desc: String(payload.description || "").trim(),
    model: "mimo-v2.5-tts-voiceclone",
    voice: dest,
    gender: String(payload.gender || ""),
    age: String(payload.age || ""),
    createdAt: new Date().toISOString(),
  };

  const list = readCloud();
  list.push(record);
  writeCloud(list);

  const meta = readMeta();
  meta[`cloud/${path.basename(dest)}`] = metaFor(record);
  writeMeta(meta);

  return {
    ...record,
    provider: "mimo",
    localPath: relPath(dest),
    previewUrl: `/v1/voice-audio?path=cloud/${path.basename(dest)}`,
  };
}

function remove(id) {
  const item = list().find((voice) => voice.id === id);
  if (!item) throw new Error("找不到云音色");

  const saved = readCloud();
  const record = saved.find((voice) => voice.id === id);
  if (!record) throw new Error("预置音色不能删除");

  const moved = record.voice && fs.existsSync(record.voice) ? moveToTrash(record.voice) : "";
  writeCloud(saved.filter((voice) => voice.id !== id));

  const meta = readMeta();
  delete meta[`cloud/${path.basename(record.voice)}`];
  writeMeta(meta);

  return { ok: true, moved };
}

function update(id, payload) {
  const list = readCloud();
  const record = list.find((voice) => voice.id === id);
  if (!record) throw new Error("预置音色不能直接编辑，先保存成设计音色");

  if (payload.name !== undefined) record.name = String(payload.name).trim().slice(0, 20);
  if (payload.desc !== undefined) record.desc = String(payload.desc).trim();
  if (payload.gender !== undefined) record.gender = String(payload.gender).trim();
  if (payload.age !== undefined) record.age = String(payload.age).trim();
  writeCloud(list);

  const meta = readMeta();
  const key = `cloud/${path.basename(record.voice)}`;
  if (meta[key]) {
    meta[key] = metaFor(record);
    writeMeta(meta);
  }

  const local = findLocalSample(record.id);
  return {
    ...record,
    provider: "mimo",
    localPath: local || undefined,
  };
}

module.exports = {
  list,
  synthesize,
  designPreview,
  saveDesign,
  materialize,
  remove,
  update,
};
