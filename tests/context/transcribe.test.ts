import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseTranscriptionResponse,
  transcribeFigures,
} from "../../src/context/transcribe";
import { UI_LANGUAGE_PREF } from "../../src/utils/ui-locale";

const streamChunks = vi.fn();
const streamArgs = vi.fn();

vi.mock("../../src/providers/factory", () => ({
  getProvider: () => ({
    // eslint-disable-next-line require-yield
    async *stream(...args: unknown[]) {
      streamArgs(...args);
      for (const chunk of streamChunks()) {
        yield chunk;
      }
    },
  }),
}));

function useLocale(locale: "zh-CN" | "en-US") {
  vi.stubGlobal("Zotero", {
    Prefs: { get: (key: string) => key === UI_LANGUAGE_PREF ? locale : undefined },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  streamArgs.mockReset();
});

describe("parseTranscriptionResponse", () => {
  it("parses a fenced JSON id→latex map", () => {
    const text = '```json\n{"eq-p6-1": "\\\\alpha + \\\\beta", "eq-p6-2": "x^2"}\n```';
    const map = parseTranscriptionResponse(text);
    expect(map.get("eq-p6-1")).toBe("\\alpha + \\beta");
    expect(map.get("eq-p6-2")).toBe("x^2");
  });

  it("parses bare JSON with surrounding prose", () => {
    const map = parseTranscriptionResponse('Here:\n{"a": "y=1"}\nDone.');
    expect(map.get("a")).toBe("y=1");
  });

  it("returns an empty map on unparseable output", () => {
    expect(parseTranscriptionResponse("sorry, no").size).toBe(0);
  });
});

describe("transcribeFigures", () => {
  it("resolves to an id→transcription map from the streamed model output", async () => {
    useLocale("en-US");
    streamChunks.mockReturnValue([
      { type: "text_delta", text: '{"eq-p6-1":"x^2"}' },
    ]);
    const map = await transcribeFigures(
      [{ id: "eq-p6-1", pngDataUrl: "data:image/png;base64,AAA" }],
      {} as any,
      new AbortController().signal,
    );
    expect(map.get("eq-p6-1")).toBe("x^2");
    const [messages, systemPrompt] = streamArgs.mock.calls[0];
    expect(systemPrompt).toContain("Output ONLY a JSON object");
    expect(systemPrompt).toContain("Preserve the source language and wording");
    expect(messages[0].content).toBe("Transcribe each tagged image. ids: eq-p6-1");
  });

  it("localizes the transcription instructions to Chinese", async () => {
    useLocale("zh-CN");
    streamChunks.mockReturnValue([{ type: "text_delta", text: '{"eq-p6-1":"x^2"}' }]);
    await transcribeFigures(
      [{ id: "eq-p6-1", pngDataUrl: "data:image/png;base64,AAA" }],
      {} as any,
      new AbortController().signal,
    );
    const [messages, systemPrompt] = streamArgs.mock.calls[0];
    expect(systemPrompt).toContain("只输出一个 JSON 对象");
    expect(systemPrompt).toContain("保留图像中的原语言和原有措辞");
    expect(messages[0].content).toBe("转录每张带标签的图像。ids：eq-p6-1");
  });

  it("resolves to an empty map when the stream yields an error chunk", async () => {
    useLocale("en-US");
    streamChunks.mockReturnValue([{ type: "error", message: "boom" }]);
    const map = await transcribeFigures(
      [{ id: "eq-p6-1", pngDataUrl: "data:image/png;base64,AAA" }],
      {} as any,
      new AbortController().signal,
    );
    expect(map.size).toBe(0);
  });
});
