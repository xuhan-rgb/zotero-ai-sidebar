import {
  readArxivMainText,
  readArxivMeta,
  readArxivBibliographyFiles,
} from "../context/arxiv-store";
import { fullDocumentReferences } from "./full-document-references";
import {
  ensureArxivSource,
  isFreshArxivSourceMeta,
} from "../context/arxiv-source";
import {
  createFullTranslationState,
  loadFullTranslationState,
  reconcileFullTranslationState,
  type FullTranslationState,
} from "../settings/full-translation-store";
import {
  buildFullTranslationDocument,
  type FullTranslationDocument,
} from "./full-document";
import type { FullTranslationAssetPreviews } from "./full-document-assets";

export interface FullTranslationSession {
  document: FullTranslationDocument;
  state: FullTranslationState;
  assets: FullTranslationAssetPreviews;
  runError?: string;
  preparing?: boolean;
}

export async function loadFullTranslationSession(
  arxivId: string,
): Promise<FullTranslationSession | null> {
  let meta = await readArxivMeta(arxivId);
  if (meta?.status !== "ok") return null;
  if (!isFreshArxivSourceMeta(meta)) {
    if (!(await ensureArxivSource({ arxivId }))) return null;
    meta = await readArxivMeta(arxivId);
    if (!isFreshArxivSourceMeta(meta)) return null;
  }
  const source = await readArxivMainText(arxivId);
  if (!source) return null;

  const document = buildFullTranslationDocument(arxivId, source);
  document.references = fullDocumentReferences(
    await readArxivBibliographyFiles(arxivId),
  );
  if (document.blocks.length === 0) return null;
  const cached = await loadFullTranslationState(arxivId, document.sourceHash);
  const state = cached
    ? reconcileFullTranslationState(cached, document)
    : createFullTranslationState(document, "", "");
  return { document, state, assets: {} };
}
