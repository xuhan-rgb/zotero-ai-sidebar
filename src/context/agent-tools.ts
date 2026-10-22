import { promptText } from "../utils/prompt-locale";
import type {
  AgentTool,
  Message,
  MindmapData,
  MindmapNode,
  ToolExecutionResult,
} from "../providers/types";
import type { ContextSource, ItemMetadata } from "./builder";
import { freezeFullText, getFrozenFullText } from "../settings/paper-cache";
import { formatAnnotations, formatRetrievedPassages } from "./message-format";
import { createPaperTools } from "./paper-tools";
import { createPdfLocator, type PdfLocator } from "./pdf-locator";
import { DEFAULT_CONTEXT_POLICY, type ContextPolicy } from "./policy";
import { extractPdfRange, searchPdfPassages } from "./retrieval";
import { attachAnchors, detectOutline } from "./pdf-outline";
import type {
  OutlineEntry,
  OverviewData,
  OverviewEmphasis,
  OverviewPhase,
} from "./overview-types";
import {
  currentArxivId,
  loadArxivBibliography,
  formatArxivEquationMiss,
  formatArxivEquationResult,
  formatArxivFigureMiss,
  formatArxivFigureResult,
  formatArxivTableMiss,
  formatArxivTableResult,
  loadArxivEquation,
  loadArxivFigureByQuery,
  loadArxivSections,
  loadArxivTableByQuery,
} from "./arxiv-tools";
import { hasArxivSource } from "./arxiv-store";
import { findSection, buildToc, isArxivTocBlock } from "./tex-sections";
import {
  normalizeLatexListEnvironments,
  normalizeLatexSourceCommands,
} from "./tex-clean";
import type { MessageContext } from "./types";

// Codex-style local harness for Zotero. Each tool is a structured function
// the model can call; the harness validates args, enforces policy budgets,
// runs the Zotero side-effect, and returns a structured result.
//
// INVARIANT: NO local intent routing. The model decides whether it needs
// metadata, search, range, full PDF, or annotation writes — never our code.
// (See CLAUDE.md "No hardcoded semantic intent matching".)
//
// REF: Codex `mcp_tool_call` registry pattern; OpenAI Codex
//      `responses_api/function_call` schema.

export interface ToolFactoryOptions {
  source: ContextSource;
  itemID: number | null;
  referencedItems?: Array<{ itemID: number; title: string }>;
  policy?: ContextPolicy;
  selectionAnnotation?: () => SelectionAnnotationDraft | null;
  // Configured PDF annotation color preset text from user prefs. When
  // present, it gets parsed into the `color` schema description for
  // annotation write tools so the model sees the hex→category mapping at
  // the exact field where it picks a color (stronger than system prompt).
  annotationColorGuide?: string;
  // Kept for the explicit "full-text highlights" quick prompt. Tool
  // availability no longer branches on this flag; the model sees the same
  // manual/tools and decides what to call.
  fullTextHighlight?: boolean;
  getActiveReader?: () => unknown | null;
  previousMessages?: Message[];
  // Append-to-child-note callback. WHY a callback (not a direct sidebar
  // import): keeps the agent-tools module decoupled from sidebar UI state.
  // The sidebar curries in `doc` and the live `state.itemID` so this tool
  // always writes to whatever item is currently selected, even if the
  // tool call lands several turns after session creation. Mirrors the
  // existing `selectionAnnotation` / `getActiveReader` pattern.
  appendToChildNote?: (content: string) => Promise<{
    noteID: number;
    created: boolean;
    usedBetterNotes: boolean;
  }>;
  onMindmapReady?: (data: MindmapData) => void;
  onOverviewReady?: (data: OverviewData) => void;
  debugFullTextSaver?: (
    text: string,
    meta: {
      source: NonNullable<MessageContext["fullTextSource"]>;
      tool: string;
    },
  ) => Promise<string | undefined>;
}

export interface ZoteroAgentToolSession {
  tools: AgentTool[];
  dispose(): void;
}

export interface SelectionAnnotationDraft {
  text: string;
  attachmentID: number;
  annotation: Record<string, unknown>;
}

// An existing PDF annotation found to overlap a sentence — lets immersive mode
// show its saved comment instead of re-translating, and 💾 UPDATE it (by key)
// instead of stacking a duplicate highlight on the same sentence.
export interface ExistingSentenceAnnotation {
  key: string;
  comment: string;
  text: string;
  type: "highlight" | "underline";
  color: string;
  pageLabel: string;
  sortIndex: string;
  pageIndex: number;
  rects: number[][];
}

// Session-less convenience wrapper for tests. Production callers should
// use `createZoteroAgentToolSession` directly so they can `dispose()` the
// PdfLocator (otherwise the locator pins page bundles in memory).
export function createZoteroAgentTools(
  options: ToolFactoryOptions,
): AgentTool[] {
  return createZoteroAgentToolSession(options).tools;
}

