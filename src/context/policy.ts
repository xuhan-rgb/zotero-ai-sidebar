// Single source of truth for every context/tool budget.
// WHY: Codex-style harness keeps the model in charge of *what* to fetch,
//      while the *limits* live here so we can audit prompt-blowup risk in
//      one place. New magic numbers belong in this file (see CLAUDE.md).
// REF: docs/HARNESS_ENGINEERING.md, OpenAI Codex `protocol::TurnContext` budgets.
export interface ContextPolicy {
  // --- PDF retrieval / full-text budgets ---------------------------------
  // Hard cap on `zotero_get_full_pdf` output. INVARIANT: tokens ≈ chars / 4
  // (rough OAI/Anthropic heuristic), so 60k tokens ≈ 240k chars sent to model.
  fullPdfTokenBudget: number;
  // Soft budget kept for legacy planner code; kept here so future search-side
  // prompts can size their context blocks uniformly.
  searchContextTokenBudget: number;
  // Default `topK` returned by `zotero_search_pdf` when the model omits it.
  searchCandidateCount: number;
  // Cap on a single PDF *selection* attached as UI context. GOTCHA: this is
  // user-attached selected text, NOT model-requested retrieval — a bigger
  // budget than per-passage to allow long highlights.
  maxSelectedTextChars: number;
  // Per-passage cap during `splitIntoPassages`. Larger ⇒ fewer/longer chunks
  // (better recall on long arguments); smaller ⇒ more granular scoring.
  maxPassageChars: number;
  // Sliding-window overlap so a sentence split across two passages still
  // matches as a phrase in at least one of them.
  passageOverlapChars: number;
  // Cap on `zotero_read_pdf_range` slices. WHY: bounds a model that asks for
  // an absurd `[0, 10_000_000]` range without a prior search hit.
  maxRangeChars: number;

  // --- Overview map ------------------------------------------------------
  // Hard cap on the whole `zotero_outline_pdf` output (skeleton is cheap).
  outlineCharBudget: number;
  // Per-section body preview length the model reads to write a gist.
  outlinePreviewChars: number;
  // Cap on returned sections.
  maxOutlineEntries: number;
  // Even-window count when headings are too sparse to detect.
  outlineFallbackWindows: number;
  // Max entries in the overview "↶ 返回" back stack (session-scoped reading
  // navigation). Pure hygiene cap on a list you basically never fill — no UI.
  overviewBackStackMax: number;

  // --- Public GitHub network-diagram analysis ---------------------------
  // Maximum text returned from one repository file read. Source bodies enter
  // the model only through exact line ranges; small config/docs may be whole.
  githubMaxFileChars: number;
  // Maximum inclusive line span for one source-evidence read. Navigation may
  // inspect a whole symbol outline, but bodies enter the model in small ranges.
  githubMaxRangeLines: number;
  // Aggregate source text returned to the diagram agent during one run.
  // There is deliberately NO file-count limit: repositories split modules at
  // very different granularities, so completion is driven by evidence/detail.
  githubAnalysisCharBudget: number;
  // Maximum directory-manifest text included in one model/tool response.
  githubTreeManifestCharBudget: number;
  // Smaller path preview repeated in every network-diagram model round. The
  // full bounded manifest remains available through github_list_paths.
  githubPromptTreeManifestCharBudget: number;
  // Network safety fuses. These bound remote work without turning a number of
  // files into analysis routing or an early-completion condition.
  githubRequestBudget: number;
  // Fixed-commit tarballs are cached only for the network-diagram analyzer.
  // Per-file and aggregate limits prevent a repository from expanding without
  // bound inside the Zotero data directory.
  githubSnapshotMaxFileBytes: number;
  githubSnapshotMaxBytes: number;
  githubAnalysisTimeoutMs: number;
  // Network-diagram research has a large fixed tool schema and therefore a
  // tighter runaway-loop fuse than ordinary conversation. Completion is still
  // decided by graph/evidence validation, never by this count.
  githubMaxToolIterations: number;

  // --- Annotation handling ----------------------------------------------
  // Cap on annotations returned by `zotero_get_annotations` so a heavily
  // marked-up paper (hundreds of highlights) cannot flood the prompt.
  maxAnnotations: number;

