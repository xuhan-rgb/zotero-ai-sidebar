import { describe, expect, it, vi } from "vitest";
import { renderWebUsageNotice } from "../../src/modules/web-usage-notice";

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

  it("lists the two ways of sending an image", () => {
    const layer = renderWebUsageNotice(document, () => {});
    const items = [...layer.querySelectorAll(".zai-web-notice-list li")];

    expect(items.map((item) => item.textContent)).toEqual([
      "截图 / 本机图片输入框 ＋ → 截图 / 图片，图片会随消息一起发送。",
      "解析稿里的图 / 表输入框里打 @ 选择这篇论文已解析出的图或表；需要论文已经解析完成。",
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
