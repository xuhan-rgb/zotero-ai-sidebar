import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderFullTranslationView } from "../../src/modules/full-translation-view";
import { createFullTranslationState } from "../../src/settings/full-translation-store";
import type { FullTranslationDocument } from "../../src/translate/full-document";
import type { PdfSourceOptions } from "../../src/modules/full-translation-pdf-source";
import type { PdfSourcePage } from "../../src/modules/pdf-source-preview";

const paper: FullTranslationDocument = {
  schemaVersion: 1,
  arxivId: "pdf:TEST",
  sourceHash: "same",
  blocks: [
    {
      id: "a",
      kind: "paragraph",
      source: "First paragraph",
      translatable: true,
      pdfLocation: { pageIndex: 0, bbox: [100, 200, 500, 400] },
    },
    {
      id: "b",
      kind: "paragraph",
      source: "Second paragraph",
      translatable: true,
      pdfLocation: { pageIndex: 2, bbox: [503, 232, 923, 369] },
    },
    {
      id: "c",
      kind: "paragraph",
      source: "Without coordinates",
      translatable: true,
    },
  ],
};
const page: PdfSourcePage = {
  url: "data:image/png;base64,cGRm",
  width: 600,
  height: 800,
  pageCount: 3,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(
  options: Partial<PdfSourceOptions> = {},
  arxivId = paper.arxivId,
) {
  const getPage = vi.fn(async () => page);
  const documentValue = { ...paper, arxivId };
  const root = renderFullTranslationView(document, {
    document: documentValue,
    state: createFullTranslationState(documentValue, "", ""),
    layout: "interleaved",
    running: false,
    assets: {},
    pdfSource: { getPage, ...options },
    onLayoutChange() {},
    onRun() {},
    onRetranslate() {},
    onCancel() {},
    onExit() {},
  });
  document.body.append(root);
  return { root, getPage };
}
function click(root: HTMLElement, selector: string) {
  root.querySelector<HTMLElement>(selector)!.click();
}

afterEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

describe("ordinary PDF original-source views", () => {
  it("keeps the source verification button inside its paragraph", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("addon/content/sidebar.css", "utf8");
    document.head.append(style);
    try {
      const { root } = setup();
      const trigger = root.querySelector<HTMLElement>(
        ".zai-pdf-source-trigger",
      )!;
      expect(window.getComputedStyle(trigger).position).toBe("static");
    } finally {
      style.remove();
    }
  });
  it("opens an original PDF region only with its verification button", async () => {
    const { root, getPage } = setup();
    expect(getPage).not.toHaveBeenCalled();
    click(root, '[data-block-id="b"] .zai-ft-source');
    click(root, '[data-block-id="b"] .zai-ft-translation');
    expect(getPage).not.toHaveBeenCalled();
    expect(root.querySelector(".zai-pdf-source-inline")).toBeNull();
    click(root, '[data-block-id="b"] .zai-pdf-source-trigger');
    await flush();
    expect(getPage).toHaveBeenCalledWith(2);
    const img = root.querySelector<HTMLImageElement>(
      ".zai-pdf-source-crop img",
    )!;
    expect(img.src).toBe(page.url);
    expect(img.alt).toContain("第 3 页");
    expect(Number.parseFloat(img.style.width)).toBeCloseTo(100000 / 436);
    expect(Number.parseFloat(img.style.top)).toBeCloseTo((-100 * 224) / 153);
    click(root, ".zai-pdf-source-inline > button");
    expect(root.querySelector(".zai-pdf-source-inline")).toBeNull();
  });

  it("links parsed blocks to PDF boxes and PDF boxes back to parsed blocks", async () => {
    const { root, getPage } = setup();
    click(root, ".zai-ft-pdf-toggle");
    await flush();
    expect(root.classList.contains("is-pdf-compare")).toBe(true);
    const box = root.querySelector<HTMLElement>(
      '.zai-pdf-source-box[data-block-id="a"]',
    )!;
    expect(box.style.left).toBe("10%");
    expect(box.style.height).toBe("20%");
    box.click();
    expect(
      root
        .querySelector('.zai-ft-block[data-block-id="a"]')
        ?.classList.contains("is-pdf-source-selected"),
    ).toBe(true);
    click(root, '.zai-ft-block[data-block-id="b"] .zai-ft-source');
    await flush();
    expect(getPage).toHaveBeenLastCalledWith(2);
    expect(
      root
        .querySelector(".zai-pdf-source-box.is-selected")
        ?.getAttribute("data-block-id"),
    ).toBe("b");
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      ".zai-pdf-source-controls button",
    );
    expect(buttons[1]!.disabled).toBe(true);
    buttons[0]!.click();
    await flush();
    expect(getPage).toHaveBeenLastCalledWith(1);
    click(root, ".zai-ft-pdf-toggle");
    expect(
      root.querySelector<HTMLElement>(".zai-pdf-source-pane")!.hidden,
    ).toBe(true);
  });

  it("preserves selected text and leaves link clicks alone", () => {
    const { root, getPage } = setup();
    const text = root.querySelector<HTMLElement>(
      '[data-block-id="a"] .zai-ft-source',
    )!;
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()!.addRange(range);
    text.click();
    expect(getPage).not.toHaveBeenCalled();
    document.getSelection()!.removeAllRanges();
    const link = document.createElement("a");
    link.textContent = "reference";
    text.append(link);
    link.click();
    expect(getPage).not.toHaveBeenCalled();
  });

  it("reports missing coordinates and renderer failures without displaying parsed text as original", async () => {
    const { root, getPage } = setup();
    click(root, '[data-block-id="c"] .zai-pdf-source-trigger');
    expect(root.querySelector(".zai-pdf-source-inline")?.textContent).toContain(
      "没有页码或区域坐标",
    );
    expect(getPage).not.toHaveBeenCalled();
    getPage.mockRejectedValueOnce(new Error("missing attachment"));
    click(root, '[data-block-id="a"] .zai-pdf-source-trigger');
    await flush();
    expect(root.querySelector(".zai-pdf-source-inline")?.textContent).toContain(
      "missing attachment",
    );
    expect(root.querySelector(".zai-pdf-source-inline img")).toBeNull();
  });

  it("ignores an older page result after another paragraph is selected", async () => {
    let finish!: (page: PdfSourcePage) => void;
    const { root } = setup({
      compare: true,
      getPage: (index) =>
        index === 0
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(page),
    });
    click(root, '.zai-ft-block[data-block-id="b"] .zai-ft-source');
    await flush();
    finish({ ...page, url: "old-page" });
    await flush();
    expect(
      root.querySelector(".zai-pdf-source-page img")?.getAttribute("src"),
    ).toBe(page.url);
    expect(
      root.querySelector(".zai-pdf-source-box")?.getAttribute("data-block-id"),
    ).toBe("b");
  });

  it("restores comparison or inline view after a translation update", async () => {
    const { root } = setup({ compare: true, blockId: "b", pageIndex: 2 });
    await flush();
    expect(root.dataset.pdfPageIndex).toBe("2");
    expect(
      root
        .querySelector(".zai-pdf-source-box.is-selected")
        ?.getAttribute("data-block-id"),
    ).toBe("b");
    const inline = setup({ inlineBlockId: "b" }).root;
    await flush();
    expect(inline.querySelector(".zai-pdf-source-crop img")).not.toBeNull();
  });

  it("does not add PDF controls or handlers to LaTeX papers", () => {
    const { root, getPage } = setup({}, "2401.12345");
    expect(root.querySelector(".zai-ft-pdf-toggle")).toBeNull();
    click(root, '[data-block-id="a"] .zai-ft-source');
    expect(getPage).not.toHaveBeenCalled();
  });
});
