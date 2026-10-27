type NativeWindow = Window & {
  windowState?: number;
  STATE_MINIMIZED?: number;
  STATE_MAXIMIZED?: number;
  minimize?(): void;
  restore?(): void;
  maximize?(): void;
};
interface Group {
  children: Set<NativeWindow>;
  minimizedByHost: Map<NativeWindow, number | undefined>;
  sync(): void;
  dispose(): void;
}
const groups = new WeakMap<Window, Group>();
const links = new WeakMap<Window, { dispose(): void }>();
const isMinimized = (win: NativeWindow) =>
  win.windowState === (win.STATE_MINIMIZED ?? 2);

/** Only restore windows this group minimized; preserve independently minimized windows. */
export function linkWindowMinimization(
  host: Window,
  child: Window,
): () => void {
  const existing = links.get(child);
  if (existing) return existing.dispose;
  let group = groups.get(host);
  if (!group) {
    const children = new Set<NativeWindow>();
    const minimizedByHost = new Map<NativeWindow, number | undefined>();
    const sync = () => {
      if (host.closed) return;
      if (isMinimized(host)) {
        for (const win of children) {
          if (win.closed || isMinimized(win) || minimizedByHost.has(win))
            continue;
          minimizedByHost.set(win, win.windowState);
          win.minimize?.();
        }
      } else {
        for (const [win, previousState] of minimizedByHost) {
          if (win.closed || !isMinimized(win)) continue;
          if (previousState === (win.STATE_MAXIMIZED ?? 1) && win.maximize)
            win.maximize();
          else win.restore?.();
        }
        minimizedByHost.clear();
      }
    };
    const dispose = () => {
      host.removeEventListener("sizemodechange", sync);
      host.removeEventListener("unload", dispose);
      for (const win of [...children]) links.get(win)?.dispose();
      groups.delete(host);
    };
    group = { children, minimizedByHost, sync, dispose };
    groups.set(host, group);
    host.addEventListener("sizemodechange", sync);
    host.addEventListener("unload", dispose);
  }
  const owner = group;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    child.removeEventListener("unload", dispose);
    owner.children.delete(child);
    owner.minimizedByHost.delete(child);
    links.delete(child);
    if (owner.children.size === 0) owner.dispose();
  };
  links.set(child, { dispose });
  owner.children.add(child);
  child.addEventListener("unload", dispose);
  owner.sync();
  return dispose;
}

export function clearWindowMinimization(host: Window): void {
  groups.get(host)?.dispose();
}
