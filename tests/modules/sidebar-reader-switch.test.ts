// @vitest-environment-options {"happyDOM":{"settings":{"disableCSSFileLoading":true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSidebar, unregisterSidebar } from "../../src/modules/sidebar";
import {
  saveChatMessages,
  loadChatConversations,
  saveChatConversations,
} from "../../src/settings/chat-history";

import * as arxivID from "../../src/context/arxiv-id";
import { zoteroContextSource } from "../../src/context/zotero-source";
import * as arxivStore from "../../src/context/arxiv-store";
import * as arxivSource from "../../src/context/arxiv-source";
import * as contextBuilder from "../../src/context/builder";
import * as providerFactory from "../../src/providers/factory";

import { windowSidebars } from "../../src/modules/sidebar-state";
import * as overviewStore from "../../src/context/overview-store";

import * as markdownRenderer from "../../src/modules/markdown-render";

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
  prefs.set(
    "extensions.zotero-ai-sidebar.presets",
    JSON.stringify([
      {
        id: "first",
        label: "First",
        provider: "openai",
        apiKey: "test",
        model: "model-first",
        baseUrl: "https://example.test/v1",
        maxTokens: 1024,
      },
      {
        id: "chosen",
        label: "Chosen",
        provider: "openai",
        apiKey: "test",
        model: "model-chosen",
        baseUrl: "https://example.test/v1",
        maxTokens: 1024,
        extras: { agentPermissionMode: "yolo" },
      },
    ]),
  );
  const items = new Map(
    [101, 102, 103].map((id) => [
      id,
      {
        id,
        key: `PAPER${id}`,
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
    Utilities: { randomString: () => "test-task" },
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
  vi.restoreAllMocks();
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
  it("realigns docked startup layout when the sidebar stylesheet finishes loading", async () => {
    unregisterSidebar();
    const { saveLocalUiSettings, DEFAULT_LOCAL_UI_SETTINGS } =
      await import("../../src/settings/local-ui-settings");
    saveLocalUiSettings((globalThis as any).Zotero.Prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      sidebarDisplayMode: "docked",
    });
    let top = 320;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return {
          left: 0,
          top: this.id === "zai-column" ? top : 0,
          width: 480,
          height: 700,
          right: 480,
          bottom: 700,
        } as DOMRect;
      },
    );
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    const sidebar = windowSidebars.get(window)!;
    expect((sidebar.column as HTMLElement).style.transform).toBe(
      "translateY(-320px)",
    );
    top = 0;
    sidebar.column
      .querySelector('link[href$="/sidebar.css"]')!
      .dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(30);
    expect((sidebar.column as HTMLElement).style.transform).toBe("");
    expect((sidebar.column as HTMLElement).style.height).toBe(
      `${window.innerHeight}px`,
    );
  });

  it("coalesces a burst of streamed tokens instead of rebuilding each token", async () => {
    vi.spyOn(contextBuilder, "buildContext").mockResolvedValue({ systemPrompt: "test" } as Awaited<ReturnType<typeof contextBuilder.buildContext>>);
    vi.spyOn(zoteroContextSource, "getFullText").mockResolvedValue("PDF");
    vi.spyOn(providerFactory, "getProvider").mockReturnValue({
      stream: async function* () {
        for (let i = 0; i < 100; i++) yield { type: "text_delta" as const, text: "stream-fragment " };
      },
    });
    const render = vi.spyOn(markdownRenderer, "renderMarkdownInto");
    const input = document.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    const renders = render.mock.calls.filter((call) => call[1].includes("stream-fragment"));
    expect(renders.length).toBeLessThan(10);
    expect(document.body.textContent).toContain("stream-fragment ".repeat(100).trim());
  });

  it("sends local PDF context while the background LaTeX download remains pending", async () => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(arxivID, "resolveArxivIdForItemID").mockReturnValue("2304.13705");
    const download = vi
      .spyOn(arxivSource, "ensureArxivSource")
      .mockReturnValue(pending);
    vi.spyOn(arxivStore, "readArxivMainText").mockResolvedValue(null);
    vi.spyOn(contextBuilder, "buildContext").mockResolvedValue({
      systemPrompt: "test",
    } as Awaited<ReturnType<typeof contextBuilder.buildContext>>);
    const pdf = vi
      .spyOn(zoteroContextSource, "getFullText")
      .mockResolvedValue("Local PDF body");
    const stream = vi.fn(async function* () {
      yield { type: "text_delta" as const, text: "Reply using the local PDF" };
    });
    vi.spyOn(providerFactory, "getProvider").mockReturnValue({ stream });
    const input = document.querySelector<HTMLTextAreaElement>(
      ".input-row textarea",
    )!;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(download).toHaveBeenCalled();
    expect(pdf).toHaveBeenCalledWith(101);
    expect(stream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      expect.anything(),
      expect.objectContaining({
        pinnedFullText: "Local PDF body",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "zotero_outline_pdf" }),
          expect.objectContaining({ name: "render_paper_overview" }),
          expect.objectContaining({ name: "zotero_get_full_pdf" }),
        ]),
      }),
    );
    expect(document.body.textContent).toContain("Reply using the local PDF");
    finish(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stream).toHaveBeenCalledOnce();
  });

  it("uses a cache completed elsewhere while an older download remains pending", async () => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(arxivID, "resolveArxivIdForItemID").mockReturnValue("2504.16054");
    const download = vi
      .spyOn(arxivSource, "ensureArxivSource")
      .mockReturnValue(pending);
    vi.spyOn(arxivStore, "hasArxivSource").mockResolvedValue(true);
    vi.spyOn(arxivStore, "readArxivMainText").mockResolvedValue(
      "\\section{Cached Method}\nAlready available source.",
    );
    vi.spyOn(contextBuilder, "buildContext").mockResolvedValue({
      systemPrompt: "test",
    } as Awaited<ReturnType<typeof contextBuilder.buildContext>>);
    const pdf = vi
      .spyOn(zoteroContextSource, "getFullText")
      .mockResolvedValue("Local PDF body");
    const stream = vi.fn(async function* () {
      yield { type: "text_delta" as const, text: "Cached reply" };
    });
    vi.spyOn(providerFactory, "getProvider").mockReturnValue({ stream });
    const input = document.querySelector<HTMLTextAreaElement>(
      ".input-row textarea",
    )!;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(stream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      expect.anything(),
      expect.objectContaining({
        pinnedFullText: expect.stringContaining("Cached Method"),
      }),
    );
    expect(pdf).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalled();
    finish(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stream).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Cached reply");
  });

  it("stops during context preparation without waiting or sending a model request", async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof contextBuilder.buildContext>>,
    ) => void;
    const pending = new Promise<
      Awaited<ReturnType<typeof contextBuilder.buildContext>>
    >((resolve) => {
      finish = resolve;
    });
    const build = vi
      .spyOn(contextBuilder, "buildContext")
      .mockReturnValue(pending);
    const provider = vi.spyOn(providerFactory, "getProvider");
    const input = document.querySelector<HTMLTextAreaElement>(
      ".input-row textarea",
    )!;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(build).toHaveBeenCalled();
    expect(document.body.textContent).toContain("正在整理上下文");
    expect(document.body.textContent).toContain("正在读取论文题录");
    const stop = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "停止",
    )!;
    expect(stop).toBeTruthy();
    await vi.advanceTimersByTimeAsync(100);
    stop.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(document.body.textContent).toContain("已取消本次回答。");
    expect(document.querySelector(".assistant-live-progress")).toBeNull();
    const stageLog = vi
      .mocked(Zotero.debug)
      .mock.calls.map(([message]) => String(message))
      .find(
        (message) =>
          message.includes("chat.prepare.stage") &&
          message.includes("正在读取论文题录"),
      );
    expect(stageLog).toBeTruthy();
    const recorded = JSON.parse(stageLog!.slice(stageLog!.indexOf("{")));
    expect(recorded.cancelled).toBe(true);
    expect(recorded.elapsedMs).toBeGreaterThanOrEqual(100);
    finish({ systemPrompt: "test" } as Awaited<
      ReturnType<typeof contextBuilder.buildContext>
    >);
    await vi.advanceTimersByTimeAsync(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it("keeps the selected account, model and YOLO across papers and remounts", async () => {
    const workspace = await loadChatConversations(102);
    workspace.conversations[0].presetID = "first";
    await saveChatConversations(102, workspace);
    const select = document.querySelector<HTMLSelectElement>(
      ".composer-preset-select",
    )!;
    select.value = "chosen";
    select.dispatchEvent(new Event("change"));
    const expectSelection = () => {
      expect(
        document.querySelector<HTMLSelectElement>(".composer-preset-select")
          ?.value,
      ).toBe("chosen");
      expect(document.querySelector(".model-switcher")?.textContent).toContain(
        "model-chosen",
      );
      expect(
        document.querySelector<HTMLInputElement>(
          ".yolo-toggle:not(.copy-debug-toggle) input",
        )?.checked,
      ).toBe(true);
    };
    expectSelection();
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(120);
    expectPaper(102, "Answer for paper B");
    expectSelection();
    host.Zotero_Tabs.selectedID = "pdf-a";
    await vi.advanceTimersByTimeAsync(120);
    expectSelection();
    unregisterSidebar();
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    expectSelection();
  });

  it("switches an open overview to the newly selected PDF", async () => {
    const sidebar = windowSidebars.get(window)!;
    sidebar.overviewActive = true;
    sidebar.noteMount.textContent = "Overview of paper A";
    const load = vi.spyOn(overviewStore, "loadOverview").mockResolvedValue({
      updatedAt: 1,
      data: { title: "Paper B", source: "pdf", coverage: "headings",
        narrative: "Overview of paper B", sections: [] },
    });
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(120);
    expect(sidebar.noteMount.textContent).not.toContain("Overview of paper A");
    expect(sidebar.noteMount.textContent).toContain("Overview of paper B");
    expect(load).toHaveBeenCalled();
  });

  it("does not restore a stale overview after another PDF switch", async () => {
    const sidebar = windowSidebars.get(window)!;
    sidebar.overviewActive = true;
    let finish!: (value: Awaited<ReturnType<typeof overviewStore.loadOverview>>) => void;
    vi.spyOn(overviewStore, "loadOverview").mockImplementation((key) =>
      key === "PAPER102" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(null),
    );
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(120);
    host.Zotero_Tabs.selectedID = "pdf-a";
    await vi.advanceTimersByTimeAsync(120);
    expect(sidebar.noteMount.textContent).toContain("还没有全文总览");
    finish({ updatedAt: 1, data: { title: "Paper B", source: "pdf",
      coverage: "headings", narrative: "Stale paper B overview", sections: [] } });
    await vi.advanceTimersByTimeAsync(1);
    expect(sidebar.noteMount.textContent).not.toContain("Stale paper B overview");
    expect(sidebar.noteMount.textContent).toContain("还没有全文总览");
  });

  it("keeps an open note column open across papers without notes", async () => {
    const sidebar = windowSidebars.get(window)!;
    sidebar.noteColumn.removeAttribute("hidden");
    sidebar.noteColumn.removeAttribute("collapsed");
    Object.assign(sidebar.noteColumn, { hidden: false, collapsed: false });
    sidebar.noteItemID = 999;
    for (const tab of ["pdf-b", "pdf-a"]) {
      host.Zotero_Tabs.selectedID = tab;
      await vi.advanceTimersByTimeAsync(120);
      expect(sidebar.noteColumn.getAttribute("hidden")).not.toBe("true");
      expect(sidebar.noteMount.textContent).toContain("还没有 AI 笔记");
      expect(document.querySelector(".open-note-button")?.textContent).toBe("关闭笔记");
    }
    (document.querySelector(".open-note-button") as HTMLButtonElement).click();
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(120);
    expect(sidebar.noteColumn.getAttribute("hidden")).toBe("true");
  });

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
