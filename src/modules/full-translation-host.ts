const ROOT_CLASS = "zai-full-translation-host";

interface HiddenChildSnapshot {
  element: Element;
  hidden: string | null;
}

export interface FullTranslationHost {
  container: Element;
  root: HTMLElement;
  hiddenChildren: HiddenChildSnapshot[];
}

export function mountFullTranslationHost(
  doc: Document,
  tabID: string,
  adjacentElements: readonly Element[] = [],
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
  return { container, root, hiddenChildren };
}

export function unmountFullTranslationHost(host: FullTranslationHost): void {
  host.root.remove();
  for (const snapshot of host.hiddenChildren) {
    if (snapshot.hidden == null) snapshot.element.removeAttribute("hidden");
    else snapshot.element.setAttribute("hidden", snapshot.hidden);
  }
}
