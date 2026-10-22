// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageWebAttachment } from "../../web-agent/attachments.mjs";

const source = readFileSync("web-agent/agent.mjs", "utf8");
const staging = source.slice(
  source.indexOf("async function stageTaskAttachments("),
  source.indexOf("async function webMaterialKey("),
);
const createStage = new Function(
  "config",
  "mkdtemp",
  "stageWebAttachment",
  "path",
  `${staging}; return stageTaskAttachments;`,
);

describe("Snap Firefox attachment staging", () => {
  it("copies all attachments into accessible, distinct task paths and preserves original file identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "zai-snap-staging-"));
    try {
      const profileDir = path.join(root, "snap-common", "profile");
      await mkdir(profileDir, { recursive: true });
      const originals = [
        path.join(root, ".zotero", "a"),
        path.join(root, ".zotero", "b"),
      ];
      await Promise.all(
        originals.map((dir) => mkdir(dir, { recursive: true })),
      );
      await writeFile(path.join(originals[0], "paper.pdf"), "first PDF");
      await writeFile(path.join(originals[1], "paper.pdf"), "second PDF");
      const attachments = originals.map((dir) => ({
        kind: "pdf",
        name: "paper.pdf",
        mimeType: "application/pdf",
        path: path.join(dir, "paper.pdf"),
      }));
      const task: any = {};
      const stage = createStage(
        { firefoxSnap: true, profileDir },
        mkdtemp,
        stageWebAttachment,
        path,
      );
      const results = await stage(task, {}, attachments);
      expect(task.attachmentStageDir.startsWith(profileDir + path.sep)).toBe(
        true,
      );
      expect(results[0].path).not.toBe(results[1].path);
      for (const [i, attachment] of results.entries()) {
        expect(attachment.sourcePath).toBe(attachments[i].path);
        expect(attachment.mimeType).toBe("application/pdf");
        expect(await readFile(attachment.path, "utf8")).toBe(
          i ? "second PDF" : "first PDF",
        );
      }
      await rm(task.attachmentStageDir, { recursive: true, force: true });
      expect(await readFile(attachments[0].path, "utf8")).toBe("first PDF");
      expect(await readFile(attachments[1].path, "utf8")).toBe("second PDF");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not copy ordinary Firefox attachments unnecessarily", async () => {
    const stage = createStage(
      { firefoxSnap: false },
      mkdtemp,
      stageWebAttachment,
      path,
    );
    const attachments = [{ kind: "pdf", path: "/original/paper.pdf" }];
    expect(await stage({}, {}, attachments)).toBe(attachments);
  });
});
