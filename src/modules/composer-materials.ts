import { captureDraftFromInput, type ComposerDraftState } from "./composer-state";
import {
  insertComposerText,
  renameComposerMarker,
  removeComposerMarkerFromText,
} from "./composer-images";
import { buttonEl, el } from "./dom-utils";
import {
  paperFigureLatex,
  type PaperFigure,
  type PaperFigureKind,
} from "./paper-figures";
import { latexMaterialPreview } from "./latex-preview";

/**
 * Chips whose rendered preview the user expanded by clicking the label. Kept
 * outside the draft state so a panel repaint (typing, relabeling) does not
 * collapse previews the user is reading.
 */
const expandedMaterialPreviews = new Set<string>();

/**
 * Tables and formulas picked with `@`. The composer only carries a short
 * marker; the LaTeX source replaces it when the message is actually sent, so
 * a full table does not fill the input box (or the chat bubble) with code.
 */
export interface DraftMaterial {
  id: string;
  marker: string;
  kind: PaperFigureKind;
  label: string;
  latex: string;
  /** The `@` item this came from, for dropping its PDF reference box. */
  figureId?: string;
}

export interface DraftMaterialState extends ComposerDraftState {
  draftMaterials: DraftMaterial[];
  nextMaterialID: number;
}

const KIND_LABELS: Record<PaperFigureKind, string> = {
  figure: "图",
  table: "表",
  equation: "公式",
};

export function addDraftMaterial<TState extends DraftMaterialState>(
  state: TState,
  figure: PaperFigure,
  input?: HTMLTextAreaElement,
): boolean {
  const latex = paperFigureLatex(figure);
  if (!latex) return false;
  const material: DraftMaterial = {
    id: `material-${Date.now()}-${state.nextMaterialID++}`,
    marker: "",
    kind: figure.kind,
    label: figure.label,
    latex,
    figureId: figure.id,
  };
  state.draftMaterials.push(material);
  relabelDraftMaterials(state, input);
  if (input) {
    insertComposerText(input, material.marker);
    captureDraftFromInput(input, state);
  }
  return true;
}

export function renderDraftMaterials<TState extends DraftMaterialState>(
  doc: Document,
  mount: HTMLElement,
  state: TState,
  input: HTMLTextAreaElement,
  deps: {
    renderPanel(mount: HTMLElement, state: TState): void;
    /** The chip's × was clicked: drop its dashed box on the PDF, if any. */
    unmarkReference?(material: DraftMaterial): void;
    /** The chip's label was clicked: jump to and highlight this material on the PDF. */
    jumpToMaterial?(material: DraftMaterial): void;
  },
): HTMLElement {
  const tray = el(
    doc,
    "div",
    state.draftMaterials.length ? "draft-materials" : "draft-materials is-empty",
  );
  for (const material of state.draftMaterials) {
    const chip = el(doc, "span", "draft-material");
    chip.title = `发送时展开为 LaTeX：\n${material.latex}`;
    const label = el(
      doc,
      "span",
      "draft-material-label",
      `${material.marker} ${material.label}`,
    );
    const previewNode = latexMaterialPreview(doc, material.kind, material.latex);
    if (previewNode) {
      label.classList.add("is-previewable");
      label.title = "点击预览/收起此素材，并跳转到所在页";
      label.addEventListener("click", () => {
        if (!expandedMaterialPreviews.delete(material.id)) {
          expandedMaterialPreviews.add(material.id);
        }
        deps.renderPanel(mount, state);
        deps.jumpToMaterial?.(material);
      });
    } else {
      // KaTeX could not typeset this source: fall back to locating it on the PDF.
      label.classList.add("is-jumpable");
      label.title = "点击在 PDF 中查看此素材";
      label.addEventListener("click", () => {
        deps.jumpToMaterial?.(material);
      });
    }
    chip.append(label);
    const remove = buttonEl(doc, "×");
    remove.title = "移除素材";
    remove.addEventListener("click", () => {
      deps.unmarkReference?.(material);
      removeDraftMaterial(state, input, material);
      deps.renderPanel(mount, state);
    });
    chip.append(remove);
    tray.append(chip);
    if (previewNode && expandedMaterialPreviews.has(material.id)) {
      const preview = el(doc, "div", "draft-material-preview");
      preview.append(previewNode);
      tray.append(preview);
    }
  }
  return tray;
}

/**
 * Drops one table or formula and its marker. The caller clears the PDF mark,
 * because only it knows the reader and why the material goes away.
 */
export function removeDraftMaterial<TState extends DraftMaterialState>(
  state: TState,
  input: HTMLTextAreaElement,
  material: DraftMaterial,
): void {
  input.value = removeComposerMarkerFromText(input.value, material.marker);
  state.draftMaterials = state.draftMaterials.filter(
    (candidate) => candidate.id !== material.id,
  );
  expandedMaterialPreviews.delete(material.id);
  relabelDraftMaterials(state, input);
  captureDraftFromInput(input, state);
}

/** Swaps every marker that is still in the text for its LaTeX source. */
export function expandDraftMaterials(
  text: string,
  materials: DraftMaterial[],
): string {
  let out = text;
  for (const material of materials) {
    if (!material.marker || !out.includes(material.marker)) continue;
    out = out.split(material.marker).join(material.latex);
  }
  return out;
}

/**
 * Drops the tables and formulas whose marker the user deleted from the text,
 * then renumbers what is left — the same rule pictures follow.
 */
export function dropDraftMaterialsMissingMarker<
  TState extends DraftMaterialState,
>(state: TState, input: HTMLTextAreaElement): boolean {
  const kept = state.draftMaterials.filter((material) =>
    input.value.includes(material.marker),
  );
  if (kept.length === state.draftMaterials.length) return false;
  state.draftMaterials = kept;
  relabelDraftMaterials(state, input);
  return true;
}

/** Numbers markers per kind again after a material was removed. */
export function relabelDraftMaterials<TState extends DraftMaterialState>(
  state: TState,
  input?: HTMLTextAreaElement,
): void {
  const counts = new Map<PaperFigureKind, number>();
  for (const material of state.draftMaterials) {
    const next = (counts.get(material.kind) ?? 0) + 1;
    counts.set(material.kind, next);
    const marker = `[${KIND_LABELS[material.kind]} #${next}]`;
    if (material.marker === marker) continue;
    if (input) renameComposerMarker(input, material.marker, marker);
    material.marker = marker;
  }
}
