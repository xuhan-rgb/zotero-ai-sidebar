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
  ensureMineruCachedAssets,
  loadMineruCache,
  mineruCacheFolder,
  readPdfStat,
} from "../translate/mineru-store";
import { htmlTableToLatex } from "./html-table-latex";

// ---------------------------------------------------------------------------
// Disk cache: the parsed material list and rasterised thumbnails survive
// across Zotero restarts, so a paper is parsed and matched once per PDF
// version, not once per session. Entries are validated against the PDF's
// size/mtime, the same contract MinerU's cache uses.
// ---------------------------------------------------------------------------

const FIGURE_CACHE_DIR = "zotero-ai-sidebar-figures";

function dataRoot(): string {
  const Z = (
    globalThis as unknown as {
      Zotero?: {
        DataDirectory?: { dir?: string; path?: string };
        Profile: { dir: string };
      };
    }
  ).Zotero!;
  return Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
}

export function paperFigureCacheFolder(itemKey: string): string {
  return appendLocalPath(dataRoot(), FIGURE_CACHE_DIR, itemKey);
}

interface FigureCacheMeta {
  version: number;
  pdfSize: number;
  pdfMtime: number;
  savedAt: string;
  figures: PaperFigure[];
}

/**
 * Bumped whenever parsing or page matching changes. The cache is keyed by the
 * PDF alone, so without this an upgrade would keep serving entries written by
 * the old logic. Entries written before the field existed are rejected too.
 */
// 3: LaTeX material without reader text is no longer cached, so entries written
// by version 2 with every page unknown must be dropped and re-resolved.
const FIGURE_CACHE_VERSION = 3;

async function readCachedPaperFigures(
  itemKey: string,
  pdfSize: number,
  pdfMtime: number,
): Promise<PaperFigure[] | null> {
  try {
    const readUTF8 = zoteroIO().readUTF8;
    if (!readUTF8) return null;
    const raw = await readUTF8(
      appendLocalPath(paperFigureCacheFolder(itemKey), "figures.json"),
    );
    const meta = JSON.parse(raw) as FigureCacheMeta;
    if (meta.version !== FIGURE_CACHE_VERSION) return null;
    if (meta.pdfSize !== pdfSize || meta.pdfMtime !== pdfMtime) return null;
    if (!Array.isArray(meta.figures)) return null;
    return meta.figures;
  } catch {
    return null;
  }
}

async function writeCachedPaperFigures(
  itemKey: string,
  pdfSize: number,
  pdfMtime: number,
  figures: PaperFigure[],
): Promise<void> {
  try {
    const IO = zoteroIO();
    const folder = paperFigureCacheFolder(itemKey);
    await IO.makeDirectory?.(folder, {
      ignoreExisting: true,
      createAncestors: true,
    });
    const meta: FigureCacheMeta = {
      version: FIGURE_CACHE_VERSION,
      pdfSize,
      pdfMtime,
      savedAt: new Date().toISOString(),
      figures,
    };
    if (!IO.writeUTF8) return;
    await IO.writeUTF8(
      appendLocalPath(folder, "figures.json"),
      JSON.stringify(meta),
    );
  } catch {
    // Caching is best-effort; a failed write only means the next session
    // re-parses.
  }
}

function cacheSafeName(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").slice(0, 80) || "figure";
}

/**
 * Rasterised picture bytes cached on disk under the paper's cache folder, so
 * PDF/EPS figures are not re-rasterised on every restart. The source file's
 * mtime is part of the name, so a replaced source re-rasters automatically.
 */
