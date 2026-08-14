import { describe, expect, it, vi } from "vitest";
import {
  openGitHubRepository,
  parsePublicGitHubRepositoryURL,
} from "../../src/context/github-repository";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub repository reader", () => {
  it("accepts only public github.com repository URLs", () => {
    expect(
      parsePublicGitHubRepositoryURL("https://github.com/owner/repo.git"),
    ).toEqual({ owner: "owner", repo: "repo" });
    expect(() =>
      parsePublicGitHubRepositoryURL("https://token@github.com/owner/repo"),
    ).toThrow(/凭证/);
    expect(() =>
      parsePublicGitHubRepositoryURL("https://example.com/owner/repo"),
    ).toThrow(/github\.com/);
  });

  it("pins a commit and reads every AI-selected file without a file-count cap", async () => {
    const files = Array.from({ length: 13 }, (_, index) => ({
      path: `models/layer-${index}.py`,
      mode: "100644",
      type: "blob",
      sha: `blob-${index}`,
      size: 30,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.github.com/repos/owner/repo") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url === "https://api.github.com/repos/owner/repo/commits/main") {
        return jsonResponse({ sha: "commit-sha" });
      }
      if (
        url ===
        "https://api.github.com/repos/owner/repo/git/trees/commit-sha?recursive=1"
      ) {
        return jsonResponse({ truncated: false, tree: files });
      }
      if (
        url.startsWith(
          "https://raw.githubusercontent.com/owner/repo/commit-sha/",
        )
      ) {
        return new Response(`class Layer:\n    pass\n# ${url}`, {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });

    const repository = await openGitHubRepository(
      "https://github.com/owner/repo",
      { fetcher },
    );
    const selected = await repository.readFiles(
      files.map((file) => ({
        path: file.path,
        startLine: 1,
        endLine: 2,
        reason: "确认逐层实现",
        coverage: "backbone-features",
      })),
    );

    expect(repository.reference.commitSHA).toBe("commit-sha");
    expect(selected).toHaveLength(13);
    expect(selected.every((file) => file.reason === "确认逐层实现")).toBe(true);
    expect(selected.every((file) => file.text.includes("class Layer"))).toBe(
      true,
    );
  });

  it("installs one fixed-commit source snapshot and reuses it without Raw requests", async () => {
    const files = [
      {
        path: "models/net.py",
        type: "blob",
        sha: "net-blob",
        size: 48,
      },
    ];
    let installed:
      | {
          files: Array<{ path: string; sha: string; size: number }>;
          readText(path: string): Promise<string | null>;
        }
      | undefined;
    const snapshotStore = {
      load: vi.fn(async () => installed ?? null),
      install: vi.fn(
        async (
          _reference: unknown,
          snapshotFiles: Array<{ path: string; sha: string; size: number }>,
          archive: Uint8Array,
        ) => {
          expect(archive).toEqual(new Uint8Array([1, 2, 3]));
          installed = {
            files: snapshotFiles,
            async readText(path: string) {
              return path === "models/net.py"
                ? "class Network:\n    def forward(self, x): return x"
                : null;
            },
          };
          return installed;
        },
      ),
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/git/trees/commit-sha")) {
        return jsonResponse({ truncated: false, tree: files });
      }
      if (url.includes("/tarball/commit-sha")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      if (url.includes("raw.githubusercontent.com")) {
        throw new Error("Raw file requests must not happen after install");
      }
      return new Response("not found", { status: 404 });
    });

    const options = {
      fetcher,
      defaultBranch: "main",
      commitSHA: "commit-sha",
      snapshotStore,
    };
    const first = await openGitHubRepository(
      "https://github.com/owner/repo",
      options,
    );
    expect((await first.searchCode("forward")).matches).toHaveLength(1);
    const networkCallsAfterInstall = fetcher.mock.calls.length;

    const second = await openGitHubRepository(
      "https://github.com/owner/repo",
      options,
    );
    expect((await second.outlineFile("models/net.py")).entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signature: "class Network:" }),
      ]),
    );

    expect(snapshotStore.install).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(networkCallsAfterInstall);
  });

  it("refuses paths that are not blobs in the pinned commit tree", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/owner/repo")) {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.endsWith("/commits/main")) return jsonResponse({ sha: "sha" });
      if (url.includes("/git/trees/sha")) {
        return jsonResponse({
          truncated: false,
          tree: [
            {
              path: "models/main.py",
              type: "blob",
              sha: "blob",
              size: 10,
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });
    const repository = await openGitHubRepository(
      "https://github.com/owner/repo",
      { fetcher },
    );

    await expect(
      repository.readFiles([
        {
          path: "../../secret.txt",
          reason: "越界",
          coverage: "inputs-preprocess",
        },
      ]),
    ).rejects.toThrow(/固定 commit/);
  });

  it("searches repository contents and outlines symbols before precise reads", async () => {
    const source = [
      "import torch",
      "",
      "class FusionBlock:",
      "    def __init__(self):",
      "        pass",
      "",
      "    def forward(self, image, context):",
      "        fused = image + context",
      "        return fused",
      "",
      "class OutputHead:",
      "    pass",
    ].join("\n");
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/owner/repo")) {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.endsWith("/commits/main")) return jsonResponse({ sha: "sha" });
      if (url.includes("/git/trees/sha")) {
        return jsonResponse({
          truncated: false,
          tree: [
            {
              path: "models/fusion.py",
              type: "blob",
              sha: "fusion-blob",
              size: source.length,
            },
          ],
        });
      }
      if (url.endsWith("/models/fusion.py")) return new Response(source);
      return new Response("not found", { status: 404 });
    });
    const repository = await openGitHubRepository(
      "https://github.com/owner/repo",
      { fetcher },
    );

    const search = await repository.searchCode("FUSED", "models/", 10);
    expect(search.matches).toEqual([
      {
        path: "models/fusion.py",
        line: 8,
        text: "fused = image + context",
      },
      {
        path: "models/fusion.py",
        line: 9,
        text: "return fused",
      },
    ]);
    expect(search.scannedFiles).toBe(1);

    const outline = await repository.outlineFile("models/fusion.py");
    expect(outline.totalLines).toBe(12);
    expect(outline.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "class",
          signature: "class FusionBlock:",
          startLine: 3,
        }),
        expect.objectContaining({
          kind: "function",
          signature: "def forward(self, image, context):",
          startLine: 7,
          endLine: 10,
        }),
      ]),
    );

    const [range] = await repository.readFiles([
      {
        path: "models/fusion.py",
        startLine: 7,
        endLine: 9,
        reason: "确认融合前向路径",
        coverage: "branches-fusion",
      },
    ]);
    expect(range.text).toContain("def forward");
    expect(range.text).toContain("return fused");
    expect(range.text).not.toContain("class OutputHead");
  });

  it("rejects oversized source ranges instead of returning an unbounded tool result", async () => {
    const source = Array.from(
      { length: 220 },
      (_, index) => `line_${index + 1} = ${index + 1}`,
    ).join("\n");
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/owner/repo")) {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.endsWith("/commits/main")) return jsonResponse({ sha: "sha" });
      if (url.includes("/git/trees/sha")) {
        return jsonResponse({
          truncated: false,
          tree: [
            {
              path: "models/large.py",
              type: "blob",
              sha: "large-blob",
              size: source.length,
            },
          ],
        });
      }
      if (url.endsWith("/models/large.py")) return new Response(source);
      return new Response("not found", { status: 404 });
    });
    const repository = await openGitHubRepository(
      "https://github.com/owner/repo",
      { fetcher },
    );

    await expect(
      repository.readFiles([
        {
          path: "models/large.py",
          startLine: 1,
          endLine: 220,
          reason: "范围过大",
          coverage: "backbone-features",
        },
      ]),
    ).rejects.toThrow(/行范围.*最多/);
  });

  it("rejects broad source reads and missing symbols instead of falling back to the full file", async () => {
    const source =
      "class RealModel:\n    def forward(self, x):\n        return x";
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/owner/repo")) {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.endsWith("/commits/main")) return jsonResponse({ sha: "sha" });
      if (url.includes("/git/trees/sha")) {
        return jsonResponse({
          truncated: false,
          tree: [
            {
              path: "models/model.py",
              type: "blob",
              sha: "model-blob",
              size: source.length,
            },
            {
              path: "configs/model.yaml",
              type: "blob",
              sha: "config-blob",
              size: 16,
            },
          ],
        });
      }
      if (url.endsWith("/models/model.py")) return new Response(source);
      if (url.endsWith("/configs/model.yaml")) {
        return new Response("layers: 4\nheads: 8");
      }
      return new Response("not found", { status: 404 });
    });
    const repository = await openGitHubRepository(
      "https://github.com/owner/repo",
      { fetcher },
    );

    await expect(
      repository.readFiles([
        {
          path: "models/model.py",
          reason: "尝试宽泛读取",
          coverage: "inference-path",
        },
      ]),
    ).rejects.toThrow(/必须指定 startLine\/endLine/);

    await expect(
      repository.readFiles([
        {
          path: "models/model.py",
          symbols: ["MissingModel.forward"],
          reason: "读取不存在的符号",
          coverage: "inference-path",
        },
      ]),
    ).rejects.toThrow(/不再接受 symbols/);

    await expect(
      repository.readFiles([
        {
          path: "configs/model.yaml",
          reason: "读取小型配置",
          coverage: "parameters-tensors",
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ text: "layers: 4\nheads: 8" }),
    ]);
  });
});
