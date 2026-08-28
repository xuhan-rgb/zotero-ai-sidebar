import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  answerNodeRange,
  chatGLMResponseSnapshot,
  inPlaceStillBaseline,
  isRecoverablePageReadError,
  nextAnswerPollDelay,
  nextAnswerWaitState,
  nextPageNoticeWaitState,
  pageShowsChatGLMAnswerPhase,
  pageShowsGenerationProgress,
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
  it("separates ChatGLM thinking from its final answer while generation is active", () => {
    expect(chatGLMResponseSnapshot(["正在分析用户问题"], true)).toEqual({
      answer: "",
      reasoning: "正在分析用户问题",
    });
    expect(
      chatGLMResponseSnapshot(["当前轮首帧思考内容"], false, false),
    ).toEqual({
      answer: "",
      reasoning: "当前轮首帧思考内容",
    });
    expect(
      chatGLMResponseSnapshot(
        ["正在分析用户问题", "你好！我们继续讨论这篇论文。"],
        true,
        true,
      ),
    ).toEqual({
      answer: "你好！我们继续讨论这篇论文。",
      reasoning: "正在分析用户问题",
    });
    expect(chatGLMResponseSnapshot(["直接回答"], false, true)).toEqual({
      answer: "直接回答",
      reasoning: "",
    });
  });

  it("keeps ChatGLM text appended at the thinking-finished transition out of the answer", () => {
    const firstThinking =
      "Actually, given this is just a greeting, a search would be performative.";
    const lateThinking =
      "The user just said hello. I should give a brief, natural, warm greeting.";
    const finalAnswer = "你好！我已经读取了论文材料，可以继续帮你解读。";

    expect(
      chatGLMResponseSnapshot(
        [firstThinking, lateThinking],
        true,
        true,
        2,
      ),
    ).toEqual({
      answer: "",
      reasoning: `${firstThinking}\n\n${lateThinking}`,
    });
    expect(
      chatGLMResponseSnapshot(
        [firstThinking, lateThinking, finalAnswer],
        true,
        true,
        2,
      ),
    ).toEqual({
      answer: finalAnswer,
      reasoning: `${firstThinking}\n\n${lateThinking}`,
    });
  });

  it("removes a final answer duplicated at the end of ChatGLM reasoning", () => {
    const thinking = [
      "The user greets again after discussing Equation 14b.",
      "I should answer briefly and offer to continue.",
    ].join("\n\n");
    const finalAnswer = [
      "你好！我们刚聊完公式（14b）——解模糊后的波向量如何提取方位角。",
      "接下来可以继续承接公式，也可以分析实验结果。",
    ].join("\n\n");

    expect(
      chatGLMResponseSnapshot(
        [`${thinking}\n\n${finalAnswer}`, finalAnswer],
        false,
        true,
        1,
      ),
    ).toEqual({
      answer: finalAnswer,
      reasoning: thinking,
    });
  });

  it("removes a truncated ChatGLM reasoning prefix from the final answer", () => {
    const sharedPrefix = [
      'The user just said “hello” - a simple greeting.',
      "I should respond naturally and offer to help with the paper.",
    ].join("\n\n");
    const thinking = `${sharedPrefix}\n\nI can respond in English and mention that I’ve read\u00a0the\u00a0p`;
    const finalAnswer = [
      "Hello! 👋",
      "I’ve read the paper and I’m ready to answer your questions.",
    ].join("\n\n");
    const combinedNode = [
      sharedPrefix,
      "I can respond in English and mention that I’ve read the paper.",
      finalAnswer,
    ].join("\n\n");

    expect(
      chatGLMResponseSnapshot(
        [thinking, combinedNode],
        false,
        true,
        1,
      ),
    ).toEqual({
      answer: finalAnswer,
      reasoning: thinking,
    });
  });

  it("collapses duplicate ChatGLM thinking snapshots rendered in the same node", () => {
    const earlier = [
      "用户问的是第一章是什么意思，即论文的第一章是什么意思。根据 arXiv 目录，第一章是引言。",
      "让我搜索一下以确认我对论文第一章的理解，然后根据已加载的 LaTeX 源文件给出回答。",
    ].join("\n\n");
    const newer = `${earlier}\n\n让我查看 LaTeX 源文件中的引言部分并梳理关键点。`;

    expect(chatGLMResponseSnapshot([`${newer}\n\n${earlier}`], true)).toEqual({
      answer: "",
      reasoning: newer,
    });
    expect(chatGLMResponseSnapshot([`${earlier}\n\n${newer}`], true)).toEqual({
      answer: "",
      reasoning: newer,
    });
  });

  it("does not paint a growing duplicate ChatGLM thinking node as the answer", () => {
    const duplicatePrefix = [
      "The user just said hello with a bunch of context about a paper. This is a greeting, not an actual question about the paper.",
      "Let me think about what is appropriate here. The user has sent a hello message in the context of a Zotero academic reading task.",
    ].join("\n\n");
    const completeThinking = `${duplicatePrefix}\n\nLet me do a quick search to confirm the paper details so my greeting is grounded.`;

    expect(
      chatGLMResponseSnapshot(
        [completeThinking, duplicatePrefix],
        true,
      ),
    ).toEqual({
      answer: "",
      reasoning: completeThinking,
    });

    const rewrittenThinking =
      'The user just said "hello" - a casual greeting. I have confirmed the paper is current, but I should still answer briefly and naturally.';
    expect(
      chatGLMResponseSnapshot(
        [completeThinking, rewrittenThinking],
        true,
        false,
      ),
    ).toEqual({
      answer: "",
      reasoning: completeThinking,
    });
  });

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

  it("never completes page-content fallback while the provider is generating", () => {
    const content = "附件列表已经显示";
    const waiting = nextPageNoticeWaitState({
      content,
      previousSignature: content,
      stablePolls: 20,
      pageReady: true,
      pageGenerating: true,
      normalAnswerObserved: false,
    });
    expect(waiting.shouldComplete).toBe(false);
    expect(waiting.nextStable).toBe(0);
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

  it("does not treat ChatGLM attachment cards and its stop control as a page notice", () => {
    const content = [
      "许瀚",
      "展开",
      "main111 TEX 76.23KB",
      "zai-web-context-1787661964845-N03GSpm4X7111 308B",
      "zai-arxiv-toc-1787661964855-MjyB8yBPNQ111 931B",
      "停止对话",
    ].join("\n");
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

  it("keeps ChatGLM search progress out of page-content fallback", () => {
    const content = [
      "搜索中...",
      "正在查询 π0.5 Vision-Language-Action Model arxiv",
    ].join("\n");
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

  it("uses ChatGLM page progress as a fallback generation signal without changing DeepSeek", () => {
    const content = "搜索中...\n正在查询 π0.5\n停止对话";
    expect(pageShowsGenerationProgress("chatglm.cn", content)).toBe(true);
    expect(pageShowsGenerationProgress("chatglm.cn", "回答完成")).toBe(false);
    expect(
      pageShowsGenerationProgress(
        "chatglm.cn",
        "I was thinking about the paper and searching for a concise answer.",
      ),
    ).toBe(false);
    expect(pageShowsGenerationProgress("chat.deepseek.com", content)).toBe(
      false,
    );
    expect(pageShowsChatGLMAnswerPhase("chatglm.cn", "思考结束\n回答正文")).toBe(
      true,
    );
    expect(pageShowsChatGLMAnswerPhase("chatglm.cn", content)).toBe(false);
    expect(
      pageShowsChatGLMAnswerPhase("chat.deepseek.com", "思考结束"),
    ).toBe(false);
    const previousTurn = [
      "上一轮",
      "思考结束",
      "上一轮回答",
    ].join("\n");
    const currentTurnFirstFrame = [
      previousTurn,
      "当前轮第一段思考内容已经出现，但状态标题尚未挂载",
    ].join("\n");
    expect(
      pageShowsChatGLMAnswerPhase(
        "chatglm.cn",
        currentTurnFirstFrame,
        previousTurn,
      ),
    ).toBe(false);
    const currentTurnThinking = [
      previousTurn,
      "当前轮",
      "思考中...",
      "正在分析当前问题",
    ].join("\n");
    expect(
      pageShowsChatGLMAnswerPhase(
        "chatglm.cn",
        currentTurnThinking,
        previousTurn,
      ),
    ).toBe(false);
    expect(
      pageShowsChatGLMAnswerPhase(
        "chatglm.cn",
        `${currentTurnThinking}\n思考结束\n当前轮回答`,
        previousTurn,
      ),
    ).toBe(true);
    expect(agent).toContain("pageShowsGenerationProgress(");
    expect(agent).toContain("let chatGLMReasoningNodeEnd;");
    expect(agent).toContain(
      "pageState.chatGLMReasoningNodeEnd = chatGLMReasoningNodeEnd",
    );
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

  it("keeps ChatGLM active until its answer stays stable after early finished actions", () => {
    const stillGenerating = nextAnswerWaitState({
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
    expect(stillGenerating.nextStable).toBe(5);
    expect(stillGenerating.shouldComplete).toBe(false);

    const earlyFinishedActions = nextAnswerWaitState({
      result: { answer: "完整回答", reasoning: "" },
      previousSignature: JSON.stringify({
        answer: "完整回答",
        reasoning: "",
      }),
      generating: false,
      completionReady: true,
      host: "chatglm.cn",
      stablePolls: 4,
      inPlace: false,
    });
    expect(earlyFinishedActions.nextStable).toBe(5);
    expect(earlyFinishedActions.shouldComplete).toBe(false);

    const stableAfterFinishedActions = nextAnswerWaitState({
      result: { answer: "完整回答", reasoning: "" },
      previousSignature: JSON.stringify({
        answer: "完整回答",
        reasoning: "",
      }),
      generating: false,
      completionReady: true,
      host: "chatglm.cn",
      stablePolls: 24,
      inPlace: false,
    });
    expect(stableAfterFinishedActions.nextStable).toBe(25);
    expect(stableAfterFinishedActions.shouldComplete).toBe(true);

    const stableWithoutFinishedActions = nextAnswerWaitState({
      result: { answer: "完整回答", reasoning: "" },
      previousSignature: JSON.stringify({
        answer: "完整回答",
        reasoning: "",
      }),
      generating: false,
      completionReady: false,
      host: "chatglm.cn",
      stablePolls: 7,
      inPlace: false,
    });
    expect(stableWithoutFinishedActions.nextStable).toBe(8);
    expect(stableWithoutFinishedActions.shouldComplete).toBe(true);
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
