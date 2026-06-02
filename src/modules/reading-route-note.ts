// reading-route-note: build the reading-route note HTML (with PDF reference
// jump links) and save it into the item dedicated note. Pure move from sidebar.ts.

import { createPdfLocator } from "../context/pdf-locator";
import type { PdfSelectionLocator } from "../providers/types";
import { debugZai, errorMessage, htmlStringDebugInfo, textDebugInfo } from "./debug-utils";
import { renderMarkdownInto } from "./markdown-render";
import {
  READING_ROUTE_MANUAL_HEADING,
  READING_ROUTE_NOTE_TITLE,
  dedicatedNoteMarker,
  noteTitle,
  resolveReadingRouteNote,
} from "./note-dedicated";
import {
  NOTE_PDF_LOCATION_HASH_MARKER,
  NOTE_PDF_REFERENCE_HASH_MARKER,
  pdfSelectionForNoteData,
} from "./note-pdf-link";
import { PDF_QUOTE_MAX_PER_RENDER, PDF_QUOTE_MIN_CHARS } from "./sidebar-state";
import { formatNoteTimestamp, installPdfQuoteButtonsInElement, locatePdfQuoteBlock, pdfOpenUrlForSelection } from "./note-pdf-render";
import { firstPdfQuoteLocateCandidate, pdfQuoteBlockLocateText, pdfQuoteBlocks, pdfQuoteLinkKey } from "./pdf-quote-utils";
import { getReaderForAttachmentOrItem } from "./reader-access";
import { highlightReadingRouteKeyBullets, locateReadingRouteReference, readingRouteReferenceKey, readingRouteReferenceLabels, readingRouteReferenceParts, uniqueStrings } from "./reading-route-reference";
import { readingRouteElementDebugInfo, readingRouteErrorDebugInfo, readingRouteNodesDebugInfo, readingRouteStringDiagnostics } from "./reading-route-debug";

export async function saveReadingRouteToDedicatedNote(
  doc: Document,
  itemID: number | null,
  markdown: string,
): Promise<{ note: Zotero.Item; created: boolean }> {
  const startedAt = Date.now();
  let stage = "resolve-note";
  debugZai("reading-route.save:start", {
    itemID,
    markdown: textDebugInfo(markdown),
    markdownChars: readingRouteStringDiagnostics(markdown),
  });
  try {
    const target = await resolveReadingRouteNote(itemID);
    debugZai("reading-route.save:note", {
      itemID,
      noteID: target.note.id,
      created: target.created,
      noteTitle: noteTitle(target.note),
    });

    stage = "read-existing-note";
    const existing = target.note.getNote?.() || "";
    debugZai("reading-route.save:existing", {
      noteID: target.note.id,
      existing: htmlStringDebugInfo(existing),
      existingChars: readingRouteStringDiagnostics(existing),
    });

    stage = "pdf-reference-links";
    const jumpLinks = await readingRoutePdfJumpLinks(doc, itemID, markdown);
    debugZai("reading-route.save:reference-links", {
      count: jumpLinks.size,
      keys: Array.from(jumpLinks.keys()).slice(0, 12),
    });

    stage = "pdf-quote-links";
    const quoteLinks = await readingRoutePdfQuoteJumpLinks(
      doc,
      itemID,
      markdown,
    );
    debugZai("reading-route.save:quote-links", {
      count: quoteLinks.size,
      keys: Array.from(quoteLinks.keys()).slice(0, 8),
    });

    stage = "build-note-html";
    const html = readingRouteNoteHTML(
      doc,
      itemID,
      markdown,
      existing,
      jumpLinks,
      quoteLinks,
    );
    debugZai("reading-route.save:html-built", {
      noteID: target.note.id,
      html: htmlStringDebugInfo(html),
      htmlChars: readingRouteStringDiagnostics(html),
    });

    stage = "set-note";
    try {
      target.note.setNote(html);
    } catch (err) {
      debugZai("reading-route.save:set-note-failed", {
        noteID: target.note.id,
        error: readingRouteErrorDebugInfo(err),
        html: htmlStringDebugInfo(html),
        htmlChars: readingRouteStringDiagnostics(html),
      });
      throw err;
    }

    stage = "save-note";
    try {
      await target.note.saveTx();
    } catch (err) {
      debugZai("reading-route.save:save-tx-failed", {
        noteID: target.note.id,
        error: readingRouteErrorDebugInfo(err),
        noteAfterSet: htmlStringDebugInfo(target.note.getNote?.() || ""),
      });
      throw err;
    }

    debugZai("reading-route.save:done", {
      noteID: target.note.id,
      ms: Date.now() - startedAt,
    });
    return target;
  } catch (err) {
    debugZai("reading-route.save:failed", {
      itemID,
      stage,
      ms: Date.now() - startedAt,
      error: readingRouteErrorDebugInfo(err),
    });
    throw err;
  }
}

