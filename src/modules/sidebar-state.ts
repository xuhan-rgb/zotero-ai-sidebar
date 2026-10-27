import { SidebarMountStateMap } from "./sidebar-mount";
import { promptText } from "../utils/prompt-locale";
// Shared foundation for the sidebar module cluster: layout constants, the core
// PanelState / WindowSidebarState types, and the module-level maps that track
// per-window / per-item sidebar state. Extracted from sidebar.ts so feature
// modules (toolbar, task queue, annotations, pdf-quote, note panel, …) can
// depend on this without importing sidebar.ts itself (which would create import
// cycles). This file holds declarations only — no behavior.
//
// NOTE: the two mutable singletons that sidebar.ts reassigns (`registered`,
// `readerSelectionHandler`) intentionally stay in sidebar.ts — ESM import
// bindings are read-only, so a reassigned `let` cannot live in a shared module.

import type { SelectionAnnotationDraft } from "../context/agent-tools";
import { DEFAULT_CONTEXT_POLICY } from "../context/policy";
import type { Message, PdfSelectionLocator } from "../providers/types";
import type { LocalUiSettings } from "../settings/local-ui-settings";
import type { UiSettings } from "../settings/ui-settings";
import type { AgentPermissionMode, ModelPreset } from "../settings/types";
import type { ChatConversation } from "../settings/chat-history";
import type { ConversationHistoryMode } from "./conversation-history";
import type { TranslateModeController } from "../translate/translate-mode";
import type { AskModeController } from "../translate/ask-mode";
import type { AssistantProgressStage } from "./assistant-progress";
import type { DraftImage } from "./composer-images";
import type { DraftMaterial } from "./composer-materials";
import type { PaperReference } from "./paper-reference";
import type { PasteBlock } from "./composer-paste";
import type {
  NoteCaretSnapshot,
  NotePointerSnapshot,
  NoteScrollSnapshot,
} from "./note-editor-restore";
import type { OverviewNavState } from "./overview-view";
import type {
  DetailedNetworkNode,
  NetworkDiagramAnalysisProgress,
  NetworkDiagramMessage,
} from "../context/network-diagram-types";

export const translateControllers = new WeakMap<
  Window,
  TranslateModeController
>();

export const askControllers = new WeakMap<Window, AskModeController>();

export const XHTML_NS = "http://www.w3.org/1999/xhtml";
export const COLUMN_ID = "zai-column";
export const SPLITTER_ID = "zai-column-splitter";
export const NOTE_COLUMN_ID = "zai-note-column";
export const NOTE_SPLITTER_ID = "zai-note-column-splitter";
export const NOTE_ROOT_ID = "zai-note-root";
export const ROOT_ID = "zai-root";
export const TOGGLE_BUTTON_ID = "zai-toggle-button";
export const FLOATING_TOGGLE_ID = "zai-floating-toggle";
export const READER_LAYOUT_PREF_KEY =
  "extensions.zotero-ai-sidebar.readerLayout";