export function createZoteroAgentToolSession(
  options: ToolFactoryOptions,
): ZoteroAgentToolSession {
  const policy = options.policy ?? DEFAULT_CONTEXT_POLICY;
  const highlightSession = createFullTextHighlightState(options);
  const colorDescription = buildAnnotationColorDescription(
    options.annotationColorGuide,
  );
  const tools: AgentTool[] = [
    {
      name: "zotero_get_current_item",
      description:
        promptText("读取用户当前选中或打开的 Zotero 条目题录。回答需要标题、作者、年份、摘要或标签时，先使用此工具。", "Read metadata for the Zotero item currently selected or opened by the user. Use this before answering when title, authors, year, abstract, or tags are needed."),
      parameters: objectSchema({}),
      execute: async () => {
        const itemID = currentItemID(options);
        if (itemID == null)
          return errorResult("No Zotero item is currently selected.");
        const metadata = await options.source.getItem(itemID);
        if (!metadata)
          return errorResult("No Zotero item metadata is available.");
        return {
          output: formatMetadata(metadata),
          summary: "读取当前条目题录",
          context: {
            planMode: "metadata_only",
            ...zoteroSourceFromMetadata(itemID, metadata),
          },
        };
      },
    },
    ...(options.referencedItems?.length ? [createReferencedPaperTool(options, policy)] : []),
    {
      name: "zotero_get_annotations",
      description:
        promptText("读取当前条目的 Zotero PDF 注释，包括高亮、评论、页码、颜色及顺序。用户询问其高亮、笔记、注释或阅读标记时使用。", "Read Zotero PDF annotations for the current item, including highlights, comments, page labels, colors, and order. Use when the user asks about their highlights, notes, annotations, or reading marks."),
      parameters: objectSchema({}),
      execute: async () => {
        const itemID = currentItemID(options);
        if (itemID == null)
          return errorResult("No Zotero item is currently selected.");
        const annotations =
          (await options.source.getAnnotations?.(itemID)) ?? [];
        const sourceContext = await zoteroSourceContext(options, itemID);
        const limited = annotations.slice(0, policy.maxAnnotations);
        return {
          output: limited.length
            ? `[Zotero annotations]\n${formatAnnotations(limited)}`
            : "No Zotero PDF annotations were found for the current item.",
          summary: `读取 Zotero 标注 ${limited.length} 条`,
          context: {
            planMode: "annotations",
            ...sourceContext,
            annotations: limited,
          },
        };
      },
    },
    createPreviousContextTool(options, policy),
    {
      name: "zotero_outline_pdf",
      description:
        promptText("不读取全文，以低成本获取整篇论文骨架（章节标题、字符范围、首行预览、图表锚点）。用户需要全文总览时先使用。arXiv 条目使用缓存的 LaTeX 章节列表；其他 PDF 使用启发式标题检测，失败时回退到均匀窗口。读取骨架后，为每节撰写一句话 gist 和逻辑流程图，再调用 render_paper_overview。", "Get a cheap whole-paper skeleton (section headings, char ranges, first-line previews, figure/table anchors) WITHOUT reading the full PDF. Use this first when the user wants an overview/总览 of the entire paper. arXiv items use the cached LaTeX section list; other PDFs use heuristic heading detection with an even-window fallback. After reading the skeleton, write a one-line gist per section and a logical flowchart, then call render_paper_overview."),
      parameters: objectSchema({}),
      execute: async () => {
        const itemID = currentItemID(options);
        if (itemID == null)
          return errorResult("No Zotero item is currently selected.");
        // arXiv path: reuse the reliable LaTeX section index.
        const arxiv = await loadArxivSections(options);
        if (arxiv) {
          const sections = buildToc(arxiv.sections).map((entry) => ({
            no: String(entry.number),
            level: entry.level,
            title: entry.title,
            charStart: 0,
            charEnd: 0,
            preview: "",
          }));
          return {
            output: `[Paper outline]\n${JSON.stringify(
              { title: "", source: "arxiv", coverage: "headings", sections },
              null,
              2,
            )}`,
            summary: `生成 arXiv 大纲 ${sections.length} 节`,
            context: { planMode: "outline" },
          };
        }
        const text = await getToolPdfText(options, itemID);
        if (!text) return errorResult(readablePdfTextError());
        const entries: OutlineEntry[] = attachAnchors(
          detectOutline(text, policy),
          text,
        );
        const coverage = entries[0]?.no.startsWith("~")
          ? "uniform-fallback"
          : "headings";
        const payload = {
          title: "",
          source: "pdf",
          coverage,
          sections: entries.map((entry) => ({
            no: entry.no,
            level: entry.level,
            title: entry.title,
            charStart: entry.charStart,
            charEnd: entry.charEnd,
            preview: entry.preview,
            ...(entry.anchors ? { anchors: entry.anchors } : {}),
          })),
        };
        const output = truncateByTokenBudget(
          `[Paper outline]\n${JSON.stringify(payload, null, 2)}`,
          Math.ceil(policy.outlineCharBudget / 4),
        );
        return {
          output,
          summary: `生成大纲 ${entries.length} 节（${coverage}）`,
          context: { planMode: "outline" },
        };
      },
    },
    {
      name: "zotero_search_pdf",
      description:
        promptText("用模型编写的 query 搜索当前 PDF 全文缓存。适用于定向证据、追问、定义、图表、实验、公式、论点、章节标题或局部段落。执行器返回有字符范围的有限段落，模型可决定只用 zotero_read_pdf_range 扩展相关部分，而非读取全文。需要写回 PDF 高亮的原文应改用 zotero_get_reader_pdf_text，以匹配 Reader 文本层。", "Search the current PDF full-text cache using a query written by the model. Use this for targeted evidence, follow-up questions, definitions, figures, experiments, equations, claims, section/chapter headings, or local passages. The harness returns bounded passages with character ranges so the model can decide whether to expand only a relevant section with zotero_read_pdf_range instead of reading the whole PDF. For passages that will be written back as PDF highlights, use zotero_get_reader_pdf_text instead so the copied text matches the Reader text layer."),
      parameters: objectSchema(
        {
          query: stringSchema(promptText("当前 PDF 全文的搜索查询。", "Search query for the current PDF full text.")),
          topK: numberSchema(
            promptText("最多返回的段落数。执行器会限制在策略允许范围内。", "Maximum passages to return. The harness clamps this to policy limits."),
          ),
        },
        ["query"],
      ),
      execute: async (args) => {
        const itemID = currentItemID(options);
        if (itemID == null)
          return errorResult("No Zotero item is currently selected.");
        const parsed = objectArgs(args);
        const query = stringArg(parsed, "query");
        if (!query)
          return errorResult("zotero_search_pdf requires a non-empty query.");
        const [pdfText, sourceContext] = await Promise.all([
          getToolPdfText(options, itemID),
          zoteroSourceContext(options, itemID),
        ]);
        if (!pdfText) return errorResult(readablePdfTextError());
        const topK = numberArg(parsed, "topK") ?? policy.searchCandidateCount;
        const passages = searchPdfPassages(pdfText, query, topK, policy);
        return {
          isError: passages.length === 0,
          output: passages.length
            ? `[Retrieved PDF passages]\n${formatRetrievedPassages(passages)}`
            : `No PDF passages matched the model-provided query: ${query}`,
          summary: `检索 PDF: ${query}，返回 ${passages.length} 段`,
          context: {
            planMode: "search_pdf",
            ...sourceContext,
            query,
            candidatePassageCount: passages.length,
            selectedPassageNumbers: passages.map((_, index) => index + 1),
            passageSelectorSource: "model",
            retrievedPassages: passages,
          },
        };
      },
    },
    {
      name: "zotero_read_pdf_range",
      description:
        promptText("从当前 PDF 全文缓存读取精确字符范围。仅在先前缓存工具结果或上下文账本提供可用 start/end 范围时使用，包括模型选定的章节范围。执行器会验证并限制范围。需写回 PDF 高亮的段落应改用 zotero_get_reader_pdf_text。", "Read an exact character range from the current PDF full-text cache. Use only when a previous cache-based tool result or ledger gives useful start/end ranges, including section/chapter ranges chosen by the model. The harness validates and caps the range. For passages that will be written back as PDF highlights, use zotero_get_reader_pdf_text instead."),
      parameters: objectSchema(
        {
          start: numberSchema(
            promptText("先前工具结果中从零开始的起始字符偏移。", "Zero-based start character offset from a previous tool result."),
          ),
          end: numberSchema(
            promptText("先前工具结果中的结束字符偏移。", "End character offset from a previous tool result."),
          ),
        },
        ["start", "end"],
      ),
      execute: async (args) => {
        const itemID = currentItemID(options);
        if (itemID == null)
          return errorResult("No Zotero item is currently selected.");
        const parsed = objectArgs(args);
        const start = numberArg(parsed, "start");
        const end = numberArg(parsed, "end");
        if (start == null || end == null) {
          return errorResult(
            "zotero_read_pdf_range requires numeric start and end.",
          );
        }
        const [pdfText, sourceContext] = await Promise.all([
          getToolPdfText(options, itemID),
          zoteroSourceContext(options, itemID),
        ]);
        if (!pdfText) return errorResult(readablePdfTextError());
        const range = extractPdfRange(pdfText, start, end, policy);
        if (!range)
          return errorResult("The requested PDF range is invalid or empty.");
        return {
          output: `[PDF range ${range.start}-${range.end}]\n${range.text}`,
          summary: `读取 PDF 范围 ${range.start}-${range.end}`,
          context: {
            planMode: "pdf_range",
            ...sourceContext,
            rangeStart: range.start,
            rangeEnd: range.end,
            retrievedPassages: [range],
          },
        };
      },
    },
    {
      name: "zotero_get_full_pdf",
      description:
        promptText("读取当前 PDF 全文缓存以综合整篇论文。模型判断需要整篇当前 Zotero 论文且小范围工具不足时使用。此前发送的全文在上下文账本中以来源/范围元数据记录，可据此选择现有历史、定向范围、重新读取或请用户重发。不要从此工具复制 zotero_annotate_passage 的高亮原文；PDF 写入流程使用 zotero_get_reader_pdf_text。执行器会限制全文预算。", "Read the current PDF full-text cache for whole-paper synthesis. Use when the model decides the entire current Zotero paper is needed and smaller tools are insufficient. Prior full-PDF sends appear in the context ledger as source/range metadata so the model can choose between current history, targeted ranges, fresh full text, or asking the user for a resend. Do not copy highlight text from this tool for zotero_annotate_passage; use zotero_get_reader_pdf_text for PDF write workflows. The harness applies a full-PDF budget cap."),
      parameters: objectSchema({}),
      execute: async () => {
        const itemID = currentItemID(options);
        if (itemID == null)
          return errorResult("No Zotero item is currently selected.");
        // A completed parse supersedes text frozen before parsing finished.
        const parsedText = await options.source.getParsedPdfText?.(itemID);
        let text = parsedText ? null : await getFrozenFullText(itemID);
        if (text != null && isArxivTocBlock(text)) text = null;
        if (text != null) {
          text = normalizeLatexSourceCommands(
            normalizeLatexListEnvironments(text),
          );
        }
        let truncated = false;
        let totalChars = 0;
        let sourceContext: Awaited<ReturnType<typeof zoteroSourceContext>>;
        if (text == null) {
          // Extract path: getToolPdfText and zoteroSourceContext are
          // independent — run them in parallel.
          const [pdfText, ctx] = await Promise.all([
            parsedText || getToolPdfText(options, itemID),
            zoteroSourceContext(options, itemID),
          ]);
          sourceContext = ctx;
          if (!pdfText) return errorResult(readablePdfTextError());
          text = truncateByTokenBudget(pdfText, policy.fullPdfTokenBudget);
          truncated = text.length < pdfText.length;
          totalChars = pdfText.length;
          await freezeFullText(itemID, text);
        } else {
          totalChars = text.length;
          sourceContext = await zoteroSourceContext(options, itemID);
        }
        const fullTextSource = parsedText ? "pdf" : await fullTextSourceForTool(options);
        const frontBlockDebugPath = await options.debugFullTextSaver?.(text, {
          source: fullTextSource,
          tool: "zotero_get_full_pdf",
        });
        return {
          output: [
            "Full paper text is now provided at the top of this turn under",
            "the heading [Paper full text]. Read the paper from there. Do not",
            "call zotero_get_full_pdf again this turn.",
          ].join(" "),
          summary:
            fullTextSource === "arxiv"
              ? `读取 arXiv LaTeX 源码 ${text.length}/${totalChars} 字`
              : `读取 PDF 全文 ${text.length}/${totalChars} 字`,
          frontBlock: text,
          context: {
            planMode: "full_pdf",
            ...sourceContext,
            fullTextChars: text.length,
            fullTextTotalChars: totalChars,
            fullTextTruncated: truncated,
            fullTextSource,
            ...(frontBlockDebugPath ? { frontBlockDebugPath } : {}),
            rangeStart: 0,
            rangeEnd: text.length,
          },
        };
      },
    },
    {
      name: "arxiv_list_sections",
      description:
        promptText("以 JSON 列出当前 arXiv 论文缓存 LaTeX 源码的目录，每项为 {number, level, title, label?, bodyChars}。在决定用 arxiv_get_section 读取章节之前，先了解章节及大小，避免 2 KB 足够时读取 30 KB。仅适用于当前 Zotero 条目已有 arXiv 源码缓存的情形；否则使用 zotero_search_pdf / zotero_read_pdf_range / zotero_get_full_pdf。", "List the table of contents of the current arXiv paper's cached LaTeX source as JSON: each entry is {number, level, title, label?, bodyChars}. Use this to discover what sections exist (and how big each is) BEFORE deciding to fetch one with arxiv_get_section, so you do not pull a 30 KB section when a 2 KB one suffices. Only works when the current Zotero item has a cached arXiv source — when not, fall back to the PDF tools (zotero_search_pdf / zotero_read_pdf_range / zotero_get_full_pdf)."),
      parameters: objectSchema({}),
      execute: async () => {
        const loaded = await loadArxivSections(options);
        if (!loaded)
          return errorResult(
            "This item has no cached arXiv source — use the PDF tools instead.",
          );
        const toc = buildToc(loaded.sections);
        if (!toc.length)
          return errorResult(
            "The cached arXiv source has no detectable sections.",
          );
        return {
          output: `[arXiv sections]\n${JSON.stringify(toc, null, 2)}`,
          summary: `列出 arXiv 章节 ${toc.length} 个`,
        };
      },
    },
    {
      name: "arxiv_get_figure",
      description:
        promptText("获取当前 arXiv 论文中的图，以图像附加到后续多模态轮次，让模型实际查看。用户指定 Figure 3 / 图3 / Fig. 3 时使用 number；LaTeX 图标签使用 label；图文件名、相对路径、caption 或 includegraphics 子串使用 name。PNG/JPG/GIF/WebP 直接附加；.pdf/.eps 尽可能从当前 Zotero PDF Reader 裁剪，最好保持 PDF 打开。仅适用于当前条目已有 arXiv 源码缓存。", "Fetch a figure from the current arXiv paper and attach it as an image the model can SEE in a follow-up multimodal turn. Use `number` for user requests such as 'Figure 3' / '图3' / 'Fig. 3'; `label` for a LaTeX figure label; or `name` for a figure basename, relative path, caption substring, or includegraphics substring. Raster source files (PNG/JPG/GIF/WebP) are attached directly. Vector source files (.pdf/.eps) are cropped from the active Zotero PDF Reader when possible, so keep the PDF open for best results. Only works when the current item has a cached arXiv source."),
      parameters: objectSchema({
        number: numberSchema(
          promptText("编译后的图号，例如 Figure 3 对应 3。提供 label 或 name 时可省略。", "Compiled figure number, e.g. 3 for Figure 3. Optional if label or name is provided."),
        ),
        label: stringSchema(
          promptText("LaTeX 图标签，例如 fig:occupancy。提供 number 或 name 时可省略。", "LaTeX figure label, e.g. fig:occupancy. Optional if number or name is provided."),
        ),
        name: stringSchema(
          promptText("图文件名、相对路径、caption 或 includegraphics 子串，例如 occupancy 或 figures/occupancy.pdf。提供 number 或 label 时可省略。", "Figure basename, relative path, caption substring, or includegraphics substring (e.g. 'occupancy' or 'figures/occupancy.pdf'). Optional if number or label is provided."),
        ),
      }),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const number = numberArg(parsed, "number") ?? undefined;
        const label = stringArg(parsed, "label") || undefined;
        const name = stringArg(parsed, "name") || undefined;
        if (number == null && !label && !name) {
          return errorResult(
            "arxiv_get_figure requires `number`, `label`, or `name`.",
          );
        }
        const loaded = await loadArxivFigureByQuery(options, {
          number,
          label,
          name,
        });
        if (!loaded) {
          return errorResult(
            "This item has no cached arXiv source — use the PDF tools instead.",
          );
        }
        if (!loaded.figure) {
          return errorResult(
            formatArxivFigureMiss(loaded.figures, { number, label, name }),
          );
        }
        return {
          output: formatArxivFigureResult({
            ...loaded,
            figure: loaded.figure,
          }),
          summary: `读取 arXiv Figure ${loaded.figure.number}${loaded.image ? "（含图像）" : "（仅文字）"}`,
          ...(loaded.image ? { images: [loaded.image] } : {}),
          context: {
            planMode: "figure",
            sourceKind: "zotero_item",
            sourceID:
              options.itemID != null ? String(options.itemID) : undefined,
            figureNumber: loaded.figure.number,
            ...(loaded.figure.label
              ? { figureLabel: loaded.figure.label }
              : {}),
            ...(loaded.figure.caption
              ? { figureCaption: loaded.figure.caption }
              : {}),
            figureImageAttached: !!loaded.image,
          },
        };
      },
    },
    {
      name: "arxiv_get_table",
      description:
        promptText("按编译表号（如 Table 2 / 表2 对应 2）、LaTeX 标签或 caption/name 子串，读取当前 arXiv 论文缓存源码中的一张表。回答指定表号的问题前先使用，因为 PDF 页面可能包含多个浮动对象，邻近内容可能指向错误表格。结果包含权威 LaTeX 表格源码以供核对。", "Return one numbered table from the current arXiv paper's cached LaTeX source by compiled table number (e.g. 2 for 'Table 2' / '表2'), LaTeX label, or caption/name substring. Use this before answering questions that mention a specific table number, because PDF pages can contain multiple floats and nearby visible content can point to the wrong table. The result includes the authoritative LaTeX table source for verification."),
      parameters: objectSchema({
        number: numberSchema(
          promptText("编译后的表号，例如 Table 2 对应 2。提供 label 或 name 时可省略。", "Compiled table number, e.g. 2 for Table 2. Optional if label or name is provided."),
        ),
        label: stringSchema(
          promptText("LaTeX 表标签，例如 tab:main-results。提供 number 或 name 时可省略。", "LaTeX table label, e.g. tab:main-results. Optional if number or name is provided."),
        ),
        name: stringSchema(
          promptText("caption、标签或表格源码的子串。提供 number 或 label 时可省略。", "Caption substring, label substring, or table-source substring. Optional if number or label is provided."),
        ),
      }),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const number = numberArg(parsed, "number") ?? undefined;
        const label = stringArg(parsed, "label") || undefined;
        const name = stringArg(parsed, "name") || undefined;
        if (number == null && !label && !name) {
          return errorResult(
            "arxiv_get_table requires `number`, `label`, or `name`.",
          );
        }
        const loaded = await loadArxivTableByQuery(options, {
          number,
          label,
          name,
        });
        if (!loaded) {
          return errorResult(
            "This item has no cached arXiv source — use the PDF tools instead.",
          );
        }
        if (!loaded.table) {
          return errorResult(
            formatArxivTableMiss(loaded.tables, { number, label, name }),
          );
        }
        return {
          output: formatArxivTableResult({
            ...loaded,
            table: loaded.table,
          }),
          summary: `读取 arXiv Table ${loaded.table.number}`,
          context: {
            planMode: "table",
            sourceKind: "zotero_item",
            sourceID:
              options.itemID != null ? String(options.itemID) : undefined,
            tableNumber: loaded.table.number,
            ...(loaded.table.label ? { tableLabel: loaded.table.label } : {}),
            ...(loaded.table.caption
              ? { tableCaption: loaded.table.caption }
              : {}),
            tableChars: loaded.table.tex.length,
          },
        };
      },
    },
    {
      name: "arxiv_get_section",
      description:
        promptText("读取当前 arXiv 论文缓存源码中一个章节的 LaTeX 正文。section 接受点分编号（如 3.1）、LaTeX 标签（如 sec:method）或不区分大小写的标题子串（如 methodology）。问题限于特定章节时，优先使用此工具而非重读全文。仅适用于当前条目已有 arXiv 源码缓存。", "Return the LaTeX body of ONE section of the current arXiv paper's cached source. `section` accepts the dotted number (e.g. '3.1'), the LaTeX label (e.g. 'sec:method'), or a case-insensitive substring of the section title (e.g. 'methodology'). Prefer this over re-reading the whole paper whenever the user's question is scoped to a specific section. Only works when the current item has a cached arXiv source."),
      parameters: objectSchema(
        {
          section: stringSchema(
            promptText("章节号（3.1）、标签（sec:method）或标题子串（methodology）。", "Section number ('3.1'), label ('sec:method'), or title substring ('methodology')."),
          ),
        },
        ["section"],
      ),
      execute: async (args) => {
        const loaded = await loadArxivSections(options);
        if (!loaded)
          return errorResult(
            "This item has no cached arXiv source — use the PDF tools instead.",
          );
        const parsed = objectArgs(args);
        const key = stringArg(parsed, "section").trim();
        if (!key)
          return errorResult(
            "arxiv_get_section requires a non-empty `section` argument.",
          );
        const found = findSection(loaded.sections, key);
        if (!found) return errorResult(`No section matched: ${key}`);
        const body = normalizeLatexSourceCommands(
          normalizeLatexListEnvironments(found.body),
        );
        return {
          output: `[arXiv §${found.number} ${found.title}]\n${body}`,
          summary: `读取 arXiv §${found.number} ${found.title} (${body.length} 字)`,
          context: {
            planMode: "full_pdf",
            sourceKind: "zotero_item",
            sourceID:
              options.itemID != null ? String(options.itemID) : undefined,
            fullTextChars: body.length,
            fullTextSource: "arxiv",
          },
        };
      },
    },
    {
      name: "arxiv_get_equation",
      description:
        promptText("按编译公式号（如 Equation (3) / 公式3 对应 3）或 LaTeX 标签（如 eq:loss），读取当前 arXiv 论文缓存源码中的一个编号公式。回答指定公式号的问题前先使用，因为 PDF 可见编号如 (3) 在编译时生成，普通章节文本中不可靠。结果包含用于回答的展示公式和供核对的精确 LaTeX 源码；除非用户要求源码，否则优先用展示公式。", "Return one numbered equation from the current arXiv paper's cached LaTeX source by compiled equation number (e.g. 3 for 'Equation (3)' / '公式3') or by LaTeX label (e.g. 'eq:loss'). Use this before answering questions that mention a specific formula/equation number, because PDF-visible numbers like '(3)' are generated at compile time and are not reliable in plain section text. The result includes display math for final answers and exact LaTeX source for verification; prefer the display math unless the user asks for raw/source LaTeX."),
      parameters: objectSchema({
        number: numberSchema(
          promptText("编译后的公式号，例如 Equation (3) 对应 3。提供 label 时可省略。", "Compiled equation number, e.g. 3 for Equation (3). Optional if label is provided."),
        ),
        label: stringSchema(
          promptText("LaTeX 公式标签，例如 eq:mix_schedule。提供 number 时可省略。", "LaTeX equation label, e.g. eq:mix_schedule. Optional if number is provided."),
        ),
      }),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const number = numberArg(parsed, "number") ?? undefined;
        const label = stringArg(parsed, "label") || undefined;
        if (number == null && !label) {
          return errorResult(
            "arxiv_get_equation requires either `number` or `label`.",
          );
        }
        const loaded = await loadArxivEquation(options, { number, label });
        if (!loaded) {
          return errorResult(
            "This item has no cached arXiv source — use the PDF tools instead.",
          );
        }
        if (!loaded.equation) {
          return errorResult(
            formatArxivEquationMiss(loaded.equations, { number, label }),
          );
        }
        return {
          output: formatArxivEquationResult({
            ...loaded,
            equation: loaded.equation,
          }),
          summary: `读取 arXiv 公式 (${loaded.equation.number})`,
          context: {
            planMode: "equation",
            sourceKind: "zotero_item",
            sourceID:
              options.itemID != null ? String(options.itemID) : undefined,
            equationNumber: loaded.equation.number,
            ...(loaded.equation.label
              ? { equationLabel: loaded.equation.label }
              : {}),
            equationChars: loaded.equation.tex.length,
          },
        };
      },
    },
    {
      name: "arxiv_get_bibliography",
      description:
        promptText("读取当前 arXiv 论文缓存的参考文献文件。用户询问参考文献、引用键或论文引用的相关工作，或者清理后的 LaTeX 全文只有 \\bibliography{...} 而没有展开条目时，优先使用。有编译 .bbl 文件时返回 .bbl，否则返回 .bib。仅适用于当前条目已有 arXiv 源码缓存。", "Read the current arXiv paper's cached bibliography files. Prefer this when the user asks about references, citation keys, related works cited by the paper, or when the cleaned full LaTeX source only contains `\\bibliography{...}` without expanded entries. Returns compiled .bbl files when available; otherwise returns .bib files. Only works when the current item has a cached arXiv source."),
      parameters: objectSchema({}),
      execute: async () => {
        const loaded = await loadArxivBibliography(options);
        if (!loaded)
          return errorResult(
            "This item has no cached arXiv source — use the PDF tools or web search instead.",
          );
        if (!loaded.files.length)
          return errorResult(
            "The cached arXiv source has no .bbl or .bib bibliography files.",
          );
        const blocks = loaded.files.map(
          (file) => `[arXiv bibliography file: ${file.path}]\n${file.text}`,
        );
        const text = blocks.join("\n\n");
        const output = truncateByTokenBudget(text, policy.fullPdfTokenBudget);
        return {
          output,
          summary: `读取 arXiv 参考文献 ${loaded.files.length} 个文件 (${output.length}/${text.length} 字)`,
          context: {
            planMode: "bibliography",
            sourceKind: "zotero_item",
            sourceID:
              options.itemID != null ? String(options.itemID) : undefined,
            bibliographyChars: output.length,
            bibliographyFiles: loaded.files.map((file) => file.path),
          },
        };
      },
    },
    createDrawMindmapTool(options),
    {
      name: "render_paper_overview",
      description:
        promptText("将全文总览图渲染到笔记面板的总览视图。在 zotero_outline_pdf 之后调用。提供 narrative：2–4 句中文核心讲述，说明论文内容与贡献；sections 按文档顺序排列，每项含 no、level、title、≤30 字中文 gist、charStart、charEnd、可选 anchors、phase（motivation|method|validation）、emphasis（innovation|result|normal|background）。emphasis=innovation 时 gist 必须说明新在哪。flowchart 含 nodes（id/label/type[root|section|point|result|innovation]/可选 sectionNo）及 edges（source/target/可选 label）。本文贡献节点用 innovation，并设置对应 sectionNo；效果/SOTA 节点用 result。网络图从关联代码单独生成，不应包含在此处。", "Render the whole-paper overview map into the note panel's Overview view. Call AFTER zotero_outline_pdf. Provide: 'narrative' = a 2–4 sentence English synthesis (what the paper does and its contribution); 'sections' in document order, each with no, level, title, a ≤30-char English gist, charStart, charEnd, optional anchors, 'phase' (motivation|method|validation) and 'emphasis' (innovation|result|normal|background) — for emphasis='innovation' the gist MUST say what is NEW; and a 'flowchart' (nodes id/label/type[root|section|point|result|innovation]/optional sectionNo + edges source/target/optional label). Mark THIS paper's contributions as type='innovation' with sectionNo set to the matching section number; 'result' marks effect/SOTA nodes. Network diagrams are generated separately from linked source code and must not be included here."),
      parameters: objectSchema(
        {
          title: stringSchema(promptText("论文标题。", "Paper title.")),
          source: stringSchema(promptText("取值为 arxiv 或 pdf。", "'arxiv' or 'pdf'.")),
          coverage: stringSchema(promptText("取值为 headings 或 uniform-fallback。", "'headings' or 'uniform-fallback'.")),
          narrative: stringSchema(
            promptText("2–4 句中文全文核心讲述，结尾点出贡献。", "2–4 sentence English whole-paper synthesis, ending by pointing out the contributions."),
          ),
          sections: {
            type: "array",
            description: promptText("按文档顺序排列的章节，每节含 gist 和分类。", "Document-order sections, each gisted and classified."),
            items: {
              type: "object",
              properties: {
                no: { type: "string" },
                level: { type: "number" },
                title: { type: "string" },
                gist: { type: "string" },
                charStart: { type: "number" },
                charEnd: { type: "number" },
                pageLabel: { type: "string" },
                anchors: { type: "array", items: { type: "string" } },
                phase: { type: "string" },
                emphasis: { type: "string" },
              },
              required: ["no", "title"],
            },
          },
          flowchart: {
            type: "object",
            description: promptText("逻辑结构图（类似 Mermaid 流程图）。", "Logical structure graph (mermaid-flowchart-like)."),
            properties: {
              rankdir: { type: "string" },
              nodes: { type: "array", items: { type: "object" } },
              edges: { type: "array", items: { type: "object" } },
            },
          },
        },
        ["sections"],
      ),
      execute: async (args) => {
        const parsed = objectArgs(args);
        const rawSections = Array.isArray(parsed.sections)
          ? parsed.sections
          : [];
        if (!rawSections.length)
          return errorResult(
            "render_paper_overview requires a non-empty 'sections' array.",
          );
        const data: OverviewData = {
          title: stringArg(parsed, "title"),
          source: stringArg(parsed, "source") === "arxiv" ? "arxiv" : "pdf",
          coverage:
            stringArg(parsed, "coverage") === "uniform-fallback"
              ? "uniform-fallback"
              : "headings",
          narrative: stringArg(parsed, "narrative") || undefined,
          sections: rawSections
            .filter(
              (s): s is Record<string, unknown> => !!s && typeof s === "object",
            )
            .map((s) => ({
              no: String(s.no ?? ""),
              level: typeof s.level === "number" ? s.level : 1,
              title: String(s.title ?? ""),
              gist: typeof s.gist === "string" ? s.gist : undefined,
              charStart: typeof s.charStart === "number" ? s.charStart : 0,
              charEnd: typeof s.charEnd === "number" ? s.charEnd : 0,
              pageLabel:
                typeof s.pageLabel === "string" ? s.pageLabel : undefined,
              anchors: Array.isArray(s.anchors)
                ? s.anchors.filter((a): a is string => typeof a === "string")
                : undefined,
              phase: overviewPhaseArg(s.phase),
              emphasis: overviewEmphasisArg(s.emphasis),
            })),
          flowchart: normalizeOverviewFlowchart(parsed.flowchart),
        };
        // Fallbacks so the redesigned view always shows phases + emphasis even
        // when the model under-fills the structured fields. Phase ← title;
        // emphasis ← flowchart innovation/result nodes (by sectionNo) or a
        // leading "新/创新:" gist prefix the model tends to write.
        const innovationNos = new Set<string>();
        const resultNos = new Set<string>();
        for (const node of data.flowchart?.nodes ?? []) {
          if (!node.sectionNo) continue;
          if (node.type === "innovation") innovationNos.add(node.sectionNo);
          else if (node.type === "result") resultNos.add(node.sectionNo);
        }
        for (const section of data.sections) {
          if (!section.phase)
            section.phase = inferPhaseFromTitle(section.title);
          if (!section.emphasis) {
            if (innovationNos.has(section.no)) section.emphasis = "innovation";
            else if (resultNos.has(section.no)) section.emphasis = "result";
            else if (
              section.gist &&
              /^(新|创新|本文)\s*[:：]/.test(section.gist.trim())
            )
              section.emphasis = "innovation";
          }
          if (section.emphasis === "innovation" && section.gist) {
            section.gist = section.gist.replace(
              /^(新|创新|本文)\s*[:：]\s*/,
              "",
            );
          }
        }
        options.onOverviewReady?.(data);
        return {
          output: `[Overview rendered] ${data.sections.length} sections${
            data.flowchart ? `, ${data.flowchart.nodes.length} flow nodes` : ""
          }.`,
          summary: `渲染总览 ${data.sections.length} 节`,
          context: { planMode: "overview" },
        };
      },
    },
    ...createPaperTools(policy),
    createGetReaderPdfTextTool(policy, highlightSession),
    createGetCurrentPdfSelectionTool(options),
    createTextAnnotationNearSelectionTool(policy, options),
    {
      name: "zotero_add_annotation_to_selection",
      description:
        promptText("为用户当前 PDF 选区创建 Zotero highlight 注释（Reader 工具栏的高亮文本工具），并附加评论。用户要求高亮、高亮+评论或划线评论时使用，结果会给选区着色并附加评论。用户要求在页面放置可见文字框时不要使用，应改用 zotero_add_text_annotation_to_selection / 新增文字 / Add Text。写入工具，需要审批或 YOLO 模式。", "Create a Zotero PDF `highlight` annotation (Zotero Reader toolbar tool 'Highlight Text / 高亮文本') with a comment attached to the user's current selected PDF text. Use this when the user asks for a highlight, a comment on the highlight, or a 高亮 / 高亮+评论 / 划线评论 — the result colors the selected text and attaches the comment. Do NOT use this when the user asks for a visible text BOX placed on the page (use zotero_add_text_annotation_to_selection / 新增文字 / Add Text for that). Write tool, requires approval or YOLO mode."),
      requiresApproval: true,
      parameters: objectSchema(
        {
          comment: stringSchema(
            promptText("保存到 PDF 选区的注释评论。", "Annotation comment to save on the selected PDF text."),
          ),
          color: stringSchema(colorDescription),
          type: stringSchema(
            promptText("可选注释类型：highlight 或 underline。省略时使用 highlight。", "Optional annotation type. Supported values are highlight or underline. If omitted, highlight is used."),
          ),
        },
        ["comment"],
      ),
      execute: async (args) => {
        const draft = options.selectionAnnotation?.();
        if (!draft) {
          return errorResult(
            "No live PDF text selection is available for creating an annotation. Select text in the Zotero PDF reader first.",
          );
        }
        const parsed = objectArgs(args);
        const comment = truncate(
          stringArg(parsed, "comment"),
          policy.maxAnnotationCommentChars,
        );
        if (!comment) {
          return errorResult(
            "zotero_add_annotation_to_selection requires a non-empty comment.",
          );
        }
        const saved = await saveSelectionAnnotation(draft, {
          comment,
          color: stringArg(parsed, "color") || undefined,
          type: annotationTypeArg(parsed),
        });
        return {
          output: [
            "[Saved Zotero PDF annotation]",
            `Annotation item ID: ${saved.id}`,
            `Selected text: ${draft.text}`,
            `Comment: ${comment}`,
          ].join("\n"),
          summary: `新增 PDF 注释 ${comment.length} 字`,
          context: {
            planMode: "selected_text",
            selectedText: draft.text,
          },
        };
      },
    },
    createAnnotatePassageTool(policy, highlightSession, colorDescription),
    createAppendToChildNoteTool(options),
  ];

  return { tools, dispose: highlightSession.dispose };
}

