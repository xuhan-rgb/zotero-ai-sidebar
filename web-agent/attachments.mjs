import { spawnSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
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

export async function stageWebAttachment(
  attachment,
  adapter,
  stagingDirectory,
) {
  const extension = adapter?.latexUploadExtension;
  if (attachment?.kind !== "latex" || !extension) return attachment;
  const sourceName = path.basename(attachment.name);
  const sourceExtension = path.extname(sourceName);
  const stem = sourceExtension
    ? sourceName.slice(0, -sourceExtension.length)
    : sourceName;
  const targetName = `${stem}${extension}`;
  await mkdir(stagingDirectory, { recursive: true });
  const targetPath = path.join(stagingDirectory, targetName);
  await copyFile(attachment.path, targetPath);
  return {
    ...attachment,
    path: targetPath,
    name: targetName,
    mimeType: "text/plain",
  };
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
  const uploadedThroughChooser = uploadedThroughInput
    ? false
    : await setWebAttachmentThroughChooser(page, adapter, attachment);
  if (!uploadedThroughInput && !uploadedThroughChooser) {
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
  const candidates = [];
  for (let index = 0; index < (await inputs.count()); index += 1) {
    const input = inputs.nth(index);
    const accept =
      typeof input.getAttribute === "function"
        ? await input.getAttribute("accept").catch(() => "")
        : "";
    const score = attachmentInputScore(accept || "", filePath);
    if (score >= 0) candidates.push({ input, score, index });
  }
  candidates.sort(
    (left, right) => right.score - left.score || left.index - right.index,
  );
  for (const { input } of candidates) {
    try {
      await input.setInputFiles(filePath);
      return true;
    } catch {}
  }
  return false;
}

async function setWebAttachmentThroughChooser(page, adapter, attachment) {
  if (
    !adapter.attachmentTrigger?.length ||
    typeof page.waitForEvent !== "function"
  ) {
    return false;
  }
  const triggers = page.locator(selectorList(adapter.attachmentTrigger));
  for (let index = 0; index < (await triggers.count()); index += 1) {
    const trigger = triggers.nth(index);
    if (!(await trigger.isVisible().catch(() => false))) continue;
    const chooserPromise = page
      .waitForEvent("filechooser", { timeout: 3_000 })
      .catch(() => null);
    if (
      !(await trigger
        .click({ force: true })
        .then(() => true)
        .catch(() => false))
    ) {
      await chooserPromise;
      continue;
    }
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(attachment.path);
      return true;
    }
    if (await setWebAttachmentInputFiles(page, attachment.path)) return true;
  }
  return false;
}

function attachmentInputScore(accept, filePath) {
  const values = String(accept)
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length || values.includes("*/*")) return 0;
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === ".pdf" ? "application/pdf" : "text/plain";
  if (values.includes(extension) || values.includes(mimeType)) return 2;
  if (mimeType.startsWith("text/") && values.includes("text/*")) return 1;
  return -1;
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
  const nameCandidates = adapter.looseAttachmentNames
    ? attachmentVisibleNameCandidates(name)
    : [{ text: name, exact: false }];
  for (const candidate of nameCandidates) {
    const named = page.getByText(candidate.text, { exact: candidate.exact });
    for (let index = 0; index < (await named.count()); index += 1) {
      if (await named.nth(index).isVisible()) return true;
    }
  }
  const previews = page.locator(selectorList(adapter.attachmentPreviews));
  for (let index = 0; index < (await previews.count()); index += 1) {
    const preview = previews.nth(index);
    if (!(await preview.isVisible())) continue;
    const text = await preview.innerText().catch(() => "");
    if (attachmentPreviewMatchesName(text, name)) return true;
  }
  return false;
}

export function attachmentVisibleNameCandidates(name) {
  const fileName = path.basename(String(name));
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  const candidates = [{ text: fileName, exact: true }];
  if (stem !== fileName) candidates.push({ text: stem, exact: true });
  if (stem.length > 20) {
    candidates.push({ text: stem.slice(0, 20), exact: false });
  }
  return candidates;
}

export function attachmentPreviewMatchesName(text, name) {
  const visibleText = String(text).toLowerCase();
  const fileName = path.basename(String(name)).toLowerCase();
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  if (visibleText.includes(fileName) || visibleText.includes(stem)) return true;
  const displayName = visibleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  const truncatedPrefix = displayName.split(/(?:…|\.\.\.)/, 1)[0].trim();
  return truncatedPrefix.length >= 8 && stem.startsWith(truncatedPrefix);
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
