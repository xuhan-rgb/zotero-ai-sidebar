import { describe, expect, it, vi } from "vitest";

import {
  renderFullTranslationView,
  type FullTranslationLayout,
} from "../../src/modules/full-translation-view";
import { createFullTranslationState } from "../../src/settings/full-translation-store";
import { DEFAULT_FULL_TRANSLATION_READING_SETTINGS } from "../../src/settings/local-ui-settings";
import type { FullTranslationDocument } from "../../src/translate/full-document";

const document: FullTranslationDocument = {
  schemaVersion: 1,
  arxivId: "2504.16054",
  sourceHash: "0123456789abcdef",
  blocks: [
    {
      id: "section-1",
      kind: "heading",
      source: "Method",
      translatable: true,
      level: 1,
      number: "1",
    },
    {
      id: "section-1-p1",
      kind: "paragraph",
      source: "Loss $L$ is minimized.",
      translatable: true,
    },
    {
      id: "equation-1",
      kind: "formula",
      source: "L = L_{task}",
      translatable: false,
      number: 1,
    },
    {
      id: "figure-1-caption",
      kind: "figure-caption",
      source: "System overview.",
      translatable: true,
      number: 1,
      assets: ["figures/system.png"],
    },
    {
      id: "table-1-caption",
      kind: "table-caption",
      source: "Evaluation results.",
      translatable: true,
      number: 1,
      table: {
        rows: [
          ["Method", "Success"],
          ["Ours", "87%"],
        ],
      },
    },
  ],
};

function state() {
  const value = createFullTranslationState(document, "preset-1", "model-1");
  value.usage = { input: 1200, output: 300, cacheRead: 200 };
  value.blocks["section-1"] = { status: "done", translation: "方法" };
  value.blocks["section-1-p1"] = {
    status: "done",
    translation: "最小化损失 $L$。",
  };
  value.blocks["figure-1-caption"] = {
    status: "done",
    translation: "系统概览。",
  };
  value.blocks["table-1-caption"] = {
    status: "done",
    translation: "评估结果。",
  };
  return value;
}

type UsageEvent = {
  blockId: string;
  usage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheReadIncludedInInput?: boolean;
  };
  recordedAt: string;
};

function addUsageEvents(value: ReturnType<typeof state>, events: UsageEvent[]) {
  (value as typeof value & { usageEvents: UsageEvent[] }).usageEvents = events;
  return value;
}

function render(layout: FullTranslationLayout = "parallel") {
  return renderFullTranslationView(globalThis.document, {
    document,
    state: state(),
    layout,
    running: false,
    assets: {
      "figures/system.png": {
        sourcePath: "figures/system.png",
        previewUrl: "data:image/png;base64,AQID",
      },
    },
    onLayoutChange: vi.fn(),
    onRun: vi.fn(),
    onRetranslate: vi.fn(),
    onCancel: vi.fn(),
    onExit: vi.fn(),
  });
}

