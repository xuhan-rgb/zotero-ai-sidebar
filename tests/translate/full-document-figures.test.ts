import { describe, expect, it } from "vitest";

import { buildFullTranslationDocument } from "../../src/translate/full-document";

describe("full-document figure extraction", () => {
  it("keeps wrapped subfigures in one shared block with translatable captions", () => {
    const source = String.raw`\begin{document}
\section{Related Work}
\begin{wrapfigure}{r}{.33\textwidth}
  \centering
  \begin{minipage}{\linewidth}
    \includegraphics[width=0.9\linewidth]{figs/baseline.jpg}
    \subcaption{Static-height.}
    \par\vfill
    \includegraphics[width=0.9\linewidth]{figs/vbc.jpg}
    \subcaption{VBC.}
  \end{minipage}
  \caption{Illustration of comparing VBC to static-height methods.}
\end{wrapfigure}
Visible prose after the figure.
\end{document}`;

    const document = buildFullTranslationDocument("2403.16967", source);
    const figures = document.blocks.filter(
      (block) => block.kind === "figure-caption",
    );

    expect(figures).toEqual([
      expect.objectContaining({
        source:
          "Static-height. VBC. Illustration of comparing VBC to static-height methods.",
        translatable: true,
        assets: ["figs/baseline.jpg", "figs/vbc.jpg"],
      }),
    ]);
    expect(
      document.blocks.filter((block) =>
        block.assets?.includes("figs/baseline.jpg"),
      ),
    ).toHaveLength(1);
    expect(document.blocks.map((block) => block.source).join("\n")).not.toMatch(
      /\\(?:begin\{minipage\}|includegraphics|subcaption)/,
    );
  });
});
