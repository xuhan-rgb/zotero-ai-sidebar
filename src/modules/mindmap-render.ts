// structuredClone is not available in Zotero's XUL sandbox (added to browsers
// in 2022 but Zotero's privileged context does not expose it). Dagre/graphlib
// uses it internally when serializing graph state during layout. Polyfill with
// JSON round-trip, which is equivalent for the plain-object graph labels dagre
// produces.
if (typeof structuredClone === "undefined") {
  (globalThis as Record<string, unknown>).structuredClone = <T>(v: T): T =>
    JSON.parse(JSON.stringify(v)) as T;
}

import { Graph as DagreGraph } from "@dagrejs/graphlib";
import { layout as dagreLayout } from "@dagrejs/dagre";
import type { MindmapData, MindmapEdge, MindmapNode } from "../providers/types";

const SVG_NS = "http://www.w3.org/2000/svg";

// Layout direction: honor an explicit rankdir (flowchart TD => TB), else keep
// the historical LR default used by mindmaps.
export function resolveRankdir(data: MindmapData): "TB" | "LR" {
  return data.rankdir === "TB" ? "TB" : "LR";
}

// ── Layout constants ─────────────────────────────────────────────────────────
const FONT_SIZE = 11.5;
const H_PAD = 18; // horizontal padding inside node
const V_PAD = 10; // vertical padding inside node
const MAX_LINE_W = 180; // max text width before wrapping
const MAX_LINES = 3;
const LINE_H = FONT_SIZE * 1.35;

function nodeRadius(type?: string): number {
  return type === "root"
    ? 10
    : type === "section" || type === "result" || type === "innovation"
      ? 7
      : 5;
}

// Innovation nodes get a ✦ prefix (deduped) so they read as "this is a
// contribution" alongside the gold styling.
function displayLabel(node: MindmapNode): string {
  if (node.type === "innovation") {
    return `✦ ${node.label.replace(/^✦\s*/, "")}`;
  }
  return node.label;
}

// Approximate rendered width. CJK / full-width glyphs are ~1 em; ASCII ~0.55 em.
// WHY per-char: a single ASCII px-per-char constant badly under-measures Chinese
// (no spaces to wrap on, ~2× wider), so nodes were mis-sized and overlapped.
function charWidthPx(ch: string): number {
  return /[⺀-鿿　-〿＀-￯]/.test(ch)
    ? FONT_SIZE * 1.02
    : FONT_SIZE * 0.55;
}

function textWidthPx(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidthPx(ch);
  return w;
}

function wrapLabel(label: string): string[] {
  if (textWidthPx(label) <= MAX_LINE_W) return [label];
  // Split at delimiters (keep them); any unit still wider than a line is
  // broken per-character so spaceless CJK runs still wrap.
  const units: string[] = [];
  for (const unit of label.split(/(?<=[\s,/·、，。：:+\-—])/)) {
    if (!unit) continue;
    if (textWidthPx(unit) <= MAX_LINE_W) {
      units.push(unit);
      continue;
    }
    let chunk = "";
    for (const ch of unit) {
      if (chunk && textWidthPx(chunk + ch) > MAX_LINE_W) {
        units.push(chunk);
        chunk = "";
      }
      chunk += ch;
    }
    if (chunk) units.push(chunk);
  }
  const lines: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && textWidthPx(current + unit) > MAX_LINE_W) {
      lines.push(current.trim());
      current = unit;
    } else {
      current += unit;
    }
  }
  if (current.trim()) lines.push(current.trim());
  if (lines.length <= MAX_LINES) return lines.length ? lines : [label];
  // Truncated: keep MAX_LINES, ellipsize the last.
  const kept = lines.slice(0, MAX_LINES);
  let last = kept[MAX_LINES - 1];
  while (last && textWidthPx(last + "…") > MAX_LINE_W) last = last.slice(0, -1);
  kept[MAX_LINES - 1] = last + "…";
  return kept;
}

function nodeDimensions(
  label: string,
  type?: string,
): { width: number; height: number; lines: string[] } {
  const lines = wrapLabel(label);
  const maxLineW = Math.max(...lines.map((l) => textWidthPx(l)));
  const width = Math.max(
    type === "root" ? 120 : type === "section" ? 100 : 80,
    Math.min(maxLineW + H_PAD * 2, MAX_LINE_W + H_PAD * 2),
  );
  const height = lines.length * LINE_H + V_PAD * 2;
  return { width, height, lines };
}

