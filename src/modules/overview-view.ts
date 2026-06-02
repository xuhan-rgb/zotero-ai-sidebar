import type {
  OverviewData,
  OverviewPhase,
  OverviewSection,
} from "../context/overview-types";
import { renderMindmapBlock } from "./mindmap-render";

// Read-only renderer for the whole-paper overview (lean redesign):
//   核心讲述 → ✦-标注的章节骨架（三阶段 · gist · 创新/效果/淡）→ 折叠的结构图纸
// One skeleton is the single source of truth (no separate contributions list);
// the folded flowchart's nodes link back to a section's gist via sectionNo.
// No contenteditable, so it never fights Zotero Reader keyboard handlers.

export interface OverviewViewHandlers {
  // When provided, skeleton rows + flowchart-node detail become click-to-jump.
  onJumpToSection?: (section: OverviewSection) => void;
  // When provided, a header button exports + opens the overview in a browser.
  onOpenInBrowser?: () => void;
}

const PHASES: Array<{ key: OverviewPhase; badge: string; name: string }> = [
  { key: "motivation", badge: "①", name: "动机与背景" },
  { key: "method", badge: "②", name: "方法" },
  { key: "validation", badge: "③", name: "验证与结论" },
];

interface SectionNode {
  section: OverviewSection;
  children: OverviewSection[];
}

// Group level>1 sections under the preceding level-1 section (document order).
function buildTree(sections: OverviewSection[]): SectionNode[] {
  const tree: SectionNode[] = [];
  for (const section of sections) {
    if (section.level > 1 && tree.length) {
      tree[tree.length - 1].children.push(section);
    } else {
      tree.push({ section, children: [] });
    }
  }
  return tree;
}

function emphasisClass(section: OverviewSection): string {
  switch (section.emphasis) {
    case "innovation":
      return " is-innovation";
    case "result":
      return " is-result";
    case "background":
      return " is-background";
    default:
      return "";
  }
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
  if (handlers.onOpenInBrowser) {
    const openBtn = doc.createElement("button");
    openBtn.className = "overview-open-browser";
    openBtn.textContent = "↗ 浏览器";
    openBtn.title = "在浏览器中打开完整总揽";
    openBtn.addEventListener("click", () => handlers.onOpenInBrowser!());
    header.append(openBtn);
  }
  const meta = doc.createElement("span");
  meta.className = "overview-meta";
  meta.textContent = `${data.sections.length} 章${
    data.coverage === "uniform-fallback" ? " · 估算分段" : ""
  }`;
  header.append(meta);
  wrap.append(header);

  if (data.narrative) {
    const nar = doc.createElement("div");
    nar.className = "overview-narrative";
    const lab = doc.createElement("div");
    lab.className = "overview-narrative-label";
    lab.textContent = "✦ 核心讲述";
    const body = doc.createElement("div");
    body.className = "overview-narrative-body";
    body.textContent = data.narrative;
    nar.append(lab, body);
    wrap.append(nar);
  }

  // Skeleton grouped by phase (document order; emit a band when phase changes).
  const tree = buildTree(data.sections);
  let list: HTMLUListElement | null = null;
  let prevPhase: OverviewPhase | undefined;
  let started = false;
  for (const node of tree) {
    const phase = node.section.phase;
    if (!started || phase !== prevPhase) {
      started = true;
      prevPhase = phase;
      wrap.append(phaseBand(doc, phase));
      list = doc.createElement("ul");
      list.className = "overview-skeleton";
      wrap.append(list);
    }
    list!.append(renderSectionItem(doc, node, handlers));
  }

  if (data.flowchart && data.flowchart.nodes.length) {
    wrap.append(renderFlowchart(doc, data, handlers));
  }

  return wrap;
}

function phaseBand(
  doc: Document,
  phase: OverviewPhase | undefined,
): HTMLElement {
  const def = PHASES.find((p) => p.key === phase);
  const band = doc.createElement("div");
  band.className = "overview-phase";
  const badge = doc.createElement("span");
  badge.className = "overview-phase-badge";
  badge.textContent = def?.badge ?? "·";
  const name = doc.createElement("span");
  name.className = "overview-phase-name";
  name.textContent = def?.name ?? "其他";
  band.append(badge, name);
  return band;
}

function emphasisChip(
  doc: Document,
  section: OverviewSection,
): HTMLElement | null {
  if (section.emphasis === "innovation") {
    const chip = doc.createElement("span");
    chip.className = "overview-chip overview-chip-innov";
    chip.textContent = "创新";
    return chip;
  }
  if (section.emphasis === "result") {
    const chip = doc.createElement("span");
    chip.className = "overview-chip overview-chip-result";
    chip.textContent = "效果锚点";
    return chip;
  }
  return null;
}

