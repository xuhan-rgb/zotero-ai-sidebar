import type { OutlineEntry } from "./overview-types";

// Cheap whole-paper skeleton detection over the PDF full-text cache.
// WHY pure + heuristic: an overview needs *coverage* (touch the whole paper),
// not *depth*. Headings + char ranges + first-line previews give the model a
// bounded digest to synthesize from, without ever sending the full PDF.
// arXiv items take a more reliable LaTeX path elsewhere; this is the fallback
// for ordinary PDFs whose full-text has lost structure.

export interface OutlinePolicy {
  outlinePreviewChars: number;
  maxOutlineEntries: number;
  outlineFallbackWindows: number;
}

const COMMON_CAPS = new Set([
  "ABSTRACT",
  "INTRODUCTION",
  "RELATED WORK",
  "BACKGROUND",
  "METHOD",
  "METHODS",
  "METHODOLOGY",
  "APPROACH",
  "EXPERIMENTS",
  "RESULTS",
  "EVALUATION",
  "DISCUSSION",
  "CONCLUSION",
  "CONCLUSIONS",
  "REFERENCES",
  "APPENDIX",
  "ACKNOWLEDGMENTS",
]);

interface RawHeading {
  no: string;
  level: number;
  title: string;
  at: number;
}

// Match a heading line. Returns null for ordinary prose lines.
function matchHeading(line: string): Omit<RawHeading, "at"> | null {
  const t = line.trim();
  if (!t || t.length > 80) return null;
  // "3" / "3.1" / "3.1.2" + Title (Title starts uppercase, no terminal period)
  const numbered = t.match(/^(\d+(?:\.\d+)*)\.?\s+([A-Z][^.]{1,70})$/);
  if (numbered) {
    const no = numbered[1];
    return {
      no,
      level: Math.min(no.split(".").length, 2),
      title: numbered[2].trim(),
    };
  }
  // A standalone line that IS a known section name (any case), e.g.
  // "Abstract", "INTRODUCTION", "Related Work". Requiring the whole trimmed
  // line to equal a known name keeps this from matching ordinary prose.
  const upper = t.toUpperCase();
  if (COMMON_CAPS.has(upper)) {
    return { no: "—", level: 1, title: t };
  }
  return null;
}

export function detectOutline(
  fullText: string,
  policy: OutlinePolicy,
): OutlineEntry[] {
  const headings: RawHeading[] = [];
  let offset = 0;
  for (const line of fullText.split("\n")) {
    const m = matchHeading(line);
    if (m) headings.push({ ...m, at: offset });
    offset += line.length + 1; // +1 for the consumed "\n"
  }

  // Too few headings → even-window fallback so coverage always holds.
  if (headings.length < 3) {
    return uniformWindows(fullText, policy);
  }

  const entries: OutlineEntry[] = headings.map((h, i) => {
    const charStart = h.at;
    const charEnd =
      i + 1 < headings.length ? headings[i + 1].at : fullText.length;
    const bodyStart = h.at + lineLengthAt(fullText, h.at);
    return {
      no: h.no,
      level: h.level,
      title: h.title,
      charStart,
      charEnd,
      preview: previewOf(
        fullText,
        bodyStart,
        charEnd,
        policy.outlinePreviewChars,
      ),
    };
  });
  return entries.slice(0, policy.maxOutlineEntries);
}

function uniformWindows(
  fullText: string,
  policy: OutlinePolicy,
): OutlineEntry[] {
  const n = Math.max(1, policy.outlineFallbackWindows);
  const size = Math.ceil(fullText.length / n);
  const out: OutlineEntry[] = [];
  for (let i = 0; i < n; i++) {
    const charStart = i * size;
    if (charStart >= fullText.length && i > 0) break;
    const charEnd = Math.min(charStart + size, fullText.length);
    out.push({
      no: `~${i + 1}`,
      level: 1,
      title: `第 ${i + 1} 段`,
      charStart,
      charEnd,
      preview: previewOf(fullText, charStart, charEnd, policy.outlinePreviewChars),
    });
  }
  return out;
}

function lineLengthAt(text: string, at: number): number {
  const nl = text.indexOf("\n", at);
  return (nl === -1 ? text.length : nl) - at + 1;
}

function previewOf(
  text: string,
  start: number,
  end: number,
  max: number,
): string {
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, max);
}
