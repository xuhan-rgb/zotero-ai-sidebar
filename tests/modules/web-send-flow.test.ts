import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chromeLaunchArguments } from "../../web-agent/browser-mode.mjs";
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
const taskEscapeHandler = sidebar.slice(
  sidebar.indexOf("function handleTaskEscape("),
  sidebar.indexOf("function viewChatTask("),
);
const agent = readFileSync(
  resolve(process.cwd(), "web-agent/agent.mjs"),
  "utf8",
);
const webAgentClient = readFileSync(
  resolve(process.cwd(), "src/modules/web-agent-client.ts"),
  "utf8",
);

describe("WEB send flow", () => {
  it("restores Z.ai tasks without rerouting them to domestic ChatGLM", () => {
    expect(
      webPromptProviderForUserMessage({ task: { webProvider: "zai" } }),
    ).toBe("zai");
    expect(
      webPromptProviderForUserMessage({ task: { title: "Z.ai Web" } }),
    ).toBe("zai");
    expect(
      webPromptProviderForUserMessage({ task: { title: "ChatGLM Web" } }),
    ).toBe("chatglm");
  });

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
    expect(sendWebPrompt).toContain("const sourceItemID = state.itemID");
    expect(sendWebPrompt).toContain("item:${sourceItemID}");
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

  it("reuses the single-selection annotation draft flow for WEB explain-selection", () => {
    expect(sidebar).toMatch(
      /explainSelection,\s*annotationBatch: fullTextHighlight,\s*taskTitle: label/,
    );
    expect(sendWebPrompt).toContain("explainSelection?: boolean");
    expect(sendWebPrompt).toMatch(
      /cloneSelectionAnnotationDraft\([\s\S]*?options\.retrySelectionSnapshot \?\?[\s\S]*?getStoredSelectionAnnotation\(sourceItemID\)/,
    );
    expect(sendWebPrompt).toContain(
      "selectionSnapshot = await rebuildWebSelectionAnnotationSnapshot(",
    );
    expect(sendWebPrompt).toContain("annotationSuggestion: options.explainSelection");
    expect(sendWebPrompt).toContain(
      "attachAnnotationDraft(target, selectionSnapshot, true)",
    );
    expect(sendWebPrompt).toContain(
      "options.annotationBatch || hasWebAnnotationProtocol(importedAnswer)",
    );
    expect(sendWebPrompt).toMatch(
      /if \(state\.activeConversationID === sourceConversationID\) \{\s*renderPanel\(mount, state\);/,
    );
  });

  it("preserves the chat position while saving a WEB annotation batch", () => {
    const saveBatch = sidebar.slice(
      sidebar.indexOf("async function saveWebAnnotationBatch("),
      sidebar.indexOf("function renderAnnotationSuggestionActions("),
    );
    expect(saveBatch).toContain("const scrollSnapshot = lockMessagesScroll(mount)");
    expect(saveBatch).toContain(
      "scheduleMessagesScrollRestore(mount, scrollSnapshot)",
    );
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
      webPromptProviderForUserMessage({ task: { webProvider: "chatglm" } }),
    ).toBe("chatglm");
    expect(
      webPromptProviderForUserMessage({
        task: { id: "1723-abc", title: "DeepSeek Web" },
      }),
    ).toBe("deepseek");
    expect(
      webPromptProviderForUserMessage({
        task: { id: "1723-abc", title: "Kimi Web" },
      }),
    ).toBe("kimi");
    // Normal API queue tasks use "task-" ids and must stay out of the Web flow.
    expect(
      webPromptProviderForUserMessage({
        task: { id: "task-9", title: "Kimi Web" },
      }),
    ).toBeNull();
    expect(webPromptProviderForUserMessage({ task: { id: "task-9" } })).toBeNull();
  });

  it("retries a Web answer through its original Web provider", () => {
    expect(sidebar).toContain(
      "const webProvider = webPromptProviderForUserMessage(userMessage);",
    );
    expect(sidebar).toMatch(
      /if \(webProvider\) \{[\s\S]*?await sendWebPromptMessage\([\s\S]*?webProvider,[\s\S]*?retrySelectionSnapshot:[\s\S]*?return;[\s\S]*?\}[\s\S]*?await streamAssistant/,
    );
  });

  it("resumes the original message once initial Web account setup completes", () => {
    expect(sidebar).toContain("renderWebAccountButton(doc, mount, state)");
    expect(sidebar).toContain("openWebAccount(provider, customProvider)");
    expect(sidebar).toContain("尚未配置");
    expect(sendWebPrompt).toContain(
      "getWebAccountStatus(provider, undefined, customProvider)",
    );
    expect(sendWebPrompt).toContain("if (!account.configured)");
    expect(sendWebPrompt).toContain("configureWebAccount(");
    expect(sendWebPrompt).toContain("void sendWebPromptMessage(");
    expect(sidebar).toContain("onConfigured?: () => void");
    expect(sidebar).toContain("onConfigured?.();");
    expect(agent).toContain(
      'request.method === "POST" && request.url === "/browser/open"',
    );
    expect(agent).toContain('request.url?.startsWith("/browser/status")');
    expect(agent).toContain("chromium.connectOverCDP(endpoint)");
    expect(
      chromeLaunchArguments({ profileDir: "/profile" }, "visible"),
    ).toContain("--remote-debugging-port=0");
    expect(agent).not.toContain("chromium.launchPersistentContext");
    expect(agent).toContain("async function accountReady(page, adapter, requiresLogin = false)");
    expect(agent).toContain("button[data-testid='login-button']");
    expect(agent).toContain("登录以获取");
  });

  it("returns a visible custom-site message before starting uploads", () => {
    const accountReady = agent.slice(
      agent.indexOf("async function accountReady("),
      agent.indexOf("const CHATGPT_REASONING_VALUES"),
    );
    expect(agent).toContain("async function blockingAccountDialogText(");
    expect(agent).toContain("async function composerOverlayText(");
    expect(agent).toContain("document.elementFromPoint(");
    expect(agent).toContain('["fixed", "absolute"].includes(style.position)');
    expect(agent).toMatch(/overlay = node;\s*break;/);
    expect(accountReady).toContain('adapter.template === "chatgpt-like"');
    expect(accountReady).toContain(
      "await blockingAccountDialogVisible(page, adapter)",
    );
    expect(agent).toContain("task.earlyPageNotice = blockingDialog");
    expect(agent).toMatch(
      /task\.pageNotice\s*=[\s\S]*?await throwForBlockingAccountDialog\(task\);[\s\S]*?let loginReported/,
    );
  });

  it("does not treat whole-page changes during upload as received messages", () => {
    const operationMonitor = agent.slice(
      agent.indexOf("async function runWithEarlyPageNotice("),
      agent.indexOf("async function throwForBlockingAccountDialog("),
    );
    expect(operationMonitor).toContain("await throwForBlockingAccountDialog(task)");
    expect(operationMonitor).not.toContain("visiblePageTextDelta(");
    expect(operationMonitor).not.toContain("nextOperationPageNoticeState(");
  });

  it("refreshes the page baseline after account setup and gates early body fallback", () => {
    const failedNotice = agent.slice(
      agent.indexOf("async function failedTaskPageNotice("),
      agent.indexOf("async function runWithEarlyPageNotice("),
    );
    expect(failedNotice).toContain("!task.submissionConfirmed");
    expect(agent).toMatch(
      /if \(task\.pageNotice\) \{[\s\S]*?task\.pageNotice\.baseline = await pageVisibleText\(page\);/,
    );
    expect(agent).toContain("task.submissionAttempted = true");
    expect(agent).toContain("task.submissionConfirmed = true");
  });

  it("uses the semantic Kimi send icon for custom webpages without clicking a disabled control", () => {
    expect(agent).toContain("async function sendControl(page, adapter)");
    expect(agent).toContain("svg[name='Send']");
    expect(agent).toContain('adapter.template === "chatgpt-like"');
    expect(agent).toContain("await sendControlDisabled(send)");
  });

  it("paints Web snapshots incrementally in the existing assistant bubble", () => {
    expect(sendWebPrompt).toContain("advanceWebProgressText");
    expect(sendWebPrompt).toContain(
      "updateMessageBubble(mount, index, target)",
    );
    expect(sendWebPrompt).toContain("schedule(flush, 35)");
    expect(sendWebPrompt).toContain("cancelWebProgress();");
    expect(sidebar).toMatch(
      /root\.classList\.toggle\(\s*"bubble-web-page-notice",\s*message\.webPageNotice === true,?\s*\)/,
    );
    const onImport = sendWebPrompt.slice(sendWebPrompt.indexOf("onImport:"));
    expect(onImport.indexOf("renderPanel(mount, state)")).toBeLessThan(
      onImport.indexOf("await persistPanelConversations(state)"),
    );
    expect(sendWebPrompt).toContain(
      "const importedAnswer = describeUnavailableGeneratedFiles(result.answer);",
    );
    expect(agent).toContain("let pollDelay = 350;");
    expect(agent).toContain("await page.waitForTimeout(pollDelay);");
    expect(sidebar).toContain(
      'if (message.role === "assistant") {\n    renderMessageImages(doc, root, message.images, placedCharts);',
    );
  });

  it("clears the Web busy state and repaints the composer on completion", () => {
    const onImport = sendWebPrompt.slice(sendWebPrompt.indexOf("onImport:"));
    expect(onImport).toContain("delete target.task.webStatus");
    expect(onImport).toContain("delete sourceUserMessage.task.webStatus");
    expect(onImport.indexOf("renderPanel(mount, state);")).toBeLessThan(
      onImport.indexOf("await persistPanelConversations(state)"),
    );
  });

  it("keeps abnormal webpage content out of the normal answer pipeline", () => {
    expect(sendWebPrompt).toContain("if (result.pageNotice)");
    expect(sendWebPrompt).toContain("target.webPageNotice = true");
    expect(sendWebPrompt).toContain("网页未返回正常回答");
    expect(sendWebPrompt).toContain(
      '请点击底部“账号”检查登录状态、浏览器显示方式或网页配置后重试。',
    );
    expect(sendWebPrompt).toMatch(
      /if \(result\.pageNotice\)[\s\S]*?else if \([\s\S]*?options\.annotationBatch/,
    );
  });

  it("returns an independently received page notice when WEB automation fails", () => {
    expect(agent).toContain("async function failedTaskPageNotice(task)");
    expect(agent).toContain("const pageNotice = task.cancelled");
    expect(agent).toContain('? "completed"');
    expect(agent).toContain("pageNotice: true");
    expect(agent).toContain("task.normalAnswerObserved");
    expect(agent).toContain("async function runWithEarlyPageNotice(");
    expect(agent).toContain("await throwForBlockingAccountDialog(task)");
    expect(agent).toContain("await runWithEarlyPageNotice(task, async () => {");
  });

  it("confirms ChatGPT submission and uses only one submit action per task", () => {
    expect(agent).toContain(
      "async function submitPrompt(page, composer, adapter, previousAnswerCount, task)",
    );
    expect(agent).toContain("send.click({ force: true })");
    expect(agent).toContain('await composer.press("Enter")');
    expect(agent).not.toContain("await send.evaluate((button)");
    expect(agent).toContain("knownTaskIDs.has(task.id)");
    expect(agent).toContain("未再次提交以避免重复发送");
    expect(agent).toContain(
      "await submitPrompt(page, composer, adapter, previousAnswerCount, task)",
    );
    expect(agent).toContain(
      "async function promptSubmissionStarted(",
    );
    expect(agent).toContain("previousAnswerCount,");
    expect(agent).toContain("previousCompletionCount,");
    expect(agent).toContain("answerCount > previousAnswerCount");
    expect(agent).toContain("send.isEnabled()");
    expect(agent).toContain("await page.waitForTimeout(100);");
    expect(agent).toContain("if (isRecoverablePageReadError(error)) return false;");
    expect(agent).toContain("button.click({ force: true, timeout: 3_000 })");
    expect(agent).toContain("const copiedAnswer = result.answer");
  });

  it("starts all Web attachment pastes before waiting for uploads", () => {
    expect(agent).toContain("waitForUpload: false");
    expect(agent).toContain("waitForWebAttachments(page, adapter, attachments)");
  });

  it("selects all Kimi attachments together with a guarded serial fallback", () => {
    expect(agent).toContain("setWebAttachmentsAsBatch(");
    expect(agent).toContain("if (!uploadedAsBatch)");
    expect(agent).toContain("adapter.waitForAttachmentAcceptance");
    expect(agent).toContain(
      "adapter.waitForAttachmentAcceptance === true",
    );
    expect(agent).toContain("waitForWebAttachments(page, adapter, attachments)");
    expect(agent).not.toContain("adapter.bundleTextAttachments");
  });

  it("tries one ChatGLM multi-file selection before its serial fallback", () => {
    expect(agent).toContain("if (adapter.batchAttachmentInput?.length)");
    expect(agent).toContain("if (adapter.serialAttachments)");
    expect(agent).toContain("waitForUpload: true");
  });

  it("can cancel a stuck WEB upload without restarting Zotero", () => {
    expect(agent).toContain('request.url === "/tasks/cancel"');
    expect(agent).toContain("await cancelTask(");
    expect(agent).toContain('callback(task, "cancelled"');
    expect(agent).toContain("await task.page.close(");
    expect(webAgentClient).toContain("export async function cancelWebAgentTask(");
    expect(webAgentClient).toContain('`http://127.0.0.1:${config.port}/tasks/cancel`');
    expect(sidebar).toMatch(/const webPromptStopping\s*=\s*webPromptBusy/);
    expect(sidebar).toContain("cancelPendingWebPromptTask(mount, state)");
    const cancelWeb = sidebar.slice(
      sidebar.indexOf("async function cancelPendingWebPromptTask("),
      sidebar.indexOf("async function sendWebPromptMessage("),
    );
    expect(cancelWeb.indexOf("renderPanel(mount, state);")).toBeLessThan(
      cancelWeb.indexOf("void persistPanelConversations(state)"),
    );
    expect(sendWebPrompt).toContain("if (target?.task?.cancelledAt)");
    expect(sendWebPrompt).toContain("cancelWebProgress();");
  });

  it("routes Escape through the same WEB cancellation path", () => {
    expect(taskEscapeHandler).toContain("webPromptTaskPending(state)");
    expect(taskEscapeHandler).toContain(
      "void cancelPendingWebPromptTask(mount, state)",
    );
    expect(taskEscapeHandler).toContain("event.preventDefault()");
    expect(taskEscapeHandler).toContain("event.stopPropagation()");
  });

  it("allows bounded DeepSeek submit retries without retrying other providers", () => {
    expect(agent).toContain('const attempts = adapter.name === "DeepSeek" ? 3 : 1');
    expect(agent).toContain("attempt + 1 < attempts");
    expect(agent).toContain("未再次提交以避免重复发送");
  });

  it("locks Web submission before asynchronous preparation can duplicate bubbles", () => {
    expect(sendWebPrompt).toContain("webPromptTaskPending(state)");
    expect(sendWebPrompt).toContain("state.webPromptBusy = true");
    expect(sendWebPrompt).toContain("state.webPromptBusyTaskID = taskID");
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
      "const importedAnswer = describeUnavailableGeneratedFiles(result.answer)",
    );
    expect(sidebar).toContain("describeUnavailableGeneratedFiles,");
  });

  it("reuses one Web page per paper and resets material when switching keys", () => {
    expect(agent).toContain("const sessionSlot = task.sessionKey");
    expect(agent).toContain("session.sessionKey !== task.sessionKey");
    expect(agent).toContain("session.materialUploaded = false");
  });
});