  // --- Context ledger / multi-turn replay -------------------------------
  // How many recent user turns are eligible for context replay (see
  // retainedRecentContextIndexes in message-format.ts).
  retainedContextTurnCount: number;
  // Char budget shared across replayed turns. INVARIANT: the ledger replays
  // metadata only past this budget — it never re-sends full PDFs.
  retainedContextCharBudget: number;
  // Upper clamp on model-supplied `topK` for `zotero_search_pdf`.
  maxSearchTopK: number;
  // Reserved for future planner pipelines that pre-select passages.
  maxSelectedPassages: number;
  // Cap when reading Zotero's full-text cache file from disk. WHY: avoid
  // pinning hundreds of MB into JS memory for absurdly long PDFs.
  fullTextCacheReadCharLimit: number;

  // --- Formula repair diagnostics --------------------------------------
  // Heuristic-only detector for PDF-cache formula garble. It marks
  // vertically fragmented math-like text runs so a future repair pipeline can
  // locate/crop/transcribe them; it must stay conservative around clean prose.
  garbledFormulaMinRunLines: number;
  garbledFormulaShortLineChars: number;
  garbledFormulaMaxLineChars: number;
  garbledFormulaAsciiLineMaxChars: number;
  garbledFormulaMinMathLineFraction: number;
  garbledFormulaMinShortLineFraction: number;
  garbledFormulaMinFormulaPunctuation: number;

  // --- Tool-loop safety fuse --------------------------------------------
  // Hard ceiling on agent tool iterations per turn. INVARIANT: this is a
  // *safety fuse* that prevents runaway loops — it is NOT routing logic
  // (do not condition behavior on iteration count, see CLAUDE.md).
  maxToolIterations: number;

  // --- Annotation write tools ------------------------------------------
  // Char cap on user-selection annotation comments.
  maxAnnotationCommentChars: number;
  // Char cap on each highlight comment (Chinese reading note ≤ 80 chars).
  maxFullTextHighlightCommentChars: number;
  // Confidence threshold for `pdfLocator.locate` to accept a fuzzy passage
  // match. Below this we refuse to write an annotation to avoid mis-pinning.
  minLocateConfidence: number;
  formulaRenderScale: number;
  formulaRenderMaxEdgePx: number;
  formulaCropPaddingPt: number;
  maxFiguresPerPaper: number;
  transcribeBatchSize: number;
  paperBuildTimeoutMs: number;
  maxArxivSourceBytes: number;
  arxivFetchTimeoutMs: number;
}

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  fullPdfTokenBudget: 60_000,
  searchContextTokenBudget: 100_000,
  searchCandidateCount: 8,
  maxSelectedTextChars: 20_000,
  maxPassageChars: 1200,
  passageOverlapChars: 160,
  maxRangeChars: 9000,
  outlineCharBudget: 4000,
  outlinePreviewChars: 120,
  maxOutlineEntries: 40,
  outlineFallbackWindows: 6,
  overviewBackStackMax: 10,
  githubMaxFileChars: 16_000,
  githubMaxRangeLines: 160,
  githubAnalysisCharBudget: 160_000,
  githubTreeManifestCharBudget: 24_000,
  githubPromptTreeManifestCharBudget: 8_000,
  githubRequestBudget: 200,
  githubSnapshotMaxFileBytes: 4_000_000,
  githubSnapshotMaxBytes: 100_000_000,
  githubAnalysisTimeoutMs: 420_000,
  githubMaxToolIterations: 12,
  maxAnnotations: 80,
  retainedContextTurnCount: 4,
  retainedContextCharBudget: 8000,
  maxSearchTopK: 8,
  maxSelectedPassages: 3,
  fullTextCacheReadCharLimit: 400_000,
  garbledFormulaMinRunLines: 5,
  garbledFormulaShortLineChars: 3,
  garbledFormulaMaxLineChars: 100,
  garbledFormulaAsciiLineMaxChars: 32,
  garbledFormulaMinMathLineFraction: 0.25,
  garbledFormulaMinShortLineFraction: 0.35,
  garbledFormulaMinFormulaPunctuation: 2,
  maxToolIterations: 100,
  maxAnnotationCommentChars: 4000,
  maxFullTextHighlightCommentChars: 80,
  minLocateConfidence: 0.85,
  formulaRenderScale: 3,
  formulaRenderMaxEdgePx: 2000,
  formulaCropPaddingPt: 6,
  maxFiguresPerPaper: 60,
  transcribeBatchSize: 6,
  paperBuildTimeoutMs: 120_000,
  maxArxivSourceBytes: 80_000_000,
  arxivFetchTimeoutMs: 60_000,
};
