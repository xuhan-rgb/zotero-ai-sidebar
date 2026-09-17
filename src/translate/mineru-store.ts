import { appendLocalPath } from "../utils/local-path";
import type { MineruParseResult } from "./mineru-client";

export interface MineruCacheMeta {
  itemKey: string;
  pdfSize: number;
  pdfMtime: number;
  sourceHash: string;
  batchId?: string;
  parsedAt: string;
}

interface IOUtilsLike {
  makeDirectory(
    path: string,
    options?: { ignoreExisting?: boolean },
  ): Promise<void>;
  writeUTF8(path: string, data: string): Promise<unknown>;
  readUTF8(path: string): Promise<string>;
  exists?(path: string): Promise<boolean>;
  stat?(path: string): Promise<{ size?: number; lastModified?: number }>;
  read(path: string): Promise<Uint8Array>;
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

export function mineruCacheFolder(itemKey: string): string {
  return appendLocalPath(dataRoot(), "zotero-ai-sidebar-mineru", itemKey);
}

export async function readPdfFingerprint(
  path: string,
): Promise<{ size: number; mtime: number; bytes: Uint8Array }> {
  const IO = io();
  const bytes = await IO.read(path);
  const stat = await IO.stat?.(path);
  return {
    bytes,
    size: stat?.size ?? bytes.byteLength,
    mtime: stat?.lastModified ?? 0,
  };
}

export async function loadMineruCache(
  itemKey: string,
  pdfSize: number,
  pdfMtime: number,
): Promise<MineruParseResult | null> {
  try {
    const folder = mineruCacheFolder(itemKey);
    const meta = JSON.parse(await io().readUTF8(appendLocalPath(folder, "meta.json"))) as MineruCacheMeta;
    if (meta.pdfSize !== pdfSize || meta.pdfMtime !== pdfMtime) return null;
    const markdown = await io().readUTF8(appendLocalPath(folder, "full.md"));
    let contentList: unknown | null = null;
    try {
      contentList = JSON.parse(
        await io().readUTF8(appendLocalPath(folder, "content_list.json")),
      );
    } catch {
      contentList = null;
    }
    return { markdown, contentList, batchId: meta.batchId ?? "" };
  } catch {
    return null;
  }
}

export async function saveMineruCache(
  itemKey: string,
  fingerprint: { size: number; mtime: number },
  parsed: MineruParseResult,
  sourceHash: string,
): Promise<void> {
  const folder = mineruCacheFolder(itemKey);
  const IO = io();
  await IO.makeDirectory(folder, { ignoreExisting: true });
  const meta: MineruCacheMeta = {
    itemKey,
    pdfSize: fingerprint.size,
    pdfMtime: fingerprint.mtime,
    sourceHash,
    batchId: parsed.batchId,
    parsedAt: new Date().toISOString(),
  };
  await IO.writeUTF8(appendLocalPath(folder, "meta.json"), JSON.stringify(meta, null, 2));
  await IO.writeUTF8(appendLocalPath(folder, "full.md"), parsed.markdown);
  await IO.writeUTF8(
    appendLocalPath(folder, "content_list.json"),
    JSON.stringify(parsed.contentList ?? null),
  );
}