// Read-only companion to `zotero_add_annotation_to_selection`.
// The selection snapshot is captured in the sidebar from Zotero Reader's
// `renderTextSelectionPopup` event, which is the same official path used
// when Zotero builds a highlight candidate from `_selectionRanges`.
// REF: Zotero Reader `pdf-view.js` `_getAnnotationFromSelectionRanges(...)`.
function createGetCurrentPdfSelectionTool(
  options: ToolFactoryOptions,
): AgentTool {
  return {
    name: "zotero_get_current_pdf_selection",
    description:
      promptText("读取当前 Zotero PDF Reader 中用户选中的文本，尽可能保留语义段落和列表结构。用户要求查看、输出、翻译、解释或分析 PDF 选区，而 [Selected PDF text] 尚未提供选区时使用。只读，不创建注释。", "Read the user's current selected text in the active Zotero PDF Reader, preserving semantic paragraph/list structure when available. Use when the user asks to inspect, print, translate, explain, or reason about the current PDF selection and the selection was not already supplied in [Selected PDF text]. This is read-only and does not create annotations."),
    parameters: objectSchema({}),
    execute: async () => {
      const draft = options.selectionAnnotation?.();
      if (!draft) {
        return errorResult(
          "No live PDF text selection is available. Select text in the Zotero PDF reader first.",
        );
      }
      const itemID = currentItemID(options);
      const sourceContext =
        itemID == null ? {} : await zoteroSourceContext(options, itemID);
      const pageLabel = selectionPageLabel(draft);
      const rectCount = selectionRectCount(draft);
      return {
        output: [
          "[Current PDF selection]",
          "Source: active Zotero Reader text selection",
          `Attachment ID: ${draft.attachmentID}`,
          pageLabel ? `Page: ${pageLabel}` : "",
          `Rects: ${rectCount}`,
          `Chars: ${draft.text.length}`,
          "",
          draft.text,
        ]
          .filter((line) => line !== "")
          .join("\n"),
        summary: `读取当前 PDF 选区 ${draft.text.length} 字`,
        context: {
          planMode: "selected_text",
          ...sourceContext,
          selectedText: draft.text,
        },
      };
    },
  };
}

