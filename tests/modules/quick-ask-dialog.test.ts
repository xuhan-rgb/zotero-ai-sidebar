import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disposeQuickAskDialog,
  focusQuickAskInput,
  renderQuickAskDialog,
  updateQuickAskReferenceView,
} from "../../src/modules/quick-ask-dialog";
import { createQuickAskState } from "../../src/modules/quick-ask";

function actions() {
  return {
    onQuestionChange: vi.fn(),
    onModelChange: vi.fn(),
    onReasoningChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onCopy: vi.fn(),
    onTransfer: vi.fn(),
    onClose: vi.fn(),
  };
}

afterEach(() => {
  globalThis.document.body.replaceChildren();
});

describe("Quick Ask dialog", () => {
  it("updates a newly selected quote without replacing or clearing the focused draft", () => {
    const state = createQuickAskState();
    state.question = "解释一下";
    const root = renderQuickAskDialog(document, state, actions(), {});
    document.body.append(root);
    const input = root.querySelector<HTMLTextAreaElement>(".zai-quick-ask-input")!;
    input.focus();
    input.setSelectionRange(2, 2);
    state.reference = { kind: "pdf", displayText: "第一段", sourceText: "第一段" };
    updateQuickAskReferenceView(root, state);
    expect(root.querySelector(".zai-quick-ask-reference")?.textContent).toContain("第一段");
    state.reference = { kind: "pdf", displayText: "另一段", sourceText: "另一段" };
    updateQuickAskReferenceView(root, state);
    expect(root.querySelectorAll(".zai-quick-ask-reference")).toHaveLength(1);
    expect(root.querySelector(".zai-quick-ask-reference")?.textContent).toContain("另一段");
    expect(root.querySelector(".zai-quick-ask-input")).toBe(input);
    expect(input.value).toBe("解释一下");
    expect(input.selectionStart).toBe(2);
    expect(document.activeElement).toBe(input);
    state.reference = null;
    updateQuickAskReferenceView(root, state);
    expect(root.querySelector(".zai-quick-ask-reference")).toBeNull();
    root.querySelector<HTMLButtonElement>(".zai-quick-ask-close")!.click();
  });

  it("lets pointer input reach the paper outside the non-modal dialog", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("addon/content/sidebar.css", "utf8");
    document.head.append(style);
    const root = renderQuickAskDialog(document, createQuickAskState(), actions(), {});
    document.body.append(root);
    try {
      const dialog = root.querySelector<HTMLElement>(".zai-quick-ask-dialog")!;
      expect(getComputedStyle(root).pointerEvents).toBe("none");
      expect(getComputedStyle(dialog).pointerEvents).toBe("auto");
      expect(dialog.getAttribute("aria-modal")).toBe("false");
    } finally {
      style.remove();
      root.querySelector<HTMLButtonElement>(".zai-quick-ask-close")!.click();
    }
  });

  it("keeps the dialog open when clicking outside, while the close button still works", () => {
    const handlers = actions();
    const root = renderQuickAskDialog(document, createQuickAskState(), handlers, {});
    document.body.append(root);
    root.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    root.click();
    expect(handlers.onClose).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(".zai-quick-ask-close")!.click();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it("shows every archived session read-only without replacing the current draft", () => {
    const state = createQuickAskState();
    state.question = "当前草稿";
    const handlers = actions();
    const onHistoryToggle = vi.fn();
    const root = renderQuickAskDialog(document, state, handlers, {
      history: ["第一场", "第二场"].map((id) => ({
        id,
        itemID: 1,
        createdAt: "2026-11-07T12:00:00Z",
        updatedAt: "2026-11-07T12:00:00Z",
        reference: null,
        messages: [
          { role: "user", content: id },
          { role: "assistant", content: `${id}回答` },
        ],
      })),
      onHistoryToggle,
    });
    document.body.append(root);
    const toggle = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "历史记录")!;
    const history = root.querySelector<HTMLElement>(".zai-quick-ask-history")!;
    expect(history.hidden).toBe(true);
    toggle.click();
    expect(history.hidden).toBe(false);
    expect(history.querySelectorAll("details")).toHaveLength(2);
    expect(history.textContent).toContain("第一场回答");
    expect(history.textContent).toContain("第二场回答");
    expect(history.querySelector("textarea")).toBeNull();
    expect(onHistoryToggle).toHaveBeenCalledWith(true);
    expect(state.messages).toEqual([]);
    expect(handlers.onSend).not.toHaveBeenCalled();
    toggle.click();
    expect(history.hidden).toBe(true);
    expect(
      root.querySelector<HTMLTextAreaElement>(".zai-quick-ask-input")!.value,
    ).toBe("当前草稿");
    expect(root.textContent).not.toContain("关闭后销毁");
    root.querySelector<HTMLButtonElement>(".zai-quick-ask-close")!.click();
  });

  it("keeps a growing dialog inside the viewport", () => {
    const position = { x: 100, y: 200 };
    const root = renderQuickAskDialog(
      document,
      createQuickAskState(),
      actions(),
      {
        position,
      },
    );
    document.body.append(root);
    const dialog = root.querySelector<HTMLElement>(".zai-quick-ask-dialog")!;
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: window.innerHeight - 100,
      right: 500,
      bottom: window.innerHeight + 200,
      width: 400,
      height: 300,
    } as DOMRect);

    window.dispatchEvent(new Event("resize"));

    expect(position.y).toBe(0);
    expect(dialog.style.transform).toBe("translate(100px, 0px)");
    root.querySelector<HTMLButtonElement>(".zai-quick-ask-close")!.click();
  });

  it("rechecks layout after redraw and disconnects observers on disposal", () => {
    const callbacks: Array<() => void> = [];
    const disconnects: Array<ReturnType<typeof vi.fn>> = [];
    const observer = vi.spyOn(window, "ResizeObserver").mockImplementation(
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
          disconnects.push(this.disconnect);
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      } as unknown as typeof ResizeObserver,
    );
    const position = { x: 100, y: 200 };
    try {
      const root = renderQuickAskDialog(
        document,
        createQuickAskState(),
        actions(),
        { position },
      );
      document.body.append(root);
      const updated = renderQuickAskDialog(
        document,
        createQuickAskState(),
        actions(),
        { position },
      );
      root.replaceWith(updated);
      expect(disconnects[0]).toHaveBeenCalledOnce();
      const dialog = updated.querySelector<HTMLElement>(
        ".zai-quick-ask-dialog",
      )!;
      vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
        left: 100,
        top: window.innerHeight - 100,
        right: 500,
        bottom: window.innerHeight + 200,
        width: 400,
        height: 300,
      } as DOMRect);
      callbacks[1]();
      expect(position.y).toBe(0);
      expect(dialog.style.transform).toBe("translate(100px, 0px)");
      const remove = vi.spyOn(document, "removeEventListener");
      updated
        .querySelector<HTMLElement>(".zai-quick-ask-head")!
        .dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        );
      disposeQuickAskDialog(position);
      expect(disconnects[1]).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith("mousemove", expect.any(Function));
      expect(remove).toHaveBeenCalledWith("mouseup", expect.any(Function));
      remove.mockRestore();
    } finally {
      disposeQuickAskDialog(position);
      observer.mockRestore();
    }
  });

  it("removes document drag listeners when Escape closes the dialog", () => {
    const root = renderQuickAskDialog(
      document,
      createQuickAskState(),
      actions(),
      {},
    );
    document.body.append(root);
    const remove = vi.spyOn(document, "removeEventListener");
    root
      .querySelector<HTMLElement>(".zai-quick-ask-head")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    try {
      expect(remove).toHaveBeenCalledWith("mousemove", expect.any(Function));
      expect(remove).toHaveBeenCalledWith("mouseup", expect.any(Function));
    } finally {
      document.dispatchEvent(new MouseEvent("mouseup"));
      remove.mockRestore();
    }
  });

  it("focuses the host window and question input when opened", () => {
    const root = renderQuickAskDialog(
      document,
      createQuickAskState(),
      actions(),
      {},
    );
    document.body.append(root);
    const focusWindow = vi.spyOn(window, "focus");
    focusQuickAskInput(root);
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      root.querySelector(".zai-quick-ask-input"),
    );
    focusWindow.mockRestore();
  });
  it("exposes the follow-mouse setting in the header", () => {
    const onFollowMouseChange = vi.fn();
    const root = renderQuickAskDialog(
      document,
      createQuickAskState(),
      actions(),
      {
        followMouse: true,
        onFollowMouseChange,
      },
    );
    const checkbox = root.querySelector<HTMLInputElement>(
      ".zai-quick-ask-follow-mouse input",
    )!;
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(onFollowMouseChange).toHaveBeenCalledWith(false);
  });
  it("drags from the header and retains its position after a redraw", () => {
    const position = { x: 0, y: 0 };
    const handlers = actions();
    const root = renderQuickAskDialog(
      document,
      createQuickAskState(),
      handlers,
      {
        position,
      },
    );
    document.body.append(root);
    const dialog = root.querySelector<HTMLElement>(".zai-quick-ask-dialog")!;
    const head = root.querySelector<HTMLElement>(".zai-quick-ask-head")!;
    head.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 60, clientY: 40 }),
    );
    expect(dialog.style.transform).toBe("translate(50px, 30px)");
    const updated = renderQuickAskDialog(
      document,
      createQuickAskState(),
      handlers,
      {
        position,
      },
    );
    root.replaceWith(updated);
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 70, clientY: 50 }),
    );
    expect(
      updated.querySelector<HTMLElement>(".zai-quick-ask-dialog")!.style
        .transform,
    ).toBe("translate(60px, 40px)");
    document.dispatchEvent(new MouseEvent("mouseup"));
    updated.querySelector<HTMLButtonElement>(".zai-quick-ask-close")!.click();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it("does not replay entrance animations when the dialog is redrawn", () => {
    const initial = renderQuickAskDialog(
      document,
      createQuickAskState(),
      actions(),
      {},
    );
    const updated = renderQuickAskDialog(
      document,
      createQuickAskState(),
      actions(),
      {
        animateEntrance: false,
      },
    );

    expect(initial.style.animation).toBe("");
    expect(
      initial.querySelector<HTMLElement>(".zai-quick-ask-dialog")!.style
        .animation,
    ).toBe("");
    expect(updated.style.animation).toBe("none");
    expect(
      updated.querySelector<HTMLElement>(".zai-quick-ask-dialog")!.style
        .animation,
    ).toBe("none");
  });

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

  it("enables the continuous send action as the user types", () => {
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

  it("defaults to the active chat model and allows a temporary model change", () => {
    const handlers = actions();
    const root = renderQuickAskDialog(
      globalThis.document,
      createQuickAskState(null, {
        presetId: "openai-main",
        model: "gpt-5.4",
        reasoningEffort: "high",
      }),
      handlers,
      {
        modelOptions: [
          {
            presetId: "openai-main",
            presetLabel: "OpenAI 主账号",
            model: "gpt-5.4",
          },
          {
            presetId: "deepseek",
            presetLabel: "DeepSeek",
            model: "deepseek-chat",
          },
        ],
        reasoningOptions: [
          ["none", "关闭 - 不进行额外思考"],
          ["high", "High - 强推理"],
        ],
      },
    );

    const presetSelect = root.querySelector<HTMLSelectElement>(
      ".zai-quick-ask-preset-select",
    )!;
    const modelSelect = root.querySelector<HTMLSelectElement>(
      ".zai-quick-ask-model-select",
    )!;
    expect(presetSelect.value).toBe("openai-main");
    expect(presetSelect.options[0]?.textContent).toContain("OpenAI 主账号");
    expect(modelSelect.value).toBe("gpt-5.4");

    presetSelect.value = "deepseek";
    presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(handlers.onModelChange).toHaveBeenCalledWith(
      "deepseek",
      "deepseek-chat",
    );

    const reasoning = root.querySelector<HTMLSelectElement>(
      ".zai-quick-ask-reasoning-select",
    )!;
    expect(reasoning.value).toBe("high");
    reasoning.value = "none";
    reasoning.dispatchEvent(new Event("change", { bubbles: true }));
    expect(handlers.onReasoningChange).toHaveBeenCalledWith("none");
  });

  it("explains when the selected account does not support thinking", () => {
    const root = renderQuickAskDialog(
      globalThis.document,
      createQuickAskState(null, {
        presetId: "compat",
        model: "custom-model",
        reasoningEffort: "none",
      }),
      actions(),
      {
        modelOptions: [
          {
            presetId: "compat",
            presetLabel: "兼容账号",
            model: "custom-model",
          },
        ],
        reasoningOptions: [],
      },
    );

    const reasoning = root.querySelector<HTMLSelectElement>(
      ".zai-quick-ask-reasoning-select",
    )!;
    expect(reasoning.disabled).toBe(true);
    expect(reasoning.textContent).toContain("当前账号不支持");
  });

  it("opens model controls from the header without header hints", () => {
    const handlers = actions();
    const root = renderQuickAskDialog(
      globalThis.document,
      createQuickAskState(null, {
        presetId: "openai-main",
        model: "gpt-5.4",
        reasoningEffort: "high",
      }),
      handlers,
      {
        modelOptions: [
          {
            presetId: "openai-main",
            presetLabel: "OpenAI 主账号",
            model: "gpt-5.4",
          },
        ],
        reasoningOptions: [["high", "High - 强推理"]],
      },
    );

    const panel = root.querySelector<HTMLElement>(
      ".zai-quick-ask-model-settings-panel",
    )!;

    const settings = root.querySelector<HTMLElement>(
      ".zai-quick-ask-model-settings",
    )!;
    const toggle = root.querySelector<HTMLButtonElement>(
      ".zai-quick-ask-model-settings-toggle",
    )!;
    expect(settings.hidden).toBe(true);
    toggle.click();
    expect(settings.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.querySelectorAll("select")).toHaveLength(3);
    expect(root.querySelector(".zai-quick-ask-info")).toBeNull();
    expect(root.querySelector(".zai-quick-ask-shortcut")).toBeNull();
    expect(root.textContent).toContain("OpenAI 主账号");
    expect(root.textContent).toContain("gpt-5.4");
    expect(root.textContent).not.toContain("本次 Quick Ask");
  });

  it("keeps the transcript and follow-up box after an answer", () => {
    const handlers = actions();
    const state = createQuickAskState({
      kind: "translation",
      displayText: "第二个结果提高了准确率。",
      sourceText: "The second result improves accuracy.",
    });
    state.status = "answered";
    state.messages.push(
      { role: "user", content: "为什么？" },
      { role: "assistant", content: "因为训练目标不同。" },
    );

    const root = renderQuickAskDialog(globalThis.document, state, handlers, {});

    expect(root.textContent).toContain("第二个结果提高了准确率。");
    expect(root.textContent).toContain("The second result improves accuracy.");
    expect(root.textContent).toContain("为什么？");
    expect(root.textContent).toContain("因为训练目标不同。");
    const followUp = root.querySelector<HTMLTextAreaElement>(
      ".zai-quick-ask-input",
    )!;
    followUp.value = "这个结论如何验证？";
    followUp.dispatchEvent(new Event("input", { bubbles: true }));
    const continueButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "继续询问",
    )!;
    continueButton.click();

    expect(handlers.onSend).toHaveBeenCalledWith("这个结论如何验证？");
    expect(root.textContent).toContain("继续询问");
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
