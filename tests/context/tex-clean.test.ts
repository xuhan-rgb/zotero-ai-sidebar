import { describe, expect, it } from "vitest";
import {
  stripTexComments,
  findMainTex,
  inlineInputs,
  expandMacros,
  buildCitationLabels,
  normalizeCitations,
  normalizeLatexCommonCommands,
  normalizeLatexListEnvironments,
  normalizeLatexSourceCommands,
  normalizeLatexTextCommands,
} from "../../src/context/tex-clean";

describe("stripTexComments", () => {
  it("removes a line comment", () => {
    expect(stripTexComments("text % a comment")).toBe("text ");
  });
  it("keeps an escaped percent", () => {
    expect(stripTexComments("50\\% done % real comment")).toBe("50\\% done ");
  });
  it("keeps lines without comments", () => {
    expect(stripTexComments("a\nb")).toBe("a\nb");
  });
});

describe("findMainTex", () => {
  it("picks the file with documentclass + begin document", () => {
    const files = [
      { path: "sec1.tex", text: "\\section{Intro}" },
      {
        path: "main.tex",
        text: "\\documentclass{x}\n\\begin{document}\nhi\n\\end{document}",
      },
    ];
    expect(findMainTex(files)?.path).toBe("main.tex");
  });
  it("returns null when there is no .tex file", () => {
    expect(findMainTex([{ path: "a.png", text: "" }])).toBeNull();
  });
});

describe("expandMacros", () => {
  it("expands simple zero-arg macros", () => {
    const text =
      "\\newcommand{\\E}{\\mathbb{E}}\n\\newcommand{\\bo}{\\mathbf{o}}\n" +
      "body: \\E[\\bo_t]";
    expect(expandMacros(text)).toContain("body: \\mathbb{E}[\\mathbf{o}_t]");
  });

  it("respects word boundaries", () => {
    const text = "\\newcommand{\\E}{X}\n\\Energy and \\E\\bar";
    const out = expandMacros(text);
    expect(out).toContain("\\Energy and X\\bar");
  });

  it("iterates to fixpoint for nested macros", () => {
    const text =
      "\\newcommand{\\E}{\\mathbb{E}}\n\\newcommand{\\loss}{\\E[L]}\n\\loss";
    expect(expandMacros(text).trim().endsWith("\\mathbb{E}[L]")).toBe(true);
  });

  it("expands model-symbol macros with nested ensuremath and xspace", () => {
    const text =
      "\\newcommand{\\ModelSymbol}{\\ensuremath{\\pi_{0.5}}\\xspace}\n" +
      "While \\ModelSymbol\\ can clean kitchens.";
    expect(expandMacros(text)).toContain(
      "While $\\pi_{0.5}$ can clean kitchens.",
    );
  });

  it("uses the bare math body when an ensuremath macro appears inside math", () => {
    const text =
      "\\newcommand{\\ModelSymbol}{\\ensuremath{\\pi_{0.5}}\\xspace}\n" +
      "$\\ModelSymbol + x$";
    expect(expandMacros(text)).toContain("$\\pi_{0.5} + x$");
  });

  it("supports common zero-arg definition forms", () => {
    const text = [
      "\\newcommand\\A{Alpha}",
      "\\renewcommand{\\B}{Beta}",
      "\\providecommand{\\C}{Gamma}",
      "\\DeclareRobustCommand{\\D}{Delta}",
      "\\def\\E{Epsilon}",
      "\\A \\B \\C \\D \\E",
    ].join("\n");
    expect(expandMacros(text)).toContain("Alpha Beta Gamma Delta Epsilon");
  });

  it("keeps macro definitions readable while expanding body usages", () => {
    const text = "\\newcommand{\\E}{\\mathbb{E}}\nBody \\E.";
    const out = expandMacros(text);
    expect(out).toContain("\\newcommand{\\E}{\\mathbb{E}}");
    expect(out).toContain("Body \\mathbb{E}.");
  });

  it("leaves parameterized macros and their usages untouched", () => {
    const text = "\\newcommand{\\red}[1]{\\textcolor{red}{#1}}\n\\red{X}";
    expect(expandMacros(text)).toContain("\\red{X}");
  });

  it("keeps paragraph headings while removing a layout redefinition", () => {
    const text = String.raw`\makeatletter
\renewcommand{\paragraph}{
  \@startsection{paragraph}{4}
  {\z@}{0.05ex \@plus .05ex \@minus .05ex}{-1em}
  {\normalfont\normalsize\bfseries}
}
\paragraph{Multi-Task POMDP.} Body text.`;

    const out = expandMacros(text);

    expect(out).toContain(String.raw`\paragraph{Multi-Task POMDP.} Body text.`);
    expect(out).not.toContain(String.raw`\renewcommand{\paragraph}`);
    expect(out).not.toContain(String.raw`\@startsection{paragraph}`);
  });
});

