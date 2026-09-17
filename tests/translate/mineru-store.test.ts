import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { ensureMineruCachedAssets, readMineruAsset, saveMineruCache } from "../../src/translate/mineru-store";

const root = "/data/zotero-ai-sidebar-mineru/ITEM";
let files: Map<string, Uint8Array>;
const image = new Uint8Array([137, 80, 78, 71]);

beforeEach(() => {
  files = new Map();
  vi.stubGlobal("Zotero", {
    DataDirectory: { dir: "/data" }, Profile: { dir: "/profile" },
    Prefs: { get: () => JSON.stringify({ token: "test-token" }) },
  });
  vi.stubGlobal("IOUtils", {
    makeDirectory: vi.fn(async () => undefined),
    write: async (path: string, bytes: Uint8Array) => { files.set(path, bytes); },
    writeUTF8: async (path: string, text: string) => { files.set(path, strToU8(text)); },
    read: async (path: string) => {
      if (!files.has(path)) throw new Error("missing");
      return files.get(path)!;
    },
    readUTF8: async (path: string) => {
      if (!files.has(path)) throw new Error("missing");
      return new TextDecoder().decode(files.get(path)!);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("MinerU image cache", () => {
  it("persists image bytes safely and reads them without network access", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await saveMineruCache("ITEM", { size: 12, mtime: 1 }, {
      markdown: "# Title", contentList: [], batchId: "batch",
      assets: { "images/figure.png": image, "../escape.png": image },
    }, "hash");
    await ensureMineruCachedAssets("ITEM");
    expect(await readMineruAsset("ITEM", "images/figure.png")).toEqual({
      path: "images/figure.png", bytes: image, mediaType: "image/png",
    });
    expect(await readMineruAsset("ITEM", "../escape.png")).toBeNull();
    expect([...files.keys()].some((path) => path.includes("escape"))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("restores old caches from the existing result without uploading or reparsing", async () => {
    files.set(`${root}/meta.json`, strToU8(JSON.stringify({ batchId: "old-batch", sourceHash: "original" })));
    const zip = zipSync({ "result/full.md": strToU8("# Title"), "result/images/figure.png": image });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      if (url.endsWith("/extract-results/batch/old-batch")) {
        return Response.json({ code: 0, data: { extract_result: [{ state: "done", full_zip_url: "https://example.test/result.zip" }] } });
      }
      if (url === "https://example.test/result.zip") return new Response(zip);
      throw new Error("unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    await Promise.all([ensureMineruCachedAssets("ITEM"), ensureMineruCachedAssets("ITEM")]);
    await ensureMineruCachedAssets("ITEM");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await readMineruAsset("ITEM", "images/figure.png"))?.bytes).toEqual(image);
    expect(JSON.parse(new TextDecoder().decode(files.get(`${root}/meta.json`)))).toMatchObject({ sourceHash: "original", assets: ["images/figure.png"] });
  });

  it("leaves a failed restoration retryable", async () => {
    files.set(`${root}/meta.json`, strToU8(JSON.stringify({ batchId: "old-batch" })));
    const fetch = vi.fn(async () => Response.json({ code: -1, msg: "expired" }));
    vi.stubGlobal("fetch", fetch);
    await expect(ensureMineruCachedAssets("ITEM")).rejects.toThrow("expired");
    await expect(ensureMineruCachedAssets("ITEM")).rejects.toThrow("expired");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(new TextDecoder().decode(files.get(`${root}/meta.json`))).assets).toBeUndefined();
  });
});
