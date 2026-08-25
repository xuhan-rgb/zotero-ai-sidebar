import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  answerNodeRange,
  inPlaceStillBaseline,
  isRecoverablePageReadError,
  nextAnswerPollDelay,
  nextAnswerWaitState,
  nextPageNoticeWaitState,
  visiblePageTextDelta,
} from "../../web-agent/answer-wait.mjs";

const agent = readFileSync(
  resolve(process.cwd(), "web-agent/agent.mjs"),
  "utf8",
);
const adapters = readFileSync(
  resolve(process.cwd(), "web-agent/adapters.mjs"),
  "utf8",
);

function collectWaitEvents(
  baseline: { answer: string; reasoning?: string },
  previousCount: number,
  polls: Array<{
    currentCount: number;
    answer: string;
    reasoning?: string;
    generating: boolean;
    completionReady?: boolean;
  }>,
) {
  let previousSignature = "";
  let stablePolls = 0;
  const events: Array<{ type: string; answer: string; reasoning: string }> = [];
  for (const poll of polls) {
    const range = answerNodeRange(previousCount, poll.currentCount);
    const result = {
      answer: poll.answer,
      reasoning: poll.reasoning || "",
    };
    if (inPlaceStillBaseline(range.inPlace, result, baseline)) continue;
    const step = nextAnswerWaitState({
      result,
      previousSignature,
      generating: poll.generating,
      completionReady: poll.completionReady,
      host: "chat.deepseek.com",
      stablePolls,
      inPlace: range.inPlace,
    });
    if (step.emitProgress) {
      events.push({
        type: "generating",
        answer: result.answer,
        reasoning: result.reasoning,
      });
    }
    previousSignature = step.signature;
    stablePolls = step.nextStable;
    if (step.shouldComplete) {
      events.push({
        type: "completed",
        answer: result.answer,
        reasoning: result.reasoning,
      });
      break;
    }
  }
  return events;
}

