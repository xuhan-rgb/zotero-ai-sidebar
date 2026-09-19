import { describe, expect, it, vi } from "vitest";
import { version as ADDON_VERSION } from "../../package.json";
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

  it("starts from where the paper material comes from", () => {
    const items = sectionItems("论文材料从哪来").map((item) => item.textContent);

    expect(items).toHaveLength(3);
    expect(items[0]).toContain("LaTeX 源");
    expect(items[0]).toContain("点「素材」直接开列表");
    expect(items[1]).toContain("PDF 已解析");
    expect(items[2]).toContain("＋ → 截图 / 图片");
  });

  it("keeps the material section to one line per row", () => {
    const items = sectionItems("素材怎么用");

    expect(items).toHaveLength(4);
    expect(items[0]!.textContent).toContain("取点期间左侧不选文字");
    expect(items[0]!.textContent).toContain("不会误进对话");
    expect(items[1]!.textContent).toContain("空白处不响应");
    expect(items[1]!.textContent).toContain("LaTeX 源论文自动改为打开列表");
    expect(items[2]!.textContent).toContain("[表 #1]");
    expect(items[3]!.textContent).toContain("第 N–M 页·推测");
    for (const item of items) {
      expect(item.textContent!.length).toBeLessThan(60);
    }
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

  it("records the 素材 shortcut where the pick mode is described", () => {
    const changes: string[] = [];
    const layer = renderWebUsageNotice(document, () => {}, {
      value: "Ctrl+Shift+M",
      onChange: (value) => changes.push(value),
    });
    const field = layer.querySelector<HTMLInputElement>(
      ".zai-web-notice-shortcut-field",
    )!;

    expect(field.value).toBe("Ctrl+Shift+M");
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, altKey: true }),
    );
    expect(changes).toEqual(["Ctrl+Alt+K"]);
    expect(field.value).toBe("Ctrl+Alt+K");
  });

  it("omits the shortcut row when no preference store is wired", () => {
    const layer = renderWebUsageNotice(document, () => {});

    expect(layer.querySelector(".zai-web-notice-shortcut-field")).toBeNull();
  });

  it("closes from the close button and the confirm button", () => {
    const onClose = vi.fn();
    const layer = renderWebUsageNotice(document, onClose);

    (layer.querySelector(".zai-web-notice-close") as HTMLElement).click();
    (layer.querySelector(".zai-web-notice-confirm") as HTMLElement).click();

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("links the project and the issue tracker at the bottom", () => {
    const launchURL = vi.fn();
    (globalThis as { Zotero?: { launchURL: (url: string) => void } }).Zotero = {
      launchURL,
    };
    const layer = renderWebUsageNotice(document, () => {});
    const links = [
      ...layer.querySelectorAll<HTMLAnchorElement>(".zai-web-notice-project a"),
    ];

    const urls = [
      "https://github.com/xuhan-rgb/zotero-ai-sidebar",
      "https://github.com/xuhan-rgb/zotero-ai-sidebar/issues/new",
    ];
    expect(links.map((link) => link.href)).toEqual(urls);
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noreferrer");
    }

    // Zotero chrome does not follow anchor navigation, so the click must be
    // routed through launchURL instead of being left to the document.
    links.forEach((link, index) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(launchURL).toHaveBeenNthCalledWith(index + 1, urls[index]);
    });
    delete (globalThis as { Zotero?: unknown }).Zotero;
  });

  it("copies this machine's versions for the issue form", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.defaultView!.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    (globalThis as { Zotero?: unknown }).Zotero = {
      version: "7.0.11",
      isLinux: true,
      getOSVersion: () =>
        Promise.resolve(
          "Linux 5.15.0-191-generic #201-Ubuntu SMP Fri Aug 7 18:39:04 UTC 2026",
        ),
    };
    const layer = renderWebUsageNotice(document, () => {});
    const button = layer.querySelector<HTMLButtonElement>(
      ".zai-web-notice-copy-env",
    )!;

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toBe(
      `XPI ${ADDON_VERSION} · Zotero 7.0.11 · Linux 5.15.0-191-generic`,
    );
    expect(button.textContent).toBe("已复制");

    delete (globalThis as { Zotero?: unknown }).Zotero;
  });

  it("keeps the support QR collapsed until it is clicked, and stores no image", () => {
    const layer = renderWebUsageNotice(document, () => {});
    const toggle = layer.querySelector<HTMLElement>(
      ".zai-web-notice-support-toggle",
    )!;
    const panel = layer.querySelector<HTMLElement>(
      ".zai-web-notice-support-panel",
    )!;

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(panel.childElementCount).toBe(0);
    expect(layer.querySelector("img")).toBeNull();

    toggle.click();

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".zai-web-notice-qr")).not.toBeNull();
    expect(layer.querySelector("img")).toBeNull();

    toggle.click();

    expect(panel.hidden).toBe(true);
  });

  it("keeps the support panel to the Alipay code, with no amount field", () => {
    const layer = renderWebUsageNotice(document, () => {});
    const toggle = layer.querySelector<HTMLElement>(
      ".zai-web-notice-support-toggle",
    )!;
    toggle.click();
    const panel = layer.querySelector<HTMLElement>(
      ".zai-web-notice-support-panel",
    )!;

    expect(toggle.textContent).toContain("Buy me a coffee");
    expect(toggle.textContent).toContain("支付宝");
    expect(panel.querySelector("input")).toBeNull();
    expect(panel.querySelector(".zai-web-notice-qr")).not.toBeNull();
    expect(panel.childElementCount).toBe(1);

    // A second click collapses the panel, keeping the layout tidy afterwards.
    toggle.click();

    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
