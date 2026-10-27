export function getPdfViewerApplication<T extends object>(
  view: Window,
): T | null {
  const resolve = (source: unknown): T | null => {
    try {
      const app = (source as { PDFViewerApplication?: T } | null)
        ?.PDFViewerApplication;
      return app && (app as { pdfViewer?: unknown }).pdfViewer ? app : null;
    } catch {
      return null;
    }
  };

  const direct = resolve(view);
  if (direct) return direct;
  try {
    return resolve(
      (view as Window & { wrappedJSObject?: unknown }).wrappedJSObject,
    );
  } catch {
    return null;
  }
}
