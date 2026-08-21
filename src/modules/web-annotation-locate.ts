const MIN_FRAGMENT_CHARS = 20;

interface WebAnnotationLocateResult {
  matchedText: string;
  confidence: number;
}

interface WebAnnotationLocator<Result extends WebAnnotationLocateResult> {
  locate(
    needle: string,
    options?: { minConfidence?: number; exactOnly?: boolean },
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
  for (const candidate of candidates) {
    const exact = await locator.locate(candidate, { exactOnly: true });
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const fuzzy = await locator.locate(candidate, { minConfidence });
    if (fuzzy) return fuzzy;
  }
  return null;
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
      ...clauses.slice(0, -1).map((clause, index) => clause + clauses[index + 1]),
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
