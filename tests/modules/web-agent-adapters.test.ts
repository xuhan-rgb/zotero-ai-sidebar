// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  firstPopulatedLocator,
  providerDefinition,
  selectorList,
  customProviderDefinition,
} from "../../web-agent/adapters.mjs";
import { setWebAttachmentInputFiles } from "../../web-agent/attachments.mjs";

describe("Web Agent provider adapters", () => {
  it("defines separate ChatGPT and DeepSeek pages and response selectors", () => {
    const chatgpt = providerDefinition("chatgpt");
    const deepseek = providerDefinition("deepseek");
    expect(chatgpt.host).toBe("chatgpt.com");
    expect(deepseek.host).toBe("chat.deepseek.com");
    expect(chatgpt.answers).toContain("[data-message-author-role='assistant']");
    expect(deepseek.answers).toContain(
      ".ds-message .ds-assistant-message-main-content",
    );
    expect(deepseek.reasoning).toContain(".ds-think-content .ds-markdown");
    expect(chatgpt.attachmentPreviews.length).toBeGreaterThan(0);
    expect(deepseek.attachmentPreviews.length).toBeGreaterThan(0);
    expect(chatgpt.attachmentUploading.length).toBeGreaterThan(0);
    expect(deepseek.attachmentUploading.length).toBeGreaterThan(0);
    expect(chatgpt.attachmentUploading).toContain(
      "[data-composer-body] [role='group'][aria-label] [class*='animate-spin']",
    );
  });

  it("recognizes ChatGPT's UUID-named file tile after a pasted upload", () => {
    const chatgpt = providerDefinition("chatgpt");
    const composer = document.createElement("div");
    composer.setAttribute("data-composer-body", "");
    const fileTile = document.createElement("div");
    fileTile.setAttribute("role", "group");
    fileTile.setAttribute(
      "aria-label",
      "beacdf06-96e2-451f-9ed3-75b5a2446ea1.pdf",
    );
    composer.append(fileTile);
    document.body.append(composer);

    expect(
      chatgpt.attachmentPreviews.some((selector) => fileTile.matches(selector)),
    ).toBe(true);
  });

  it("rejects unsupported providers and creates a CSS selector union", () => {
    expect(() => providerDefinition("unknown")).toThrow("Unsupported provider");
    expect(selectorList(["textarea", "div[contenteditable='true']"])).toBe(
      "textarea, div[contenteditable='true']",
    );
    expect(selectorList([])).toBe(":not(*)");
  });

  it("builds a ChatGPT-like adapter from a safe custom definition", () => {
    const adapter = customProviderDefinition({
      id: "paper-site",
      name: "Paper Site",
      template: "chatgpt-like",
      homeUrl: "https://example.com/chat",
      newConversationUrl: "https://example.com/chat/new",
      selectors: {
        composer: ["textarea.chat"],
        send: ["button.send"],
        stop: ["button.stop"],
        answers: ["article.answer"],
        attachmentPreviews: [".file"],
        attachmentUploading: [".loading"],
      },
    });
    expect(adapter.name).toBe("Paper Site");
    expect(adapter.host).toBe("example.com");
    expect(adapter.composer).toEqual(["textarea.chat"]);
    expect(adapter.answers).toEqual([
      "article.answer",
      "[class*='_markdown'].markdown",
    ]);
    expect(() =>
      customProviderDefinition({
        id: "bad",
        name: "Bad",
        template: "chatgpt-like",
        homeUrl: "javascript:alert(1)",
        newConversationUrl: "javascript:alert(1)",
        selectors: {
          composer: ["textarea"],
          send: ["button"],
          stop: [],
          answers: [".answer"],
          attachmentPreviews: [],
          attachmentUploading: [],
        },
      }),
    ).toThrow();
  });

  it("recognizes the current unlabeled DeepSeek submit control", () => {
    const deepseek = providerDefinition("deepseek");
    expect(deepseek.send).toContain("div[role='button'].ds-button--primary");
  });

  it("uses only the first populated answer selector", async () => {
    const counts = new Map([
      [".stable-answer", 2],
      [".nested-markdown", 4],
    ]);
    const page = {
      locator: (selector: string) => ({
        selector,
        count: async () => counts.get(selector) ?? 0,
      }),
    };

    const locator = await firstPopulatedLocator(page, [
      ".missing-answer",
      ".stable-answer",
      ".nested-markdown",
    ]);

    expect(locator.selector).toBe(".stable-answer");
  });

  it("pastes files into the composer without clicking an attachment button", () => {
    const source = readFileSync(
      resolve(process.cwd(), "web-agent/attachments.mjs"),
      "utf8",
    );
    expect(source).toContain('"text/uri-list"');
    expect(source).toContain("writeClipboard(");
    // The X11 clipboard is global; concurrent provider tasks must serialize.
    expect(source).toContain("withClipboardLock(");
    expect(source).toContain('page.keyboard.press("Control+V")');
    expect(source).toContain("options.allowClipboardFallback === false");
    expect(source.indexOf("const uploadedThroughInput")).toBeLessThan(
      source.indexOf("await withClipboardLock("),
    );
    expect(source).not.toContain(".click(");
    expect(source).toContain("请求过于频繁");
    expect(source).toContain("rate limit");
    const agent = readFileSync(
      resolve(process.cwd(), "web-agent/agent.mjs"),
      "utf8",
    );
    expect(agent).toContain("allowClipboardFallback:");
    expect(agent).toContain(
      '!["DeepSeek", "ChatGPT"].includes(adapter.name)',
    );
  });

  it("uploads through the hidden file input without focusing Chrome", async () => {
    const setInputFiles = vi.fn(async () => undefined);
    const input = { setInputFiles };
    const page = {
      locator: vi.fn(() => ({
        count: vi.fn(async () => 1),
        nth: vi.fn(() => input),
      })),
    };

    await expect(
      setWebAttachmentInputFiles(page, "/tmp/paper.pdf"),
    ).resolves.toBe(true);
    expect(page.locator).toHaveBeenCalledWith("input[type='file']");
    expect(setInputFiles).toHaveBeenCalledWith("/tmp/paper.pdf");
  });

  it("extracts only a newly generated answer and returns it to Zotero", () => {
    const source = readFileSync(
      resolve(process.cwd(), "web-agent/agent.mjs"),
      "utf8",
    );
    expect(source).toContain(
      "const previousAnswerCount = await answers.count()",
    );
    expect(source).toContain("const result = await waitForAnswer(");
    expect(source).toContain("previousAnswerCount,");
    expect(source).toContain("answerNodeReasoningMarkdown(");
    expect(source).toContain("adapter.reasoning");
    expect(source).toContain("const previousCopyCount =");
    expect(source).toContain(
      "const completionReady = await answerCompletionReady(",
    );
    expect(source).toContain("previousCopyCount,");
    // The stability threshold moved into the extracted answer-wait module.
    const answerWait = readFileSync(
      resolve(process.cwd(), "web-agent/answer-wait.mjs"),
      "utf8",
    );
    expect(answerWait).toContain("nextStable >= 12");
    expect(source).toContain('callback(task, "generating", result)');
    expect(source).toContain("reasoning: reasoningChunks.join");
    expect(source).toContain('element.getAttribute("role") === "heading"');
    expect(source).toContain('.replace(/^#{1,6}\\s+/, "")');
    expect(source).toContain('["::before", "::marker"]');
    expect(source).toContain(
      '["style", "script", "noscript", "template", "canvas"]',
    );
    expect(source).toContain("/^https?:\\/\\/sandbox:|^sandbox:/i");
    expect(source).toContain('await callback(task, "completed", result)');
    expect(source).toContain("async function composerText(composer)");
    expect(source).toContain("composer.inputValue().catch(() => \"\")");
    expect(source).toContain(
      'element.hasAttribute("data-file-citation-group-identity")',
    );
    expect(source).toContain("hasCitationMarker");
    expect(source).toContain("data-testid*='file-citation'");
    expect(source).toContain("const href = element.href || element.getAttribute(\"href\") || \"\";");
    expect(source).toContain("const label = (element.textContent || \"\").trim() || href;");
    expect(source.indexOf('if (tag === "a")')).toBeLessThan(
      source.indexOf("const hasCitationMarker"),
    );
    expect(source).toContain("materializeAnswerDownloads");
    expect(source).toContain('if (adapter.name === "DeepSeek") return answer;');
    expect(source).toContain("extractRenderedSvgImages");
    expect(source).toContain("data:image/svg+xml;charset=utf-8");
    expect(source).toContain("foreignObject");
    expect(source).toContain("downloadAnswerButton");
    expect(source).toContain("pathToFileURL(destination).href");
    expect(source).toContain("#zai-web-download");
    expect(source).toContain("button[aria-label='下载']");
    expect(source).toContain("isDownloadableFileName");
    expect(source).toContain("[0-9a-f]{8}-[0-9a-f]{4}");
  });
});
