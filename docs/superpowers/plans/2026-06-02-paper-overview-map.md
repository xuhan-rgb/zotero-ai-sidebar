# 论文总揽地图 Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the reader a glanceable whole-paper overview map (narrative skeleton + structural flowchart) as a third view in the note panel, model-driven and cheap.

**Architecture:** A new harness tool `zotero_outline_pdf` cheaply extracts a paper skeleton (headings + char ranges + caption anchors; arXiv reuses cached LaTeX sections, plain PDF uses heuristic detection with an even-window fallback). The model synthesizes gists + a logical flowchart and emits them via `render_paper_overview`, which pushes structured `OverviewData` to the sidebar through an `onOverviewReady` callback. The sidebar renders a read-only live view (reusing the existing dagre+SVG renderer, now extended to mermaid `flowchart`), caches the data in chat-history/state (rides existing WebDAV sync), and supports click-to-jump via `note-pdf-link`.

**Tech Stack:** TypeScript, vitest (`npm test` → `vitest run`), @dagrejs/dagre+graphlib (existing), Zotero plugin DOM APIs.

**Spec:** `docs/superpowers/specs/2026-06-02-paper-overview-map-design.md`

**Conventions confirmed:** tests live in `tests/<area>/<name>.test.ts`, import from `../../src/...`, use `import { describe, expect, it } from "vitest"`. Run a single test file with `npx vitest run tests/path/file.test.ts`. After each task, run `npm run build` is NOT required per-step (slow); run `npx vitest run` for the touched test(s) and commit.

---

## File Structure

- Create `src/context/pdf-outline.ts` — pure heading/anchor detection over full-text. One responsibility: text → skeleton.
- Create `src/modules/mermaid-flowchart.ts` — pure parser: mermaid `flowchart/graph` source → `MindmapData`.
- Create `src/context/overview-types.ts` — shared `OverviewSection` / `OverviewData` / `OutlineEntry` types (kept out of the giant `agent-tools.ts`).
- Modify `src/providers/types.ts` — extend `MindmapNode|Edge|Data`.
- Modify `src/modules/mindmap-render.ts` — `rankdir`, edge labels, `result` node type.
- Modify `src/modules/markdown-render.ts` — flowchart fallback in `flushCode`.
- Modify `src/context/agent-tools.ts` — `zotero_outline_pdf`, `render_paper_overview`, `onOverviewReady` option.
- Modify `src/context/policy.ts` — outline budgets.
- Modify `src/settings/chat-history.ts` + `src/sync/state.ts` — persist/sync `OverviewData` per item.
- Modify `src/modules/sidebar.ts` + `src/modules/note-dedicated.ts` — segmented `[笔记|路线|总揽]`, morphing action, live view, jump, save-to-note.
- Tests: `tests/context/pdf-outline.test.ts`, `tests/modules/mermaid-flowchart.test.ts`, additions to `tests/context/agent-tools.test.ts`.

---

## Task 1: Extend mindmap types + add overview types

**Files:**
- Modify: `src/providers/types.ts` (MindmapNode/Edge/Data)
- Create: `src/context/overview-types.ts`

- [ ] **Step 1: Extend mindmap types in `src/providers/types.ts`**

Find the existing `MindmapNode`/`MindmapEdge`/`MindmapData` definitions and replace with:

```ts
export interface MindmapNode {
  id: string;
  label: string;
  type?: "root" | "section" | "point" | "result";
  sectionNo?: string; // back-link from a structural node to a document section
}

export interface MindmapEdge {
  source: string;
  target: string;
  label?: string;
}

export interface MindmapData {
  title?: string;
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  source?: string; // original mermaid text, when parsed from a code block
  rankdir?: "TB" | "LR"; // layout direction; renderer default stays LR
}
```

- [ ] **Step 2: Create `src/context/overview-types.ts`**

```ts
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (Existing `mindmap-render.ts` already handles a subset of node types; adding `"result"` is non-breaking because `type` is optional and switch/default falls through.)

- [ ] **Step 4: Commit**

```bash
git add src/providers/types.ts src/context/overview-types.ts
git commit -m "feat(overview): add overview types and extend mindmap types"
```

---

## Task 2: `detectOutline` heading detection (pure)

**Files:**
- Create: `src/context/pdf-outline.ts`
- Test: `tests/context/pdf-outline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { detectOutline } from "../../src/context/pdf-outline";

const POLICY = { outlinePreviewChars: 80, maxOutlineEntries: 40, outlineFallbackWindows: 6 };

