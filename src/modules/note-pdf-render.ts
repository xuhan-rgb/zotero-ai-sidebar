// note-pdf-render: locate PDF quote blocks in the reader, decorate quote/jump
// buttons, and render assistant content into Zotero note HTML carrying PDF
// selection/quote jump links. Depends on pdf-navigation + reader-access +
// pdf-quote-utils + note-pdf-link + leaf utils; pure move, no logic changes.

import { createPdfLocator, getSharedPdfLocator } from "../context/pdf-locator";
import type { PdfSelectionLocator } from "../providers/types";
import {
  debugZai,
  errorMessage,
  htmlStringDebugInfo,
  textDebugInfo,
} from "./debug-utils";
import { renderMarkdownInto } from "./markdown-render";
import { getZoteroItem } from "./note-dedicated";
import {
  NOTE_PDF_QUOTE_HASH_MARKER,
  NOTE_PDF_SELECTION_HASH_MARKER,
  pdfSelectionForNoteData,
} from "./note-pdf-link";
import {
  jumpToPdfSelectionPreview,
  pdfSelectionLocatorFromLocateResult,
  setTempLoadMarkStatus,
} from "./pdf-navigation";
import {
  firstPdfQuoteLocateCandidate,
  pdfQuoteBlockLocateText,
  pdfQuoteBlocks,
  pdfQuoteConfidenceFloor,
  pdfQuoteLinkKey,
  pdfQuoteLocateCandidates,
} from "./pdf-quote-utils";
import {
  getReaderForAttachmentOrItem,
  readerAttachmentID,
} from "./reader-access";
import {
  assignHrefWithDebug,
  encodeURIComponentWithDebug,
  readingRouteStringDiagnostics,
  setAttributeWithDebug,
} from "./reading-route-debug";
import {
  PDF_QUOTE_BUTTON_LIMIT,
  PDF_QUOTE_MIN_CHARS,
  pdfQuoteLocateCache,
  type PanelState,
} from "./sidebar-state";

export interface PdfQuoteButtonOptions {
  onJump?: (quote: string, block: HTMLElement) => void | Promise<void>;
  sourceItemID?: number | null;
  preferredAttachmentID?: number | null;
  preferredPageIndex?: number | null;
  quoteLinks?: Map<string, PdfSelectionLocator>;
}

export function installPdfQuoteButtonsInElement(
  root: HTMLElement,
  options: PdfQuoteButtonOptions = {},
): void {
  const blocks = pdfQuoteBlocks(root, PDF_QUOTE_MIN_CHARS).slice(
    0,
    PDF_QUOTE_BUTTON_LIMIT,
  );
  if (!blocks.length) return;
  for (const block of blocks) {
    // Idempotent across re-renders: chat blocks carry the .zai-pdf-quote-block
    // class, note blocks carry an <a.zai-pdf-quote-jump> child.
    if (
      block.classList.contains("zai-pdf-quote-block") ||
      block.querySelector(".zai-pdf-quote-jump")
    )
      continue;
    const quote = firstPdfQuoteLocateCandidate(
      pdfQuoteBlockLocateText(block),
      PDF_QUOTE_MIN_CHARS,
    );
    if (!quote) continue;
    wrapPdfQuoteBlock(block, quote, {
      ...options,
      prelocatedSelection: options.quoteLinks?.get(pdfQuoteLinkKey(quote)),
    });
  }
}

type PdfQuoteBlockOptions = PdfQuoteButtonOptions & {
  prelocatedSelection?: PdfSelectionLocator;
};

export async function locatePdfQuoteBlock(
  locator: Awaited<ReturnType<typeof createPdfLocator>>,
  rawText: string,
  preferredPageIndex: number | null = null,
): Promise<PdfSelectionLocator | null> {
  const scopedPageIndex = normalizedPreferredPageIndex(
    preferredPageIndex,
    locator.pageCount,
  );
  if (scopedPageIndex != null) {
    const scoped = await locatePdfQuoteBlockInScope(
      locator,
      rawText,
      scopedPageIndex,
      false,
    );
    if (scoped) return scoped;
  }
  return locatePdfQuoteBlockInScope(locator, rawText, null, true);
}

