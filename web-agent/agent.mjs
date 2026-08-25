import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { unlink } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

import {
  firstPopulatedLocator,
  firstResponseLocator,
  providerDefinition,
  selectorList,
} from "./adapters.mjs";
import {
  pasteWebAttachment,
  stageWebAttachment,
  validateWebAttachment,
  waitForWebAttachments,
} from "./attachments.mjs";
import {
  answerNodeRange,
  inPlaceStillBaseline,
  isRecoverablePageReadError,
  nextAnswerPollDelay,
  nextAnswerWaitState,
  nextPageNoticeWaitState,
  visiblePageTextDelta,
} from "./answer-wait.mjs";
import { showBrowserWindow } from "./window-visibility.mjs";
import {
  browserModeFromVersion,
  chromeLaunchArguments,
} from "./browser-mode.mjs";

const configPath = process.argv[2];
if (!configPath) throw new Error("Web Agent config path is required");
const config = JSON.parse(await readFile(configPath, "utf8"));
const PROTOCOL_VERSION = 7;
const queues = new Map();
const active = new Map();
const activeTasks = new Map();
const knownTaskIDs = new Set();
const sessions = new Map();
let context;
let cdpBrowser;
let contextConnecting;
let browserLaunching;
let browserTransition;
let browserMode;
let accountWindowVisible = false;
const visibleTaskIDs = new Set();

const server = http.createServer(async (request, response) => {
  try {
    if (!authorized(request))
      return json(response, 401, { error: "unauthorized" });
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, {
        ok: true,
        version: "0.1.0",
        protocolVersion: PROTOCOL_VERSION,
        active: Object.fromEntries(active),
        sessions: sessions.size,
        queued: Object.fromEntries(
          [...queues].map(([provider, tasks]) => [provider, tasks.length]),
        ),
        browserConnected: !!context,
        browserMode: await currentBrowserMode(),
      });
    }
    if (request.method === "POST" && request.url === "/browser/open") {
      const value = await requestBody(request);
      const provider = value?.provider;
      const status = await openDedicatedBrowser(
        provider,
        value?.customProvider,
      );
      return json(response, 200, status);
    }
    if (request.method === "POST" && request.url === "/browser/hide") {
      const value = await requestBody(request);
      const provider = value?.provider;
      const status = await hideDedicatedBrowser(
        provider,
        value?.customProvider,
      );
      return json(response, 200, status);
    }
    if (
      request.method === "GET" &&
      request.url?.startsWith("/browser/status")
    ) {
      const url = new URL(request.url, "http://127.0.0.1");
      const provider = url.searchParams.get("provider");
      const customProvider = url.searchParams.get("customProvider");
      return json(
        response,
        200,
        await browserAccountStatus(
          provider,
          customProvider ? JSON.parse(customProvider) : undefined,
        ),
      );
    }
    if (request.method === "POST" && request.url === "/tasks") {
      const task = await validateTask(await requestBody(request));
      if (knownTaskIDs.has(task.id)) {
        return json(response, 202, { ok: true, id: task.id, duplicate: true });
      }
      knownTaskIDs.add(task.id);
      queueFor(task.provider).push(task);
      void runNext(task.provider);
      return json(response, 202, { ok: true, id: task.id });
    }
    if (request.method === "POST" && request.url === "/tasks/cancel") {
      const value = await requestBody(request);
      const id = typeof value?.id === "string" ? value.id : "";
      if (!id) return json(response, 400, { error: "task id is required" });
      return json(response, 200, await cancelTask(id));
    }
    return json(response, 404, { error: "not_found" });
  } catch (error) {
    return json(response, 400, { error: errorMessage(error) });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`[web-agent] listening on 127.0.0.1:${config.port}`);
});

const hiddenWindowWatchdog = setInterval(() => {
  void enforceHiddenWindowPolicy();
}, 1_000);
hiddenWindowWatchdog.unref();
void enforceHiddenWindowPolicy();

