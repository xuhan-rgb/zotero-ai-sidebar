import { describe, it, expect, vi } from "vitest";
import { attachFullTranslationLinks } from "../../src/modules/full-translation-links";
import { fullDocumentReferences } from "../../src/translate/full-document-references";

const clipboard = vi.hoisted(() => ({ copy: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/modules/clipboard-utils", () => ({ copyToClipboard: clipboard.copy }));

describe("full document reading links", () => {
  it("uses bibliography numbering, without guessing from bib files or conflicting lists", () => {
    expect(
      fullDocumentReferences([{ path: "a.bib", text: "@article{a}" }]),
    ).toEqual([]);
    expect(
      fullDocumentReferences([
        {
          path: "a.bbl",
          text: String.raw`\bibitem{a}Author.\newblock {\em Title.}\bibitem{b}Second.\end{thebibliography}`,
        },
      ]),
    ).toEqual([
      { number: 1, text: "Author. *Title.*" },
      { number: 2, text: "Second." },
    ]);
    expect(
      fullDocumentReferences([
        { path: "a.bbl", text: String.raw`\bibitem{a}A` },
        { path: "b.bbl", text: String.raw`\bibitem{b}B` },
      ]),
    ).toEqual([]);
  });
  it("opens a reference, returns from figures, and excludes math and missing references", async () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="zai-ft-content"><article data-block-id="p"><div class="zai-ft-block-body">See Figure 2(a), 图2（b） and [1, 9]. <span class="katex">[1]</span></div></article><article data-block-id="f"><div class="zai-ft-assets"><div class="zai-ft-asset"><img src="x" alt="Figure 2"></div></div></article></div>';
    document.body.append(root);
    attachFullTranslationLinks(root, {
      schemaVersion: 1,
      arxivId: "a",
      sourceHash: "b",
      blocks: [
        {
          id: "f",
          kind: "figure-caption",
          source: "Figure",
          number: 2,
          translatable: true,
        },
      ],
      references: [{ number: 1, text: "Author. Paper title." }],
    });
    expect(root.querySelectorAll(".zai-ft-citation-link")).toHaveLength(1);
    const link = root.querySelector<HTMLButtonElement>(
      ".zai-ft-citation-link",
    )!;
    root.getBoundingClientRect = () => ({top:0,bottom:800,height:800,left:0,right:1000,width:1000,x:0,y:0,toJSON(){}});
    link.getBoundingClientRect = () => ({top:650,bottom:670,height:20,left:100,right:120,width:20,x:100,y:650,toJSON(){}});
    Object.defineProperty(root.querySelector(".zai-ft-reference-dialog"), "scrollHeight", {value:320});
    link.click();
    expect((root.querySelector(".zai-ft-reference-dialog") as HTMLElement).style.bottom).toBe("162px");
    expect(
      root.querySelector<HTMLElement>(".zai-ft-reference-overlay")!.hidden,
    ).toBe(false);
    expect(root.querySelector(".zai-ft-reference-body")!.textContent).toContain(
      "Paper title",
    );
    const copy = root.querySelector<HTMLButtonElement>(".zai-ft-reference-copy")!;
    copy.click();
    await vi.waitFor(() => expect(copy.textContent).toBe("已复制"));
    expect(clipboard.copy).toHaveBeenCalledWith(document, "Author. Paper title.");
    root
      .querySelector<HTMLButtonElement>(".zai-ft-reference-dialog > button")!
      .click();
    expect(
      root.querySelector<HTMLElement>(".zai-ft-reference-overlay")!.hidden,
    ).toBe(true);
    expect(document.activeElement).toBe(link);
    const target = root.querySelector<HTMLElement>('[data-block-id="f"]')!;
    target.scrollIntoView = vi.fn();
    const figure = root.querySelector<HTMLButtonElement>(
      ".zai-ft-object-link",
    )!;
    figure.scrollIntoView = vi.fn();
    figure.click();
    expect(target.scrollIntoView).toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(".zai-ft-reference-back")!.click();
    expect(figure.scrollIntoView).toHaveBeenCalled();
    root.querySelector<HTMLImageElement>(".zai-ft-asset img")!.click();
    expect(root.querySelector(".zai-ft-reference-body img")).not.toBeNull();
    root.remove();
  });
});

it("decodes bibliography accent commands", () => {
  expect(fullDocumentReferences([{path:"a.bbl",text:String.raw`\bibitem{x}P. Doll{\'a}r. A study.`}])[0].text).toBe("P. Dollár. A study.");
});