async function readPaperFigureImageCached(
  figure: PaperFigure,
  doc: Document | undefined,
  width: number,
  itemKey: string,
): Promise<PaperFigureImage | null> {
  if (!figure.path) return readPaperFigureImage(figure, doc, width);
  try {
    const IO = zoteroIO();
    const stat = await IO.stat?.(figure.path);
    const mtime = stat?.lastModified ?? 0;
    const name = `thumb-${mtime}-${width}-${cacheSafeName(figure.id)}.png`;
    const cachePath = appendLocalPath(paperFigureCacheFolder(itemKey), name);
    try {
      const bytes = await IO.read(cachePath);
      return { bytes, mediaType: "image/png" };
    } catch {
      /* not cached yet */
    }
    const image = await readPaperFigureImage(figure, doc, width);
    if (!image) return null;
    try {
      await IO.makeDirectory?.(paperFigureCacheFolder(itemKey), {
        ignoreExisting: true,
        createAncestors: true,
      });
      if (IO.write) await IO.write(cachePath, image.bytes);
    } catch {
      /* best-effort */
    }
    return image;
  } catch {
    return readPaperFigureImage(figure, doc, width);
  }
}

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
  /**
   * 0-based inclusive page range guessed from neighboring materials when the
   * exact page cannot be matched (公式 N between 公式 N-1 on page a and 公式
   * N+1 on page b is printed somewhere on pages a..b). Shown on every page in
   * the range with a "推测" marker instead of a definite page.
   */
  pageRange?: [number, number];
  /**
   * MinerU's box for this item: [left, top, right, bottom], normalized to
   * 0..1000 of the rendered page. Absent for LaTeX-only material.
   */
  bbox?: [number, number, number, number];
}

