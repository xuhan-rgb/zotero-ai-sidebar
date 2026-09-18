import { captureDraftFromInput, type ComposerDraftState } from "./composer-state";
import {
  insertComposerText,
  removeComposerMarkerFromText,
} from "./composer-images";
import { buttonEl, el } from "./dom-utils";
import {
  paperFigureLatex,
  type PaperFigure,
  type PaperFigureKind,
} from "./paper-figures";

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
  deps: { renderPanel(mount: HTMLElement, state: TState): void },
): HTMLElement {
  const tray = el(
    doc,
    "div",
    state.draftMaterials.length ? "draft-materials" : "draft-materials is-empty",
  );
  for (const material of state.draftMaterials) {
    const chip = el(doc, "span", "draft-material");
    chip.title = `发送时展开为 LaTeX：\n${material.latex}`;
    chip.append(
      el(doc, "span", "draft-material-label", `${material.marker} ${material.label}`),
    );
    const remove = buttonEl(doc, "×");
    remove.title = "移除素材";
    remove.addEventListener("click", () => {
      input.value = removeComposerMarkerFromText(
        input.value,
        material.marker,
      );
      state.draftMaterials = state.draftMaterials.filter(
        (candidate) => candidate.id !== material.id,
      );
      relabelDraftMaterials(state, input);
      captureDraftFromInput(input, state);
      deps.renderPanel(mount, state);
    });
    chip.append(remove);
    tray.append(chip);
  }
  return tray;
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

/** Numbers markers per kind again after a material was removed. */
export function relabelDraftMaterials<TState extends DraftMaterialState>(
  state: TState,
  input?: HTMLTextAreaElement,
): void {
  const counts = new Map<PaperFigureKind, number>();
  let text = input?.value;
  for (const material of state.draftMaterials) {
    const next = (counts.get(material.kind) ?? 0) + 1;
    counts.set(material.kind, next);
    const marker = `[${KIND_LABELS[material.kind]} #${next}]`;
    if (material.marker === marker) continue;
    if (text != null && material.marker) {
      text = text.split(material.marker).join(marker);
    }
    material.marker = marker;
  }
  if (input && text != null) input.value = text;
}
