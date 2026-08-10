import { afterEach, describe, expect, it, vi } from "vitest";

import { renderQuickAskDialog } from "../../src/modules/quick-ask-dialog";
import { createQuickAskState } from "../../src/modules/quick-ask";

function actions() {
  return {
    onQuestionChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onReset: vi.fn(),
    onCopy: vi.fn(),
    onTransfer: vi.fn(),
    onClose: vi.fn(),
  };
}

afterEach(() => {
  globalThis.document.body.replaceChildren();
});

describe("Quick Ask dialog", () => {
  it("creates real XHTML controls when mounted from Zotero's XUL document", () => {
    const xhtml = "http://www.w3.org/1999/xhtml";
    const xulDocument = globalThis.document.implementation.createDocument(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "window",
    );

    const root = renderQuickAskDialog(
      xulDocument,
      createQuickAskState(),
      actions(),
      { shortcutLabel: "Alt + Q" },
    );

    expect(root.namespaceURI).toBe(xhtml);
    expect(root.querySelector("textarea")?.namespaceURI).toBe(xhtml);
    expect(root.querySelector("button")?.namespaceURI).toBe(xhtml);
  });

  it("enables the one-shot send action as the user types", () => {
    const handlers = actions();
    const root = renderQuickAskDialog(
      globalThis.document,
      createQuickAskState(),
      handlers,
      { shortcutLabel: "Ctrl/Cmd + Shift + Space" },
    );
    globalThis.document.body.append(root);
    const input = root.querySelector<HTMLTextAreaElement>(
      ".zai-quick-ask-input",
    )!;
    const send = root.querySelector<HTMLButtonElement>(
      ".zai-quick-ask-primary",
    )!;

    expect(send.disabled).toBe(true);
    input.value = "解释这个结论";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(send.disabled).toBe(false);
    send.click();

    expect(handlers.onQuestionChange).toHaveBeenCalledWith("解释这个结论");
    expect(handlers.onSend).toHaveBeenCalledWith("解释这个结论");
  });

  it("shows the Chinese selection and mapped English quote without a follow-up box", () => {
    const handlers = actions();
    const state = createQuickAskState({
      kind: "translation",
      displayText: "第二个结果提高了准确率。",
      sourceText: "The second result improves accuracy.",
    });
    state.status = "answered";
    state.question = "为什么？";
    state.answer = "因为训练目标不同。";

    const root = renderQuickAskDialog(globalThis.document, state, handlers, {
      shortcutLabel: "Ctrl/Cmd + Shift + Space",
    });

    expect(root.textContent).toContain("第二个结果提高了准确率。");
    expect(root.textContent).toContain("The second result improves accuracy.");
    expect(root.querySelector(".zai-quick-ask-input")).toBeNull();
    expect(root.textContent).toContain("再问一个");
  });

  it("closes and destroys the popup on Escape", () => {
    const handlers = actions();
    const root = renderQuickAskDialog(
      globalThis.document,
      createQuickAskState(),
      handlers,
      { shortcutLabel: "Ctrl/Cmd + Shift + Space" },
    );

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
});
