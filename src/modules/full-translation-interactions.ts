import type { FullTranslationBlock } from "../translate/full-document";
import { splitSentences } from "../translate/sentence-splitter";

export interface FullTranslationSourceSelection {
  blockId: string;
  selectedText: string;
  displayText: string;
  origin: "source" | "translation";
}

export function mapTranslationSelectionToSource(
  source: string,
  renderedTranslation: string,
  selectionStart: number,
  selectionEnd: number,
): string {
  const sourceSentences = splitSentences(source);
  const translationSentences = splitSentences(renderedTranslation);
  if (!sourceSentences.length || !translationSentences.length) return "";

  const start = clamp(
    Math.min(selectionStart, selectionEnd),
    0,
    renderedTranslation.length,
  );
  const end = clamp(
    Math.max(selectionStart, selectionEnd),
    start,
    renderedTranslation.length,
  );
  if (end <= start) return "";

  const selectedIndexes = translationSentences
    .map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) => sentence.end > start && sentence.start < end)
    .map(({ index }) => index);
  if (!selectedIndexes.length) return "";

  const firstTranslation = selectedIndexes[0]!;
  const lastTranslation = selectedIndexes[selectedIndexes.length - 1]!;
  const firstSource = Math.floor(
    (firstTranslation * sourceSentences.length) / translationSentences.length,
  );
  const sourceEnd = Math.max(
    firstSource + 1,
    Math.ceil(
      ((lastTranslation + 1) * sourceSentences.length) /
        translationSentences.length,
    ),
  );
  return sourceSentences
    .slice(firstSource, sourceEnd)
    .map((sentence) => sentence.text)
    .join(" ")
    .trim();
}

export function readFullTranslationSourceSelection(
  root: HTMLElement,
  blocks: readonly FullTranslationBlock[],
): FullTranslationSourceSelection | null {
  const selection = root.ownerDocument?.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startBody = closestBlockBody(root, range.startContainer);
  const endBody = closestBlockBody(root, range.endContainer);
  if (!startBody || startBody !== endBody) return null;

  const cell = startBody.closest(
    ".zai-ft-translation, .zai-ft-source",
  ) as HTMLElement | null;
  const row = cell?.closest(
    ".zai-ft-block[data-block-id]",
  ) as HTMLElement | null;
  if (!cell || !row || !root.contains(row)) return null;
  const block = blocks.find(
    (candidate) => candidate.id === row.dataset.blockId,
  );
  if (!block) return null;

  const offsets = selectionOffsets(startBody, range);
  if (!offsets) return null;
  const selectedText = mapTranslationSelectionToSource(
    block.source,
    offsets.text,
    offsets.start,
    offsets.end,
  );
  const displayText = range.toString().replace(/\s+/g, " ").trim();
  return selectedText && displayText
    ? {
        blockId: block.id,
        selectedText,
        displayText,
        origin: cell.classList.contains("zai-ft-translation")
          ? "translation"
          : "source",
      }
    : null;
}

export function findFullTranslationSourceBlockId(
  blocks: readonly FullTranslationBlock[],
  quote: string,
): string | null {
  const candidates = [quote, ...splitSentences(quote).map((item) => item.text)]
    .map(normalizeSourceSearchText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (!candidates.length) return null;

  const sources = blocks.map((block) => ({
    id: block.id,
    text: normalizeSourceSearchText(block.source),
  }));
  for (const candidate of candidates) {
    const match = sources.find(({ text }) => text.includes(candidate));
    if (match) return match.id;
  }
  return null;
}

function closestBlockBody(root: HTMLElement, node: Node): HTMLElement | null {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const body = (element?.closest(".zai-ft-block-body") ??
    null) as HTMLElement | null;
  return body && root.contains(body) ? body : null;
}

function selectionOffsets(
  body: HTMLElement,
  selection: Range,
): { text: string; start: number; end: number } | null {
  if (
    !body.contains(selection.startContainer) ||
    !body.contains(selection.endContainer)
  ) {
    return null;
  }
  const doc = body.ownerDocument;
  if (!doc) return null;
  const whole = doc.createRange();
  whole.selectNodeContents(body);
  const beforeStart = whole.cloneRange();
  beforeStart.setEnd(selection.startContainer, selection.startOffset);
  const beforeEnd = whole.cloneRange();
  beforeEnd.setEnd(selection.endContainer, selection.endOffset);
  return {
    text: whole.toString(),
    start: beforeStart.toString().length,
    end: beforeEnd.toString().length,
  };
}

function normalizeSourceSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\\(?:cite|ref|label)\*?(?:\[[^\]]*\])?\{[^{}]*\}/gi, "")
    .replace(/\\([A-Za-z]+)\*?\{([^{}]*)\}/g, "$2")
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/[$`*_~#{}]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
