import type { PdfSelectionLocator } from "../providers/types";
import { clonePlainRecord, finiteNumber } from "./plain-utils";

export const NOTE_PDF_SELECTION_HASH_MARKER = "#zaiSelection=";
export const NOTE_PDF_LOCATION_HASH_MARKER = "#zaiLocation=";
export const NOTE_PDF_QUOTE_HASH_MARKER = "#zaiQuote=";
export const NOTE_PDF_REFERENCE_HASH_MARKER = "#zaiReference=";

export interface PdfQuoteNoteLinkData {
  quote: string;
  sourceItemID?: number;
  preferredAttachmentID?: number;
  preferredPageIndex?: number;
}

export function pdfSelectionFromNoteLink(
  link: HTMLAnchorElement,
): PdfSelectionLocator | null {
  const raw =
    link.getAttribute("data-zai-pdf-selection") ||
    pdfSelectionJSONFromNoteHref(link.href);
  return pdfSelectionLocatorFromRawJSON(raw);
}

export function pdfLocationFromNoteLink(
  link: HTMLAnchorElement,
): PdfSelectionLocator | null {
  const raw =
    link.getAttribute("data-zai-pdf-location") ||
    link.getAttribute("data-zai-pdf-selection") ||
    pdfLocationJSONFromNoteHref(link.href) ||
    pdfSelectionJSONFromNoteHref(link.href);
  return pdfSelectionLocatorFromRawJSON(raw);
}

export function pdfQuoteFromNoteLink(link: HTMLAnchorElement): string {
  return (pdfQuoteDataFromNoteLink(link)?.quote || "").trim();
}

export function pdfQuoteDataFromNoteLink(
  link: HTMLAnchorElement,
): PdfQuoteNoteLinkData | null {
  return (
    pdfQuoteDataFromRaw(pdfQuoteFromNoteHrefRaw(link.href)) ||
    pdfQuoteDataFromRaw(link.getAttribute("data-zai-pdf-quote"))
  );
}

export function pdfSelectionFromNoteHref(
  href: string,
): PdfSelectionLocator | null {
  return pdfSelectionLocatorFromRawJSON(pdfSelectionJSONFromNoteHref(href));
}

export function pdfLocationFromNoteHref(
  href: string,
): PdfSelectionLocator | null {
  return pdfSelectionLocatorFromRawJSON(pdfLocationJSONFromNoteHref(href));
}

function pdfSelectionLocatorFromRawJSON(
  raw: string | null | undefined,
): PdfSelectionLocator | null {
  if (!raw) return null;
  try {
    return normalizePdfSelectionLocatorForNote(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function pdfSelectionJSONFromNoteHref(href: string): string {
  return pdfDataJSONFromNoteHref(href, NOTE_PDF_SELECTION_HASH_MARKER);
}

export function pdfLocationJSONFromNoteHref(href: string): string {
  return pdfDataJSONFromNoteHref(href, NOTE_PDF_LOCATION_HASH_MARKER);
}

export function pdfQuoteFromNoteHref(href: string): string {
  return pdfQuoteDataFromNoteHref(href)?.quote ?? "";
}

export function pdfQuoteDataFromNoteHref(
  href: string,
): PdfQuoteNoteLinkData | null {
  return pdfQuoteDataFromRaw(pdfQuoteFromNoteHrefRaw(href));
}

function pdfQuoteFromNoteHrefRaw(href: string): string {
  return pdfDataJSONFromNoteHref(href, NOTE_PDF_QUOTE_HASH_MARKER);
}

function pdfDataJSONFromNoteHref(href: string, marker: string): string {
  const index = href.indexOf(marker);
  if (index < 0) return "";
  const encoded = href.slice(index + marker.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return "";
  }
}

function pdfQuoteDataFromRaw(raw: string | null): PdfQuoteNoteLinkData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const data = parsed as Record<string, unknown>;
      const quote = typeof data.quote === "string" ? data.quote : "";
      if (!quote) return { quote: raw };
      const sourceItemID = finiteNumber(data.sourceItemID);
      const preferredAttachmentID = finiteNumber(data.preferredAttachmentID);
      const preferredPageIndex = finiteNumber(data.preferredPageIndex);
      return {
        quote,
        ...(sourceItemID != null ? { sourceItemID } : {}),
        ...(preferredAttachmentID != null ? { preferredAttachmentID } : {}),
        ...(preferredPageIndex != null ? { preferredPageIndex } : {}),
      };
    }
  } catch {
    // Plain quotes continue to use the legacy string payload.
  }
  return { quote: raw };
}

export function noteHrefWithoutPdfData(href: string): string {
  const selectionIndex = href.indexOf(NOTE_PDF_SELECTION_HASH_MARKER);
  const locationIndex = href.indexOf(NOTE_PDF_LOCATION_HASH_MARKER);
  const quoteIndex = href.indexOf(NOTE_PDF_QUOTE_HASH_MARKER);
  const indexes = [selectionIndex, locationIndex, quoteIndex].filter(
    (index) => index >= 0,
  );
  if (!indexes.length) return href;
  return href.slice(0, Math.min(...indexes));
}

function normalizePdfSelectionLocatorForNote(
  value: unknown,
): PdfSelectionLocator | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const locator = value as Record<string, unknown>;
  const attachmentID = finiteNumber(locator.attachmentID);
  const selectedText =
    typeof locator.selectedText === "string" ? locator.selectedText : "";
  const position =
    locator.position && typeof locator.position === "object"
      ? clonePlainRecord(locator.position)
      : null;
  if (attachmentID == null || !selectedText || !position) return null;
  const pageIndex = finiteNumber(locator.pageIndex);
  const pageLabel =
    typeof locator.pageLabel === "string" ? locator.pageLabel : undefined;
  return {
    attachmentID,
    selectedText,
    ...(pageIndex != null ? { pageIndex } : {}),
    ...(pageLabel ? { pageLabel } : {}),
    position,
  };
}

export function encodePdfSelectionForNoteLink(
  selection: PdfSelectionLocator,
): string {
  return encodeURIComponent(JSON.stringify(pdfSelectionForNoteData(selection)));
}

export function pdfSelectionForNoteData(
  selection: PdfSelectionLocator,
): PdfSelectionLocator {
  return {
    attachmentID: selection.attachmentID,
    selectedText: selection.selectedText,
    ...(selection.pageIndex != null ? { pageIndex: selection.pageIndex } : {}),
    ...(selection.pageLabel ? { pageLabel: selection.pageLabel } : {}),
    position: clonePlainRecord(selection.position) ?? selection.position,
  };
}
