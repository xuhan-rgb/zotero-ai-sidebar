import { describe, expect, it, vi } from "vitest";
import {
  activeMentionTarget,
  createFigurePicker,
} from "../../src/modules/figure-picker";
import { paperFigureFileName } from "../../src/modules/paper-figures";

function textareaWith(value: string, caret = value.length): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  input.value = value;
  input.selectionStart = caret;
  input.selectionEnd = caret;
  return input;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("figure picker", () => {
  it("only treats @ at a word boundary as a figure mention", () => {
    expect(activeMentionTarget(textareaWith("看图 @图"))?.query).toBe("图");
    expect(activeMentionTarget(textareaWith("@"))?.query).toBe("");
    expect(activeMentionTarget(textareaWith("mail@example.com"))).toBeNull();
    expect(activeMentionTarget(textareaWith("@two words"))).toBeNull();
  });

  it("lists parsed figures and replaces the token with an image marker", async () => {
    const input = textareaWith("这张图讲了什么 @");
    const pick = vi.fn();
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:images/a.jpg",
          label: "图 1",
          caption: "系统结构",
          path: "/cache/assets/images/a.jpg",
          mediaType: "image/jpeg",
        },
      ],
      preview: async () => null,
      pick,
    });
    picker.refresh();
    await settle();

    const item = picker.menu.querySelector<HTMLElement>(".figure-item")!;
    expect(item.textContent).toContain("图 1");
    expect(item.textContent).toContain("系统结构");

    item.click();

    expect(pick).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("这张图讲了什么 ");
    expect(picker.menu.style.display).toBe("none");
  });

  it("keeps the menu closed without an @ token", async () => {
    const input = textareaWith("普通问题");
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [],
      preview: async () => null,
      pick: () => {},
    });

    picker.refresh();

    expect(picker.menu.style.display).toBe("none");
    expect(picker.onKeydown(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(
      false,
    );
  });
});

describe("paper figure file names", () => {
  it("keeps the label and the source extension", () => {
    expect(
      paperFigureFileName({
        id: "mineru:images/x.jpg",
        label: "图 3",
        caption: "",
        path: "/cache/assets/images/abc123.jpg",
        mediaType: "image/jpeg",
      }),
    ).toBe("图-3-abc123.jpg");
  });
});
