/** Keep async chat work attached to one state while its document changes. */
interface MountGroup {
  home: HTMLElement;
  current: HTMLElement;
}
const mounts = new WeakMap<Element, MountGroup>();

export function bindSidebarMount(
  home: HTMLElement,
  current: HTMLElement,
): void {
  const group = mounts.get(home) ?? { home, current: home };
  group.current = current;
  mounts.set(home, group);
  mounts.set(current, group);
}

export function resolveSidebarMount(mount: HTMLElement): HTMLElement {
  return mounts.get(mount)?.current ?? mount;
}

/** All document-specific mounts share a single state key. */
export class SidebarMountStateMap<T> extends WeakMap<Element, T> {
  override get(key: Element): T | undefined {
    return super.get(mounts.get(key)?.home ?? key);
  }
  override set(key: Element, value: T): this {
    return super.set(mounts.get(key)?.home ?? key, value);
  }
  override has(key: Element): boolean {
    return super.has(mounts.get(key)?.home ?? key);
  }
  override delete(key: Element): boolean {
    return super.delete(mounts.get(key)?.home ?? key);
  }
}
