export interface LogInfo {
  file: string;
  size: number;
}

function bridge() {
  return typeof window !== "undefined" ? window.shengkan?.log : undefined;
}

export function log(scope: string, message: string, data?: unknown) {
  console.log(`[${scope}] ${message}`, data === undefined ? "" : data);
  bridge()?.write(scope, message, data);
}

export async function logInfo(): Promise<LogInfo | null> {
  return bridge()?.info() ?? null;
}

export async function openLog(): Promise<string | null> {
  return bridge()?.open() ?? null;
}
