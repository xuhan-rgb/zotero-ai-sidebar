import { el } from "./dom-utils";
import { latexMaterialPreview } from "./latex-preview";
import type { PaperFigure, PaperFigureKind } from "./paper-figures";

/**
 * What a page click meant while picking: `picked` attached a material, `miss`
 * landed on a boxed paper but not on a box, and `unpickable` landed on a paper
 * whose material has no PDF position at all (LaTeX source), where no click
 * could ever pick — the caller is expected to say so out loud.
 */
export type PagePickResult = "picked" | "miss" | "unpickable";

export interface FigurePickerDeps {
  doc: Document;
  input: HTMLTextAreaElement;
  load(): Promise<PaperFigure[]>;
  preview(figure: PaperFigure): Promise<string | null>;
  pick(figure: PaperFigure): void;
  afterPick?(): void;
  /** 0-based page the PDF reader currently shows, when it is known. */
  currentPage?(): number | null;
  /**
   * Pointer entered a row: show where that figure sits in the PDF. Must not
   * touch the composer or the reader selection — the menu is a preview only.
   */
  hover?(figure: PaperFigure): void;
  /** Pointer left the rows, or the menu closed. */
  hoverEnd?(): void;
  /**
   * While the menu is open, the pages become a pick surface. `onPick` gets the
   * 0-based page and the click normalized to 0..1000 (top-left origin, the
   * convention MinerU writes) and answers whether it consumed a material; every
   * other page click is consumed too, so browsing material never starts a text
   * selection by accident. Returns the disposer that gives the pages back to
   * the reader when the menu closes.
   */
  watchPdf?(
    onPick: (pageIndex: number, x: number, y: number) => PagePickResult,
    /** Pointer moved over a reader page while picking is active; the picker answers whether a material is under it. */
    onHover?: (pageIndex: number, x: number, y: number) => void,
    /** `null` when no reader page could be watched yet, so arming can retry later. */
  ): (() => void) | null;
  /**
   * The menu showed or hid. The composer mirrors this on its 素材 chip, which
   * has no other way to learn that a click opened the list.
   */
  onVisibilityChange?(open: boolean): void;
}

export interface FigurePicker {
  menu: HTMLElement;
  /** Re-reads the `@` token and repaints the menu. */
  refresh(): void;
  /** Opens the menu without an `@` token (the composer `＋` entry). */
  open(): void;
  /**
   * Arms click-to-pick over the left PDF without showing the menu, so the
   * composer chip can light up and the reader stays unobstructed.
   */
  arm(): void;
  /** Leaves the click-to-pick mode (clicking the chip again, or picking). */
  disarm(): void;
  /**
   * Closed from the composer (the 素材 chip, or Esc): the half-typed mention
   * goes with the list, so no `@` is left behind to reopen it.
   */
  dismiss(): void;
  /** Returns true while click-to-pick is armed. */
  isArmed(): boolean;
  /**
   * Resolves true when the loaded material carries PDF boxes, so click-to-pick
   * on the page can actually hit something. LaTeX-sourced papers resolve false.
   */
  canPickOnPdf(): Promise<boolean>;
  /** Returns true when the key was consumed by the open menu. */
  onKeydown(event: KeyboardEvent): boolean;
  /** Returns true when the menu is currently visible. */
  isOpen(): boolean;
}

interface MentionTarget {
  start: number;
  end: number;
  query: string;
}

/** `page` = what the reader shows now; the rest match one material kind. */
type FigureFilter = "page" | "all" | PaperFigureKind;

interface FilterChip {
  id: FigureFilter;
  text: string;
}

const MAX_VISIBLE = 6;
/** How often the open menu checks whether the reader scrolled to another page. */
const PAGE_WATCH_MS = 400;
const KIND_LABELS: Array<[PaperFigureKind, string]> = [
  ["figure", "图片"],
  ["table", "表格"],
  ["equation", "公式"],
];