export interface PaperFigureContext {
  /**
   * Reader text by 0-based PDF page index, or a thunk that reads it lazily.
   * LaTeX source carries no page numbers, so a float's page is matched from the
   * caption it renders as, and an equation's from the printed equation number.
   */
  pageTexts?: string[] | (() => Promise<string[] | undefined>);
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
 * Session cache of the parsed material list, keyed by item. Parsing the LaTeX
 * source re-reads every `.tex` of the paper and matching pages scans the whole
 * reader text, so reopening the `@` list must not pay that twice. Entries made
 * without reader text (no pages resolvable yet) are not cached, so a later
 * call with the reader open can still fill them in. Failures are dropped, not
 * cached, so the next open retries.
 */
const paperFigureListCache = new Map<number, Promise<PaperFigure[]>>();

/** Drops cached material lists (all papers, or one); the next load re-parses. */
export function clearPaperFigureCache(itemID?: number): void {
  if (itemID == null) {
    paperFigureListCache.clear();
  } else {
    paperFigureListCache.delete(itemID);
  }
}

/** The conversation item + its first PDF: the identity a cache entry binds to. */
async function figureCacheIdentity(
  itemID: number,
): Promise<{ itemKey: string; pdfPath: string } | null> {
  const selected = getItem(itemID);
  if (!selected) return null;
  const root =
    typeof selected.parentID === "number"
      ? getItem(selected.parentID) || selected
      : selected;
  const itemKey = root.key || selected.key || "";
  const pdfPath = await firstPdfPath(root, selected);
  if (!itemKey || !pdfPath) return null;
  return { itemKey, pdfPath };
}

export async function loadPaperFigures(
  itemID: number | null,
  context: PaperFigureContext = {},
): Promise<PaperFigure[]> {
  if (itemID == null) return [];
  const cached = paperFigureListCache.get(itemID);
  if (cached) return cached;
  const pending = loadPaperFiguresFresh(itemID, context);
  const figures = pending.then((load) => load.figures);
  if (context.pageTexts) {
    paperFigureListCache.set(itemID, figures);
    // A load that never saw the reader text may not be reused: the pages it
    // could not resolve would stay unknown for the rest of the session.
    void pending.then(
      (load) => {
        if (!load.cacheable) paperFigureListCache.delete(itemID);
      },
      () => paperFigureListCache.delete(itemID),
    );
  }
  return figures;
}

interface PaperFigureLoad {
  figures: PaperFigure[];
  /** False when the pages were left unknown for want of reader text. */
  cacheable: boolean;
}

async function loadPaperFiguresFresh(
  itemID: number,
  context: PaperFigureContext,
): Promise<PaperFigureLoad> {
  const identity = await figureCacheIdentity(itemID);
  let stat: { size: number; mtime: number } | null = null;
  if (identity) {
    try {
      stat = await readPdfStat(identity.pdfPath);
    } catch {
      stat = null;
    }
    if (stat) {
      const disk = await readCachedPaperFigures(
        identity.itemKey,
        stat.size,
        stat.mtime,
      );
      if (disk) return { figures: disk, cacheable: true };
    }
  }
  const mineru = await mineruFigures(itemID);
  // A parsed float carries its own page. A LaTeX float does not: its page comes
  // from the text the reader prints, so a session without that text must not be
  // written — the cache is keyed by the PDF alone and would freeze every float
  // as page-less, which is what the page filter then reports as 本页 0.
  const pageTexts = mineru.length ? undefined : await resolvePageTexts(context);
  const figures = mineru.length ? mineru : await latexFigures(itemID, pageTexts);
  const cacheable = mineru.length > 0 || !!pageTexts?.length;
  if (cacheable && identity && stat) {
    await writeCachedPaperFigures(identity.itemKey, stat.size, stat.mtime, figures);
  }
  return { figures, cacheable };
}

/** Session cache of rendered thumbnails, keyed by item + raster width. */
const paperFigureDataUrlCache = new Map<string, Promise<string | null>>();

/** The cache-folder key (root item key) for an item, "" when unknown. */
export async function paperFigureCacheItemKey(itemID: number | null): Promise<string> {
  if (itemID == null) return "";
  return (await figureCacheIdentity(itemID))?.itemKey ?? "";
}

export async function readPaperFigureDataUrl(
  figure: PaperFigure,
  doc?: Document,
  width = PAPER_FIGURE_THUMBNAIL_WIDTH,
  cacheItemKey?: string,
): Promise<string | null> {
  const key = `${figure.id}:${width}:${cacheItemKey ?? ""}`;
  const cached = paperFigureDataUrlCache.get(key);
  if (cached) return cached;
  const pending = renderPaperFigureDataUrl(figure, doc, width, cacheItemKey);
  paperFigureDataUrlCache.set(key, pending);
  pending.catch(() => paperFigureDataUrlCache.delete(key));
  return pending;
}

async function renderPaperFigureDataUrl(
  figure: PaperFigure,
  doc: Document | undefined,
  width: number,
  cacheItemKey?: string,
): Promise<string | null> {
  const image = cacheItemKey
    ? await readPaperFigureImageCached(figure, doc, width, cacheItemKey)
    : await readPaperFigureImage(figure, doc, width);
  if (!image) return null;
  let binary = "";
  for (let offset = 0; offset < image.bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...image.bytes.subarray(offset, offset + 0x8000),
    );
  }
  return `data:${image.mediaType};base64,${btoa(binary)}`;
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
  const identity = await figureCacheIdentity(itemID);
  if (!identity) return [];
  const { itemKey, pdfPath } = identity;
  try {
    const stat = await readPdfStat(pdfPath);
    const cache = await loadMineruCache(itemKey, stat.size, stat.mtime);
    if (!cache?.contentList) return [];
    const folder = appendLocalPath(mineruCacheFolder(itemKey), "assets");
    const io = zoteroIO();
    await ensureMineruPictureAssets(itemKey, cache.contentList, folder, io);
    const figures: PaperFigure[] = [];
    for (const item of contentListItems(cache.contentList)) {
      const kind = stringValue(item.type).toLowerCase();
      const page = pageIndexOf(item);
      const bbox = bboxOf(item);
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
          ...(bbox ? { bbox } : {}),
        });
        continue;
      }
      if (!["image", "chart", "table"].includes(kind)) continue;
      const caption = captionText(item);
      const itemKind = kind === "table" ? "table" : "figure";
      if (kind === "table") {
        const latex = htmlTableToLatex(stringValue(item.table_body));
        if (latex) {
          figures.push({
            id: `mineru:table:${page ?? "?"}:${figures.length}`,
            kind: "table",
            label: itemLabel(itemKind, caption, figures.length + 1),
            caption,
            latex,
            ...(page != null ? { page } : {}),
            ...(bbox ? { bbox } : {}),
          });
          continue;
        }
      }
      const asset = mineruAssetPath(item.img_path);
      if (!asset) continue;
      const path = appendLocalPath(folder, asset);
      if (!(await io.exists(path))) continue;
      figures.push({
        id: `mineru:${asset}`,
        kind: itemKind,
        label: itemLabel(itemKind, caption, figures.length + 1),
        caption,
        path,
        mediaType: mediaTypeForImagePath(asset),
        ...(page != null ? { page } : {}),
        ...(bbox ? { bbox } : {}),
      });
    }
    return figures;
  } catch {
    // A missing or unreadable parse cache simply means "no figures to offer".
    return [];
  }
}

