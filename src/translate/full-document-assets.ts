import { arxivFolderPath, readArxivSourceAsset } from "../context/arxiv-store";
import { appendLocalPath } from "../utils/local-path";
import type { FullTranslationDocument } from "./full-document";

export const PDFJS_MODULE_URL = "resource://zotero/reader/pdf/build/pdf.mjs";
export const PDFJS_WORKER_URL =
  "resource://zotero/reader/pdf/build/pdf.worker.mjs";
const PDF_RENDERER_URL =
  "chrome://zotero-ai-sidebar/content/pdf-figure-renderer.html";

interface PdfRendererWindow extends Window {
  renderPdfFirstPage?(bytes: number[]): Promise<string>;
  pdfRendererError?: string;
}

const pdfRenderers = new WeakMap<Document, Promise<PdfRendererWindow>>();
const assetPreviewCaches = new WeakMap<
  Document,
  Map<string, Promise<FullTranslationAssetPreview>>
>();
let nativePreviewID = 0;

export interface FullTranslationAssetPreview {
  sourcePath: string;
  resolvedPath?: string;
  previewUrl?: string;
  error?: string;
}

export type FullTranslationAssetPreviews = Record<
  string,
  FullTranslationAssetPreview
>;

export async function loadFullTranslationAssetPreviews(
  document: FullTranslationDocument,
  doc: Document,
  onAsset?: (path: string, preview: FullTranslationAssetPreview) => void,
): Promise<FullTranslationAssetPreviews> {
  const paths = [
    ...new Set(document.blocks.flatMap((block) => block.assets ?? [])),
  ];
  const previews: FullTranslationAssetPreviews = {};
  for (const path of paths) {
    const preview = await cachedPreview(document.arxivId, path, doc);
    previews[path] = preview;
    onAsset?.(path, preview);
  }
  return previews;
}

function cachedPreview(
  arxivId: string,
  sourcePath: string,
  doc: Document,
): Promise<FullTranslationAssetPreview> {
  let cache = assetPreviewCaches.get(doc);
  if (!cache) {
    cache = new Map();
    assetPreviewCaches.set(doc, cache);
  }
  const key = `${arxivId}\0${sourcePath}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = loadPreview(arxivId, sourcePath, doc).then((preview) => {
    if (preview.error) cache!.delete(key);
    return preview;
  });
  cache.set(key, pending);
  return pending;
}

async function loadPreview(
  arxivId: string,
  sourcePath: string,
  doc: Document,
): Promise<FullTranslationAssetPreview> {
  const asset = await readArxivSourceAsset(arxivId, sourcePath);
  if (!asset) return { sourcePath, error: "未找到 LaTeX 图源" };
  try {
    if (asset.mediaType === "application/pdf") {
      const nativePreview = await renderNativePdfSourceAsset(
        arxivId,
        asset.path,
      );
      return {
        sourcePath,
        resolvedPath: asset.path,
        previewUrl: nativePreview ?? (await renderPdfPreview(doc, asset.bytes)),
      };
    }
    if (asset.mediaType === "application/postscript") {
      return {
        sourcePath,
        resolvedPath: asset.path,
        error: "EPS 图源暂时无法预览",
      };
    }
    return {
      sourcePath,
      resolvedPath: asset.path,
      previewUrl: bytesToDataUrl(asset.bytes, asset.mediaType),
    };
  } catch (error) {
    return {
      sourcePath,
      resolvedPath: asset.path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

async function renderNativePdfSourceAsset(
  arxivId: string,
  sourcePath: string,
): Promise<string | null> {
  const Z = Zotero as any;
  const exec = Z?.Utilities?.Internal?.exec;
  const tempRoot: string | undefined = Z?.getTempDirectory?.()?.path;
  if (!Z?.isLinux || typeof exec !== "function" || !tempRoot) return null;

  const outputPrefix = appendLocalPath(
    tempRoot,
    `zai-latex-figure-${Date.now()}-${nativePreviewID++}`,
  );
  const outputPath = `${outputPrefix}.png`;
  const inputPath = appendLocalPath(
    arxivFolderPath(arxivId),
    "source",
    sourcePath,
  );
  try {
    const ok = await exec("/usr/bin/pdftoppm", [
      "-f",
      "1",
      "-singlefile",
      "-scale-to-x",
      "1400",
      "-scale-to-y",
      "-1",
      "-png",
      inputPath,
      outputPrefix,
    ]);
    if (ok !== true) return null;
    const bytes = await (
      globalThis as unknown as {
        IOUtils: { read(path: string): Promise<Uint8Array> };
      }
    ).IOUtils.read(outputPath);
    return bytesToDataUrl(bytes, "image/png");
  } catch {
    return null;
  } finally {
    try {
      await Z?.File?.removeIfExists?.(outputPath);
    } catch {
      // Temporary preview cleanup is best-effort.
    }
  }
}

async function renderPdfPreview(
  doc: Document,
  bytes: Uint8Array,
): Promise<string> {
  const renderer = await pdfRenderer(doc);
  if (!renderer.renderPdfFirstPage) throw new Error("PDF 图片渲染器未就绪");
  return withTimeout(
    renderer.renderPdfFirstPage(Array.from(bytes)),
    15_000,
    "PDF 图片渲染超时",
  );
}

function pdfRenderer(doc: Document): Promise<PdfRendererWindow> {
  const cached = pdfRenderers.get(doc);
  if (cached) return cached;
  const promise = createPdfRenderer(doc);
  pdfRenderers.set(doc, promise);
  promise.catch(() => pdfRenderers.delete(doc));
  return promise;
}

function createPdfRenderer(doc: Document): Promise<PdfRendererWindow> {
  const frame = doc.createXULElement?.("browser") as
    | (Element & { contentWindow?: PdfRendererWindow })
    | undefined;
  if (!frame)
    return Promise.reject(new Error("当前 Zotero 无法创建图片渲染器"));
  frame.setAttribute("type", "content");
  frame.setAttribute("src", PDF_RENDERER_URL);
  frame.setAttribute("hidden", "true");
  doc.documentElement?.append(frame);

  return new Promise((resolve, reject) => {
    const win = doc.defaultView;
    let attempts = 0;
    const poll = () => {
      const contentWindow = frame.contentWindow;
      if (contentWindow?.pdfRendererError) {
        frame.remove();
        reject(
          new Error(
            `PDF 图片渲染器加载失败：${contentWindow.pdfRendererError}`,
          ),
        );
        return;
      }
      if (typeof contentWindow?.renderPdfFirstPage === "function") {
        resolve(contentWindow);
        return;
      }
      attempts += 1;
      if (attempts >= 100) {
        frame.remove();
        reject(new Error("PDF 图片渲染器加载超时"));
        return;
      }
      (win?.setTimeout ?? setTimeout)(poll, 50);
    };
    frame.addEventListener("load", poll, { once: true });
    (win?.setTimeout ?? setTimeout)(poll, 50);
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
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