export function createFigurePicker(deps: FigurePickerDeps): FigurePicker {
  const { doc, input } = deps;
  const menu = el(doc, "div", "figure-menu");
  menu.style.display = "none";

  const previews = new Map<string, string | null>();
  /** Rendered LaTeX previews, built once per item and cloned on every repaint. */
  const latexPreviews = new Map<string, HTMLElement | null>();
  let figures: PaperFigure[] | null = null;
  let loading = false;
  let failed = false;
  let filter: FigureFilter | null = null;
  /** True once the user picked a chip; the 本页 default only applies until then. */
  let filterPinned = false;
  let matches: PaperFigure[] = [];
  let selected = 0;
  let pageWatch: ReturnType<typeof setInterval> | null = null;
  let watchedPage: number | null = null;
  let pdfWatch: (() => void) | null = null;
  /** `＋` menu opened the picker without an `@` token in the input. */
  let forcedOpen = false;
  /** Chip-only mode: pick on the PDF while the menu stays hidden. */
  let pdfOnly = false;
  let visible = false;

  const setVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    deps.onVisibilityChange?.(next);
  };

  const hide = () => {
    forcedOpen = false;
    pdfOnly = false;
    filter = null;
    filterPinned = false;
    stopPageWatch();
    stopPdfWatch();
    menu.style.display = "none";
    menu.replaceChildren();
    matches = [];
    setVisible(false);
    deps.hoverEnd?.();
  };

  const preview = (figure: PaperFigure): Promise<string | null> => {
    const cached = previews.get(figure.id);
    if (cached !== undefined) return Promise.resolve(cached);
    return deps.preview(figure).then((url) => {
      previews.set(figure.id, url);
      return url;
    });
  };

  const latexPreview = (figure: PaperFigure): HTMLElement | null => {
    const cached = latexPreviews.get(figure.id);
    if (cached !== undefined) return cached;
    const node = buildLatexPreview(doc, figure);
    latexPreviews.set(figure.id, node);
    return node;
  };

  const currentPage = (): number | null => {
    try {
      return deps.currentPage?.() ?? null;
    } catch {
      return null;
    }
  };

  // The reader keeps scrolling under the open menu, so the page the list calls
  // 本页 has to follow it instead of freezing when `@` was typed.
  const stopPageWatch = () => {
    if (pageWatch == null) return;
    clearInterval(pageWatch);
    pageWatch = null;
  };

  const startPageWatch = () => {
    if (pageWatch != null || !menu.isConnected) return;
    watchedPage = currentPage();
    pageWatch = setInterval(() => {
      // A re-render replaces this picker; the detached menu must stop polling.
      if (!menu.isConnected) return stopPageWatch();
      const page = currentPage();
      if (page === watchedPage) return;
      watchedPage = page;
      paint();
    }, PAGE_WATCH_MS);
  };

  // `@` + click on the left PDF: the smallest parsed box under the pointer wins,
  // so a formula sitting inside a figure's box still picks the formula. Only the
  // three material kinds carry a bbox, so a click on plain text hits nothing.
  const figureAtPoint = (
    pageIndex: number,
    x: number,
    y: number,
  ): PaperFigure | null => {
    let best: PaperFigure | null = null;
    let bestArea = Infinity;
    for (const figure of figures ?? []) {
      const bbox = figure.bbox;
      if (!bbox || figure.page !== pageIndex) continue;
      const [left, top, right, bottom] = bbox;
      if (x < left || x > right || y < top || y > bottom) continue;
      const area = (right - left) * (bottom - top);
      if (area < bestArea) {
        bestArea = area;
        best = figure;
      }
    }
    return best;
  };

  const stopPdfWatch = () => {
    pdfWatch?.();
    pdfWatch = null;
  };

  const startPdfWatch = () => {
    if (pdfWatch != null || !deps.watchPdf || !menu.isConnected) return;
    let lastHoveredId: string | null = null;
    pdfWatch =
      deps.watchPdf(
        (pageIndex, x, y) => {
          const figure = figureAtPoint(pageIndex, x, y);
          if (figure) {
            pick(figure);
            return "picked";
          }
          const loaded = figures;
          return loaded && !loaded.some((entry) => entry.bbox)
            ? "unpickable"
            : "miss";
        },
        (pageIndex, x, y) => {
          const figure = figureAtPoint(pageIndex, x, y);
          if (figure && figure.id !== lastHoveredId) {
            deps.hover?.(figure);
            lastHoveredId = figure.id;
          } else if (!figure && lastHoveredId !== null) {
            deps.hoverEnd?.();
            lastHoveredId = null;
          }
        },
      ) ?? null;
  };

  // The click-to-pick mode is invisible otherwise, so say it is available —
  // and only when there is at least one boxed item to hit.
  const pdfPickHint = (): string =>
    deps.watchPdf && (figures ?? []).some((figure) => figure.bbox)
      ? "；也可在左侧 PDF 直接点击公式/图片/表格"
      : figures?.length
        ? "；这类素材没有 PDF 位置（LaTeX 源），直接在列表里选（左侧 PDF 不响应点击）"
        : "";

  const chipsFor = (list: PaperFigure[], page: number | null): FilterChip[] => {
    const chips: FilterChip[] = [];
    if (page != null) {
      // 本页 is the default scope, so the chip stays in the row even when the
      // page holds nothing: `本页 0` is what explains the empty list, and the
      // user cannot pick a scope that was never offered.
      const onPage = list.filter((figure) => figureOnPage(figure, page)).length;
      chips.push({ id: "page", text: `本页 ${onPage}` });
    }
    chips.push({ id: "all", text: `全部 ${list.length}` });
    for (const [kind, label] of KIND_LABELS) {
      const count = list.filter((figure) => figure.kind === kind).length;
      if (count) chips.push({ id: kind, text: `${label} ${count}` });
    }
    return chips;
  };

  // The chip row is the menu's header: it pins to the top of the scrolling
  // list so the scope switcher and its active state never scroll out of view.
  const renderChipBar = (chips: FilterChip[]): HTMLElement => {
    const bar = el(doc, "div", "figure-menu-filters");
    for (const chip of chips) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "figure-chip";
      if (chip.id === filter) button.classList.add("figure-chip-active");
      button.textContent = chip.text;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        filter = chip.id;
        filterPinned = true;
        selected = 0;
        paint();
      });
      bar.append(button);
    }
    return bar;
  };

  const renderFootNote = (
    pool: PaperFigure[],
    page: number | null,
  ): HTMLElement => {
    // No page on any row means the reader text never arrived (the PDF was not
    // open yet), not that this paper has no pages: say so, or 本页 0 looks like
    // a wrong answer instead of an unfinished one.
    const noPages = pool.every(
      (figure) => figure.page == null && !figure.pageRange,
    );
    const hint =
      pool.length > 0 && noPages
        ? "还没读到 PDF 页码（阅读器刚打开或没开 PDF）；点「全部」照常选，稍后重开列表会重试"
        : filter === "page" && page != null
          ? `本页没有的素材，点「全部」或输入关键字查找`
          : `输入关键字可以筛选这 ${pool.length} 个素材`;
    return el(doc, "div", "figure-menu-foot", hint + pdfPickHint());
  };

  const renderItem = (
    figure: PaperFigure,
    isSelected: boolean,
    page: number | null,
  ): HTMLElement => {
    const row = doc.createElement("button");
    row.type = "button";
    row.className = "figure-item";
    if (isSelected) row.classList.add("figure-item-selected");
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", () => pick(figure));
    row.addEventListener("mouseenter", () => deps.hover?.(figure));
    row.addEventListener("mouseleave", () => deps.hoverEnd?.());

    const thumb = doc.createElement("span");
    thumb.className = "figure-item-thumb";
    if (figure.latex) {
      const rendered = latexPreview(figure);
      if (rendered) {
        thumb.classList.add("is-latex");
        thumb.append(rendered.cloneNode(true));
      } else {
        thumb.classList.add("is-text");
        thumb.textContent = "TeX";
      }
    } else {
      thumb.textContent = figure.label.slice(0, 2);
    }
    const labelLine = el(doc, "span", "figure-item-label-line");
    labelLine.append(el(doc, "span", "figure-item-label", figure.label));
    const meta = pageMeta(figure, page);
    if (meta) {
      const metaEl = el(
        doc,
        "span",
        figure.page == null && figure.pageRange
          ? "figure-item-meta is-estimated"
          : "figure-item-meta",
        meta,
      );
      labelLine.append(metaEl);
    }
    row.append(thumb, labelLine);
    if (figure.caption) {
      row.append(
        el(doc, "span", "figure-item-caption", figure.caption || "（无说明）"),
      );
    }
    if (figure.path) {
      void preview(figure).then((url) => {
        if (!url) return;
        const image = doc.createElement("img");
        image.src = url;
        image.alt = "";
        thumb.replaceChildren(image);
        thumb.classList.add("has-image");
      });
    }
    return row;
  };

  const paint = () => {
    const target = activeMentionTarget(input);
    if (!target && !forcedOpen) return hide();
    // Chip-only mode: the list stays shut, only the PDF is clickable.
    if (pdfOnly && !target) {
      // Arming only helps when something on the page can be hit. LaTeX-sourced
      // material carries no PDF box, so arming would leave the user clicking a
      // page that never reacts — fall through and show the list instead.
      const loaded = figures;
      if (loaded !== null && !loaded.some((figure) => figure.bbox)) {
        pdfOnly = false;
      } else {
        menu.replaceChildren();
        menu.style.display = "none";
        setVisible(true);
        startPdfWatch();
        return;
      }
    }
    menu.replaceChildren();
    menu.style.display = "";
    setVisible(true);
    startPageWatch();
    startPdfWatch();

    if (figures === null) {
      menu.append(
        el(
          doc,
          "div",
          "figure-menu-note",
          loading
            ? "正在读取这篇论文的图片和公式…"
            : failed
              ? "读取素材失败，请稍后再试"
              : "这篇论文还没有可用的图片、表格或公式",
        ),
      );
      return;
    }

    const page = currentPage();
    const chips = chipsFor(figures, page);
    // The list answers "what can I pick on the page I am looking at", so 本页
    // stays selected — even when the reader only becomes resolvable after the
    // first paint — until the user widens it from the chip row.
    if (page != null && !filterPinned) {
      filter = "page";
    } else if (!chips.some((chip) => chip.id === filter)) {
      filter = chips.find((chip) => chip.id === "page") ? "page" : "all";
    }

    const query = (target?.query ?? "").toLowerCase();
    const pool = figures.filter((figure) => {
      if (filter === "all") return true;
      if (filter === "page") return page != null && figureOnPage(figure, page);
      return figure.kind === filter;
    });
    const filtered = query
      ? pool.filter((figure) =>
          `${figure.label} ${figure.caption}`.toLowerCase().includes(query),
        )
      : pool;

    matches = sortByCurrentPage(filtered, filter === "page" ? null : page);
    if (selected >= matches.length) selected = 0;

    if (!figures.length) {
      menu.append(
        el(
          doc,
          "div",
          "figure-menu-note",
          "这篇论文还没有可用的图片、表格或公式",
        ),
      );
      return;
    }

    // Only the item list scrolls: the chip row is pinned to the top and the
    // hint to the bottom, so the active scope stays visible while scrolling.
    menu.append(renderChipBar(chips));
    const list = el(doc, "div", "figure-menu-list");
    matches.forEach((figure, index) => {
      list.append(renderItem(figure, index === selected, page));
    });
    if (!matches.length) {
      const reason =
        !query && filter === "page" ? "这一页没有素材" : "没有匹配的素材";
      list.append(el(doc, "div", "figure-menu-note", reason));
    }
    menu.append(list);
    menu.append(renderFootNote(figures, page));
  };

  /** Removes the mention the caret is in, keeping the text around it. */
  const removeMentionToken = (target: MentionTarget) => {
    const before = input.value.slice(0, target.start);
    const after = input.value.slice(target.end);
    input.value = before + after;
    input.selectionStart = before.length;
    input.selectionEnd = before.length;
  };

  const pick = (figure: PaperFigure) => {
    const target = activeMentionTarget(input);
    if (target) removeMentionToken(target);
    hide();
    deps.pick(figure);
    deps.afterPick?.();
  };

  /**
   * `@` is a trigger, not content: what follows it is a query for this list.
   * Closing the list without picking therefore drops the token — leaving it
   * would only reopen the list on the next keystroke.
   */
  const dropMentionToken = () => {
    const target = activeMentionTarget(input);
    if (!target) return;
    removeMentionToken(target);
    // Let the composer store the new text as its draft and refresh its status.
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  /** The menu and the chip-only mode both need the parsed material boxes. */
  const loadFigures = (): Promise<PaperFigure[]> => {
    if (figures !== null) return Promise.resolve(figures);
    if (!loading) {
      loading = true;
      failed = false;
      void deps
        .load()
        .then((loaded) => {
          figures = loaded;
        })
        .catch(() => {
          figures = [];
          failed = true;
        })
        .then(() => {
          loading = false;
          paint();
        });
    }
    // Poll the in-flight load: loads resolve in one macrotask burst, so this
    // stays cheap, and it shares the single load ensureFigures started.
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (figures !== null) {
          clearInterval(timer);
          resolve(figures);
        }
      }, 50);
    });
  };

  const ensureFigures = () => {
    void loadFigures();
  };

  const refresh = () => {
    const target = activeMentionTarget(input);
    if (!target && !forcedOpen) return hide();
    ensureFigures();
    paint();
  };

  const dismiss = () => {
    hide();
    dropMentionToken();
  };

  const onKeydown = (event: KeyboardEvent): boolean => {
    if (menu.style.display === "none") return false;
    if (event.key === "Escape") {
      dismiss();
      event.preventDefault();
      return true;
    }
    if (matches.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const delta = event.key === "ArrowDown" ? 1 : -1;
      selected = (selected + delta + matches.length) % matches.length;
      paint();
      event.preventDefault();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const figure = matches[selected];
      if (!figure) return false;
      pick(figure);
      event.preventDefault();
      return true;
    }
    return false;
  };

  return {
    menu,
    refresh,
    open: () => {
      forcedOpen = true;
      pdfOnly = false;
      input.focus();
      refresh();
    },
    arm: () => {
      forcedOpen = true;
      pdfOnly = true;
      ensureFigures();
      paint();
    },
    disarm: () => hide(),
    dismiss,
    isArmed: () => pdfOnly,
    /**
     * True when the loaded material carries PDF boxes and can actually be
     * clicked on the page. LaTeX-sourced papers have no boxes, so arming the
     * PDF pick mode there would only swallow clicks — the caller opens the
     * list instead.
     */
    canPickOnPdf: async () =>
      (await loadFigures()).some((figure) => figure.bbox),
    onKeydown,
    isOpen: () => menu.style.display !== "none",
  };
}

