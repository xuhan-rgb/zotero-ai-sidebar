import katex from "katex";

import { findNextMathRegion, normalizeLatexForKatex } from "../ui/math";
import type { FullTranslationAssetPreviews } from "./full-document-assets";
import {
  protectLatexForTranslation,
  type FullTranslationBlock,
  type FullTranslationDocument,
} from "./full-document";

export type FullTranslationPreflightStatus = "checking" | "ready" | "blocked";

export interface FullTranslationPreflightIssue {
  code:
    | "duplicate-block"
    | "translatable-formula"
    | "invalid-math"
    | "unprotected-math"
    | "raw-latex"
    | "unclaimed-figure"
    | "orphaned-figure"
    | "asset-error"
    | "dom-block"
    | "dom-formula"
    | "dom-figure"
    | "dom-table"
    | "dom-math";
  message: string;
  blockId?: string;
  sourcePath?: string;
  sourceLine?: number;
}

export interface FullTranslationPreflight {
  status: FullTranslationPreflightStatus;
  sourceHash: string;
  issues: FullTranslationPreflightIssue[];
  checkedAssets: number;
  totalAssets: number;
}

export function inspectFullTranslationSource(
  source: string,
  document: FullTranslationDocument,
): FullTranslationPreflight {
  const issues: FullTranslationPreflightIssue[] = [];
  const ids = new Set<string>();

  for (const block of document.blocks) {
    if (!block.id || ids.has(block.id)) {
      issues.push({
        code: "duplicate-block",
        message: `HTML 块 ID 重复或为空：${block.id || "(empty)"}`,
        ...(block.id ? { blockId: block.id } : {}),
      });
    }
    ids.add(block.id);
    inspectBlock(block, issues);
  }

  inspectFigureClaims(source, document, issues);
  const totalAssets = uniqueAssetPaths(document).length;
  return {
    status: issues.length ? "blocked" : "checking",
    sourceHash: document.sourceHash,
    issues,
    checkedAssets: 0,
    totalAssets,
  };
}

export async function completeFullTranslationPreflight(
  sourceCheck: FullTranslationPreflight,
  document: FullTranslationDocument,
  assets: FullTranslationAssetPreviews,
  root: HTMLElement,
): Promise<FullTranslationPreflight> {
  const issues = [...sourceCheck.issues];
  let checkedAssets = 0;

  for (const path of uniqueAssetPaths(document)) {
    const preview = assets[path];
    if (!preview?.previewUrl || preview.error) {
      issues.push({
        code: "asset-error",
        message: `${path}：${preview?.error ?? "图片尚未生成可视化预览"}`,
        sourcePath: path,
      });
      continue;
    }
    checkedAssets += 1;
  }

  await inspectRenderedDocument(document, root, issues);
  return {
    status:
      issues.length === 0 && sourceCheck.sourceHash === document.sourceHash
        ? "ready"
        : "blocked",
    sourceHash: document.sourceHash,
    issues,
    checkedAssets,
    totalAssets: uniqueAssetPaths(document).length,
  };
}

function inspectBlock(
  block: FullTranslationBlock,
  issues: FullTranslationPreflightIssue[],
): void {
  if (block.kind === "formula") {
    if (block.translatable) {
      issues.push({
        code: "translatable-formula",
        message: "独立公式不能进入翻译。",
        blockId: block.id,
      });
    }
    inspectStrictMath(block.source, true, block.id, issues);
  } else {
    inspectInlineMath(block.source, block.id, issues);
    inspectRawLatex(block.source, block.id, issues);
  }

  for (const row of block.table?.rows ?? []) {
    for (const cell of row) {
      inspectInlineMath(cell, block.id, issues);
      inspectRawLatex(cell, block.id, issues);
    }
  }

  if (!block.translatable) return;
  const protectedText = protectLatexForTranslation(block.source).text;
  if (findNextMathRegion(protectedText, 0)) {
    issues.push({
      code: "unprotected-math",
      message: "仍有公式会进入段落翻译请求。",
      blockId: block.id,
    });
  }
}

