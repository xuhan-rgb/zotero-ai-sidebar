import { describe, expect, it } from "vitest";

import {
  buildQuickAskApiMessages,
  createQuickAskState,
  createQuickAskAltReleaseGuard,
  createQuickAskUserMessage,
  DEFAULT_QUICK_ASK_SHORTCUT,
  getQuickAskShortcut,
  getQuickAskFollowMouse,
  isQuickAskShortcut,
  loadQuickAskModelSelection,
  quickAskReadOnlyTools,
  quickAskMousePosition,
  saveQuickAskModelSelection,
  setQuickAskShortcut,
  setQuickAskFollowMouse,
} from "../../src/modules/quick-ask";
import type { PrefsStore } from "../../src/settings/storage";

function memoryPrefs(initial?: string): PrefsStore {
  let value = initial;
  return {
    get: () => value,
    set: (_key, next) => {
      value = next;
    },
  };
}

describe("Quick Ask", () => {
  it("sends a fresh selection with a follow-up question", () => {
    const messages = buildQuickAskApiMessages([
      { role: "user", content: "上一个问题" },
      { role: "assistant", content: "上一个回答" },
      createQuickAskUserMessage("解释新选区", {
        kind: "pdf", displayText: "new passage", sourceText: "new passage",
      }, {}),
    ]);
    expect(messages[2].content).toContain("new passage");
    expect(messages[2].content).toContain("解释新选区");
  });

  it("consumes only the Alt release belonging to the Quick Ask shortcut", () => {
    const guard = createQuickAskAltReleaseGuard();
    const standalone = new KeyboardEvent("keyup", { key: "Alt", cancelable: true });
    expect(guard.handleKeyUp(standalone)).toBe(false);
    expect(standalone.defaultPrevented).toBe(false);
    guard.arm(true);
    const qRelease = new KeyboardEvent("keyup", { key: "q", altKey: true, cancelable: true });
    expect(guard.handleKeyUp(qRelease)).toBe(false);
    const altRelease = new KeyboardEvent("keyup", { key: "Alt", cancelable: true });
    expect(guard.handleKeyUp(altRelease)).toBe(true);
    expect(altRelease.defaultPrevented).toBe(true);
    const nextAlt = new KeyboardEvent("keyup", { key: "Alt", cancelable: true });
    expect(guard.handleKeyUp(nextAlt)).toBe(false);
    expect(nextAlt.defaultPrevented).toBe(false);
  });

  it("prevents the menu activation handler from receiving shortcut Alt release", () => {
    const guard = createQuickAskAltReleaseGuard();
    const target = document.createElement("textarea");
    let menuActivated = false;
    target.addEventListener("keyup", (event) => guard.handleKeyUp(event));
    target.addEventListener("keyup", () => { menuActivated = true; });
    guard.arm(true);
    target.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", cancelable: true }));
    expect(menuActivated).toBe(false);
    guard.arm(false);
    target.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", cancelable: true }));
    expect(menuActivated).toBe(true);
  });

  it("places the dialog near the mouse while keeping it in the viewport", () => {
    const viewport = { width: 1000, height: 800 };
    const dialog = { width: 400, height: 300 };
    expect(quickAskMousePosition({ x: 100, y: 200 }, viewport, dialog)).toEqual(
      { x: 112, y: 212 },
    );
    expect(quickAskMousePosition({ x: 990, y: 790 }, viewport, dialog)).toEqual(
      { x: 600, y: 500 },
    );
  });
  it("remembers whether Quick Ask opens near the mouse", () => {
    const prefs = memoryPrefs();
    expect(getQuickAskFollowMouse(prefs)).toBe(false);
    setQuickAskFollowMouse(prefs, true);
    expect(getQuickAskFollowMouse(prefs)).toBe(true);
    setQuickAskFollowMouse(prefs, false);
    expect(getQuickAskFollowMouse(prefs)).toBe(false);
  });
  it("builds a multi-turn API request without accepting research chat history", () => {
    const firstUserMessage = createQuickAskUserMessage(
      "这句话是什么意思？",
      {
        kind: "translation",
        displayText: "第二个结果提高了准确率。",
        sourceText: "The second result improves accuracy.",
      },
      {},
    );
    const firstAssistantMessage = {
      role: "assistant" as const,
      content: "它表示第二个结果提升了准确率。",
    };
    const followUpMessage = createQuickAskUserMessage("为什么？", null, {});

    const messages = buildQuickAskApiMessages([
      firstUserMessage,
      firstAssistantMessage,
      followUpMessage,
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain(
      "The second result improves accuracy.",
    );
    expect(messages[0]?.content).toContain("这句话是什么意思？");
    expect(messages[1]).toEqual(firstAssistantMessage);
    expect(messages[2]?.content).toContain("为什么？");
  });

  it("uses the configured shortcut without consuming input-method combinations", () => {
    expect(
      isQuickAskShortcut({
        key: "q",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: true,
        isComposing: false,
      }),
    ).toBe(true);
    expect(
      isQuickAskShortcut(
        {
          key: " ",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          isComposing: false,
        },
        "Ctrl+Space",
      ),
    ).toBe(true);
    expect(
      isQuickAskShortcut({
        key: "q",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: true,
        isComposing: true,
      }),
    ).toBe(false);
  });

  it("stores Alt+Q as the default configurable Quick Ask shortcut", () => {
    const prefs = memoryPrefs();
    expect(getQuickAskShortcut(prefs)).toBe(DEFAULT_QUICK_ASK_SHORTCUT);

    setQuickAskShortcut(prefs, "Ctrl+Space");
    expect(getQuickAskShortcut(prefs)).toBe("Ctrl+Space");
  });

  it("remembers the Quick Ask model and reasoning independently", () => {
    const prefs = memoryPrefs();
    const selection = {
      presetId: "deepseek",
      model: "deepseek-reasoner",
      reasoningEffort: "xhigh" as const,
    };

    expect(loadQuickAskModelSelection(prefs)).toBeNull();
    saveQuickAskModelSelection(prefs, selection);
    expect(loadQuickAskModelSelection(prefs)).toEqual(selection);
  });

  it("ignores malformed saved Quick Ask model selections", () => {
    expect(loadQuickAskModelSelection(memoryPrefs("not json"))).toBeNull();
    expect(
      loadQuickAskModelSelection(
        memoryPrefs(
          JSON.stringify({
            presetId: "openai",
            model: "gpt-5.4",
            reasoningEffort: "turbo",
          }),
        ),
      ),
    ).toBeNull();
  });

  it("removes history access and write tools from the temporary tool session", () => {
    const read = { name: "zotero_search_pdf", requiresApproval: false };
    const history = {
      name: "chat_get_previous_context",
      requiresApproval: false,
    };
    const write = { name: "zotero_annotate_passage", requiresApproval: true };

    expect(quickAskReadOnlyTools([read, history, write])).toEqual([read]);
  });
});
