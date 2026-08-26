import { describe, expect, it, vi } from "vitest";

import {
  locateWebAnnotationQuote,
  locateWebAnnotationQuoteSegments,
} from "../../src/modules/web-annotation-locate";

describe("WEB annotation quote location", () => {
  it("uses the exact passage without terminal punctuation instead of a wider fuzzy window", async () => {
    const quote =
      "To address this limitation, we introduce a latent world model designed to predict future latent features directly from the current latent features and ego actions.";
    const exactPassage = quote.slice(0, -1);
    const widerWindow =
      "their reliance on diffusion models, which may take several seconds to generate images of a future scene. To address this limitation, we introduce a latent world model";
    const locate = vi.fn(
      async (needle: string, options?: { exactOnly?: boolean }) => {
        if (options?.exactOnly && needle === exactPassage) {
          return { matchedText: exactPassage, confidence: 1 };
        }
        if (!options?.exactOnly && needle === quote) {
          return { matchedText: widerWindow, confidence: 0.94 };
        }
        return null;
      },
    );

    const result = await locateWebAnnotationQuote({ locate }, quote, 0.85);

    expect(result).toEqual({ matchedText: exactPassage, confidence: 1 });
  });

  it("repairs a small wording drift to an exact sentence from the Reader page", async () => {
    const quote =
      "LAW predicts future latent scene features based on current features and ego trajectories.";
    const readerSentence =
      "LAW predicts future scene features based on current features and ego trajectories.";
    const exactResult = {
      matchedText: readerSentence,
      confidence: 1,
      pageIndex: 0,
    };
    const locator = {
      pageCount: 1,
      getPageContent: vi.fn(async () => ({
        pageText: `Background sentence. ${readerSentence} Closing sentence.`,
      })),
      locate: vi.fn(
        async (
          needle: string,
          options?: { exactOnly?: boolean; pageIndex?: number },
        ) =>
          options?.exactOnly &&
          options.pageIndex === 0 &&
          needle === readerSentence
            ? exactResult
            : null,
      ),
    };

    const result = await locateWebAnnotationQuote(locator, quote, 0.85);

    expect(result).toEqual(exactResult);
  });

  it("restores an exact Reader sentence when the model omitted author-year citations", async () => {
    const quote =
      "Traditional self-supervised methods in computer vision often focus on static, single-frame images. However, autonomous driving relies on continuous video input, so effectively using temporal data is crucial.";
    const readerSentence =
      "Traditional self-supervised methods in computer vision(He et al., 2022; Chen et al., 2020b) often focus on static, single-frame images. However, autonomous driving relies on continuous video input, so effectively using temporal data is crucial.";
    const exactResult = {
      matchedText: readerSentence,
      confidence: 1,
      pageIndex: 0,
    };
    const locator = {
      pageCount: 1,
      getPageContent: vi.fn(async () => ({ pageText: readerSentence })),
      locate: vi.fn(
        async (
          needle: string,
          options?: { exactOnly?: boolean; pageIndex?: number },
        ) =>
          options?.exactOnly &&
          options.pageIndex === 0 &&
          needle === readerSentence
            ? exactResult
            : null,
      ),
    };

    const result = await locateWebAnnotationQuote(locator, quote, 0.85);

    expect(result).toEqual(exactResult);
  });

  it("does not turn a sentence split across PDF pages into a partial highlight", async () => {
    const quote =
      "While several image-based driving world models exist, they exhibit inefficiencies in enhancing scene feature representations due to their reliance on diffusion models, which may take several seconds to generate images of a future scene.";
    const locator = {
      pageCount: 2,
      getPageContent: vi.fn(async (pageIndex: number) => ({
        pageText:
          pageIndex === 0
            ? "While several image-based driving world models (Wang et al., 2023b; Hu et al., 2023a; Jia et al., 2023a) exist, they exhibit inefficiencies in enhancing scene"
            : "feature representations due to their reliance on diffusion models, which may take several seconds to generate images of a future scene. To address this limitation, we introduce a latent world model.",
      })),
      locate: vi.fn(async () => null),
    };

    const result = await locateWebAnnotationQuote(locator, quote, 0.85);

    expect(result).toBeNull();
  });

  it("locates a reliable sentence split across adjacent PDF pages as two exact segments", async () => {
    const quote =
      "While several image-based driving world models exist, they exhibit inefficiencies in enhancing scene feature representations due to their reliance on diffusion models, which may take several seconds to generate images of a future scene.";
    const first =
      "While several image-based driving world models (Wang et al., 2023b; Hu et al., 2023a; Jia et al., 2023a) exist, they exhibit inefficiencies in enhancing scene";
    const second =
      "feature representations due to their reliance on diffusion models, which may take several seconds to generate images of a future scene.";
    const results = [
      { matchedText: first, confidence: 1, pageIndex: 0 },
      { matchedText: second, confidence: 1, pageIndex: 1 },
    ];
    const locator = {
      pageCount: 2,
      getPageContent: vi.fn(async (pageIndex: number) => ({
        pageText:
          pageIndex === 0
            ? `Opening sentence. ${first}`
            : `${second} To address this limitation, we introduce a latent world model.`,
      })),
      locate: vi.fn(
        async (
          needle: string,
          options?: { exactOnly?: boolean; pageIndex?: number },
        ) => {
          if (!options?.exactOnly) return null;
          if (options.pageIndex === 0 && needle === first) return results[0];
          if (options.pageIndex === 1 && needle === second) return results[1];
          return null;
        },
      ),
    };

    const result = await locateWebAnnotationQuoteSegments(locator, quote, 0.85);

    expect(result).toEqual(results);
  });

  it("rejects a cross-page quote when either page fragment is not exact", async () => {
    const quote =
      "While several image-based driving world models exist, they exhibit inefficiencies in enhancing scene feature representations due to their reliance on diffusion models, which may take several seconds to generate images of a future scene.";
    const first =
      "While several image-based driving world models exist, they exhibit inefficiencies in enhancing scene";
    const second =
      "feature representations due to their reliance on diffusion models, which may take several seconds to generate images of a future scene.";
    const locator = {
      pageCount: 2,
      getPageContent: vi.fn(async (pageIndex: number) => ({
        pageText: pageIndex === 0 ? first : second,
      })),
      locate: vi.fn(
        async (
          needle: string,
          options?: { exactOnly?: boolean; pageIndex?: number },
        ) =>
          options?.exactOnly && options.pageIndex === 0 && needle === first
            ? { matchedText: first, confidence: 1, pageIndex: 0 }
            : null,
      ),
    };

    const result = await locateWebAnnotationQuoteSegments(locator, quote, 0.85);

    expect(result).toBeNull();
  });

  it("finds cross-page fragments around a page footer and next-page figure", async () => {
    const quote =
      "While several image-based driving world models exist, they exhibit inefficiencies in enhancing scene feature representations due to their reliance on diffusion models, which may take several seconds to generate images of a future scene.";
    const first =
      "While several image-based driving world models (Wang et al., 2023b; Hu et al., 2023a; Jia et al., 2023a) exist, they exhibit inefficiencies in enhancing scene";
    const second =
      "feature representations due to their reliance on diffusion models, which may take several seconds to generate images of a future scene.";
    const results = [
      { matchedText: first, confidence: 1, pageIndex: 0 },
      { matchedText: second, confidence: 1, pageIndex: 1 },
    ];
    const pages = [
      `Earlier introduction. ${first}\n1 Email: author@example.org\n1`,
      `Published as a conference paper. Figure 1: The illustration of our self-supervised method. ${second} To address this limitation, we introduce a latent world model.`,
    ];
    const locator = {
      pageCount: 2,
      getPageContent: vi.fn(async (pageIndex: number) => ({
        pageText: pages[pageIndex],
      })),
      locate: vi.fn(
        async (
          needle: string,
          options?: { exactOnly?: boolean; pageIndex?: number },
        ) => {
          if (!options?.exactOnly) return null;
          if (options.pageIndex === 0 && needle === first) return results[0];
          if (options.pageIndex === 1 && needle === second) return results[1];
          return null;
        },
      ),
    };

    const result = await locateWebAnnotationQuoteSegments(
      locator,
      quote,
      0.85,
    );

    expect(result).toEqual(results);
  });

  it("prefers a reliable full-quote fuzzy match over an exact clause match", async () => {
    const quote =
      "To address this limitation, we introduce a latent world model designed to predict future latent features directly from the current latent features and ego actions.";
    const clause = "To address this limitation,";
    const locate = vi.fn(
      async (needle: string, options?: { exactOnly?: boolean }) => {
        if (options?.exactOnly && needle === clause) {
          return { matchedText: clause, confidence: 1 };
        }
        if (!options?.exactOnly && needle === quote) {
          return { matchedText: quote, confidence: 0.96 };
        }
        return null;
      },
    );

    const result = await locateWebAnnotationQuote({ locate }, quote, 0.85);

    expect(result).toEqual({ matchedText: quote, confidence: 0.96 });
  });

  it("falls back to a continuous prose clause when a display formula breaks the full quote", async () => {
    const locate = vi.fn(
      async (needle: string, options?: { exactOnly?: boolean }) => {
        if (
          options?.exactOnly &&
          needle ===
            "它表示方位角在约3秒或更长时间尺度上的变化，属于希望保留的慢变化。"
        ) {
          return { matchedText: needle, confidence: 1 };
        }
        return null;
      },
    );

    const result = await locateWebAnnotationQuote(
      { locate },
      "0.33Hz对应的时间周期为：T_pass = 1/0.33 ≈ 3.03s，它表示方位角在约3秒或更长时间尺度上的变化，属于希望保留的慢变化。",
      0.85,
    );

    expect(result?.matchedText).toContain("它表示方位角");
    expect(locate).toHaveBeenCalledWith(
      "它表示方位角在约3秒或更长时间尺度上的变化，属于希望保留的慢变化。",
      { exactOnly: true },
    );
  });

  it("does not silently save a clause when an ordinary full quote cannot be located", async () => {
    const quote =
      "To address this limitation, we introduce a latent world model designed to predict future latent features directly from the current latent features and ego actions.";
    const locate = vi.fn(
      async (needle: string, options?: { exactOnly?: boolean }) => {
        if (options?.exactOnly && needle === "To address this limitation,") {
          return { matchedText: needle, confidence: 1 };
        }
        return null;
      },
    );

    const result = await locateWebAnnotationQuote({ locate }, quote, 0.85);

    expect(result).toBeNull();
  });

  it("does not use short fragments that could match an unrelated PDF location", async () => {
    const locate = vi.fn(async () => null);

    await locateWebAnnotationQuote({ locate }, "短句：x = 1，因此成立。", 0.85);

    expect(locate).toHaveBeenCalledTimes(2);
    expect(locate).toHaveBeenNthCalledWith(1, "短句：x = 1，因此成立。", {
      exactOnly: true,
    });
    expect(locate).toHaveBeenNthCalledWith(2, "短句：x = 1，因此成立。", {
      minConfidence: 0.85,
    });
  });
});