export function readingRouteNoteHTML(
  doc: Document,
  itemID: number | null,
  markdown: string,
  existing: string,
  jumpLinks: Map<string, PdfSelectionLocator> = new Map(),
  quoteLinks: Map<string, PdfSelectionLocator> = new Map(),
): string {
  let stage = "init";
  debugZai("reading-route.html:start", {
    itemID,
    markdown: textDebugInfo(markdown),
    existing: htmlStringDebugInfo(existing),
  });
  const root = doc.createElement("div");
  try {
    stage = "title";
    const title = doc.createElement("h1");
    title.append(dedicatedNoteMarker(doc, "readingRoute"));
    title.append(doc.createTextNode(READING_ROUTE_NOTE_TITLE));
    root.append(title);

    stage = "metadata";
    const meta = doc.createElement("p");
    const small = doc.createElement("small");
    small.textContent =
      `生成时间：${formatNoteTimestamp(new Date())}` +
      " · 来源：Zotero AI Sidebar · 方法：Keshav three-pass approach";
    meta.append(small);
    root.append(meta);

    stage = "render-markdown";
    const body = doc.createElement("div");
    renderMarkdownInto(body, markdown.trim(), "source");
    debugZai("reading-route.html:markdown-rendered", {
      body: readingRouteElementDebugInfo(body),
    });

    stage = "link-references";
    linkReadingRoutePdfReferences(body, jumpLinks, itemID);
    debugZai("reading-route.html:references-linked", {
      body: readingRouteElementDebugInfo(body),
    });

    stage = "link-quotes";
    installPdfQuoteButtonsInElement(body, { sourceItemID: itemID, quoteLinks });
    debugZai("reading-route.html:quotes-linked", {
      body: readingRouteElementDebugInfo(body),
    });

    stage = "highlight-bullets";
    highlightReadingRouteKeyBullets(body);
    debugZai("reading-route.html:bullets-highlighted", {
      body: readingRouteElementDebugInfo(body),
    });

    stage = "append-body";
    while (body.firstChild) root.appendChild(body.firstChild);

    stage = "extract-manual";
    root.append(doc.createElement("hr"));
    const manualNodes = extractReadingRouteManualNodes(doc, existing);
    debugZai("reading-route.html:manual-extracted", {
      hasManual: manualNodes.length > 0,
      manual: readingRouteNodesDebugInfo(manualNodes),
    });
    if (manualNodes.length) {
      stage = "append-existing-manual";
      for (const node of manualNodes) root.appendChild(node);
    } else {
      stage = "append-empty-manual";
      const manualTitle = doc.createElement("h2");
      manualTitle.textContent = READING_ROUTE_MANUAL_HEADING;
      manualTitle.setAttribute("data-zai-reading-route-manual", "true");
      root.append(manualTitle, doc.createElement("p"));
    }

    stage = "serialize";
    const html = String(root.innerHTML);
    debugZai("reading-route.html:done", {
      html: htmlStringDebugInfo(html),
      htmlChars: readingRouteStringDiagnostics(html),
    });
    return html;
  } catch (err) {
    debugZai("reading-route.html:failed", {
      stage,
      error: readingRouteErrorDebugInfo(err),
      root: readingRouteElementDebugInfo(root),
    });
    throw err;
  }
}

