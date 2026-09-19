import { appendLocalPath, localDirname } from "../utils/local-path";
import { downloadMineruResult, type MineruParseResult } from "./mineru-client";
import { mineruImagePath } from "./mineru-zip";
import { loadMineruSettings } from "../settings/mineru";
import { zoteroPrefs } from "../settings/storage";

export interface MineruCacheMeta {
  itemKey: string;
  pdfSize: number;
  pdfMtime: number;
  sourceHash: string;
  batchId?: string;
  parsedAt: string;
  assets?: string[];
}

interface IOUtilsLike {
  makeDirectory(
    path: string,
    options?: { ignoreExisting?: boolean; createAncestors?: boolean },
  ): Promise<void>;
  writeUTF8(path: string, data: string): Promise<unknown>;
  readUTF8(path: string): Promise<string>;
  exists?(path: string): Promise<boolean>;
  stat?(path: string): Promise<{ size?: number; lastModified?: number }>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<unknown>;
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

export async function readPdfStat(
  path: string,
): Promise<{ size: number; mtime: number }> {
  const IO = io();
  const stat = await IO.stat?.(path);
  if (stat && typeof stat.size === "number") {
    return { size: stat.size, mtime: stat.lastModified ?? 0 };
  }
  const bytes = await IO.read(path);
  return { size: bytes.byteLength, mtime: 0 };
}

export async function readPdfBytes(path: string): Promise<Uint8Array> {
  return io().read(path);
}

export async function readPdfFingerprint(
  path: string,
): Promise<{ size: number; mtime: number; bytes: Uint8Array }> {
  const bytes = await readPdfBytes(path);
  const stat = await readPdfStat(path);
  return { bytes, size: stat.size, mtime: stat.mtime };
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
    assets: await saveMineruAssets(itemKey, parsed.assets ?? {}),
  };
  await IO.writeUTF8(appendLocalPath(folder, "meta.json"), JSON.stringify(meta, null, 2));
  await IO.writeUTF8(appendLocalPath(folder, "full.md"), parsed.markdown);
  await IO.writeUTF8(
    appendLocalPath(folder, "content_list.json"),
    JSON.stringify(parsed.contentList ?? null),
  );
}

async function saveMineruAssets(itemKey: string, assets: Record<string, Uint8Array>): Promise<string[]> {
  const paths: string[] = [];
  for (const [name, bytes] of Object.entries(assets)) {
    const path = mineruImagePath(name);
    if (!path) continue;
    const target = appendLocalPath(mineruCacheFolder(itemKey), "assets", path);
    await io().makeDirectory(localDirname(target), {
      ignoreExisting: true,
      createAncestors: true,
    });
    await io().write(target, bytes);
    paths.push(path);
  }
  return paths;
}

const assetRestores = new Map<string, Promise<void>>();

export async function ensureMineruCachedAssets(itemKey: string): Promise<void> {
  const existing = assetRestores.get(itemKey);
  if (existing) return existing;
  const pending = restoreMineruAssets(itemKey);
  assetRestores.set(itemKey, pending);
  try {
    await pending;
  } finally {
    assetRestores.delete(itemKey);
  }
}

async function restoreMineruAssets(itemKey: string): Promise<void> {
  const path = appendLocalPath(mineruCacheFolder(itemKey), "meta.json");
  const meta = JSON.parse(await io().readUTF8(path)) as MineruCacheMeta;
  if (!(await pictureAssetsMissing(itemKey, meta))) return;
  const token = loadMineruSettings(zoteroPrefs()).token;
  if (!token) throw new Error("补齐图片缓存需要配置 MinerU Token");
  if (!meta.batchId) throw new Error("缺少 MinerU 原解析任务，无法补齐图片缓存");
  const result = await downloadMineruResult(meta.batchId, { token });
  meta.assets = await saveMineruAssets(itemKey, result.assets ?? {});
  await io().writeUTF8(path, JSON.stringify(meta, null, 2));
}

/**
 * Parses written before the plugin cached pictures list no assets at all, and a
 * cache whose `assets/` folder was pruned still lists files that are gone. Both
 * mean the pictures have to be fetched again; a complete cache costs a handful
 * of `exists` calls.
 */
async function pictureAssetsMissing(
  itemKey: string,
  meta: MineruCacheMeta,
): Promise<boolean> {
  if (!Array.isArray(meta.assets)) return true;
  const IO = io();
  if (!IO.exists) return false;
  const folder = appendLocalPath(mineruCacheFolder(itemKey), "assets");
  for (const asset of meta.assets) {
    const safe = mineruImagePath(asset);
    if (safe && !(await IO.exists(appendLocalPath(folder, safe)))) return true;
  }
  return false;
}

export async function readMineruAsset(itemKey: string, sourcePath: string): Promise<{
  path: string;
  bytes: Uint8Array;
  mediaType: string;
} | null> {
  const path = mineruImagePath(sourcePath);
  if (!path) return null;
  const extension = path.split(".").pop()!.toLowerCase();
  try {
    const bytes = await io().read(appendLocalPath(mineruCacheFolder(itemKey), "assets", path));
    return { path, bytes, mediaType: `image/${extension === "jpg" ? "jpeg" : extension}` };
  } catch {
    return null;
  }
}
