export type FloatingDesktopWindowOptions = {
  url: string;
  width: number;
  height: number;
  pinned?: boolean;
  onReady(win: Window): void;
  onClose(): void;
};

let nextWindowId = 0;

export function openFloatingDesktopWindow(
  host: Window,
  options: FloatingDesktopWindowOptions,
): { focus(): void; close(): void; window: Window | null } {
  if (typeof host.openDialog !== "function") {
    throw new Error("Native dialog windows are not available");
  }
  const name = `zai-floating-desktop-${Date.now()}-${++nextWindowId}`;
  const win = host.openDialog(
    options.url,
    name,
    `chrome,dialog=no,resizable,${options.pinned === false ? "" : "alwaysontop,"}centerscreen,width=${options.width},height=${options.height}`,
  );
  if (!win) throw new Error("Unable to open native dialog window");

  let closed = false;
  let ready = false;
  const onLoad = () => {
    if (closed || ready) return;
    let isReady = false;
    try {
      const doc = win.document;
      isReady =
        doc.readyState === "complete" &&
        Boolean(doc.documentElement) &&
        doc.location?.href !== "about:blank";
    } catch {
      // Ignore a document being replaced during navigation.
    }
    if (!isReady) return;
    ready = true;
    win.removeEventListener("load", onLoad);
    options.onReady(win);
  };
  const onUnload = () => {
    if (closed) return;
    try {
      if (win.document.location?.href === "about:blank") return;
    } catch {
      return;
    }
    closed = true;
    win.removeEventListener("load", onLoad);
    options.onClose();
  };

  win.addEventListener("load", onLoad);
  win.addEventListener("unload", onUnload);
  try {
    if (win.document.readyState === "complete") host.setTimeout(onLoad, 0);
  } catch {
    // The initial document may not be accessible until navigation completes.
  }
  return {
    window: win,
    focus() {
      if (!closed) win.focus();
    },
    close() {
      if (closed) return;
      closed = true;
      win.removeEventListener("load", onLoad);
      win.removeEventListener("unload", onUnload);
      win.close();
    },
  };
}
