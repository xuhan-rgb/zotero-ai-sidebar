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

// Reading phase a section belongs to — drives the ①②③ progressive grouping.
export type OverviewPhase = "motivation" | "method" | "validation";

// Visual emphasis — shared vocabulary with the flowchart:
//   innovation = this paper's contribution (gold ✦, must-read)
//   result     = where the results/SOTA live (green 效果锚点)
//   background = related work / boilerplate (de-emphasized)
//   normal     = everything else
export type OverviewEmphasis = "innovation" | "result" | "normal" | "background";

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
  phase?: OverviewPhase;
  emphasis?: OverviewEmphasis;
}

// The full structured overview the UI renders.
export interface OverviewData {
  title: string;
  source: "arxiv" | "pdf";
  coverage: "headings" | "uniform-fallback";
  narrative?: string; // 核心讲述: 2–4 sentence whole-paper synthesis
  sections: OverviewSection[];
  flowchart?: MindmapData;
  networkTopology?: MindmapData; // optional model architecture: input → modules → output
}
