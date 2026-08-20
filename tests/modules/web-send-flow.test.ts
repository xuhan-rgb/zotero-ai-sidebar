import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateLegacyDeepSeekMessages } from "../../src/modules/web-history-migration";
import {
  webPromptProviderForUserMessage,
  webPromptTaskPending,
} from "../../src/modules/web-prompt-runtime";

const sidebar = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);
const sendWebPrompt = sidebar.slice(
  sidebar.indexOf("async function sendWebPromptMessage("),
  sidebar.indexOf("function webPromptStatusMessage("),
);
const agent = readFileSync(
  resolve(process.cwd(), "web-agent/agent.mjs"),
  "utf8",
);
const browserMode = readFileSync(
  resolve(process.cwd(), "web-agent/browser-mode.mjs"),
  "utf8",
);

describe("WEB send flow", () => {
  it("migrates old DeepSeek reasoning out of the visible answer", () => {
    const messages = [
      {
        role: "user" as const,
        content: "整理论文",
        task: {
          id: "legacy-web",
          kind: "general" as const,
          title: "DeepSeek Web",
          promptPreview: "整理论文",
          createdAt: 1,
        },
      },
      {
        role: "assistant" as const,
        content:
          "用户要求我整理论文。我们需要根据回答要求组织内容。策略：先读取材料并提取要点。最终回答需要清晰。我们需要检查标题、作者、方法和实验结果，并确保最终回答不要复述思考过程。用户问题比较宽泛，因此需要先判断回答范围，再整理结构化内容。\n# ## 论文整理\n\nTEST_FINAL_OK",
        task: {
          id: "legacy-web",
          kind: "general" as const,
          title: "等待网页回答",
          promptPreview: "整理论文",
          createdAt: 1,
        },
      },
    ];
    expect(migrateLegacyDeepSeekMessages(messages)).toBe(true);
    expect(messages[1]).toMatchObject({
      thinking: expect.stringContaining("用户要求我整理论文"),
      content: "## 论文整理\n\nTEST_FINAL_OK",
    });
  });

  it("guards restored panels against legacy reasoning-only Web answers", () => {
    expect(sidebar).toContain("migrateLegacyDeepSeekMessages(state.messages)");
    expect(sidebar).toContain(
      "old reasoning trace can never be painted as the answer body",
    );
  });

  it("normalizes duplicate headings in an already migrated Web answer", () => {
    const messages = [
      {
        role: "user" as const,
        content: "整理论文",
        task: {
          id: "migrated-web",
          kind: "general" as const,
          title: "DeepSeek Web",
          promptPreview: "整理论文",
          createdAt: 1,
        },
      },
      {
        role: "assistant" as const,
        content: "## 标题\n\n## ## 二级标题",
        thinking: "旧思考",
        task: {
          id: "migrated-web",
          kind: "general" as const,
          title: "等待网页回答",
          promptPreview: "整理论文",
          createdAt: 1,
        },
      },
    ];
    expect(migrateLegacyDeepSeekMessages(messages)).toBe(true);
    expect(messages[1].content).toBe("## 标题\n\n## 二级标题");
  });

  it("clears the Zotero draft without allowing the old DOM to restore it", () => {
    expect(sendWebPrompt).toMatch(
      /state\.draftText = "";\s*state\.draftSelectionStart = 0;\s*state\.draftSelectionEnd = 0;[\s\S]*?state\.skipNextDraftCapture = true;[\s\S]*?renderPanel\(mount, state\)/,
    );
  });

  it("sends a stable paper-scoped web conversation key and a no-attachment follow-up prompt", () => {
    expect(sendWebPrompt).toContain("const webConversationKey =");
    expect(sendWebPrompt).toContain("const paperSessionKey =");
    expect(sendWebPrompt).toContain("item:${state.itemID}");
    expect(sendWebPrompt).not.toContain(
      '`${state.itemID ?? "global"}:${sourceConversationID}:${provider}`',
    );
    expect(sendWebPrompt).toContain("continuationPrompt");
    expect(sendWebPrompt).toContain("sessionKey: webConversationKey");
    expect(sendWebPrompt).toContain(
      "const continuationPrompt = buildWebPrompt({",
    );
    expect(sendWebPrompt).toContain("history,");
    expect(sendWebPrompt).toContain(
      "attachmentAlreadyAvailable: !!material.attachment",
    );
    expect(sendWebPrompt).not.toContain("deepseekOptions:");
  });

  it("never changes DeepSeek mode or option toggles before submitting", () => {
    expect(agent).not.toContain("ensureDeepSeekOptions");
    expect(agent).not.toContain("setDeepSeekToggle");
    expect(agent).not.toContain("deepseekOptionsKey");
    expect(agent).not.toContain("DEEPSEEK_MODE_LABELS");
    expect(agent).not.toContain("await mode.click()");
    expect(agent).not.toContain('hasText: "深度思考"');
    expect(agent).not.toContain('hasText: "智能搜索"');
  });

  it("keeps legacy DeepSeek expert tasks safe without exposing a mode selector", () => {
    expect(sidebar).not.toContain("composer-deepseek-mode-select");
    expect(sidebar).not.toContain("专家（不支持论文附件）");
    expect(agent).not.toContain("validateDeepSeekOptions");
  });

  it("keeps Web tasks out of the normal API streaming queue", () => {
    expect(sendWebPrompt).toContain("webProvider: provider");
    expect(sidebar).toContain("isWebPromptUserMessage(message)");
    expect(sidebar).toContain(
      "Web tasks are dispatched directly to the Web Agent",
    );
    // Web detection was extracted to web-prompt-runtime; assert its behavior.
    expect(
      webPromptProviderForUserMessage({ task: { webProvider: "chatgpt" } }),
    ).toBe("chatgpt");
    expect(
      webPromptProviderForUserMessage({
        task: { id: "1723-abc", title: "DeepSeek Web" },
      }),
    ).toBe("deepseek");
    expect(
      webPromptProviderForUserMessage({
        task: { id: "1723-abc", title: "Kimi Web" },
      }),
    ).toBe("custom:legacy");
    // Normal API queue tasks use "task-" ids and must stay out of the Web flow.
    expect(
      webPromptProviderForUserMessage({
        task: { id: "task-9", title: "Kimi Web" },
      }),
    ).toBeNull();
    expect(webPromptProviderForUserMessage({ task: { id: "task-9" } })).toBeNull();
  });

  it("requires a manually configured Web account before sending", () => {
    expect(sidebar).toContain("renderWebAccountButton(doc, mount, state)");
    expect(sidebar).toContain("openWebAccount(provider, customProvider)");
    expect(sidebar).toContain("尚未配置");
    expect(sidebar).toContain("state.webAccountConfigured === true");
    expect(agent).toContain(
      'request.method === "POST" && request.url === "/browser/open"',
    );
    expect(agent).toContain('request.url?.startsWith("/browser/status")');
    expect(agent).toContain("chromium.connectOverCDP(endpoint)");
    expect(browserMode).toContain(
      "--remote-debugging-port=${config.cdpPort || 9224}",
    );
    expect(agent).toContain("let port = Number(config.cdpPort) || 9224");
    expect(agent).not.toContain("chromium.launchPersistentContext");
    expect(agent).toContain("async function accountReady(page, adapter)");
    expect(agent).toContain("button[data-testid='login-button']");
    expect(agent).toContain("登录以获取");
  });

  it("paints Web snapshots incrementally in the existing assistant bubble", () => {
    expect(sendWebPrompt).toContain("advanceWebProgressText");
    expect(sendWebPrompt).toContain(
      "updateMessageBubble(mount, index, target)",
    );
    expect(sendWebPrompt).toContain("schedule(flush, 35)");
    expect(sendWebPrompt).toContain("cancelWebProgress();");
    expect(sendWebPrompt).toContain(
      "target.content = describeUnavailableGeneratedFiles(result.answer);",
    );
    expect(agent).toContain("await page.waitForTimeout(350);");
    expect(sidebar).toContain(
      'if (message.role === "assistant") {\n    renderMessageImages(doc, root, message.images, placedCharts);',
    );
  });

  it("confirms ChatGPT submission and uses only one submit action per task", () => {
    expect(agent).toContain(
      "async function submitPrompt(page, composer, adapter, previousAnswerCount)",
    );
    expect(agent).toContain("send.click({ force: true })");
    expect(agent).toContain('await composer.press("Enter")');
    expect(agent).not.toContain("await send.evaluate((button)");
    expect(agent).toContain("knownTaskIDs.has(task.id)");
    expect(agent).toContain("未再次提交以避免重复发送");
    expect(agent).toContain(
      "await submitPrompt(page, composer, adapter, previousAnswerCount)",
    );
    expect(agent).toContain(
      "async function promptSubmissionStarted(",
    );
    expect(agent).toContain("previousAnswerCount,");
    expect(agent).toContain("answerCount > previousAnswerCount");
    expect(agent).toContain("send.isEnabled()");
    expect(agent).toContain("button.click({ force: true, timeout: 3_000 })");
    expect(agent).toContain("const copiedAnswer = result.answer");
  });

  it("starts all Web attachment pastes before waiting for uploads", () => {
    expect(agent).toContain("waitForUpload: false");
    expect(agent).toContain("waitForWebAttachments(page, adapter, attachments)");
  });

  it("allows bounded DeepSeek submit retries without retrying other providers", () => {
    expect(agent).toContain('const attempts = adapter.name === "DeepSeek" ? 3 : 1');
    expect(agent).toContain("attempt + 1 < attempts");
    expect(agent).toContain("未再次提交以避免重复发送");
  });

  it("locks Web submission before asynchronous preparation can duplicate bubbles", () => {
    expect(sendWebPrompt).toContain("webPromptTaskPending(state)");
    expect(sendWebPrompt).toContain("state.webPromptBusy = true");
    expect(sendWebPrompt).toContain("releaseWebPromptLock();");
    expect(sidebar).toContain("const webPromptBusy = webPromptTarget");
    // Pending detection was extracted to web-prompt-runtime; assert behavior.
    expect(webPromptTaskPending({ webPromptBusy: true, messages: [] })).toBe(true);
    expect(
      webPromptTaskPending({
        messages: [{ task: { id: "1723-abc", title: "ChatGPT Web" } }],
      }),
    ).toBe(true);
    expect(
      webPromptTaskPending({
        messages: [
          { task: { id: "1723-abc", title: "ChatGPT Web", completedAt: 2 } },
        ],
      }),
    ).toBe(false);
  });

  it("restores the text prompt after file pastes", () => {
    expect(agent).toContain("await restoreComposerPrompt(composer, submissionPrompt)");
    expect(agent).toContain("const text = await composerText(composer)");
    expect(agent).toContain("if (!text.trim())");
  });

  it("changes ChatGPT reasoning strength in the existing Web session", () => {
    expect(sendWebPrompt).toContain("chatgptOptions:");
    expect(sendWebPrompt).toContain("state.localUiSettings.chatgptWeb");
    expect(agent).toContain(
      "ensureChatGPTOptions(page, session, task.chatgptOptions)",
    );
    expect(agent).toContain("session.chatgptOptionsKey");
    expect(agent).toContain("data-model-reasoning-effort-slider");
    expect(agent).toContain("session.materialUploaded = false");
  });

  it("reuses a provider page and uploads paper material once per session", () => {
    expect(agent).toContain("const sessions = new Map()");
    expect(agent).toContain("sessions.get(sessionSlot)");
    expect(agent).toContain("session.materialUploaded");
    expect(agent).toContain("task.continuationPrompt");
  });

  it("does not click generic chart download controls", () => {
    expect(agent).toContain('"button, [role=\'button\'], a[download]"');
    expect(agent).toContain("const label = await controlLabel(button)");
    expect(agent).toContain("const fileNameLabel = isDownloadableFileName(label)");
    expect(agent).toContain("if (!fileNameLabel) continue");
    expect(agent).not.toContain("function isDownloadActionLabel(value)");
    expect(agent).not.toContain("!fileNameLabel && !isDownloadActionLabel(label)");
    expect(agent).toContain("inlineLabel: label");
    expect(agent).toContain("async function controlLabel(control)");
    // File tiles can still be numerous, so the work per answer stays bounded.
    expect(agent).toContain("const maxDownloads = 4");
    expect(agent).toContain("if (attempts >= maxDownloads) break");
  });

  it("syncs only rendered charts, never toolbar icons", () => {
    expect(agent).toContain(
      "button, [role='button'], a, [role='tab'], [role='tablist'], [role='toolbar']",
    );
    expect(agent).toContain("if (box.width < 160 || box.height < 120) return \"\"");
    expect(agent).toContain('element.querySelector("text, tspan")');
    expect(agent).toContain("[clone, ...clone.querySelectorAll(\"*\")]");
    expect(agent).toContain("`${adapter.name} 图表 ${images.length + 1}.svg`");
  });

  it("degrades unusable sandbox file paths before storing a Web answer", () => {
    expect(sidebar).toContain(
      "target.content = describeUnavailableGeneratedFiles(result.answer)",
    );
    expect(sidebar).toContain("describeUnavailableGeneratedFiles,");
  });

  it("reuses one Web page per paper and resets material when switching keys", () => {
    expect(agent).toContain("const sessionSlot = task.sessionKey");
    expect(agent).toContain("session.sessionKey !== task.sessionKey");
    expect(agent).toContain("session.materialUploaded = false");
  });
});
