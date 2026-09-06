import { closestElement as closestNoteElement } from "./dom-utils";

export { closestNoteElement };

// Parsing/identification of PDF-jump links embedded in Zotero notes:
// classify an anchor (selection / location / quote / reference), read its
// label/source-item, and normalize ProseMirror-surviving hrefs. Pure DOM/string
// helpers; depends only on note-pdf-link (hash markers + href codecs).

import {
  NOTE_PDF_LOCATION_HASH_MARKER,
  NOTE_PDF_REFERENCE_HASH_MARKER,
  noteHrefWithoutPdfData,
  pdfLocationJSONFromNoteHref,
  pdfQuoteFromNoteHref,
  pdfSelectionJSONFromNoteHref,
} from "./note-pdf-link";

export function normalizeZoteroNotePdfLocationOnlyLinks(
  doc: Document | null | undefined,
) {
  if (!doc) return;
  const links = Array.from(
    doc.querySelectorAll('a[data-zai-pdf-location-only="true"]'),
  ) as HTMLAnchorElement[];
  for (const link of links) {
    const selection =
      link.getAttribute("data-zai-pdf-location") ||
      link.getAttribute("data-zai-pdf-selection") ||
      pdfLocationJSONFromNoteHref(link.href) ||
      pdfSelectionJSONFromNoteHref(link.href);
    if (selection && !link.getAttribute("data-zai-pdf-location")) {
      link.setAttribute("data-zai-pdf-location", selection);
    }
    if (selection && !pdfLocationJSONFromNoteHref(link.href)) {
      const baseHref = noteHrefWithoutPdfData(link.href || "#");
      link.href = `${baseHref || "#"}${NOTE_PDF_LOCATION_HASH_MARKER}${encodeURIComponent(
        selection,
      )}`;
    }
  }
}

export function normalizeZoteroNotePdfQuoteLinks(doc: Document | null | undefined) {
  if (!doc) return;
  const links = Array.from(
    doc.querySelectorAll("a[data-zai-pdf-quote]"),
  ) as HTMLAnchorElement[];
  for (const link of links) {
    link.textContent = "原文";
    link.title = "点击回到 PDF 原文，并选中这句论据";
  }
}

export function notePdfJumpEventTargets(
  iframeWindow: Window,
  doc: Document | null | undefined,
): EventTarget[] {
  const targets: EventTarget[] = [iframeWindow];
  const add = (target: EventTarget | null | undefined) => {
    if (target && !targets.includes(target)) targets.push(target);
  };
  add(doc);
  add(doc?.documentElement);
  add(doc?.body);
  add(doc?.querySelector(".ProseMirror"));
  add(doc?.querySelector("#editor-container"));
  return targets;
}

export function notePdfJumpLinkFromEvent(
  event: Event,
  doc: Document | null | undefined,
): HTMLAnchorElement | null {
  const path =
    typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const entry of path) {
    const link = closestNoteElement(
      entry as Node | null,
      "a",
    ) as HTMLAnchorElement | null;
    if (isNotePdfJumpLink(link)) return link;
  }
  const targetLink = closestNoteElement(
    event.target as Node | null,
    "a",
  ) as HTMLAnchorElement | null;
  if (isNotePdfJumpLink(targetLink)) return targetLink;

  const point = event as MouseEvent;
  if (doc && Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) {
    const element = doc.elementFromPoint(point.clientX, point.clientY);
    const pointLink = closestNoteElement(
      element,
      "a",
    ) as HTMLAnchorElement | null;
    if (isNotePdfJumpLink(pointLink)) return pointLink;
    return notePdfJumpLinkAtPoint(doc, point.clientX, point.clientY);
  }
  return null;
}

export function notePdfJumpLinkAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): HTMLAnchorElement | null {
  const links = Array.from(
    doc.querySelectorAll(
      "a[data-zai-pdf-location], a[data-zai-pdf-selection], a[data-zai-pdf-quote], a[data-zai-pdf-reference-label]",
    ),
  ) as HTMLAnchorElement[];
  for (const link of links) {
    for (const rect of Array.from(link.getClientRects())) {
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return link;
      }
    }
  }
  return null;
}

export function isNotePdfJumpLink(
  link: HTMLAnchorElement | null | undefined,
): link is HTMLAnchorElement {
  return Boolean(
    link &&
    (link.hasAttribute("data-zai-pdf-location") ||
      link.hasAttribute("data-zai-pdf-selection") ||
      link.hasAttribute("data-zai-pdf-quote") ||
      link.hasAttribute("data-zai-pdf-reference-label") ||
      pdfLocationJSONFromNoteHref(link.href) ||
      pdfSelectionJSONFromNoteHref(link.href) ||
      pdfQuoteFromNoteHref(link.href) ||
      pdfReferenceLabelFromNoteHref(link.href)),
  );
}

export function isPdfQuoteJumpLink(link: HTMLAnchorElement): boolean {
  return (
    link.classList.contains("zai-pdf-quote-jump") ||
    link.dataset.zaiPdfQuoteLink === "true"
  );
}

export function isPdfLocationJumpLink(link: HTMLAnchorElement): boolean {
  return Boolean(
    link.dataset.zaiPdfLocationOnly === "true" ||
    link.hasAttribute("data-zai-pdf-location") ||
    pdfLocationJSONFromNoteHref(link.href),
  );
}

export function pdfReferenceLabelFromNoteLink(link: HTMLAnchorElement): string {
  return (
    link.getAttribute("data-zai-pdf-reference-label") ||
    pdfReferenceLabelFromNoteHref(link.href)
  ).trim();
}

export function pdfReferenceLabelFromNoteHref(href: string): string {
  const index = href.indexOf(NOTE_PDF_REFERENCE_HASH_MARKER);
  if (index < 0) return "";
  try {
    return decodeURIComponent(
      href.slice(index + NOTE_PDF_REFERENCE_HASH_MARKER.length),
    ).trim();
  } catch {
    return "";
  }
}

export function sourceItemIDFromNoteLink(link: HTMLAnchorElement): number | null {
  const raw = link.getAttribute("data-zai-pdf-source-item-id");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
