import type { FullTranslationReadingSettings } from "../settings/local-ui-settings";
import { splitSentences } from "../translate/sentence-splitter";

interface DomPoint {
  node: Text;
  offset: number;
}

interface ReadingBoundary {
  offset: number;
  placement: "before" | "after";
  sentenceIndex: number;
  lineBreak: boolean;
  marker: string;
}

interface LogicalText {
  text: string;
  beforePoints: Array<DomPoint | null>;
  afterPoints: Array<DomPoint | null>;
}

const PROSE_CONTAINERS = "p, li, blockquote, th, td";
const SENTENCE_END = /[.?!。？！]/;
const SEMICOLON = /[;；]/;
const SENTENCE_CLOSERS = new Set([
  '"',
  "'",
  "”",
  "’",
  ")",
  "]",
  "}",
  "»",
  "」",
  "』",
  "）",
  "】",
  "》",
  "〉",
  "〕",
  "〗",
  "〙",
  "〛",
  "〞",
  "〟",
  "］",
  "｝",
  "｣",
]);
// These abbreviations introduce the following name/reference rather than
// completing the preceding clause, even when that following token is capitalized.
const NON_TERMINAL_PREFIX_ABBREVIATIONS = new Set([
  "capt.",
  "dr.",
  "fig.",
  "hon.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "rev.",
  "revd.",
  "st.",
  "vol.",
]);

export function decorateSentenceBoundaries(
  root: HTMLElement,
  settings: FullTranslationReadingSettings,
): void {
  if (
    (settings.markerStyle === "off" ||
      (settings.markerStyle === "custom" && !settings.customMarker)) &&
    settings.lineBreakMode === "continuous"
  ) {
    return;
  }

  const nested = Array.from(
    root.querySelectorAll(PROSE_CONTAINERS),
  ) as HTMLElement[];
  const containers = nested.length ? nested : [root];
  const containerSet = new Set(containers);
  for (const container of containers) {
    decorateProseContainer(container, containerSet, settings);
  }
}

function decorateProseContainer(
  container: HTMLElement,
  containers: Set<HTMLElement>,
  settings: FullTranslationReadingSettings,
): void {
  const logical = logicalText(container, containers);
  const doc = container.ownerDocument;
  if (!doc) return;
  const boundaries = readingBoundaries(logical.text, settings);
  const insertions = boundaries
    .map((boundary) => ({
      boundary,
      point:
        (boundary.placement === "before"
          ? logical.beforePoints[boundary.offset]
          : logical.afterPoints[boundary.offset]) ?? null,
    }))
    .filter(
      (item): item is { boundary: ReadingBoundary; point: DomPoint } =>
        item.point != null,
    )
    .sort((left, right) => right.boundary.offset - left.boundary.offset);

  for (const { boundary, point } of insertions) {
    const parent = point.node.parentNode;
    if (!parent) continue;
    const tail = point.node.splitText(point.offset);
    const marker = doc.createElement("span");
    marker.className = "zai-ft-sentence-boundary";
    marker.dataset.marker = boundary.marker;
    marker.setAttribute("aria-hidden", "true");
    if (boundary.lineBreak) marker.classList.add("is-line-break");
    if (boundary.placement === "before" && boundary.marker) {
      marker.classList.add("is-prefix-marker");
    }
    if (settings.markerColorMode === "palette") {
      marker.classList.add(`tone-${(boundary.sentenceIndex - 1) % 6}`);
    } else {
      marker.style.setProperty("--zai-ft-marker-color", settings.markerColor);
    }
    parent.insertBefore(marker, tail);
  }
}

