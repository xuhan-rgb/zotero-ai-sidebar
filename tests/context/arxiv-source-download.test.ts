import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureArxivSource,
  arxivSourceError,
  ARXIV_SOURCE_CLEANER_VERSION,
} from "../../src/context/arxiv-source";
import { readArxivMeta } from "../../src/context/arxiv-store";
import { downloadLatexSource } from "../../src/context/latex-download";
import { saveLatexProxy } from "../../src/settings/latex-proxy";
import { zoteroPrefs } from "../../src/settings/storage";

vi.mock("../../src/context/latex-download", () => ({
  downloadLatexSource: vi.fn(),
}));
vi.mock("../../src/context/arxiv-store", () => ({
  hasArxivSource: async () => false,
  readArxivMeta: vi.fn().mockResolvedValue(null),
  writeArxivSource: vi.fn(),
}));
const download = vi.mocked(downloadLatexSource);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readArxivMeta).mockResolvedValue(null);
  const prefs = new Map();
  vi.stubGlobal("Zotero", {
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: string) => prefs.set(key, value),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("shared source downloads", () => {
  it("uses a cache completed elsewhere instead of joining an older pending download", async () => {
    let reject!: (reason: Error) => void;
    download.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const old = ensureArxivSource({ arxivId: "completed-elsewhere" });
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    vi.mocked(readArxivMeta).mockResolvedValue({
      arxivId: "completed-elsewhere",
      status: "ok",
      fetchedAt: new Date().toISOString(),
      mainTexRelPath: "main.tex",
      cleanerVersion: ARXIV_SOURCE_CLEANER_VERSION,
    });
    let result: boolean | undefined;
    const next = ensureArxivSource({ arxivId: "completed-elsewhere" }).then(
      (value) => {
        result = value;
      },
    );
    try {
      await vi.waitFor(() => expect(result).toBe(true), {
        timeout: 100,
        interval: 5,
      });
      expect(download).toHaveBeenCalledOnce();
    } finally {
      reject(new Error("old download timed out"));
      await Promise.all([old, next]);
    }
    expect(arxivSourceError("completed-elsewhere")).toBeUndefined();
  });

  it("coalesces callers and allows retry after timeout", async () => {
    let reject!: (reason: Error) => void;
    download.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const first = ensureArxivSource({ arxivId: "timeout-paper" });
    const second = ensureArxivSource({ arxivId: "timeout-paper" });
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(download).toHaveBeenCalledOnce();
    reject(new Error("Request timed out after 60000 ms"));
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(arxivSourceError("timeout-paper")).toBe("下载超时（60 秒）");
    download.mockResolvedValueOnce({
      status: 200,
      response: new TextEncoder().encode("%PDF").buffer,
    });
    await ensureArxivSource({ arxivId: "timeout-paper" });
    expect(download).toHaveBeenCalledTimes(2);
    expect(arxivSourceError("timeout-paper")).toBeUndefined();
  });

  it("uses newly saved proxy settings without reusing the old pending connection", async () => {
    let reject!: (reason: Error) => void;
    download.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const old = ensureArxivSource({ arxivId: "changed-proxy" });
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    saveLatexProxy(zoteroPrefs(), {
      mode: "direct",
    });
    download.mockResolvedValueOnce({
      status: 200,
      response: new TextEncoder().encode("%PDF").buffer,
    });
    await ensureArxivSource({ arxivId: "changed-proxy" });
    expect(download).toHaveBeenLastCalledWith(expect.any(String), 60000, {
      mode: "direct",
    });
    reject(new Error("old connection failed"));
    await old;
    expect(arxivSourceError("changed-proxy")).toBeUndefined();
  });
});
