import { describe, expect, it } from "vitest";

import {
  buildPanelPdfHtml,
  panelPdfPrintCss,
} from "../../src/modules/tab-pdf-export";

describe("note-panel PDF export", () => {
  it("builds a standalone printable note document", () => {
    const html = buildPanelPdfHtml({
      title: 'Paper <A> & "B"',
      bodyHtml: "<h1>AI 笔记</h1><p>正文</p>",
      pluginCss: ".zai-note-rich-editor{color:#24211d}",
      kind: "note",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(
      "<title>Paper &lt;A&gt; &amp; &quot;B&quot;</title>",
    );
    expect(html).toContain('class="zai-note-rich-editor zai-pdf-note"');
    expect(html).toContain("<h1>AI 笔记</h1><p>正文</p>");
    expect(html).toContain("@page");
  });

  it("builds a standalone overview document without plugin chrome", () => {
    const html = buildPanelPdfHtml({
      title: "全文总览",
      bodyHtml: '<section class="overview-block">内容</section>',
      pluginCss: ".overview-block{color:#24211d}",
      kind: "overview",
    });

    expect(html).toContain('class="zai-pdf-overview"');
    expect(html).toContain('<section class="overview-block">内容</section>');
    expect(html).not.toContain("zai-note-window-head");
  });

  it("hides controls and avoids splitting important content when printing", () => {
    const css = panelPdfPrintCss("overview");

    expect(css).toContain("button,input,textarea,select");
    expect(css).toContain("break-inside:avoid");
    expect(css).toContain("print-color-adjust:exact");
  });

  it("expands Zotero's scroll-bound note editor into a paginated document", () => {
    const css = panelPdfPrintCss("note");

    expect(css).toContain(
      "#editor-container{position:static!important;inset:auto!important;height:auto!important;overflow:visible!important}",
    );
    expect(css).toContain(
      "#editor-container .editor{position:static!important;inset:auto!important;height:auto!important;overflow:visible!important}",
    );
    expect(css).toContain(
      "#editor-container .editor .editor-core{display:block!important;flex:none!important;height:auto!important;overflow:visible!important}",
    );
    expect(css).toContain(
      "#editor-container .editor .editor-core .primary-editor{display:block!important;min-height:0!important;height:auto!important;overflow:visible!important}",
    );
  });
});