export const contextPolicy = DEFAULT_CONTEXT_POLICY;
export const DEFAULT_AI_COLUMN_WIDTH = 380;
export const DEFAULT_NOTE_COLUMN_WIDTH = 560;
export const MIN_AI_COLUMN_WIDTH = 320;
export const MIN_NOTE_COLUMN_WIDTH = 260;
export const MAX_AI_COLUMN_WIDTH = 760;
export const MAX_NOTE_COLUMN_WIDTH = 700;
export const SELECTION_CONTEXT_RADIUS_CHARS = 2500;
export const SELECTION_CONTEXT_QUERY_CHARS = 500;
export const OPENAI_QUICK_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2",
];
// Tool guidance injected into each turn. This documents available choices;
// the model still decides which tool, if any, to call.
export function getZoteroToolManual(): string {
  return promptText(
    [
      "Zotero 工具说明：",
      "- 由模型决定调用哪个 Zotero 工具。执行器只验证参数、限制预算/权限、执行工具，并返回可见的工具轨迹。",
      "- 用 zotero_get_current_item 读取标题、作者、年份、标签和摘要。整篇总结、贡献分析或全文标注计划之前优先使用。",
      "- 用户通过 @ 附加另一篇 Zotero 论文时，本轮消息会提供其条目 ID 和标题。用 zotero_read_referenced_paper 按需读取题录、检索段落、范围或全文。区分当前论文与引用论文的证据；根据用户提示词决定对比，还是用引用论文分析当前论文。",
      "- 上下文大小选择属于模型的工具规划：根据当前问题选择题录、搜索命中、精确范围或全文，不依赖本地意图路由。",
      "- 账本包含先前来源标识、范围和工具摘要。用它区分当前 Zotero 条目与 URL 指定的远程论文，并选择所需上下文大小。",
      "- 账本显示相关片段此前已附加，而需要再次查看原文时，使用 chat_get_previous_context。它是只读对话历史工具，不获取 Zotero、arXiv 或网页内容。",
      "- 模型判断整篇当前 Zotero PDF 对阅读、总结、审阅、对比或分析必要时，使用 zotero_get_full_pdf。此前发送的全文在账本中记为来源/范围元数据，可据此选择现有历史、定向范围、新的全文或请用户重发。",
      "- 前置块若为 arXiv 章节索引，它只是目录而非正文。整篇总结/审阅/对比前先调用 zotero_get_full_pdf；特定章节用 arxiv_get_section；指定公式号如 Equation (3) / 公式3 用 arxiv_get_equation；指定图号如 Figure 3 / 图3 用 arxiv_get_figure 的 number；指定表号如 Table 2 / 表2 用 arxiv_get_table 的 number；参考文献/引用/书目用 arxiv_get_bibliography。",
      "- 用 zotero_search_pdf 获取定向概念、未知编号的图表、实验、未知编号的公式、论点、定义、章节标题和局部证据；zotero_read_pdf_range 仅扩展先前工具输出或账本中的缓存范围。",
      "- 用户询问已有 Zotero 高亮、笔记、评论、注释或阅读标记时，用 zotero_get_annotations。",
      "- 用户要求查看、输出、翻译、解释或分析当前 PDF 选区，且 [Selected PDF text] 尚未提供选区时，用 zotero_get_current_pdf_selection。此工具只读，使用与注释创建相同的 Reader 选区快照。",
      "- 用户明确要求写入 PDF 高亮/注释或全文标注时，用 zotero_get_reader_pdf_text。zotero_annotate_passage.text 必须逐字复制其输出，以便在 Reader 文本层定位。",
      "- 用户明确要求像 Zotero 的 T 工具那样在 PDF 页面放置可见文字时，用 zotero_add_text_annotation_to_selection。它创建文字框注释，而非高亮+评论。",
      "- 只有用户明确要求将笔记/评论保存到当前 PDF 选区时，才使用 zotero_add_annotation_to_selection。",
      "- 只有用户明确要求向 PDF 写入高亮/注释时，才使用 zotero_annotate_passage。普通总结重点请求不要使用写入工具，除非用户要求在 Zotero 中写入/高亮/标注。",
      "- 修改 PDF 需要审批或 YOLO 模式。若写入被阻止，说明用户必须启用 YOLO 或批准写入，不要假装 PDF 已修改。",
      "- 论文相关论点应依赖当前上下文、追问时的先前助手回答、chat_get_previous_context 或新获取的 Zotero/arXiv 工具输出。视觉问题若只有 caption/文字而没有图片，应明确说明。",
    ].join("\n"),
    [
      "Zotero tool manual:",
      "- The model, not the local UI, decides which Zotero tool to call. The local harness only validates arguments, enforces budgets/permissions, executes tools, and returns visible tool traces.",
      "- Use zotero_get_current_item for title, authors, year, tags, and abstract. Prefer it before whole-paper summaries, contribution analysis, or full-paper annotation planning.",
      "- When the user attaches another Zotero paper with @, its item ID and title appear on that user turn. Use zotero_read_referenced_paper with that ID to read its metadata, search passages, ranges, or full text as needed. Keep evidence from the current and referenced papers separate; decide from the user's prompt whether to compare them or use the reference to analyze the current paper.",
      "- Context-size selection is part of the model's tool planning: choose metadata, search hits, exact ranges, or the full PDF according to the current question instead of relying on local intent routing.",
      "- The ledger includes prior source identity, ranges, and tool summaries. Use it as structured memory to distinguish the current Zotero item from remote papers named by URLs and to choose the needed context size.",
      "- Use chat_get_previous_context when the ledger says relevant snippets were already attached in this chat and the raw text is needed again. This is a read-only chat-history tool; it does not fetch Zotero, arXiv, or web content.",
      "- Use zotero_get_full_pdf when the model decides the whole current Zotero PDF is needed for reading, summary, review, comparison, or analysis. Prior full-PDF sends appear in the ledger as source/range metadata so the model can choose between current history, targeted ranges, fresh full text, or asking the user for a resend.",
      "- If the front block is an arXiv section index, it is only a table of contents, not the paper body. For whole-paper summaries/reviews/comparisons, call zotero_get_full_pdf before answering; for a specific section, call arxiv_get_section; for a specific equation/formula number such as 'Equation (3)' or '公式3', call arxiv_get_equation; for a specific figure number such as 'Figure 3' or '图3', call arxiv_get_figure with `number`; for a specific table number such as 'Table 2' or '表2', call arxiv_get_table with `number`; for references/citations/bibliography, call arxiv_get_bibliography.",
      "- Use zotero_search_pdf for targeted concepts, figures without a known number, experiments, equations without a known number, claims, definitions, section/chapter headings, and local evidence; use zotero_read_pdf_range only to expand cache-based ranges from prior tool output or the ledger.",
      "- Use zotero_get_annotations when the user asks about existing Zotero highlights, notes, comments, annotations, or reading marks.",
      "- Use zotero_get_current_pdf_selection when the user asks to inspect, print, translate, explain, or reason about the current PDF selection and [Selected PDF text] was not already supplied. This is read-only and follows the Zotero Reader selection snapshot used by annotation creation.",
      "- Use zotero_get_reader_pdf_text when the user explicitly asks to write PDF highlights/annotations or annotate the whole paper. Copy zotero_annotate_passage.text verbatim from zotero_get_reader_pdf_text output so the passage can be located in the Reader text layer.",
      "- Use zotero_add_text_annotation_to_selection when the user explicitly asks to place visible text directly on the PDF page like Zotero's T text tool. This creates a text-box annotation, not a highlight comment.",
      "- Use zotero_add_annotation_to_selection only when the user explicitly asks to save a note/comment on the current PDF selection.",
      "- Use zotero_annotate_passage only when the user explicitly asks to write highlights/annotations into the PDF. Do not use write tools for ordinary requests like summarizing key points unless the user asks to write/highlight/annotate in Zotero.",
      "- PDF modification requires approval or YOLO mode. If a write tool is blocked, explain that the user must enable YOLO or approve the write, and do not pretend the PDF was modified.",
      "- For paper-specific claims, rely on current context, prior assistant answers when the user is asking a continuation, chat_get_previous_context, or fresh Zotero/arXiv tool outputs. If you have only caption/text and not an image, say so explicitly for visual questions.",
    ].join("\n"),
  );
}

