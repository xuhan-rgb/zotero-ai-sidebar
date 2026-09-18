import { describe, expect, it, vi } from "vitest";
import { renderWebUsageNotice } from "../../src/modules/web-usage-notice";

function sectionItems(title: string): HTMLElement[] {
  const layer = renderWebUsageNotice(document, () => {});
  const section = [...layer.querySelectorAll(".zai-web-notice-section")].find(
    (entry) => entry.querySelector("strong")?.textContent === title,
  );
  if (!section) throw new Error(`missing notice section: ${title}`);
  return [...section.querySelectorAll<HTMLElement>("li")];
}

describe("WEB usage notice", () => {
  it("says up front that WEB does not send images", () => {
    const layer = renderWebUsageNotice(document, () => {});

    expect(
      layer.querySelector(".zai-web-notice-callout-title")!.textContent,
    ).toBe("WEB 默认不发送图片");
  });

  it("keeps the image row in the mode comparison table", () => {
    const layer = renderWebUsageNotice(document, () => {});
    const rows = [...layer.querySelectorAll(".zai-web-notice-table tbody tr")];
    const imageRow = rows.find(
      (row) =>
        row.querySelector(".zai-web-notice-item")!.textContent ===
        "图片 / 图表",
    );

    expect(imageRow).toBeDefined();
    expect(imageRow!.lastElementChild!.textContent).toContain("默认不发送");
  });

  it("describes API mode in its own section", () => {
    const items = sectionItems("API 模式");

    expect(items.map((item) => item.textContent)).toEqual([
      "图片随消息发送输入框 ＋ → 截图 / 图片，或直接 Ctrl+V 粘贴，图片与消息一起发给模型。",
      "图表与公式输入框里打 @：图片、表格、公式都能选；表格和公式先插入短标签，发送时才展开成 LaTeX 源码。",
      "论文上下文由输入行的「原文」控制：附带 LaTeX 源码、MinerU 解析稿或 PDF 原件。",
    ]);
  });

  it("lists the two ways of sending an image to a web page", () => {
    const items = sectionItems("WEB 模式：想让网页模型看图");

    expect(items.map((item) => item.textContent)).toEqual([
      "截图 / 本机图片输入框 ＋ → 截图 / 图片，图片会随消息一起上传给网页。",
      "@ 选论文素材输入框里打 @ 挑图片、表格和公式；已解析的 PDF 会先列出你正在看的那一页，也可以按「图片 / 表格 / 公式」切换。图片随消息上传；表格和公式先插入短标签，发送时才展开成 LaTeX 文字。",
    ]);
  });

  it("closes from the close button and the confirm button", () => {
    const onClose = vi.fn();
    const layer = renderWebUsageNotice(document, onClose);

    (layer.querySelector(".zai-web-notice-close") as HTMLElement).click();
    (layer.querySelector(".zai-web-notice-confirm") as HTMLElement).click();

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
