import type { SelectionAnnotationDraft } from "../context/agent-tools";
import type { LocateResult } from "../context/pdf-locator";
import { locateWebAnnotationQuote } from "./web-annotation-locate";

interface SelectionLocator {
  attachmentID: number;
  locate(
    needle: string,
    options?: { minConfidence?: number; exactOnly?: boolean },
  ): Promise<LocateResult | null>;
}

export async function locateWebSelectionAnnotationDraft(
  locator: SelectionLocator,
  selectedText: string,
  minConfidence: number,
): Promise<SelectionAnnotationDraft | null> {
  const result = await locateWebAnnotationQuote(
    locator,
    selectedText,
    minConfidence,
  );
  if (!result) return null;
  return {
    text: result.matchedText,
    attachmentID: locator.attachmentID,
    annotation: {
      type: "highlight",
      text: result.matchedText,
      pageLabel: result.pageLabel,
      sortIndex: result.sortIndex,
      position: {
        pageIndex: result.pageIndex,
        rects: result.rects,
        ...(result.anchorOffset != null
          ? { zaiAnchorOffset: result.anchorOffset }
          : {}),
        ...(result.headOffset != null
          ? { zaiHeadOffset: result.headOffset }
          : {}),
      },
    },
  };
}