async function runNext(provider) {
  if (active.has(provider)) return;
  const task = queueFor(provider).shift();
  if (!task) return;
  active.set(provider, task.id);
  activeTasks.set(task.id, task);
  if (!task.hideBrowser) visibleTaskIDs.add(task.id);
  try {
    await runTask(task);
  } catch (error) {
    // The failed-state callback can itself fail (e.g. Zotero was closed).
    // Letting it throw here would surface as an unhandled rejection and kill
    // the agent process, taking every queued task in other providers with it.
    const pageNotice = task.cancelled ? "" : await failedTaskPageNotice(task);
    const state = task.cancelled
      ? "cancelled"
      : pageNotice
        ? "completed"
        : "failed";
    const extra = task.cancelled
      ? {}
      : pageNotice
        ? { answer: pageNotice, reasoning: "", pageNotice: true }
        : { error: errorMessage(error) };
    await callback(task, state, extra).catch((callbackError) =>
        console.warn(
          `[web-agent] failed-state callback undeliverable for ${task.id}: ${errorMessage(callbackError)}`,
        ),
    );
  } finally {
    if (task.attachmentStageDir) {
      await rm(task.attachmentStageDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    visibleTaskIDs.delete(task.id);
    active.delete(provider);
    activeTasks.delete(task.id);
    knownTaskIDs.delete(task.id);
    void runNext(provider);
  }
}

async function failedTaskPageNotice(task) {
  if (task.earlyPageNotice) return task.earlyPageNotice;
  const page = task.page;
  if (
    !task.pageNotice ||
    !page ||
    page.isClosed() ||
    !task.submissionConfirmed ||
    task.normalAnswerObserved ||
    !task.adapter?.pageNoticeFallback
  ) {
    return "";
  }
  return visiblePageTextDelta(
    task.pageNotice.baseline,
    await pageVisibleText(page),
    task.pageNotice.exclusions,
  );
}

async function runWithEarlyPageNotice(task, operation) {
  if (!task.pageNotice || !task.adapter?.pageNoticeFallback) {
    return operation();
  }
  let operationFinished = false;
  const operationPromise = Promise.resolve()
    .then(operation)
    .finally(() => {
      operationFinished = true;
    });
  const noticePromise = (async () => {
    while (!operationFinished && !task.cancelled) {
      await throwForBlockingAccountDialog(task);
      await task.page.waitForTimeout(350);
    }
    return undefined;
  })();
  try {
    return await Promise.race([operationPromise, noticePromise]);
  } finally {
    operationFinished = true;
  }
}

async function throwForBlockingAccountDialog(task) {
  if (task.adapter?.template !== "chatgpt-like" || task.normalAnswerObserved) {
    return;
  }
  const blockingDialog = await blockingAccountDialogText(
    task.page,
    task.adapter,
  );
  if (!blockingDialog) return;
  task.earlyPageNotice = blockingDialog;
  await task.page.close({ runBeforeUnload: false }).catch(() => undefined);
  throw new Error(`${task.adapter.name} 网页需要人工处理后才能继续`);
}

async function runTask(task) {
  throwIfTaskCancelled(task);
  const adapter = providerDefinition(task.provider, task.customProvider);
  task.adapter = adapter;
  await callback(task, "starting_browser");
  await ensureDedicatedBrowserMode(task.hideBrowser ? "headless" : "visible");
  const browserContext = await ensureContext();
  const session = await webSession(browserContext, task, adapter);
  const page = session.page;
  task.page = page;
  throwIfTaskCancelled(task);
  await applyTaskWindowPolicy(page, task);
  task.pageNotice = adapter.pageNoticeFallback
    ? {
        baseline: await pageVisibleText(page),
        exclusions: [
          task.prompt,
          task.continuationPrompt,
          task.attachment?.name,
          task.contextAttachment?.name,
          task.tocAttachment?.name,
        ].filter(Boolean),
      }
    : null;

  await throwForBlockingAccountDialog(task);

  let loginReported = false;
  const loginDeadline = Date.now() + 30 * 60_000;
  while (Date.now() < loginDeadline) {
    await throwForBlockingAccountDialog(task);
    if (await accountReady(page, adapter)) break;
    if (!loginReported) {
      await callback(task, "needs_login");
      loginReported = true;
    }
    await page.waitForTimeout(1_000);
    throwIfTaskCancelled(task);
  }
  if (!(await accountReady(page, adapter))) {
    throw new Error(
      `${adapter.name} login was not completed within 30 minutes`,
    );
  }
  if (task.provider === "chatgpt") {
    await ensureChatGPTOptions(page, session, task.chatgptOptions);
  }
  if (task.pageNotice) {
    task.pageNotice.baseline = await pageVisibleText(page);
  }

  const answers = await firstPopulatedLocator(page, adapter.answers);
  const previousAnswerCount = await answers.count();
  const responses = await firstResponseLocator(page, adapter);
  const previousResponseCount = await responses.count();
  const previousResponseBaseline =
    adapter.responseRoots?.length && previousResponseCount > 0
      ? await snapshotResponseSlice(
          [responses.nth(previousResponseCount - 1)],
          adapter,
          0,
          1,
        )
      : undefined;
  const previousCopyCount = adapter.copy
    ? await page.locator(selectorList(adapter.copy)).count()
    : 0;
  const previousCompletionCount = adapter.completion
    ? await completionLocator(page, adapter).count()
    : 0;
  const composer = page
    .locator(selectorList(adapter.composer))
    .filter({ visible: true })
    .first();
  const uploadMaterial = !!task.attachment && !session.materialUploaded;
  const submissionPrompt = uploadMaterial
    ? task.prompt
    : task.continuationPrompt;
  await composer.fill(submissionPrompt);
  const sourceAttachments = [
    ...(uploadMaterial && task.attachment ? [task.attachment] : []),
    ...(task.contextAttachment ? [task.contextAttachment] : []),
    ...(task.tocAttachment ? [task.tocAttachment] : []),
  ];
  const attachments = await stageTaskAttachments(
    task,
    adapter,
    sourceAttachments,
  );
  if (attachments.length) {
    await callback(task, "uploading_attachment");
    await runWithEarlyPageNotice(task, async () => {
      const allowClipboardFallback =
        !task.hideBrowser || !["DeepSeek", "ChatGPT"].includes(adapter.name);
      if (adapter.serialAttachments) {
        for (const attachment of attachments) {
          await pasteWebAttachment(page, composer, adapter, attachment, {
            waitForUpload: true,
            allowClipboardFallback,
          });
        }
      } else {
        // Clipboard writes themselves stay sequential to avoid replacing one
        // file URI with another. The expensive upload/processing waits run in
        // parallel after all file pastes have been initiated.
        for (const attachment of attachments) {
          await pasteWebAttachment(page, composer, adapter, attachment, {
            waitForUpload: false,
            allowClipboardFallback,
          });
        }
        await waitForWebAttachments(page, adapter, attachments);
      }
    });
    if (uploadMaterial) session.materialUploaded = true;
  }
  // Pasting a file into a ChatGPT-like editor can replace its text selection.
  // Restore the complete prompt after the last attachment so a task is never
  // submitted with only a PDF/TXT tile and no user question.
  await restoreComposerPrompt(composer, submissionPrompt);
  await callback(task, "submitting");
  task.submissionAttempted = true;
  await submitPrompt(page, composer, adapter, previousAnswerCount, task);
  task.submissionConfirmed = true;

  await callback(task, "generating");
  const result = await waitForAnswer(
    page,
    adapter,
    previousAnswerCount,
    previousResponseCount,
    previousResponseBaseline,
    previousCopyCount,
    previousCompletionCount,
    task,
    task.pageNotice,
  );
  await callback(task, "processing_answer");
  const copiedAnswer = result.answer
    ? ""
    : await copyLatestAnswer(page, adapter, previousAnswerCount);
  if (copiedAnswer) result.answer = copiedAnswer;
  // Sync charts first: it marks each accepted SVG in the page, so converting
  // the answer again turns those marks into placeholders the sidebar can paint
  // in place. Download links are appended afterwards and must survive.
  const renderedImages = await extractRenderedSvgImages(
    page,
    adapter,
    previousAnswerCount,
  );
  if (renderedImages.length) {
    result.images = renderedImages;
    const replaced = await answerMarkdownSnapshot(
      page,
      adapter,
      previousAnswerCount,
    );
    if (replaced) result.answer = replaced;
  }
  result.answer = await materializeAnswerDownloads(
    page,
    adapter,
    previousAnswerCount,
    result.answer,
  );
  await callback(task, "completed", result);
}

async function stageTaskAttachments(task, adapter, attachments) {
  if (
    !adapter.latexUploadExtension ||
    !attachments.some((attachment) => attachment.kind === "latex")
  ) {
    return attachments;
  }
  task.attachmentStageDir = await mkdtemp(
    `${config.profileDir}/zai-web-upload-`,
  );
  return Promise.all(
    attachments.map((attachment) =>
      stageWebAttachment(attachment, adapter, task.attachmentStageDir),
    ),
  );
}

async function cancelTask(id) {
  for (const [provider, tasks] of queues) {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) continue;
    const [task] = tasks.splice(index, 1);
    task.cancelled = true;
    knownTaskIDs.delete(id);
    await callback(task, "cancelled").catch(() => undefined);
    if (!tasks.length) queues.delete(provider);
    return { ok: true, id, state: "queued" };
  }
  const task = activeTasks.get(id);
  if (!task) return { ok: true, id, state: "not_found" };
  task.cancelled = true;
  if (task.page && !task.page.isClosed()) {
    await task.page.close({ runBeforeUnload: false }).catch(() => undefined);
  }
  return { ok: true, id, state: "active" };
}

function throwIfTaskCancelled(task) {
  if (task.cancelled) throw new Error("WEB task cancelled");
}

async function restoreComposerPrompt(composer, prompt) {
  await composer.fill(prompt);
  const text = await composerText(composer);
  if (!text.trim()) {
    throw new Error("网页输入框未保留 Prompt，已停止提交以避免只发送附件");
  }
}

async function submitPrompt(page, composer, adapter, previousAnswerCount, task) {
  await waitForSendButton(page, adapter);
  // Re-locate after the upload settles. DeepSeek replaces the submit node
  // while processing an attachment, so a locator created before the wait may
  // point at the pre-upload control state.
  const send = await sendControl(page, adapter);
  const attempts = adapter.name === "DeepSeek" ? 3 : 1;
  let submitMethod = "button";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await send.click({ force: true });
    } catch {
      // The page can briefly place an overlay over the button after an
      // attachment finishes. Enter remains the provider-supported fallback.
      submitMethod = "enter";
      await composer.press("Enter");
    }
    if (
      await promptSubmissionStarted(
        page,
        composer,
        adapter,
        previousAnswerCount,
        task,
      )
    )
      return;
    if (attempt + 1 < attempts) {
      await page.waitForTimeout(800);
      await waitForSendButton(page, adapter);
    }
  }
  throw new Error(
    `${adapter.name} ${submitMethod === "button" ? "发送按钮" : "Enter 兜底"}未触发，未再次提交以避免重复发送`,
  );
}

async function waitForSendButton(page, adapter) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await sendButtonReady(page, adapter)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`${adapter.name} 上传尚未完成，发送按钮仍未就绪`);
}

async function sendButtonReady(page, adapter) {
  try {
  const send = await sendControl(page, adapter);
  return !!(
    (await send.count()) > 0 &&
    (await send.isEnabled()) &&
    !(await sendControlDisabled(send))
  );
  } catch (error) {
    if (isRecoverablePageReadError(error)) return false;
    throw error;
  }
}

async function sendControl(page, adapter) {
  const configured = page
    .locator(selectorList(adapter.send))
    .filter({ visible: true })
    .first();
  if ((await configured.count()) > 0) return configured;
  if (adapter.template === "chatgpt-like") {
    // Some third-party chat pages (including Kimi) expose the send action as
    // a clickable div containing a semantic Send SVG, not as a button.
    return page
      .locator(".send-button-container:has(svg[name='Send'])")
      .filter({ visible: true })
      .first();
  }
  return configured;
}

