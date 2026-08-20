import { describe, expect, it } from "vitest";

import {
  formatWebWaitTime,
  renderWebTaskProgress,
  webTaskProgressFor,
} from "../../src/modules/web-task-progress";

function task(status: string) {
  return {
    id: "web-1",
    kind: "general" as const,
    title: "等待网页回答",
    promptPreview: "整理流程图",
    createdAt: 1_000,
    webProvider: "deepseek" as const,
    webStatus: status,
  };
}

describe("WEB task progress", () => {
  it("maps real callbacks onto five visible phases", () => {
    expect(webTaskProgressFor(task("starting_browser"), "DeepSeek")?.index).toBe(0);
    expect(webTaskProgressFor(task("uploading_attachment"), "DeepSeek")?.index).toBe(1);
    expect(webTaskProgressFor(task("submitting"), "DeepSeek")?.index).toBe(2);
    expect(webTaskProgressFor(task("generating"), "DeepSeek")?.index).toBe(3);
    expect(webTaskProgressFor(task("processing_answer"), "DeepSeek")?.index).toBe(4);
  });

  it("renders five segments, the current detail, and elapsed time", () => {
    const progress = webTaskProgressFor(task("generating"), "DeepSeek")!;
    const row = renderWebTaskProgress(document, progress, 66_000);

    expect(row.querySelectorAll(".web-task-progress-segment")).toHaveLength(5);
    expect(row.querySelectorAll(".is-complete")).toHaveLength(3);
    expect(row.querySelectorAll(".is-active")).toHaveLength(1);
    expect(row.textContent).toContain("DeepSeek 正在思考并生成回答");
    expect(row.textContent).toContain("已等待 1分05秒");
  });

  it("formats short and long waits without implying a percentage", () => {
    expect(formatWebWaitTime(9_000)).toBe("9秒");
    expect(formatWebWaitTime(125_000)).toBe("2分05秒");
  });
});
