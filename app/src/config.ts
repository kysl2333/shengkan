export interface EngineConfig {
  mode: "gradio" | "local";
  gradioUrl: string;
  gradioApi: string;
  voiceLib: string;
  python: string;
  indexttsCodeDir: string;
  indexttsModelDir: string;
  indexttsVersion: "2.5" | "2.0";
}

const KEY = "shengkan:engine-config";

const DEFAULTS: EngineConfig = {
  mode: "gradio",
  gradioUrl: "http://192.168.3.68:7860",
  gradioApi: "gen_single",
  voiceLib: "",
  python: "",
  indexttsCodeDir: "",
  indexttsModelDir: "",
  indexttsVersion: "2.5",
};

export async function getEngineConfig(): Promise<EngineConfig> {
  if (window.shengkan?.config) return window.shengkan.config.get();
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setEngineConfig(cfg: EngineConfig): Promise<EngineConfig> {
  if (window.shengkan?.config) return window.shengkan.config.set(cfg);
  localStorage.setItem(KEY, JSON.stringify(cfg));
  return cfg;
}
