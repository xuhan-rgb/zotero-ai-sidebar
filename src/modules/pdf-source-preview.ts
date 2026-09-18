export interface PdfSourcePage {
  url: string;
  width: number;
  height: number;
  pageCount: number;
}

interface RendererWindow extends Window {
  openSourcePdf?(input: number[]): Promise<number>;
  renderSourcePage?(pageIndex: number): Promise<PdfSourcePage>;
  pdfSourceError?: string;
}

/** A private renderer for the original attachment; never uses OCR text as the preview. */
export function createPdfSourcePreview(
  doc: Document,
  resolvePath: () => Promise<string>,
) {
  let frame: (Element & { contentWindow?: RendererWindow }) | undefined;
  let ready: Promise<RendererWindow> | undefined;
  let disposed = false;
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const pages = new Map<number, PdfSourcePage>();

  function resetRenderer() {
    generation++;
    frame?.remove();
    frame = undefined;
    ready = undefined;
  }

  async function initialize(): Promise<RendererWindow> {
    const current = generation;
    const assertActive = () => {
      if (disposed || current !== generation) throw new Error("PDF 预览已关闭");
    };
    const path = await resolvePath();
    assertActive();
    frame = doc.createXULElement?.("browser") as typeof frame;
    if (!frame) throw new Error("当前 Zotero 无法创建 PDF 预览");
    frame.setAttribute("type", "content");
    frame.setAttribute("hidden", "true");
    frame.setAttribute(
      "src",
      "chrome://zotero-ai-sidebar/content/pdf-source-renderer.html",
    );
    doc.documentElement!.append(frame);
    for (let attempt = 0; attempt < 100; attempt++) {
      assertActive();
      const win = frame.contentWindow;
      if (win?.pdfSourceError) throw new Error(win.pdfSourceError);
      if (win?.openSourcePdf && win.renderSourcePage) {
        const bytes = await (
          globalThis as unknown as {
            IOUtils: { read(path: string): Promise<Uint8Array> };
          }
        ).IOUtils.read(path);
        assertActive();
        await win.openSourcePdf(Array.from(bytes));
        assertActive();
        return win;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("PDF 预览加载超时");
  }

  return {
    getPage(pageIndex: number): Promise<PdfSourcePage> {
      const task = queue.then(async () => {
        if (disposed) throw new Error("PDF 预览已关闭");
        const cached = pages.get(pageIndex);
        if (cached) return cached;
        let page: PdfSourcePage;
        try {
          ready ??= initialize();
          const win = await withPreviewTimeout(
            ready,
            "读取原始 PDF 超时，请重试",
          );
          page = await withPreviewTimeout(
            win.renderSourcePage!(pageIndex),
            "绘制原始 PDF 超时，请重试",
          );
        } catch (error) {
          resetRenderer();
          throw error;
        }
        if (disposed) throw new Error("PDF 预览已关闭");
        // Retain only two rendered pages while the reading session is open.
        if (pages.size >= 2) pages.delete(pages.keys().next().value!);
        pages.set(pageIndex, page);
        return page;
      });
      queue = task.catch(() => undefined);
      return task;
    },
    dispose() {
      disposed = true;
      pages.clear();
      resetRenderer();
    },
  };
}

function withPreviewTimeout<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 30_000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
