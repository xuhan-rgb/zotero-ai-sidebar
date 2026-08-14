import { appendLocalPath } from "../utils/local-path";

export type PanelPdfKind = "note" | "overview";

interface PanelPdfHtmlOptions {
  title: string;
  bodyHtml: string;
  pluginCss: string;
  kind: PanelPdfKind;
}

interface HiddenPrintBrowser {
  load(source: string): Promise<boolean>;
  waitForDocument(options?: {
    allowInteractiveAfter?: number | false;
  }): Promise<void>;
  print(options?: object): Promise<void>;
  destroy(): void;
}

interface HiddenPrintBrowserConstructor {
  new (options: { useHiddenFrame: false }): HiddenPrintBrowser;
}

export function panelPdfPrintCss(kind: PanelPdfKind): string {
  const contentRules =
    kind === "note"
      ? [
          ".zai-pdf-note{box-sizing:border-box;width:100%;max-width:none;min-height:0;overflow:visible;padding:0;color:#24211d;background:#fff;font-size:14px;line-height:1.55}",
          "#editor-container{position:static!important;inset:auto!important;height:auto!important;overflow:visible!important}",
          "#editor-container .editor{position:static!important;inset:auto!important;height:auto!important;overflow:visible!important}",
          "#editor-container .editor .editor-core{display:block!important;flex:none!important;height:auto!important;overflow:visible!important}",
          "#editor-container .editor .editor-core .primary-editor{display:block!important;min-height:0!important;height:auto!important;overflow:visible!important}",
          ".toolbar,.findbar,.noticebar,.context-menu,.popup{display:none!important}",
          ".zai-pdf-note h1,.zai-pdf-note h2,.zai-pdf-note h3,.zai-pdf-note h4,.zai-pdf-note h5,.zai-pdf-note h6{break-after:avoid-page}",
          ".zai-pdf-note blockquote,.zai-pdf-note pre,.zai-pdf-note table,.zai-pdf-note figure,.zai-pdf-note li{break-inside:avoid}",
          ".zai-pdf-note img,.zai-pdf-note svg{max-width:100%;height:auto}",
        ]
      : [
          ".zai-pdf-overview{box-sizing:border-box;width:100%;max-width:none;margin:0;padding:0;background:#fff}",
          ".zai-pdf-overview .overview-block{width:100%;max-width:none;margin:0;box-shadow:none;border:0;background:#fff}",
          ".zai-pdf-overview .overview-header{position:static}",
          ".zai-pdf-overview .overview-sec,.zai-pdf-overview .overview-fig,.zai-pdf-overview .zai-mm-node,.zai-pdf-overview .network-diagram-card{break-inside:avoid}",
          ".zai-pdf-overview .overview-view-pane:not(.active){display:none!important}",
        ];

  return [
    "@page{size:auto;margin:14mm 12mm}",
    "@media print{",
    "html,body{margin:0!important;padding:0!important;background:#fff!important;color:#24211d}",
    "body{-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    "button,input,textarea,select,.overview-view-tabs{display:none!important}",
    "a{color:inherit;text-decoration:none}",
    ...contentRules,
    "}",
  ].join("\n");
}

export function buildPanelPdfHtml(options: PanelPdfHtmlOptions): string {
  const wrapperClass =
    options.kind === "note"
      ? "zai-note-rich-editor zai-pdf-note"
      : "zai-pdf-overview";
  return [
    "<!DOCTYPE html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(options.title)}</title>`,
    "<style>",
    options.pluginCss,
    panelPdfPrintCss(options.kind),
    "</style></head><body>",
    `<main class="${wrapperClass}">${options.bodyHtml}</main>`,
    "</body></html>",
  ].join("\n");
}

// Print an already-rendered Zotero note editor. This preserves Zotero's own
// equation, image, citation, and note CSS rendering instead of reconstructing
// the editor from serialized note HTML.
export async function printContentWindowAsPdf(
  contentWindow: Window,
  kind: PanelPdfKind,
): Promise<void> {
  await waitForPrintableContent(contentWindow);
  const doc = contentWindow.document;
  const style = doc.createElement("style");
  style.dataset.zaiPdfPrint = "1";
  style.textContent = panelPdfPrintCss(kind);
  doc.head?.append(style);
  const hadPrintClass = doc.body?.classList.contains("zai-pdf-note") ?? false;
  if (kind === "note") doc.body?.classList.add("zai-pdf-note");
  try {
    const exposedWindow = contentWindow.wrappedJSObject ?? contentWindow;
    const print = (
      exposedWindow as Window & {
        zoteroPrint?: (options?: object) => Promise<void>;
      }
    ).zoteroPrint;
    if (typeof print !== "function") {
      throw new Error("当前 Zotero 版本未提供原生 PDF 打印接口");
    }
    await print.call(exposedWindow, {});
  } finally {
    if (!hadPrintClass) doc.body?.classList.remove("zai-pdf-note");
    style.remove();
  }
}

// Standalone printing is used for 总览 and as a fallback when Zotero's note
// editor iframe is unavailable. HiddenBrowser is Zotero's native print path and
// opens the system print dialog, where the user chooses “打印到文件 / PDF”.
export async function printPanelHtmlAsPdf(html: string): Promise<void> {
  const tempRoot = Zotero.getTempDirectory?.()?.path;
  if (!tempRoot) throw new Error("无法创建 PDF 打印页面");
  const path = appendLocalPath(
    tempRoot,
    `zai-panel-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`,
  );
  const { HiddenBrowser } = ChromeUtils.importESModule(
    "chrome://zotero/content/HiddenBrowser.mjs",
  ) as { HiddenBrowser: HiddenPrintBrowserConstructor };
  const browser = new HiddenBrowser({ useHiddenFrame: false });
  try {
    await Zotero.File.putContentsAsync(path, html);
    const loaded = await browser.load(path);
    if (!loaded) throw new Error("PDF 打印页面加载失败");
    await browser.waitForDocument();
    await browser.print({});
  } finally {
    browser.destroy();
    await Zotero.File.removeIfExists(path).catch(() => undefined);
  }
}

async function waitForPrintableContent(contentWindow: Window): Promise<void> {
  const doc = contentWindow.document;
  if (doc.readyState !== "complete") {
    await waitForWindowEvent(contentWindow, "load", 5000);
  }
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready) await withTimeout(contentWindow, fonts.ready, 5000);
  const pendingImages = Array.from(doc.querySelectorAll("img")).filter(
    (image) => !(image as HTMLImageElement).complete,
  ) as HTMLImageElement[];
  await withTimeout(
    contentWindow,
    Promise.allSettled(
      pendingImages.map(
        (image) =>
          new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    ),
    5000,
  );
  await new Promise<void>((resolve) =>
    contentWindow.requestAnimationFrame(() =>
      contentWindow.requestAnimationFrame(() => resolve()),
    ),
  );
}

function waitForWindowEvent(
  win: Window,
  eventName: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      win.clearTimeout(timer);
      win.removeEventListener(eventName, done);
      resolve();
    };
    const timer = win.setTimeout(done, timeoutMs);
    win.addEventListener(eventName, done, { once: true });
  });
}

async function withTimeout<T>(
  win: Window,
  promise: PromiseLike<T>,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    Promise.resolve(promise).then(() => undefined),
    new Promise<void>((resolve) => win.setTimeout(resolve, timeoutMs)),
  ]);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
