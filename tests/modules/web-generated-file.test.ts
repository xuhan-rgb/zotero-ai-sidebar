import { beforeEach, describe, expect, it } from "vitest";

import {
  describeUnavailableGeneratedFiles,
  markWebGeneratedFileHref,
  saveWebGeneratedFileToCurrentItem,
  WEB_GENERATED_FILE_MARKER,
  webGeneratedFilePath,
} from "../../src/modules/web-generated-file";

describe("web-generated-file", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: { DataDirectory: { dir: "/data" }, Profile: { dir: "/profile" } },
    });
  });

  it("marks and recovers only Web Agent generated file links", () => {
    const href = markWebGeneratedFileHref(
      "file:///tmp/zai-downloads/LAW%20flowchart.pdf",
    );
    expect(href).toContain(`#${WEB_GENERATED_FILE_MARKER}`);
    expect(webGeneratedFilePath(href)).toBe("/tmp/zai-downloads/LAW flowchart.pdf");
    expect(webGeneratedFilePath("file:///tmp/zai-downloads/legacy.pdf")).toBe(
      "/tmp/zai-downloads/legacy.pdf",
    );
    expect(webGeneratedFilePath("file:///tmp/other.pdf")).toBeNull();
    expect(webGeneratedFilePath("https://example.com/file.pdf")).toBeNull();
  });

  it("degrades internal sandbox paths that Zotero can never open", () => {
    // Real answer stored by the sidebar on 2026-08-18: the site claimed two
    // generated files but only printed its own execution-sandbox paths.
    const answer = [
      "已为你生成针对 LAW 算法的 PDF 流程图：",
      "",
      "- PDF：`/mnt/data/law_algorithm_flowchart.pdf`",
      "- 预览 PNG：`/mnt/data/law_algorithm_flowchart.png`",
    ].join("\n");

    const result = describeUnavailableGeneratedFiles(answer);

    expect(result).not.toContain("/mnt/data/");
    expect(result).toContain("`law_algorithm_flowchart.pdf`");
    expect(result).toContain("`law_algorithm_flowchart.png`");
    expect(result).toContain("网页没有返回可下载的附件");
  });

  it("collapses sandbox download links and keeps their visible label", () => {
    const result = describeUnavailableGeneratedFiles(
      "[LAW_flowchart.png](https://sandbox:/mnt/data/LAW_flowchart.png) 已生成。",
    );

    expect(result).not.toContain("sandbox:");
    expect(result).toContain("LAW_flowchart.png 已生成。");
    expect(result).toContain("网页没有返回可下载的附件");
  });

  it("leaves real Web Agent file links and ordinary answers untouched", () => {
    const linked =
      "[flowchart.pdf](file:///home/u/browser-profile/zai-downloads/1-flowchart.pdf#zai-web-download)";
    expect(describeUnavailableGeneratedFiles(linked)).toBe(linked);
    expect(describeUnavailableGeneratedFiles("普通回答，没有文件。")).toBe(
      "普通回答，没有文件。",
    );
    expect(describeUnavailableGeneratedFiles("")).toBe("");
  });

  it("imports into the current Zotero item's attachment directory", async () => {
    const imported: unknown[] = [];
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        exists: async (path: string) => path === "/tmp/zai-downloads/flowchart.pdf",
      },
    });
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        Items: { get: () => ({ id: 14, parentID: 7 }) },
        Attachments: {
          importFromFile: async (options: unknown) => {
            imported.push(options);
            return { id: 99 };
          },
        },
      },
    });

    const attachmentID = await saveWebGeneratedFileToCurrentItem(
      "/tmp/zai-downloads/flowchart.pdf",
      14,
      "LAW flowchart.pdf",
    );

    expect(attachmentID).toBe(99);
    expect(imported).toEqual([
      {
        file: "/tmp/zai-downloads/flowchart.pdf",
        parentItemID: 7,
        title: "LAW flowchart.pdf",
        contentType: "application/pdf",
      },
    ]);
  });
});
