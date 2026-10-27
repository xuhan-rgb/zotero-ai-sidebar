import { readerRectInHost } from "./floating-pdf-alignment";

export interface PdfReadingViewport {
  hostWindow: Window;
  right: number;
}

/** Return a PDF container width clipped to the visible host reading area. */
export function visiblePdfWidth(
  view: Window,
  container: HTMLElement,
  related: Window[],
  viewport: PdfReadingViewport,
): number | null {
  const bounds = container.getBoundingClientRect();
  const nativeWidth = view.innerWidth - bounds.left;
  if (
    ![bounds.left, bounds.top, bounds.width, bounds.height, nativeWidth].every(
      Number.isFinite,
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    nativeWidth <= 0 ||
    !Number.isFinite(viewport.right) ||
    viewport.right <= 0
  )
    return null;

  const nativeRect = {
    left: bounds.left,
    top: bounds.top,
    width: nativeWidth,
    height: bounds.height,
  };
  const mapped = readerRectInHost(
    view,
    nativeRect,
    viewport.hostWindow,
    related,
  );
  if (!mapped) return null;
  const hostRight = Math.min(viewport.hostWindow.innerWidth, viewport.right);
  if (!Number.isFinite(hostRight) || hostRight <= 0) return null;
  const visibleLeft = Math.max(0, mapped.left);
  const visibleRight = Math.min(hostRight, mapped.left + mapped.width);
  if (!Number.isFinite(visibleLeft) || !Number.isFinite(visibleRight))
    return null;
  const scaleX = mapped.width / nativeWidth;
  const width = (visibleRight - visibleLeft) / scaleX;
  return Number.isFinite(width) && width > 0 ? width : null;
}
