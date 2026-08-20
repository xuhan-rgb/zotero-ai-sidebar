import { describe, expect, it } from "vitest";
import { parseGraphvizDot } from "../../src/modules/graphviz-dot";

const LAW_DOT = String.raw`digraph LAW_Roadmap {
  rankdir=TB;
  node [shape=box, style=filled, fillcolor=lightblue];
  subgraph cluster_core {
    label="核心方法 (LAW)";
    Encoder [label="视觉编码器\n(Backbone+视角转换)"];
    V_t [label="当前视觉隐变量 V_t\n(透视/BEV特征)"];
    Decoder [label="航点解码器\n(交叉注意力+MLP)"];
  }
  Encoder -> V_t -> Decoder;
  Decoder -> L_per [style=dashed, label="感知头"];
  FutureImages -> V_t_label [style=invis];
  // 实际连接
  Benchmarks -> NuScenes;
}`;

describe("parseGraphvizDot", () => {
  it("parses the DeepSeek DOT subset used by the LAW roadmap", () => {
    const data = parseGraphvizDot(LAW_DOT)!;

    expect(data.rankdir).toBe("TB");
    expect(data.source).toBe(LAW_DOT);
    expect(data.nodes.find((node) => node.id === "Encoder")?.label).toBe(
      "视觉编码器\n(Backbone+视角转换)",
    );
    expect(data.nodes.some((node) => node.id === "V_t_label")).toBe(false);
    expect(data.edges).toEqual(
      expect.arrayContaining([
        { source: "Encoder", target: "V_t" },
        { source: "V_t", target: "Decoder" },
        { source: "Decoder", target: "L_per", label: "感知头" },
        { source: "Benchmarks", target: "NuScenes" },
      ]),
    );
  });

  it("returns null for non-DOT input", () => {
    expect(parseGraphvizDot("flowchart TD\nA --> B")).toBeNull();
  });
});
