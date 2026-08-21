import { resolveArxivIdForItemID } from "../context/arxiv-id";
import {
  arxivFolderPath,
  readArxivMeta,
} from "../context/arxiv-store";
import { appendLocalPath } from "../utils/local-path";
import type { WebAgentAttachment } from "./web-agent-client";
import type { Message } from "../providers/types";

export interface WebPaperMaterial {
  paperUrl: string;
  attachment?: WebAgentAttachment;
}

export async function createWebContextAttachment(
  history: Message[],
): Promise<WebAgentAttachment | undefined> {
  const seen = new Set<string>();
  const completed = history.filter((message) => {
    if (!message.content.trim()) return false;
    const key = `${message.role}\u0000${message.content.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!completed.length) return undefined;
  const root = (Zotero as any).DataDirectory?.dir;
  const io = (globalThis as any).IOUtils;
  if (!root || !io?.writeUTF8 || !io?.makeDirectory) return undefined;
  const token = (Zotero as any).Utilities?.randomString?.(10) || String(Date.now());
  const dir = appendLocalPath(root, "zai-web-context");
  const name = `zai-web-context-${Date.now()}-${token}.txt`;
  const path = appendLocalPath(dir, name);
  await io.makeDirectory(dir, { createAncestors: true });
  const historyBody = completed
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content.trim()}`)
    .join("\n\n");
  const body = `## 前序 Zotero 对话\n${historyBody}`;
  await io.writeUTF8(path, body);
  return { kind: "text", path, name, mimeType: "text/plain" };
}

export async function createWebTocAttachment(
  arxivToc: string | null | undefined,
): Promise<WebAgentAttachment | undefined> {
  const directory = webArxivTocDirectory(arxivToc);
  if (!directory) return undefined;
  const root = (Zotero as any).DataDirectory?.dir;
  const io = (globalThis as any).IOUtils;
  if (!root || !io?.writeUTF8 || !io?.makeDirectory) return undefined;
  const token = (Zotero as any).Utilities?.randomString?.(10) || String(Date.now());
  const dir = appendLocalPath(root, "zai-web-context");
  const name = `zai-arxiv-toc-${Date.now()}-${token}.txt`;
  const path = appendLocalPath(dir, name);
  await io.makeDirectory(dir, { createAncestors: true });
  await io.writeUTF8(path, `## arXiv 论文目录\n${directory}`);
  return { kind: "text", path, name, mimeType: "text/plain" };
}

export function webArxivTocDirectory(
  arxivToc: string | null | undefined,
): string {
  if (!arxivToc?.trim()) return "";
  const lines = arxivToc.split(/\r?\n/);
  const directoryStart = lines.findIndex((line) =>
    line.startsWith("Sections (number · title · body chars):"),
  );
  if (directoryStart < 0) return "";
  return lines
    .slice(directoryStart + 1)
    .map((line) =>
      line
        .replace(/\s+\{[^{}\n]+\}(?=\s+\(\d+ chars\)\s*$)/, "")
        .replace(/\s+\(\d+ chars\)\s*$/, ""),
    )
    .filter((line) => line.trim())
    .join("\n");
}

interface ZoteroWebItem {
  id?: number;
  parentID?: number;
  attachmentContentType?: string;
  getField?(field: string): string;
  getAttachments?(): number[];
  isAttachment?(): boolean;
  isPDFAttachment?(): boolean;
  getFilePathAsync?(): Promise<string | false>;
}

export async function resolveWebPaperMaterial(
  itemID: number | null,
): Promise<WebPaperMaterial> {
  if (itemID == null) return { paperUrl: "" };
  const selected = getItem(itemID);
  if (!selected) return { paperUrl: "" };
  const root =
    typeof selected.parentID === "number"
      ? getItem(selected.parentID) || selected
      : selected;
  const arxivId = resolveArxivIdForItemID(itemID);
  const paperUrl = canonicalPaperUrl(root, selected, arxivId);

  if (arxivId) {
    const meta = await readArxivMeta(arxivId);
    if (meta?.status === "ok" && meta.mainTexRelPath) {
      const path = appendLocalPath(
        arxivFolderPath(arxivId),
        "source",
        meta.mainTexRelPath,
      );
      if (await pathExists(path)) {
        return {
          paperUrl,
          attachment: {
            kind: "latex",
            path,
            name: fileName(path) || "main.tex",
            mimeType: "text/plain",
          },
        };
      }
    }
  }

  const pdf = await firstPdfAttachment(root, selected);
  return pdf ? { paperUrl, attachment: pdf } : { paperUrl };
}

function canonicalPaperUrl(
  root: ZoteroWebItem,
  selected: ZoteroWebItem,
  arxivId: string | null,
): string {
  if (arxivId) return `https://arxiv.org/abs/${arxivId}`;
  const doi = itemField(root, "DOI") || itemField(selected, "DOI");
  if (doi) {
    const normalized = doi
      .trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "");
    if (normalized) return `https://doi.org/${normalized}`;
  }
  return itemField(root, "url") || itemField(selected, "url");
}

async function firstPdfAttachment(
  root: ZoteroWebItem,
  selected: ZoteroWebItem,
): Promise<WebAgentAttachment | undefined> {
  const candidates = isPdf(selected)
    ? [selected]
    : (root.getAttachments?.() ?? [])
        .map((id) => getItem(id))
        .filter((item): item is ZoteroWebItem => !!item && isPdf(item));
  for (const item of candidates) {
    const path = await item.getFilePathAsync?.();
    if (path && (await pathExists(path))) {
      return {
        kind: "pdf",
        path,
        name: fileName(path) || "paper.pdf",
        mimeType: "application/pdf",
      };
    }
  }
  return undefined;
}

function isPdf(item: ZoteroWebItem): boolean {
  return (
    item.isPDFAttachment?.() === true ||
    item.attachmentContentType === "application/pdf"
  );
}

function itemField(item: ZoteroWebItem, field: string): string {
  try {
    const value = item.getField?.(field);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function getItem(id: number): ZoteroWebItem | null {
  try {
    return ((Zotero as any).Items?.get?.(id) as ZoteroWebItem) || null;
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const exists = (globalThis as any).IOUtils?.exists;
    return typeof exists === "function" ? await exists(path) : true;
  } catch {
    return false;
  }
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? "";
}
