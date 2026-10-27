import { describe, expect, it, vi } from "vitest";
import { openFloatingDesktopWindow } from "../../src/modules/floating-desktop-window";

function setup(href = "https://example.test/floating-window.xhtml") {
  const win = new EventTarget() as EventTarget & {
    document: Document;
    focus: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let location = href;
  Object.defineProperty(win, "document", {
    get: () => ({
      readyState: "complete",
      documentElement: {},
      location: {
        get href() {
          return location;
        },
      },
    }),
  });
  win.focus = vi.fn();
  win.close = vi.fn();
  const openDialog = vi.fn(() => win as unknown as Window);
  const scheduled: Array<() => void> = [];
  const setTimeout = vi.fn((callback: TimerHandler) => {
    if (typeof callback === "function") scheduled.push(callback as () => void);
    return 0;
  });
  const host = { openDialog, setTimeout } as unknown as Window;
  return {
    win,
    host,
    openDialog,
    setTimeout,
    navigate(url: string) {
      location = url;
    },
    load() {
      win.dispatchEvent(new Event("load"));
    },
    unload() {
      win.dispatchEvent(new Event("unload"));
    },
    runScheduled() {
      for (const callback of scheduled.splice(0)) callback();
    },
  };
}

describe("openFloatingDesktopWindow", () => {
  it("opens a native unbounded chrome dialog and waits for the document", () => {
    const state = setup("about:blank");
    const onReady = vi.fn();
    const shell = openFloatingDesktopWindow(state.host, {
      url: "chrome://zotero-ai-sidebar/content/floating-window.xhtml",
      width: 900,
      height: 760,
      onReady,
      onClose: vi.fn(),
    });
    expect(state.openDialog).toHaveBeenCalledWith(
      "chrome://zotero-ai-sidebar/content/floating-window.xhtml",
      expect.stringMatching(/^zai-floating-desktop-/),
      "chrome,dialog=no,resizable,alwaysontop,centerscreen,width=900,height=760",
    );
    state.load();
    expect(onReady).not.toHaveBeenCalled();
    state.navigate("chrome://zotero-ai-sidebar/content/floating-window.xhtml");
    state.load();
    expect(onReady).toHaveBeenCalledOnce();
    expect(shell.window).toBe(state.win);
    shell.focus();
    expect(state.win.focus).toHaveBeenCalledOnce();
  });

  it("opens an unpinned dialog when the saved preference is disabled", () => {
    const state = setup();
    openFloatingDesktopWindow(state.host, {
      url: "chrome://zotero-ai-sidebar/content/floating-window.xhtml",
      width: 600,
      height: 680,
      pinned: false,
      onReady: vi.fn(),
      onClose: vi.fn(),
    });
    expect(state.openDialog).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "chrome,dialog=no,resizable,centerscreen,width=600,height=680",
    );
  });

  it("suppresses stale ready and close callbacks after explicit close", () => {
    const state = setup("about:blank");
    const onReady = vi.fn();
    const onClose = vi.fn();
    const shell = openFloatingDesktopWindow(state.host, {
      url: "chrome://zotero-ai-sidebar/content/floating-window.xhtml",
      width: 600,
      height: 680,
      onReady,
      onClose,
    });
    shell.close();
    state.navigate("chrome://zotero-ai-sidebar/content/floating-window.xhtml");
    state.load();
    state.unload();
    expect(onReady).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(state.win.close).toHaveBeenCalledOnce();
  });

  it("reports native unload once", () => {
    const state = setup();
    const onClose = vi.fn();
    openFloatingDesktopWindow(state.host, {
      url: "chrome://zotero-ai-sidebar/content/floating-window.xhtml",
      width: 600,
      height: 680,
      onReady: vi.fn(),
      onClose,
    });
    state.unload();
    state.unload();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("checks an already complete target and ignores about:blank unload", () => {
    const state = setup("about:blank");
    const onReady = vi.fn();
    const onClose = vi.fn();
    openFloatingDesktopWindow(state.host, {
      url: "chrome://zotero-ai-sidebar/content/floating-window.xhtml",
      width: 600,
      height: 680,
      onReady,
      onClose,
    });
    expect(state.setTimeout).toHaveBeenCalledOnce();
    state.runScheduled();
    state.unload();
    expect(onClose).not.toHaveBeenCalled();
    state.navigate("chrome://zotero-ai-sidebar/content/floating-window.xhtml");
    state.load();
    expect(onReady).toHaveBeenCalledOnce();
    state.unload();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("throws when openDialog is unavailable or cannot open a window", () => {
    expect(() =>
      openFloatingDesktopWindow({} as Window, {
        url: "x",
        width: 1,
        height: 1,
        onReady: vi.fn(),
        onClose: vi.fn(),
      }),
    ).toThrow(/not available/);
    expect(() =>
      openFloatingDesktopWindow(
        { openDialog: () => null } as unknown as Window,
        {
          url: "x",
          width: 1,
          height: 1,
          onReady: vi.fn(),
          onClose: vi.fn(),
        },
      ),
    ).toThrow(/Unable to open/);
  });
});
