import {
  createFullTranslationState,
  loadFullTranslationState,
  reconcileFullTranslationState,
} from "../settings/full-translation-store";
import {
  buildMineruTranslationDocument,
  pdfTranslationDocumentId,
} from "./mineru-document";
import { loadMineruCache, readPdfFingerprint } from "./mineru-store";
import type { FullTranslationSession } from "./full-document-session";

export { pdfTranslationDocumentId };

export async function resolveItemPdfForMineru(
  itemID: number,
): Promise<{ path: string; name: string; itemKey: string } | null> {
  const selected = getItem(itemID);
  if (!selected) return null;
  const root =
    typeof selected.parentID === "number"
      ? getItem(selected.parentID) || selected
      : selected;
  const itemKey =
    (typeof root.key === "string" && root.key) ||
    (typeof selected.key === "string" && selected.key) ||
    "";
  if (!itemKey) return null;
  const candidates = isPdf(selected)
    ? [selected]
    : (root.getAttachments?.() ?? [])
        .map((id) => getItem(id))
        .filter((item): item is ZoteroMineruItem => !!item && isPdf(item));
  for (const item of candidates) {
    const path = await item.getFilePathAsync?.();
    if (path) {
      return {
        path,
        name: path.split(/[\\/]/).pop() || "paper.pdf",
        itemKey,
      };
    }
  }
  return null;
}

interface ZoteroMineruItem {
  key?: string;
  parentID?: number;
  attachmentContentType?: string;
  getAttachments?(): number[];
  isAttachment?(): boolean;
  isPDFAttachment?(): boolean;
  getFilePathAsync?(): Promise<string | false>;
}

function getItem(id: number): ZoteroMineruItem | null {
  try {
    const item = (
      globalThis as unknown as {
        Zotero: { Items: { get(id: number): ZoteroMineruItem | false | null } };
      }
    ).Zotero.Items.get(id);
    return item || null;
  } catch {
    return null;
  }
}

function isPdf(item: ZoteroMineruItem): boolean {
  return (
    item.isPDFAttachment?.() === true ||
    item.attachmentContentType === "application/pdf"
  );
}

export async function loadMineruFullTranslationSession(options: {
  itemKey: string;
  pdfPath: string;
}): Promise<FullTranslationSession> {
  const documentId = pdfTranslationDocumentId(options.itemKey);
  const fingerprint = await readPdfFingerprint(options.pdfPath);
  const cached = await loadMineruCache(
    options.itemKey,
    fingerprint.size,
    fingerprint.mtime,
  );
  if (!cached) {
    throw new Error("PDF 尚未解析完成，请等待解析后再打开全文翻译。");
  }
  const document = buildMineruTranslationDocument(
    documentId,
    cached.markdown,
    cached.contentList,
  );
  const stored = await loadFullTranslationState(documentId, document.sourceHash);
  const state = stored
    ? reconcileFullTranslationState(stored, document)
    : createFullTranslationState(document, "", "");
  let removedError = false;
  for (const block of document.blocks) {
    if (!block.translatable && state.blocks[block.id]?.status !== "skipped") {
      removedError ||= state.blocks[block.id]?.status === "error";
      state.blocks[block.id] = { status: "skipped" };
    }
  }
  if (removedError && !Object.values(state.blocks).some((block) => block.status === "error")) {
    delete state.lastError;
  }
  return { document, state, assets: {} };
}
