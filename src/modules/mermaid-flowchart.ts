import type { MindmapData, MindmapEdge, MindmapNode } from "../providers/types";

// Parse a subset of mermaid `flowchart`/`graph` into MindmapData.
// We do NOT use the Mermaid library (CSP `unsafe-eval` blocks it in Gecko) —
// same constraint as the mindmap parser. Supported:
//   header: `flowchart TD|TB|LR|RL|BT` / `graph ...`
//   node shapes: A[rect] A(round) A{{hexagon}}/A{...} A((circle))
//   edges: `A --> B`, `A -->|label| B`
// Returns null for any source whose first token is not flowchart/graph, so
// the mindmap parser keeps priority for `mindmap` blocks.

const HEADER_RE = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i;
const EDGE_RE = /^(.+?)\s*-->\s*(?:\|([^|]*)\|\s*)?(.+)$/;
const NODE_RE =
  /^([A-Za-z0-9_]+)\s*(\[\[?|\(\(?|\{\{?)?\s*([^\]\)\}]*)\s*(\]\]?|\)\)?|\}\}?)?$/;

function nodeType(open?: string): MindmapNode["type"] {
  if (open === "((") return "root";
  if (open === "{{" || open === "{") return "result";
  if (open === "(") return "section";
  return "point";
}

export function parseMermaidFlowchart(source: string): MindmapData | null {
  const lines = source
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const header = lines[0]?.match(HEADER_RE);
  if (!header) return null;

  const dir = header[1].toUpperCase();
  const rankdir: MindmapData["rankdir"] =
    dir === "LR" || dir === "RL" ? "LR" : "TB";

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
