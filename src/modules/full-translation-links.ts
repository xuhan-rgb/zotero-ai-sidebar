import { copyToClipboard } from "./clipboard-utils";
import type { FullTranslationDocument } from "../translate/full-document";
import { renderMarkdownInto } from "./markdown-render";

export function attachFullTranslationLinks(
  root: HTMLElement,
  document: FullTranslationDocument,
): void {
  const doc = root.ownerDocument!;
  const content = root.querySelector<HTMLElement>(".zai-ft-content");
  if (!content) return;
  const references = new Map(
    (document.references ?? []).map((ref) => [String(ref.number), ref]),
  );
  const targets = new Map<string, HTMLElement>();
  for (const block of document.blocks) {
    const kind =
      block.kind === "figure-caption"
        ? "figure"
        : block.kind === "table-caption"
          ? "table"
          : "";
    if (!kind || block.number === undefined) continue;
    const row = [
      ...content.querySelectorAll<HTMLElement>("[data-block-id]"),
    ].find((row) => row.dataset.blockId === block.id);
    if (row) targets.set(`${kind}-${block.number}`, row);
  }
  const overlay = doc.createElement("div");
  overlay.className = "zai-ft-reference-overlay";
  overlay.hidden = true;
  const panel = doc.createElement("section");
  panel.className = "zai-ft-reference-dialog";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "引用详情");
  const title = doc.createElement("h3");
  const close = doc.createElement("button");
  close.type = "button";
  close.textContent = "关闭 ×";
  const body = doc.createElement("div");
  body.className = "zai-ft-reference-body";
  panel.append(title, close, body);
  overlay.append(panel);
  root.append(overlay);
  let origin: HTMLElement | null = null;
  const dismiss = () => {
    overlay.hidden = true;
    body.replaceChildren();
    origin?.focus({ preventScroll: true });
  };
  close.addEventListener("click", dismiss);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismiss();
  });
  overlay.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
    if ((event as KeyboardEvent).key === "Tab") {
      event.preventDefault();
      const copy = body.querySelector<HTMLButtonElement>(".zai-ft-reference-copy");
      if (copy && doc.activeElement === close) copy.focus();
      else close.focus();
    }
  });
  const show = (heading: string, from: HTMLElement) => {
    origin = from;
    title.textContent = heading;
    overlay.hidden = false;
    panel.style.position = "";
    panel.style.top = "";
    panel.style.bottom = "";
    panel.style.maxHeight = "";
    if (from.classList.contains("zai-ft-citation-link")) {
      const bounds = root.getBoundingClientRect();
      const anchor = from.getBoundingClientRect();
      const below = Math.max(0, bounds.bottom - anchor.bottom - 24);
      const above = Math.max(0, anchor.top - bounds.top - 24);
      const useBelow = below >= Math.min(panel.scrollHeight, 300) || below >= above;
      panel.style.position = "absolute";
      panel.style.maxHeight = `${Math.max(0, useBelow ? below : above)}px`;
      if (useBelow) panel.style.top = `${anchor.bottom - bounds.top + 12}px`;
      else panel.style.bottom = `${bounds.bottom - anchor.top + 12}px`;
    }
    close.focus({ preventScroll: true });
  };
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "zai-ft-reference-back";
  back.textContent = "↩ 返回引用位置";
  back.hidden = true;
  root.append(back);
  let jumpOrigin: HTMLElement | null = null;
  back.addEventListener("click", () => {
    jumpOrigin?.scrollIntoView({ block: "center" });
    jumpOrigin?.focus({ preventScroll: true });
    back.hidden = true;
  });
  // Markdown can emit a citation as several adjacent text nodes.
  content.normalize();
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(content, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (
      node.parentElement?.closest(".zai-ft-block-body") &&
      !node.parentElement.closest("a,button,.katex,pre,code")
    )
      nodes.push(node);
  }
  const pattern =
    /\[(\d+(?:\s*[,，–-]\s*\d+)*)\]|(?:Figure\s*|Fig\.\s*|图\s*)(\d+)(?:\s*[（(][a-z][）)])?|(?:Table\s*|表\s*)(\d+)/g;
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      fragment.append(text.slice(cursor, match.index));
      if (match[1]) {
        // Keep punctuation and ranges as printed; each endpoint remains clickable.
        fragment.append("[");
        for (const part of match[1].split(/(\d+)/)) {
          const reference = references.get(part);
          if (!reference) {
            fragment.append(part);
            continue;
          }
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "zai-ft-citation-link";
          button.textContent = part;
          button.setAttribute("aria-label", `查看参考文献 ${part}`);
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            body.replaceChildren();
            const text = doc.createElement("div");
            renderMarkdownInto(text, reference.text);
            const note = doc.createElement("small");
            note.textContent = "来自本文参考文献列表，编号沿用原文。";
            const copy = doc.createElement("button");
            copy.type = "button";
            copy.className = "zai-ft-reference-copy";
            copy.textContent = "复制文献";
            copy.setAttribute("aria-live", "polite");
            copy.addEventListener("click", async () => {
              copy.disabled = true;
              try {
                await copyToClipboard(doc, text.textContent ?? "");
                copy.textContent = "已复制";
              } catch {
                copy.textContent = "复制失败，请重试";
              } finally {
                copy.disabled = false;
              }
            });
            body.append(text, note, copy);
            show(`参考文献 [${part}]`, button);
          });
          fragment.append(button);
        }
        fragment.append("]");
      } else {
        const target = targets.get(
          match[2] ? `figure-${match[2]}` : `table-${match[3]}`,
        );
        if (!target) fragment.append(match[0]);
        else {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "zai-ft-object-link";
          button.textContent = match[0];
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            jumpOrigin = button;
            back.hidden = false;
            target.scrollIntoView({ block: "center" });
          });
          fragment.append(button);
        }
      }
      cursor = pattern.lastIndex;
    }
    if (cursor) {
      fragment.append(text.slice(cursor));
      node.replaceWith(fragment);
    }
  }
  // Delegation also covers figure previews populated asynchronously.
  content.addEventListener("click", (event) => {
    const image = (event.target as Element | null)?.closest(
      ".zai-ft-asset img",
    ) as HTMLImageElement | null;
    if (!image) return;
    const preview = image.cloneNode(true) as HTMLImageElement;
    preview.removeAttribute("role");
    preview.removeAttribute("tabindex");
    body.replaceChildren(preview);
    show(image.alt || "查看图片", image);
  });
  content.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    const image = (event.target as Element | null)?.closest(
      ".zai-ft-asset img",
    ) as HTMLImageElement | null;
    if (image && (key === "Enter" || key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      image.click();
    }
  });
}
