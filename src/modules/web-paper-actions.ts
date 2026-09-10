import { webPdfOutline } from "./web-pdf-outline";
import {
  createZoteroAgentToolSession,
  type ToolFactoryOptions,
} from "../context/agent-tools";
import type { OverviewData } from "../context/overview-types";

export type WebPaperAction = "readingRoute" | "overview";

export function webReadingRoutePrompt(prompt: string): string {
  return [
    prompt,
    "WEB 执行说明：直接阅读本次附带的论文全文和目录，不调用 Zotero 工具。上面的工具读取步骤改为阅读附件；只返回完整阅读路线 Markdown，不模拟工具调用。保留章节号、图表号和逐字原文引用，不能读取附件时明确说明，不能编造。最后一行必须为 --- 阅读路线结束 ---。",
  ].join("\n\n");
}

export function parseWebReadingRoute(answer: string): string {
  const text = answer
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n/i, "")
    .replace(/\n```$/, "")
    .trim();
  if (
    !text.endsWith("--- 阅读路线结束 ---") ||
    !/第一遍/.test(text) ||
    !/第二遍/.test(text) ||
    !/第三遍/.test(text)
  ) {
    throw new Error(
      "WEB 阅读路线不完整，尚未覆盖原有笔记；请重试。网页原始回答已保留。",
    );
  }
  return text;
}

export async function prepareWebOverview(
  options: ToolFactoryOptions,
): Promise<OverviewData> {
  const session = createZoteroAgentToolSession(options);
  try {
    const result = await session.tools
      .find((tool) => tool.name === "zotero_outline_pdf")!
      .execute({});
    const prefix = "[Paper outline]\n";
    if (!result.output.startsWith(prefix)) throw new Error(result.output);
    const outline = JSON.parse(
      result.output.slice(prefix.length),
    ) as OverviewData;
    if (!outline.sections?.length)
      throw new Error("没有可用的论文章节，无法生成 WEB 总览。");
    if (
      outline.source === "pdf" &&
      outline.coverage === "uniform-fallback" &&
      options.itemID != null
    ) {
      const headings = webPdfOutline(
        await options.source.getFullText(options.itemID),
      );
      if (headings)
        return { ...outline, coverage: "headings", sections: headings };
    }
    return outline;
  } finally {
    session.dispose();
  }
}

export function webOverviewPrompt(outline: OverviewData): string {
  return [
    "阅读附带的论文全文，并基于下面插件提供的章节骨架生成中文全文总览。不要调用任何 Zotero 工具。",
    "仅在一个 json 代码块中返回对象：narrative 为 2–4 句核心讲述，结尾指出本文贡献；sections 按骨架顺序，每节包含原样的 no、一句话中文 gist、phase（motivation|method|validation）、emphasis（innovation|result|normal|background）。每个章节必须恰好返回一次；创新章节说明新在哪。",
    'flowchart 为 {"nodes":[{"id":"n1","label":"问题","type":"root","sectionNo":"1"}],"edges":[{"source":"n1","target":"n2"}]}，使用问题→方法→结果的逻辑关系；节点 type 可为 root/section/point/result/innovation。不要生成代码网络图。',
    "返回标准 JSON；使用普通中文和 Unicode 数学符号，避免 LaTeX 反斜杠转义。不要编造章节编号、字符位置或图表锚点，这些由插件保留。",
    JSON.stringify(outline),
  ].join("\n\n");
}

export async function parseWebOverview(
  answer: string,
  outline: OverviewData,
  options: ToolFactoryOptions,
): Promise<OverviewData> {
  const fenced = answer.match(/```(?:json)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/i);
  type SectionReply = {
    no: string;
    gist: string;
    phase: string;
    emphasis: string;
  };
  let parsed: {
    narrative?: string;
    sections?: SectionReply[];
    flowchart?: unknown;
  } | null;
  try {
    parsed = JSON.parse(fenced ? fenced[1] : answer.trim());
  } catch {
    throw new Error(
      "WEB 总览不是完整 JSON，原有总览未改动；网页原始回答已保留，请重试。",
    );
  }
  if (
    !parsed ||
    typeof parsed.narrative !== "string" ||
    !parsed.narrative.trim() ||
    !Array.isArray(parsed.sections)
  ) {
    throw new Error("WEB 总览缺少核心讲述或章节，原有总览未改动。");
  }
  const entries = new Map<string, SectionReply>();
  for (const section of parsed.sections) {
    if (
      !section ||
      typeof section.no !== "string" ||
      entries.has(section.no) ||
      typeof section.gist !== "string" ||
      !section.gist.trim() ||
      !["motivation", "method", "validation"].includes(section.phase) ||
      !["innovation", "result", "normal", "background"].includes(
        section.emphasis,
      )
    ) {
      throw new Error("WEB 总览章节重复或字段不完整，原有总览未改动。");
    }
    entries.set(section.no, section);
  }
  if (
    entries.size !== outline.sections.length ||
    outline.sections.some((s) => !entries.has(s.no))
  ) {
    throw new Error("WEB 总览章节与论文不匹配，原有总览未改动。");
  }
  let data: OverviewData | undefined;
  const session = createZoteroAgentToolSession({
    ...options,
    onOverviewReady: (value) => {
      data = value;
    },
  });
  try {
    await session.tools
      .find((tool) => tool.name === "render_paper_overview")!
      .execute({
        ...outline,
        narrative: parsed.narrative,
        sections: outline.sections.map((s) => ({
          ...s,
          gist: entries.get(s.no)!.gist,
          phase: entries.get(s.no)!.phase,
          emphasis: entries.get(s.no)!.emphasis,
        })),
        flowchart: parsed.flowchart,
      });
    if (!data?.flowchart?.nodes.length)
      throw new Error("WEB 总览缺少有效逻辑图，原有总览未改动。");
    data.sections = data.sections.map((section, index) => ({
      ...section,
      ...(outline.sections[index].headingText
        ? { headingText: outline.sections[index].headingText }
        : {}),
    }));
    return data;
  } finally {
    session.dispose();
  }
}

export function webPaperSessionKey(
  base: string,
  action: WebPaperAction | undefined,
  taskID: string,
): string {
  return action ? `${base}:${action}:${taskID}` : base;
}