export async function readingRoutePdfJumpLinks(
  doc: Document,
  itemID: number | null,
  markdown: string,
): Promise<Map<string, PdfSelectionLocator>> {
  const labels = readingRouteReferenceLabels(markdown);
  const links = new Map<string, PdfSelectionLocator>();
  if (!labels.length || itemID == null) return links;

  const reader = getReaderForAttachmentOrItem(doc.defaultView, itemID, null);
  if (!reader) return links;

  let locator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    locator = await createPdfLocator(reader);
    for (const label of labels.slice(0, 48)) {
      const result = await locateReadingRouteReference(locator, label);
      if (!result) continue;
      links.set(readingRouteReferenceKey(label), {
        attachmentID: locator.attachmentID,
        selectedText: result.matchedText || label,
        pageIndex: result.pageIndex,
        pageLabel: result.pageLabel,
        position: {
          pageIndex: result.pageIndex,
          rects: result.rects,
          ...(result.anchorOffset != null
            ? { zaiAnchorOffset: result.anchorOffset }
            : {}),
          ...(result.headOffset != null
            ? { zaiHeadOffset: result.headOffset }
            : {}),
        },
      });
    }
  } catch (err) {
    debugZai("reading-route.pdf-links.failed", { error: errorMessage(err) });
  } finally {
    locator?.dispose();
  }
  return links;
}

export async function readingRoutePdfQuoteJumpLinks(
  doc: Document,
  itemID: number | null,
  markdown: string,
): Promise<Map<string, PdfSelectionLocator>> {
  const links = new Map<string, PdfSelectionLocator>();
  if (itemID == null) return links;

  const body = doc.createElement("div");
  renderMarkdownInto(body, markdown.trim(), "source");
  const quotes = uniqueStrings(
    pdfQuoteBlocks(body, PDF_QUOTE_MIN_CHARS)
      .slice(0, PDF_QUOTE_MAX_PER_RENDER)
      .map((block) =>
        firstPdfQuoteLocateCandidate(
          pdfQuoteBlockLocateText(block),
          PDF_QUOTE_MIN_CHARS,
        ),
      )
      .filter(Boolean),
  );
  debugZai("reading-route.quote-links:quotes", {
    itemID,
    count: quotes.length,
    sample: quotes.slice(0, 6).map((quote) => ({
      quote: textDebugInfo(quote, 120),
      chars: readingRouteStringDiagnostics(quote),
    })),
  });
  if (!quotes.length) return links;

  const reader = getReaderForAttachmentOrItem(doc.defaultView, itemID, null);
  if (!reader) return links;

  let locator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    locator = await createPdfLocator(reader);
    for (const quote of quotes) {
      debugZai("reading-route.quote-links:locate", {
        quote: textDebugInfo(quote, 120),
        chars: readingRouteStringDiagnostics(quote),
      });
      const result = await locatePdfQuoteBlock(locator, quote);
      if (!result) continue;
      links.set(pdfQuoteLinkKey(quote), result);
    }
  } catch (err) {
    debugZai("reading-route.pdf-quote-links.failed", {
      error: errorMessage(err),
    });
  } finally {
    locator?.dispose();
  }
  return links;
}

export function noteTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const collect = (node: Node) => {
    if (node.nodeType === 3) {
      nodes.push(node as Text);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.closest("a")) return;
    for (const child of Array.from(node.childNodes)) {
      if (child) collect(child);
    }
  };
  collect(root);
  return nodes;
}

