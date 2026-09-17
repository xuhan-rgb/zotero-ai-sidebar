import {
  createFullTranslationState,
  loadFullTranslationState,
  reconcileFullTranslationState,
} from "../settings/full-translation-store";
import { parsePdfWithMineru } from "./mineru-client";
import {
  buildMineruTranslationDocument,
  pdfTranslationDocumentId,
} from "./mineru-document";
import {
  loadMineruCache,
  readPdfFingerprint,
  saveMineruCache,
} from "./mineru-store";
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
  fileName: string;
  token: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<FullTranslationSession> {
  const documentId = pdfTranslationDocumentId(options.itemKey);
  options.onProgress?.("正在读取 PDF…");
  const fingerprint = await readPdfFingerprint(options.pdfPath);
  const cached = await loadMineruCache(
    options.itemKey,
    fingerprint.size,
    fingerprint.mtime,
  );
  const parsed =
    cached ??
    (await parsePdfWithMineru(
      {
        name: options.fileName,
        bytes: fingerprint.bytes,
        dataId: options.itemKey,
      },
      {
        token: options.token,
        signal: options.signal,
        onProgress: (progress) => {
          options.onProgress?.(progressLabel(progress.state, progress.extractedPages, progress.totalPages));
        },
      },
    ));
  const document = buildMineruTranslationDocument(
    documentId,
    parsed.markdown,
    parsed.contentList,
  );
  if (!cached) {
    await saveMineruCache(options.itemKey, fingerprint, parsed, document.sourceHash);
  }
  const stored = await loadFullTranslationState(documentId, document.sourceHash);
  const state = stored
    ? reconcileFullTranslationState(stored, document)
    : createFullTranslationState(document, "", "");
  return { document, state, assets: {} };
}

function progressLabel(
  state: string,
  extracted?: number,
  total?: number,
): string {
  if (state === "waiting-file") return "正在上传 PDF…";
  if (state === "pending") return "MinerU 排队中…";
  if (state === "converting") return "MinerU 正在转换格式…";
  if (state === "running") {
    return total
      ? `MinerU 解析中（${extracted ?? 0}/${total} 页）…`
      : "MinerU 正在解析 PDF…";
  }
  if (state === "done") return "正在读取解析结果…";
  return "正在用 MinerU 解析 PDF…";
}