function buildArrowMarker(doc: Document, id: string): Element {
  const marker = doc.createElementNS(SVG_NS, "marker");
  marker.setAttribute("id", id);
  marker.setAttribute("markerWidth", "9");
  marker.setAttribute("markerHeight", "9");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "3.5");
  marker.setAttribute("orient", "auto");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M0,0.5 L0,6.5 L8,3.5 z");
  path.setAttribute("class", "zai-mm-arrow-fill");
  marker.append(path);
  return marker;
}

// Smooth cubic bezier — auto-detects horizontal (LR) vs vertical (TB) edges.
function bezierPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return "";
  const p0 = pts[0];
  const pN = pts[pts.length - 1];
  if (pts.length === 2) {
    const dx = Math.abs(pN.x - p0.x);
    const dy = Math.abs(pN.y - p0.y);
    if (dx > dy) {
      // Horizontal edge (LR layout): S-curve along X axis
      const midX = (p0.x + pN.x) / 2;
      return `M${p0.x},${p0.y} C${midX},${p0.y} ${midX},${pN.y} ${pN.x},${pN.y}`;
    }
    // Vertical edge (TB layout): S-curve along Y axis
    const midY = (p0.y + pN.y) / 2;
    return `M${p0.x},${p0.y} C${p0.x},${midY} ${pN.x},${midY} ${pN.x},${pN.y}`;
  }
  let d = `M${p0.x},${p0.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const cx = (prev.x + curr.x) / 2;
    const cy = (prev.y + curr.y) / 2;
    const cx2 = (curr.x + next.x) / 2;
    const cy2 = (curr.y + next.y) / 2;
    d += ` C${cx},${cy} ${curr.x},${curr.y} ${cx2},${cy2}`;
  }
  d += ` L${pN.x},${pN.y}`;
  return d;
}

export function renderMindmapSvg(
  doc: Document,
  data: MindmapData,
): SVGSVGElement {
  const g = new DagreGraph();
  g.setGraph({
    rankdir: resolveRankdir(data),
    ranksep: 56,
    nodesep: 30,
    edgesep: 14,
    marginx: 26,
    marginy: 26,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
  const dimMap = new Map<string, ReturnType<typeof nodeDimensions>>();

  for (const node of data.nodes) {
    const dim = nodeDimensions(displayLabel(node), node.type);
    dimMap.set(node.id, dim);
    g.setNode(node.id, { width: dim.width, height: dim.height });
  }

  for (const edge of data.edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      g.setEdge(
        edge.source,
        edge.target,
        edge.label
          ? { label: edge.label, width: textWidthPx(edge.label) + 8, height: 14 }
          : {},
      );
    }
  }

  dagreLayout(g);

  const gi = g.graph();
  const svgW = (gi.width ?? 400) + 56;
  const svgH = (gi.height ?? 300) + 56;

  const markerId = `zai-mm-arr-${Math.random().toString(36).slice(2, 7)}`;

  const svg = doc.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("data-natural-w", String(svgW));
  svg.setAttribute("data-natural-h", String(svgH));
  svg.setAttribute("class", "zai-mm-svg");

  const defs = doc.createElementNS(SVG_NS, "defs");
  defs.append(buildArrowMarker(doc, markerId));
  svg.append(defs);

  // Edges
  const edgeGroup = doc.createElementNS(SVG_NS, "g");
  edgeGroup.setAttribute("class", "zai-mm-edges");
  for (const e of g.edges()) {
    const ei = g.edge(e);
    const pts = ei.points as Array<{ x: number; y: number }>;
    if (!pts || pts.length < 2) continue;
    const d = bezierPath(pts);
    if (!d) continue;
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "zai-mm-edge");
    path.setAttribute("marker-end", `url(#${markerId})`);
    edgeGroup.append(path);
    if (ei.label) {
      const text = String(ei.label);
      const fallback = pts[Math.floor(pts.length / 2)];
      const lx = typeof ei.x === "number" ? ei.x : fallback.x;
      const ly = typeof ei.y === "number" ? ei.y : fallback.y;
      const bw = textWidthPx(text) + 8;
      const bg = doc.createElementNS(SVG_NS, "rect");
      bg.setAttribute("x", String(lx - bw / 2));
      bg.setAttribute("y", String(ly - 8));
      bg.setAttribute("width", String(bw));
      bg.setAttribute("height", "14");
      bg.setAttribute("rx", "3");
      bg.setAttribute("class", "zai-mm-elabel-bg");
      edgeGroup.append(bg);
      const lbl = doc.createElementNS(SVG_NS, "text");
      lbl.setAttribute("x", String(lx));
      lbl.setAttribute("y", String(ly + 3));
      lbl.setAttribute("text-anchor", "middle");
      lbl.setAttribute("class", "zai-mm-elabel");
      lbl.textContent = text;
      edgeGroup.append(lbl);
    }
  }
  svg.append(edgeGroup);

  // Nodes
  const nodeGroup = doc.createElementNS(SVG_NS, "g");
  nodeGroup.setAttribute("class", "zai-mm-nodes");
  for (const id of g.nodes()) {
    const nd = g.node(id);
    const orig = nodeMap.get(id);
    const type = orig?.type ?? "point";
    const r = nodeRadius(type);
    const x = nd.x - nd.width / 2;
    const y = nd.y - nd.height / 2;
    const dim = dimMap.get(id) ?? { lines: [orig?.label ?? id] };

    const grp = doc.createElementNS(SVG_NS, "g");
    grp.setAttribute("class", `zai-mm-node zai-mm-node-${type}`);
    if (orig?.sectionNo) grp.setAttribute("data-section-no", orig.sectionNo);

    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(nd.width));
    rect.setAttribute("height", String(nd.height));
    rect.setAttribute("rx", String(r));
    rect.setAttribute("ry", String(r));
    grp.append(rect);

    const lines = dim.lines;
    const totalTextH = lines.length * LINE_H;
    const textStartY = nd.y - totalTextH / 2 + LINE_H / 2;

    const textEl = doc.createElementNS(SVG_NS, "text");
    textEl.setAttribute("x", String(nd.x));
    textEl.setAttribute("text-anchor", "middle");
    textEl.setAttribute("dominant-baseline", "middle");
    for (let i = 0; i < lines.length; i++) {
      const tspan = doc.createElementNS(SVG_NS, "tspan");
      tspan.setAttribute("x", String(nd.x));
      tspan.setAttribute("y", String(textStartY + i * LINE_H));
      tspan.textContent = lines[i];
      textEl.append(tspan);
    }
    grp.append(textEl);
    nodeGroup.append(grp);
  }
  svg.append(nodeGroup);

  return svg;
}

