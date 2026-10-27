import { describe, expect, it } from "vitest";
import { getPdfViewerApplication } from "../../src/modules/pdf-viewer-application";

describe("getPdfViewerApplication", () => {
  it("returns the direct application when its viewer is available", () => {
    const app = { pdfViewer: {} };
    expect(
      getPdfViewerApplication({ PDFViewerApplication: app } as Window),
    ).toBe(app);
  });

  it("reads the wrapped API when only it is visible", () => {
    const app = { pdfViewer: {} };
    expect(
      getPdfViewerApplication({
        wrappedJSObject: { PDFViewerApplication: app },
      } as Window),
    ).toBe(app);
  });

  it("falls back when the direct application is empty", () => {
    const app = { pdfViewer: {} };
    expect(
      getPdfViewerApplication({
        PDFViewerApplication: {},
        wrappedJSObject: { PDFViewerApplication: app },
      } as Window),
    ).toBe(app);
  });

  it("falls back when reading the direct application throws", () => {
    const app = { pdfViewer: {} };
    const view = { wrappedJSObject: { PDFViewerApplication: app } };
    Object.defineProperty(view, "PDFViewerApplication", {
      get: () => {
        throw new Error();
      },
    });
    expect(getPdfViewerApplication(view as unknown as Window)).toBe(app);
  });

  it("returns null when both APIs are unavailable or throw", () => {
    const view = {
      get wrappedJSObject(): never {
        throw new Error();
      },
    };
    expect(getPdfViewerApplication(view as unknown as Window)).toBeNull();
    expect(
      getPdfViewerApplication({ PDFViewerApplication: {} } as Window),
    ).toBeNull();
  });
});
