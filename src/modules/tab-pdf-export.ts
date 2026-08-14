import { appendLocalPath } from "../utils/local-path";

export type PanelPdfKind = "note" | "overview";

interface PanelPdfHtmlOptions {
  title: string;
  bodyHtml: string;
  pluginCss: string;
  kind: PanelPdfKind;
}

interface HiddenPrintBrowser {
  browsingContext: PrintableBrowsingContext;
  load(source: string): Promise<boolean>;
  waitForDocument(options?: {
    allowInteractiveAfter?: number | false;
  }): Promise<void>;
  destroy(): void;
}

type PrintableBrowsingContext = BrowsingContext & {
  print(settings: nsIPrintSettings): Promise<void>;
};

type PanelPdfFileLabel = "AI笔记" | "阅读路线" | "全文总览";

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

export function panelPdfFileName(
  paperTitle: string,
  label: PanelPdfFileLabel,
): string {
  const cleanedTitle = paperTitle
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const title = cleanedTitle || "Zotero论文";
  const suffix = ` - ${label}.pdf`;
  return `${title.slice(0, Math.max(1, 180 - suffix.length))}${suffix}`;
}

export function configurePdfPrintSettings(
  settings: nsIPrintSettings,
  targetPath: string,
): void {
  settings.outputDestination = settings.kOutputDestinationFile ?? 1;
  settings.outputFormat = settings.kOutputFormatPDF ?? 2;
  settings.toFileName = targetPath;
  settings.printSilent = true;
  settings.printBGColors = true;
  settings.printBGImages = true;
  settings.headerStrLeft = "";
  settings.headerStrCenter = "";
  settings.headerStrRight = "";
  settings.footerStrLeft = "";
  settings.footerStrCenter = "";
  settings.footerStrRight = "";
}

export async function pickPanelPdfSavePath(
  mainWindow: Window,
  suggestedName: string,
): Promise<string | null> {
  if (!mainWindow.browsingContext) throw new Error("当前窗口不支持文件选择器");
  const nsFilePicker = Components.interfaces.nsIFilePicker;
  const filePickerClass = (
    Components.classes as unknown as Record<
      string,
      { createInstance(iid: typeof nsFilePicker): nsIFilePicker }
    >
  )["@mozilla.org/filepicker;1"];
  const picker = filePickerClass.createInstance(nsFilePicker);
  picker.init(
    mainWindow.browsingContext,
    "保存转换后的 PDF",
    nsFilePicker.modeSave,
  );
  picker.appendFilter("PDF 文件", "*.pdf");
  picker.defaultExtension = "pdf";
  picker.defaultString = suggestedName;
  const result = await new Promise<nsIFilePicker.ResultCode>((resolve) => {
    picker.open({ done: resolve });
  });
  if (result === nsFilePicker.returnCancel) return null;
  if (
    result !== nsFilePicker.returnOK &&
    result !== nsFilePicker.returnReplace
  ) {
    return null;
  }
  const path = picker.file?.path;
  if (!path) return null;
  return /\.pdf$/i.test(path) ? path : `${path}.pdf`;
}

// Export an already-rendered Zotero note editor. This preserves Zotero's own
// equation, image, citation, and note CSS rendering instead of reconstructing
// the editor from serialized note HTML.
export async function saveContentWindowAsPdf(
  contentWindow: Window,
  kind: PanelPdfKind,
  targetPath: string,
  mainWindow: Window,
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
    await printBrowsingContextToPdf(
      contentWindow.browsingContext as PrintableBrowsingContext,
      targetPath,
      mainWindow,
    );
  } finally {
    if (!hadPrintClass) doc.body?.classList.remove("zai-pdf-note");
    style.remove();
  }
}

// Standalone rendering is used for 总览 and as a fallback when Zotero's note
// editor iframe is unavailable. HiddenBrowser loads the print-only document;
// the browsing context writes it directly to the user-selected PDF path.
export async function savePanelHtmlAsPdf(
  html: string,
  targetPath: string,
  mainWindow: Window,
): Promise<void> {
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
    await printBrowsingContextToPdf(
      browser.browsingContext,
      targetPath,
      mainWindow,
    );
  } finally {
    browser.destroy();
    await Zotero.File.removeIfExists(path).catch(() => undefined);
  }
}

export function copyPdfFileToClipboard(path: string): void {
  const transferable = (
    Components.classes as unknown as Record<
      string,
      {
        createInstance(
          iid: typeof Components.interfaces.nsITransferable,
        ): nsITransferable;
      }
    >
  )["@mozilla.org/widget/transferable;1"].createInstance(
    Components.interfaces.nsITransferable,
  );
  transferable.init(null as unknown as nsILoadContext);

  const file = Zotero.File.pathToFile(path);
  transferable.addDataFlavor("application/x-moz-file");
  transferable.setTransferData("application/x-moz-file", file);

  const fileURI = Zotero.File.pathToFileURI(path);
  addClipboardString(transferable, "text/uri-list", fileURI);
  addClipboardString(
    transferable,
    "x-special/gnome-copied-files",
    `copy\n${fileURI}`,
  );
  Services.clipboard.setData(
    transferable,
    null as unknown as nsIClipboardOwner,
    Components.interfaces.nsIClipboard.kGlobalClipboard,
  );
}

async function printBrowsingContextToPdf(
  browsingContext: PrintableBrowsingContext,
  targetPath: string,
  mainWindow: Window,
): Promise<void> {
  const printUtils = (
    mainWindow as Window & {
      PrintUtils?: {
        getPrintSettings(
          printerName: string,
          defaultsOnly: boolean,
        ): nsIPrintSettings;
      };
    }
  ).PrintUtils;
  if (!printUtils) throw new Error("当前 Zotero 版本未提供 PDF 输出接口");
  const settings = printUtils.getPrintSettings("", false);
  configurePdfPrintSettings(settings, targetPath);
  await IOUtils.remove(targetPath, { ignoreAbsent: true });
  await browsingContext.print(settings);
  const info = await IOUtils.stat(targetPath).catch(() => null);
  if (!info || (info.size ?? 0) <= 0) throw new Error("PDF 文件生成失败");
}

function addClipboardString(
  transferable: nsITransferable,
  flavor: string,
  value: string,
): void {
  const supportsString = (
    Components.classes as unknown as Record<
      string,
      {
        createInstance(
          iid: typeof Components.interfaces.nsISupportsString,
        ): nsISupportsString;
      }
    >
  )["@mozilla.org/supports-string;1"].createInstance(
    Components.interfaces.nsISupportsString,
  );
  supportsString.data = value;
  transferable.addDataFlavor(flavor);
  transferable.setTransferData(flavor, supportsString);
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