export async function locatePdfQuoteBlockInScope(
  locator: Awaited<ReturnType<typeof createPdfLocator>>,
  rawText: string,
  pageIndex: number | null,
  logMiss: boolean,
): Promise<PdfSelectionLocator | null> {
  const candidates = pdfQuoteLocateCandidates(rawText, PDF_QUOTE_MIN_CHARS);

  // Phase 1 — exact match, every candidate. `indexOf` is cheap and page
  // bundles are memoized, so trying all candidates here costs almost nothing.
  // The model usually quotes text verbatim from getFullText() output, so this
  // resolves most jumps — and a verbatim sentence inside a noise-perturbed
  // full quote is now found here instead of after a full fuzzy scan of the
  // full quote. Only quotes with NO verbatim candidate fall through to fuzzy.
  for (const quote of candidates) {
    const exact = await locator.locate(quote, {
      exactOnly: true,
      ...(pageIndex != null ? { pageIndex } : {}),
    });
    if (exact) {
      return pdfSelectionLocatorFromLocateResult(
        locator.attachmentID,
        exact.matchedText || quote,
        exact,
      );
    }
  }

  // Phase 2 — fuzzy fallback, reached only when nothing matched verbatim.
  let bestConfidence = 0;
  for (const quote of candidates) {
    // Locate with no floor, then gate with a length-aware confidence floor
    // here. Gating ourselves also lets a miss report how close it got — for
    // diagnosing quotes that fail to jump — without paying for a second scan.
    const result = await locator.locate(quote, {
      minConfidence: 0,
      ...(pageIndex != null ? { pageIndex } : {}),
    });
    if (!result) continue;
    if (result.confidence > bestConfidence) bestConfidence = result.confidence;
    if (result.confidence >= pdfQuoteConfidenceFloor(quote.length)) {
      return pdfSelectionLocatorFromLocateResult(
        locator.attachmentID,
        result.matchedText || quote,
        result,
      );
    }
  }
  if (logMiss && candidates.length) {
    debugZai("pdf-quote.locate.miss", {
      candidates: candidates.length,
      bestConfidence: Number(bestConfidence.toFixed(3)),
      head: candidates[0]!.slice(0, 80),
    });
  }
  return null;
}

export function normalizedPreferredPageIndex(
  pageIndex: number | null | undefined,
  pageCount: number,
): number | null {
  if (
    typeof pageIndex !== "number" ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= pageCount
  ) {
    return null;
  }
  return pageIndex;
}

export async function jumpToPdfQuote(
  mount: HTMLElement,
  state: PanelState,
  quote: string,
  preferredAttachmentID: number | null = null,
  _button?: HTMLElement,
  sourceItemID: number | null = null,
  preferredPageIndex: number | null = null,
): Promise<void> {
  setTempLoadMarkStatus(mount, "原文定位中");
  try {
    const itemID = sourceItemID ?? state.itemID;
    const locator = await locatePdfQuoteForItem(
      mount.ownerDocument!,
      itemID,
      quote,
      preferredAttachmentID,
      preferredPageIndex,
    );
    if (!locator) {
      setTempLoadMarkStatus(mount, "原文未定位");
      return;
    }
    setTempLoadMarkStatus(mount, "原文定位");
    void jumpToPdfSelectionPreview(mount, state, locator);
  } catch (err) {
    setTempLoadMarkStatus(mount, "原文异常");
    debugZai("pdf-quote.jump.failed", { error: errorMessage(err) });
  }
}

export async function locatePdfQuoteForItem(
  doc: Document,
  itemID: number | null,
  rawText: string,
  preferredAttachmentID: number | null = null,
  preferredPageIndex: number | null = null,
): Promise<PdfSelectionLocator | null> {
  if (itemID == null) return null;
  const quote = firstPdfQuoteLocateCandidate(rawText, PDF_QUOTE_MIN_CHARS);
  if (!quote) return null;
  const reader = getReaderForAttachmentOrItem(
    doc.defaultView,
    itemID,
    preferredAttachmentID,
  );
  if (!reader) return null;
  const attachmentID = preferredAttachmentID ?? readerAttachmentID(reader) ?? 0;
  const pageKey =
    preferredPageIndex != null &&
    Number.isInteger(preferredPageIndex) &&
    preferredPageIndex >= 0
      ? preferredPageIndex
      : "";
  const cacheKey = [itemID, attachmentID, pageKey, quote].join("\u0001");
  const cached = pdfQuoteLocateCache.get(cacheKey);
  if (cached) return cached;
  const promise = locatePdfQuoteWithReader(
    reader,
    quote,
    preferredPageIndex,
  ).catch((err) => {
    debugZai("pdf-quote.locate.failed", { error: errorMessage(err) });
    return null;
  });
  pdfQuoteLocateCache.set(cacheKey, promise);
  trimPdfQuoteLocateCache();
  return promise;
}

