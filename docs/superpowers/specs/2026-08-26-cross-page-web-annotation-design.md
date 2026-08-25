# Cross-page WEB annotation design

## Goal

Allow one WEB annotation draft to preserve a quoted sentence that crosses two
adjacent PDF pages. The sidebar continues to present one logical draft, while
Zotero stores one precise highlight per page.

## Safety constraints

- Keep the existing single-page location and save path unchanged.
- Attempt cross-page repair only after the normal full-quote locator fails.
- Consider only the end of page `n` plus the beginning of page `n + 1`.
- Compare after removing supported author-year citations, but build both saved
  highlights from the Reader's original page text.
- Require ordered-token similarity of at least 90 percent and a token-length
  ratio of at least 85 percent for the combined text.
- Require both page-local fragments to locate exactly. Do not return a partial
  result when either fragment is missing.
- Do not lower the existing fuzzy-match threshold or fall back to an ordinary
  prose clause.

## Data model

Single-page entries keep their existing `snapshot` and `state` fields. A
cross-page entry adds `segments`, containing two page-local snapshots and an
independent save state for each segment. The entry-level state is derived from
the segments:

- `saving` while any unsaved segment is being saved;
- `saved` only after both segments are saved;
- `failed` when a segment fails, while retaining successful segment states so a
  retry skips them.

History normalization accepts both the old single-snapshot representation and
the optional segmented representation. Existing conversations require no
migration.

## Location flow

1. Run the existing exact, repaired-sentence, and full-quote fuzzy flow.
2. If it returns no result, inspect each pair of adjacent Reader pages.
3. Build candidate sentence text from the trailing incomplete sentence on the
   first page and the leading sentence fragment on the second page.
4. Compare the combined candidate with the quote under the existing strict
   repair thresholds.
5. Exact-locate both original page fragments on their own pages.
6. Return a segmented result only if both exact locations succeed.

## UI and save behavior

- A cross-page row displays `第 1–2 页 · 跨页精确匹配` and counts as one located
  draft.
- Clicking the row or the batch preview opens the first segment.
- Batch save writes each unsaved segment with the same comment and color.
- If one write succeeds and the next fails, the row reports failure without
  discarding the successful segment ID. Retrying saves only the missing
  segment.
- The logical entry counts as saved only when every segment is saved.

## Verification seams

- `locateWebAnnotationQuoteSegments`: returns two exact page-local locations for
  the known LAW sentence and rejects partial or low-similarity candidates.
- WEB annotation batch persistence: round-trips segmented drafts while keeping
  legacy single-snapshot drafts valid.
- Batch save: creates two annotations once, survives a partial failure, and
  does not duplicate the first annotation on retry.
- Existing single-page location and save tests remain unchanged and passing.

