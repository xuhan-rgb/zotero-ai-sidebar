import { resolveArxivIdForItemID } from "../context/arxiv-id";
import {
  arxivFolderPath,
  matchSourceAssetFile,
  mediaTypeForSourceAsset,
  readArxivMainText,
  readArxivMeta,
  readArxivTextFile,
  type ArxivMeta,
} from "../context/arxiv-store";
import { inlineInputs, stripTexComments } from "../context/tex-clean";
import { parseEquations } from "../context/tex-equations";
import { parseFigures } from "../context/tex-figures";
import { parseTables } from "../context/tex-tables";
import { appendLocalPath } from "../utils/local-path";
import { renderPdfPreview } from "../translate/full-document-assets";
import {
  loadMineruCache,
  mineruCacheFolder,
  readPdfStat,
} from "../translate/mineru-store";

export type PaperFigureKind = "figure" | "table" | "equation";

export interface PaperFigure {
  id: string;
  kind: PaperFigureKind;
  label: string;
  caption: string;
  /** Absolute path of the picture on disk; absent for LaTeX tables/equations. */
  path?: string;
  mediaType?: string;
  /** LaTeX source, inserted into the composer as text instead of an image. */
  latex?: string;
  /** 0-based PDF page, when the parse or the reader text can tell us. */
  page?: number;
}

export interface PaperFigureContext {
  /**
   * Reader text by 0-based PDF page index. LaTeX source carries no page
   * numbers, so a float's page is matched from the caption it renders as
   * ("Figure 3", "Table 2") in the PDF the user is looking at.
   */
  pageTexts?: string[];
}

export interface PaperFigureImage {
  bytes: Uint8Array;
  mediaType: string;
}

/** Width used when a picture is handed to the model or uploaded. */
export const PAPER_FIGURE_IMAGE_WIDTH = 1600;
/** Width used for the thumbnails inside the picker. */
export const PAPER_FIGURE_THUMBNAIL_WIDTH = 420;

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
 * Pictures, tables and formulas that already exist on disk for this paper:
 * MinerU's parsed crops when the PDF has been parsed, otherwise whatever the
 * arXiv LaTeX source provides.
 */
export async function loadPaperFigures(
  itemID: number | null,
  context: PaperFigureContext = {},
): Promise<PaperFigure[]> {
  if (itemID == null) return [];
  const mineru = await mineruFigures(itemID);
  return mineru.length ? mineru : await latexFigures(itemID, context);
}

/**
 * Bytes that can be shown or uploaded. Raster pictures pass through; PDF and
 * EPS figures are rasterised, so the picker and the model both get a picture.
 */
export async function readPaperFigureImage(
  figure: PaperFigure,
  doc?: Document,
  width = PAPER_FIGURE_IMAGE_WIDTH,
): Promise<PaperFigureImage | null> {
  if (!figure.path || !figure.mediaType) return null;
  const bytes = await readFileBytes(figure.path);
  if (!bytes) return null;
  if (figure.mediaType.startsWith("image/")) {
    return { bytes, mediaType: figure.mediaType };
  }
  const postscript = figure.mediaType === "application/postscript";
  if (figure.mediaType !== "application/pdf" && !postscript) return null;
  const png = await rasterizeFigure(figure.path, bytes, doc, width, postscript);
  return png ? { bytes: png, mediaType: "image/png" } : null;
}

export async function readPaperFigureDataUrl(
  figure: PaperFigure,
  doc?: Document,
  width = PAPER_FIGURE_THUMBNAIL_WIDTH,
): Promise<string | null> {
  const image = await readPaperFigureImage(figure, doc, width);
  if (!image) return null;
  let binary = "";
  for (let offset = 0; offset < image.bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...image.bytes.subarray(offset, offset + 0x8000),
    );
  }
  return `data:${image.mediaType};base64,${btoa(binary)}`;
}

export function paperFigureFileName(
  figure: PaperFigure,
  mediaType = figure.mediaType ?? "",
): string {
  const base = (figure.path ?? "figure").split(/[\\/]/).pop() || "figure";
  const stem = base.replace(/\.[^.]+$/, "") || "figure";
  const extension = extensionForMediaType(mediaType) ?? extensionOf(base);
  return `${figure.label.replace(/[^\w\u4e00-\u9fa5]+/g, "-")}-${stem}${extension}`;
}