export async function locatePdfQuoteWithReader(
  reader: unknown,
  quote: string,
  preferredPageIndex: number | null = null,
): Promise<PdfSelectionLocator | null> {
  // Reuse a cached locator (see getSharedPdfLocator) instead of rebuilding and
  // disposing one per click. It is intentionally not disposed here: the
  // locator lives as long as its Reader and is collected together with it.
  const locator = await getSharedPdfLocator(reader);
  return locatePdfQuoteBlock(locator, quote, preferredPageIndex);
}

export function trimPdfQuoteLocateCache(): void {
  while (pdfQuoteLocateCache.size > 160) {
    const first = pdfQuoteLocateCache.keys().next().value;
    if (typeof first !== "string") return;
    pdfQuoteLocateCache.delete(first);
  }
}

export function wrapPdfQuoteBlock(
  block: HTMLElement,
  quote: string,
  options: PdfQuoteBlockOptions = {},
): void {
  // Chat: the whole quote block IS the click target — no separate marker.
  // A live click listener works because chat DOM is never serialized.
  if (options.onJump) {
    decoratePdfQuoteBlockClickable(block, quote, options.onJump);
    return;
  }
  // Note: a saved note is serialized HTML with no live listeners, so the jump
  // must ride on an <a> whose hash href installZoteroNotePdfJumpLinks reopens.
  appendNotePdfQuoteLink(block, quote, options);
}

export function decoratePdfQuoteBlockClickable(
  block: HTMLElement,
  quote: string,
  onJump: NonNullable<PdfQuoteButtonOptions["onJump"]>,
): void {
  block.classList.add("zai-pdf-quote-block");
  block.title = "点击跳到 PDF 原文，并选中这段论据";
  // A persistent low-key 「原文」 marker at the end so the quote reads as
  // clickable without hovering. A <span> (not <a>) — a click on it still
  // bubbles to the block listener below.
  const marker = block.ownerDocument!.createElement("span");
  marker.className = "zai-pdf-quote-jump";
  marker.textContent = "原文";
  block.append(marker);
  block.addEventListener("click", (event) => {
    // Clicking a real link inside the quote, or finishing a drag-selection,
    // must not be hijacked into a jump.
    if ((event.target as Element | null)?.closest?.("a")) return;
    const selection = block.ownerDocument?.defaultView?.getSelection();
    if (selection && !selection.isCollapsed) return;
    event.preventDefault();
    event.stopPropagation();
    markActiveQuoteElement(block);
    void onJump(quote, block);
  });
}

// Keep the quote the user last jumped from visibly "selected" — exactly one
// at a time. Scoped per document, so the chat panel and the note-editor
// iframe each track their own active quote independently.

export function markActiveQuoteElement(target: Element): void {
  target.ownerDocument
    ?.querySelectorAll(".zai-pdf-quote-active")
    .forEach((el: Element) => el.classList.remove("zai-pdf-quote-active"));
  target.classList.add("zai-pdf-quote-active");
}

export function appendNotePdfQuoteLink(
  block: HTMLElement,
  quote: string,
  options: PdfQuoteBlockOptions,
): void {
  const doc = block.ownerDocument!;
  const link = doc.createElement("a");
  link.className = "zai-pdf-quote-jump";
  link.textContent = "原文";
  link.title = "点击回到 PDF 原文，并选中这段论据";
  link.dataset.zaiPdfQuoteLink = "true";
  if (options.prelocatedSelection) {
    applyPdfSelectionLinkAttributes(link, options.prelocatedSelection);
  } else {
    applyPdfQuoteLinkAttributes(
      link,
      quote,
      options.sourceItemID ?? null,
      options.preferredAttachmentID ?? null,
      options.preferredPageIndex ?? null,
    );
  }
  block.append(link);
}

