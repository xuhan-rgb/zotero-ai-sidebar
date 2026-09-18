import { el } from "./dom-utils";
import type { PaperFigure } from "./paper-figures";

export interface FigurePickerDeps {
  doc: Document;
  input: HTMLTextAreaElement;
  load(): Promise<PaperFigure[]>;
  preview(figure: PaperFigure): Promise<string | null>;
  pick(figure: PaperFigure): void;
  afterPick?(): void;
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

const MAX_VISIBLE = 6;

export function createFigurePicker(deps: FigurePickerDeps): FigurePicker {
  const { doc, input } = deps;
  const menu = el(doc, "div", "figure-menu");
  menu.style.display = "none";

  const previews = new Map<string, string | null>();
  let figures: PaperFigure[] | null = null;
  let loading = false;
  let failed = false;
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
            ? "正在读取这篇论文的图片…"
            : failed
              ? "读取图片失败，请稍后再试"
              : "这篇论文还没有可用的图片",
        ),
      );
      return;
    }

    const query = target.query.toLowerCase();
    matches = query
      ? figures.filter((figure) =>
          `${figure.label} ${figure.caption}`.toLowerCase().includes(query),
        )
      : figures;
    if (selected >= matches.length) selected = 0;
    if (matches.length === 0) {
      menu.append(el(doc, "div", "figure-menu-note", "没有匹配的图片"));
      return;
    }

    const list = el(doc, "div", "figure-menu-list");
    matches.forEach((figure, index) => {
      const row = doc.createElement("button");
      row.type = "button";
      row.className = "figure-item";
      if (index === selected) row.classList.add("figure-item-selected");
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => pick(figure));

      const thumb = doc.createElement("span");
      thumb.className = "figure-item-thumb";
      thumb.textContent = figure.label.slice(0, 2);
      row.append(
        thumb,
        el(doc, "span", "figure-item-label", figure.label),
        el(doc, "span", "figure-item-caption", figure.caption || "（无图注）"),
      );
      list.append(row);
      void preview(figure).then((url) => {
        if (!url) return;
        const image = doc.createElement("img");
        image.src = url;
        image.alt = "";
        thumb.replaceChildren(image);
        thumb.classList.add("has-image");
      });
    });
    menu.append(list);
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
