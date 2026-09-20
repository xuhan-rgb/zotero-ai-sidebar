import { stat } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setWebAttachmentInputFiles } from "./attachments.mjs";

const drafts = new WeakMap();
const UPLOAD_TIMEOUT_MS = 120_000;

// Executed in the page. Derive the boundary from the actual composer, never
// from the document-wide file-name matches (which also include old messages).
export function readDeepSeekDraft(composer, { name, previews, uploading, rootSelector, readOnly = false }) {
  let root = rootSelector ? composer.closest(rootSelector) : composer.parentElement;
  while (root && !root.querySelector("input[type='file']"))
    root = root.parentElement;
  if (
    !root ||
    root === document.body ||
    root === document.documentElement ||
    root.querySelector(".ds-message")
  ) {
    throw new Error("无法确认 DeepSeek 当前输入框的附件区域，已停止上传");
  }
  const visible = (node) => {
    for (
      let current = node;
      current && current !== root.parentElement;
      current = current.parentElement
    ) {
      const style = getComputedStyle(current);
      if (
        current.hidden ||
        current.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      )
        return false;
    }
    return true;
  };
  const text = (node) => node.innerText || node.textContent || "";
  const imageName = (node) =>
    node.querySelector("img[alt]")?.getAttribute("alt") || "";
  const labelText = (node) => imageName(node) || text(node);
  const stem = name.replace(/\.[^.]+$/, "").toLowerCase();
  const matches = (node) => {
    const values = [text(node), node.getAttribute("title") || "", imageName(node)];
    return values.some((value) =>
      value
        .toLowerCase()
        .split(/\r?\n/)
        .some((line) => {
          const label = line.trim();
          if (label === name.toLowerCase() || label === stem) return true;
          if (!/…|\.\.\./.test(label)) return false;
          const prefix = label.split(/…|\.\.\./)[0].trim();
          return prefix.length >= 8 && stem.startsWith(prefix);
        }),
    );
  };
  const previewNodes = [...root.querySelectorAll(previews)].filter(
    (node) =>
      node.tagName !== "INPUT" && !node.contains(composer) && visible(node),
  );
  const candidates = previewNodes.filter(matches);
  // A file tile and its nested file-name nodes describe one attachment.
  const leaves = candidates.filter(
    (node) =>
      !candidates.some((other) => other !== node && node.contains(other)),
  );
  const id = (node, attribute) => {
    if (!node.hasAttribute(attribute) && !readOnly)
      node.setAttribute(attribute, crypto.randomUUID());
    return node.getAttribute(attribute);
  };
  const otherCandidates = previewNodes.filter((node) => {
    if (matches(node)) return false;
    const label = (node.getAttribute("title") || labelText(node))
      .trim()
      .split(/\r?\n/)[0];
    return /\.[a-z][a-z0-9]{0,9}$/i.test(label) || /…|\.\.\./.test(label);
  });
  const otherLeaves = otherCandidates.filter(
    (node) =>
      !otherCandidates.some((other) => other !== node && node.contains(other)),
  );
  const rootId = id(root, "data-zai-draft-root");
  const body = previewNodes.map(text).join("\n");
  const busyNodes = [...root.querySelectorAll(uploading)].filter(visible);
  const busyText =
    body.match(
      /上传中|解析中|处理中|等待解析|uploading|processing|waiting to parse|queued for parsing/i,
    )?.[0] || "";
  const describe = (node) => ({
    tag: node.tagName,
    class: (node.getAttribute("class") || "").slice(0, 240),
    title: (node.getAttribute("title") || "").slice(0, 160),
    text: node.contains(composer) ? "" : text(node).slice(0, 200),
    containsComposer: node.contains(composer),
  });
  return {
    rootId,
    diagnostics: {
      root: describe(root),
      previewNodeCount: previewNodes.length,
      matchingNodeCount: candidates.length,
      previews: previewNodes.slice(0, 8).map(describe),
      busyText,
      busyNodeCount: busyNodes.length,
      busyNodes: busyNodes.slice(0, 8).map((node) => ({
        ...describe(node),
        selectors: uploading
          .split(",")
          .filter((selector) => node.matches(selector.trim())),
      })),
    },
    cards: leaves.map((node) => ({
      id: id(node, "data-zai-draft-file"),
      text: labelText(node),
    })),
    otherCards: otherLeaves.map((node) => ({
      id: id(node, "data-zai-draft-file"),
      text: labelText(node),
    })),
    busy: busyNodes.length > 0 || !!busyText,
    failed:
      /上传失败|解析失败|文件不支持|unsupported file|upload failed|请求过于频繁|too many requests/i.test(
        body,
      ),
  };
}