function renderSectionItem(
  doc: Document,
  node: SectionNode,
  handlers: OverviewViewHandlers,
): HTMLElement {
  const { section, children } = node;
  const li = doc.createElement("li");
  li.className = "overview-sec" + emphasisClass(section);
  li.setAttribute("data-section-no", section.no);

  const head = doc.createElement("div");
  head.className = "overview-sec-head";

  if (children.length) {
    const caret = doc.createElement("span");
    caret.className = "overview-caret";
    caret.textContent = "▸";
    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      li.classList.toggle("open");
    });
    head.append(caret);
  }
  if (section.emphasis === "innovation") {
    const star = doc.createElement("span");
    star.className = "overview-star";
    star.textContent = "✦";
    head.append(star);
  }
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
  const chip = emphasisChip(doc, section);
  if (chip) head.append(chip);
  for (const anchor of section.anchors ?? []) {
    const an = doc.createElement("span");
    an.className = "overview-anchor";
    an.textContent = anchor;
    head.append(an);
  }
  if (handlers.onJumpToSection) {
    li.classList.add("overview-jump");
    head.addEventListener("click", () => handlers.onJumpToSection!(section));
  }
  li.append(head);

  if (section.gist) {
    const gist = doc.createElement("div");
    gist.className = "overview-gist";
    gist.textContent = section.gist;
    li.append(gist);
  }

  if (children.length) {
    const kids = doc.createElement("ul");
    kids.className = "overview-kids";
    for (const child of children) {
      const cli = doc.createElement("li");
      cli.className = "overview-kid";
      if (handlers.onJumpToSection) {
        cli.classList.add("overview-jump");
        cli.addEventListener("click", () => handlers.onJumpToSection!(child));
      }
      const cn = doc.createElement("span");
      cn.className = "overview-kid-no";
      cn.textContent = child.no;
      const ct = doc.createElement("span");
      ct.className = "overview-kid-title";
      ct.textContent = child.title;
      cli.append(cn, ct);
      if (child.gist) {
        const cg = doc.createElement("div");
        cg.className = "overview-kid-gist";
        cg.textContent = child.gist;
        cli.append(cg);
      }
      kids.append(cli);
    }
    li.append(kids);
  }
  return li;
}

// Folded structural flowchart. Clicking a node fills the explanation strip
// BELOW the diagram (never a popover over it) with that section's gist.
function renderFlowchart(
  doc: Document,
  data: OverviewData,
  handlers: OverviewViewHandlers,
): HTMLElement {
  const card = doc.createElement("div");
  card.className = "overview-fig";

  const head = doc.createElement("div");
  head.className = "overview-fig-head";
  const caret = doc.createElement("span");
  caret.className = "overview-caret";
  caret.textContent = "▸";
  const figTitle = doc.createElement("span");
  figTitle.className = "overview-fig-title";
  figTitle.textContent = "📐 结构图纸";
  const hint = doc.createElement("span");
  hint.className = "overview-fig-hint";
  hint.textContent = "点击展开 · 点节点看解释";
  head.append(caret, figTitle, hint);
  head.addEventListener("click", () => card.classList.toggle("open"));
  card.append(head);

  const body = doc.createElement("div");
  body.className = "overview-fig-body";
  const block = renderMindmapBlock(doc, { ...data.flowchart!, title: "" });
  body.append(block);

  const detail = doc.createElement("div");
  detail.className = "overview-node-detail";
  const dHint = doc.createElement("div");
  dHint.className = "overview-nd-hint";
  dHint.textContent = "▸ 点上方任一节点，这里显示它的解释（不遮挡图）";
  const dContent = doc.createElement("div");
  dContent.className = "overview-nd-content";
  dContent.style.display = "none";
  const dTitle = doc.createElement("div");
  dTitle.className = "overview-nd-title";
  const dGist = doc.createElement("div");
  dGist.className = "overview-nd-gist";
  dContent.append(dTitle, dGist);
  let jumpBtn: HTMLButtonElement | null = null;
  if (handlers.onJumpToSection) {
    const acts = doc.createElement("div");
    acts.className = "overview-nd-acts";
    jumpBtn = doc.createElement("button");
    jumpBtn.textContent = "跳到 PDF";
    acts.append(jumpBtn);
    dContent.append(acts);
  }
  detail.append(dHint, dContent);
  body.append(detail);

  const nodes = block.querySelectorAll(".zai-mm-node[data-section-no]");
  nodes.forEach((nodeEl: Element) => {
    nodeEl.addEventListener("click", () => {
      const no = nodeEl.getAttribute("data-section-no");
      const section = data.sections.find((s) => s.no === no);
      block
        .querySelectorAll(".zai-mm-node.zai-mm-sel")
        .forEach((x: Element) => x.classList.remove("zai-mm-sel"));
      nodeEl.classList.add("zai-mm-sel");
      dTitle.textContent = `§${no ?? ""}  ${section?.title ?? ""}`;
      dGist.textContent = section?.gist ?? "（该节点无对应章节解释）";
      dHint.style.display = "none";
      dContent.style.display = "block";
      if (jumpBtn && section && handlers.onJumpToSection) {
        jumpBtn.onclick = () => handlers.onJumpToSection!(section);
      }
    });
  });

  card.append(body);
  return card;
}
