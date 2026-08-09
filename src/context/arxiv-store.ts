// Shared arXiv source cache: arxiv/<encoded arXiv ID>/source/* + meta.json.

import { appendLocalPath, localDirname } from "../utils/local-path";
import type { ArchiveFile } from "./arxiv-archive";

export interface ArxivMeta {
  arxivId: string;
  fetchedAt: string;
  mainTexRelPath: string;
  status: "ok" | "no-source";
  /** Version of the local source-cleaning pipeline that produced main.tex.
   *  Missing means an older cache; callers may choose to rebuild it. */
  cleanerVersion?: number;
  /** Relative paths (within `source/`) of every extracted file. Used by
   *  the figure tool to resolve `arxiv_get_figure(name)` without walking
   *  the folder on disk. Older caches written before this field existed
   *  fall back to a folder scan. */
  files?: string[];
}

interface IOUtilsLike {
  makeDirectory(
    path: string,
    options?: { ignoreExisting?: boolean },
  ): Promise<void>;
  writeUTF8(
    path: string,
    data: string,
    options?: { mode?: string },
  ): Promise<unknown>;
  write(path: string, data: Uint8Array): Promise<unknown>;
  readUTF8(path: string): Promise<string>;
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

// TEMP diagnostic helper: append a single timestamped line to the shared
// arXiv debug file. Used to surface silent IOUtils failures on Windows
// where reads return null despite cache existing on disk. Safe to call from
// any thread; never throws. Remove once the Windows path is verified.
export function appendArxivDiagnostic(parts: string[]): void {
  try {
    const g = globalThis as unknown as {
      IOUtils?: IOUtilsLike;
      Zotero?: {
        DataDirectory?: { dir?: string; path?: string };
        Profile?: { dir: string };
      };
    };
    const dir =
      g.Zotero?.DataDirectory?.dir ??
      g.Zotero?.DataDirectory?.path ??
      g.Zotero?.Profile?.dir;
    if (!dir || !g.IOUtils) return;
    const line = `${new Date().toISOString()} ${parts.join(" | ")}\n`;
    void g.IOUtils.writeUTF8(
      appendLocalPath(dir, "zotero-ai-sidebar-arxiv-debug.txt"),
      line,
      { mode: "appendOrCreate" },
    );
  } catch {
    // diagnostics only
  }
}

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

function io(): IOUtilsLike {
  return (globalThis as unknown as { IOUtils: IOUtilsLike }).IOUtils;
}

export function arxivFolderPath(arxivId: string): string {
  return appendLocalPath(
    dataRoot(),
    "zotero-ai-sidebar",
    "arxiv",
    encodeURIComponent(arxivId),
  );
}

function metaPath(arxivId: string): string {
  return appendLocalPath(arxivFolderPath(arxivId), "meta.json");
}

// Sanitize an archive-relative path so it cannot escape the source folder.
function safeRel(path: string): string | null {
  const clean = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (clean.startsWith("/") || clean.split("/").includes("..")) return null;
  return clean;
}

export async function writeArxivSource(
  arxivId: string,
  files: ArchiveFile[],
  meta: ArxivMeta,
): Promise<void> {
  const folder = arxivFolderPath(arxivId);
  const IO = io();
  await IO.makeDirectory(appendLocalPath(folder, "source"), {
    ignoreExisting: true,
  });
  const written: string[] = [];
  for (const file of files) {
    const rel = safeRel(file.path);
    if (!rel) continue;
    const full = appendLocalPath(folder, "source", rel);
    const parent = localDirname(full);
    if (parent) await IO.makeDirectory(parent, { ignoreExisting: true });
    await IO.write(full, file.bytes);
    written.push(rel);
  }
  await IO.writeUTF8(
    metaPath(arxivId),
    JSON.stringify({ ...meta, files: written }, null, 2),
  );
}

export async function hasArxivSource(arxivId: string): Promise<boolean> {
  try {
    return await io().exists(metaPath(arxivId));
  } catch (err) {
    appendArxivDiagnostic([
      "hasArxivSource.catch",
      `arxivId=${arxivId}`,
      `path=${metaPath(arxivId)}`,
      `err=${String(err)}`,
    ]);
    return false;
  }
}

export async function readArxivMeta(
  arxivId: string,
): Promise<ArxivMeta | null> {
  try {
    const parsed: unknown = JSON.parse(await io().readUTF8(metaPath(arxivId)));
    return parsed && typeof parsed === "object" ? (parsed as ArxivMeta) : null;
  } catch (err) {
    appendArxivDiagnostic([
      "readArxivMeta.catch",
      `arxivId=${arxivId}`,
      `path=${metaPath(arxivId)}`,
      `err=${String(err)}`,
    ]);
    return null;
  }
}

// The cleaned main-tex content for chat context, or null if not cached / no source.
export async function readArxivMainText(
  arxivId: string,
): Promise<string | null> {
  const meta = await readArxivMeta(arxivId);
  if (!meta || meta.status !== "ok") {
    appendArxivDiagnostic([
      "readArxivMainText.no-meta",
      `arxivId=${arxivId}`,
      meta
        ? `status=${meta.status} cleaner=${meta.cleanerVersion} main=${meta.mainTexRelPath}`
        : "meta=null",
    ]);
    return null;
  }
  const fullPath = appendLocalPath(
    arxivFolderPath(arxivId),
    "source",
    meta.mainTexRelPath,
  );
  try {
    const text = await io().readUTF8(fullPath);
    if (!text) {
      appendArxivDiagnostic([
        "readArxivMainText.empty",
        `arxivId=${arxivId}`,
        `path=${fullPath}`,
      ]);
    }
    return text;
  } catch (err) {
    appendArxivDiagnostic([
      "readArxivMainText.catch",
      `arxivId=${arxivId}`,
      `path=${fullPath}`,
      `err=${String(err)}`,
    ]);
    return null;
  }
}

export interface ArxivTextFile {
  path: string;
  text: string;
}

export async function readArxivTextFile(
  arxivId: string,
  relPath: string,
): Promise<string | null> {
  const rel = safeRel(relPath);
  if (!rel) return null;
  try {
    return await io().readUTF8(
      appendLocalPath(arxivFolderPath(arxivId), "source", rel),
    );
  } catch {
    return null;
  }
}

// Return compiled bibliography files when present (.bbl), otherwise fall
// back to BibTeX databases (.bib). We intentionally keep this out of the
// default full-paper front block because references are often long and most
// summary turns do not need them.
export async function readArxivBibliographyFiles(
  arxivId: string,
): Promise<ArxivTextFile[]> {
  const meta = await readArxivMeta(arxivId);
  if (!meta || meta.status !== "ok" || !meta.files?.length) return [];
  const bbl = meta.files.filter((path) => path.toLowerCase().endsWith(".bbl"));
  const bib = meta.files.filter((path) => path.toLowerCase().endsWith(".bib"));
  const candidates = bbl.length ? bbl : bib;
  const out: ArxivTextFile[] = [];
  for (const path of candidates.sort()) {
    const text = await readArxivTextFile(arxivId, path);
    if (text) out.push({ path, text });
  }
  return out;
}

// Map a file extension to a multimodal-friendly media type. Vector formats
// (.pdf, .eps) are NOT supported here — we return null so the figure tool
// can refuse them cleanly. Only raster types reach the model.
export function mediaTypeForFigure(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

// Pick the cached file whose path matches a model-supplied figure name.
// Tried, in order:
//   1) exact relative path           ("figures/robot_system_overview.png")
//   2) basename equal to `name`      ("robot_system_overview.png")
//   3) name + supported extension    ("robot_system_overview" → ".png")
//   4) case-insensitive substring of the basename
// Only paths with a supported media type (see `mediaTypeForFigure`) are
// considered — vector figures (.pdf/.eps) are skipped on purpose.
export function matchFigureFile(files: string[], name: string): string | null {
  const supported = files.filter((p) => mediaTypeForFigure(p) !== null);
  if (!supported.length) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const exact = supported.find((p) => p === trimmed);
  if (exact) return exact;

  const byBase = supported.find((p) => basename(p) === trimmed);
  if (byBase) return byBase;

  for (const ext of [".png", ".jpg", ".jpeg", ".gif", ".webp"]) {
    const target = trimmed.toLowerCase().endsWith(ext)
      ? trimmed
      : `${trimmed}${ext}`;
    const m = supported.find(
      (p) => basename(p).toLowerCase() === target.toLowerCase(),
    );
    if (m) return m;
  }

  const lower = trimmed.toLowerCase();
  return (
    supported.find((p) => basename(p).toLowerCase().includes(lower)) ?? null
  );
}

export interface LoadedArxivFigure {
  /** Relative path inside `source/` that we actually loaded. */
  path: string;
  bytes: Uint8Array;
  mediaType: string;
}

// Locate a cached arXiv figure by name and return its bytes + media type,
// or null when no supported figure matches. Vector PDFs ARE indexed in
// `meta.files` but `matchFigureFile` filters them out — the model is told
// in the tool description to ask for the raster version when available.
export async function readArxivFigure(
  arxivId: string,
  name: string,
): Promise<LoadedArxivFigure | null> {
  const meta = await readArxivMeta(arxivId);
  if (!meta || meta.status !== "ok" || !meta.files?.length) return null;
  const matched = matchFigureFile(meta.files, name);
  if (!matched) return null;
  const mediaType = mediaTypeForFigure(matched);
  if (!mediaType) return null;
  try {
    const bytes = await io().read(
      appendLocalPath(arxivFolderPath(arxivId), "source", matched),
    );
    return { path: matched, bytes, mediaType };
  } catch {
    return null;
  }
}

export function mediaTypeForSourceAsset(path: string): string | null {
  return (
    mediaTypeForFigure(path) ??
    (path.toLowerCase().endsWith(".svg")
      ? "image/svg+xml"
      : path.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : path.toLowerCase().endsWith(".eps")
          ? "application/postscript"
          : null)
  );
}

export function matchSourceAssetFile(
  files: string[],
  name: string,
): string | null {
  const supported = files.filter(
    (path) => mediaTypeForSourceAsset(path) !== null,
  );
  const requested = safeRel(name.trim());
  if (!requested || !supported.length) return null;
  const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const exact = supported.find(
    (path) => path.toLowerCase() === requested.toLowerCase(),
  );
  if (exact) return exact;
  const byBasename = supported.find(
    (path) =>
      basename(path).toLowerCase() === basename(requested).toLowerCase(),
  );
  if (byBasename) return byBasename;

  const requestedStem = requested.replace(/\.[^./]+$/, "").toLowerCase();
  const basenameStem = basename(requestedStem);
  const candidates = supported.filter((path) => {
    const pathStem = path.replace(/\.[^./]+$/, "").toLowerCase();
    return pathStem === requestedStem || basename(pathStem) === basenameStem;
  });
  const extensionOrder = [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
    ".pdf",
    ".eps",
  ];
  return (
    candidates.sort(
      (a, b) =>
        extensionOrder.findIndex((extension) =>
          a.toLowerCase().endsWith(extension),
        ) -
        extensionOrder.findIndex((extension) =>
          b.toLowerCase().endsWith(extension),
        ),
    )[0] ?? null
  );
}

export interface LoadedArxivSourceAsset {
  path: string;
  bytes: Uint8Array;
  mediaType: string;
}

export async function readArxivSourceAsset(
  arxivId: string,
  name: string,
): Promise<LoadedArxivSourceAsset | null> {
  const meta = await readArxivMeta(arxivId);
  if (!meta || meta.status !== "ok" || !meta.files?.length) return null;
  const matched = matchSourceAssetFile(meta.files, name);
  if (!matched) return null;
  const mediaType = mediaTypeForSourceAsset(matched);
  if (!mediaType) return null;
  try {
    const bytes = await io().read(
      appendLocalPath(arxivFolderPath(arxivId), "source", matched),
    );
    return { path: matched, bytes, mediaType };
  } catch {
    return null;
  }
}
