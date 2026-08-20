import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { selectorList } from "./adapters.mjs";

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

// Tasks for different providers run concurrently, but the X11 clipboard is a
// single global resource. Serialize each write→paste→restore critical section
// so a ChatGPT task cannot replace the file URI a DeepSeek task is pasting.
let clipboardTurn = Promise.resolve();
function withClipboardLock(action) {
  const run = clipboardTurn.then(action);
  clipboardTurn = run.catch(() => undefined);
  return run;
}

export async function validateWebAttachment(value) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error("invalid attachment");
  }
  const { kind, path: filePath, name, mimeType } = value;
  if (
    !["latex", "pdf", "text"].includes(kind) ||
    typeof filePath !== "string" ||
    !path.isAbsolute(filePath) ||
    typeof name !== "string" ||
    !name.trim() ||
    !["text/plain", "application/pdf"].includes(mimeType)
  ) {
    throw new Error("invalid attachment fields");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("attachment is not a file");
  if (fileStat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("attachment exceeds the 100 MB limit");
  }
  return { kind, path: filePath, name, mimeType };
}

export async function pasteWebAttachment(
  page,
  composer,
  adapter,
  attachment,
  options = {},
) {
  const previousPreviewCount = await visibleAttachmentPreviewCount(
    page,
    adapter,
  );
  const uploadedThroughInput = await setWebAttachmentInputFiles(
    page,
    attachment.path,
  );
  if (!uploadedThroughInput) {
    if (options.allowClipboardFallback === false) {
      throw new Error(
        `${adapter.name} attachment input is unavailable; clipboard fallback is disabled in hidden mode`,
      );
    }
    await withClipboardLock(async () => {
      const savedText = readClipboardText();
      try {
        writeClipboard(
          "text/uri-list",
          `${pathToFileURL(attachment.path).href}\r\n`,
        );
        await composer.focus();
        await page.keyboard.press("Control+V");
      } finally {
        writeClipboard("UTF8_STRING", savedText ?? "");
      }
    });
  }
  if (options.waitForUpload !== false) {
    await waitForAttachmentPreview(
      page,
      adapter,
      attachment.name,
      previousPreviewCount,
    );
  }
}

export async function setWebAttachmentInputFiles(page, filePath) {
  const inputs = page.locator("input[type='file']");
  for (let index = 0; index < (await inputs.count()); index += 1) {
    try {
      await inputs.nth(index).setInputFiles(filePath);
      return true;
    } catch {}
  }
  return false;
}

export async function waitForWebAttachment(page, adapter, attachment) {
  await waitForAttachmentPreview(page, adapter, attachment.name, 0);
}

export async function waitForWebAttachments(page, adapter, attachments) {
  const names = attachments.map((attachment) => attachment.name);
  const deadline = Date.now() + 120_000;
  let stablePolls = 0;
  const requiredStablePolls = adapter.name === "DeepSeek" ? 10 : 3;
  while (Date.now() < deadline) {
    let allVisible = true;
    let anyUploading = false;
    for (const name of names) {
      const visible = await attachmentNameVisible(page, adapter, name);
      const state = await attachmentTextState(page, name);
      if (state === "failed") {
        throw new Error(`${adapter.name} rejected ${name}`);
      }
      allVisible = allVisible && visible;
      anyUploading =
        anyUploading ||
        state === "uploading" ||
        (await anyVisible(page, adapter.attachmentUploading));
    }
    // Do not require the submit control here. DeepSeek can clear the
    // composer while a pasted file is being finalized; the prompt is
    // restored after this wait and send readiness is checked then.
    if (allVisible && !anyUploading) stablePolls += 1;
    else stablePolls = 0;
    if (stablePolls >= requiredStablePolls) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`${adapter.name} did not accept or finish uploading all attachments`);
}

async function waitForAttachmentPreview(
  page,
  adapter,
  name,
  previousPreviewCount,
) {
  const deadline = Date.now() + 120_000;
  let stablePolls = 0;
  const requiredStablePolls = adapter.name === "DeepSeek" ? 10 : 3;
  while (Date.now() < deadline) {
    const visible =
      (await attachmentNameVisible(page, adapter, name)) ||
      (await visibleAttachmentPreviewCount(page, adapter)) >
        previousPreviewCount;
    const state = await attachmentTextState(page, name);
    if (state === "failed") {
      throw new Error(`${adapter.name} rejected ${name}`);
    }
    const uploading =
      state === "uploading" ||
      (await anyVisible(page, adapter.attachmentUploading));
    // A visible file tile can be created before ChatGPT finishes uploading.
    // Require a stable ready signal across several polls, and never trust an
    // enabled send button while the tile still exposes a busy/progress state.
    // Send readiness is checked after the complete prompt is restored.
    if (visible && !uploading) stablePolls += 1;
    else stablePolls = 0;
    if (stablePolls >= requiredStablePolls) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`${adapter.name} did not accept or finish uploading ${name}`);
}

async function visibleAttachmentPreviewCount(page, adapter) {
  const previews = page.locator(selectorList(adapter.attachmentPreviews));
  let count = 0;
  for (let index = 0; index < (await previews.count()); index += 1) {
    if (await previews.nth(index).isVisible()) count += 1;
  }
  return count;
}

async function attachmentNameVisible(page, adapter, name) {
  const named = page.getByText(name, { exact: false });
  for (let index = 0; index < (await named.count()); index += 1) {
    if (await named.nth(index).isVisible()) return true;
  }
  const previews = page.locator(selectorList(adapter.attachmentPreviews));
  for (let index = 0; index < (await previews.count()); index += 1) {
    const preview = previews.nth(index);
    if (!(await preview.isVisible())) continue;
    const text = await preview.innerText().catch(() => "");
    if (text.includes(name)) return true;
  }
  return false;
}

async function attachmentTextState(page, name) {
  const body = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const related = body
    .split("\n")
    .filter((line) => line.includes(name))
    .join("\n");
  if (
    /上传失败|解析失败|不支持|unsupported|failed|请求过于频繁|too many requests|rate limit|temporarily restricted|访问对话记录/i.test(
      related,
    )
  ) {
    return "failed";
  }
  if (/上传中|解析中|处理中|uploading|processing/i.test(related)) {
    return "uploading";
  }
  return "ready";
}

function readClipboardText() {
  const result = spawnSync(
    "xclip",
    ["-selection", "clipboard", "-o", "-target", "UTF8_STRING"],
    { encoding: "utf8", timeout: 3_000 },
  );
  return result.status === 0 ? result.stdout : null;
}

function writeClipboard(target, input) {
  const result = spawnSync(
    "xclip",
    ["-selection", "clipboard", "-i", "-target", target],
    { input, encoding: "utf8", timeout: 3_000 },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "xclip failed");
  }
}

async function anyVisible(page, selectors) {
  const controls = page.locator(selectorList(selectors));
  for (let index = 0; index < (await controls.count()); index += 1) {
    if (await controls.nth(index).isVisible()) return true;
  }
  return false;
}
