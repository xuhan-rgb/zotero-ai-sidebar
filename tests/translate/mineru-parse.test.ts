import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureMineruParse, resetMineruParseCache } from "../../src/translate/mineru-parse";
import { parsePdfWithMineru } from "../../src/translate/mineru-client";
import { resolveItemPdfForMineru } from "../../src/translate/mineru-session";
import { loadMineruSettings } from "../../src/settings/mineru";

vi.mock("../../src/translate/mineru-client", () => ({
  parsePdfWithMineru: vi.fn(),
}));
vi.mock("../../src/translate/mineru-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/translate/mineru-session")>();
  return {
    ...actual,
    resolveItemPdfForMineru: vi.fn(),
  };
});
vi.mock("../../src/settings/mineru", () => ({
  loadMineruSettings: vi.fn(() => ({ token: "tok" })),
}));

const parse = vi.mocked(parsePdfWithMineru);
const resolvePdf = vi.mocked(resolveItemPdfForMineru);
const token = vi.mocked(loadMineruSettings);

beforeEach(() => {
  resetMineruParseCache();
  vi.clearAllMocks();
  token.mockReturnValue({ token: "tok" });
  resolvePdf.mockResolvedValue({
    itemKey: "ABCD1234",
    pdfPath: "/tmp/paper.pdf",
    fileName: "paper.pdf",
  });
  const files = new Map<string, string>();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      DataDirectory: { dir: "/data" },
      Profile: { dir: "/profile" },
      Prefs: { get: () => undefined, set: () => undefined },
    },
  });
  Object.defineProperty(globalThis, "IOUtils", {
    configurable: true,
    value: {
      stat: async () => ({ size: 12, lastModified: 100 }),
      read: async () => new Uint8Array([1, 2, 3]),
      readUTF8: async (path: string) => {
        const value = files.get(path);
        if (value == null) throw new Error("missing");
        return value;
      },
      writeUTF8: async (path: string, contents: string) => {
        files.set(path, contents);
      },
      makeDirectory: async () => undefined,
    },
  });
});

describe("ensureMineruParse", () => {
  it("does not call MinerU when a matching cache already exists", async () => {
    const IO = (globalThis as unknown as { IOUtils: { writeUTF8: Function } }).IOUtils;
    await IO.writeUTF8(
      "/data/zotero-ai-sidebar-mineru/ABCD1234/meta.json",
      JSON.stringify({ pdfSize: 12, pdfMtime: 100 }),
    );
    await IO.writeUTF8("/data/zotero-ai-sidebar-mineru/ABCD1234/full.md", "# Paper");
    await IO.writeUTF8(
      "/data/zotero-ai-sidebar-mineru/ABCD1234/content_list.json",
      "[]",
    );
    await expect(ensureMineruParse(7)).resolves.toEqual({ status: "ready" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("parses through MinerU only when there is no cache", async () => {
    parse.mockResolvedValue({
      markdown: "# Paper\n\nHello.",
      contentList: [{ type: "title", text: "Paper" }],
      batchId: "b1",
    });
    await expect(ensureMineruParse(7)).resolves.toEqual({ status: "ready" });
    expect(parse).toHaveBeenCalledOnce();
  });

  it("does not parse without a token", async () => {
    token.mockReturnValue({ token: "" });
    await expect(ensureMineruParse(7)).resolves.toEqual({ status: "no-token" });
    expect(parse).not.toHaveBeenCalled();
  });
});
