import type { OverviewData, OverviewSection } from "../context/overview-types";
import { renderMindmapBlock } from "./mindmap-render";

// Read-only renderer for the whole-paper overview map: a narrative section
// skeleton (each line = no + title + gist + figure/table anchors) followed by
// the structural flowchart (reusing the existing mindmap block, which already
// provides render/source tabs + copy-image). No contenteditable, so it never
// fights Zotero Reader keyboard/focus handlers.

export interface OverviewViewHandlers {
  // When provided, skeleton rows become clickable and call this on click.
  onJumpToSection?: (section: OverviewSection) => void;
}

export function renderOverviewBlock(
  doc: Document,
  data: OverviewData,
  handlers: OverviewViewHandlers = {},
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "overview-block";

  const header = doc.createElement("div");
  header.className = "overview-header";
  const title = doc.createElement("span");
  title.className = "overview-title";
  title.textContent = "📍 全文总揽";
  header.append(title);
  const meta = doc.createElement("span");
  meta.className = "overview-meta";
  meta.textContent = `${data.sections.length} 节${
    data.coverage === "uniform-fallback" ? " · 估算分段" : ""
  }`;
  header.append(meta);
  wrap.append(header);

  const list = doc.createElement("ul");
  list.className = "overview-skeleton";
  for (const section of data.sections) {
    const li = doc.createElement("li");
    li.className =
      section.level > 1 ? "overview-sec overview-sub" : "overview-sec";
    if (handlers.onJumpToSection) {
      li.classList.add("overview-jump");
      li.addEventListener("click", () => handlers.onJumpToSection!(section));
    }
    const head = doc.createElement("div");
    head.className = "overview-sec-head";
    if (section.no && section.no !== "—") {
      const no = doc.createElement("span");
      no.className = "overview-no";
      no.textContent = section.no;
      head.append(no);
    }
    const titleEl = doc.createElement("span");
    titleEl.className = "overview-sec-title";
    titleEl.textContent = section.title;
    head.append(titleEl);
    for (const anchor of section.anchors ?? []) {
      const a = doc.createElement("span");
      a.className = "overview-anchor";
      a.textContent = anchor;
      head.append(a);
    }
    li.append(head);
    if (section.gist) {
      const gist = doc.createElement("div");
      gist.className = "overview-gist";
      gist.textContent = section.gist;
      li.append(gist);
    }
    list.append(li);
  }
  wrap.append(list);

  if (data.flowchart && data.flowchart.nodes.length) {
    wrap.append(
      renderMindmapBlock(doc, { ...data.flowchart, title: "结构图纸" }),
    );
  }
  return wrap;
}
