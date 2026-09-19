// reader-access: resolve the active Zotero PDF reader for a window/item/selection
// and read its current text selection. Foundation layer for pdf-navigation /
// pdf-quote / note-panel; depends only on sidebar-state + leaf utils, calls
// nothing back into sidebar.ts.

import type { SelectionAnnotationDraft } from "../context/agent-tools";
import { debugZai } from "./debug-utils";
import {
  formatSelectedTextSemantically,
  repairPdfSelectionLineBreaks,
} from "./selected-text-format";
import {
  contextPolicy,
  ignoredSelectedTextByItem,
  readerByAttachmentID,
  selectedAnnotationByItem,
  selectedTextByItem,
} from "./sidebar-state";

export function getStoredSelectedText(itemID: number | null): string {
  if (itemID == null) return "";
  const text = selectedTextByItem.get(itemID) ?? "";
  return text && ignoredSelectedTextByItem.get(itemID) !== text ? text : "";
}

export function getStoredSelectionAnnotation(
  itemID: number | null,
): SelectionAnnotationDraft | null {
  if (itemID == null) return null;
  const draft = selectedAnnotationByItem.get(itemID) ?? null;
  return draft && ignoredSelectedTextByItem.get(itemID) !== draft.text
    ? draft
    : null;
}

// `clearWhenEmpty` distinguishes the two callers:
// - Polling monitor (focusInSidebar=false ⇒ true): if the Reader has no
//   live selection AND the user is interacting with the sidebar, clear
//   stored selection so the chip disappears once the user starts typing.
// - Send-time read (false): keep the stored selection so a click on the
//   composer doesn't drop the selection chip the user just made.

export function getActiveReaderSelection(reader: unknown): string {
  const r = reader as any;
  return firstText([
    safeSelectionText(r?._internalReader?._primaryView?._iframeWindow),
    safeSelectionText(r?._internalReader?._secondaryView?._iframeWindow),
    safeSelectionText(r?._iframeWindow),
  ]);
}

export function activeReaderViews(reader: any): any[] {
  const views: any[] = [];
  const add = (view: unknown) => {
    if (view && !views.includes(view)) views.push(view);
  };
  add(reader?._internalReader?._primaryView);
  add(reader?._internalReader?._secondaryView);
  return views;
}

// The page the user is currently looking at, 0-based so it lines up with
// MinerU's `page_idx` and with Zotero's own pageIndex. The reader embeds a
// PDF.js viewer, which is the only place that knows the visible page.
export function activeReaderPageIndex(
  win: Window | null | undefined,
  itemID: number | null,
): number | null {
  return readerPageIndex(getPaperReaderForItem(win, itemID));
}

export function readerPageIndex(reader: unknown): number | null {
  for (const view of activeReaderViews(reader as any)) {
    const pageNumber = readerPageNumber(view);
    if (pageNumber != null) return pageNumber - 1;
  }
  return null;
}

/**
 * Reader text per page, used to place LaTeX floats (which carry no page numbers
 * of their own) on the page their caption renders on. The reader keeps `chars`
 * only for pages it has already rendered or searched (the same on-demand fill
 * its own search uses), so fill the missing pages first — otherwise a float
 * sitting on an unvisited page would look page-less.
 */
export async function activeReaderAllPageTexts(
  win: Window | null | undefined,
  itemID: number | null,
): Promise<string[] | undefined> {
  return readerAllPageTexts(getPaperReaderForItem(win, itemID));
}

export async function readerAllPageTexts(
  reader: unknown,
): Promise<string[] | undefined> {
  const view = activeReaderViews(reader as any)[0];
  if (!view?._pdfPages) return undefined;
  await ensureReaderPageData(view);
  return readerPageTexts(reader);
}

export function readerPageTexts(reader: unknown): string[] | undefined {
  const view = activeReaderViews(reader as any)[0];
  const pages = view?._pdfPages;
  if (!pages) return undefined;
  // Pages are keyed by 0-based index; keep the gaps so an index stays a page.
  const texts: string[] = [];
  for (const key of Object.keys(pages)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    texts[index] = readerCharsText(
      (pages as Record<string, { chars?: unknown }>)[key]?.chars,
    );
  }
  for (let index = 0; index < texts.length; index += 1) {
    if (typeof texts[index] !== "string") texts[index] = "";
  }
  return texts.some(Boolean) ? texts : undefined;
}

/** Caps how many pages one picker open may pull text for. */
const READER_PAGE_TEXT_MAX_PAGES = 80;