export async function assistantContentToNoteHTML(
  doc: Document,
  itemID: number | null,
  content: string,
  pdfSelection: PdfSelectionLocator | null = null,
): Promise<string> {
  const root = doc.createElement("div");
  root.append(doc.createElement("hr"));

  const title = doc.createElement("h2");
  title.textContent = `AI 总结 ${formatNoteTimestamp(new Date())}`;
  root.append(title);

  const jump = renderNotePdfSelectionJump(doc, pdfSelection);
  if (jump) root.append(jump);

  const body = doc.createElement("div");
  // Notes path: keep $..$ / $$..$$ as plain text. Zotero's note editor
  // (and Better Notes' ProseMirror schema) strips KaTeX-produced HTML and
  // MathML wrappers; the only math syntax that consistently round-trips
  // is the LaTeX source inside dollar delimiters, which Better Notes
  // re-renders via its own KaTeX pass. See the comment in
  // appendInlineMarkdown above for the failure modes we'd hit otherwise.
  renderMarkdownInto(body, content.trim(), "source");
  installPdfQuoteButtonsInElement(body, { sourceItemID: itemID });
  while (body.firstChild) root.appendChild(body.firstChild);
  return String(root.innerHTML);
}

export function renderNotePdfSelectionJump(
  doc: Document,
  pdfSelection: PdfSelectionLocator | null,
): HTMLElement | null {
  if (!pdfSelection) return null;
  const href = pdfOpenUrlForSelection(pdfSelection);
  if (!href) return null;

  const row = doc.createElement("p");
  row.className = "zai-note-pdf-jump";
  const link = doc.createElement("a");
  link.className = "zai-note-pdf-selection-link";
  link.textContent = `↗ 查看 PDF 原选区${pdfSelectionPageLabel(pdfSelection)}`;
  link.title = previewSelection(pdfSelection.selectedText);
  applyPdfSelectionLinkAttributes(link, pdfSelection, href);
  row.append(link);
  return row;
}

export function applyPdfSelectionLinkAttributes(
  link: HTMLAnchorElement,
  selection: PdfSelectionLocator,
  baseHref: string = pdfOpenUrlForSelection(selection),
): void {
  const data = JSON.stringify(pdfSelectionForNoteData(selection));
  const detail = {
    attachmentID: selection.attachmentID,
    pageIndex: selection.pageIndex,
    selectedText: textDebugInfo(selection.selectedText ?? "", 160),
    data: textDebugInfo(data, 160),
  };
  const encoded = encodeURIComponentWithDebug(data, "pdf-selection", detail);
  assignHrefWithDebug(
    link,
    `${baseHref || "#"}${NOTE_PDF_SELECTION_HASH_MARKER}${encoded}`,
    "pdf-selection",
    detail,
  );
  setAttributeWithDebug(
    link,
    "data-zai-pdf-selection",
    data,
    "pdf-selection",
    detail,
  );
}

export function applyPdfQuoteLinkAttributes(
  link: HTMLAnchorElement,
  quote: string,
  sourceItemID: number | null = null,
  preferredAttachmentID: number | null = null,
  preferredPageIndex: number | null = null,
): void {
  const payload =
    sourceItemID == null &&
    preferredAttachmentID == null &&
    preferredPageIndex == null
      ? quote
      : JSON.stringify({
          quote,
          ...(sourceItemID != null ? { sourceItemID } : {}),
          ...(preferredAttachmentID != null ? { preferredAttachmentID } : {}),
          ...(preferredPageIndex != null ? { preferredPageIndex } : {}),
        });
  const detail = {
    sourceItemID,
    preferredAttachmentID,
    preferredPageIndex,
    quote: textDebugInfo(quote, 160),
    quoteChars: readingRouteStringDiagnostics(quote),
    payload: textDebugInfo(payload, 160),
  };
  const encoded = encodeURIComponentWithDebug(payload, "pdf-quote", detail);
  assignHrefWithDebug(
    link,
    `#${NOTE_PDF_QUOTE_HASH_MARKER.slice(1)}${encoded}`,
    "pdf-quote",
    detail,
  );
  setAttributeWithDebug(link, "data-zai-pdf-quote", quote, "pdf-quote", detail);
  if (sourceItemID != null) {
    setAttributeWithDebug(
      link,
      "data-zai-pdf-source-item-id",
      String(sourceItemID),
      "pdf-quote",
      detail,
    );
  }
  if (preferredAttachmentID != null) {
    setAttributeWithDebug(
      link,
      "data-zai-pdf-source-attachment-id",
      String(preferredAttachmentID),
      "pdf-quote",
      detail,
    );
  }
  if (preferredPageIndex != null) {
    setAttributeWithDebug(
      link,
      "data-zai-pdf-source-page-index",
      String(preferredPageIndex),
      "pdf-quote",
      detail,
    );
  }
}

