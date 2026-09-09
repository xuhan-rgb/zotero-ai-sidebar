import {
  buildCitationLabels,
  normalizeLatexTextCommands,
} from "../context/tex-clean";

export interface FullTranslationReference {
  number: number;
  text: string;
}

// Use the same .bbl ordering as citation normalization. A .bib alone does not
// establish printed reference numbers.
export function fullDocumentReferences(
  files: Array<{ path: string; text: string }>,
): FullTranslationReference[] {
  const labels = buildCitationLabels(files);
  const entries = new Map<number, { key: string; text: string }>();
  const ambiguous = new Set<number>();
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".bbl")) continue;
    const matches = [
      ...file.text.matchAll(/\\bibitem(?:\[[^\]]*\])?\s*\{([^}]+)\}/g),
    ];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const number = labels.get(match[1]);
      if (!number) continue;
      const previous = entries.get(number);
      if (previous && previous.key !== match[1]) {
        ambiguous.add(number);
        continue;
      }
      const raw = file.text
        .slice(
          match.index! + match[0].length,
          matches[i + 1]?.index ?? file.text.length,
        )
        .replace(/\\end\{thebibliography\}[\s\S]*$/, "")
        .replace(/\\newblock\b/g, " ")
        .replace(/~/g, " ");
      const text = normalizeLatexTextCommands(
        raw
          .replace(/\{\\(['`"^~=.])\s*([A-Za-z])\}/g, (_, accent: string, letter: string) => {
            const marks: Record<string, string> = { "'": "\u0301", "`": "\u0300", '\"': "\u0308", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307" };
            return (letter + marks[accent]).normalize("NFC");
          })
          .replace(/\{\\(?:em|it)\s+([^{}]*)\}/g, "*$1*")
          .replace(/\{\\bf\s+([^{}]*)\}/g, "**$1**")
          .replace(/\{([A-Za-z][A-Za-z0-9 -]*)\}/g, "$1"),
      )
        .replace(/\s+/g, " ")
        .trim();
      entries.set(number, { key: match[1], text });
    }
  }
  return [...entries]
    .filter(([number]) => !ambiguous.has(number))
    .map(([number, entry]) => ({ number, text: entry.text }));
}
