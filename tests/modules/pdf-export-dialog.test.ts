// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { renderPdfExportDialog } from "../../src/modules/pdf-export-dialog";

describe("PDF export dialog", () => {
  it("shows conversion progress without completion actions", () => {
    const dialog = renderPdfExportDialog(
      document,
      { status: "converting", fileName: "Paper - AI笔记.pdf" },
      emptyActions(),
    );

    expect(dialog.textContent).toContain("正在转换 PDF");
    expect(dialog.textContent).toContain("Paper - AI笔记.pdf");
    expect(dialog.querySelector(".zai-pdf-export-actions")).toBeNull();
  });

  it("offers file, path, open, and close actions after completion", async () => {
    const actions = emptyActions();
    const dialog = renderPdfExportDialog(
      document,
      {
        status: "done",
        fileName: "Paper - AI笔记.pdf",
        path: "/home/user/Desktop/Paper - AI笔记.pdf",
      },
      actions,
    );

    expect(dialog.textContent).toContain("PDF 转换完成");
    expect(dialog.textContent).toContain(
      "/home/user/Desktop/Paper - AI笔记.pdf",
    );
    const buttons = Array.from(dialog.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "复制文件",
      "复制路径",
      "打开 PDF",
      "关闭",
    ]);
    buttons.forEach((button) => button.click());
    await Promise.resolve();
    expect(actions.onCopyFile).toHaveBeenCalledOnce();
    expect(actions.onCopyPath).toHaveBeenCalledOnce();
    expect(actions.onOpen).toHaveBeenCalledOnce();
    expect(actions.onClose).toHaveBeenCalledOnce();
  });
});

function emptyActions() {
  return {
    onCopyFile: vi.fn(),
    onCopyPath: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
  };
}
