// Helpers and side-channel utilities for the model-driven arXiv section /
// figure tools. The tool literals themselves are registered alongside the
// other Zotero tools in `agent-tools.ts`; this file holds the per-item
// resolution + the TOC-front-block builder so both can be reused without
// growing the already-large agent-tools file further.

import type { ToolFactoryOptions } from "./agent-tools";
import type { MessageImage } from "../providers/types";
import {
  hasArxivSource,
  readArxivMainText,
  readArxivFigure,
  readArxivMeta,
  mediaTypeForFigure,
  readArxivBibliographyFiles,
  appendArxivDiagnostic,
  type ArxivTextFile,
} from "./arxiv-store";
import {
  parseSections,
  buildToc,
  formatTocBlock,
  type TexSection,
} from "./tex-sections";
import {
  equationDisplayMath,
  findEquation,
  parseEquations,
  summarizeEquationIndex,
  type TexEquation,
} from "./tex-equations";
import {
  findFigure,
  parseFigures,
  plainFigureCaption,
  summarizeFigureIndex,
  type TexFigure,
} from "./tex-figures";
import {
  findTable,
  parseTables,
  summarizeTableIndex,
  type TexTable,
} from "./tex-tables";
import { getSharedPdfLocator, type PdfRect } from "./pdf-locator";
import { resolveArxivIdForItemID } from "./arxiv-id";

export function currentArxivId(options: ToolFactoryOptions): string | null {
  return resolveArxivIdForItemID(options.itemID);
}

export interface LoadedArxivSections {
  arxivId: string;
  sections: TexSection[];
}

// Load the parsed sections of the current item's cached arXiv source.
// Returns null when no arXiv source is cached for the item (caller falls
// back cleanly — e.g. by refusing the tool call with an explanation).
export async function loadArxivSections(
  options: ToolFactoryOptions,
): Promise<LoadedArxivSections | null> {
  const arxivId = currentArxivId(options);
  if (!arxivId) {
    appendArxivDiagnostic([
      "loadArxivSections.no-arxivId",
      `itemID=${options.itemID}`,
    ]);
    return null;
  }
  const exists = await hasArxivSource(arxivId);
  if (!exists) {
    appendArxivDiagnostic([
      "loadArxivSections.no-source",
      `arxivId=${arxivId}`,
    ]);
    return null;
  }
  const text = await readArxivMainText(arxivId);
  if (!text) {
    appendArxivDiagnostic([
      "loadArxivSections.no-text",
      `arxivId=${arxivId}`,
      `text=${text === null ? "null" : `len=${text.length}`}`,
    ]);
    return null;
  }
  return { arxivId, sections: parseSections(text) };
}

// Section list for an arXiv id, bypassing ToolFactoryOptions. Used by the
// sidebar's overview jump to derive an accurate locate needle from the LaTeX
// body. Returns null when the item has no cached arXiv source.
export async function loadArxivSectionsForArxivId(
  arxivId: string,
): Promise<TexSection[] | null> {
  if (!arxivId || !(await hasArxivSource(arxivId))) return null;
  const text = await readArxivMainText(arxivId);
  if (!text) return null;
  return parseSections(text);
}

export async function loadArxivBibliography(
  options: ToolFactoryOptions,
): Promise<{ arxivId: string; files: ArxivTextFile[] } | null> {
  const arxivId = currentArxivId(options);
  if (!arxivId) return null;
  if (!(await hasArxivSource(arxivId))) return null;
  const files = await readArxivBibliographyFiles(arxivId);
  return { arxivId, files };
}

export interface LoadedArxivEquationLookup {
  arxivId: string;
  equations: TexEquation[];
  equation?: TexEquation;
  section?: Pick<TexSection, "number" | "title">;
}

export interface LoadedArxivEquation {
  arxivId: string;
  equation: TexEquation;
  equations: TexEquation[];
  section?: Pick<TexSection, "number" | "title">;
}

export async function loadArxivEquation(
  options: ToolFactoryOptions,
  query: { number?: number; label?: string },
): Promise<LoadedArxivEquationLookup | null> {
  const arxivId = currentArxivId(options);
  if (!arxivId) return null;
  if (!(await hasArxivSource(arxivId))) return null;
  const text = await readArxivMainText(arxivId);
  if (!text) return null;
  const equations = parseEquations(text);
  const equation = findEquation(equations, query);
  if (!equation) return { arxivId, equations };
  const priorSections = parseSections(text).filter(
    (candidate) => candidate.start <= equation.start,
  );
  const section = priorSections[priorSections.length - 1];
  return {
    arxivId,
    equation,
    equations,
    ...(section
      ? { section: { number: section.number, title: section.title } }
      : {}),
  };
}

