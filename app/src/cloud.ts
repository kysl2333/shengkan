export interface CloudVoice {
  id: string;
  name: string;
  desc: string;
  provider: string;
  model: string;
  voice: string;
  gender?: string;
  age?: string;
  previewUrl?: string;
  localPath?: string;
}

export interface CloudTTSPayload {
  text: string;
  model: string;
  voice: string;
  instruction?: string;
}

export interface CloudDesignPreview {
  tempId: string;
  name: string;
  description: string;
  previewText: string;
  gender: string;
  age: string;
  previewUrl: string;
}

function bridge() {
  return typeof window !== "undefined" ? window.shengkan?.cloud : undefined;
}

export async function listCloudVoices(): Promise<CloudVoice[]> {
  const b = bridge();
  if (!b) return [];
  return b.list();
}

export async function cloudTTS(payload: CloudTTSPayload): Promise<{ file: string; url: string }> {
  const b = bridge();
  if (!b) throw new Error("云 TTS 只在桌面版可用");
  return b.tts(payload);
}

export async function materializeCloudVoice(id: string): Promise<CloudVoice> {
  const b = bridge();
  if (!b) throw new Error("云音色只在桌面版可用");
  return b.materialize(id);
}

export async function removeCloudVoice(id: string): Promise<{ ok: boolean; moved: string }> {
  const b = bridge();
  if (!b) throw new Error("云音色只在桌面版可用");
  return b.remove(id);
}

export async function updateCloudVoice(
  id: string,
  payload: { name?: string; desc?: string; gender?: string; age?: string }
): Promise<CloudVoice> {
  const b = bridge();
  if (!b) throw new Error("云音色只在桌面版可用");
  return b.update(id, payload);
}

export async function designCloudPreview(payload: {
  prompt?: string;
  description?: string;
  previewText?: string;
  name?: string;
}): Promise<CloudDesignPreview> {
  const b = bridge();
  if (!b) throw new Error("音色设计只在桌面版可用");
  return b.designPreview(payload);
}

export async function saveCloudDesign(payload: {
  tempId: string;
  name: string;
  description: string;
  gender?: string;
  age?: string;
}): Promise<CloudVoice> {
  const b = bridge();
  if (!b) throw new Error("音色设计只在桌面版可用");
  return b.saveDesign(payload);
}