export function linkReadingRoutePdfReferences(
  root: HTMLElement,
  jumpLinks: Map<string, PdfSelectionLocator>,
  itemID: number | null = null,
) {
  const doc = root.ownerDocument!;
  const textNodes = noteTextNodes(root);
  const pattern =
    /\b(?:Fig(?:ure)?\.?|Table)\s*\d+[A-Za-z]?\b|\b(?:Eq(?:uation)?\.?|Equation)\s*\(?\d+[A-Za-z]?\)?(?:\s*[-–—]\s*\(?\d+[A-Za-z]?\)?)?/gi;
  for (const node of textNodes) {
    const text = node.textContent || "";
    pattern.lastIndex = 0;
    let lastIndex = 0;
    let changed = false;
    const fragment = doc.createDocumentFragment();
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const raw = match[0];
      const locator = jumpLinks.get(readingRouteReferenceKey(raw));
      if (start > lastIndex) {
        fragment.append(doc.createTextNode(text.slice(lastIndex, start)));
      }
      fragment.append(
        locator
          ? readingRoutePdfReferenceLink(doc, raw, locator)
          : readingRoutePdfReferenceFallbackLink(doc, raw, itemID),
      );
      lastIndex = start + raw.length;
      changed = true;
    }
    if (!changed) continue;
    if (lastIndex < text.length) {
      fragment.append(doc.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode?.replaceChild(fragment, node);
  }
}

export function readingRoutePdfReferenceFallbackLink(
  doc: Document,
  label: string,
  itemID: number | null,
): HTMLAnchorElement {
  const link = doc.createElement("a");
  const kind = readingRouteReferenceParts(label)?.kind;
  link.className = "zai-note-pdf-selection-link";
  link.href = `${NOTE_PDF_REFERENCE_HASH_MARKER}${encodeURIComponent(label)}`;
  link.textContent = label;
  link.title = "点击后临时定位 PDF 图表/公式位置";
  link.setAttribute("data-zai-pdf-reference-label", label);
  if (kind) link.setAttribute("data-zai-pdf-reference-kind", kind);
  if (itemID != null) {
    link.setAttribute("data-zai-pdf-source-item-id", String(itemID));
  }
  return link;
}

export function readingRoutePdfReferenceLink(
  doc: Document,
  label: string,
  locator: PdfSelectionLocator,
): HTMLAnchorElement {
  const link = doc.createElement("a");
  const href = pdfOpenUrlForSelection(locator);
  const data = JSON.stringify(pdfSelectionForNoteData(locator));
  link.className = "zai-note-pdf-selection-link";
  link.href = `${href || "#"}${NOTE_PDF_LOCATION_HASH_MARKER}${encodeURIComponent(
    data,
  )}`;
  link.textContent = label;
  link.title = `跳转到 PDF 第 ${locator.pageLabel ?? String((locator.pageIndex ?? 0) + 1)} 页`;
  link.setAttribute("data-zai-pdf-location", data);
  link.setAttribute("data-zai-pdf-location-only", "true");
  const kind = readingRouteReferenceParts(label)?.kind;
  if (kind) link.setAttribute("data-zai-pdf-reference-kind", kind);
  return link;
}

export function extractReadingRouteManualNodes(
  doc: Document,
  existing: string,
): Node[] {
  if (!existing.trim()) return [];
  const htmlDoc = doc.implementation.createHTMLDocument(
    "zai-reading-route-existing",
  );
  const body = htmlDoc.body;
  if (!body) return [];
  body.innerHTML = existing;
  const heading = (
    Array.from(body.querySelectorAll("h1,h2,h3,h4,h5,h6")) as HTMLElement[]
  ).find((node) => node.textContent?.trim() === READING_ROUTE_MANUAL_HEADING);
  if (!heading) return [];

  const nodes: Node[] = [];
  for (let node: any = heading; node; node = node.nextSibling) {
    nodes.push(doc.importNode(node, true));
  }
  return nodes;
}