async function promptSubmissionStarted(
  page,
  composer,
  adapter,
  previousAnswerCount,
  task,
) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
    await throwForBlockingAccountDialog(task);
    if (await anyVisible(page, adapter.stop)) return true;
    const answerCount = await (
      await firstPopulatedLocator(page, adapter.answers)
    ).count();
    if (answerCount > previousAnswerCount) return true;
    const text = await composerText(composer);
    if (!text.trim()) return true;
    const send = await sendControl(page, adapter);
    if (
      (await send.count()) === 0 ||
      !(await send.isEnabled()) ||
      (await sendControlDisabled(send))
    )
      return true;
    } catch (error) {
      if (!isRecoverablePageReadError(error)) throw error;
    }
    await page.waitForTimeout(100);
  }
  return false;
}

async function sendControlDisabled(control) {
  const disabled = await control.getAttribute("disabled");
  const ariaDisabled = await control.getAttribute("aria-disabled");
  const className = await control.getAttribute("class");
  return (
    disabled !== null ||
    ariaDisabled === "true" ||
    /(?:^|\s)(?:ds-button--disabled|disabled)(?:\s|$)/i.test(className || "")
  );
}

async function composerText(composer) {
  const tagName = await composer
    .evaluate((element) => element.tagName.toLowerCase())
    .catch(() => "");
  if (tagName === "textarea" || tagName === "input") {
    return composer.inputValue().catch(() => "");
  }
  return composer.innerText().catch(() => "");
}

async function copyLatestAnswer(page, adapter, previousAnswerCount) {
  if (!adapter.copy) return "";
  const answers = await firstPopulatedLocator(page, adapter.answers);
  const count = await answers.count();
  const range = answerNodeRange(previousAnswerCount, count);
  if (range.end <= range.start) return "";
  const buttons = page.locator(selectorList(adapter.copy));
  for (let index = (await buttons.count()) - 1; index >= 0; index -= 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible())) continue;
    try {
      await button.click({ force: true, timeout: 3_000 });
    } catch {
      continue;
    }
    await page.waitForTimeout(200);
    const browserCopied = await page
      .evaluate(() => navigator.clipboard?.readText?.() || "")
      .catch(() => "");
    const copied = browserCopied || readClipboardText();
    if (copied.trim()) return copied.trim();
  }
  return "";
}