function inspectInlineMath(
  source: string,
  blockId: string,
  issues: FullTranslationPreflightIssue[],
): void {
  let cursor = 0;
  while (cursor < source.length) {
    const region = findNextMathRegion(source, cursor);
    if (!region) break;
    inspectStrictMath(region.latex, region.display, blockId, issues);
    cursor = Math.max(region.end, cursor + 1);
  }
}

function inspectStrictMath(
  source: string,
  display: boolean,
  blockId: string,
  issues: FullTranslationPreflightIssue[],
): void {
  try {
    katex.renderToString(normalizeLatexForKatex(source), {
      displayMode: display,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      output: "html",
    });
  } catch (error) {
    issues.push({
      code: "invalid-math",
      message: `公式无法生成 HTML：${errorMessage(error)}`,
      blockId,
    });
  }
}

const RAW_LAYOUT_RE =
  /\\(?:begin|end)\{(?:figure\*?|wrapfigure|floatingfigure|minipage|center|table\*?|tabular\*?|tabularx|longtable)\}|\\(?:includegraphics|caption|subcaption|captionsetup|acknowledgments|twocolumn|setlength|titlespacing|resizebox|shortstack|multirow|multicolumn|centering|vspace|hspace|Large|large|small|normalsize|par|vfill)\b|\{\s*\\bf\b/;

function inspectRawLatex(
  source: string,
  blockId: string,
  issues: FullTranslationPreflightIssue[],
): void {
  const visible = maskMath(source);
  const raw = RAW_LAYOUT_RE.exec(visible);
  if (raw) {
    issues.push({
      code: "raw-latex",
      message: `HTML 中仍有未解析的 LaTeX：${raw[0]}`,
      blockId,
    });
  }
  if (/\$(?=[^$\n]*(?:\\[A-Za-z]+|[_^]))/.test(visible)) {
    issues.push({
      code: "raw-latex",
      message: "HTML 中仍有未闭合或未识别的数学源码。",
      blockId,
    });
  }
}

function maskMath(source: string): string {
  let masked = source;
  let cursor = 0;
  while (cursor < source.length) {
    const region = findNextMathRegion(source, cursor);
    if (!region) break;
    masked =
      masked.slice(0, region.start) +
      " ".repeat(region.end - region.start) +
      masked.slice(region.end);
    cursor = Math.max(region.end, cursor + 1);
  }
  return masked;
}

function inspectFigureClaims(
  source: string,
  document: FullTranslationDocument,
  issues: FullTranslationPreflightIssue[],
): void {
  const body = documentBody(source);
  const sourcePaths: Array<{ path: string; index: number }> = [];
  const graphics = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = graphics.exec(body.text)) !== null) {
    sourcePaths.push({
      path: match[1].trim(),
      index: body.offset + match.index,
    });
  }

  const sourceCounts = occurrenceCounts(sourcePaths.map(({ path }) => path));
  const claimedCounts = occurrenceCounts(
    document.blocks.flatMap((block) => block.assets ?? []),
  );
  for (const [path, count] of sourceCounts) {
    const missing = count - (claimedCounts.get(path) ?? 0);
    if (missing <= 0) continue;
    const first = sourcePaths.find((item) => item.path === path)!;
    issues.push({
      code: "unclaimed-figure",
      message: `LaTeX 图片未进入 HTML（${missing} 次）：${path}`,
      sourcePath: path,
      sourceLine: lineNumberAt(source, first.index),
    });
  }
  for (const [path, count] of claimedCounts) {
    const extra = count - (sourceCounts.get(path) ?? 0);
    if (extra <= 0) continue;
    issues.push({
      code: "orphaned-figure",
      message: `HTML 图片与 LaTeX 源不一致（${extra} 次）：${path}`,
      sourcePath: path,
    });
  }
}

