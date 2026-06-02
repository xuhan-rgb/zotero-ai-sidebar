import type {
  OverviewData,
  OverviewPhase,
  OverviewSection,
} from "../context/overview-types";
import { renderMindmapBlock } from "./mindmap-render";

// Read-only renderer for the whole-paper overview (lean redesign):
//   核心讲述 → ✦-标注的章节骨架（三阶段 · gist · 创新/效果/淡）→ 折叠的结构图纸
// The sticky header carries the reading-anchor controls: ↶返回 (back stack),
// ↩在读 (jump-to-anchor), 🔓/🔒 (lock the anchor). No contenteditable, so it
// never fights Zotero Reader keyboard handlers.

// Session-scoped reading navigation. The view MUTATES this object in place; the
// sidebar owns it so state (anchor / browse cursor / back stack / lock) survives
// view re-renders. NOT persisted to disk — resets on Zotero restart.
export interface OverviewNavState {
  readingNo?: string; // the sticky 在读 anchor (solid ring + 在读 pill)
  browseNo?: string; // dashed browse cursor — only meaningful while locked
  history: string[]; // back stack of positions left behind (capped by maxBack)
  locked: boolean; // 🔒 pin the anchor: clicks jump only, never move 在读
}

export interface OverviewViewHandlers {
  // When provided, skeleton rows + flowchart-node detail become click-to-jump.
  onJumpToSection?: (section: OverviewSection) => void;
  // When provided, a header button exports + opens the overview in a browser.
  onOpenInBrowser?: () => void;
  // Session-scoped nav state (anchor / browse cursor / back stack / lock).
  nav?: OverviewNavState;
  // Back-stack cap (policy constant). Defaults to 10.
  maxBack?: number;
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

// Per-row wiring shared with renderSectionItem / renderFlowchart.
interface RowCtx {
  canJump: boolean;
  register: (no: string, el: HTMLElement) => void;
  jump: (section: OverviewSection) => void;
}

// A dotted section number ("4.1", "5.2.1") is the authoritative subsection
// signal: nest it under the most recent top-level section whose number is its
// prefix. We trust the NUMBER over the model-provided `level`, which is
// unreliable (some papers come back with level=1 for clearly-dotted
// subsections). Fall back to `level` only when there is no usable number.
function isSubNumberOf(childNo: string, parentNo: string): boolean {
  if (!parentNo || parentNo === "—") return false;
  return childNo.startsWith(`${parentNo}.`);
}

function buildTree(sections: OverviewSection[]): SectionNode[] {
  const tree: SectionNode[] = [];
  for (const section of sections) {
    const top = tree.length ? tree[tree.length - 1] : null;
    const hasNo = !!section.no && section.no !== "—";
    const isChild =
      top != null &&
      (isSubNumberOf(section.no, top.section.no) ||
        (!hasNo && section.level > 1));
    if (isChild) {
      top!.children.push(section);
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

  const nav: OverviewNavState = handlers.nav ?? { history: [], locked: false };
  const maxBack = handlers.maxBack ?? 10;
  const canJump = !!handlers.onJumpToSection;
  const rowMap = new Map<string, HTMLElement>();
  const sectionByNo = (no?: string): OverviewSection | undefined =>
    no == null ? undefined : data.sections.find((s) => s.no === no);

  // ── sticky header ──
  const header = doc.createElement("div");
  header.className = "overview-header";
  const title = doc.createElement("span");
  title.className = "overview-title";
  title.textContent = "📍 全文总览";

  const right = doc.createElement("span");
  right.className = "overview-head-right";

  if (handlers.onOpenInBrowser) {
    const openBtn = doc.createElement("button");
    openBtn.className = "overview-open-browser";
    openBtn.textContent = "↗ 浏览器";
    openBtn.title = "在浏览器中打开完整总览";
    openBtn.addEventListener("click", () => handlers.onOpenInBrowser!());
    right.append(openBtn);
  }
  // Chapter count — shown only while nothing is 在读.
  const meta = doc.createElement("span");
  meta.className = "overview-meta";
  meta.textContent = `${data.sections.length} 章${
    data.coverage === "uniform-fallback" ? " · 估算分段" : ""
  }`;
  // ↶ 返回 (back stack).
  const backBtn = doc.createElement("button");
  backBtn.className = "overview-back";
  // ↩ 在读 control (label + lock toggle).
  const readingCtl = doc.createElement("span");
  readingCtl.className = "overview-reading";
  const readingLabel = doc.createElement("span");
  readingLabel.className = "overview-reading-label";
  const lockBtn = doc.createElement("span");
  lockBtn.className = "overview-lock";
  readingCtl.append(readingLabel, lockBtn);
  right.append(meta, backBtn, readingCtl);
  header.append(title, right);
  wrap.append(header);

  // ── nav controller (mutates `nav` in place; updates DOM live) ──
  const rowEl = (no?: string) => (no ? rowMap.get(no) : undefined);
  const scrollToRow = (no?: string): void => {
    const el = rowEl(no);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };
  // Where a click currently "is": the browse cursor while locked, else 在读.
  const cur = (): string | undefined =>
    nav.locked ? nav.browseNo ?? nav.readingNo : nav.readingNo;
  const setCur = (no: string): void => {
    if (nav.locked) nav.browseNo = no === nav.readingNo ? undefined : no;
    else {
      nav.readingNo = no;
      nav.browseNo = undefined;
    }
  };
  const pushHistory = (no?: string): void => {
    if (no == null) return;
    nav.history.push(no);
    while (nav.history.length > maxBack) nav.history.shift();
  };
  const applyMarkers = (): void => {
    wrap
      .querySelectorAll(".is-reading, .is-browsing")
      .forEach((x: Element) => x.classList.remove("is-reading", "is-browsing"));
    rowEl(nav.readingNo)?.classList.add("is-reading");
    if (nav.locked && nav.browseNo && nav.browseNo !== nav.readingNo) {
      rowEl(nav.browseNo)?.classList.add("is-browsing");
    }
  };
  const applyHeader = (): void => {
    const reading = sectionByNo(nav.readingNo);
    if (reading) {
      meta.style.display = "none";
      readingCtl.style.display = "";
      readingCtl.classList.toggle("locked", nav.locked);
      readingLabel.textContent = `↩ 在读 ${reading.no}`;
      readingCtl.title = `回到正在读的章节：${reading.no} ${reading.title}`;
      lockBtn.textContent = nav.locked ? "🔒" : "🔓";
      lockBtn.title = nav.locked
        ? "已锁定：点别的章节只跳 PDF、不改在读。点此解锁"
        : "钉死在读锚点：之后点别的章节只跳转、不改在读";
    } else {
      meta.style.display = "";
      readingCtl.style.display = "none";
    }
    if (nav.history.length) {
      backBtn.style.display = "";
      backBtn.textContent = `↶ 返回 ${nav.history[nav.history.length - 1]}`;
      backBtn.title = "退回上一处（同时跳 PDF）";
    } else {
      backBtn.style.display = "none";
    }
  };
  const jump = (section: OverviewSection): void => {
    const from = cur();
    if (section.no !== from) pushHistory(from);
    setCur(section.no);
    applyMarkers();
    applyHeader();
    handlers.onJumpToSection?.(section);
  };

  backBtn.addEventListener("click", () => {
    if (!nav.history.length) return;
    const prev = nav.history.pop()!;
    setCur(prev);
    applyMarkers();
    applyHeader();
    scrollToRow(prev);
    const s = sectionByNo(prev);
    if (s) handlers.onJumpToSection?.(s);
  });
  readingLabel.addEventListener("click", () => {
    scrollToRow(nav.readingNo);
    const s = sectionByNo(nav.readingNo);
    if (s) handlers.onJumpToSection?.(s);
  });
  lockBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    nav.locked = !nav.locked;
    if (!nav.locked) nav.browseNo = undefined;
    applyMarkers();
    applyHeader();
  });

  const ctx: RowCtx = {
    canJump,
    register: (no, el) => rowMap.set(no, el),
    jump,
  };

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
    list!.append(renderSectionItem(doc, node, ctx));
  }