export interface WindowSidebarState {
  column: Element;
  splitter: Element;
  mount: HTMLElement;
  noteColumn: Element;
  noteSplitter: Element;
  noteMount: HTMLElement;
  noteItemID?: number;
  nativeNoteIDs?: Map<number | null, number>;
  overviewActive?: boolean;
  fullTranslationActive?: boolean;
  fullTranslationLayout?: "parallel" | "interleaved";
  fullTranslationAbort?: AbortController;
  // Reading navigation for the overview map (在读 anchor / browse cursor / back
  // stack / lock). Session-scoped: survives view switches, resets on restart.
  overviewNav?: OverviewNavState;
  overviewNavItemKey?: string;
  networkDiagramProgress?: NetworkDiagramAnalysisProgress;
  networkDiagramMessages?: NetworkDiagramMessage[];
  networkDiagramSelectedNode?: DetailedNetworkNode;
  networkDiagramBusy?: boolean;
  networkDiagramError?: string;
  networkDiagramDraftRepositoryURL?: string;
  networkDiagramCommitSHA?: string;
  networkDiagramPaperTitle?: string;
  networkDiagramAbort?: AbortController;
  networkDiagramItemKey?: string;
  noteAutosaveTimer?: number;
  noteAutosavePromise?: Promise<void>;
  noteEditorCleanup?: () => void;
  notePointerSnapshot?: NotePointerSnapshot;
  noteCaretSnapshot?: NoteCaretSnapshot;
  noteRestoreSnapshot?: NoteScrollSnapshot;
  noteSuppressAutoFocusUntil?: number;
  noteCaretUserMovedAt?: number;
  copyHandlerCleanup?: () => void;
  selectionMenuCleanup?: () => void;
  promptShortcutCleanup?: () => void;
  initialRefreshCleanup?: () => void;
  layoutSaveTimer?: number;
  layoutCleanup?: () => void;
  lastCopySelection?: { text: string; updatedAt: number };
  toggleButton?: Element;
  floatingButton?: HTMLElement;
  floatingToggleCleanup?: () => void;
  floatingToolbar?: HTMLElement;
  collapsedDockedWidth?: number;
  selectionMonitorID?: number;
  originalItemSelected?: (...args: unknown[]) => unknown;
  patchedItemSelected?: (...args: unknown[]) => unknown;
}

