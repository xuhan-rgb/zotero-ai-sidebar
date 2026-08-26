import { splitSentences } from "../translate/sentence-splitter";

const MIN_FRAGMENT_CHARS = 20;
const MIN_REPAIR_SIMILARITY = 0.9;
const MIN_REPAIR_LENGTH_RATIO = 0.85;
const AUTHOR_YEAR_CITATION =
  /\((?:\s*(?:[\p{L}'’.-]+(?:\s+et\s+al\.)?\s*,?\s*)?(?:19|20)\d{2}[a-z]?\s*)(?:;\s*(?:[\p{L}'’.-]+(?:\s+et\s+al\.)?\s*,?\s*)?(?:19|20)\d{2}[a-z]?\s*)*\)/giu;

interface WebAnnotationLocateResult {
  matchedText: string;
  confidence: number;
}

interface WebAnnotationLocator<Result extends WebAnnotationLocateResult> {
  pageCount?: number;
  getPageContent?(pageIndex: number): Promise<{ pageText?: string } | null>;
  locate(
    needle: string,
    options?: {
      minConfidence?: number;
      exactOnly?: boolean;
      pageIndex?: number;
    },
  ): Promise<Result | null>;
}

export async function locateWebAnnotationQuote<
  Result extends WebAnnotationLocateResult,
>(
  locator: WebAnnotationLocator<Result>,
  quote: string,
  minConfidence: number,
): Promise<Result | null> {
  const candidates = annotationQuoteCandidates(quote);
  const fullQuote = candidates[0];
  if (!fullQuote) return null;

  const exactFull = await locator.locate(fullQuote, { exactOnly: true });
  if (exactFull) return exactFull;
  const withoutTerminalPunctuation = stripTerminalPunctuation(fullQuote);
  if (
    withoutTerminalPunctuation !== fullQuote &&
    compactLength(withoutTerminalPunctuation) >= MIN_FRAGMENT_CHARS
  ) {
    const exactWithoutPunctuation = await locator.locate(
      withoutTerminalPunctuation,
      { exactOnly: true },
    );
    if (exactWithoutPunctuation) return exactWithoutPunctuation;
  }
  const repairedSentence = await locateRepairedReaderSentence(
    locator,
    fullQuote,
    minConfidence,
  );
  if (repairedSentence) return repairedSentence;
  const fuzzyFull = await locator.locate(fullQuote, { minConfidence });
  if (fuzzyFull) return fuzzyFull;

  if (!hasFormulaBoundary(fullQuote)) return null;

  for (const candidate of candidates.slice(1)) {
    const exact = await locator.locate(candidate, { exactOnly: true });
    if (exact) return exact;
  }
  for (const candidate of candidates.slice(1)) {
    const fuzzy = await locator.locate(candidate, { minConfidence });
    if (fuzzy) return fuzzy;
  }
  return null;
}

export async function locateWebAnnotationQuoteSegments<
  Result extends WebAnnotationLocateResult,
>(
  locator: WebAnnotationLocator<Result>,
  quote: string,
  minConfidence: number,
): Promise<Result[] | null> {
  const single = await locateWebAnnotationQuote(locator, quote, minConfidence);
  if (single) return [single];
  const pageCount = locator.pageCount;
  if (
    !Number.isInteger(pageCount) ||
    pageCount == null ||
    pageCount < 2 ||
    !locator.getPageContent
  ) {
    return null;
  }

  const quoteTokens = annotationAlignmentTokens(quote);
  if (!quoteTokens.length) return null;
  for (let pageIndex = 0; pageIndex < pageCount - 1; pageIndex++) {
    const firstPageText =
      (await locator.getPageContent(pageIndex))?.pageText ?? "";
    const secondPageText =
      (await locator.getPageContent(pageIndex + 1))?.pageText ?? "";
    const fragments = exactCrossPageFragments(
      firstPageText,
      secondPageText,
      quoteTokens,
    );
    if (!fragments) continue;
    const [first, second] = fragments;

    const candidateTokens = annotationAlignmentTokens(`${first} ${second}`);
    const lengthRatio =
      Math.min(quoteTokens.length, candidateTokens.length) /
      Math.max(quoteTokens.length, candidateTokens.length, 1);
    const similarity = orderedTokenSimilarity(quoteTokens, candidateTokens);
    if (
      lengthRatio < MIN_REPAIR_LENGTH_RATIO ||
      similarity < Math.max(minConfidence, MIN_REPAIR_SIMILARITY)
    ) {
      continue;
    }

    const firstResult = await locator.locate(first, {
      exactOnly: true,
      pageIndex,
    });
    if (!firstResult) continue;
    const secondResult = await locator.locate(second, {
      exactOnly: true,
      pageIndex: pageIndex + 1,
    });
    if (secondResult) return [firstResult, secondResult];
  }
  return null;
}

