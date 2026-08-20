import { describe, expect, it } from "vitest";
import { renderMarkdownInto } from "../../src/modules/markdown-render";

function render(markdown: string): HTMLElement {
  const root = document.createElement("div");
  renderMarkdownInto(root, markdown);
  return root;
}

describe("renderMarkdownInto", () => {
  it("renders fenced Graphviz DOT as an SVG chart", () => {
    const source = [
      "digraph Roadmap {",
      "  rankdir=TB;",
      '  Input [label="输入图像"];',
      '  Encoder [label="视觉编码器"];',
      "  Input -> Encoder;",
      "}",
    ].join("\n");
    const root = render(`\`\`\`dot\n${source}\n\`\`\``);

    expect(root.querySelector(".mindmap-block")).not.toBeNull();
    expect(root.querySelector(".zai-mm-svg")).not.toBeNull();
    expect(root.querySelector("pre code.language-dot")).toBeNull();
    expect(root.querySelector(".mindmap-source")?.textContent).toBe(source);
  });

  it("repairs DeepSeek's detached DOT language label without treating code as math", () => {
    const markdown = [
      "### 方案一：Graphviz DOT 代码（推荐）",
      "",
      "dot",
      "",
      "```",
      "digraph LAW {",
      "  rankdir=TB;",
      '  Pred [label="预测隐特征 \\\\hat{V}_{t+1}"];',
      '  Loss [label="\\\\mathcal{L}_{\\\\text{latent}}"];',
      "  Pred -> Loss;",
      "}",
      "```",
    ].join("\n");
    const root = render(markdown);

    expect(root.querySelector(".mindmap-block")).not.toBeNull();
    expect(root.querySelector(".math-display")).toBeNull();
    expect(root.querySelector("p")?.textContent).not.toBe("dot");
    expect(root.querySelector(".mindmap-source")?.textContent).toContain(
      "digraph LAW",
    );
  });

  it("turns bare web URLs into safe clickable links", () => {
    const root = render(
      "论文地址：https://arxiv.org/abs/2406.08481。",
    );
    const link = root.querySelector("a") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.href).toContain("https://arxiv.org/abs/2406.08481");
    expect(link?.textContent).toBe("https://arxiv.org/abs/2406.08481");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noreferrer");
    expect(root.textContent).toContain("。");
  });

  it("keeps local generated-file links clickable", () => {
    const root = render("[下载 PDF](file:///tmp/zai-downloads/flowchart.pdf)");
    const link = root.querySelector("a") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.href).toContain("file:///tmp/zai-downloads/flowchart.pdf");
    expect(link?.textContent).toBe("下载 PDF");
  });

  it("keeps parentheses in generated-file URLs", () => {
    const root = render(
      "[流程图](file:///tmp/zai-downloads/flowchart_cn(5).pdf#zai-web-download)",
    );
    const link = root.querySelector("a") as HTMLAnchorElement | null;
    expect(link?.href).toContain("flowchart_cn(5).pdf#zai-web-download");
    expect(link?.textContent).toBe("流程图");
  });

  it("does not rewrite padded inline math or prose LaTeX commands", () => {
    const root = render(
      "and additionally learn an ego decoder $\\hat{p}^{T+1} = d_{ego}(\\hat{Z}^{T+1}_0) $ \\wrt the current frame.",
    );

    expect(root.querySelector(".math-inline")).toBeNull();
    expect(root.textContent).toContain("$");
    expect(root.textContent).toContain("\\wrt");
  });

  it("renders GFM pipe tables as scrollable tables", () => {
    const root = render(
      [
        "主要数值如下：",
        "",
        "| Method | PQ | mIoU |",
        "| :--- | ---: | ---: |",
        "| **RangeFormer** | 73.3 | 66.6 |",
        "| P-RangeFormer | 64.2 | 59.5 |",
      ].join("\n"),
    );

    const wrap = root.querySelector(".markdown-table-wrap");
    const table = root.querySelector("table.markdown-table");
    expect(wrap).not.toBeNull();
    expect(table).not.toBeNull();
    expect(root.querySelectorAll("th")).toHaveLength(3);
    expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(root.querySelector("tbody strong")?.textContent).toBe("RangeFormer");
    expect(
      (root.querySelectorAll("th")[1] as HTMLElement).style.textAlign,
    ).toBe("right");
  });

  it("keeps malformed pipe text as a paragraph instead of a table", () => {
    const root = render("Method | PQ | mIoU\nRangeFormer | 73.3 | 66.6");

    expect(root.querySelector("table")).toBeNull();
    expect(root.textContent).toContain("Method | PQ | mIoU");
  });

  // Set-builder notation puts a literal `|` inside `$…$` in a table cell. The
  // pipe splitter must treat that `|` as math content (like it already does for
  // `|` inside backtick code spans), not as a column separator — otherwise the
  // cell tears into "$\{x" (unclosed, leaked) plus dropped overflow columns.
  it("does not split a table cell on a literal pipe inside inline math", () => {
    const root = render(
      [
        "| 集合 | 定义 |",
        "| --- | --- |",
        "| A | $\\{x \\mid x>0\\}$ |",
        "| B | $\\{x | x<0\\}$ |",
      ].join("\n"),
    );

    const rows = root.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].children).toHaveLength(2);
    expect(rows[1].children).toHaveLength(2);
    const cellB = rows[1].children[1] as HTMLElement;
    expect(cellB.querySelector(".math-inline")).not.toBeNull();
    expect(cellB.textContent).not.toContain("$");
  });

  it("keeps indented list items nested under their parent item", () => {
    const root = render(
      [
        "- Category: system paper",
        "- Context: related to VLAs; references:",
        "  - Black 2024 — pi0 flow VLA",
        "  - Pertsch 2025 — FAST tokenization",
        "- Correctness: check ablations",
      ].join("\n"),
    );

    const top = root.querySelector(":scope > ul")!;
    expect(top).not.toBeNull();
    expect(top.children).toHaveLength(3);
    expect(top.children[1].childNodes[0]?.textContent).toBe(
      "Context: related to VLAs; references:",
    );

    const nested = top.children[1].querySelector(":scope > ul")!;
    expect(nested).not.toBeNull();
    expect(Array.from(nested.children).map((li) => li.textContent)).toEqual([
      "Black 2024 — pi0 flow VLA",
      "Pertsch 2025 — FAST tokenization",
    ]);
    expect(top.children[2].textContent).toBe("Correctness: check ablations");
  });

  it("renders math-like fenced text blocks as display math", () => {
    const root = render(
      [
        "```text",
        "πθ(a_{t:t+H}, \\hat l | o_t, l)",
        "= πθ(a_{t:t+H} | o_t, \\hat l) πθ(\\hat l | o_t, l)",
        "```",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    expect(math?.dataset.latex).toContain("\\pi_\\theta");
    expect(root.querySelector("pre code")).toBeNull();
  });

  it("keeps ordinary fenced text blocks as code", () => {
    const root = render(
      ["```text", "Run this command exactly:", "npm test", "```"].join("\n"),
    );

    expect(root.querySelector(".math-display")).toBeNull();
    expect(root.querySelector("pre code")?.textContent).toContain("npm test");
  });

  it("renders a LaTeX equation environment inside a blockquote", () => {
    const root = render(
      [
        "> We decompose the distribution as",
        "> \\begin{equation*}",
        "> \\pi_\\theta(a \\vert o) = \\pi_\\theta(a \\vert \\hat{\\ell})\\pi_\\theta(\\hat{\\ell} \\vert o)",
        "> \\end{equation*}",
        "> where the action distribution depends on the subtask.",
      ].join("\n"),
    );

    const quote = root.querySelector("blockquote") as HTMLElement | null;
    const math = quote?.querySelector(".math-display") as HTMLElement | null;
    expect(quote).not.toBeNull();
    expect(math).not.toBeNull();
    expect(math?.dataset.latex).toContain("\\pi_\\theta(a \\vert o)");
    expect(quote?.textContent).not.toContain("\\begin{equation");
    expect(root.querySelector(".katex-error")).toBeNull();
  });

  // A model sometimes splits an equation environment across a blockquote
  // boundary: `> \begin{equation}` inside the quote, the body and
  // `\end{equation}` outside it. The orphaned delimiters used to leak and the
  // bare body rendered as raw LaTeX. Strip the orphan delimiters and render the
  // body as display math.
  it("renders an equation environment split across a blockquote boundary", () => {
    const root = render(
      [
        "> Formally, the goal is to train a policy $\\hat\\pi$ as follows:",
        "> \\begin{equation}",
        "\\hat{\\pi} = \\arg\\min_{\\pi\\in\\Pi}\\mathbb{E}_{s\\sim d_{\\pi}}[\\ell(s,\\pi)].",
        "\\end{equation}",
      ].join("\n"),
    );

    expect(root.textContent).not.toContain("\\begin{equation}");
    expect(root.textContent).not.toContain("\\end{equation}");
    expect(root.textContent).not.toContain("\\hat{\\pi}");
    expect(root.querySelector(".math-display")).not.toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
    expect(root.querySelector("blockquote")?.textContent).toContain(
      "Formally, the goal",
    );
  });

  it("renders split blockquote equation when a blank precedes the end delimiter", () => {
    const root = render(
      [
        "> Formally, the goal is to train a student policy $\\hat{\\pi}$ minimizing the action distance:",
        "> \\begin{equation}",
        "\\hat{\\pi} = \\arg\\min_{\\pi\\in\\Pi}\\mathbb{E}_{s\\sim d_{\\pi}}[\\ell(s,\\pi)].",
        "",
        "\\end{equation}",
      ].join("\n"),
    );

    expect(root.textContent).not.toContain("\\begin{equation}");
    expect(root.textContent).not.toContain("\\end{equation}");
    expect(root.textContent).not.toContain("\\hat{\\pi}");
    expect(root.querySelectorAll(".math-display")).toHaveLength(1);
    expect(root.querySelector(".katex-error")).toBeNull();
  });

  it("renders blockquoted display math delimited by standalone single-$ lines", () => {
    const root = render(
      [
        "> The command $\\mathbf{b}_t$ for our low-level policy is defined as",
        "> $",
        "> \\mathbf{b}_t = [\\mathbf{p}^{\\text{cmd}}, \\mathbf{o}^{\\text{cmd}}, v_{\\text{lin}}^{\\text{cmd}}, \\omega_\\text{yaw}^{\\text{cmd}}]",
        "> $",
        "> where $\\mathbf{p}^{\\text{cmd}}\\in\\mathbb{R}^3$ and $\\mathbf{o}^{\\text{cmd}}\\in\\mathbb{R}^3$ are end-effector commands.",
      ].join("\n"),
    );

    const quote = root.querySelector("blockquote") as HTMLElement | null;
    const math = quote?.querySelector(".math-display") as HTMLElement | null;
    expect(quote).not.toBeNull();
    expect(math).not.toBeNull();
    expect(math?.dataset.latex).toContain("\\mathbf{b}_t = [");
    expect(quote?.textContent).not.toContain("\\mathbf{b}_t = [");
    expect(quote?.textContent).not.toContain("\\text{cmd}");
    expect(root.querySelector(".katex-error")).toBeNull();
  });

  it("renders standalone display-math paragraphs delimited by single-$ lines", () => {
    const root = render(
      [
        "The command $\\mathbf{b}_t$ for our low-level policy is defined as",
        "",
        "$",
        "\\mathbf{b}_t = [\\mathbf{p}^{\\text{cmd}}, \\mathbf{o}^{\\text{cmd}}, v_{\\text{lin}}^{\\text{cmd}}, \\omega_\\text{yaw}^{\\text{cmd}}]",
        "$",
        "",
        "Our low-level goal-reaching policy mainly controls the quadruped robot.",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    expect(math?.dataset.latex).toContain("\\mathbf{b}_t = [");
    expect(root.textContent).not.toContain("\\mathbf{p}^{\\text{cmd}}");
    expect(root.querySelector(".katex-error")).toBeNull();
  });

  // A padded single-$ math line (`$ … $,` — space just inside the dollars,
  // which the strict inline-$ guard rejects) that OPENS a multi-line paragraph
  // (followed by a `where …` line, no blank between) used to leak as raw
  // "$ \mathbf{o}_t = …". The blockquote path already normalizes loose single-$
  // lines per line; the regular paragraph path must do the same.
  it("renders a padded single-$ math line that opens a multi-line paragraph", () => {
    const root = render(
      [
        "> Formally, the observation of our vision policy is",
        "$ \\mathbf{o}_t = [\\mathbf{s}_t^{\\text{proprio}}, \\mathbf{a}_{t-1}]$,",
        "where $\\mathbf{o}^{\\text{image}}_t$ consists of depth images.",
      ].join("\n"),
    );

    expect(root.querySelector(".katex-error")).toBeNull();
    expect(root.textContent).not.toContain("\\mathbf");
    expect(root.textContent).not.toContain("$");
    expect(root.querySelectorAll(".math-inline").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("renders whole-paragraph single-dollar math even when padded with spaces", () => {
    const root = render(
      [
        "Formally, the observation of our vision policy is",
        "",
        "$ \\mathbf{o}_t = [\\mathbf{o}^{\\text{image}}_t, \\mathbf{s}_t^{\\text{proprio}}, \\mathbf{a}_{t-1}]$,",
        "",
        "where $\\mathbf{o}^{\\text{image}}_t$ consists of segmented depth images.",
      ].join("\n"),
    );

    const math = root.querySelector(".math-inline") as HTMLElement | null;
    expect(math).not.toBeNull();
    expect(math?.dataset.latex).toContain("\\mathbf{o}_t = [");
    expect(root.textContent).not.toContain("\\mathbf{s}_t^{\\text{proprio}}");
    expect(root.textContent).toContain(",");
    expect(root.querySelector(".katex-error")).toBeNull();
  });

  it("renders blockquoted whole-line single-dollar math even when padded with spaces", () => {
    const root = render(
      [
        "> Formally, the observation of our vision policy is",
        "> $ \\mathbf{o}_t = [\\mathbf{o}^{\\text{image}}_t, \\mathbf{s}_t^{\\text{proprio}}, \\mathbf{a}_{t-1}]$,",
        "> where $\\mathbf{o}^{\\text{image}}_t$ consists of object segmentation masks and segmented depth images.",
      ].join("\n"),
    );

    const quote = root.querySelector("blockquote") as HTMLElement | null;
    const math = quote?.querySelector(".math-inline") as HTMLElement | null;
    expect(quote).not.toBeNull();
    expect(math).not.toBeNull();
    expect(math?.dataset.latex).toContain("\\mathbf{o}_t = [");
    expect(quote?.textContent).not.toContain("\\mathbf{s}_t^{\\text{proprio}}");
    expect(quote?.textContent).toContain(
      "consists of object segmentation masks and segmented depth images.",
    );
    expect(quote?.textContent).toContain(",");
    expect(root.querySelector(".katex-error")).toBeNull();
  });

  it("renders display math even when the body contains stray inner dollar delimiters", () => {
    const root = render(
      [
        "> In particular, PPO optimizes the following objective:",
        "> $",
        "> L^{PPO}(\\theta_\\pi) = $\\mathbb{E}_{\\pi}[\\min(rA, \\text{clip}(r,1-\\epsilon,1+\\epsilon)A)]$",
        "> $",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
    expect(math?.textContent ?? "").not.toContain("$");
  });

  it("renders raw LaTeX tabular rows as readable label-value lines", () => {
    const root = render(
      [
        "> Leg joint positions & \\( \\mathbf{q}\\) \\\\",
        "> Leg joint torques & \\( \\tau \\) \\\\",
        "> Base linear velocity & \\( v_b \\) \\\\",
      ].join("\n"),
    );

    const quote = root.querySelector("blockquote") as HTMLElement | null;
    expect(quote).not.toBeNull();
    expect(quote?.textContent).toContain("Leg joint positions:");
    expect(quote?.textContent).toContain("Leg joint torques:");
    expect(quote?.textContent).toContain("Base linear velocity:");
    expect(quote?.textContent).not.toContain("&");
    expect(quote?.textContent).not.toContain("\\\\");
  });

  // A raw tabular row whose first column is empty (`& label & val & val \\`,
  // common when the header column is blank) used to be rejected by the
  // any-empty-cell guard and leak its `&` / `\\`. Empty cells should be dropped,
  // the rest rendered as a readable pipe-joined line with math intact.
  it("normalizes a raw tabular row that has a leading empty cell", () => {
    const root = render(
      "> & Floating Base & $0.39 \\pm 0.07$ & $0.06 \\pm 0.02$ \\\\",
    );

    const quote = root.querySelector("blockquote") as HTMLElement | null;
    expect(quote).not.toBeNull();
    expect(quote?.textContent).toContain("Floating Base");
    expect(quote?.textContent).not.toContain("&");
    expect(quote?.textContent).not.toContain("\\\\");
    expect(quote?.querySelector(".math-inline")).not.toBeNull();
  });

  it("does not turn a quoted LaTeX result row into an HTML table", () => {
    const root = render(
      "> “Copy\\&Paste & 3D-Occ & None & 66.38 & 14.91 & 10.54 & 8.52 & \\cellcolor{gray!30}11.33 & 62.29 & \\cellcolor{gray!30}20.52 & \\cellcolor{gray!30}-”",
    );

    const quote = root.querySelector("blockquote") as HTMLElement | null;
    expect(quote?.querySelector("table.markdown-table")).toBeNull();
    expect(quote?.textContent).toContain("Copy\\&Paste");
    expect(quote?.textContent).toContain("\\cellcolor");
  });

  // `\footnote{…}` is tangential source metadata; inlined mid-sentence it
  // breaks the quote. Drop the command and its content entirely.
  it("drops LaTeX footnote commands with their content", () => {
    const root = render(
      "orientation\\footnote{{We use Euler angles by default.}} command, defined",
    );

    expect(root.textContent).not.toContain("\\footnote");
    expect(root.textContent).not.toContain("Euler angles");
    expect(root.textContent).toContain("orientation command, defined");
  });

  // `\edit{…}` is a custom revision macro wrapping real prose/math. Unwrap it
  // (keep the content, render inner math), like \textrm — don't leak `\edit{`.
  it("unwraps a custom edit revision macro and renders its inner math", () => {
    const root = render(
      "limits \\edit{$v_{\\text{lin}}^{\\text{cmd}} \\in \\mathbb{R}$ are velocities}",
    );

    expect(root.textContent).not.toContain("\\edit");
    expect(root.textContent).toContain("are velocities");
    expect(root.querySelector(".math-inline")).not.toBeNull();
  });

  // The blockquote path extracts math regions at the top level, which split a
  // math-wrapping `\edit{$…$}` and leak the bare `\edit{`. The wrapper must be
  // unwrapped before math extraction so it survives inside blockquotes too.
  it("unwraps a custom edit macro wrapping math inside a blockquote", () => {
    const root = render(
      "> limits \\edit{$v_{\\text{lin}}^{\\text{cmd}} \\in \\mathbb{R}$ are velocities} here",
    );

    const quote = root.querySelector("blockquote") as HTMLElement | null;
    expect(quote).not.toBeNull();
    expect(quote?.textContent).not.toContain("\\edit");
    expect(quote?.textContent).toContain("are velocities");
    expect(quote?.querySelector(".math-inline")).not.toBeNull();
  });

  it("does not render source-only equation labels inside blockquotes", () => {
    const root = render(
      [
        "> Our model is optimized to minimize the combined loss",
        "> \\begin{align}",
        "> x &= y \\notag \\\\",
        "> z &= w, \\label{eq:cotrain}",
        "> \\end{align}",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    expect(math?.dataset.latex).not.toContain("\\label");
    expect(math?.dataset.latex).not.toContain("\\notag");
    expect(root.textContent).not.toContain("eq:cotrain");
    expect(root.querySelector(".katex-error")).toBeNull();
  });

  it("renders residual LaTeX citation commands as neutral citation markers", () => {
    const root = render(
      "Finally we include CapsFusion \\cite{yu2024capsfusion}, COCO \\citep[see]{chen2015microsoft}.",
    );

    expect(root.textContent).toContain(
      "Finally we include CapsFusion [citation], COCO [citation].",
    );
    expect(root.textContent).not.toContain("\\cite");
    expect(root.textContent).not.toContain("yu2024capsfusion");
  });

  it("renders residual LaTeX references as neutral reference markers", () => {
    const root = render("Figure~\\ref{fig:home} and Eq.~\\eqref{eq:loss}");

    // The `~` ties render as spaces (see tie test below), not literal tildes.
    expect(root.textContent).toBe("Figure [ref] and Eq. [ref]");
    expect(root.textContent).not.toContain("\\ref");
    expect(root.textContent).not.toContain("eq:loss");
  });

  // `~` is a LaTeX non-breaking space (tie). When the model quotes LaTeX source
  // verbatim it leaks as a literal tilde — "Previous work~[citation]" should
  // read "Previous work [citation]". Only ties (a `~` glued between non-space
  // chars) convert; a spaced `~` (e.g. "approx ~5") is left alone.
  it("renders LaTeX non-breaking-space ties as spaces", () => {
    const root = render("Previous work~\\cite{wbc2024} has revealed that");

    expect(root.textContent).toBe("Previous work [citation] has revealed that");
    expect(root.textContent).not.toContain("~");
  });

  it("leaves a spaced tilde untouched (not a LaTeX tie)", () => {
    const root = render("the value is approx ~5 units");

    expect(root.textContent).toContain("approx ~5 units");
  });

  // arXiv papers define custom cross-reference macros (\fig, \tab, \eqn, …) we
  // can't enumerate. When the model quotes LaTeX source verbatim, these leak as
  // raw `\fig{fig:overview}`. The argument's `type:name` label shape is the
  // reliable signal — treat any unknown command taking only such a label as a
  // reference, like \ref / \cref.
  it("renders custom cross-reference macros with label args as reference markers", () => {
    const root = render(
      "described in the blue part in \\fig{fig:overview}, is trained to track.",
    );

    expect(root.textContent).toContain("blue part in [ref], is trained");
    expect(root.textContent).not.toContain("\\fig");
    expect(root.textContent).not.toContain("fig:overview");
  });

  // The label shape is what gates this: a custom command whose sole argument is
  // ordinary prose (not a `type:name` label) must be left untouched, not turned
  // into [ref].
  it("does not turn an unknown command with a non-label argument into a reference", () => {
    const root = render("the \\squad{soccer team} won");

    expect(root.textContent).not.toContain("[ref]");
    expect(root.textContent).toContain("soccer team");
  });

  it("renders residual LaTeX enumerate environments without source commands", () => {
    const root = render(
      [
        "> Our experiments focus on the following questions:",
        "> \\begin{enumerate}",
        "> \\item Can $\\pi_{0.5}$ generalize?",
        "> \\item How does it scale?",
        "> \\end{enumerate}",
      ].join("\n"),
    );

    expect(root.textContent).toContain("1. Can");
    expect(root.textContent).toContain("2. How");
    expect(root.textContent).not.toContain("\\begin{enumerate}");
    expect(root.textContent).not.toContain("\\item");
    expect(root.textContent).not.toContain("\\end{enumerate}");
  });

  it("renders residual LaTeX text wrappers without exposing source commands", () => {
    const root = render(
      "an action \\emph{chunk}, \\textbf{important}, and \\texttt{FAST}",
    );

    expect(root.textContent).toBe("an action chunk, important, and FAST");
    expect(root.querySelector("em")?.textContent).toBe("chunk");
    expect(root.querySelector("strong")?.textContent).toBe("important");
    expect(root.querySelector("code")?.textContent).toBe("FAST");
    expect(root.textContent).not.toContain("\\emph");
  });

  it("renders Markdown emphasis emitted by the source cleaner", () => {
    const root = render("an action *chunk*");

    expect(root.textContent).toBe("an action chunk");
    expect(root.querySelector("em")?.textContent).toBe("chunk");
  });

  // A model often writes one formula across several source lines for
  // readability. Each line is NOT its own display row: forcing them into
  // separate \begin{aligned} rows splits `\left[` from `\right]`, which is
  // invalid LaTeX. KaTeX then rejects the block and emits red `.katex-error`
  // spans — the exact symptom the user reported.
  it("renders a formula split across source lines as one valid expression", () => {
    const root = render(
      [
        "```math",
        "\\mathbb{E}_{D,\\tau,\\omega}",
        "\\left[",
        "H(x_{1:M}, f^l_\\theta(o_t,l))",
        "+",
        "\\alpha",
        "\\left\\|",
        "\\omega - a_{t:t+H}",
        "-",
        "f^a_\\theta(a^{\\tau,\\omega}_{t:t+H}, o_t, l)",
        "\\right\\|^2",
        "\\right]",
        "```",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    // KaTeX renders unparseable LaTeX as red `.katex-error` spans.
    expect(root.querySelector(".katex-error")).toBeNull();
    // The whole block is one expression — no aligned rows splitting the
    // \left/\right pairs apart.
    expect(math?.dataset.latex).not.toContain("\\begin{aligned}");
    expect(math?.dataset.latex).toContain("\\left[");
    expect(math?.dataset.latex).toContain("\\right]");
  });

  // The flip side: a genuine multi-step derivation, aligned at relations,
  // must still stack into separate \begin{aligned} rows.
  it("keeps a multi-step derivation as separate aligned rows", () => {
    const root = render(
      [
        "```math",
        "\\hat{y}_t = \\alpha x_t + \\beta",
        "= \\gamma z_t",
        "```",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
    expect(math?.dataset.latex).toContain("\\begin{aligned}");
    expect(math?.dataset.latex).toContain("\\\\");
  });

  // A relation-led line that lands INSIDE an open `\left[ ... \right]`
  // group is still a continuation, not a new row — breaking here would
  // re-tear the \left/\right pair apart.
  it("never breaks an aligned row inside an open delimiter group", () => {
    const root = render(
      [
        "```math",
        "\\left[",
        "\\sum_i x_i",
        "= S_{\\text{total}}",
        "\\right]",
        "```",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
    expect(math?.dataset.latex).not.toContain("\\begin{aligned}");
  });

  // A model often writes a formula as flat pseudo-text with Unicode Greek
  // glyphs and no braces: `fθl`, `ωt`. normalizeLatexLikeText turns each
  // glyph into a multi-letter command (`θ` → `\theta`). Without a
  // terminator, a following ASCII letter glues onto the command name:
  // `fθl` → `f\thetal`. KaTeX prints an unsupported command as its literal
  // source, so a raw `\thetal` shows up in the formula — the user-reported
  // π0.5 symptom.
  it("does not glue a Greek command onto a following letter", () => {
    const root = render(
      [
        "```text",
        "E[",
        "  H(x1:M, fθl(ot, l))",
        "  + α ||ω - at:t+H - fθa(aτ,ωt:t+H, ot, l)||²",
        "]",
        "```",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    // θ/ω were substituted into commands, never fused with the next letter.
    expect(math?.dataset.latex).toContain("\\theta");
    expect(math?.dataset.latex).toContain("\\omega");
    expect(math?.dataset.latex).not.toMatch(/\\theta[A-Za-z]/);
    expect(math?.dataset.latex).not.toMatch(/\\omega[A-Za-z]/);
    // Nothing surfaces as a raw `\command`: KaTeX prints unknown commands
    // verbatim, so a backslash in the rendered text means a glued command.
    expect(math?.textContent ?? "").not.toContain("\\");
  });

  // A model often line-breaks an inequality inside a multi-line `$$` block:
  // the relation operator (`>`) lands alone at the start of a source line.
  // The block-level scanner used to read that `>` line as a Markdown
  // blockquote, tearing the `$$...$$` block into a leaked `$$ a` paragraph,
  // an empty <blockquote>, and a `b $$` paragraph. A `>` inside an open
  // display-math block is math, not a quote.
  it("keeps a multi-line $$ block intact when a body line starts with >", () => {
    const root = render(
      [
        "于是有：",
        "",
        "$$",
        "r_t(\\theta)\\hat A_t",
        ">",
        "(1-\\epsilon)\\hat A_t",
        "$$",
        "",
        "结束。",
      ].join("\n"),
    );

    const math = root.querySelector(".math-display") as HTMLElement | null;
    expect(math).not.toBeNull();
    expect(math?.dataset.latex).toContain("r_t(\\theta)\\hat A_t");
    expect(math?.dataset.latex).toContain("(1-\\epsilon)\\hat A_t");
    // The `$$` delimiters must not leak as literal text…
    expect(root.textContent).not.toContain("$$");
    // …and the `>` line must not be misparsed into a stray blockquote.
    expect(root.querySelector("blockquote")).toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
  });
});