function selectionPageLabel(draft: SelectionAnnotationDraft): string {
  const label = stringValue(draft.annotation.pageLabel);
  if (label) return label;
  const position = draft.annotation.position;
  if (!position || typeof position !== "object") return "";
  const pageIndex = (position as { pageIndex?: unknown }).pageIndex;
  return typeof pageIndex === "number" && Number.isFinite(pageIndex)
    ? String(Math.floor(pageIndex) + 1)
    : "";
}

function selectionRectCount(draft: SelectionAnnotationDraft): number {
  const position = draft.annotation.position;
  if (!position || typeof position !== "object") return 0;
  const rects = (position as { rects?: unknown }).rects;
  return Array.isArray(rects) ? rects.length : 0;
}

function createTextAnnotationNearSelectionTool(
  policy: ContextPolicy,
  options: ToolFactoryOptions,
): AgentTool {
  return {
    name: "zotero_add_text_annotation_to_selection",
    description:
      promptText("创建 Zotero PDF text 注释，即 Reader 工具栏的新增文字 / Add Text（T 工具）。在用户当前 PDF 选区附近放置可见文字框。用户要求新增文字、加文字、写到 PDF 上、文字框、text 注释、T 工具或 Add Text 等可见页面文字时使用，而非高亮文字。选区作为锚点，文字框可位于下方、上方或覆盖选区。创建的是 text 类型，而非高亮+评论（后者使用 zotero_add_annotation_to_selection）。必须有当前 PDF 选区。写入工具，需要审批或 YOLO 模式。", "Create a Zotero PDF `text` annotation — the Zotero Reader toolbar tool 'Add Text / 新增文字' (the T tool). This places a visible text box on the page near the user's current PDF text selection. Use this when the user asks for 新增文字 / 加文字 / 写到 PDF 上 / 文字框 / a 'text' annotation / the T tool / 'Add Text' — anything that means 'put visible text on the page', as opposed to highlighting words. The selected text is the anchor; the text box appears below (or above/over) it. This creates annotation type `text`, NOT a highlight + comment (use zotero_add_annotation_to_selection / 高亮+评论 for that). Requires a current PDF selection. Write tool, requires approval or YOLO mode."),
    requiresApproval: true,
    parameters: objectSchema(
      {
        comment: stringSchema(
          promptText("放置到 PDF 页面上的可见文字，例如简短中文笔记。", "Visible text to place on the PDF page, for example a short English note."),
        ),
        color: stringSchema(
          promptText("可选文字颜色，例如 #ffd400。省略时使用 Zotero 默认注释颜色。", "Optional text color, such as #ffd400. If omitted, Zotero/default annotation color is used."),
        ),
        fontSize: numberSchema(
          promptText("可选字号，单位为 PDF 点，默认 14。", "Optional font size in PDF points. Defaults to 14."),
        ),
        placement: stringSchema(
          promptText("相对当前选区的可选位置：below、above 或 over。默认 below。", "Optional placement relative to the current selection: below, above, or over. Defaults to below."),
        ),
      },
      ["comment"],
    ),
    execute: async (args) => {
      const draft = options.selectionAnnotation?.();
      if (!draft) {
        return errorResult(
          "No live PDF text selection is available for anchoring a visible text annotation. Select text in the Zotero PDF reader first.",
        );
      }
      const parsed = objectArgs(args);
      const comment = truncate(
        stringArg(parsed, "comment"),
        policy.maxAnnotationCommentChars,
      );
      if (!comment) {
        return errorResult(
          "zotero_add_text_annotation_to_selection requires a non-empty comment.",
        );
      }
      const saved = await saveTextAnnotationNearSelection(
        draft,
        {
          comment,
          color: stringArg(parsed, "color") || undefined,
          fontSize: numberArg(parsed, "fontSize") ?? undefined,
          placement: textAnnotationPlacementArg(parsed),
        },
        options.getActiveReader?.(),
      );
      return {
        output: [
          "[Saved Zotero PDF text annotation]",
          textAnnotationSavedLine(saved),
          `Anchor text: ${draft.text}`,
          `Visible text: ${comment}`,
        ].join("\n"),
        summary: `新增 PDF 文字（T 工具） ${comment.length} 字`,
        context: {
          planMode: "annotation_write",
          selectedText: draft.text,
        },
      };
    },
  };
}

function createReferencedPaperTool(
  options: ToolFactoryOptions,
  policy: ContextPolicy,
): AgentTool {
  return {
    name: "zotero_read_referenced_paper",
    description:
      promptText("读取用户在本轮通过 @ 明确附加的 Zotero 论文。itemID 使用用户消息中附加论文列表的 ID。action=metadata 读取标题/摘要；search 用 query 检索有限段落；range 用 start/end 扩展先前结果；full 在需要整篇对比时读取受限全文。不要用当前论文替代引用论文。由用户提示词决定是对比还是用引用论文分析当前论文。", "Read a Zotero paper explicitly attached with @ to this user turn. Use itemID from the attached-paper list in the user message. action=metadata reads title/abstract; action=search retrieves bounded passages using query; action=range expands a prior result using start/end; action=full reads bounded full text when needed for whole-paper comparison. Do not substitute the current paper for the referenced paper. The user prompt determines whether to compare or use the referenced paper to analyze the current one."),
    parameters: objectSchema(
      {
        itemID: numberSchema(promptText("通过 @ 明确附加的论文条目 ID。", "Item ID of a paper explicitly attached with @.")),
        action: stringSchema(promptText("取值为 metadata、search、range 或 full。", "One of metadata, search, range, full.")),
        query: stringSchema(promptText("action=search 时的搜索查询。", "Search query when action is search.")),
        start: numberSchema(promptText("action=range 时的起始字符偏移。", "Start character offset when action is range.")),
        end: numberSchema(promptText("action=range 时的结束字符偏移。", "End character offset when action is range.")),
      },
      ["itemID", "action"],
    ),
    execute: async (args) => {
      const parsed = objectArgs(args);
      const itemID = numberArg(parsed, "itemID");
      const action = stringArg(parsed, "action");
      const reference = options.referencedItems?.find((item) => item.itemID === itemID);
      if (!reference) return errorResult("This Zotero item was not attached with @ in this turn.");
      const metadata = await options.source.getItem(reference.itemID);
      if (!metadata) return errorResult("The referenced Zotero item is unavailable.");
      const sourceContext = zoteroSourceFromMetadata(reference.itemID, metadata);
      if (action === "metadata") {
        return {
          output: `[Referenced Zotero paper: ${metadata.title}]\n${formatMetadata(metadata)}`,
          summary: `读取引用文章题录：${metadata.title}`,
          context: { planMode: "metadata_only", ...sourceContext },
        };
      }
      const fullText = await options.source.getFullText(reference.itemID);
      if (!fullText) return errorResult(`No readable full text for referenced paper: ${metadata.title}`);
      if (action === "search") {
        const query = stringArg(parsed, "query");
        if (!query) return errorResult("search requires query.");
        const passages = searchPdfPassages(fullText, query, policy.searchCandidateCount, policy);
        return {
          output: passages.length
            ? `[Referenced paper: ${metadata.title}]\n${formatRetrievedPassages(passages)}`
            : `No passages matched in referenced paper: ${metadata.title}`,
          summary: `检索引用文章：${metadata.title}，${passages.length} 段`,
          context: { planMode: "search_pdf", ...sourceContext, query, retrievedPassages: passages },
        };
      }
      if (action === "range") {
        const start = numberArg(parsed, "start");
        const end = numberArg(parsed, "end");
        if (start == null || end == null) return errorResult("range requires start and end.");
        const range = extractPdfRange(fullText, start, end, policy);
        if (!range) return errorResult("The requested range is invalid or empty.");
        return {
          output: `[Referenced paper: ${metadata.title}, range ${range.start}-${range.end}]\n${range.text}`,
          summary: `读取引用文章范围：${metadata.title}`,
          context: { planMode: "pdf_range", ...sourceContext, rangeStart: range.start, rangeEnd: range.end, retrievedPassages: [range] },
        };
      }
      if (action === "full") {
        const text = truncateByTokenBudget(fullText, policy.fullPdfTokenBudget);
        return {
          output: `[Referenced paper full text: ${metadata.title}]\n${text}`,
          summary: `读取引用文章全文：${metadata.title} ${text.length}/${fullText.length} 字`,
          context: { planMode: "full_pdf", ...sourceContext, fullTextChars: text.length, fullTextTotalChars: fullText.length, fullTextTruncated: text.length < fullText.length },
        };
      }
      return errorResult("action must be metadata, search, range, or full.");
    },
  };
}

async function getToolPdfText(
  options: ToolFactoryOptions,
  itemID: number,
): Promise<string> {
  return options.source.getFullText(itemID);
}

async function fullTextSourceForTool(
  options: ToolFactoryOptions,
): Promise<NonNullable<MessageContext["fullTextSource"]>> {
  try {
    const arxivId = currentArxivId(options);
    if (arxivId && (await hasArxivSource(arxivId))) return "arxiv";
  } catch {
    // Fall back to the generic PDF label; source tagging is only debug
    // metadata and must not make the full-text tool fail.
  }
  return "pdf";
}

function readablePdfTextError(): string {
  return "No readable PDF full-text cache is available for the current item.";
}

async function getReaderPdfText(
  session: FullTextHighlightState,
): Promise<string> {
  const locator = await session.getOrCreateLocator();
  return locator ? locator.getFullText() : "";
}

function readableReaderPdfTextError(session: FullTextHighlightState): string {
  return `No readable PDF.js text layer is available from the active Zotero Reader. ${session.locatorError()}`;
}

interface FullTextHighlightState {
  getOrCreateLocator(): Promise<PdfLocator | null>;
  locatorError(): string;
  dispose(): void;
}

