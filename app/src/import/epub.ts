import JSZip from "jszip";
import type { ImportedBook, ImportedChapter } from "./text";

interface NavEntry {
  file: string;
  fragment: string;
  title: string;
}

const TITLE_LIKE =
  /^(第[0-9零〇一二三四五六七八九十百千万两]+[章回节卷部篇集]|序章|楔子|引子|前言|序言|后记|尾声|终章|番外|chapter|part|prologue|epilogue)/i;

const SKIP_TITLE = /^(cover|title\s*page|titlepage|copyright|contents|table of contents|目录|版权|封面|扉页)/i;

const FRONT_MATTER =
  /(ISBN|版权所有|出版发行|制作信息|插图|插画|作者[:：]|译者|Copyright|All rights reserved|图书在版编目|定价|开本|印张)/i;

function isFrontMatter(body: string) {
  if (body.length > 1200) return false;
  const hits = (body.match(FRONT_MATTER) || []).length;
  return hits >= 2 || (body.length < 300 && hits >= 1);
}

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "div", "dl", "dt", "dd",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

function byLocal(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((el) => el.localName === name);
}

function parseXml(text: string, label: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error(`${label} 解析失败，文件可能已损坏`);
  }
  return doc;
}

function resolvePath(baseFile: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0]).replace(/\\/g, "/");
  if (!clean) return baseFile;
  const parts = baseFile.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function textOf(node: Node | null): string {
  return (node?.textContent || "").replace(/\s+/g, " ").trim();
}

function nodeToText(root: Node): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.nodeValue || "");
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName.toLowerCase();
      if (["rt", "rp", "img", "image", "svg", "figure", "figcaption"].includes(tag)) return;
      if (tag === "br") {
        out.push("\n");
        return;
      }
      const block = BLOCK_TAGS.has(tag);
      if (block) out.push("\n");
      node.childNodes.forEach(walk);
      if (block) out.push("\n");
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(root);

  return out
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sliceRange(doc: Document, start: Element, end: Element | null): string {
  const range = doc.createRange();
  range.setStartBefore(start);
  if (end) range.setEndBefore(end);
  else range.setEnd(doc.body, doc.body.childNodes.length);

  const holder = doc.createElement("div");
  holder.appendChild(range.cloneContents());
  return nodeToText(holder);
}

function firstHeading(doc: Document): string {
  const el = doc.querySelector("h1,h2,h3");
  return textOf(el);
}

function chapterTitle(navTitle: string, body: string, heading: string) {
  const firstLine = body.split("\n").map((s) => s.trim()).find(Boolean) || heading;
  if (firstLine && firstLine.length <= 60 && TITLE_LIKE.test(firstLine)) return firstLine;
  if (navTitle) return navTitle;
  if (firstLine && firstLine.length <= 60) return firstLine;
  return "";
}

function stripTitleLine(body: string, title: string) {
  if (!title) return body;
  const lines = body.split("\n");
  if (lines[0]?.trim() === title) {
    return lines.slice(1).join("\n").trim();
  }
  if (lines[0] && TITLE_LIKE.test(title) && TITLE_LIKE.test(lines[0].trim())) {
    return lines.slice(1).join("\n").trim();
  }
  return body;
}

async function readEntry(zip: JSZip, path: string) {
  const direct = zip.file(path);
  if (direct) return direct;
  const lower = path.toLowerCase();
  const hit = Object.keys(zip.files).find((k) => k.toLowerCase() === lower);
  return hit ? zip.file(hit) : null;
}

function addNav(entries: NavEntry[], baseFile: string, href: string | null, label: string) {
  if (!href) return;
  const clean = href.split("#");
  const file = resolvePath(baseFile, clean[0] || baseFile);
  const fragment = clean[1] ? decodeURIComponent(clean[1]) : "";
  const title = label.replace(/\s+/g, " ").trim();
  if (title) entries.push({ file, fragment, title });
}

async function navEntriesNav(zip: JSZip, navPath: string, entries: NavEntry[]) {
  const entry = await readEntry(zip, navPath);
  if (!entry) return;

  const doc = new DOMParser().parseFromString(await entry.async("string"), "text/html");
  const navs = Array.from(doc.getElementsByTagName("nav"));
  const typeOf = (nav: Element) =>
    `${nav.getAttributeNS("http://www.idpf.org/2007/ops", "type") || nav.getAttribute("epub:type") || nav.getAttribute("type") || ""}`;
  const withLinks = navs
    .map((nav) => ({ nav, links: nav.querySelectorAll("a[href]").length }))
    .filter((item) => item.links > 0)
    .sort((a, b) => {
      const at = /toc/i.test(typeOf(a.nav)) ? 1 : 0;
      const bt = /toc/i.test(typeOf(b.nav)) ? 1 : 0;
      return bt - at || b.links - a.links;
    });
  const toc = withLinks[0]?.nav;
  if (!toc) return;

  for (const a of Array.from(toc.querySelectorAll("a[href]"))) {
    addNav(entries, navPath, a.getAttribute("href"), textOf(a));
  }
}

