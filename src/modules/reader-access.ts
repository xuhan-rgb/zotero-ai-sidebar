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
    return normalizeSelectedText(
      (win as Window | undefined)?.getSelection?.()?.toString(),
    );
  } catch {
    return "";
  }
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
