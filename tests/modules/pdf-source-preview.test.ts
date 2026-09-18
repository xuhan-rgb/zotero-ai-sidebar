import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPdfSourcePreview } from "../../src/modules/pdf-source-preview";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setup() {
  const frame = document.createElement("div");
  const open = vi.fn(async () => 3);
  const render = vi.fn(async (index: number) => ({
    url: `page-${index}`,
    width: 600,
    height: 800,
    pageCount: 3,
  }));
  Object.defineProperty(frame, "contentWindow", {
    value: { openSourcePdf: open, renderSourcePage: render },
  });
  const doc = {
    createXULElement: () => frame,
    documentElement: document.body,
  } as unknown as Document;
  const read = vi.fn(async () => new Uint8Array([1, 2, 3]));
  vi.stubGlobal("IOUtils", { read });
  const preview = createPdfSourcePreview(doc, async () => "/local/paper.pdf");
  return { preview, frame, open, render, read };
}

describe("original PDF preview renderer", () => {
  it("reads the attachment lazily, reuses pages and releases its hidden browser", async () => {
    const { preview, frame, open, render, read } = setup();
    expect(read).not.toHaveBeenCalled();
    expect(await preview.getPage(2)).toMatchObject({ url: "page-2" });
    await preview.getPage(2);
    expect(read).toHaveBeenCalledExactlyOnceWith("/local/paper.pdf");
    expect(open).toHaveBeenCalledExactlyOnceWith([1, 2, 3]);
    expect(render).toHaveBeenCalledExactlyOnceWith(2);
    expect(frame.isConnected).toBe(true);
    await preview.getPage(0);
    await preview.getPage(1);
    await preview.getPage(2);
    expect(render).toHaveBeenCalledTimes(4);
    preview.dispose();
    expect(frame.isConnected).toBe(false);
    await expect(preview.getPage(0)).rejects.toThrow("已关闭");
  });

  it("serializes requests and allows retry after a failed render", async () => {
    const { preview, render } = setup();
    render.mockRejectedValueOnce(new Error("render failed"));
    const first = preview.getPage(0);
    const second = preview.getPage(1);
    await expect(first).rejects.toThrow("render failed");
    await expect(second).resolves.toMatchObject({ url: "page-1" });
    await expect(preview.getPage(0)).resolves.toMatchObject({ url: "page-0" });
    preview.dispose();
  });

  it("times out stalled opening and lets the next request retry", async () => {
    vi.useFakeTimers();
    const { preview, open } = setup();
    try {
      open.mockImplementationOnce(() => new Promise(() => {}));
      const first = preview.getPage(0);
      const outcome = first.then(
        () => "done",
        (error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(30_001);
      expect(
        await Promise.race([outcome, Promise.resolve("still loading")]),
      ).toContain("超时");
      await expect(preview.getPage(0)).resolves.toMatchObject({
        url: "page-0",
      });
    } finally {
      preview.dispose();
      vi.useRealTimers();
    }
  });

  it("times out a stalled render and reopens the PDF for retry", async () => {
    vi.useFakeTimers();
    const { preview, render, open } = setup();
    try {
      render.mockImplementationOnce(() => new Promise(() => {}));
      const outcome = preview.getPage(0).then(
        () => "done",
        (error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(30_001);
      expect(
        await Promise.race([outcome, Promise.resolve("still loading")]),
      ).toContain("超时");
      await expect(preview.getPage(0)).resolves.toMatchObject({
        url: "page-0",
      });
      expect(open).toHaveBeenCalledTimes(2);
    } finally {
      preview.dispose();
      vi.useRealTimers();
    }
  });

  it("does not create a browser after closure while resolving the attachment", async () => {
    let resolve!: (path: string) => void;
    const create = vi.fn();
    const preview = createPdfSourcePreview(
      { createXULElement: create } as unknown as Document,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const task = preview.getPage(0);
    await Promise.resolve();
    preview.dispose();
    resolve("/paper.pdf");
    await expect(task).rejects.toThrow("已关闭");
    expect(create).not.toHaveBeenCalled();
  });

  it("runs the packaged renderer for the requested original PDF page", async () => {
    const html = readFileSync("addon/content/pdf-source-renderer.html", "utf8");
    const script = html.match(
      /<script type="module">([\s\S]*?)<\/script>/,
    )![1]!;
    const cleanup = vi.fn();
    // PDF.js 4.10 schedules display rendering with requestAnimationFrame.
    // Hidden browser documents do not supply those frames; print intent uses microtasks.
    const render = vi.fn(({ intent }: { intent?: string }) => ({
      promise: intent === "print" ? Promise.resolve() : new Promise(() => {}),
    }));
    const getPage = vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
      }),
      render,
      cleanup,
    }));
    const getDocument = vi.fn(() => ({
      promise: Promise.resolve({ numPages: 3, getPage }),
    }));
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/png;base64,original",
    };
    const win: Record<string, any> = {};
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    await new AsyncFunction(
      "window",
      "document",
      "globalThis",
      "loadModule",
      script.replaceAll("await import(", "await loadModule("),
    )(win, { createElement: () => canvas }, {}, async () => ({
      getDocument,
      WorkerMessageHandler: {},
    }));
    expect(await win.openSourcePdf([1, 2])).toBe(3);
    expect(
      await Promise.race([
        win.renderSourcePage(2),
        new Promise((resolve) =>
          setTimeout(
            () => resolve("waiting for hidden-window animation frame"),
            30,
          ),
        ),
      ]),
    ).toEqual({
      url: "data:image/png;base64,original",
      width: 1200,
      height: 1600,
      pageCount: 3,
    });
    expect(getPage).toHaveBeenCalledWith(3);
    expect(render).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
});
