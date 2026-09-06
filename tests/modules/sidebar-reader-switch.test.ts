// @vitest-environment-options {"happyDOM":{"settings":{"disableCSSFileLoading":true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSidebar, unregisterSidebar } from "../../src/modules/sidebar";
import { saveChatMessages } from "../../src/settings/chat-history";

let selected: number;
let readers: Map<string, unknown>;
let itemSelected: ReturnType<typeof vi.fn>;
const host = window as any;

beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div><div id="zotero-context-pane"></div></div>';
  (document as any).createXULElement = (tag: string) =>
    document.createElement(tag);
  const files = new Map<string, string>();
  const prefs = new Map<string, unknown>();
  const items = new Map(
    [101, 102, 103].map((id) => [
      id,
      {
        id,
        getField: (name: string) => (name === "title" ? `Paper ${id}` : ""),
        getAttachments: () => [],
        getNotes: () => [],
        isRegularItem: () => true,
      },
    ]),
  );
  selected = 101;
  readers = new Map([
    ["pdf-a", { _item: { id: 201, parentID: 101 } }],
    ["pdf-b", { _item: { id: 202, parentID: 102 } }],
  ]);
  host.Zotero_Tabs = { selectedID: "pdf-a" };
  itemSelected = vi.fn();
  host.ZoteroPane = {
    getSelectedItems: () => [items.get(selected)],
    itemSelected,
  };
  vi.stubGlobal("addon", {
    data: {
      config: {
        addonID: "zotero-ai-sidebar@local",
        addonRef: "zotero-ai-sidebar",
      },
      alive: true,
    },
  });
  vi.stubGlobal("Zotero", {
    getMainWindows: () => [window],
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
    Items: { get: (id: number) => items.get(id) },
    Reader: { getByTabID: (id: string) => readers.get(id) },
    Profile: { dir: "/tmp/sidebar-reader-switch" },
    File: {
      getContentsAsync: async (file: string) => files.get(file) || "{}",
      putContentsAsync: async (file: string, content: string) => {
        files.set(file, content);
      },
    },
    debug: vi.fn(),
  });
  await saveChatMessages(101, [
    { role: "assistant", content: "Answer for paper A" },
  ]);
  await saveChatMessages(102, [
    { role: "assistant", content: "Answer for paper B" },
  ]);
  registerSidebar();
  // Drain bootstrap refreshes first: they must not accidentally make a tab
  // switch pass without the ongoing selection listener.
  await vi.advanceTimersByTimeAsync(2000);
});

afterEach(() => {
  unregisterSidebar();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete host.Zotero_Tabs;
  delete host.ZoteroPane;
  document.body.replaceChildren();
});

function expectPaper(id: number, answer?: string) {
  const root = document.getElementById("zai-root")!;
  expect(root.querySelector(".ctx-meta")?.textContent).toContain(
    `Item ID: ${id}`,
  );
  if (answer) expect(root.textContent).toContain(answer);
}

describe("sidebar follows the active paper", () => {
  it("switches history on PDF tab selection without a body click or library selection", async () => {
    expectPaper(101, "Answer for paper A");
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(120);
    expectPaper(102, "Answer for paper B");
    expect(itemSelected).not.toHaveBeenCalled();
    host.Zotero_Tabs.selectedID = "pdf-a";
    await vi.advanceTimersByTimeAsync(120);
    expectPaper(101, "Answer for paper A");
  });

  it("preserves switching from the library item list", async () => {
    host.Zotero_Tabs.selectedID = "library";
    selected = 102;
    host.ZoteroPane.itemSelected();
    await vi.advanceTimersByTimeAsync(1);
    expectPaper(102, "Answer for paper B");
  });

  it("follows a reader that becomes available after selecting its tab", async () => {
    const reader = readers.get("pdf-b");
    readers.delete("pdf-b");
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(120);
    readers.set("pdf-b", reader);
    await vi.advanceTimersByTimeAsync(120);
    expectPaper(102, "Answer for paper B");
    expect(itemSelected).not.toHaveBeenCalled();
  });
});
