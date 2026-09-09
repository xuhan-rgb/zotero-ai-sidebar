import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createFullDocumentWebTranslator } from "../../src/translate/full-document-web";
import { DEFAULT_LOCAL_UI_SETTINGS } from "../../src/settings/local-ui-settings";
import {
  translateProtectedBlock,
  runFullDocumentTranslation,
} from "../../src/translate/full-document-runner";
import { createFullTranslationState } from "../../src/settings/full-translation-store";
import type { WebPromptTaskInput } from "../../src/modules/web-prompt-hub";
const mocks = vi.hoisted(() => ({
  tasks: [] as WebPromptTaskInput[],
  dispatch: vi.fn(),
  cancel: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("../../src/modules/web-prompt-hub", () => ({
  createWebPromptTask: (input: WebPromptTaskInput) => {
    mocks.tasks.push(input);
    return { id: `task-${mocks.tasks.length}`, url: "local" };
  },
  discardWebPromptTask: mocks.discard,
}));
vi.mock("../../src/modules/web-agent-client", () => ({
  dispatchWebAgentTask: mocks.dispatch,
  cancelWebAgentTask: mocks.cancel,
}));
beforeEach(() => {
  mocks.tasks.length = 0;
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
function translator(signal = new AbortController().signal) {
  return createFullDocumentWebTranslator({
    settings: {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatSendMode: "web",
      webPromptProvider: "deepseek",
    },
    arxivId: "2110.06864",
    signal,
  });
}
describe("WEB full-document translation", () => {
  it("uses the website task and restores protected math without API usage", async () => {
    const t = translator();
    const pending = translateProtectedBlock(
      "Associate $\\mathcal T$ using [6].",
      async (source) => (await t.translate(source)).text,
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "deepseek",
        paperUrl: "https://arxiv.org/abs/2110.06864",
        prompt: expect.stringContaining("ZAILATEXTOKEN0X"),
      }),
    );
    await mocks.tasks[0].onImport({
      answer: "关联 ZAILATEXTOKEN0X，参见 [6]。",
    });
    expect(await pending).toBe("关联 $\\mathcal T$，参见 [6]。");
    expect(mocks.discard).toHaveBeenCalledWith("task-1");
  });
  it("rejects verification notices instead of saving them as translations", async () => {
    const pending = translator().translate("Some source sentence.");
    const check = expect(pending).rejects.toThrow("登录或验证");
    await mocks.tasks[0].onImport({
      answer: "Please sign in",
      pageNotice: true,
    });
    await check;
  });
  it("cancels immediately and cancels again if dispatch completes after abort", async () => {
    let done!: () => void;
    mocks.dispatch.mockImplementation(
      () =>
        new Promise<void>((r) => {
          done = r;
        }),
    );
    const controller = new AbortController();
    const pending = translator(controller.signal).translate("Source");
    const check = expect(pending).rejects.toThrow("取消");
    controller.abort();
    await check;
    done();
    await Promise.resolve();
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    await mocks.tasks[0].onImport({ answer: "迟到的回答" });
    expect(mocks.discard).toHaveBeenCalledTimes(1);
  });
  it("times out and releases the registered task", async () => {
    vi.useFakeTimers();
    const pending = translator().translate("Source");
    const check = expect(pending).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(600000);
    await check;
    expect(mocks.cancel).toHaveBeenCalled();
  });
  it("does not submit an already-cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      translator(controller.signal).translate("Source"),
    ).rejects.toThrow("取消");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("stops at failure and leaves following blocks pending for resume", async () => {
    const paper = {
      schemaVersion: 1 as const,
      arxivId: "2110.06864",
      sourceHash: "x",
      blocks: [
        {
          id: "a",
          kind: "paragraph" as const,
          source: "One",
          translatable: true,
        },
        {
          id: "b",
          kind: "paragraph" as const,
          source: "Two",
          translatable: true,
        },
      ],
    };
    let saved = createFullTranslationState(paper, "web:deepseek", "deepseek");
    const translate = vi.fn().mockRejectedValue(new Error("网页失败"));
    await expect(
      runFullDocumentTranslation({
        document: paper,
        state: saved,
        signal: new AbortController().signal,
        translate,
        stopOnError: true,
        onState: (s) => {
          saved = s;
        },
      }),
    ).rejects.toThrow("网页失败");
    expect(translate).toHaveBeenCalledTimes(1);
    expect(saved.blocks.a.status).toBe("error");
    expect(saved.blocks.b.status).toBe("pending");
  });
});

it("sends structured batches and waits before another website message", async () => {
  vi.useFakeTimers();
  const t = translator();
  const first = t.translateBatch([
    { id: "a", text: "A title" },
    { id: "b", text: "A paragraph" },
  ]);
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  expect(mocks.dispatch.mock.calls[0][0].prompt).toContain(
    "<<<ZAI_TRANSLATION:a>>>",
  );
  await mocks.tasks[0].onImport({
    answer: block("a", "标题") + "\n" + block("b", "段落"),
  });
  expect(await first).toHaveLength(2);
  const second = t.translateBatch([{ id: "c", text: "Another paragraph" }]);
  await vi.advanceTimersByTimeAsync(14999);
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  await mocks.tasks[1].onImport({
    answer: block("c", "另一段"),
  });
  await second;
});

function block(id: string, text: string) {
  return `<<<ZAI_TRANSLATION:${id}>>>\n${text}\n<<<END_ZAI_TRANSLATION:${id}>>>`;
}

it("preserves raw LaTeX commands, quotes and newlines in fenced batch replies", async () => {
  const text = String.raw`\BlankLine
\tcc{初始化新轨迹 "目标"}
\For{ZAILATEXTOKEN0X}{\textbf{返回} ZAILATEXTOKEN1X\;}
\caption{BYTE的伪代码。}`;
  // The screenshot's literal LaTeX cannot be embedded directly in JSON strings.
  expect(() =>
    JSON.parse(`{"translations":[{"id":"algorithm","text":"${text}"}]}`),
  ).toThrow();
  const pending = translator().translateBatch([
    { id: "algorithm", text: "Initialize tracks" },
  ]);
  await mocks.tasks[0].onImport({
    answer: "```text\n" + block("algorithm", text) + "\n```",
  });
  expect(await pending).toEqual([{ id: "algorithm", text }]);
});

it.each([
  ["missing end", "<<<ZAI_TRANSLATION:a>>>\n译文"],
  [
    "mismatched end",
    "<<<ZAI_TRANSLATION:a>>>\n译文\n<<<END_ZAI_TRANSLATION:b>>>",
  ],
  ["duplicate", block("a", "译文") + "\n" + block("a", "译文")],
  ["unknown id", block("other", "译文")],
  ["missing paragraph", ""],
])("rejects %s without misdiagnosing a rate limit", async (_name, answer) => {
  const pending = translator().translateBatch([{ id: "a", text: "Source" }]);
  const check = expect(pending).rejects.toThrow(/段落|标记/);
  await mocks.tasks[0].onImport({ answer });
  await check;
});

it.each([
  (body: string) => `text\n\n\`\`\`text\n${body}\n\`\`\``,
  (body: string) => `以下是翻译结果：\n\n\`\`\`text\n${body}\n\`\`\`\n复制代码`,
])(
  "accepts complete translation blocks with surrounding website/code-card text",
  async (wrap) => {
    const text = String.raw`\myparagraph{通过跟踪进行检测。}
一些方法 [53, 91, 14, 13, 15, 12] 利用单目标跟踪。`;
    const pending = translator().translateBatch([
      { id: "section-2-1-p4", text: "Detection by tracking." },
    ]);
    await mocks.tasks[0].onImport({
      answer: wrap(block("section-2-1-p4", text)),
    });
    expect(await pending).toEqual([{ id: "section-2-1-p4", text }]);
  },
);

it("rejects a truncated extra block even when the requested block is complete", async () => {
  const pending = translator().translateBatch([{ id: "a", text: "Source" }]);
  const check = expect(pending).rejects.toThrow(/标记/);
  await mocks.tasks[0].onImport({
    answer: block("a", "译文") + "\n<<<ZAI_TRANSLATION:b>>>\n未完成",
  });
  await check;
});
