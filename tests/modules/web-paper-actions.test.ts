import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  parseWebOverview,
  parseWebReadingRoute,
  webOverviewPrompt,
  webReadingRoutePrompt,
} from "../../src/modules/web-paper-actions";
import type { OverviewData } from "../../src/context/overview-types";

const outline: OverviewData = {
  title: "Paper",
  source: "pdf",
  coverage: "headings",
  sections: [
    {
      no: "1",
      title: "Introduction",
      level: 1,
      charStart: 10,
      charEnd: 100,
      anchors: ["Fig. 1"],
    },
    { no: "2", title: "Method", level: 1, charStart: 100, charEnd: 250 },
  ],
};
const payload = () => ({
  narrative: "本文提出方法并验证效果。",
  sections: [
    {
      no: "2",
      gist: "提出新方法",
      phase: "method",
      emphasis: "innovation",
      charStart: 999,
    },
    { no: "1", gist: "问题动机", phase: "motivation", emphasis: "background" },
  ],
  flowchart: {
    nodes: [
      { id: "a", label: "问题", type: "root" },
      { id: "b", label: "方法", type: "innovation", sectionNo: "2" },
    ],
    edges: [{ source: "a", target: "b" }],
  },
});
const options = {
  source: { getItem: async () => null, getFullText: async () => "" },
  itemID: 42,
};

describe("WEB paper actions", () => {
  it("retains local section order and navigation coordinates through the existing renderer", async () => {
    const data = await parseWebOverview(
      "```json\n" + JSON.stringify(payload()) + "\n```",
      outline,
      options,
    );
    expect(data.sections.map((s) => s.no)).toEqual(["1", "2"]);
    expect(data.sections[0]).toMatchObject({
      charStart: 10,
      charEnd: 100,
      anchors: ["Fig. 1"],
    });
    expect(data.sections[1]).toMatchObject({
      charStart: 100,
      charEnd: 250,
      emphasis: "innovation",
    });
    expect(data.flowchart?.edges).toEqual([{ source: "a", target: "b" }]);
  });
  it.each(["missing", "duplicate", "unknown", "invalid phase", "no graph"])(
    "rejects %s before saving",
    async (fault) => {
      const value = payload();
      if (fault === "missing") value.sections.pop();
      if (fault === "duplicate") value.sections[1].no = "2";
      if (fault === "unknown") value.sections[1].no = "3";
      if (fault === "invalid phase") value.sections[1].phase = "bad";
      if (fault === "no graph") value.flowchart.nodes = [];
      await expect(
        parseWebOverview(JSON.stringify(value), outline, options),
      ).rejects.toThrow("原有总览未改动");
    },
  );
  it("rejects invalid JSON and incomplete routes", async () => {
    await expect(
      parseWebOverview("不完整 JSON", outline, options),
    ).rejects.toThrow("原有总览未改动");
    expect(() => parseWebReadingRoute("## 第一遍\n未完成")).toThrow("尚未覆盖");
    const route =
      "## 第一遍\n研究脉络\n## 第二遍\n证据\n## 第三遍\n复现\n--- 阅读路线结束 ---";
    expect(parseWebReadingRoute(route)).toBe(route);
    expect(webReadingRoutePrompt("自定义要求")).toContain("自定义要求");
    expect(webOverviewPrompt(outline)).toContain('"charStart":10');
  });
});

// Execute the real button handlers with isolated dependencies; no host/UI launch.
const sidebar = readFileSync("src/modules/sidebar.ts", "utf8");
it.each(["readingRoute", "overview"])(
  "keeps the %s API call and routes only WEB to the website",
  async (action) => {
    const name =
      action === "readingRoute"
        ? "generateReadingRouteFromNoteSwitcher"
        : "generateOverviewIntoPanel";
    const start = sidebar.indexOf(`async function ${name}(`);
    const end = sidebar.indexOf("\nasync function ", start + 1);
    const code = ts.transpileModule(sidebar.slice(start, end), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    for (const mode of ["api", "web"]) {
      const state = {
        localUiSettings: { chatSendMode: mode, webPromptProvider: "deepseek" },
      };
      const api = vi.fn().mockResolvedValue(undefined),
        web = vi.fn().mockResolvedValue(undefined);
      const run = new Function(
        "states",
        "saveVisibleNoteBeforeSwitch",
        "loadQuickPromptSettings",
        "zoteroPrefs",
        "sendMessage",
        "sendWebPromptMessage",
        "OVERVIEW_PROMPT",
        `${code}; return ${name};`,
      )(
        { get: () => state },
        async () => {},
        () => ({ builtIns: { readingRoute: "route prompt" } }),
        () => ({}),
        api,
        web,
        "overview prompt",
      );
      await run(
        { mount: {}, noteMount: { ownerDocument: {} } },
        { textContent: "生成", title: "", disabled: false },
      );
      expect(api).toHaveBeenCalledTimes(mode === "api" ? 1 : 0);
      expect(web).toHaveBeenCalledTimes(mode === "web" ? 1 : 0);
      if (mode === "api")
        expect(api.mock.calls[0][2]).toBe(
          action === "readingRoute" ? "route prompt" : "overview prompt",
        );
      else expect(web.mock.calls[0][4]).toMatchObject({ paperAction: action });
    }
  },
);

// DeepSeek's actual callback puts the language label outside an unlabelled fence.
it("imports DeepSeek overview code cards with a separate json label", async () => {
  const answer = "json\n\n```\n" + JSON.stringify(payload(), null, 2) + "\n```";
  const data = await parseWebOverview(answer, outline, options);
  expect(data.sections).toHaveLength(2);
  expect(data.flowchart?.nodes).toHaveLength(2);
});

it("starts each paper action in a fresh session but keeps ordinary chat sessions", async () => {
  const { webPaperSessionKey } =
    await import("../../src/modules/web-paper-actions");
  expect(webPaperSessionKey("item:1:deepseek", undefined, "t1")).toBe(
    "item:1:deepseek",
  );
  expect(webPaperSessionKey("item:1:deepseek", "overview", "t1")).not.toBe(
    webPaperSessionKey("item:1:deepseek", "overview", "t2"),
  );
});

it.each(["readingRoute", "overview"])(
  "omits chat history and context attachments for %s",
  async (action) => {
    const start = sidebar.indexOf("  const history = options.paperAction");
    const end = sidebar.indexOf("  // A chat citation", start);
    const historyCode = ts.transpileModule(sidebar.slice(start, end), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const complete = vi.fn(),
      select = vi.fn();
    const history = new Function(
      "options",
      "completedWebHistory",
      "selectConversationHistory",
      "state",
      "chatQuote",
      `${historyCode}; return webHistory;`,
    )({ paperAction: action }, complete, select, {}, undefined);
    expect(history).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    const attachStart = sidebar.indexOf("  const contextAttachment =", start);
    const attachEnd = sidebar.indexOf("  const tocAttachment", attachStart);
    const attachCode = ts.transpileModule(
      sidebar.slice(attachStart, attachEnd),
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const create = vi.fn();
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const attachment = await new AsyncFunction(
      "options",
      "provider",
      "account",
      "createWebContextAttachment",
      "webHistory",
      `${attachCode}; return contextAttachment;`,
    )({ paperAction: action }, "deepseek", {}, create, history);
    expect(attachment).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  },
);
