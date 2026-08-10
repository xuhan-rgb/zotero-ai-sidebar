import { afterEach, describe, expect, it } from "vitest";

import {
  findFullTranslationSourceBlockId,
  mapTranslationSelectionToSource,
  readFullTranslationSourceSelection,
} from "../../src/modules/full-translation-interactions";
import type { FullTranslationBlock } from "../../src/translate/full-document";

const blocks: FullTranslationBlock[] = [
  {
    id: "paragraph-1",
    kind: "paragraph",
    source:
      "The first result is stable. The second result improves accuracy. The final result is faster.",
    translatable: true,
  },
  {
    id: "paragraph-2",
    kind: "paragraph",
    source: "We minimize the **task loss** $L_{task}$ during training.",
    translatable: true,
  },
];

afterEach(() => {
  globalThis.getSelection()?.removeAllRanges();
  globalThis.document.body.replaceChildren();
});

describe("full translation interactions", () => {
  it("maps a partial Chinese selection to the complete English sentence", () => {
    const translation =
      "第一个结果稳定。第二个结果提高了准确率。最终结果更快。";
    const start = translation.indexOf("提高了");

    expect(
      mapTranslationSelectionToSource(
        blocks[0]!.source,
        translation,
        start,
        start + 3,
      ),
    ).toBe("The second result improves accuracy.");
  });

  it("maps a multi-sentence Chinese selection to all matching English sentences", () => {
    const translation =
      "第一个结果稳定。第二个结果提高了准确率。最终结果更快。";
    const start = translation.indexOf("第一个");
    const end = translation.indexOf("最终结果");

    expect(
      mapTranslationSelectionToSource(
        blocks[0]!.source,
        translation,
        start,
        end,
      ),
    ).toBe("The first result is stable. The second result improves accuracy.");
  });

  it("uses proportional sentence coverage when sentence counts differ", () => {
    const translation = "前两项结果稳定。最终结果更快。";
    const end = translation.indexOf("最终结果");

    expect(
      mapTranslationSelectionToSource(blocks[0]!.source, translation, 0, end),
    ).toBe("The first result is stable. The second result improves accuracy.");
  });

  it("reads a Chinese DOM selection and returns the corresponding English sentence", () => {
    const root = globalThis.document.createElement("div");
    root.className = "zai-full-translation";
    root.innerHTML = `
      <article class="zai-ft-block" data-block-id="paragraph-1">
        <div class="zai-ft-translation">
          <div class="zai-ft-block-body">第一个结果稳定。<span class="zai-ft-sentence-boundary"></span>第二个结果提高了准确率。<span class="zai-ft-sentence-boundary"></span>最终结果更快。</div>
        </div>
      </article>
    `;
    globalThis.document.body.append(root);
    const body = root.querySelector(".zai-ft-block-body")!;
    const text = body.childNodes[2]!;
    const value = text.textContent!;
    const start = value.indexOf("提高了");
    const range = globalThis.document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 3);
    globalThis.getSelection()!.addRange(range);

    expect(readFullTranslationSourceSelection(root, blocks)).toEqual({
      blockId: "paragraph-1",
      selectedText: "The second result improves accuracy.",
      displayText: "提高了",
      origin: "translation",
    });
  });

  it("finds the source block after normalizing Markdown and LaTeX markup", () => {
    expect(
      findFullTranslationSourceBlockId(
        blocks,
        "We minimize the task loss L_{task} during training.",
      ),
    ).toBe("paragraph-2");
  });
});
