import { describe, expect, it, vi } from "vitest";
import {
  activeMentionTarget,
  createFigurePicker,
  type PagePickResult,
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
          kind: "figure",
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

  it("starts on the page the reader shows and can switch to one kind", async () => {
    const input = textareaWith("@");
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:images/a.jpg",
          kind: "figure",
          label: "图 1",
          caption: "第一页的图",
          path: "/cache/assets/images/a.jpg",
          mediaType: "image/jpeg",
          page: 0,
        },
        {
          id: "mineru:table:2",
          kind: "table",
          label: "表 1",
          caption: "数据对比",
          latex: "\\begin{tabular}{ll} A & B \\end{tabular}",
          page: 0,
        },
        {
          id: "mineru:equation:3",
          kind: "equation",
          label: "公式 3",
          caption: "$$a + b$$",
          latex: "$$\na + b\n$$",
          page: 3,
        },
      ],
      preview: async () => null,
      pick: () => {},
      currentPage: () => 0,
    });
    picker.refresh();
    await settle();

    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(2);
    expect(picker.menu.textContent).toContain("本页 2");

    const chips = Array.from(
      picker.menu.querySelectorAll<HTMLElement>(".figure-chip"),
    );
    expect(
      chips.find((chip) => chip.textContent?.startsWith("公式")),
    ).toBeDefined();

    const all = chips.find((chip) => chip.textContent?.startsWith("全部"))!;
    all.click();

    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(3);

    const tables = chips.find((chip) => chip.textContent?.startsWith("表格"))!;
    tables.click();

    const items = picker.menu.querySelectorAll<HTMLElement>(".figure-item");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("表 1");

    const equations = chips.find(
      (chip) => chip.textContent?.startsWith("公式"),
    )!;
    equations.click();

    const equationsAfterFilter =
      picker.menu.querySelectorAll<HTMLElement>(".figure-item");
    expect(equationsAfterFilter).toHaveLength(1);
    expect(equationsAfterFilter[0].textContent).toContain("公式 3");
    // Rows always render the LaTeX preview now, so the thumb holds typeset
    // output rather than the "TeX" placeholder.
    const thumb = equationsAfterFilter[0].querySelector<HTMLElement>(
      ".figure-item-thumb",
    );
    expect(thumb?.classList.contains("is-latex")).toBe(true);
    expect(thumb?.textContent).toContain("a+b");
  });

  it("keeps the list on the page the reader shows until a chip is clicked", async () => {
    const input = textareaWith("@");
    let page: number | null = null;
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:images/a.jpg",
          kind: "figure",
          label: "图 1",
          caption: "",
          path: "/cache/assets/images/a.jpg",
          mediaType: "image/jpeg",
          page: 0,
        },
        {
          id: "mineru:images/b.jpg",
          kind: "figure",
          label: "图 2",
          caption: "",
          path: "/cache/assets/images/b.jpg",
          mediaType: "image/jpeg",
          page: 5,
        },
      ],
      preview: async () => null,
      pick: () => {},
      currentPage: () => page,
    });
    document.body.append(picker.menu);

    picker.refresh();
    await settle();
    // Reader not resolvable yet: nothing to narrow down to.
    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(2);

    // Once the reader reports its page, the list snaps to that page only.
    page = 0;
    picker.refresh();
    await settle();
    const onPage = picker.menu.querySelectorAll<HTMLElement>(".figure-item");
    expect(onPage).toHaveLength(1);
    expect(onPage[0].textContent).toContain("图 1");

    const all = Array.from(
      picker.menu.querySelectorAll<HTMLElement>(".figure-chip"),
    ).find((chip) => chip.textContent?.startsWith("全部"))!;
    all.click();
    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(2);

    // Closing and reopening the list drops the manual widening again.
    picker.disarm();
    picker.refresh();
    await settle();
    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(1);

    picker.menu.remove();
  });

  it("keeps 本页 selected and highlighted when the page holds nothing", async () => {
    const input = textareaWith("@");
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:images/a.jpg",
          kind: "figure",
          label: "图 1",
          caption: "",
          path: "/cache/assets/images/a.jpg",
          mediaType: "image/jpeg",
          page: 3,
        },
      ],
      preview: async () => null,
      pick: () => {},
      currentPage: () => 0,
    });
    document.body.append(picker.menu);

    picker.refresh();
    await settle();

    const chips = Array.from(
      picker.menu.querySelectorAll<HTMLElement>(".figure-chip"),
    );
    // The default scope is offered even at 0, so the user can see what the
    // empty list means and can widen it.
    const pageChip = chips.find((chip) =>
      chip.textContent?.startsWith("本页"),
    )!;
    expect(pageChip.textContent).toBe("本页 0");
    expect(pageChip.classList.contains("figure-chip-active")).toBe(true);
    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(0);
    expect(picker.menu.textContent).toContain("这一页没有素材");

    const all = chips.find((chip) => chip.textContent?.startsWith("全部"))!;
    all.click();

    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(1);
    expect(
      Array.from(
        picker.menu.querySelectorAll<HTMLElement>(".figure-chip-active"),
      ).map((chip) => chip.textContent),
    ).toEqual(["全部 1"]);

    picker.menu.remove();
  });

  it("pins the chip row above the scrolling list", async () => {
    const input = textareaWith("@");
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:images/a.jpg",
          kind: "figure",
          label: "图 1",
          caption: "",
          path: "/cache/assets/images/a.jpg",
          mediaType: "image/jpeg",
          page: 0,
        },
      ],
      preview: async () => null,
      pick: () => {},
      currentPage: () => 0,
    });
    document.body.append(picker.menu);

    picker.refresh();
    await settle();

    const order = Array.from(picker.menu.children).map(
      (child) => (child as HTMLElement).className,
    );
    expect(order).toEqual([
      "figure-menu-filters",
      "figure-menu-list",
      "figure-menu-foot",
    ]);

    picker.menu.remove();
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

  it("reports every open and close so the composer can highlight its chip", async () => {
    const input = textareaWith("");
    const visibility = vi.fn();
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:images/a.jpg",
          kind: "figure",
          label: "图 1",
          caption: "系统结构",
          path: "/cache/assets/images/a.jpg",
          mediaType: "image/jpeg",
        },
      ],
      preview: async () => null,
      pick: () => {},
      onVisibilityChange: visibility,
    });

    picker.open();
    await settle();
    expect(visibility.mock.calls).toEqual([[true]]);

    picker.refresh();
    await settle();
    expect(visibility.mock.calls).toEqual([[true]]);

    expect(picker.onKeydown(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(
      true,
    );
    expect(visibility.mock.calls).toEqual([[true], [false]]);
  });

  it("arms click-to-pick on the PDF without showing the menu", async () => {
    const input = textareaWith("");
    const visibility = vi.fn();
    const pick = vi.fn();
    let onPick:
      | ((page: number, x: number, y: number) => PagePickResult)
      | null = null;
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:equation:1",
          kind: "equation",
          label: "公式 1",
          caption: "$$a$$",
          latex: "$$a$$",
          page: 0,
          bbox: [10, 10, 50, 50],
        },
      ],
      preview: async () => null,
      pick,
      watchPdf: (handler) => {
        onPick = handler;
        return () => {
          onPick = null;
        };
      },
      onVisibilityChange: visibility,
    });
    document.body.append(picker.menu);

    picker.arm();
    await settle();

    expect(picker.isArmed()).toBe(true);
    expect(picker.menu.style.display).toBe("none");
    expect(visibility.mock.calls).toEqual([[true]]);

    expect(onPick!(0, 900, 900)).toBe("miss");
    expect(onPick!(0, 30, 30)).toBe("picked");
    expect(pick).toHaveBeenCalledTimes(1);
    expect(picker.isArmed()).toBe(false);
    expect(visibility.mock.calls).toEqual([[true], [false]]);

    picker.menu.remove();
  });

  it("picks a formula by clicking the PDF while the menu is open", async () => {
    const input = textareaWith("@");
    const pick = vi.fn();
    let onPick: ((page: number, x: number, y: number) => boolean) | null = null;
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:images/a.jpg",
          kind: "figure",
          label: "图 1",
          caption: "第一页的图",
          path: "/cache/assets/images/a.jpg",
          mediaType: "image/jpeg",
          page: 0,
          bbox: [10, 10, 50, 50],
        },
        {
          id: "mineru:equation:2",
          kind: "equation",
          label: "公式 2",
          caption: "$$x + y$$",
          latex: "$$x + y$$",
          page: 0,
          bbox: [60, 60, 100, 100],
        },
      ],
      preview: async () => null,
      pick,
      watchPdf: (handler) => {
        onPick = handler;
        return () => {
          onPick = null;
        };
      },
    });
    document.body.append(picker.menu);

    picker.refresh();
    await settle();

    expect(picker.menu.style.display).not.toBe("none");
    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(2);

    expect(onPick!(0, 80, 80)).toBe("picked");
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.calls[0][0].kind).toBe("equation");
    expect(pick.mock.calls[0][0].label).toBe("公式 2");

    picker.menu.remove();
  });

  it("calls hover callbacks while the pointer moves over the PDF during picking", async () => {
    const input = textareaWith("");
    const hover = vi.fn();
    const hoverEnd = vi.fn();
    let onHover: ((page: number, x: number, y: number) => void) | null = null;
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "mineru:images/a.jpg",
          kind: "figure",
          label: "图 1",
          caption: "Picture",
          path: "/cache/assets/images/a.jpg",
          mediaType: "image/jpeg",
          page: 0,
          bbox: [10, 10, 50, 50],
        },
        {
          id: "mineru:equation:2",
          kind: "equation",
          label: "公式 2",
          caption: "$$x$$",
          latex: "$$x$$",
          page: 0,
          bbox: [60, 60, 100, 100],
        },
      ],
      preview: async () => null,
      pick: () => {},
      hover,
      hoverEnd,
      watchPdf: (onPick, hoverCallback) => {
        onHover = hoverCallback ?? null;
        return () => {
          onHover = null;
        };
      },
    });
    document.body.append(picker.menu);

    picker.arm();
    await settle();

    expect(onHover).not.toBeNull();

    onHover!(0, 30, 30);
    expect(hover).toHaveBeenCalledTimes(1);
    expect(hover.mock.calls[0][0].id).toBe("mineru:images/a.jpg");

    onHover!(0, 30, 30);
    expect(hover).toHaveBeenCalledTimes(1);

    onHover!(0, 900, 900);
    expect(hoverEnd).toHaveBeenCalledTimes(1);

    onHover!(0, 80, 80);
    expect(hover).toHaveBeenCalledTimes(2);
    expect(hover.mock.calls[1][0].id).toBe("mineru:equation:2");

    picker.menu.remove();
  });

  it("opens the list instead of arming when no material has a PDF box", async () => {
    // LaTeX-sourced material carries a page but no box, so click-to-pick can
    // never hit anything: the chip must fall back to the list. The pages still
    // become a pick surface, so browsing the list cannot select PDF text by
    // accident — a click there simply hits nothing.
    const input = textareaWith("");
    const watchPdf = vi.fn(() => () => {});
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "latex:table:1",
          kind: "table",
          label: "表 1",
          caption: "数据对比",
          latex: "\\begin{tabular}{ll} A & B \\end{tabular}",
          page: 3,
        },
      ],
      preview: async () => null,
      pick: () => {},
      watchPdf,
      currentPage: () => 3,
    });
    document.body.append(picker.menu);

    picker.arm();
    await settle();

    expect(picker.isArmed()).toBe(false);
    expect(picker.isOpen()).toBe(true);
    expect(picker.menu.querySelectorAll(".figure-item")).toHaveLength(1);
    expect(picker.menu.textContent).toContain("直接在列表里选");
    expect(watchPdf).toHaveBeenCalled();

    // Nothing on a LaTeX paper's page carries a box, so a click there is not a
    // miss to be swallowed: it reports back that this paper cannot be picked.
    const onPick = (
      watchPdf.mock.calls as unknown as Array<
        [(page: number, x: number, y: number) => PagePickResult]
      >
    )[0][0];
    expect(onPick(3, 500, 500)).toBe("unpickable");

    picker.menu.remove();
  });

  it("explains a page-less list instead of leaving 本页 at 0", async () => {
    const input = textareaWith("@");
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "latex:table:1",
          kind: "table",
          label: "表 1",
          caption: "延迟对比",
          latex: "\\begin{tabular}{ll} A & B \\end{tabular}",
        },
      ],
      preview: async () => null,
      pick: () => {},
      currentPage: () => 3,
    });
    picker.refresh();
    await settle();

    const foot = picker.menu.querySelector(".figure-menu-foot")!;
    // No reader text yet: say the pages are unknown rather than implying the
    // paper has nothing on the page being read.
    expect(foot.textContent).toContain("还没读到 PDF 页码");
    expect(foot.textContent).not.toContain("本页没有的素材");

    picker.menu.remove();
  });

  it("drops the half-typed mention when the list is dismissed", async () => {
    const input = textareaWith("这张图讲了什么 @");
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [
        {
          id: "latex:table:1",
          kind: "table",
          label: "表 1",
          caption: "延迟对比",
          latex: "\\begin{tabular}{ll} A & B \\end{tabular}",
        },
      ],
      preview: async () => null,
      pick: () => {},
    });
    picker.refresh();
    await settle();

    let announced = 0;
    input.addEventListener("input", () => {
      announced += 1;
    });
    picker.dismiss();

    expect(input.value).toBe("这张图讲了什么 ");
    expect(input.selectionStart).toBe(input.value.length);
    expect(picker.menu.style.display).toBe("none");
    // The composer has to hear about it, or the draft would keep the `@`.
    expect(announced).toBe(1);
  });

  it("leaves the text alone when there is no mention to drop", async () => {
    const input = textareaWith("这张图讲了什么");
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [],
      preview: async () => null,
      pick: () => {},
    });

    picker.dismiss();

    expect(input.value).toBe("这张图讲了什么");
  });

  it("treats Esc as cancelling the mention, not only the popup", async () => {
    const input = textareaWith("@");
    const picker = createFigurePicker({
      doc: document,
      input,
      load: async () => [],
      preview: async () => null,
      pick: () => {},
    });
    picker.refresh();
    await settle();

    expect(
      picker.onKeydown(new KeyboardEvent("keydown", { key: "Escape" })),
    ).toBe(true);
    expect(input.value).toBe("");
  });

});

describe("paper figure file names", () => {
  it("keeps the label and the source extension", () => {
    expect(
      paperFigureFileName({
        id: "mineru:images/x.jpg",
        kind: "figure",
        label: "图 3",
        caption: "",
        path: "/cache/assets/images/abc123.jpg",
        mediaType: "image/jpeg",
      }),
    ).toBe("图-3-abc123.jpg");
  });
});
