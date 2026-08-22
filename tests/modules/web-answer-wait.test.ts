import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  answerNodeRange,
  inPlaceStillBaseline,
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
    const events = collectWaitEvents({ answer: "上一轮总结", reasoning: "" }, 1, [
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
    ]);

    expect(events.some((event) => event.type === "generating" && event.answer)).toBe(
      true,
    );
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      answer: "flowchart TD\nA-->B",
    });
  });

  it("does not complete a DeepSeek in-place poll that is still the previous turn", () => {
    const events = collectWaitEvents({ answer: "上一轮总结", reasoning: "" }, 1, [
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
    ]);
    expect(events).toEqual([]);
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

  it("wires the shipped agent to the in-place wait helpers", () => {
    expect(agent).toContain('from "./answer-wait.mjs"');
    expect(agent).toContain("answerNodeRange(");
    expect(agent).toContain("inPlaceStillBaseline(");
    expect(agent).toContain("nextAnswerWaitState(");
    expect(agent).toContain("range.inPlace");
    expect(adapters).toContain(
      ".ds-message .ds-assistant-message-main-content",
    );
    expect(adapters).toContain("[class*='ds-assistant-message'] .ds-markdown");
  });
});
