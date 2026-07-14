// Resolve an arXiv id from Zotero item metadata fields. Pure — no I/O.

export interface ArxivIdFields {
  extra?: string;
  url?: string;
  doi?: string;
  archiveID?: string;
}

interface ZoteroArxivItem {
  id?: number;
  key?: string;
  libraryID?: number;
  parentID?: number;
  getField?(field: string): string;
  getAttachments?(): number[];
}

interface ZoteroItemsApi {
  get?(id: number): ZoteroArxivItem | false | null | undefined;
  getByLibraryAndKey?(
    libraryID: number,
    itemKey: string,
  ): ZoteroArxivItem | false | null | undefined;
}

// new-style: 2504.16054 (+ optional v3); legacy: hep-th/9901001 (+ optional v2)
// The digit groups are bounded by (^|\D) and (\D|$) so a slice of a longer
// numeric run (e.g. ...678.3539... inside a non-arXiv DOI) is not matched.
const NEW_STYLE = /(?:^|\D)(\d{4}\.\d{4,5})(v\d+)?(?:\D|$)/;
const LEGACY_STYLE = /([a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;

function extractArxivId(text: string): string | null {
  // Anchor on an "arxiv" mention when present, to avoid matching stray
  // numbers (e.g. a non-arXiv DOI). Fall back to a bare scan otherwise.
  const anchored = text.match(/ar[xX]iv[:.\s/]*([^\s]+)/);
  const haystacks = anchored ? [anchored[1], text] : [text];
  for (const h of haystacks) {
    const m = h.match(NEW_STYLE) ?? h.match(LEGACY_STYLE);
    if (m) return `${m[1]}${m[2] ?? ""}`;
  }
  return null;
}

export function resolveArxivId(fields: ArxivIdFields): string | null {
  for (const raw of [fields.extra, fields.archiveID, fields.url, fields.doi]) {
    const id = raw ? extractArxivId(raw) : null;
    if (id) return id;
  }
  return null;
}

export function resolveArxivIdFromZoteroItems(
  items: ZoteroArxivItem[],
): string | null {
  const fieldNames: Array<[string, keyof ArxivIdFields]> = [
    ["extra", "extra"],
    ["archiveID", "archiveID"],
    ["url", "url"],
    ["DOI", "doi"],
  ];
  for (const [fieldName, arxivField] of fieldNames) {
    for (const item of items) {
      const value = itemField(item, fieldName);
      const arxivId = value ? resolveArxivId({ [arxivField]: value }) : null;
      if (arxivId) return arxivId;
    }
  }
  return null;
}

export function resolveArxivIdForLibraryItem(
  libraryID: number,
  itemKey: string,
): string | null {
  try {
    const items = zoteroItems();
    if (!items) return null;
    const item = items?.getByLibraryAndKey?.(libraryID, itemKey);
    return item ? resolveArxivIdForZoteroItem(item, items) : null;
  } catch {
    return null;
  }
}

export function resolveArxivIdForItemID(itemID: number | null): string | null {
  if (itemID == null) return null;
  try {
    const items = zoteroItems();
    if (!items) return null;
    const item = items?.get?.(itemID);
    if (!item) return null;
    if (
      typeof item.libraryID === "number" &&
      typeof item.key === "string" &&
      items.getByLibraryAndKey
    ) {
      return resolveArxivIdForLibraryItem(item.libraryID, item.key);
    }
    return resolveArxivIdForZoteroItem(item, items);
  } catch {
    return null;
  }
}

function resolveArxivIdForZoteroItem(
  item: ZoteroArxivItem,
  items: ZoteroItemsApi,
): string | null {
  const related: ZoteroArxivItem[] = [];
  const parent =
    typeof item.parentID === "number" ? items.get?.(item.parentID) : null;
  const root = parent || item;
  if (parent) related.push(parent);
  related.push(item);
  try {
    for (const attachmentID of root.getAttachments?.() ?? []) {
      const attachment = items.get?.(attachmentID);
      if (attachment && !related.includes(attachment)) related.push(attachment);
    }
  } catch {
    // Attachment metadata is best-effort; the selected item may still identify arXiv.
  }
  return resolveArxivIdFromZoteroItems(related);
}

function itemField(item: ZoteroArxivItem, field: string): string {
  try {
    const value = item.getField?.(field);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function zoteroItems(): ZoteroItemsApi | null {
  return (
    (globalThis as unknown as { Zotero?: { Items?: ZoteroItemsApi } }).Zotero
      ?.Items ?? null
  );
}
