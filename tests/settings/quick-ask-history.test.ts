import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadQuickAskHistory,
  saveQuickAskHistory,
  type QuickAskHistoryEntry,
} from "../../src/settings/quick-ask-history";
import {
  buildQuickAskApiMessages,
  createQuickAskState,
} from "../../src/modules/quick-ask";

let files: Map<string, string>;
const entry = (
  id: string,
  itemID: number | null = 1,
): QuickAskHistoryEntry => ({
  id,
  itemID,
  createdAt: id,
  updatedAt: id,
  reference: { kind: "pdf", displayText: "选区", sourceText: "source" },
  messages: [
    { role: "user", content: "问题", context: { selectedText: "source" } },
    {
      role: "assistant",
      content: "回答",
      thinking: "思考",
      usage: { input: 10, output: 20 },
    },
  ],
});
beforeEach(() => {
  files = new Map();
  vi.stubGlobal("IOUtils", { exists: async (path: string) => files.has(path) });
  vi.stubGlobal("Zotero", {
    Profile: { dir: "/profile" },
    DataDirectory: { dir: "/data" },
    File: {
      getContentsAsync: async (path: string) => files.get(path),
      putContentsAsync: async (path: string, value: string) => {
        files.set(path, value);
      },
    },
  });
});
describe("Quick Ask archives", () => {
  it("keeps all sessions, updates one session without duplicates, and isolates papers", async () => {
    await Promise.all([
      saveQuickAskHistory(entry("a")),
      saveQuickAskHistory(entry("b")),
      saveQuickAskHistory(entry("c", 2)),
      saveQuickAskHistory(entry("d", null)),
    ]);
    const updated = entry("a");
    updated.messages.push({ role: "user", content: "追问" });
    await saveQuickAskHistory(updated);
    expect((await loadQuickAskHistory(1)).map((x) => x.id)).toEqual(["b", "a"]);
    expect((await loadQuickAskHistory(1))[1].messages).toHaveLength(3);
    expect((await loadQuickAskHistory(2)).map((x) => x.id)).toEqual(["c"]);
    expect((await loadQuickAskHistory(null)).map((x) => x.id)).toEqual(["d"]);
  });
  it("persists message metadata without adding archived messages to a fresh conversation", async () => {
    const original = entry("a");
    const saving = saveQuickAskHistory(original);
    original.messages[0].content = "mutated";
    await saving;
    expect((await loadQuickAskHistory(1))[0]).toEqual(entry("a"));
    expect(files.has("/data/zotero-ai-sidebar-quick-ask-history.json")).toBe(
      true,
    );
    const fresh = createQuickAskState();
    expect(fresh.messages).toEqual([]);
    expect(buildQuickAskApiMessages(fresh.messages)).toEqual([]);
    await saveQuickAskHistory({ ...entry("empty"), messages: [] });
    expect(await loadQuickAskHistory(1)).toHaveLength(1);
  });
  it("snapshots a partial response on close and preserves it after later sessions", async () => {
    const partial = entry("partial");
    partial.messages[1].content = "尚未生成完的回答";
    partial.messages[1].images = [
      {
        id: "figure",
        name: "figure.png",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,abc",
        size: 3,
      },
    ];
    await saveQuickAskHistory(partial);
    await saveQuickAskHistory(entry("new-session"));
    expect(
      (await loadQuickAskHistory(1)).find((saved) => saved.id === "partial"),
    ).toEqual(partial);
  });

  it("does not overwrite corrupt history and reports the failure", async () => {
    files.set("/data/zotero-ai-sidebar-quick-ask-history.json", "invalid");
    await expect(saveQuickAskHistory(entry("a"))).rejects.toThrow();
    expect(files.get("/data/zotero-ai-sidebar-quick-ask-history.json")).toBe(
      "invalid",
    );
  });
});
