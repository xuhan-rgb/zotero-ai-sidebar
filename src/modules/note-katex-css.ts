// KaTeX CSS injection for Zotero note editors (rendered math in saved notes).
// Pure DOM style injection; no shared sidebar state.

import { debugZai } from "./debug-utils";
import type { ZoteroNoteEditorElement } from "./note-editor-restore";
import { NOTE_PDF_QUOTE_HASH_MARKER } from "./note-pdf-link";

export function ensureAllZoteroNoteEditorKatexCSS(doc: Document): void {
  const editors = Array.from(
    doc.querySelectorAll("note-editor"),
  ) as ZoteroNoteEditorElement[];
  let injected = 0;
  for (const editor of editors) {
    if (ensureZoteroNoteEditorKatexCSS(editor)) injected++;
  }
  debugZai("note-editor-katex-css:scan", {
    editors: editors.length,
    injected,
  });
}

export function ensureZoteroNoteEditorKatexCSS(
  editor: ZoteroNoteEditorElement,
): boolean {
  const iframeDoc = editor.getCurrentInstance?.()?._iframeWindow?.document;
  if (!iframeDoc) return false;
  ensureKatexCSSInDocument(iframeDoc);
  return true;
}

export function ensureKatexCSSInDocument(doc: Document): void {
  const root = doc.head ?? doc.documentElement;
  if (!root) return;

  if (!doc.getElementById("zai-katex-css-link")) {
    const link = doc.createElement("link");
    link.id = "zai-katex-css-link";
    link.rel = "stylesheet";
    link.href = `chrome://${addon.data.config.addonRef}/content/katex/katex.min.css`;
    root.append(link);
  }

  if (!doc.getElementById("zai-katex-css-fallback")) {
    const style = doc.createElement("style");
    style.id = "zai-katex-css-fallback";
    style.textContent = `
.katex .katex-mathml {
  position: absolute;
  clip: rect(1px, 1px, 1px, 1px);
  padding: 0;
  border: 0;
  height: 1px;
  width: 1px;
  overflow: hidden;
}
.katex-display {
  display: block;
  margin: 1em 0;
  text-align: center;
}
.katex-display > .katex {
  display: block;
  text-align: center;
  white-space: nowrap;
}
.zai-note-pdf-jump {
  margin: 0.35em 0 0.8em;
}
.zai-note-pdf-selection-link {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid #c7dfe8;
  border-radius: 999px;
  color: #2d6f8f;
  font-size: 0.9em;
  font-weight: 700;
  text-decoration: none;
}
.zai-note-pdf-selection-link:hover {
  border-color: #2d6f8f;
  text-decoration: none;
}
/* The note editor (ProseMirror) keeps only an <a>'s href across a save —
   class and data-* attributes are stripped. Match the surviving #zaiQuote=
   href so the quote link stays low-key grey, not the editor's blue default. */
.zai-pdf-quote-jump,
a[href*="${NOTE_PDF_QUOTE_HASH_MARKER}"] {
  margin-inline-start: 4px;
  color: #b3b3b3 !important;
  font-size: 0.72em;
  font-weight: normal;
  text-decoration: none !important;
  cursor: pointer;
}
.zai-pdf-quote-jump:hover,
a[href*="${NOTE_PDF_QUOTE_HASH_MARKER}"]:hover {
  color: #7a7a7a !important;
  text-decoration: none !important;
}
.zai-pdf-quote-active {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
}
.zai-reading-route-key {
  margin: 0 2px;
  padding: 1px 4px;
  border-radius: 4px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.zai-reading-route-key[data-zai-reading-route-tone="blue"] {
  background: rgba(46, 168, 229, 0.28) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="yellow"] {
  background: rgba(255, 212, 0, 0.36) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="red"] {
  background: rgba(255, 102, 102, 0.28) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="green"] {
  background: rgba(95, 178, 54, 0.28) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="purple"] {
  background: rgba(162, 138, 229, 0.28) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="orange"] {
  background: rgba(241, 152, 55, 0.32) !important;
}
`;
    root.append(style);
  }
}