describe("normalizeCitations", () => {
  it("replaces common LaTeX citation commands with a neutral marker", () => {
    const text =
      "CapsFusion \\cite{yu2024capsfusion}, COCO \\citep{chen2015microsoft}, and \\citet{smith2020}.";
    expect(normalizeCitations(text)).toBe(
      "CapsFusion [citation], COCO [citation], and [citation].",
    );
  });

  it("handles optional citation notes without exposing bibliography keys", () => {
    expect(normalizeCitations("see \\citep[Sec.~2][p.~4]{a,b}")).toBe(
      "see [citation]",
    );
  });

  it("renders citation numbers from compiled bibliography order", () => {
    const labels = buildCitationLabels([
      {
        path: "paper.bbl",
        text: String.raw`\begin{thebibliography}{9}
\bibitem{lenz2015deep} Lenz.
\bibitem{redmon2015real} Redmon.
\end{thebibliography}`,
      },
    ]);

    expect(
      normalizeCitations(
        String.raw`Lenz~\cite{lenz2015deep,redmon2015real}`,
        labels,
      ),
    ).toBe("Lenz~[1, 2]");
  });
});

describe("normalizeLatexCommonCommands", () => {
  it("converts common prose macros and nonbreaking spaces before translation", () => {
    expect(
      normalizeLatexCommonCommands(
        String.raw`Lenz~\etal proposed it, \ie it works; $x~y$ stays math.`,
      ),
    ).toBe("Lenz et al. proposed it, i.e. it works; $x~y$ stays math.");
  });

  it("converts prose line-break commands without changing display math", () => {
    expect(
      normalizeLatexCommonCommands(
        String.raw`A title\\ on one line and $\begin{matrix}a\\b\end{matrix}$.`,
      ),
    ).toBe(
      String.raw`A title on one line and $\begin{matrix}a\\b\end{matrix}$.`,
    );
  });
});

describe("normalizeLatexTextCommands", () => {
  it("converts visible LaTeX text wrappers to Markdown without dropping content", () => {
    expect(
      normalizeLatexTextCommands(
        "an action \\emph{chunk}, \\textbf{important}, and \\texttt{FAST}",
      ),
    ).toBe("an action *chunk*, **important**, and `FAST`");
  });

  it("unwraps source styling commands while preserving their visible text", () => {
    expect(
      normalizeLatexTextCommands(
        "\\underline{underlined} \\textsc{Small Caps} \\textcolor{red}{red text}",
      ),
    ).toBe("underlined Small Caps red text");
  });

  it("handles nested text commands recursively", () => {
    expect(normalizeLatexTextCommands("\\emph{action \\textbf{chunk}}")).toBe(
      "*action **chunk***",
    );
  });

  it("does not rewrite text commands inside math mode", () => {
    expect(normalizeLatexTextCommands("$\\textbf{x}$ and \\emph{x}")).toBe(
      "$\\textbf{x}$ and *x*",
    );
  });

  it("unwraps LaTeX font-size commands while preserving their text", () => {
    expect(
      normalizeLatexTextCommands(
        String.raw`\scriptsize{small} \footnotesize{\textbf{label}}`,
      ),
    ).toBe("small **label**");
  });

  it("keeps wrapper whitespace outside Markdown emphasis markers", () => {
    expect(normalizeLatexTextCommands(String.raw`\textbf{ label }`)).toBe(
      " **label** ",
    );
  });
});