export function formatArxivEquationResult(loaded: LoadedArxivEquation): string {
  const eq = loaded.equation;
  const displayMath = equationDisplayMath(eq);
  const lines = [
    `[arXiv equation (${eq.number})]`,
    `Environment: ${eq.env}`,
    eq.label ? `Label: ${eq.label}` : "",
    loaded.section
      ? `Section: §${loaded.section.number} ${loaded.section.title}`
      : "",
    "",
    "Display math for final answers (prefer this; it renders in chat):",
    "$$",
    displayMath,
    "$$",
    "",
    "Exact LaTeX source for verification only:",
    "```tex",
    eq.tex.trim(),
    "```",
    eq.rowTex ? `Numbered row:\n${eq.rowTex}` : "",
    "",
    "Context before:",
    eq.contextBefore || "(none)",
    "",
    "Context after:",
    eq.contextAfter || "(none)",
  ].filter((line) => line !== "");
  return lines.join("\n");
}

export function formatArxivEquationMiss(
  equations: TexEquation[],
  query: { number?: number; label?: string },
): string {
  const target = query.label
    ? `label ${query.label}`
    : query.number != null
      ? `number ${query.number}`
      : "empty query";
  return `No cached arXiv equation matched ${target}. Available equations: ${summarizeEquationIndex(equations)}`;
}

export interface LoadedArxivFigureLookup {
  arxivId: string;
  figures: TexFigure[];
  figure?: TexFigure;
  image?: MessageImage;
  imageSource?: "arxiv_raster" | "pdf_crop";
  imagePath?: string;
  imageError?: string;
  section?: Pick<TexSection, "number" | "title">;
}

export async function loadArxivFigureByQuery(
  options: ToolFactoryOptions,
  query: { number?: number; label?: string; name?: string },
): Promise<LoadedArxivFigureLookup | null> {
  const arxivId = currentArxivId(options);
  if (!arxivId) return null;
  if (!(await hasArxivSource(arxivId))) return null;
  const text = await readArxivMainText(arxivId);
  if (!text) return null;
  const figures = parseFigures(text);
  const figure = findFigure(figures, query);
  if (!figure) return { arxivId, figures };
  const priorSections = parseSections(text).filter(
    (candidate) => candidate.start <= figure.start,
  );
  const section = priorSections[priorSections.length - 1];
  const imageResult = await loadFigureImage(options, arxivId, figure);
  return {
    arxivId,
    figures,
    figure,
    ...(section
      ? { section: { number: section.number, title: section.title } }
      : {}),
    ...imageResult,
  };
}

export function formatArxivFigureResult(
  loaded: LoadedArxivFigureLookup & { figure: TexFigure },
): string {
  const fig = loaded.figure;
  const lines = [
    `[arXiv figure ${fig.number}]`,
    fig.label ? `Label: ${fig.label}` : "",
    loaded.section
      ? `Section: §${loaded.section.number} ${loaded.section.title}`
      : "",
    fig.caption ? `Caption: ${fig.caption}` : "Caption: (none)",
    fig.graphics.length ? `Graphics: ${fig.graphics.join(", ")}` : "",
    loaded.image
      ? `Image attached: yes (${loaded.imageSource}, ${loaded.imagePath ?? loaded.image.name})`
      : `Image attached: no${loaded.imageError ? ` (${loaded.imageError})` : ""}`,
    "",
    "Context before:",
    fig.contextBefore || "(none)",
    "",
    "Context after:",
    fig.contextAfter || "(none)",
  ].filter((line) => line !== "");
  return lines.join("\n");
}

export function formatArxivFigureMiss(
  figures: TexFigure[],
  query: { number?: number; label?: string; name?: string },
): string {
  const target = query.label
    ? `label ${query.label}`
    : query.number != null
      ? `number ${query.number}`
      : query.name
        ? `name ${query.name}`
        : "empty query";
  return `No cached arXiv figure matched ${target}. Available figures: ${summarizeFigureIndex(figures)}`;
}

export interface LoadedArxivTableLookup {
  arxivId: string;
  tables: TexTable[];
  table?: TexTable;
  section?: Pick<TexSection, "number" | "title">;
}

export async function loadArxivTableByQuery(
  options: ToolFactoryOptions,
  query: { number?: number; label?: string; name?: string },
): Promise<LoadedArxivTableLookup | null> {
  const arxivId = currentArxivId(options);
  if (!arxivId) return null;
  if (!(await hasArxivSource(arxivId))) return null;
  const text = await readArxivMainText(arxivId);
  if (!text) return null;
  const tables = parseTables(text);
  const table = findTable(tables, query);
  if (!table) return { arxivId, tables };
  const priorSections = parseSections(text).filter(
    (candidate) => candidate.start <= table.start,
  );
  const section = priorSections[priorSections.length - 1];
  return {
    arxivId,
    tables,
    table,
    ...(section
      ? { section: { number: section.number, title: section.title } }
      : {}),
  };
}