describe("web answer wait (in-place DeepSeek)", () => {
  it("only retries errors caused by an in-flight page refresh", () => {
    expect(
      isRecoverablePageReadError(
        new Error(
          "Execution context was destroyed, most likely because of a navigation",
        ),
      ),
    ).toBe(true);
    expect(
      isRecoverablePageReadError(new Error("Target page has been closed")),
    ).toBe(false);
    expect(isRecoverablePageReadError(new Error("answer timed out"))).toBe(
      false,
    );
  });

  it("keeps a fresh snapshot flowing after a page navigation", () => {
    expect(agent).toContain('page.on("framenavigated", onFrameNavigated)');
    expect(agent).toContain("let pageRefreshPending = false;");
    expect(agent).toContain(
      "const refreshedSinceLastSnapshot = pageRefreshPending;",
    );
    expect(agent).toContain("refreshedSinceLastSnapshot ||");
    expect(agent).toContain('previousSignature = "";');
    expect(agent).toContain('page.off("framenavigated", onFrameNavigated)');
  });

  it("captures DeepSeek search and browse cards with the thinking transcript", () => {
    expect(agent).toContain('if (adapter.name !== "DeepSeek")');
    expect(agent).toContain('message.locator(":scope > div > div")');
    expect(agent).toContain("搜索到|搜索结果|浏览\\s+\\d+");
    expect(agent).toContain("processSignal");
  });

  it("returns newly visible page content without interpreting its language", () => {
    const baseline = "ChatGLM\n用户问题\nhello";
    const current =
      "ChatGLM\n用户问题\nhello\n高峰期排队中\n本次回答已被终止\n重新回答";
    expect(visiblePageTextDelta(baseline, current, ["hello"])).toBe(
      "高峰期排队中\n本次回答已被终止\n重新回答",
    );
    expect(visiblePageTextDelta("Home", "Home\nSomething went wrong", [])).toBe(
      "Something went wrong",
    );
  });

  it("never completes from page content after a normal answer appears", () => {
    expect(
      nextPageNoticeWaitState({
        content: "本次回答已被终止",
        previousSignature: "本次回答已被终止",
        stablePolls: 20,
        pageReady: true,
        normalAnswerObserved: true,
      }).shouldComplete,
    ).toBe(false);
  });

  it("completes stable page content only when the page is ready again", () => {
    const waiting = nextPageNoticeWaitState({
      content: "Something went wrong",
      previousSignature: "Something went wrong",
      stablePolls: 8,
      pageReady: false,
      normalAnswerObserved: false,
    });
    expect(waiting.shouldComplete).toBe(false);
    const ready = nextPageNoticeWaitState({
      content: "Something went wrong",
      previousSignature: "Something went wrong",
      stablePolls: 8,
      pageReady: true,
      normalAnswerObserved: false,
    });
    expect(ready.shouldComplete).toBe(true);
  });

  it("does not complete while DeepSeek is still reading an attachment", () => {
    const content = "新对话\nPDF 3.77MB\n正在阅读\n内容由 AI 生成，请仔细甄别";
    const waiting = nextPageNoticeWaitState({
      content,
      previousSignature: content,
      stablePolls: 20,
      pageReady: true,
      normalAnswerObserved: false,
    });
    expect(waiting.shouldComplete).toBe(false);
    expect(waiting.nextStable).toBe(0);
  });

  it("marks page-content fallback separately from a normal answer", () => {
    expect(agent).toContain(
      'return { answer: content, reasoning: "", pageNotice: true };',
    );
  });

  it("selects the last node when the assistant count does not grow", () => {
    expect(answerNodeRange(1, 1)).toEqual({
      start: 0,
      end: 1,
      inPlace: true,
    });
    expect(answerNodeRange(2, 2)).toEqual({
      start: 1,
      end: 2,
      inPlace: true,
    });
    expect(answerNodeRange(2, 3)).toEqual({
      start: 2,
      end: 3,
      inPlace: false,
    });
    expect(answerNodeRange(0, 0)).toEqual({
      start: 0,
      end: 0,
      inPlace: false,
    });
  });

  it("ignores an unchanged last node from the previous turn", () => {
    expect(
      inPlaceStillBaseline(
        true,
        { answer: "旧回答", reasoning: "" },
        { answer: "旧回答", reasoning: "" },
      ),
    ).toBe(true);
    expect(
      inPlaceStillBaseline(
        true,
        { answer: "横向时间顺序流程图", reasoning: "已思考" },
        { answer: "旧回答", reasoning: "" },
      ),
    ).toBe(false);
    expect(
      inPlaceStillBaseline(
        false,
        { answer: "旧回答", reasoning: "" },
        { answer: "旧回答", reasoning: "" },
      ),
    ).toBe(false);
  });

  it("emits generating snapshots and completes when DeepSeek streams in place", () => {
    const events = collectWaitEvents(
      { answer: "上一轮总结", reasoning: "" },
      1,
      [
      {
        currentCount: 1,
        answer: "上一轮总结",
        generating: false,
      },
      {
        currentCount: 1,
        answer: "",
        reasoning: "已思考",
        generating: true,
      },
      {
        currentCount: 1,
        answer: "flowchart TD",
        reasoning: "已思考",
        generating: true,
      },
      {
        currentCount: 1,
        answer: "flowchart TD\nA-->B",
        reasoning: "已思考",
        generating: true,
      },
      {
        currentCount: 1,
        answer: "flowchart TD\nA-->B",
        reasoning: "已思考",
        generating: false,
        completionReady: false,
      },
      {
        currentCount: 1,
        answer: "flowchart TD\nA-->B",
        reasoning: "已思考",
        generating: false,
        completionReady: false,
      },
      {
        currentCount: 1,
        answer: "flowchart TD\nA-->B",
        reasoning: "已思考",
        generating: false,
        completionReady: false,
      },
      {
        currentCount: 1,
        answer: "flowchart TD\nA-->B",
        reasoning: "已思考",
        generating: false,
        completionReady: false,
      },
      {
        currentCount: 1,
        answer: "flowchart TD\nA-->B",
        reasoning: "已思考",
        generating: false,
        completionReady: false,
      },
      ],
    );

    expect(
      events.some((event) => event.type === "generating" && event.answer),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      answer: "flowchart TD\nA-->B",
    });
  });

  it("does not complete a DeepSeek in-place poll that is still the previous turn", () => {
    const events = collectWaitEvents(
      { answer: "上一轮总结", reasoning: "" },
      1,
      [
      {
        currentCount: 1,
        answer: "上一轮总结",
        generating: false,
        completionReady: true,
      },
      {
        currentCount: 1,
        answer: "上一轮总结",
        generating: false,
        completionReady: true,
      },
      {
        currentCount: 1,
        answer: "上一轮总结",
        generating: false,
        completionReady: true,
      },
      ],
    );
    expect(events).toEqual([]);
  });

  it("never completes from a reasoning-only snapshot", () => {
    const step = nextAnswerWaitState({
      result: { answer: "", reasoning: "思考内容已经稳定" },
      previousSignature: JSON.stringify({
        answer: "",
        reasoning: "思考内容已经稳定",
      }),
      generating: false,
      completionReady: true,
      host: "chat.deepseek.com",
      stablePolls: 99,
      inPlace: true,
    });

    expect(step.shouldComplete).toBe(false);
    expect(step.nextStable).toBe(0);
  });

  it("completes a stable answer when its finished-action control is visible", () => {
    const step = nextAnswerWaitState({
      result: { answer: "完整回答", reasoning: "" },
      previousSignature: JSON.stringify({
        answer: "完整回答",
        reasoning: "",
      }),
      generating: true,
      completionReady: true,
      host: "chatglm.cn",
      stablePolls: 4,
      inPlace: false,
    });
    expect(step.nextStable).toBe(5);
    expect(step.shouldComplete).toBe(true);
  });

  it("does not wait five polls after a finished-action control is visible", () => {
    const step = nextAnswerWaitState({
      result: { answer: "完整回答", reasoning: "" },
      previousSignature: JSON.stringify({ answer: "完整回答", reasoning: "" }),
      generating: true,
      completionReady: true,
      host: "chat.deepseek.com",
      stablePolls: 2,
      inPlace: false,
    });
    expect(step.shouldComplete).toBe(true);
  });

  it("finishes one poll sooner only when generation has also stopped", () => {
    const stopped = nextAnswerWaitState({
      result: { answer: "完整回答", reasoning: "" },
      previousSignature: JSON.stringify({ answer: "完整回答", reasoning: "" }),
      generating: false,
      completionReady: true,
      host: "chat.deepseek.com",
      stablePolls: 1,
      inPlace: false,
    });
    expect(stopped.shouldComplete).toBe(true);

    const stillGenerating = nextAnswerWaitState({
      result: { answer: "完整回答", reasoning: "" },
      previousSignature: JSON.stringify({ answer: "完整回答", reasoning: "" }),
      generating: true,
      completionReady: true,
      host: "chat.deepseek.com",
      stablePolls: 1,
      inPlace: false,
    });
    expect(stillGenerating.shouldComplete).toBe(false);
  });

  it("samples faster after a live answer change but keeps the idle interval", () => {
    expect(
      nextAnswerPollDelay({ generating: true, completionReady: false }),
    ).toBe(150);
    expect(
      nextAnswerPollDelay({ generating: true, completionReady: true }),
    ).toBe(100);
    expect(
      nextAnswerPollDelay({ generating: false, completionReady: true }),
    ).toBe(100);
    expect(
      nextAnswerPollDelay({ generating: false, completionReady: false }),
    ).toBe(350);
  });

  it("wires the shipped agent to the in-place wait helpers", () => {
    expect(agent).toContain('from "./answer-wait.mjs"');
    expect(agent).toContain("firstResponseLocator(page, adapter)");
    expect(agent).toContain("snapshotResponseSlice(");
    expect(agent).toContain("answerNodeRange(");
    expect(agent).toContain("inPlaceStillBaseline(");
    expect(agent).toContain("nextAnswerWaitState(");
    expect(agent).toContain("range.inPlace");
    expect(adapters).toContain(
      ".ds-message .ds-assistant-message-main-content",
    );
    expect(adapters).toContain("[role='button'].ds-button--iconLabelTertiary");
    expect(agent).toContain("responseNodes[range.end - 1]");
    expect(agent).toContain("previousCompletionCount");
    expect(adapters).toContain("[class*='ds-assistant-message'] .ds-markdown");
  });
});
