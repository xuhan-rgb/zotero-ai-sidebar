// MessageContext schema for context-card display + ledger formatting.
// Each `planMode` value below maps to one tool/UI path:
//   none / metadata_only / annotations / search_pdf / pdf_range /
//   selected_text / full_pdf / remote_paper / reader_pdf_text /
//   annotation_write / equation / figure / table / previous_context.
// INVARIANT: this is descriptive metadata captured AFTER the model picks
// a tool — not a planner schema. The model's choice is the planner.
export type ContextMode =
  | "none"
  | "metadata_only"
  | "annotations"
  | "search_pdf"
  | "pdf_range"
  | "selected_text"
  | "full_pdf"
  | "remote_paper"
  | "reader_pdf_text"
  | "annotation_write"
  | "note_write"
  | "mindmap"
  | "bibliography"
  | "equation"
  | "figure"
  | "table"
  | "outline"
  | "overview"
  | "previous_context";

export type ContextPlanSource = "selected" | "model" | "fallback";
export type ContextSelectionSource = "model" | "fallback";
export type ContextSourceKind = "zotero_item" | "arxiv";

export interface ToolTrace {
  name: string;
  status: "started" | "completed" | "error";
  summary?: string;
}

export interface PromptCacheDebug {
  provider: string;
  requestPath: string;
  endpoint: string;
  model: string;
  presetID: string;
  promptCacheKey: string;
  promptCacheKeySent: boolean;
  promptCacheRetention?: string;
  promptCacheMechanism: string;
  reasoningSent: boolean;
  reasoningDetail: string;
  toolsSent: string[];
  toolsHash: string;
  systemPromptHash: string;
  frontBlockHash?: string;
  frontBlockChars?: number;
  stablePrefixHash: string;
  replayContentHash?: string;
  replayContentChars?: number;
}

export interface RetrievedPassage {
  text: string;
  score: number;
  start: number;
  end: number;
}

export interface ItemAnnotation {
  type: string;
  text: string;
  comment?: string;
  pageLabel?: string;
  color?: string;
  sortIndex?: number;
}

export interface MessageContext {
  sourceKind?: ContextSourceKind;
  sourceID?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  selectedText?: string;
  explainSelection?: boolean;
  // Per-turn override from the composer "+ 本轮原文" button. It forces the
  // frozen full text front block for this selected-text message only.
  pinnedFullTextForced?: boolean;
  annotationSuggestion?: boolean;
  annotationColorGuide?: string;
  // Captured at the moment the user message was submitted (whether the
  // task ran immediately or was queued for later). Lets a queued task that
  // runs later still anchor its "建议注释" card to the original PDF
  // selection — without this, the live selection at the time the queued
  // task fires would be used (or none), breaking the contract that the
  // selection follows the message that was typed against it.
  queuedAnnotationSnapshot?: {
    text: string;
    attachmentID: number;
    annotation: Record<string, unknown>;
  };
  queuedAnnotationColorEnabled?: boolean;
  planMode?: ContextMode;
  planReason?: string;
  plannerSource?: ContextPlanSource;
  query?: string;
  rangeStart?: number;
  rangeEnd?: number;
  annotations?: ItemAnnotation[];
  candidatePassageCount?: number;
  selectedPassageNumbers?: number[];
  passageSelectionReason?: string;
  passageSelectorSource?: ContextSelectionSource;
  retrievedPassages?: RetrievedPassage[];
  fullTextChars?: number;
  fullTextTotalChars?: number;
  fullTextTruncated?: boolean;
  bibliographyChars?: number;
  bibliographyFiles?: string[];
  equationNumber?: number;
  equationLabel?: string;
  equationChars?: number;
  figureNumber?: number;
  figureLabel?: string;
  figureCaption?: string;
  figureImageAttached?: boolean;
  tableNumber?: number;
  tableLabel?: string;
  tableCaption?: string;
  tableChars?: number;
  /** Where the full text came from. "arxiv" → the cleaned LaTeX source
   *  (formulas exact). "arxiv_toc" → just the section index (bodies are
   *  fetched on demand via `arxiv_get_section`). Absent or "pdf" → the
   *  PDF text layer. */
  fullTextSource?: "arxiv" | "arxiv_toc" | "pdf";
  /** Debug-only file path for the exact [Paper full text] front block that
   *  was sent this turn. Saved only when the sidebar 调试 toggle is on. */
  frontBlockDebugPath?: string;
  retainedContextCount?: number;
  retainedContextChars?: number;
  // Hidden prompt-only snapshot captured when the user turn is submitted.
  // Replaying this with the same user turn keeps future prompts append-only
  // instead of rewriting the system prompt with a fresh ledger each turn.
  promptCacheLedger?: string;
  // Hidden prompt-only snapshot of the exact user-turn wire content sent
  // when a front block carries the large PDF text. Later turns replay this
  // small content verbatim so the previous request remains a prefix of the
  // next one, matching Codex's prompt-cache layout without resending PDF text.
  promptCacheWireContent?: string;
  promptCacheDebug?: PromptCacheDebug;
  toolCalls?: ToolTrace[];
}