async function navEntriesNcx(zip: JSZip, ncxPath: string, entries: NavEntry[]) {
  const entry = await readEntry(zip, ncxPath);
  if (!entry) return;

  const doc = parseXml(await entry.async("string"), "EPUB 目录");
  const walk = (parent: Element) => {
    for (const point of Array.from(parent.children).filter((c) => c.localName === "navPoint")) {
      const label = textOf(byLocal(point, "text")[0]);
      const src = byLocal(point, "content")[0]?.getAttribute("src") || null;
      addNav(entries, ncxPath, src, label);
      walk(point);
    }
  };
  const navMap = byLocal(doc, "navMap")[0];
  if (navMap) walk(navMap);
}

function navTitleFor(entries: NavEntry[], path: string) {
  return (
    entries.find((e) => e.file === path && !e.fragment)?.title ||
    entries.find((e) => e.file === path)?.title ||
    ""
  );
}

export async function parseEpub(buffer: ArrayBuffer, fileName: string): Promise<ImportedBook> {
  const zip = await JSZip.loadAsync(buffer);

  const containerEntry = await readEntry(zip, "META-INF/container.xml");
  if (!containerEntry) throw new Error("不是有效的 EPUB：缺少 container.xml");

  const container = parseXml(await containerEntry.async("string"), "EPUB container");
  const opfPath = byLocal(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("不是有效的 EPUB：找不到 OPF 文件");

  const opfEntry = await readEntry(zip, opfPath);
  if (!opfEntry) throw new Error(`EPUB 缺少 OPF 文件：${opfPath}`);
  const opf = parseXml(await opfEntry.async("string"), "EPUB OPF");

  const title = textOf(byLocal(opf, "title")[0]) || fileName.replace(/\.[^.]+$/, "");

  const items = byLocal(opf, "item").map((el) => ({
    id: el.getAttribute("id") || "",
    href: el.getAttribute("href") || "",
    type: el.getAttribute("media-type") || "",
    properties: el.getAttribute("properties") || "",
  }));
  const byId = new Map(items.map((item) => [item.id, item]));

  const spine = byLocal(opf, "itemref")
    .filter((el) => el.getAttribute("linear") !== "no")
    .map((el) => byId.get(el.getAttribute("idref") || ""))
    .filter((item): item is (typeof items)[number] => !!item);

  const navItem = items.find((i) => i.properties.split(/\s+/).includes("nav"));
  const ncxItem = items.find((i) => i.type === "application/x-dtbncx+xml");

  const navEntries: NavEntry[] = [];
  if (navItem) await navEntriesNav(zip, resolvePath(opfPath, navItem.href), navEntries);
  if (!navEntries.length && ncxItem) {
    await navEntriesNcx(zip, resolvePath(opfPath, ncxItem.href), navEntries);
  }

  const navByFile = new Map<string, NavEntry[]>();
  for (const entry of navEntries) {
    const list = navByFile.get(entry.file) || [];
    list.push(entry);
    navByFile.set(entry.file, list);
  }

  const navFile = navItem ? resolvePath(opfPath, navItem.href) : "";
  const chapters: ImportedChapter[] = [];
  const used = new Set<string>();

  for (const item of spine) {
    if (!/html|xhtml/i.test(item.type) && !/\.x?html?$/i.test(item.href)) continue;
    const path = resolvePath(opfPath, item.href);
    if (path === navFile || used.has(path)) continue;
    used.add(path);

    const entry = await readEntry(zip, path);
    if (!entry) continue;

    const html = await entry.async("string");
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style,svg,noscript,iframe,img,figure,figcaption").forEach((el) => el.remove());

    const heading = firstHeading(doc);
    const entries = navByFile.get(path) || [];
    const findAnchor = (fragment: string) => {
      const direct = doc.getElementById(fragment);
      if (direct) return direct;
      let decoded = fragment;
      try {
        decoded = decodeURIComponent(fragment);
      } catch {
        /* 保留原值 */
      }
      return (
        Array.from(doc.querySelectorAll("[id],[name]")).find(
          (el) => el.id === decoded || el.getAttribute("name") === decoded
        ) || null
      );
    };

    const anchors = entries
      .map((e) => ({
        title: e.title,
        el: e.fragment ? findAnchor(e.fragment) : null,
      }))
      .filter((e): e is { title: string; el: Element } => !!e.el);

    anchors.sort((a, b) =>
      a.el === b.el
        ? 0
        : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1
    );

    if (anchors.length >= 2) {
      for (let i = 0; i < anchors.length; i++) {
        const body = sliceRange(doc, anchors[i].el, anchors[i + 1]?.el ?? null);
        const chapter = chapterTitle(anchors[i].title, body, heading);
        if (!chapter || SKIP_TITLE.test(chapter)) continue;
        const clean = stripTitleLine(body, chapter);
        if (!clean || isFrontMatter(clean)) continue;
        chapters.push({ title: chapter, body: clean });
      }
      continue;
    }

    let body = nodeToText(doc.body);
    if (!body) continue;

    const chapter = chapterTitle(
      navTitleFor(navEntries, path) || anchors[0]?.title || "",
      body,
      heading
    );
    if (!chapter || SKIP_TITLE.test(chapter)) continue;

    body = stripTitleLine(body, chapter);
    if (!body || isFrontMatter(body)) continue;
    chapters.push({ title: chapter, body });
  }

  if (!chapters.length) throw new Error("EPUB 里没有找到可读正文，可能是纯图片排版");

  return {
    title,
    chapters,
    text: chapters.map((c) => `${c.title}\n\n${c.body}`).join("\n\n"),
    format: "epub",
    tocCount: new Set(navEntries.map((e) => `${e.file}#${e.fragment}`)).size,
  };
}