export async function uploadDeepSeekAttachments(
  page,
  composer,
  adapter,
  attachments,
  draftKey,
) {
  const startedAt = Date.now();
  const log = (event, details = {}) => {
    const line = JSON.stringify({
      time: new Date().toISOString(), draftKey,
      elapsedMs: Date.now() - startedAt, event, ...details,
    });
    console.info("[web-agent][deepseek-upload]", line);
    try {
      appendFileSync(join(dirname(fileURLToPath(import.meta.url)), "upload-diagnostics.jsonl"), `${line}\n`, { mode: 0o600 });
    } catch (error) {
      console.warn("[web-agent] Could not persist upload diagnostics:", error.message);
    }
  };
  log("start", { files: attachments.map((attachment) => attachment.name) });
  try {
    await runDeepSeekUploads(
      page,
      composer,
      adapter,
      attachments,
      draftKey,
      log,
    );
    log("complete");
  } catch (error) {
    log("failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function runDeepSeekUploads(
  page,
  composer,
  adapter,
  attachments,
  draftKey,
  log,
) {
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  let draft = drafts.get(page);
  if (!draft || draft.key !== draftKey) {
    draft = { key: draftKey, files: new Map() };
    drafts.set(page, draft);
  }
  const lastSnapshots = new Map();
  const snapshot = async (name) => {
    const state = await composer.evaluate(readDeepSeekDraft, {
      name,
      rootSelector: adapter.attachmentRoot,
      previews: adapter.attachmentPreviews.join(", "),
      uploading: adapter.attachmentUploading.join(", "),
    });
    const key = JSON.stringify(state);
    if (lastSnapshots.get(name) !== key) {
      lastSnapshots.set(name, key);
      log("state", { name, ...state });
    }
    return state;
  };
  if (!attachments.length) return;
  const initial = await snapshot(attachments[0].name);
  if (draft.rootId !== initial.rootId) {
    draft.files.clear();
    draft.rootId = initial.rootId;
  }
  for (const [filePath, record] of draft.files) {
    if (attachments.some((attachment) => attachment.path === filePath))
      continue;
    if ((await snapshot(record.name)).cards.length) {
      throw new Error("DeepSeek 草稿仍有上次任务的其他附件，请处理草稿后重试");
    }
  }
  const rejectUnknownCards = (state) => {
    const known = new Set(
      [...draft.files.values()].map((record) => record.cardId).filter(Boolean),
    );
    if ((state.otherCards || []).some((card) => !known.has(card.id))) {
      throw new Error(
        "DeepSeek 草稿中有未确认归属的其他附件，请处理草稿后重试",
      );
    }
  };
  for (const attachment of attachments) {
    const info = await stat(attachment.path);
    const fingerprint = JSON.stringify([
      attachment.path,
      info.size,
      info.mtimeMs,
    ]);
    let state = await snapshot(attachment.name);
    rejectUnknownCards(state);
    if (state.failed) throw new Error(`DeepSeek 拒绝了附件 ${attachment.name}`);
    const previous = draft.files.get(attachment.path);
    const reusable =
      previous?.fingerprint === fingerprint &&
      previous.rootId === state.rootId &&
      state.cards.length === 1 &&
      (!previous.cardId || previous.cardId === state.cards[0].id);
    if (state.cards.length && !reusable) {
      throw new Error(
        `DeepSeek 草稿中已有 ${attachment.name}，无法确认附件归属；请处理草稿后重试，未重复上传`,
      );
    }
    const pending =
      previous?.fingerprint === fingerprint && previous.rootId === state.rootId;
    if (reusable || pending)
      log("reuse_or_observe", { name: attachment.name, reusable, pending });
    // A previous attempt without a preview may still be arriving on this page.
    if (!reusable && !pending) {
      draft.files.set(attachment.path, {
        fingerprint,
        rootId: state.rootId,
        name: attachment.name,
      });
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("DeepSeek 附件上传等待超时");
      try {
        log("input_start", {
          name: attachment.name,
          timeoutMs: Math.min(30_000, remaining),
        });
        const accepted = await setWebAttachmentInputFiles(
          page.locator(`[data-zai-draft-root="${state.rootId}"]`),
          attachment.path,
          { timeout: Math.min(30_000, remaining) },
        );
        log("input_returned", { name: attachment.name, accepted });
        if (!accepted)
          throw new Error("DeepSeek 当前输入框没有可用的文件上传入口");
      } catch (error) {
        if (error?.name !== "TimeoutError") throw error;
        log("input_timeout_observing", { name: attachment.name });
        // Continue observing until the same deadline; never upload a second copy.
      }
    }
    let stable = 0;
    while (Date.now() < deadline) {
      state = await snapshot(attachment.name);
      rejectUnknownCards(state);
      const record = draft.files.get(attachment.path);
      if (state.failed)
        throw new Error(`DeepSeek 拒绝了附件 ${attachment.name}`);
      if (record.rootId !== state.rootId || state.cards.length > 1) {
        throw new Error(
          `DeepSeek 草稿附件状态发生变化，无法确认 ${attachment.name}，已停止发送`,
        );
      }
      if (state.cards.length === 1) {
        if (record.cardId && record.cardId !== state.cards[0].id) {
          throw new Error(
            `DeepSeek 草稿附件已变化，无法确认 ${attachment.name}`,
          );
        }
        record.cardId = state.cards[0].id;
        stable = state.busy ? 0 : stable + 1;
        if (stable >= 3) {
          log("ready", { name: attachment.name });
          break;
        }
      } else stable = 0;
      await page.waitForTimeout(
        Math.min(500, Math.max(0, deadline - Date.now())),
      );
    }
    if (stable < 3)
      throw new Error(
        `DeepSeek 无法确认 ${attachment.name} 已上传就绪；未自动重传，请检查草稿`,
      );
  }
}
