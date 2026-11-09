import { parseEpub } from "./epub";
import { chaptersFromText, decodeText, type ImportedBook } from "./text";

export {
  splitChaptersRule,
  applyAiChapters,
  estimateSentences,
  isRealCharacter,
  mergeShortChapters,
} from "./text";
export type { ImportedBook, ImportedChapter } from "./text";

const EXT = /\.(txt|md|markdown|epub)$/i;

export function isSupportedFile(name: string) {
  return EXT.test(name);
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function readBookFile(file: File): Promise<ImportedBook> {
  const name = file.name || "未命名";
  if (!isSupportedFile(name)) {
    throw new Error("只支持 .txt、.md、.epub 文件");
  }

  const buffer = await file.arrayBuffer();
  if (/\.epub$/i.test(name)) {
    return parseEpub(buffer, name);
  }

  const text = decodeText(buffer);
  if (!text.trim()) throw new Error("文件是空的，或者编码无法识别");
  const title = name.replace(/\.[^.]+$/, "");
  const format = /\.md$|\.markdown$/i.test(name) ? "md" : "txt";
  return {
    title,
    chapters: chaptersFromText(text, title),
    text,
    format,
  };
}
