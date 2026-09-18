import type { FullTranslationBlock } from "../translate/full-document";
import type { PdfSourcePage } from "./pdf-source-preview";

export interface PdfSourceOptions {
  getPage(pageIndex: number): Promise<PdfSourcePage>;
  compare?: boolean;
  blockId?: string;
  pageIndex?: number;
  inlineBlockId?: string;
}

/** Both views show pixels rendered from the original PDF, with MinerU region links. */
export function attachPdfSourceView(
  root: HTMLElement,
  blocks: FullTranslationBlock[],
  options: PdfSourceOptions,
): void {
  const doc = root.ownerDocument!;
  const content = root.querySelector<HTMLElement>(".zai-ft-content")!;
  const reader = root.querySelector<HTMLElement>(".zai-ft-reader")!;
  const rows = new Map<string, HTMLElement>();
  for (const row of content.querySelectorAll<HTMLElement>("[data-block-id]")) {
    rows.set(row.dataset.blockId!, row);
  }
  let compare = options.compare === true;
  let selected = blocks.find((block) => block.id === options.blockId);
  let pageIndex = options.pageIndex ?? selected?.pdfLocation?.pageIndex ?? 0;
  let request = 0;
  let inlineRequest = 0;
  let inline: HTMLElement | undefined;
  let pageCount: number | undefined;
  let zoom = 1;

  const pane = doc.createElement("section");
  pane.className = "zai-pdf-source-pane";
  pane.setAttribute("aria-label", "原始 PDF 对照");
  const controls = doc.createElement("div");
  controls.className = "zai-pdf-source-controls";
  const label = doc.createElement("span");
  const body = doc.createElement("div");
  body.className = "zai-pdf-source-body";
  const previous = button("上一页", () => void showPage(pageIndex - 1));
  const next = button("下一页", () => void showPage(pageIndex + 1));
  controls.append(
    previous,
    label,
    next,
    button("−", () => resize(-0.25)),
    button("+", () => resize(0.25)),
  );
  pane.append(controls, body);
  reader.prepend(pane);
  const toggle = button("PDF 对照", () => {
    compare = !compare;
    request++;
    inlineRequest++;
    inline?.remove();
    inline = undefined;
    delete root.dataset.pdfInlineBlockId;
    updateMode();
    if (compare) void showPage(selected?.pdfLocation?.pageIndex ?? pageIndex);
  });
  toggle.className = "zai-ft-pdf-toggle";
  root.querySelector(".zai-ft-view-controls")!.append(toggle);

  function button(text: string, action: () => void) {
    const element = doc.createElement("button");
    element.type = "button";
    element.textContent = text;
    element.addEventListener("click", action);
    return element;
  }

  function updateMode() {
    root.classList.toggle("is-pdf-compare", compare);
    root.dataset.pdfCompare = String(compare);
    pane.hidden = !compare;
    toggle.setAttribute("aria-pressed", String(compare));
  }

  function resize(delta: number) {
    zoom = Math.max(1, Math.min(3, zoom + delta));
    const page = body.querySelector<HTMLElement>(".zai-pdf-source-page");
    if (page) page.style.width = `${zoom * 100}%`;
  }

  function select(block: FullTranslationBlock) {
    selected = block;
    root.dataset.pdfBlockId = block.id;
    for (const [id, row] of rows)
      row.classList.toggle("is-pdf-source-selected", id === block.id);
  }

  function pageImage(page: PdfSourcePage, description: string) {
    const img = doc.createElement("img");
    img.src = page.url;
    img.alt = description;
    img.draggable = false;
    img.width = page.width;
    img.height = page.height;
    return img;
  }

  async function showPage(index: number) {
    if (index < 0 || (pageCount != null && index >= pageCount)) return;
    pageIndex = index;
    inlineRequest++;
    inline?.remove();
    inline = undefined;
    delete root.dataset.pdfInlineBlockId;
    root.dataset.pdfPageIndex = String(index);
    label.textContent = `原始 PDF · 第 ${index + 1} 页`;
    previous.disabled = index === 0;
    next.disabled = true;
    const ticket = ++request;
    body.textContent = "正在读取原始 PDF…";
    try {
      const page = await options.getPage(index);
      if (ticket !== request) return;
      pageCount = page.pageCount;
      next.disabled = index + 1 >= pageCount;
      label.textContent = `原始 PDF · ${index + 1} / ${pageCount}`;
      const surface = doc.createElement("div");
      surface.className = "zai-pdf-source-page";
      surface.style.width = `${zoom * 100}%`;
      surface.append(pageImage(page, `原始 PDF 第 ${index + 1} 页`));
      for (const block of blocks) {
        const location = block.pdfLocation;
        if (!location || location.pageIndex !== index) continue;
        const box = button(``, () => {
          select(block);
          rows
            .get(block.id)
            ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          for (const element of surface.querySelectorAll<HTMLElement>(
            "[data-block-id]",
          )) {
            element.classList.toggle(
              "is-selected",
              element.dataset.blockId === block.id,
            );
          }
        });
        box.className = "zai-pdf-source-box";
        box.classList.toggle("is-selected", selected?.id === block.id);
        box.dataset.blockId = block.id;
        box.title = block.source.slice(0, 160);
        box.setAttribute(
          "aria-label",
          `定位解析段落：${block.source.slice(0, 80)}`,
        );
        const [x0, y0, x1, y1] = location.bbox;
        Object.assign(box.style, {
          left: `${x0 / 10}%`,
          top: `${y0 / 10}%`,
          width: `${(x1 - x0) / 10}%`,
          height: `${(y1 - y0) / 10}%`,
        });
        surface.append(box);
      }
      body.replaceChildren(surface);
      const active = surface.querySelector<HTMLElement>(".is-selected");
      if (active)
        body.scrollTop = Math.max(0, active.offsetTop - body.clientHeight / 3);
      else body.scrollTop = 0;
    } catch (error) {
      if (ticket === request)
        body.textContent = `无法显示原始 PDF：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function showInline(block: FullTranslationBlock) {
    root.dataset.pdfInlineBlockId = block.id;
    inline?.remove();
    const preview = doc.createElement("div");
    preview.className = "zai-pdf-source-inline";
    inline = preview;
    const close = button("收起原始 PDF", () => {
      inlineRequest++;
      preview.remove();
      inline = undefined;
      delete root.dataset.pdfInlineBlockId;
    });
    const region = doc.createElement("div");
    preview.append(close, region);
    rows.get(block.id)?.append(preview);
    const location = block.pdfLocation;
    const ticket = ++inlineRequest;
    if (!location) {
      region.textContent =
        "此段解析缓存没有页码或区域坐标，无法精确定位。可用 PDF 对照逐页核对。";
      return;
    }
    region.textContent = `正在读取原始 PDF 第 ${location.pageIndex + 1} 页…`;
    try {
      const page = await options.getPage(location.pageIndex);
      if (ticket !== inlineRequest) return;
      const label = doc.createElement("div");
      label.textContent = `原始 PDF · 第 ${location.pageIndex + 1} 页`;
      const crop = doc.createElement("div");
      crop.className = "zai-pdf-source-crop";
      // Include a little surrounding whitespace for visual verification.
      const [left, top, right, bottom] = location.bbox;
      const x0 = Math.max(0, left - 8),
        y0 = Math.max(0, top - 8);
      const width = Math.min(1000, right + 8) - x0;
      const height = Math.min(1000, bottom + 8) - y0;
      crop.style.aspectRatio = `${width * page.width} / ${height * page.height}`;
      const img = pageImage(
        page,
        `本段对应的原始 PDF 第 ${location.pageIndex + 1} 页区域`,
      );
      Object.assign(img.style, {
        width: `${100000 / width}%`,
        left: `${(-100 * x0) / width}%`,
        top: `${(-100 * y0) / height}%`,
      });
      crop.append(img);
      region.replaceChildren(label, crop);
    } catch (error) {
      if (ticket === inlineRequest)
        region.textContent = `无法显示原始 PDF：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  for (const block of blocks) {
    const row = rows.get(block.id);
    if (!row) continue;
    const open = () => {
      select(block);
      if (compare && block.pdfLocation)
        void showPage(block.pdfLocation.pageIndex);
      else void showInline(block);
    };
    const trigger = button("核对 PDF 原文", open);
    trigger.className = "zai-pdf-source-trigger";
    row.append(trigger);
    row.addEventListener("click", (event) => {
      if (!compare) return;
      const target = event.target as Element;
      if (
        target.closest("button, a, input, select, .zai-pdf-source-inline") ||
        doc.getSelection()?.toString().trim()
      )
        return;
      open();
    });
  }
  updateMode();
  if (selected) select(selected);
  if (compare) void showPage(pageIndex);
  else if (options.inlineBlockId) {
    const block = blocks.find((block) => block.id === options.inlineBlockId);
    if (block) void showInline(block);
  }
}
