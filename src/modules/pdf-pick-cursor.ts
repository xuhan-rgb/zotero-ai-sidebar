// While material picking is armed the reader's pages are click targets, not
// prose: the pointer over a page becomes a crosshair instead of the text
// I-beam the PDF text layer sets, and the text layer stops accepting a
// selection. Swallowing pointerdown alone was not enough — the reader's own
// selection handling still dragged out a highlight over the page — so the
// lock is declared in CSS where no listener order can bypass it.
// One style element per reader document; arming twice must not stack copies,
// and disarming always clears it.

const STYLE_ID = "zai-material-pick-cursor";
const CSS =
  ".page, .page * { cursor: crosshair !important; user-select: none !important; -webkit-user-select: none !important; }";

export function setMaterialPickCursor(doc: Document, on: boolean): void {
  const existing = doc.getElementById(STYLE_ID);
  if (on) {
    if (existing) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    const target = doc.head || doc.documentElement;
    if (target) target.appendChild(style);
  } else {
    if (existing) existing.remove();
  }
}
