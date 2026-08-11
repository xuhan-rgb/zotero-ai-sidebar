import { describe, expect, it } from "vitest";

import {
  buildQuickAskApiMessages,
  createQuickAskState,
  createQuickAskUserMessage,
  DEFAULT_QUICK_ASK_SHORTCUT,
  getQuickAskShortcut,
  isQuickAskShortcut,
  loadQuickAskModelSelection,
  quickAskReadOnlyTools,
  saveQuickAskModelSelection,
  setQuickAskShortcut,
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