async function ensureReaderPageData(view: any): Promise<void> {
  const ensure = view?._ensureBasicPageData;
  if (typeof ensure !== "function") return;
  const total = Number(
    view?._iframeWindow?.PDFViewerApplication?.pdfDocument?.numPages,
  );
  if (!Number.isFinite(total) || total <= 0) return;
  const count = Math.min(Math.floor(total), READER_PAGE_TEXT_MAX_PAGES);
  for (let index = 0; index < count; index += 1) {
    if (view._pdfPages?.[index]?.chars) continue;
    try {
      await ensure.call(view, index);
    } catch {
      // A page that will not load simply stays unmarked.
    }
  }
}

function readerPageNumber(view: any): number | null {
  const value =
    view?._iframeWindow?.PDFViewerApplication?.pdfViewer?.currentPageNumber ??
    view?._pdfViewer?.currentPageNumber;
  const pageNumber = Number(value);
  return Number.isFinite(pageNumber) && pageNumber >= 1
    ? Math.floor(pageNumber)
    : null;
}

function readerCharsText(chars: unknown): string {
  if (!Array.isArray(chars)) return "";
  let text = "";
  for (const char of chars) {
    const value = (char as { c?: unknown })?.c;
    if (typeof value === "string") text += value;
  }
  return text;
}

export function readerItemIDs(
  reader: unknown,
  fallbackItemID: number | null,
): number[] {
  const r = reader as {
    itemID?: number;
    _item?: { id?: number; parentID?: number };
  } | null;
  const ids = [
    fallbackItemID,
    r?._item?.id,
    r?._item?.parentID,
    r?.itemID,
  ].filter((id): id is number => typeof id === "number");
  return [...new Set(ids)];
}

export function readerAttachmentID(reader: unknown): number | null {
  try {
    const r = reader as {
      itemID?: number;
      _item?: { id?: number };
    } | null;
    return typeof r?._item?.id === "number"
      ? r._item.id
      : typeof r?.itemID === "number"
        ? r.itemID
        : null;
  } catch {
    return null;
  }
}

// Active Reader = the reader instance for the foreground Zotero tab.
// REF: Zotero source `chrome/content/zotero/elements/zoteroTabs.js` for
//      Zotero_Tabs.selectedID; `chrome/content/zotero/reader.js` for
//      Reader.getByTabID. The chain optionals defend against the user
//      having no Reader tab open.

export function getActiveReader(win: Window | null | undefined): any {
  const tabID = (win as any)?.Zotero_Tabs?.selectedID;
  return tabID ? (Zotero as any).Reader?.getByTabID?.(tabID) : null;
}

// Returns the active Reader ONLY IF it's open on the same paper as the
// current chat thread. WHY this guard: agent tools that need PDF.js text
// (the highlight-write tool) must operate on the SAME paper the user is
// chatting about — otherwise we'd write a highlight to the wrong PDF.
// `activeReaderConversationItemID` walks attachment→parent so the match
// works whether the Reader is on the parent or the attachment.

export function getActiveReaderForItem(
  win: Window | null | undefined,
  itemID: number | null,
): any {
  if (!win || itemID == null) return null;
  const reader = getActiveReader(win);
  if (!reader) return null;
  return activeReaderConversationItemID(win) === itemID ? reader : null;
}

// Page lookups only READ from the PDF, so they may fall back to a reader
// Zotero keeps alive in a background tab: the user can be typing in the sidebar
// while another tab is selected, and the paper's page must still resolve.
// Anything that WRITES to the PDF keeps using getActiveReaderForItem, which is
// deliberately limited to the reader on screen.
export function getPaperReaderForItem(
  win: Window | null | undefined,
  itemID: number | null,
): any {
  const active = getActiveReaderForItem(win, itemID);
  if (active || itemID == null || typeof Zotero === "undefined") return active;
  return (
    allZoteroReaders().find(
      (reader) => readerConversationItemID(reader) === itemID,
    ) ?? null
  );
}

export function getReaderForCurrentSelection(
  win: Window | null | undefined,
  itemID: number | null,
): any {
  const draft = getStoredSelectionAnnotation(itemID);
  return getReaderForAttachmentOrItem(win, itemID, draft?.attachmentID ?? null);
}