async function webSession(browserContext, task, adapter) {
  // The caller scopes sessionKey to a paper and provider. Keeping one page
  // per key lets returning to an older paper reuse its existing Web thread.
  const sessionSlot = task.sessionKey;
  let session = sessions.get(sessionSlot);
  if (session && !session.page.isClosed()) {
    if (session.sessionKey !== task.sessionKey) {
      await session.page.goto(adapter.url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      session.sessionKey = task.sessionKey;
      session.materialUploaded = false;
      session.chatgptOptionsKey = undefined;
    }
    return session;
  }
  const page = await browserContext.newPage();
  session = {
    page,
    materialUploaded: false,
    sessionKey: task.sessionKey,
    chatgptOptionsKey: undefined,
  };
  sessions.set(sessionSlot, session);
  page.on("close", () => {
    if (sessions.get(sessionSlot)?.page === page) {
      sessions.delete(sessionSlot);
    }
  });
  await page.goto(adapter.url, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  return session;
}

async function ensureContext() {
  if (context) return context;
  if (contextConnecting) return contextConnecting;
  contextConnecting = (async () => {
    const endpoint = await readDevToolsEndpoint();
    if (!endpoint) {
      throw new Error(
        "专用 WEB 浏览器尚未打开，请先点击账号配置按钮并手动登录",
      );
    }
    cdpBrowser = await chromium.connectOverCDP(endpoint);
    const connectedContext = cdpBrowser.contexts()[0];
    if (!connectedContext) {
      throw new Error("专用 WEB 浏览器没有可用页面，请重新打开账号配置");
    }
    context = connectedContext;
    cdpBrowser.on("disconnected", () => {
      context = undefined;
      cdpBrowser = undefined;
      browserMode = undefined;
      sessions.clear();
    });
    return context;
  })();
  try {
    return await contextConnecting;
  } finally {
    contextConnecting = undefined;
  }
}

async function applyTaskWindowPolicy(page, task) {
  if (!task.hideBrowser) {
    await showBrowserWindow(page);
  }
}

async function openDedicatedBrowser(provider, customProvider) {
  accountWindowVisible = true;
  const adapter = providerDefinition(provider, customProvider);
  if (!browserLaunching) {
    browserLaunching = (async () => {
      await ensureDedicatedBrowserMode("visible");
      const connectedContext = await ensureContext();
      const pages = connectedContext
        .pages()
        .filter((candidate) => candidate.url().includes(adapter.host));
      let page = undefined;
      for (const candidate of pages) {
        if (await accountReady(candidate, adapter)) {
          page = candidate;
          break;
        }
      }
      page ||= pages[0];
      if (!page) page = await connectedContext.newPage();
      await showBrowserWindow(page);
      if (!page.url().includes(adapter.host)) {
        await page.goto(adapter.accountUrl || adapter.url, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
      }
      return {
        ok: true,
        provider,
        browserOpen: true,
        url: page.url(),
        configured: await accountReady(page, adapter),
      };
    })();
  }
  try {
    return await browserLaunching;
  } catch (error) {
    accountWindowVisible = false;
    throw error;
  } finally {
    browserLaunching = undefined;
  }
}

async function browserAccountStatus(provider, customProvider) {
  const adapter = providerDefinition(provider, customProvider);
  try {
    await ensureDedicatedBrowserMode(
      accountWindowVisible ? "visible" : "headless",
    );
    const connectedContext = await ensureContext();
    const pages = connectedContext
      .pages()
      .filter((candidate) => candidate.url().includes(adapter.host));
    let configuredPage;
    for (const candidate of pages) {
      if (await accountReady(candidate, adapter)) {
        configuredPage = candidate;
        break;
      }
    }
    let page = configuredPage || pages[0];
    if (!page) {
      page = await connectedContext.newPage();
      await page.goto(adapter.accountUrl || adapter.url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      if (await accountReady(page, adapter)) configuredPage = page;
    }
    return {
      ok: true,
      provider,
      browserOpen: true,
      configured: !!configuredPage,
      url: page?.url() || "",
    };
  } catch (error) {
    return {
      ok: true,
      provider,
      browserOpen: false,
      configured: false,
      error: errorMessage(error),
    };
  }
}

async function hideDedicatedBrowser(provider, customProvider) {
  accountWindowVisible = false;
  const adapter = providerDefinition(provider, customProvider);
  const endpoint = await readDevToolsEndpoint();
  if (!endpoint) {
    return { ok: true, provider, browserOpen: false, configured: false };
  }
  const connectedContext = await ensureContext();
  const providerPages = connectedContext
    .pages()
    .filter((candidate) => candidate.url().includes(adapter.host));
  const pages = providerPages.length
    ? providerPages
    : connectedContext.pages().slice(0, 1);
  let configured = false;
  for (const page of pages) {
    if (page.url().includes(adapter.host)) {
      configured = (await accountReady(page, adapter)) || configured;
    }
  }
  await stopDedicatedBrowser();
  return {
    ok: true,
    provider,
    browserOpen: false,
    configured,
    hidden: true,
  };
}

async function enforceHiddenWindowPolicy() {
  if (accountWindowVisible || visibleTaskIDs.size > 0 || browserLaunching)
    return;
  const endpoint = await readDevToolsEndpoint();
  if (!endpoint) return;
  try {
    if ((await currentBrowserMode()) === "headless") return;
    await stopDedicatedBrowser();
  } catch (error) {
    console.warn(
      `[web-agent] hidden-window watchdog failed: ${errorMessage(error)}`,
    );
  }
}

async function ensureDedicatedBrowserMode(mode) {
  if (browserTransition) {
    await browserTransition;
    if ((await currentBrowserMode()) === mode) return;
  }
  browserTransition = (async () => {
    const runningMode = await currentBrowserMode();
    if (runningMode === mode) {
      browserMode = mode;
      return;
    }
    if (runningMode) await stopDedicatedBrowser();
    await startDedicatedBrowser(mode);
  })();
  try {
    await browserTransition;
  } finally {
    browserTransition = undefined;
  }
}

async function startDedicatedBrowser(mode) {
  await unlink(devToolsPortFile()).catch(() => undefined);
  const child = spawn(config.chromePath, chromeLaunchArguments(config, mode), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await waitForDevToolsEndpoint();
  browserMode = mode;
}

async function stopDedicatedBrowser() {
  const endpoint = await readDevToolsEndpoint();
  if (endpoint) {
    try {
      const connectedContext = await ensureContext();
      const page = connectedContext.pages()[0];
      if (page) {
        const session = await page.context().newCDPSession(page);
        await session.send("Browser.close").catch(() => undefined);
        await session.detach().catch(() => undefined);
      }
    } catch {}
  }
  resetBrowserConnection();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && (await readDevToolsEndpoint())) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (await readDevToolsEndpoint()) {
    throw new Error("专用 WEB 浏览器未能关闭，已取消模式切换");
  }
  await unlink(devToolsPortFile()).catch(() => undefined);
}

function resetBrowserConnection() {
  context = undefined;
  cdpBrowser = undefined;
  browserMode = undefined;
  sessions.clear();
}

async function currentBrowserMode() {
  const endpoint = await readDevToolsEndpoint();
  if (!endpoint) {
    browserMode = undefined;
    return undefined;
  }
  if (browserMode) return browserMode;
  try {
    const response = await fetch(`${endpoint}/json/version`);
    if (!response.ok) return undefined;
    browserMode = browserModeFromVersion(await response.json());
    return browserMode;
  } catch {
    return undefined;
  }
}

function devToolsPortFile() {
  return `${config.profileDir}/DevToolsActivePort`;
}

async function readDevToolsEndpoint() {
  let port = Number(config.cdpPort) || 9224;
  try {
    const raw = await readFile(devToolsPortFile(), "utf8");
    const filePort = Number.parseInt(raw.split(/\s+/)[0], 10);
    if (Number.isInteger(filePort) && filePort > 0) port = filePort;
  } catch {}
  if (!Number.isInteger(port) || port <= 0) return "";
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(`${endpoint}/json/version`);
    return response.ok ? endpoint : "";
  } catch {
    return "";
  }
}

async function waitForDevToolsEndpoint() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const endpoint = await readDevToolsEndpoint();
    if (endpoint) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("专用 WEB 浏览器启动超时，请检查 Chrome 是否可用");
}

async function composerReady(page, adapter) {
  const composer = page
    .locator(selectorList(adapter.composer))
    .filter({ visible: true });
  return (await composer.count()) > 0 && (await composer.first().isEditable());
}

async function accountReady(page, adapter) {
  if (!(await composerReady(page, adapter))) return false;
  if (
    adapter.template === "chatgpt-like" &&
    (await blockingAccountDialogVisible(page, adapter))
  ) {
    return false;
  }
  if (adapter.host !== "chatgpt.com") return true;

  // ChatGPT exposes a usable composer before authentication. Treat visible
  // login controls or the logged-out landing copy as the authoritative state;
  // the Web task must remain blocked until the user completes manual login.
  const loggedOutControls = page
    .locator(
      "button[data-testid='login-button'], button[data-testid='signup-button']",
    )
    .filter({ visible: true });
  if ((await loggedOutControls.count()) > 0) return false;
  const loggedOutPrompt = page
    .getByText("登录以获取", { exact: false })
    .filter({ visible: true });
  return (await loggedOutPrompt.count()) === 0;
}

async function blockingAccountDialogVisible(page, adapter) {
  return !!(await blockingAccountDialogText(page, adapter));
}

async function blockingAccountDialogText(page, adapter) {
  if (!page || page.isClosed()) return "";
  const dialogs = page
    .locator(
      "dialog, [role='dialog'], [aria-modal='true'], [class*='modal' i], [class*='dialog' i]",
    )
    .filter({ visible: true });
  let best = "";
  let bestArea = 0;
  for (let index = 0; index < (await dialogs.count()); index += 1) {
    const dialog = dialogs.nth(index);
    const text = await dialog.innerText().catch(() => "");
    const box = await dialog.boundingBox().catch(() => null);
    const area = box ? box.width * box.height : 0;
    if (
      text.trim() &&
      box &&
      box.width >= 160 &&
      box.height >= 80 &&
      area > bestArea
    ) {
      best = text.trim();
      bestArea = area;
    }
  }
  if (best) return best.slice(0, 6_000);
  return adapter?.template === "chatgpt-like"
    ? composerOverlayText(page, adapter)
    : "";
}

async function composerOverlayText(page, adapter) {
  const composer = page
    .locator(selectorList(adapter.composer))
    .filter({ visible: true })
    .first();
  if ((await composer.count()) === 0) return "";
  return composer
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return "";
      const x = Math.max(
        0,
        Math.min(window.innerWidth - 1, rect.left + rect.width / 2),
      );
      const y = Math.max(
        0,
        Math.min(window.innerHeight - 1, rect.top + rect.height / 2),
      );
      const top = document.elementFromPoint(x, y);
      if (!top || top === element || element.contains(top)) return "";

      let overlay = null;
      for (
        let node = top;
        node && node !== document.body && node !== document.documentElement;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        if (
          style.pointerEvents !== "none" &&
          ["fixed", "absolute"].includes(style.position) &&
          box.width >= window.innerWidth * 0.4 &&
          box.height >= window.innerHeight * 0.3
        ) {
          overlay = node;
          break;
        }
      }
      if (!overlay) return "";
      return (overlay.innerText || overlay.textContent || "")
        .trim()
        .slice(0, 6_000);
    })
    .catch(() => "");
}

const CHATGPT_REASONING_VALUES = {
  low: 0,
  medium: 1,
  high: 2,
};

const CHATGPT_REASONING_LABELS = {
  low: ["低", "极速"],
  medium: ["中"],
  high: ["高"],
};

