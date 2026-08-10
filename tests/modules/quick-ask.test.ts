import { describe, expect, it } from "vitest";

import {
  buildQuickAskApiMessages,
  createQuickAskState,
  createQuickAskUserMessage,
  isQuickAskShortcut,
  quickAskReadOnlyTools,
  resetQuickAskState,
} from "../../src/modules/quick-ask";

describe("Quick Ask", () => {
  it("builds a single-turn API request without accepting chat history", () => {
    const userMessage = createQuickAskUserMessage(
      "这句话是什么意思？",
      {
        kind: "translation",
        displayText: "第二个结果提高了准确率。",
        sourceText: "The second result improves accuracy.",
      },
      {},
    );

    const messages = buildQuickAskApiMessages(userMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain(
      "The second result improves accuracy.",
    );
    expect(messages[0]?.content).toContain("这句话是什么意思？");
  });

  it("clears the previous question and answer while keeping the captured quote", () => {
    const reference = {
      kind: "pdf" as const,
      displayText: "A selected sentence.",
      sourceText: "A selected sentence.",
    };
    const state = createQuickAskState(reference);
    state.question = "First question";
    state.answer = "First answer";
    state.thinking = "Private reasoning";
    state.status = "answered";

    const reset = resetQuickAskState(state);

    expect(reset).toEqual({
      status: "idle",
      question: "",
      answer: "",
      thinking: "",
      statusText: "",
      error: "",
      usage: undefined,
      reference,
    });
  });

  it("uses Alt+Q without consuming Chinese input-method key combinations", () => {
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
      isQuickAskShortcut({
        key: " ",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        isComposing: false,
      }),
    ).toBe(false);
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