/**
 * A parse old enough to predate the local picture cache lists its crops in
 * `content_list.json` but has no bytes next to the Markdown, so `@` offered
 * formulas only. Fetch the pictures from MinerU's stored result once; when that
 * fails the material stays text-only instead of failing the whole list.
 */
async function ensureMineruPictureAssets(
  itemKey: string,
  contentList: unknown,
  folder: string,
  io: ZoteroIO,
): Promise<void> {
  for (const item of contentListItems(contentList)) {
    const kind = stringValue(item.type).toLowerCase();
    if (!["image", "chart", "table"].includes(kind)) continue;
    const asset = mineruAssetPath(item.img_path);
    if (!asset) continue;
    if (await io.exists(appendLocalPath(folder, asset))) continue;
    try {
      await ensureMineruCachedAssets(itemKey);
    } catch {
      // Keep the text material; the pictures stay out of the list.
    }
    return;
  }
}

async function latexFigures(
  itemID: number,
  pageTexts: string[] | undefined,
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
        ...pageField(
          paperFigurePage("figure", figure.number, figure.caption, pageTexts),
        ),
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
      ...pageField(
        paperFigurePage("table", table.number, table.caption, pageTexts),
      ),
    });
  }
  const equations = parseEquations(text);
  const pages = equations.map((equation) =>
    paperEquationPage(
      equation.number,
      equation.rowTex ?? equation.tex,
      pageTexts,
    ),
  );
  const ranges = estimateEquationRanges(pages, pageTexts?.length);
  equations.forEach((equation, index) => {
    const latex = (equation.tex || "").trim();
    if (!latex) return;
    figures.push({
      id: `latex:equation:${equation.number}`,
      kind: "equation",
      label: `公式 ${equation.number}`,
      caption: compactLatex(latex),
      latex,
      ...pageField(pages[index]),
      ...(pages[index] == null && ranges[index]
        ? { pageRange: ranges[index] }
        : {}),
    });
  });
  return figures;
}

/**
 * Equations print in order, so an equation with no page of its own is printed
 * somewhere between its nearest numbered neighbors: 公式 4 sits on pages
 * 公式 3..公式 5. One-sided anchors clamp to the document edge; no anchor at
 * all leaves the equation page-less.
 */