// Locator session: lazily builds one PdfLocator per tool session and
// memoizes it. INVARIANT: at most one in-flight locator init promise — the
// model often calls `zotero_get_reader_pdf_text` and `zotero_annotate_passage`
// in rapid succession, and we MUST NOT trigger PDF.js text-layer extraction
// twice in parallel (it produces inconsistent char offsets).
function createFullTextHighlightState(
  options: ToolFactoryOptions,
): FullTextHighlightState {
  let locator: PdfLocator | null = null;
  let locatorPromise: Promise<PdfLocator | null> | null = null;
  let locatorError = "";

  return {
    async getOrCreateLocator() {
      if (locator) return locator;
      if (!locatorPromise) {
        locatorPromise = (async () => {
          const reader = options.getActiveReader?.();
          if (!reader) {
            locatorError =
              "Please open the PDF in Zotero Reader and keep that tab active.";
            return null;
          }
          try {
            locator = await createPdfLocator(reader);
            return locator;
          } catch (err) {
            locatorError = err instanceof Error ? err.message : String(err);
            return null;
          }
        })();
      }
      return locatorPromise;
    },
    locatorError() {
      return locatorError;
    },
    dispose() {
      locator?.dispose();
      locator = null;
      locatorPromise = null;
    },
  };
}

function createGetReaderPdfTextTool(
  policy: ContextPolicy,
  session: FullTextHighlightState,
): AgentTool {
  return {
    name: "zotero_get_reader_pdf_text",
    description:
      promptText("读取当前 Zotero Reader/PDF.js 文本层。用户明确要求写入 PDF 高亮/注释时使用，从此工具复制的段落可由 zotero_annotate_passage 定位。PDF 必须在 Zotero Reader 中打开。普通总结或不写入的分析应使用 zotero_get_full_pdf。可选 start/end 可读取先前 zotero_get_reader_pdf_text 结果中的精确范围。", "Read PDF text from the active Zotero Reader/PDF.js text layer. Use this when the user explicitly asks to write PDF highlights/annotations, because passages copied from this tool can be located by zotero_annotate_passage. Requires the PDF to be open in Zotero Reader. For ordinary summarization or non-writing analysis, use zotero_get_full_pdf instead. Optional start/end read an exact Reader-text range from a previous zotero_get_reader_pdf_text result."),
    parameters: objectSchema({
      start: numberSchema(
        promptText("先前 Reader 文本结果中可选的、从零开始的起始字符偏移。", "Optional zero-based start character offset from a previous Reader-text result."),
      ),
      end: numberSchema(
        promptText("先前 Reader 文本结果中可选的结束字符偏移。", "Optional end character offset from a previous Reader-text result."),
      ),
    }),
    execute: async (args) => {
      const pdfText = await getReaderPdfText(session);
      if (!pdfText) return errorResult(readableReaderPdfTextError(session));

      const parsed = objectArgs(args);
      const slice = readerTextSlice(pdfText, parsed, policy);
      if (!slice) {
        return errorResult(
          "zotero_get_reader_pdf_text requires both numeric start and end when either range field is provided, and the range must be valid.",
        );
      }
      const truncated = slice.end < pdfText.length;
      return {
        output: [
          "[Reader PDF text for annotation]",
          "Source: active Zotero Reader text layer",
          "Use with: zotero_annotate_passage",
          `Chars: ${slice.text.length} / ${pdfText.length}`,
          `Truncated: ${truncated ? "yes" : "no"}`,
          `Range: ${slice.start}-${slice.end}`,
          "",
          slice.text,
        ].join("\n"),
        summary: `读取 Reader PDF 文本 ${slice.text.length}/${pdfText.length} 字`,
        context: {
          planMode: "reader_pdf_text",
          fullTextChars: slice.text.length,
          fullTextTotalChars: pdfText.length,
          fullTextTruncated: truncated,
          rangeStart: slice.start,
          rangeEnd: slice.end,
        },
      };
    },
  };
}

function readerTextSlice(
  pdfText: string,
  args: Record<string, unknown>,
  policy: ContextPolicy,
): { start: number; end: number; text: string } | null {
  const startArg = numberArg(args, "start");
  const endArg = numberArg(args, "end");
  const hasStart = startArg != null;
  const hasEnd = endArg != null;
  if (hasStart !== hasEnd) return null;

  if (!hasStart && !hasEnd) {
    const end = Math.min(pdfText.length, policy.fullPdfTokenBudget * 4);
    return { start: 0, end, text: pdfText.slice(0, end) };
  }
  if (startArg == null || endArg == null) return null;

  const start = Math.floor(startArg);
  const requestedEnd = Math.floor(endArg);
  if (start !== startArg || requestedEnd !== endArg) return null;
  if (start < 0 || requestedEnd <= start || start >= pdfText.length)
    return null;

  const end = Math.min(
    requestedEnd,
    start + policy.maxRangeChars,
    pdfText.length,
  );
  return { start, end, text: pdfText.slice(start, end) };
}

function createAnnotatePassageTool(
  policy: ContextPolicy,
  session: FullTextHighlightState,
  colorDescription: string,
): AgentTool {
  return {
    name: "zotero_annotate_passage",
    description:
      promptText("对指定段落创建 Zotero PDF 高亮注释。仅在用户明确要求向 PDF 写入高亮/注释时使用，例如全文标注或高亮重点句。全文标注前先调用 zotero_get_current_item 读取摘要，再调用 zotero_get_reader_pdf_text，并从 Reader 文本输出逐字复制 text。不要从 zotero_get_full_pdf 复制，因为它使用全文缓存而非 Reader 文本层。普通总结不要使用此写入工具。PDF 修改需要审批或 YOLO 模式。", "Create a Zotero PDF highlight annotation on a specific passage. Use only when the user explicitly asks to write highlights/annotations into the PDF, such as annotating the whole paper or highlighting key sentences. Before using this tool for full-text annotation, call zotero_get_current_item to read the abstract, then call zotero_get_reader_pdf_text and copy `text` verbatim from that Reader-text output. Do not copy highlight text from zotero_get_full_pdf, because that tool uses Zotero's full-text cache rather than the Reader text layer. For ordinary summaries, do not use this write tool. PDF modification requires approval or YOLO mode."),
    requiresApproval: true,
    parameters: objectSchema(
      {
        text: stringSchema(
          promptText("PDF 中精确的原文段落，逐字复制，不可改写。", "Exact passage from the PDF (verbatim, no paraphrasing)."),
        ),
        comment: stringSchema(
          promptText("阅读笔记（中文，≤80 字），说明该段落为何重要。", "Reading note (≤ 80 characters in English), explaining why this passage is important."),
        ),
        color: stringSchema(colorDescription),
      },
      ["text", "comment"],
    ),
    execute: async (args) => {
      const parsed = objectArgs(args);
      const text = stringArg(parsed, "text");
      const comment = truncate(
        stringArg(parsed, "comment"),
        policy.maxFullTextHighlightCommentChars,
      );
      if (!text)
        return errorResult(
          "zotero_annotate_passage requires a non-empty `text`.",
        );
      if (!comment)
        return errorResult(
          "zotero_annotate_passage requires a non-empty `comment`.",
        );
      const locator = await session.getOrCreateLocator();
      if (!locator) {
        return errorResult(
          `No Reader/PDF.js text layer is available for this item. ${session.locatorError()}`,
        );
      }

      const result = await locator.locate(text, {
        minConfidence: policy.minLocateConfidence,
      });
      if (!result) {
        return errorResult(
          `Passage not found in PDF (or low confidence): ${text.slice(0, 60)}...`,
        );
      }

      const Z = getZoteroAnnotationAPI();
      const attachment = await Z.Items.getAsync(locator.attachmentID);
      if (!attachment)
        return errorResult("PDF attachment is no longer available.");

      const key = Z.DataObjectUtilities.generateKey();
      const json = {
        id: key,
        key,
        type: "highlight",
        text: result.matchedText,
        comment,
        color: stringArg(parsed, "color") || Z.Annotations.DEFAULT_COLOR,
        pageLabel: result.pageLabel,
        sortIndex: result.sortIndex,
        position: { pageIndex: result.pageIndex, rects: result.rects },
      };
      const saved = await Z.Annotations.saveFromJSON(
        attachment,
        annotationJSONForZotero(json),
      );
      return {
        output: [
          `[Saved annotation #${saved.id}]`,
          `Page: ${result.pageLabel}`,
          `Confidence: ${result.confidence.toFixed(2)}`,
          `Text: ${result.matchedText.slice(0, 100)}`,
          `Comment: ${comment}`,
        ].join("\n"),
        summary: `p.${result.pageLabel} 高亮 +${comment.length}字`,
        context: { planMode: "annotation_write" },
      };
    },
  };
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): { [key: string]: unknown } {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

// Build a rich `color` parameter description by parsing the user's
// configured annotation color preset. We prefer this over a generic
// "Optional Zotero annotation color, e.g. #ffd400." string because the
// schema description is read by the model at the exact moment it fills
// the `color` field — stronger than restating the rule in system prompt
// or user message. The trailing warning addresses a real failure mode
// observed in practice: models permute the hex→category mapping based
// on color intuition (red=danger, green=good) instead of the configured
// project-specific semantics.
function buildAnnotationColorDescription(guide?: string): string {
  const fallback =
    promptText("可选 Zotero 注释颜色，例如 #ffd400。省略时使用选区或默认颜色。", "Optional Zotero annotation color, e.g. #ffd400. If omitted, the selection/default color is used.");
  if (!guide) return fallback;
  const entries: string[] = [];
  for (const line of guide.split(/\r?\n/)) {
    const match = line.match(/(#[0-9a-fA-F]{6})\s*(.*)$/);
    if (!match) continue;
    const hex = match[1].toLowerCase();
    const rest = match[2].trim().replace(/[。\.]+\s*$/, "");
    entries.push(rest ? `- ${hex} — ${rest}` : `- ${hex}`);
  }
  if (!entries.length) return fallback;
  return [
    promptText("可选 Zotero 注释颜色。必须从下列已配置预设中选择 hex；无明确匹配类别时省略，不要强行分类。", "Optional Zotero annotation color. MUST pick a hex from the configured presets below; omit the field if no category clearly matches (do not force-fit colors)."),
    "",
    ...entries,
    "",
    promptText("重要：这些类别与 hex 的映射是项目特定规则，可能与常见颜色直觉相反。按上面的类别标签匹配，不要依赖一般颜色联想（例如不要假定红色=问题、绿色=好结果或橙色=警告，应逐条阅读）。", "IMPORTANT: These category-to-hex mappings are project-specific and may CONTRADICT common color intuition. Map by the category labels above, NOT by general color associations (e.g., do not assume red=problem, green=good results, or orange=warning — read each entry)."),
  ].join("\n");
}

function stringSchema(description: string): { [key: string]: unknown } {
  return { type: "string", description };
}

function numberSchema(description: string): { [key: string]: unknown } {
  return { type: "number", description };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function currentItemID(options: ToolFactoryOptions): number | null {
  return options.itemID;
}

interface PreviousContextCandidate {
  turn: number;
  sourceKind?: string;
  sourceID?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  passage: {
    text: string;
    score: number;
    start: number;
    end: number;
  };
}

function createPreviousContextTool(
  options: ToolFactoryOptions,
  policy: ContextPolicy,
): AgentTool {
  return {
    name: "chat_get_previous_context",
    description:
      promptText("读取此前已附加到本次对话历史的片段。上下文账本显示可用的先前来源/范围元数据，模型希望复用而非再次查询 Zotero/arXiv 时使用。仅返回本地保留片段，不读取实时 PDF、不获取 URL，也不推断需要哪段。", "Read snippets that were already attached earlier in this chat history. Use when the context ledger shows useful prior source/range metadata and the model wants to reuse prior context instead of querying Zotero/arXiv again. This tool only returns locally retained prior snippets; it does not read the live PDF, fetch URLs, or infer which snippet is needed."),
    parameters: objectSchema({
      sourceKind: stringSchema(
        promptText("账本中的可选来源类型，例如 zotero_item 或 arxiv。", "Optional source kind from the ledger, for example zotero_item or arxiv."),
      ),
      sourceID: stringSchema(
        promptText("账本中的可选来源 ID，例如 Zotero 条目 ID 或 arXiv ID。", "Optional source ID from the ledger, for example a Zotero item ID or arXiv ID."),
      ),
      start: numberSchema(
        promptText("可选起始偏移；与 end 同时提供时仅返回重叠的先前 PDF 范围。", "Optional start offset; when provided with end, only overlapping prior PDF ranges are returned."),
      ),
      end: numberSchema(
        promptText("可选结束偏移；与 start 同时提供时仅返回重叠的先前 PDF 范围。", "Optional end offset; when provided with start, only overlapping prior PDF ranges are returned."),
      ),
      query: stringSchema(
        promptText("先前片段的可选字面文本过滤器。留空则依赖来源/范围过滤。", "Optional literal text filter for prior snippets. Leave empty to rely on source/range filters."),
      ),
      maxChars: numberSchema(
        promptText("返回先前片段的可选字符预算，执行器会限制在安全范围内。", "Optional character budget for returned prior snippets. The harness clamps this to a safe limit."),
      ),
    }),
    execute: async (args) => {
      const parsed = objectArgs(args);
      const sourceKind = stringArg(parsed, "sourceKind");
      const sourceID = stringArg(parsed, "sourceID");
      const start = numberArg(parsed, "start");
      const end = numberArg(parsed, "end");
      const query = stringArg(parsed, "query")?.toLowerCase();
      const maxChars = clamp(
        Math.floor(
          numberArg(parsed, "maxChars") ?? policy.retainedContextCharBudget,
        ),
        1000,
        policy.retainedContextCharBudget * 4,
      );
      if ((start == null) !== (end == null)) {
        return errorResult(
          "chat_get_previous_context requires both start and end when filtering by range.",
        );
      }
      const candidates = previousContextCandidates(
        options.previousMessages ?? [],
      );
      const matches = candidates.filter((candidate) => {
        if (sourceKind && candidate.sourceKind !== sourceKind) return false;
        if (sourceID && candidate.sourceID !== sourceID) return false;
        if (
          start != null &&
          end != null &&
          (candidate.passage.end <= start || candidate.passage.start >= end)
        ) {
          return false;
        }
        if (query && !candidate.passage.text.toLowerCase().includes(query)) {
          return false;
        }
        return true;
      });
      const selected = takePreviousContextWithinBudget(matches, maxChars);
      if (!selected.length) {
        return {
          output:
            "No prior retained context matched those filters. The model can choose another tool or answer from conversation history.",
          summary: "未找到可复用历史上下文",
          context: { planMode: "previous_context" },
        };
      }
      const passages = selected.map((candidate) => candidate.passage);
      const chars = passages.reduce(
        (sum, passage) => sum + passage.text.length,
        0,
      );
      const source = selected[0];
      return {
        output: [
          "[Previous chat context]",
          ...selected.map((candidate, index) =>
            [
              `#${index + 1} turn ${candidate.turn}`,
              candidate.sourceKind
                ? `Source kind: ${candidate.sourceKind}`
                : "",
              candidate.sourceID ? `Source ID: ${candidate.sourceID}` : "",
              candidate.sourceTitle
                ? `Source title: ${candidate.sourceTitle}`
                : "",
              candidate.sourceUrl ? `Source URL: ${candidate.sourceUrl}` : "",
              `Range: ${candidate.passage.start}-${candidate.passage.end}`,
              "",
              candidate.passage.text,
            ]
              .filter((line) => line !== "")
              .join("\n"),
          ),
        ].join("\n\n"),
        summary: `复用历史上下文 ${selected.length} 段 / ${chars} 字`,
        context: {
          planMode: "previous_context",
          sourceKind:
            source.sourceKind === "zotero_item" || source.sourceKind === "arxiv"
              ? source.sourceKind
              : undefined,
          sourceID: source.sourceID,
          sourceTitle: source.sourceTitle,
          sourceUrl: source.sourceUrl,
          retrievedPassages: passages,
        },
      };
    },
  };
}

function previousContextCandidates(
  messages: Message[],
): PreviousContextCandidate[] {
  const candidates: PreviousContextCandidate[] = [];
  const seen = new Set<string>();
  messages.forEach((message, index) => {
    if (
      message.role !== "user" ||
      !message.context?.retrievedPassages?.length
    ) {
      return;
    }
    for (const passage of message.context.retrievedPassages) {
      const key = [
        message.context.sourceKind ?? "",
        message.context.sourceID ?? "",
        passage.start,
        passage.end,
        passage.text,
      ].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        turn: index + 1,
        sourceKind: message.context.sourceKind,
        sourceID: message.context.sourceID,
        sourceTitle: message.context.sourceTitle,
        sourceUrl: message.context.sourceUrl,
        passage,
      });
    }
  });
  return candidates;
}

function takePreviousContextWithinBudget(
  candidates: PreviousContextCandidate[],
  maxChars: number,
): PreviousContextCandidate[] {
  const selected: PreviousContextCandidate[] = [];
  let remaining = maxChars;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    if (candidate.passage.text.length <= remaining) {
      selected.push(candidate);
      remaining -= candidate.passage.text.length;
      continue;
    }
    if (!selected.length) {
      selected.push({
        ...candidate,
        passage: {
          ...candidate.passage,
          text: candidate.passage.text.slice(0, remaining),
          end: candidate.passage.start + remaining,
        },
      });
    }
    break;
  }
  return selected;
}

async function zoteroSourceContext(
  options: ToolFactoryOptions,
  itemID: number,
): Promise<Pick<MessageContext, "sourceKind" | "sourceID" | "sourceTitle">> {
  try {
    const metadata = await options.source.getItem(itemID);
    return zoteroSourceFromMetadata(itemID, metadata ?? undefined);
  } catch {
    return zoteroSourceFromMetadata(itemID);
  }
}

function zoteroSourceFromMetadata(
  itemID: number,
  metadata?: ItemMetadata | null,
): Pick<MessageContext, "sourceKind" | "sourceID" | "sourceTitle"> {
  return {
    sourceKind: "zotero_item",
    sourceID: String(itemID),
    ...(metadata?.title ? { sourceTitle: metadata.title } : {}),
  };
}

function errorResult(output: string): ToolExecutionResult {
  return { output, summary: output, isError: true };
}

function overviewPhaseArg(value: unknown): OverviewPhase | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "motivation" || v === "动机" || v === "背景") return "motivation";
  if (v === "method" || v === "方法") return "method";
  if (v === "validation" || v === "验证" || v === "实验" || v === "结论")
    return "validation";
  return undefined;
}

