const START_MARKER = "---ZOTERO_ANNOTATIONS_V1---";
const END_MARKER = "---END_ZOTERO_ANNOTATIONS---";
const COMPATIBLE_END_MARKERS = [
  END_MARKER,
  "---END_ZOTERO_ANNOTATIONS_V1---",
];
const MAX_ANNOTATIONS = 24;
const MAX_QUOTE_CHARS = 2400;
const MAX_COMMENT_CHARS = 500;
const SECTION_SCOPE_RULE =
  "如果用户指定章节、小节、页码或其他范围，所有 quote 必须严格来自该范围。对于 LaTeX 章节，从该标题开始，到下一个同级或更高级标题之前结束；Abstract 不属于 Introduction。范围内不足指定数量时返回实际数量，不得从摘要或其他章节补足数量。";

export function hasWebAnnotationProtocol(content: string): boolean {
  return (
    (content.includes(START_MARKER) &&
      COMPATIBLE_END_MARKERS.some((marker) => content.includes(marker))) ||
    standaloneAnnotationPayload(content) != null
  );
}

export interface WebAnnotationCandidate {
  quote: string;
  comment: string;
  color?: string;
}

export interface ParsedWebAnnotationBatch {
  body: string;
  annotations: WebAnnotationCandidate[];
  error: string | null;
}

export function parseWebAnnotationBatch(
  content: string,
): ParsedWebAnnotationBatch {
  const text = content ?? "";
  const start = text.lastIndexOf(START_MARKER);
  if (start < 0) {
    const standalone = standaloneAnnotationPayload(text);
    return standalone == null
      ? { body: text, annotations: [], error: null }
      : parseAnnotationPayload(standalone, "");
  }

  const payloadStart = start + START_MARKER.length;
  const end = firstMarkerIndex(text, COMPATIBLE_END_MARKERS, payloadStart);
  const body = trimProtocolGap(text.slice(0, start));
  if (end < 0) {
    return {
      body,
      annotations: [],
      error: "WEB 标注协议缺少结束标记。",
    };
  }

  const payload = stripOptionalCodeFence(text.slice(payloadStart, end));
  return parseAnnotationPayload(payload, body);
}

function parseAnnotationPayload(
  payload: string,
  body: string,
): ParsedWebAnnotationBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return {
      body,
      annotations: [],
      error: "WEB 标注协议不是有效 JSON。",
    };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.annotations)) {
    return {
      body,
      annotations: [],
      error: "WEB 标注协议缺少 annotations 数组。",
    };
  }
  if (parsed.annotations.length > MAX_ANNOTATIONS) {
    return {
      body,
      annotations: [],
      error: `WEB 标注协议最多允许 ${MAX_ANNOTATIONS} 条。`,
    };
  }

  const annotations: WebAnnotationCandidate[] = [];
  for (let index = 0; index < parsed.annotations.length; index += 1) {
    const candidate = normalizeCandidate(parsed.annotations[index]);
    if (!candidate) {
      return {
        body,
        annotations: [],
        error: `WEB 标注协议第 ${index + 1} 条缺少有效 quote/comment。`,
      };
    }
    annotations.push(candidate);
  }
  if (!annotations.length) {
    return { body, annotations: [], error: "WEB 标注协议没有候选条目。" };
  }
  return { body, annotations, error: null };
}

