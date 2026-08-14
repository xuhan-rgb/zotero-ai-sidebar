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
export const ZOTERO_TOOL_MANUAL = [
  "Zotero tool manual:",
  "- The model, not the local UI, decides which Zotero tool to call. The local harness only validates arguments, enforces budgets/permissions, executes tools, and returns visible tool traces.",
  "- Use zotero_get_current_item for title, authors, year, tags, and abstract. Prefer it before whole-paper summaries, contribution analysis, or full-paper annotation planning.",
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
].join("\n");

export interface WindowSidebarState {
  column: Element;
  splitter: Element;
  mount: HTMLElement;
  noteColumn: Element;
  noteSplitter: Element;
  noteMount: HTMLElement;
  noteItemID?: number;
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
  selectionMonitorID?: number;
  originalItemSelected?: (...args: unknown[]) => unknown;
  patchedItemSelected?: (...args: unknown[]) => unknown;
}

export interface ReaderLayoutPrefs {
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
  promptHistoryDraft?: string;
  messagesScrollTop: number;
  autoFollowMessages: boolean;
  skipNextDraftCapture?: boolean;
  activeAssistantIndex?: number;
  activeAssistantStage?: AssistantProgressStage;
  activeAssistantDetail?: string;
  agentPermissionMode: AgentPermissionMode;
  copyDebugContext: boolean;
  uiSettings: UiSettings;
  pasteBlocks: PasteBlock[];
  draftImages: DraftImage[];
  nextPasteID: number;
  localUiSettings: LocalUiSettings;
  abort?: AbortController;
  messagesScrollLock?: MessagesScrollLock;
  activeTaskID?: string;
  cancellingTaskID?: string;
  queueOpen?: boolean;
  processingQueuedTask?: boolean;
  renderRecoveryAttempts?: number;
  // Mirrors the per-item "原文" toggle (paper-cache `pinned`). New items are
  // default-on; loadPersistedMessages later applies any explicit saved off
  // state.
  paperPinned?: boolean;
  fullTextTurnMode?: "auto" | "force";
  fullTextTurnSelectionText?: string;
  turnContextSelectionPreviewOpen?: boolean;
  draftSaveTimer?: number;
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
export const states = new WeakMap<Element, PanelState>();
