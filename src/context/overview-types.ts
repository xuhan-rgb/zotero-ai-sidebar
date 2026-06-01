import type { MindmapData } from "../providers/types";

// One detected/return skeleton entry from zotero_outline_pdf.
export interface OutlineEntry {
  no: string; // "1", "3.1", or "~1" for fallback windows
  level: number; // 1 = top-level section, 2 = subsection
  title: string;
  charStart: number;
  charEnd: number;
  preview: string; // first ~N chars of the section body (for the model to write a gist)
  anchors?: string[]; // e.g. ["Fig.4", "Tab.1"]
}

// A section after the model has added a gist (rendered in the narrative layer).
export interface OverviewSection {
  no: string;
  level: number;
  title: string;
  gist?: string;
  charStart: number;
  charEnd: number;
  pageLabel?: string;
  anchors?: string[];
}

// The full structured overview the UI renders.
export interface OverviewData {
  title: string;
  source: "arxiv" | "pdf";
  coverage: "headings" | "uniform-fallback";
  sections: OverviewSection[];
  flowchart?: MindmapData;
}