function standaloneAnnotationPayload(content: string): string | null {
  const text = (content ?? "").trim();
  const fenced = text.match(
    /^(?:json\s*)?```(?:json)?\s*([\s\S]*?)\s*```$/iu,
  );
  const payload = fenced?.[1]?.trim() ?? (/^\{[\s\S]*\}$/u.test(text) ? text : "");
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return isRecord(parsed) && Array.isArray(parsed.annotations)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function firstMarkerIndex(
  text: string,
  markers: string[],
  fromIndex: number,
): number {
  let first = -1;
  for (const marker of markers) {
    const index = text.indexOf(marker, fromIndex);
    if (index >= 0 && (first < 0 || index < first)) first = index;
  }
  return first;
}

export function webAnnotationProtocolInstructions(
  annotationColorGuide: string,
): string {
  const colors =
    annotationColorGuide.trim() ||
    "未提供颜色 rubric；color 字段可以省略，由 Zotero 使用默认颜色。";
  return [
    "## Zotero WEB 批量标注输出协议",
    "这是 WEB 模式：不要调用 Zotero 工具，也不要声称已经修改 PDF。你的任务只是从附件中选择逐字原句并返回本地插件可解析的标注草稿。",
    "选择 5–10 条真正值得标注的正文原句；quote 必须逐字来自附件，不得改写、翻译、省略或补全。每条 quote 只能是一段连续正文，不得跨越独立公式、表格或分页拼接；重点被公式打断时，只引用公式前或公式后的完整文字句。comment 使用中文，格式为“类别：理由”，不超过 80 字。",
    SECTION_SCOPE_RULE,
    "正常回答只保留一段简短摘要；随后严格输出下面的协议块，不要省略开始或结束标记，不要使用 Markdown 代码围栏，也不要在协议块后添加任何内容：",
    "",
    START_MARKER,
    '{"annotations":[{"quote":"PDF 逐字原文","comment":"类别：为什么值得标注","color":"#允许的六位十六进制颜色"}]}',
    END_MARKER,
    "",
    "颜色只能从以下用户配置中选择；类别不明确时省略 color，不要凭颜色直觉猜测：",
    colors,
  ].join("\n");
}

export function webOptionalAnnotationProtocolInstructions(
  annotationColorGuide: string,
): string {
  const colors =
    annotationColorGuide.trim() ||
    "未提供颜色 rubric；color 字段可以省略，由 Zotero 使用默认颜色。";
  return [
    "## 可选 PDF 标注输出约定",
    "如果用户要求解释某个 PDF 句子或选区，请先正常说明原句含义、它在上下文中的作用以及为什么值得关注；仅当用户同时要求标注、高亮、划重点、保存原文或创建注释时，才追加下面的标注协议。",
    "如果用户明确要求对 PDF 内容进行标注、高亮、划重点、保存原文，或者要求选出值得标注的重点句，请在正常回答后严格输出下面的协议。普通问答、解释、总结、翻译、比较或推导不要输出该协议。",
    "quote 必须逐字来自当前提供的论文附件或 PDF 选区，不得改写、翻译、省略、补全或跨公式拼接。comment 使用中文，格式为“类别：为什么值得标注”，不超过 80 字。这只是标注草稿，不要声称已经修改 PDF。",
    SECTION_SCOPE_RULE,
    "输出协议时不要省略开始或结束标记，也不要使用 Markdown 代码围栏。",
    "",
    START_MARKER,
    '{"annotations":[{"quote":"附件中的逐字原文","comment":"类别：简短理由","color":"#允许的六位十六进制颜色"}]}',
    END_MARKER,
    "",
    "color 只能从以下用户配置中选择；类别不明确时省略 color：",
    colors,
  ].join("\n");
}

export function webAnnotationTaskQuestion(): string {
  return [
    "请通读当前附件论文，选择最值得在 PDF 中标注的重点原句。",
    "优先覆盖研究问题、关键定义、核心方法、主要结果、重要限制和结论；避免整段、公式以及只在摘要中重复正文的句子。",
    "未指定数量时选择 5–10 条。每条给出简短中文注释，并按 Zotero WEB 批量标注输出协议返回。",
  ].join("\n");
}

function normalizeCandidate(value: unknown): WebAnnotationCandidate | null {
  if (!isRecord(value)) return null;
  const quote = stringValue(value.quote).trim();
  const comment = stringValue(value.comment).trim();
  if (
    !quote ||
    !comment ||
    quote.length > MAX_QUOTE_CHARS ||
    comment.length > MAX_COMMENT_CHARS
  ) {
    return null;
  }
  const color = normalizeColor(stringValue(value.color));
  return { quote, comment, ...(color ? { color } : {}) };
}

function normalizeColor(value: string): string | null {
  const color = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
}

function stripOptionalCodeFence(value: string): string {
  const text = value.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? text).trim();
}

function trimProtocolGap(value: string): string {
  return value.replace(/\s+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