interface AlignmentTokenSpan {
  value: string;
  start: number;
  end: number;
}

function exactCrossPageFragments(
  firstPageText: string,
  secondPageText: string,
  quoteTokens: string[],
): [string, string] | null {
  const firstPageTokens = annotationAlignmentTokenSpans(firstPageText);
  const secondPageTokens = annotationAlignmentTokenSpans(secondPageText);
  for (let split = 4; split <= quoteTokens.length - 4; split++) {
    const firstRange = exactAlignmentTokenRange(
      firstPageTokens,
      quoteTokens.slice(0, split),
    );
    if (!firstRange) continue;
    const secondRange = exactAlignmentTokenRange(
      secondPageTokens,
      quoteTokens.slice(split),
    );
    if (!secondRange) continue;
    const first = firstPageText.slice(firstRange.start, firstRange.end).trim();
    const secondEnd = terminalPunctuationEnd(secondPageText, secondRange.end);
    const second = secondPageText
      .slice(secondRange.start, secondEnd)
      .trim();
    if (
      compactLength(first) >= MIN_FRAGMENT_CHARS &&
      compactLength(second) >= MIN_FRAGMENT_CHARS
    ) {
      return [first, second];
    }
  }
  return null;
}

function annotationAlignmentTokenSpans(text: string): AlignmentTokenSpan[] {
  const comparable = text
    .replace(AUTHOR_YEAR_CITATION, (citation) => " ".repeat(citation.length))
    .toLowerCase();
  const pattern =
    /[\p{Script=Latin}\p{Script=Greek}\p{N}]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  const tokens: AlignmentTokenSpan[] = [];
  for (const match of comparable.matchAll(pattern)) {
    const start = match.index;
    tokens.push({
      value: match[0],
      start,
      end: start + match[0].length,
    });
  }
  return tokens;
}

function exactAlignmentTokenRange(
  haystack: AlignmentTokenSpan[],
  needle: string[],
): { start: number; end: number } | null {
  if (!needle.length || haystack.length < needle.length) return null;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    if (
      needle.every(
        (token, index) => haystack[start + index]?.value === token,
      )
    ) {
      return {
        start: haystack[start]!.start,
        end: haystack[start + needle.length - 1]!.end,
      };
    }
  }
  return null;
}

function terminalPunctuationEnd(text: string, start: number): number {
  const punctuation = text
    .slice(start)
    .match(/^[.,;:!?，。；：！？]+/u)?.[0];
  return start + (punctuation?.length ?? 0);
}

async function locateRepairedReaderSentence<
  Result extends WebAnnotationLocateResult,