function overviewEmphasisArg(value: unknown): OverviewEmphasis | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "innovation" || v === "创新" || v === "贡献") return "innovation";
  if (v === "result" || v === "效果" || v === "结果" || v === "sota")
    return "result";
  if (v === "background" || v === "背景" || v === "相关工作")
    return "background";
  if (v === "normal" || v === "普通") return "normal";
  return undefined;
}

// Display-only fallback so the phased grouping always renders even when the
// model omits `phase`. Normalizes the model's own output for layout; it is NOT
// user-intent routing.
function inferPhaseFromTitle(title: string): OverviewPhase {
  const t = title.toLowerCase();
  if (/introduction|related work|background|motivation|preliminar/.test(t)) {
    return "motivation";
  }
  if (
    /experiment|evaluation|result|conclusion|discussion|future|ablation/.test(t)
  ) {
    return "validation";
  }
  return "method";
}

// Validate + normalize a model-supplied flowchart into MindmapData. Drops
// malformed nodes/edges and edges that reference unknown node ids, so the
// renderer always receives a consistent graph.
function normalizeOverviewFlowchart(raw: unknown): MindmapData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { rankdir?: unknown; nodes?: unknown; edges?: unknown };
  const nodes: MindmapNode[] = Array.isArray(r.nodes)
    ? r.nodes
        .filter(
          (n): n is Record<string, unknown> =>
            !!n &&
            typeof n === "object" &&
            typeof (n as { id?: unknown }).id === "string" &&
            typeof (n as { label?: unknown }).label === "string",
        )
        .map((n) => ({
          id: n.id as string,
          label: n.label as string,
          type: (["root", "section", "point", "result", "innovation"].includes(
            n.type as string,
          )
            ? (n.type as string)
            : "point") as MindmapNode["type"],
          ...(typeof n.sectionNo === "string"
            ? { sectionNo: n.sectionNo as string }
            : {}),
        }))
    : [];
  if (!nodes.length) return undefined;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(r.edges)
    ? r.edges
        .filter(
          (e): e is Record<string, unknown> =>
            !!e &&
            typeof e === "object" &&
            ids.has((e as { source?: unknown }).source as string) &&
            ids.has((e as { target?: unknown }).target as string),
        )
        .map((e) => ({
          source: e.source as string,
          target: e.target as string,
          ...(typeof e.label === "string" && e.label
            ? { label: e.label as string }
            : {}),
        }))
    : [];
  return {
    nodes,
    edges,
    rankdir: r.rankdir === "TB" ? "TB" : r.rankdir === "LR" ? "LR" : "TB",
  };
}