export interface ReaderLayoutPrefs {
  aiOpen?: boolean;
  aiWidth?: number;
  dockedAiWidth?: number;
  messageScrollPositions?: Record<string, MessagesScrollSnapshot>;
  noteWidth?: number;
  updatedAt?: number;
}

export const windowSidebars = new WeakMap<Window, WindowSidebarState>();
export const windowRegisterRetries = new WeakMap<Window, number>();
export const mountedWindows = new Set<Window>();
export const selectedTextByItem = new Map<number, string>();
export const selectedAnnotationByItem = new Map<
  number,
  SelectionAnnotationDraft
>();
export const ignoredSelectedTextByItem = new Map<number, string>();
export const activeRouteHighlights = new Map<
  HTMLElement,
  { destroy(): void }
>();
export const readerByAttachmentID = new Map<number, unknown>();
export const pdfQuoteLocateCache = new Map<
  string,
  Promise<PdfSelectionLocator | null>
>();
export const SELECTION_MONITOR_MS = 60;
export const PDF_QUOTE_MIN_CHARS = 32;
// Two different ceilings for two different costs:
// - PDF_QUOTE_MAX_PER_RENDER bounds EAGER pre-location (reading-route notes),
//   where every quote triggers a full locate up front — kept small.
// - PDF_QUOTE_BUTTON_LIMIT bounds LAZY button decoration in a rendered
//   message, where locating only happens on click. Decorating a button is
//   cheap, so this is just a sanity bound against a pathological message.
export const PDF_QUOTE_MAX_PER_RENDER = 24;
export const PDF_QUOTE_BUTTON_LIMIT = 300;