/** LaTeX material the picker inserts as text rather than as a picture. */
export function paperFigureLatex(figure: PaperFigure): string {
  const latex = (figure.latex ?? "").trim();
  if (figure.kind === "equation" && latex && !latex.startsWith("$$")) {
    return `$$\n${latex}\n$$`;
  }
  return latex;
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
      const kind = stringValue(item.type).toLowerCase();
      const page = pageIndexOf(item);
      if (kind === "equation" || kind === "interline_equation") {
        const latex = stringValue(item.text);
        if (!latex) continue;
        figures.push({
          id: `mineru:equation:${page ?? "?"}:${figures.length}`,
          kind: "equation",
          label: itemLabel("equation", "", figures.length + 1, latex),
          caption: compactLatex(latex),
          latex,
          ...(page != null ? { page } : {}),
        });
        continue;
      }
      if (!["image", "chart", "table"].includes(kind)) continue;
      const asset = mineruAssetPath(item.img_path);
      if (!asset) continue;
      const path = appendLocalPath(folder, asset);
      if (!(await io.exists(path))) continue;
      const caption = captionText(item);
      const itemKind = kind === "table" ? "table" : "figure";
      figures.push({
        id: `mineru:${asset}`,
        kind: itemKind,
        label: itemLabel(itemKind, caption, figures.length + 1),
        caption,
        path,
        mediaType: mediaTypeForImagePath(asset),
        ...(page != null ? { page } : {}),
      });
    }
    return figures;
  } catch {
    // A missing or unreadable parse cache simply means "no figures to offer".
    return [];
  }
}

async function latexFigures(
  itemID: number,
  context: PaperFigureContext,
): Promise<PaperFigure[]> {
  const arxivId = resolveArxivIdForItemID(itemID);
  if (!arxivId) return [];
  const meta = await readArxivMeta(arxivId);
  if (meta?.status !== "ok" || !meta.files?.length) return [];
  const main = await readArxivMainText(arxivId);
  if (!main) return [];
  const text = await latexSourceText(arxivId, meta, main);
  const io = zoteroIO();
  const figures: PaperFigure[] = [];
  const postscript = await hasRasterizer(EPS_RASTERIZERS);
  for (const figure of parseFigures(text)) {
    for (const graphic of figure.graphics) {
      const matched = matchSourceAssetFile(meta.files, graphic);
      if (!matched) continue;
      const mediaType = mediaTypeForSourceAsset(matched);
      if (!mediaType || !isRenderableFigure(mediaType, postscript)) continue;
      const path = appendLocalPath(arxivFolderPath(arxivId), "source", matched);
      if (!(await io.exists(path))) continue;
      figures.push({
        id: `latex:${matched}`,
        kind: "figure",
        label: `图 ${figure.number}`,
        caption: (figure.caption || "").trim(),
        path,
        mediaType,
        ...pageOfNumber("figure", figure.number, context),
      });
      break;
    }
  }
  for (const table of parseTables(text)) {
    const latex = (table.tex || "").trim();
    if (!latex) continue;
    figures.push({
      id: `latex:table:${table.number}`,
      kind: "table",
      label: `表 ${table.number}`,
      caption: (table.caption || "").trim() || compactLatex(latex),
      latex,
      ...pageOfNumber("table", table.number, context),
    });
  }
  for (const equation of parseEquations(text)) {
    const latex = (equation.tex || "").trim();
    if (!latex) continue;
    figures.push({
      id: `latex:equation:${equation.number}`,
      kind: "equation",
      label: `公式 ${equation.number}`,
      caption: compactLatex(latex),
      latex,
    });
  }
  return figures;
}

/**
 * The main `.tex` with `\input`/`\include` expanded: papers that keep their
 * sections (and their figures) in separate files otherwise look empty here.
 */
async function latexSourceText(
  arxivId: string,
  meta: ArxivMeta,
  main: string,
): Promise<string> {
  const paths = (meta.files ?? []).filter((path) => /\.tex$/i.test(path));
  if (paths.length <= 1) return stripTexComments(main);
  const files: Array<{ path: string; text: string }> = [];
  for (const path of paths.slice(0, 400)) {
    const text = await readArxivTextFile(arxivId, path);
    if (text != null) files.push({ path, text });
  }
  return stripTexComments(inlineInputs(main, files));
}

function pageOfNumber(
  kind: "figure" | "table",
  number: number,
  context: PaperFigureContext,
): { page?: number } {
  const texts = context.pageTexts;
  if (!texts?.length) return {};
  const name = kind === "table" ? "table" : "(?:figure|fig\\.?)";
  const pattern = new RegExp(`\\b${name}\\s*0*${number}\\b`, "i");
  for (let index = 0; index < texts.length; index += 1) {
    if (pattern.test(texts[index] ?? "")) return { page: index };
  }
  return {};
}