// `zotero_append_to_note` — model-driven equivalent of the user's "写入笔记"
// button. Calls into the same `appendAssistantContentToItemNote` path the
// button uses, so behavior (auto-create child note, Better Notes preference,
// HTML conversion) stays identical and any future change to the button
// flows to the model automatically.
//
// IMPORTANT — DESCRIPTION CONTRASTS WITH PDF ANNOTATION TOOLS: the model
// has TWO write surfaces and they target completely different Zotero
// objects (rich-text child note vs. PDF annotation item). The negative
// guidance "NOT for PDF highlights" is the cheapest way to prevent
// mis-routing — observed in user testing where the model conflated the
// two and offered to use `zotero_annotate_passage` for note writes.
function createAppendToChildNoteTool(options: ToolFactoryOptions): AgentTool {
  return {
    name: "zotero_append_to_note",
    description:
      promptText("将 Markdown 内容追加到当前 Zotero 条目的富文本子笔记，与用户点击“写入笔记”按钮写入的是同一笔记。尚无子笔记时自动创建。仅在用户明确要求写入、保存、添加或追加到笔记时使用，例如“写到笔记里”“加到 MD 笔记”“save this to my note”。不要用于 PDF 高亮或注释；应改用 zotero_annotate_passage（段落高亮+评论）或 zotero_add_annotation_to_selection（选区评论）。这是写入工具，除非启用 YOLO 模式，否则需要审批。", "Append the given Markdown content to the rich-text child note for the current Zotero item — " +
      "the same note the user's '写入笔记' (Save to Note) button writes to. " +
      "If the current item has no child note yet, one is created automatically. " +
      "Use when the user explicitly asks to write/save/add/append content to their note " +
      "(e.g. '写到笔记里', '加到 MD 笔记', 'save this to my note'). " +
      "DO NOT use this for PDF highlights or PDF annotations — for those use " +
      "`zotero_annotate_passage` (passage highlight + comment) or " +
      "`zotero_add_annotation_to_selection` (selection-based comment) instead. " +
      "This is a write tool and requires approval unless YOLO mode is enabled."),
    requiresApproval: true,
    parameters: objectSchema(
      {
        content: stringSchema(
          promptText("待追加的 Markdown 内容，将转为 Zotero 笔记 HTML（已安装 Better Notes 时使用它，否则用内置转换器）。可包含标题、列表和代码块。公式使用 $...$（行内）或 $$...$$（独立行）包裹 LaTeX 源码，例如 $\\mathbb{E}_{x}[f(x)]$。也接受并规范化 \\(...\\) 与 \\[...\\]。不要预先将公式转换为 Unicode（例如公式中不要用 θ 替代 \\theta）；保留 LaTeX 源码以便笔记排版。", "Markdown content to append. Will be converted to Zotero note HTML " +
            "(via Better Notes if installed, otherwise a built-in converter). " +
            "Include headings, lists, code blocks as needed. " +
            "For math: write LaTeX source wrapped in $...$ (inline) or $$...$$ (display); " +
            "e.g. $\\mathbb{E}_{x}[f(x)]$. \\(...\\) and \\[...\\] are also accepted and " +
            "will be normalized. Do NOT pre-render math to Unicode (e.g. don't write 'θ' " +
            "for \\theta inside math) — keep it as LaTeX source so the note can typeset it."),
        ),
      },
      ["content"],
    ),
    execute: async (args) => {
      if (!options.appendToChildNote) {
        return errorResult(
          "Note write is unavailable in this context (no UI callback registered).",
        );
      }
      if (options.itemID == null) {
        return errorResult(
          "No Zotero item is currently selected; cannot resolve a child note.",
        );
      }
      const parsed = objectArgs(args);
      const content = stringArg(parsed, "content").trim();
      if (!content) {
        return errorResult(
          "zotero_append_to_note requires non-empty `content`.",
        );
      }
      try {
        const result = await options.appendToChildNote(content);
        return {
          output: [
            "[Appended to Zotero child note]",
            `Note item ID: ${result.noteID}`,
            `Created new note: ${result.created ? "yes" : "no"}`,
            `Used Better Notes: ${result.usedBetterNotes ? "yes" : "no"}`,
            `Appended ${content.length} chars of Markdown.`,
          ].join("\n"),
          summary: result.created
            ? `已新建笔记并写入 ${content.length} 字`
            : `已追加 ${content.length} 字到笔记 #${result.noteID}`,
          context: { planMode: "note_write" },
        };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to write to Zotero child note: ${detail}`);
      }
    },
  };
}

function createDrawMindmapTool(options: ToolFactoryOptions): AgentTool {
  return {
    name: "draw_article_mindmap",
    description:
      promptText("渲染展示文章主旨、结构、论证和要点的可视化流程图（思维导图/流程图/结构图）。用户要求思维导图、流程图、结构图、脉络图、mindmap、flowchart 或文章结构总览时调用。提供 nodes（每项 id、label、type: root|section|point）和 edges（source→target）。root 表示中心主旨，section 表示主要论点或章节，point 表示支撑细节。", "Render a visual flowchart (思维导图 / 流程图 / 结构图) showing the article's main thesis, structure, arguments, and key points. Call this when the user asks for 思维导图, 流程图, 结构图, 脉络图, mindmap, flowchart, or a visual overview of the article structure. Supply 'nodes' (each with id, label, and type: root|section|point) and 'edges' (source→target). Use type='root' for the central thesis, 'section' for major arguments or chapters, 'point' for supporting details."),
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            promptText("可选图标题，通常为文章或论文标题。", "Optional chart title, usually the article or paper title."),
        },
        nodes: {
          type: "array",
          description:
            promptText("图节点，每个节点含 id、展示标签和可选 type。", "Graph nodes. Each node has an id, a display label, and an optional type."),
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: promptText("唯一节点标识。", "Unique node identifier.") },
              label: {
                type: "string",
                description: promptText("展示标签（≤30 字符）。", "Display label (≤30 chars)."),
              },
              type: {
                type: "string",
                enum: ["root", "section", "point"],
                description:
                  promptText("root：中心主旨；section：主要论点/章节；point：细节。", "root: central thesis; section: major argument/chapter; point: detail."),
              },
            },
            required: ["id", "label"],
          },
        },
        edges: {
          type: "array",
          description: promptText("连接节点的有向边。", "Directed edges connecting nodes."),
          items: {
            type: "object",
            properties: {
              source: { type: "string", description: promptText("源节点 ID。", "Source node id.") },
              target: { type: "string", description: promptText("目标节点 ID。", "Target node id.") },
            },
            required: ["source", "target"],
          },
        },
      },
      required: ["nodes", "edges"],
    },
    execute: async (args) => {
      const parsed = objectArgs(args);
      const rawNodes = parsed.nodes;
      const rawEdges = parsed.edges;
      if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
        return errorResult(
          "draw_article_mindmap requires 'nodes' and 'edges' arrays.",
        );
      }
      const nodes = rawNodes
        .filter(
          (n): n is Record<string, unknown> =>
            n &&
            typeof n === "object" &&
            typeof n.id === "string" &&
            typeof n.label === "string",
        )
        .map((n) => ({
          id: n.id as string,
          label: n.label as string,
          type: (["root", "section", "point"].includes(n.type as string)
            ? n.type
            : "point") as "root" | "section" | "point",
        }));
      const edges = rawEdges
        .filter(
          (e): e is Record<string, unknown> =>
            e &&
            typeof e === "object" &&
            typeof e.source === "string" &&
            typeof e.target === "string",
        )
        .map((e) => ({
          source: e.source as string,
          target: e.target as string,
        }));
      if (nodes.length === 0) {
        return errorResult("draw_article_mindmap requires at least one node.");
      }
      const title = typeof parsed.title === "string" ? parsed.title : undefined;
      const data: MindmapData = { title, nodes, edges };
      options.onMindmapReady?.(data);
      return {
        output: `[Mindmap rendered: ${nodes.length} nodes, ${edges.length} edges]`,
        summary: `生成结构图 ${nodes.length} 个节点`,
        context: { planMode: "mindmap" },
      };
    },
  };
}

function objectArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === "object"
    ? (args as Record<string, unknown>)
    : {};
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function annotationTypeArg(
  args: Record<string, unknown>,
): "highlight" | "underline" | undefined {
  const value = stringArg(args, "type");
  if (value === "highlight" || value === "underline") return value;
  return undefined;
}

function textAnnotationPlacementArg(
  args: Record<string, unknown>,
): "below" | "above" | "over" {
  const value = stringArg(args, "placement");
  if (value === "above" || value === "over") return value;
  return "below";
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export async function saveTextAnnotationNearSelection(
  draft: SelectionAnnotationDraft,
  patch: {
    comment: string;
    color?: string;
    fontSize?: number;
    placement?: "below" | "above" | "over";
  },
  reader?: unknown | null,
): Promise<{ id: number; key?: string; pending?: boolean }> {
  const Z = getZoteroAnnotationAPI();
  const attachment = await Z.Items.getAsync(draft.attachmentID);
  if (!attachment)
    throw new Error("Selected PDF attachment is no longer available.");

  const json = textAnnotationJSONFromSelection(draft, patch, Z);
  const key = stringValue(json.key) || stringValue(json.id);
  debugAgentTool("text-annotation.save.start", {
    attachmentID: draft.attachmentID,
    pageLabel: json.pageLabel,
    sortIndex: json.sortIndex,
    commentChars: patch.comment.length,
    rects: textAnnotationRectCount(json),
  });

  // Single-path strategy: write straight through chrome saveFromJSON. Zotero's
  // notify pipeline forwards the new annotation to any open Reader for this
  // attachment, which renders the text box itself — we don't go through
  // Reader._annotationManager.addAnnotation. WHY: doing both produces
  // double-rendering and, more importantly, a save failure inside the Reader
  // pipeline drops the Reader into read-only state, blocking subsequent text
  // annotations until the PDF is reopened. saveFromJSON is unaffected by that
  // UI-level read-only flag — it only requires attachment.isEditable() — so
  // skipping the Reader path makes the operation idempotent and recoverable.
  const item = await runSaveFromJSON(Z, attachment, json, key);
  debugAgentTool("text-annotation.save.direct.ok", { itemID: item.id });

  // Best-effort UI niceties on whatever Reader is currently showing this
  // attachment: clear any stale read-only flag left by a previous failed save,
  // and select the new annotation so it's visually highlighted. Both are
  // strictly cosmetic — failures here MUST NOT mask the successful DB write.
  const targetReader = reader ?? findOpenReaderForAttachment(attachment.id);
  if (targetReader) {
    nudgeReaderAfterSave(targetReader, attachment, key);
  }

  return { id: item.id };
}

// Attempts the chrome-side save through multiple compartment-crossing
// strategies, in order of "most isolated from addon-sandbox quirks" first.
// We log whichever step throws so the Zotero debug log pinpoints exactly
// where the "Permission denied to pass object to privileged code" is
// happening — this used to be opaque because every prior strategy swallowed
// the error and silently fell through.
async function runSaveFromJSON(
  fallbackZ: ZoteroAnnotationAPI,
  attachment: ZoteroAnnotationItem,
  json: Record<string, unknown>,
  key: string,
): Promise<ZoteroAnnotationItem> {
  const chromeWin = zoteroMainWindowForClone() as any;
  const jsonString = JSON.stringify(json);

  debugAgentTool("text-annotation.save.attempt", {
    hasChromeWin: !!chromeWin,
    hasChromeJSON: !!chromeWin?.JSON,
    hasChromeZotero: !!chromeWin?.Zotero?.Annotations?.saveFromJSON,
    hasGlobalComponents:
      typeof (globalThis as any).Components?.utils?.cloneInto === "function",
    hasChromeComponents:
      typeof chromeWin?.Components?.utils?.cloneInto === "function",
  });

  // Strategy A: invoke chrome window's saveFromJSON with chrome-window-parsed
  // JSON. Every object in the call lives in the chrome compartment, so no
  // cross-compartment wrapping happens. This is the most robust path.
  const chromeSave = chromeWin?.Zotero?.Annotations?.saveFromJSON;
  if (
    typeof chromeSave === "function" &&
    typeof chromeWin?.JSON?.parse === "function"
  ) {
    try {
      const chromeJSON = chromeWin.JSON.parse(jsonString);
      const result = await chromeSave.call(
        chromeWin.Zotero.Annotations,
        attachment,
        chromeJSON,
      );
      debugAgentTool("text-annotation.save.A.chrome-window.ok", {
        itemID: result?.id,
      });
      return result as ZoteroAnnotationItem;
    } catch (err) {
      debugAgentTool("text-annotation.save.A.chrome-window.failed", {
        error: errorMessage(err),
      });
    }
  }

  // Strategy B: addon-scope saveFromJSON with explicit Components.utils.cloneInto
  // into chrome. Use chrome window's Cu (more reliable than addon's globalThis).
  const Cu =
    chromeWin?.Components?.utils ?? (globalThis as any).Components?.utils;
  if (Cu?.cloneInto && chromeWin) {
    try {
      const plain = JSON.parse(jsonString);
      const cloned = Cu.cloneInto(plain, chromeWin);
      const result = await fallbackZ.Annotations.saveFromJSON(
        attachment,
        cloned,
      );
      debugAgentTool("text-annotation.save.B.cu-cloneInto.ok", {
        itemID: result?.id,
      });
      return result;
    } catch (err) {
      debugAgentTool("text-annotation.save.B.cu-cloneInto.failed", {
        error: errorMessage(err),
      });
    }
  }

  // Strategy C: bare addon-scope path. If we got here, neither cross-scope
  // method worked — saveFromJSON likely throws "Permission denied" again, but
  // we attempt one more time so the Notifier observation can rescue it.
  try {
    const plain = JSON.parse(jsonString);
    const result = await fallbackZ.Annotations.saveFromJSON(attachment, plain);
    debugAgentTool("text-annotation.save.C.bare.ok", { itemID: result?.id });
    return result;
  } catch (err) {
    debugAgentTool("text-annotation.save.C.bare.failed", {
      error: errorMessage(err),
    });
    // Race-condition safety net: occasionally Zotero writes the item to DB
    // before the cross-compartment promise rejects cleanly. Poll for the key.
    const observed = key
      ? await waitForSavedAnnotationItem(attachment, key, 250).catch(() => null)
      : null;
    if (observed) {
      debugAgentTool("text-annotation.save.observed-after-failure", {
        itemID: observed.id,
        key,
      });
      return observed;
    }
    throw err;
  }
}

function nudgeReaderAfterSave(
  reader: unknown,
  attachment: ZoteroAnnotationItem,
  key: string,
): void {
  if (readerAttachmentIDForTool(reader) !== attachment.id) return;
  const internalReader = internalReaderForTool(reader);
  if (!internalReader) return;

  if (attachmentLooksEditable(attachment)) {
    clearStaleReaderReadOnly(internalReader);
  }
  if (!key || typeof internalReader.setSelectedAnnotations !== "function") {
    return;
  }
  try {
    const iframeWindow = readerIframeWindowForTool(reader);
    internalReader.setSelectedAnnotations(
      clonePlainJSONForTargetScope([key], iframeWindow),
      true,
    );
  } catch (err) {
    debugAgentTool("text-annotation.reader.select-failed", {
      error: errorMessage(err),
    });
  }
}

function clearStaleReaderReadOnly(internalReader: any): void {
  const manager = internalReader?._annotationManager;
  const isReadOnly = !!(manager?._readOnly || internalReader?._state?.readOnly);
  if (!isReadOnly) return;
  debugAgentTool("text-annotation.reader.clear-readonly", {});
  try {
    if (typeof internalReader.setReadOnly === "function") {
      internalReader.setReadOnly(false);
    }
  } catch {}
  try {
    if (typeof manager?.setReadOnly === "function") {
      manager.setReadOnly(false);
    } else if (manager && "_readOnly" in manager) {
      manager._readOnly = false;
    }
  } catch {}
}

function attachmentLooksEditable(attachment: ZoteroAnnotationItem): boolean {
  try {
    const candidate = attachment as ZoteroAnnotationItem & {
      isEditable?: () => boolean;
      deleted?: boolean;
      parentItem?: { deleted?: boolean };
    };
    if (candidate.deleted || candidate.parentItem?.deleted) return false;
    return typeof candidate.isEditable === "function"
      ? candidate.isEditable()
      : true;
  } catch {
    return false;
  }
}

function textAnnotationSavedLine(saved: { id: number }): string {
  return `Annotation item ID: ${saved.id}`;
}

function clonePlainJSONForTargetScope<T>(value: T, targetScope?: unknown): T {
  const plain = JSON.parse(JSON.stringify(value)) as T;
  const targetJSON = (targetScope as { JSON?: JSON } | null)?.JSON;
  if (typeof targetJSON?.parse === "function") {
    try {
      return targetJSON.parse(JSON.stringify(plain)) as T;
    } catch {}
  }
  return cloneForTargetScope(plain, targetScope);
}

async function waitForSavedAnnotationItem(
  attachment: ZoteroAnnotationItem,
  key: string,
  timeoutMs = 5000,
): Promise<ZoteroAnnotationItem | null> {
  const Z = getZoteroAnnotationAPI();
  if (
    typeof attachment.libraryID !== "number" ||
    typeof Z.Items.getByLibraryAndKey !== "function"
  ) {
    return null;
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const item = Z.Items.getByLibraryAndKey(attachment.libraryID, key);
    if (item && typeof item.id === "number") return item;
    await delay(80);
  }
  return null;
}

function internalReaderForTool(reader: unknown): any {
  try {
    const r = reader as any;
    return (
      r?._internalReader ??
      r?._iframeWindow?.wrappedJSObject?._reader ??
      r?._iframeWindow?._reader ??
      null
    );
  } catch (err) {
    debugAgentTool("text-annotation.reader.internal-reader-failed", {
      error: errorMessage(err),
    });
    return null;
  }
}

function readerAttachmentIDForTool(reader: unknown): number | null {
  try {
    const r = reader as any;
    const id = r?._item?.id ?? r?.itemID;
    return typeof id === "number" && Number.isFinite(id) ? id : null;
  } catch (err) {
    debugAgentTool("text-annotation.reader.attachment-id-failed", {
      error: errorMessage(err),
    });
    return null;
  }
}

function findOpenReaderForAttachment(attachmentID: number): unknown | null {
  try {
    const Z = (globalThis as any).Zotero;
    const readers = Array.isArray(Z?.Reader?._readers) ? Z.Reader._readers : [];
    return (
      readers.find(
        (reader: unknown) => readerAttachmentIDForTool(reader) === attachmentID,
      ) ?? null
    );
  } catch {
    return null;
  }
}

function readerIframeWindowForTool(reader: unknown): unknown {
  try {
    const r = reader as any;
    const internal = internalReaderForTool(reader);
    return (
      r?._iframeWindow ??
      internal?._iframeWindow ??
      internal?._primaryView?._iframeWindow ??
      internal?._secondaryView?._iframeWindow ??
      null
    );
  } catch (err) {
    debugAgentTool("text-annotation.reader.iframe-window-failed", {
      error: errorMessage(err),
    });
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textAnnotationJSONFromSelection(
  draft: SelectionAnnotationDraft,
  patch: {
    comment: string;
    color?: string;
    fontSize?: number;
    placement?: "below" | "above" | "over";
  },
  Z: ZoteroAnnotationAPI,
): Record<string, unknown> {
  const base = draft.annotation;
  const basePosition = base.position;
  if (!basePosition || typeof basePosition !== "object") {
    throw new Error(
      "Selected PDF text does not include Zotero annotation position data.",
    );
  }
  const anchor = textAnnotationAnchor(basePosition);
  if (!anchor) {
    throw new Error("Selected PDF text does not include usable rect data.");
  }

  const key = Z.DataObjectUtilities.generateKey();
  const fontSize = clampTextAnnotationFontSize(patch.fontSize);
  const rect = textAnnotationRect(
    anchor.rect,
    patch.comment,
    fontSize,
    patch.placement,
  );
  return {
    id: key,
    key,
    type: "text",
    text: "",
    comment: patch.comment,
    color:
      patch.color || stringValue(base.color) || Z.Annotations.DEFAULT_COLOR,
    pageLabel: stringValue(base.pageLabel) || String(anchor.pageIndex + 1),
    sortIndex:
      stringValue(base.sortIndex) || fallbackSortIndex(anchor.pageIndex, rect),
    position: {
      pageIndex: anchor.pageIndex,
      fontSize,
      rotation: 0,
      rects: [rect],
    },
  };
}

function textAnnotationAnchor(
  position: object,
): { pageIndex: number; rect: [number, number, number, number] } | null {
  const pageIndex = numberValue(
    (position as { pageIndex?: unknown }).pageIndex,
  );
  const rects = (position as { rects?: unknown }).rects;
  if (pageIndex == null || !Array.isArray(rects)) return null;
  const usable = rects.flatMap((rect) => {
    if (!Array.isArray(rect) || rect.length < 4) return [];
    const values = rect.slice(0, 4).map(numberValue);
    return values.every((value) => value != null)
      ? [values as [number, number, number, number]]
      : [];
  });
  if (!usable.length) return null;
  return { pageIndex, rect: boundingRect(usable) };
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundingRect(
  rects: Array<[number, number, number, number]>,
): [number, number, number, number] {
  return [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3])),
  ];
}

function clampTextAnnotationFontSize(value: number | undefined): number {
  return clamp(Math.round(value ?? 14), 8, 48);
}

function textAnnotationRect(
  anchor: [number, number, number, number],
  comment: string,
  fontSize: number,
  placement: "below" | "above" | "over" = "below",
): [number, number, number, number] {
  const anchorWidth = Math.max(fontSize * 6, anchor[2] - anchor[0]);
  const width = Math.min(
    Math.max(
      anchorWidth,
      fontSize * Math.min(18, Math.max(4, comment.length)) * 0.62,
    ),
    fontSize * 28,
  );
  const lines = Math.max(
    1,
    Math.ceil((comment.length * fontSize * 0.62) / width),
  );
  const height = Math.max(fontSize * 1.4, lines * fontSize * 1.25);
  const gap = fontSize * 0.55;
  const left = anchor[0];
  const top =
    placement === "above"
      ? anchor[1] - height - gap
      : placement === "over"
        ? anchor[1]
        : anchor[3] + gap;
  return [left, top, left + width, top + height];
}

function fallbackSortIndex(
  pageIndex: number,
  rect: [number, number, number, number],
): string {
  return [
    String(Math.max(0, pageIndex)).padStart(5, "0"),
    "000000",
    String(Math.max(0, Math.round(rect[3]))).padStart(5, "0"),
  ].join("|");
}

// Find an existing highlight/underline annotation that substantially overlaps
// the given sentence rects on the same page. Used by immersive mode to surface a
// sentence's saved comment on click and to dedupe 💾 (update vs. new). Returns
// the best (largest-coverage) match, or null. Read-only; never mutates.
export async function findSentenceAnnotation(
  attachmentID: number,
  pageIndex: number,
  rects: number[][],
): Promise<ExistingSentenceAnnotation | null> {
  const Z = getZoteroAnnotationAPI();
  const attachment = await Z.Items.getAsync(attachmentID);
  if (!attachment || typeof attachment.getAnnotations !== "function") {
    return null;
  }
  const sentenceRects = rects.filter((r) => Array.isArray(r) && r.length >= 4);
  if (!sentenceRects.length) return null;
  let best: {
    ann: ZoteroAnnotationItem;
    ratio: number;
    rects: number[][];
  } | null = null;
  for (const ann of attachment.getAnnotations(false)) {
    const type = stringValue(ann.annotationType);
    if (type !== "highlight" && type !== "underline") continue;
    const parsed = parseAnnotationPosition(ann.annotationPosition);
    if (!parsed || parsed.pageIndex !== pageIndex) continue;
    // Coverage = how much of the sentence the annotation's rects cover. ≥ 0.5
    // catches our own full-sentence highlights (≈ 1) and substantial manual
    // ones, without false-matching a different sentence that merely shares a
    // bounding box.
    const ratio = rectCoverageRatio(sentenceRects, parsed.rects);
    if (ratio < 0.5) continue;
    if (!best || ratio > best.ratio) {
      best = { ann, ratio, rects: parsed.rects };
    }
  }
  if (!best) return null;
  const type = stringValue(best.ann.annotationType);
  return {
    key: stringValue(best.ann.key),
    comment: stringValue(best.ann.annotationComment),
    text: stringValue(best.ann.annotationText),
    type: type === "underline" ? "underline" : "highlight",
    color: stringValue(best.ann.annotationColor),
    pageLabel: stringValue(best.ann.annotationPageLabel),
    sortIndex: stringValue(best.ann.annotationSortIndex),
    pageIndex,
    rects: best.rects,
  };
}

function parseAnnotationPosition(
  position: unknown,
): { pageIndex: number; rects: number[][] } | null {
  let pos: unknown = position;
  if (typeof pos === "string") {
    try {
      pos = JSON.parse(pos);
    } catch {
      return null;
    }
  }
  if (!pos || typeof pos !== "object") return null;
  const pageIndex = numberValue((pos as { pageIndex?: unknown }).pageIndex);
  const rawRects = (pos as { rects?: unknown }).rects;
  if (pageIndex == null || !Array.isArray(rawRects)) return null;
  const rects = rawRects.filter(
    (r): r is number[] =>
      Array.isArray(r) &&
      r.length >= 4 &&
      r.slice(0, 4).every((n) => typeof n === "number" && Number.isFinite(n)),
  );
  return rects.length ? { pageIndex, rects } : null;
}

function rectArea(r: number[]): number {
  return Math.abs(r[2] - r[0]) * Math.abs(r[3] - r[1]);
}

function rectIntersectionArea(a: number[], b: number[]): number {
  const w =
    Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2])) -
    Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2]));
  const h =
    Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3])) -
    Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3]));
  return w > 0 && h > 0 ? w * h : 0;
}

// Fraction of the sentence's total rect area covered by the annotation's rects.
function rectCoverageRatio(
  sentenceRects: number[][],
  annRects: number[][],
): number {
  let area = 0;
  let inter = 0;
  for (const s of sentenceRects) {
    area += rectArea(s);
    for (const a of annRects) inter += rectIntersectionArea(s, a);
  }
  return area > 0 ? inter / area : 0;
}

export async function saveSelectionAnnotation(
  draft: SelectionAnnotationDraft,
  patch: { comment: string; color?: string; type?: "highlight" | "underline" },
): Promise<{ id: number; key: string }> {
  const Z = getZoteroAnnotationAPI();
  const attachment = await Z.Items.getAsync(draft.attachmentID);
  if (!attachment)
    throw new Error("Selected PDF attachment is no longer available.");

  const base = draft.annotation;
  const key =
    stringValue(base.key) ||
    stringValue(base.id) ||
    Z.DataObjectUtilities.generateKey();
  const position = base.position;
  if (!position || typeof position !== "object") {
    throw new Error(
      "Selected PDF text does not include Zotero annotation position data.",
    );
  }

  const json = {
    ...base,
    id: key,
    key,
    type: patch.type ?? selectedAnnotationType(base),
    text: draft.text,
    comment: patch.comment,
    color:
      patch.color || stringValue(base.color) || Z.Annotations.DEFAULT_COLOR,
    pageLabel: stringValue(base.pageLabel),
    sortIndex: stringValue(base.sortIndex),
    position,
  };

  const item = await Z.Annotations.saveFromJSON(
    attachment,
    annotationJSONForZotero(json),
  );
  // `key` is stable across create/update (saveFromJSON upserts by key), so
  // callers can remember it to update the same annotation on a later save.
  return { id: item.id, key };
}

function annotationJSONForZotero(
  json: Record<string, unknown>,
): Record<string, unknown> {
  // The payload originates in the addon sandbox. Zotero.Annotations.saveFromJSON
  // runs in the chrome window scope and reads properties privileged-side; if we
  // hand it a sandbox-scope object directly, we trigger
  // "Permission denied to pass object to privileged code".
  //
  // We can't rely on Components.utils.cloneInto here because the addon sandbox
  // sometimes can't reach a usable Components.utils, and the previous
  // cloneForTargetScope helper would *silently* no-op in that case — exactly
  // the case that was leaking sandbox objects into chrome saveFromJSON.
  // Round-tripping through the chrome window's own JSON.parse always produces
  // objects in chrome scope, no Components.utils required.
  const plain = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  return clonePlainJSONForTargetScope(plain, zoteroMainWindowForClone());
}

function cloneForTargetScope<T>(value: T, targetScope?: unknown): T {
  const cu = componentsUtilsForClone();
  if (!targetScope || typeof cu?.cloneInto !== "function") return value;
  try {
    return cu.cloneInto(value, targetScope, {
      wrapReflectors: true,
      cloneFunctions: true,
    }) as T;
  } catch {
    return value;
  }
}

function componentsUtilsForClone(): { cloneInto?: Function } | null {
  try {
    const globalUtils = (globalThis as any).Components?.utils;
    if (globalUtils) return globalUtils;
  } catch {}
  try {
    const winUtils = (zoteroMainWindowForClone() as any)?.Components?.utils;
    if (winUtils) return winUtils;
  } catch {}
  return null;
}

function zoteroMainWindowForClone(): unknown {
  try {
    const Z = (globalThis as any).Zotero;
    return typeof Z?.getMainWindow === "function" ? Z.getMainWindow() : null;
  } catch {
    return null;
  }
}

function textAnnotationRectCount(json: Record<string, unknown>): number {
  const position = json.position;
  if (!position || typeof position !== "object") return 0;
  const rects = (position as { rects?: unknown }).rects;
  return Array.isArray(rects) ? rects.length : 0;
}

function debugAgentTool(topic: string, data: Record<string, unknown>): void {
  try {
    const Z = (globalThis as any).Zotero;
    if (typeof Z?.debug === "function") {
      Z.debug(`[Zotero AI Sidebar] ${topic}: ${JSON.stringify(data)}`);
    }
  } catch {}
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function selectedAnnotationType(
  base: Record<string, unknown>,
): "highlight" | "underline" {
  const type = stringValue(base.type);
  return type === "underline" ? "underline" : "highlight";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

interface ZoteroAnnotationItem {
  id: number;
  libraryID?: number;
  key?: string;
  annotationType?: string;
  annotationComment?: string;
  annotationText?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string;
  annotationPosition?: string | object;
  getAnnotations?(includeTrashed?: boolean): ZoteroAnnotationItem[];
}

interface ZoteroAnnotationAPI {
  Items: {
    getAsync(id: number): Promise<ZoteroAnnotationItem | null>;
    getByLibraryAndKey?(
      libraryID: number,
      key: string,
    ): ZoteroAnnotationItem | false | null | undefined;
  };
  DataObjectUtilities: { generateKey(): string };
  Annotations: {
    DEFAULT_COLOR: string;
    saveFromJSON(
      attachment: ZoteroAnnotationItem,
      json: Record<string, unknown>,
      saveOptions?: Record<string, unknown>,
    ): Promise<ZoteroAnnotationItem>;
  };
}

function getZoteroAnnotationAPI(): ZoteroAnnotationAPI {
  return (globalThis as unknown as { Zotero: ZoteroAnnotationAPI }).Zotero;
}

function formatMetadata(item: ItemMetadata): string {
  const lines = [`Title: ${item.title}`];
  if (item.authors.length) lines.push(`Authors: ${item.authors.join(", ")}`);
  if (item.year) lines.push(`Year: ${item.year}`);
  if (item.tags.length) lines.push(`Tags: ${item.tags.join(", ")}`);
  if (item.abstract) lines.push(`Abstract: ${item.abstract}`);
  return lines.join("\n");
}

// Token-to-char heuristic shared with builder.ts: 1 token ≈ 4 chars.
// GOTCHA: this is a rough OAI/Anthropic English heuristic; CJK uses fewer
// chars per token, so this *over-budgets* tokens for Chinese papers (safe).
export function truncateByTokenBudget(
  text: string,
  tokenBudget: number,
): string {
  const charBudget = tokenBudget * 4;
  return text.length > charBudget ? text.slice(0, charBudget) : text;
}