async function ensureChatGPTOptions(page, session, options) {
  const effort = options?.reasoningEffort || "medium";
  if (session.chatgptOptionsKey === effort) return;
  const labels = CHATGPT_REASONING_LABELS[effort];
  const trigger = page
    .locator("button[aria-haspopup='menu']")
    .filter({ has: page.locator("[data-animated-slider-trigger='true']") })
    .filter({ visible: true })
    .first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  if (labels.includes((await trigger.innerText()).trim())) {
    session.chatgptOptionsKey = effort;
    return;
  }

  await trigger.click();
  const control = page
    .locator("[role='menuitem']")
    .filter({ has: page.locator("[data-model-reasoning-effort-slider]") })
    .filter({ visible: true })
    .first();
  await control.waitFor({ state: "visible", timeout: 5_000 });
  const slider = control.locator("[role='slider']").first();
  const current = Number(await slider.getAttribute("aria-valuenow"));
  const target = CHATGPT_REASONING_VALUES[effort];
  if (!Number.isInteger(current) || target == null) {
    throw new Error("ChatGPT reasoning effort control is unavailable");
  }
  await control.focus();
  const key = target > current ? "ArrowRight" : "ArrowLeft";
  for (let step = current; step !== target; step += target > current ? 1 : -1) {
    await page.keyboard.press(key);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  if (!labels.includes((await trigger.innerText()).trim())) {
    throw new Error(
      `ChatGPT reasoning effort did not change: ${labels.join("/")}`,
    );
  }
  session.chatgptOptionsKey = effort;
}

async function waitForAnswer(
  page,
  adapter,
  previousAnswerCount,
  previousResponseCount,
  previousResponseBaseline,
  previousCopyCount,
  previousCompletionCount,
  task,
  pageNotice,
) {
  const deadline = Date.now() + 10 * 60_000;
  let previousSignature = "";
  let stablePolls = 0;
  // A browser refresh rebuilds DeepSeek's answer DOM while the same task is
  // still running. Force one fresh snapshot after the navigation so the
  // Zotero sidebar catches up even when the text has not grown yet.
  let pageRefreshPending = false;
  const onFrameNavigated = (frame) => {
    if (frame === page.mainFrame()) pageRefreshPending = true;
  };
  page.on("framenavigated", onFrameNavigated);
  let normalAnswerObserved = false;
  let pageNoticeSignature = "";
  let pageNoticeStablePolls = 0;
  let pollDelay = 350;
  try {
    let initialNodes;
    while (Date.now() < deadline && !initialNodes) {
      try {
        initialNodes = await (await firstResponseLocator(page, adapter)).all();
      } catch (error) {
        if (!isRecoverablePageReadError(error)) throw error;
        pageRefreshPending = true;
        await page.waitForTimeout(250);
      }
    }
    if (!initialNodes) throw new Error(`${adapter.name} answer timed out`);
    const baselineRange = answerNodeRange(
      previousResponseCount,
      initialNodes.length,
    );
    const baseline =
      previousResponseBaseline ??
      (baselineRange.inPlace
        ? await snapshotResponseSlice(
            initialNodes,
            adapter,
            baselineRange.start,
            baselineRange.end,
          )
        : { answer: "", reasoning: "" });
    while (Date.now() < deadline) {
      try {
        const responses = await firstResponseLocator(page, adapter);
        // Snapshot the current nodes. ChatGPT-like UIs replace message elements
        // while streaming; repeatedly addressing nth() can otherwise wait for a
        // node that disappeared during a render pass. DeepSeek often streams into
        // the last assistant node without increasing the node count.
        const responseNodes = await responses.all();
        const range = answerNodeRange(
          previousResponseCount,
          responseNodes.length,
        );
        const refreshedSinceLastSnapshot = pageRefreshPending;
        if (pageRefreshPending) {
          previousSignature = "";
          stablePolls = 0;
          pageRefreshPending = false;
        }
        if (range.end > range.start) {
          const result = await snapshotResponseSlice(
            responseNodes,
            adapter,
            range.start,
            range.end,
          );
          if (
            refreshedSinceLastSnapshot ||
            !inPlaceStillBaseline(range.inPlace, result, baseline)
          ) {
            if (result.answer || result.reasoning) {
              normalAnswerObserved = true;
              task.normalAnswerObserved = true;
            }
            const generating = await anyVisible(page, adapter.stop);
            const completionReady = await answerCompletionReady(
              page,
              adapter,
              previousCopyCount,
              previousCompletionCount,
              responseNodes[range.end - 1],
            );
            const step = nextAnswerWaitState({
              result,
              previousSignature,
              generating,
              completionReady,
              host: adapter.host,
              stablePolls,
              inPlace: range.inPlace,
            });
            if (step.emitProgress) await callback(task, "generating", result);
            previousSignature = step.signature;
            stablePolls = step.nextStable;
            if (step.shouldComplete) return result;
            pollDelay = nextAnswerPollDelay({
              generating,
              completionReady,
            });
          }
        }
        if (!normalAnswerObserved) {
          await throwForBlockingAccountDialog(task);
        }
        if (adapter.pageNoticeFallback && !normalAnswerObserved) {
          const content = visiblePageTextDelta(
            pageNotice?.baseline || "",
            await pageVisibleText(page),
            pageNotice?.exclusions || [],
          );
          const noticeStep = nextPageNoticeWaitState({
            content,
            previousSignature: pageNoticeSignature,
            stablePolls: pageNoticeStablePolls,
            pageReady: await sendButtonReady(page, adapter),
            normalAnswerObserved,
          });
          pageNoticeSignature = noticeStep.signature;
          pageNoticeStablePolls = noticeStep.nextStable;
          if (noticeStep.shouldComplete) {
            return { answer: content, reasoning: "", pageNotice: true };
          }
        }
      } catch (error) {
        if (!isRecoverablePageReadError(error)) throw error;
        // A user refresh destroys the current execution context briefly. Keep
        // the same task and baseline, then resume once the page has a context
        // again; closed pages and browser disconnects still fail normally.
        pageRefreshPending = true;
        previousSignature = "";
        stablePolls = 0;
        await page.waitForTimeout(250);
      }
      // Poll the live answer often enough for the Zotero sidebar to paint
      // growing Web output instead of receiving only large one-second chunks.
      await page.waitForTimeout(pollDelay);
    }
  } finally {
    page.off("framenavigated", onFrameNavigated);
  }
  throw new Error(`${adapter.name} answer timed out`);
}

async function pageVisibleText(page) {
  return page
    .locator("body")
    .innerText()
    .catch(() => "");
}

async function snapshotResponseSlice(responseNodes, adapter, start, end) {
  if (!adapter.responseRoots?.length) {
    return snapshotAnswerSlice(responseNodes, adapter, start, end);
  }
  const answerChunks = [];
  const reasoningChunks = [];
  for (
    let index = start;
    index < end && index < responseNodes.length;
    index += 1
  ) {
    const responseNode = responseNodes[index];
    const answers = await firstPopulatedLocator(responseNode, adapter.answers);
    for (const answerNode of await answers.all()) {
      const chunk = await answerNodeMarkdown(answerNode).catch(() => "");
      if (chunk) answerChunks.push(chunk);
    }
    const reasoning = await responseRootReasoningMarkdown(
      responseNode,
      adapter,
    ).catch(() => "");
    if (reasoning) reasoningChunks.push(reasoning);
  }
  return {
    answer: answerChunks.join("\n\n").trim(),
    reasoning: reasoningChunks.join("\n\n").trim(),
  };
}

async function snapshotAnswerSlice(answerNodes, adapter, start, end) {
  const answerChunks = [];
  const reasoningChunks = [];
  for (
    let index = start;
    index < end && index < answerNodes.length;
    index += 1
  ) {
    const answerNode = answerNodes[index];
    const chunk = await answerNodeMarkdown(answerNode).catch(() => "");
    if (chunk) answerChunks.push(chunk);
    const reasoning = await answerNodeReasoningMarkdown(
      answerNode,
      adapter,
    ).catch(() => "");
    if (reasoning) reasoningChunks.push(reasoning);
  }
  return {
    answer: answerChunks.join("\n\n").trim(),
    reasoning: reasoningChunks.join("\n\n").trim(),
  };
}

async function answerMarkdownSnapshot(page, adapter, previousAnswerCount) {
  const answers = await firstPopulatedLocator(page, adapter.answers);
  const nodes = await answers.all();
  const range = answerNodeRange(previousAnswerCount, nodes.length);
  const chunks = [];
  for (let index = range.start; index < range.end; index += 1) {
    const chunk = await answerNodeMarkdown(nodes[index]).catch(() => "");
    if (chunk) chunks.push(chunk);
  }
  return chunks.join("\n\n").trim();
}

async function materializeAnswerDownloads(
  page,
  adapter,
  previousAnswerCount,
  answer,
) {
  if (!answer) return answer;
  // DeepSeek's answer toolbar exposes a "下载" control for the web page.
  // It is provider UI, not part of the Zotero result, so never click it.
  if (adapter.name === "DeepSeek") return answer;
  const answers = await firstPopulatedLocator(page, adapter.answers);
  const answerNodes = await answers.all();
  const range = answerNodeRange(previousAnswerCount, answerNodes.length);
  const links = [];
  // File tiles can be numerous, and a failed click waits out its timeouts.
  // Bound the work so one answer cannot spend minutes downloading files.
  const maxDownloads = 4;
  let attempts = 0;
  for (
    let index = range.start;
    index < range.end && attempts < maxDownloads;
    index += 1
  ) {
    const answerNode = answerNodes[index];
    const buttons = answerNode.locator("button, [role='button'], a[download]");
    for (
      let buttonIndex = 0;
      buttonIndex < (await buttons.count());
      buttonIndex += 1
    ) {
      if (attempts >= maxDownloads) break;
      const button = buttons.nth(buttonIndex);
      if (!(await button.isVisible().catch(() => false))) continue;
      const label = await controlLabel(button);
      const fileNameLabel = isDownloadableFileName(label);
      // A generic "下载" action belongs to the provider's chart toolbar. Do
      // not open its menu automatically; DOT/Mermaid source is rendered by
      // Zotero, while users remain free to download from the Web page.
      if (!fileNameLabel) continue;
      attempts += 1;
      const saved = await downloadAnswerButton(page, button, label);
      if (saved) links.push({ ...saved, inlineLabel: label });
    }
  }
  let result = answer;
  for (const link of links) {
    const linked = `[${link.name}](${link.url})`;
    if (result.includes(link.url)) continue;
    const escaped = escapeRegExp(link.inlineLabel);
    // Do not replace the label inside an existing Markdown link. Some web
    // UIs return both a plain filename and a link for the same file; replacing
    // both creates nested Markdown such as `[[name](url)](url)`.
    const plainName = new RegExp(`(?<!\\[)${escaped}(?!\\]\\()`, "g");
    result = plainName.test(result)
      ? result.replace(plainName, linked)
      : `${result}\n\n${linked}`;
  }
  return result;
}

async function controlLabel(control) {
  const aria = String((await control.getAttribute("aria-label")) || "").trim();
  if (aria) return aria;
  const title = String((await control.getAttribute("title")) || "").trim();
  if (title) return title;
  const text = String(await control.innerText().catch(() => "")).trim();
  return text.slice(0, 180);
}

async function extractRenderedSvgImages(page, adapter, previousAnswerCount) {
  const answers = await firstPopulatedLocator(page, adapter.answers);
  const nodes = await answers.all();
  const range = answerNodeRange(previousAnswerCount, nodes.length);
  const images = [];
  for (let index = range.start; index < range.end; index += 1) {
    const svgs = nodes[index].locator("svg");
    for (let svgIndex = 0; svgIndex < (await svgs.count()); svgIndex += 1) {
      const svg = svgs.nth(svgIndex);
      if (!(await svg.isVisible().catch(() => false))) continue;
      const markup = await svg.evaluate((element, ordinal) => {
        // Toolbar icons (zoom, download, fullscreen, copy) and the placeholder
        // shown next to "渲染失败" are SVGs too. Importing them filled the
        // Zotero answer with a dozen "图表 N.svg" arrows and plus signs. A
        // rendered chart is never inside a control, is never icon-sized, and
        // carries labels or many shapes.
        if (
          element.closest(
            "button, [role='button'], a, [role='tab'], [role='tablist'], [role='toolbar']",
          )
        ) {
          return "";
        }
        const box = element.getBoundingClientRect();
        if (box.width < 160 || box.height < 120) return "";
        if (
          !element.querySelector("text, tspan") &&
            element.querySelectorAll(
              "path, rect, circle, ellipse, polygon, line",
            ).length < 12
        ) {
          return "";
        }
        element.setAttribute("data-zai-chart", String(ordinal));
        const clone = element.cloneNode(true);
        // Keep <foreignObject>. Mermaid defaults to htmlLabels: true, so every
        // node label lives inside one; removing them shipped empty boxes to
        // Zotero. Zotero renders the result through <img>, where SVG runs in
        // secure static mode: no script executes and no external resource
        // loads, so the embedded markup is inert.
        clone.querySelectorAll("script").forEach((node) => node.remove());
        // The root <svg> carries attributes too; cleaning only descendants
        // left an `onclick` on the element that Zotero renders.
        [clone, ...clone.querySelectorAll("*")].forEach((node) => {
          [...node.attributes].forEach((attribute) => {
              if (/^on/i.test(attribute.name))
                node.removeAttribute(attribute.name);
            if (
              /^(href|xlink:href|src)$/i.test(attribute.name) &&
              /^https?:/i.test(attribute.value)
            ) {
              node.removeAttribute(attribute.name);
            }
          });
        });
        return clone.outerHTML;
      }, images.length + 1).catch(() => "");
      if (!markup || markup.length > 2_000_000) continue;
      const encoded = encodeURIComponent(markup);
      images.push({
        id: `web-svg-${Date.now()}-${images.length}`,
        name: `${adapter.name} 图表 ${images.length + 1}.svg`,
        mediaType: "image/svg+xml",
        dataUrl: `data:image/svg+xml;charset=utf-8,${encoded}`,
        size: Buffer.byteLength(markup),
      });
    }
  }
  return images;
}

async function downloadAnswerButton(page, button, label) {
  let openedPage;
  try {
    await page.keyboard.press("Escape").catch(() => undefined);
    // Some ChatGPT-like sites expose the generated file itself as a button.
    // Clicking it opens a download or a PDF page directly, without a second
    // "Download" menu button.
    const directDownloadPromise = page
      .waitForEvent("download", { timeout: 5_000 })
      .catch(() => null);
    const directPagePromise = page
      .context()
      .waitForEvent("page", { timeout: 5_000 })
      .catch(() => null);
    await button.click({ force: true, timeout: 5_000 });
    const direct = await Promise.race([
      directDownloadPromise,
      directPagePromise,
    ]);
    if (direct) {
      return await saveDownloadedFile(direct, label);
    }

    const downloadButton = page
      .locator(
        "button[aria-label='下载'], button[aria-label='Download'], [role='button'][aria-label='下载'], [role='button'][aria-label='Download']",
      )
      .filter({ visible: true })
      .last();
    await downloadButton.waitFor({ state: "visible", timeout: 5_000 });
    const downloadPromise = page
      .waitForEvent("download", { timeout: 15_000 })
      .catch(() => null);
    const pagePromise = page
      .context()
      .waitForEvent("page", { timeout: 5_000 })
      .catch(() => null);
    await downloadButton.click({ force: true });
    const download = await Promise.race([downloadPromise, pagePromise]);
    return await saveDownloadedFile(download, label);
  } catch (error) {
    console.warn(
      `[web-agent] file download failed for ${label}: ${errorMessage(error)}`,
    );
    await page.keyboard.press("Escape").catch(() => undefined);
    return null;
  } finally {
    if (openedPage && !openedPage.isClosed()) {
      await openedPage.close().catch(() => undefined);
    }
  }
}

async function saveDownloadedFile(download, label) {
  let openedPage;
  try {
    if (download && typeof download.saveAs !== "function") {
      openedPage = download;
    }
    if (!download) throw new Error("网页未返回下载文件或文件页面");
    const downloadDir = `${config.profileDir}/zai-downloads`;
    await mkdir(downloadDir, { recursive: true });
    const fileName = safeDownloadFileName(
      download?.suggestedFilename?.() || label,
    );
    const destination = `${downloadDir}/${Date.now()}-${fileName}`;
    if (typeof download.saveAs === "function") {
      await download.saveAs(destination);
    } else {
      await openedPage.waitForLoadState("domcontentloaded", {
        timeout: 15_000,
      });
      const payload = await openedPage.evaluate(async () => {
        const response = await fetch(location.href);
        if (!response.ok) {
          throw new Error(`文件页面返回 HTTP ${response.status}`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + chunkSize),
          );
        }
        return btoa(binary);
      });
      await writeFile(destination, Buffer.from(payload, "base64"));
    }
    return {
      name: fileName,
      // The fragment distinguishes files that were downloaded by this agent
      // from arbitrary file: links a model may include in its prose.
      url: `${pathToFileURL(destination).href}#zai-web-download`,
    };
  } catch (error) {
    return null;
  } finally {
    if (openedPage && !openedPage.isClosed()) {
      await openedPage.close().catch(() => undefined);
    }
  }
}

