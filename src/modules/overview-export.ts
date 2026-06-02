import type { OverviewData } from "../context/overview-types";
import { renderOverviewBlock } from "./overview-view";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Build a self-contained HTML document of the current overview for opening in
// the system browser. Reuses the live renderer (same DOM/SVG the panel shows),
// expands every section + the flowchart so the static page needs no JS, and
// inlines the collected plugin CSS (plus concrete --zai-* fallbacks) so it
// looks the same outside Zotero.
export function buildOverviewExportHtml(
  doc: Document,
  data: OverviewData,
  css: string,
): string {
  const block = renderOverviewBlock(doc, data);
  block
    .querySelectorAll(".overview-sec, .overview-fig")
    .forEach((e: Element) => e.classList.add("open"));
  const title = data.title ? escapeHtml(data.title) : "全文总揽";
  return [
    "<!DOCTYPE html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title} · 全文总揽</title>`,
    "<style>",
    ":root{--zai-bg:#fffdf8;--zai-bg-soft:#fbfaf7;--zai-panel-strong:#fbf7f0;",
    "--zai-text:#24211d;--zai-text-muted:#6b6357;--zai-border:#e3d8c8;",
    "--zai-accent:#c0673d;--zai-accent-soft:#fff0e7;--zai-accent-strong:#a94e25;",
    "--zai-font:-apple-system,'Noto Sans CJK SC','PingFang SC',sans-serif;}",
    "body{margin:0;background:radial-gradient(900px 420px at 50% -120px,#fff7ec,transparent),#efe7da;",
    "font-family:var(--zai-font);padding:28px 18px 60px}",
    ".zai-overview-export{max-width:760px;margin:0 auto;background:var(--zai-bg);",
    "border:1px solid var(--zai-border);border-radius:14px;",
    "box-shadow:0 10px 34px rgba(60,40,20,.16);padding:6px 14px 18px}",
    css,
    "</style></head><body>",
    `<div class="zai-overview-export">${block.outerHTML}</div>`,
    "</body></html>",
  ].join("\n");
}
