// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  firstResponseLocator,
  firstPopulatedLocator,
  providerDefinition,
  selectorList,
  customProviderDefinition,
} from "../../web-agent/adapters.mjs";
import {
  attachmentVisibleNameCandidates,
  attachmentPreviewMatchesName,
  attachmentTextStateFromBody,
  setWebAttachmentsAsBatch,
  setWebAttachmentInputFiles,
  stageWebAttachment,
  waitForWebAttachmentAcceptance,
} from "../../web-agent/attachments.mjs";

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
    expect(deepseek.completion).toEqual([
      "[role='button'].ds-button--iconLabelTertiary",
    ]);
    expect(deepseek.completion).not.toEqual(deepseek.copy);
    expect(chatgpt.attachmentPreviews.length).toBeGreaterThan(0);
    expect(deepseek.attachmentPreviews.length).toBeGreaterThan(0);
    expect(chatgpt.attachmentUploading.length).toBeGreaterThan(0);
    expect(deepseek.attachmentUploading.length).toBeGreaterThan(0);
    expect(chatgpt.serialAttachments).toBeUndefined();
    expect(deepseek.serialAttachments).toBeUndefined();
    expect(chatgpt.pageNoticeFallback).toBe(true);
    expect(deepseek.pageNoticeFallback).toBe(true);
    expect(chatgpt.latexUploadExtension).toBeUndefined();
    expect(deepseek.latexUploadExtension).toBeUndefined();
    expect(chatgpt.attachmentUploading).toContain(
      "[data-composer-body] [role='group'][aria-label] [class*='animate-spin']",
    );
  });

  it("locates a DeepSeek response before its final answer node exists", () => {
    document.body.innerHTML = `
      <div class="ds-message">
        <div class="ds-think-content">
          <div class="ds-markdown">正在分析用户问题</div>
        </div>
      </div>`;

    const deepseek = providerDefinition("deepseek");
    const responses = document.querySelectorAll(
      selectorList(deepseek.responseRoots),
    );
    const answers = document.querySelectorAll(selectorList(deepseek.answers));

    expect(answers).toHaveLength(0);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.textContent).toContain("正在分析用户问题");
  });

  it("selects a DeepSeek response root while its final answer is still empty", async () => {
    const deepseek = providerDefinition("deepseek");
    const responseSelector = deepseek.responseRoots?.[0] || "";
    const page = {
      locator: (selector: string) => ({
        selector,
        count: async () => (selector === responseSelector ? 1 : 0),
      }),
    };

    const locator = await firstResponseLocator(page, deepseek);

    expect(locator.selector).toBe(responseSelector);
  });

  it("defines ChatGLM as a built-in provider", () => {
    const chatglm = providerDefinition("chatglm");
    expect(chatglm.name).toBe("ChatGLM");
    expect(chatglm.host).toBe("chatglm.cn");
    expect(chatglm.url).toBe("https://chatglm.cn/main/alltoolsdetail?lang=zh");
    expect(chatglm.send[0]).toBe(".enter-icon-container");
    expect(chatglm.attachmentTrigger.length).toBeGreaterThan(0);
    expect(chatglm.serialAttachments).toBe(true);
    expect(chatglm.batchAttachmentInput).toEqual([
      "input[type='file'][multiple]",
    ]);
    expect(chatglm.looseAttachmentNames).toBe(true);
    expect(chatglm.pageNoticeFallback).toBe(true);
    expect(chatglm.stop).not.toContain("[class*='stop']");
    expect(chatglm.stop).toContain(".enter-icon-container [class*='stop']");
    expect(chatglm.attachmentUploading).not.toContain("[aria-busy='true']");
    expect(chatglm.attachmentUploading).not.toContain("[role='progressbar']");
  });

  it("defines Kimi as a built-in provider with its own submit and final-answer selectors", () => {
    const kimi = providerDefinition("kimi");
    expect(kimi.name).toBe("Kimi");
    expect(kimi.host).toBe("www.kimi.com");
    expect(kimi.template).toBe("chatgpt-like");
    expect(kimi.latexUploadExtension).toBe(".txt");
    expect(kimi.waitForAttachmentAcceptance).toBe(true);
    expect(kimi.previewScopedAttachmentNames).toBe(true);
    expect(kimi.batchAttachmentTrigger).toEqual([".toolkit-trigger-btn"]);
    expect(kimi.batchAttachmentInput).toEqual([
      ".toolkit-popover input[type='file'][multiple]",
    ]);
    expect(kimi.bundleTextAttachments).toBeUndefined();
    expect(kimi.serialAttachments).toBeUndefined();
    expect(kimi.batchAttachments).toBeUndefined();
    expect(kimi.send).toContain(".send-button-container:has(svg[name='Send'])");
    expect(kimi.answers).toContain(
      ".chat-content-item-assistant .segment-content-box > .markdown-container > .markdown",
    );
    expect(kimi.reasoning).toContain(".thinking-container .markdown");
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
    expect(adapter.latexUploadExtension).toBe(".txt");
    expect(adapter.name).toBe("Paper Site");
    expect(adapter.host).toBe("example.com");
    expect(adapter.composer).toEqual(["textarea.chat"]);
    expect(adapter.answers).toEqual([
      "article.answer",
      "[class*='_markdown'].markdown",
      ".chat-content-item-assistant .segment-content-box > .markdown-container > .markdown",
    ]);
    expect(adapter.pageNoticeFallback).toBe(true);
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

  it("selects Kimi's final answer without importing its thinking panel", () => {
    const adapter = customProviderDefinition({
      id: "kimi-com",
      name: "kimi.com",
      template: "chatgpt-like",
      homeUrl: "https://www.kimi.com/",
      selectors: {
        composer: ["[contenteditable='true']"],
        send: ["button[type='submit']"],
        answers: ["article"],
      },
    });
    const assistant = document.createElement("div");
    assistant.className = "chat-content-item-assistant";
    assistant.innerHTML = `
      <div class="segment-content-box">
        <div class="thinking-container">
          <div class="markdown-container"><div class="markdown">内部思考</div></div>
        </div>
        <div class="markdown-container"><div class="markdown">最终回答</div></div>
      </div>`;
    document.body.append(assistant);
    const matches = document.querySelectorAll(adapter.answers.at(-1)!);
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent).toBe("最终回答");
  });

  it("stages LaTeX as a real txt file only for third-party adapters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zai-web-stage-test-"));
    const source = join(directory, "source.tex");
    const stage = join(directory, "stage");
    await writeFile(source, "\\section{Method}", "utf8");
    try {
      const attachment = {
        kind: "latex",
        path: source,
        name: "main.tex",
        mimeType: "text/plain",
      };
      const custom = await stageWebAttachment(
        attachment,
        { latexUploadExtension: ".txt" },
        stage,
      );
      expect(custom.name).toBe("main.txt");
      expect(custom.path).toBe(join(stage, "main.txt"));
      expect(await readFile(custom.path, "utf8")).toBe("\\section{Method}");
      expect(
        await stageWebAttachment(
          attachment,
          providerDefinition("chatgpt"),
          stage,
        ),
      ).toBe(attachment);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("upgrades chatglm.cn custom entries with the dedicated site adapter", () => {
    const adapter = customProviderDefinition({
      id: "chatglm-cn",
      name: "chatglm.cn",
      template: "chatgpt-like",
      homeUrl: "https://chatglm.cn/",
      newConversationUrl: "https://chatglm.cn/",
      selectors: {
        composer: ["textarea", "[contenteditable='true']"],
        send: ["button[type='submit']"],
        stop: [],
        answers: ["article"],
        attachmentPreviews: [],
        attachmentUploading: [],
      },
    });

    expect(adapter.url).toBe("https://chatglm.cn/main/alltoolsdetail?lang=zh");
    expect(adapter.send[0]).toBe(".enter-icon-container");
    expect(adapter.send).toContain("div.enter");
    expect(adapter.answers[0]).toBe('[class*="assistant"] [class*="markdown"]');
    expect(adapter.answers).toContain(".markdown-body");
    expect(adapter.attachmentTrigger.length).toBeGreaterThan(0);
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

  it("pastes files into the composer with a guarded attachment-button fallback", () => {
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
    expect(source).toContain("adapter.attachmentTrigger?.length");
    expect(source).toContain("请求过于频繁");
    expect(source).toContain("rate limit");
    const agent = readFileSync(
      resolve(process.cwd(), "web-agent/agent.mjs"),
      "utf8",
    );
    expect(agent).toContain("allowClipboardFallback,");
    expect(agent).toContain('!["DeepSeek", "ChatGPT"].includes(adapter.name)');
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

  it("selects every Kimi material through one multiple-file input call", async () => {
    let menuOpen = false;
    const setInputFiles = vi.fn(async () => undefined);
    const input = {
      getAttribute: vi.fn(async () => ""),
      setInputFiles,
    };
    const trigger = {
      isVisible: vi.fn(async () => true),
      click: vi.fn(async () => {
        menuOpen = true;
      }),
    };
    const page = {
      locator: vi.fn((selector: string) => {
        const items =
          selector === ".toolkit-trigger-btn"
            ? [trigger]
            : menuOpen
              ? [input]
              : [];
        return {
          count: vi.fn(async () => items.length),
          nth: vi.fn((index: number) => items[index]),
        };
      }),
    };
    const attachments = [
      { path: "/tmp/main.txt" },
      { path: "/tmp/context.txt" },
      { path: "/tmp/toc.txt" },
    ];

    await expect(
      setWebAttachmentsAsBatch(
        page,
        {
          batchAttachmentTrigger: [".toolkit-trigger-btn"],
          batchAttachmentInput: [
            ".toolkit-popover input[type='file'][multiple]",
          ],
        },
        attachments,
      ),
    ).resolves.toBe(true);
    expect(trigger.click).toHaveBeenCalledTimes(1);
    expect(setInputFiles).toHaveBeenCalledTimes(1);
    expect(setInputFiles).toHaveBeenCalledWith([
      "/tmp/main.txt",
      "/tmp/context.txt",
      "/tmp/toc.txt",
    ]);
  });

  it("selects all ChatGLM materials through its existing multiple-file input", async () => {
    const setInputFiles = vi.fn(async () => undefined);
    const input = {
      getAttribute: vi.fn(async () => ""),
      setInputFiles,
    };
    const page = {
      locator: vi.fn(() => ({
        count: vi.fn(async () => 1),
        nth: vi.fn(() => input),
      })),
    };

    await expect(
      setWebAttachmentsAsBatch(
        page,
        { batchAttachmentInput: ["input[type='file'][multiple]"] },
        [
          { path: "/tmp/main.tex" },
          { path: "/tmp/context.txt" },
          { path: "/tmp/toc.txt" },
        ],
      ),
    ).resolves.toBe(true);
    expect(setInputFiles).toHaveBeenCalledTimes(1);
    expect(setInputFiles).toHaveBeenCalledWith([
      "/tmp/main.tex",
      "/tmp/context.txt",
      "/tmp/toc.txt",
    ]);
  });

  it("ignores a Kimi filename in the prompt until its file card appears", async () => {
    let previewVisible = false;
    const waitForTimeout = vi.fn(async () => {
      previewVisible = true;
    });
    const named = {
      count: vi.fn(async () => 1),
      nth: vi.fn(() => ({ isVisible: vi.fn(async () => true) })),
    };
    const previews = {
      count: vi.fn(async () => (previewVisible ? 1 : 0)),
      nth: vi.fn(() => ({
        isVisible: vi.fn(async () => true),
        innerText: vi.fn(async () => "main.txt\n等待解析"),
      })),
    };
    const page = {
      getByText: vi.fn(() => named),
      locator: vi.fn((selector: string) =>
        selector === "body"
          ? { innerText: vi.fn(async () => "Prompt 提到了 main.txt") }
          : previews,
      ),
      waitForTimeout,
    };

    await expect(
      waitForWebAttachmentAcceptance(
        page,
        {
          name: "Kimi",
          attachmentPreviews: [".file-card"],
          previewScopedAttachmentNames: true,
        },
        "main.txt",
        0,
      ),
    ).resolves.toBeUndefined();
    expect(waitForTimeout).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting when Kimi renders the parse status below the file name", () => {
    expect(
      attachmentTextStateFromBody(
        "e2e-context.txt\n等待解析\ne2e-toc.txt\nTXT 2 KB",
        "e2e-context.txt",
      ),
    ).toBe("uploading");
    expect(
      attachmentTextStateFromBody(
        "e2e-context.txt\nTXT 2 KB\ne2e-toc.txt\n等待解析",
        "e2e-context.txt",
      ),
    ).toBe("ready");
  });

  it("skips image-only file inputs when attaching a PDF", async () => {
    const imageInput = {
      getAttribute: vi.fn(async () => "image/*"),
      setInputFiles: vi.fn(async () => undefined),
    };
    const documentInput = {
      getAttribute: vi.fn(async () => ".pdf,.txt,.doc,.docx"),
      setInputFiles: vi.fn(async () => undefined),
    };
    const inputs = [imageInput, documentInput];
    const page = {
      locator: vi.fn(() => ({
        count: vi.fn(async () => inputs.length),
        nth: vi.fn((index: number) => inputs[index]),
      })),
    };

    await expect(
      setWebAttachmentInputFiles(page, "/tmp/paper.pdf"),
    ).resolves.toBe(true);
    expect(imageInput.setInputFiles).not.toHaveBeenCalled();
    expect(documentInput.setInputFiles).toHaveBeenCalledWith("/tmp/paper.pdf");
  });

  it("recognizes ChatGLM attachment cards that omit extensions or truncate names", () => {
    expect(attachmentPreviewMatchesName("main\nTEX 46.21KB", "main.tex")).toBe(
      true,
    );
    expect(
      attachmentPreviewMatchesName(
        "zai-web-context-178…\nTXT 92B",
        "zai-web-context-1787361234567-AbCdEf.txt",
      ),
    ).toBe(true);
    expect(
      attachmentPreviewMatchesName(
        "unrelated-file\nTXT 1KB",
        "zai-arxiv-toc-1787361234567-XyZ.txt",
      ),
    ).toBe(false);
  });

  it("derives the visible ChatGLM labels without relying on card CSS classes", () => {
    expect(attachmentVisibleNameCandidates("main.tex")).toEqual([
      { text: "main.tex", exact: true },
      { text: "main", exact: true },
    ]);
    expect(
      attachmentVisibleNameCandidates(
        "zai-web-context-1787361234567-AbCdEf.txt",
      ),
    ).toContainEqual({ text: "zai-web-context-1787", exact: false });
  });

  it("opens ChatGLM's attachment chooser when no compatible input exists", () => {
    const source = readFileSync(
      resolve(process.cwd(), "web-agent/attachments.mjs"),
      "utf8",
    );
    expect(source).toContain("adapter.attachmentTrigger");
    expect(source).toContain('.waitForEvent("filechooser"');
    expect(source).toContain("chooser.setFiles(attachment.path)");
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
    expect(source).toContain('composer.inputValue().catch(() => "")');
    expect(source).toContain(
      'element.hasAttribute("data-file-citation-group-identity")',
    );
    expect(source).toContain("hasCitationMarker");
    expect(source).toContain("data-testid*='file-citation'");
    expect(source).toContain(
      'const href = element.href || element.getAttribute("href") || "";',
    );
    expect(source).toContain(
      'const label = (element.textContent || "").trim() || href;',
    );
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
