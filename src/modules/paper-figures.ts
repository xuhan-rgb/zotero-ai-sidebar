import { resolveArxivIdForItemID } from "../context/arxiv-id";
import {
  arxivFolderPath,
  matchSourceAssetFile,
  mediaTypeForSourceAsset,
  readArxivMeta,
  readArxivMainText,
} from "../context/arxiv-store";
import { parseFigures } from "../context/tex-figures";
import { appendLocalPath } from "../utils/local-path";
import {
  loadMineruCache,
  mineruCacheFolder,
  readPdfStat,
} from "../translate/mineru-store";

export interface PaperFigure {
  id: string;
  label: string;
  caption: string;
  /** Absolute path of the image on disk. */
  path: string;
  mediaType: string;
}

interface ZoteroFigureItem {
  key?: string;
  parentID?: number;
  isPDFAttachment?: () => boolean;
  attachmentContentType?: string;
  getField?: (field: string) => unknown;
  getAttachments?: () => number[];
  getFilePathAsync?: () => Promise<string | undefined>;
}

/**
 * Figures and tables that already exist on disk for this paper: MinerU's
 * extracted images when the PDF has been parsed, otherwise the LaTeX figure
 * files of an arXiv source.
 */
export async function loadPaperFigures(
  itemID: number | null,
): Promise<PaperFigure[]> {
  if (itemID == null) return [];
  const mineru = await mineruFigures(itemID);
  return mineru.length ? mineru : await latexFigures(itemID);
}

export async function readPaperFigureBytes(
  figure: PaperFigure,
): Promise<Uint8Array | null> {
  const io = zoteroIO();
  try {
    return await io.read(figure.path);
  } catch {
    return null;
  }
}

export async function readPaperFigureDataUrl(
  figure: PaperFigure,
): Promise<string | null> {
  const bytes = await readPaperFigureBytes(figure);
  if (!bytes) return null;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${figure.mediaType};base64,${btoa(binary)}`;
}

export function paperFigureFileName(figure: PaperFigure): string {
  const base = figure.path.split(/[\\/]/).pop() || "figure";
  const stem = base.replace(/\.[^.]+$/, "") || "figure";
  return `${figure.label.replace(/[^\w\u4e00-\u9fa5]+/g, "-")}-${stem}${extensionOf(base)}`;
}

async function mineruFigures(itemID: number): Promise<PaperFigure[]> {
  const selected = getItem(itemID);
  if (!selected) return [];
  const root =
    typeof selected.parentID === "number"
      ? getItem(selected.parentID) || selected
      : selected;
  const itemKey = root.key || selected.key || "";
  const pdfPath = await firstPdfPath(root, selected);
  if (!itemKey || !pdfPath) return [];
  try {
    const stat = await readPdfStat(pdfPath);
    const cache = await loadMineruCache(itemKey, stat.size, stat.mtime);
    if (!cache?.contentList) return [];
    const folder = appendLocalPath(mineruCacheFolder(itemKey), "assets");
    const io = zoteroIO();
    const figures: PaperFigure[] = [];
    for (const item of contentListItems(cache.contentList)) {
      const asset = mineruAssetPath(item.img_path);
      if (!asset) continue;
      const kind = stringValue(item.type).toLowerCase();
      if (!["image", "figure", "chart", "table"].includes(kind)) continue;
      const path = appendLocalPath(folder, asset);
      if (!(await io.exists(path))) continue;
      const caption = captionText(item);
      figures.push({
        id: `mineru:${asset}`,
        label: figureLabel(kind, caption, figures.length + 1),
        caption,
        path,
        mediaType: mediaTypeForImagePath(asset),
      });
    }
    return figures;
  } catch {
    // A missing or unreadable parse cache simply means "no figures to offer".
    return [];
  }
}

async function latexFigures(itemID: number): Promise<PaperFigure[]> {
  const arxivId = resolveArxivIdForItemID(itemID);
  if (!arxivId) return [];
  const meta = await readArxivMeta(arxivId);
  if (meta?.status !== "ok" || !meta.files?.length) return [];
  const main = await readArxivMainText(arxivId);
  if (!main) return [];
  const io = zoteroIO();
  const figures: PaperFigure[] = [];
  for (const figure of parseFigures(main)) {
    for (const graphic of figure.graphics) {
      const matched = matchSourceAssetFile(meta.files, graphic);
      if (!matched) continue;
      const mediaType = mediaTypeForSourceAsset(matched);
      if (!mediaType?.startsWith("image/")) continue;
      const path = appendLocalPath(arxivFolderPath(arxivId), "source", matched);
      if (!(await io.exists(path))) continue;
      figures.push({
        id: `latex:${matched}`,
        label: `图 ${figure.number}`,
        caption: (figure.caption || "").trim(),
        path,
        mediaType,
      });
      break;
    }
  }
  return figures;
}

function contentListItems(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value)) {
    if (Array.isArray(value.pages)) {
      return value.pages.flatMap((page) =>
        isRecord(page) ? contentListItems(page.blocks) : [],
      );
    }
    if (Array.isArray(value.blocks)) return contentListItems(value.blocks);
  }
  return [];
}

function mineruAssetPath(value: unknown): string | null {
  const raw = stringValue(value).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw || raw.startsWith("/") || /[:\x00]/.test(raw)) return null;
  if (raw.split("/").some((part) => part === ".." || part === "." || !part)) {
    return null;
  }
  return /\.(png|jpe?g|gif|webp)$/i.test(raw) ? raw : null;
}

function mediaTypeForImagePath(path: string): string {
  const extension = path.split(".").pop()!.toLowerCase();
  return `image/${extension === "jpg" ? "jpeg" : extension}`;
}

function figureLabel(kind: string, caption: string, index: number): string {
  const numbered = caption.match(
    /^(?:figure|fig\.?|table|图|表)\s*([0-9]+(?:\.[0-9]+)?)/i,
  );
  const name = kind === "table" ? "表" : "图";
  return `${name} ${numbered ? numbered[1] : index}`;
}

function captionText(item: Record<string, unknown>): string {
  const caption =
    item.image_caption ??
    item.chart_caption ??
    item.table_caption ??
    item.caption;
  const text = Array.isArray(caption)
    ? caption
        .map((part) => stringValue(part))
        .filter(Boolean)
        .join(" ")
    : stringValue(caption);
  return text.replace(/\s+/g, " ").trim();
}

function extensionOf(name: string): string {
  const match = name.match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function firstPdfPath(
  root: ZoteroFigureItem,
  selected: ZoteroFigureItem,
): Promise<string | null> {
  const candidates = isPdf(selected)
    ? [selected]
    : (root.getAttachments?.() ?? [])
        .map((id) => getItem(id))
        .filter((item): item is ZoteroFigureItem => !!item && isPdf(item));
  for (const item of candidates) {
    const path = await item.getFilePathAsync?.();
    if (path) return path;
  }
  return null;
}

function isPdf(item: ZoteroFigureItem): boolean {
  return (
    item.isPDFAttachment?.() === true ||
    item.attachmentContentType === "application/pdf"
  );
}

function getItem(id: number): ZoteroFigureItem | null {
  try {
    return ((Zotero as any).Items?.get?.(id) as ZoteroFigureItem) || null;
  } catch {
    return null;
  }
}

interface ZoteroIO {
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

function zoteroIO(): ZoteroIO {
  return (globalThis as unknown as { IOUtils: ZoteroIO }).IOUtils;
}
