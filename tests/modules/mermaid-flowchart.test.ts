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
    expect(data.nodes.map((n) => n.label).sort()).toEqual([
      "Method",
      "Problem",
      "Result",
    ]);
    expect(data.edges.length).toBe(2);
    const result = data.nodes.find((n) => n.label === "Result")!;
    expect(result.type).toBe("result"); // {{...}} => result emphasis
  });

  it("parses edge labels in -->|label| form", () => {
    const data = parseMermaidFlowchart("graph LR\n A[a] -->|because| B[b]")!;
    expect(data.rankdir).toBe("LR");
    expect(data.edges[0].label).toBe("because");
  });
});
