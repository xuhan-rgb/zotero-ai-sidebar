import { describe, expect, it } from "vitest";
import { detailedNetworkGraphToMindmap } from "../../src/context/network-diagram-types";

describe("network diagram conversion", () => {
  it("renders cached LR network graphs vertically", () => {
    const diagram = detailedNetworkGraphToMindmap({
      rankdir: "LR",
      nodes: [
        {
          id: "input",
          label: "输入",
          type: "root",
          stage: "inputs-preprocess",
          description: "输入张量",
          evidenceIDs: [],
        },
        {
          id: "output",
          label: "输出",
          type: "result",
          stage: "outputs",
          description: "预测结果",
          evidenceIDs: [],
        },
      ],
      edges: [{ source: "input", target: "output" }],
    });

    expect(diagram.rankdir).toBe("TB");
    expect(diagram.source).toMatch(/^flowchart TB/m);
  });

  it("keeps DAG nodes unique in Mermaid source and visual labels compact", () => {
    const diagram = detailedNetworkGraphToMindmap({
      rankdir: "TB",
      nodes: [
        {
          id: "input",
          label: "共享特征",
          type: "root",
          stage: "inputs-preprocess",
          description: "这是只应出现在节点说明中的较长文字",
          tensorShape: "[B,Q,D]",
          evidenceIDs: [],
        },
        {
          id: "branch-a",
          label: "检测分支",
          type: "section",
          stage: "branches-fusion",
          description: "检测",
          evidenceIDs: [],
        },
        {
          id: "branch-b",
          label: "规划分支",
          type: "innovation",
          stage: "core-innovations",
          description: "规划",
          evidenceIDs: [],
        },
        {
          id: "output",
          label: "最终输出",
          type: "result",
          stage: "outputs",
          description: "共享输出节点",
          evidenceIDs: [],
        },
      ],
      edges: [
        { source: "input", target: "branch-a" },
        { source: "input", target: "branch-b" },
        { source: "branch-a", target: "output" },
        { source: "branch-b", target: "output" },
      ],
    });

    expect(diagram.nodes[0].label).toBe("共享特征 · [B,Q,D]");
    expect(diagram.nodes[0].label).not.toContain("较长文字");
    expect(diagram.source).toMatch(/^flowchart TB/m);
    expect(diagram.source?.match(/最终输出/g)).toHaveLength(1);
    expect(diagram.source?.match(/--> n3/g)).toHaveLength(2);
  });
});