  if (data.flowchart && data.flowchart.nodes.length) {
    wrap.append(renderFlowchart(doc, data, ctx));
  }

  applyMarkers();
  applyHeader();
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
  ctx: RowCtx,
): HTMLElement {
  const { section, children } = node;
  const li = doc.createElement("li");
  li.className = "overview-sec" + emphasisClass(section);
  li.setAttribute("data-section-no", section.no);

  const head = doc.createElement("div");
  head.className = "overview-sec-head";

  let caretEl: HTMLElement | undefined;
  if (children.length) {
    caretEl = doc.createElement("span");
    caretEl.className = "overview-caret";
    caretEl.textContent = "▸";
    head.append(caretEl);
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
  // Wrap the section's OWN row (head + gist) so hover/selection/emphasis target
  // only this row — they must NOT bleed behind the subsection list.
  const main = doc.createElement("div");
  main.className = "overview-sec-main";
  main.append(head);
  if (section.gist) {
    const gist = doc.createElement("div");
    gist.className = "overview-gist";
    gist.textContent = section.gist;
    main.append(gist);
  }
  // Click rule: the caret toggles the subsections; clicking the row itself
  // jumps to the PDF — parents jump too, not only expand. Leaves just jump.
  if (children.length && caretEl) {
    caretEl.addEventListener("click", (e) => {
      e.stopPropagation();
      li.classList.toggle("open");
    });
  }
  if (ctx.canJump) {
    main.classList.add("overview-clickable", "overview-jump");
    ctx.register(section.no, main);
    main.addEventListener("click", () => ctx.jump(section));
  } else if (children.length) {
    // No jump handler (e.g. static export) → clicking the row toggles instead.
    main.classList.add("overview-clickable");
    main.addEventListener("click", () => li.classList.toggle("open"));
  }
  li.append(main);

  if (children.length) {
    const kids = doc.createElement("ul");
    kids.className = "overview-kids";
    for (const child of children) {
      const cli = doc.createElement("li");
      cli.className = "overview-kid" + emphasisClass(child);
      cli.setAttribute("data-section-no", child.no);
      if (ctx.canJump) {
        cli.classList.add("overview-jump");
        ctx.register(child.no, cli);
        cli.addEventListener("click", () => ctx.jump(child));
      }
      if (child.emphasis === "innovation") {
        const star = doc.createElement("span");
        star.className = "overview-star";
        star.textContent = "✦";
        cli.append(star);
      }
      const cn = doc.createElement("span");
      cn.className = "overview-kid-no";
      cn.textContent = child.no;
      const ct = doc.createElement("span");
      ct.className = "overview-kid-title";
      ct.textContent = child.title;
      cli.append(cn, ct);
      const chip = emphasisChip(doc, child);
      if (chip) cli.append(chip);
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
  ctx: RowCtx,
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
  hint.textContent = "点击展开 · 点节点看解释 · 滚轮缩放/拖动";
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
  if (ctx.canJump) {
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
      if (jumpBtn && section && ctx.canJump) {
        jumpBtn.onclick = () => ctx.jump(section);
      }
    });
  });

  card.append(body);
  return card;
}
