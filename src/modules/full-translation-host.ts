const ROOT_CLASS = "zai-full-translation-host";

interface HiddenChildSnapshot {
  element: Element;
  hidden: string | null;
}

export interface FullTranslationHost {
  container: Element;
  root: HTMLElement;
  hiddenChildren: HiddenChildSnapshot[];
  rightBoundary?: Element;
}

export function mountFullTranslationHost(
  doc: Document,
  tabID: string,
  adjacentElements: readonly Element[] = [],
  rightBoundary?: Element,
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
  if (!host.rightBoundary || elementIsHidden(host.rightBoundary)) return;

  const containerRect = host.container.getBoundingClientRect();
  const boundaryRect = host.rightBoundary.getBoundingClientRect();
  if (
    !Number.isFinite(containerRect.left) ||
    !Number.isFinite(containerRect.width) ||
    !Number.isFinite(boundaryRect.left) ||
    containerRect.width <= 0
  ) {
    return;
  }

  const availableWidth = Math.floor(boundaryRect.left - containerRect.left);
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
