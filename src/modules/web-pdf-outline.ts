import { attachAnchors } from "../context/pdf-outline";
import type { OutlineEntry } from "../context/overview-types";
import { DEFAULT_CONTEXT_POLICY } from "../context/policy";

// WEB must supply reliable IDs before asking for per-section replies. The API
// agent can refine an outline itself; this fallback does not change that path.
export function webPdfOutline(
  text: string,
): (OutlineEntry & { headingText: string })[] | undefined {
  const headings: Array<{
    no: string;
    title: string;
    level: number;
    at: number;
    body: number;
  }> = [];
  let offset = 0;
  let parent = "";
  let mainCount = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const at = offset + line.indexOf(trimmed);
    const main = trimmed.match(
      /^([IVXLCDM]+)\.\s+([A-Z0-9][A-Z0-9 ,:()&/–—-]{1,78})$/,
    );
    const sub = trimmed.match(/^([A-Z])\.\s+([A-Z][^.]{1,78})$/);
    const abstract = trimmed.match(/^Abstract\s*[—–-]\s*/i);
    if (main) {
      parent = main[1];
      mainCount++;
      headings.push({
        no: parent,
        title: main[2],
        level: 1,
        at,
        body: offset + line.length + 1,
      });
    } else if (sub && parent) {
      headings.push({
        no: `${parent}.${sub[1]}`,
        title: sub[2],
        level: 2,
        at,
        body: offset + line.length + 1,
      });
    } else if (abstract) {
      headings.push({
        no: "abstract",
        title: "Abstract",
        level: 1,
        at,
        body: at + abstract[0].length,
      });
    } else if (/^REFERENCES$/.test(trimmed)) {
      headings.push({
        no: "references",
        title: "References",
        level: 1,
        at,
        body: offset + line.length + 1,
      });
    }
    offset += line.length + 1;
  }
  if (
    mainCount < 3 ||
    new Set(headings.map((h) => h.no)).size !== headings.length
  )
    return undefined;
  const entries = headings.map((h, index) => {
    const end = headings[index + 1]?.at ?? text.length;
    return {
      no: h.no,
      title: h.title,
      headingText: text
        .slice(
          h.at,
          text.indexOf("\n", h.at) < 0 ? text.length : text.indexOf("\n", h.at),
        )
        .trim()
        .split(/[—–]/)[0],
      level: h.level,
      charStart: h.at,
      charEnd: end,
      preview: text
        .slice(h.body, end)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, DEFAULT_CONTEXT_POLICY.outlinePreviewChars),
    };
  });
  attachAnchors(entries, text);
  return entries;
}
