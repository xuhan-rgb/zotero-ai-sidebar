import { describe, expect, it, vi } from "vitest";
import {
  addDraftMaterial,
  expandDraftMaterials,
  renderDraftMaterials,
  type DraftMaterialState,
} from "../../src/modules/composer-materials";

function draftState(): DraftMaterialState {
  return {
    draftText: "",
    draftSelectionStart: 0,
    draftSelectionEnd: 0,
    draftHadFocus: false,
    draftMaterials: [],
    nextMaterialID: 1,
  };
}

function textarea(value = ""): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  input.value = value;
  input.selectionStart = value.length;
  input.selectionEnd = value.length;
  return input;
}

const table = {
  id: "latex:table:1",
  kind: "table" as const,
  label: "表 1",
  caption: "Detection results",
  latex: "\\begin{table}\n\\caption{Detection results}\n\\end{table}",
};

describe("composer materials", () => {
  it("keeps a table behind a marker and expands it only when sending", () => {
    const state = draftState();
    const input = textarea("这张表说明了什么 ");

    expect(addDraftMaterial(state, table, input)).toBe(true);

    expect(input.value).toBe("这张表说明了什么 [表 #1]");
    expect(state.draftMaterials[0].marker).toBe("[表 #1]");
    expect(expandDraftMaterials(input.value, state.draftMaterials)).toBe(
      `这张表说明了什么 ${table.latex}`,
    );
  });

  it("numbers markers per kind and drops removed ones", () => {
    const state = draftState();
    const input = textarea();
    addDraftMaterial(state, table, input);
    addDraftMaterial(
      state,
      {
        ...table,
        id: "latex:equation:1",
        kind: "equation",
        label: "公式 1",
        latex: "\\begin{equation}\na = b\n\\end{equation}",
      },
      input,
    );
    addDraftMaterial(
      state,
      { ...table, id: "latex:table:2", label: "表 2" },
      input,
    );

    expect(input.value).toBe("[表 #1]\n[公式 #1]\n[表 #2]");

    const tray = renderDraftMaterials(
      document,
      document.body,
      state,
      input,
      { renderPanel: vi.fn() },
    );
    const chips = tray.querySelectorAll(".draft-material");
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toContain("[表 #1] 表 1");

    (chips[0].querySelector("button") as HTMLElement).click();

    expect(state.draftMaterials.map((item) => item.marker)).toEqual([
      "[公式 #1]",
      "[表 #1]",
    ]);
    expect(input.value).toBe("[公式 #1]\n[表 #1]");
    const expanded = expandDraftMaterials(input.value, state.draftMaterials);
    expect(expanded).not.toContain("[表 #");
    expect(expanded.match(/\\begin\{table\}/g)).toHaveLength(1);
    expect(expanded).toContain("\\begin{equation}");
  });

  it("leaves unknown markers alone", () => {
    expect(expandDraftMaterials("hello [表 #4]", [])).toBe("hello [表 #4]");
  });
});
