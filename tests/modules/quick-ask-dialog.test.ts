import { afterEach, describe, expect, it, vi } from "vitest";

import { renderQuickAskDialog } from "../../src/modules/quick-ask-dialog";
import { createQuickAskState } from "../../src/modules/quick-ask";

function actions() {
  return {
    onQuestionChange: vi.fn(),
    onToggleModelSettings: vi.fn(),
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
        shortcutLabel: "Alt + Q",
        modelSettingsOpen: true,
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
        shortcutLabel: "Alt + Q",
        modelSettingsOpen: true,
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

  it("keeps model controls collapsed behind a settings button by default", () => {
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
        shortcutLabel: "Alt + Q",
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

    const toggle = root.querySelector<HTMLButtonElement>(
      ".zai-quick-ask-model-settings-toggle",
    )!;
    const panel = root.querySelector<HTMLElement>(
      ".zai-quick-ask-model-settings-panel",
    )!;

    expect(toggle.textContent).toContain("模型设置");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(root.textContent).toContain("OpenAI 主账号");
    expect(root.textContent).toContain("gpt-5.4");
    expect(root.textContent).not.toContain("本次 Quick Ask");

    toggle.click();
    expect(handlers.onToggleModelSettings).toHaveBeenCalledOnce();
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

    const root = renderQuickAskDialog(globalThis.document, state, handlers, {
      shortcutLabel: "Ctrl/Cmd + Shift + Space",
    });

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
