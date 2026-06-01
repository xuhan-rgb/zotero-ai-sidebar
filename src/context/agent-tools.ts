import type {
  AgentTool,
  Message,
  MindmapData,
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
import type { OutlineEntry, OverviewData } from "./overview-types";
import {
  currentItemKey,
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
        "Read metadata for the Zotero item currently selected or opened by the user. Use this before answering when title, authors, year, abstract, or tags are needed.",
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
    {
      name: "zotero_get_annotations",
      description:
        "Read Zotero PDF annotations for the current item, including highlights, comments, page labels, colors, and order. Use when the user asks about their highlights, notes, annotations, or reading marks.",
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
        "Get a cheap whole-paper skeleton (section headings, char ranges, first-line previews, figure/table anchors) WITHOUT reading the full PDF. Use this first when the user wants an overview/总揽 of the entire paper. arXiv items use the cached LaTeX section list; other PDFs use heuristic heading detection with an even-window fallback. After reading the skeleton, write a one-line gist per section and a logical flowchart, then call render_paper_overview.",
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
        "Search the current PDF full-text cache using a query written by the model. Use this for targeted evidence, follow-up questions, definitions, figures, experiments, equations, claims, section/chapter headings, or local passages. The harness returns bounded passages with character ranges so the model can decide whether to expand only a relevant section with zotero_read_pdf_range instead of reading the whole PDF. For passages that will be written back as PDF highlights, use zotero_get_reader_pdf_text instead so the copied text matches the Reader text layer.",
      parameters: objectSchema(
        {
          query: stringSchema("Search query for the current PDF full text."),
          topK: numberSchema(
            "Maximum passages to return. The harness clamps this to policy limits.",
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
        "Read an exact character range from the current PDF full-text cache. Use only when a previous cache-based tool result or ledger gives useful start/end ranges, including section/chapter ranges chosen by the model. The harness validates and caps the range. For passages that will be written back as PDF highlights, use zotero_get_reader_pdf_text instead.",
      parameters: objectSchema(
        {
          start: numberSchema(
            "Zero-based start character offset from a previous tool result.",
          ),
          end: numberSchema(
            "End character offset from a previous tool result.",
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
        "Read the current PDF full-text cache for whole-paper synthesis. Use when the model decides the entire current Zotero paper is needed and smaller tools are insufficient. Prior full-PDF sends appear in the context ledger as source/range metadata so the model can choose between current history, targeted ranges, fresh full text, or asking the user for a resend. Do not copy highlight text from this tool for zotero_annotate_passage; use zotero_get_reader_pdf_text for PDF write workflows. The harness applies a full-PDF budget cap.",
      parameters: objectSchema({}),
      execute: async () => {
        const itemID = currentItemID(options);
        if (itemID == null)
          return errorResult("No Zotero item is currently selected.");
        // Reuse a frozen copy if one exists (cache-existence check); only
        // extract when there is no usable cache.
        let text = await getFrozenFullText(itemID);
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
            getToolPdfText(options, itemID),
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
        const fullTextSource = await fullTextSourceForTool(options);
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
          summary: `读取 PDF 全文 ${text.length}/${totalChars} 字`,
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
        "List the table of contents of the current arXiv paper's cached LaTeX source as JSON: each entry is {number, level, title, label?, bodyChars}. Use this to discover what sections exist (and how big each is) BEFORE deciding to fetch one with arxiv_get_section, so you do not pull a 30 KB section when a 2 KB one suffices. Only works when the current Zotero item has a cached arXiv source — when not, fall back to the PDF tools (zotero_search_pdf / zotero_read_pdf_range / zotero_get_full_pdf).",
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
        "Fetch a figure from the current arXiv paper and attach it as an image the model can SEE in a follow-up multimodal turn. Use `number` for user requests such as 'Figure 3' / '图3' / 'Fig. 3'; `label` for a LaTeX figure label; or `name` for a figure basename, relative path, caption substring, or includegraphics substring. Raster source files (PNG/JPG/GIF/WebP) are attached directly. Vector source files (.pdf/.eps) are cropped from the active Zotero PDF Reader when possible, so keep the PDF open for best results. Only works when the current item has a cached arXiv source.",
      parameters: objectSchema({
        number: numberSchema(
          "Compiled figure number, e.g. 3 for Figure 3. Optional if label or name is provided.",
        ),
        label: stringSchema(
          "LaTeX figure label, e.g. fig:occupancy. Optional if number or name is provided.",
        ),
        name: stringSchema(
          "Figure basename, relative path, caption substring, or includegraphics substring (e.g. 'occupancy' or 'figures/occupancy.pdf'). Optional if number or label is provided.",
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
        "Return one numbered table from the current arXiv paper's cached LaTeX source by compiled table number (e.g. 2 for 'Table 2' / '表2'), LaTeX label, or caption/name substring. Use this before answering questions that mention a specific table number, because PDF pages can contain multiple floats and nearby visible content can point to the wrong table. The result includes the authoritative LaTeX table source for verification.",
      parameters: objectSchema({
        number: numberSchema(
          "Compiled table number, e.g. 2 for Table 2. Optional if label or name is provided.",
        ),
        label: stringSchema(
          "LaTeX table label, e.g. tab:main-results. Optional if number or name is provided.",
        ),
        name: stringSchema(
          "Caption substring, label substring, or table-source substring. Optional if number or label is provided.",
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
        "Return the LaTeX body of ONE section of the current arXiv paper's cached source. `section` accepts the dotted number (e.g. '3.1'), the LaTeX label (e.g. 'sec:method'), or a case-insensitive substring of the section title (e.g. 'methodology'). Prefer this over re-reading the whole paper whenever the user's question is scoped to a specific section. Only works when the current item has a cached arXiv source.",
      parameters: objectSchema(
        {
          section: stringSchema(
            "Section number ('3.1'), label ('sec:method'), or title substring ('methodology').",
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
        "Return one numbered equation from the current arXiv paper's cached LaTeX source by compiled equation number (e.g. 3 for 'Equation (3)' / '公式3') or by LaTeX label (e.g. 'eq:loss'). Use this before answering questions that mention a specific formula/equation number, because PDF-visible numbers like '(3)' are generated at compile time and are not reliable in plain section text. The result includes display math for final answers and exact LaTeX source for verification; prefer the display math unless the user asks for raw/source LaTeX.",
      parameters: objectSchema({
        number: numberSchema(
          "Compiled equation number, e.g. 3 for Equation (3). Optional if label is provided.",
        ),
        label: stringSchema(
          "LaTeX equation label, e.g. eq:mix_schedule. Optional if number is provided.",
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
        "Read the current arXiv paper's cached bibliography files. Prefer this when the user asks about references, citation keys, related works cited by the paper, or when the cleaned full LaTeX source only contains `\\bibliography{...}` without expanded entries. Returns compiled .bbl files when available; otherwise returns .bib files. Only works when the current item has a cached arXiv source.",
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
    ...createPaperTools(policy),
    createGetReaderPdfTextTool(policy, highlightSession),
    createGetCurrentPdfSelectionTool(options),
    createTextAnnotationNearSelectionTool(policy, options),
    {
      name: "zotero_add_annotation_to_selection",
      description:
        "Create a Zotero PDF `highlight` annotation (Zotero Reader toolbar tool 'Highlight Text / 高亮文本') with a comment attached to the user's current selected PDF text. Use this when the user asks for a highlight, a comment on the highlight, or a 高亮 / 高亮+评论 / 划线评论 — the result colors the selected text and attaches the comment. Do NOT use this when the user asks for a visible text BOX placed on the page (use zotero_add_text_annotation_to_selection / 新增文字 / Add Text for that). Write tool, requires approval or YOLO mode.",
      requiresApproval: true,
      parameters: objectSchema(
        {
          comment: stringSchema(
            "Annotation comment to save on the selected PDF text.",
          ),
          color: stringSchema(colorDescription),
          type: stringSchema(
            "Optional annotation type. Supported values are highlight or underline. If omitted, highlight is used.",
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
      "Read the user's current selected text in the active Zotero PDF Reader, preserving semantic paragraph/list structure when available. Use when the user asks to inspect, print, translate, explain, or reason about the current PDF selection and the selection was not already supplied in [Selected PDF text]. This is read-only and does not create annotations.",
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
      "Create a Zotero PDF `text` annotation — the Zotero Reader toolbar tool 'Add Text / 新增文字' (the T tool). This places a visible text box on the page near the user's current PDF text selection. Use this when the user asks for 新增文字 / 加文字 / 写到 PDF 上 / 文字框 / a 'text' annotation / the T tool / 'Add Text' — anything that means 'put visible text on the page', as opposed to highlighting words. The selected text is the anchor; the text box appears below (or above/over) it. This creates annotation type `text`, NOT a highlight + comment (use zotero_add_annotation_to_selection / 高亮+评论 for that). Requires a current PDF selection. Write tool, requires approval or YOLO mode.",
    requiresApproval: true,
    parameters: objectSchema(
      {
        comment: stringSchema(
          "Visible text to place on the PDF page, for example a short Chinese note.",
        ),
        color: stringSchema(
          "Optional text color, such as #ffd400. If omitted, Zotero/default annotation color is used.",
        ),
        fontSize: numberSchema(
          "Optional font size in PDF points. Defaults to 14.",
        ),
        placement: stringSchema(
          "Optional placement relative to the current selection: below, above, or over. Defaults to below.",
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
    const key = currentItemKey(options);
    if (key && (await hasArxivSource(key))) return "arxiv";
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
      "Read PDF text from the active Zotero Reader/PDF.js text layer. Use this when the user explicitly asks to write PDF highlights/annotations, because passages copied from this tool can be located by zotero_annotate_passage. Requires the PDF to be open in Zotero Reader. For ordinary summarization or non-writing analysis, use zotero_get_full_pdf instead. Optional start/end read an exact Reader-text range from a previous zotero_get_reader_pdf_text result.",
    parameters: objectSchema({
      start: numberSchema(
        "Optional zero-based start character offset from a previous Reader-text result.",
      ),
      end: numberSchema(
        "Optional end character offset from a previous Reader-text result.",
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
      "Create a Zotero PDF highlight annotation on a specific passage. Use only when the user explicitly asks to write highlights/annotations into the PDF, such as annotating the whole paper or highlighting key sentences. Before using this tool for full-text annotation, call zotero_get_current_item to read the abstract, then call zotero_get_reader_pdf_text and copy `text` verbatim from that Reader-text output. Do not copy highlight text from zotero_get_full_pdf, because that tool uses Zotero's full-text cache rather than the Reader text layer. For ordinary summaries, do not use this write tool. PDF modification requires approval or YOLO mode.",
    requiresApproval: true,
    parameters: objectSchema(
      {
        text: stringSchema(
          "Exact passage from the PDF (verbatim, no paraphrasing).",
        ),
        comment: stringSchema(
          "Reading note (≤ 80 chars Chinese), explaining why this passage is important.",
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
    "Optional Zotero annotation color, e.g. #ffd400. If omitted, the selection/default color is used.";
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
    "Optional Zotero annotation color. MUST pick a hex from the configured presets below; omit the field if no category clearly matches (do not force-fit colors).",
    "",
    ...entries,
    "",
    "IMPORTANT: These category-to-hex mappings are project-specific and may CONTRADICT common color intuition. Map by the category labels above, NOT by general color associations (e.g., do not assume red=problem, green=good results, or orange=warning — read each entry).",
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
      "Read snippets that were already attached earlier in this chat history. Use when the context ledger shows useful prior source/range metadata and the model wants to reuse prior context instead of querying Zotero/arXiv again. This tool only returns locally retained prior snippets; it does not read the live PDF, fetch URLs, or infer which snippet is needed.",
    parameters: objectSchema({
      sourceKind: stringSchema(
        "Optional source kind from the ledger, for example zotero_item or arxiv.",
      ),
      sourceID: stringSchema(
        "Optional source ID from the ledger, for example a Zotero item ID or arXiv ID.",
      ),
      start: numberSchema(
        "Optional start offset; when provided with end, only overlapping prior PDF ranges are returned.",
      ),
      end: numberSchema(
        "Optional end offset; when provided with start, only overlapping prior PDF ranges are returned.",
      ),
      query: stringSchema(
        "Optional literal text filter for prior snippets. Leave empty to rely on source/range filters.",
      ),
      maxChars: numberSchema(
        "Optional character budget for returned prior snippets. The harness clamps this to a safe limit.",
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
  return { output, summary: output };
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
      "Append the given Markdown content to the rich-text child note for the current Zotero item — " +
      "the same note the user's '写入笔记' (Save to Note) button writes to. " +
      "If the current item has no child note yet, one is created automatically. " +
      "Use when the user explicitly asks to write/save/add/append content to their note " +
      "(e.g. '写到笔记里', '加到 MD 笔记', 'save this to my note'). " +
      "DO NOT use this for PDF highlights or PDF annotations — for those use " +
      "`zotero_annotate_passage` (passage highlight + comment) or " +
      "`zotero_add_annotation_to_selection` (selection-based comment) instead. " +
      "This is a write tool and requires approval unless YOLO mode is enabled.",
    requiresApproval: true,
    parameters: objectSchema(
      {
        content: stringSchema(
          "Markdown content to append. Will be converted to Zotero note HTML " +
            "(via Better Notes if installed, otherwise a built-in converter). " +
            "Include headings, lists, code blocks as needed. " +
            "For math: write LaTeX source wrapped in $...$ (inline) or $$...$$ (display); " +
            "e.g. $\\mathbb{E}_{x}[f(x)]$. \\(...\\) and \\[...\\] are also accepted and " +
            "will be normalized. Do NOT pre-render math to Unicode (e.g. don't write 'θ' " +
            "for \\theta inside math) — keep it as LaTeX source so the note can typeset it.",
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
      "Render a visual flowchart (思维导图 / 流程图 / 结构图) showing the article's main thesis, structure, arguments, and key points. Call this when the user asks for 思维导图, 流程图, 结构图, 脉络图, mindmap, flowchart, or a visual overview of the article structure. Supply 'nodes' (each with id, label, and type: root|section|point) and 'edges' (source→target). Use type='root' for the central thesis, 'section' for major arguments or chapters, 'point' for supporting details.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Optional chart title, usually the article or paper title.",
        },
        nodes: {
          type: "array",
          description:
            "Graph nodes. Each node has an id, a display label, and an optional type.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique node identifier." },
              label: {
                type: "string",
                description: "Display label (≤30 chars).",
              },
              type: {
                type: "string",
                enum: ["root", "section", "point"],
                description:
                  "root: central thesis; section: major argument/chapter; point: detail.",
              },
            },
            required: ["id", "label"],
          },
        },
        edges: {
          type: "array",
          description: "Directed edges connecting nodes.",
          items: {
            type: "object",
            properties: {
              source: { type: "string", description: "Source node id." },
              target: { type: "string", description: "Target node id." },
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

export async function saveSelectionAnnotation(
  draft: SelectionAnnotationDraft,
  patch: { comment: string; color?: string; type?: "highlight" | "underline" },
): Promise<{ id: number }> {
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
  return { id: item.id };
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
