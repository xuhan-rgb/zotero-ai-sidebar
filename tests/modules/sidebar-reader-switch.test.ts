import { Window as TestWindow } from "happy-dom";
import * as noteDedicated from "../../src/modules/note-dedicated";
// @vitest-environment-options {"happyDOM":{"settings":{"disableCSSFileLoading":true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSidebar, unregisterSidebar, refreshSidebarPreferences } from "../../src/modules/sidebar";
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

import { windowSidebars, states } from "../../src/modules/sidebar-state";
import * as overviewStore from "../../src/context/overview-store";

import * as markdownRenderer from "../../src/modules/markdown-render";

let selected: number;
let readers: Map<string, unknown>;
let itemSelected: ReturnType<typeof vi.fn>;
const host = window as any;

beforeEach(async () => {
  vi.stubGlobal("Cc", {
    "@mozilla.org/intl/ospreferences;1": {
      getService: () => ({ systemLocales: ["zh-CN"] }),
    },
  });
  vi.stubGlobal("Ci", { mozIOSPreferences: {} });
  host.happyDOM.settings.disableCSSFileLoading = true;
  host.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
  vi.useFakeTimers();
  document.body.innerHTML = '<div><div id="zotero-context-pane"></div></div>';
  (document as any).createXULElement = (tag: string) =>
    document.createElement(tag);
  const files = new Map<string, string>();
  const prefs = new Map<string, unknown>();
  // These layout tests exercise an open sidebar; fresh profiles start collapsed.
  prefs.set(
    "extensions.zotero-ai-sidebar.readerLayout",
    JSON.stringify({ aiOpen: true }),
  );
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
  it("does not disconnect a docked note editor when switching language", async () => {
    await vi.advanceTimersByTimeAsync(2000);
    const { saveLocalUiSettings, DEFAULT_LOCAL_UI_SETTINGS } = await import("../../src/settings/local-ui-settings");
    saveLocalUiSettings((globalThis as any).Zotero.Prefs, { ...DEFAULT_LOCAL_UI_SETTINGS, sidebarDisplayMode: "docked" });
    refreshSidebarPreferences();
    const sidebar = windowSidebars.get(window)!;
    const disconnected = vi.fn();
    class NoteEditor extends HTMLElement {
      disconnectedCallback() { disconnected(); this.replaceChildren(); }
    }
    if (!customElements.get("test-language-note-editor")) customElements.define("test-language-note-editor", NoteEditor);
    const editor = document.createElement("test-language-note-editor");
    editor.textContent = "已加载的笔记内容";
    sidebar.noteMount.append(editor);
    for (const language of ["en-US", "zh-CN"]) {
      Zotero.Prefs.set("extensions.zotero-ai-sidebar.interfaceLanguage", language, true);
      refreshSidebarPreferences();
      expect(disconnected).not.toHaveBeenCalled();
      expect(editor.textContent).toBe("已加载的笔记内容");
    }
  });

  it("updates the overview action in place when language changes", async () => {
    await vi.advanceTimersByTimeAsync(2000);
    const sidebar = windowSidebars.get(window)!;
    sidebar.noteMount.dataset.noteView = "overview";
    sidebar.noteMount.innerHTML = '<div class="zai-note-window-head"><button class="zai-note-act">↻ 更新总览</button></div><p>模型生成的中文总览正文</p>';
    const action = sidebar.noteMount.querySelector<HTMLButtonElement>(".zai-note-act")!;
    const clicked = vi.fn(); action.addEventListener("click", clicked);
    for (const language of ["en-US", "zh-CN"]) {
      Zotero.Prefs.set("extensions.zotero-ai-sidebar.interfaceLanguage", language, true);
      refreshSidebarPreferences();
      expect(action.textContent).toBe(language === "en-US" ? "↻ Update overview" : "↻ 更新总览");
      expect(sidebar.noteMount.querySelector(".zai-note-act")).toBe(action);
      expect(sidebar.noteMount.querySelector("p")!.textContent).toBe("模型生成的中文总览正文");
    }
    action.click(); expect(clicked).toHaveBeenCalledOnce();
  });

  it("updates an open note header language without replacing its editor", async () => {
    await vi.advanceTimersByTimeAsync(2000);
    const sidebar = windowSidebars.get(window)!;
    sidebar.noteMount.dataset.noteView = "normal";
    sidebar.noteMount.innerHTML = '<div class="zai-note-window-head"><div class="zai-note-seg"><button class="on">笔记</button><button>路线</button><button>总览</button></div><button class="zai-note-act">↻ 更新路线</button><span class="zai-note-window-status">Zotero 自动保存</span></div><div class="zai-note-rich-editor" contenteditable="true">未保存的笔记</div>';
    const editor = sidebar.noteMount.querySelector(".zai-note-rich-editor");
    const tabs = Array.from(sidebar.noteMount.querySelectorAll(".zai-note-seg button"));
    for (const language of ["en-US", "zh-CN"]) {
      Zotero.Prefs.set("extensions.zotero-ai-sidebar.interfaceLanguage", language, true);
      refreshSidebarPreferences();
      expect(Array.from(sidebar.noteMount.querySelectorAll(".zai-note-seg button"), (node) => node.textContent)).toEqual(language === "en-US" ? ["Notes", "Reading route", "Overview"] : ["笔记", "路线", "总览"]);
      expect(sidebar.noteMount.querySelector(".zai-note-window-status")!.textContent).toBe(language === "en-US" ? "Zotero autosave" : "Zotero 自动保存");
      Array.from(sidebar.noteMount.querySelectorAll(".zai-note-seg button")).forEach((button, index) => expect(button).toBe(tabs[index]));
      expect(tabs[0].classList.contains("on")).toBe(true);
      expect(sidebar.noteMount.querySelector(".zai-note-act")!.textContent).toBe(language === "en-US" ? "↻ Update route" : "↻ 更新路线");
      expect(sidebar.noteMount.querySelector(".zai-note-rich-editor")).toBe(editor);
      expect(editor!.textContent).toBe("未保存的笔记");
    }
  });

  it("offers language below font size and saves changes without losing the draft", async () => {
    await vi.advanceTimersByTimeAsync(2000);
    const language = document.querySelector<HTMLElement>(".chat-language-control")!;
    expect(language).not.toBeNull();
    expect(Array.from(language.querySelectorAll(".header-layout-choice-option"), option => option.textContent)).toEqual(["Auto", "中文", "English"]);
    expect(language.closest(".header-view-section")!.querySelector(".chat-font-size-control")).toBeTruthy();
    expect(language.closest(".header-view-menu")).toBeTruthy();
    const draft = document.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    draft.value = "保留草稿";
    draft.dispatchEvent(new Event("input"));
    for (const [value, label] of [["en-US", "English"], ["zh-CN", "中文"], ["auto", "Auto"]]) {
      const field = document.querySelector<HTMLElement>(".chat-language-control")!;
      [...field.querySelectorAll<HTMLButtonElement>(".header-layout-choice-option")].find(option => option.textContent === label)!.click();
      expect(Zotero.Prefs.get("extensions.zotero-ai-sidebar.interfaceLanguage", true)).toBe(value);
      expect(document.querySelector(".chat-language-control .header-layout-choice-option.active")!.textContent).toBe(label);
      expect(document.querySelector<HTMLTextAreaElement>(".input-row textarea")!.value).toBe("保留草稿");
      expect(document.getElementById("zai-root")!.textContent).toContain(value === "en-US" ? "Summarize paper" : "总结论文");
      expect(document.getElementById("zai-root")!.textContent).toContain("Answer for paper A");
    }
  });

  it("refreshes explicit interface language while preserving draft and replies", async () => {
    await vi.advanceTimersByTimeAsync(2000);
    const input = document.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    input.value = "未发送的中文草稿";
    input.dispatchEvent(new Event("input"));
    Zotero.Prefs.set("extensions.zotero-ai-sidebar.interfaceLanguage", "en-US", true);
    refreshSidebarPreferences();
    expect(document.querySelector<HTMLTextAreaElement>(".input-row textarea")!.value).toBe("未发送的中文草稿");
    expect(document.getElementById("zai-root")!.textContent).toContain("Summarize paper");
    expect(document.getElementById("zai-root")!.textContent).toContain("Answer for paper A");
    Zotero.Prefs.set("extensions.zotero-ai-sidebar.interfaceLanguage", "zh-CN", true);
    refreshSidebarPreferences();
    expect(document.getElementById("zai-root")!.textContent).toContain("总结论文");
    expect(document.querySelector<HTMLTextAreaElement>(".input-row textarea")!.value).toBe("未发送的中文草稿");
  });

  it("uses English sidebar controls for an unsupported system language", async () => {
    unregisterSidebar();
    vi.stubGlobal("Cc", {
      "@mozilla.org/intl/ospreferences;1": {
        getService: () => ({ systemLocales: ["de-DE"] }),
      },
    });
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    const root = document.getElementById("zai-root")!;
    const buttons = Array.from(root.querySelectorAll("button"), (node) => node.textContent);
    expect(buttons).toContain("Summarize paper");
    expect(buttons).toContain("Explain selection");
    expect(buttons).toContain("Usage notes");
    expect(root.querySelector("textarea")?.placeholder).toContain("Enter");
    expect(root.querySelector("textarea")?.placeholder).not.toMatch(/[\u3400-\u9fff]/);
    expect(root.textContent).toContain("Answer for paper A");
  });

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


describe("chat column width memory", () => {
  it("restores the embedded width after dragging and remounting without changing note width", async () => {
    const prefs = (globalThis as any).Zotero.Prefs;
    const key = "extensions.zotero-ai-sidebar.readerLayout";
    prefs.set(key, JSON.stringify({ aiOpen: true, noteWidth: 530 }));
    const sidebar = windowSidebars.get(window)!;
    sidebar.splitter.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    sidebar.column.setAttribute("width", "645");
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(JSON.parse(prefs.get(key))).toMatchObject({ aiWidth: 645, noteWidth: 530 });
    unregisterSidebar();
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    expect(windowSidebars.get(window)!.column.getAttribute("width")).toBe("645");
  });

  it("remembers docked drag width separately from embedded width", async () => {
    unregisterSidebar();
    const prefs = (globalThis as any).Zotero.Prefs;
    const key = "extensions.zotero-ai-sidebar.readerLayout";
    prefs.set(key, JSON.stringify({ aiOpen: true, aiWidth: 410, noteWidth: 530 }));
    const { saveLocalUiSettings, DEFAULT_LOCAL_UI_SETTINGS } = await import("../../src/settings/local-ui-settings");
    saveLocalUiSettings(prefs, { ...DEFAULT_LOCAL_UI_SETTINGS, sidebarDisplayMode: "docked" });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1600);
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    const sidebar = windowSidebars.get(window)!;
    sidebar.splitter.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 980, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(JSON.parse(prefs.get(key))).toMatchObject({ aiWidth: 410, dockedAiWidth: 620, noteWidth: 530 });
    unregisterSidebar();
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    expect(windowSidebars.get(window)!.column.getAttribute("width")).toBe("620");
  });
});


describe("width persistence boundaries", () => {
  it("does not replace the saved width when the column is collapsed", () => {
    const key = "extensions.zotero-ai-sidebar.readerLayout";
    const prefs = (globalThis as any).Zotero.Prefs;
    prefs.set(key, JSON.stringify({ aiWidth: 645 }));
    const sidebar = windowSidebars.get(window)!;
    sidebar.splitter.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
    sidebar.column.setAttribute("collapsed", "true");
    sidebar.column.setAttribute("width", "0");
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(JSON.parse(prefs.get(key)).aiWidth).toBe(645);
  });

  it("flushes an unfinished drag before removing the sidebar", async () => {
    const sidebar = windowSidebars.get(window)!;
    sidebar.splitter.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
    sidebar.column.setAttribute("width", "590");
    unregisterSidebar();
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    expect(windowSidebars.get(window)!.column.getAttribute("width")).toBe("590");
  });

  it("keeps the preferred docked width when the window temporarily becomes narrow", async () => {
    unregisterSidebar();
    const prefs = (globalThis as any).Zotero.Prefs;
    const key = "extensions.zotero-ai-sidebar.readerLayout";
    prefs.set(key, JSON.stringify({ aiOpen: true, dockedAiWidth: 700 }));
    const { saveLocalUiSettings, DEFAULT_LOCAL_UI_SETTINGS } = await import("../../src/settings/local-ui-settings");
    saveLocalUiSettings(prefs, { ...DEFAULT_LOCAL_UI_SETTINGS, sidebarDisplayMode: "docked" });
    const width = vi.spyOn(window, "innerWidth", "get").mockReturnValue(1100);
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    expect(Number(windowSidebars.get(window)!.column.getAttribute("width"))).toBeLessThan(700);
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(JSON.parse(prefs.get(key)).dockedAiWidth).toBe(700);
    width.mockReturnValue(1600);
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(200);
    expect(windowSidebars.get(window)!.column.getAttribute("width")).toBe("700");
  });
});

describe("composer history keyboard navigation", () => {
  it("recalls questions with Up and clears the recalled history with Down", () => {
    const sidebar = windowSidebars.get(window)!;
    const state = states.get(sidebar.mount)!;
    state.messages = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ];
    refreshSidebarPreferences();
    const input = sidebar.mount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event;
    };
    expect(press("ArrowUp").defaultPrevented).toBe(true);
    expect(input.value).toBe("second question");
    press("ArrowUp");
    expect(input.value).toBe("first question");
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(state.draftText).toBe("");
    expect(state.promptHistoryCursor).toBeUndefined();
    expect(press("ArrowDown").defaultPrevented).toBe(false);
    press("ArrowUp");
    expect(input.value).toBe("second question");
    input.value = "a manually edited question";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(press("ArrowDown").defaultPrevented).toBe(false);
    expect(input.value).toBe("a manually edited question");
  });
});

