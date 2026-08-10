import { describe, expect, it } from "vitest";

import {
  FULL_TRANSLATION_PARSER_VERSION,
  buildFullTranslationDocument,
  protectLatexForTranslation,
  restoreLatexAfterTranslation,
} from "../../src/translate/full-document";

const source = String.raw`
\documentclass{article}
\title{A Study of $x$}
\begin{document}
\renewcommand{\@maketitle}{internal layout that must not become body text}
\maketitle
\begin{abstract}
We study $x$ under realistic conditions.
\end{abstract}

\section{Method}
\label{sec:method}
\setcounter{figure}{0}
First paragraph with inline math $E = mc^2$ and [citation].

Second paragraph explains the training recipe.

[Equation (1) label=eq:loss]
\begin{equation}
L = L_{task} + \lambda L_{aux}
\label{eq:loss}
\end{equation}

[Figure (1) label=fig:system graphics=figures/system.png]
\begin{figure}
\includegraphics{figures/system.png}
\includegraphics{figures/detail.pdf}
\caption{System overview for the proposed method.}
\label{fig:system}
\end{figure}

\begin{table}
\caption{Evaluation results.}
\label{tab:results}
\begin{tabular}{lc}
Method & Success \\
Baseline & 42\% \\
Ours & $87\%$ \\
\end{tabular}
\end{table}

\appendix
\section{Additional Results}
Appendix evidence appears here.

\begin{thebibliography}{9}
\bibitem{x} Reference title.
\end{thebibliography}
\end{document}
`;