// ── Mermaid mindmap parser ───────────────────────────────────────────────────
// Parses the Mermaid `mindmap` diagram syntax into MindmapData.
// We do NOT use the Mermaid library (CSP `unsafe-eval` blocks it in Gecko).
// Only the `mindmap` diagram type is supported; other Mermaid types are skipped.

interface StackEntry {
  id: string;
  indent: number;
}

function countLeadingSpaces(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

function extractMermaidNodeInfo(raw: string): {
  label: string;
  type: MindmapNode["type"];
} {
  // ((text)) — circle/root — may have optional id prefix: root((label))
  const circleMatch = raw.match(/\(\((.+)\)\)$/);
  if (circleMatch) return { label: circleMatch[1], type: "root" };
  // )(text)( — bang shape
  const bangMatch = raw.match(/\)\((.+)\)\($/);
  if (bangMatch) return { label: bangMatch[1], type: "root" };
  // {{text}} or {text} — hexagon, may have id prefix
  const hexaMatch = raw.match(/\{\{(.+)\}\}$/) ?? raw.match(/\{(.+)\}$/);
  if (hexaMatch) return { label: hexaMatch[1], type: "section" };
  // [text] — square, may have id prefix
  const squareMatch = raw.match(/\[(.+)\]$/);
  if (squareMatch) return { label: squareMatch[1], type: "section" };
  // (text) — rounded, may have id prefix
  const roundMatch = raw.match(/\((.+)\)$/);
  if (roundMatch) return { label: roundMatch[1], type: "section" };
  return { label: raw, type: "point" };
}

export function parseMermaidMindmap(source: string): MindmapData | null {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "mindmap") return null;

  const nodes: MindmapNode[] = [];
  const edges: MindmapEdge[] = [];
  const stack: StackEntry[] = [];
  let counter = 0;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const indent = countLeadingSpaces(line);
    const raw = line.trim();

    // Pop stack entries at the same or deeper indent — they are siblings
    // or children already processed.
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const { label, type } = extractMermaidNodeInfo(raw);
    const resolvedType: MindmapNode["type"] =
      nodes.length === 0 && type === "point" ? "root" : type;
    const id = `mm${counter++}`;
    nodes.push({ id, label, type: resolvedType });

    if (stack.length > 0) {
      edges.push({ source: stack[stack.length - 1].id, target: id });
    }
    stack.push({ id, indent });
  }

  return nodes.length > 0 ? { nodes, edges } : null;
}

// ── Block renderer ───────────────────────────────────────────────────────────

