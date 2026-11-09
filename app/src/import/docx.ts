import JSZip from "jszip";
import { chaptersFromText, type ImportedBook } from "./text";

function textOfParagraph(paragraph: Element) {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue || "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const local = (node as Element).localName;
    if (local === "t") {
      out += node.textContent || "";
      return;
    }
    if (local === "tab") {
      out += " ";
      return;
    }
    if (local === "br" || local === "cr") {
      out += "\n";
      return;
    }
    node.childNodes.forEach(walk);
  };
  paragraph.childNodes.forEach(walk);
  return out.replace(/\u00a0/g, " ").replace(/[ \t]+$/g, "").trim();
}

function coreTitle(xml: string) {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return (doc.getElementsByTagNameNS("*", "title")[0]?.textContent || "").trim();
  } catch {
    return "";
  }
}

export async function parseDocx(buffer: ArrayBuffer, fileName: string): Promise<ImportedBook> {
  const zip = await JSZip.loadAsync(buffer);
  const docEntry = zip.file("word/document.xml");
  if (!docEntry) throw new Error("不是有效的 DOCX：缺少 word/document.xml");

  const xml = await docEntry.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("DOCX 正文解析失败，文件可能已损坏");
  }

  const paragraphs = Array.from(doc.getElementsByTagNameNS("*", "p"))
    .map((p) => textOfParagraph(p))
    .filter((text) => text.length > 0);

  const text = paragraphs.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("DOCX 里没有找到可读正文，可能全是图片或表格");

  const core = zip.file("docProps/core.xml");
  const title =
    (core ? coreTitle(await core.async("string")) : "") ||
    fileName.replace(/\.[^.]+$/, "") ||
    "未命名项目";

  return {
    title,
    chapters: chaptersFromText(text, title),
    text,
    format: "docx",
  };
}