describe("normalizeLatexSourceCommands", () => {
  it("removes source-only equation metadata", () => {
    const text =
      "\\begin{align}\n" +
      "x &= y \\notag \\\\\n" +
      "z &= w, \\label{eq:cotrain}\n" +
      "\\end{align}";
    const out = normalizeLatexSourceCommands(text);
    expect(out).not.toContain("\\notag");
    expect(out).not.toContain("\\label");
    expect(out).not.toContain("eq:cotrain");
    expect(out).toContain("x &= y  \\\\");
    expect(out).toContain("z &= w, ");
  });

  it("neutralizes cross-references without exposing source keys", () => {
    expect(
      normalizeLatexSourceCommands(
        "Figure~\\ref{fig:home} and Eq.~\\eqref{eq:loss}",
      ),
    ).toBe("Figure~[ref] and Eq.~[ref]");
  });

  it("renders resolved cross-reference numbers before translation", () => {
    const references = new Map([
      ["fig:home", "2"],
      ["eq:loss", "3"],
      ["sec:method", "4.1"],
    ]);

    expect(
      normalizeLatexSourceCommands(
        "Figure~\\ref{fig:home}, Eq.~\\eqref{eq:loss}, and \\autoref{sec:method}",
        { referenceLabels: references },
      ),
    ).toBe("Figure~2, Eq.~(3), and Section 4.1");
  });

  it("uses label prefixes for typed automatic references", () => {
    const references = new Map([
      ["fig:home", "2"],
      ["tab:results", "5"],
      ["eq:loss", "3"],
    ]);

    expect(
      normalizeLatexSourceCommands(
        "\\autoref{fig:home}, \\autoref{tab:results}, \\autoref{eq:loss}",
        { referenceLabels: references },
      ),
    ).toBe("Figure 2, Table 5, Equation 3");
  });

  it("can preserve section labels for arXiv section lookup", () => {
    const text =
      "\\section{Method}\n\\label{sec:method}\nBody \\label{eq:body}";
    const out = normalizeLatexSourceCommands(text, {
      preserveSectionLabels: true,
    });
    expect(out).toContain("\\label{sec:method}");
    expect(out).not.toContain("eq:body");
  });

  it("can preserve equation labels for deterministic equation lookup", () => {
    const text =
      "\\begin{equation}\n" +
      "x = y\n" +
      "\\label{eq:target}\n" +
      "\\end{equation}\n" +
      "Body \\label{eq:body}";
    const out = normalizeLatexSourceCommands(text, {
      preserveEquationLabels: true,
    });

    expect(out).toContain("\\label{eq:target}");
    expect(out).not.toContain("eq:body");
  });

  it("can preserve figure labels for deterministic figure lookup", () => {
    const text =
      "\\begin{figure}\n" +
      "\\caption{A}\n" +
      "\\label{fig:target}\n" +
      "\\end{figure}\n" +
      "Body \\label{fig:body}";
    const out = normalizeLatexSourceCommands(text, {
      preserveFigureLabels: true,
    });

    expect(out).toContain("\\label{fig:target}");
    expect(out).not.toContain("fig:body");
  });
});

describe("normalizeLatexListEnvironments", () => {
  it("converts enumerate environments to Markdown numbered lists", () => {
    expect(
      normalizeLatexListEnvironments(
        "\\begin{enumerate}\n\\item First\n\\item Second\n\\end{enumerate}",
      ),
    ).toBe("1. First\n2. Second");
  });

  it("converts itemize environments to Markdown bullet lists", () => {
    expect(
      normalizeLatexListEnvironments(
        "\\begin{itemize}\n\\item Alpha\n\\item Beta\n\\end{itemize}",
      ),
    ).toBe("- Alpha\n- Beta");
  });

  it("handles list items that wrap across source lines", () => {
    expect(
      normalizeLatexListEnvironments(
        "\\begin{enumerate}\n\\item First line\ncontinues here\n\\item Second\n\\end{enumerate}",
      ),
    ).toBe("1. First line continues here\n2. Second");
  });
});

describe("inlineInputs", () => {
  it("splices an \\input file's content", () => {
    const files = [{ path: "method.tex", text: "METHOD BODY" }];
    expect(inlineInputs("before \\input{method} after", files)).toBe(
      "before METHOD BODY after",
    );
  });
});
