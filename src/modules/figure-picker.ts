import { el } from "./dom-utils";
import type { PaperFigure, PaperFigureKind } from "./paper-figures";

export interface FigurePickerDeps {
  doc: Document;
  input: HTMLTextAreaElement;
  load(): Promise<PaperFigure[]>;
  preview(figure: PaperFigure): Promise<string | null>;
  pick(figure: PaperFigure): void;
  afterPick?(): void;
  /** 0-based page the PDF reader currently shows, when it is known. */
  currentPage?(): number | null;
}

export interface FigurePicker {
  menu: HTMLElement;
  /** Re-reads the `@` token and repaints the menu. */
  refresh(): void;
  /** Returns true when the key was consumed by the open menu. */
  onKeydown(event: KeyboardEvent): boolean;
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
  let figures: PaperFigure[] | null = null;
  let loading = false;
  let failed = false;
  let filter: FigureFilter | null = null;
  let matches: PaperFigure[] = [];
  let selected = 0;

  const hide = () => {
    menu.style.display = "none";
    menu.replaceChildren();
    matches = [];
  };

  const preview = (figure: PaperFigure): Promise<string | null> => {
    const cached = previews.get(figure.id);
    if (cached !== undefined) return Promise.resolve(cached);
    return deps.preview(figure).then((url) => {
      previews.set(figure.id, url);
      return url;
    });
  };

  const currentPage = (): number | null => {
    try {
      return deps.currentPage?.() ?? null;
    } catch {
      return null;
    }
  };

  const chipsFor = (list: PaperFigure[], page: number | null): FilterChip[] => {
    const chips: FilterChip[] = [];
    if (page != null) {
      const onPage = list.filter((figure) => figure.page === page).length;
      if (onPage) chips.push({ id: "page", text: `本页 ${onPage}` });
    }
    chips.push({ id: "all", text: `全部 ${list.length}` });
    for (const [kind, label] of KIND_LABELS) {
      const count = list.filter((figure) => figure.kind === kind).length;
      if (count) chips.push({ id: kind, text: `${label} ${count}` });
    }
    return chips;
  };

  const paintChips = (
    chips: FilterChip[],
    page: number | null,
    pool: PaperFigure[],
  ) => {
    if (chips.length <= 1) return;
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
        selected = 0;
        paint();
      });
      bar.append(button);
    }
    menu.append(bar);
    const hint =
      filter === "page" && page != null
        ? `本页没有的素材，点「全部」或输入关键字查找`
        : `输入关键字可以筛选这 ${pool.length} 个素材`;
    menu.append(el(doc, "div", "figure-menu-foot", hint));
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

    const thumb = doc.createElement("span");
    thumb.className = "figure-item-thumb";
    if (figure.latex) {
      thumb.classList.add("is-text");
      thumb.textContent = "TeX";
    } else {
      thumb.textContent = figure.label.slice(0, 2);
    }
    const labelLine = el(doc, "span", "figure-item-label-line");
    labelLine.append(el(doc, "span", "figure-item-label", figure.label));
    const meta = pageMeta(figure, page);
    if (meta) labelLine.append(el(doc, "span", "figure-item-meta", meta));
    row.append(
      thumb,
      labelLine,
      el(doc, "span", "figure-item-caption", figure.caption || "（无说明）"),
    );
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
    if (!target) return hide();
    menu.replaceChildren();
    menu.style.display = "";

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
    if (!chips.some((chip) => chip.id === filter)) {
      filter = chips.find((chip) => chip.id === "page") ? "page" : "all";
    }

    const query = target.query.toLowerCase();
    const pool = figures.filter((figure) => {
      if (filter === "all") return true;
      if (filter === "page") return figure.page === page;
      return figure.kind === filter;
    });
    const filtered = query
      ? pool.filter((figure) =>
          `${figure.label} ${figure.caption}`.toLowerCase().includes(query),
        )
      : pool;

    matches = sortByCurrentPage(filtered, filter === "page" ? null : page);
    if (selected >= matches.length) selected = 0;

    const list = el(doc, "div", "figure-menu-list");
    matches.forEach((figure, index) => {
      list.append(renderItem(figure, index === selected, page));
    });
    if (!matches.length) {
      list.append(el(doc, "div", "figure-menu-note", "没有匹配的素材"));
    }
    if (matches.length) menu.append(list);
    paintChips(chips, page, figures);
  };

  const pick = (figure: PaperFigure) => {
    const target = activeMentionTarget(input);
    if (target) {
      const before = input.value.slice(0, target.start);
      const after = input.value.slice(target.end);
      input.value = before + after;
      input.selectionStart = before.length;
      input.selectionEnd = before.length;
    }
    hide();
    deps.pick(figure);
    deps.afterPick?.();
  };

  const refresh = () => {
    const target = activeMentionTarget(input);
    if (!target) return hide();
    if (figures === null && !loading) {
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
    paint();
  };

  const onKeydown = (event: KeyboardEvent): boolean => {
    if (menu.style.display === "none") return false;
    if (event.key === "Escape") {
      hide();
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

  return { menu, refresh, onKeydown };
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

function pageMeta(figure: PaperFigure, page: number | null): string {
  if (figure.page == null) return "";
  if (page != null && figure.page === page) return "本页";
  return `第 ${figure.page + 1} 页`;
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
