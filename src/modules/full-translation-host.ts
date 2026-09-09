const ROOT_CLASS = "zai-full-translation-host";

interface HiddenChildSnapshot {
  element: Element;
  hidden: string | null;
}

export interface FullTranslationHost {
  container: Element;
  root: HTMLElement;
  hiddenChildren: HiddenChildSnapshot[];
  rightBoundary?: Element | readonly Element[];
}

export function mountFullTranslationHost(
  doc: Document,
  tabID: string,
  adjacentElements: readonly Element[] = [],
  rightBoundary?: Element | readonly Element[],
): FullTranslationHost | null {
  const container = doc.getElementById(tabID);
  if (!container) return null;

  const existing = container.querySelector(`:scope > .${ROOT_CLASS}`);
  if (existing) existing.remove();

  const hiddenChildren = Array.from(
    new Set([...container.children, ...adjacentElements]),
  ).map((element) => ({
    element,
    hidden: element.getAttribute("hidden"),
  }));
  for (const snapshot of hiddenChildren) {
    snapshot.element.setAttribute("hidden", "true");
  }

  const root = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  root.className = ROOT_CLASS;
  container.append(root);
  const host = { container, root, hiddenChildren, rightBoundary };
  syncFullTranslationHostBounds(host);
  return host;
}

export function syncFullTranslationHostBounds(host: FullTranslationHost): void {
  host.root.style.removeProperty("width");
  host.root.style.removeProperty("max-width");
  if (!host.rightBoundary) return;

  const containerRect = host.container.getBoundingClientRect();
  if (
    !Number.isFinite(containerRect.left) ||
    !Number.isFinite(containerRect.width) ||
    containerRect.width <= 0
  ) {
    return;
  }

  const boundaries: readonly Element[] = Array.isArray(host.rightBoundary)
    ? host.rightBoundary
    : [host.rightBoundary as Element];
  let right = containerRect.left + containerRect.width;
  for (const boundary of boundaries) {
    if (!boundary.isConnected || elementIsHidden(boundary)) continue;
    const rect = boundary.getBoundingClientRect();
    if (
      Number.isFinite(rect.left) &&
      rect.width > 0 &&
      rect.left > containerRect.left
    ) {
      right = Math.min(right, rect.left);
    }
  }
  const availableWidth = Math.floor(right - containerRect.left);
  if (availableWidth <= 0 || availableWidth >= containerRect.width) return;
  host.root.style.width = `${availableWidth}px`;
  host.root.style.maxWidth = `${availableWidth}px`;
}

export function unmountFullTranslationHost(host: FullTranslationHost): void {
  host.root.remove();
  for (const snapshot of host.hiddenChildren) {
    if (snapshot.hidden == null) snapshot.element.removeAttribute("hidden");
    else snapshot.element.setAttribute("hidden", snapshot.hidden);
  }
}

function elementIsHidden(element: Element): boolean {
  const candidate = element as Element & {
    hidden?: boolean;
    collapsed?: boolean;
  };
  return (
    candidate.hidden === true ||
    candidate.collapsed === true ||
    element.getAttribute("hidden") === "true" ||
    element.getAttribute("collapsed") === "true"
  );
}