function isDownloadableFileName(value) {
  return (
    /\.(?:pdf|png|jpe?g|gif|webp|docx?|pptx?|xlsx?|csv|zip|tex|txt)$/i.test(
      value,
    ) && !isUUIDFileName(value)
  );
}

function isUUIDFileName(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{1,12}(?:…|\.\.\.)?(?:\.[\w.-]+)?$/i.test(
    value,
  );
}

function safeDownloadFileName(value) {
  const cleaned = String(value)
    .replace(/[\\/<>:"|?*\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 180);
  return cleaned || "zai-download.bin";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function answerCompletionReady(
  page,
  adapter,
  previousCopyCount,
  previousCompletionCount,
  answerNode,
) {
  if (adapter.completion && answerNode) {
    const messageItem = answerNode.locator(
      "xpath=ancestor::*[@data-virtual-list-item-key][1]",
    );
    const buttons = messageItem.locator(selectorList(adapter.completion));
    const total = await completionLocator(page, adapter).count();
    if (total <= previousCompletionCount || (await buttons.count()) === 0) {
      return false;
    }
    for (let index = 0; index < (await buttons.count()); index += 1) {
      if (await buttons.nth(index).isVisible()) return true;
    }
    return false;
  }
  if (!adapter.copy) return false;
  const buttons = page.locator(selectorList(adapter.copy));
  const count = await buttons.count();
  if (count <= previousCopyCount) return false;
  for (let index = previousCopyCount; index < count; index += 1) {
    if (await buttons.nth(index).isVisible()) return true;
  }
  return false;
}

function completionLocator(page, adapter) {
  return page
    .locator("[data-virtual-list-item-key]")
    .locator(selectorList(adapter.completion));
}

async function answerNodeReasoningMarkdown(answer, adapter) {
  if (!adapter.reasoning?.length) return "";
  const message = answer.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ds-message ')][1]",
  );
  return responseRootReasoningMarkdown(message, adapter);
}

async function responseRootReasoningMarkdown(message, adapter) {
  if (!adapter.reasoning?.length) return "";
  const reasoning = message.locator(selectorList(adapter.reasoning));
  const parts = [];
  for (let index = 0; index < (await reasoning.count()); index += 1) {
    const chunk = await answerNodeMarkdown(reasoning.nth(index)).catch(
      () => "",
    );
    if (chunk) parts.push(chunk);
  }
  if (adapter.name !== "DeepSeek") return parts.join("\n\n").trim();

  // DeepSeek renders search results and browsed-page cards as siblings of the
  // thinking Markdown, not inside `.ds-think-content`. Include those cards in
  // the live reasoning transcript so a Zotero refresh does not leave the
  // sidebar behind while the page is visibly searching or browsing.
  const children = message.locator(":scope > div > div");
  for (let index = 0; index < (await children.count()); index += 1) {
    const child = children.nth(index);
    const info = await child
      .evaluate((element) => {
        const text = (element.innerText || "").trim();
        const className = String(element.className || "");
        const isThinking = className.split(/\s+/).includes("ds-think-content");
        const isAnswer =
          className
            .split(/\s+/)
            .includes("ds-assistant-message-main-content") ||
          !!element.querySelector(".ds-assistant-message-main-content");
        const processSignal =
          !!element.querySelector("a") ||
          /搜索到|搜索结果|浏览\s+\d+\s*个页面|读取|调用工具|执行工具/.test(
            text,
          );
        return { isThinking, isAnswer, processSignal, text };
      })
      .catch(() => ({
        isThinking: false,
        isAnswer: true,
        processSignal: false,
        text: "",
      }));
    if (!info.text || info.isThinking || info.isAnswer || !info.processSignal) {
      continue;
    }
    const chunk = await answerNodeMarkdown(child).catch(() => "");
    if (chunk) parts.push(chunk);
  }
  return parts.join("\n\n").trim();
}

async function answerNodeMarkdown(answer) {
  return answer.evaluate((root) => {
    const children = (node) => [...node.childNodes].map(convert).join("");
    const text = (node) => (node.textContent || "").trim();
    const rows = (table) =>
      [...table.querySelectorAll("tr")].map((row) =>
        [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) =>
          children(cell)
            .replace(/\|/g, "\\|")
            .replace(/\s*\n\s*/g, " ")
            .trim(),
        ),
      );

    function convert(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const element = node;
      const tag = element.tagName.toLowerCase();
      const className = String(element.className || "");
      // DeepSeek's Mermaid card embeds its failed renderer output as a large
      // inline SVG with a <style> node. That is presentation implementation,
      // not answer content, and serializing it leaks thousands of CSS
      // characters into the Zotero reply.
      // A chart that was synced to Zotero carries a marker. Leave a
      // placeholder so the sidebar can paint the image where the chart
      // actually sits in the answer instead of dropping every figure to the
      // bottom of the message. Untagged SVGs are icons or failed renders.
      if (tag === "svg") {
        const chart = element.getAttribute("data-zai-chart");
        return chart ? `\n\n[[zai-web-chart:${chart}]]\n\n` : "";
      }
      if (
        ["style", "script", "noscript", "template", "canvas"].includes(tag)
      ) {
        return "";
      }
      // Card toolbars live inside the answer node. DeepSeek's Mermaid card
      // leaked its own controls into Zotero as "图表代码下载全屏渲染失败",
      // where "下载" looked like a link the user could click. Controls are
      // never answer content. Anchors are excluded because a real download
      // link can carry role="button".
      const role = element.getAttribute("role") || "";
      if (
        tag === "button" ||
        (tag !== "a" &&
            [
              "button",
              "tab",
              "tablist",
              "toolbar",
              "menu",
              "menuitem",
            ].includes(role))
      ) {
        return "";
      }
      // File download links can carry the same citation attributes as the
      // surrounding file tile. Preserve the actual anchor and resolve
      // relative URLs so Zotero receives a usable link instead of a UUID
      // citation control or an origin-relative path.
      if (tag === "a") {
        const href = element.href || element.getAttribute("href") || "";
        if (href) {
          const label = (element.textContent || "").trim() || href;
          // DeepSeek can expose a sandbox:/ path as an anchor even though it
          // cannot be downloaded outside its service. Do not turn that into a
          // deceptive link in Zotero; keep only its visible label.
          if (/^https?:\/\/sandbox:|^sandbox:/i.test(href)) return label;
          return `[${label}](${href})`;
        }
      }
      // ChatGPT injects file citation buttons into assistant Markdown. They
      // are UI provenance controls, not answer text; importing them would
      // leak UUID filenames into the Zotero response. The attribute name has
      // changed between web builds, so recognize the common citation markers
      // instead of depending on one exact DOM attribute.
      const hasCitationMarker =
        element.hasAttribute("data-file-citation-group-identity") ||
        [...element.attributes].some((attribute) => {
          const token = `${attribute.name}=${attribute.value}`.toLowerCase();
          return (
            /file[-_ ]?citation|citation[-_ ]?file/.test(token) ||
            (/^data[-_].*citation/.test(attribute.name.toLowerCase()) &&
              /citation/.test(token))
          );
        });
      const citationAncestor = element.closest?.(
        "[data-file-citation-group-identity], [data-file-citation], [data-testid*='file-citation'], [data-testid*='citation']",
      );
      if (hasCitationMarker || citationAncestor) {
        return "";
      }
      const marker = listMarker(element);
      const annotation = element.querySelector(
        'annotation[encoding="application/x-tex"]',
      );
      if (annotation && className.includes("katex-display")) {
        return `\n\n$$\n${text(annotation)}\n$$\n\n`;
      }
      if (annotation && className.split(/\s+/).includes("katex")) {
        return `$${text(annotation)}$`;
      }
      if (/^h[1-6]$/.test(tag)) {
        const heading = children(element)
          .trim()
          .replace(/^#{1,6}\s+/, "");
        return `\n\n${"#".repeat(Number(tag[1]))} ${heading}\n\n`;
      }
      if (element.getAttribute("role") === "heading") {
        const level = Math.max(
          1,
          Math.min(6, Number(element.getAttribute("aria-level")) || 2),
        );
        const heading = children(element)
          .trim()
          .replace(/^#{1,6}\s+/, "");
        return `\n\n${"#".repeat(level)} ${heading}\n\n`;
      }
      if (tag === "p") {
        const renderedText = children(element).trim();
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize || "0");
        const rootFontSize = Number.parseFloat(
          getComputedStyle(root).fontSize || "16",
        );
        const onlyStrong =
          element.children.length === 1 &&
          ["strong", "b"].includes(
            element.firstElementChild?.tagName.toLowerCase() || "",
          );
        if (
          renderedText &&
          renderedText.length <= 120 &&
          (fontSize >= rootFontSize * 1.15 || onlyStrong) &&
          Number.parseInt(
            style.fontWeight || (onlyStrong ? "700" : "400"),
            10,
          ) >= 600
        ) {
          return `\n\n## ${renderedText.replace(/^\*\*|\*\*$/g, "")}\n\n`;
        }
        return `\n\n${renderedText}\n\n`;
      }
      if (tag === "br") return "\n";
      if (tag === "strong" || tag === "b") return `**${children(element)}**`;
      if (tag === "em" || tag === "i") return `*${children(element)}*`;
      if (tag === "pre") {
        const code = element.querySelector("code");
        const language =
          String(code?.className || "").match(/language-([\w-]+)/)?.[1] || "";
        return `\n\n\`\`\`${language}\n${code?.textContent || element.textContent || ""}\n\`\`\`\n\n`;
      }
      if (tag === "code") return `\`${children(element)}\``;
      if (tag === "blockquote") {
        return `\n\n${children(element)
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}\n\n`;
      }
      if (tag === "ul" || tag === "ol") {
        const ordered = tag === "ol";
        const items = [...element.children]
          .filter((child) => child.tagName.toLowerCase() === "li")
          .map(
            (item, index) =>
              `${ordered ? `${index + 1}.` : "-"} ${children(item).trim()}`,
          );
        return `\n\n${items.join("\n")}\n\n`;
      }
      if (tag === "table") {
        const tableRows = rows(element);
        if (!tableRows.length) return "";
        const width = Math.max(...tableRows.map((row) => row.length));
        const normalized = tableRows.map((row) => [
          ...row,
          ...Array(Math.max(0, width - row.length)).fill(""),
        ]);
        const lines = normalized.map((row) => `| ${row.join(" | ")} |`);
        lines.splice(1, 0, `| ${Array(width).fill("---").join(" | ")} |`);
        return `\n\n${lines.join("\n")}\n\n`;
      }
      if (marker) return `\n\n${marker} ${children(element).trim()}\n\n`;
      if (className.includes("list-item")) {
        const siblings = [...(element.parentElement?.children || [])];
        const ordinal = siblings.indexOf(element) + 1;
        const ordered = /ordered|number|decimal/i.test(className);
        return `\n\n${ordered ? `${ordinal}.` : "-"} ${children(element).trim()}\n\n`;
      }
      const renderedText = children(element).trim();
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize || "0");
      const rootFontSize = Number.parseFloat(
        getComputedStyle(root).fontSize || "16",
      );
      if (
        renderedText &&
        renderedText.length <= 120 &&
        fontSize >= rootFontSize * 1.15 &&
        Number.parseInt(style.fontWeight || "400", 10) >= 600
      ) {
        return `\n\n## ${renderedText}\n\n`;
      }
      return children(element);
    }

    function listMarker(element) {
      const pseudoContent = ["::before", "::marker"]
        .map((pseudo) => getComputedStyle(element, pseudo).content)
        .find((content) => content && content !== "none" && content !== '""');
      const computed = getComputedStyle(element);
      if (!pseudoContent && computed.display !== "list-item") return "";
      if (computed.display === "list-item") {
        const siblings = [...(element.parentElement?.children || [])];
        const ordinal = siblings.indexOf(element) + 1;
        return computed.listStyleType === "decimal" ||
          computed.listStyleType === "none"
          ? `${ordinal}.`
          : "-";
      }
      const marker = pseudoContent.replace(/^['"]|['"]$/g, "").trim();
      if (marker.includes("counter(")) {
        const siblings = [...(element.parentElement?.children || [])];
        return `${siblings.indexOf(element) + 1}.`;
      }
      return /^(?:\d+[.)]|[-*+]|[•·])$/.test(marker) ? marker : "";
    }

    return convert(root)
      .replace(/\n[ \t]+/g, "\n")
      // A few builds expose a file citation as a plain UUID filename without
      // any marker. It is not answer content and should not appear in Zotero.
      .replace(
        /(^|\n)[ \t]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{1,12}(?:…|\.\.\.)?(?:\.[\w.-]+)?[ \t]*(?=\n|$)/gi,
        "$1",
      )
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{1,12}(?:…|\.\.\.)?(?:\.[\w.-]+)?\b/gi,
        "",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }, undefined, { timeout: 2_000 });
}

async function anyVisible(page, selectors) {
  const controls = page.locator(selectorList(selectors));
  for (let index = 0; index < (await controls.count()); index += 1) {
    if (await controls.nth(index).isVisible()) return true;
  }
  return false;
}

async function callback(task, state, extra = {}) {
  const carriesSnapshot =
    state === "completed" ||
    (state === "generating" &&
      (extra.answer || extra.reasoning || extra.images));
  const revision = carriesSnapshot
    ? (task.callbackRevision = (task.callbackRevision || 0) + 1)
    : undefined;
  const body = JSON.stringify({
    id: task.id,
    state,
    ...extra,
    ...(revision ? { revision } : {}),
  });
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(config.callbackUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body,
      });
      if (response.ok) return;
      lastError = new Error(`callback returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError;
}

function authorized(request) {
  return request.headers.authorization === `Bearer ${config.token}`;
}

async function validateTask(value) {
  if (!value || typeof value !== "object") throw new Error("invalid task");
  if (typeof value.id !== "string" || typeof value.prompt !== "string") {
    throw new Error("task id and prompt are required");
  }
  const customProvider = value.customProvider;
  providerDefinition(value.provider, customProvider);
  if (
    typeof value.continuationPrompt !== "string" ||
    typeof value.sessionKey !== "string" ||
    !value.sessionKey
  ) {
    throw new Error("task continuationPrompt and sessionKey are required");
  }
  const paperUrl = typeof value.paperUrl === "string" ? value.paperUrl : "";
  const attachment = await validateWebAttachment(value.attachment);
  const contextAttachment = await validateWebAttachment(
    value.contextAttachment,
  );
  const tocAttachment = await validateWebAttachment(value.tocAttachment);
  const chatgptOptions = validateChatGPTOptions(value.chatgptOptions);
  return {
    id: value.id,
    prompt: value.prompt,
    continuationPrompt: value.continuationPrompt,
    sessionKey: value.sessionKey,
    provider: value.provider,
    customProvider: customProvider || undefined,
    paperUrl,
    hideBrowser: value.hideBrowser !== false,
    chatgptOptions,
    attachment,
    contextAttachment,
    tocAttachment,
  };
}

function queueFor(provider) {
  if (!queues.has(provider)) queues.set(provider, []);
  return queues.get(provider);
}

function validateChatGPTOptions(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    reasoningEffort: ["low", "medium", "high"].includes(input.reasoningEffort)
      ? input.reasoningEffort
      : "medium",
  };
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readClipboardText() {
  try {
    const result = spawnSync(
      "xclip",
      ["-selection", "clipboard", "-o", "-target", "UTF8_STRING"],
      { encoding: "utf8", timeout: 3_000 },
    );
    return result.status === 0 ? result.stdout || "" : "";
  } catch {
    return "";
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function shutdown() {
  server.close();
  await stopDedicatedBrowser().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