export function formatArxivTableResult(
  loaded: LoadedArxivTableLookup & { table: TexTable },
): string {
  const table = loaded.table;
  const lines = [
    `[arXiv table ${table.number}]`,
    `Environment: ${table.env}`,
    table.label ? `Label: ${table.label}` : "",
    loaded.section
      ? `Section: §${loaded.section.number} ${loaded.section.title}`
      : "",
    table.caption ? `Caption: ${table.caption}` : "Caption: (none)",
    table.tabularTex ? "Tabular source: present" : "Tabular source: not found",
    "",
    "Exact LaTeX source for this table (authoritative; do not infer from nearby PDF tables):",
    "```tex",
    table.tex.trim(),
    "```",
    "",
    "Context before:",
    table.contextBefore || "(none)",
    "",
    "Context after:",
    table.contextAfter || "(none)",
  ].filter((line) => line !== "");
  return lines.join("\n");
}

export function formatArxivTableMiss(
  tables: TexTable[],
  query: { number?: number; label?: string; name?: string },
): string {
  const target = query.label
    ? `label ${query.label}`
    : query.number != null
      ? `number ${query.number}`
      : query.name
        ? `name ${query.name}`
        : "empty query";
  return `No cached arXiv table matched ${target}. Available tables: ${summarizeTableIndex(tables)}`;
}

async function loadFigureImage(
  options: ToolFactoryOptions,
  arxivId: string,
  figure: TexFigure,
): Promise<
  Pick<
    LoadedArxivFigureLookup,
    "image" | "imageSource" | "imagePath" | "imageError"
  >
> {
  let vectorPath: string | null = null;
  for (const graphic of figure.graphics) {
    const path = await resolveArxivGraphicPath(arxivId, graphic);
    if (!path) continue;
    const mediaType = mediaTypeForFigure(path);
    if (!mediaType) {
      if (!vectorPath) vectorPath = path;
      continue;
    }
    const loaded = await readArxivFigure(arxivId, path);
    if (!loaded) continue;
    return {
      image: messageImageFromBytes(
        `figure-${figure.number}-${loaded.path}`,
        `Figure ${figure.number}: ${basename(loaded.path)}`,
        `[Figure ${figure.number}]`,
        loaded.mediaType,
        loaded.bytes,
      ),
      imageSource: "arxiv_raster",
      imagePath: loaded.path,
    };
  }

  const crop = await cropFigureFromActiveReader(options, figure);
  if (crop) {
    return {
      image: crop.image,
      imageSource: "pdf_crop",
      imagePath: crop.path,
    };
  }
  return {
    imageError: vectorPath
      ? `source graphic is vector (${vectorPath}) and no PDF crop was available`
      : "no raster graphic matched and no PDF crop was available",
  };
}

async function resolveArxivGraphicPath(
  arxivId: string,
  graphic: string,
): Promise<string | null> {
  const meta = await readArxivMeta(arxivId);
  const files = meta?.files ?? [];
  if (!files.length) return null;
  const clean = graphic.replace(/\\/g, "/").replace(/^\.\//, "");
  const exact = files.find((path) => path === clean);
  if (exact) return exact;
  const candidates = [
    clean,
    ...FIGURE_EXTENSIONS.map((ext) => `${clean}${ext}`),
  ];
  const lowerCandidates = new Set(candidates.map((path) => path.toLowerCase()));
  const byPath = files.find((path) => lowerCandidates.has(path.toLowerCase()));
  if (byPath) return byPath;
  const cleanBase = stripExtension(basename(clean)).toLowerCase();
  return (
    files.find(
      (path) => stripExtension(basename(path)).toLowerCase() === cleanBase,
    ) ?? null
  );
}

const FIGURE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".pdf",
  ".eps",
];

async function cropFigureFromActiveReader(
  options: ToolFactoryOptions,
  figure: TexFigure,
): Promise<{ image: MessageImage; path: string } | null> {
  const reader = options.getActiveReader?.();
  if (!reader) return null;
  const locator = await getSharedPdfLocator(reader).catch(() => null);
  if (!locator) return null;
  const caption = plainFigureCaption(figure);
  if (!caption) return null;
  const located = await locateFigureCaption(locator, figure.number, caption);
  if (!located) return null;
  const page = await locator.getPageContent(located.pageIndex);
  if (!page?.viewBox) return null;
  const cropRect = figureCropRect(located.rects, page.viewBox);
  if (!cropRect) return null;
  const bytes = await locator.renderRegion(located.pageIndex, [cropRect]);
  if (!bytes) return null;
  const pageLabel = located.pageLabel || String(located.pageIndex + 1);
  return {
    image: messageImageFromBytes(
      `figure-${figure.number}-pdf-crop`,
      `Figure ${figure.number} (PDF p.${pageLabel} crop)`,
      `[Figure ${figure.number}]`,
      "image/png",
      bytes,
    ),
    path: `PDF page ${pageLabel} crop`,
  };
}

