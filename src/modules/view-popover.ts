export function syncViewDragGuard(doc: Document | null | undefined): void {
  doc?.documentElement?.classList.toggle(
    "zai-view-menu-open",
    !!doc.querySelector("details.header-view-menu[open]"),
  );
}

export function positionViewPopover(menu: HTMLElement): void {
  syncViewDragGuard(menu.ownerDocument);
  const summary = menu.querySelector("summary");
  const content = menu.querySelector<HTMLElement>(".zai-compact-menu-content");
  const view = menu.ownerDocument?.defaultView;
  if (!summary || !content || !view) return;

  const anchor = summary.getBoundingClientRect();
  const viewportWidth = view.innerWidth;
  const viewportHeight = view.innerHeight;
  content.style.width = "";
  const width = Math.max(
    0,
    Math.min(content.getBoundingClientRect().width || 320, viewportWidth - 16),
  );
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - width - 8));
  const below = Math.max(0, viewportHeight - anchor.bottom - 8);
  const above = Math.max(0, anchor.top - 8);
  const placeAbove = below < content.scrollHeight && above > below;
  const maxHeight = placeAbove ? above : below;

  Object.assign(content.style, {
    position: "fixed",
    left: `${left}px`,
    top: placeAbove ? "auto" : `${anchor.bottom}px`,
    bottom: placeAbove ? `${viewportHeight - anchor.top + 8}px` : "auto",
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    overflowY: "auto",
  });
}

export function captureViewPopover(
  mount: HTMLElement,
): { scrollTop: number } | null {
  const menu = mount.querySelector<HTMLElement>(
    "details.header-view-menu[open]",
  );
  const content = menu?.querySelector<HTMLElement>(".zai-compact-menu-content");
  return content ? { scrollTop: content.scrollTop } : null;
}

export function restoreViewPopover(
  mount: HTMLElement,
  snapshot: { scrollTop: number } | null,
): void {
  if (!snapshot) {
    syncViewDragGuard(mount.ownerDocument);
    return;
  }
  const menu = mount.querySelector<HTMLElement>("details.header-view-menu");
  if (!menu) return;
  menu.setAttribute("open", "");
  positionViewPopover(menu);
  const content = menu.querySelector<HTMLElement>(".zai-compact-menu-content");
  if (content) content.scrollTop = snapshot.scrollTop;
}
