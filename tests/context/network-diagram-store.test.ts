import { beforeEach, describe, expect, it } from "vitest";
import {
  appendNetworkDiagramRevision,
  clearNetworkDiagramMessages,
  loadNetworkDiagramWorkspace,
  saveNetworkDiagramWorkspace,
  undoNetworkDiagramRevision,
} from "../../src/context/network-diagram-store";
import type { NetworkDiagramWorkspace } from "../../src/context/network-diagram-types";

let files: Map<string, string>;

beforeEach(() => {
  files = new Map();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      DataDirectory: { dir: "/tmp/zotero-data" },
      Profile: { dir: "/tmp/zotero-profile" },
      File: {
        getContentsAsync: async (path: string) => {
          const value = files.get(path);
          if (value == null) throw new Error(`missing file: ${path}`);
          return value;
        },
        putContentsAsync: async (path: string, contents: string) => {
          files.set(path, contents);
        },
      },
    },
  });
});

const emptyWorkspace = (): NetworkDiagramWorkspace => ({
  itemKey: "ITEM",
  revisions: [],
  messages: [],
  evidenceIndex: [],
});

describe("network diagram workspace store", () => {
  it("persists a paper repository link before any graph is analyzed", async () => {
    await saveNetworkDiagramWorkspace(
      "ITEM",
      {
        ...emptyWorkspace(),
        linkedRepositoryURL: "https://github.com/owner/repo",
      },
      100,
    );

    const restored = await loadNetworkDiagramWorkspace("ITEM");
    expect(restored?.workspace.linkedRepositoryURL).toBe(
      "https://github.com/owner/repo",
    );
    expect(restored?.workspace.revisions).toEqual([]);
  });

  it("persists revisions, evidence and the independent diagram conversation", async () => {
    const workspace = appendNetworkDiagramRevision(emptyWorkspace(), {
      id: "v1",
      createdAt: 100,
      userInstruction: "首次生成",
      assistantSummary: "详细 v1",
      usage: { input: 1234, output: 56, cacheRead: 789 },
      evidenceIDs: ["code:1"],
      changedNodeIDs: ["input"],
      graph: {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "Input",
            type: "root",
            stage: "inputs-preprocess",
            description: "input",
            notes: {
              parameters: "none",
              dataFlow: "point_clouds enters the forward path",
              objective: "none",
              attribution: "input-output",
              implementation: "Model.forward(point_clouds)",
            },
            evidenceIDs: ["code:1"],
          },
        ],
        edges: [],
      },
    });
    workspace.messages.push({
      id: "m1",
      role: "assistant",
      content: "可以继续优化",
      createdAt: 101,
    });
    workspace.evidenceIndex.push({
      id: "code:1",
      kind: "code",
      label: "models/net.py",
      path: "models/net.py",
      commitSHA: "sha",
    });

    await saveNetworkDiagramWorkspace("ITEM", workspace, 200);
    const restored = await loadNetworkDiagramWorkspace("ITEM");

    expect(restored?.workspace.currentRevisionID).toBe("v1");
    expect(restored?.workspace.revisions[0].usage).toEqual({
      input: 1234,
      output: 56,
      cacheRead: 789,
    });
    expect(restored?.workspace.messages[0].content).toBe("可以继续优化");
    expect(restored?.workspace.evidenceIndex[0].path).toBe("models/net.py");
    expect(restored?.workspace.revisions[0].graph.nodes[0].notes).toEqual({
      parameters: "none",
      dataFlow: "point_clouds enters the forward path",
      objective: "none",
      attribution: "input-output",
      implementation: "Model.forward(point_clouds)",
    });
  });

  it("undoes by moving the pointer without deleting later revisions", () => {
    let workspace = emptyWorkspace();
    workspace = appendNetworkDiagramRevision(workspace, {
      id: "v1",
      createdAt: 1,
      userInstruction: "one",
      assistantSummary: "one",
      graph: { rankdir: "TB", nodes: [], edges: [] },
      evidenceIDs: [],
      changedNodeIDs: [],
    });
    workspace = appendNetworkDiagramRevision(workspace, {
      id: "v2",
      parentID: "v1",
      createdAt: 2,
      userInstruction: "two",
      assistantSummary: "two",
      graph: { rankdir: "TB", nodes: [], edges: [] },
      evidenceIDs: [],
      changedNodeIDs: [],
    });

    const undone = undoNetworkDiagramRevision(workspace);
    expect(undone.currentRevisionID).toBe("v1");
    expect(undone.latestRevisionID).toBe("v2");
    expect(undone.revisions).toHaveLength(2);
  });

  it("clears only the independent diagram conversation", () => {
    const workspace: NetworkDiagramWorkspace = {
      ...emptyWorkspace(),
      linkedRepositoryURL: "https://github.com/owner/repo",
      messages: [{ id: "m1", role: "user", content: "优化节点", createdAt: 1 }],
      evidenceIndex: [{ id: "code:1", kind: "code", label: "model.py" }],
      revisions: [
        {
          id: "v1",
          createdAt: 1,
          userInstruction: "生成",
          assistantSummary: "完成",
          graph: { rankdir: "TB", nodes: [], edges: [] },
          evidenceIDs: ["code:1"],
          changedNodeIDs: [],
        },
      ],
    };

    const cleared = clearNetworkDiagramMessages(workspace);

    expect(cleared.messages).toEqual([]);
    expect(cleared.revisions).toEqual(workspace.revisions);
    expect(cleared.evidenceIndex).toEqual(workspace.evidenceIndex);
    expect(cleared.linkedRepositoryURL).toBe(workspace.linkedRepositoryURL);
  });
});