export interface PanelState {
  itemID: number | null;
  presets: ModelPreset[];
  selectedId: string | null;
  conversations: ChatConversation[];
  activeConversationID: string;
  historyMode: ConversationHistoryMode;
  editing: boolean;
  messages: Message[];
  historyLoaded: boolean;
  sending: boolean;
  scrollToBottom?: boolean;
  focusInput?: boolean;
  networkDiagramTarget?: boolean;
  networkDiagramReturnDraft?: {
    text: string;
    selectionStart: number;
    selectionEnd: number;
  };
  networkDiagramMessagesScrollTop?: number;
  networkDiagramAutoFollowMessages?: boolean;
  draftText: string;
  draftSelectionStart: number;
  draftSelectionEnd: number;
  draftHadFocus: boolean;
  promptHistoryCursor?: number;
  messagesScrollTop: number;
  autoFollowMessages: boolean;
  skipNextDraftCapture?: boolean;
  skipNextMessagesScrollCapture?: boolean;
  activeAssistantIndex?: number;
  activeAssistantStage?: AssistantProgressStage;
  activeAssistantDetail?: string;
  agentPermissionMode: AgentPermissionMode;
  copyDebugContext: boolean;
  uiSettings: UiSettings;
  pasteBlocks: PasteBlock[];
  draftImages: DraftImage[];
  nextPasteID: number;
  // Tables and formulas picked with `@`: only their marker sits in the
  // composer until the message is sent.
  draftMaterials: DraftMaterial[];
  draftPaperReferences: PaperReference[];
  nextMaterialID: number;
  localUiSettings: LocalUiSettings;
  webAccountConfigured?: boolean;
  webAccountNotice?: string;
  // Prevent a second Web task while the first one is still preparing,
  // uploading, generating, or importing its answer.
  webPromptBusy?: boolean;
  // Once a Web task exists, bind the preparation lock to that task so a
  // stale boolean cannot keep the composer disabled after completion.
  webPromptBusyTaskID?: string;
  abort?: AbortController;
  messagesScrollLock?: MessagesScrollLock;
  activeTaskID?: string;
  activeTaskConversationID?: string;
  cancellingTaskID?: string;
  queueOpen?: boolean;
  processingQueuedTask?: boolean;
  conversationTaskRuntimes: Map<string, ConversationTaskRuntime>;
  renderRecoveryAttempts?: number;
  // Mirrors the per-item "原文" toggle (paper-cache `pinned`). New items are
  // default-on; loadPersistedMessages later applies any explicit saved off
  // state.
  paperPinned?: boolean;
  fullTextTurnMode?: "auto" | "force";
  fullTextTurnSelectionText?: string;
  turnContextSelectionPreviewOpen?: boolean;
  chatSelectionQuote?: {
    excerpt: string;
    fullReply: string;
    sourceConversationTitle: string;
    sourceAssistantOrdinal: number;
    sourceQuestionPreview: string;
  };
  chatSelectionPreviewOpen?: boolean;
  draftSaveTimer?: number;
}

export interface ConversationTaskRuntime {
  abort?: AbortController;
  activeAssistantIndex?: number;
  activeAssistantStage?: AssistantProgressStage;
  activeAssistantDetail?: string;
  activeTaskID?: string;
  cancellingTaskID?: string;
}

export interface MessagesScrollSnapshot {
  top: number;
  atBottom: boolean;
}

export interface VisualSelectionSnapshot {
  text: string;
  rectCount: number;
  source: string;
}

export interface MessagesScrollLock {
  snapshot: MessagesScrollSnapshot;
  until: number;
}

// Panel-state survival
// =====================================================================
// Each rendered sidebar mount carries a PanelState in this WeakMap. The
// mount is the GC root: when the Zotero window closes, the mount drops
// out, and the WeakMap entry goes with it (no manual cleanup needed).
//
// INVARIANT: rendering is FULL-REPLACE — `renderPanel` calls
// `mount.replaceChildren()` and rebuilds. WHY full replace (not diff):
// the sidebar is small, full replace is simpler than reconciliation, and
// it's the same pattern as Zotero's own ItemPane sub-panels. The cost
// (lost draft text + scroll position on every render) is paid by
// `capturePanelState` (saves into `state` BEFORE replace) and then
// `restoreMessagesScroll` + `restoreChatInput` (reapplied AFTER replace).
export const states = new SidebarMountStateMap<PanelState>();
