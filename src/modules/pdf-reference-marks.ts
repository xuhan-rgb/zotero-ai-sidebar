// pdf-reference-marks: the dashed "used by this round" boxes drawn on the
// reader page. A pick (公式/图片/表格) or a text selection adds a mark; the
// marks of the previous round are dropped as soon as the next round is sent,
// so what stays tinted is always what the current round refers to.
//
// Marks are grouped per paper (the reader's conversation item, falling back to
// its attachment) and are drawn through the same overlay painter as the reading
// route highlight. Each mark owns one registry slot element, which is why a
// re-mark of the same target only repaints instead of stacking a second box.

import type { PaperFigure } from "./paper-figures";
import {
  destroyActiveRouteHighlight,
  mountNormalizedPdfHighlight,
  mountRouteHighlightOverlay,
} from "./pdf-navigation";
import {
  activeReaderViews,
  readerAttachmentID,
  readerConversationItemID,
} from "./reader-access";
import type { PdfSelectionLocator } from "../providers/types";

export type PdfReferenceKind = "figure" | "selection";

interface ReferenceMark {
  round: number;
  kind: PdfReferenceKind;
  key: string;
  slot: HTMLElement;
  destroy(): void;
}

interface ReferenceRound {
  round: number;
  marks: ReferenceMark[];
}

const referenceRounds = new Map<number, ReferenceRound>();

/** The paper a reader belongs to; marks never mix two papers. */
function referenceKeyForReader(reader: unknown): number | null {
  return readerConversationItemID(reader) ?? readerAttachmentID(reader);
}

function roundFor(key: number): ReferenceRound {
  let round = referenceRounds.get(key);
  if (!round) {
    round = { round: 0, marks: [] };
    referenceRounds.set(key, round);
  }
  return round;
}

function firstReaderView(reader: unknown): any | null {
  for (const view of activeReaderViews(reader as any)) {
    if (view?._iframeWindow?.document) return view;
  }
  return null;
}

function upsertMark(
  reader: unknown,
  kind: PdfReferenceKind,
  key: string,
  paint: (slot: HTMLElement) => void,
): void {
  const groupKey = referenceKeyForReader(reader);
  const view = firstReaderView(reader);
  if (groupKey == null || !view) return;
  const state = roundFor(groupKey);
  const existing = state.marks.find(
    (mark) => mark.kind === kind && mark.key === key,
  );
  const slot =
    existing?.slot ??
    (view._iframeWindow.document.createElement("div") as HTMLElement);
  paint(slot);
  if (existing) {
    // Still referenced by the round being composed, so keep it for that round.
    existing.round = state.round;
    return;
  }
  state.marks.push({
    round: state.round,
    kind,
    key,
    slot,
    destroy: () => destroyActiveRouteHighlight(slot),
  });
}

/** Dashed box around a picked 公式/图片/表格 (MinerU box, 0..1000 of the page). */
export function markFigureReference(
  reader: unknown,
  figure: PaperFigure,
): void {
  const page = figure.page;
  const bbox = figure.bbox;
  if (page == null || !bbox) return;
  upsertMark(
    reader,
    "figure",
    `${figure.id}:${page}:${bbox.join(",")}`,
    (slot) =>
      mountNormalizedPdfHighlight(slot, firstReaderView(reader), page, bbox, {
        reference: true,
      }),
  );
}

/** Dashed box around the text selection that the current round quotes. */
export function markSelectionReference(
  reader: unknown,
  locator: PdfSelectionLocator,
): void {
  upsertMark(
    reader,
    "selection",
    `${locator.pageIndex ?? "?"}:${JSON.stringify(locator.position?.rects ?? [])}`,
    (slot) =>
      mountRouteHighlightOverlay(slot, firstReaderView(reader), locator, {
        reference: true,
      }),
  );
}

/** A new round is starting: the marks of every earlier round are dropped. */
export function advanceReferenceRound(reader: unknown): void {
  const groupKey = referenceKeyForReader(reader);
  if (groupKey == null) return;
  const state = referenceRounds.get(groupKey);
  if (!state) return;
  state.round += 1;
  const kept = state.marks.filter((mark) => mark.round >= state.round - 1);
  for (const mark of state.marks) {
    if (kept.includes(mark)) continue;
    try {
      mark.destroy();
    } catch {
      /* best effort */
    }
  }
  state.marks = kept;
  if (!kept.length) referenceRounds.delete(groupKey);
}

/** Drops the dashed box of one picked 公式/图片/表格 (its × was clicked). */
export function clearFigureReferenceMark(
  reader: unknown,
  figureId: string,
): void {
  const groupKey = referenceKeyForReader(reader);
  if (groupKey == null) return;
  const state = referenceRounds.get(groupKey);
  if (!state) return;
  const prefix = `${figureId}:`;
  const kept: ReferenceMark[] = [];
  for (const mark of state.marks) {
    if (mark.kind === "figure" && mark.key.startsWith(prefix)) {
      try {
        mark.destroy();
      } catch {
        /* best effort */
      }
      continue;
    }
    kept.push(mark);
  }
  state.marks = kept;
  if (!kept.length) referenceRounds.delete(groupKey);
}

/** Drops the text-selection marks only; picked figures keep their box. */
export function clearSelectionReferenceMarks(reader: unknown): void {
  const groupKey = referenceKeyForReader(reader);
  if (groupKey == null) return;
  const state = referenceRounds.get(groupKey);
  if (!state) return;
  const kept: ReferenceMark[] = [];
  for (const mark of state.marks) {
    if (mark.kind !== "selection") {
      kept.push(mark);
      continue;
    }
    try {
      mark.destroy();
    } catch {
      /* best effort */
    }
  }
  state.marks = kept;
  if (!kept.length) referenceRounds.delete(groupKey);
}

/** Drops marks from previous rounds; keeps only current-round marks. */
export function clearStaleReferenceMarks(reader: unknown): void {
  const groupKey = referenceKeyForReader(reader);
  if (groupKey == null) return;
  const state = referenceRounds.get(groupKey);
  if (!state) return;
  const kept: ReferenceMark[] = [];
  for (const mark of state.marks) {
    if (mark.round === state.round) {
      kept.push(mark);
      continue;
    }
    try {
      mark.destroy();
    } catch {
      /* best effort */
    }
  }
  state.marks = kept;
  if (!kept.length) referenceRounds.delete(groupKey);
}
