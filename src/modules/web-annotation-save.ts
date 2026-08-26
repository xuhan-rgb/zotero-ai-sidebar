import type {
  AssistantAnnotationDraft,
  WebAnnotationBatchEntry,
} from "../providers/types";

type SaveAnnotation = (
  snapshot: AssistantAnnotationDraft["snapshot"],
  patch: { comment: string; color?: string },
) => Promise<{ id: number }>;

export async function saveWebAnnotationEntry(
  entry: WebAnnotationBatchEntry,
  save: SaveAnnotation,
): Promise<void> {
  const segments = entry.segments;
  if (!segments?.length) return;

  entry.state = { kind: "saving" };
  for (const segment of segments) {
    if (segment.state.kind === "saved") continue;
    segment.state = { kind: "saving" };
    try {
      const saved = await save(segment.snapshot, {
        comment: entry.comment,
        ...(entry.color ? { color: entry.color } : {}),
      });
      segment.state = {
        kind: "saved",
        annotationID: saved.id,
        savedAt: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      segment.state = { kind: "failed", error: message };
      entry.state = { kind: "failed", error: message };
      return;
    }
  }

  const first = segments[0]?.state;
  if (first?.kind === "saved") {
    entry.state = {
      kind: "saved",
      annotationID: first.annotationID,
      savedAt: Math.max(
        ...segments.map((segment) =>
          segment.state.kind === "saved" ? segment.state.savedAt : 0,
        ),
      ),
    };
  }
}