function toMermaidSource(data: MindmapData): string {
  const childMap = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of data.edges) {
    if (!childMap.has(edge.source)) childMap.set(edge.source, []);
    childMap.get(edge.source)!.push(edge.target);
    hasParent.add(edge.target);
  }
  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
  const roots = data.nodes.filter((n) => !hasParent.has(n.id));
  const lines = ["mindmap"];
  const visit = (id: string, depth: number) => {
    const node = nodeMap.get(id);
    if (!node) return;
    const pad = "  ".repeat(depth);
    if (node.type === "root") lines.push(`${pad}root((${node.label}))`);
    else if (node.type === "section") lines.push(`${pad}(${node.label})`);
    else lines.push(`${pad}${node.label}`);
    for (const child of childMap.get(id) ?? []) visit(child, depth + 1);
  };
  for (const r of roots) visit(r.id, 1);
  return lines.join("\n");
}

function copySvgAsImage(
  svgEl: SVGSVGElement,
  doc: Document,
  btn: HTMLElement,
): void {
  const win = doc.defaultView;
  if (!win) return;

  const w = parseFloat(svgEl.getAttribute("data-natural-w") ?? "400");
  const h = parseFloat(svgEl.getAttribute("data-natural-h") ?? "300");

  // Inline critical CSS so the exported image includes styles.
  const styleText = `
    .zai-mm-edge { fill:none; stroke:#c0b4a6; stroke-width:1.5px; }
    .zai-mm-arrow-fill { fill:#c0b4a6; }
    .zai-mm-node rect { fill:#fffdf8; stroke:#d8c9b6; stroke-width:1.2px; }
    .zai-mm-node text, .zai-mm-node tspan { font-family:sans-serif; font-size:11.5px; fill:#24211d; }
    .zai-mm-node-section rect { fill:#fbfaf7; stroke:#c0673d; stroke-width:1.4px; }
    .zai-mm-node-section text, .zai-mm-node-section tspan { font-weight:500; }
    .zai-mm-node-root rect { fill:#fff0e7; stroke:#c0673d; stroke-width:2px; }
    .zai-mm-node-root text, .zai-mm-node-root tspan { font-weight:600; fill:#a94e25; font-size:12px; }
    .zai-mm-node-result rect { fill:#eaf4ff; stroke:#3b7ec0; stroke-width:1.4px; }
    .zai-mm-node-result text, .zai-mm-node-result tspan { font-weight:600; fill:#2f6aa0; }
    .zai-mm-node-innovation rect { fill:#eaf5ea; stroke:#4a9a4a; stroke-width:1.8px; }
    .zai-mm-node-innovation text, .zai-mm-node-innovation tspan { font-weight:700; fill:#2f6b2f; }
  `;

  // Clone SVG and embed the style; restore explicit pixel dimensions for rasterisation
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const styleEl = doc.createElementNS(SVG_NS, "style");
  styleEl.textContent = styleText;
  clone.insertBefore(styleEl, clone.firstChild);
  clone.setAttribute("xmlns", SVG_NS);

  const serial = new win.XMLSerializer();
  const svgStr = serial.serializeToString(clone);
  const blob = new win.Blob([svgStr], { type: "image/svg+xml" });
  const url = win.URL.createObjectURL(blob);

  const img = new win.Image(w, h);
  img.addEventListener("load", () => {
    const canvas = doc.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!ctx) {
      win.URL.revokeObjectURL(url);
      return;
    }
    ctx.scale(2, 2);
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img as unknown as HTMLImageElement, 0, 0);
    win.URL.revokeObjectURL(url);

    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      const item = new win.ClipboardItem({ "image/png": pngBlob });
      void (win.navigator.clipboard as Clipboard).write([item]);
      btn.textContent = "已复制";
      win.setTimeout(() => {
        btn.textContent = "复制图片";
      }, 1600);
    }, "image/png");
  });
  img.src = url;
}

