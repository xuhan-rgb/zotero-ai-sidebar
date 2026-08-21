import { describe, expect, it, vi } from "vitest";

import { locateWebAnnotationQuote } from "../../src/modules/web-annotation-locate";

describe("WEB annotation quote location", () => {
  it("falls back to a continuous prose clause when a display formula breaks the full quote", async () => {
    const locate = vi.fn(async (needle: string, options?: { exactOnly?: boolean }) => {
      if (
        options?.exactOnly &&
        needle ===
          "它表示方位角在约3秒或更长时间尺度上的变化，属于希望保留的慢变化。"
      ) {
        return { matchedText: needle, confidence: 1 };
      }
      return null;
    });

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

  it("does not use short fragments that could match an unrelated PDF location", async () => {
    const locate = vi.fn(async () => null);

    await locateWebAnnotationQuote(
      { locate },
      "短句：x = 1，因此成立。",
      0.85,
    );

    expect(locate).toHaveBeenCalledTimes(2);
    expect(locate).toHaveBeenNthCalledWith(1, "短句：x = 1，因此成立。", {
      exactOnly: true,
    });
    expect(locate).toHaveBeenNthCalledWith(2, "短句：x = 1，因此成立。", {
      minConfidence: 0.85,
    });
  });
});