async function locateFigureCaption(
  locator: Awaited<ReturnType<typeof getSharedPdfLocator>>,
  figureNumber: number,
  caption: string,
) {
  const trimmed = caption.replace(/\s+/g, " ").trim();
  const prefix = trimmed.slice(0, 220);
  const candidates = [
    `Figure ${figureNumber}: ${prefix}`,
    `Fig. ${figureNumber}: ${prefix}`,
    prefix,
  ].filter((candidate) => candidate.length > 12);
  for (const candidate of candidates) {
    const found = await locator.locate(candidate, { minConfidence: 0.55 });
    if (found) return found;
  }
  return null;
}

function figureCropRect(rects: PdfRect[], viewBox: PdfRect): PdfRect | null {
  if (!rects.length) return null;
  const box = unionRect(rects);
  const [pageX0, pageY0, pageX1, pageY1] = viewBox;
  const pageW = pageX1 - pageX0;
  const pageH = pageY1 - pageY0;
  if (pageW <= 0 || pageH <= 0) return null;
  const captionW = box[2] - box[0];
  const xPad = 16;
  const yPad = 10;
  const cropHeight = Math.max(120, Math.min(pageH * 0.38, captionW * 0.7));
  return [
    Math.max(pageX0, box[0] - xPad),
    Math.max(pageY0, box[1] - yPad),
    Math.min(pageX1, box[2] + xPad),
    Math.min(pageY1, box[3] + cropHeight),
  ];
}

function unionRect(rects: PdfRect[]): PdfRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const rect of rects) {
    x0 = Math.min(x0, rect[0]);
    y0 = Math.min(y0, rect[1]);
    x1 = Math.max(x1, rect[2]);
    y1 = Math.max(y1, rect[3]);
  }
  return [x0, y0, x1, y1];
}

function messageImageFromBytes(
  id: string,
  name: string,
  marker: string,
  mediaType: string,
  bytes: Uint8Array,
): MessageImage {
  return {
    id: id.replace(/[^A-Za-z0-9_.-]+/g, "_"),
    name,
    marker,
    mediaType,
    dataUrl: `data:${mediaType};base64,${bytesToBase64(bytes)}`,
    size: bytes.length,
  };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stripExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot > 0 ? path.slice(0, dot) : path;
}

// Build the compact TOC front-block for an item, or null when no arXiv
// source is cached. This is what `resolvePinnedFullText` returns in place
// of the full LaTeX source when an arXiv cache exists, so each turn's
// static prefix stays small (~1 KB) AND byte-stable across turns (good
// for the prompt cache). The model fetches actual section bodies via the
// `arxiv_get_section` tool on demand.
export async function buildArxivTocFrontBlock(
  itemID: number | null,
): Promise<string | null> {
  if (itemID == null) return null;
  const arxivId = resolveArxivIdForItemID(itemID);
  if (!arxivId) return null;
  if (!(await hasArxivSource(arxivId))) return null;
  const text = await readArxivMainText(arxivId);
  if (!text) return null;
  const toc = buildToc(parseSections(text));
  return formatTocBlock(toc);
}

// Encode a binary buffer as base64 in chunks. `btoa` is a runtime global
// in both Zotero (Gecko) and Node 16+, so the encoder works on the plugin
// and in vitest. Chunking prevents call-stack blow-ups on multi-MB images
// from `String.fromCharCode.apply(null, …)`.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as number[],
    );
  }
  return (globalThis as { btoa: (s: string) => string }).btoa(binary);
}

// Load a cached figure for the current item and shape it as a MessageImage
// ready for the multimodal follow-up turn the provider adapter emits.
// Returns null when no arXiv source is cached, no matching raster figure
// was found, or the figure is vector (.pdf/.eps) — see `matchFigureFile`.
export async function loadArxivFigureAsImage(
  options: ToolFactoryOptions,
  name: string,
): Promise<{ image: MessageImage; path: string } | null> {
  const arxivId = currentArxivId(options);
  if (!arxivId) return null;
  const figure = await readArxivFigure(arxivId, name);
  if (!figure) return null;
  const dataUrl = `data:${figure.mediaType};base64,${bytesToBase64(figure.bytes)}`;
  const id = figure.path.replace(/[^A-Za-z0-9_.-]+/g, "_");
  return {
    path: figure.path,
    image: {
      id,
      name: figure.path,
      marker: `[arxiv:${figure.path}]`,
      mediaType: figure.mediaType,
      dataUrl,
      size: figure.bytes.length,
    },
  };
}