describe("renderFullTranslationView", () => {
  it("aligns original and translated content by stable block ID", () => {
    const view = render();
    const row = view.querySelector('[data-block-id="section-1-p1"]');

    expect(view.classList.contains("is-parallel")).toBe(true);
    expect(row?.querySelector(".zai-ft-source")?.textContent).toContain("Loss");
    expect(row?.querySelector(".zai-ft-translation")?.textContent).toContain(
      "最小化损失",
    );
    expect(
      view.querySelector('[data-block-id="equation-1"] .zai-ft-shared-formula')
        ?.textContent,
    ).toContain("L");
    expect(
      view.querySelectorAll(
        '[data-block-id="equation-1"] .zai-ft-shared-visual',
      ),
    ).toHaveLength(1);
    expect(
      view.querySelectorAll('[data-block-id="equation-1"] .zai-ft-block-body'),
    ).toHaveLength(1);
    expect(
      view.querySelectorAll('[data-block-id="equation-1"] .zai-ft-cell'),
    ).toHaveLength(0);
    expect(
      view.querySelectorAll('[data-block-id="figure-1-caption"] img'),
    ).toHaveLength(1);
    expect(
      view.querySelectorAll('[data-block-id="table-1-caption"] table'),
    ).toHaveLength(1);
    expect(
      view.querySelectorAll(
        '[data-block-id="figure-1-caption"] .zai-ft-shared-visual',
      ),
    ).toHaveLength(1);
    expect(
      view.querySelectorAll('[data-block-id="figure-1-caption"] .zai-ft-cell'),
    ).toHaveLength(2);
    expect(
      view.querySelector('[data-block-id="figure-1-caption"] .zai-ft-source')
        ?.textContent,
    ).toContain("System overview.");
    expect(
      view.querySelector(
        '[data-block-id="figure-1-caption"] .zai-ft-translation',
      )?.textContent,
    ).toContain("系统概览。");
    expect(
      view.querySelectorAll(
        '[data-block-id="figure-1-caption"] .zai-ft-marker',
      ),
    ).toHaveLength(1);
  });

  it("renders the same block pairs in interleaved mode", () => {
    const view = render("interleaved");
    const row = view.querySelector('[data-block-id="section-1-p1"]');

    expect(view.classList.contains("is-interleaved")).toBe(true);
    expect(row?.children[0]?.classList.contains("zai-ft-source")).toBe(true);
    expect(row?.children[1]?.classList.contains("zai-ft-translation")).toBe(
      true,
    );
  });

  it("keeps a bilingual heading in one interleaved row with one section number", () => {
    const view = render("interleaved");
    const heading = view.querySelector('[data-block-id="section-1"]');

    expect(heading?.children).toHaveLength(2);
    expect(heading?.children[0]?.textContent).toContain("Method");
    expect(heading?.children[1]?.textContent).toContain("方法");
    expect(heading?.querySelectorAll(".zai-ft-marker")).toHaveLength(1);
    expect(
      heading?.querySelector(".zai-ft-source .zai-ft-marker")?.textContent,
    ).toBe("1");
    expect(
      heading?.querySelector(".zai-ft-translation .zai-ft-marker"),
    ).toBeNull();
  });

  it("applies default reading markers when settings are omitted", () => {
    const view = render();
    const marker = view.querySelector<HTMLElement>(
      '[data-block-id="section-1-p1"] .zai-ft-source .zai-ft-sentence-boundary',
    );

    expect(marker?.dataset.marker).toBe("//");
  });

  it("switches source visibility independently from the bilingual layout", () => {
    const onReadingSettingsChange = vi.fn();
    const readingSettings = {
      ...DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      languageMode: "translation" as const,
      layout: "interleaved" as const,
    };
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: state(),
      layout: readingSettings.layout,
      running: false,
      assets: {},
      readingSettings,
      onReadingSettingsChange,
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });

    expect(view.classList.contains("is-translation-only")).toBe(true);
    expect(
      view.querySelectorAll<HTMLButtonElement>(".zai-ft-layouts button")[0]
        ?.disabled,
    ).toBe(true);
    expect(
      view.querySelectorAll<HTMLButtonElement>(".zai-ft-layouts button")[1]
        ?.disabled,
    ).toBe(true);
    expect(view.querySelector(".zai-ft-outline")?.textContent).toContain(
      "方法",
    );

    const sourceOnly = view.querySelector(
      '[data-language-mode="source"]',
    ) as HTMLButtonElement;
    sourceOnly.click();
    expect(onReadingSettingsChange).toHaveBeenCalledWith({
      ...readingSettings,
      languageMode: "source",
    });
  });

  it("applies sentence marker, color, and line-break reading settings", () => {
    const onReadingSettingsChange = vi.fn();
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: state(),
      layout: "parallel",
      running: false,
      assets: {},
      readingSettings: DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      onReadingSettingsChange,
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const settings = view.querySelector(
      ".zai-ft-reading-settings",
    ) as HTMLDetailsElement;
    const form = settings.querySelector("form") as HTMLFormElement;
    const markerStyle = form.elements.namedItem(
      "markerStyle",
    ) as HTMLSelectElement;
    const colorMode = form.elements.namedItem(
      "markerColorMode",
    ) as HTMLSelectElement;
    const markerColor = form.elements.namedItem(
      "markerColor",
    ) as HTMLInputElement;
    const lineBreakMode = form.elements.namedItem(
      "lineBreakMode",
    ) as HTMLSelectElement;

    expect(settings.querySelector("summary")?.textContent).toBe("阅读设置");
    markerStyle.value = "circled";
    colorMode.value = "single";
    markerColor.value = "#336699";
    lineBreakMode.value = "sentence-semicolon";
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(onReadingSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      markerStyle: "circled",
      markerColorMode: "single",
      markerColor: "#336699",
      lineBreakMode: "sentence-semicolon",
    });
  });

  it("adds display-only sentence markers without splitting abbreviations or math", () => {
    const markedDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        {
          id: "marked-paragraph",
          kind: "paragraph",
          source: "See Dr. Smith. Loss $L = 1.2$ works. Next?",
          translatable: true,
        },
      ],
    };
    const markedState = createFullTranslationState(
      markedDocument,
      "preset-1",
      "model-1",
    );
    markedState.blocks["marked-paragraph"] = {
      status: "done",
      translation: "参见 Smith 博士。损失 $L = 1.2$ 有效。下一句？",
    };
    const renderMarked = (withMarkers: boolean) =>
      renderFullTranslationView(globalThis.document, {
        document: markedDocument,
        state: markedState,
        layout: "parallel",
        running: false,
        assets: {},
        readingSettings: withMarkers
          ? DEFAULT_FULL_TRANSLATION_READING_SETTINGS
          : {
              ...DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
              markerStyle: "off",
            },
        onLayoutChange: vi.fn(),
        onRun: vi.fn(),
        onRetranslate: vi.fn(),
        onCancel: vi.fn(),
        onExit: vi.fn(),
      });
    const baseline = renderMarked(false);
    const marked = renderMarked(true);
    const markedSource = marked.querySelector(
      '[data-block-id="marked-paragraph"] .zai-ft-source .zai-ft-block-body',
    ) as HTMLElement;
    const baselineSource = baseline.querySelector(
      '[data-block-id="marked-paragraph"] .zai-ft-source .zai-ft-block-body',
    ) as HTMLElement;

    expect(
      markedSource.querySelectorAll(".zai-ft-sentence-boundary"),
    ).toHaveLength(3);
    expect(
      Array.from(
        markedSource.querySelectorAll<HTMLElement>(".zai-ft-sentence-boundary"),
      ).map((marker) => marker.dataset.marker),
    ).toEqual(["//", "//", "//"]);
    expect(
      markedSource.querySelector(".math-inline .zai-ft-sentence-boundary"),
    ).toBeNull();
    expect(markedSource.textContent).toBe(baselineSource.textContent);
  });

  it("numbers sentence ends by color while treating semicolons as line breaks only", () => {
    const segmentedDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        {
          id: "segmented-paragraph",
          kind: "paragraph",
          source: "First clause; still one sentence. Second sentence.",
          translatable: true,
        },
      ],
    };
    const segmentedState = createFullTranslationState(
      segmentedDocument,
      "preset-1",
      "model-1",
    );
    segmentedState.blocks["segmented-paragraph"] = {
      status: "done",
      translation: "第一个分句；仍是同一句。第二句。",
    };
    const view = renderFullTranslationView(globalThis.document, {
      document: segmentedDocument,
      state: segmentedState,
      layout: "parallel",
      running: false,
      assets: {},
      readingSettings: {
        ...DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
        markerStyle: "circled",
        lineBreakMode: "sentence-semicolon",
      },
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const sides = ["source", "translation"].map((side) =>
      Array.from(
        view.querySelectorAll<HTMLElement>(
          `[data-block-id="segmented-paragraph"] .zai-ft-${side} .zai-ft-sentence-boundary`,
        ),
      ),
    );

    for (const markers of sides) {
      expect(markers.map((marker) => marker.dataset.marker)).toEqual([
        "",
        "①",
        "②",
      ]);
      expect(
        markers.every((marker) => marker.classList.contains("is-line-break")),
      ).toBe(true);
      expect(markers[1]?.classList.contains("tone-0")).toBe(true);
      expect(markers[2]?.classList.contains("tone-1")).toBe(true);
    }
  });

  it("places one marker after closing quotes and consecutive punctuation", () => {
    const quotedDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        {
          id: "quoted-paragraph",
          kind: "paragraph",
          source: "The result was “Done.” Next?!",
          translatable: true,
        },
      ],
    };
    const view = renderFullTranslationView(globalThis.document, {
      document: quotedDocument,
      state: createFullTranslationState(quotedDocument, "preset-1", "model-1"),
      layout: "parallel",
      running: false,
      assets: {},
      readingSettings: DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const markers = Array.from(
      view.querySelectorAll<HTMLElement>(
        '[data-block-id="quoted-paragraph"] .zai-ft-source .zai-ft-sentence-boundary',
      ),
    );

    expect(markers).toHaveLength(2);
    expect(markers[0]?.previousSibling?.textContent).toMatch(/”$/);
    expect(markers[1]?.previousSibling?.textContent).toMatch(/!$/);
  });

  it("places sentence markers after common Chinese closing punctuation", () => {
    const closers = [
      "」",
      "』",
      "）",
      "】",
      "》",
      "〉",
      "〕",
      "〗",
      "〙",
      "〛",
      "〞",
      "〟",
      "］",
      "｝",
      "｣",
    ];
    const markedDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        {
          id: "chinese-closers",
          kind: "paragraph",
          source: closers
            .map((closer, index) => `第${index + 1}句。${closer}`)
            .join(" "),
          translatable: true,
        },
      ],
    };
    const view = renderFullTranslationView(globalThis.document, {
      document: markedDocument,
      state: createFullTranslationState(markedDocument, "preset-1", "model-1"),
      layout: "parallel",
      running: false,
      assets: {},
      readingSettings: DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const markers = Array.from(
      view.querySelectorAll<HTMLElement>(
        '[data-block-id="chinese-closers"] .zai-ft-source .zai-ft-sentence-boundary',
      ),
    );

    expect(markers).toHaveLength(closers.length);
    expect(
      markers.map((marker) => marker.previousSibling?.textContent?.at(-1)),
    ).toEqual(closers);
  });

  it("uses following sentence context when an abbreviation can end a sentence", () => {
    const markedDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        {
          id: "abbreviation-boundaries",
          kind: "paragraph",
          source:
            "Smith et al. report gains. We follow Jones et al. Next sentence starts. See Dr. Brown. Final sentence.",
          translatable: true,
        },
      ],
    };
    const view = renderFullTranslationView(globalThis.document, {
      document: markedDocument,
      state: createFullTranslationState(markedDocument, "preset-1", "model-1"),
      layout: "parallel",
      running: false,
      assets: {},
      readingSettings: DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const body = view.querySelector(
      '[data-block-id="abbreviation-boundaries"] .zai-ft-source .zai-ft-block-body',
    ) as HTMLElement;
    const markers = Array.from(
      body.querySelectorAll<HTMLElement>(".zai-ft-sentence-boundary"),
    );
    const prefixes = markers.map((marker) => {
      const range = globalThis.document.createRange();
      range.selectNodeContents(body);
      range.setEndBefore(marker);
      return range.toString();
    });

    expect(prefixes).toEqual([
      "Smith et al. report gains.",
      "Smith et al. report gains. We follow Jones et al.",
      "Smith et al. report gains. We follow Jones et al. Next sentence starts.",
      "Smith et al. report gains. We follow Jones et al. Next sentence starts. See Dr. Brown.",
      "Smith et al. report gains. We follow Jones et al. Next sentence starts. See Dr. Brown. Final sentence.",
    ]);
  });

  it("offers a per-block translation action only on translatable blocks", () => {
    const onTranslateBlock = vi.fn();
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: state(),
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onTranslateBlock,
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const action = view.querySelector(
      '[data-block-id="section-1-p1"] .zai-ft-block-action',
    ) as HTMLButtonElement;

    expect(action).not.toBeNull();
    expect(action.closest(".zai-ft-translation")).not.toBeNull();
    expect(action.title).toBe("重新翻译此段");
    expect(
      view.querySelector('[data-block-id="equation-1"] .zai-ft-block-action'),
    ).toBeNull();
    action.click();
    expect(onTranslateBlock).toHaveBeenCalledWith("section-1-p1");
  });

  it("locks block actions only while a translation request is active", () => {
    const translating = state();
    translating.blocks["section-1-p1"] = { status: "translating" };
    const options = {
      document,
      state: translating,
      layout: "parallel" as const,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onTranslateBlock: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    };

    const active = renderFullTranslationView(globalThis.document, {
      ...options,
      running: true,
    });
    const activeAction = active.querySelector(
      '[data-block-id="section-1-p1"] .zai-ft-block-action',
    ) as HTMLButtonElement;
    expect(activeAction.disabled).toBe(true);
    expect(activeAction.title).toBe("正在翻译此段");

    const resumable = renderFullTranslationView(globalThis.document, {
      ...options,
      running: false,
    });
    const resumableAction = resumable.querySelector(
      '[data-block-id="section-1-p1"] .zai-ft-block-action',
    ) as HTMLButtonElement;
    expect(resumableAction.disabled).toBe(false);
    expect(resumableAction.title).toBe("翻译此段");
  });

  it("shows persisted token usage after translation completes", () => {
    const view = render();
    const usage = view.querySelector(".zai-ft-token-usage");

    expect(usage?.textContent).toContain("累计 1.5k · 缓存 17%");
    expect(view.querySelector(".zai-ft-usage-total")?.textContent).toContain(
      "Hit 200 · Miss 1,000 · Output 300",
    );
    expect(usage?.title).toContain("Token total: 1,500");
  });

  it("shows an explicit total when the provider does not report cache usage", () => {
    const withoutCache = state();
    withoutCache.usage = { input: 100, output: 20 };
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: withoutCache,
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });

    expect(view.querySelector(".zai-ft-token-usage")?.textContent).toContain(
      "累计 120 · 缓存未返回",
    );
    expect(view.querySelector(".zai-ft-usage-total")?.textContent).toContain(
      "Miss 100",
    );
  });

  it("expands translation attempts newest first with per-attempt usage", () => {
    const withEvents = addUsageEvents(state(), [
      {
        blockId: "section-1-p1",
        usage: { input: 80, output: 20, cacheRead: 20 },
        recordedAt: "2026-08-09T02:00:00.000Z",
      },
      {
        blockId: "figure-1-caption",
        usage: { input: 120, output: 30 },
        recordedAt: "2026-08-09T03:00:00.000Z",
      },
    ]);
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: withEvents,
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const details = view.querySelector(
      ".zai-ft-usage-history",
    ) as HTMLDetailsElement;

    (details.querySelector("summary") as HTMLElement).click();

    const attempts = Array.from(
      details.querySelectorAll(".zai-ft-usage-event"),
    );
    expect(details.open).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.getAttribute("data-target-block-id")).toBe(
      "figure-1-caption",
    );
    expect(attempts[0]?.textContent).toContain("第 2 次");
    expect(attempts[0]?.textContent).toContain("Total 150");
    expect(attempts[0]?.textContent).toContain("Hit 未返回");
    expect(attempts[0]?.textContent).toContain("Miss 120");
    expect(attempts[0]?.textContent).toContain("Output 30");
    expect(attempts[0]?.textContent).toContain("Rate 未返回");
    expect(attempts[1]?.textContent).toContain("Total 100");
    expect(attempts[1]?.textContent).toContain("Hit 20");
    expect(attempts[1]?.textContent).toContain("Miss 60");
    expect(attempts[1]?.textContent).toContain("Rate 25%");
  });

  it("hides expanded translation statistics when the translation page is clicked", () => {
    const withEvents = addUsageEvents(state(), [
      {
        blockId: "section-1-p1",
        usage: { input: 80, output: 20 },
        recordedAt: "2026-08-09T02:00:00.000Z",
      },
    ]);
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: withEvents,
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const details = view.querySelector(
      ".zai-ft-usage-history",
    ) as HTMLDetailsElement;

    (details.querySelector("summary") as HTMLElement).click();
    expect(details.open).toBe(true);

    (view.querySelector(".zai-ft-content") as HTMLElement).click();

    expect(details.open).toBe(false);
  });

  it("maps each attempt to its nearest heading and original excerpt", () => {
    const withEvents = addUsageEvents(state(), [
      {
        blockId: "section-1-p1",
        usage: { input: 80, output: 20 },
        recordedAt: "2026-08-09T02:00:00.000Z",
      },
    ]);
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: withEvents,
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const attempt = view.querySelector(".zai-ft-usage-event");

    expect(attempt?.querySelector(".zai-ft-usage-context")?.textContent).toBe(
      "1 Method",
    );
    expect(attempt?.querySelector(".zai-ft-usage-excerpt")?.textContent).toBe(
      "Loss L is minimized.",
    );
  });

  it("jumps to and temporarily highlights the attempt's bilingual row", () => {
    vi.useFakeTimers();
    try {
      const withEvents = addUsageEvents(state(), [
        {
          blockId: "section-1-p1",
          usage: { input: 80, output: 20 },
          recordedAt: "2026-08-09T02:00:00.000Z",
        },
      ]);
      const view = renderFullTranslationView(globalThis.document, {
        document,
        state: withEvents,
        layout: "parallel",
        running: false,
        assets: {},
        onLayoutChange: vi.fn(),
        onRun: vi.fn(),
        onRetranslate: vi.fn(),
        onCancel: vi.fn(),
        onExit: vi.fn(),
      });
      const details = view.querySelector(
        ".zai-ft-usage-history",
      ) as HTMLDetailsElement;
      const target = view.querySelector(
        '[data-block-id="section-1-p1"]',
      ) as HTMLElement;
      const scrollIntoView = vi.fn();
      target.scrollIntoView = scrollIntoView;
      details.open = true;

      (details.querySelector(".zai-ft-usage-event") as HTMLElement).click();

      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
      expect(target.classList.contains("is-usage-target")).toBe(true);
      expect(details.open).toBe(false);
      vi.advanceTimersByTime(2_000);
      expect(target.classList.contains("is-usage-target")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains missing history for legacy and partially covered usage", () => {
    const legacyView = render();
    expect(legacyView.querySelector(".zai-ft-usage-legacy")?.textContent).toBe(
      "旧记录只有全文累计；后续翻译会记录到段落",
    );

    const partial = addUsageEvents(state(), [
      {
        blockId: "section-1-p1",
        usage: { input: 80, output: 20 },
        recordedAt: "2026-08-09T02:00:00.000Z",
      },
    ]);
    const partialView = renderFullTranslationView(globalThis.document, {
      document,
      state: partial,
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });

    expect(partialView.querySelector(".zai-ft-usage-legacy")?.textContent).toBe(
      "旧数据中的部分 Token 没有逐段明细",
    );
  });

  it("keeps accumulated token usage visible while work is incomplete", () => {
    const partial = state();
    partial.blocks["section-1-p1"] = {
      status: "error",
      error: "rate limited",
    };
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: partial,
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });

    expect(view.querySelector(".zai-ft-usage-total")?.textContent).toContain(
      "Hit 200",
    );
  });

  it("keeps the translation and token toolbar visible after a run error", () => {
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: state(),
      layout: "parallel",
      running: false,
      runError: "无法保存翻译进度",
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });

    expect(view.querySelector(".zai-ft-run-error")?.textContent).toContain(
      "无法保存翻译进度",
    );
    expect(view.querySelector(".zai-ft-usage-total")?.textContent).toContain(
      "Hit 200",
    );
    expect(view.querySelector(".zai-ft-content")).not.toBeNull();
  });

  it("summarizes cache tokens reported outside the raw input count", () => {
    const separateCache = state();
    separateCache.usage = {
      input: 100,
      output: 20,
      cacheRead: 40,
      cacheReadIncludedInInput: false,
    };
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: separateCache,
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const usage = view.querySelector(".zai-ft-token-usage");

    expect(usage?.textContent).toContain("累计 160 · 缓存 29%");
    expect(view.querySelector(".zai-ft-usage-total")?.textContent).toContain(
      "Hit 40 · Miss 100 · Output 20",
    );
    expect(usage?.title).toContain("Token total: 160");
  });

  it("requires confirmation before requesting a complete retranslation", () => {
    const onRetranslate = vi.fn();
    const confirm = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    Object.defineProperty(globalThis.window, "confirm", {
      configurable: true,
      value: confirm,
    });
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: state(),
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate,
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const button = view.querySelector(".zai-ft-run") as HTMLButtonElement;

    expect(button.textContent).toBe("重新翻译");
    expect(button.disabled).toBe(false);
    button.click();
    expect(onRetranslate).not.toHaveBeenCalled();
    button.click();
    expect(onRetranslate).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).toContain("清除现有译文");
    expect(confirm.mock.calls[0]?.[0]).toContain("API");
  });

  it.each([
    "好的，请提供需要翻译的英文内容。",
    "打扰一下，我能不能问你一个问题？",
    "很抱歉，您似乎只提供了“Introduction”这个词，但没有提供需要翻译的英文原文。请提供您希望翻译成简体中文的完整文本内容，我将为您翻译。",
    "对不起，我还没有学会回答这个问题。如果你有其他问题，我非常乐意为你提供帮助。",
    "您好！请问您需要翻译什么内容呢？如果有具体的文本或请求，请提供，我会为您进行中英互译。",
    "您好！请问有什么可以帮您？",
    "您好，欢迎使用。如果您有任何问题或需要帮助，请随时告诉我。",
  ])(
    "offers continuation when a cached block contains an invalid reply: %s",
    (invalidReply) => {
      const invalid = state();
      invalid.blocks["section-1"] = {
        status: "done",
        translation: invalidReply,
      };
      const onRun = vi.fn();
      const view = renderFullTranslationView(globalThis.document, {
        document,
        state: invalid,
        layout: "parallel",
        running: false,
        assets: {},
        onLayoutChange: vi.fn(),
        onRun,
        onRetranslate: vi.fn(),
        onCancel: vi.fn(),
        onExit: vi.fn(),
      });
      const button = view.querySelector(".zai-ft-run") as HTMLButtonElement;

      expect(button.textContent).toBe("继续翻译");
      expect(
        view.querySelector('[data-block-id="section-1"] .zai-ft-translation')
          ?.textContent,
      ).toContain("等待翻译");
      expect(view.textContent).not.toContain(invalidReply);
      button.click();
      expect(onRun).toHaveBeenCalledOnce();
    },
  );

  it("locks the action while a confirmed retranslation is being prepared", () => {
    const onRun = vi.fn();
    const onRetranslate = vi.fn();
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: state(),
      layout: "parallel",
      running: false,
      preparing: true,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun,
      onRetranslate,
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });
    const button = view.querySelector(".zai-ft-run") as HTMLButtonElement;

    expect(button.textContent).toBe("准备重译…");
    expect(button.disabled).toBe(true);
    button.click();
    expect(onRun).not.toHaveBeenCalled();
    expect(onRetranslate).not.toHaveBeenCalled();
  });

  it("does not expose parser verification in the runtime view", () => {
    const view = render();

    expect(view.querySelector(".zai-ft-preflight")).toBeNull();
    expect(view.querySelector(".zai-ft-preflight-status")).toBeNull();
    expect(view.textContent).not.toContain("HTML 预检");
  });

  it("reports layout changes without creating a new translation", () => {
    const onLayoutChange = vi.fn();
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: state(),
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange,
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit: vi.fn(),
    });

    (view.querySelector('[data-layout="interleaved"]') as HTMLElement).click();
    expect(onLayoutChange).toHaveBeenCalledWith("interleaved");
  });

  it("returns to the existing PDF from the same reader tab", () => {
    const onExit = vi.fn();
    const view = renderFullTranslationView(globalThis.document, {
      document,
      state: state(),
      layout: "parallel",
      running: false,
      assets: {},
      onLayoutChange: vi.fn(),
      onRun: vi.fn(),
      onRetranslate: vi.fn(),
      onCancel: vi.fn(),
      onExit,
    });

    (view.querySelector(".zai-ft-exit") as HTMLElement).click();

    expect(onExit).toHaveBeenCalledOnce();
  });

  it("renders a left document outline that jumps to bilingual blocks", () => {
    const view = render();
    const target = view.querySelector(
      '[data-block-id="section-1"]',
    ) as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    const outlineItem = view.querySelector(
      '.zai-ft-outline [data-target-block-id="section-1"]',
    ) as HTMLButtonElement;
    outlineItem.click();

    expect(view.querySelectorAll(".zai-ft-outline-item")).toHaveLength(1);
    expect(outlineItem.textContent).toContain("Method");
    expect(outlineItem.classList.contains("is-active")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});