describe("unified view settings", () => {
  const visibleSidebar = async () => {
    unregisterSidebar();
    const toolbar = document.createElement("div");
    toolbar.id = "zotero-items-toolbar";
    document.body.prepend(toolbar);
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    const sidebar = windowSidebars.get(window)!;
    if (sidebar.column.getAttribute("collapsed") === "true") {
      sidebar.toggleButton!.dispatchEvent(new Event("command"));
      await vi.advanceTimersByTimeAsync(200);
    }
    return sidebar;
  };
  it("combines layout and display controls in a single entry and preserves the popover during changes", async () => {
    const sidebar = windowSidebars.get(window)!;
    const view = () => sidebar.mount.querySelector<HTMLElement>(".header-view-menu")!;
    expect(view().querySelector("summary")!.textContent).toBe("视图");
    expect(sidebar.mount.querySelectorAll(".header-view-menu")).toHaveLength(1);
    expect(sidebar.mount.querySelector(".zai-icon-menu")).toBeNull();
    expect([...view().querySelectorAll(".header-view-section-title")].map(n => n.textContent)).toEqual(["布局", "显示"]);
    expect(view().textContent).toContain("笔记位置在下次打开时生效");
    expect(view().textContent).toContain("保持侧栏宽度，窗口随 PDF 缩放自动变宽或收窄");
    let draft = sidebar.mount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    draft.value = "draft while changing view";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    view().querySelector<HTMLElement>("summary")!.click();
    expect(view().hasAttribute("open")).toBe(true);
    expect(document.documentElement.classList.contains("zai-view-menu-open")).toBe(true);
    view().querySelector<HTMLElement>(".zai-compact-menu-content")!.scrollTop = 25;
    const choice = [...view().querySelectorAll<HTMLElement>(".header-layout-field")].find(n => n.firstElementChild?.textContent === "对话排版")!;
    choice.querySelector<HTMLButtonElement>(".header-layout-choice-trigger")!.click();
    expect(choice.querySelector(".header-layout-choice[open]")).toBeTruthy();
    [...choice.querySelectorAll<HTMLButtonElement>(".header-layout-choice-option")].find(n => n.textContent === "专注模式")!.click();
    expect(view().hasAttribute("open")).toBe(true);
    expect(view().querySelector(".header-layout-choice[open]")).toBeNull();
    expect(view().querySelector<HTMLElement>(".zai-compact-menu-content")!.scrollTop).toBe(25);
    expect(view().querySelector("select")).toBeNull();
    const font = view().querySelector<HTMLButtonElement>(".chat-font-size-control .header-layout-choice-trigger")!;
    const beforeFontMenu = view();
    const beforeFontMessages = sidebar.mount.querySelector(".messages");
    font.click();
    [...view().querySelectorAll<HTMLButtonElement>(".chat-font-size-control .header-layout-choice-option")].find(option => option.textContent === "18px")!.click();
    expect(font.textContent).toBe("18px");
    expect(view().hasAttribute("open")).toBe(true);
    expect(sidebar.mount.querySelector<HTMLElement>(".zai-app")!.style.getPropertyValue("--zai-chat-font-size")).toBe("18px");
    expect(view()).toBe(beforeFontMenu);
    expect(view().querySelector(".chat-font-size-control .header-layout-choice-trigger")).toBe(font);
    expect(sidebar.mount.querySelector(".messages")).toBe(beforeFontMessages);
    view().querySelector<HTMLInputElement>(".zai-docked-tight-toggle")!.click();
    expect(view().hasAttribute("open")).toBe(true);
    [...view().querySelectorAll<HTMLButtonElement>(".chat-language-control .header-layout-choice-option")].find(option => option.textContent === "English")!.click();
    expect(view().hasAttribute("open")).toBe(true);
    expect(view().querySelector("summary")!.textContent).toBe("View");
    draft = sidebar.mount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    expect(draft.value).toBe("draft while changing view");
    expect(sidebar.mount.querySelector(".messages")!.textContent).toContain("Answer for paper A");
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    draft.dispatchEvent(escape);
    expect(view().hasAttribute("open")).toBe(false);
    expect(escape.defaultPrevented).toBe(true);
    expect(document.documentElement.classList.contains("zai-view-menu-open")).toBe(false);
    view().querySelector<HTMLElement>("summary")!.click();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(view().hasAttribute("open")).toBe(false);
    view().querySelector<HTMLElement>("summary")!.click();
    view().querySelector<HTMLElement>("summary")!.click();
    expect(view().hasAttribute("open")).toBe(false);
  });

  it("keeps View open after choosing any chat position", async () => {
    const sidebar = await visibleSidebar();
    const menu = () => sidebar.mount.querySelector<HTMLElement>(".header-view-menu")!;
    menu().querySelector<HTMLElement>("summary")!.click();
    for (const label of ["右侧并排", "阅读器侧栏", "浮动模式", "阅读器侧栏"]) {
      expect(menu().hasAttribute("open")).toBe(true);
      [...menu().querySelectorAll<HTMLButtonElement>(".header-layout-choice-option")].find(n => n.textContent === label)!.click();
      expect(menu().hasAttribute("open")).toBe(true);
      expect(document.documentElement.classList.contains("zai-view-menu-open")).toBe(true);
    }
  });

  it("reopens View in the desktop window and keeps it open when returning", async () => {
    const sidebar = await visibleSidebar();
    const home = sidebar.mount;
    const desktop = new TestWindow({ url: "chrome://zotero-ai-sidebar/content/floating-window.xhtml", settings: { disableCSSFileLoading: true } });
    desktop.document.body.innerHTML = '<div id="zai-desktop-container"></div>';
    desktop.focus = vi.fn(); desktop.moveTo = vi.fn(); desktop.resizeTo = vi.fn();
    const originalOpen = host.openDialog;
    host.openDialog = vi.fn(() => desktop);
    const menu = () => sidebar.mount.querySelector<HTMLElement>(".header-view-menu")!;
    const choose = (label: string) => [...menu().querySelectorAll<HTMLButtonElement>(".header-layout-choice-option")].find(n => n.textContent === label)!.click();
    try {
      menu().querySelector<HTMLElement>("summary")!.click();
      menu().querySelector<HTMLElement>(".zai-compact-menu-content")!.scrollTop = 30;
      choose("浮动模式");
      desktop.dispatchEvent(new desktop.Event("load"));
      await vi.advanceTimersByTimeAsync(100);
      expect(sidebar.mount.ownerDocument).toBe(desktop.document);
      expect(menu().hasAttribute("open")).toBe(true);
      expect(menu().querySelector<HTMLElement>(".zai-compact-menu-content")!.scrollTop).toBe(30);
      expect(document.documentElement.classList.contains("zai-view-menu-open")).toBe(false);
      expect(desktop.document.documentElement.classList.contains("zai-view-menu-open")).toBe(true);
      choose("阅读器侧栏");
      await vi.advanceTimersByTimeAsync(100);
      expect(sidebar.mount).toBe(home);
      expect(menu().hasAttribute("open")).toBe(true);
      expect(menu().querySelector<HTMLElement>(".zai-compact-menu-content")!.scrollTop).toBe(30);
      expect(document.documentElement.classList.contains("zai-view-menu-open")).toBe(true);
    } finally {
      unregisterSidebar();
      host.openDialog = originalOpen;
      desktop.close();
    }
  });

  it("keeps View open while the model streams and preserves the next draft", async () => {
    const sidebar = windowSidebars.get(window)!;
    vi.spyOn(contextBuilder, "buildContext").mockResolvedValue({ systemPrompt: "test" } as Awaited<ReturnType<typeof contextBuilder.buildContext>>);
    vi.spyOn(zoteroContextSource, "getFullText").mockResolvedValue("PDF");
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    vi.spyOn(providerFactory, "getProvider").mockReturnValue({ stream: async function* () {
      yield { type: "text_delta" as const, text: "view-first " };
      await pending;
      yield { type: "text_delta" as const, text: "view-last" };
    } });
    const input = sidebar.mount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    input.value = "question";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    const menu = () => sidebar.mount.querySelector<HTMLElement>(".header-view-menu")!;
    menu().querySelector<HTMLElement>("summary")!.click();
    const draft = sidebar.mount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    draft.value = "next unsent question";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    finish();
    await vi.advanceTimersByTimeAsync(300);
    expect(menu().hasAttribute("open")).toBe(true);
    expect(sidebar.mount.querySelector("textarea")!.value).toBe("next unsent question");
    expect(sidebar.mount.querySelector(".messages")!.textContent).toContain("view-first view-last");
  });

});