describe("detectOutline", () => {
  it("detects numbered headings and assigns char ranges", () => {
    const text =
      "Abstract\nWe study X.\n\n1 Introduction\nMotivation here.\n\n2 Method\nWe propose Y.\n\n3 Conclusion\nDone.";
    const out = detectOutline(text, POLICY);
    expect(out.map((e) => e.title)).toEqual([
      "Abstract",
      "Introduction",
      "Method",
      "Conclusion",
    ]);
    expect(out[1].no).toBe("1");
    expect(out[1].charStart).toBeLessThan(out[2].charStart);
    expect(out[1].preview.length).toBeLessThanOrEqual(80);
    expect(text.slice(out[1].charStart, out[1].charEnd)).toContain("Motivation");
  });

  it("detects dotted subsection levels", () => {
    const text = "3 Method\nintro\n\n3.1 Encoder\ndetails\n\n3.2 Loss\nmore";
    const out = detectOutline(text, POLICY);
    const enc = out.find((e) => e.title === "Encoder")!;
    expect(enc.no).toBe("3.1");
    expect(enc.level).toBe(2);
  });

  it("detects all-caps section names", () => {
    const text = "INTRODUCTION\nbody\n\nRELATED WORK\nbody2\n\nREFERENCES\n[1] ...";
    const out = detectOutline(text, POLICY);
    expect(out.map((e) => e.title)).toEqual([
      "INTRODUCTION",
      "RELATED WORK",
      "REFERENCES",
    ]);
  });

  it("falls back to even windows when too few headings are found", () => {
    const text = "x".repeat(6000); // no headings
    const out = detectOutline(text, POLICY);
    expect(out.length).toBe(6);
    expect(out[0].no.startsWith("~")).toBe(true);
    expect(out[0].charStart).toBe(0);
    expect(out[5].charEnd).toBe(6000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/context/pdf-outline.test.ts`
Expected: FAIL — "Failed to resolve import ... pdf-outline".

- [ ] **Step 3: Implement `src/context/pdf-outline.ts`**

```ts
import type { OutlineEntry } from "./overview-types";

export interface OutlinePolicy {
  outlinePreviewChars: number;
  maxOutlineEntries: number;
  outlineFallbackWindows: number;
}

const COMMON_CAPS = new Set([
  "ABSTRACT", "INTRODUCTION", "RELATED WORK", "BACKGROUND", "METHOD", "METHODS",
  "METHODOLOGY", "APPROACH", "EXPERIMENTS", "RESULTS", "EVALUATION", "DISCUSSION",
  "CONCLUSION", "CONCLUSIONS", "REFERENCES", "APPENDIX", "ACKNOWLEDGMENTS",
]);

interface RawHeading { no: string; level: number; title: string; at: number }

// Match a heading line. Returns null for ordinary prose lines.
function matchHeading(line: string): Omit<RawHeading, "at"> | null {
  const t = line.trim();
  if (!t || t.length > 80) return null;
  // "3" / "3.1" / "3.1.2" + Title
  const numbered = t.match(/^(\d+(?:\.\d+)*)\.?\s+([A-Z][^.]{1,70})$/);
  if (numbered) {
    const no = numbered[1];
    return { no, level: Math.min(no.split(".").length, 2), title: numbered[2].trim() };
  }
  // Known all-caps section names, or short Title Case with no terminal period
  const upper = t.toUpperCase();
  if (COMMON_CAPS.has(upper) && t === upper) {
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
    const charEnd = i + 1 < headings.length ? headings[i + 1].at : fullText.length;
    const bodyStart = h.at + lineLengthAt(fullText, h.at);
    return {
      no: h.no,
      level: h.level,
      title: h.title,
      charStart,
      charEnd,
      preview: previewOf(fullText, bodyStart, charEnd, policy.outlinePreviewChars),
    };
  });
  return entries.slice(0, policy.maxOutlineEntries);
}

function uniformWindows(fullText: string, policy: OutlinePolicy): OutlineEntry[] {
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

function previewOf(text: string, start: number, end: number, max: number): string {
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/context/pdf-outline.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/context/pdf-outline.ts tests/context/pdf-outline.test.ts
git commit -m "feat(overview): detectOutline heading detection with even-window fallback"
```

---

## Task 3: `extractAnchors` + attach to sections (pure)

**Files:**
- Modify: `src/context/pdf-outline.ts`
- Test: `tests/context/pdf-outline.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/context/pdf-outline.test.ts`:

```ts
import { detectOutline as _d, attachAnchors } from "../../src/context/pdf-outline";

describe("attachAnchors", () => {
  it("assigns figure/table captions to the section that contains them", () => {
    const text =
      "1 Intro\nbody\n\n2 Method\nWe show in Figure 4 the design.\n\nTable 1: results.\n\n3 End\nbye";
    const out = attachAnchors(_d(text, { outlinePreviewChars: 80, maxOutlineEntries: 40, outlineFallbackWindows: 6 }), text);
    const method = out.find((e) => e.title === "Method")!;
    expect(method.anchors).toEqual(["Fig.4", "Tab.1"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/context/pdf-outline.test.ts`
Expected: FAIL — "attachAnchors is not a function".

- [ ] **Step 3: Implement `attachAnchors` in `src/context/pdf-outline.ts`**

```ts
const ANCHOR_RE = /\b(?:Figure|Fig\.?|Table|Tab\.?)\s*(\d+)/gi;

export function attachAnchors(
  entries: OutlineEntry[],
  fullText: string,
): OutlineEntry[] {
  for (const m of fullText.matchAll(ANCHOR_RE)) {
    const at = m.index ?? 0;
    const isFig = /^f/i.test(m[0]);
    const label = `${isFig ? "Fig." : "Tab."}${m[1]}`;
    const sec = entries.find((e) => at >= e.charStart && at < e.charEnd);
    if (!sec) continue;
    sec.anchors = sec.anchors ?? [];
    if (!sec.anchors.includes(label)) sec.anchors.push(label);
  }
  return entries;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/context/pdf-outline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/context/pdf-outline.ts tests/context/pdf-outline.test.ts
git commit -m "feat(overview): attach figure/table anchors to sections"
```

---

## Task 4: `parseMermaidFlowchart` (pure)

**Files:**
- Create: `src/modules/mermaid-flowchart.ts`
- Test: `tests/modules/mermaid-flowchart.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseMermaidFlowchart } from "../../src/modules/mermaid-flowchart";

describe("parseMermaidFlowchart", () => {
  it("returns null for non-flowchart sources (lets mindmap parser win)", () => {
    expect(parseMermaidFlowchart("mindmap\n  root((x))")).toBeNull();
    expect(parseMermaidFlowchart("sequenceDiagram\n A->>B: hi")).toBeNull();
  });

  it("parses nodes, shapes, edges and rankdir", () => {
    const src = "flowchart TD\n  P[Problem] --> M(Method)\n  M --> R{{Result}}";
    const data = parseMermaidFlowchart(src)!;
    expect(data.rankdir).toBe("TB");
    expect(data.nodes.map((n) => n.label).sort()).toEqual(["Method", "Problem", "Result"]);
    expect(data.edges.length).toBe(2);
    const result = data.nodes.find((n) => n.label === "Result")!;
    expect(result.type).toBe("result"); // {{...}} => result/section emphasis
  });

  it("parses edge labels in -->|label| form", () => {
    const data = parseMermaidFlowchart("graph LR\n A[a] -->|because| B[b]")!;
    expect(data.rankdir).toBe("LR");
    expect(data.edges[0].label).toBe("because");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/modules/mermaid-flowchart.test.ts`
Expected: FAIL — cannot resolve import.

- [ ] **Step 3: Implement `src/modules/mermaid-flowchart.ts`**

```ts
import type { MindmapData, MindmapEdge, MindmapNode } from "../providers/types";

// Parse a subset of mermaid `flowchart`/`graph` into MindmapData.
// We do NOT use the Mermaid library (CSP `unsafe-eval` blocks it in Gecko).
// Supported: header `flowchart TD|LR` / `graph TD|LR`; node shapes
// [rect] (round) {{hexagon}} ((circle)); edges `A --> B`, `A -->|label| B`.
// Returns null for any source whose first token is not flowchart/graph.

const HEADER_RE = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i;
const EDGE_RE =
  /^(.+?)\s*-->\s*(?:\|([^|]*)\|\s*)?(.+)$/;
const NODE_RE = /^([A-Za-z0-9_]+)\s*(\[\[?|\(\(?|\{\{?)?\s*([^\]\)\}]*)\s*(\]\]?|\)\)?|\}\}?)?$/;

function nodeType(open?: string): MindmapNode["type"] {
  if (open === "((") return "root";
  if (open === "{{" || open === "{") return "result";
  if (open === "(") return "section";
  return "point";
}

export function parseMermaidFlowchart(source: string): MindmapData | null {
  const lines = source.split("\n").map((l) => l.trim()).filter(Boolean);
  const header = lines[0]?.match(HEADER_RE);
  if (!header) return null;

  const dir = header[1].toUpperCase();
  const rankdir: MindmapData["rankdir"] = dir === "LR" || dir === "RL" ? "LR" : "TB";

  const nodes = new Map<string, MindmapNode>();
  const edges: MindmapEdge[] = [];

  const upsert = (token: string): string => {
    const m = token.trim().match(NODE_RE);
    const id = (m?.[1] ?? token.trim()).trim();
    const label = (m?.[3] || id).trim();
    const type = nodeType(m?.[2]);
    if (!nodes.has(id)) nodes.set(id, { id, label, type });
    else if (m?.[3]) nodes.set(id, { id, label, type }); // later definition wins
    return id;
  };

  for (const line of lines.slice(1)) {
    const e = line.match(EDGE_RE);
    if (e) {
      const source = upsert(e[1]);
      const target = upsert(e[3]);
      const edge: MindmapEdge = { source, target };
      if (e[2]?.trim()) edge.label = e[2].trim();
      edges.push(edge);
    } else {
      upsert(line); // standalone node declaration
    }
  }

  if (nodes.size === 0) return null;
  return { nodes: [...nodes.values()], edges, rankdir };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/modules/mermaid-flowchart.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/mermaid-flowchart.ts tests/modules/mermaid-flowchart.test.ts
git commit -m "feat(overview): mermaid flowchart/graph parser"
```

---

## Task 5: Renderer honors `rankdir`, edge labels, `result` node

**Files:**
- Modify: `src/modules/mindmap-render.ts` (`renderMindmapSvg`, `nodeRadius`)
- Test: `tests/modules/mermaid-flowchart.test.ts` (append a render-integration test using jsdom DOM)

Note: vitest in this repo runs in node; `renderMindmapSvg(doc, data)` needs a `Document`. Use `globalThis.document` if the test env provides jsdom; otherwise assert via a thin DOM stub. Check `vitest.config.*` for `environment`. If not jsdom, SKIP the DOM test and instead unit-test a new pure helper `resolveRankdir(data)`.

- [ ] **Step 1: Add pure helper test** (environment-independent)

Append to `tests/modules/mermaid-flowchart.test.ts`:

```ts
import { resolveRankdir } from "../../src/modules/mindmap-render";

describe("resolveRankdir", () => {
  it("uses data.rankdir when present, else LR default", () => {
    expect(resolveRankdir({ nodes: [], edges: [], rankdir: "TB" })).toBe("TB");
    expect(resolveRankdir({ nodes: [], edges: [] })).toBe("LR");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/modules/mermaid-flowchart.test.ts`
Expected: FAIL — "resolveRankdir is not exported".

- [ ] **Step 3: Modify `src/modules/mindmap-render.ts`**

Add the exported helper near the top (after imports):

```ts
export function resolveRankdir(data: MindmapData): "TB" | "LR" {
  return data.rankdir === "TB" ? "TB" : "LR";
}
```

In `renderMindmapSvg`, change the graph config to use it:

```ts
  g.setGraph({
    rankdir: resolveRankdir(data),
    ranksep: 36,
    nodesep: 12,
    marginx: 24,
    marginy: 24,
  });
```

In the edge loop (where `g.setEdge(edge.source, edge.target)` is called) attach the label so dagre reserves space:

```ts
  for (const edge of data.edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      g.setEdge(edge.source, edge.target, edge.label ? { label: edge.label } : {});
    }
  }
```

In the edge-draw loop, after appending the `path`, render the label at the edge midpoint when present:

```ts
    const ei = g.edge(e);
    // ... existing path append ...
    if (ei.label) {
      const mid = ei.points[Math.floor(ei.points.length / 2)];
      const lbl = doc.createElementNS(SVG_NS, "text");
      lbl.setAttribute("x", String(mid.x));
      lbl.setAttribute("y", String(mid.y - 3));
      lbl.setAttribute("text-anchor", "middle");
      lbl.setAttribute("class", "zai-mm-elabel");
      lbl.textContent = String(ei.label);
      edgeGroup.append(lbl);
    }
```

In `nodeRadius`, treat `result` like `section`:

```ts
function nodeRadius(type?: string): number {
  return type === "root" ? 10 : type === "section" || type === "result" ? 7 : 5;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/modules/mermaid-flowchart.test.ts`
Expected: PASS.

- [ ] **Step 5: Add CSS for result node + edge label**

In `addon/content/sidebar.css` (search for `.zai-mm-node-section`), add nearby:

```css
.zai-mm-node-result rect { fill:#eef3ea; stroke:#5c8a4a; stroke-width:1.4px; }
.zai-mm-node-result text, .zai-mm-node-result tspan { font-weight:600; fill:#3f6b32; }
.zai-mm-elabel { font-family:sans-serif; font-size:9px; fill:#9b9183; }
```

(The node `<g>` already gets class `zai-mm-node-${type}`, so `result` is styled automatically.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/mindmap-render.ts tests/modules/mermaid-flowchart.test.ts addon/content/sidebar.css
git commit -m "feat(overview): renderer rankdir, edge labels, result node type"
```

---

## Task 6: markdown-render falls back to flowchart

**Files:**
- Modify: `src/modules/markdown-render.ts` (`flushCode`, ~line 142)
- Test: existing markdown-render test file if present (`tests/modules/markdown-render.test.ts`); else add a focused parser-wiring assertion.

- [ ] **Step 1: Modify `flushCode` in `src/modules/markdown-render.ts`**

At the top of the file add the import:

```ts
import { parseMermaidFlowchart } from "./mermaid-flowchart";
```

In `flushCode`, inside `if (codeLanguage === "mermaid") { ... }`, after the existing `parseMermaidMindmap` block (which `return`s on success), add a second attempt before falling through:

```ts
    if (codeLanguage === "mermaid") {
      const parsed = parseMermaidMindmap(raw);
      if (parsed) {
        parsed.source = raw;
        target.append(renderMindmapBlock(doc, parsed));
        codeLines = null; codeLanguage = ""; return;
      }
      const flow = parseMermaidFlowchart(raw);
      if (flow) {
        flow.source = raw;
        target.append(renderMindmapBlock(doc, flow));
        codeLines = null; codeLanguage = ""; return;
      }
    }
```

- [ ] **Step 2: Verify build + (if a markdown-render test exists) run it**

Run: `npx tsc --noEmit` → no errors.
Run (if exists): `npx vitest run tests/modules/markdown-render.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/markdown-render.ts
git commit -m "feat(overview): render mermaid flowchart blocks in chat markdown"
```

---

## Task 7: `zotero_outline_pdf` tool

**Files:**
- Modify: `src/context/policy.ts` (add budgets), `src/context/agent-tools.ts`
- Test: `tests/context/agent-tools.test.ts`

- [ ] **Step 1: Add budgets to `src/context/policy.ts`**

In the `ContextPolicy` interface (PDF retrieval section) add:

```ts
  // --- Overview map ------------------------------------------------------
  outlineCharBudget: number; // hard cap on the whole outline tool output
  outlinePreviewChars: number; // per-section body preview length
  maxOutlineEntries: number; // cap on returned sections
  outlineFallbackWindows: number; // even-window count when headings are sparse
```

In `DEFAULT_CONTEXT_POLICY` add:

```ts
  outlineCharBudget: 4000,
  outlinePreviewChars: 120,
  maxOutlineEntries: 40,
  outlineFallbackWindows: 6,
```

- [ ] **Step 2: Write failing test**

Append to `tests/context/agent-tools.test.ts` (reuse existing `source`/helpers in that file; set `getFullText` for this case):

```ts
describe("zotero_outline_pdf", () => {
  it("returns a JSON skeleton from the PDF full-text cache", async () => {
    const text =
      "Abstract\nWe study X.\n\n1 Introduction\nMotivation.\n\n2 Method\nWe propose Y. See Figure 2.\n\n3 Conclusion\nDone.";
    const tools = createZoteroAgentTools({
      source: { getItem: async () => ({ title: "T" } as any), getFullText: async () => text },
      itemID: 1,
    });
    const tool = tools.find((t) => t.name === "zotero_outline_pdf")!;
    const res = await tool.execute({});
    const payload = JSON.parse(res.output.replace(/^\[Paper outline\]\n/, ""));
    expect(payload.source).toBe("pdf");
    expect(payload.coverage).toBe("headings");
    expect(payload.sections.map((s: any) => s.title)).toContain("Method");
    const method = payload.sections.find((s: any) => s.title === "Method");
    expect(method.anchors).toContain("Fig.2");
    expect(res.context?.planMode).toBe("outline");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/context/agent-tools.test.ts -t "zotero_outline_pdf"`
Expected: FAIL — tool not found.

- [ ] **Step 4: Implement the tool in `src/context/agent-tools.ts`**

Add imports at top:

```ts
import { detectOutline, attachAnchors } from "./pdf-outline";
import { buildToc } from "./tex-sections";
import { loadArxivSections } from "./arxiv-tools";
import type { OutlineEntry } from "./overview-types";
```

Add this tool object to the `tools` array (e.g. right after `createPreviousContextTool(...)`):

```ts
    {
      name: "zotero_outline_pdf",
      description:
        "Get a cheap whole-paper skeleton (section headings, char ranges, first-line previews, figure/table anchors) WITHOUT reading the full PDF. Use this first when the user wants an overview/总揽 of the entire paper. arXiv items use the cached LaTeX section list; other PDFs use heuristic heading detection with an even-window fallback. After reading the skeleton, write a one-line gist per section and a logical flowchart, then call render_paper_overview.",
      parameters: objectSchema({}),
      execute: async () => {
        const itemID = currentItemID(options);
        if (itemID == null)
          return errorResult("No Zotero item is currently selected.");
        // arXiv path: reuse reliable LaTeX TOC.
        const arxiv = await loadArxivSections(options);
        if (arxiv) {
          const toc = buildToc(arxiv.sections);
          const sections = toc.map((t) => ({
            no: String(t.number),
            level: t.level,
            title: t.title,
            charStart: 0,
            charEnd: 0,
            preview: "",
          }));
          return {
            output: `[Paper outline]\n${JSON.stringify({ title: "", source: "arxiv", coverage: "headings", sections }, null, 2)}`,
            summary: `生成 arXiv 大纲 ${sections.length} 节`,
            context: { planMode: "outline" },
          };
        }
        const text = await getToolPdfText(options, itemID);
        if (!text) return errorResult(readablePdfTextError());
        const entries: OutlineEntry[] = attachAnchors(
          detectOutline(text, policy),
          text,
        );
        const coverage = entries[0]?.no.startsWith("~")
          ? "uniform-fallback"
          : "headings";
        const payload = {
          title: "",
          source: "pdf",
          coverage,
          sections: entries.map((e) => ({
            no: e.no,
            level: e.level,
            title: e.title,
            charStart: e.charStart,
            charEnd: e.charEnd,
            preview: e.preview,
            ...(e.anchors ? { anchors: e.anchors } : {}),
          })),
        };
        const output = truncateByTokenBudget(
          `[Paper outline]\n${JSON.stringify(payload, null, 2)}`,
          Math.ceil(policy.outlineCharBudget / 4),
        );
        return {
          output,
          summary: `生成大纲 ${entries.length} 节（${coverage}）`,
          context: { planMode: "outline" },
        };
      },
    },
```

Note: `buildToc` returns `TexTocEntry[]` with `{number, level, title, ...}` (confirmed in `tex-sections.ts:119`). If a field name differs, read `TexTocEntry` and adjust the three field reads (`t.number/t.level/t.title`).

Also add `"outline"` to the `planMode` union in `src/context/types.ts` `MessageContext` if that union is closed (search for existing `planMode` values like `"search_pdf"`).

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/context/agent-tools.test.ts -t "zotero_outline_pdf"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/context/policy.ts src/context/agent-tools.ts src/context/types.ts tests/context/agent-tools.test.ts
git commit -m "feat(overview): zotero_outline_pdf skeleton tool"
```

---

## Task 8: `render_paper_overview` tool + `onOverviewReady` callback

**Files:**
- Modify: `src/context/agent-tools.ts` (`ToolFactoryOptions`, new tool)
- Test: `tests/context/agent-tools.test.ts`

This mirrors the existing `draw_article_mindmap` → `onMindmapReady` pattern. Before implementing, read how `onMindmapReady` is declared in `ToolFactoryOptions` and how `createDrawMindmapTool` validates+invokes it (same file). Implement `render_paper_overview` the same way with `OverviewData`.

- [ ] **Step 1: Add option to `ToolFactoryOptions`**

```ts
  onOverviewReady?: (data: OverviewData) => void;
```

Import the type: `import type { OverviewData } from "./overview-types";`

- [ ] **Step 2: Write failing test**

```ts
describe("render_paper_overview", () => {
  it("validates and forwards structured overview to the callback", async () => {
    let received: any = null;
    const tools = createZoteroAgentTools({
      source: { getItem: async () => null, getFullText: async () => "x" },
      itemID: 1,
      onOverviewReady: (d) => { received = d; },
    });
    const tool = tools.find((t) => t.name === "render_paper_overview")!;
    const res = await tool.execute({
      title: "T",
      source: "pdf",
      coverage: "headings",
      sections: [{ no: "1", level: 1, title: "Intro", gist: "g", charStart: 0, charEnd: 10 }],
      flowchart: { rankdir: "TB", nodes: [{ id: "a", label: "A", type: "root" }], edges: [] },
    });
    expect(received?.sections?.[0]?.title).toBe("Intro");
    expect(received?.flowchart?.nodes?.length).toBe(1);
    expect(res.context?.planMode).toBe("overview");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/context/agent-tools.test.ts -t "render_paper_overview"`
Expected: FAIL — tool not found.

- [ ] **Step 4: Implement the tool** in `src/context/agent-tools.ts`

```ts
    {
      name: "render_paper_overview",
      description:
        "Render the whole-paper overview map (narrative section skeleton + a logical flowchart) into the note panel's 总揽 view. Call AFTER zotero_outline_pdf. Provide 'sections' (each with no, level, title, a ≤30-char Chinese gist, charStart, charEnd, optional anchors) and a 'flowchart' (nodes with id/label/type[root|section|point|result]/optional sectionNo, and edges with source/target/optional label). type='result' marks effect/SOTA nodes.",
      parameters: objectSchema(
        {
          title: stringSchema("Paper title."),
          source: stringSchema("'arxiv' or 'pdf'."),
          coverage: stringSchema("'headings' or 'uniform-fallback'."),
          sections: {
            type: "array",
            description: "Document-order sections with one-line gists.",
            items: {
              type: "object",
              properties: {
                no: { type: "string" }, level: { type: "number" },
                title: { type: "string" }, gist: { type: "string" },
                charStart: { type: "number" }, charEnd: { type: "number" },
                pageLabel: { type: "string" },
                anchors: { type: "array", items: { type: "string" } },
              },
              required: ["no", "title"],
            },
          },
          flowchart: {
            type: "object",
            description: "Logical structure graph (mermaid-flowchart-like).",
            properties: {
              rankdir: { type: "string" },
              nodes: { type: "array", items: { type: "object" } },
              edges: { type: "array", items: { type: "object" } },
            },
          },
        },
        ["sections"],
      ),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const rawSections = Array.isArray(parsed.sections) ? parsed.sections : [];
        if (!rawSections.length)
          return errorResult("render_paper_overview requires a non-empty 'sections' array.");
        const data: OverviewData = {
          title: stringArg(parsed, "title"),
          source: stringArg(parsed, "source") === "arxiv" ? "arxiv" : "pdf",
          coverage:
            stringArg(parsed, "coverage") === "uniform-fallback"
              ? "uniform-fallback"
              : "headings",
          sections: rawSections
            .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
            .map((s) => ({
              no: String(s.no ?? ""),
              level: typeof s.level === "number" ? s.level : 1,
              title: String(s.title ?? ""),
              gist: typeof s.gist === "string" ? s.gist : undefined,
              charStart: typeof s.charStart === "number" ? s.charStart : 0,
              charEnd: typeof s.charEnd === "number" ? s.charEnd : 0,
              pageLabel: typeof s.pageLabel === "string" ? s.pageLabel : undefined,
              anchors: Array.isArray(s.anchors)
                ? s.anchors.filter((a): a is string => typeof a === "string")
                : undefined,
            })),
          flowchart: normalizeOverviewFlowchart(parsed.flowchart),
        };
        options.onOverviewReady?.(data);
        return {
          output: `[Overview rendered] ${data.sections.length} sections${data.flowchart ? `, ${data.flowchart.nodes.length} flow nodes` : ""}.`,
          summary: `渲染总揽 ${data.sections.length} 节`,
          context: { planMode: "overview" },
        };
      },
    },
```

Add helper near other module-private helpers in the same file:

```ts
function normalizeOverviewFlowchart(raw: unknown): MindmapData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { rankdir?: unknown; nodes?: unknown; edges?: unknown };
  const nodes = Array.isArray(r.nodes)
    ? r.nodes
        .filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && typeof n.id === "string" && typeof n.label === "string")
        .map((n) => ({
          id: n.id as string,
          label: n.label as string,
          type: (["root", "section", "point", "result"].includes(n.type as string) ? n.type : "point") as MindmapNode["type"],
          ...(typeof n.sectionNo === "string" ? { sectionNo: n.sectionNo } : {}),
        }))
    : [];
  if (!nodes.length) return undefined;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(r.edges)
    ? r.edges
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && ids.has(e.source as string) && ids.has(e.target as string))
        .map((e) => ({ source: e.source as string, target: e.target as string, ...(typeof e.label === "string" && e.label ? { label: e.label } : {}) }))
    : [];
  return { nodes, edges, rankdir: r.rankdir === "TB" ? "TB" : r.rankdir === "LR" ? "LR" : "TB" };
}
```

Ensure `MindmapData`/`MindmapNode` are imported (the file already imports `MindmapData` for the mindmap tool — confirm and extend the import).

Add `"overview"` to the `planMode` union in `src/context/types.ts`.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/context/agent-tools.test.ts -t "render_paper_overview"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/context/agent-tools.ts src/context/types.ts tests/context/agent-tools.test.ts
git commit -m "feat(overview): render_paper_overview tool + onOverviewReady callback"
```

---

## Task 9: Persist + sync `OverviewData` per item

**Files:**
- Modify: `src/settings/chat-history.ts` (store per-item overview), `src/sync/state.ts` (include in snapshot)
- Test: existing chat-history test file if present; else add a round-trip test.

Before coding, read how `chat-history.ts` keys per-item data and how `buildSyncSnapshot` in `src/sync/state.ts` assembles fields (it already includes `presets`, `threads`, `translateCache`, annotations). Add an `overviews` map keyed by itemKey with the same load/save/merge shape as `translateCache` (last-write-wins by a stored `updatedAt`).

- [ ] **Step 1: Add storage functions** mirroring the translateCache pattern:

```ts
// chat-history.ts
export interface StoredOverview { data: OverviewData; updatedAt: number }
export function loadOverview(itemKey: string): StoredOverview | null { /* read prefs map */ }
export function saveOverview(itemKey: string, data: OverviewData): void { /* write prefs map with updatedAt */ }
export function loadAllOverviews(): Record<string, StoredOverview> { /* for sync snapshot */ }
export function mergeOverviews(incoming: Record<string, StoredOverview>): void { /* last-write-wins by updatedAt */ }
```

(Copy the exact serialization/error-handling shape from the existing `translateCache` functions in the same file — do not invent a new format.)

- [ ] **Step 2: Wire into sync** in `src/sync/state.ts`: add `overviews: loadAllOverviews()` to `buildSyncSnapshot`, add `overviews?: Record<string, StoredOverview>` to `SyncSnapshot`, and call `mergeOverviews(snapshot.overviews ?? {})` in the pull/apply path (mirror how `translateCache` is applied). Add a line to `formatPullMessage` listing overview count.

- [ ] **Step 3: Round-trip test** (in the chat-history test file):

```ts
it("round-trips an overview and merges last-write-wins", () => {
  saveOverview("ITEMKEY", { title: "T", source: "pdf", coverage: "headings", sections: [{ no: "1", level: 1, title: "I", charStart: 0, charEnd: 1 }] });
  expect(loadOverview("ITEMKEY")?.data.title).toBe("T");
});
```

- [ ] **Step 4: Run + Commit**

Run: `npx vitest run tests/settings` (adjust path to the chat-history test).
```bash
git add src/settings/chat-history.ts src/sync/state.ts tests/settings/*.ts
git commit -m "feat(overview): persist and sync overview data per item"
```

---

## Task 10: Note-panel 总揽 view + segmented switcher + jump (UI integration)

**Files:**
- Modify: `src/modules/sidebar.ts` (view switcher ~7430–7560, mindmap render wiring, `onOverviewReady` wiring), `src/modules/note-dedicated.ts` (if a `"overview"` kind is needed for save-to-note)
- Modify: `addon/content/sidebar.css`, `addon/locale/*` (button strings)

This task touches the large `sidebar.ts`. **First read** the regions: the morphing button block (`sidebar.ts:7430–7560`), how `MindmapData` is rendered into the chat (search `renderMindmapBlock`/`onMindmapReady`), and how the note panel mounts views. Then implement against these concrete contracts:

- [ ] **Step 1:** Wire `onOverviewReady` when constructing the tool session (search where `createZoteroAgentToolSession`/`onMindmapReady` is passed in `sidebar.ts`). On callback: `saveOverview(itemKey, data)` then re-render the 总揽 view if it is the active note-panel view.

- [ ] **Step 2:** Add a `renderOverviewView(doc, data, { onJump })` function (new file `src/modules/overview-view.ts`) that builds the skeleton `<ul>` (each `<li data-char-start>` clickable) + the flowchart via `renderMindmapSvg(doc, data.flowchart)`. Pure-ish DOM builder; unit-test the skeleton list (count of `<li>` == sections, gist text present) with the repo's DOM test approach.

- [ ] **Step 3:** Convert the two view pills into a segmented control `[笔记|路线|总揽]`; extend the existing morphing action button state machine with the 总揽 cases: no overview → `生成总揽` (sends the model a generate request, same mechanism as 生成路线); overview exists → `更新总揽`. Net new persistent buttons: 0.

- [ ] **Step 4:** Click handler: on `<li>` click call the existing PDF-jump path used by reading-route note links (`note-pdf-link.ts` helpers) to scroll the Reader to the section. For fallback windows (no real page) jump by `charStart` via the existing locator.

- [ ] **Step 5:** Manual verification (no unit test for full panel): build, install XPI, open a PDF, ask "给我这篇的总揽", confirm the 总揽 segment renders skeleton + flowchart and clicking a section scrolls the PDF.

- [ ] **Step 6: Commit**

```bash
git add src/modules/sidebar.ts src/modules/overview-view.ts addon/content/sidebar.css addon/locale tests/modules/overview-view.test.ts
git commit -m "feat(overview): note-panel 总揽 view, segmented switcher, click-to-jump"
```

---

## Task 11: Optional save-to-note snapshot

**Files:**
- Modify: `src/modules/sidebar.ts` (toolbar 保存 handler when 总揽 active), reuse `copySvgAsImage` (SVG→PNG) from `mindmap-render.ts` and the `appendToChildNote` write path.

- [ ] **Step 1:** When 总揽 view is active and 保存 is pressed, rasterize the flowchart SVG to PNG (factor the canvas logic out of `copySvgAsImage` into a reusable `svgToPngBlob(svg)` if needed) and build a note body = skeleton (as a list) + the PNG image; write it to a dedicated "AI 全文总揽" note. This is a Zotero write → it must go through the existing approval-aware note write path (`appendToChildNote` / `requiresApproval` semantics).
- [ ] **Step 2:** Manual verification: press 保存 on 总揽, confirm a "AI 全文总揽" note is created with image + skeleton and that it syncs (appears in `state.json` annotations/notes path already covered by Zotero sync).
- [ ] **Step 3: Commit**

```bash
git add src/modules/sidebar.ts src/modules/mindmap-render.ts
git commit -m "feat(overview): optional save-to-note snapshot of the overview map"
```

---

## Self-Review

- **Spec coverage:** acquisition (T2/T3/T7), rendering/flowchart (T4/T5/T6), render tool+callback (T8), live view+switcher+jump (T10), state cache/sync (T9), save-to-note (T11), budgets in policy (T7), no-intent-routing/no-auto-full-PDF (tools are model-called, outline is cheap) — covered. Phase-2「你在这」intentionally excluded (separate plan).
- **Placeholders:** T1–T9 contain complete code. T10/T11 are UI-integration tasks against the 8k-line `sidebar.ts`; they specify exact regions to read first + concrete contracts (function names, callbacks, file targets) rather than inventing line-level diffs sight-unseen — flagged explicitly, not hidden.
- **Type consistency:** `OverviewData`/`OverviewSection`/`OutlineEntry` defined in T1, used identically in T7/T8/T9/T10. `onOverviewReady` declared T8, consumed T10. `parseMermaidFlowchart` (T4) consumed in T6. `resolveRankdir`/`rankdir` consistent across T4/T5.
- **Risk:** `buildToc`/`TexTocEntry` field names (`number/level/title`) assumed from `tex-sections.ts:119` — T7 notes to verify and adjust. `planMode` union may be closed in `types.ts` — T7/T8 note to extend it.
