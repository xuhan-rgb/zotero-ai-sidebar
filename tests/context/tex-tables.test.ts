import { describe, expect, it } from "vitest";
import {
  annotateNumberedTables,
  findTable,
  parseTables,
  plainTableCaption,
} from "../../src/context/tex-tables";

describe("parseTables", () => {
  it("indexes table environments with captions, labels, and tabular source", () => {
    const text = [
      "\\section{Results}",
      "\\begin{table*}[t]",
      "\\caption{Comparisons among range view methods on SemanticKITTI.}",
      "\\label{tab:range-view}",
      "\\centering",
      "\\begin{tabular}{c|c}",
      "Method & mIoU \\\\",
      "RangeFormer & 73.3 \\\\",
      "\\end{tabular}",
      "\\end{table*}",
    ].join("\n");

    const tables = parseTables(text);

    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      number: 1,
      env: "table*",
      label: "tab:range-view",
    });
    expect(tables[0].tabularTex).toContain("RangeFormer");
    expect(plainTableCaption(tables[0])).toBe(
      "Comparisons among range view methods on SemanticKITTI.",
    );
    expect(findTable(tables, { number: 1 })?.label).toBe("tab:range-view");
    expect(findTable(tables, { name: "semantic" })?.number).toBe(1);
  });

  it("keeps the complete outer tabular when cells contain nested tabulars", () => {
    const text = String.raw`\begin{table}
\begin{tabular}{cc}
\footnotesize{\begin{tabular}[c]{c}Grasps\\ / scene\end{tabular}} & Score \\
Ours & 98\% \\
\end{tabular}
\caption{Nested header.}
\end{table}`;

    const [table] = parseTables(text);

    expect(table.tabularTex).toContain("Ours & 98\\%");
    expect(table.tabularTex?.match(/\\end\{tabular\}/g)).toHaveLength(2);
  });

  it("counts multiple captions in one table environment as separate tables", () => {
    const text = [
      "\\begin{table*}",
      "\\begin{minipage}{0.45\\linewidth}",
      "\\begin{tabular}{cc}A & B\\end{tabular}",
      "\\caption{Semantic segmentation results.}",
      "\\label{tab:semantic}",
      "\\end{minipage}",
      "\\begin{minipage}{0.45\\linewidth}",
      "\\begin{tabular}{cc}C & D\\end{tabular}",
      "\\caption{Panoptic segmentation results.}",
      "\\label{tab:panoptic}",
      "\\end{minipage}",
      "\\end{table*}",
    ].join("\n");

    const tables = parseTables(text);

    expect(tables.map((table) => table.number)).toEqual([1, 2]);
    expect(tables[0].caption).toContain("Semantic segmentation");
    expect(tables[0].tex).not.toContain("Panoptic segmentation");
    expect(tables[1].caption).toContain("Panoptic segmentation");
    expect(tables[1].label).toBe("tab:panoptic");
  });

  it("adds visible table-number markers before table chunks", () => {
    const text = [
      "\\begin{table}",
      "\\caption{Ablation.}",
      "\\begin{tabular}{c}A\\end{tabular}",
      "\\end{table}",
    ].join("\n");

    const out = annotateNumberedTables(text);

    expect(out).toContain("[Table (1) caption=Ablation.]");
    expect(out.indexOf("[Table (1)")).toBeLessThan(
      out.indexOf("\\begin{table}"),
    );
  });

  it("preserves grouping braces inside caption math", () => {
    const [table] = parseTables(String.raw`\begin{table}
\caption{Velocity $\dot{\mathbf{q}}$ and distance $\mathbf{d}_{\text{obj}}$.}
\begin{tabular}{c}Value\end{tabular}
\end{table}`);

    expect(plainTableCaption(table)).toBe(
      String.raw`Velocity $\dot{\mathbf{q}}$ and distance $\mathbf{d}_{\text{obj}}$.`,
    );
  });
});