async function inspectRenderedDocument(
  document: FullTranslationDocument,
  root: HTMLElement,
  issues: FullTranslationPreflightIssue[],
): Promise<void> {
  const pendingImages: Array<{
    image: HTMLImageElement;
    item: HTMLElement;
    blockId: string;
  }> = [];
  for (const block of document.blocks) {
    const rows = Array.from(root.querySelectorAll("[data-block-id]")).filter(
      (row) => (row as HTMLElement).dataset.blockId === block.id,
    );
    if (rows.length !== 1) {
      issues.push({
        code: "dom-block",
        message: `段落 HTML 数量应为 1，实际为 ${rows.length}。`,
        blockId: block.id,
      });
      continue;
    }
    const row = rows[0] as HTMLElement;
    if (
      block.kind === "formula" &&
      (row.querySelectorAll(".zai-ft-shared-formula").length !== 1 ||
        row.querySelectorAll(".zai-ft-cell").length !== 0)
    ) {
      issues.push({
        code: "dom-formula",
        message: "独立公式没有作为单个共享 HTML 公式渲染。",
        blockId: block.id,
      });
    }
    if (block.table && row.querySelectorAll("table").length !== 1) {
      issues.push({
        code: "dom-table",
        message: "表格没有生成唯一的 HTML table。",
        blockId: block.id,
      });
    }
    const assetItems = Array.from(
      row.querySelectorAll(".zai-ft-asset[data-asset-path]"),
    ) as HTMLElement[];
    if (assetItems.length !== (block.assets?.length ?? 0)) {
      issues.push({
        code: "dom-figure",
        message: "图片 HTML 数量与 LaTeX 图片数量不一致。",
        blockId: block.id,
      });
    }
    for (const item of assetItems) {
      const image = item.querySelector("img");
      if (!image) {
        issues.push({
          code: "dom-figure",
          message: `图片没有成功解码：${item.dataset.assetPath ?? "unknown"}`,
          blockId: block.id,
          ...(item.dataset.assetPath
            ? { sourcePath: item.dataset.assetPath }
            : {}),
        });
      } else {
        pendingImages.push({ image, item, blockId: block.id });
      }
    }
  }

  const imageIssues = await Promise.all(
    pendingImages.map(async ({ image, item, blockId }) => {
      if (await imageCanRender(image)) return null;
      return {
        code: "dom-figure" as const,
        message: `图片没有成功解码：${item.dataset.assetPath ?? "unknown"}`,
        blockId,
        ...(item.dataset.assetPath
          ? { sourcePath: item.dataset.assetPath }
          : {}),
      };
    }),
  );
  for (const issue of imageIssues) {
    if (issue) issues.push(issue);
  }

  if (
    root.querySelector(".katex-error, .math-fallback, .zai-ft-block-body .math")
  ) {
    issues.push({
      code: "dom-math",
      message: "HTML 中存在公式回退或 KaTeX 错误节点。",
    });
  }
}

async function imageCanRender(image: HTMLImageElement): Promise<boolean> {
  // Zotero chrome can reject decode() for images it has already painted.
  if (image.naturalWidth > 0) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (rendered: boolean) => {
      if (settled) return;
      settled = true;
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      clearTimeout(timeoutTimer);
      resolve(rendered);
    };
    const onLoad = () => finish(image.naturalWidth > 0);
    const onError = () => finish(false);
    const poll = () => {
      if (image.naturalWidth > 0) {
        finish(true);
      } else {
        pollTimer = setTimeout(poll, 50);
      }
    };

    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    pollTimer = setTimeout(poll, 50);
    const timeoutTimer = setTimeout(
      () => finish(image.naturalWidth > 0),
      5_000,
    );

    if (typeof image.decode !== "function") return;
    try {
      void image.decode().then(
        () => finish(true),
        () => undefined,
      );
    } catch {
      // Load state remains authoritative when decode() is unavailable here.
    }
  });
}

function uniqueAssetPaths(document: FullTranslationDocument): string[] {
  return [...new Set(document.blocks.flatMap((block) => block.assets ?? []))];
}

function occurrenceCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function documentBody(source: string): { text: string; offset: number } {
  const documentStart = source.indexOf("\\begin{document}");
  const startAfterDocument =
    documentStart < 0 ? 0 : documentStart + "\\begin{document}".length;
  const maketitle = source.indexOf("\\maketitle", startAfterDocument);
  const offset =
    maketitle < 0 ? startAfterDocument : maketitle + "\\maketitle".length;
  const documentEnd = source.indexOf("\\end{document}", offset);
  return {
    text: source.slice(offset, documentEnd < 0 ? source.length : documentEnd),
    offset,
  };
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