/**
 * A formula is typeset with KaTeX; a table has no KaTeX environment, so it is
 * drawn as the small grid its `tabular` body prints as. Both are cached by the
 * caller because the menu repaints whenever the reader turns a page.
 */
function buildLatexPreview(
  doc: Document,
  figure: PaperFigure,
): HTMLElement | null {
  return latexMaterialPreview(doc, figure.kind, figure.latex ?? "");
}

/** Puts what the reader is showing now on top of the list. */
function sortByCurrentPage(
  figures: PaperFigure[],
  page: number | null,
): PaperFigure[] {
  if (page == null) return figures;
  const here: PaperFigure[] = [];
  const rest: PaperFigure[] = [];
  for (const figure of figures) {
    (figure.page === page ? here : rest).push(figure);
  }
  return here.length && rest.length ? [...here, ...rest] : figures;
}

function figureOnPage(figure: PaperFigure, page: number): boolean {
  if (figure.page === page) return true;
  const range = figure.pageRange;
  return range != null && page >= range[0] && page <= range[1];
}

function pageMeta(figure: PaperFigure, page: number | null): string {
  if (figure.page != null) {
    if (page != null && figure.page === page) return "本页";
    return `第 ${figure.page + 1} 页`;
  }
  if (figure.pageRange) {
    const [first, last] = figure.pageRange;
    const label =
      first === last ? `第 ${first + 1} 页` : `第 ${first + 1}–${last + 1} 页`;
    return `${label}·推测`;
  }
  return "";
}

/**
 * The `@` token the caret currently sits in, mirroring the slash-command
 * trigger: `@` starts a token at a word boundary and the token holds no space.
 */
export function activeMentionTarget(
  input: HTMLTextAreaElement,
): MentionTarget | null {
  const start = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? start;
  if (start !== selectionEnd) return null;
  const before = input.value.slice(0, start);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  return { start: at, end: start, query };
}

export const FIGURE_MENU_MAX_VISIBLE = MAX_VISIBLE;