async function rasterizeFigure(
  inputPath: string,
  bytes: Uint8Array,
  doc: Document | undefined,
  width: number,
  postscript: boolean,
): Promise<Uint8Array | null> {
  const rasterizer = await firstRasterizer(
    postscript ? EPS_RASTERIZERS : PDF_RASTERIZERS,
  );
  if (rasterizer) {
    const png = await runRasterizer(rasterizer, (output, prefix) =>
      postscript
        ? epsArgs(inputPath, output)
        : [
            "-f",
            "1",
            "-singlefile",
            "-scale-to-x",
            String(width),
            "-scale-to-y",
            "-1",
            "-png",
            inputPath,
            prefix,
          ],
    );
    if (png) return png;
  }
  if (!doc || postscript) return null;
  try {
    return dataUrlBytes(await renderPdfPreview(doc, bytes));
  } catch {
    return null;
  }
}

const PDF_RASTERIZERS = [
  "/usr/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
  "/opt/homebrew/bin/pdftoppm",
];
const EPS_RASTERIZERS = [
  "/usr/bin/gs",
  "/usr/local/bin/gs",
  "/opt/homebrew/bin/gs",
];
const rasterizers = new Map<string, Promise<string | null>>();

function firstRasterizer(candidates: string[]): Promise<string | null> {
  const key = candidates.join("\0");
  const cached = rasterizers.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const io = (globalThis as unknown as { IOUtils?: ZoteroIO }).IOUtils;
    if (!io?.exists) return null;
    for (const candidate of candidates) {
      try {
        if (await io.exists(candidate)) return candidate;
      } catch {
        // Unreadable candidates simply fall through to the next one.
      }
    }
    return null;
  })();
  rasterizers.set(key, pending);
  return pending;
}

function hasRasterizer(candidates: string[]): Promise<boolean> {
  return firstRasterizer(candidates).then((found) => found != null);
}

async function runRasterizer(
  command: string,
  args: (outputPath: string, outputPrefix: string) => string[],
): Promise<Uint8Array | null> {
  const Z = Zotero as any;
  const exec = Z?.Utilities?.Internal?.exec;
  const tempRoot: string | undefined = Z?.getTempDirectory?.()?.path;
  if (typeof exec !== "function" || !tempRoot) return null;
  const prefix = appendLocalPath(
    tempRoot,
    `zai-figure-${Date.now()}-${rasterizeID++}`,
  );
  const outputPath = `${prefix}.png`;
  try {
    const ok = await exec(command, args(outputPath, prefix));
    if (ok !== true) return null;
    return await zoteroIO().read(outputPath);
  } catch {
    return null;
  } finally {
    try {
      await Z?.File?.removeIfExists?.(outputPath);
    } catch {
      // Temporary raster cleanup is best-effort.
    }
  }
}

let rasterizeID = 0;

function epsArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-q",
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=png16m",
    "-dEPSCrop",
    "-dTextAlphaBits=4",
    "-dGraphicsAlphaBits=4",
    "-r160",
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];
}

function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function readFileBytes(path: string): Promise<Uint8Array | null> {
  try {
    return await zoteroIO().read(path);
  } catch {
    return null;
  }
}

function isRenderableFigure(mediaType: string, postscript: boolean): boolean {
  if (mediaType === "image/svg+xml") return false;
  if (mediaType.startsWith("image/")) return true;
  if (mediaType === "application/pdf") return true;
  return mediaType === "application/postscript" && postscript;
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

function pageIndexOf(item: Record<string, unknown>): number | null {
  const value = Number(item.page_idx);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function itemLabel(
  kind: PaperFigureKind,
  caption: string,
  index: number,
  latex = "",
): string {
  const name = kind === "table" ? "表" : kind === "equation" ? "公式" : "图";
  const numbered = caption.match(
    /^(?:figure|fig\.?|table|图|表)\s*([0-9]+(?:\.[0-9]+)?)/i,
  );
  const tagged = latex.match(/\\tag\{([0-9]+(?:\.[0-9]+)?)\}/);
  return `${name} ${numbered?.[1] ?? tagged?.[1] ?? index}`;
}

function compactLatex(latex: string): string {
  return latex.replace(/\s+/g, " ").trim().slice(0, 160);
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

function extensionForMediaType(mediaType: string): string | null {
  switch (mediaType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return null;
  }
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
