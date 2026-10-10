import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWebUsageNotice } from "../../src/modules/web-usage-notice";
import { assistantProgressFor } from "../../src/modules/assistant-progress";
import { renderComposerReasoningSelect } from "../../src/modules/composer-reasoning";
import { renderImageAttachButton } from "../../src/modules/composer-images";
import {
  inspectWebAgentInstallation,
  type WebAgentInstallerHost,
} from "../../src/modules/web-agent-installer";
import { localizeStaticUi } from "../../src/utils/ui-locale";
import { readFileSync } from "node:fs";

function systemLocale(locale: string): void {
  vi.stubGlobal("Cc", {
    "@mozilla.org/intl/ospreferences;1": {
      getService: () => ({ systemLocales: [locale] }),
    },
  });
  vi.stubGlobal("Ci", { mozIOSPreferences: {} });
}

afterEach(() => vi.unstubAllGlobals());

describe("issue #29 interface language", () => {
  it("falls back to English for a German system even with Chinese Zotero", () => {
    systemLocale("de-DE");
    vi.stubGlobal("Zotero", { locale: "zh-CN" });
    const layer = renderWebUsageNotice(document, () => {});
    expect(
      layer.querySelector(".zai-web-notice-callout-title")?.textContent,
    ).toBe("WEB does not send images by default");
  });

  it("preserves Chinese interface text on a Chinese system", () => {
    systemLocale("zh-CN");
    const layer = renderWebUsageNotice(document, () => {});
    expect(
      layer.querySelector(".zai-web-notice-callout-title")?.textContent,
    ).toBe("WEB 默认不发送图片");
  });

  it("renders English reasoning controls without changing provider parameters", () => {
    systemLocale("ru-RU");
    const change = vi.fn();
    const root = renderComposerReasoningSelect(
      document,
      {
        id: "test",
        label: "我的模型",
        provider: "openai",
        apiKey: "",
        baseUrl: "",
        model: "gpt-5.6-sol",
        maxTokens: 32768,
      },
      false,
      change,
    );
    const select = root.querySelector("select")!;
    expect(select.getAttribute("aria-label")).toBe("Reasoning effort");
    expect(select.options[0].textContent).toBe("Off");
    expect(select.title).not.toMatch(/[\u3400-\u9fff]/);
    select.value = "high";
    select.dispatchEvent(new Event("change"));
    expect(change.mock.calls[0][0]).toMatchObject({
      label: "我的模型",
      model: "gpt-5.6-sol",
      extras: { reasoningEffortByModel: { "gpt-5.6-sol": "high" } },
    });
  });

  it("renders English attachment chrome without changing the draft", () => {
    systemLocale("en-GB");
    const input = document.createElement("textarea");
    input.value = "请用中文回答";
    const state = {
      draftText: input.value,
      draftSelectionStart: 0,
      draftSelectionEnd: 0,
      draftHadFocus: false,
      draftImages: [],
      nextPasteID: 1,
    };
    const root = renderImageAttachButton(
      document,
      document.createElement("div"),
      state,
      input,
      () => {},
      { selectedChatPreset: () => ({}), renderPanel: () => {} },
    );
    expect(root.querySelector("button")?.textContent).toBe("Images");
    expect(root.querySelector("button")?.title).toContain("system screenshot");
    expect(input.value).toBe("请用中文回答");
  });

  it("localizes progress labels without translating model content", () => {
    systemLocale("de-DE");
    const message = { role: "assistant" as const, content: "这是模型回复" };
    const progress = assistantProgressFor(
      {
        sending: true,
        activeAssistantIndex: 0,
        activeAssistantStage: "writing",
        messages: [message],
      },
      0,
      message,
    );
    expect(progress?.label).toBe("Generating response");
    expect(message.content).toBe("这是模型回复");
  });

  it("shows English dependency errors on unsupported systems", async () => {
    systemLocale("ja-JP");
    const host = {
      platform: "linux",
      homeDir: "/home/test",
      dataDir: "/tmp/test",
      profileDir: "/tmp/profile",
      env: {},
      exists: async () => false,
      readUTF8: async () => {
        throw new Error("missing");
      },
      probeNodeVersion: async () => null,
      health: async () => null,
    } as WebAgentInstallerHost;
    const report = await inspectWebAgentInstallation(host);
    expect(report.state).toBe("blocked");
    expect(report.message).toMatch(/^Missing system dependencies:/);
    expect(report.missing).toContain("Node.js 20+");
    expect(report.missing).toContain("xclip");
  });

  it("localizes the shipped static settings markup", () => {
    systemLocale("fr-FR");
    const root = document.createElement("div");
    root.innerHTML = readFileSync("addon/content/preferences.xhtml", "utf8");
    localizeStaticUi(root);
    expect(root.querySelector("#zai-save-commit")?.textContent).toBe(
      "Save changes",
    );
    expect(root.querySelector("#zai-save-discard")?.textContent).toBe(
      "Discard",
    );
    expect(
      root.querySelector("[data-zai-l10n='AI Chat Settings']")?.textContent,
    ).toBe("AI Chat Settings");
  });

  it("keeps the shipped settings title and controls in Chinese on Chinese systems", () => {
    systemLocale("zh-TW");
    const root = document.createElement("div");
    root.innerHTML = readFileSync("addon/content/preferences.xhtml", "utf8");
    localizeStaticUi(root);
    expect(root.querySelector("#zai-save-commit")?.textContent).toBe(
      "保存更改",
    );
    expect(
      root.querySelector("[data-zai-l10n='AI Chat Settings']")?.textContent,
    ).toBe("AI 对话设置");
  });
});