// Wheel-zoom toward the cursor + drag-to-pan + double-click reset, by mutating
// the SVG viewBox — lets users magnify a dense flowchart to read it. A drag
// past a small threshold suppresses the trailing click so panning doesn't also
// select a node.
function enablePanZoom(svg: SVGSVGElement): void {
  const W = parseFloat(svg.getAttribute("data-natural-w") || "0");
  const H = parseFloat(svg.getAttribute("data-natural-h") || "0");
  if (!W || !H) return;
  let vb = { x: 0, y: 0, w: W, h: H };
  const apply = () =>
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.style.cursor = "grab";
  svg.style.touchAction = "none";

  svg.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      e.preventDefault();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      const nw = Math.max(W * 0.25, Math.min(vb.w * factor, W * 1.6));
      const nh = Math.max(H * 0.25, Math.min(vb.h * factor, H * 1.6));
      vb = {
        x: vb.x + (vb.w - nw) * px,
        y: vb.y + (vb.h - nh) * py,
        w: nw,
        h: nh,
      };
      apply();
    },
    { passive: false },
  );

  let dragging = false;
  let moved = false;
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  svg.addEventListener("pointerdown", (e: PointerEvent) => {
    dragging = true;
    moved = false;
    sx = e.clientX;
    sy = e.clientY;
    ox = vb.x;
    oy = vb.y;
    svg.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    vb.x = ox - (dx / rect.width) * vb.w;
    vb.y = oy - (dy / rect.height) * vb.h;
    apply();
  });
  const endDrag = () => {
    dragging = false;
    svg.style.cursor = "grab";
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointerleave", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    },
    true,
  );
  svg.addEventListener("dblclick", (e: MouseEvent) => {
    e.preventDefault();
    vb = { x: 0, y: 0, w: W, h: H };
    apply();
  });
}

export function renderMindmapBlock(
  doc: Document,
  data: MindmapData,
): HTMLElement {
  const source = data.source ?? toMermaidSource(data);
  const wrap = doc.createElement("div");
  wrap.className = "mindmap-block";

  // Header: title + tab pills (渲染 / 原格式) + copy button
  const header = doc.createElement("div");
  header.className = "mindmap-header";

  const titleSpan = doc.createElement("span");
  titleSpan.className = "mindmap-title";
  titleSpan.textContent = data.title ?? "结构图";
  header.append(titleSpan);

  const tabs = doc.createElement("div");
  tabs.className = "mindmap-tabs";

  const previewTab = doc.createElement("button");
  previewTab.className = "mindmap-tab mindmap-tab-active";
  previewTab.textContent = "渲染";

  const codeTab = doc.createElement("button");
  codeTab.className = "mindmap-tab";
  codeTab.textContent = "原格式";

  tabs.append(previewTab, codeTab);
  header.append(tabs);

  let svgEl: SVGSVGElement | null = null;
  let showingCode = false;

  const copyBtn = doc.createElement("button");
  copyBtn.className = "mindmap-copy-btn";
  copyBtn.textContent = "复制图片";
  copyBtn.title = "复制为 PNG 图片";
  copyBtn.addEventListener("click", () => {
    if (showingCode) {
      const win = doc.defaultView;
      if (!win) return;
      void win.navigator.clipboard.writeText(source).then(() => {
        copyBtn.textContent = "已复制";
        win.setTimeout(() => { copyBtn.textContent = "复制代码"; }, 1600);
      });
    } else {
      if (svgEl) copySvgAsImage(svgEl, doc, copyBtn);
    }
  });
  header.append(copyBtn);

  wrap.append(header);

  // Preview pane
  const svgWrap = doc.createElement("div");
  svgWrap.className = "mindmap-svg-wrap";
  try {
    svgEl = renderMindmapSvg(doc, data);
    svgWrap.append(svgEl);
    enablePanZoom(svgEl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { (globalThis as { Zotero?: { debug?: (s: string) => void } }).Zotero?.debug?.(`[zai-mindmap] render error: ${msg}`); } catch { /* ignore */ }
    const errEl = doc.createElement("div");
    errEl.className = "mindmap-error";
    errEl.textContent = `无法渲染结构图: ${msg}`;
    svgWrap.append(errEl);
  }

  // Code pane
  const codePre = doc.createElement("pre");
  codePre.className = "mindmap-source";
  codePre.textContent = source;
  codePre.style.display = "none";

  wrap.append(svgWrap, codePre);

  // Tab switching
  previewTab.addEventListener("click", () => {
    showingCode = false;
    svgWrap.style.display = "";
    codePre.style.display = "none";
    copyBtn.textContent = "复制图片";
    copyBtn.title = "复制为 PNG 图片";
    previewTab.classList.add("mindmap-tab-active");
    codeTab.classList.remove("mindmap-tab-active");
  });
  codeTab.addEventListener("click", () => {
    showingCode = true;
    svgWrap.style.display = "none";
    codePre.style.display = "";
    copyBtn.textContent = "复制代码";
    copyBtn.title = "复制 Mermaid 源码";
    codeTab.classList.add("mindmap-tab-active");
    previewTab.classList.remove("mindmap-tab-active");
  });

  return wrap;
}
