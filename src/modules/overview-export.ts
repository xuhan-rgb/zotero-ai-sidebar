import type { OverviewData } from "../context/overview-types";
import { renderOverviewBlock } from "./overview-view";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// This function is stringified into the standalone HTML below, so it must stay
// self-contained and use only browser globals available in that page.
function installOverviewExportInteractions(doc: Document): void {
  const flashCopyResult = (button: HTMLElement, label: string): void => {
    button.textContent = label;
    globalThis.setTimeout(() => {
      const source = button
        .closest(".mindmap-block")
        ?.querySelector<HTMLElement>(".mindmap-source");
      button.textContent =
        source?.style.display === "none" ? "复制图片" : "复制代码";
    }, 1600);
  };

  const copyText = async (text: string, button: HTMLElement): Promise<void> => {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      flashCopyResult(button, "已复制");
    } catch {
      const textarea = doc.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      doc.body?.append(textarea);
      textarea.select();
      let copied = false;
      try {
        copied = doc.execCommand("copy");
      } catch {
        // Some file:// browser contexts disable the legacy clipboard fallback.
      }
      textarea.remove();
      flashCopyResult(button, copied ? "已复制" : "复制失败");
    }
  };

  const copySvgAsPng = (svg: SVGSVGElement, button: HTMLElement): void => {
    const width = parseFloat(svg.dataset.naturalW ?? "400");
    const height = parseFloat(svg.dataset.naturalH ?? "300");
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .zai-mm-edge{fill:none;stroke:#c0b4a6;stroke-width:1.5px}
      .zai-mm-arrow-fill{fill:#c0b4a6}
      .zai-mm-node rect{fill:#fffdf8;stroke:#d8c9b6;stroke-width:1.2px}
      .zai-mm-node text,.zai-mm-node tspan{font-family:sans-serif;font-size:11.5px;fill:#24211d}
      .zai-mm-node-section rect{fill:#fbfaf7;stroke:#c0673d;stroke-width:1.4px}
      .zai-mm-node-root rect{fill:#fff0e7;stroke:#c0673d;stroke-width:2px}
      .zai-mm-node-root text,.zai-mm-node-root tspan{font-weight:600;fill:#a94e25;font-size:12px}
      .zai-mm-node-result rect{fill:#eaf4ff;stroke:#3b7ec0;stroke-width:1.4px}
      .zai-mm-node-result text,.zai-mm-node-result tspan{font-weight:600;fill:#2f6aa0}
      .zai-mm-node-innovation rect{fill:#eaf5ea;stroke:#4a9a4a;stroke-width:1.8px}
      .zai-mm-node-innovation text,.zai-mm-node-innovation tspan{font-weight:700;fill:#2f6b2f}
    `;
    clone.insertBefore(style, clone.firstChild);
    const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    });
    const svgURL = globalThis.URL.createObjectURL(svgBlob);
    const image = new Image(width, height);
    image.addEventListener("load", () => {
      const canvas = doc.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D | null;
      if (!context) {
        globalThis.URL.revokeObjectURL(svgURL);
        flashCopyResult(button, "复制失败");
        return;
      }
      context.scale(2, 2);
      context.fillStyle = "#fffdf8";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      globalThis.URL.revokeObjectURL(svgURL);
      canvas.toBlob((png) => {
        if (!png) {
          flashCopyResult(button, "复制失败");
          return;
        }
        const download = (): void => {
          const downloadURL = globalThis.URL.createObjectURL(png);
          const link = doc.createElement("a");
          link.href = downloadURL;
          link.download = "结构图.png";
          link.click();
          globalThis.setTimeout(
            () => globalThis.URL.revokeObjectURL(downloadURL),
            0,
          );
          flashCopyResult(button, "已下载");
        };
        if (
          !globalThis.navigator.clipboard?.write ||
          typeof ClipboardItem === "undefined"
        ) {
          download();
          return;
        }
        void globalThis.navigator.clipboard
          .write([new ClipboardItem({ "image/png": png })])
          .then(() => flashCopyResult(button, "已复制"))
          .catch(download);
      }, "image/png");
    });
    image.addEventListener("error", () => {
      globalThis.URL.revokeObjectURL(svgURL);
      flashCopyResult(button, "复制失败");
    });
    image.src = svgURL;
  };

  const enablePanZoom = (svg: SVGSVGElement): void => {
    const naturalWidth = parseFloat(svg.dataset.naturalW ?? "0");
    const naturalHeight = parseFloat(svg.dataset.naturalH ?? "0");
    if (!naturalWidth || !naturalHeight) return;
    let viewBox = {
      x: 0,
      y: 0,
      width: naturalWidth,
      height: naturalHeight,
    };
    const apply = (): void => {
      svg.setAttribute(
        "viewBox",
        `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
      );
    };
    svg.style.cursor = "grab";
    svg.style.touchAction = "none";
    svg.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        event.preventDefault();
        const pointerX = (event.clientX - rect.left) / rect.width;
        const pointerY = (event.clientY - rect.top) / rect.height;
        const factor = event.deltaY < 0 ? 0.85 : 1 / 0.85;
        const width = Math.max(
          naturalWidth * 0.25,
          Math.min(viewBox.width * factor, naturalWidth * 1.6),
        );
        const height = Math.max(
          naturalHeight * 0.25,
          Math.min(viewBox.height * factor, naturalHeight * 1.6),
        );
        viewBox = {
          x: viewBox.x + (viewBox.width - width) * pointerX,
          y: viewBox.y + (viewBox.height - height) * pointerY,
          width,
          height,
        };
        apply();
      },
      { passive: false },
    );

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    svg.addEventListener("pointerdown", (event: PointerEvent) => {
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      originX = viewBox.x;
      originY = viewBox.y;
      svg.style.cursor = "grabbing";
    });
    svg.addEventListener("pointermove", (event: PointerEvent) => {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 4) moved = true;
      viewBox.x = originX - (deltaX / rect.width) * viewBox.width;
      viewBox.y = originY - (deltaY / rect.height) * viewBox.height;
      apply();
    });
    const endDrag = (): void => {
      dragging = false;
      svg.style.cursor = "grab";
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointerleave", endDrag);
    svg.addEventListener("pointercancel", endDrag);
    svg.addEventListener(
      "click",
      (event: MouseEvent) => {
        if (!moved) return;
        event.stopPropagation();
        event.preventDefault();
        moved = false;
      },
      true,
    );
    svg.addEventListener("dblclick", (event: MouseEvent) => {
      event.preventDefault();
      viewBox = {
        x: 0,
        y: 0,
        width: naturalWidth,
        height: naturalHeight,
      };
      apply();
    });
  };

  const sections = Array.from(
    doc.querySelectorAll(".overview-sec"),
  ) as HTMLElement[];
  sections.forEach((section) => {
    if (!section.querySelector(":scope > .overview-kids")) return;
    const main = section.querySelector(
      ":scope > .overview-sec-main",
    ) as HTMLElement | null;
    main?.addEventListener("click", () => section.classList.toggle("open"));
  });

  const viewTabs = Array.from(
    doc.querySelectorAll(".overview-view-tab"),
  ) as HTMLElement[];
  viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const block = tab.closest(".overview-block");
      const key = tab.dataset.overviewView;
      if (!block || !key) return;
      const shouldClose = tab.classList.contains("active");
      block
        .querySelectorAll(
          ".overview-view-tab.active, .overview-view-pane.active",
        )
        .forEach((item: Element) => item.classList.remove("active"));
      if (shouldClose) return;
      tab.classList.add("active");
      block
        .querySelector(`[data-overview-pane="${key}"]`)
        ?.classList.add("active");
    });
  });

  const figureHeads = Array.from(
    doc.querySelectorAll(".overview-fig-head"),
  ) as HTMLElement[];
  figureHeads.forEach((head) => {
    head.addEventListener("click", () => {
      head.closest(".overview-fig")?.classList.toggle("open");
    });
  });

  const mindmaps = Array.from(
    doc.querySelectorAll(".mindmap-block"),
  ) as HTMLElement[];
  mindmaps.forEach((block) => {
    const tabs = block.querySelectorAll(
      ".mindmap-tab",
    ) as NodeListOf<HTMLElement>;
    const previewTab = tabs[0];
    const codeTab = tabs[1];
    const svgWrap = block.querySelector(
      ".mindmap-svg-wrap",
    ) as HTMLElement | null;
    const source = block.querySelector(".mindmap-source") as HTMLElement | null;
    const copyButton = block.querySelector(
      ".mindmap-copy-btn",
    ) as HTMLElement | null;
    if (!previewTab || !codeTab || !svgWrap || !source || !copyButton) return;
    const svg = svgWrap.querySelector(".zai-mm-svg") as SVGSVGElement | null;
    if (svg) enablePanZoom(svg);

    previewTab.addEventListener("click", () => {
      svgWrap.style.display = "";
      source.style.display = "none";
      copyButton.textContent = "复制图片";
      copyButton.title = "复制为 PNG 图片";
      previewTab.classList.add("mindmap-tab-active");
      codeTab.classList.remove("mindmap-tab-active");
    });
    codeTab.addEventListener("click", () => {
      svgWrap.style.display = "none";
      source.style.display = "";
      copyButton.textContent = "复制代码";
      copyButton.title = "复制 Mermaid 源码";
      codeTab.classList.add("mindmap-tab-active");
      previewTab.classList.remove("mindmap-tab-active");
    });
    copyButton.addEventListener("click", () => {
      if (source.style.display !== "none") {
        void copyText(source.textContent ?? "", copyButton);
      } else {
        if (svg) copySvgAsPng(svg, copyButton);
      }
    });

    const nodes = Array.from(
      block.querySelectorAll(".zai-mm-node[data-section-no]"),
    ) as HTMLElement[];
    nodes.forEach((node) => {
      node.addEventListener("click", () => {
        block
          .querySelectorAll(".zai-mm-node.zai-mm-sel")
          .forEach((selected: Element) =>
            selected.classList.remove("zai-mm-sel"),
          );
        node.classList.add("zai-mm-sel");
        const card = block.closest(".overview-fig");
        const hint = card?.querySelector(
          ".overview-nd-hint",
        ) as HTMLElement | null;
        const content = card?.querySelector(
          ".overview-nd-content",
        ) as HTMLElement | null;
        const title = card?.querySelector(
          ".overview-nd-title",
        ) as HTMLElement | null;
        const gist = card?.querySelector(
          ".overview-nd-gist",
        ) as HTMLElement | null;
        if (hint) hint.style.display = "none";
        if (content) content.style.display = "block";
        if (title) {
          title.textContent = `§${node.dataset.sectionNo ?? ""}  ${node.dataset.sectionTitle ?? ""}`;
        }
        if (gist) {
          gist.textContent =
            node.dataset.sectionGist ?? "（该节点无对应章节解释）";
        }
      });
    });
  });
}

// Build a self-contained HTML document of the current overview for opening in
// the system browser. Reuses the live renderer (same DOM/SVG the panel shows),
// starts every section + the flowchart expanded, and inlines both the collected
// plugin CSS and the small interaction runtime needed outside Zotero.
export function buildOverviewExportHtml(
  doc: Document,
  data: OverviewData,
  css: string,
): string {
  const block = renderOverviewBlock(doc, data);
  block
    .querySelectorAll(".overview-sec, .overview-fig")
    .forEach((e: Element) => e.classList.add("open"));
  const sectionByNo = new Map(
    data.sections.map((section) => [section.no, section]),
  );
  const diagramNodes = Array.from(
    block.querySelectorAll(".zai-mm-node[data-section-no]"),
  ) as HTMLElement[];
  diagramNodes.forEach((node) => {
    const section = sectionByNo.get(node.dataset.sectionNo ?? "");
    if (!section) return;
    node.dataset.sectionTitle = section.title;
    node.dataset.sectionGist = section.gist ?? "";
  });
  const title = data.title ? escapeHtml(data.title) : "全文总览";
  return [
    "<!DOCTYPE html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title} · 全文总览</title>`,
    "<style>",
    ":root{--zai-bg:#fffdf8;--zai-bg-soft:#fbfaf7;--zai-panel-strong:#fbf7f0;",
    "--zai-text:#24211d;--zai-text-muted:#6b6357;--zai-border:#e3d8c8;",
    "--zai-accent:#c0673d;--zai-accent-soft:#fff0e7;--zai-accent-strong:#a94e25;",
    "--zai-font:-apple-system,'Noto Sans CJK SC','PingFang SC',sans-serif;}",
    "body{margin:0;background:radial-gradient(900px 420px at 50% -120px,#fff7ec,transparent),#efe7da;",
    "font-family:var(--zai-font);padding:28px 18px 60px}",
    ".zai-overview-export{width:calc(100vw - 36px);max-width:1440px;box-sizing:border-box;",
    "margin:0 auto;background:var(--zai-bg);",
    "border:1px solid var(--zai-border);border-radius:14px;",
    "box-shadow:0 10px 34px rgba(60,40,20,.16);padding:6px 14px 18px}",
    css,
    "</style></head><body>",
    `<div class="zai-overview-export">${block.outerHTML}</div>`,
    "<script data-zai-overview-export-runtime>",
    `(${installOverviewExportInteractions.toString()})(document);`,
    "</script>",
    "</body></html>",
  ].join("\n");
}
