import type { MindmapData, MindmapEdge, MindmapNode } from "../providers/types";

const ID = String.raw`(?:"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_:.]*)`;
const EDGE_RE = new RegExp(
  `^(${ID}(?:\\s*->\\s*${ID})+)(?:\\s*(\\[.*\\]))?$`,
  "s",
);
const NODE_RE = new RegExp(`^(${ID})\\s*(\\[.*\\])$`, "s");

export function parseGraphvizDot(source: string): MindmapData | null {
  const clean = stripLineComments(source);
  const header = clean.match(
    /^\s*(?:strict\s+)?digraph(?:\s+("(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_:.]*))?\s*\{/i,
  );
  if (!header) return null;

  const nodes = new Map<string, MindmapNode>();
  const edges: MindmapEdge[] = [];
  let rankdir: MindmapData["rankdir"];

  const upsert = (
    rawID: string,
    attrs: Record<string, string> = {},
  ): string => {
    const id = decodeDotValue(rawID);
    const existing = nodes.get(id);
    const label = attrs.label ?? existing?.label ?? id;
    const highlighted =
      attrs.color?.toLowerCase() === "red" ||
      Number.parseFloat(attrs.penwidth ?? "") >= 3;
    nodes.set(id, {
      id,
      label,
      type: highlighted ? "innovation" : existing?.type,
    });
    return id;
  };

  for (const statement of dotStatements(clean.slice(header[0].length))) {
    const trimmed = statement.trim();
    if (!trimmed || /^(?:subgraph|graph|node|edge)\b/i.test(trimmed)) {
      continue;
    }

    const direction = trimmed.match(/^rankdir\s*=\s*(TB|TD|LR|RL)\b/i);
    if (direction) {
      rankdir = /^(?:TB|TD)$/i.test(direction[1]) ? "TB" : "LR";
      continue;
    }

    const edgeMatch = trimmed.match(EDGE_RE);
    if (edgeMatch) {
      const attrs = parseAttributes(edgeMatch[2] ?? "");
      if (attrs.style?.toLowerCase() === "invis") continue;
      const chain = edgeMatch[1].split(/\s*->\s*/).map((id) => upsert(id));
      for (let index = 0; index < chain.length - 1; index += 1) {
        const edge: MindmapEdge = {
          source: chain[index],
          target: chain[index + 1],
        };
        if (attrs.label) edge.label = attrs.label;
        edges.push(edge);
      }
      continue;
    }

    const nodeMatch = trimmed.match(NODE_RE);
    if (nodeMatch) upsert(nodeMatch[1], parseAttributes(nodeMatch[2]));
  }

  if (nodes.size === 0) return null;
  const title = header[1] ? decodeDotValue(header[1]) : "Graphviz DOT";
  return {
    title,
    nodes: [...nodes.values()],
    edges,
    source,
    rankdir,
  };
}

function dotStatements(source: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  let bracketDepth = 0;

  for (const char of source) {
    if (quoted) {
      current += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      current += char;
    } else if (char === "[") {
      bracketDepth += 1;
      current += char;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
    } else if (
      bracketDepth === 0 &&
      (char === ";" || char === "{" || char === "}")
    ) {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function parseAttributes(source: string): Record<string, string> {
  const body = source.trim().replace(/^\[/, "").replace(/\]$/, "");
  const attrs: Record<string, string> = {};
  const pattern =
    /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:\\.|[^"\\])*"|[^,\s\]]+)/g;
  for (const match of body.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = decodeDotValue(match[2]);
  }
  return attrs;
}

function decodeDotValue(value: string): string {
  const raw =
    value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  let result = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "\\" || index + 1 >= raw.length) {
      result += raw[index];
      continue;
    }
    const next = raw[++index];
    if (next === "n" || next === "l" || next === "r") result += "\n";
    else if (next === "\\" || next === '"') result += next;
    else result += `\\${next}`;
  }
  return result;
}

function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let quoted = false;
      let escaped = false;
      for (let index = 0; index < line.length - 1; index += 1) {
        const char = line[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\" && quoted) {
          escaped = true;
          continue;
        }
        if (char === '"') quoted = !quoted;
        if (!quoted && char === "/" && line[index + 1] === "/") {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}