describe("floating sidebar integration", () => {
  const chooseMode = (label: string) => {
    const sidebar = windowSidebars.get(window)!;
    const option = Array.from(
      sidebar.mount.querySelectorAll<HTMLButtonElement>(
        ".header-layout-choice-option",
      ),
    ).find((button) => button.textContent === label);
    expect(option).toBeTruthy();
    option!.click();
  };
  const openSidebar = async () => {
    unregisterSidebar();
    const toolbar = document.createElement("div");
    toolbar.id = "zotero-items-toolbar";
    document.body.prepend(toolbar);
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    const sidebar = windowSidebars.get(window)!;
    if (sidebar.column.getAttribute("collapsed") === "true") {
      sidebar.toggleButton!.dispatchEvent(new Event("command"));
      await vi.advanceTimersByTimeAsync(500);
    }
    return sidebar;
  };

  it("moves a streaming floating chat into a desktop window and back without losing drafts", async () => {
    const sidebar = await openSidebar();
    const homeMount = sidebar.mount;
    vi.spyOn(contextBuilder, "buildContext").mockResolvedValue({ systemPrompt: "test" } as Awaited<ReturnType<typeof contextBuilder.buildContext>>);
    vi.spyOn(zoteroContextSource, "getFullText").mockResolvedValue("PDF");
    let finishReply!: () => void;
    const pending = new Promise<void>(resolve => { finishReply = resolve; });
    const stream = vi.fn(async function* () {
      yield { type: "text_delta" as const, text: "before-desktop " };
      await pending;
      yield { type: "text_delta" as const, text: "after-desktop" };
    });
    vi.spyOn(providerFactory, "getProvider").mockReturnValue({ stream });
    let input = homeMount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    input.value = "start streaming";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    input = homeMount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    input.value = "next unsent draft";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const desktop = new TestWindow({ url: "chrome://zotero-ai-sidebar/content/floating-window.xhtml", settings: { disableCSSFileLoading: true } });
    desktop.document.body.innerHTML = '<div id="zai-desktop-container"></div>';
    Object.defineProperty(desktop.document, "execCommand", { value: vi.fn(() => false), configurable: true });
    desktop.focus = vi.fn(); desktop.moveTo = vi.fn(); desktop.resizeTo = vi.fn();
    const nativeClose = vi.spyOn(desktop, "close");
    const originalOpenDialog = host.openDialog;
    host.openDialog = vi.fn(() => desktop);
    try {
      chooseMode("浮动模式");
      desktop.dispatchEvent(new desktop.Event("load"));
      await vi.advanceTimersByTimeAsync(100);
      expect(host.openDialog).toHaveBeenCalledOnce();
      expect(sidebar.mount).not.toBe(homeMount);
      expect(sidebar.mount.ownerDocument).toBe(desktop.document);
      expect(homeMount.children).toHaveLength(0);
      const pin = sidebar.mount.querySelector<HTMLButtonElement>(".zai-chat-window-pin")!;
      expect(pin.getAttribute("aria-pressed")).toBe("true");
      expect(pin.closest(".header-actions-menu, .header-window-menu")).toBeNull();
      expect(pin.parentElement?.lastElementChild).toBe(pin);
      expect(pin.style.marginLeft).toBe("auto");
      (Zotero as any).isLinux = true;
      const execPin = vi.fn(async () => true);
      (Zotero as any).Utilities.Internal = { exec: execPin };
      pin.click();
      await new Promise<void>(resolve => desktop.setTimeout(resolve, 10));
      await vi.advanceTimersByTimeAsync(50);
      expect(execPin).toHaveBeenCalledWith("/usr/bin/wmctrl", expect.arrayContaining(["remove,above"]));
      expect(pin.getAttribute("aria-pressed")).toBe("false");
      expect(JSON.parse(String(Zotero.Prefs.get("extensions.zotero-ai-sidebar.localUiSettings", true))).chatWindowPinned).toBe(false);
      expect(sidebar.mount.querySelector("textarea")!.value).toBe("next unsent draft");
      finishReply();
      await vi.advanceTimersByTimeAsync(400);
      expect(sidebar.mount.querySelector(".messages")!.textContent).toContain("before-desktop after-desktop");
      expect(sidebar.mount.querySelector("textarea")!.value).toBe("next unsent draft");
      const paragraph = [...sidebar.mount.querySelectorAll(".bubble-assistant p")].find(p => p.textContent?.includes("before-desktop after-desktop"))!;
      const selection = desktop.getSelection()!;
      const range = desktop.document.createRange();
      range.selectNodeContents(paragraph as any);
      selection.addRange(range);
      const copied = vi.fn();
      const copy = new desktop.Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(copy, "clipboardData", { value: { setData: copied } });
      paragraph.dispatchEvent(copy as unknown as Event);
      expect(copied).toHaveBeenCalledWith("text/plain", expect.stringContaining("before-desktop after-desktop"));
      selection.removeAllRanges();
      chooseMode("阅读器侧栏");
      await vi.advanceTimersByTimeAsync(400);
      expect(sidebar.mount).toBe(homeMount);
      expect(sidebar.mount.querySelector("textarea")!.value).toBe("next unsent draft");
      expect(sidebar.mount.querySelector(".messages")!.textContent).toContain("before-desktop after-desktop");
      expect(nativeClose).toHaveBeenCalledOnce();
    } finally {
      finishReply();
      unregisterSidebar();
      host.openDialog = originalOpenDialog;
      desktop.close();
    }
  });

  it("opens restored history at the bottom after a delayed first visible layout", async () => {
    unregisterSidebar();
    const observations: Array<{ callback: () => void; targets: Element[] }> = [];
    vi.stubGlobal("ResizeObserver", class {
      entry: { callback: () => void; targets: Element[] };
      constructor(callback: () => void) {
        this.entry = { callback, targets: [] };
        observations.push(this.entry);
      }
      observe(target: Element) { this.entry.targets.push(target); }
      disconnect() {}
    });
    const prefs = (globalThis as any).Zotero.Prefs;
    prefs.set("extensions.zotero-ai-sidebar.readerLayout", JSON.stringify({ aiOpen: true }));
    registerSidebar();
    await vi.advanceTimersByTimeAsync(1500);
    const sidebar = windowSidebars.get(window)!;
    const messages = sidebar.mount.querySelector<HTMLElement>(".messages")!;
    expect(messages.textContent).toContain("Answer for paper A");
    expect(messages.scrollTop).toBe(0);
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 400 },
    });
    for (const entry of observations)
      if (entry.targets.includes(messages)) entry.callback();
    await vi.advanceTimersByTimeAsync(50);
    expect(messages.scrollTop).toBe(2600);
    expect(states.get(sidebar.mount)!.autoFollowMessages).toBe(true);
  });

  it.each(["阅读器侧栏", "右侧并排", "浮动模式"])("restores the saved reading position when reopening %s", async display => {
    vi.spyOn(window, "resizeBy").mockImplementation(() => {});
    const sidebar = await openSidebar();
    chooseMode(display);
    const state = states.get(sidebar.mount)!;
    const messages = sidebar.mount.querySelector<HTMLElement>(".messages")!;
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 400 },
    });
    messages.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    messages.scrollTop = 140;
    messages.dispatchEvent(new Event("scroll"));
    state.messagesScrollTop = 140; state.autoFollowMessages = false;
    sidebar.toggleButton!.dispatchEvent(new Event("command"));
    sidebar.toggleButton!.dispatchEvent(new Event("command"));
    const reopened = sidebar.mount.querySelector<HTMLElement>(".messages")!;
    Object.defineProperties(reopened, {
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 400 },
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(reopened.scrollTop).toBe(140);
    expect(state.autoFollowMessages).toBe(false);
    expect(reopened.textContent).toContain("Answer for paper A");
  });

  it("remembers separate article scroll positions across tab switches and sidebar registration", async () => {
    let sidebar = await openSidebar();
    const observations: Array<{ callback: () => void; targets: Element[] }> = [];
    vi.stubGlobal("ResizeObserver", class {
      entry: { callback: () => void; targets: Element[] };
      constructor(callback: () => void) { this.entry = { callback, targets: [] }; observations.push(this.entry); }
      observe(target: Element) { this.entry.targets.push(target); }
      disconnect() {}
    });
    const reveal = async () => {
      const messages = sidebar.mount.querySelector<HTMLElement>(".messages")!;
      Object.defineProperties(messages, {
        scrollHeight: { configurable: true, value: 3000 },
        clientHeight: { configurable: true, value: 400 },
      });
      for (const entry of [...observations]) if (entry.targets.includes(messages)) entry.callback();
      await vi.advanceTimersByTimeAsync(50);
      return messages;
    };
    const readAt = (messages: HTMLElement, top: number) => {
      messages.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
      messages.scrollTop = top;
      messages.dispatchEvent(new Event("scroll"));
    };
    readAt(await reveal(), 640);
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(120);
    expect((await reveal()).scrollTop).toBe(2600); // No record: latest message.
    readAt(sidebar.mount.querySelector<HTMLElement>(".messages")!, 320);
    host.Zotero_Tabs.selectedID = "pdf-a";
    await vi.advanceTimersByTimeAsync(120);
    expect((await reveal()).scrollTop).toBe(640);
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(120);
    expect((await reveal()).scrollTop).toBe(320);
    unregisterSidebar();
    registerSidebar();
    sidebar = windowSidebars.get(window)!;
    await vi.advanceTimersByTimeAsync(1500);
    expect((await reveal()).scrollTop).toBe(320);
  });

  it.each(["右侧并排", "阅读器侧栏"])("preserves chat width on PDF zoom and fits PDF scale when dragging the splitter in %s", async (mode) => {
    let hostWidth = 1600;
    vi.spyOn(window, "innerWidth", "get").mockImplementation(() => hostWidth);
    let sidebar = await openSidebar();
    chooseMode(mode);
    const chatWidth = () => Number(sidebar.column.getAttribute("width"));
    let measuredWidth: number | undefined;
    sidebar.column.getBoundingClientRect = () => new DOMRect(hostWidth - (measuredWidth ?? chatWidth()), 0, measuredWidth ?? chatWidth(), 800);
    const iframe = document.createElement("iframe"); document.body.append(iframe);
    const readerWidth = () => hostWidth - chatWidth() - 100;
    Object.defineProperty(iframe, "offsetWidth", { configurable: true, get: readerWidth });
    Object.defineProperty(iframe, "offsetHeight", { configurable: true, value: 600 });
    iframe.getBoundingClientRect = () => new DOMRect(100, 100, readerWidth(), 600);
    const pdf = iframe.contentWindow!;
    Object.defineProperty(pdf, "innerWidth", { configurable: true, get: readerWidth });
    pdf.document.body.innerHTML = '<div id="viewerContainer"><div class="pdfViewer"><div class="page" data-page-number="1"><canvas width="1000" height="50"></canvas></div></div></div>';
    const container = pdf.document.getElementById("viewerContainer")!;
    Object.defineProperty(container, "clientWidth", { configurable: true, get: readerWidth });
    Object.defineProperty(container, "offsetWidth", { configurable: true, get: readerWidth });
    container.getBoundingClientRect = () => new DOMRect(0, 0, readerWidth(), 600);
    let scale = 1, value: string | number = "page-width";
    const viewer = { currentScale: 1, currentPageNumber: 1,
      get currentScaleValue() { return value; }, set currentScaleValue(next: string | number) { value = next; scale = typeof next === "number" ? next : 1; this.currentScale = scale; },
    };
    const listeners = new Map<string, () => void>();
    (pdf as any).wrappedJSObject = { PDFViewerApplication: { pdfViewer: viewer, eventBus: { on: (name: string, cb: () => void) => listeners.set(name, cb), off: (name: string) => listeners.delete(name) } } };
    const canvas = pdf.document.querySelector("canvas")!;
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1000 * scale, 50 * scale);
    Object.defineProperty(canvas, "getContext", { value: () => ({ getImageData: (x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255), at = (x === 0 ? 50 : width - 101) * 4;
      data[at] = data[at + 1] = data[at + 2] = 0;
      return { data };
    } }) });
    (readers.get("pdf-a") as any)._iframeWindow = pdf;
    sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")!.click();
    expect(viewer.currentScale).toBe(1);
    const initialWidth = chatWidth();
    viewer.currentScaleValue = 1.1;
    listeners.get("scalechanging")!();
    await vi.advanceTimersByTimeAsync(50);
    expect(chatWidth()).toBe(initialWidth);
    expect(viewer.currentScale).toBe(1.1);
    const enlargedWidth = chatWidth();
    viewer.currentScaleValue = 0.9;
    listeners.get("scalechanging")!();
    await vi.advanceTimersByTimeAsync(50);
    expect(chatWidth()).toBe(initialWidth);
    expect(viewer.currentScale).toBe(0.9);
    expect(enlargedWidth).toBeGreaterThanOrEqual(320);
    hostWidth = 2000;
    window.dispatchEvent(new Event("resize"));
    listeners.get("pagerendered")!();
    await vi.advanceTimersByTimeAsync(50);
    expect(chatWidth()).toBe(initialWidth);
    expect(parseFloat((sidebar.column as HTMLElement).style.maxWidth)).toBeGreaterThanOrEqual(chatWidth());
    expect(viewer.currentScale).toBe(0.9);
    // Automatic layout can legitimately create a column wider than the old 760px manual cap.
    sidebar.column.setAttribute("width", "900");
    (sidebar.column as HTMLElement).style.width = "900px";
    (sidebar.column as HTMLElement).style.maxWidth = "900px";
    const capture = vi.fn(), release = vi.fn();
    Object.defineProperties(sidebar.splitter, {
      setCapture: { configurable: true, value: capture },
      releaseCapture: { configurable: true, value: release },
    });
    measuredWidth = chatWidth(); // Real chrome layout may lag width attributes during mousemove.
    const startWidth = chatWidth();
    const startClientX = hostWidth - startWidth - 2; // Grab within the splitter, not the column edge.
    const startScreenX = startClientX + 80;
    sidebar.splitter.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: startClientX, screenX: startScreenX, bubbles: true }));
    for (const [index, width] of [900, 898, 880, 900, 600, 580, 560, 580, 900].entries()) {
      // Reader iframe and chrome can report different local coordinates.
      window.dispatchEvent(new MouseEvent("mousemove", {
        clientX: index % 2 ? hostWidth - width : 20,
        screenX: startScreenX + startWidth - width,
      }));
      expect(chatWidth()).toBe(width);
      listeners.get("pagerendered")!();
      await vi.advanceTimersByTimeAsync(50);
      expect(chatWidth()).toBe(width);
      expect(viewer.currentScale).toBeCloseTo((hostWidth - 100 - width - 24) / 1000);
    }
    expect(chatWidth()).toBe(900);
    expect(viewer.currentScale).toBeCloseTo((hostWidth - 100 - 900 - 24) / 1000);
    listeners.get("pagerendered")!();
    await vi.advanceTimersByTimeAsync(50);
    expect(chatWidth()).toBe(900);
    expect(viewer.currentScale).toBeCloseTo((hostWidth - 100 - 900 - 24) / 1000);
    if (mode === "右侧并排")
      expect(document.documentElement.style.getPropertyValue("--zai-docked-width")).toBe("900px");
    measuredWidth = undefined;
    window.dispatchEvent(new MouseEvent("mouseup"));
    await vi.advanceTimersByTimeAsync(50);
    expect(capture).toHaveBeenCalledExactlyOnceWith(true);
    expect(release).toHaveBeenCalledOnce();
    expect(chatWidth()).toBe(900);
    expect(viewer.currentScale).toBeCloseTo((hostWidth - 100 - 900 - 24) / 1000);
    expect(Math.abs(readerWidth() - (1000 * viewer.currentScale + 24))).toBeLessThanOrEqual(1);
    const fittedScale = viewer.currentScale;
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: hostWidth - 500 }));
    expect(chatWidth()).toBe(900);
    expect(viewer.currentScale).toBe(fittedScale);
    expect(sidebar.mount.querySelector(".messages")?.textContent).toContain("Answer for paper A");
    const prefs = (globalThis as any).Zotero.Prefs;
    const widthKey = mode === "右侧并排" ? "dockedAiWidth" : "aiWidth";
    expect(JSON.parse(prefs.get("extensions.zotero-ai-sidebar.readerLayout"))[widthKey]).toBe(900);
    const columnRect = sidebar.column.getBoundingClientRect;
    unregisterSidebar();
    registerSidebar();
    sidebar = windowSidebars.get(window)!;
    sidebar.column.getBoundingClientRect = columnRect;
    await vi.advanceTimersByTimeAsync(2000);
    expect(chatWidth()).toBe(900);
    vi.spyOn(window, "resizeBy").mockImplementation(() => {});
    sidebar.toggleButton!.dispatchEvent(new Event("command"));
    await vi.advanceTimersByTimeAsync(50);
    sidebar.toggleButton!.dispatchEvent(new Event("command"));
    await vi.advanceTimersByTimeAsync(50);
    expect(chatWidth()).toBe(900);
    expect(sidebar.mount.querySelector(".messages")?.textContent).toContain("Answer for paper A");
  });

  it("toggles a clearly labeled spacing checkbox in Layout without losing the draft or conversation", async () => {
    const sidebar = await openSidebar();
    expect(sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")?.checked).toBe(false);
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const pdf = iframe.contentWindow!;
    pdf.document.body.innerHTML = '<div class="pdfViewer"><div class="page">PDF</div></div>';
    (readers.get("pdf-a") as any)._iframeWindow = pdf;
    chooseMode("右侧并排");
    const toggle = sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")!;
    expect(toggle).toBeTruthy();
    expect(toggle.closest(".header-layout-menu")).toBeTruthy();
    expect(toggle.type).toBe("checkbox");
    expect(toggle.parentElement?.tagName.toLowerCase()).toBe("label");
    const label = toggle.parentElement?.textContent;
    expect(label).toContain("自动调整 PDF 页边距");
    expect(label).toContain("保持侧栏宽度，窗口随 PDF 缩放自动变宽或收窄");
    expect(toggle.closest(".preset-switcher-row")?.querySelector(":scope > .zai-docked-tight-toggle")).toBeNull();
    expect(toggle.checked).toBe(false);
    const input = sidebar.mount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    input.value = "draft while comparing";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const messages = sidebar.mount.querySelector<HTMLElement>(".messages")!;
    messages.scrollTop = 80;
    toggle.click();
    expect(toggle.checked).toBe(true);
    expect(sidebar.mount.classList.contains("zai-reading-tight")).toBe(true);
    expect(pdf.document.getElementById("zai-floating-pdf-align")?.textContent).toContain("flex-start");
    expect(pdf.document.querySelector(".zai-floating-reader-space")).toBeNull();
    expect(sidebar.mount.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("draft while comparing");
    expect(sidebar.mount.querySelector(".messages")).toBe(messages);
    expect(messages.textContent).toContain("Answer for paper A");
    toggle.click();
    expect(sidebar.mount.classList.contains("zai-reading-tight")).toBe(false);
    expect(pdf.document.getElementById("zai-floating-pdf-align")).toBeNull();
    toggle.click();
    chooseMode("阅读器侧栏");
    expect(sidebar.mount.classList.contains("zai-reading-tight")).toBe(true);
    expect(sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")?.checked).toBe(true);
    expect(pdf.document.getElementById("zai-floating-pdf-align")).not.toBeNull();
    sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")!.click();
    expect(sidebar.mount.classList.contains("zai-reading-tight")).toBe(false);
    expect(pdf.document.getElementById("zai-floating-pdf-align")).toBeNull();
    chooseMode("右侧并排");
    expect(sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")?.checked).toBe(false);
    expect(sidebar.mount.querySelector(".zai-docked-tight-toggle")?.parentElement?.textContent).toBe(label);
    chooseMode("浮动模式");
    expect(sidebar.mount.querySelector(".zai-docked-tight-toggle")).toBeNull();
    expect(sidebar.mount.classList.contains("zai-reading-tight")).toBe(false);
  });

  it("remembers the shared PDF margin checkbox after sidebar registration", async () => {
    let sidebar = await openSidebar();
    chooseMode("阅读器侧栏");
    sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")!.click();
    expect(JSON.parse(String(Zotero.Prefs.get("extensions.zotero-ai-sidebar.localUiSettings", true))).dockedTightLayout).toBe(true);
    unregisterSidebar();
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    sidebar = windowSidebars.get(window)!;
    expect(sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")?.checked).toBe(true);
    chooseMode("右侧并排");
    expect(sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")?.checked).toBe(true);
    sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")!.click();
    chooseMode("阅读器侧栏");
    expect(sidebar.mount.querySelector<HTMLInputElement>(".zai-docked-tight-toggle")?.checked).toBe(false);
  });

  it.each(["阅读器侧栏", "右侧并排"])("offers separate native notes in %s through the Mode menu", async display => {
    const sidebar = await openSidebar();
    chooseMode(display);
    const draft = sidebar.mount.querySelector<HTMLTextAreaElement>(".input-row textarea")!;
    draft.value = "draft before note location changes";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    const option = [...sidebar.mount.querySelectorAll<HTMLButtonElement>(".header-layout-choice-option")].find(b => b.textContent === "独立窗口")!;
    expect(option.closest(".header-layout-menu")).toBeTruthy();
    option.click();
    const native = { closed: true, close: vi.fn(() => { native.closed = true; }) };
    host.ZoteroPane.openNote = vi.fn(async () => { native.closed = false; });
    host.ZoteroPane.findNoteWindow = vi.fn(() => native.closed ? null : native);
    vi.spyOn(noteDedicated, "resolveTargetNote").mockResolvedValue({ note: { id: 901, parentID: 101 } as Zotero.Item, created: false });
    sidebar.mount.querySelector<HTMLButtonElement>(".open-note-button")!.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(host.ZoteroPane.openNote).toHaveBeenCalledExactlyOnceWith(901, { openInWindow: true });
    expect(sidebar.mount.querySelector(".open-note-button")?.textContent).toBe("关闭笔记");
    expect(sidebar.mount.querySelector("textarea")!.value).toBe("draft before note location changes");
    expect(sidebar.mount.querySelector(".messages")?.textContent).toContain("Answer for paper A");
    chooseMode("当前窗口");
    expect(sidebar.mount.querySelector(".open-note-button")?.textContent).toBe("关闭笔记");
    sidebar.mount.querySelector<HTMLButtonElement>(".open-note-button")!.click();
    expect(native.close).toHaveBeenCalledOnce();
    expect(sidebar.mount.querySelector(".open-note-button")?.textContent).toBe("打开笔记");
    expect(JSON.parse(String(Zotero.Prefs.get("extensions.zotero-ai-sidebar.localUiSettings", true))).noteWindowMode).toBe("inline");
    chooseMode("浮动模式");
    expect([...sidebar.mount.querySelectorAll(".header-layout-choice-option")].find(b => b.textContent === "当前窗口")).toBeUndefined();
  });

  it("aligns PDF pages only while the floating answer is visible", async () => {
    await openSidebar();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const pdfWindow = iframe.contentWindow!;
    pdfWindow.document.body.innerHTML =
      '<div class="pdfViewer"><div class="page">PDF</div></div>';
    (readers.get("pdf-a") as any)._iframeWindow = pdfWindow;
    chooseMode("浮动模式");
    expect(
      pdfWindow.document.getElementById("zai-floating-pdf-align"),
    ).not.toBeNull();
    chooseMode("右侧并排");
    expect(
      pdfWindow.document.getElementById("zai-floating-pdf-align"),
    ).toBeNull();
    chooseMode("浮动模式");
    expect(
      pdfWindow.document.getElementById("zai-floating-pdf-align"),
    ).not.toBeNull();
    chooseMode("阅读器侧栏");
    expect(
      pdfWindow.document.getElementById("zai-floating-pdf-align"),
    ).toBeNull();
  });

  it("preserves the draft and conversation across all three display modes", async () => {
    const sidebar = await openSidebar();
    const input = sidebar.mount.querySelector<HTMLTextAreaElement>(
      ".input-row textarea",
    )!;
    input.value = "draft across display modes";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    chooseMode("浮动模式");
    await vi.advanceTimersByTimeAsync(400);
    expect(sidebar.mount.parentElement).toBe(document.documentElement);
    expect(
      sidebar.mount.querySelectorAll("[data-zai-floating-panel]"),
    ).toHaveLength(2);
    expect(
      sidebar.mount.querySelector(
        '[data-zai-floating-panel="composer"] .input-row textarea',
      )?.value,
    ).toBe("draft across display modes");
    expect(
      sidebar.mount.querySelector(
        '[data-zai-floating-panel="answer"] .messages',
      )?.textContent,
    ).toContain("Answer for paper A");
    chooseMode("右侧并排");
    await vi.advanceTimersByTimeAsync(400);
    expect(
      document.documentElement.classList.contains("zai-docked-window"),
    ).toBe(true);
    expect(sidebar.mount.parentElement).toBe(sidebar.column);
    expect(sidebar.mount.querySelector("[data-zai-floating-panel]")).toBeNull();
    expect(sidebar.mount.querySelector(".zai-chat-window-pin")).toBeNull();
    expect(
      sidebar.mount.querySelector<HTMLTextAreaElement>("textarea")?.value,
    ).toBe("draft across display modes");
    chooseMode("阅读器侧栏");
    await vi.advanceTimersByTimeAsync(400);
    expect(
      document.documentElement.classList.contains("zai-docked-window"),
    ).toBe(false);
    expect(sidebar.mount.parentElement).toBe(sidebar.column);
    expect(sidebar.mount.textContent).toContain("Answer for paper A");
  });

  it("restores floating mode and saved geometry after window registration", async () => {
    const sidebar = await openSidebar();
    chooseMode("浮动模式");
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      for (const [key, value] of Object.entries({
        button: 0,
        pointerId: 12,
        clientX: x,
        clientY: y,
      }))
        Object.defineProperty(event, key, { value });
      return event;
    };
    sidebar.mount
      .querySelector('[data-zai-float-drag="answer"]')!
      .dispatchEvent(pointer("pointerdown", 200, 200));
    window.dispatchEvent(pointer("pointermove", 100, 240));
    window.dispatchEvent(pointer("pointerup", 100, 240));
    const left = sidebar.mount.querySelector<HTMLElement>(
      '[data-zai-floating-window]',
    )!.style.left;
    const settings = JSON.parse(
      String(
        Zotero.Prefs.get("extensions.zotero-ai-sidebar.localUiSettings", true),
      ),
    );
    expect(settings.sidebarDisplayMode).toBe("floating");
    expect(settings.floatingPanels.answer.x).toBe(parseFloat(left));
    unregisterSidebar();
    registerSidebar();
    await vi.advanceTimersByTimeAsync(2000);
    const restored = windowSidebars.get(window)!;
    expect(restored.mount.parentElement).toBe(document.documentElement);
    expect(
      restored.mount.querySelector<HTMLElement>(
        '[data-zai-floating-window]',
      )!.style.left,
    ).toBe(left);
    expect(
      restored.mount.querySelectorAll("[data-zai-floating-panel]"),
    ).toHaveLength(2);
  });

  it("keeps selected-answer copy and its context menu inside floating panels", async () => {
    const sidebar = await openSidebar();
    chooseMode("浮动模式");
    const paragraph = sidebar.mount.querySelector(
      '[data-zai-floating-panel="answer"] .bubble-assistant .bubble-body p',
    )!;
    expect(paragraph).toBeTruthy();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);
    const copied = vi.fn();
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", {
      value: { setData: copied },
    });
    paragraph.dispatchEvent(copy);
    expect(copied).toHaveBeenCalledWith(
      "text/plain",
      expect.stringContaining("Answer for paper A"),
    );
    paragraph.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 400,
        clientY: 200,
      }),
    );
    expect(
      sidebar.mount.querySelector(".zai-selection-menu")?.parentElement,
    ).toBe(sidebar.mount);
    selection.removeAllRanges();
  });

  it("continues one streaming response across mode changes and preserves the next draft", async () => {
    const sidebar = await openSidebar();
    chooseMode("浮动模式");
    sidebar.mount
      .querySelector<HTMLButtonElement>(
        '[data-zai-float-action="hide"]',
      )!
      .click();
    expect(
      sidebar.mount.querySelector<HTMLElement>(
        '[data-zai-floating-panel="answer"]',
      )!.hidden,
    ).toBe(true);
    vi.spyOn(contextBuilder, "buildContext").mockResolvedValue({
      systemPrompt: "test",
    } as Awaited<ReturnType<typeof contextBuilder.buildContext>>);
    vi.spyOn(zoteroContextSource, "getFullText").mockResolvedValue("PDF");
    let finishReply!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishReply = resolve;
    });
    const stream = vi.fn(async function* () {
      yield { type: "text_delta" as const, text: "floating-first " };
      await pending;
      yield { type: "text_delta" as const, text: "floating-last" };
    });
    vi.spyOn(providerFactory, "getProvider").mockReturnValue({ stream });
    let input = sidebar.mount.querySelector<HTMLTextAreaElement>(
      ".input-row textarea",
    )!;
    input.value = "floating question";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(
      sidebar.mount.querySelector<HTMLElement>(
        '[data-zai-floating-panel="answer"]',
      )!.hidden,
    ).toBe(false);
    expect(
      sidebar.mount.querySelector('[data-zai-floating-panel="answer"]')
        ?.textContent,
    ).toContain("floating-first");
    input = sidebar.mount.querySelector<HTMLTextAreaElement>(
      ".input-row textarea",
    )!;
    input.value = "next unsent question";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    chooseMode("阅读器侧栏");
    chooseMode("浮动模式");
    finishReply();
    await vi.advanceTimersByTimeAsync(500);
    expect(stream).toHaveBeenCalledOnce();
    expect(
      sidebar.mount.querySelector(
        '[data-zai-floating-panel="answer"] .messages',
      )?.textContent,
    ).toContain("floating-first floating-last");
    expect(
      sidebar.mount.querySelector<HTMLTextAreaElement>(".input-row textarea")
        ?.value,
    ).toBe("next unsent question");
    expect(
      sidebar.mount.querySelectorAll("[data-zai-floating-panel]"),
    ).toHaveLength(2);
  });

  it("tracks native note opening, button close, and closing the window itself", async () => {
    const sidebar = await openSidebar();
    chooseMode("浮动模式");
    vi.spyOn(noteDedicated, "resolveTargetNote").mockResolvedValue({
      note: { id: 901, parentID: 101 } as Zotero.Item,
      created: false,
    });
    let nativeWindow: { closed: boolean; close: ReturnType<typeof vi.fn> };
    const open = vi.fn(async () => {
      nativeWindow = {
        closed: false,
        close: vi.fn(() => {
          nativeWindow.closed = true;
        }),
      };
    });
    host.ZoteroPane.openNote = open;
    host.ZoteroPane.findNoteWindow = vi.fn((id: number) =>
      id === 901 && nativeWindow && !nativeWindow.closed ? nativeWindow : null,
    );
    const button = () =>
      sidebar.mount.querySelector<HTMLButtonElement>(".open-note-button")!;
    button().click();
    await vi.advanceTimersByTimeAsync(10);
    expect(open).toHaveBeenCalledWith(901, { openInWindow: true });
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("关闭笔记");
    expect(sidebar.noteColumn.getAttribute("collapsed")).toBe("true");
    expect(sidebar.noteMount.childElementCount).toBe(0);
    button().click();
    await vi.advanceTimersByTimeAsync(10);
    expect(nativeWindow!.close).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(button().textContent).toBe("打开笔记");
    button().click();
    await vi.advanceTimersByTimeAsync(10);
    expect(open).toHaveBeenCalledTimes(2);
    expect(button().textContent).toBe("关闭笔记");
    nativeWindow!.close();
    await vi.advanceTimersByTimeAsync(600);
    expect(button().textContent).toBe("打开笔记");
  });

  it("keeps the note button pending until the native window has finished opening", async () => {
    const sidebar = await openSidebar();
    chooseMode("浮动模式");
    vi.spyOn(noteDedicated, "resolveTargetNote").mockResolvedValue({
      note: { id: 901, parentID: 101 } as Zotero.Item,
      created: false,
    });
    let finishOpen!: () => void;
    let nativeWindow: {
      closed: boolean;
      close: ReturnType<typeof vi.fn>;
    } | null = null;
    host.ZoteroPane.openNote = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        }),
    );
    host.ZoteroPane.findNoteWindow = vi.fn(() => nativeWindow);
    const button =
      sidebar.mount.querySelector<HTMLButtonElement>(".open-note-button")!;
    button.click();
    await vi.advanceTimersByTimeAsync(1100);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("打开中...");
    expect(host.ZoteroPane.openNote).toHaveBeenCalledOnce();
    nativeWindow = { closed: false, close: vi.fn() };
    finishOpen();
    await vi.advanceTimersByTimeAsync(10);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("关闭笔记");
  });

  it("does not confuse a different paper's native note with the current one", async () => {
    const sidebar = await openSidebar();
    chooseMode("浮动模式");
    vi.spyOn(noteDedicated, "resolveTargetNote").mockResolvedValue({
      note: { id: 901, parentID: 101 } as Zotero.Item,
      created: false,
    });
    const nativeWindow = { closed: false, close: vi.fn() };
    host.ZoteroPane.openNote = vi.fn(async () => undefined);
    host.ZoteroPane.findNoteWindow = vi.fn((id: number) =>
      id === 901 ? nativeWindow : null,
    );
    sidebar.mount
      .querySelector<HTMLButtonElement>(".open-note-button")!
      .click();
    await vi.advanceTimersByTimeAsync(10);
    expect(sidebar.mount.querySelector(".open-note-button")!.textContent).toBe(
      "关闭笔记",
    );
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(1200);
    expect(sidebar.mount.querySelector(".open-note-button")!.textContent).toBe(
      "打开笔记",
    );
    host.Zotero_Tabs.selectedID = "pdf-a";
    await vi.advanceTimersByTimeAsync(1200);
    expect(sidebar.mount.querySelector(".open-note-button")!.textContent).toBe(
      "关闭笔记",
    );
    expect(nativeWindow.close).not.toHaveBeenCalled();
  });

  it("keeps floating panels available through hide/show and switches their paper context", async () => {
    const sidebar = await openSidebar();
    chooseMode("浮动模式");
    sidebar.toggleButton!.dispatchEvent(new Event("command"));
    expect(
      Array.from(
        sidebar.mount.querySelectorAll<HTMLElement>(
          "[data-zai-floating-panel]",
        ),
      ).every((panel) => panel.hidden),
    ).toBe(true);
    expect(sidebar.toggleButton!.getAttribute("aria-pressed")).toBe("false");
    sidebar.toggleButton!.dispatchEvent(new Event("command"));
    expect(
      Array.from(
        sidebar.mount.querySelectorAll<HTMLElement>(
          "[data-zai-floating-panel]",
        ),
      ).every((panel) => !panel.hidden),
    ).toBe(true);
    expect(sidebar.toggleButton!.getAttribute("aria-pressed")).toBe("true");
    host.Zotero_Tabs.selectedID = "pdf-b";
    await vi.advanceTimersByTimeAsync(1200);
    expect(
      sidebar.mount.querySelectorAll("[data-zai-floating-panel]"),
    ).toHaveLength(2);
    expect(sidebar.mount.textContent).toContain("Answer for paper B");
    expect(sidebar.mount.textContent).not.toContain("Answer for paper A");
    const mount = sidebar.mount;
    unregisterSidebar();
    expect(document.querySelector(".zai-root-floating")).toBeNull();
    expect(mount.isConnected).toBe(false);
  });
});