export function pdfSelectionPageLabel(selection: PdfSelectionLocator): string {
  const label = selection.pageLabel ?? String((selection.pageIndex ?? 0) + 1);
  return label ? `（第 ${label} 页）` : "";
}

export function pdfOpenUrlForSelection(selection: PdfSelectionLocator): string {
  const attachment = getZoteroItem(selection.attachmentID);
  const key = (attachment as any)?.key;
  if (!attachment || !key) return "";

  const page = encodeURIComponent(
    String(selection.pageIndex != null ? selection.pageIndex + 1 : 1),
  );
  const itemURI =
    typeof (Zotero as any).URI?.getItemURI === "function"
      ? String((Zotero as any).URI.getItemURI(attachment))
      : "";
  const group = itemURI.match(/\/groups\/(\d+)\/items\/[^/?#]+/);
  if (group) {
    return `zotero://open-pdf/groups/${encodeURIComponent(
      group[1]!,
    )}/items/${encodeURIComponent(key)}?page=${page}`;
  }
  return `zotero://open-pdf/library/items/${encodeURIComponent(
    key,
  )}?page=${page}`;
}

export async function insertHTMLIntoNote(
  note: Zotero.Item,
  html: string,
  forceMetadata = false,
): Promise<boolean> {
  const betterNotesInsert = betterNotesNoteInsert();
  const before = note.getNote?.() || "";
  debugZai("note-insert:start", {
    noteID: note.id,
    forceMetadata,
    betterNotes: Boolean(betterNotesInsert),
    before: textDebugInfo(before, 120),
    beforeHTML: htmlStringDebugInfo(before),
    html: htmlStringDebugInfo(html),
  });
  if (betterNotesInsert) {
    try {
      await betterNotesInsert(note, html, -1, forceMetadata);
      const after = note.getNote?.() || "";
      debugZai("note-insert:better-notes-done", {
        noteID: note.id,
        after: textDebugInfo(after, 120),
        afterHTML: htmlStringDebugInfo(after),
      });
      return true;
    } catch (err) {
      debugZai("note-insert:better-notes-failed:fallback", {
        noteID: note.id,
        error: errorMessage(err),
      });
    }
  }

  note.setNote(appendHTMLToExistingNote(note.getNote() || "", html));
  await note.saveTx();
  const after = note.getNote?.() || "";
  debugZai("note-insert:zotero-done", {
    noteID: note.id,
    after: textDebugInfo(after, 120),
    afterHTML: htmlStringDebugInfo(after),
  });
  return false;
}

export function betterNotesInsertAvailable(): boolean {
  return !!betterNotesNoteInsert();
}

export function betterNotesNoteInsert():
  | ((
      note: Zotero.Item,
      html: string,
      lineIndex?: number,
      forceMetadata?: boolean,
    ) => Promise<void> | void)
  | null {
  const noteApi = (
    Zotero as unknown as {
      BetterNotes?: {
        api?: {
          note?: {
            insert?: (
              note: Zotero.Item,
              html: string,
              lineIndex?: number,
              forceMetadata?: boolean,
            ) => Promise<void> | void;
          };
        };
      };
    }
  ).BetterNotes?.api?.note;
  return typeof noteApi?.insert === "function"
    ? noteApi.insert.bind(noteApi)
    : null;
}

export function appendHTMLToExistingNote(existing: string, addition: string): string {
  if (!existing.trim()) return `<div>${addition}</div>`;
  const closingDiv = existing.lastIndexOf("</div>");
  if (closingDiv >= 0 && existing.slice(closingDiv).trim() === "</div>") {
    return `${existing.slice(0, closingDiv)}${addition}${existing.slice(
      closingDiv,
    )}`;
  }
  return `${existing}${addition}`;
}

export function formatNoteTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

// Render the assistant's "建议注释" block (parsed by annotation-draft.ts).
// READ-ONLY display until the user clicks "保存". INVARIANT: this is NOT a
// hidden write — saving requires a button click and routes through
// `saveAnnotationDraftFromBubble`, which goes through the same Zotero
// annotation API as a manual annotation. CLAUDE.md "No hidden Zotero writes".

export function previewSelection(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 60)}…`;
}
