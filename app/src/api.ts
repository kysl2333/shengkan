export function getEngine() {
  try {
    return localStorage.getItem("shengkan:engine") || "http://127.0.0.1:8290";
  } catch {
    return "http://127.0.0.1:8290";
  }
}

export const ENGINE = getEngine();

export interface Health {
  ok: boolean;
  engine: string;
  code_dir: string;
  model_dir: string;
  model_loaded: boolean;
  gpu?: { name: string; free_gb: number; used_gb?: number; total_gb: number };
}

export interface VoiceItem {
  name: string;
  displayName?: string;
  desc?: string;
  gender?: string;
  age?: string;
  path: string;
  category: string;
  size: number;
}

export interface Segment {
  speaker: string;
  text: string;
  emotion: string;
  confidence: number;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(body || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export function getHealth() {
  return json<Health>(`${ENGINE}/health`);
}

export function getVoices(q?: string) {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  return json<{ voices: VoiceItem[]; count: number }>(`${ENGINE}/v1/voices${suffix}`);
}

export function splitText(text: string) {
  return json<{ segments: Segment[]; count: number; characters: number; mode: string }>(
    `${ENGINE}/v1/split`,
    { method: "POST", body: JSON.stringify({ text }) }
  );
}

export function synthesize(payload: {
  text: string;
  voice: string;
  lang?: string;
  emo_vector?: number[];
  emo_alpha?: number;
  emo_text?: string;
}) {
  return json<{ ok: boolean; file: string; url: string }>(`${ENGINE}/v1/tts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function exportAudio(payload: {
  lines: { file: string; speaker: string; text: string }[];
  pauses?: number[];
  loudness?: number;
  formats?: string[];
  output_name?: string;
}) {
  return json<{
    ok: boolean;
    base: string;
    files: { wav: string; srt?: string; stems?: string };
    duration: number;
    lines: number;
  }>(`${ENGINE}/v1/export`, { method: "POST", body: JSON.stringify(payload) });
}

export function audioUrl(url: string) {
  return url.startsWith("http") ? url : `${ENGINE}${url}`;
}

export function deleteAudio(url?: string) {
  const name = String(url || "").split("/").filter(Boolean).pop();
  if (!name) return Promise.resolve({ ok: true });
  return json<{ ok: boolean }>(`${ENGINE}/v1/audio-delete`, {
    method: "POST",
    body: JSON.stringify({ name }),
  }).catch(() => ({ ok: false }));
}

export function deleteVoice(path?: string) {
  if (!path) return Promise.resolve({ ok: true });
  return json<{ ok: boolean; trash?: string }>(`${ENGINE}/v1/voice-delete`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function updateVoice(
  path: string,
  payload: { name?: string; desc?: string; gender?: string; age?: string }
) {
  return json<{ ok: boolean; path: string; meta: Record<string, string> }>(
    `${ENGINE}/v1/voice-update`,
    { method: "POST", body: JSON.stringify({ path, ...payload }) }
  );
}
