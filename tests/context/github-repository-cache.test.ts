import { describe, expect, it } from "vitest";
import { createGitHubRepositorySnapshotStore } from "../../src/context/github-repository-cache";

function makeTar(path: string, body: string): Uint8Array {
  const encoder = new TextEncoder();
  const header = new Uint8Array(512);
  const data = encoder.encode(body);
  header.set(encoder.encode(path), 0);
  header.set(encoder.encode("0000644"), 100);
  header.set(encoder.encode(data.length.toString(8).padStart(11, "0")), 124);
  header[156] = "0".charCodeAt(0);
  header.set(encoder.encode("ustar\0"), 257);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const tar = new Uint8Array(512 + padded.length + 1024);
  tar.set(header);
  tar.set(padded, 512);
  return tar;
}

describe("GitHub repository snapshot cache", () => {
  it("stores only allow-listed files beneath the fixed commit directory", async () => {
    const values = new Map<string, string | Uint8Array>();
    const global = globalThis as unknown as {
      IOUtils?: unknown;
      Zotero?: unknown;
    };
    const originalIO = global.IOUtils;
    const originalZotero = global.Zotero;
    global.Zotero = { DataDirectory: { dir: "/zotero" } };
    global.IOUtils = {
      async makeDirectory() {},
      async write(path: string, data: Uint8Array) {
        values.set(path, new Uint8Array(data));
      },
      async writeUTF8(path: string, data: string) {
        values.set(path, data);
      },
      async readUTF8(path: string) {
        const value = values.get(path);
        if (typeof value === "string") return value;
        if (value instanceof Uint8Array) {
          return new TextDecoder().decode(value);
        }
        throw new Error("missing");
      },
      async exists(path: string) {
        return values.has(path);
      },
    };

    try {
      const reference = {
        url: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
        defaultBranch: "main",
        commitSHA: "abc123",
      };
      const files = [
        { path: "models/net.py", sha: "blob", size: 12 },
        { path: "assets/weights.bin", sha: "binary", size: 6 },
      ];
      const store = createGitHubRepositorySnapshotStore();
      expect(store).not.toBeNull();
      await store!.install(
        reference,
        files,
        makeTar("owner-repo-abc123/models/net.py", "class Net: pass"),
        ["models/net.py"],
      );

      const loaded = await store!.load(reference);
      expect(loaded?.files).toEqual(files);
      expect(await loaded?.readText("models/net.py")).toBe("class Net: pass");
      expect(await loaded?.readText("assets/weights.bin")).toBeNull();
      expect(
        [...values.keys()].some((path) =>
          path.includes("repositories/owner/repo/abc123/source/models/net.py"),
        ),
      ).toBe(true);
    } finally {
      global.IOUtils = originalIO;
      global.Zotero = originalZotero;
    }
  });
});
