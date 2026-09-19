import { describe, expect, it, vi } from "vitest";
import {
  activeReaderPageIndex,
  readerAllPageTexts,
  readerPageTexts,
} from "../../src/modules/reader-access";

function viewWith(chars: Record<number, string>, numPages = 3) {
  const view = {
    _pdfPages: Object.fromEntries(
      Object.entries(chars).map(([key, text]) => [
        key,
        { chars: [...text].map((c) => ({ c })) },
      ]),
    ) as Record<string, unknown>,
    _iframeWindow: {
      PDFViewerApplication: { pdfDocument: { numPages } },
    },
    _ensureBasicPageData: vi.fn(async (index: number) => {
      view._pdfPages[index] = { chars: [{ c: `p${index}` }] };
    }),
  };
  return view;
}

const readerWith = (view: unknown, parentID = 42) => ({
  _internalReader: { _primaryView: view },
  _item: { parentID },
});

describe("reader page texts", () => {
  it("keeps a page text at its own index", () => {
    const reader = readerWith(viewWith({ 2: "third" }));
    // Page 0 and 1 have no chars yet: the list must not shift page 2 into 0.
    expect(readerPageTexts(reader)).toEqual(["", "", "third"]);
  });

  it("fills the pages the reader has not materialised yet", async () => {
    const view = viewWith({ 0: "first" });
    await expect(readerAllPageTexts(readerWith(view))).resolves.toEqual([
      "first",
      "p1",
      "p2",
    ]);
    expect(view._ensureBasicPageData).toHaveBeenCalledTimes(2);
  });

  it("reports nothing when there is no reader or no page data", async () => {
    await expect(readerAllPageTexts(null)).resolves.toBeUndefined();
    await expect(
      readerAllPageTexts(readerWith({ _pdfPages: { 0: {} } })),
    ).resolves.toBeUndefined();
  });

  it("reads the page from a reader kept in a background tab", () => {
    const view = viewWith({ 0: "first" });
    const application = view._iframeWindow.PDFViewerApplication as {
      pdfViewer?: { currentPageNumber: number };
    };
    application.pdfViewer = { currentPageNumber: 2 };
    const reader = readerWith(view);
    (globalThis as Record<string, unknown>).Zotero = {
      Reader: { _readers: [reader], getByTabID: () => null },
    };
    // The foreground tab is not a reader, but the paper's reader is still open.
    const win = { Zotero_Tabs: { selectedID: "tab-1" } } as unknown as Window;

    expect(activeReaderPageIndex(win, 42)).toBe(1);
    expect(activeReaderPageIndex(win, 7)).toBeNull();

    delete (globalThis as Record<string, unknown>).Zotero;
  });
});