export function getReaderForAttachmentOrItem(
  win: Window | null | undefined,
  itemID: number | null,
  attachmentID: number | null,
): any {
  const active = getActiveReaderForItem(win, itemID);
  if (!attachmentID || readerHasAttachmentID(active, attachmentID)) {
    return active;
  }

  const cached = readerByAttachmentID.get(attachmentID);
  if (readerHasAttachmentID(cached, attachmentID)) return cached;

  const readers = allZoteroReaders();
  const exact = readers.filter((reader) =>
    readerHasAttachmentID(reader, attachmentID),
  );
  const sameThread =
    exact.find((reader) => readerConversationItemID(reader) === itemID) ??
    exact[0];
  if (sameThread) return sameThread;

  debugZai("text-annotation.reader-missing", {
    itemID,
    attachmentID,
    activeAttachmentID: readerAttachmentID(active),
    knownReaders: readers.map((reader) => ({
      itemID: (reader as any)?.itemID,
      attachmentID: readerAttachmentID(reader),
      conversationItemID: readerConversationItemID(reader),
    })),
  });
  return active;
}

export function allZoteroReaders(): any[] {
  const readerAPI = (Zotero as any).Reader;
  const readers = Array.isArray(readerAPI?._readers) ? readerAPI._readers : [];
  return readers.filter(Boolean);
}

export function readerHasAttachmentID(reader: unknown, attachmentID: number): boolean {
  return readerAttachmentID(reader) === attachmentID;
}

export function readerConversationItemID(reader: unknown): number | null {
  try {
    const r = reader as {
      itemID?: number;
      _item?: { id?: number; parentID?: number };
    } | null;
    return typeof r?._item?.parentID === "number"
      ? r._item.parentID
      : typeof r?._item?.id === "number"
        ? itemIDToParentID(r._item.id)
        : itemIDToParentID(r?.itemID);
  } catch {
    return null;
  }
}

export function safeSelectionText(win: unknown): string {
  try {
    const selection = (win as Window | undefined)?.getSelection?.();
    if (!selection) return "";
    // Selections inside our own in-place translate/ask card must NOT leak into
    // the sidebar's selected-text context — the user is just copying 原文/译文.
    if (selectionInsidePluginOverlay(selection)) return "";
    return normalizeSelectedText(selection.toString());
  } catch {
    return "";
  }
}

function selectionInsidePluginOverlay(selection: Selection): boolean {
  const node = selection.anchorNode ?? selection.focusNode;
  if (!node) return false;
  const el =
    node.nodeType === 1
      ? (node as Element)
      : ((node as { parentElement?: Element | null }).parentElement ?? null);
  return !!el?.closest?.(".zai-translate-overlay,.zai-sentence-chooser");
}

export function firstText(values: string[]): string {
  return values.find(Boolean) ?? "";
}

export function normalizeSelectedText(text: unknown): string {
  if (typeof text !== "string") return "";
  const normalized = formatSelectedTextSemantically(
    repairPdfSelectionLineBreaks(text),
  );
  return normalized.length > contextPolicy.maxSelectedTextChars
    ? normalized.slice(0, contextPolicy.maxSelectedTextChars)
    : normalized;
}

export function activeReaderWindows(reader: any): Window[] {
  const windows: Window[] = [];
  const add = (value: unknown) => {
    const win = value as Window | null | undefined;
    if (win && !windows.includes(win)) windows.push(win);
  };
  add(reader?._internalReader?._primaryView?._iframeWindow);
  add(reader?._internalReader?._secondaryView?._iframeWindow);
  add(reader?._iframeWindow);
  return windows;
}

export function activeReaderConversationItemID(win: Window): number | null {
  const reader = getActiveReader(win);
  const r = reader as {
    itemID?: number;
    _item?: { id?: number; parentID?: number };
  } | null;
  return typeof r?._item?.parentID === "number"
    ? r._item.parentID
    : typeof r?._item?.id === "number"
      ? itemIDToParentID(r._item.id)
      : itemIDToParentID(r?.itemID);
}

export function conversationItemID(item: unknown): number | null {
  const i = item as {
    id?: number;
    parentID?: number;
    isAttachment?: () => boolean;
  } | null;
  if (!i) return null;
  if (typeof i.parentID === "number") return i.parentID;
  const id = i.id;
  return typeof id === "number" ? id : null;
}

export function itemIDToParentID(itemID: unknown): number | null {
  if (typeof itemID !== "number") return null;
  try {
    const item = Zotero.Items.get(itemID) as {
      id?: number;
      parentID?: number;
    } | null;
    return conversationItemID(item);
  } catch {
    return itemID;
  }
}