function logicalText(
  root: HTMLElement,
  containers: Set<HTMLElement>,
): LogicalText {
  const chars: string[] = [];
  const beforePoints: Array<DomPoint | null> = [];
  const afterPoints: Array<DomPoint | null> = [];
  const appendSpace = () => {
    if (chars.length && !/\s/.test(chars[chars.length - 1]!)) {
      chars.push(" ");
      beforePoints.push(null);
      afterPoints.push(null);
    }
  };

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node as Text;
      for (let index = 0; index < text.data.length; index++) {
        chars.push(text.data[index]!);
        beforePoints.push({ node: text, offset: index });
        afterPoints.push({ node: text, offset: index + 1 });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (element !== root && containers.has(element)) return;
    if (isAtomicElement(element)) {
      appendSpace();
      return;
    }
    if (element.tagName === "BR") {
      appendSpace();
      return;
    }
    for (const child of Array.from(element.childNodes)) {
      if (child) walk(child);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    if (child) walk(child);
  }
  return { text: chars.join(""), beforePoints, afterPoints };
}

function isAtomicElement(element: HTMLElement): boolean {
  return (
    element.tagName === "CODE" ||
    element.tagName === "PRE" ||
    element.tagName === "BUTTON" ||
    element.classList.contains("math-inline") ||
    element.classList.contains("math-display") ||
    element.classList.contains("katex") ||
    element.classList.contains("zai-ft-sentence-boundary")
  );
}

function readingBoundaries(
  text: string,
  settings: FullTranslationReadingSettings,
): ReadingBoundary[] {
  const sentenceOffsets = new Set<number>();
  const segmentationText = maskSentenceClosers(text);
  for (const sentence of splitSentences(segmentationText)) {
    let offset = sentence.end - 1;
    if (offset >= 0 && SENTENCE_END.test(text[offset]!)) {
      while (
        offset + 1 < text.length &&
        (SENTENCE_END.test(text[offset + 1]!) ||
          SENTENCE_CLOSERS.has(text[offset + 1]!))
      ) {
        offset += 1;
      }
      sentenceOffsets.add(offset);
    }
  }
  addContextualAbbreviationBoundaries(text, sentenceOffsets);

  const sentenceEnds = Array.from(sentenceOffsets).sort(
    (left, right) => left - right,
  );
  const sentenceSpans: Array<{ start: number; end: number; index: number }> =
    [];
  let sentenceStart = 0;
  sentenceEnds.forEach((end, index) => {
    while (sentenceStart <= end && /\s/.test(text[sentenceStart] ?? "")) {
      sentenceStart += 1;
    }
    if (sentenceStart <= end) {
      sentenceSpans.push({ start: sentenceStart, end, index: index + 1 });
    }
    sentenceStart = end + 1;
  });

  const markerAtStart = usesSentencePrefix(settings.markerStyle);
  const boundaries: ReadingBoundary[] = [];
  for (const sentence of sentenceSpans) {
    const marker = sentenceMarker(settings, sentence.index);
    if (markerAtStart && marker) {
      boundaries.push({
        offset: sentence.start,
        placement: "before",
        sentenceIndex: sentence.index,
        lineBreak: false,
        marker,
      });
    }
    const lineBreak = settings.lineBreakMode !== "continuous";
    if (!markerAtStart || lineBreak) {
      boundaries.push({
        offset: sentence.end,
        placement: "after",
        sentenceIndex: sentence.index,
        lineBreak,
        marker: markerAtStart ? "" : marker,
      });
    }
  }

  if (settings.lineBreakMode === "sentence-semicolon") {
    for (let offset = 0; offset < text.length; offset++) {
      if (SEMICOLON.test(text[offset]!)) {
        const sentenceIndex =
          sentenceSpans.find((sentence) => sentence.end >= offset)?.index ??
          Math.max(1, sentenceSpans.length);
        boundaries.push({
          offset,
          placement: "after",
          sentenceIndex,
          lineBreak: true,
          marker: "",
        });
      }
    }
  }
  return boundaries.sort((left, right) => left.offset - right.offset);
}

function usesSentencePrefix(
  style: FullTranslationReadingSettings["markerStyle"],
): boolean {
  return style === "circled" || style === "decimal" || style === "dot";
}

function addContextualAbbreviationBoundaries(
  text: string,
  sentenceOffsets: Set<number>,
): void {
  for (let periodOffset = 0; periodOffset < text.length; periodOffset++) {
    if (text[periodOffset] !== ".") continue;

    let boundaryOffset = periodOffset;
    while (
      boundaryOffset + 1 < text.length &&
      SENTENCE_CLOSERS.has(text[boundaryOffset + 1]!)
    ) {
      boundaryOffset += 1;
    }
    if (sentenceOffsets.has(boundaryOffset)) continue;

    let nextOffset = boundaryOffset + 1;
    while (/\s/.test(text[nextOffset] ?? "")) nextOffset += 1;
    if (!/[A-Z\u3400-\u9fff]/.test(text[nextOffset] ?? "")) continue;

    let tokenStart = periodOffset;
    while (tokenStart > 0 && /[A-Za-z.]/.test(text[tokenStart - 1]!)) {
      tokenStart -= 1;
    }
    const abbreviation = text.slice(tokenStart, periodOffset + 1).toLowerCase();
    if (NON_TERMINAL_PREFIX_ABBREVIATIONS.has(abbreviation)) continue;

    // The shared splitter deliberately suppresses abbreviation periods. A
    // capitalized/CJK token after one is contextual evidence of a new sentence.
    sentenceOffsets.add(boundaryOffset);
  }
}

function maskSentenceClosers(text: string): string {
  let followsSentenceEnd = false;
  return Array.from(text, (character) => {
    if (SENTENCE_END.test(character)) {
      followsSentenceEnd = true;
      return character;
    }
    if (followsSentenceEnd && SENTENCE_CLOSERS.has(character)) return " ";
    followsSentenceEnd = false;
    return character;
  }).join("");
}

function sentenceMarker(
  settings: FullTranslationReadingSettings,
  index: number,
): string {
  switch (settings.markerStyle) {
    case "slashes":
      return "//";
    case "circled":
      return index <= 20 ? String.fromCodePoint(0x245f + index) : `[${index}]`;
    case "decimal":
      return `[${index}]`;
    case "dot":
      return "•";
    case "custom":
      return settings.customMarker;
    case "off":
      return "";
  }
}
