import { it, expect, vi } from "vitest";
import { renderFullTranslationView } from "../../src/modules/full-translation-view";
import { createFullTranslationState } from "../../src/settings/full-translation-store";
import type { FullTranslationDocument } from "../../src/translate/full-document";
it("renders a paper header and cleans original prose without changing cached source", () => {
  const paper: FullTranslationDocument = {schemaVersion:1,arxivId:"2110.06864",sourceHash:"x",blocks:[
    {id:"title",kind:"title",source:"ByteTrack",translatable:true},
    {id:"front-p1",kind:"paragraph",source:String.raw`\let\relax\footnotetext{Corresponding author.}`,translatable:true},
    {id:"abstract",kind:"abstract",source:String.raw`Visit \url{https://example.org/code}.`,translatable:true},
  ]};
  const state=createFullTranslationState(paper,"p","m");
  state.blocks.title={status:"done",translation:"<chs_title>中文标题</chs_title><chs_description>额外概述</chs_description>"};
  const view=renderFullTranslationView(document,{document:paper,state,layout:"parallel",running:false,assets:{},onLayoutChange:vi.fn(),onRun:vi.fn(),onRetranslate:vi.fn(),onCancel:vi.fn(),onExit:vi.fn()});
  expect(view.querySelector('.zai-ft-title .zai-ft-translation .zai-ft-block-body')?.textContent).toBe("中文标题");
  expect(view.querySelector('.zai-ft-title-description')?.textContent).toContain("额外概述");
  expect(view.querySelector('[data-block-id="front-p1"] .zai-ft-source')?.textContent).not.toContain('\\footnotetext');
  expect(view.querySelector('.zai-ft-abstract .zai-ft-source a')?.getAttribute('href')).toBe('https://example.org/code');
  expect(view.querySelector('.zai-ft-section-label')?.textContent).toContain('Abstract');
  expect(paper.blocks[1].source).toContain('\\footnotetext');
});

it("restores escaped numeric citations only when matching citations occur in the original", () => {
  const paper: FullTranslationDocument={schemaVersion:1,arxivId:"a",sourceHash:"b",blocks:[{id:"p",kind:"paragraph",source:String.raw`Methods [53, 91, 14] use SOT [5] and filtering [29]. The result is \[7\].`,translatable:true}],references:[{number:5,text:"SOT reference"}]};
  const state=createFullTranslationState(paper,"p","m");
  state.blocks.p={status:"done",translation:String.raw`方法\[53, 91, 14\]使用 SOT\[5\]和滤波\[29\]。结果是\[7\]，公式为\[x=5\]。`};
  const view=renderFullTranslationView(document,{document:paper,state,layout:"interleaved",running:false,assets:{},onLayoutChange:vi.fn(),onRun:vi.fn(),onRetranslate:vi.fn(),onCancel:vi.fn(),onExit:vi.fn()});
  const zh=view.querySelector('.zai-ft-translation')!;
  expect(zh.textContent).toContain('[53, 91, 14]');
  expect(zh.textContent).toContain('[29]');
  expect(zh.querySelector('.zai-ft-citation-link')?.textContent).toBe('5');
  (zh.querySelector('.zai-ft-citation-link') as HTMLButtonElement).click();
  expect(view.querySelector('.zai-ft-reference-body')?.textContent).toContain('SOT reference');
  expect(zh.querySelectorAll('.math-display')).toHaveLength(2);
  expect(state.blocks.p.translation).toContain(String.raw`\[29\]`);
});
