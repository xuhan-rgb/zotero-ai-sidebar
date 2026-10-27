import { linkWindowMinimization } from "./window-minimize-group";
import { setNativeWindowPinned } from "./native-window-pin";
import { openFloatingDesktopWindow } from "./floating-desktop-window";
import {
  createFloatingWorkspace,
  type FloatingWorkspace,
  type FloatingWorkspaceOptions,
} from "./floating-workspace";
import { normalizeFloatingPanelLayout } from "../settings/local-ui-settings";

interface Options extends FloatingWorkspaceOptions {
  windowURL: string;
  pinned?: boolean;
  onMountChange(mount: HTMLElement): void;
}

/** Native window ownership; each document renders fresh nodes against the same chat state. */
export function createFloatingDesktopWorkspace(
  host: Window,
  home: HTMLElement,
  options: Options,
): FloatingWorkspace {
  let layout = normalizeFloatingPanelLayout(options.layout);
  let shell: ReturnType<typeof openFloatingDesktopWindow> | null = null;
  let view: FloatingWorkspace | null = null;
  let desktop: Window | null = null;
  let hidden = false;
  let disposed = false;
  let expandedHeight = layout.answer.height;
  let compact = false;
  let pinned = options.pinned ?? true;
  let lastGeometry = "";
  let minimized = false;
  const isMinimized = () =>
    !!desktop &&
    (desktop as any).windowState === ((desktop as any).STATE_MINIMIZED ?? 2);
  let detachEvents: (() => void) | null = null;

  const saveGeometry = () => {
    if (!desktop || desktop.closed || hidden || disposed || isMinimized())
      return;
    const rect = {
      x: desktop.screenX,
      y: desktop.screenY,
      width: desktop.outerWidth,
      height: compact ? expandedHeight : desktop.outerHeight,
    };
    if (!Number.isFinite(rect.width) || rect.width <= 0 || rect.height <= 0)
      return;
    const key = JSON.stringify(rect);
    if (key === lastGeometry) return;
    lastGeometry = key;
    layout = normalizeFloatingPanelLayout({ ...layout, answer: rect });
    options.onLayoutChange(layout);
  };
  const restoreHome = () => {
    detachEvents?.();
    detachEvents = null;
    view?.destroy();
    view = null;
    desktop = null;
    options.onMountChange(home);
  };
  const open = () => {
    if (disposed || shell) return;
    hidden = false;
    shell = openFloatingDesktopWindow(host, {
      url: options.windowURL,
      pinned,
      width: Math.max(400, layout.answer.width),
      height: Math.max(400, layout.answer.height),
      onReady(win) {
        if (disposed) return;
        desktop = win;
        const container = win.document.getElementById("zai-desktop-container");
        if (!container) throw new Error("Floating window container is missing");
        const mount = win.document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "div",
        ) as HTMLElement;
        mount.id = home.id;
        mount.className = "zai-root-independent";
        container.append(mount);
        if (layout.answer.x !== null && layout.answer.y !== null)
          win.moveTo(layout.answer.x, layout.answer.y);
        options.onMountChange(mount);
        view = createFloatingWorkspace(win, mount, {
          ...options,
          desktop: true,
          readerHostWindow: host,
          onCompactChange(value) {
            const wasCompact = compact;
            if (value && !wasCompact) expandedHeight = win.outerHeight;
            compact = value;
            win.requestAnimationFrame(() => {
              if (
                disposed ||
                win.closed ||
                desktop !== win ||
                compact !== value
              )
                return;
              if (value) {
                const content = mount.querySelector<HTMLElement>(".composer");
                const height = Math.max(160, content?.scrollHeight || 200);
                win.resizeTo(
                  win.outerWidth,
                  height + Math.max(0, win.outerHeight - win.innerHeight),
                );
              } else if (wasCompact)
                win.resizeTo(win.outerWidth, expandedHeight);
            });
          },
          onReset() {
            expandedHeight = 680;
            win.resizeTo(600, 680);
            win.moveTo(
              host.screenX + Math.max(0, (host.outerWidth - 600) / 2),
              host.screenY + 80,
            );
          },
          onLayoutChange: () => saveGeometry(),
        });
        const onResize = () => {
          saveGeometry();
          view?.refreshReaderAlignment();
        };
        const onFocus = () => {
          if (!hidden && !minimized) return;
          hidden = minimized = false;
          view?.setVisible(true);
          options.onVisibilityChange();
        };
        const onInput = () => {
          if (!compact) return;
          win.requestAnimationFrame(() => {
            if (disposed || win.closed || desktop !== win || !compact) return;
            const height = Math.max(
              160,
              mount.querySelector<HTMLElement>(".composer")?.scrollHeight ||
                200,
            );
            win.resizeTo(
              win.outerWidth,
              height + Math.max(0, win.outerHeight - win.innerHeight),
            );
          });
        };
        mount.addEventListener("input", onInput);
        win.addEventListener("resize", onResize);
        win.addEventListener("focus", onFocus);
        const unlinkMinimization = linkWindowMinimization(host, win);
        detachEvents = () => {
          unlinkMinimization();
          win.removeEventListener("resize", onResize);
          win.removeEventListener("focus", onFocus);
          mount.removeEventListener("input", onInput);
        };
        view.setVisible(!hidden);
        if (hidden) (win as Window & { minimize?(): void }).minimize?.();
        else if (
          (host as any).windowState !== ((host as any).STATE_MINIMIZED ?? 2)
        )
          shell?.focus();
        options.onVisibilityChange();
      },
      onClose() {
        shell = null;
        hidden = true;
        restoreHome();
        options.onVisibilityChange();
      },
    });
  };
  open();
  return {
    arrange(panel) {
      view?.arrange(panel);
    },
    refresh(next) {
      if (next) layout = normalizeFloatingPanelLayout(next);
      view?.refresh();
    },
    refreshReaderAlignment() {
      const nextMinimized = isMinimized();
      if (minimized !== nextMinimized) {
        minimized = nextMinimized;
        view?.setVisible(!hidden && !minimized);
        options.onVisibilityChange();
      }
      saveGeometry();
      view?.refreshReaderAlignment();
    },
    setVisible(visible) {
      hidden = !visible;
      if (visible) {
        open();
        hidden = false;
        (desktop as (Window & { restore?(): void }) | null)?.restore?.();
        view?.setVisible(true);
        shell?.focus();
      } else {
        view?.setVisible(false);
        (desktop as (Window & { minimize?(): void }) | null)?.minimize?.();
      }
      options.onVisibilityChange();
    },
    showAnswer() {
      const wasHidden = hidden;
      if (hidden) this.setVisible(true);
      return (view?.showAnswer() ?? false) || wasHidden;
    },
    async setPinned(value) {
      if (desktop && !desktop.closed)
        await setNativeWindowPinned(desktop, value);
      pinned = value;
    },
    isHidden: () => hidden || isMinimized(),
    destroy() {
      if (disposed) return;
      saveGeometry();
      disposed = true;
      restoreHome();
      shell?.close();
      shell = null;
    },
  };
}