describe("buildFullTranslationDocument", () => {
  it("builds stable translatable blocks from cleaned LaTeX", () => {
    const document = buildFullTranslationDocument("2504.16054", source);

    expect(document.sourceHash).toMatch(/^[0-9a-f]{16}$/);
    expect(document.blocks.map((block) => block.kind)).toEqual([
      "title",
      "abstract",
      "heading",
      "paragraph",
      "paragraph",
      "formula",
      "figure-caption",
      "table-caption",
      "heading",
      "paragraph",
    ]);
    expect(document.blocks.map((block) => block.id)).toEqual([
      "title",
      "abstract",
      "section-1",
      "section-1-p1",
      "section-1-p2",
      "equation-1",
      "figure-1-caption",
      "table-1-caption",
      "section-2",
      "section-2-p1",
    ]);
    expect(
      document.blocks.find((block) => block.id === "equation-1"),
    ).toMatchObject({
      translatable: false,
      source: expect.stringContaining("L_{task}"),
    });
    expect(
      document.blocks.find((block) => block.id === "figure-1-caption"),
    ).toMatchObject({
      source: "System overview for the proposed method.",
      translatable: true,
      assets: ["figures/system.png", "figures/detail.pdf"],
    });
    expect(
      document.blocks.find((block) => block.id === "table-1-caption"),
    ).toMatchObject({
      source: "Evaluation results.",
      translatable: true,
      table: {
        rows: [
          ["Method", "Success"],
          ["Baseline", "42%"],
          ["Ours", "$87\\%$"],
        ],
      },
    });
    expect(
      document.blocks.some((block) => block.source.includes("Reference title")),
    ).toBe(false);
    expect(
      document.blocks.some((block) => block.source.includes("internal layout")),
    ).toBe(false);
    expect(
      document.blocks.some((block) => block.source.includes("setcounter")),
    ).toBe(false);
  });

  it("is deterministic for the same source", () => {
    expect(buildFullTranslationDocument("2504.16054", source)).toEqual(
      buildFullTranslationDocument("2504.16054", source),
    );
  });

  it("namespaces the source hash by parser version", () => {
    const document = buildFullTranslationDocument("2504.16054", source);

    expect(document.sourceHash).toBe(
      stableHash(`${FULL_TRANSLATION_PARSER_VERSION}\0${source}`),
    );
    expect(document.sourceHash).not.toBe(stableHash(source));
  });

  it("renders epigraph commands as translatable blockquotes", () => {
    const document = buildFullTranslationDocument(
      "2504.16054",
      String.raw`\begin{document}
\section{Introduction}
\epigraph{*Stuff your eyes with wonder...*}{Ray Bradbury, *Fahrenheit 451*}

Opening paragraph.
\end{document}`,
    );

    expect(document.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "section-1-p1",
          kind: "paragraph",
          source:
            "> *Stuff your eyes with wonder...*\n>\n> Ray Bradbury, *Fahrenheit 451*",
          translatable: true,
        }),
        expect.objectContaining({
          id: "section-1-p2",
          source: "Opening paragraph.",
        }),
      ]),
    );
  });

  it("parses nested table headers and font-size wrappers before rendering", () => {
    const document = buildFullTranslationDocument(
      "1912.13470",
      String.raw`\begin{document}
\begin{table}
\begin{tabular}{cc}
\multicolumn{1}{c}{\scriptsize{\textbf{Object}}} &
**\begin{tabular}[c]{c}Grasps\\ / scene \end{tabular}** \\
\scriptsize{Banana} & \scriptsize{98\%} \\ \hlineB{2}
\end{tabular}
\caption{Success rate.}
\end{table}
\end{document}`,
    );

    const table = document.blocks.find(
      (block) => block.id === "table-1-caption",
    )?.table;
    expect(table?.rows).toEqual([
      ["**Object**", "**Grasps / scene**"],
      ["Banana", "98%"],
    ]);
    expect(table?.rows.flat().join(" ")).not.toMatch(
      /\\(?:scriptsize|footnotesize|begin|hlineB)/,
    );
  });

  it("normalizes common prose macros before creating translation blocks", () => {
    const document = buildFullTranslationDocument(
      "1912.13470",
      String.raw`\begin{document}
\section{Related Work}
Lenz~\etal~[13] proposed a cascaded method.
\end{document}`,
    );

    expect(
      document.blocks.find((block) => block.kind === "paragraph")?.source,
    ).toBe("Lenz et al. [13] proposed a cascaded method.");
  });

  it("hides synthetic paragraph numbering and source-only bibliography commands", () => {
    const document = buildFullTranslationDocument(
      "1912.13470",
      String.raw`\title{Dataset\\ for Grasping}
\begin{document}
\section{Dataset}
\subsection{Annotation}
\paragraph{Grasp Pose Annotation}Visible body.
{\small
\bibliographystyle{egbib}
\bibliography{egbib}
}
\end{document}`,
    );

    expect(document.blocks.find((block) => block.id === "title")?.source).toBe(
      "Dataset for Grasping",
    );
    expect(
      document.blocks.find((block) => block.source === "Grasp Pose Annotation"),
    ).toMatchObject({ kind: "heading", level: 4 });
    expect(
      document.blocks.find((block) => block.source === "Grasp Pose Annotation")
        ?.number,
    ).toBeUndefined();
    expect(
      document.blocks.some((block) => block.source.includes("bibliography")),
    ).toBe(false);
    expect(document.blocks.some((block) => /^[{}]+$/.test(block.source))).toBe(
      false,
    );
  });

  it("ignores document-body layout definitions without hiding real headings", () => {
    const document = buildFullTranslationDocument(
      "2506.00613",
      String.raw`\titlespacing\section{0pt}{1pt}{1pt}
\begin{document}
\maketitle
\setlength{\abovedisplayskip}{1pt}
\titlespacing\section{0pt}{3pt plus 1pt minus 2pt}{2pt plus 1pt minus 2pt}
\makeatletter
\renewcommand{\paragraph}{
  \@startsection{paragraph}{4}
  {\z@}{0.05ex \@plus .05ex \@minus .05ex}{-1em}
  {\normalfont\normalsize\bfseries}
}
\section{Introduction}
Visible section body keeps the 1pt threshold.

\@startsection{paragraph}{4}
{\z@}{0.05ex \@plus .05ex \@minus .05ex}{-1em}
{\normalfont\normalsize\bfseries}
Body after an expanded layout definition remains visible.

\paragraph{Evaluation Setup}Visible paragraph body.
\end{document}`,
    );

    expect(
      document.blocks.map(({ kind, source, number }) => ({
        kind,
        source,
        number,
      })),
    ).toEqual([
      { kind: "heading", source: "Introduction", number: "1" },
      {
        kind: "paragraph",
        source: "Visible section body keeps the 1pt threshold.",
        number: undefined,
      },
      {
        kind: "paragraph",
        source: "Body after an expanded layout definition remains visible.",
        number: undefined,
      },
      {
        kind: "heading",
        source: "Evaluation Setup",
        number: undefined,
      },
      {
        kind: "paragraph",
        source: "Visible paragraph body.",
        number: undefined,
      },
    ]);
  });

  it("extracts a standalone-dollar display formula whose closing dollar ends the formula line", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\section{Policy}
The privileged observations are defined below.

$
\mathbf{o}_t = [\mathbf{z}^{\text{shape}}, \mathbf{s}_t^{\text{obj}}],$

where $\mathbf{z}^{\text{shape}}\in\mathbb{R}^{1024}$ is fixed.
\end{document}`,
    );

    expect(
      document.blocks.map(({ kind, source, translatable }) => ({
        kind,
        source,
        translatable,
      })),
    ).toEqual([
      { kind: "heading", source: "Policy", translatable: true },
      {
        kind: "paragraph",
        source: "The privileged observations are defined below.",
        translatable: true,
      },
      {
        kind: "formula",
        source:
          "\\mathbf{o}_t = [\\mathbf{z}^{\\text{shape}}, \\mathbf{s}_t^{\\text{obj}}],",
        translatable: false,
      },
      {
        kind: "paragraph",
        source:
          "where $\\mathbf{z}^{\\text{shape}}\\in\\mathbb{R}^{1024}$ is fixed.",
        translatable: true,
      },
    ]);
  });

  it("extracts a single-line formula-only paragraph as a shared formula", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\section{Policy}
The action is defined as follows.

$\Delta\mathbf{\theta} = J^{T}(JJ^T)^{-1}\mathbf{e},$

where $J$ is the Jacobian matrix.
\end{document}`,
    );

    expect(document.blocks[2]).toMatchObject({
      kind: "formula",
      source: String.raw`\Delta\mathbf{\theta} = J^{T}(JJ^T)^{-1}\mathbf{e},`,
      translatable: false,
    });
  });

  it("splits a display formula embedded between prose without blank lines", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\section{Policy}
\noindent **Commands.**
The command is defined as
$
\mathbf{b}_t = [\mathbf{p}^{\text{cmd}}, \mathbf{o}^{\text{cmd}}]
$
where $\mathbf{p}^{\text{cmd}}\in\mathbb{R}^3$ is the target position.

The next paragraph keeps its original stable index.
\end{document}`,
    );

    expect(
      document.blocks.map(({ id, kind, source, translatable }) => ({
        id,
        kind,
        source,
        translatable,
      })),
    ).toEqual([
      {
        id: "section-1",
        kind: "heading",
        source: "Policy",
        translatable: true,
      },
      {
        id: "section-1-p1-s1",
        kind: "paragraph",
        source: "**Commands.**\nThe command is defined as",
        translatable: true,
      },
      {
        id: expect.stringMatching(/^display-formula-/),
        kind: "formula",
        source:
          "\\mathbf{b}_t = [\\mathbf{p}^{\\text{cmd}}, \\mathbf{o}^{\\text{cmd}}]",
        translatable: false,
      },
      {
        id: "section-1-p1-s2",
        kind: "paragraph",
        source:
          "where $\\mathbf{p}^{\\text{cmd}}\\in\\mathbb{R}^3$ is the target position.",
        translatable: true,
      },
      {
        id: "section-1-p2",
        kind: "paragraph",
        source: "The next paragraph keeps its original stable index.",
        translatable: true,
      },
    ]);
  });

  it("extracts equation* as one non-translatable formula block", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
Before the formula.

\begin{equation*}
x = y + z
\end{equation*}

After the formula.
\end{document}`,
    );

    expect(
      document.blocks.map(({ kind, source, translatable }) => ({
        kind,
        source,
        translatable,
      })),
    ).toEqual([
      {
        kind: "paragraph",
        source: "Before the formula.",
        translatable: true,
      },
      { kind: "formula", source: "x = y + z", translatable: false },
      {
        kind: "paragraph",
        source: "After the formula.",
        translatable: true,
      },
    ]);
  });

  it("keeps every row of a multi-line align in one formula block", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\begin{align}
a &= b + c \label{eq:first} \\
d &= e + f \label{eq:second}
\end{align}
\end{document}`,
    );

    const formulas = document.blocks.filter(
      (block) => block.kind === "formula",
    );
    expect(formulas).toHaveLength(1);
    expect(formulas[0]).toMatchObject({
      translatable: false,
      source: String.raw`\begin{aligned}
a &= b + c  \\
d &= e + f
\end{aligned}`,
    });
  });

  it("extracts every row of align* as one formula block", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\begin{align*}
x &= y \\
u &= v
\end{align*}
\end{document}`,
    );

    expect(document.blocks).toEqual([
      expect.objectContaining({
        kind: "formula",
        translatable: false,
        source: String.raw`\begin{aligned}
x &= y \\
u &= v
\end{aligned}`,
      }),
    ]);
  });

  it("extracts gather* as one non-translatable formula block", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\begin{gather*}
x = y \\
u = v
\end{gather*}
\end{document}`,
    );

    expect(document.blocks).toEqual([
      expect.objectContaining({
        kind: "formula",
        translatable: false,
        source: String.raw`\begin{gathered}
x = y \\
u = v
\end{gathered}`,
      }),
    ]);
  });

  it("extracts every row of multline* as one formula block", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\begin{multline*}
F(x) = a + b + c \\
{}+ d + e
\end{multline*}
\end{document}`,
    );

    expect(document.blocks).toEqual([
      expect.objectContaining({
        kind: "formula",
        translatable: false,
        source: String.raw`\begin{aligned}
&F(x) = a + b + c \\
&{}+ d + e
\end{aligned}`,
      }),
    ]);
  });

  it("unwraps visible legacy prose commands before creating translation blocks", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\section{Conclusions}
{\bf Limitations.}
The system has several limitations.

\acknowledgments{
This project was supported by a research award.
We thank the contributors.
}

\twocolumn[
\centering
\Large
**Paper title**
\vspace{0.5em}Appendix
]
\section{Extended Results}
Further evidence.
\end{document}`,
    );

    const visible = document.blocks.map((block) => block.source).join("\n");
    expect(visible).toContain("**Limitations.**");
    expect(visible).toContain(
      "This project was supported by a research award.",
    );
    expect(visible).toContain("We thank the contributors.");
    expect(visible).toContain("**Paper title**\nAppendix");
    expect(visible).not.toMatch(
      /\\(?:bf|acknowledgments|twocolumn|centering|Large|vspace)/,
    );
  });

  it("normalizes harmless whitespace inside inline math delimiters", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\section{Policy}
The observation is $ \mathbf{o}_t = [x] $, where $ y_t $ is visible.
\end{document}`,
    );

    expect(
      document.blocks.find((block) => block.kind === "paragraph")?.source,
    ).toBe("The observation is $\\mathbf{o}_t = [x]$, where $y_t$ is visible.");
  });

  it("unwraps multirow options and shortstack table labels", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\begin{table}
\begin{tabular}{cc}
\multirow{2}{*}[-1.4ex]{\textbf{Teacher}} & Score \\
 & 0.9 \\
\shortstack{Assistant\\ Rewards} & $r = x $ \\
\end{tabular}
\caption{Results.}
\end{table}
\end{document}`,
    );

    expect(document.blocks[0]?.table?.rows).toEqual([
      [{ text: "**Teacher**", rowSpan: 2 }, "Score"],
      ["0.9"],
      ["Assistant Rewards", "$r = x$"],
    ]);
  });

  it("preserves multicolumn and multirow layout without covered placeholders", () => {
    const document = buildFullTranslationDocument(
      "2403.16967",
      String.raw`\begin{document}
\begin{table}
\begin{tabular}{cccccc|c}
\toprule
& \multicolumn{5}{c|}{\textbf{High-Level}} & {\textbf{Low-Level}}\\
\cline{2-7}
& \multicolumn{3}{c}{TrackingSAM} & \multirow{2}{*}{Pre-Process} & \multirow{2}{*}{Model Inference} & \multirow{2}{*}{Model Inference} \\
\cline{2-4}
& SAM clicking & AOT Init & \multicolumn{1}{c}{AOT Tracking} & & & \\
\midrule
\multicolumn{1}{c|}{\textbf{Time (s)}} & $1.369\pm0.33$ & $0.323\pm0.72$ & $0.083\pm0.0$ & $0.031\pm0.01$ & $0.003\pm0.0$ & $0.011\pm 0.0$\\
\midrule
\multicolumn{1}{c|}{\textbf{Stage}} & \multicolumn{2}{c|}{Initialization} & \multicolumn{4}{c}{Autonumous} \\
\midrule
\multicolumn{1}{c|}{\textbf{Device}} & \multicolumn{5}{c|}{External NVIDIA Jetson Orin 64GB} & {Internal NVIDIA Jetson Xavier NX}\\
\bottomrule
\end{tabular}
\caption{Component runtime analysis.}
\end{table}
\end{document}`,
    );

    expect(document.blocks[0]?.table?.rows).toEqual([
      ["", { text: "**High-Level**", colSpan: 5 }, "**Low-Level**"],
      [
        "",
        { text: "TrackingSAM", colSpan: 3 },
        { text: "Pre-Process", rowSpan: 2 },
        { text: "Model Inference", rowSpan: 2 },
        { text: "Model Inference", rowSpan: 2 },
      ],
      ["", "SAM clicking", "AOT Init", "AOT Tracking"],
      [
        "**Time (s)**",
        "$1.369\\pm0.33$",
        "$0.323\\pm0.72$",
        "$0.083\\pm0.0$",
        "$0.031\\pm0.01$",
        "$0.003\\pm0.0$",
        "$0.011\\pm 0.0$",
      ],
      [
        "**Stage**",
        { text: "Initialization", colSpan: 2 },
        { text: "Autonumous", colSpan: 4 },
      ],
      [
        "**Device**",
        { text: "External NVIDIA Jetson Orin 64GB", colSpan: 5 },
        "Internal NVIDIA Jetson Xavier NX",
      ],
    ]);
  });
});

function stableHash(value: string): string {
  let high = 0xcbf29ce4 >>> 0;
  let low = 0x84222325 >>> 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ (code + 0x9e37), 0x01000193) >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

describe("LaTeX placeholder protection", () => {
  it("restores inline math byte-identically after translation", () => {
    const protectedSource = protectLatexForTranslation(
      "Loss $L = L_{task} + \\lambda L_{aux}$ is minimized.",
    );
    expect(protectedSource.text).toBe("Loss ZAILATEXTOKEN0X is minimized.");
    expect(
      restoreLatexAfterTranslation(
        "最小化损失 ZAILATEXTOKEN0X。",
        protectedSource.placeholders,
      ),
    ).toBe("最小化损失 $L = L_{task} + \\lambda L_{aux}$。");
  });

  it("protects single-dollar math that spans source lines", () => {
    const source = String.raw`The objective $
L = L_{task}
+ \lambda L_{aux}
$ remains fixed.`;

    const protectedSource = protectLatexForTranslation(source);

    expect(protectedSource).toEqual({
      text: "The objective ZAILATEXTOKEN0X remains fixed.",
      placeholders: [
        {
          token: "ZAILATEXTOKEN0X",
          latex: String.raw`$
L = L_{task}
+ \lambda L_{aux}
$`,
        },
      ],
    });
  });

  it("rejects model output that drops a protected expression", () => {
    const protectedSource = protectLatexForTranslation("Value $x$.");
    expect(
      restoreLatexAfterTranslation("该值。", protectedSource.placeholders),
    ).toBeNull();
  });

  it("protects LaTeX cross-reference identifiers", () => {
    const protectedSource = protectLatexForTranslation(
      String.raw`See Equation \eqref{eq:loss} and Figure \ref{fig:system}.`,
    );

    expect(protectedSource.text).toBe(
      "See Equation ZAILATEXTOKEN0X and Figure ZAILATEXTOKEN1X.",
    );
    expect(
      restoreLatexAfterTranslation(
        "参见公式 ZAILATEXTOKEN0X 与图 ZAILATEXTOKEN1X。",
        protectedSource.placeholders,
      ),
    ).toBe(String.raw`参见公式 \eqref{eq:loss} 与图 \ref{fig:system}。`);
  });
});