export function estimateEquationRanges(
  pages: Array<number | undefined>,
  pageCount: number | undefined,
): Array<[number, number] | undefined> {
  return pages.map((page, index) => {
    if (page != null) return undefined;
    let low: number | undefined;
    for (let before = index - 1; before >= 0; before -= 1) {
      if (pages[before] != null) {
        low = pages[before];
        break;
      }
    }
    let high: number | undefined;
    for (let after = index + 1; after < pages.length; after += 1) {
      if (pages[after] != null) {
        high = pages[after];
        break;
      }
    }
    if (low == null && high == null) return undefined;
    return [low ?? 0, high ?? Math.max(0, (pageCount ?? 1) - 1)];
  });
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

/**
 * The 0-based page a float is printed on, or undefined when the reader text
 * cannot tell us. The caption is the strongest signal — a bare "Figure 3" also
 * appears in the prose of a dozen other pages — so match the caption first and
 * only fall back to the float number.
 */
export function paperFigurePage(
  kind: "figure" | "table",
  number: number,
  caption: string | undefined,
  pageTexts: string[] | undefined,
): number | undefined {
  if (!pageTexts?.length) return undefined;
  const compact = pageTexts.map(compactPageText);
  return (
    pageOfCaption(caption ?? "", compact) ??
    pageOfNumber(kind, number, pageTexts)
  );
}

function pageField(page: number | undefined): { page?: number } {
  return page == null ? {} : { page };
}

/**
 * The 0-based page an equation is printed on, or undefined when the reader
 * text cannot tell us. Display math has no caption; the number it is typeset
 * with ("(3)" in the right margin) is the only printed anchor. That number
 * also shows up in prose ("conventional pipeline (1)"), so when more than one
 * page carries it, the equation body itself disambiguates.
 */
export function paperEquationPage(
  number: number,
  latex: string,
  pageTexts: string[] | undefined,
): number | undefined {
  if (!pageTexts?.length) return undefined;
  const candidates = equationNumberPages(number, pageTexts);
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  const compact = pageTexts.map(compactPageText);
  const loose = compact.map(looseEquationGlyphs);
  // Loosest last: each pass only runs when the stricter one found nothing, so a
  // relaxed body can never displace a page the exact body already pinned.
  const attempts: Array<[string, string[]]> = [
    [equationSearchText(latex), compact],
    [typesetEquationSearchText(latex), compact],
    [looseEquationGlyphs(typesetEquationSearchText(latex)), loose],
  ];
  for (const [body, text] of attempts) {
    if (body.length < EQUATION_MIN_SEARCH_CHARS) continue;
    const hits = candidates.filter((page) => text[page].includes(body));
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}

/** Shorter bodies ("x = y") match every page; only distinctive ones may pin a page. */
const EQUATION_MIN_SEARCH_CHARS = 8;

function equationNumberPages(number: number, pages: string[]): number[] {
  // The closing paren in the pattern already rejects "(12)" when number is 1;
  // every other hit is kept as a candidate and disambiguated by the body.
  const pattern = new RegExp(`\\(\\s*0*${number}\\s*\\)`, "u");
  const hits: number[] = [];
  pages.forEach((page, index) => {
    if (pattern.test(page)) hits.push(index);
  });
  return hits;
}

// The PDF prints the math but never the LaTeX commands, so drop every command
// name and keep only the letters and digits that survive typesetting.
function equationSearchText(latex: string): string {
  return latex
    .toLowerCase()
    .replace(/\\(?:begin|end)\{[^{}]*\}/g, "")
    .replace(/\\label\{[^{}]*\}/g, "")
    .replace(/\\(?:notag|nonumber)\b/g, "")
    .replace(/\\[a-zA-Z]+\*?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The same body, but with the operator commands the PDF typesets as their own
 * name: `\min` prints as "min", which the plain body drops.
 */
function typesetEquationSearchText(latex: string): string {
  return equationSearchText(
    latex.replace(TYPESET_OPERATOR_RE, (_match, name: string) => name),
  );
}

const TYPESET_OPERATOR_RE =
  /\\(min|max|sup|inf|lim|log|ln|lg|exp|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arg|det|dim|deg|ker|hom|gcd|pr|mod|bmod)(?![a-zA-Z])/gi;

/**
 * Drops the glyphs a PDF draws a math accent with: the hat of `\hat{z}` reaches
 * the reader as U+02C6, a spacing letter that survives `compactPageText` while
 * the LaTeX body has no such character at all.
 */
function looseEquationGlyphs(text: string): string {
  return text.replace(/[\p{Lm}\p{M}\p{Sk}]+/gu, "");
}

async function resolvePageTexts(
  context: PaperFigureContext,
): Promise<string[] | undefined> {
  const source = context.pageTexts;
  if (!source) return undefined;
  if (typeof source !== "function") return source;
  try {
    return await source();
  } catch {
    return undefined;
  }
}

/** Longest caption prefix first: the shortest ones match too much. */
const CAPTION_PREFIX_WORDS = [14, 10, 7, 5];
/** Shorter captions ("Results.") would match half the paper. */
const CAPTION_MIN_CHARS = 20;

function pageOfCaption(caption: string, pages: string[]): number | null {
  const words = captionWords(caption);
  if (words.join("").length < CAPTION_MIN_CHARS) return null;
  for (const count of CAPTION_PREFIX_WORDS) {
    if (words.length < count) continue;
    const prefix = words.slice(0, count).join("");
    // A caption is printed once; a prefix on several pages means it is too
    // generic (or this float is not in this PDF), so stop instead of guessing.
    const hits: number[] = [];
    pages.forEach((page, index) => {
      if (page.includes(prefix)) hits.push(index);
    });
    if (hits.length === 1) return hits[0];
  }
  return null;
}

// LaTeX captions carry commands the PDF never prints (`\textbf{}`, `\cite{}`,
// `\model`), so drop the reference commands and every command name first.
function captionWords(caption: string): string[] {
  return caption
    .replace(
      /\\(?:cite|citep|citet|ref|eqref|autoref|label|model)\{[^{}]*\}/gi,
      " ",
    )
    .replace(/\\[a-zA-Z]+\*?/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

// The reader hands us one char per glyph and drops the spaces between words, so
// comparisons run on text without any separator.
function compactPageText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// Matched on the raw page text (not the compact one) so the guard can reject
// the prose forms: "Figure 4a" must not count as Figure 4.
function pageOfNumber(
  kind: "figure" | "table",
  number: number,
  pages: string[],
): number | undefined {
  const name = kind === "table" ? "(?:table|tab)" : "(?:figure|fig)";
  const suffix = `(?![\\p{L}\\p{N}])`;
  const patterns: RegExp[] = [
    new RegExp(`${name}\\.?\\s*0*${number}${suffix}`, "iu"),
  ];
  const roman = kind === "table" ? romanNumeral(number) : null;
  if (roman)
    patterns.push(new RegExp(`${name}\\.?\\s*${roman}${suffix}`, "iu"));
  for (const pattern of patterns) {
    const index = pages.findIndex((page) => pattern.test(page));
    if (index >= 0) return index;
  }
  return undefined;
}

// IEEE-style papers number their floats in Roman numerals while the LaTeX
// counters stay arabic, so accept both spellings.
function romanNumeral(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 20) return null;
  const numerals: Array<[number, string]> = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let rest = value;
  let text = "";
  for (const [amount, numeral] of numerals) {
    while (rest >= amount) {
      text += numeral;
      rest -= amount;
    }
  }
  return text;
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

/** MinerU writes top-left bounds normalized to 0..1000; reject anything else. */
function bboxOf(item: Record<string, unknown>): [number, number, number, number] | null {
  const value = item.bbox;
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    return null;
  }
  const [left, top, right, bottom] = value as [number, number, number, number];
  if (left < 0 || top < 0 || right > 1000 || bottom > 1000) return null;
  if (right <= left || bottom <= top) return null;
  return [left, top, right, bottom];
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
  readUTF8?(path: string): Promise<string>;
  writeUTF8?(path: string, data: string): Promise<unknown>;
  makeDirectory?(
    path: string,
    options?: { ignoreExisting?: boolean; createAncestors?: boolean },
  ): Promise<void>;
  write?(path: string, bytes: Uint8Array): Promise<unknown>;
  stat?(path: string): Promise<{ size?: number; lastModified?: number }>;
}

function zoteroIO(): ZoteroIO {
  return (globalThis as unknown as { IOUtils: ZoteroIO }).IOUtils;
}
