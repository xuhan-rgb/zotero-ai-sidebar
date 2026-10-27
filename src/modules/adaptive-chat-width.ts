export interface AdaptiveChatWidthOptions {
  windowWidth: number;
  readerLeft: number;
  pdfWidth: number;
  noteWidth?: number;
  splitterWidth?: number;
  minChatWidth?: number;
  maxChatWidth?: number;
}

export interface AdaptiveChatWidthResult {
  chatWidth: number;
  readerWidth: number;
  fits: boolean;
}

export function adaptiveChatWidth({
  windowWidth,
  readerLeft,
  pdfWidth,
  noteWidth = 0,
  splitterWidth = 4,
  minChatWidth = 320,
  maxChatWidth = 760,
}: AdaptiveChatWidthOptions): AdaptiveChatWidthResult | null {
  if (
    ![
      windowWidth,
      readerLeft,
      pdfWidth,
      noteWidth,
      splitterWidth,
      minChatWidth,
      maxChatWidth,
    ].every(Number.isFinite) ||
    windowWidth <= 0 ||
    pdfWidth <= 0 ||
    readerLeft < 0 ||
    noteWidth < 0 ||
    splitterWidth < 0 ||
    minChatWidth <= 0 ||
    maxChatWidth < minChatWidth
  ) {
    return null;
  }

  const usableWidth = windowWidth - readerLeft - noteWidth - splitterWidth;
  if (usableWidth <= 0) return null;

  const minWidth = Math.ceil(minChatWidth);
  const maxWidth = Math.floor(maxChatWidth);
  if (minWidth > maxWidth) return null;

  const desiredChatWidth = usableWidth - pdfWidth;
  const chatWidth = Math.round(
    Math.min(maxWidth, Math.max(minWidth, desiredChatWidth)),
  );
  const readerWidth = usableWidth - chatWidth;

  return {
    chatWidth,
    readerWidth,
    fits: readerWidth + 1 >= pdfWidth,
  };
}
