import { beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.hoisted(() => vi.fn());

vi.mock("../../src/providers/factory", () => ({
  getProvider: () => ({ stream }),
}));

import { createFullDocumentTranslator } from "../../src/translate/full-document-provider";
import type { PrefsStore } from "../../src/settings/storage";

const preset = {
  id: "preset-1",
  label: "Primary",
  provider: "openai",
  apiKey: "key",
  baseUrl: "https://example.invalid/v1",
  model: "model-1",
  models: ["model-1"],
  maxTokens: 8192,
  extras: {},
};

function prefs(): PrefsStore {
  const values: Record<string, string> = {
    "extensions.zotero-ai-sidebar.presets": JSON.stringify([preset]),
  };
  return {
    get: (key) => values[key],
    set: () => undefined,
  };
}

beforeEach(() => {
  stream.mockReset();
  stream.mockImplementation(async function* () {
    yield { type: "text_delta", text: "中文译文 ZAILATEXTOKEN0X" };
    yield { type: "usage", input: 120, output: 30, cacheRead: 20 };
  });
});

describe("createFullDocumentTranslator usage", () => {
  it("treats a one-word user message as the complete translation source", async () => {
    stream.mockImplementation(async function* (messages) {
      yield {
        type: "text_delta",
        text:
          messages[0]?.content === "英译中：Introduction"
            ? "引言"
            : "您好！请问您需要翻译什么内容呢？",
      };
    });
    const translator = createFullDocumentTranslator(
      prefs(),
      new AbortController().signal,
    );

    await expect(translator.translate("Introduction")).resolves.toMatchObject({
      text: "引言",
    });
    expect(stream).toHaveBeenCalledOnce();
    expect(stream.mock.calls[0]?.[0]).toEqual([
      { role: "user", content: "英译中：Introduction" },
    ]);
    const staticInstructionLength =
      Array.from(stream.mock.calls[0]?.[0]?.[0]?.content ?? "").length -
      Array.from("Introduction").length +
      Array.from(stream.mock.calls[0]?.[1] ?? "").length;
    expect(staticInstructionLength).toBeLessThanOrEqual(35);
  });

  it("uses a compact prompt and preserves the source after its scope prefix", async () => {
    const translator = createFullDocumentTranslator(
      prefs(),
      new AbortController().signal,
    );
    const source = "Loss ZAILATEXTOKEN0X is minimized.";

    await translator.translate(source);

    const [messages, systemPrompt] = stream.mock.calls[0];
    expect(messages).toEqual([{ role: "user", content: `英译中：${source}` }]);
    expect(messages[0]?.content.slice("英译中：".length)).toBe(source);
    expect(systemPrompt).toBe("仅输出简中译文；ZAILATEXTOKEN0X不变。");
    expect(systemPrompt.length).toBeLessThanOrEqual(40);
  });

  it("returns the API token usage with translated text", async () => {
    const translator = createFullDocumentTranslator(
      prefs(),
      new AbortController().signal,
    );

    await expect(translator.translate("Source text.")).resolves.toEqual({
      text: "中文译文 ZAILATEXTOKEN0X",
      usage: {
        input: 120,
        output: 30,
        cacheRead: 20,
        cacheReadIncludedInInput: true,
      },
    });
  });

  it("retries a request-for-content reply with a stricter compact prompt", async () => {
    stream
      .mockImplementationOnce(async function* () {
        yield {
          type: "text_delta",
          text: "好的，请提供需要翻译的英文内容。",
        };
        yield { type: "usage", input: 20, output: 8, cacheRead: 5 };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text_delta", text: "引言" };
        yield { type: "usage", input: 22, output: 2, cacheRead: 5 };
      });
    const translator = createFullDocumentTranslator(
      prefs(),
      new AbortController().signal,
    );

    await expect(translator.translate("Introduction")).resolves.toMatchObject({
      text: "引言",
      usage: { input: 42, output: 10, cacheRead: 10 },
    });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1]?.[1]).toContain("只译不问");
    expect(stream.mock.calls[1]?.[1].length).toBeLessThanOrEqual(35);
  });
});