>(
  locator: WebAnnotationLocator<Result>,
  quote: string,
  minConfidence: number,
): Promise<Result | null> {
  const pageCount = locator.pageCount;
  if (
    !Number.isInteger(pageCount) ||
    pageCount == null ||
    pageCount <= 0 ||
    !locator.getPageContent
  ) {
    return null;
  }

  const quoteTokens = annotationAlignmentTokens(quote);
  if (!quoteTokens.length) return null;
  const quoteSentenceCount = Math.max(1, splitSentences(quote).length);
  let best: { text: string; pageIndex: number; similarity: number } | undefined;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = await locator.getPageContent(pageIndex);
    const pageText = page?.pageText ?? "";
    const sentences = splitSentences(pageText);
    for (let index = 0; index < sentences.length; index++) {
      const last = sentences[index + quoteSentenceCount - 1];
      if (!last) break;
      const sentenceText = pageText
        .slice(sentences[index]!.start, last.end)
        .trim();
      const sentenceTokens = annotationAlignmentTokens(sentenceText);
      const lengthRatio =
        Math.min(quoteTokens.length, sentenceTokens.length) /
        Math.max(quoteTokens.length, sentenceTokens.length, 1);
      if (lengthRatio < MIN_REPAIR_LENGTH_RATIO) continue;
      const similarity = orderedTokenSimilarity(quoteTokens, sentenceTokens);
      if (!best || similarity > best.similarity) {
        best = { text: sentenceText, pageIndex, similarity };
      }
    }
  }
  if (
    !best ||
    best.similarity < Math.max(minConfidence, MIN_REPAIR_SIMILARITY)
  ) {
    return null;
  }
  return locator.locate(best.text, {
    exactOnly: true,
    pageIndex: best.pageIndex,
  });
}

function annotationAlignmentTokens(text: string): string[] {
  return (
    text
      .replace(AUTHOR_YEAR_CITATION, " ")
      .toLowerCase()
      .match(
        /[\p{Script=Latin}\p{Script=Greek}\p{N}]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
      ) ?? []
  );
}

function orderedTokenSimilarity(left: string[], right: string[]): number {
  let previous = new Array<number>(right.length + 1).fill(0);
  for (const leftToken of left) {
    const current = [0];
    for (let index = 0; index < right.length; index++) {
      current[index + 1] =
        leftToken === right[index]
          ? previous[index]! + 1
          : Math.max(current[index]!, previous[index + 1]!);
    }
    previous = current;
  }
  return (2 * previous[right.length]!) / (left.length + right.length);
}

function hasFormulaBoundary(text: string): boolean {
  return /(?:[$]|\\(?:begin|end|frac|sqrt|sum|prod|int)\b|[=≈≃≠≤≥±×÷]|[_^]\{?)/u.test(
    text,
  );
}

export function annotationQuoteCandidates(quote: string): string[] {
  const fullQuote = trimOuterQuoteMarks(quote.trim());
  if (!fullQuote) return [];

  const fragments = splitKeepingPunctuation(
    fullQuote,
    /[^。！？!?；;\n]+(?:[。！？!?；;]|$)/gu,
  ).flatMap((sentence) => {
    const clauses = splitKeepingPunctuation(
      sentence,
      /[^，,：:]+(?:[，,：:]|$)/gu,
    );
    return [
      sentence,
      ...clauses,
      ...clauses
        .slice(0, -1)
        .map((clause, index) => clause + clauses[index + 1]),
    ];
  });
  const unique = new Set<string>();
  for (const fragment of fragments) {
    const candidate = trimOuterQuoteMarks(fragment.trim());
    if (
      candidate !== fullQuote &&
      compactLength(candidate) >= MIN_FRAGMENT_CHARS
    ) {
      unique.add(candidate);
    }
  }
  return [
    fullQuote,
    ...Array.from(unique).sort(
      (left, right) => compactLength(right) - compactLength(left),
    ),
  ];
}

function splitKeepingPunctuation(text: string, pattern: RegExp): string[] {
  return text.match(pattern) ?? [];
}

function compactLength(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

function trimOuterQuoteMarks(text: string): string {
  return text.replace(/^[“”‘’"']+|[“”‘’"']+$/gu, "").trim();
}

function stripTerminalPunctuation(text: string): string {
  return text.replace(/[.,;:!?，。；：！？]+$/u, "").trimEnd();
}
