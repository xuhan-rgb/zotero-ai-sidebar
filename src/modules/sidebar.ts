import { buildContext } from "../context/builder";
import type { ContextSource } from "../context/builder";
import {
  createZoteroAgentToolSession,
  saveSelectionAnnotation,
  saveTextAnnotationNearSelection,
  truncateByTokenBudget,
  type SelectionAnnotationDraft,
  type ZoteroAgentToolSession,
} from "../context/agent-tools";
import { parseAnnotationSuggestion } from "../context/annotation-draft";
import {
  contextSummaryLine,
  formatContextLedger,
  formatUserMessageForApi,
  retainedContextStats,
  toApiMessages,
} from "../context/message-format";
import { DEFAULT_CONTEXT_POLICY, type ContextPolicy } from "../context/policy";
import { createPdfLocator, getSharedPdfLocator } from "../context/pdf-locator";
import { extractPdfRange, searchPdfPassages } from "../context/retrieval";
import { ensureArxivSource } from "../context/arxiv-source";
import { hasArxivSource } from "../context/arxiv-store";
import { buildArxivTocFrontBlock } from "../context/arxiv-tools";
import { toolsForPinnedFullTextTurn } from "../context/tool-filter";
import { isArxivTocBlock } from "../context/tex-sections";
import { zoteroContextSource } from "../context/zotero-source";
import { getProvider } from "../providers/factory";
import type {
  AssistantAnnotationDraft,
  ChatTaskMeta,
  Message,
  PdfSelectionLocator,
} from "../providers/types";
import { loadChatMessages, saveChatMessages } from "../settings/chat-history";
import {
  freezeFullText,
  getFrozenFullText,
  isPaperPinned,
  setPaperPinned,
} from "../settings/paper-cache";
import { loadQuickPromptSettings } from "../settings/quick-prompts";
import { loadPresets, zoteroPrefs } from "../settings/storage";
import {
  DEFAULT_LOCAL_UI_SETTINGS,
  loadLocalUiSettings,
  normalizeLocalUiSettings,
  saveLocalUiSettings,
  type LocalUiSettings,
} from "../settings/local-ui-settings";
import {
  loadToolSettings,
  saveToolSettings,
  type WebSearchMode,
} from "../settings/tool-settings";
import {
  loadUiSettings,
  type ChatProfileSettings,
  type UiSettings,
} from "../settings/ui-settings";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_SUMMARY,
  REASONING_SUMMARY_OPTIONS,
  type AgentPermissionMode,
  type ModelPreset,
  type ProviderKind,
  type ReasoningEffort,
  type ReasoningSummary,
} from "../settings/types";
import {
  expandSlashCommandMessage,
  matchingSlashCommands,
  type SlashCommand,
} from "../ui/slash-commands";
import { serializeSelectionAsMarkdown } from "../ui/selection-serialize";
import { mountSelectionPopupGuard } from "../translate/overlay";
import { TranslateModeController } from "../translate/translate-mode";
import {
  addDraftImages,
  pastedImageFiles,
  renderDraftImages,
  renderImageAttachButton,
  renderScreenshotAttachButton,
  type DraftImage,
} from "./composer-images";
import {
  assistantProgressFor,
  renderAssistantProgress,
  type AssistantProgress,
  type AssistantProgressStage,
} from "./assistant-progress";
import {
  findLastAssistantIndex,
  findPreviousUserIndex,
} from "./chat-message-index";
import {
  formatConversationMarkdown,
  messageToClipboard,
} from "./clipboard-format";
import { saveFrontBlockDebugFileOnce } from "./front-block-debug-file";
import {
  clearPendingSidebarCopy,
  copyToClipboard,
  flashButton,
  getPendingSidebarCopy,
  isProgrammaticClipboardWrite,
  setPendingSidebarCopy,
} from "./clipboard-utils";
import {
  expandPasteMarkers,
  insertPastedTextMarker,
  shouldCompactPastedText,
  type PasteBlock,
} from "./composer-paste";
import { captureDraftFromInput, clampOffset } from "./composer-state";
import {
  navigateComposerPromptHistory,
  resetComposerPromptHistory,
} from "./composer-history";
import {
  buttonEl,
  el,
  field,
  inputEl,
  repopulateSelect,
  selectEl,
} from "./dom-utils";
import {
  debugZai,
  errorMessage,
  htmlDebugInfo,
  htmlStringDebugInfo,
  rangeDebugInfo,
  textDebugInfo,
} from "./debug-utils";
import {
  firstPdfQuoteLocateCandidate,
  pdfQuoteBlockLocateText,
  pdfQuoteBlocks,
  pdfQuoteConfidenceFloor,
  pdfQuoteLinkKey,
  pdfQuoteLocateCandidates,
} from "./pdf-quote-utils";
import {
  NOTE_PDF_LOCATION_HASH_MARKER,
  NOTE_PDF_QUOTE_HASH_MARKER,
  NOTE_PDF_SELECTION_HASH_MARKER,
  noteHrefWithoutPdfData,
  pdfLocationFromNoteHref,
  pdfLocationFromNoteLink,
  pdfLocationJSONFromNoteHref,
  pdfQuoteDataFromNoteHref,
  pdfQuoteDataFromNoteLink,
  pdfQuoteFromNoteHref,
  pdfQuoteFromNoteLink,
  pdfSelectionForNoteData,
  pdfSelectionFromNoteHref,
  pdfSelectionFromNoteLink,
  pdfSelectionJSONFromNoteHref,
} from "./note-pdf-link";
import {
  READING_ROUTE_MANUAL_HEADING,
  READING_ROUTE_NOTE_TITLE,
  childNotesForItem,
  createChildNote,
  createParentForStandalonePDF,
  dedicatedNoteMarker,
  findReadingRouteNote,
  getZoteroItem,
  hasDedicatedNoteMarker,
  isAiNote,
  isReadingRouteNote,
  isZoteroNote,
  noteTitle,
  parentItemForDedicatedLookup,
  parentItemForNotes,
  resolveReadingRouteNote,
  resolveTargetNote,
} from "./note-dedicated";
import {
  editableNoteHTML,
  insertPlainTextAtSelection,
  installNoteEditorEventIsolation,
  renderEditableNoteHTML,
  restoreEditableSelectionIfLost,
  saveEditableSelection,
} from "./note-html-utils";
import { renderMarkdownInto } from "./markdown-render";
import {
  highlightReadingRouteKeyBullets,
  locateReadingRouteReference,
  readingRouteReferenceKey,
  readingRouteReferenceKindFromData,
  readingRouteReferenceLabels,
  readingRouteReferenceParts,
  type ReadingRouteReferenceKind,
  uniqueStrings,
} from "./reading-route-reference";
import { renderMindmapBlock } from "./mindmap-render";
import { renderOverviewBlock } from "./overview-view";
import { loadOverview, saveOverview } from "../context/overview-store";
import { clonePlainRecord, finiteNumber } from "./plain-utils";
import {
  agentPermissionMode,
  collapseReasoningForPreset,
  configuredPresets,
  isReasoningDisabledForDraft,
  makePreset,
  persist,
  presetSelectLabel,
  presetSignature,
  reasoningEffortLabel,
  reasoningEffortOptionsForPreset,
  reasoningEffortShortLabel,
  sanitizedTestError,
  selectedChatPreset,
  selectedPreset,
  testPresetConnectivity,
  testPresetPromptCache,
  updateSendControls,
  updateToolbarOption,
  upsertPreset,
  withAgentPermissionMode,
  withReasoningEffort,
} from "./preset-utils";
import { scrollTaskMessageIntoView } from "./task-scroll";
import {
  captureNoteCaretSnapshot,
  findActiveNoteEditor,
  installZoteroNoteCaretMemory,
  installZoteroNotePointerMemory,
  noteAutoFocusSuppressed,
  noteCaretSnapshotDebugInfo,
  noteCaretSnapshotForSidebar,
  noteEditorDebugRoots,
  noteEditorScrollRoot,
  noteElementDebugInfo,
  notePointerSnapshotForSidebar,
  noteScrollSnapshotDebugInfo,
  restoreVisibleNoteScroll,
  tryInsertHTMLAtCursor,
  type NoteCaretSnapshot,
  type NotePointerSnapshot,
  type NoteScrollSnapshot,
  type ZoteroNoteEditorElement,
} from "./note-editor-restore";

const translateControllers = new WeakMap<Window, TranslateModeController>();

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const COLUMN_ID = "zai-column";
const SPLITTER_ID = "zai-column-splitter";
const NOTE_COLUMN_ID = "zai-note-column";
const NOTE_SPLITTER_ID = "zai-note-column-splitter";
const NOTE_ROOT_ID = "zai-note-root";
const ROOT_ID = "zai-root";
const TOGGLE_BUTTON_ID = "zai-toggle-button";
const FLOATING_TOGGLE_ID = "zai-floating-toggle";
const READER_LAYOUT_PREF_KEY = "extensions.zotero-ai-sidebar.readerLayout";
const READER_TRANSLATE_GROUP_ID = "zai-reader-translate-group";
const READER_TRANSLATE_STYLE_ID = "zai-reader-translate-style";
const contextPolicy = DEFAULT_CONTEXT_POLICY;
const DEFAULT_AI_COLUMN_WIDTH = 380;
const DEFAULT_NOTE_COLUMN_WIDTH = 560;
const MIN_AI_COLUMN_WIDTH = 320;
const MIN_NOTE_COLUMN_WIDTH = 260;
const MAX_AI_COLUMN_WIDTH = 760;
const MAX_NOTE_COLUMN_WIDTH = 700;
const SELECTION_CONTEXT_RADIUS_CHARS = 2500;
const SELECTION_CONTEXT_QUERY_CHARS = 500;
const OPENAI_QUICK_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2",
];
// Tool guidance injected into each turn. This documents available choices;
// the model still decides which tool, if any, to call.
const ZOTERO_TOOL_MANUAL = [
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

let registered = false;

interface WindowSidebarState {
  column: Element;
  splitter: Element;
  mount: HTMLElement;
  noteColumn: Element;
  noteSplitter: Element;
  noteMount: HTMLElement;
  noteItemID?: number;
  overviewActive?: boolean;
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
  readerTranslateToolbarCleanup?: () => void;
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

interface ReaderLayoutPrefs {
  noteWidth?: number;
  updatedAt?: number;
}

const windowSidebars = new WeakMap<Window, WindowSidebarState>();
const windowRegisterRetries = new WeakMap<Window, number>();
const mountedWindows = new Set<Window>();
const selectedTextByItem = new Map<number, string>();
const selectedAnnotationByItem = new Map<number, SelectionAnnotationDraft>();
const ignoredSelectedTextByItem = new Map<number, string>();
const activeRouteHighlights = new Map<HTMLElement, { destroy(): void }>();
const readerByAttachmentID = new Map<number, unknown>();
const pdfQuoteLocateCache = new Map<
  string,
  Promise<PdfSelectionLocator | null>
>();
let readerSelectionHandler: ((event: unknown) => void) | null = null;
const SELECTION_MONITOR_MS = 60;
const PDF_QUOTE_MIN_CHARS = 32;
// Two different ceilings for two different costs:
// - PDF_QUOTE_MAX_PER_RENDER bounds EAGER pre-location (reading-route notes),
//   where every quote triggers a full locate up front — kept small.
// - PDF_QUOTE_BUTTON_LIMIT bounds LAZY button decoration in a rendered
//   message, where locating only happens on click. Decorating a button is
//   cheap, so this is just a sanity bound against a pathological message.
const PDF_QUOTE_MAX_PER_RENDER = 24;
const PDF_QUOTE_BUTTON_LIMIT = 300;

interface PanelState {
  itemID: number | null;
  presets: ModelPreset[];
  selectedId: string | null;
  editing: boolean;
  messages: Message[];
  historyLoaded: boolean;
  sending: boolean;
  scrollToBottom?: boolean;
  focusInput?: boolean;
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
}

interface MessagesScrollSnapshot {
  top: number;
  atBottom: boolean;
}

interface MessagesScrollLock {
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
const states = new WeakMap<Element, PanelState>();

// Entry point per Zotero item selection.
// Two paths:
//   - itemID changed (or first render): allocate fresh PanelState and
//     kick off async history load. Old state is DROPPED — switching items
//     means switching threads.
//   - same itemID: reload presets only when NOT editing, then reuse existing
//     messages/draft/scroll state. While editing, `state.presets` may contain
//     unsaved form changes; reloading prefs would resurrect the last saved
//     model list during background sidebar refreshes.
function renderMount(mount: HTMLElement, itemID: number | null) {
  let state = states.get(mount);
  if (!state || state.itemID !== itemID) {
    const presets = loadPresets(zoteroPrefs());
    state = {
      itemID,
      presets,
      selectedId: presets[0]?.id ?? null,
      editing: presets.length === 0,
      messages: [],
      historyLoaded: false,
      sending: false,
      draftText: "",
      draftSelectionStart: 0,
      draftSelectionEnd: 0,
      draftHadFocus: false,
      messagesScrollTop: 0,
      autoFollowMessages: true,
      agentPermissionMode: agentPermissionMode(presets[0]),
      copyDebugContext: false,
      uiSettings: loadUiSettings(zoteroPrefs()),
      pasteBlocks: [],
      draftImages: [],
      nextPasteID: 1,
      localUiSettings: loadLocalUiSettings(zoteroPrefs()),
      paperPinned: itemID != null,
      fullTextTurnMode: "auto",
      turnContextSelectionPreviewOpen: false,
    };
    states.set(mount, state);
    void loadPersistedMessages(mount, state);
  } else {
    if (!state.editing) {
      state.presets = loadPresets(zoteroPrefs());
    }
    if (
      state.selectedId &&
      !state.presets.find((p) => p.id === state!.selectedId)
    ) {
      state.selectedId = state.presets[0]?.id ?? null;
    }
    if (state.presets.length === 0) state.editing = true;
    state.agentPermissionMode = agentPermissionMode(
      selectedChatPreset(state) ?? selectedPreset(state),
    );
    state.uiSettings = loadUiSettings(zoteroPrefs());
    state.localUiSettings = loadLocalUiSettings(zoteroPrefs());
  }

  renderPanel(mount, state);
}

function renderPanel(mount: HTMLElement, state: PanelState) {
  const doc = mount.ownerDocument!;
  capturePanelState(mount, state);
  try {
    refreshActiveReaderSelection(doc.defaultView, state.itemID, false);
  } catch (err) {
    debugZai("sidebar.selection-refresh.failed", { error: errorMessage(err) });
  }

  let panel: HTMLElement;
  try {
    panel = el(doc, "div", "zai-app native-panel");
    panel.addEventListener("keydown", (event: KeyboardEvent) => {
      handleTaskEscape(mount, state, event);
    });
    applyChatAppearance(panel, state.uiSettings, state.localUiSettings);
    panel.append(renderToolbar(doc, mount, state));
    panel.append(renderContextCard(doc, state.itemID));
    panel.append(renderMessages(doc, mount, state));
    panel.append(renderInput(doc, mount, state));
  } catch (err) {
    debugZai("sidebar.render.failed", {
      error: errorMessage(err),
      itemID: state.itemID,
    });
    mount.replaceChildren(renderPanelRecovery(doc, mount, state, err));
    schedulePanelRecovery(mount, state);
    return;
  }

  state.renderRecoveryAttempts = 0;
  mount.replaceChildren();
  mount.append(panel);
  const shouldScroll = state.scrollToBottom;
  const shouldFocus = state.focusInput;
  state.scrollToBottom = false;
  state.focusInput = false;
  afterRender(mount, () => {
    const lockedScroll = activeMessagesScrollLock(state);
    if (lockedScroll) {
      scheduleMessagesScrollRestore(mount, lockedScroll);
    } else {
      restoreMessagesScroll(mount, state, !!shouldScroll);
    }
    restoreChatInput(mount, state, !!shouldFocus);
  });
}

function renderPanelRecovery(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  err: unknown,
): HTMLElement {
  const box = el(doc, "div", "zai-app native-panel");
  box.setAttribute(
    "style",
    [
      "box-sizing:border-box",
      "height:100%",
      "padding:14px",
      "font:13px/1.45 sans-serif",
      "background:#fbfaf7",
      "color:#24211d",
    ].join(";"),
  );
  box.append(
    el(doc, "strong", "", "AI 对话正在恢复"),
    el(doc, "div", "", "Zotero 刚加载时界面还没稳定，插件会自动重试。"),
  );
  const detail = el(doc, "div", "", errorMessage(err));
  detail.style.cssText = "margin-top:8px;color:#8a5a44;font-size:12px;";
  const retry = buttonEl(doc, "立即重试");
  retry.style.cssText = "margin-top:12px;";
  retry.addEventListener("click", () => renderPanel(mount, state));
  box.append(detail, retry);
  return box;
}

function schedulePanelRecovery(mount: HTMLElement, state: PanelState): void {
  const win = mount.ownerDocument?.defaultView;
  if (!win) return;
  const attempts = (state.renderRecoveryAttempts ?? 0) + 1;
  state.renderRecoveryAttempts = attempts;
  if (attempts > 8) return;
  const delay = Math.min(1600, 150 * attempts);
  win.setTimeout(() => {
    if (states.get(mount) === state) renderPanel(mount, state);
  }, delay);
}

function applyChatAppearance(
  panel: HTMLElement,
  settings: UiSettings,
  localSettings: LocalUiSettings,
): void {
  if (settings.chatFontFamily) {
    panel.style.setProperty("--zai-font", settings.chatFontFamily);
  } else {
    panel.style.removeProperty("--zai-font");
  }
  panel.style.setProperty(
    "--zai-chat-font-size",
    `${localSettings.chatFontSizePx}px`,
  );
}

// Captures DOM-resident state into PanelState BEFORE renderPanel wipes
// the DOM. Two pieces of survival:
//   1. Draft textarea content + selection range (so the user's typing
//      survives streaming re-renders).
//   2. Messages list scrollTop (so the auto-follow-vs-pinned-scroll
//      decision in restoreMessagesScroll has accurate state).
//
// `skipNextDraftCapture` is the one-shot flag set by sendMessage AFTER
// it clears the draft. WHY: the textarea DOM still holds the just-sent
// text on the next render (until `restoreChatInput` reapplies the empty
// state.draftText). Without this flag, capture would copy the still-
// rendered old text back into state, undoing the clear.
function capturePanelState(mount: HTMLElement, state: PanelState) {
  if (!state.skipNextDraftCapture) {
    const input = mount.querySelector(
      ".input-row textarea",
    ) as HTMLTextAreaElement | null;
    if (input) {
      captureDraftFromInput(input, state);
    }
  }
  state.skipNextDraftCapture = false;

  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (messages) {
    const lockedScroll = activeMessagesScrollLock(state);
    if (lockedScroll) {
      state.messagesScrollTop = lockedScroll.top;
      state.autoFollowMessages = lockedScroll.atBottom;
      return;
    }
    state.messagesScrollTop = messages.scrollTop;
  }
}

function renderToolbar(doc: Document, mount: HTMLElement, state: PanelState) {
  const toolbarPresets = configuredPresets(state);
  const selectedForToolbar = selectedChatPreset(state);
  const bar = el(
    doc,
    "div",
    toolbarPresets.length ? "preset-switcher" : "preset-empty",
  );
  const topRow = el(doc, "div", "preset-switcher-row preset-switcher-top");
  const bottomRow = el(
    doc,
    "div",
    "preset-switcher-row preset-switcher-bottom",
  );
  const title = el(doc, "strong", "", "AI 对话");
  topRow.append(title);

  if (toolbarPresets.length === 0) {
    topRow.append(el(doc, "span", "", "未配置模型"));
    const button = buttonEl(doc, "添加模型");
    button.addEventListener("click", () => {
      openAddonPreferences(doc);
    });
    bottomRow.append(button);
    bar.append(topRow, bottomRow);
    return bar;
  }

  const select = doc.createElement("select");
  for (const preset of toolbarPresets) {
    const option = doc.createElement("option");
    option.value = preset.id;
    option.textContent = presetSelectLabel(preset);
    select.append(option);
  }
  // Set after options exist; otherwise the browser falls back to the first item.
  select.value = selectedForToolbar?.id ?? "";
  select.addEventListener("change", () => {
    state.selectedId = select.value;
    state.agentPermissionMode = agentPermissionMode(
      selectedChatPreset(state) ?? selectedPreset(state),
    );
    renderPanel(mount, state);
  });
  topRow.append(select);

  const settings = buttonEl(doc, "设置");
  settings.addEventListener("click", () => {
    openAddonPreferences(doc);
  });
  if (state.messages.length > 0) {
    const copyAll = buttonEl(doc, "复制MD");
    copyAll.title = state.copyDebugContext
      ? "复制当前对话为 Markdown（含工具上下文和 PDF 片段）"
      : "复制当前对话为 Markdown（只含论文介绍和对话）";
    copyAll.addEventListener("click", () => {
      void (async () => {
        // Only build the system prompt when the debug toggle is on — it's an
        // async Zotero.Items.get + tool-manual assembly, not free.
        let systemPrompt: string | undefined;
        let frontBlock: string | undefined;
        if (state.copyDebugContext) {
          try {
            const built = await buildSystemContextOnly(state.itemID);
            systemPrompt = built.systemPrompt;
          } catch {
            systemPrompt = undefined;
          }
          if (
            state.itemID != null &&
            messagesContainPaperFrontBlock(state.messages)
          ) {
            frontBlock = await resolvePinnedFullText(
              state.itemID,
              zoteroContextSource,
              contextPolicy,
              { force: shouldExportWholePaperFrontBlock(state.messages) },
            );
          }
        }
        const markdown = formatConversationMarkdown(
          state,
          state.copyDebugContext,
          systemPrompt,
          frontBlock,
        );
        await copyToClipboard(
          doc,
          markdown,
          undefined,
          markdownToClipboardHTML(doc, markdown),
        );
        flashButton(copyAll, "已复制");
      })();
    });
    topRow.append(copyAll);

    const clear = buttonEl(doc, "清空");
    clear.disabled = state.sending;
    clear.title = "清空并保存当前条目的聊天记录";
    clear.addEventListener("click", () => {
      state.messages = [];
      void saveChatMessages(state.itemID, state.messages);
      renderPanel(mount, state);
    });
    topRow.append(clear);
  }
  const noteWindowOpen = isNoteWindowOpenForMount(mount);
  const openNote = buttonEl(doc, noteWindowOpen ? "关闭笔记" : "打开笔记");
  openNote.className = "open-note-button";
  openNote.title = noteWindowOpen
    ? "关闭笔记列"
    : "在当前 Zotero 窗口打开当前条目的子笔记";
  openNote.disabled = state.itemID == null;
  openNote.addEventListener("click", () => {
    if (isNoteWindowOpenForMount(mount)) {
      void closeCurrentNoteWindow(mount);
    } else {
      void openCurrentItemNote(doc, state.itemID, openNote);
    }
  });
  bottomRow.append(openNote);
  bottomRow.append(settings);
  const win = mount.ownerDocument!.defaultView!;
  const translateBtn = buttonEl(doc, "译");
  translateBtn.className = "zai-sidebar-translate-button";
  translateBtn.title = "逐句翻译模式（点击切换开关）";
  syncTranslateBtnState(win, translateBtn);
  translateBtn.addEventListener("click", () => {
    void toggleTranslateMode(win, translateBtn);
  });
  bottomRow.append(translateBtn);
  const hide = buttonEl(doc, "隐藏");
  hide.title = "隐藏 AI 对话列";
  hide.addEventListener("click", () => hideCurrentSidebar(mount));
  bottomRow.append(hide);
  bottomRow.append(renderChatFontSizeControl(doc, mount, state));
  bottomRow.append(renderCopyDebugToggle(doc, mount, state));
  bar.append(topRow, bottomRow);
  return bar;
}

function renderChatFontSizeControl(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const wrap = el(doc, "label", "chat-font-size-control");
  wrap.title = "仅保存在本机，不参与 WebDAV 云同步";
  wrap.append(doc.createTextNode("字号"));
  const select = doc.createElement("select");
  for (const size of [11, 12, 13, 14, 15, 16, 18, 20, 22]) {
    const option = doc.createElement("option");
    option.value = String(size);
    option.textContent =
      size === DEFAULT_LOCAL_UI_SETTINGS.chatFontSizePx
        ? `${size}px 默认`
        : `${size}px`;
    select.append(option);
  }
  select.value = String(state.localUiSettings.chatFontSizePx);
  select.addEventListener("change", () => {
    const next = normalizeLocalUiSettings({
      ...state.localUiSettings,
      chatFontSizePx: select.value,
    });
    state.localUiSettings = next;
    saveLocalUiSettings(zoteroPrefs(), next);
    renderPanel(mount, state);
  });
  wrap.append(select);
  return wrap;
}

export function refreshSidebarPreferences(): void {
  for (const win of Zotero.getMainWindows()) {
    const sidebar = windowSidebars.get(win);
    if (!sidebar) continue;
    const state = states.get(sidebar.mount);
    if (!state) continue;
    const presets = loadPresets(zoteroPrefs());
    state.presets = presets;
    if (!state.selectedId || !presets.some((p) => p.id === state.selectedId)) {
      state.selectedId =
        configuredPresets(state)[0]?.id ?? presets[0]?.id ?? null;
    }
    state.agentPermissionMode = agentPermissionMode(
      selectedChatPreset(state) ?? selectedPreset(state),
    );
    state.uiSettings = loadUiSettings(zoteroPrefs());
    state.localUiSettings = loadLocalUiSettings(zoteroPrefs());
    renderPanel(sidebar.mount, state);
  }
}

function openAddonPreferences(doc: Document): void {
  const paneID = `${addon.data.config.addonRef}-prefs`;
  const zotero = Zotero as unknown as {
    PreferencePanes?: { open?: (id?: string) => void };
    Utilities?: { Internal?: { openPreferences?: (id?: string) => void } };
  };
  try {
    if (typeof zotero.PreferencePanes?.open === "function") {
      zotero.PreferencePanes.open(paneID);
      return;
    }
  } catch {}
  try {
    if (typeof zotero.Utilities?.Internal?.openPreferences === "function") {
      zotero.Utilities.Internal.openPreferences(paneID);
      return;
    }
  } catch {}
  doc.defaultView?.openDialog(
    "chrome://zotero/content/preferences/preferences.xhtml",
    "zotero-prefs",
    "chrome,titlebar,toolbar,centerscreen",
    paneID,
  );
}

function renderPresetEditor(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
) {
  const existing = selectedPreset(state);
  let current: ModelPreset = existing ?? makePreset("openai");
  if (!existing) {
    state.presets = [...state.presets, current];
    state.selectedId = current.id;
  }
  const draft = current;
  const box = el(doc, "div", "preset-edit native-preset-edit");

  const provider = selectEl(doc, [
    ["openai", "OpenAI 兼容"],
    ["anthropic", "Anthropic"],
  ]);
  provider.value = draft.provider;
  const label = inputEl(doc, draft.label);
  const apiKey = inputEl(doc, draft.apiKey, "password");
  const baseUrl = inputEl(
    doc,
    draft.baseUrl || DEFAULT_BASE_URLS[draft.provider],
  );
  const initialModels =
    draft.models && draft.models.length > 0
      ? draft.models
      : draft.model
        ? [draft.model]
        : [];
  // Chip-style model list: each model is a compact pill (input + tiny ✕)
  // and "+" sits at the end as another chip. flex-wrap keeps them on one
  // row when space allows. Every input/delete fires syncDraft() so changes
  // save live, matching label/apiKey/baseUrl behavior.
  const modelsField = doc.createElement("div") as HTMLDivElement;
  modelsField.className = "preset-models-list";
  const placeholderFor = (kind: ProviderKind) =>
    DEFAULT_MODELS[kind] || (kind === "anthropic" ? "claude-..." : "gpt-...");
  // Auto-size the input via the `size` attribute (monospace font ⇒ ~1ch each).
  // Clamped 8..28 so empty inputs are still typable and crazy-long ids don't
  // blow out the row.
  const sizeModelInput = (input: HTMLInputElement) => {
    const text = input.value || input.placeholder;
    const width = Math.max(8, Math.min(28, text.length || 8));
    input.size = width;
    input.style.width = `${width}ch`;
  };
  const addModelChip = (initialValue: string): HTMLInputElement => {
    const chip = el(doc, "span", "preset-models-chip");
    const input = inputEl(doc, initialValue);
    input.placeholder = placeholderFor(provider.value as ProviderKind);
    input.classList.add("preset-models-input");
    input.spellcheck = false;
    input.addEventListener("input", () => {
      sizeModelInput(input);
      syncDraft();
    });
    const remove = buttonEl(doc, "✕");
    remove.classList.add("preset-models-remove");
    remove.title = "删除此模型";
    remove.addEventListener("click", () => {
      chip.remove();
      syncDraft();
    });
    chip.append(input, remove);
    modelsField.insertBefore(chip, addBtn);
    sizeModelInput(input);
    return input;
  };
  const addBtn = buttonEl(doc, "+ 添加");
  addBtn.classList.add("preset-models-add");
  addBtn.title = "添加一个新模型 ID";
  addBtn.addEventListener("click", () => {
    const input = addModelChip("");
    input.focus();
    updateSaveState();
  });
  modelsField.append(addBtn);
  for (const id of initialModels) addModelChip(id);
  const replaceModelChips = (ids: string[]) => {
    Array.from(modelsField.querySelectorAll(".preset-models-chip")).forEach(
      (chip) => (chip as HTMLElement).remove(),
    );
    for (const id of ids) addModelChip(id);
  };

  const collectModelInputs = (): HTMLInputElement[] =>
    Array.from(
      modelsField.querySelectorAll(".preset-models-input"),
    ) as HTMLInputElement[];

  const refreshModelShortcutState = () => {
    const activeModels = new Set(
      collectModelInputs().map((input) => input.value.trim()),
    );
    modelShortcuts
      .querySelectorAll("[data-model-id]")
      .forEach((node: Element) =>
        (node as HTMLElement).classList.toggle(
          "is-active",
          activeModels.has((node as HTMLElement).dataset.modelId ?? ""),
        ),
      );
  };

  const readModelsField = (): { model: string; models: string[] } => {
    const lines = collectModelInputs()
      .map((input) => input.value.trim())
      .filter((value) => value.length > 0);
    const providerKind = provider.value as ProviderKind;
    // Keep the user's currently-active selection sticky if it survives the
    // edit. Otherwise fall back to first row; if the list is empty, use
    // the provider default. Mirrors normalizePreset's repair logic.
    const active =
      current.model && lines.includes(current.model)
        ? current.model
        : lines[0] || DEFAULT_MODELS[providerKind];
    return { model: active, models: lines };
  };

  const maxTokens = inputEl(doc, String(draft.maxTokens || 8192), "number");
  const reasoningEffort = selectEl(doc, reasoningEffortOptionsForPreset(draft));
  reasoningEffort.value = collapseReasoningForPreset(
    draft,
    draft.extras?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  );
  // Anthropic chat now also reads reasoningEffort to decide thinking depth;
  // only compat vendor (third-party Anthropic-shaped endpoint) ignores it.
  reasoningEffort.disabled = isReasoningDisabledForDraft(draft);
  const reasoningSummary = selectEl(doc, REASONING_SUMMARY_OPTIONS);
  reasoningSummary.value =
    draft.extras?.reasoningSummary ?? DEFAULT_REASONING_SUMMARY;
  reasoningSummary.disabled =
    draft.provider !== "openai" || !!draft.extras?.openaiUseChatCompletions;
  const omitReasoningForCache = doc.createElement("input");
  omitReasoningForCache.type = "checkbox";
  omitReasoningForCache.checked =
    draft.extras?.omitResponsesReasoningForCache === true;
  const relayCacheControl = el(doc, "div", "preset-help");
  relayCacheControl.append(
    omitReasoningForCache,
    el(
      doc,
      "span",
      "",
      "缓存优先：仅对非官方 OpenAI-compatible Responses endpoint 生效；开启后会省略 reasoning，可能降低显式思考强度。",
    ),
  );
  const relayCacheField = field(doc, "Relay cache", relayCacheControl);
  const modelShortcuts = el(doc, "div", "preset-model-shortcuts");
  const shortcutLabel = el(
    doc,
    "b",
    "preset-model-shortcuts-label",
    "OpenAI 常用",
  );
  modelShortcuts.append(shortcutLabel);
  const setModels = (ids: string[]) => {
    const nextModels = ids.filter((id) => id.trim().length > 0);
    if (nextModels.length === 0) return;
    replaceModelChips(nextModels);
    current = { ...current, model: nextModels[0], models: nextModels };
    refreshModelShortcutState();
    syncDraft();
  };
  const toggleModel = (id: string) => {
    const currentModels = collectModelInputs()
      .map((input) => input.value.trim())
      .filter((value) => value.length > 0);
    const nextModels = currentModels.includes(id)
      ? currentModels.filter((model) => model !== id)
      : [...currentModels, id];
    setModels(nextModels.length ? nextModels : [id]);
  };
  const allModels = buttonEl(doc, "填入全部");
  allModels.title = "填入 Codex 常用的 OpenAI 模型列表";
  allModels.addEventListener("click", () => setModels(OPENAI_QUICK_MODELS));
  modelShortcuts.append(allModels);
  for (const id of OPENAI_QUICK_MODELS) {
    const pick = buttonEl(doc, id);
    pick.dataset.modelId = id;
    pick.title = `加入/移除 ${id}`;
    pick.addEventListener("click", () => toggleModel(id));
    modelShortcuts.append(pick);
  }
  refreshModelShortcutState();
  modelShortcuts.hidden = draft.provider !== "openai";
  const modelsControl = el(doc, "div", "preset-models-control");
  modelsControl.append(
    modelsField,
    modelShortcuts,
    el(
      doc,
      "div",
      "preset-help",
      "模型 ID 仍可手动编辑；保存时会自动测试连接并探测是否需要发送 Max tokens。",
    ),
  );
  const flagList = el(doc, "div", "preset-flags");
  const flagHint = el(doc, "div", "preset-help");
  const flagControl = el(doc, "div", "preset-flags-control");
  flagControl.append(flagList, flagHint);
  const flagsField = field(doc, "标志位", flagControl);

  const readDraft = (): ModelPreset => {
    const providerKind = provider.value as ProviderKind;
    const { model: activeModel, models } = readModelsField();
    const openaiExtras = {
      ...current.extras,
      reasoningEffort: reasoningEffort.value as ReasoningEffort,
      reasoningSummary: reasoningSummary.value as ReasoningSummary,
      agentPermissionMode: agentPermissionMode(current),
    };
    if (omitReasoningForCache.checked) {
      openaiExtras.omitResponsesReasoningForCache = true;
    } else {
      delete openaiExtras.omitResponsesReasoningForCache;
    }
    delete (openaiExtras as Record<string, unknown>).forceResponsesReasoning;
    return {
      id: current.id,
      provider: providerKind,
      label:
        label.value.trim() || (providerKind === "anthropic" ? "Claude" : "GPT"),
      apiKey: apiKey.value.trim(),
      baseUrl: baseUrl.value.trim() || DEFAULT_BASE_URLS[providerKind],
      model: activeModel,
      models,
      maxTokens: parseInt(maxTokens.value, 10) || 8192,
      extras:
        providerKind === "openai"
          ? openaiExtras
          : {
              agentPermissionMode: agentPermissionMode(current),
            },
    };
  };

  let updateSaveState = () => undefined;
  const refreshPresetFlags = (presetForFlags: ModelPreset = current) => {
    flagList.replaceChildren(
      ...presetFlagBadges(presetForFlags).map((flag) =>
        presetFlagBadge(doc, flag),
      ),
    );
    flagHint.textContent = presetFlagHint(presetForFlags);
  };
  const refreshRelayCacheControl = () => {
    const isOpenAI = provider.value === "openai";
    const isChatCompletions = !!current.extras?.openaiUseChatCompletions;
    relayCacheField.hidden = !isOpenAI;
    omitReasoningForCache.disabled = !isOpenAI || isChatCompletions;
    refreshPresetFlags();
  };
  const syncDraft = () => {
    const next = readDraft();
    current = next;
    upsertPreset(state, next);
    state.selectedId = next.id;
    updateToolbarOption(mount, next);
    updateSendControls(mount, state);
    refreshModelShortcutState();
    refreshRelayCacheControl();
    updateSaveState();
    return next;
  };

  provider.addEventListener("change", () => {
    const nextProvider = provider.value as ProviderKind;
    label.value =
      label.value || (nextProvider === "anthropic" ? "Claude" : "GPT");
    if (
      !baseUrl.value ||
      Object.values(DEFAULT_BASE_URLS).includes(baseUrl.value)
    ) {
      baseUrl.value = DEFAULT_BASE_URLS[nextProvider];
    }
    const inputs = collectModelInputs();
    const currentLines = inputs
      .map((input) => input.value.trim())
      .filter((value) => value.length > 0);
    const allDefaults =
      currentLines.length === 0 ||
      currentLines.every((line) =>
        Object.values(DEFAULT_MODELS).includes(line),
      );
    if (allDefaults) {
      // Replace existing chips with a single one carrying the new provider's default.
      Array.from(modelsField.querySelectorAll(".preset-models-chip")).forEach(
        (chip) => (chip as HTMLElement).remove(),
      );
      addModelChip(DEFAULT_MODELS[nextProvider] || "");
    }
    collectModelInputs().forEach((input) => {
      input.placeholder = placeholderFor(nextProvider);
    });
    // Mirror the same enable/disable rule used at initial render — see the
    // comment by the first reasoningEffort assignment above.
    const nextDraft: ModelPreset = { ...draft, provider: nextProvider };
    reasoningEffort.disabled = isReasoningDisabledForDraft(nextDraft);
    // Provider change can switch the option list shape (DeepSeek → 2 entries
    // vs the 4-entry default). Repopulate so the dropdown stays honest.
    repopulateSelect(
      reasoningEffort,
      reasoningEffortOptionsForPreset(nextDraft),
      collapseReasoningForPreset(
        nextDraft,
        (reasoningEffort.value as ReasoningEffort) || DEFAULT_REASONING_EFFORT,
      ),
    );
    reasoningSummary.disabled =
      nextProvider !== "openai" ||
      !!readDraft().extras?.openaiUseChatCompletions;
    refreshRelayCacheControl();
    modelShortcuts.hidden = nextProvider !== "openai";
    if (nextProvider === "openai" && !reasoningEffort.value) {
      reasoningEffort.value = DEFAULT_REASONING_EFFORT;
    }
    if (nextProvider === "openai" && !reasoningSummary.value) {
      reasoningSummary.value = DEFAULT_REASONING_SUMMARY;
    }
    syncDraft();
  });

  for (const control of [label, apiKey, baseUrl, maxTokens]) {
    control.addEventListener("input", syncDraft);
  }
  reasoningEffort.addEventListener("change", syncDraft);
  reasoningSummary.addEventListener("change", syncDraft);
  omitReasoningForCache.addEventListener("change", syncDraft);
  refreshRelayCacheControl();
  refreshPresetFlags(draft);

  box.append(
    field(doc, "Provider", provider),
    field(doc, "名称", label),
    field(doc, "API Key", apiKey),
    field(doc, "Base URL", baseUrl),
    field(doc, "Models", modelsControl),
    field(doc, "Max tokens", maxTokens),
    field(doc, "Reasoning", reasoningEffort),
    field(doc, "Reasoning Summary", reasoningSummary),
    flagsField,
    relayCacheField,
  );

  const testStatus = el(doc, "div", "preset-test-status");
  testStatus.setAttribute("role", "status");
  const setTestStatus = (
    kind: "idle" | "running" | "ok" | "error",
    text: string,
  ) => {
    testStatus.className = `preset-test-status preset-test-${kind}`;
    testStatus.textContent = text;
  };
  const buttons = el(doc, "div", "add-buttons");
  const save = buttonEl(doc, "保存预设");
  const cacheTest = buttonEl(doc, "测试缓存");
  cacheTest.title =
    "当前条目有 PDF 时连续发送同一篇文章；否则发送内置长文本。失败会自动关闭该预设的 relay prompt cache。";
  cacheTest.disabled = draft.provider !== "openai";
  let savedSignature = presetSignature(draft);
  const isDirty = () => presetSignature(readDraft()) !== savedSignature;
  updateSaveState = () => {
    save.disabled = !isDirty();
    save.title = save.disabled ? "当前配置没有未保存改动" : "";
  };

  save.addEventListener("click", () => {
    const preset = syncDraft();
    if (!isDirty()) {
      updateSaveState();
      return;
    }
    save.disabled = true;
    setTestStatus("running", "正在测试连接；通过后会自动保存...");
    void (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const result = await testPresetConnectivity(preset, controller.signal);
        current = result.preset;
        upsertPreset(state, result.preset);
        persist(state);
        savedSignature = presetSignature(result.preset);
        updateToolbarOption(mount, result.preset);
        updateSendControls(mount, state);
        setTestStatus("ok", `${result.message}。已保存。`);
      } catch (err) {
        setTestStatus(
          "error",
          `${sanitizedTestError(err, preset.apiKey)}。未保存，请修正后重试。`,
        );
      } finally {
        clearTimeout(timeout);
        updateSaveState();
      }
    })();
  });
  buttons.append(save);

  cacheTest.addEventListener("click", () => {
    const preset = syncDraft();
    if (preset.provider !== "openai") {
      setTestStatus("error", "缓存测试仅支持 OpenAI 兼容预设。");
      return;
    }
    cacheTest.disabled = true;
    setTestStatus(
      "running",
      "正在测试 prompt cache（连续发送两次同一内容）...",
    );
    void (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      try {
        const testText = await promptCacheTestTextForCurrentItem(state.itemID);
        const result = await testPresetPromptCache(preset, controller.signal, {
          promptCacheKey: buildPromptCacheKey(preset, state.itemID),
          pinnedFullText: testText.text,
          sourceLabel: testText.label,
        });
        if (result.preset !== preset) {
          current = result.preset;
          upsertPreset(state, result.preset);
          persist(state);
          savedSignature = presetSignature(result.preset);
          updateToolbarOption(mount, result.preset);
          updateSendControls(mount, state);
        }
        setTestStatus("ok", result.message);
      } catch (err) {
        setTestStatus("error", sanitizedTestError(err, preset.apiKey));
      } finally {
        clearTimeout(timeout);
        cacheTest.disabled = readDraft().provider !== "openai";
      }
    })();
  });
  buttons.append(cacheTest);

  for (const kind of ["openai", "anthropic"] as ProviderKind[]) {
    const add = buttonEl(doc, kind === "openai" ? "+ OpenAI" : "+ Anthropic");
    add.addEventListener("click", () => {
      const preset = makePreset(kind);
      state.presets = [...state.presets, preset];
      state.selectedId = preset.id;
      state.editing = true;
      renderPanel(mount, state);
    });
    buttons.append(add);
  }

  const remove = buttonEl(doc, "删除当前");
  remove.addEventListener("click", () => {
    state.presets = state.presets.filter((p) => p.id !== current.id);
    state.selectedId = state.presets[0]?.id ?? null;
    state.editing = state.presets.length === 0;
    persist(state);
    renderPanel(mount, state);
  });
  buttons.append(remove);
  updateSaveState();
  box.append(buttons, testStatus);
  return box;
}

function renderContextCard(doc: Document, itemID: number | null) {
  const item = safeGetItem(itemID);
  const title =
    item && typeof item.getField === "function"
      ? item.getField("title") || "未选择条目"
      : "未选择条目";
  const card = el(doc, "div", "ctx-card");
  const metaRow = el(doc, "div", "ctx-meta", `Item ID: ${itemID ?? "none"}`);
  card.append(el(doc, "div", "ctx-title", title), metaRow);
  // When the active item has a cached arXiv LaTeX source, append a badge.
  // hasArxivSource is async, so render the row first and attach the badge
  // afterwards rather than blocking the synchronous header build.
  const itemKey = itemID != null ? getZoteroItem(itemID)?.key : undefined;
  if (typeof itemKey === "string") {
    void hasArxivSource(itemKey).then((has) => {
      if (!has || !metaRow.isConnected) return;
      const arxivBadge = doc.createElement("span");
      arxivBadge.className = "arxiv-source-badge";
      arxivBadge.textContent = "LaTeX 源";
      arxivBadge.title = "正在使用 arXiv LaTeX 源码分析（公式精确）";
      metaRow.append(arxivBadge);
    });
  }
  return card;
}

function safeGetItem(
  itemID: number | null,
): { getField?: (field: string) => string } | null {
  if (itemID == null) return null;
  try {
    const item = Zotero.Items.get(itemID) as
      | { getField?: (field: string) => string }
      | false
      | null;
    return item || null;
  } catch (err) {
    debugZai("sidebar.item.get.failed", {
      itemID,
      error: errorMessage(err),
    });
    return null;
  }
}

function renderQuickPrompts(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
) {
  const promptSettings = loadQuickPromptSettings(zoteroPrefs());
  const selectedText = getStoredSelectedText(state.itemID);
  const preset = selectedChatPreset(state);
  const fullTextHighlightDisabled = fullTextHighlightDisabledReason(
    doc.defaultView,
    state,
    preset,
  );
  const prompts: Array<{
    label: string;
    prompt: string;
    disabled: boolean;
    disabledTitle?: string;
    explainSelection?: boolean;
    ignoreSelection?: boolean;
    fullTextHighlight?: boolean;
  }> = [
    {
      label: "总结论文",
      prompt: promptSettings.builtIns.summary,
      disabled: false,
      ignoreSelection: true,
    },
    {
      label: "🔖 全文重点",
      prompt: promptSettings.builtIns.fullTextHighlight,
      disabled: !!fullTextHighlightDisabled,
      disabledTitle: fullTextHighlightDisabled,
      ignoreSelection: true,
      fullTextHighlight: true,
    },
    {
      label: "解释选区",
      prompt: promptSettings.builtIns.explainSelection,
      disabled: !selectedText,
      disabledTitle: "请先在 PDF 中选中需要注释的句子",
      explainSelection: true,
    },
  ];
  const box = el(doc, "div", "quick-prompts");
  for (const {
    label,
    prompt,
    disabled,
    disabledTitle,
    explainSelection,
    ignoreSelection,
    fullTextHighlight,
  } of prompts) {
    const button = buttonEl(doc, label);
    button.disabled = state.sending || disabled;
    if (disabled && disabledTitle) button.title = disabledTitle;
    button.addEventListener("click", () => {
      void sendMessage(mount, state, prompt, {
        explainSelection,
        ignoreSelection,
        fullTextHighlight,
        taskTitle: label.replace(/^🔖\s*/, ""),
      });
    });
    box.append(button);
  }
  const customPrompts = promptSettings.customButtons.filter(
    (button) => button.label.trim() && button.prompt.trim(),
  );
  if (customPrompts.length) {
    box.append(el(doc, "span", "quick-prompts-break"));
    for (const custom of customPrompts) {
      const button = buttonEl(doc, custom.label);
      button.className = "quick-prompt-custom";
      button.disabled = state.sending;
      button.title = custom.shortcut
        ? `自定义提示词按钮；PDF 中按 ${custom.shortcut.toUpperCase()} 触发`
        : "自定义提示词按钮";
      button.addEventListener("click", () => {
        void sendMessage(mount, state, custom.prompt, {
          taskTitle: custom.label,
        });
      });
      box.append(button);
    }
  }
  box.append(renderTaskQueueTrigger(doc, mount, state));
  return box;
}

type ChatTaskStatus =
  | "queued"
  | "running"
  | "unread"
  | "read"
  | "failed"
  | "cancelled";

interface ChatTaskView {
  task: ChatTaskMeta;
  userIndex: number;
  assistantIndex: number;
  status: ChatTaskStatus;
}

function renderTaskQueueTrigger(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  // Single-task mode: the entire task-queue concept is irrelevant — there's
  // never more than one in-flight task and the composer's "停止" button
  // already covers cancellation. Returning an empty span keeps the parent
  // grid layout stable without leaving a dangling badge.
  if (!queueWhileSendingEnabled(state)) {
    return el(doc, "span", "task-queue-trigger-hidden");
  }
  const tasks = visibleChatTasks(state);
  const unread = tasks.filter((task) => task.status === "unread").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const button = buttonEl(doc, "");
  button.className = [
    "task-queue-trigger",
    unread ? "has-unread" : "",
    running || queued ? "has-running" : "",
  ]
    .filter(Boolean)
    .join(" ");
  button.title = tasks.length ? "查看任务队列和未读回答" : "暂无任务结果";
  button.append(
    doc.createTextNode(unread ? "未读 " : queued ? "排队 " : "队列 "),
    el(
      doc,
      "span",
      "task-queue-count",
      String(unread || queued || tasks.length),
    ),
  );
  button.addEventListener("click", () => {
    state.queueOpen = !state.queueOpen;
    renderPanel(mount, state);
  });
  return button;
}

function renderTaskQueue(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const wrap = el(doc, "div", "task-queue-wrap");
  // When single-task mode is active the queue popover has nothing to
  // coordinate, so render nothing — keeps the composer chrome free of
  // queue scaffolding when the user has opted out of multi-task semantics.
  if (!queueWhileSendingEnabled(state)) return wrap;
  if (!state.queueOpen) return wrap;
  const tasks = visibleChatTasks(state);

  const popover = el(doc, "div", "task-queue-popover");
  const unread = tasks.filter((task) => task.status === "unread").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const head = el(doc, "div", "task-queue-head");
  const summary = queued
    ? `${unread} 未读 / ${queued} 排队 / ${tasks.length} 总计`
    : `${unread} 未读 / ${tasks.length} 总计`;
  head.append(
    el(doc, "strong", "", "任务队列"),
    el(doc, "span", "task-queue-summary", summary),
  );
  const actions = el(doc, "div", "task-queue-actions");
  const markRead = buttonEl(doc, "全部已读");
  markRead.disabled = unread === 0;
  markRead.addEventListener("click", () => {
    markAllChatTasksRead(state);
    void saveChatMessages(state.itemID, state.messages);
    renderPanel(mount, state);
  });
  // Cancel-only-pending: leaves the currently running task alone (the
  // composer's "停止" button is the right place for that), drops every
  // task that's still waiting its turn. Useful when the user submitted
  // several misfires while AI was busy and now wants to drain the
  // backlog without aborting the current reply.
  const cancelQueued = buttonEl(doc, "取消待办");
  cancelQueued.className = "cancel-queued-tasks";
  cancelQueued.disabled = queued === 0;
  cancelQueued.title = cancelQueued.disabled
    ? "没有正在排队等待执行的任务"
    : "把还没轮到的任务标为已取消，不影响当前正在回答的那一条";
  cancelQueued.addEventListener("click", () => {
    cancelQueuedChatTasks(state);
    void saveChatMessages(state.itemID, state.messages);
    renderPanel(mount, state);
  });
  const clear = buttonEl(doc, "清空队列");
  clear.className = "clear-task-queue";
  clear.disabled =
    unread > 0 || running > 0 || queued > 0 || tasks.length === 0;
  clear.title = clear.disabled
    ? "全部已读且没有回答中/排队中任务时才可清空"
    : "直接清空队列记录，不删除聊天内容";
  clear.addEventListener("click", () => {
    clearChatTaskQueue(state);
    void saveChatMessages(state.itemID, state.messages);
    renderPanel(mount, state);
  });
  const close = buttonEl(doc, "关闭");
  close.className = "close-task-queue";
  close.title = "关闭任务队列窗口";
  close.addEventListener("click", () => {
    state.queueOpen = false;
    renderPanel(mount, state);
  });
  actions.append(markRead, cancelQueued, clear, close);
  head.append(actions);
  popover.append(head);

  const list = el(doc, "div", "task-list");
  if (tasks.length === 0) {
    list.append(el(doc, "div", "task-empty", "暂无任务结果"));
  } else {
    for (const task of tasks) {
      list.append(renderTaskRow(doc, mount, state, task));
    }
  }
  popover.append(list);
  wrap.append(popover);
  return wrap;
}

function renderTaskRow(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  view: ChatTaskView,
): HTMLElement {
  const row = el(doc, "div", `task-row task-${view.status}`);
  row.append(el(doc, "span", "task-status-dot"));

  const main = el(doc, "div", "task-main");
  const top = el(doc, "div", "task-top");
  top.append(
    el(doc, "strong", "task-title", view.task.title),
    el(doc, "span", "task-age", taskStatusLabel(view)),
  );
  main.append(top, el(doc, "div", "task-preview", view.task.promptPreview));
  if (view.task.pdfSelection) {
    main.append(
      el(doc, "div", "task-locator-chip", taskLocatorLabel(view.task)),
    );
  }
  row.append(main);

  const actions = el(doc, "div", "task-row-actions");
  if (view.status === "running" || view.status === "queued") {
    const cancel = buttonEl(doc, "取消");
    cancel.className = "task-cancel";
    cancel.disabled = state.cancellingTaskID === view.task.id;
    cancel.addEventListener("click", () => cancelChatTask(mount, state, view));
    actions.append(cancel);
  } else if (view.status === "cancelled") {
    const remove = buttonEl(doc, "移除");
    remove.addEventListener("click", () => {
      hideChatTask(state, view);
      renderPanel(mount, state);
    });
    actions.append(remove);
  } else {
    const label = view.status === "read" ? "再看" : "查看";
    const button = buttonEl(doc, label);
    button.addEventListener("click", () => viewChatTask(mount, state, view));
    actions.append(button);
  }
  row.append(actions);
  return row;
}

function visibleChatTasks(state: PanelState): ChatTaskView[] {
  const tasks: ChatTaskView[] = [];
  state.messages.forEach((message, index) => {
    if (message.role !== "user" || !message.task || message.task.hiddenAt)
      return;
    const assistantIndex = findNextAssistantIndex(state.messages, index);
    tasks.push({
      task: message.task,
      userIndex: index,
      assistantIndex,
      status: chatTaskStatus(state, message.task),
    });
  });
  return tasks.sort((a, b) => b.task.createdAt - a.task.createdAt);
}

function chatTaskStatus(state: PanelState, task: ChatTaskMeta): ChatTaskStatus {
  if (task.cancelledAt) return "cancelled";
  if (task.error) return "failed";
  if (state.sending && state.activeTaskID === task.id) return "running";
  if (!task.completedAt) return "queued";
  if (task.completedAt && !task.viewedAt) return "unread";
  return "read";
}

function findNextAssistantIndex(
  messages: Message[],
  userIndex: number,
): number {
  for (let index = userIndex + 1; index < messages.length; index++) {
    if (messages[index].role === "assistant") return index;
  }
  return -1;
}

function taskStatusLabel(view: ChatTaskView): string {
  if (view.status === "queued") return "排队中";
  if (view.status === "running") return "回答中";
  if (view.status === "cancelled") return "已取消";
  if (view.status === "failed") return "失败";
  if (view.status === "read") return "已读";
  return relativeTaskTime(view.task.completedAt ?? view.task.createdAt);
}

function relativeTaskTime(time: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时`;
}

function taskLocatorLabel(task: ChatTaskMeta): string {
  const locator = task.pdfSelection;
  if (!locator) return "";
  const label = locator.pageLabel ?? String((locator.pageIndex ?? 0) + 1);
  return `📍 PDF 第 ${label} 页 · 原选区`;
}

function markAllChatTasksRead(state: PanelState) {
  const now = Date.now();
  for (const message of state.messages) {
    if (message.role !== "user" || !message.task) continue;
    if (chatTaskStatus(state, message.task) === "unread") {
      message.task.viewedAt = now;
    }
  }
}

function clearChatTaskQueue(state: PanelState) {
  const now = Date.now();
  for (const message of state.messages) {
    if (message.role === "user" && message.task) {
      message.task.hiddenAt = now;
    }
  }
  state.queueOpen = false;
}

// Drops every still-waiting task; the running one (if any) is left alone
// so this works as "drain the backlog" without colliding with the
// composer's stop button. Pairs with the read-on-load tombstoning in
// loadPersistedMessages — same `cancelledAt` mechanism, same downstream
// rendering as "已取消".
function cancelQueuedChatTasks(state: PanelState) {
  const now = Date.now();
  for (const message of state.messages) {
    if (message.role !== "user" || !message.task) continue;
    if (chatTaskStatus(state, message.task) === "queued") {
      message.task.cancelledAt = now;
    }
  }
}

function hideChatTask(state: PanelState, view: ChatTaskView) {
  view.task.hiddenAt = Date.now();
  void saveChatMessages(state.itemID, state.messages);
  state.queueOpen = true;
}

function cancelChatTask(
  mount: HTMLElement,
  state: PanelState,
  view: ChatTaskView,
) {
  if (view.status === "queued") {
    markMessageTaskCancelled(state.messages[view.userIndex]);
    void saveChatMessages(state.itemID, state.messages);
    renderPanel(mount, state);
    void processNextQueuedChatTask(mount, state);
    return;
  }
  if (!(state.sending && state.activeTaskID === view.task.id)) return;
  view.task.cancelledAt = Date.now();
  view.task.completedAt ??= view.task.cancelledAt;
  state.cancellingTaskID = view.task.id;
  state.abort?.abort();
  void saveChatMessages(state.itemID, state.messages);
  renderPanel(mount, state);
}

function cancelActiveChatTask(mount: HTMLElement, state: PanelState) {
  const active = visibleChatTasks(state).find(
    (view) => view.task.id === state.activeTaskID,
  );
  if (active) {
    cancelChatTask(mount, state, active);
    return;
  }
  state.abort?.abort();
  renderPanel(mount, state);
}

function handleTaskEscape(
  mount: HTMLElement,
  state: PanelState,
  event: KeyboardEvent,
): boolean {
  if (
    event.defaultPrevented ||
    event.key !== "Escape" ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return false;
  }
  if (state.queueOpen) {
    state.queueOpen = false;
    renderPanel(mount, state);
  } else if (state.sending) {
    cancelActiveChatTask(mount, state);
  } else {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function viewChatTask(
  mount: HTMLElement,
  state: PanelState,
  view: ChatTaskView,
) {
  view.task.viewedAt = Date.now();
  void saveChatMessages(state.itemID, state.messages);
  renderPanel(mount, state);
  afterRender(mount, () => {
    jumpToTaskMessage(mount, view);
  });
}

function jumpToTaskMessage(mount: HTMLElement, view: ChatTaskView) {
  const index = view.userIndex;
  const root = mount.querySelector(
    `[data-message-index="${index}"]`,
  ) as HTMLElement | null;
  if (!root) return;
  scrollTaskMessageIntoView(mount, root, (scrollTop) => {
    const state = states.get(mount);
    if (state) state.messagesScrollTop = scrollTop;
  });
  root.classList.add("bubble-task-jump");
  const win = mount.ownerDocument?.defaultView;
  win?.setTimeout(() => root.classList.remove("bubble-task-jump"), 1800);
}

async function jumpToPdfSelection(
  mount: HTMLElement,
  state: PanelState,
  locator: PdfSelectionLocator,
) {
  const win = mount.ownerDocument?.defaultView;
  const activeReader = getActiveReader(win);
  const activeConversationID = win ? activeReaderConversationItemID(win) : null;
  const reader =
    readerAttachmentID(activeReader) === locator.attachmentID
      ? activeReader
      : getReaderForAttachmentOrItem(win, state.itemID, locator.attachmentID);
  if (!reader || typeof reader.navigate !== "function") {
    debugZai("task.pdf-selection.jump.unavailable", {
      attachmentID: locator.attachmentID,
      itemID: state.itemID,
      activeAttachmentID: readerAttachmentID(activeReader),
      activeConversationID,
    });
    return;
  }
  try {
    await reader.navigate({ position: locator.position });
    const restored = await restoreReaderTextSelectionAfterNavigate(
      win,
      reader,
      locator,
    );
    if (restored) {
      clearIgnoredSelectedTextForReader(
        reader,
        state.itemID,
        locator.selectedText,
      );
      rememberReaderSelection(
        reader,
        state.itemID,
        locator.selectedText,
        restored,
      );
      updateSelectionIndicators(mount, state.itemID);
    }
    debugZai("task.pdf-selection.jump", {
      attachmentID: locator.attachmentID,
      pageIndex: locator.pageIndex,
      restoredSelection: !!restored,
      text: textDebugInfo(locator.selectedText, 120),
    });
  } catch (err) {
    debugZai("task.pdf-selection.jump.failed", {
      error: errorMessage(err),
      attachmentID: locator.attachmentID,
    });
  }
}

async function jumpToPdfSelectionPreview(
  mount: HTMLElement,
  state: PanelState,
  locator: PdfSelectionLocator,
) {
  const win = mount.ownerDocument?.defaultView;
  const activeReader = getActiveReader(win);
  const activeConversationID = win ? activeReaderConversationItemID(win) : null;
  const reader =
    readerAttachmentID(activeReader) === locator.attachmentID
      ? activeReader
      : getReaderForAttachmentOrItem(win, state.itemID, locator.attachmentID);
  if (!reader || typeof reader.navigate !== "function") {
    debugZai("task.pdf-selection-preview.jump.unavailable", {
      attachmentID: locator.attachmentID,
      itemID: state.itemID,
      activeAttachmentID: readerAttachmentID(activeReader),
      activeConversationID,
    });
    return;
  }
  try {
    const selectionLocator = await enrichPdfSelectionLocatorWithReaderOffsets(
      reader,
      locator,
    );
    setTempLoadMarkStatus(mount, "选区中");
    suppressReaderSelectionTextForPrompt(reader, selectionLocator.selectedText);
    const restored = await navigateReaderToPdfSelectionPreview(
      win,
      reader,
      selectionLocator,
    );
    suppressReaderSelectionTextForPrompt(reader, selectionLocator.selectedText);
    setTempLoadMarkStatus(mount, restored ? "选区OK" : "选区失败");
    debugZai("task.pdf-selection-preview.jump", {
      attachmentID: selectionLocator.attachmentID,
      pageIndex: selectionLocator.pageIndex,
      restoredSelection: !!restored,
      hasOffsets: locatorHasSelectionOffsets(selectionLocator),
      domText: textDebugInfo(getActiveReaderSelection(reader), 120),
      text: textDebugInfo(selectionLocator.selectedText, 120),
    });
  } catch (err) {
    setTempLoadMarkStatus(mount, "选区异常");
    debugZai("task.pdf-selection-preview.jump.failed", {
      error: errorMessage(err),
      attachmentID: locator.attachmentID,
    });
  }
}

function setTempLoadMarkStatus(mount: HTMLElement, text: string): void {
  const button = mount.querySelector(
    ".zai-temp-load-mark",
  ) as HTMLElement | null;
  if (!button) return;
  button.textContent = text;
  button.title = `临时调试状态：${text}`;
}

async function enrichPdfSelectionLocatorWithReaderOffsets(
  reader: unknown,
  locator: PdfSelectionLocator,
): Promise<PdfSelectionLocator> {
  if (locatorHasSelectionOffsets(locator)) return locator;
  let pdfLocator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    pdfLocator = await createPdfLocator(reader);
    const result = await pdfLocator.locate(locator.selectedText, {
      minConfidence: 0.85,
      pageIndex: locator.pageIndex,
    });
    if (!result || result.anchorOffset == null || result.headOffset == null) {
      return locator;
    }
    return {
      ...locator,
      selectedText: result.matchedText || locator.selectedText,
      pageIndex: result.pageIndex,
      pageLabel: result.pageLabel,
      position: {
        ...locator.position,
        pageIndex: result.pageIndex,
        rects: result.rects,
        zaiAnchorOffset: result.anchorOffset,
        zaiHeadOffset: result.headOffset,
      },
    };
  } catch (err) {
    debugZai("task.pdf-selection-preview.enrich-offsets.failed", {
      error: errorMessage(err),
      attachmentID: locator.attachmentID,
      pageIndex: locator.pageIndex,
    });
    return locator;
  } finally {
    pdfLocator?.dispose();
  }
}

function locatorHasSelectionOffsets(locator: PdfSelectionLocator): boolean {
  const anchorOffset = finiteNumber(locator.position?.zaiAnchorOffset);
  const headOffset = finiteNumber(locator.position?.zaiHeadOffset);
  return (
    anchorOffset != null &&
    headOffset != null &&
    Number.isInteger(anchorOffset) &&
    Number.isInteger(headOffset) &&
    headOffset > anchorOffset
  );
}

async function jumpToPdfLocationOnly(
  mount: HTMLElement,
  state: PanelState,
  locator: PdfSelectionLocator,
  referenceKind?: ReadingRouteReferenceKind,
) {
  const win = mount.ownerDocument?.defaultView;
  const activeReader = getActiveReader(win);
  const activeConversationID = win ? activeReaderConversationItemID(win) : null;
  const reader =
    readerAttachmentID(activeReader) === locator.attachmentID
      ? activeReader
      : getReaderForAttachmentOrItem(win, state.itemID, locator.attachmentID);
  if (!reader || typeof reader.navigate !== "function") {
    debugZai("task.pdf-location.jump.unavailable", {
      attachmentID: locator.attachmentID,
      itemID: state.itemID,
      activeAttachmentID: readerAttachmentID(activeReader),
      activeConversationID,
    });
    return;
  }
  const popupGuard = mountReaderSelectionPopupGuard(reader);
  try {
    const navigated = await navigateReaderToPdfLocationOnly(
      win,
      reader,
      locator,
      referenceKind,
    );
    if (!navigated) {
      await reader.navigate({ position: locator.position });
      await clearReaderTransientPdfStateAfterNavigate(win, reader, {
        clearHighlight: false,
        clearSelection: false,
      });
    }
    for (const view of activeReaderViews(reader as any)) {
      if (view?._iframeWindow) {
        mountRouteHighlightOverlay(mount, view, locator);
        break;
      }
    }
    debugZai("task.pdf-location.jump", {
      attachmentID: locator.attachmentID,
      pageIndex: locator.pageIndex,
      text: textDebugInfo(locator.selectedText, 120),
      referenceKind,
      directViewNavigation: navigated,
    });
  } catch (err) {
    debugZai("task.pdf-location.jump.failed", {
      error: errorMessage(err),
      attachmentID: locator.attachmentID,
    });
  } finally {
    destroyGuardAfterDelay(win, popupGuard, 2000);
  }
}

async function jumpToReadingRouteReference(
  mount: HTMLElement,
  state: PanelState,
  label: string,
  sourceItemID: number | null,
  referenceKind?: ReadingRouteReferenceKind,
): Promise<void> {
  const win = mount.ownerDocument?.defaultView;
  const reader = getReaderForAttachmentOrItem(win, sourceItemID, null);
  if (!reader) {
    setTempLoadMarkStatus(mount, "图表未打开");
    return;
  }

  setTempLoadMarkStatus(mount, "图表定位中");
  let pdfLocator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    pdfLocator = await createPdfLocator(reader);
    const result = await locateReadingRouteReference(pdfLocator, label);
    if (!result) {
      setTempLoadMarkStatus(mount, "图表未定位");
      return;
    }
    const locator = pdfSelectionLocatorFromLocateResult(
      pdfLocator.attachmentID,
      result.matchedText || label,
      result,
    );
    setTempLoadMarkStatus(mount, "图表定位");
    await jumpToPdfLocationOnly(mount, state, locator, referenceKind);
  } catch (err) {
    setTempLoadMarkStatus(mount, "图表异常");
    debugZai("reading-route.reference.jump.failed", {
      error: errorMessage(err),
      label,
      sourceItemID,
    });
  } finally {
    pdfLocator?.dispose();
  }
}

function mountReaderSelectionPopupGuard(reader: unknown): { destroy(): void } {
  const guards: Array<{ destroy(): void }> = [];
  for (const view of activeReaderViews(reader as any)) {
    const doc = view?._iframeWindow?.document as Document | undefined;
    if (!doc) continue;
    try {
      guards.push(mountSelectionPopupGuard(doc));
    } catch (err) {
      debugZai("task.pdf-location.popup-guard.failed", {
        error: errorMessage(err),
      });
    }
  }
  return {
    destroy() {
      for (const guard of guards) {
        try {
          guard.destroy();
        } catch {
          /* best effort */
        }
      }
    },
  };
}

function destroyGuardAfterDelay(
  win: Window | null | undefined,
  guard: { destroy(): void },
  delayMs: number,
) {
  void sleepInWindow(win, delayMs).then(() => guard.destroy());
}

function destroyActiveRouteHighlight(mount: HTMLElement): void {
  activeRouteHighlights.get(mount)?.destroy();
  activeRouteHighlights.delete(mount);
}

function ensureRouteHighlightStyle(doc: Document): void {
  const STYLE_ID = "zai-route-highlight-style";
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.zai-route-highlight {
  position: absolute;
  background: rgba(100, 160, 240, 0.35);
  border-radius: 2px;
  pointer-events: none;
  mix-blend-mode: multiply;
  z-index: 5;
}
`;
  (doc.head ?? doc.documentElement!).appendChild(style);
}

function mountRouteHighlightOverlay(
  mount: HTMLElement,
  view: any,
  locator: PdfSelectionLocator,
): void {
  destroyActiveRouteHighlight(mount);
  const rects = pdfRects(locator.position?.rects);
  const pageIndex =
    finiteNumber(locator.position?.pageIndex) ?? locator.pageIndex;
  if (!rects.length || pageIndex == null) return;

  const iframeDoc = view?._iframeWindow?.document as Document | undefined;
  const pageEl = iframeDoc?.querySelector(
    `[data-page-number="${pageIndex + 1}"]`,
  ) as HTMLElement | null;
  const viewport =
    iframeDoc?.defaultView?.PDFViewerApplication?.pdfViewer?._pages?.[pageIndex]
      ?.viewport;
  if (!iframeDoc || !pageEl || !viewport) return;

  ensureRouteHighlightStyle(iframeDoc);

  const overlays: HTMLElement[] = [];
  for (const [x1, y1, x2, y2] of rects) {
    try {
      const [vx1, vy2] = viewport.convertToViewportPoint(x1, y1) as [
        number,
        number,
      ];
      const [vx2, vy1] = viewport.convertToViewportPoint(x2, y2) as [
        number,
        number,
      ];
      const div = iframeDoc.createElement("div");
      div.className = "zai-route-highlight";
      div.style.left = `${Math.min(vx1, vx2)}px`;
      div.style.top = `${Math.min(vy1, vy2)}px`;
      div.style.width = `${Math.max(1, Math.abs(vx2 - vx1))}px`;
      div.style.height = `${Math.max(1, Math.abs(vy2 - vy1))}px`;
      pageEl.appendChild(div);
      overlays.push(div);
    } catch {
      /* best effort */
    }
  }

  if (overlays.length) {
    activeRouteHighlights.set(mount, {
      destroy() {
        for (const div of overlays) {
          try {
            div.remove();
          } catch {
            /* best effort */
          }
        }
      },
    });
  }
}

async function navigateReaderToPdfLocationOnly(
  win: Window | null | undefined,
  reader: unknown,
  locator: PdfSelectionLocator,
  referenceKind?: ReadingRouteReferenceKind,
): Promise<boolean> {
  for (const view of activeReaderViews(reader as any)) {
    if (!view || typeof view.navigateToPosition !== "function") continue;
    try {
      await view.initializedPromise;
      const position = pdfLocationScrollPosition(
        locator.position,
        view,
        referenceKind,
      );
      const scopedPosition = clonePlainForScope(position, view?._iframeWindow);
      clearReaderTransientPdfState(reader);
      view.navigateToPosition(scopedPosition, {
        block: "center",
        behavior: "instant",
      });
      suppressReaderSelectionTextForPrompt(reader, locator.selectedText);
      await restoreReaderTextSelectionQuietAfterNavigate(win, reader, locator);
      await clearReaderTransientPdfStateAfterNavigate(win, reader, {
        clearHighlight: false,
        clearSelection: false,
      });
      return true;
    } catch (err) {
      debugZai("task.pdf-location.direct-jump.failed", {
        error: errorMessage(err),
        attachmentID: locator.attachmentID,
        pageIndex: locator.pageIndex,
      });
    }
  }
  return false;
}

async function navigateReaderToPdfSelectionPreview(
  win: Window | null | undefined,
  reader: unknown,
  locator: PdfSelectionLocator,
): Promise<boolean> {
  const popupGuard = mountReaderSelectionPopupGuard(reader);
  try {
    for (const view of activeReaderViews(reader as any)) {
      if (!view || typeof view.navigateToPosition !== "function") continue;
      try {
        await view.initializedPromise;
        const position =
          clonePlainRecord(locator.position) ??
          (locator.position as Record<string, unknown>);
        const scopedPosition = clonePlainForScope(
          position,
          view?._iframeWindow,
        );
        clearReaderTransientPdfState(reader);
        view.navigateToPosition(scopedPosition, {
          block: "center",
          behavior: "instant",
        });
        suppressReaderSelectionTextForPrompt(reader, locator.selectedText);
        const restored = await restoreReaderTextSelectionQuietAfterNavigate(
          win,
          reader,
          locator,
        );
        await clearReaderTransientPdfStateAfterNavigate(win, reader, {
          clearHighlight: false,
          clearSelection: false,
        });
        if (restored) centerReaderSelectionInView(view);
        if (restored) return true;
      } catch (err) {
        debugZai("task.pdf-selection-preview.direct-jump.failed", {
          error: errorMessage(err),
          attachmentID: locator.attachmentID,
          pageIndex: locator.pageIndex,
        });
      }
    }

    const navigable = reader as { navigate?: (args: unknown) => Promise<void> };
    if (typeof navigable.navigate !== "function") return false;
    await navigable.navigate({ position: locator.position });
    const restored = await restoreReaderTextSelectionQuietAfterNavigate(
      win,
      reader,
      locator,
    );
    await clearReaderTransientPdfStateAfterNavigate(win, reader, {
      clearHighlight: false,
      clearSelection: false,
    });
    if (restored) centerReaderSelectionInActiveViews(reader);
    return restored;
  } finally {
    destroyGuardAfterDelay(win, popupGuard, 1400);
  }
}

async function restoreReaderTextSelectionQuietAfterNavigate(
  win: Window | null | undefined,
  reader: unknown,
  locator: PdfSelectionLocator,
): Promise<boolean> {
  for (const delayMs of [0, 80, 240, 600, 1000, 1600]) {
    if (delayMs > 0) await sleepInWindow(win, delayMs);
    if (restoreReaderTextSelectionQuiet(reader, locator)) return true;
  }
  return false;
}

function restoreReaderTextSelectionQuiet(
  reader: unknown,
  locator: PdfSelectionLocator,
): boolean {
  for (const view of activeReaderViews(reader as any)) {
    const ranges = selectionRangesFromLocator(view, locator);
    if (!ranges.length || typeof view?._setSelectionRanges !== "function") {
      continue;
    }
    try {
      const scopedRanges = clonePlainForScope(ranges, view?._iframeWindow);
      focusReaderViewForSelection(view);
      view._setSelectionRanges(scopedRanges);
      // Keep the visible selection but close Zotero's native selection popup.
      view._onSetSelectionPopup?.();
      view._render?.();
      const visible = setReaderTextLayerSelection(view, scopedRanges);
      return visible;
    } catch (err) {
      debugZai("task.pdf-location.quiet-selection.failed", {
        error: errorMessage(err),
        attachmentID: locator.attachmentID,
        pageIndex: locator.pageIndex,
      });
    }
  }
  return false;
}

function focusReaderViewForSelection(view: any) {
  try {
    view?.focus?.();
    view?._iframe?.focus?.();
    view?._iframeWindow?.focus?.();
  } catch {
    /* best effort */
  }
}

function setReaderTextLayerSelection(
  view: any,
  selectionRanges: any[],
): boolean {
  const win = view?._iframeWindow as Window | undefined;
  const doc = win?.document;
  if (!win || !doc || !selectionRanges.length) return false;

  try {
    const first = selectionRanges[0];
    const last = selectionRanges[selectionRanges.length - 1];
    const start = readerTextLayerNodeOffset(
      doc,
      selectionRangePageIndex(first),
      Math.min(
        selectionRangeOffset(first?.anchorOffset),
        selectionRangeOffset(first?.headOffset),
      ),
    );
    const end = readerTextLayerNodeOffset(
      doc,
      selectionRangePageIndex(last),
      Math.max(
        selectionRangeOffset(last?.anchorOffset),
        selectionRangeOffset(last?.headOffset),
      ),
    );
    if (!start || !end) return false;
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = win.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    focusReaderViewForSelection(view);
    const visibleText = normalizeSelectedText(selection.toString());
    debugZai("task.pdf-location.dom-selection", {
      rangeCount: selection.rangeCount,
      text: textDebugInfo(visibleText, 120),
    });
    return selection.rangeCount > 0 && !!visibleText;
  } catch (err) {
    debugZai("task.pdf-location.dom-selection.failed", {
      error: errorMessage(err),
    });
    return false;
  }
}

type ReaderScrollContainer = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect: () => DOMRect;
};

function centerReaderSelectionInActiveViews(reader: unknown): boolean {
  for (const view of activeReaderViews(reader as any)) {
    if (centerReaderSelectionInView(view)) return true;
  }
  return false;
}

function centerReaderSelectionInView(view: any): boolean {
  const win = view?._iframeWindow as Window | undefined;
  const selection = win?.getSelection?.();
  if (!win || !selection || selection.rangeCount === 0) return false;

  try {
    const range = selection.getRangeAt(0);
    const rect = firstVisibleRangeRect(range);
    if (!rect) return false;

    const container = readerScrollContainer(view);
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const target =
        container.scrollTop +
        rect.top -
        containerRect.top -
        Math.max(80, container.clientHeight * 0.35);
      container.scrollTop = boundedScrollTop(container, target);
      debugZai("task.pdf-selection-preview.centered", {
        top: Math.round(container.scrollTop),
      });
      return true;
    }

    const target =
      win.scrollY + rect.top - Math.max(80, win.innerHeight * 0.35);
    win.scrollTo(win.scrollX, Math.max(0, Math.round(target)));
    return true;
  } catch (err) {
    debugZai("task.pdf-selection-preview.center.failed", {
      error: errorMessage(err),
    });
    return false;
  }
}

function firstVisibleRangeRect(range: Range): DOMRect | null {
  const rectList = range.getClientRects();
  const rects = Array.from(rectList ?? []).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  const rect = rects[0] ?? range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function readerScrollContainer(view: any): ReaderScrollContainer | null {
  const win = view?._iframeWindow as Window | undefined;
  const doc = win?.document;
  return (
    scrollContainerElement(win?.PDFViewerApplication?.pdfViewer?.container) ||
    scrollContainerElement(doc?.getElementById("viewerContainer")) ||
    scrollContainerElement(doc?.scrollingElement)
  );
}

function scrollContainerElement(value: unknown): ReaderScrollContainer | null {
  const node = value as Partial<ReaderScrollContainer> | null | undefined;
  if (
    !node ||
    typeof node.scrollTop !== "number" ||
    typeof node.scrollHeight !== "number" ||
    typeof node.clientHeight !== "number" ||
    typeof node.getBoundingClientRect !== "function"
  ) {
    return null;
  }
  return node as ReaderScrollContainer;
}

function boundedScrollTop(
  container: ReaderScrollContainer,
  target: number,
): number {
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.min(maxTop, Math.max(0, Math.round(target)));
}

function readerTextLayerNodeOffset(
  doc: Document,
  pageIndex: number,
  offset: number,
): { node: Node; offset: number } | null {
  const container = doc.querySelector(
    `[data-page-number="${pageIndex + 1}"] .textLayer`,
  );
  if (!container) return null;

  const textNodeType = doc.defaultView?.Node?.TEXT_NODE ?? 3;
  let visibleCharIndex = 0;
  const stack: Node[] = [container];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType === textNodeType) {
      const value = node.nodeValue ?? "";
      let nodeOffset = 0;
      for (const char of Array.from(value)) {
        if (char.trim()) {
          if (visibleCharIndex === offset) {
            return { node, offset: nodeOffset };
          }
          visibleCharIndex++;
        }
        nodeOffset += char.length;
      }
      if (visibleCharIndex === offset) {
        return { node, offset: nodeOffset };
      }
      continue;
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes.item(i);
      if (child) stack.push(child);
    }
  }
  return null;
}

function suppressReaderSelectionTextForPrompt(reader: unknown, text: string) {
  const normalized = normalizeSelectedText(text);
  if (!normalized) return;
  for (const id of readerItemIDs(reader, null)) {
    ignoredSelectedTextByItem.set(id, normalized);
    selectedTextByItem.delete(id);
    selectedAnnotationByItem.delete(id);
  }
}

function pdfLocationScrollPosition(
  rawPosition: Record<string, unknown>,
  view: any,
  referenceKind?: ReadingRouteReferenceKind,
): Record<string, unknown> {
  const position =
    clonePlainRecord(rawPosition) ??
    rawPosition ??
    ({} as Record<string, unknown>);
  const pageIndex = finiteNumber(position.pageIndex);
  const rects = pdfRects(position.rects);
  if (pageIndex == null || !rects.length) return position;

  const pageBounds = pdfPageBounds(view, pageIndex);
  if (!pageBounds || referenceKind === "equation") return position;

  const [pageX1, pageY1, pageX2, pageY2] = pageBounds;
  const bounds = pdfRectBounds(rects);
  if (!bounds) return position;

  const pageHeight = Math.max(1, pageY2 - pageY1);
  const context = Math.min(Math.max(pageHeight * 0.3, 180), 320);
  const [, y1, , y2] = bounds;
  const contextRect: PdfRectTuple =
    referenceKind === "table"
      ? [pageX1, Math.max(pageY1, y1 - context), pageX2, y2]
      : [pageX1, y1, pageX2, Math.min(pageY2, y2 + context)];
  return {
    ...position,
    pageIndex,
    rects: [contextRect],
  };
}

function pdfPageBounds(view: any, pageIndex: number): PdfRectTuple | null {
  const pdfPage = readerPageForIndex(view, pageIndex);
  const viewBox = pdfRects([pdfPage?.viewBox])[0];
  if (viewBox) return viewBox;
  const viewportViewBox = pdfRects([
    view?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.[pageIndex]
      ?.viewport?.viewBox,
  ])[0];
  return viewportViewBox ?? null;
}

function pdfRectBounds(rects: PdfRectTuple[]): PdfRectTuple | null {
  if (!rects.length) return null;
  return [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3])),
  ];
}

async function clearReaderTransientPdfStateAfterNavigate(
  win: Window | null | undefined,
  reader: unknown,
  options: { clearHighlight?: boolean; clearSelection?: boolean } = {},
) {
  clearReaderTransientPdfState(reader, options);
  for (const delayMs of [80, 240]) {
    await sleepInWindow(win, delayMs);
    clearReaderTransientPdfState(reader, options);
  }
}

function clearReaderTransientPdfState(
  reader: unknown,
  options: { clearHighlight?: boolean; clearSelection?: boolean } = {},
) {
  const clearHighlight = options.clearHighlight !== false;
  const clearSelection = options.clearSelection !== false;
  for (const view of activeReaderViews(reader as any)) {
    try {
      if (clearSelection) view?._setSelectionRanges?.();
      view?._onSetSelectionPopup?.();
      view?._onSetAnnotationPopup?.();
      view?._onSetOverlayPopup?.(null);
      if (clearHighlight && "_highlightedPosition" in view) {
        view._highlightedPosition = null;
      }
      if (clearSelection) {
        view?._iframeWindow?.getSelection?.()?.removeAllRanges?.();
      }
      view?._render?.();
    } catch (err) {
      debugZai("task.pdf-location.clear-transient.failed", {
        error: errorMessage(err),
      });
    }
  }
}

function clearIgnoredSelectedTextForReader(
  reader: unknown,
  itemID: number | null,
  text: string,
) {
  const normalized = normalizeSelectedText(text);
  if (!normalized) return;
  for (const id of readerItemIDs(reader, itemID)) {
    if (ignoredSelectedTextByItem.get(id) === normalized) {
      ignoredSelectedTextByItem.delete(id);
    }
  }
}

async function restoreReaderTextSelectionAfterNavigate(
  win: Window | null | undefined,
  reader: unknown,
  locator: PdfSelectionLocator,
): Promise<Record<string, unknown> | null> {
  for (const delayMs of [0, 80, 240, 600, 1200]) {
    if (delayMs > 0) await sleepInWindow(win, delayMs);
    const restored = restoreReaderTextSelection(reader, locator);
    if (restored) return restored;
  }
  return null;
}

function sleepInWindow(
  win: Window | null | undefined,
  delayMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    if (win?.setTimeout) win.setTimeout(resolve, delayMs);
    else setTimeout(resolve, delayMs);
  });
}

function restoreReaderTextSelection(
  reader: unknown,
  locator: PdfSelectionLocator,
): Record<string, unknown> | null {
  for (const view of activeReaderViews(reader as any)) {
    const ranges = selectionRangesFromLocator(view, locator);
    if (!ranges.length || typeof view?._setSelectionRanges !== "function") {
      continue;
    }
    try {
      const scopedRanges = clonePlainForScope(ranges, view?._iframeWindow);
      focusReaderViewForSelection(view);
      view._setSelectionRanges(scopedRanges);
      view._scrollSelectionHeadIntoView?.(scopedRanges);
      view._render?.(true);
      setReaderTextLayerSelection(view, scopedRanges);
      return (
        selectionAnnotationFromView(view, scopedRanges, locator) ??
        selectionAnnotationFromRanges(scopedRanges, locator)
      );
    } catch (err) {
      debugZai("task.pdf-selection.restore.failed", {
        error: errorMessage(err),
        attachmentID: locator.attachmentID,
        pageIndex: locator.pageIndex,
      });
    }
  }
  return null;
}

function selectionRangesFromLocator(
  view: any,
  locator: PdfSelectionLocator,
): Array<Record<string, unknown>> {
  const position = locator.position as { pageIndex?: unknown; rects?: unknown };
  const pageIndex = finiteNumber(position.pageIndex);
  const rects = pdfRects(position.rects);
  if (pageIndex == null || rects.length === 0) return [];

  const page = readerPageForIndex(view, pageIndex);
  const chars = Array.isArray(page?.chars) ? page.chars : [];
  if (!chars.length) return [];

  const offsets =
    selectionOffsetsFromLocatorPosition(position, chars.length) ??
    charOffsetsForReaderText(chars, locator.selectedText, rects) ??
    charOffsetsForPdfRects(chars, rects);
  if (!offsets) {
    debugZai("task.pdf-selection.restore.offsets-missing", {
      pageIndex,
      rects: rects.length,
      text: textDebugInfo(locator.selectedText, 120),
    });
    return [];
  }
  const [anchorOffset, headOffset] = offsets;
  const rangeRects =
    rectsFromReaderChars(chars.slice(anchorOffset, headOffset)) || rects;
  const range = {
    pageIndex,
    anchorOffset,
    headOffset,
    anchor: true,
    head: true,
    collapsed: anchorOffset === headOffset,
    text:
      locator.selectedText ||
      textFromReaderChars(chars.slice(anchorOffset, headOffset)),
    sortIndex: selectionSortIndex(
      pageIndex,
      anchorOffset,
      rangeRects,
      page?.viewBox,
    ),
    position: { pageIndex, rects: rangeRects },
  };
  return range.collapsed ? [] : [range];
}

function selectionOffsetsFromLocatorPosition(
  position: Record<string, unknown>,
  charCount: number,
): [number, number] | null {
  const anchorOffset = finiteNumber(position.zaiAnchorOffset);
  const headOffset = finiteNumber(position.zaiHeadOffset);
  if (anchorOffset == null || headOffset == null) return null;
  const start = Math.floor(anchorOffset);
  const end = Math.floor(headOffset);
  if (
    start !== anchorOffset ||
    end !== headOffset ||
    start < 0 ||
    end <= start ||
    end > charCount
  ) {
    return null;
  }
  return [start, end];
}

function selectionAnnotationFromView(
  view: any,
  ranges: Array<Record<string, unknown>>,
  locator: PdfSelectionLocator,
): Record<string, unknown> | null {
  if (typeof view?._getAnnotationFromSelectionRanges !== "function") {
    return null;
  }
  try {
    const annotation = view._getAnnotationFromSelectionRanges(
      ranges,
      "highlight",
    );
    if (!annotation || typeof annotation !== "object") return null;
    return {
      ...clonePlainForScope(annotation),
      text: locator.selectedText,
      pageLabel: locator.pageLabel ?? (annotation as any).pageLabel,
    };
  } catch {
    return null;
  }
}

function selectionAnnotationFromRanges(
  ranges: Array<Record<string, unknown>>,
  locator: PdfSelectionLocator,
): Record<string, unknown> | null {
  const first = ranges[0];
  const position = first?.position;
  if (!position || typeof position !== "object") return null;
  return {
    type: "highlight",
    text: locator.selectedText,
    pageLabel: locator.pageLabel,
    sortIndex: typeof first.sortIndex === "string" ? first.sortIndex : "",
    position,
  };
}

function readerPageForIndex(view: any, pageIndex: number): any {
  const pages = view?._pdfPages;
  return Array.isArray(pages) ? pages[pageIndex] : pages?.[String(pageIndex)];
}

type PdfRectTuple = [number, number, number, number];

function pdfRects(value: unknown): PdfRectTuple[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 4) return null;
      const rect = entry.slice(0, 4).map(finiteNumber);
      return rect.every((coord) => coord != null)
        ? (rect as PdfRectTuple)
        : null;
    })
    .filter((rect): rect is PdfRectTuple => !!rect);
}

function charOffsetsForPdfRects(
  chars: any[],
  rects: PdfRectTuple[],
): [number, number] | null {
  let start = Infinity;
  let end = -1;
  chars.forEach((char, index) => {
    const rect = pdfRectFromChar(char);
    if (
      !rect ||
      !rects.some((selectionRect) => pdfRectCenterInside(rect, selectionRect))
    ) {
      return;
    }
    start = Math.min(start, index);
    end = Math.max(end, index + 1);
  });
  return Number.isFinite(start) && end > start ? [start, end] : null;
}

function pdfRectFromChar(char: any): PdfRectTuple | null {
  return pdfRects([char?.inlineRect])[0] ?? pdfRects([char?.rect])[0] ?? null;
}

function charOffsetsForReaderText(
  chars: any[],
  text: string,
  rects: PdfRectTuple[] = [],
): [number, number] | null {
  const needle = normalizedReaderTextWithMap(text).text;
  if (!needle) return null;
  const haystack = normalizedReaderCharsWithMap(chars);
  const matches: Array<[number, number]> = [];
  for (
    let index = haystack.text.indexOf(needle);
    index >= 0;
    index = haystack.text.indexOf(needle, index + 1)
  ) {
    const mapSlice = haystack.map
      .slice(index, index + needle.length)
      .filter((value) => Number.isFinite(value));
    if (!mapSlice.length) continue;
    const start = Math.min(...mapSlice);
    const end = Math.max(...mapSlice) + 1;
    if (end > start) matches.push([start, end]);
  }
  if (!matches.length) return null;
  if (matches.length === 1 || !rects.length) return matches[0]!;
  return matches
    .map((offsets) => ({
      offsets,
      score: rectDistanceScore(
        rectsFromReaderChars(chars.slice(offsets[0], offsets[1])) ?? [],
        rects,
      ),
    }))
    .sort((a, b) => a.score - b.score)[0]!.offsets;
}

function rectDistanceScore(
  left: PdfRectTuple[],
  right: PdfRectTuple[],
): number {
  if (!left.length || !right.length) return Infinity;
  let total = 0;
  for (const rect of left) {
    total += Math.min(...right.map((target) => pdfRectDistance(rect, target)));
  }
  return total / left.length;
}

function pdfRectDistance(a: PdfRectTuple, b: PdfRectTuple): number {
  const left = b[2] < a[0];
  const right = a[2] < b[0];
  const bottom = b[3] < a[1];
  const top = a[3] < b[1];

  if (top && left) return Math.hypot(a[0] - b[2], b[1] - a[3]);
  if (left && bottom) return Math.hypot(a[0] - b[2], a[1] - b[3]);
  if (bottom && right) return Math.hypot(a[2] - b[0], a[1] - b[3]);
  if (right && top) return Math.hypot(b[0] - a[2], b[1] - a[3]);
  if (left) return a[0] - b[2];
  if (right) return b[0] - a[2];
  if (bottom) return a[1] - b[3];
  if (top) return b[1] - a[3];
  return 0;
}

function normalizedReaderTextWithMap(text: string): {
  text: string;
  map: number[];
} {
  return normalizedReaderTokensWithMap(
    Array.from(text).map((char, index) => ({ char, index })),
  );
}

function normalizedReaderCharsWithMap(chars: any[]): {
  text: string;
  map: number[];
} {
  const tokens: Array<{ char: string; index: number }> = [];
  chars.forEach((char, index) => {
    if (!char || char.ignorable) return;
    if (typeof char.c === "string" && char.c) {
      tokens.push({ char: char.c, index });
    }
    if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) {
      tokens.push({ char: " ", index });
    }
  });
  return normalizedReaderTokensWithMap(tokens);
}

function normalizedReaderTokensWithMap(
  tokens: Array<{ char: string; index: number }>,
): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace: number | null = null;
  const pushSpace = () => {
    if (
      pendingSpace == null ||
      out.length === 0 ||
      out[out.length - 1] === " "
    ) {
      pendingSpace = null;
      return;
    }
    out.push(" ");
    map.push(pendingSpace);
    pendingSpace = null;
  };
  for (const token of tokens) {
    for (const raw of Array.from(token.char)) {
      if (/\s/u.test(raw)) {
        pendingSpace = token.index;
        continue;
      }
      pushSpace();
      out.push(raw.toLowerCase());
      map.push(token.index);
    }
  }
  if (out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  return { text: out.join(""), map };
}

function rectsFromReaderChars(chars: any[]): PdfRectTuple[] | null {
  const rects: PdfRectTuple[] = [];
  let current: PdfRectTuple | null = null;
  for (const char of chars) {
    if (!char || char.ignorable) continue;
    const rect = pdfRectFromChar(char);
    if (!rect) continue;
    current = current ? pdfRectUnion(current, rect) : rect;
    if (char.lineBreakAfter) {
      rects.push(current);
      current = null;
    }
  }
  if (current) rects.push(current);
  return rects.length ? rects : null;
}

function pdfRectUnion(left: PdfRectTuple, right: PdfRectTuple): PdfRectTuple {
  return [
    Math.min(left[0], right[0]),
    Math.min(left[1], right[1]),
    Math.max(left[2], right[2]),
    Math.max(left[3], right[3]),
  ];
}

function pdfRectCenterInside(
  rect: PdfRectTuple,
  target: PdfRectTuple,
): boolean {
  const x = (rect[0] + rect[2]) / 2;
  const y = (rect[1] + rect[3]) / 2;
  return (
    x >= Math.min(target[0], target[2]) &&
    x <= Math.max(target[0], target[2]) &&
    y >= Math.min(target[1], target[3]) &&
    y <= Math.max(target[1], target[3])
  );
}

function selectionSortIndex(
  pageIndex: number,
  offset: number,
  rects: PdfRectTuple[],
  viewBox: unknown,
): string {
  const topRect = rects[0] ?? [0, 0, 0, 0];
  const box = pdfRects([viewBox])[0];
  const pageHeight = box ? box[3] - box[1] : 0;
  const top = pageHeight > 0 ? Math.max(0, pageHeight - topRect[3]) : 0;
  return [
    String(Math.max(0, pageIndex)).padStart(5, "0"),
    String(Math.max(0, offset)).padStart(6, "0"),
    String(Math.max(0, Math.floor(top))).padStart(5, "0"),
  ].join("|");
}

function clonePlainForScope<T>(value: T, targetScope?: unknown): T {
  const plain = JSON.parse(JSON.stringify(value)) as T;
  try {
    const cloneInto = (globalThis as any).Components?.utils?.cloneInto;
    if (targetScope && typeof cloneInto === "function") {
      return cloneInto(plain, targetScope, {
        wrapReflectors: true,
        cloneFunctions: true,
      }) as T;
    }
  } catch {
    // Fall through to the plain object clone.
  }
  return plain;
}

function fullTextHighlightDisabledReason(
  win: Window | null,
  state: PanelState,
  preset: ModelPreset | null,
): string {
  if (!preset) return "请先配置并选择一个 OpenAI 模型";
  if (preset.provider !== "openai") return "全文重点 v1 仅支持 OpenAI 工具循环";
  if (state.agentPermissionMode !== "yolo")
    return "批量写注释需要先开启 YOLO 模式";
  if (!getActiveReaderForItem(win, state.itemID))
    return "请先在 Reader 中打开此 PDF";
  return "";
}

function renderMessages(doc: Document, mount: HTMLElement, state: PanelState) {
  const messages = el(doc, "div", "messages");
  messages.addEventListener("scroll", () => {
    const lockedScroll = activeMessagesScrollLock(state);
    if (lockedScroll) {
      scheduleMessagesScrollRestore(mount, lockedScroll);
      return;
    }
    state.messagesScrollTop = messages.scrollTop;
    state.autoFollowMessages = isMessagesElementNearBottom(messages);
  });
  if (state.messages.length === 0) {
    const hint = el(doc, "div", "bubble bubble-assistant bubble-hint");
    hint.append(
      el(doc, "div", "bubble-role", "AI"),
      el(
        doc,
        "div",
        "bubble-body",
        "已就绪。配置模型预设后，可以直接询问当前 Zotero 条目或 PDF 内容。",
      ),
    );
    messages.append(hint);
    return messages;
  }

  state.messages.forEach((message, index) =>
    messages.append(bubble(doc, mount, state, message, index)),
  );
  return messages;
}

function renderInput(doc: Document, mount: HTMLElement, state: PanelState) {
  const composer = el(doc, "div", "composer");
  const row = el(doc, "div", "input-row");
  const input = doc.createElement("textarea");
  input.rows = 3;
  const status = el(doc, "div", "composer-status");

  const preset = selectedChatPreset(state);
  const queueAllowed = queueWhileSendingEnabled(state);
  const canSubmit =
    !!preset?.apiKey && !!preset.model && (!state.sending || queueAllowed);
  input.placeholder = preset
    ? state.sending
      ? queueAllowed
        ? "AI 回答中…当前回复结束后将按顺序执行队列里的消息"
        : "AI 回答中…等待结束后再发送（设置可开启发送中排队）"
      : "问点什么... (Enter 发送，Shift+Enter 换行)"
    : "先添加一个模型预设。";
  input.disabled = !preset;
  input.value = state.draftText;
  input.style.height = "auto";
  const slashMenu = el(doc, "div", "slash-command-menu");
  slashMenu.style.display = "none";

  const updateStatus = (captureFocus = true) => {
    captureDraftFromInput(input, state, captureFocus);
    autoResizeInput(input);
    renderInputStatus(status, input, state);
    renderSlashCommandMenu(slashMenu, input, state);
  };

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    const slashTarget = activeSlashCommandTarget(input);
    const slashMatches = slashTarget
      ? matchingSlashCommands(slashTarget.token)
      : [];
    if (
      slashTarget &&
      slashMatches.length > 0 &&
      (event.key === "Enter" || event.key === "Tab")
    ) {
      event.preventDefault();
      applySlashCommand(input, state, slashTarget, slashMatches[0]);
      updateStatus();
      return;
    }
    if (slashTarget && event.key === "Escape") {
      slashMenu.style.display = "none";
      event.preventDefault();
      return;
    }
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.isComposing &&
      state.draftImages.length === 0
    ) {
      const next = navigateComposerPromptHistory(
        state,
        input.value,
        event.key === "ArrowUp" ? "previous" : "next",
      );
      if (next.handled) {
        event.preventDefault();
        input.value = next.value;
        input.selectionStart = input.value.length;
        input.selectionEnd = input.value.length;
        updateStatus();
        return;
      }
    }
    // Default: blocked while sending. Enable the "queue while sending"
    // toggle (UiSettings.composerQueueWhileSending) to allow Enter to
    // register new messages onto the queue. The actual queue handling is
    // sequential: streamAssistant sets state.sending = true for the duration
    // of one task, processNextQueuedChatTask only iterates once it returns
    // to false, so messages run strictly one-at-a-time after the current
    // task completes.
    const shouldSend =
      (!state.sending || queueWhileSendingEnabled(state)) &&
      event.key === "Enter" &&
      !event.isComposing &&
      (!event.shiftKey || event.ctrlKey || event.metaKey);
    if (shouldSend) {
      event.preventDefault();
      void sendMessage(
        mount,
        state,
        composerMessageContent(input.value, state),
        {
          fromComposer: true,
        },
      );
    }
  });

  input.addEventListener("input", () => {
    resetComposerPromptHistory(state);
    updateStatus();
  });
  for (const event of ["select", "click", "keyup", "focus"]) {
    input.addEventListener(event, () => updateStatus());
  }
  input.addEventListener("paste", (event: ClipboardEvent) => {
    const imageFiles = pastedImageFiles(event);
    if (imageFiles.length > 0) {
      event.preventDefault();
      resetComposerPromptHistory(state);
      void addDraftImages(input.ownerDocument!, state, imageFiles, input).then(
        () => {
          updateStatus(false);
          renderPanel(mount, state);
        },
      );
      return;
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!shouldCompactPastedText(text)) return;
    event.preventDefault();
    resetComposerPromptHistory(state);
    insertPastedTextMarker(input, state, text);
    updateStatus();
  });
  updateStatus(false);
  afterRender(mount, () => updateStatus(false));

  const inputStack = el(doc, "div", "input-stack");
  inputStack.append(
    renderDraftImages(doc, mount, state, input, { renderPanel }),
    slashMenu,
    input,
  );
  const composerSwitchers = el(doc, "div", "composer-switchers");
  composerSwitchers.append(renderWebSearchSwitcher(doc, mount, state));
  if (!getStoredSelectedText(state.itemID)) {
    composerSwitchers.append(renderPaperPinSwitcher(doc, mount, state));
  }
  row.append(inputStack, composerSwitchers);
  const imageAttach = renderImageAttachButton(
    doc,
    mount,
    state,
    input,
    updateStatus,
    { selectedChatPreset, renderPanel },
  );
  const screenshotAttach = renderScreenshotAttachButton(
    doc,
    mount,
    state,
    input,
    updateStatus,
    status,
    { selectedChatPreset, renderPanel },
  );

  const send = buttonEl(doc, state.sending ? "↑ 排队" : "↑");
  send.className = state.sending ? "send-btn send-queue-btn" : "send-btn";
  send.disabled = !canSubmit;
  send.title = preset
    ? !preset.apiKey || !preset.model
      ? "请先填写 API Key 和 Model ID"
      : state.sending
        ? "加入队列：当前回复结束后按顺序执行"
        : "发送"
    : "发送";
  send.setAttribute("aria-label", state.sending ? "加入队列" : "发送");
  send.addEventListener(
    "click",
    () =>
      void sendMessage(
        mount,
        state,
        composerMessageContent(input.value, state),
        { fromComposer: true },
      ),
  );
  row.append(send);
  if (state.sending) {
    const stop = buttonEl(doc, "停止");
    stop.className = "stop-btn";
    stop.addEventListener("click", () => {
      cancelActiveChatTask(mount, state);
    });
    row.append(stop);
  }
  const selectionChip = renderSelectionChip(doc, mount, state);
  if (selectionChip) row.prepend(selectionChip);
  composer.append(
    renderQuickPrompts(doc, mount, state),
    renderTaskQueue(doc, mount, state),
    row,
    renderComposerFooter(
      doc,
      mount,
      state,
      status,
      screenshotAttach,
      imageAttach,
    ),
  );
  return composer;
}

function composerMessageContent(raw: string, state: PanelState): string {
  return expandSlashCommandMessage(expandPasteMarkers(raw, state));
}

function queueWhileSendingEnabled(state: PanelState): boolean {
  return state.uiSettings.composerQueueWhileSending === true;
}

interface SlashCommandTarget {
  start: number;
  end: number;
  token: string;
}

function activeSlashCommandTarget(
  input: HTMLTextAreaElement,
): SlashCommandTarget | null {
  const start = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? start;
  if (start !== selectionEnd) return null;
  const beforeCursor = input.value.slice(0, start);
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const linePrefix = beforeCursor.slice(lineStart);
  if (!linePrefix.startsWith("/") || /\s/.test(linePrefix)) return null;
  const afterToken = input.value.slice(start).match(/^[^\s]*/)?.[0] ?? "";
  const end = start + afterToken.length;
  return {
    start: lineStart,
    end,
    token: input.value.slice(lineStart, end),
  };
}

function renderSlashCommandMenu(
  menu: HTMLElement,
  input: HTMLTextAreaElement,
  state: PanelState,
) {
  const target = activeSlashCommandTarget(input);
  const matches = target ? matchingSlashCommands(target.token) : [];
  if (matches.length === 0) {
    menu.style.display = "none";
    menu.replaceChildren();
    return;
  }

  const doc = input.ownerDocument!;
  menu.replaceChildren();
  matches.forEach((command, index) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "slash-command-item";
    if (index === 0) button.classList.add("slash-command-item-selected");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const latest = activeSlashCommandTarget(input);
      if (!latest) return;
      applySlashCommand(input, state, latest, command);
      captureDraftFromInput(input, state);
      renderSlashCommandMenu(menu, input, state);
      input.focus();
    });
    button.append(
      el(doc, "span", "slash-command-name", command.name),
      el(doc, "span", "slash-command-usage", command.usage),
      el(doc, "span", "slash-command-desc", slashCommandDescription(command)),
    );
    menu.append(button);
  });
  menu.style.display = "";
}

function applySlashCommand(
  input: HTMLTextAreaElement,
  state: PanelState,
  target: SlashCommandTarget,
  command: SlashCommand,
) {
  const before = input.value.slice(0, target.start);
  const after = input.value.slice(target.end);
  const insertion = `${command.name} `;
  input.value = `${before}${insertion}${after}`;
  const cursor = before.length + insertion.length;
  input.selectionStart = cursor;
  input.selectionEnd = cursor;
  captureDraftFromInput(input, state);
  autoResizeInput(input);
}

function slashCommandDescription(command: SlashCommand): string {
  const settings = loadToolSettings(zoteroPrefs());
  if (command.name === "/arxiv-search") {
    return `${command.description} 内置 arXiv 工具已可用；模型自行判断是否调用。`;
  }
  if (command.name === "/web-search" && settings.webSearchMode === "disabled") {
    return `${command.description} 可先点击输入框左下角“联网”启用。`;
  }
  return command.description;
}

// 方案 A: the PDF-selection indicator is a chip rendered INSIDE the composer
// box (as the first child of .input-row), not a separate bar above it — so it
// sits in the same place the eye and cursor already are when sending, and
// cannot be overlooked. Returns null when there is no selection.
function renderSelectionChip(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement | null {
  const selectedText = getStoredSelectedText(state.itemID);
  if (!selectedText) {
    resetTurnFullTextMode(state);
    state.turnContextSelectionPreviewOpen = false;
    return null;
  }

  const forced = isTurnFullTextForced(state, selectedText);
  const previewOpen = state.turnContextSelectionPreviewOpen;
  const wrap = el(doc, "div", "zai-sel-chip-wrap");
  const chip = el(
    doc,
    "div",
    forced ? "zai-sel-chip zai-sel-chip-forced" : "zai-sel-chip",
  );

  // Chip body — click to expand/collapse the verbatim selection preview.
  const body = doc.createElement("button");
  body.type = "button";
  body.className = "zai-sel-chip-body";
  body.title = "点击展开 / 收起，核对本轮会随消息发送的 PDF 选区原文";
  body.append(
    el(doc, "span", "zai-sel-chip-icon", forced ? "📄" : "🎯"),
    el(doc, "span", "zai-sel-chip-label", forced ? "选区+全文" : "选区"),
    el(
      doc,
      "span",
      "zai-sel-chip-text",
      selectedText.replace(/\s+/g, " ").trim(),
    ),
    el(doc, "span", "zai-sel-chip-peek", previewOpen ? "收起" : "点开核对"),
  );
  body.addEventListener("click", () => {
    state.turnContextSelectionPreviewOpen = !previewOpen;
    renderPanel(mount, state);
  });

  // + 本轮原文 — escalate this one turn to also send the whole paper.
  const fullText = doc.createElement("button");
  fullText.type = "button";
  fullText.className = "zai-sel-chip-action";
  fullText.textContent = forced ? "取消原文" : "+本轮原文";
  fullText.disabled = state.sending;
  fullText.title = forced
    ? "取消本轮全文，恢复只发送选区和附近上下文"
    : "仅本轮额外带入论文全文；发送后自动恢复";
  fullText.addEventListener("click", () => {
    if (forced) {
      resetTurnFullTextMode(state);
    } else {
      state.fullTextTurnMode = "force";
      state.fullTextTurnSelectionText = selectedText;
    }
    renderPanel(mount, state);
  });

  // ✕ — drop the selection from this turn (the PDF highlight is left alone).
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "zai-sel-chip-remove";
  remove.textContent = "✕";
  remove.disabled = state.sending;
  remove.title = "移除选区：本轮不发送，并同时取消 PDF 里的选中";
  remove.addEventListener("click", () => {
    ignoreSelectedTextForPrompt(mount, state.itemID);
    renderPanel(mount, state);
  });

  chip.append(body, fullText, remove);
  wrap.append(chip);
  if (previewOpen) {
    const preview = el(doc, "div", "zai-sel-chip-preview");
    preview.append(
      el(doc, "div", "zai-sel-chip-preview-title", "本轮会发送的 PDF 选区"),
      el(doc, "div", "zai-sel-chip-preview-body", selectedText),
    );
    wrap.append(preview);
  }
  return wrap;
}

function isTurnFullTextForced(
  state: PanelState,
  selectedText: string,
): boolean {
  if (state.fullTextTurnMode !== "force") return false;
  if (state.fullTextTurnSelectionText === selectedText) return true;
  // Reader extraction can normalize whitespace differently between the UI
  // snapshot and send-time snapshot. Keep the forced state when they are
  // effectively the same selected passage.
  return (
    normalizeSelectionForTurnMode(state.fullTextTurnSelectionText ?? "") ===
    normalizeSelectionForTurnMode(selectedText)
  );
}

function resetTurnFullTextMode(state: PanelState): void {
  state.fullTextTurnMode = "auto";
  state.fullTextTurnSelectionText = undefined;
}

function messagesContainPaperFrontBlock(messages: Message[]): boolean {
  return messages.some((message) => {
    const context = message.context;
    return (
      !!context?.fullTextChars &&
      context.planMode !== "reader_pdf_text" &&
      context.planMode !== "remote_paper"
    );
  });
}

function shouldExportWholePaperFrontBlock(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const context = messages[i].context;
    if (
      !context?.fullTextChars ||
      context.planMode === "reader_pdf_text" ||
      context.planMode === "remote_paper"
    ) {
      continue;
    }
    return (
      context.pinnedFullTextForced === true ||
      context.fullTextSource === "arxiv" ||
      context.fullTextSource === "pdf"
    );
  }
  return false;
}

function normalizeSelectionForTurnMode(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function renderComposerFooter(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  status: HTMLElement,
  screenshotAttach: HTMLElement,
  imageAttach: HTMLElement,
): HTMLElement {
  const footer = el(doc, "div", "composer-footer");
  const left = el(doc, "div", "composer-footer-left");
  const actions = el(doc, "div", "composer-footer-actions");
  left.append(status);
  actions.append(
    screenshotAttach,
    imageAttach,
    renderModelSwitcher(doc, mount, state),
    renderReasoningSwitcher(doc, mount, state),
    renderYoloToggle(doc, mount, state),
  );
  footer.append(left, actions);
  return footer;
}

function renderWebSearchSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const settings = loadToolSettings(zoteroPrefs());
  const preset = selectedChatPreset(state);
  const enabledForPreset = preset?.provider === "openai";
  const mode = settings.webSearchMode;
  const enabled = mode !== "disabled";
  const wrap = el(doc, "div", `web-search-switcher web-search-${mode}`);
  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "web-search-trigger";
  trigger.textContent = enabled ? "🌐 联网" : "＋ 联网";
  trigger.title = enabledForPreset
    ? webSearchToggleTitle(mode)
    : "联网工具目前仅对 OpenAI Responses 兼容配置生效";
  trigger.disabled = !enabledForPreset || state.sending;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const popup = el(doc, "div", "web-search-popup");
  popup.setAttribute("role", "menu");
  popup.style.display = "none";

  const closePopup = () => {
    if (popup.style.display === "none") return;
    popup.style.display = "none";
    trigger.setAttribute("aria-expanded", "false");
    doc.removeEventListener("mousedown", outsideHandler, true);
    doc.removeEventListener("keydown", escapeHandler, true);
  };
  const openPopup = () => {
    if (popup.style.display !== "none") return;
    popup.style.display = "";
    trigger.setAttribute("aria-expanded", "true");
    doc.addEventListener("mousedown", outsideHandler, true);
    doc.addEventListener("keydown", escapeHandler, true);
  };
  const outsideHandler = (event: Event) => {
    if (!wrap.contains(event.target as Node)) closePopup();
  };
  const escapeHandler = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closePopup();
      trigger.focus();
    }
  };

  const item = doc.createElement("button");
  item.type = "button";
  item.className = enabled
    ? "web-search-item web-search-item-active"
    : "web-search-item";
  item.setAttribute("role", "menuitemcheckbox");
  item.setAttribute("aria-checked", enabled ? "true" : "false");
  item.addEventListener("click", () => {
    closePopup();
    saveToolSettings(zoteroPrefs(), {
      ...settings,
      webSearchMode: enabled ? "disabled" : "live",
    });
    renderPanel(mount, state);
  });
  item.append(
    el(doc, "span", "web-search-item-icon", enabled ? "🌐" : "＋"),
    el(doc, "span", "web-search-item-main", "联网"),
    el(doc, "span", "web-search-item-check", enabled ? "✓" : ""),
    el(
      doc,
      "span",
      "web-search-item-detail",
      enabled ? "已开启；模式在设置中修改" : "点击开启；模式在设置中修改",
    ),
  );
  popup.append(item);

  trigger.addEventListener("click", () => {
    if (popup.style.display === "none") openPopup();
    else closePopup();
  });

  wrap.append(trigger, popup);
  return wrap;
}

function webSearchToggleTitle(mode: WebSearchMode): string {
  switch (mode) {
    case "cached":
      return "联网已开启：Cached；点击可关闭";
    case "live":
      return "联网已开启：Live；点击可关闭";
    default:
      return "联网已关闭；点击可开启";
  }
}

function renderPaperPinSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const on = state.paperPinned === true;
  const wrap = el(
    doc,
    "div",
    on ? "web-search-switcher web-search-live" : "web-search-switcher",
  );
  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "web-search-trigger";
  const hasItem = state.itemID != null;
  trigger.textContent = on ? "📄 原文" : "＋ 原文";
  trigger.title = !hasItem
    ? "请先在 Zotero 中选择一篇有 PDF 的论文"
    : on
      ? "原文固定已开启：PDF 条目每轮固定全文；arXiv 源条目默认固定章节目录，模型按需读取章节或升级全文。点击关闭。"
      : "点击开启：把论文原文上下文固定在每轮对话最前面；arXiv 源默认先固定章节目录以便缓存复用。";
  trigger.disabled = !hasItem || state.sending;
  trigger.addEventListener("click", () => {
    void togglePaperPinFromComposer(doc, mount, state);
  });
  wrap.append(trigger);
  return wrap;
}

async function togglePaperPinFromComposer(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): Promise<void> {
  if (state.itemID == null) return;
  const next = !state.paperPinned;
  if (!next) {
    const warning = await paperPinDisableWarning(state.itemID);
    if (!doc.defaultView?.confirm(warning)) return;
  }
  state.paperPinned = next;
  void setPaperPinned(state.itemID, next);
  renderPanel(mount, state);
}

async function paperPinDisableWarning(itemID: number): Promise<string> {
  const arxiv = await itemHasCachedArxivSource(itemID);
  if (arxiv) {
    return [
      "关闭 arXiv 论文「原文」？",
      "",
      "关闭后，每轮对话不会默认固定发送 arXiv LaTeX 章节目录。",
      "模型仍然可以按需调用 arxiv_get_section / arxiv_get_equation / arxiv_get_figure / arxiv_get_table 读取章节、公式、图和表格。",
      "",
      "影响：更省输入 token，但做全文总结、章节覆盖或公式/图表定位时，模型可能少读部分章节，需要额外工具调用。",
      "",
      "确定关闭吗？",
    ].join("\n");
  }
  return [
    "关闭普通 PDF「原文」？",
    "",
    "关闭后，每轮对话不会默认固定发送 PDF 全文。",
    "模型仍然可以在需要时调用 zotero_get_full_pdf 读取全文。",
    "",
    "影响：更省输入 token，但总结论文、提取全文重点或要求逐字原文依据时，回答可能缺少上下文，需要模型再按需读取。",
    "",
    "确定关闭吗？",
  ].join("\n");
}

async function itemHasCachedArxivSource(itemID: number): Promise<boolean> {
  const itemKey = getZoteroItem(itemID)?.key;
  return typeof itemKey === "string" ? await hasArxivSource(itemKey) : false;
}

// Composer-footer model switcher (Claudian-style).
// - 0 models in current preset → render nothing.
// - 1 model               → static label (user still sees WHICH model is in use).
// - 2+ models             → trigger button + upward popup. Click opens, picks
//                            mutate `preset.model` via upsertPreset + persist
//                            (so the choice is sticky across sessions). Outside
//                            click and Escape close the popup.
// REF: Claudian's footer model dropdown — same pattern.
function renderModelSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const preset = selectedChatPreset(state) ?? selectedPreset(state);
  const models = preset?.models ?? [];
  const wrap = el(doc, "div", "model-switcher");
  if (!preset || models.length === 0) {
    wrap.style.display = "none";
    return wrap;
  }
  const active =
    preset.model && models.includes(preset.model) ? preset.model : models[0];
  if (models.length === 1) {
    wrap.classList.add("model-switcher-static");
    wrap.title = `当前模型：${active}`;
    wrap.append(el(doc, "span", "model-switcher-label", active));
    return wrap;
  }

  const trigger = doc.createElement("button") as HTMLButtonElement;
  trigger.type = "button";
  trigger.className = "model-switcher-trigger";
  trigger.textContent = active;
  trigger.title = "切换当前预设的模型";
  trigger.disabled = state.sending;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const popup = el(doc, "div", "model-switcher-popup");
  popup.setAttribute("role", "menu");
  popup.style.display = "none";

  const closePopup = () => {
    if (popup.style.display === "none") return;
    popup.style.display = "none";
    trigger.setAttribute("aria-expanded", "false");
    doc.removeEventListener("mousedown", outsideHandler, true);
    doc.removeEventListener("keydown", escapeHandler, true);
  };
  const openPopup = () => {
    if (popup.style.display !== "none") return;
    popup.style.display = "";
    trigger.setAttribute("aria-expanded", "true");
    doc.addEventListener("mousedown", outsideHandler, true);
    doc.addEventListener("keydown", escapeHandler, true);
  };
  const outsideHandler = (event: Event) => {
    if (!wrap.contains(event.target as Node)) closePopup();
  };
  const escapeHandler = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closePopup();
      trigger.focus();
    }
  };

  for (const id of models) {
    const item = doc.createElement("button") as HTMLButtonElement;
    item.type = "button";
    item.className = "model-switcher-item";
    if (id === active) item.classList.add("model-switcher-item-active");
    item.textContent = id;
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", () => {
      closePopup();
      if (id === preset.model) return;
      upsertPreset(state, { ...preset, model: id });
      persist(state);
      updateToolbarOption(mount, { ...preset, model: id });
      renderPanel(mount, state);
    });
    popup.append(item);
  }

  trigger.addEventListener("click", () => {
    if (popup.style.display === "none") openPopup();
    else closePopup();
  });

  wrap.append(trigger, popup);
  return wrap;
}

function renderReasoningSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const preset = selectedChatPreset(state) ?? selectedPreset(state);
  const wrap = el(doc, "div", "reasoning-switcher");
  if (!preset) {
    wrap.style.display = "none";
    return wrap;
  }
  // Compat-vendor Anthropic presets never send a thinking field — show no
  // switcher to avoid implying control we don't actually have.
  if (
    preset.provider === "anthropic" &&
    (preset.extras?.vendor ?? "compat") === "compat"
  ) {
    wrap.style.display = "none";
    return wrap;
  }

  const persisted = preset.extras?.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  // DeepSeek effectively exposes only high/max — display low/medium as
  // their server-side mapped value so the trigger label matches reality.
  const active = collapseReasoningForPreset(preset, persisted);
  const trigger = doc.createElement("button") as HTMLButtonElement;
  trigger.type = "button";
  trigger.className = "reasoning-switcher-trigger";
  trigger.textContent = reasoningEffortShortLabel(active);
  trigger.title = `推理等级：${reasoningEffortLabel(active)}`;
  trigger.disabled = state.sending;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const popup = el(doc, "div", "reasoning-switcher-popup");
  popup.setAttribute("role", "menu");
  popup.style.display = "none";

  const closePopup = () => {
    if (popup.style.display === "none") return;
    popup.style.display = "none";
    trigger.setAttribute("aria-expanded", "false");
    doc.removeEventListener("mousedown", outsideHandler, true);
    doc.removeEventListener("keydown", escapeHandler, true);
  };
  const openPopup = () => {
    if (popup.style.display !== "none") return;
    popup.style.display = "";
    trigger.setAttribute("aria-expanded", "true");
    doc.addEventListener("mousedown", outsideHandler, true);
    doc.addEventListener("keydown", escapeHandler, true);
  };
  const outsideHandler = (event: Event) => {
    if (!wrap.contains(event.target as Node)) closePopup();
  };
  const escapeHandler = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closePopup();
      trigger.focus();
    }
  };

  for (const [value, label] of reasoningEffortOptionsForPreset(preset)) {
    const item = doc.createElement("button") as HTMLButtonElement;
    item.type = "button";
    item.className = "reasoning-switcher-item";
    if (value === active) item.classList.add("reasoning-switcher-item-active");
    item.textContent = label;
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", value === active ? "true" : "false");
    item.addEventListener("click", () => {
      closePopup();
      if (value === preset.extras?.reasoningEffort) return;
      const next = withReasoningEffort(preset, value);
      upsertPreset(state, next);
      persist(state);
      renderPanel(mount, state);
    });
    popup.append(item);
  }

  trigger.addEventListener("click", () => {
    if (popup.style.display === "none") openPopup();
    else closePopup();
  });

  wrap.append(trigger, popup);
  return wrap;
}

function renderYoloToggle(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const label = el(doc, "label", "yolo-toggle");
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.checked = state.agentPermissionMode === "yolo";
  input.addEventListener("change", () => {
    state.agentPermissionMode = input.checked ? "yolo" : "default";
    const preset = selectedPreset(state);
    if (preset) {
      upsertPreset(
        state,
        withAgentPermissionMode(preset, state.agentPermissionMode),
      );
      persist(state);
    }
    renderPanel(mount, state);
  });
  label.append(
    el(doc, "span", "yolo-toggle-text", "YOLO"),
    input,
    el(doc, "span", "yolo-toggle-track"),
  );
  label.title =
    state.agentPermissionMode === "yolo"
      ? "YOLO：本地工具无需审批直接执行"
      : "Default：需要审批的本地工具会被拦截";
  return label;
}

function renderCopyDebugToggle(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const label = el(doc, "label", "copy-debug-toggle yolo-toggle");
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.checked = state.copyDebugContext;
  input.addEventListener("change", () => {
    state.copyDebugContext = input.checked;
    renderPanel(mount, state);
  });
  label.append(
    el(doc, "span", "yolo-toggle-text", "调试"),
    input,
    el(doc, "span", "yolo-toggle-track"),
  );
  label.title = state.copyDebugContext
    ? "调试复制：包含工具上下文、PDF 片段和思考过程；关闭后只复制论文介绍和对话"
    : "纯净复制：只复制论文介绍和对话；开启后包含工具上下文、PDF 片段和思考过程";
  return label;
}

interface InputStatusPart {
  text: string;
  className?: string;
}

function renderInputStatus(
  status: HTMLElement,
  input: HTMLTextAreaElement,
  state: PanelState,
) {
  const parts = composeInputStatus(input, state);
  const doc = input.ownerDocument!;
  status.replaceChildren();
  for (const part of parts) {
    const node = doc.createElement("span");
    if (part.className) node.className = part.className;
    node.textContent = part.text;
    status.append(node);
  }
}

function composeInputStatus(
  input: HTMLTextAreaElement,
  state: PanelState,
): InputStatusPart[] {
  const cursor = cursorPosition(input.value, input.selectionStart ?? 0);
  const selected = Math.abs(
    (input.selectionEnd ?? 0) - (input.selectionStart ?? 0),
  );
  const parts: InputStatusPart[] = [
    { text: `Ln ${cursor.line}, Col ${cursor.column}` },
  ];
  if (selected > 0) {
    parts.push({
      text: `${selected} selected`,
      className: "composer-status-badge",
    });
  }
  if (state.pasteBlocks.length > 0) {
    const lines = state.pasteBlocks.reduce(
      (sum, block) => sum + block.lineCount,
      0,
    );
    parts.push({
      text: `Pasted ${state.pasteBlocks.length} (+${lines} lines)`,
      className: "composer-status-badge",
    });
  }
  if (state.draftImages.length > 0) {
    parts.push({
      text: `Images ${state.draftImages.length}`,
      className: "composer-status-badge composer-status-badge-image",
    });
  }
  return parts;
}

function cursorPosition(
  text: string,
  offset: number,
): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function autoResizeInput(input: HTMLTextAreaElement) {
  input.style.height = "auto";
  const maxHeight = 180;
  const next = Math.min(input.scrollHeight, maxHeight);
  input.style.height = `${next}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

interface SendMessageOptions {
  explainSelection?: boolean;
  ignoreSelection?: boolean;
  fullTextHighlight?: boolean;
  readingRoute?: boolean;
  fromComposer?: boolean;
  taskTitle?: string;
}

// User-message → wire-message pipeline.
// Responsibilities (in order, each one matters):
//   1. Trim & filter draft images (only images whose marker survives in
//      the final text are sent — the user can delete a marker mid-edit).
//   2. Skip if not configured: open the preset editor instead of erroring.
//   3. Capture the SELECTED PDF TEXT exactly once for selection-aware sends.
//      WHY: the user may type their question after selecting; locking
//      selection here makes the wire content match what the chip showed.
//      Full-paper quick actions opt out so a stray Reader selection does not
//      turn "总结论文" / "全文重点" into a selection-scoped request.
//   4. Snapshot the annotation draft for selection-annotation flows BEFORE
//      we append user message — `attachAnnotationDraft` will use the
//      snapshot regardless of how selection state evolves during streaming.
//   5. Reset draft state (text/images/scroll-anchor) to fresh defaults.
//   6. Persist BEFORE streaming so the user message is durable even if the
//      provider request errors out.
async function sendMessage(
  mount: HTMLElement,
  state: PanelState,
  text: string,
  options: SendMessageOptions = {},
) {
  const baseContent = text.trim();
  const preset = selectedChatPreset(state);
  const images = state.draftImages
    .filter((image) => text.includes(image.marker))
    .map((image) => ({ ...image }));
  if ((!baseContent && images.length === 0) || !preset) return;
  await ensureHistoryLoaded(mount, state);
  if (states.get(mount) !== state) return;
  if (!preset.apiKey || !preset.model) {
    openAddonPreferences(mount.ownerDocument!);
    return;
  }

  const rawSelectedText =
    options.ignoreSelection || options.fullTextHighlight || options.readingRoute
      ? ""
      : await getSelectedTextForPrompt(mount, state.itemID);
  const selectionPayload = options.explainSelection
    ? { selectedText: rawSelectedText, context: {} }
    : await buildSelectionPromptContext(rawSelectedText, state.itemID);
  const selectedText = selectionPayload.selectedText;
  const forcePinnedFullText =
    !!selectedText && state.fullTextTurnMode === "force";
  const quickPromptSettings = loadQuickPromptSettings(zoteroPrefs());
  const selectedSnapshot = cloneSelectionAnnotationDraft(
    getStoredSelectionAnnotation(state.itemID),
  );
  if (selectedSnapshot && selectedText) selectedSnapshot.text = selectedText;
  // Suggestion card (with color chip) is enabled for two paths:
  //   1. Explain-selection button — always, when a selection exists.
  //   2. Free-form selection question from composer — only if the user
  //      kept the prefs toggle on (default on).
  // Both share the same downstream handling: inject color guide into the
  // user message, ask the model to emit `建议颜色：#hex`, and validate the
  // hex on save.
  const annotationSuggestionEnabled =
    !!selectedText &&
    !!selectedSnapshot &&
    (options.explainSelection ||
      (options.fromComposer === true &&
        quickPromptSettings.selectionQuestionAnnotationEnabled));
  const selectionContext = selectedText ? selectionPayload.context : {};
  const annotationColorGuide = annotationSuggestionEnabled
    ? loadToolSettings(zoteroPrefs()).annotationColorGuide.trim()
    : "";
  const snapshot = annotationSuggestionEnabled ? selectedSnapshot : null;
  const userMessage: Message = {
    role: "user",
    content: baseContent,
    task: createChatTaskMeta(
      baseContent,
      options,
      selectedText,
      selectedSnapshot,
    ),
    ...(images.length ? { images } : {}),
    ...(selectedText
      ? {
          context: {
            selectedText,
            explainSelection: options.explainSelection,
            ...(forcePinnedFullText ? { pinnedFullTextForced: true } : {}),
            ...(annotationSuggestionEnabled && {
              annotationSuggestion: true,
            }),
            ...(annotationColorGuide ? { annotationColorGuide } : {}),
            // Capture the snapshot + color flag onto the message itself so
            // the queue processor can recover them later. Without this,
            // queued tasks would lose their anchor to the original PDF
            // selection (and the matching color-guide flag).
            ...(snapshot
              ? {
                  queuedAnnotationSnapshot: {
                    text: snapshot.text,
                    attachmentID: snapshot.attachmentID,
                    annotation: detachAnnotationSnapshot(snapshot.annotation),
                  },
                  queuedAnnotationColorEnabled: annotationSuggestionEnabled,
                }
              : {}),
            ...selectionContext,
          },
        }
      : {}),
  };
  const shouldQueue = state.sending;
  const isolatedExplainSelection = options.explainSelection === true;
  const history =
    shouldQueue || isolatedExplainSelection ? [] : state.messages.slice();
  state.messages.push(userMessage);
  state.draftText = "";
  state.draftSelectionStart = 0;
  state.draftSelectionEnd = 0;
  state.draftHadFocus = true;
  resetComposerPromptHistory(state);
  state.skipNextDraftCapture = true;
  state.pasteBlocks = [];
  state.draftImages = [];
  resetTurnFullTextMode(state);
  state.autoFollowMessages = true;
  state.scrollToBottom = true;
  void saveChatMessages(state.itemID, state.messages);
  if (shouldQueue) {
    state.queueOpen = true;
    renderPanel(mount, state);
    return;
  }
  await streamAssistant(mount, state, history, userMessage, {
    annotationSnapshot: snapshot,
    annotationColorEnabled: annotationSuggestionEnabled,
    fullTextHighlight: options.fullTextHighlight,
    readingRoute: options.readingRoute,
    isolatedHistory: isolatedExplainSelection,
    taskID: userMessage.task?.id,
  });
  void processNextQueuedChatTask(mount, state);
}

async function processNextQueuedChatTask(
  mount: HTMLElement,
  state: PanelState,
): Promise<void> {
  if (state.processingQueuedTask) return;
  state.processingQueuedTask = true;
  try {
    while (states.get(mount) === state && !state.sending) {
      const next = firstQueuedChatTask(state);
      if (!next) break;
      const userMessage = state.messages[next.userIndex];
      if (!userMessage || userMessage.role !== "user") break;
      const isolatedHistory = userMessage.context?.explainSelection === true;
      const history = isolatedHistory
        ? []
        : state.messages.slice(0, next.userIndex);
      // Restore whatever annotation context was captured at queue time.
      // INVARIANT: a queued message always uses the PDF selection that was
      // active when it was submitted, NEVER the live selection now —
      // otherwise users would see "建议注释" cards aimed at whatever's
      // currently highlighted in the Reader, which is rarely what they
      // typed against minutes ago.
      const queuedSnapshot = userMessage.context?.queuedAnnotationSnapshot;
      await streamAssistant(mount, state, history, userMessage, {
        annotationSnapshot: queuedSnapshot
          ? {
              text: queuedSnapshot.text,
              attachmentID: queuedSnapshot.attachmentID,
              annotation: detachAnnotationSnapshot(queuedSnapshot.annotation),
            }
          : null,
        annotationColorEnabled:
          userMessage.context?.queuedAnnotationColorEnabled === true,
        fullTextHighlight: userMessage.task?.kind === "full_text",
        readingRoute: userMessage.task?.kind === "reading_route",
        isolatedHistory,
        taskID: userMessage.task?.id,
      });
    }
  } finally {
    state.processingQueuedTask = false;
  }
}

function firstQueuedChatTask(state: PanelState): ChatTaskView | null {
  for (const view of visibleChatTasks(state)
    .slice()
    .sort((a, b) => a.task.createdAt - b.task.createdAt)) {
    if (view.status === "queued") return view;
  }
  return null;
}

async function buildSelectionPromptContext(
  selectedText: string,
  itemID: number | null,
): Promise<{
  selectedText: string;
  context: Partial<NonNullable<Message["context"]>>;
}> {
  if (!selectedText || itemID == null) {
    return { selectedText, context: {} };
  }

  try {
    const pdfText = await zoteroContextSource.getFullText(itemID);
    if (!pdfText) return { selectedText, context: {} };
    return {
      selectedText,
      context: buildSelectionNearbyContextFromPdfText(selectedText, pdfText),
    };
  } catch (err) {
    debugZai("selection.context.failed", {
      error: errorMessage(err),
      raw: textDebugInfo(selectedText, 120),
    });
    return { selectedText, context: {} };
  }
}

function buildSelectionNearbyContextFromPdfText(
  selectedText: string,
  pdfText: string,
): Partial<NonNullable<Message["context"]>> {
  const query = selectionContextQuery(selectedText);
  if (!query) return {};
  const matches = searchPdfPassages(
    pdfText,
    query,
    contextPolicy.searchCandidateCount,
    contextPolicy,
  );
  const best = matches[0];
  if (!best) return {};

  const range = extractPdfRange(
    pdfText,
    Math.max(0, best.start - SELECTION_CONTEXT_RADIUS_CHARS),
    best.end + SELECTION_CONTEXT_RADIUS_CHARS,
    contextPolicy,
  );
  if (!range) return {};

  return {
    query,
    candidatePassageCount: matches.length,
    selectedPassageNumbers: [1],
    passageSelectorSource: "fallback",
    passageSelectionReason:
      "当前 PDF 选区自动检索原文位置，并附带命中位置附近上下文",
    retrievedPassages: [range],
  };
}

function selectionContextQuery(selectedText: string): string {
  return selectedText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SELECTION_CONTEXT_QUERY_CHARS);
}

function cloneSelectionAnnotationDraft(
  draft: SelectionAnnotationDraft | null,
): SelectionAnnotationDraft | null {
  if (!draft) return null;
  return {
    text: draft.text,
    attachmentID: draft.attachmentID,
    annotation: detachAnnotationSnapshot(draft.annotation),
  };
}

// Detaches a Reader-event annotation payload from the iframe compartment it
// was emitted in. WHY: Zotero Reader emits `annotation` objects whose nested
// `position` (and `position.rects`) are iframe-scope references. If we keep
// just `{ ...annotation }` in our cache, those nested refs survive the
// initial save but become inaccessible after the iframe re-renders or its
// next save cycle — subsequent reads then throw "Permission denied to pass
// object to privileged code", which is what produced the "first save works,
// second save fails" pattern. JSON round-tripping at capture time copies the
// data into the addon compartment as plain values, immune to whatever the
// Reader iframe does later. The try/catch is a safety net for the rare case
// where the source object is already partially detached at capture time.
function detachAnnotationSnapshot(
  annotation: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(annotation));
  } catch {
    return { ...annotation };
  }
}

function createChatTaskMeta(
  content: string,
  options: SendMessageOptions,
  selectedText: string,
  selectedSnapshot: SelectionAnnotationDraft | null,
): ChatTaskMeta {
  const pdfSelection =
    selectedText && selectedSnapshot
      ? pdfSelectionLocatorFromDraft(selectedSnapshot, selectedText)
      : null;
  return {
    id: makeTaskID(),
    kind: pdfSelection
      ? "selection"
      : options.fullTextHighlight
        ? "full_text"
        : options.readingRoute
          ? "reading_route"
          : "general",
    title:
      options.taskTitle ||
      (pdfSelection ? "选中文字提问" : contentPreview(content, 14) || "提问"),
    promptPreview: contentPreview(selectedText || content, 90),
    createdAt: Date.now(),
    ...(pdfSelection ? { pdfSelection } : {}),
  };
}

function pdfSelectionLocatorFromDraft(
  draft: SelectionAnnotationDraft,
  selectedText: string,
): PdfSelectionLocator | null {
  const position = clonePlainRecord(draft.annotation.position);
  if (!position) return null;
  const pageIndex =
    typeof position.pageIndex === "number" &&
    Number.isFinite(position.pageIndex)
      ? Math.floor(position.pageIndex)
      : undefined;
  return {
    attachmentID: draft.attachmentID,
    selectedText,
    ...(pageIndex != null
      ? { pageIndex, pageLabel: String(pageIndex + 1) }
      : {}),
    position,
  };
}

function makeTaskID(): string {
  return `task-${Date.now()}-${Zotero.Utilities.randomString(6)}`;
}

function contentPreview(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 1)}…`
    : normalized;
}

interface StreamAssistantOptions {
  annotationSnapshot?: SelectionAnnotationDraft | null;
  annotationColorEnabled?: boolean;
  fullTextHighlight?: boolean;
  readingRoute?: boolean;
  isolatedHistory?: boolean;
  taskID?: string;
}

// streamAssistant: the project's OUTER loop wrapping the provider's inner
// tool loop. Codex parallel: this is where the Zotero plugin sits in the
// place of Codex's `runner` — owning tool sessions, chunk dispatch, UI
// state transitions, and persistence.
//
// Stage state machine on `activeAssistantStage`:
//   building_context → waiting_model → using_tool ⇄ waiting_model →
//   thinking ⇄ writing → (cleared on finish/error)
// Each transition triggers a re-render so the user sees what's happening.
//
// INVARIANT: `void saveChatMessages(...)` fires on every tool_call chunk.
// WHY persist mid-stream: if Zotero crashes during a long tool loop, the
// thread still has the user message + tool traces accumulated so far.
// (CLAUDE.md "Show Zotero tool-call traces visibly in the conversation".)
//
// INVARIANT: `toolSession.dispose()` MUST run in the finally block —
// the locator session holds a memoized PdfLocator that pins page bundles
// in memory. Skipping dispose leaks across turns.
async function streamAssistant(
  mount: HTMLElement,
  state: PanelState,
  history: Message[],
  userMessage: Message,
  options: StreamAssistantOptions = {},
) {
  const preset = selectedChatPreset(state);
  if (!preset || state.sending) return;

  state.sending = true;
  state.autoFollowMessages = true;
  state.scrollToBottom = true;
  state.focusInput = true;
  renderPanel(mount, state);
  const userIndex = state.messages.indexOf(userMessage);
  const assistantIndex = userIndex >= 0 ? userIndex + 1 : state.messages.length;
  const assistant: Message = { role: "assistant", content: "" };
  let readingRouteMarkdown = "";
  if (options.readingRoute) {
    assistant.content = readingRouteProgressMessage(0);
  }
  state.messages.splice(assistantIndex, 0, assistant);
  state.activeAssistantIndex = assistantIndex;
  state.activeAssistantStage = "building_context";
  state.activeTaskID = options.taskID;
  state.scrollToBottom = true;
  state.focusInput = true;
  renderPanel(mount, state);

  const controllerCtor = mount.ownerDocument!.defaultView!.AbortController;
  const controller = new controllerCtor();
  state.abort = controller;
  let toolSession: ZoteroAgentToolSession | null = null;

  try {
    const effectiveHistory = options.isolatedHistory ? [] : history;
    const contextLedger = formatContextLedger(effectiveHistory);
    const forcePinnedFullText =
      userMessage.context?.pinnedFullTextForced === true;
    if (userMessage.context?.selectedText) {
      const hasNearbyContext = !!userMessage.context.retrievedPassages?.length;
      userMessage.context = {
        ...userMessage.context,
        planMode: "selected_text",
        plannerSource: "selected",
        planReason: forcePinnedFullText
          ? "用户本轮点击“+ 本轮原文”，PDF 选区、附近上下文和论文全文一起发送；长期“原文”状态不变"
          : hasNearbyContext
            ? "只看选区：本轮只发送 PDF 选区和附近上下文，不带全文"
            : "只看选区：本轮只发送 PDF 选区，不带全文",
      };
    }
    const retainedStats = retainedContextStats(
      [...effectiveHistory, userMessage],
      userMessage,
      contextPolicy,
    );
    if (retainedStats.count > 0) {
      userMessage.context = {
        ...userMessage.context,
        retainedContextCount: retainedStats.count,
        retainedContextChars: retainedStats.chars,
      };
    }
    if (!options.isolatedHistory && contextLedger !== "none") {
      userMessage.context = {
        ...userMessage.context,
        promptCacheLedger: contextLedger,
      };
    }
    // Download the arXiv LaTeX source (if this is an arXiv item and not
    // already cached) before context assembly, so getFullText can prefer it.
    // A false result must not block analysis — the PDF flow proceeds normally.
    let arxivSourceUsed = false;
    if (state.itemID != null) {
      arxivSourceUsed = await ensureArxivSourceForItem(state.itemID);
    }
    const baseContext = await buildSystemContextOnly(state.itemID);
    const pinnedFullText = await resolvePinnedFullText(
      state.itemID,
      zoteroContextSource,
      contextPolicy,
      {
        force: forcePinnedFullText,
        suppressPinned:
          !!userMessage.context?.selectedText && !forcePinnedFullText,
      },
    );
    if (pinnedFullText) {
      const fullTextSource = isArxivTocBlock(pinnedFullText)
        ? "arxiv_toc"
        : arxivSourceUsed && forcePinnedFullText
          ? "arxiv"
          : "pdf";
      const frontBlockDebugPath = await saveDebugFrontBlockForState(
        state,
        pinnedFullText,
        fullTextSource,
      );
      const planReason = forcePinnedFullText
        ? "用户本轮点击“+ 本轮原文”，PDF 选区、附近上下文和论文全文一起发送；长期“原文”状态不变"
        : (userMessage.context?.planReason ??
          (fullTextSource === "arxiv_toc"
            ? "手动“原文”开关已开启；当前为 arXiv 源，先发送稳定章节目录，模型按需调用 arxiv_get_section、arxiv_get_equation、arxiv_get_figure、arxiv_get_table、arxiv_get_bibliography 或 zotero_get_full_pdf 读取正文/公式/图/表格/参考文献"
            : "手动“原文”开关已开启，论文全文作为前置块发送"));
      userMessage.context = {
        ...userMessage.context,
        planMode: forcePinnedFullText
          ? "full_pdf"
          : (userMessage.context?.planMode ?? "full_pdf"),
        planReason,
        sourceKind: userMessage.context?.sourceKind ?? "zotero_item",
        sourceID:
          userMessage.context?.sourceID ??
          (state.itemID != null ? String(state.itemID) : undefined),
        fullTextChars: pinnedFullText.length,
        fullTextSource,
        ...(frontBlockDebugPath ? { frontBlockDebugPath } : {}),
        rangeStart: userMessage.context?.rangeStart ?? 0,
        rangeEnd: userMessage.context?.rangeEnd ?? pinnedFullText.length,
      };
    }
    // Build a fresh tool session per turn. WHY per-turn (not cached):
    // - Reader's PDF.js text layer can change between turns (user opens a
    //   different attachment); a stale locator would point at the wrong PDF.
    // - `selectionAnnotation` is a getter, so the tool sees the snapshot
    //   that's CURRENT when the model invokes the write tool, not at
    //   session-creation time.
    toolSession = createZoteroAgentToolSession({
      source: zoteroContextSource,
      itemID: state.itemID,
      policy: contextPolicy,
      previousMessages: effectiveHistory,
      selectionAnnotation: () => getStoredSelectionAnnotation(state.itemID),
      fullTextHighlight: options.fullTextHighlight,
      annotationColorGuide:
        loadToolSettings(zoteroPrefs()).annotationColorGuide,
      debugFullTextSaver: state.copyDebugContext
        ? (text, meta) => saveDebugFrontBlockForState(state, text, meta.source)
        : undefined,
      getActiveReader: () =>
        getReaderForCurrentSelection(
          mount.ownerDocument!.defaultView,
          state.itemID,
        ),
      // Curry the live document and itemID so the model writes to whatever
      // is selected at call time (not at session-creation time). Refresh
      // the visible note panel after the write so the user sees the
      // append immediately, matching the manual button's UX.
      onMindmapReady: (data) => {
        const idx = state.activeAssistantIndex;
        if (idx != null) state.messages[idx].mindmap = data;
      },
      onOverviewReady: (data) => {
        // Persist + sync, then refresh the 总揽 panel view if it is open.
        // The overview is NOT shown in the chat — it lives in its own
        // middle-column view (showOverviewWindow).
        const itemKey = resolveItemKeyForCache(state.itemID);
        const sb = findSidebarStateByDocument(mount.ownerDocument!);
        const saved = itemKey ? saveOverview(itemKey, data) : Promise.resolve();
        void saved.then(() => {
          if (sb?.overviewActive) void showOverviewWindow(sb);
        });
      },
      appendToChildNote: async (content) => {
        const noteScroll = captureVisibleNoteScrollForDocument(
          mount.ownerDocument!,
        );
        armVisibleNoteRestoreForDocument(
          mount.ownerDocument!,
          noteScroll,
          "tool-write:before-insert",
        );
        const result = await appendAssistantContentToItemNote(
          mount.ownerDocument!,
          state.itemID,
          content,
        );
        refreshVisibleNoteWindow(
          mount.ownerDocument!,
          result.noteID,
          noteScroll,
        );
        return result;
      },
    });
    const toolsForTurn = pinnedFullText
      ? toolsForPinnedFullTextTurn(toolSession.tools, userMessage, options)
      : toolSession.tools;
    const promptCacheKey = buildPromptCacheKey(preset, state.itemID);
    const relayRoutingItemKey = resolveItemKeyForCache(state.itemID);
    userMessage.context = {
      ...userMessage.context,
      promptCacheDebug: buildPromptCacheDebug({
        preset,
        promptCacheKey,
        systemPrompt: baseContext.systemPrompt,
        pinnedFullText,
        tools: toolsForTurn,
      }),
    };
    state.scrollToBottom = state.autoFollowMessages;
    state.activeAssistantStage = "waiting_model";
    renderPanel(mount, state);

    const messagesForApi: Message[] = toApiMessages(
      [...effectiveHistory, userMessage],
      {
        message: userMessage,
      },
      contextPolicy,
    );
    const currentApiMessage = messagesForApi[messagesForApi.length - 1];
    if (pinnedFullText && typeof currentApiMessage?.content === "string") {
      userMessage.context = {
        ...userMessage.context,
        promptCacheWireContent: currentApiMessage.content,
        promptCacheDebug: userMessage.context?.promptCacheDebug
          ? {
              ...userMessage.context.promptCacheDebug,
              replayContentHash: shortHash(currentApiMessage.content),
              replayContentChars: currentApiMessage.content.length,
            }
          : undefined,
      };
    }

    for await (const chunk of getProvider(preset).stream(
      messagesForApi,
      baseContext.systemPrompt,
      preset,
      controller.signal,
      {
        tools: toolsForTurn,
        maxToolIterations: contextPolicy.maxToolIterations,
        permissionMode: state.agentPermissionMode,
        toolSettings: loadToolSettings(zoteroPrefs()),
        promptCacheKey,
        relayRoutingItemKey,
        ...(pinnedFullText ? { pinnedFullText } : {}),
      },
    )) {
      if (chunk.type === "text_delta") {
        state.activeAssistantStage = "writing";
        state.activeAssistantDetail = undefined;
        if (options.readingRoute) {
          readingRouteMarkdown += chunk.text;
          assistant.content = readingRouteProgressMessage(
            readingRouteMarkdown.length,
          );
        } else {
          assistant.content += chunk.text;
        }
        updateMessageBubble(mount, assistantIndex, assistant);
      } else if (chunk.type === "thinking_delta") {
        state.activeAssistantStage = "thinking";
        state.activeAssistantDetail = undefined;
        assistant.thinking = `${assistant.thinking ?? ""}${chunk.text}`;
        updateMessageBubble(mount, assistantIndex, assistant);
      } else if (chunk.type === "tool_call") {
        state.activeAssistantStage =
          chunk.status === "started" ? "using_tool" : "waiting_model";
        state.activeAssistantDetail = undefined;
        recordToolCall(userMessage, chunk);
        void saveChatMessages(state.itemID, state.messages);
        state.scrollToBottom = state.autoFollowMessages;
        renderPanel(mount, state);
      } else if (chunk.type === "tool_images") {
        assistant.images = [...(assistant.images ?? []), ...chunk.images];
        updateMessageBubble(mount, assistantIndex, assistant);
      } else if (chunk.type === "status") {
        state.activeAssistantStage = "waiting_model";
        state.activeAssistantDetail = chunk.message;
        updateMessageBubble(mount, assistantIndex, assistant);
      } else if (chunk.type === "usage") {
        assistant.usage = mergeMessageUsage(assistant.usage, chunk);
        updateMessageBubble(mount, assistantIndex, assistant);
      } else if (chunk.type === "error") {
        state.activeAssistantDetail = undefined;
        markMessageTaskError(userMessage, chunk.message);
        assistant.content += `\n[Error] ${chunk.message}`;
        updateMessageBubble(mount, assistantIndex, assistant);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAbortError(err) || controller.signal.aborted) {
      if (!assistant.content.trim()) {
        assistant.content = "已取消本次回答。";
      }
      markMessageTaskCancelled(userMessage);
    } else {
      markMessageTaskError(userMessage, message);
      assistant.content += `\n[Error] ${message}`;
    }
    updateMessageBubble(mount, assistantIndex, assistant);
  } finally {
    toolSession?.dispose();
    markMessageTaskCompleted(userMessage);
    if (options.annotationSnapshot) {
      attachAnnotationDraft(
        assistant,
        options.annotationSnapshot,
        !!options.annotationColorEnabled,
      );
    }
    if (shouldSaveReadingRoute(options, userMessage, readingRouteMarkdown)) {
      await saveReadingRouteAndReplaceChatMessage(
        mount.ownerDocument!,
        state.itemID,
        assistant,
        readingRouteMarkdown,
      );
    }
    state.sending = false;
    state.abort = undefined;
    state.activeAssistantIndex = undefined;
    state.activeAssistantStage = undefined;
    state.activeAssistantDetail = undefined;
    state.activeTaskID = undefined;
    state.cancellingTaskID = undefined;
    void saveChatMessages(state.itemID, state.messages);
    state.scrollToBottom = state.autoFollowMessages;
    state.focusInput = true;
    renderPanel(mount, state);
  }
}

function shouldSaveReadingRoute(
  options: StreamAssistantOptions,
  userMessage: Message,
  routeMarkdown: string,
): boolean {
  return (
    options.readingRoute === true &&
    !!routeMarkdown.trim() &&
    !userMessage.task?.error &&
    !userMessage.task?.cancelledAt
  );
}

function mergeMessageUsage(
  current: Message["usage"] | undefined,
  next: { input: number; output: number; cacheRead?: number },
): Message["usage"] {
  const cacheRead =
    current?.cacheRead == null && next.cacheRead == null
      ? undefined
      : (current?.cacheRead ?? 0) + Math.max(0, next.cacheRead ?? 0);
  return {
    input: (current?.input ?? 0) + Math.max(0, next.input || 0),
    output: (current?.output ?? 0) + Math.max(0, next.output || 0),
    ...(cacheRead != null ? { cacheRead } : {}),
  };
}

function readingRouteProgressMessage(generatedChars: number): string {
  return [
    "正在生成阅读路线，完整内容会保存到「AI 阅读路线」笔记。",
    "",
    "- 读取题录信息和 PDF 正文",
    "- 按 Keshav 三遍阅读法规划阅读顺序",
    "- 生成后自动写入并打开专用阅读路线笔记",
    generatedChars > 0 ? `- 已生成内容：${generatedChars} 字` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function saveReadingRouteAndReplaceChatMessage(
  doc: Document,
  itemID: number | null,
  assistant: Message,
  routeMarkdown: string,
): Promise<void> {
  const markdown = routeMarkdown.trim();
  debugZai("reading-route.chat-save:start", {
    itemID,
    markdown: textDebugInfo(markdown),
    markdownChars: readingRouteStringDiagnostics(markdown),
  });
  try {
    const result = await saveReadingRouteToDedicatedNote(doc, itemID, markdown);
    try {
      await showNoteWindow(doc, result.note);
      assistant.content = [
        "阅读路线已保存到「AI 阅读路线」笔记，并已在右侧打开。",
        "",
        `- 状态：${result.created ? "已新建专用笔记" : "已更新专用笔记"}`,
        `- 目标笔记：#${result.note.id}`,
        "- 重新生成：在阅读路线笔记顶部点击「更新路线」，可覆盖 AI 生成区并保留「我的补充笔记」。",
      ].join("\n");
    } catch (openErr) {
      const openMessage =
        openErr instanceof Error ? openErr.message : String(openErr);
      assistant.content = [
        "阅读路线已保存到「AI 阅读路线」笔记，但右侧打开失败。",
        "",
        `- 目标笔记：#${result.note.id}`,
        `- 打开失败：${openMessage}`,
      ].join("\n");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugZai("reading-route.chat-save:failed", {
      itemID,
      error: readingRouteErrorDebugInfo(err),
      markdown: textDebugInfo(markdown),
      markdownChars: readingRouteStringDiagnostics(markdown),
    });
    assistant.content = [
      "阅读路线已生成，但保存到「AI 阅读路线」笔记失败。",
      "",
      `- 保存失败：${message}`,
      "- 完整内容没有在对话框展开，以避免和笔记重复；请重试生成。",
    ].join("\n");
  }
}

// Splits the assistant's text into (body, annotationDraft) using the
// `建议注释` parser. The marker block is REMOVED from `assistant.content`
// (assigned to `parsed.body`) so the chat bubble doesn't show the
// suggestion text twice — once in the prose, once in the suggestion
// card. The `snapshot` carries the PDF anchor that was live when the
// turn started; we deep-copy `annotation` so the saved draft is
// invariant under later selection changes.
function attachAnnotationDraft(
  assistant: Message,
  snapshot: SelectionAnnotationDraft,
  colorEnabled: boolean,
) {
  const parsed = parseAnnotationSuggestion(assistant.content);
  if (!parsed.comment) return;
  const color = colorEnabled ? allowedAnnotationColor(parsed.color) : null;
  assistant.content = parsed.body;
  assistant.annotationDraft = {
    comment: parsed.comment,
    ...(color ? { color } : {}),
    snapshot: {
      text: snapshot.text,
      attachmentID: snapshot.attachmentID,
      annotation: detachAnnotationSnapshot(snapshot.annotation),
    },
    state: { kind: "idle" },
  };
}

function markMessageTaskCompleted(message: Message) {
  if (!message.task || message.task.completedAt) return;
  message.task.completedAt = Date.now();
}

function markMessageTaskCancelled(message: Message) {
  if (!message.task) return;
  const now = Date.now();
  message.task.cancelledAt ??= now;
  message.task.completedAt ??= now;
}

function markMessageTaskError(message: Message, error: string) {
  if (!message.task) return;
  message.task.error = error;
  message.task.completedAt ??= Date.now();
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && /abort/i.test(err.name)) ||
    (err instanceof Error && /abort/i.test(err.message))
  );
}

function allowedAnnotationColor(color: string | null): string | null {
  if (!color) return null;
  const allowed = configuredAnnotationColors();
  return allowed.has(color.toLowerCase()) ? color.toLowerCase() : null;
}

function configuredAnnotationColors(): Set<string> {
  const guide = loadToolSettings(zoteroPrefs()).annotationColorGuide;
  return new Set(
    (guide.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((hex) => hex.toLowerCase()),
  );
}

// Ensures the arXiv LaTeX source is downloaded for an item (idempotent;
// cached after first success). Returns true when a source cache is available.
async function ensureArxivSourceForItem(itemID: number): Promise<boolean> {
  const item = getZoteroItem(itemID);
  if (!item || typeof item.key !== "string") return false;
  // arXiv papers imported as a PDF often carry the arXiv URL on the PDF
  // ATTACHMENT, not the parent item — so gather metadata from both.
  const sources: NonNullable<ReturnType<typeof getZoteroItem>>[] = [item];
  try {
    for (const attID of item.getAttachments?.() ?? []) {
      const att = getZoteroItem(attID);
      if (att) sources.push(att);
    }
  } catch {
    // attachment enumeration is best-effort
  }
  const pick = (field: string): string | undefined => {
    for (const src of sources) {
      const value = src.getField?.(field);
      if (value) return value;
    }
    return undefined;
  };
  const ok = await ensureArxivSource({
    itemKey: item.key,
    fields: {
      extra: pick("extra"),
      url: pick("url"),
      doi: pick("DOI"),
      archiveID: pick("archiveID"),
    },
  });
  if (ok) {
    // The arXiv LaTeX source supersedes any frozen PDF full text — clear the
    // stale freeze so normal context assembly uses the compact TOC, while
    // explicit full-text requests can re-extract the source body.
    try {
      await freezeFullText(itemID, "");
    } catch {
      // best-effort
    }
  }
  return ok;
}

// When the "原文" toggle is on for this item, resolve the frozen full text to
// pin as the provider front block. If pinned but nothing is frozen yet (user
// toggled on before any fetch), extract once and freeze. Returns undefined
// when not pinned or when no PDF text is available.
async function resolvePinnedFullText(
  itemID: number | null,
  source: ContextSource,
  policy: ContextPolicy,
  options: { force?: boolean; suppressPinned?: boolean } = {},
): Promise<string | undefined> {
  if (itemID == null) return undefined;
  if (!options.force) {
    if (options.suppressPinned) return undefined;
    if (!(await isPaperPinned(itemID))) return undefined;
    // For arXiv items, the default pinned block is a compact TOC, not the
    // full source. Keep it out of the generic full-text cache so
    // zotero_get_full_pdf can still upgrade to the actual LaTeX body.
    const tocBlock = await buildArxivTocFrontBlock(itemID);
    if (tocBlock) return tocBlock;
  }
  const frozen = await getFrozenFullText(itemID);
  if (frozen != null && !isArxivTocBlock(frozen)) return frozen;
  const pdfText = await source.getFullText(itemID);
  if (!pdfText) return undefined;
  const text = truncateByTokenBudget(pdfText, policy.fullPdfTokenBudget);
  await freezeFullText(itemID, text);
  return text;
}

async function saveDebugFrontBlockForState(
  state: Pick<PanelState, "copyDebugContext" | "itemID">,
  text: string,
  source: "arxiv" | "arxiv_toc" | "pdf",
): Promise<string | undefined> {
  if (!state.copyDebugContext) return undefined;
  try {
    const path = await saveFrontBlockDebugFileOnce({
      enabled: true,
      itemID: state.itemID,
      source,
      text,
    });
    if (path) {
      debugZai("prompt.front_block.debug_file", {
        path,
        source,
        chars: text.length,
      });
    }
    return path;
  } catch (err) {
    debugZai("prompt.front_block.debug_file.failed", {
      source,
      chars: text.length,
      error: errorMessage(err),
    });
    return undefined;
  }
}

async function buildSystemContextOnly(
  itemID: number | null,
): Promise<{ systemPrompt: string }> {
  const ctx = await buildContext(zoteroContextSource, itemID, 0);
  return {
    systemPrompt: contextAwareSystemPrompt(ctx.systemPrompt),
  };
}

// Builds the system prompt sent to the model each turn.
// Two static sections, in order:
//   1. Item-metadata block (from buildContext): title/authors/year/abstract.
//   2. "Agent policy" block: tells the model what tools exist and that the
//      harness — not the model — enforces budgets. Plain English so we
//      don't hide tool semantics in JSON schema alone.
// Dynamic context ledgers are attached to user turns instead of this prompt,
// matching Codex's append-only prefix strategy for prompt caching.
function contextAwareSystemPrompt(systemPrompt: string): string {
  const toolManual = toolManualWithConfiguredGuides();
  return `${systemPrompt}\n\n${toolManual}`;
}

// Resolve the portable Zotero item key (e.g. "FQRVCCJN") for an itemID.
// Returns null when no item is selected or the key cannot be read. Local
// numeric itemIDs differ across machines (sync assigns them per-database),
// so anything that affects upstream relay routing or cross-machine cache
// hits must key by itemKey, not itemID.
function resolveItemKeyForCache(itemID: number | null): string | null {
  if (itemID == null) return null;
  try {
    const item = (
      globalThis as unknown as {
        Zotero?: { Items?: { get?: (id: number) => { key?: string } | null } };
      }
    ).Zotero?.Items?.get?.(itemID);
    const key = typeof item?.key === "string" ? item.key : "";
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

function buildPromptCacheKey(
  preset: ModelPreset,
  itemID: number | null,
): string {
  // WHY itemKey instead of itemID in the cache key: prompt_cache_key drives
  // sticky-session routing on self-hosted OpenAI relays (e.g.
  // claude-relay-service hashes it to pin requests to a backend Codex
  // account). Local itemIDs differ across machines via Zotero sync, which
  // splits the same paper into two cache keys → two backends → one machine
  // may consistently hit a dead account while the other works. Using the
  // portable itemKey makes routing identical across machines and also lets
  // long-prefix OpenAI prompt cache hits accumulate cross-machine.
  const itemKey = resolveItemKeyForCache(itemID);
  const itemPart =
    itemKey != null
      ? `item-${itemKey}`
      : itemID != null
        ? `item-${itemID}`
        : "global";
  return [
    "zai",
    preset.provider,
    preset.id || "preset",
    preset.model || "model",
    itemPart,
  ].join(":");
}

async function promptCacheTestTextForCurrentItem(
  itemID: number | null,
): Promise<{ text: string; label: string }> {
  if (itemID != null) {
    try {
      const pdfText = await zoteroContextSource.getFullText(itemID);
      if (pdfText.trim()) {
        return {
          text: truncateByTokenBudget(pdfText, 16_000),
          label: `当前 PDF / item-${itemID}`,
        };
      }
    } catch (err) {
      debugZai("prompt_cache_test.full_text.failed", {
        itemID,
        error: errorMessage(err),
      });
    }
  }
  const text = Array.from(
    { length: 700 },
    (_, i) =>
      `Cache smoke paragraph ${i}: SAMURAI motion-aware memory tracking fixed-prefix test.`,
  ).join("\n");
  return { text, label: "内置长文本" };
}

type PresetFlagBadge = {
  text: string;
  title: string;
  tone: "ok" | "warn" | "muted";
};

function presetFlagBadges(preset: ModelPreset): PresetFlagBadge[] {
  if (preset.provider !== "openai") {
    return [
      {
        text: "Anthropic",
        title: "当前不是 OpenAI 兼容预设",
        tone: "muted",
      },
    ];
  }
  const official = isOfficialOpenAIEndpointForDebug(preset);
  const relayCache = shouldSendRelayPromptCacheForDebug(preset);
  return [
    official
      ? {
          text: "官方 OpenAI",
          title: "api.openai.com：使用官方 prompt_cache_key 机制",
          tone: "ok",
        }
      : {
          text: "非官方/Relay",
          title:
            "非 api.openai.com endpoint：按 relay 兼容策略处理，可用于自建或第三方 OpenAI-compatible 服务",
          tone: "warn",
        },
    official
      ? {
          text: supportsExtendedPromptCacheForDebug(preset.model)
            ? "cache_key + 24h"
            : "cache_key",
          title:
            "官方 endpoint 自动发送 prompt_cache_key；支持的模型会加 24h retention",
          tone: "ok",
        }
      : relayCache
        ? {
            text: "relay cache 自动",
            title:
              "非官方 endpoint 默认发送 prompt_cache_key + session_id；若缓存测试发现不兼容会自动关闭",
            tone: "ok",
          }
        : {
            text: "relay cache 已关闭",
            title: "该预设已标记为不发送 prompt_cache_key/session_id",
            tone: "muted",
          },
  ];
}

function presetFlagBadge(doc: Document, flag: PresetFlagBadge): HTMLElement {
  const badge = el(
    doc,
    "span",
    `preset-flag preset-flag-${flag.tone}`,
    flag.text,
  );
  badge.title = flag.title;
  return badge;
}

function presetFlagHint(preset: ModelPreset): string {
  if (preset.provider !== "openai") return "非 OpenAI 兼容预设。";
  if (isOfficialOpenAIEndpointForDebug(preset)) {
    return "官方 endpoint：自动使用官方 prompt_cache_key。";
  }
  if (shouldSendRelayPromptCacheForDebug(preset)) {
    return "非官方 endpoint：默认发送 prompt_cache_key + session_id；缓存测试失败会自动关闭。";
  }
  return "非官方 endpoint：relay cache 已禁用；缓存测试可重新验证。";
}

function buildPromptCacheDebug(args: {
  preset: ModelPreset;
  promptCacheKey: string;
  systemPrompt: string;
  pinnedFullText?: string;
  tools: Array<{ name: string; parameters: { [key: string]: unknown } }>;
}): NonNullable<NonNullable<Message["context"]>["promptCacheDebug"]> {
  const { preset, promptCacheKey, systemPrompt, pinnedFullText, tools } = args;
  const officialOpenAI =
    preset.provider === "openai" && isOfficialOpenAIEndpointForDebug(preset);
  const relayPromptCache =
    preset.provider === "openai" && shouldSendRelayPromptCacheForDebug(preset);
  const requestPath =
    preset.provider === "openai"
      ? preset.extras?.openaiUseChatCompletions
        ? "openai.chat_completions"
        : "openai.responses"
      : "anthropic.messages";
  const toolsShape = tools.map((tool) => ({
    name: tool.name,
    parameters: tool.parameters,
  }));
  const frontBlockText = pinnedFullText
    ? `[Paper full text]\n${pinnedFullText}`
    : "";
  const reasoning = reasoningDebugForPreset(preset, requestPath);
  const promptCacheKeySent =
    preset.provider === "openai" && (officialOpenAI || relayPromptCache);
  const promptCacheRetention =
    officialOpenAI && supportsExtendedPromptCacheForDebug(preset.model)
      ? "24h"
      : undefined;
  return {
    provider: preset.provider,
    requestPath,
    endpoint: endpointForDebug(preset),
    model: preset.model || "(empty)",
    presetID: preset.id || "(empty)",
    promptCacheKey,
    promptCacheKeySent,
    ...(promptCacheRetention ? { promptCacheRetention } : {}),
    promptCacheMechanism:
      preset.provider === "anthropic"
        ? "Anthropic cache_control on system/front-block text"
        : promptCacheKeySent
          ? relayPromptCache
            ? "Relay prompt_cache_key + session_id header"
            : `OpenAI prompt_cache_key${promptCacheRetention ? " + 24h retention" : ""}`
          : "prompt_cache_key not sent: non-official OpenAI-compatible endpoint; relay caching depends on model/request shape",
    reasoningSent: reasoning.sent,
    reasoningDetail: reasoning.detail,
    toolsSent: tools.map((tool) => tool.name),
    toolsHash: shortHash(JSON.stringify(toolsShape)),
    systemPromptHash: shortHash(systemPrompt),
    ...(frontBlockText
      ? {
          frontBlockHash: shortHash(frontBlockText),
          frontBlockChars: pinnedFullText?.length ?? 0,
        }
      : {}),
    stablePrefixHash: shortHash(
      JSON.stringify({
        provider: preset.provider,
        requestPath,
        model: preset.model || "",
        systemPrompt,
        frontBlockText,
        toolsShape,
        reasoningShape: reasoning.shape,
      }),
    ),
  };
}

function reasoningDebugForPreset(
  preset: ModelPreset,
  requestPath: string,
): { sent: boolean; detail: string; shape: unknown } {
  if (preset.provider !== "openai") {
    return {
      sent: false,
      detail: "provider is not OpenAI Responses",
      shape: null,
    };
  }
  if (requestPath === "openai.chat_completions") {
    const effort = preset.extras?.reasoningEffort;
    if (!effort || effort === "none") {
      return {
        sent: false,
        detail: "chat completions reasoning_effort omitted",
        shape: null,
      };
    }
    const sentEffort = effort === "xhigh" ? "high" : effort;
    return {
      sent: true,
      detail: `chat completions reasoning_effort=${sentEffort}`,
      shape: { reasoning_effort: sentEffort },
    };
  }
  if (isOfficialOpenAIEndpointForDebug(preset)) {
    const shape = responsesReasoningShapeForDebug(preset);
    return {
      sent: true,
      detail: responsesReasoningDetail(shape),
      shape,
    };
  }
  if (preset.extras?.omitResponsesReasoningForCache === true) {
    return {
      sent: false,
      detail:
        "explicit relay cache-priority option enabled; Responses reasoning omitted",
      shape: null,
    };
  }
  const shape = responsesReasoningShapeForDebug(preset);
  return {
    sent: true,
    detail: `${responsesReasoningDetail(shape)}; non-official endpoint still respects selected reasoning`,
    shape,
  };
}

function responsesReasoningShapeForDebug(preset: ModelPreset): {
  effort: ReasoningEffort;
  summary?: Exclude<ReasoningSummary, "none">;
} {
  const summary = preset.extras?.reasoningSummary ?? DEFAULT_REASONING_SUMMARY;
  return {
    effort: preset.extras?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    ...(summary === "none" ? {} : { summary }),
  };
}

function responsesReasoningDetail(
  shape: ReturnType<typeof responsesReasoningShapeForDebug>,
): string {
  return [
    `responses reasoning.effort=${shape.effort}`,
    shape.summary ? `summary=${shape.summary}` : "summary omitted",
  ].join(", ");
}

function endpointForDebug(preset: ModelPreset): string {
  const baseUrl = preset.baseUrl.trim();
  if (baseUrl) return baseUrl;
  if (preset.provider === "openai")
    return "https://api.openai.com/v1 (default)";
  return "(provider default)";
}

function isOfficialOpenAIEndpointForDebug(preset: ModelPreset): boolean {
  const baseUrl = preset.baseUrl.trim();
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function shouldSendRelayPromptCacheForDebug(preset: ModelPreset): boolean {
  return (
    !isOfficialOpenAIEndpointForDebug(preset) &&
    preset.extras?.enableRelayPromptCache !== false
  );
}

function supportsExtendedPromptCacheForDebug(model: string): boolean {
  return /^(gpt-5|gpt-4\.1)(?:[.-]|$)/i.test(model.trim());
}

function shortHash(value: string): string {
  // FNV-1a over UTF-16 code units is enough for human debug fingerprints.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toolManualWithConfiguredGuides(): string {
  const guide = loadToolSettings(zoteroPrefs()).annotationColorGuide.trim();
  if (!guide) return ZOTERO_TOOL_MANUAL;
  return `${ZOTERO_TOOL_MANUAL}\n\nConfigured PDF annotation color presets:\n${guide}`;
}

// Tool-trace upsert. Each chunk that comes from the provider stream is
// either status="started" (push a new trace) or "completed"/"error"
// (replace the most recent `started` trace with the same name).
//
// INVARIANT: this works because OpenAI is configured with
// `parallel_tool_calls: false` — at most ONE in-flight tool per name at a
// time. If we ever enable parallel calls, this needs a call_id key.
//
// `chunk.context` is also merged into the user message's context so the
// MessageContext for that turn accumulates plan-mode/range/passages from
// every tool the model invoked. The user-message context is the "fact
// sheet" shown in the assistant-process collapsible.
function recordToolCall(
  message: Message,
  chunk: {
    name: string;
    status: "started" | "completed" | "error";
    summary?: string;
    context?: Message["context"];
  },
) {
  const previousTools = message.context?.toolCalls ?? [];
  const nextTools = previousTools.slice();
  const trace = {
    name: chunk.name,
    status: chunk.status,
    summary: chunk.summary,
  };

  let replaced = false;
  if (chunk.status !== "started") {
    for (let index = nextTools.length - 1; index >= 0; index--) {
      const tool = nextTools[index];
      if (tool.name === chunk.name && tool.status === "started") {
        nextTools[index] = trace;
        replaced = true;
        break;
      }
    }
  }
  if (!replaced && chunk.status === "started") {
    for (let index = nextTools.length - 1; index >= 0; index--) {
      const tool = nextTools[index];
      if (tool.name === chunk.name && tool.status === "started") {
        nextTools[index] = trace;
        replaced = true;
        break;
      }
    }
  }
  if (!replaced) nextTools.push(trace);

  message.context = {
    ...mergeToolContext(message.context, chunk.context),
    toolCalls: nextTools,
  };
}

function mergeToolContext(
  previous: Message["context"],
  next: Message["context"],
): Message["context"] {
  if (!next) return previous;
  const merged = {
    ...previous,
    ...next,
  };
  if (previous?.retrievedPassages?.length || next.retrievedPassages?.length) {
    const passages = [
      ...(previous?.retrievedPassages ?? []),
      ...(next.retrievedPassages ?? []),
    ];
    const seen = new Set<string>();
    merged.retrievedPassages = passages.filter((passage) => {
      const key = `${passage.start}:${passage.end}:${passage.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return merged;
}

// Retry the last assistant turn. INVARIANT: we REUSE the existing user
// message (with its captured selection/context) — re-deriving selection
// from the live Reader at retry time would silently change what the
// model sees vs the original turn. The user expects "retry" to give a
// new answer to the SAME question, not re-trigger context capture.
//
// Carries the previous assistant's `annotationDraft.snapshot` forward as
// `annotationSnapshot`. WHY: if the original turn was an explainSelection
// flow, the regenerated answer should still be anchored to the same PDF
// passage so the new "建议注释" suggestion can be saved at the same spot.
async function regenerateLastResponse(mount: HTMLElement, state: PanelState) {
  if (state.sending) return;
  await ensureHistoryLoaded(mount, state);
  if (states.get(mount) !== state) return;

  const assistantIndex = findLastAssistantIndex(state.messages);
  if (assistantIndex < 0) return;
  const userIndex = findPreviousUserIndex(state.messages, assistantIndex);
  if (userIndex < 0) return;

  const userMessage = state.messages[userIndex];
  const previousAssistant = state.messages[assistantIndex];
  const carriedSnapshot = previousAssistant.annotationDraft?.snapshot ?? null;
  const history = state.messages.slice(0, userIndex);
  resetChatTaskForRetry(userMessage);
  state.messages = [...history, userMessage];
  void saveChatMessages(state.itemID, state.messages);
  await streamAssistant(mount, state, history, userMessage, {
    annotationSnapshot: carriedSnapshot
      ? {
          text: carriedSnapshot.text,
          attachmentID: carriedSnapshot.attachmentID,
          annotation: { ...carriedSnapshot.annotation },
        }
      : null,
    readingRoute: userMessage.task?.kind === "reading_route",
    taskID: userMessage.task?.id,
  });
}

function resetChatTaskForRetry(message: Message) {
  if (!message.task) return;
  message.task.createdAt = Date.now();
  delete message.task.completedAt;
  delete message.task.viewedAt;
  delete message.task.hiddenAt;
  delete message.task.cancelledAt;
  delete message.task.error;
}

async function loadPersistedMessages(mount: HTMLElement, state: PanelState) {
  if (state.historyLoaded) return;
  const messages = await loadChatMessages(state.itemID);
  const paperPinned =
    state.itemID != null ? await isPaperPinned(state.itemID) : false;
  if (states.get(mount) !== state || state.sending) return;
  // Tombstone any task that was running/queued when Zotero last closed.
  // Without this, a `task` lacking both `completedAt` and `cancelledAt`
  // looks "queued" forever and `processNextQueuedChatTask` never picks it
  // up (no sendMessage triggers it on cold start) — UI would show "排队
  // 中" badges for ghosts. Marking them cancelled is the conservative
  // choice: the user can manually retry via 重试 if they actually wanted
  // those tasks to run, but we don't auto-fire untrusted API calls on
  // boot.
  const cancelledStale = cancelStaleQueuedTasks(messages);
  state.messages = messages;
  state.historyLoaded = true;
  state.paperPinned = paperPinned;
  state.scrollToBottom = true;
  if (cancelledStale > 0) {
    void saveChatMessages(state.itemID, state.messages);
  }
  renderPanel(mount, state);
}

function cancelStaleQueuedTasks(messages: Message[]): number {
  const now = Date.now();
  let cancelled = 0;
  for (const message of messages) {
    if (message.role !== "user" || !message.task) continue;
    const task = message.task;
    if (task.completedAt || task.cancelledAt) continue;
    task.cancelledAt = now;
    task.error = "Zotero 重启时被中断";
    cancelled += 1;
  }
  return cancelled;
}

async function ensureHistoryLoaded(mount: HTMLElement, state: PanelState) {
  if (state.historyLoaded) return;
  await loadPersistedMessages(mount, state);
}

// Selection state machine
// =====================================================================
// Three concurrent maps track PDF text selection per Zotero item ID:
//   selectedTextByItem        — current selection text from the Reader.
//   selectedAnnotationByItem  — Zotero annotation snapshot (for the write
//                                tool zotero_add_annotation_to_selection).
//   ignoredSelectedTextByItem — text the user dismissed via the chip's
//                                "x" button. Stored so the polling monitor
//                                doesn't immediately re-arm the same text.
//
// Sources of selection updates:
//   1. Zotero `renderTextSelectionPopup` event → `rememberReaderSelection`
//      (event-driven, fires when the user finishes a drag-select).
//   2. SELECTION_MONITOR_MS poll → `refreshActiveReaderSelection`
//      (catches keyboard-driven selection and selection-clear).
// Hybrid because Reader doesn't fire a clear event when a selection ends.
//
// INVARIANT: an item is keyed by parent-item-id where possible (see
// `readerItemIDs`); the same selection appears under both parent and
// attachment IDs so the chip survives switching between them.

async function getSelectedTextForPrompt(
  mount: HTMLElement,
  itemID: number | null,
): Promise<string> {
  const win = mount.ownerDocument?.defaultView;
  const reader = getActiveReader(win);
  const ids = readerItemIDs(reader, itemID);
  const draft = firstUsableStoredSelectionAnnotation(ids);
  const rangeText = getActiveReaderSelectionRangeText(reader);
  const visualSelection = getActiveReaderVisualSelection(reader);
  const visualText =
    visualSelection.source === "dom-rects" ? visualSelection.text : "";
  const liveText = getActiveReaderSelection(reader);
  if (rangeText) {
    rememberReaderSelection(reader, itemID, rangeText, draft?.annotation);
  } else if (liveText) {
    rememberReaderSelection(reader, itemID, liveText);
  }
  const rectText = draft
    ? await extractSelectionTextFromAnnotationPosition(reader, draft)
    : "";
  if (rectText && draft) {
    rememberReaderSelection(reader, itemID, rectText, draft.annotation);
  }
  const storedText = firstUsableStoredSelectedText(ids);
  const selectedText =
    rangeText ||
    rectText ||
    visualText ||
    liveText ||
    draft?.text ||
    storedText;
  debugZai("selection.official-text", {
    chosen: rangeText
      ? "reader-selection-ranges"
      : rectText
        ? "position-rects"
        : visualText
          ? visualSelection.source
          : liveText
            ? "live"
            : draft?.text
              ? "reader-event"
              : "stored",
    range: textDebugInfo(rangeText, 120),
    visual: textDebugInfo(visualSelection.text, 120),
    visualSource: visualSelection.source,
    visualRects: visualSelection.rectCount,
    rectText: textDebugInfo(rectText, 120),
    live: textDebugInfo(liveText, 120),
    readerEvent: textDebugInfo(draft?.text ?? "", 120),
    stored: textDebugInfo(storedText, 120),
  });
  return selectedText && !shouldIgnoreSelectedText(ids, selectedText)
    ? selectedText
    : "";
}

function getStoredSelectedText(itemID: number | null): string {
  if (itemID == null) return "";
  const text = selectedTextByItem.get(itemID) ?? "";
  return text && ignoredSelectedTextByItem.get(itemID) !== text ? text : "";
}

function getStoredSelectionAnnotation(
  itemID: number | null,
): SelectionAnnotationDraft | null {
  if (itemID == null) return null;
  const draft = selectedAnnotationByItem.get(itemID) ?? null;
  return draft && ignoredSelectedTextByItem.get(itemID) !== draft.text
    ? draft
    : null;
}

// `clearWhenEmpty` distinguishes the two callers:
// - Polling monitor (focusInSidebar=false ⇒ true): if the Reader has no
//   live selection AND the user is interacting with the sidebar, clear
//   stored selection so the chip disappears once the user starts typing.
// - Send-time read (false): keep the stored selection so a click on the
//   composer doesn't drop the selection chip the user just made.
function refreshActiveReaderSelection(
  win: Window | null | undefined,
  itemID: number | null,
  clearWhenEmpty: boolean,
): string {
  const reader = getActiveReader(win);
  const ids = readerItemIDs(reader, itemID);
  const text = getActiveReaderSelection(reader);
  if (text) {
    rememberReaderSelection(reader, itemID, text);
    return shouldIgnoreSelectedText(ids, text) ? "" : text;
  }
  if (clearWhenEmpty) {
    clearStoredSelectedText(ids);
    return "";
  }
  return firstUsableStoredSelectedText(ids);
}

function getActiveReaderSelection(reader: unknown): string {
  const r = reader as any;
  return firstText([
    safeSelectionText(r?._internalReader?._primaryView?._iframeWindow),
    safeSelectionText(r?._internalReader?._secondaryView?._iframeWindow),
    safeSelectionText(r?._iframeWindow),
  ]);
}

function getActiveReaderSelectionRangeText(reader: unknown): string {
  for (const view of activeReaderViews(reader as any)) {
    const text = selectionRangeTextFromView(view);
    if (text) return text;
  }
  return "";
}

function activeReaderViews(reader: any): any[] {
  const views: any[] = [];
  const add = (view: unknown) => {
    if (view && !views.includes(view)) views.push(view);
  };
  add(reader?._internalReader?._primaryView);
  add(reader?._internalReader?._secondaryView);
  return views;
}

function selectionRangeTextFromView(view: any): string {
  const ranges: any[] = Array.isArray(view?._selectionRanges)
    ? view._selectionRanges
    : [];
  if (!ranges.length || ranges[0]?.collapsed) return "";
  const parts = ranges
    .slice()
    .sort(selectionRangeOrder)
    .map((range) => textFromSelectionRange(view, range))
    .filter(Boolean);
  return normalizeSelectedText(parts.join("\n"));
}

function selectionRangeOrder(left: any, right: any): number {
  const leftPage = selectionRangePageIndex(left);
  const rightPage = selectionRangePageIndex(right);
  if (leftPage !== rightPage) return leftPage - rightPage;
  return selectionRangeStartOffset(left) - selectionRangeStartOffset(right);
}

function textFromSelectionRange(view: any, range: any): string {
  const pageIndex = selectionRangePageIndex(range);
  const chars = charsForReaderPage(view, pageIndex);
  const start = selectionRangeStartOffset(range);
  const end = selectionRangeEndOffset(range);
  if (
    chars.length &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start
  ) {
    return textFromReaderChars(chars.slice(start, end));
  }
  return typeof range?.text === "string" ? range.text : "";
}

function selectionRangePageIndex(range: any): number {
  const pageIndex =
    range?.position?.pageIndex ?? range?.pageIndex ?? range?.positionPageIndex;
  return typeof pageIndex === "number" && Number.isFinite(pageIndex)
    ? Math.floor(pageIndex)
    : 0;
}

function selectionRangeStartOffset(range: any): number {
  return Math.min(
    selectionRangeOffset(range?.anchorOffset),
    selectionRangeOffset(range?.headOffset),
  );
}

function selectionRangeEndOffset(range: any): number {
  return Math.max(
    selectionRangeOffset(range?.anchorOffset),
    selectionRangeOffset(range?.headOffset),
  );
}

function selectionRangeOffset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function charsForReaderPage(view: any, pageIndex: number): any[] {
  const pages = view?._pdfPages;
  const page = Array.isArray(pages)
    ? pages[pageIndex]
    : pages?.[String(pageIndex)];
  return Array.isArray(page?.chars) ? page.chars : [];
}

function textFromReaderChars(chars: any[]): string {
  const text: string[] = [];
  for (const char of chars) {
    if (!char || char.ignorable) continue;
    if (typeof char.c === "string") text.push(char.c);
    if (char.paragraphBreakAfter) {
      text.push("\n\n");
    } else if (char.lineBreakAfter) {
      text.push("\n");
    } else if (char.spaceAfter) {
      text.push(" ");
    }
  }
  return text.join("").trim();
}

interface VisualSelectionSnapshot {
  text: string;
  rectCount: number;
  source: string;
}

interface VisualCharFragment {
  char: string;
  rect: DOMRect;
  key: string;
}

function getActiveReaderVisualSelection(
  reader: unknown,
): VisualSelectionSnapshot {
  for (const win of activeReaderWindows(reader as any)) {
    const snapshot = visualSelectionFromWindow(win);
    if (snapshot.text) return snapshot;
  }
  return { text: "", rectCount: 0, source: "" };
}

function visualSelectionFromWindow(win: Window): VisualSelectionSnapshot {
  try {
    const selection = win.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return { text: "", rectCount: 0, source: "" };
    }
    const rects = selectionClientRects(selection);
    const visualText = normalizeSelectedText(
      extractVisualTextFromClientRects(win.document, rects),
    );
    const rawText = normalizeSelectedText(selection.toString());
    if (isUsableVisualSelectionText(visualText, rawText)) {
      return {
        text: visualText,
        rectCount: rects.length,
        source: "dom-rects",
      };
    }
    return {
      text: rawText,
      rectCount: rects.length,
      source: rawText ? "dom-selection" : "",
    };
  } catch (err) {
    debugZai("selection.visual.failed", { error: errorMessage(err) });
    return { text: "", rectCount: 0, source: "" };
  }
}

function selectionClientRects(selection: Selection): DOMRect[] {
  const rects: DOMRect[] = [];
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index);
    rects.push(
      ...clientRectArray(range.getClientRects()).filter(isUsefulClientRect),
    );
  }
  return rects;
}

function isUsableVisualSelectionText(
  visualText: string,
  rawText: string,
): boolean {
  if (!visualText) return false;
  if (!rawText) return visualText.length >= 2;
  if (visualText === rawText) return true;
  return visualText.length >= Math.max(12, rawText.length * 0.25);
}

function extractVisualTextFromClientRects(
  doc: Document,
  selectionRects: DOMRect[],
): string {
  if (!selectionRects.length) return "";
  const bounds = unionClientRects(selectionRects);
  const fragments = visualCharFragments(doc, selectionRects, bounds);
  return textFromVisualFragments(fragments);
}

function visualCharFragments(
  doc: Document,
  selectionRects: DOMRect[],
  bounds: DOMRect,
): VisualCharFragment[] {
  const fragments: VisualCharFragment[] = [];
  const seen = new Set<string>();
  const range = doc.createRange();
  const nodes = collectSelectionTextNodes(doc, bounds);
  nodes.forEach((node, nodeIndex) => {
    const text = node.nodeValue ?? "";
    for (const segment of textCodeUnitSegments(text)) {
      const char = text.slice(segment.start, segment.end);
      if (!char.trim()) continue;
      try {
        range.setStart(node, segment.start);
        range.setEnd(node, segment.end);
      } catch {
        continue;
      }
      const rect = bestOverlappingClientRect(
        clientRectArray(range.getClientRects()).filter(isUsefulClientRect),
        selectionRects,
      );
      if (!rect) continue;
      const key = `${nodeIndex}:${segment.start}:${segment.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fragments.push({ char, rect, key });
    }
  });
  range.detach?.();
  return fragments;
}

function collectSelectionTextNodes(doc: Document, bounds: DOMRect): Text[] {
  const roots = (
    Array.from(doc.querySelectorAll(".textLayer")) as Element[]
  ).filter((root) => clientRectListOverlaps(root.getClientRects(), bounds));
  const searchRoots: Node[] = roots.length ? roots : doc.body ? [doc.body] : [];
  const nodes: Text[] = [];
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  for (const root of searchRoots) {
    const walker = doc.createTreeWalker(root, showText);
    let current = walker.nextNode();
    while (current) {
      if (current.nodeType === 3) {
        const text = current as Text;
        if (
          text.nodeValue?.trim() &&
          text.parentElement &&
          clientRectListOverlaps(text.parentElement.getClientRects(), bounds)
        ) {
          nodes.push(text);
        }
      }
      current = walker.nextNode();
    }
  }
  return nodes;
}

function textFromVisualFragments(fragments: VisualCharFragment[]): string {
  if (!fragments.length) return "";
  const rows: Array<{
    y: number;
    height: number;
    chars: VisualCharFragment[];
  }> = [];
  const sorted = fragments
    .slice()
    .sort(
      (a, b) =>
        clientRectMidY(a.rect) - clientRectMidY(b.rect) ||
        a.rect.left - b.rect.left,
    );

  for (const fragment of sorted) {
    const y = clientRectMidY(fragment.rect);
    const height = Math.max(fragment.rect.height, 1);
    const row = rows.find(
      (candidate) =>
        Math.abs(candidate.y - y) <= Math.max(2, Math.min(8, height * 0.6)),
    );
    if (row) {
      row.chars.push(fragment);
      row.height = Math.max(row.height, height);
      row.y = (row.y + y) / 2;
    } else {
      rows.push({ y, height, chars: [fragment] });
    }
  }

  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => visualRowText(row.chars, row.height))
    .filter(Boolean)
    .join(" ");
}

function visualRowText(chars: VisualCharFragment[], rowHeight: number): string {
  const sorted = chars
    .slice()
    .sort((a, b) => a.rect.left - b.rect.left || a.key.localeCompare(b.key));
  let output = "";
  let previous: VisualCharFragment | null = null;
  for (const fragment of sorted) {
    if (previous) {
      const gap = fragment.rect.left - previous.rect.right;
      if (
        gap > Math.max(2, rowHeight * 0.22) &&
        shouldInsertVisualSpace(previous.char, fragment.char)
      ) {
        output += " ";
      }
    }
    output += fragment.char;
    previous = fragment;
  }
  return output.trim();
}

function shouldInsertVisualSpace(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (/[,.;:!?，。；：！？)]/.test(right)) return false;
  if (/[(（]$/.test(left)) return false;
  return (
    /[A-Za-z0-9\u4e00-\u9fff)\]]/.test(left) &&
    /[A-Za-z0-9\u4e00-\u9fff([（]/.test(right)
  );
}

function textCodeUnitSegments(
  text: string,
): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const char of Array.from(text)) {
    const end = offset + char.length;
    segments.push({ start: offset, end });
    offset = end;
  }
  return segments;
}

function bestOverlappingClientRect(
  candidates: DOMRect[],
  selectionRects: DOMRect[],
): DOMRect | null {
  let best: { rect: DOMRect; area: number } | null = null;
  for (const rect of candidates) {
    for (const selectionRect of selectionRects) {
      const area = clientRectOverlapArea(rect, selectionRect, 1);
      if (area > 0.5 && (!best || area > best.area)) {
        best = { rect, area };
      }
    }
  }
  return best?.rect ?? null;
}

function clientRectListOverlaps(rects: DOMRectList, bounds: DOMRect): boolean {
  return clientRectArray(rects).some(
    (rect) => isUsefulClientRect(rect) && clientRectsOverlap(rect, bounds),
  );
}

function clientRectArray(rects: DOMRectList | null): DOMRect[] {
  return rects ? Array.from(rects) : [];
}

function unionClientRects(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return DOMRect.fromRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

function isUsefulClientRect(rect: DOMRect): boolean {
  return rect.width > 0.5 && rect.height > 0.5;
}

function clientRectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return clientRectOverlapArea(a, b) > 0;
}

function clientRectOverlapArea(a: DOMRect, b: DOMRect, tolerance = 0): number {
  const left = Math.max(a.left, b.left - tolerance);
  const right = Math.min(a.right, b.right + tolerance);
  const top = Math.max(a.top, b.top - tolerance);
  const bottom = Math.min(a.bottom, b.bottom + tolerance);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function clientRectMidY(rect: DOMRect): number {
  return (rect.top + rect.bottom) / 2;
}

// Hooks Zotero's Reader event so we capture the annotation snapshot at
// the same time the selection popup renders. WHY at popup-render time:
// that's when Zotero has a fully-formed annotation candidate (with
// position/sortIndex) — we keep a copy so the write tool can save it
// later without re-deriving coordinates.
// REF: Zotero source `chrome/content/zotero/reader.js`
//      registerEventListener("renderTextSelectionPopup", ...).
function registerReaderSelectionCapture() {
  const readerAPI = (Zotero as any).Reader;
  if (readerSelectionHandler || !readerAPI?.registerEventListener) return;

  readerSelectionHandler = (event: unknown) => {
    const e = event as {
      reader?: unknown;
      params?: { annotation?: { text?: string } & Record<string, unknown> };
    };
    const officialText = normalizeSelectedText(e.params?.annotation?.text);
    const visualSelection = getActiveReaderVisualSelection(e.reader);
    const text = officialText || visualSelection.text;
    if (!text) return;
    const annotation = e.params?.annotation
      ? { ...e.params.annotation, text }
      : undefined;
    debugZai("selection.event-capture", {
      rects: annotation ? annotationRectCount(annotation) : 0,
      official: textDebugInfo(officialText, 120),
      visual: textDebugInfo(visualSelection.text, 120),
      visualSource: visualSelection.source,
      visualRects: visualSelection.rectCount,
      text: textDebugInfo(text, 120),
    });
    rememberReaderSelection(e.reader, null, text, annotation);
    for (const win of mountedWindows) {
      const sidebar = windowSidebars.get(win);
      if (sidebar)
        updateSelectionIndicators(sidebar.mount, safeSelectedItemID(win));
    }
  };
  readerAPI.registerEventListener(
    "renderTextSelectionPopup",
    readerSelectionHandler,
    addon.data.config.addonID,
  );
}

function unregisterReaderSelectionCapture() {
  const readerAPI = (Zotero as any).Reader;
  if (!readerSelectionHandler || !readerAPI?.unregisterEventListener) return;
  readerAPI.unregisterEventListener(
    "renderTextSelectionPopup",
    readerSelectionHandler,
  );
  readerSelectionHandler = null;
}

function startSelectionMonitor(win: Window, sidebar: WindowSidebarState) {
  if (sidebar.selectionMonitorID != null) return;
  sidebar.selectionMonitorID = win.setInterval(() => {
    const itemID = safeSelectedItemID(win);
    const before = getStoredSelectedText(itemID);
    const focusInSidebar =
      isFocusInside(sidebar.mount) || isFocusInside(sidebar.noteMount);
    const after = refreshActiveReaderSelection(win, itemID, !focusInSidebar);
    if (before !== after) {
      updateSelectionIndicators(sidebar.mount, itemID);
    }
  }, SELECTION_MONITOR_MS);
}

function stopSelectionMonitor(win: Window, sidebar: WindowSidebarState) {
  if (sidebar.selectionMonitorID == null) return;
  win.clearInterval(sidebar.selectionMonitorID);
  sidebar.selectionMonitorID = undefined;
}

function updateSelectionIndicators(mount: HTMLElement, _itemID: number | null) {
  // INVARIANT: only composer-area DOM is replaced here; messages-list scroll
  // must NOT shift. The wrap defends against the same scroll-collapse seen
  // on annotation-save (focused descendants in a sibling re-rendered subtree).
  preserveMessagesScroll(mount, () => {
    const state = states.get(mount);
    const prompts = mount.querySelector(".quick-prompts") as HTMLElement | null;
    if (state && prompts) {
      prompts.replaceWith(
        renderQuickPrompts(mount.ownerDocument!, mount, state),
      );
    }
    const chip = mount.querySelector(
      ".zai-sel-chip-wrap",
    ) as HTMLElement | null;
    const row = mount.querySelector(".input-row") as HTMLElement | null;
    if (state && row) {
      const nextChip = renderSelectionChip(mount.ownerDocument!, mount, state);
      if (chip && nextChip) {
        chip.replaceWith(nextChip);
      } else if (chip) {
        chip.remove();
      } else if (nextChip) {
        row.prepend(nextChip);
      }
    }
    const switchers = mount.querySelector(
      ".composer-switchers",
    ) as HTMLElement | null;
    if (state && switchers) {
      switchers.replaceChildren(
        renderWebSearchSwitcher(mount.ownerDocument!, mount, state),
      );
      if (!getStoredSelectedText(state.itemID)) {
        switchers.append(
          renderPaperPinSwitcher(mount.ownerDocument!, mount, state),
        );
      }
    }
    const input = mount.querySelector(
      ".input-row textarea",
    ) as HTMLTextAreaElement | null;
    const status = mount.querySelector(
      ".composer-status",
    ) as HTMLElement | null;
    if (state && input && status) {
      renderInputStatus(status, input, state);
    }
  });
}

function isFocusInside(root: HTMLElement): boolean {
  const active = root.ownerDocument?.activeElement;
  return !!active && root.contains(active);
}

function rememberReaderSelection(
  reader: unknown,
  fallbackItemID: number | null,
  text: string,
  annotation?: Record<string, unknown>,
) {
  const normalized = normalizeSelectedText(text);
  if (!normalized) return;
  const ids = readerItemIDs(reader, fallbackItemID);
  const attachmentID = readerAttachmentID(reader);
  if (attachmentID != null) {
    readerByAttachmentID.set(attachmentID, reader);
  }
  for (const id of ids) {
    if (ignoredSelectedTextByItem.get(id) === normalized) {
      continue;
    }
    ignoredSelectedTextByItem.delete(id);
    selectedTextByItem.set(id, normalized);
    if (annotation && attachmentID != null) {
      selectedAnnotationByItem.set(id, {
        text: normalized,
        annotation: detachAnnotationSnapshot(annotation),
        attachmentID,
      });
    }
  }
}

// Two near-twin lookups — DELIBERATE, do not merge:
// - `firstStoredSelectedText` returns whatever is in storage IGNORING the
//   ignored-by-user flag. Used by `ignoreSelectedTextForPrompt` which
//   needs to look up the text it's about to mark as ignored.
// - `firstUsableStoredSelectedText` filters out ignored entries. Used by
//   the polling monitor and any "should we show the chip?" path.
function firstStoredSelectedText(ids: number[]): string {
  for (const id of ids) {
    const text = selectedTextByItem.get(id);
    if (text) return text;
  }
  return "";
}

function firstUsableStoredSelectedText(ids: number[]): string {
  for (const id of ids) {
    const text = selectedTextByItem.get(id);
    if (text && ignoredSelectedTextByItem.get(id) !== text) return text;
  }
  return "";
}

function firstUsableStoredSelectionAnnotation(
  ids: number[],
): SelectionAnnotationDraft | null {
  for (const id of ids) {
    const draft = selectedAnnotationByItem.get(id);
    if (draft && ignoredSelectedTextByItem.get(id) !== draft.text) {
      return draft;
    }
  }
  return null;
}

function shouldIgnoreSelectedText(ids: number[], text: string): boolean {
  // Ignore flags are stored normalized (via rememberReaderSelection). Callers
  // pass raw Reader text — with line breaks/hyphenation — so normalize before
  // comparing; otherwise a dismissed selection slips back in at send time.
  const normalized = normalizeSelectedText(text);
  return ids.some((id) => ignoredSelectedTextByItem.get(id) === normalized);
}

function clearStoredSelectedText(ids: number[]) {
  for (const id of ids) {
    selectedTextByItem.delete(id);
    selectedAnnotationByItem.delete(id);
    ignoredSelectedTextByItem.delete(id);
  }
}

// User clicked the ✕ on the selection chip. The RELIABLE way to drop the
// selection is to clear the Reader's actual text selection: otherwise
// getSelectedTextForPrompt re-reads it at send time and rememberReaderSelection
// re-arms it — the text-keyed ignore flag is defeated whenever the popup-event
// and send-time extraction paths yield even slightly different strings. We
// still set the ignore flag + delete the snapshot as a belt, but clearing the
// source is what actually makes ✕ stick.
function ignoreSelectedTextForPrompt(
  mount: HTMLElement,
  itemID: number | null,
) {
  const reader = getActiveReader(mount.ownerDocument?.defaultView);
  const ids = readerItemIDs(reader, itemID);
  const text = firstStoredSelectedText(ids);
  for (const id of ids) {
    if (text) ignoredSelectedTextByItem.set(id, text);
    selectedTextByItem.delete(id);
    selectedAnnotationByItem.delete(id);
  }
  clearReaderTransientPdfState(reader, {
    clearHighlight: false,
    clearSelection: true,
  });
}

// Returns BOTH the parent item ID and the attachment ID for a Reader-open
// PDF, deduped. WHY both: the user may switch between viewing the parent
// in the items pane and the attachment via Reader; storing the selection
// under both IDs keeps the chip visible across that switch.
function readerItemIDs(
  reader: unknown,
  fallbackItemID: number | null,
): number[] {
  const r = reader as {
    itemID?: number;
    _item?: { id?: number; parentID?: number };
  } | null;
  const ids = [
    fallbackItemID,
    r?._item?.id,
    r?._item?.parentID,
    r?.itemID,
  ].filter((id): id is number => typeof id === "number");
  return [...new Set(ids)];
}

function readerAttachmentID(reader: unknown): number | null {
  try {
    const r = reader as {
      itemID?: number;
      _item?: { id?: number };
    } | null;
    return typeof r?._item?.id === "number"
      ? r._item.id
      : typeof r?.itemID === "number"
        ? r.itemID
        : null;
  } catch {
    return null;
  }
}

// Active Reader = the reader instance for the foreground Zotero tab.
// REF: Zotero source `chrome/content/zotero/elements/zoteroTabs.js` for
//      Zotero_Tabs.selectedID; `chrome/content/zotero/reader.js` for
//      Reader.getByTabID. The chain optionals defend against the user
//      having no Reader tab open.
function getActiveReader(win: Window | null | undefined): any {
  const tabID = (win as any)?.Zotero_Tabs?.selectedID;
  return tabID ? (Zotero as any).Reader?.getByTabID?.(tabID) : null;
}

// Returns the active Reader ONLY IF it's open on the same paper as the
// current chat thread. WHY this guard: agent tools that need PDF.js text
// (the highlight-write tool) must operate on the SAME paper the user is
// chatting about — otherwise we'd write a highlight to the wrong PDF.
// `activeReaderConversationItemID` walks attachment→parent so the match
// works whether the Reader is on the parent or the attachment.
function getActiveReaderForItem(
  win: Window | null | undefined,
  itemID: number | null,
): any {
  if (!win || itemID == null) return null;
  const reader = getActiveReader(win);
  if (!reader) return null;
  return activeReaderConversationItemID(win) === itemID ? reader : null;
}

function getReaderForCurrentSelection(
  win: Window | null | undefined,
  itemID: number | null,
): any {
  const draft = getStoredSelectionAnnotation(itemID);
  return getReaderForAttachmentOrItem(win, itemID, draft?.attachmentID ?? null);
}

function getReaderForAttachmentOrItem(
  win: Window | null | undefined,
  itemID: number | null,
  attachmentID: number | null,
): any {
  const active = getActiveReaderForItem(win, itemID);
  if (!attachmentID || readerHasAttachmentID(active, attachmentID)) {
    return active;
  }

  const cached = readerByAttachmentID.get(attachmentID);
  if (readerHasAttachmentID(cached, attachmentID)) return cached;

  const readers = allZoteroReaders();
  const exact = readers.filter((reader) =>
    readerHasAttachmentID(reader, attachmentID),
  );
  const sameThread =
    exact.find((reader) => readerConversationItemID(reader) === itemID) ??
    exact[0];
  if (sameThread) return sameThread;

  debugZai("text-annotation.reader-missing", {
    itemID,
    attachmentID,
    activeAttachmentID: readerAttachmentID(active),
    knownReaders: readers.map((reader) => ({
      itemID: (reader as any)?.itemID,
      attachmentID: readerAttachmentID(reader),
      conversationItemID: readerConversationItemID(reader),
    })),
  });
  return active;
}

function allZoteroReaders(): any[] {
  const readerAPI = (Zotero as any).Reader;
  const readers = Array.isArray(readerAPI?._readers) ? readerAPI._readers : [];
  return readers.filter(Boolean);
}

function readerHasAttachmentID(reader: unknown, attachmentID: number): boolean {
  return readerAttachmentID(reader) === attachmentID;
}

function readerConversationItemID(reader: unknown): number | null {
  try {
    const r = reader as {
      itemID?: number;
      _item?: { id?: number; parentID?: number };
    } | null;
    return typeof r?._item?.parentID === "number"
      ? r._item.parentID
      : typeof r?._item?.id === "number"
        ? itemIDToParentID(r._item.id)
        : itemIDToParentID(r?.itemID);
  } catch {
    return null;
  }
}

function safeSelectionText(win: unknown): string {
  try {
    return normalizeSelectedText(
      (win as Window | undefined)?.getSelection?.()?.toString(),
    );
  } catch {
    return "";
  }
}

function firstText(values: string[]): string {
  return values.find(Boolean) ?? "";
}

function normalizeSelectedText(text: unknown): string {
  if (typeof text !== "string") return "";
  const normalized = formatSelectedTextSemantically(
    repairPdfSelectionLineBreaks(text),
  );
  return normalized.length > contextPolicy.maxSelectedTextChars
    ? normalized.slice(0, contextPolicy.maxSelectedTextChars)
    : normalized;
}

type SelectedTextBlockKind = "paragraph" | "list" | "heading";

interface SelectedTextBlock {
  kind: SelectedTextBlockKind;
  text: string;
}

function formatSelectedTextSemantically(text: string): string {
  const blocks: SelectedTextBlock[] = [];
  let current: SelectedTextBlock | null = null;
  const flush = () => {
    if (!current) return;
    const value = current.text.trim();
    if (value) blocks.push({ ...current, text: value });
    current = null;
  };

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = normalizeSelectedTextLine(rawLine);
    if (!line) {
      flush();
      continue;
    }
    const kind = selectedTextBlockKind(line);
    if (kind !== "paragraph") {
      flush();
      current = { kind, text: line };
      continue;
    }
    if (!current) {
      current = { kind: "paragraph", text: line };
    } else {
      current.text = `${current.text} ${line}`;
    }
  }
  flush();
  return joinSelectedTextBlocks(blocks);
}

function normalizeSelectedTextLine(line: string): string {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .trim();
}

function selectedTextBlockKind(line: string): SelectedTextBlockKind {
  if (/^(?:\d{1,3}[\).]|\([a-zA-Z0-9]\)|[a-zA-Z]\))\s+/.test(line)) {
    return "list";
  }
  if (/^(?:[A-Z]\.|[IVXLC]+\.|Fig(?:ure)?\.?\s*\d+[:.])\s+/.test(line)) {
    return "heading";
  }
  return "paragraph";
}

function joinSelectedTextBlocks(blocks: SelectedTextBlock[]): string {
  let output = "";
  let previous: SelectedTextBlock | null = null;
  for (const block of blocks) {
    if (!output) {
      output = block.text;
    } else {
      output +=
        previous?.kind === "list" && block.kind === "list" ? "\n" : "\n\n";
      output += block.text;
    }
    previous = block;
  }
  return output.trim();
}

function repairPdfSelectionLineBreaks(text: string): string {
  return text
    .replace(/([A-Za-z]{3,})-\s*\r?\n\s*([a-z]{3,})/g, "$1$2")
    .replace(/([A-Za-z]{3,})-\s{2,}([a-z]{3,})/g, "$1$2");
}

async function extractSelectionTextFromAnnotationPosition(
  reader: unknown,
  draft: SelectionAnnotationDraft,
): Promise<string> {
  if (!reader || !hasAnnotationPosition(draft.annotation)) return "";
  let locator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    locator = await createPdfLocator(reader);
    const extracted = normalizeSelectedText(
      await locator.extractTextFromPosition(draft.annotation.position),
    );
    debugZai(
      extracted ? "selection.position-text" : "selection.position-empty",
      {
        rects: annotationRectCount(draft.annotation),
        official: textDebugInfo(draft.text, 120),
        extracted: textDebugInfo(extracted, 120),
      },
    );
    return extracted;
  } catch (err) {
    debugZai("selection.position-text.failed", {
      error: errorMessage(err),
      official: textDebugInfo(draft.text, 120),
    });
    return "";
  } finally {
    locator?.dispose();
  }
}

function hasAnnotationPosition(
  annotation: Record<string, unknown>,
): annotation is Record<string, unknown> & { position: unknown } {
  return !!annotation.position && typeof annotation.position === "object";
}

function annotationRectCount(annotation: Record<string, unknown>): number {
  const position = annotation.position as { rects?: unknown } | undefined;
  return Array.isArray(position?.rects) ? position.rects.length : 0;
}

function updateMessageBubble(
  mount: HTMLElement,
  index: number,
  message: Message,
) {
  const root = mount.querySelector(
    `[data-message-index="${index}"]`,
  ) as HTMLElement | null;
  const body = root?.querySelector(".bubble-body") as HTMLElement | null;
  if (!root || !body) return;
  const state = states.get(mount);
  const shouldStickToBottom =
    state?.autoFollowMessages ?? isMessagesNearBottom(mount);
  if (state) {
    updateAssistantProgress(
      root,
      body,
      assistantProgressFor(state, index, message),
    );
  }

  if (message.thinking) {
    renderMarkdownInto(ensureThinkingBody(root, body), message.thinking);
  }
  renderMarkdownInto(
    body,
    message.content || (state?.activeAssistantIndex === index ? " " : ""),
  );
  if (state) {
    scheduleAssistantPdfQuoteLinks(body, mount, state, message, index);
  }
  if (shouldStickToBottom) {
    scrollMessagesToBottom(mount);
  } else {
    restoreSavedMessagesScroll(mount);
  }
  syncMessagesScrollState(mount);
}

function updateAssistantProgress(
  root: HTMLElement,
  before: HTMLElement,
  progress: AssistantProgress | null,
) {
  const existing = root.querySelector(
    ".assistant-live-progress",
  ) as HTMLElement | null;
  if (!progress) {
    existing?.remove();
    return;
  }
  const next = renderAssistantProgress(root.ownerDocument!, progress);
  if (existing) existing.replaceWith(next);
  else root.insertBefore(next, before);
}

function ensureThinkingBody(
  root: HTMLElement,
  before: HTMLElement,
): HTMLElement {
  const existing = root.querySelector(
    ".bubble-thinking-body",
  ) as HTMLElement | null;
  if (existing) return existing;

  const doc = root.ownerDocument!;
  const details = doc.createElement("details");
  details.className = "bubble-thinking";
  details.open = true;
  const summary = doc.createElement("summary");
  summary.textContent = "思考过程";
  const body = doc.createElement("div");
  body.className = "bubble-thinking-body";
  details.append(summary, body);
  root.insertBefore(details, before);
  return body;
}

function afterRender(mount: HTMLElement, callback: () => void) {
  const win = mount.ownerDocument?.defaultView;
  if (win?.requestAnimationFrame) {
    win.requestAnimationFrame(() => callback());
  } else if (win?.setTimeout) {
    win.setTimeout(callback, 0);
  } else {
    callback();
  }
}

// Scroll preservation
// =====================================================================
// CLAUDE.md rule: streaming output should auto-scroll only when the user
// is already near the bottom; if they've scrolled up, preserve their
// position while new chunks arrive.
//
// State lives in `state.messagesScrollTop` so it survives re-renders
// (every chunk triggers `renderPanel`). `state.autoFollowMessages` toggles
// based on near-bottom detection — once the user scrolls up, we don't
// re-engage auto-follow until they scroll back to the bottom themselves.

function scrollMessagesToBottom(mount: HTMLElement) {
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return;
  messages.scrollTop = messages.scrollHeight;
  syncMessagesScrollState(mount);
}

function syncMessagesScrollState(mount: HTMLElement) {
  const state = states.get(mount);
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (state && messages) {
    const lockedScroll = activeMessagesScrollLock(state);
    if (lockedScroll) {
      state.messagesScrollTop = lockedScroll.top;
      state.autoFollowMessages = lockedScroll.atBottom;
      return;
    }
    state.messagesScrollTop = messages.scrollTop;
  }
}

// Wraps a local DOM mutation (e.g. swapping a single bubble element) so the
// messages-list scroll position is preserved across the swap.
// WHY: Zotero/Firefox may collapse `.messages` scrollTop to 0 mid-mutation
// when a focused descendant is replaced; without this guard the chat
// visibly pages back to the top after operations like "save annotation".
// We restore both synchronously and on the next animation frame to cover
// async layout passes that arrive after the sync swap completes.
function captureMessagesScrollSnapshot(
  mount: HTMLElement,
): MessagesScrollSnapshot | null {
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return null;
  return {
    top: messages.scrollTop,
    atBottom: isMessagesElementNearBottom(messages),
  };
}

function activeMessagesScrollLock(
  state: PanelState | undefined,
): MessagesScrollSnapshot | null {
  if (!state?.messagesScrollLock) return null;
  if (Date.now() <= state.messagesScrollLock.until) {
    return state.messagesScrollLock.snapshot;
  }
  state.messagesScrollLock = undefined;
  return null;
}

function lockMessagesScroll(
  mount: HTMLElement,
  snapshot: MessagesScrollSnapshot | null = captureMessagesScrollSnapshot(
    mount,
  ),
  durationMs = 3000,
): MessagesScrollSnapshot | null {
  const state = states.get(mount);
  if (state && snapshot) {
    state.messagesScrollLock = {
      snapshot,
      until: Date.now() + durationMs,
    };
    const win = mount.ownerDocument?.defaultView;
    win?.setTimeout(() => activeMessagesScrollLock(state), durationMs + 50);
  }
  return snapshot;
}

function restoreMessagesScrollSnapshot(
  mount: HTMLElement,
  snapshot: MessagesScrollSnapshot | null,
) {
  if (!snapshot) return;
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return;
  const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
  messages.scrollTop = snapshot.atBottom
    ? maxTop
    : Math.min(snapshot.top, maxTop);
  const state = states.get(mount);
  if (state) {
    state.messagesScrollTop = messages.scrollTop;
    state.autoFollowMessages = snapshot.atBottom;
  }
}

function scheduleMessagesScrollRestore(
  mount: HTMLElement,
  snapshot: MessagesScrollSnapshot | null,
) {
  restoreMessagesScrollSnapshot(mount, snapshot);
  const win = mount.ownerDocument?.defaultView;
  if (!win) return;
  win.requestAnimationFrame(() => {
    restoreMessagesScrollSnapshot(mount, snapshot);
    win.requestAnimationFrame(() =>
      restoreMessagesScrollSnapshot(mount, snapshot),
    );
  });
  win.setTimeout(() => restoreMessagesScrollSnapshot(mount, snapshot), 0);
  win.setTimeout(() => restoreMessagesScrollSnapshot(mount, snapshot), 80);
  win.setTimeout(() => restoreMessagesScrollSnapshot(mount, snapshot), 250);
}

function preserveMessagesScroll(
  mount: HTMLElement,
  mutate: () => void,
  snapshot = captureMessagesScrollSnapshot(mount),
) {
  mutate();
  scheduleMessagesScrollRestore(mount, snapshot);
}

function isMessagesNearBottom(mount: HTMLElement): boolean {
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return true;
  return isMessagesElementNearBottom(messages);
}

// 40px = roughly one body line of slack. Below this we treat the user as
// "at the bottom" and re-engage auto-follow. Tuned by hand: large enough
// to absorb sub-pixel scroll snap, small enough that scrolling up by one
// full message disengages follow mode.
function isMessagesElementNearBottom(messages: HTMLElement): boolean {
  return (
    messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40
  );
}

function restoreSavedMessagesScroll(mount: HTMLElement) {
  const state = states.get(mount);
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!state || !messages) return;
  messages.scrollTop = state.messagesScrollTop;
}

function restoreMessagesScroll(
  mount: HTMLElement,
  state: PanelState,
  scrollToBottom: boolean,
) {
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return;
  if (scrollToBottom) {
    messages.scrollTop = messages.scrollHeight;
    state.messagesScrollTop = messages.scrollTop;
    return;
  }
  messages.scrollTop = state.messagesScrollTop;
}

function restoreChatInput(
  mount: HTMLElement,
  state: PanelState,
  forceFocus: boolean,
) {
  const input = mount.querySelector(
    ".input-row textarea",
  ) as HTMLTextAreaElement | null;
  if (!input || input.disabled) return;
  input.value = state.draftText;
  const start = clampOffset(state.draftSelectionStart, input.value);
  const end = clampOffset(state.draftSelectionEnd, input.value);
  input.selectionStart = start;
  input.selectionEnd = end;
  autoResizeInput(input);

  const status = mount.querySelector(".composer-status") as HTMLElement | null;
  if (status) {
    renderInputStatus(status, input, state);
  }

  if (!forceFocus && !state.draftHadFocus) return;
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
}

function renderBubbleIdentity(
  doc: Document,
  role: Message["role"],
  settings: UiSettings,
): HTMLElement {
  const profile =
    role === "user" ? settings.userProfile : settings.assistantProfile;
  const wrap = el(doc, "div", "bubble-identity");
  if (profile.avatar) {
    wrap.append(renderBubbleAvatar(doc, profile));
  }
  wrap.append(el(doc, "div", "bubble-role", profile.label));
  return wrap;
}

function renderBubbleAvatar(
  doc: Document,
  profile: ChatProfileSettings,
): HTMLElement {
  const avatar = el(doc, "span", "bubble-avatar");
  if (isAvatarImageSource(profile.avatar)) {
    const image = doc.createElement("img");
    image.src = profile.avatar;
    image.alt = profile.label;
    avatar.append(image);
  } else {
    avatar.textContent = profile.avatar;
  }
  return avatar;
}

function isAvatarImageSource(value: string): boolean {
  return /^(data:image\/|https?:\/\/|file:\/\/|chrome:\/\/)/i.test(value);
}

function bubble(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  message: Message,
  index: number,
) {
  const root = el(
    doc,
    "div",
    [
      "bubble",
      `bubble-${message.role}`,
      `bubble-actions-${state.uiSettings.messageActionsPosition}`,
      `bubble-actions-${state.uiSettings.messageActionsLayout}`,
    ].join(" "),
  );
  root.dataset.messageIndex = String(index);
  const head = el(doc, "div", "bubble-head");
  head.append(renderBubbleIdentity(doc, message.role, state.uiSettings));

  const actions = el(doc, "div", "bubble-actions");
  const copy = buttonEl(doc, "复制");
  copy.addEventListener("click", () => {
    const markdown = messageToClipboard(message, state.copyDebugContext);
    void copyToClipboard(
      doc,
      markdown,
      undefined,
      markdownToClipboardHTML(doc, markdown),
    );
    flashButton(copy, "已复制");
  });
  actions.append(copy);

  if (message.role === "assistant" && message.content.trim()) {
    const saveNote = buttonEl(doc, "写入笔记");
    saveNote.title = betterNotesInsertAvailable()
      ? "用 Better Notes 写入当前条目的子笔记"
      : "写入当前条目的 Zotero 子笔记";
    saveNote.disabled =
      state.itemID == null ||
      (state.sending && state.activeAssistantIndex === index);
    saveNote.addEventListener("click", () => {
      void writeAssistantMessageToNote(
        doc,
        state.itemID,
        message,
        saveNote,
        pdfSelectionForAssistantMessage(state, index),
      );
    });
    actions.append(saveNote);
  }

  // Retry button only appears on the LATEST assistant message. WHY: the
  // regenerate path drops the last assistant message and re-streams from
  // the prior user turn — meaningful only for the latest exchange. Older
  // assistant messages get only copy/delete actions.
  if (
    message.role === "assistant" &&
    index === findLastAssistantIndex(state.messages)
  ) {
    const retry = buttonEl(doc, "重试");
    retry.disabled = state.sending;
    retry.addEventListener(
      "click",
      () => void regenerateLastResponse(mount, state),
    );
    actions.append(retry);
  }

  const del = buttonEl(doc, "删除");
  del.disabled = state.sending;
  del.addEventListener("click", () => {
    state.messages = state.messages.filter((_, i) => i !== index);
    void saveChatMessages(state.itemID, state.messages);
    renderPanel(mount, state);
  });
  actions.append(del);
  head.append(actions);

  root.append(head);
  if (message.role === "user") {
    renderMessageImages(doc, root, message.images);
    renderUserPdfSelectionContext(doc, mount, state, root, message);
  }
  const sourceUser =
    message.role === "assistant"
      ? state.messages[findPreviousUserIndex(state.messages, index)]
      : undefined;
  if (message.role === "assistant") {
    renderAssistantProcess(doc, mount, state, root, sourceUser);
  }
  const progress = assistantProgressFor(state, index, message);
  if (progress) {
    root.append(renderAssistantProgress(doc, progress));
  }
  if (message.role === "assistant" && message.thinking) {
    const details = el(doc, "details", "bubble-thinking") as HTMLDetailsElement;
    details.open = true;
    details.append(el(doc, "summary", "", "思考过程"));
    const thinkingBody = el(doc, "div", "bubble-thinking-body");
    renderMarkdownInto(thinkingBody, message.thinking);
    details.append(thinkingBody);
    root.append(details);
  }
  const body = el(doc, "div", "bubble-body");
  renderMarkdownInto(body, message.content || (progress ? " " : ""));
  scheduleAssistantPdfQuoteLinks(body, mount, state, message, index);
  if (message.role === "assistant" && message.mindmap) {
    body.append(renderMindmapBlock(doc, message.mindmap));
  }
  root.append(body);
  if (message.role === "assistant" && message.usage) {
    root.append(renderMessageUsage(doc, message.usage));
  }
  if (message.role === "assistant" && message.content.trim()) {
    const rawPre = doc.createElement("pre");
    rawPre.className = "bubble-raw";
    rawPre.textContent = message.content;
    rawPre.style.display = "none";
    root.append(rawPre);
  }
  if (message.role === "assistant" && message.annotationDraft) {
    root.append(
      renderAnnotationSuggestion(
        doc,
        mount,
        state,
        index,
        message.annotationDraft,
      ),
    );
  }
  return root;
}

function renderUserPdfSelectionContext(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  root: HTMLElement,
  message: Message,
) {
  const locator = message.task?.pdfSelection;
  const selectedText =
    message.context?.selectedText || locator?.selectedText || "";
  if (!selectedText) return;

  const card = el(doc, "div", "bubble-source-selection");
  const head = el(doc, "div", "bubble-source-selection-head");
  const label = el(
    doc,
    "div",
    "bubble-source-selection-label",
    `PDF 选区${locator ? pdfSelectionPageLabel(locator) : ""}`,
  );
  head.append(label);
  if (locator) {
    const jump = buttonEl(doc, "查看原选区");
    jump.className = "bubble-source-selection-jump";
    jump.title = "回到 PDF 原选区，并重新选中这段文字";
    jump.addEventListener("click", () => {
      jump.blur();
      void jumpToPdfSelection(mount, state, locator);
    });
    head.append(jump);
  }
  card.append(
    head,
    el(doc, "div", "bubble-source-selection-text", selectedText),
  );
  root.append(card);
}

function renderMessageUsage(
  doc: Document,
  usage: NonNullable<Message["usage"]>,
): HTMLElement {
  const breakdown = messageUsageBreakdown(usage);
  const row = el(doc, "div", "bubble-usage");
  row.title = [
    "按单价桶展示：缓存命中输入、缓存未命中输入、输出通常是不同单价。",
    `Input raw: ${formatTokenCount(breakdown.rawInput)}`,
    breakdown.cacheReturned
      ? `Input cache hit: ${formatTokenCount(breakdown.cacheHit)}`
      : "Input cache hit: 服务端未返回",
    breakdown.cacheReturned
      ? `Input cache miss: ${formatTokenCount(breakdown.cacheMiss)}`
      : `Input cache miss: ${formatTokenCount(breakdown.cacheMiss)}`,
    `Output: ${formatTokenCount(breakdown.output)}`,
    breakdown.cacheRate != null
      ? `Cache hit rate: ${breakdown.cacheRate}%`
      : "",
    `Token total: ${formatTokenCount(breakdown.total)}（仅供核对，不作为计价汇总）`,
    `统计口径: ${breakdown.mode}`,
  ]
    .filter(Boolean)
    .join("\n");

  row.textContent = breakdown.cacheReturned
    ? [
        `Input cache hit ${formatTokenCount(breakdown.cacheHit)}`,
        `Input cache miss ${formatTokenCount(breakdown.cacheMiss)}`,
        `Output ${formatTokenCount(breakdown.output)}`,
        `Cache hit rate ${breakdown.cacheRate}%`,
      ].join(" · ")
    : [
        `Input ${formatTokenCount(breakdown.rawInput)}`,
        `Output ${formatTokenCount(breakdown.output)}`,
        "Cache hit 未返回",
      ].join(" · ");
  return row;
}

function messageUsageBreakdown(usage: NonNullable<Message["usage"]>): {
  rawInput: number;
  cacheReturned: boolean;
  cacheHit: number;
  cacheMiss: number;
  output: number;
  total: number;
  cacheRate: number | null;
  mode: string;
} {
  const rawInput = Math.max(0, usage.input || 0);
  const output = Math.max(0, usage.output || 0);
  if (usage.cacheRead == null) {
    return {
      rawInput,
      cacheReturned: false,
      cacheHit: 0,
      cacheMiss: rawInput,
      output,
      total: rawInput + output,
      cacheRate: null,
      mode: "服务端未返回缓存字段",
    };
  }

  const cacheHit = Math.max(0, usage.cacheRead || 0);
  // Official OpenAI-style usage reports cached tokens as a subset of input.
  // Some compatible relays report `input` as cache-miss tokens and cache
  // reads separately. Use the only interpretation that keeps hit rate <=100%.
  const officialLike = cacheHit <= rawInput;
  const cacheMiss = officialLike ? rawInput - cacheHit : rawInput;
  const inputTotal = cacheHit + cacheMiss;
  const cacheRate =
    inputTotal > 0 ? Math.round((cacheHit / inputTotal) * 100) : 0;
  return {
    rawInput,
    cacheReturned: true,
    cacheHit,
    cacheMiss,
    output,
    total: inputTotal + output,
    cacheRate,
    mode: officialLike
      ? "官方口径：缓存命中包含在输入 tokens 内"
      : "兼容口径：输入 tokens 视为未命中，缓存命中单独返回",
  };
}

function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function pdfSelectionForAssistantMessage(
  state: PanelState,
  assistantIndex: number,
): PdfSelectionLocator | null {
  const userIndex = findPreviousUserIndex(state.messages, assistantIndex);
  return userIndex >= 0
    ? (state.messages[userIndex]?.task?.pdfSelection ?? null)
    : null;
}

function scheduleAssistantPdfQuoteLinks(
  body: HTMLElement,
  mount: HTMLElement,
  state: PanelState,
  message: Message,
  index: number,
) {
  if (message.role !== "assistant") return;
  if (state.sending && state.activeAssistantIndex === index) return;
  // Quote evidence may arrive as a `>` blockquote OR as a `- "…"` list item;
  // pdfQuoteBlocks() handles both, so gate on either element being present.
  if (!body.querySelector("blockquote, li")) return;
  const sourceSelection = pdfSelectionForAssistantMessage(state, index);
  installPdfQuoteButtonsInElement(body, {
    sourceItemID: state.itemID,
    preferredAttachmentID: sourceSelection?.attachmentID ?? null,
    preferredPageIndex: sourceSelection?.pageIndex ?? null,
    onJump: (quote, button) =>
      jumpToPdfQuote(
        mount,
        state,
        quote,
        sourceSelection?.attachmentID ?? null,
        button,
        state.itemID,
        sourceSelection?.pageIndex ?? null,
      ),
  });
}

async function openCurrentItemNote(
  doc: Document,
  itemID: number | null,
  button: HTMLButtonElement,
) {
  const originalText = button.textContent || "打开笔记";
  const originalTitle = button.title;
  button.textContent = "打开中...";
  button.disabled = true;
  let opened = false;

  try {
    const { note, created } = await resolveTargetNote(itemID);
    await showNoteWindow(doc, note);
    opened = true;
    button.textContent = created ? "已新建并打开" : "已打开";
    button.title = `目标笔记 #${note.id}`;
    button.disabled = true;
  } catch (err) {
    button.textContent = "打开失败";
    button.title = err instanceof Error ? err.message : String(err);
  } finally {
    if (!opened) {
      doc.defaultView?.setTimeout(() => {
        button.textContent = originalText;
        button.title = originalTitle;
        button.disabled = false;
      }, 1400);
    }
  }
}

async function showNoteWindow(doc: Document, note: Zotero.Item) {
  const sidebar = findSidebarStateByDocument(doc);
  if (!sidebar) throw new Error("无法找到 AI 侧栏");

  sidebar.noteItemID = note.id;
  setNoteColumnVisible(sidebar, true);
  try {
    renderNoteWindow(sidebar, note);
    updateOpenNoteButton(sidebar);
  } catch (err) {
    sidebar.noteItemID = undefined;
    sidebar.noteMount.replaceChildren();
    setNoteColumnVisible(sidebar, false);
    updateOpenNoteButton(sidebar);
    throw err;
  }
}

function renderNoteWindow(sidebar: WindowSidebarState, note: Zotero.Item) {
  const doc = sidebar.noteMount.ownerDocument!;
  sidebar.noteEditorCleanup?.();
  sidebar.noteEditorCleanup = undefined;
  sidebar.noteMount.replaceChildren();
  const head = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  head.className = "zai-note-window-head";

  const title = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  title.className = "zai-note-window-title";
  title.textContent = noteTitle(note);
  title.title = "拖动左侧橙色分隔线可调整笔记栏宽度";
  sidebar.overviewActive = false;
  const switcher = renderNoteFileSwitcher(
    doc,
    sidebar,
    isReadingRouteNote(note) ? "readingRoute" : "normal",
  );

  const resizeHint = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  resizeHint.className = "zai-note-resize-hint";
  resizeHint.textContent = "↔ 拖左侧边缘";
  resizeHint.title =
    "请拖动笔记栏左侧橙色分隔线调整宽度，避免拖出 Zotero PDF 信息栏";

  const status = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  status.className = "zai-note-window-status";
  status.textContent = "自动保存";

  const save = buttonEl(doc, "保存");
  save.className = "zai-note-window-button zai-note-window-save";
  save.disabled = true;
  save.title = "没有未保存修改";

  const close = buttonEl(doc, "关闭");
  close.className = "zai-note-window-button";
  head.append(title, switcher, resizeHint, status, save, close);

  const body = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  body.className = "zai-note-window-body";

  const zoteroEditor = createZoteroNoteEditorElement(doc);
  if (zoteroEditor) {
    body.append(zoteroEditor);
    sidebar.noteMount.append(head, body);
    initializeZoteroNoteEditor(
      sidebar,
      zoteroEditor,
      note,
      status,
      save,
      close,
    );
    return;
  }

  sidebar.noteRestoreSnapshot = undefined;
  const editor = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  editor.className = "zai-note-rich-editor";
  editor.contentEditable = "true";
  editor.spellcheck = true;
  editor.tabIndex = 0;
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("data-placeholder", "输入笔记...");
  renderEditableNoteHTML(editor, note.getNote?.() || "");
  editor.dataset.savedHTML = editableNoteHTML(editor);

  const markChanged = () => {
    updateNoteSaveState(editor, save);
    scheduleAutosaveNote(sidebar, note, editor, status, save);
  };

  editor.addEventListener("input", markChanged);
  editor.addEventListener("paste", (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    insertPlainTextAtSelection(doc, text);
    markChanged();
  });
  sidebar.noteEditorCleanup = installNoteEditorEventIsolation(
    doc,
    editor,
    () => void autosaveNoteNow(sidebar, note, editor, status, save),
  );
  save.addEventListener("click", () => {
    void autosaveNoteNow(sidebar, note, editor, status, save);
  });
  close.addEventListener("click", () => {
    void closeNoteWindow(sidebar, note, editor, status, save, close);
  });

  body.append(editor);
  sidebar.noteMount.append(head, body);
}

type NoteFileKind = "normal" | "readingRoute";
type NotePanelView = NoteFileKind | "overview";

function renderNoteFileSwitcher(
  doc: Document,
  sidebar: WindowSidebarState,
  activeView: NotePanelView,
): HTMLElement {
  const wrap = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrap.className = "zai-note-file-switcher";
  const active = activeView;
  const panelState = states.get(sidebar.mount);
  const routeExists =
    active === "readingRoute" || hasReadingRouteNoteForSidebar(sidebar);

  const normal = noteFileSwitchButton(doc, "AI 笔记", active === "normal");
  normal.title = "普通 AI 笔记：对话里的「写入笔记」默认保存到这里";
  normal.addEventListener("click", () => {
    void switchNoteFile(sidebar, "normal", normal);
  });

  // Route button morphs by view state — no extra button, label/handler shift:
  //   no route yet            → "生成路线" → generate
  //   route exists, on AI 笔记 → "阅读路线" → switch
  //   route exists, on route   → "更新路线" → regenerate (overwrites AI section,
  //                              preserves 「我的补充笔记」via
  //                              saveReadingRouteToDedicatedNote)
  const isViewingRoute = routeExists && active === "readingRoute";
  const routeLabel = isViewingRoute
    ? "更新路线"
    : routeExists
      ? "阅读路线"
      : "生成路线";
  const route = noteFileSwitchButton(doc, routeLabel, false);
  route.title = isViewingRoute
    ? "重新生成阅读路线（覆盖 AI 生成区，保留「我的补充笔记」）"
    : routeExists
      ? "打开专用阅读路线笔记"
      : "还没有阅读路线；点击后生成并打开专用阅读路线笔记";
  route.addEventListener("click", () => {
    if (isViewingRoute) {
      void generateReadingRouteFromNoteSwitcher(sidebar, route);
    } else if (routeExists) {
      void switchNoteFile(sidebar, "readingRoute", route);
    } else {
      void generateReadingRouteFromNoteSwitcher(sidebar, route);
    }
  });
  if (panelState?.sending) route.disabled = true;

  // 「总揽」opens a dedicated overview VIEW in this note column — NOT a note,
  // NOT the chat. It shows the section skeleton + the mermaid-style structural
  // flowchart, loaded from the per-item overview store.
  const overview = noteFileSwitchButton(doc, "总揽", active === "overview");
  overview.title = "全文总揽：章节骨架 + 结构图纸（独立视图，不写入笔记）";
  overview.addEventListener("click", () => {
    void showOverviewWindow(sidebar);
  });

  wrap.append(normal, route, overview);
  return wrap;
}

function noteFileSwitchButton(
  doc: Document,
  label: string,
  active: boolean,
): HTMLButtonElement {
  const button = buttonEl(doc, label);
  button.className = "zai-note-window-button zai-note-file-switch";
  if (active) button.classList.add("is-active");
  button.disabled = active;
  return button;
}

async function switchNoteFile(
  sidebar: WindowSidebarState,
  kind: NoteFileKind,
  button: HTMLButtonElement,
): Promise<void> {
  const itemID = states.get(sidebar.mount)?.itemID ?? null;
  const originalText = button.textContent || "";
  const originalTitle = button.title;
  button.textContent = "打开中...";
  button.disabled = true;

  try {
    await saveVisibleNoteBeforeSwitch(sidebar);
    const note =
      kind === "normal"
        ? (await resolveTargetNote(itemID)).note
        : await findReadingRouteNote(itemID);
    if (!note && kind === "readingRoute") {
      button.textContent = "生成路线";
      button.title = "还没有阅读路线；点击后生成并打开专用阅读路线笔记";
      await generateReadingRouteFromNoteSwitcher(sidebar, button);
      return;
    }
    if (!note) throw new Error("找不到目标笔记。");
    await showNoteWindow(sidebar.noteMount.ownerDocument!, note);
  } catch (err) {
    button.textContent = kind === "readingRoute" ? "生成路线" : "打开失败";
    button.title = err instanceof Error ? err.message : String(err);
    sidebar.noteMount.ownerDocument!.defaultView?.setTimeout(() => {
      button.textContent = originalText;
      button.title = originalTitle;
      button.disabled = false;
    }, 1600);
  }
}

function hasReadingRouteNoteForSidebar(sidebar: WindowSidebarState): boolean {
  const itemID =
    states.get(sidebar.mount)?.itemID ?? sidebar.noteItemID ?? null;
  if (itemID == null) return false;
  const item = getZoteroItem(itemID);
  if (!item) return false;
  const parent = parentItemForDedicatedLookup(item);
  if (!parent) return false;
  return childNotesForItem(parent).some((note) =>
    hasDedicatedNoteMarker(note, "readingRoute"),
  );
}

async function generateReadingRouteFromNoteSwitcher(
  sidebar: WindowSidebarState,
  button: HTMLButtonElement,
): Promise<void> {
  const state = states.get(sidebar.mount);
  const doc = sidebar.noteMount.ownerDocument!;
  if (!state) {
    button.textContent = "生成失败";
    button.title = "无法找到当前 AI 对话状态";
    return;
  }
  const originalText = button.textContent || "生成路线";
  const originalTitle = button.title;
  button.textContent = "生成中...";
  button.disabled = true;
  try {
    await saveVisibleNoteBeforeSwitch(sidebar);
    const prompt = loadQuickPromptSettings(zoteroPrefs()).builtIns.readingRoute;
    await sendMessage(sidebar.mount, state, prompt, {
      readingRoute: true,
      taskTitle: originalText.includes("更新") ? "更新路线" : "生成路线",
    });
  } catch (err) {
    button.textContent = "生成失败";
    button.title = err instanceof Error ? err.message : String(err);
    doc.defaultView?.setTimeout(() => {
      button.textContent = originalText;
      button.title = originalTitle;
      button.disabled = false;
    }, 1800);
  }
}

const OVERVIEW_PROMPT = [
  "请为当前 Zotero 论文生成「全文总揽」，目的是让我对整篇论文有一个全局概念，而不是读一点懂一点。",
  "第一步：调用 zotero_outline_pdf 获取章节骨架（标题、字符范围、图表锚点）。",
  "第二步：基于骨架，为每个章节写一句话 gist（中文，≤30 字），并构造一张论证结构流程图：问题→方法→结果及关键依赖；节点 type 用 root/section/point/result，效果或 SOTA 用 result；尽量给每个节点带上对应章节号 sectionNo。",
  "第三步：调用 render_paper_overview，把 sections（含 gist、charStart、charEnd、anchors）和 flowchart 一起渲染出来。",
  "必须调用 render_paper_overview 完成渲染，不要只用文字回答。",
].join("\n");

// Render the 总揽 view into the note column: a custom DOM page (section
// skeleton + mermaid-style structural flowchart), loaded from the per-item
// overview store. NOT a Zotero note and NOT a chat message.
async function showOverviewWindow(sidebar: WindowSidebarState): Promise<void> {
  const doc = sidebar.noteMount.ownerDocument!;
  sidebar.noteEditorCleanup?.();
  sidebar.noteEditorCleanup = undefined;
  sidebar.noteItemID = undefined;
  sidebar.overviewActive = true;
  setNoteColumnVisible(sidebar, true);
  updateOpenNoteButton(sidebar);

  const itemID = states.get(sidebar.mount)?.itemID ?? null;
  const itemKey = resolveItemKeyForCache(itemID);
  const stored = itemKey ? await loadOverview(itemKey) : null;
  // The user may have switched away while the async load was in flight.
  if (!sidebar.overviewActive) return;

  sidebar.noteMount.replaceChildren();
  const head = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  head.className = "zai-note-window-head";

  const title = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  title.className = "zai-note-window-title";
  title.textContent = "全文总揽";
  title.title = "章节骨架 + 结构图纸（独立视图，不写入笔记）";

  const switcher = renderNoteFileSwitcher(doc, sidebar, "overview");

  const resizeHint = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  resizeHint.className = "zai-note-resize-hint";
  resizeHint.textContent = "↔ 拖左侧边缘";

  const regen = buttonEl(doc, stored?.data ? "更新总揽" : "生成总揽");
  regen.className = "zai-note-window-button zai-note-file-switch";
  regen.disabled = itemID == null;
  regen.title =
    itemID == null ? "请先选择一篇带 PDF 的文献" : "调用工具重新生成全文总揽";
  regen.addEventListener("click", () => {
    void generateOverviewIntoPanel(sidebar, regen);
  });

  const close = buttonEl(doc, "关闭");
  close.className = "zai-note-window-button";
  close.addEventListener("click", () => {
    sidebar.overviewActive = false;
    sidebar.noteMount.replaceChildren();
    setNoteColumnVisible(sidebar, false);
    updateOpenNoteButton(sidebar);
  });

  head.append(title, switcher, resizeHint, regen, close);

  const body = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  body.className = "zai-note-window-body zai-overview-window-body";
  if (stored?.data) {
    body.append(renderOverviewBlock(doc, stored.data));
  } else {
    const empty = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    empty.className = "zai-overview-empty";
    empty.textContent =
      itemID == null
        ? "请先选择一篇带 PDF 的文献，再生成全文总揽。"
        : "尚未生成全文总揽。点击右上角「生成总揽」开始。";
    body.append(empty);
  }
  sidebar.noteMount.append(head, body);
}

// Trigger overview generation from the panel. The model calls
// zotero_outline_pdf + render_paper_overview; onOverviewReady persists the
// result and re-renders showOverviewWindow.
async function generateOverviewIntoPanel(
  sidebar: WindowSidebarState,
  button: HTMLButtonElement,
): Promise<void> {
  const state = states.get(sidebar.mount);
  if (!state) {
    button.textContent = "生成失败";
    button.title = "无法找到当前 AI 对话状态";
    return;
  }
  const originalText = button.textContent || "生成总揽";
  const originalTitle = button.title;
  button.textContent = "生成中...";
  button.disabled = true;
  try {
    await sendMessage(sidebar.mount, state, OVERVIEW_PROMPT, {
      taskTitle: "生成总揽",
    });
    // Safety net: if the model did not call render_paper_overview (so
    // onOverviewReady never re-rendered this view), restore the button so the
    // user can retry. If it did, this button was already replaced.
    button.textContent = originalText;
    button.title = originalTitle;
    button.disabled = false;
  } catch (err) {
    button.textContent = "生成失败";
    button.title = err instanceof Error ? err.message : String(err);
    sidebar.noteMount.ownerDocument!.defaultView?.setTimeout(() => {
      button.textContent = originalText;
      button.title = originalTitle;
      button.disabled = false;
    }, 1800);
  }
}

async function saveVisibleNoteBeforeSwitch(
  sidebar: WindowSidebarState,
): Promise<void> {
  if (!sidebar.noteItemID) return;
  const note = getZoteroItem(sidebar.noteItemID);
  if (!isZoteroNote(note)) return;

  const zoteroEditor = findActiveNoteEditor(sidebar);
  if (zoteroEditor) {
    zoteroEditor.saveSync?.();
    return;
  }

  const editor = sidebar.noteMount.querySelector(
    ".zai-note-rich-editor",
  ) as HTMLElement | null;
  const status = sidebar.noteMount.querySelector(
    ".zai-note-window-status",
  ) as HTMLElement | null;
  const saveButton = sidebar.noteMount.querySelector(
    ".zai-note-window-save",
  ) as HTMLButtonElement | null;
  if (editor && status && saveButton) {
    await autosaveNoteNow(sidebar, note, editor, status, saveButton);
  }
}

function createZoteroNoteEditorElement(
  doc: Document,
): ZoteroNoteEditorElement | null {
  if (!doc.defaultView?.customElements?.get("note-editor")) return null;
  const createXULElement = doc.createXULElement?.bind(doc);
  if (!createXULElement) return null;
  const editor = createXULElement("note-editor") as ZoteroNoteEditorElement;
  editor.setAttribute("class", "zai-zotero-note-editor");
  editor.setAttribute("flex", "1");
  editor.setAttribute("notitle", "1");
  return editor;
}

function initializeZoteroNoteEditor(
  sidebar: WindowSidebarState,
  editor: ZoteroNoteEditorElement,
  note: Zotero.Item,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
  closeButton: HTMLButtonElement,
) {
  const doc = sidebar.noteMount.ownerDocument!;
  const win = doc.defaultView;
  status.textContent = "Zotero 自动保存";
  saveButton.disabled = false;
  saveButton.title = "手动触发 Zotero 官方笔记编辑器保存";

  editor.notitle = true;
  editor.mode = "edit";
  editor.viewMode = "library";
  hideZoteroNoteEditorLinks(editor);
  installZoteroNoteRestoreHooks(sidebar, editor, status, saveButton);
  // Set item after a tick so the custom element has finished connecting.
  win?.setTimeout(() => {
    editor.item = note;
  }, 0);

  const saveNow = () => {
    saveZoteroNoteEditor(editor, status, saveButton);
  };
  const closeNow = () => {
    closeZoteroNoteWindow(sidebar, editor, closeButton);
  };
  const stopBubble = (event: Event) => {
    event.stopPropagation();
  };
  const refocusEditor = () => {
    if (noteAutoFocusSuppressed(sidebar)) return;
    void focusZoteroNoteEditor(editor);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveNow();
    }
    event.stopPropagation();
  };

  saveButton.addEventListener("click", saveNow);
  closeButton.addEventListener("click", closeNow);
  editor.addEventListener("focusin", stopBubble);
  editor.addEventListener("pointerdown", stopBubble);
  editor.addEventListener("click", stopBubble);
  editor.addEventListener("keydown", handleKeyDown);

  let initTimer: number | undefined;
  const afterInit = (attempt = 0) => {
    hideZoteroNoteEditorLinks(editor);
    const instance = editor.getCurrentInstance?.();
    if (instance?._iframeWindow) {
      // item setter can reset mode; force edit mode once the iframe is ready.
      editor.mode = "edit";
      installZoteroNoteEditorKeySave(editor, status, saveButton);
      ensureZoteroNoteEditorKatexCSS(editor);
      installZoteroNotePdfJumpLinks(sidebar, editor);
      installZoteroNotePointerMemory(sidebar, editor);
      installZoteroNoteCaretMemory(sidebar, editor);
      const pendingRestore = sidebar.noteRestoreSnapshot;
      if (pendingRestore) {
        sidebar.noteRestoreSnapshot = undefined;
        restoreVisibleNoteScroll(sidebar, pendingRestore, "afterInit");
      }
      if (pendingRestore || noteAutoFocusSuppressed(sidebar)) {
        if (pendingRestore) {
          win?.setTimeout(
            () =>
              restoreVisibleNoteScroll(sidebar, pendingRestore, "afterNoFocus"),
            0,
          );
        }
      } else {
        void focusZoteroNoteEditor(editor);
      }
      return;
    }
    if (attempt >= 80 || !win) return;
    initTimer = win.setTimeout(() => afterInit(attempt + 1), 50);
  };
  initTimer = win?.setTimeout(() => afterInit(), 0);
  win?.setTimeout(refocusEditor, 150);

  sidebar.noteEditorCleanup = () => {
    if (initTimer && win) win.clearTimeout(initTimer);
    saveButton.removeEventListener("click", saveNow);
    closeButton.removeEventListener("click", closeNow);
    editor.removeEventListener("focusin", stopBubble);
    editor.removeEventListener("pointerdown", stopBubble);
    editor.removeEventListener("click", stopBubble);
    editor.removeEventListener("keydown", handleKeyDown);
    editor._zaiPdfJumpCleanup?.();
    editor._zaiPdfJumpCleanup = undefined;
    editor._zaiPointerMemoryCleanup?.();
    editor._zaiPointerMemoryCleanup = undefined;
    editor._zaiCaretMemoryCleanup?.();
    editor._zaiCaretMemoryCleanup = undefined;
    editor._zaiRestoreHookCleanup?.();
    editor._zaiRestoreHookCleanup = undefined;
    editor.destroy?.();
  };
}

function installZoteroNoteRestoreHooks(
  sidebar: WindowSidebarState,
  editor: ZoteroNoteEditorElement,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  if (
    editor._zaiRestoreHookCleanup ||
    typeof editor.initEditor !== "function"
  ) {
    return;
  }

  const originalInitEditor = editor.initEditor;
  let initCount = 0;
  const wrappedInitEditor = (...args: unknown[]) => {
    const seq = ++initCount;
    debugZai("note-restore.initEditor:start", {
      seq,
      noteID: sidebar.noteItemID,
      hasPendingRestore: !!sidebar.noteRestoreSnapshot,
    });
    const afterInit = () => {
      installZoteroNoteEditorKeySave(editor, status, saveButton);
      ensureZoteroNoteEditorKatexCSS(editor);
      installZoteroNotePdfJumpLinks(sidebar, editor);
      installZoteroNotePointerMemory(sidebar, editor);
      installZoteroNoteCaretMemory(sidebar, editor);
      const pendingRestore = sidebar.noteRestoreSnapshot;
      debugZai("note-restore.initEditor:done", {
        seq,
        noteID: sidebar.noteItemID,
        hasPendingRestore: !!pendingRestore,
        snapshot: pendingRestore
          ? noteScrollSnapshotDebugInfo(pendingRestore)
          : null,
        roots: noteEditorDebugRoots(editor),
      });
      if (pendingRestore) {
        restoreVisibleNoteScroll(sidebar, pendingRestore, `initEditor#${seq}`);
      }
    };

    try {
      const result = originalInitEditor(...args);
      if (result && typeof (result as Promise<void>).then === "function") {
        return (result as Promise<void>).then((value) => {
          afterInit();
          return value;
        });
      }
      afterInit();
      return result;
    } catch (err) {
      debugZai("note-restore.initEditor:failed", {
        seq,
        error: errorMessage(err),
      });
      throw err;
    }
  };

  editor.initEditor = wrappedInitEditor;
  editor._zaiRestoreHookCleanup = () => {
    if (editor.initEditor === wrappedInitEditor) {
      editor.initEditor = originalInitEditor;
    }
  };
}

function hideZoteroNoteEditorLinks(editor: ZoteroNoteEditorElement) {
  const links = editor._id?.("links-container") as
    | (HTMLElement & {
        hidden?: boolean;
      })
    | null;
  if (links) links.hidden = true;
}

async function focusZoteroNoteEditor(editor: ZoteroNoteEditorElement) {
  try {
    await editor.focus?.();
  } catch (err) {
    Zotero.debug(
      `[Zotero AI Sidebar] Could not focus Zotero note editor: ${String(err)}`,
    );
  }
}

function saveZoteroNoteEditor(
  editor: ZoteroNoteEditorElement,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  try {
    status.textContent = "保存中...";
    editor.saveSync?.();
    status.textContent = "已保存";
    saveButton.disabled = false;
  } catch (err) {
    status.textContent = "保存失败";
    status.title = err instanceof Error ? err.message : String(err);
  }
}

function installZoteroNoteEditorKeySave(
  editor: ZoteroNoteEditorElement,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  const iframeWindow = editor.getCurrentInstance?.()?._iframeWindow;
  if (!iframeWindow || (editor as Element).hasAttribute("data-zai-save-key")) {
    return;
  }
  const saveOnKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveZoteroNoteEditor(editor, status, saveButton);
    }
  };
  iframeWindow.addEventListener("keydown", saveOnKeyDown, true);
  (editor as Element).setAttribute("data-zai-save-key", "true");
}

function installZoteroNotePdfJumpLinks(
  sidebar: WindowSidebarState,
  editor: ZoteroNoteEditorElement,
) {
  const iframeWindow = editor.getCurrentInstance?.()?._iframeWindow;
  const iframeDocument = iframeWindow?.document;
  if (!iframeWindow) return;
  if (editor._zaiPdfJumpCleanup && editor._zaiPdfJumpWindow === iframeWindow) {
    normalizeZoteroNotePdfLocationOnlyLinks(iframeDocument);
    normalizeZoteroNotePdfQuoteLinks(iframeDocument);
    return;
  }
  editor._zaiPdfJumpCleanup?.();
  editor._zaiPdfJumpCleanup = undefined;
  editor._zaiPdfJumpWindow = undefined;
  normalizeZoteroNotePdfLocationOnlyLinks(iframeDocument);
  normalizeZoteroNotePdfQuoteLinks(iframeDocument);

  let lastJumpKey = "";
  let lastJumpAt = 0;
  const consume = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };
  const runJump = (
    locator: PdfSelectionLocator | null,
    locationOnly: boolean,
    event: Event | null,
    source: string,
    referenceKind?: ReadingRouteReferenceKind,
  ) => {
    if (!locator) return;
    const state = states.get(sidebar.mount);
    if (!state) return;
    if (event) consume(event);
    const now = Date.now();
    const jumpKey = [
      locationOnly ? "location" : "selection",
      locator.attachmentID,
      locator.pageIndex ?? "",
      locator.selectedText,
    ].join(":");
    if (jumpKey === lastJumpKey && now - lastJumpAt < 900) return;
    lastJumpKey = jumpKey;
    lastJumpAt = now;
    debugZai("note.pdf-jump.intercepted", {
      source,
      locationOnly,
      attachmentID: locator.attachmentID,
      pageIndex: locator.pageIndex,
      text: textDebugInfo(locator.selectedText, 80),
    });
    if (locationOnly) {
      setTempLoadMarkStatus(sidebar.mount, "路线点击");
      void jumpToPdfLocationOnly(sidebar.mount, state, locator, referenceKind);
    } else {
      void jumpToPdfSelection(sidebar.mount, state, locator);
    }
  };

  const onPointerMouse = (event: Event) => {
    const pointer = event as MouseEvent | PointerEvent;
    if ("button" in pointer && pointer.button !== 0) return;
    const link = notePdfJumpLinkFromEvent(event, iframeDocument);
    if (!link) return;
    if (isPdfLocationJumpLink(link)) {
      runJump(
        pdfLocationFromNoteLink(link),
        true,
        event,
        event.type,
        readingRouteReferenceKindFromData(link.dataset.zaiPdfReferenceKind),
      );
      return;
    }
    if (pdfReferenceLabelFromNoteLink(link)) {
      consume(event);
      return;
    }
    if (isPdfQuoteJumpLink(link) || pdfQuoteFromNoteLink(link)) {
      consume(event);
    }
  };
  const onClick = (event: Event) => {
    const link = notePdfJumpLinkFromEvent(event, iframeDocument);
    if (!link) return;
    const locationLocator = isPdfLocationJumpLink(link)
      ? pdfLocationFromNoteLink(link)
      : null;
    if (locationLocator) {
      runJump(
        locationLocator,
        true,
        event,
        "click",
        readingRouteReferenceKindFromData(link.dataset.zaiPdfReferenceKind),
      );
      return;
    }
    const selectionLocator = pdfSelectionFromNoteLink(link);
    if (selectionLocator) {
      if (isPdfQuoteJumpLink(link)) {
        const state = states.get(sidebar.mount);
        if (!state) return;
        consume(event);
        markActiveQuoteElement(link.closest("blockquote, li") ?? link);
        void jumpToPdfSelectionPreview(sidebar.mount, state, selectionLocator);
        return;
      }
      runJump(selectionLocator, false, event, "click");
      return;
    }
    const referenceLabel = pdfReferenceLabelFromNoteLink(link);
    if (referenceLabel) {
      const state = states.get(sidebar.mount);
      if (!state) return;
      consume(event);
      void jumpToReadingRouteReference(
        sidebar.mount,
        state,
        referenceLabel,
        sourceItemIDFromNoteLink(link) ?? state.itemID,
        readingRouteReferenceKindFromData(link.dataset.zaiPdfReferenceKind),
      );
      return;
    }
    const quoteData = pdfQuoteDataFromNoteLink(link);
    if (quoteData?.quote) {
      const state = states.get(sidebar.mount);
      if (!state) return;
      consume(event);
      void jumpToPdfQuote(
        sidebar.mount,
        state,
        quoteData.quote,
        quoteData.preferredAttachmentID ?? null,
        link,
        quoteData.sourceItemID ?? state.itemID,
        quoteData.preferredPageIndex ?? null,
      );
    }
  };
  const onOpenURLMessage = (event: Event) => {
    const data = (event as MessageEvent).data as
      | { message?: { action?: unknown; url?: unknown } }
      | undefined;
    const message = data?.message;
    if (message?.action !== "openURL" || typeof message.url !== "string") {
      return;
    }
    const location = pdfLocationFromNoteHref(message.url);
    if (location) {
      runJump(location, true, event, "message:location");
      return;
    }
    const selection = pdfSelectionFromNoteHref(message.url);
    if (selection) {
      runJump(selection, false, event, "message:selection");
      return;
    }
    const quote = pdfQuoteFromNoteHref(message.url);
    if (quote) {
      const state = states.get(sidebar.mount);
      if (!state) return;
      consume(event);
      const quoteData = pdfQuoteDataFromNoteHref(message.url);
      void jumpToPdfQuote(
        sidebar.mount,
        state,
        quoteData?.quote ?? quote,
        quoteData?.preferredAttachmentID ?? null,
        undefined,
        quoteData?.sourceItemID ?? state.itemID,
        quoteData?.preferredPageIndex ?? null,
      );
      return;
    }
    const referenceLabel = pdfReferenceLabelFromNoteHref(message.url);
    if (referenceLabel) {
      const state = states.get(sidebar.mount);
      if (!state) return;
      consume(event);
      void jumpToReadingRouteReference(
        sidebar.mount,
        state,
        referenceLabel,
        state.itemID,
      );
    }
  };

  const targets = notePdfJumpEventTargets(iframeWindow, iframeDocument);
  for (const target of targets) {
    target.addEventListener("pointerdown", onPointerMouse, true);
    target.addEventListener("mousedown", onPointerMouse, true);
    target.addEventListener("mouseup", onPointerMouse, true);
    target.addEventListener("click", onClick, true);
  }
  iframeWindow.addEventListener("message", onOpenURLMessage, true);
  debugZai("note.pdf-jump.installed", {
    targetCount: targets.length,
    routeLinks: iframeDocument?.querySelectorAll(
      'a[data-zai-pdf-location-only="true"]',
    ).length,
  });
  editor._zaiPdfJumpCleanup = () => {
    for (const target of targets) {
      target.removeEventListener("pointerdown", onPointerMouse, true);
      target.removeEventListener("mousedown", onPointerMouse, true);
      target.removeEventListener("mouseup", onPointerMouse, true);
      target.removeEventListener("click", onClick, true);
    }
    iframeWindow.removeEventListener("message", onOpenURLMessage, true);
    destroyActiveRouteHighlight(sidebar.mount);
    if (editor._zaiPdfJumpWindow === iframeWindow) {
      editor._zaiPdfJumpWindow = undefined;
    }
  };
  editor._zaiPdfJumpWindow = iframeWindow;
}

function normalizeZoteroNotePdfLocationOnlyLinks(
  doc: Document | null | undefined,
) {
  if (!doc) return;
  const links = Array.from(
    doc.querySelectorAll('a[data-zai-pdf-location-only="true"]'),
  ) as HTMLAnchorElement[];
  for (const link of links) {
    const selection =
      link.getAttribute("data-zai-pdf-location") ||
      link.getAttribute("data-zai-pdf-selection") ||
      pdfLocationJSONFromNoteHref(link.href) ||
      pdfSelectionJSONFromNoteHref(link.href);
    if (selection && !link.getAttribute("data-zai-pdf-location")) {
      link.setAttribute("data-zai-pdf-location", selection);
    }
    if (selection && !pdfLocationJSONFromNoteHref(link.href)) {
      const baseHref = noteHrefWithoutPdfData(link.href || "#");
      link.href = `${baseHref || "#"}${NOTE_PDF_LOCATION_HASH_MARKER}${encodeURIComponent(
        selection,
      )}`;
    }
  }
}

function normalizeZoteroNotePdfQuoteLinks(doc: Document | null | undefined) {
  if (!doc) return;
  const links = Array.from(
    doc.querySelectorAll("a[data-zai-pdf-quote]"),
  ) as HTMLAnchorElement[];
  for (const link of links) {
    link.textContent = "原文";
    link.title = "点击回到 PDF 原文，并选中这句论据";
  }
}

function notePdfJumpEventTargets(
  iframeWindow: Window,
  doc: Document | null | undefined,
): EventTarget[] {
  const targets: EventTarget[] = [iframeWindow];
  const add = (target: EventTarget | null | undefined) => {
    if (target && !targets.includes(target)) targets.push(target);
  };
  add(doc);
  add(doc?.documentElement);
  add(doc?.body);
  add(doc?.querySelector(".ProseMirror"));
  add(doc?.querySelector("#editor-container"));
  return targets;
}

function notePdfJumpLinkFromEvent(
  event: Event,
  doc: Document | null | undefined,
): HTMLAnchorElement | null {
  const path =
    typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const entry of path) {
    const link = closestNoteElement(
      entry as Node | null,
      "a",
    ) as HTMLAnchorElement | null;
    if (isNotePdfJumpLink(link)) return link;
  }
  const targetLink = closestNoteElement(
    event.target as Node | null,
    "a",
  ) as HTMLAnchorElement | null;
  if (isNotePdfJumpLink(targetLink)) return targetLink;

  const point = event as MouseEvent;
  if (doc && Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) {
    const element = doc.elementFromPoint(point.clientX, point.clientY);
    const pointLink = closestNoteElement(
      element,
      "a",
    ) as HTMLAnchorElement | null;
    if (isNotePdfJumpLink(pointLink)) return pointLink;
    return notePdfJumpLinkAtPoint(doc, point.clientX, point.clientY);
  }
  return null;
}

function notePdfJumpLinkAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): HTMLAnchorElement | null {
  const links = Array.from(
    doc.querySelectorAll(
      "a[data-zai-pdf-location], a[data-zai-pdf-selection], a[data-zai-pdf-quote], a[data-zai-pdf-reference-label]",
    ),
  ) as HTMLAnchorElement[];
  for (const link of links) {
    for (const rect of Array.from(link.getClientRects())) {
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return link;
      }
    }
  }
  return null;
}

function isNotePdfJumpLink(
  link: HTMLAnchorElement | null | undefined,
): link is HTMLAnchorElement {
  return Boolean(
    link &&
    (link.hasAttribute("data-zai-pdf-location") ||
      link.hasAttribute("data-zai-pdf-selection") ||
      link.hasAttribute("data-zai-pdf-quote") ||
      link.hasAttribute("data-zai-pdf-reference-label") ||
      pdfLocationJSONFromNoteHref(link.href) ||
      pdfSelectionJSONFromNoteHref(link.href) ||
      pdfQuoteFromNoteHref(link.href) ||
      pdfReferenceLabelFromNoteHref(link.href)),
  );
}

function isPdfQuoteJumpLink(link: HTMLAnchorElement): boolean {
  return (
    link.classList.contains("zai-pdf-quote-jump") ||
    link.dataset.zaiPdfQuoteLink === "true"
  );
}

function isPdfLocationJumpLink(link: HTMLAnchorElement): boolean {
  return Boolean(
    link.dataset.zaiPdfLocationOnly === "true" ||
    link.hasAttribute("data-zai-pdf-location") ||
    pdfLocationJSONFromNoteHref(link.href),
  );
}

function pdfReferenceLabelFromNoteLink(link: HTMLAnchorElement): string {
  return (
    link.getAttribute("data-zai-pdf-reference-label") ||
    pdfReferenceLabelFromNoteHref(link.href)
  ).trim();
}

function pdfReferenceLabelFromNoteHref(href: string): string {
  const index = href.indexOf(NOTE_PDF_REFERENCE_HASH_MARKER);
  if (index < 0) return "";
  try {
    return decodeURIComponent(
      href.slice(index + NOTE_PDF_REFERENCE_HASH_MARKER.length),
    ).trim();
  } catch {
    return "";
  }
}

function sourceItemIDFromNoteLink(link: HTMLAnchorElement): number | null {
  const raw = link.getAttribute("data-zai-pdf-source-item-id");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function closestNoteElement(
  node: Node | null,
  selector: string,
): Element | null {
  const start =
    node && node.nodeType === 1
      ? (node as Element)
      : ((node as { parentElement?: Element | null } | null)?.parentElement ??
        null);
  return typeof start?.closest === "function" ? start.closest(selector) : null;
}

function ensureAllZoteroNoteEditorKatexCSS(doc: Document): void {
  const editors = Array.from(
    doc.querySelectorAll("note-editor"),
  ) as ZoteroNoteEditorElement[];
  let injected = 0;
  for (const editor of editors) {
    if (ensureZoteroNoteEditorKatexCSS(editor)) injected++;
  }
  debugZai("note-editor-katex-css:scan", {
    editors: editors.length,
    injected,
  });
}

function ensureZoteroNoteEditorKatexCSS(
  editor: ZoteroNoteEditorElement,
): boolean {
  const iframeDoc = editor.getCurrentInstance?.()?._iframeWindow?.document;
  if (!iframeDoc) return false;
  ensureKatexCSSInDocument(iframeDoc);
  return true;
}

function ensureKatexCSSInDocument(doc: Document): void {
  const root = doc.head ?? doc.documentElement;
  if (!root) return;

  if (!doc.getElementById("zai-katex-css-link")) {
    const link = doc.createElement("link");
    link.id = "zai-katex-css-link";
    link.rel = "stylesheet";
    link.href = `chrome://${addon.data.config.addonRef}/content/katex/katex.min.css`;
    root.append(link);
  }

  if (!doc.getElementById("zai-katex-css-fallback")) {
    const style = doc.createElement("style");
    style.id = "zai-katex-css-fallback";
    style.textContent = `
.katex .katex-mathml {
  position: absolute;
  clip: rect(1px, 1px, 1px, 1px);
  padding: 0;
  border: 0;
  height: 1px;
  width: 1px;
  overflow: hidden;
}
.katex-display {
  display: block;
  margin: 1em 0;
  text-align: center;
}
.katex-display > .katex {
  display: block;
  text-align: center;
  white-space: nowrap;
}
.zai-note-pdf-jump {
  margin: 0.35em 0 0.8em;
}
.zai-note-pdf-selection-link {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid #c7dfe8;
  border-radius: 999px;
  color: #2d6f8f;
  font-size: 0.9em;
  font-weight: 700;
  text-decoration: none;
}
.zai-note-pdf-selection-link:hover {
  border-color: #2d6f8f;
  text-decoration: none;
}
/* The note editor (ProseMirror) keeps only an <a>'s href across a save —
   class and data-* attributes are stripped. Match the surviving #zaiQuote=
   href so the quote link stays low-key grey, not the editor's blue default. */
.zai-pdf-quote-jump,
a[href*="${NOTE_PDF_QUOTE_HASH_MARKER}"] {
  margin-inline-start: 4px;
  color: #b3b3b3 !important;
  font-size: 0.72em;
  font-weight: normal;
  text-decoration: none !important;
  cursor: pointer;
}
.zai-pdf-quote-jump:hover,
a[href*="${NOTE_PDF_QUOTE_HASH_MARKER}"]:hover {
  color: #7a7a7a !important;
  text-decoration: none !important;
}
.zai-pdf-quote-active {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
}
.zai-reading-route-key {
  margin: 0 2px;
  padding: 1px 4px;
  border-radius: 4px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.zai-reading-route-key[data-zai-reading-route-tone="blue"] {
  background: rgba(46, 168, 229, 0.28) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="yellow"] {
  background: rgba(255, 212, 0, 0.36) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="red"] {
  background: rgba(255, 102, 102, 0.28) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="green"] {
  background: rgba(95, 178, 54, 0.28) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="purple"] {
  background: rgba(162, 138, 229, 0.28) !important;
}
.zai-reading-route-key[data-zai-reading-route-tone="orange"] {
  background: rgba(241, 152, 55, 0.32) !important;
}
`;
    root.append(style);
  }
}

function closeZoteroNoteWindow(
  sidebar: WindowSidebarState,
  editor: ZoteroNoteEditorElement,
  closeButton: HTMLButtonElement,
) {
  try {
    closeButton.disabled = true;
    editor.saveSync?.();
    sidebar.noteItemID = undefined;
    sidebar.noteEditorCleanup?.();
    sidebar.noteEditorCleanup = undefined;
    sidebar.noteMount.replaceChildren();
    setNoteColumnVisible(sidebar, false);
    updateOpenNoteButton(sidebar);
  } finally {
    closeButton.disabled = false;
  }
}

async function closeNoteWindow(
  sidebar: WindowSidebarState,
  note: Zotero.Item,
  editor: HTMLElement,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
  closeButton: HTMLButtonElement,
) {
  try {
    closeButton.disabled = true;
    await autosaveNoteNow(sidebar, note, editor, status, saveButton);
    sidebar.noteItemID = undefined;
    sidebar.noteEditorCleanup?.();
    sidebar.noteEditorCleanup = undefined;
    sidebar.noteMount.replaceChildren();
    setNoteColumnVisible(sidebar, false);
    updateOpenNoteButton(sidebar);
  } finally {
    closeButton.disabled = false;
  }
}

function scheduleAutosaveNote(
  sidebar: WindowSidebarState,
  note: Zotero.Item,
  editor: HTMLElement,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  const win = editor.ownerDocument?.defaultView;
  if (sidebar.noteAutosaveTimer && win) {
    win.clearTimeout(sidebar.noteAutosaveTimer);
  }
  if (!isNoteEditorDirty(editor)) {
    updateNoteSaveState(editor, saveButton);
    return;
  }
  status.textContent = "未保存";
  sidebar.noteAutosaveTimer = win?.setTimeout(() => {
    sidebar.noteAutosaveTimer = undefined;
    void autosaveNoteNow(sidebar, note, editor, status, saveButton);
  }, 1800);
}

async function autosaveNoteNow(
  sidebar: WindowSidebarState,
  note: Zotero.Item,
  editor: HTMLElement,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  const win = editor.ownerDocument?.defaultView;
  if (sidebar.noteAutosaveTimer && win) {
    win.clearTimeout(sidebar.noteAutosaveTimer);
    sidebar.noteAutosaveTimer = undefined;
  }
  if (!isNoteEditorDirty(editor)) {
    updateNoteSaveState(editor, saveButton);
    return;
  }
  if (sidebar.noteAutosavePromise) {
    await sidebar.noteAutosavePromise;
  }
  status.textContent = "保存中...";
  saveButton.disabled = true;
  const selection = saveEditableSelection(editor);
  sidebar.noteAutosavePromise = (async () => {
    const html = editableNoteHTML(editor);
    note.setNote(html || "<p></p>");
    await note.saveTx();
  })();
  try {
    await sidebar.noteAutosavePromise;
    editor.dataset.savedHTML = editableNoteHTML(editor);
    status.textContent = "已保存";
    updateNoteSaveState(editor, saveButton);
    restoreEditableSelectionIfLost(editor, selection);
  } catch (err) {
    status.textContent = "保存失败";
    status.title = err instanceof Error ? err.message : String(err);
    updateNoteSaveState(editor, saveButton);
    restoreEditableSelectionIfLost(editor, selection);
    throw err;
  } finally {
    sidebar.noteAutosavePromise = undefined;
  }
}

function isNoteEditorDirty(editor: HTMLElement): boolean {
  return editableNoteHTML(editor) !== (editor.dataset.savedHTML ?? "");
}

function updateNoteSaveState(
  editor: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  const dirty = isNoteEditorDirty(editor);
  saveButton.disabled = !dirty;
  saveButton.title = dirty ? "保存当前修改 (Ctrl+S)" : "没有未保存修改";
}

function findSidebarStateByDocument(doc: Document): WindowSidebarState | null {
  for (const win of mountedWindows) {
    const state = windowSidebars.get(win);
    if (state?.mount.ownerDocument === doc) return state;
  }
  return null;
}

function findSidebarStateByMount(
  mount: HTMLElement,
): WindowSidebarState | null {
  for (const win of mountedWindows) {
    const state = windowSidebars.get(win);
    if (state?.mount === mount) return state;
  }
  return null;
}

function isNoteWindowOpenForMount(mount: HTMLElement): boolean {
  const sidebar = findSidebarStateByMount(mount);
  if (!sidebar?.noteItemID) return false;
  // Auto-repair: if the note column is hidden/collapsed (e.g. user dragged the
  // splitter closed instead of clicking the Close button), clear the stale state.
  const col = sidebar.noteColumn as Element & {
    hidden?: boolean;
    collapsed?: boolean;
  };
  if (
    col.hidden ||
    col.collapsed ||
    col.getAttribute("hidden") === "true" ||
    col.getAttribute("collapsed") === "true"
  ) {
    sidebar.noteItemID = undefined;
    sidebar.noteEditorCleanup?.();
    sidebar.noteEditorCleanup = undefined;
    return false;
  }
  return true;
}

function updateOpenNoteButton(state: WindowSidebarState) {
  const button = state.mount.querySelector(
    ".open-note-button",
  ) as HTMLButtonElement | null;
  if (!button) return;
  const opened = !!state.noteItemID;
  button.textContent = opened ? "关闭笔记" : "打开笔记";
  button.title = opened
    ? "关闭笔记列"
    : "在当前 Zotero 窗口打开当前条目的子笔记";
  button.disabled = false;
}

function closeCurrentNoteWindow(mount: HTMLElement): void {
  const sidebar = findSidebarStateByMount(mount);
  if (!sidebar?.noteItemID) return;
  const editor = findActiveNoteEditor(sidebar);
  const closeBtn = sidebar.noteMount.querySelector(
    ".zai-note-window-button:last-of-type",
  ) as HTMLButtonElement | null;
  if (editor && closeBtn) {
    closeZoteroNoteWindow(sidebar, editor, closeBtn);
  } else {
    sidebar.noteItemID = undefined;
    sidebar.noteEditorCleanup?.();
    sidebar.noteEditorCleanup = undefined;
    sidebar.noteMount.replaceChildren();
    setNoteColumnVisible(sidebar, false);
    updateOpenNoteButton(sidebar);
  }
}

function setNoteColumnVisible(state: WindowSidebarState, visible: boolean) {
  const noteColumn = state.noteColumn as Element & {
    hidden?: boolean;
    collapsed?: boolean;
  };
  const noteSplitter = state.noteSplitter as Element & { hidden?: boolean };
  if (!visible) {
    rememberLastNoteWidth(state);
  }
  noteColumn.hidden = !visible;
  noteSplitter.hidden = !visible;
  if (visible) {
    noteColumn.collapsed = false;
    state.noteColumn.removeAttribute("collapsed");
    state.noteColumn.removeAttribute("hidden");
    state.noteSplitter.removeAttribute("hidden");
    applyLastNoteWidth(state);
    return;
  }
  noteColumn.collapsed = true;
  state.noteColumn.setAttribute("collapsed", "true");
  state.noteColumn.setAttribute("hidden", "true");
  state.noteSplitter.setAttribute("hidden", "true");
}

function refreshVisibleNoteWindow(
  doc: Document,
  noteID: number,
  scrollSnapshot: NoteScrollSnapshot | null = null,
) {
  const sidebar = findSidebarStateByDocument(doc);
  if (sidebar?.noteItemID !== noteID) return;
  const note = getZoteroItem(noteID);
  if (!isZoteroNote(note)) return;
  const scroll = scrollSnapshot ?? captureVisibleNoteScroll(sidebar);
  sidebar.noteRestoreSnapshot = scroll ?? undefined;
  debugZai("note-restore.refresh-render", {
    noteID,
    snapshot: scroll ? noteScrollSnapshotDebugInfo(scroll) : null,
    rootsBefore: noteEditorDebugRoots(findActiveNoteEditor(sidebar)),
  });
  renderNoteWindow(sidebar, note);
  restoreVisibleNoteScroll(sidebar, scroll, "refreshVisibleNoteWindow");
}

function captureVisibleNoteScrollForDocument(
  doc: Document,
): NoteScrollSnapshot | null {
  const sidebar = findSidebarStateByDocument(doc);
  return sidebar ? captureVisibleNoteScroll(sidebar) : null;
}

function armVisibleNoteRestoreForDocument(
  doc: Document,
  snapshot: NoteScrollSnapshot | null,
  reason: string,
): void {
  const sidebar = findSidebarStateByDocument(doc);
  if (!sidebar || !snapshot) {
    debugZai("note-restore.arm-skipped", { reason, hasSnapshot: !!snapshot });
    return;
  }
  sidebar.noteRestoreSnapshot = snapshot;
  sidebar.noteSuppressAutoFocusUntil = Date.now() + 3000;
  debugZai("note-restore.arm", {
    reason,
    noteID: sidebar.noteItemID,
    suppressAutoFocusUntil: sidebar.noteSuppressAutoFocusUntil,
    snapshot: noteScrollSnapshotDebugInfo(snapshot),
    roots: noteEditorDebugRoots(findActiveNoteEditor(sidebar)),
  });
}

function captureVisibleNoteScroll(
  sidebar: WindowSidebarState,
): NoteScrollSnapshot | null {
  const editor = findActiveNoteEditor(sidebar);
  const iframeWin = editor?.getCurrentInstance?.()?._iframeWindow;
  const scrollRoot = noteEditorScrollRoot(editor);
  const pointer = notePointerSnapshotForSidebar(sidebar);
  const caret =
    (editor ? captureNoteCaretSnapshot(editor, sidebar.noteItemID) : null) ??
    noteCaretSnapshotForSidebar(sidebar);
  if (scrollRoot) {
    const snapshot = {
      top: scrollRoot.scrollTop,
      left: scrollRoot.scrollLeft,
      windowX: iframeWin?.scrollX,
      windowY: iframeWin?.scrollY,
      ...(pointer ? { pointer } : {}),
      ...(caret ? { caret } : {}),
    };
    debugZai("note-restore.capture", {
      noteID: sidebar.noteItemID,
      snapshot: noteScrollSnapshotDebugInfo(snapshot),
      root: noteElementDebugInfo(scrollRoot),
      roots: noteEditorDebugRoots(editor),
    });
    return snapshot;
  }
  const fallback = sidebar.noteMount.querySelector(
    ".zai-note-rich-editor",
  ) as HTMLElement | null;
  const snapshot = fallback
    ? {
        top: fallback.scrollTop,
        left: fallback.scrollLeft,
        ...(pointer ? { pointer } : {}),
        ...(caret ? { caret } : {}),
      }
    : null;
  debugZai("note-restore.capture", {
    noteID: sidebar.noteItemID,
    snapshot: snapshot ? noteScrollSnapshotDebugInfo(snapshot) : null,
    fallback: fallback ? noteElementDebugInfo(fallback) : null,
    roots: noteEditorDebugRoots(editor),
  });
  return snapshot;
}

async function writeAssistantMessageToNote(
  doc: Document,
  itemID: number | null,
  message: Message,
  button: HTMLButtonElement,
  pdfSelection: PdfSelectionLocator | null = null,
) {
  const originalText = button.textContent || "写入笔记";
  const originalTitle = button.title;
  button.textContent = "写入中...";
  button.disabled = true;

  try {
    const noteScroll = captureVisibleNoteScrollForDocument(doc);
    armVisibleNoteRestoreForDocument(
      doc,
      noteScroll,
      "button-write:before-insert",
    );
    const result = await appendAssistantContentToItemNote(
      doc,
      itemID,
      message.content,
      pdfSelection,
    );
    button.textContent = result.usedBetterNotes
      ? "已写入 BN"
      : result.created
        ? "已新建笔记"
        : "已写入";
    button.title = `目标笔记 #${result.noteID}`;
    refreshVisibleNoteWindow(doc, result.noteID, noteScroll);
  } catch (err) {
    button.textContent = "写入失败";
    button.title = err instanceof Error ? err.message : String(err);
  } finally {
    doc.defaultView?.setTimeout(() => {
      button.textContent = originalText;
      button.title = originalTitle;
      button.disabled = false;
    }, 1400);
  }
}

async function appendAssistantContentToItemNote(
  doc: Document,
  itemID: number | null,
  content: string,
  pdfSelection: PdfSelectionLocator | null = null,
): Promise<{ noteID: number; created: boolean; usedBetterNotes: boolean }> {
  if (itemID == null) throw new Error("未选择 Zotero 条目");
  const target = await resolveTargetNote(itemID);
  const html = await assistantContentToNoteHTML(
    doc,
    itemID,
    content,
    pdfSelection,
  );
  const usedBetterNotes = await insertHTMLIntoNote(target.note, html);
  return {
    noteID: target.note.id,
    created: target.created,
    usedBetterNotes,
  };
}

async function saveReadingRouteToDedicatedNote(
  doc: Document,
  itemID: number | null,
  markdown: string,
): Promise<{ note: Zotero.Item; created: boolean }> {
  const startedAt = Date.now();
  let stage = "resolve-note";
  debugZai("reading-route.save:start", {
    itemID,
    markdown: textDebugInfo(markdown),
    markdownChars: readingRouteStringDiagnostics(markdown),
  });
  try {
    const target = await resolveReadingRouteNote(itemID);
    debugZai("reading-route.save:note", {
      itemID,
      noteID: target.note.id,
      created: target.created,
      noteTitle: noteTitle(target.note),
    });

    stage = "read-existing-note";
    const existing = target.note.getNote?.() || "";
    debugZai("reading-route.save:existing", {
      noteID: target.note.id,
      existing: htmlStringDebugInfo(existing),
      existingChars: readingRouteStringDiagnostics(existing),
    });

    stage = "pdf-reference-links";
    const jumpLinks = await readingRoutePdfJumpLinks(doc, itemID, markdown);
    debugZai("reading-route.save:reference-links", {
      count: jumpLinks.size,
      keys: Array.from(jumpLinks.keys()).slice(0, 12),
    });

    stage = "pdf-quote-links";
    const quoteLinks = await readingRoutePdfQuoteJumpLinks(
      doc,
      itemID,
      markdown,
    );
    debugZai("reading-route.save:quote-links", {
      count: quoteLinks.size,
      keys: Array.from(quoteLinks.keys()).slice(0, 8),
    });

    stage = "build-note-html";
    const html = readingRouteNoteHTML(
      doc,
      itemID,
      markdown,
      existing,
      jumpLinks,
      quoteLinks,
    );
    debugZai("reading-route.save:html-built", {
      noteID: target.note.id,
      html: htmlStringDebugInfo(html),
      htmlChars: readingRouteStringDiagnostics(html),
    });

    stage = "set-note";
    try {
      target.note.setNote(html);
    } catch (err) {
      debugZai("reading-route.save:set-note-failed", {
        noteID: target.note.id,
        error: readingRouteErrorDebugInfo(err),
        html: htmlStringDebugInfo(html),
        htmlChars: readingRouteStringDiagnostics(html),
      });
      throw err;
    }

    stage = "save-note";
    try {
      await target.note.saveTx();
    } catch (err) {
      debugZai("reading-route.save:save-tx-failed", {
        noteID: target.note.id,
        error: readingRouteErrorDebugInfo(err),
        noteAfterSet: htmlStringDebugInfo(target.note.getNote?.() || ""),
      });
      throw err;
    }

    debugZai("reading-route.save:done", {
      noteID: target.note.id,
      ms: Date.now() - startedAt,
    });
    return target;
  } catch (err) {
    debugZai("reading-route.save:failed", {
      itemID,
      stage,
      ms: Date.now() - startedAt,
      error: readingRouteErrorDebugInfo(err),
    });
    throw err;
  }
}

function readingRouteNoteHTML(
  doc: Document,
  itemID: number | null,
  markdown: string,
  existing: string,
  jumpLinks: Map<string, PdfSelectionLocator> = new Map(),
  quoteLinks: Map<string, PdfSelectionLocator> = new Map(),
): string {
  let stage = "init";
  debugZai("reading-route.html:start", {
    itemID,
    markdown: textDebugInfo(markdown),
    existing: htmlStringDebugInfo(existing),
  });
  const root = doc.createElement("div");
  try {
    stage = "title";
    const title = doc.createElement("h1");
    title.append(dedicatedNoteMarker(doc, "readingRoute"));
    title.append(doc.createTextNode(READING_ROUTE_NOTE_TITLE));
    root.append(title);

    stage = "metadata";
    const meta = doc.createElement("p");
    const small = doc.createElement("small");
    small.textContent =
      `生成时间：${formatNoteTimestamp(new Date())}` +
      " · 来源：Zotero AI Sidebar · 方法：Keshav three-pass approach";
    meta.append(small);
    root.append(meta);

    stage = "render-markdown";
    const body = doc.createElement("div");
    renderMarkdownInto(body, markdown.trim(), "source");
    debugZai("reading-route.html:markdown-rendered", {
      body: readingRouteElementDebugInfo(body),
    });

    stage = "link-references";
    linkReadingRoutePdfReferences(body, jumpLinks, itemID);
    debugZai("reading-route.html:references-linked", {
      body: readingRouteElementDebugInfo(body),
    });

    stage = "link-quotes";
    installPdfQuoteButtonsInElement(body, { sourceItemID: itemID, quoteLinks });
    debugZai("reading-route.html:quotes-linked", {
      body: readingRouteElementDebugInfo(body),
    });

    stage = "highlight-bullets";
    highlightReadingRouteKeyBullets(body);
    debugZai("reading-route.html:bullets-highlighted", {
      body: readingRouteElementDebugInfo(body),
    });

    stage = "append-body";
    while (body.firstChild) root.appendChild(body.firstChild);

    stage = "extract-manual";
    root.append(doc.createElement("hr"));
    const manualNodes = extractReadingRouteManualNodes(doc, existing);
    debugZai("reading-route.html:manual-extracted", {
      hasManual: manualNodes.length > 0,
      manual: readingRouteNodesDebugInfo(manualNodes),
    });
    if (manualNodes.length) {
      stage = "append-existing-manual";
      for (const node of manualNodes) root.appendChild(node);
    } else {
      stage = "append-empty-manual";
      const manualTitle = doc.createElement("h2");
      manualTitle.textContent = READING_ROUTE_MANUAL_HEADING;
      manualTitle.setAttribute("data-zai-reading-route-manual", "true");
      root.append(manualTitle, doc.createElement("p"));
    }

    stage = "serialize";
    const html = String(root.innerHTML);
    debugZai("reading-route.html:done", {
      html: htmlStringDebugInfo(html),
      htmlChars: readingRouteStringDiagnostics(html),
    });
    return html;
  } catch (err) {
    debugZai("reading-route.html:failed", {
      stage,
      error: readingRouteErrorDebugInfo(err),
      root: readingRouteElementDebugInfo(root),
    });
    throw err;
  }
}

function readingRouteElementDebugInfo(
  root: HTMLElement,
): Record<string, unknown> {
  let html = "";
  let htmlInfo: unknown = null;
  try {
    html = String(root.innerHTML);
    htmlInfo = htmlStringDebugInfo(html);
  } catch (err) {
    htmlInfo = { error: readingRouteErrorDebugInfo(err) };
  }
  return {
    childNodes: root.childNodes.length,
    children: root.children.length,
    headings: root.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    lists: root.querySelectorAll("ul,ol").length,
    listItems: root.querySelectorAll("li").length,
    blockquotes: root.querySelectorAll("blockquote").length,
    links: root.querySelectorAll("a").length,
    quoteLinks: root.querySelectorAll(
      "[data-zai-pdf-quote],.zai-pdf-quote-jump",
    ).length,
    referenceLinks: root.querySelectorAll("[data-zai-pdf-reference-label]")
      .length,
    math: root.querySelectorAll(".math,[data-latex]").length,
    html: htmlInfo,
    chars: html ? readingRouteStringDiagnostics(html) : null,
  };
}

function readingRouteNodesDebugInfo(nodes: Node[]): Record<string, unknown> {
  let html = "";
  let htmlInfo: unknown = null;
  try {
    const doc = nodes[0]?.ownerDocument;
    const root = doc?.createElement("div");
    if (root) {
      for (const node of nodes) root.appendChild(node.cloneNode(true));
      html = String(root.innerHTML);
      htmlInfo = htmlStringDebugInfo(html);
    }
  } catch (err) {
    htmlInfo = { error: readingRouteErrorDebugInfo(err) };
  }

  const elementNodes = nodes.filter((node) => node.nodeType === 1) as Element[];
  return {
    nodes: nodes.length,
    elements: elementNodes.length,
    topTags: elementNodes.slice(0, 8).map((node) => node.tagName),
    text: textDebugInfo(nodes.map((node) => node.textContent || "").join(" ")),
    html: htmlInfo,
    chars: html ? readingRouteStringDiagnostics(html) : null,
  };
}

function readingRouteErrorDebugInfo(err: unknown): Record<string, unknown> {
  const anyErr = err as
    | (Error & { code?: unknown; result?: unknown; name?: string })
    | null
    | undefined;
  return {
    name: anyErr?.name ?? (err == null ? String(err) : typeof err),
    message: errorMessage(err),
    code: anyErr?.code,
    result: anyErr?.result,
    stack:
      typeof anyErr?.stack === "string"
        ? textDebugInfo(anyErr.stack, 800)
        : undefined,
  };
}

function readingRouteStringDiagnostics(value: string): Record<string, unknown> {
  const invalidControlSamples: Array<Record<string, unknown>> = [];
  const surrogateSamples: Array<Record<string, unknown>> = [];
  let invalidControls = 0;
  let c1Controls = 0;
  let loneSurrogates = 0;
  let replacementChars = 0;
  let lineSeparators = 0;

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code >= 0x00 && code < 0x09) || (code > 0x0d && code < 0x20)) {
      invalidControls++;
      if (invalidControlSamples.length < 8) {
        invalidControlSamples.push(readingRouteCodeUnitDebug(value, index));
      }
    } else if (code >= 0x7f && code <= 0x9f) {
      c1Controls++;
      if (invalidControlSamples.length < 8) {
        invalidControlSamples.push(readingRouteCodeUnitDebug(value, index));
      }
    }

    if (code === 0xfffd) replacementChars++;
    if (code === 0x2028 || code === 0x2029) lineSeparators++;

    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    const next = value.charCodeAt(index + 1);
    const prev = value.charCodeAt(index - 1);
    const pairedHigh = isHigh && next >= 0xdc00 && next <= 0xdfff;
    const pairedLow = isLow && prev >= 0xd800 && prev <= 0xdbff;
    if ((isHigh && !pairedHigh) || (isLow && !pairedLow)) {
      loneSurrogates++;
      if (surrogateSamples.length < 8) {
        surrogateSamples.push(readingRouteCodeUnitDebug(value, index));
      }
    }
  }

  return {
    length: value.length,
    codePoints: Array.from(value).length,
    invalidControls,
    c1Controls,
    loneSurrogates,
    replacementChars,
    lineSeparators,
    invalidControlSamples,
    surrogateSamples,
  };
}

function readingRouteCodeUnitDebug(
  value: string,
  index: number,
): Record<string, unknown> {
  const code = value.charCodeAt(index);
  return {
    index,
    codeUnit: `0x${code.toString(16).padStart(4, "0")}`,
    before: value.slice(Math.max(0, index - 12), index).replace(/\s+/g, " "),
    after: value.slice(index + 1, index + 13).replace(/\s+/g, " "),
  };
}

function encodeURIComponentWithDebug(
  value: string,
  label: string,
  detail: Record<string, unknown>,
): string {
  try {
    return encodeURIComponent(value);
  } catch (err) {
    debugZai("reading-route.link:encode-failed", {
      label,
      ...detail,
      value: textDebugInfo(value, 200),
      chars: readingRouteStringDiagnostics(value),
      error: readingRouteErrorDebugInfo(err),
    });
    throw err;
  }
}

function assignHrefWithDebug(
  link: HTMLAnchorElement,
  href: string,
  label: string,
  detail: Record<string, unknown>,
): void {
  try {
    link.href = href;
  } catch (err) {
    debugZai("reading-route.link:href-failed", {
      label,
      ...detail,
      href: textDebugInfo(href, 200),
      chars: readingRouteStringDiagnostics(href),
      error: readingRouteErrorDebugInfo(err),
    });
    throw err;
  }
}

function setAttributeWithDebug(
  element: Element,
  name: string,
  value: string,
  label: string,
  detail: Record<string, unknown>,
): void {
  try {
    element.setAttribute(name, value);
  } catch (err) {
    debugZai("reading-route.link:attribute-failed", {
      label,
      name,
      ...detail,
      value: textDebugInfo(value, 200),
      chars: readingRouteStringDiagnostics(value),
      error: readingRouteErrorDebugInfo(err),
    });
    throw err;
  }
}

async function readingRoutePdfJumpLinks(
  doc: Document,
  itemID: number | null,
  markdown: string,
): Promise<Map<string, PdfSelectionLocator>> {
  const labels = readingRouteReferenceLabels(markdown);
  const links = new Map<string, PdfSelectionLocator>();
  if (!labels.length || itemID == null) return links;

  const reader = getReaderForAttachmentOrItem(doc.defaultView, itemID, null);
  if (!reader) return links;

  let locator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    locator = await createPdfLocator(reader);
    for (const label of labels.slice(0, 48)) {
      const result = await locateReadingRouteReference(locator, label);
      if (!result) continue;
      links.set(readingRouteReferenceKey(label), {
        attachmentID: locator.attachmentID,
        selectedText: result.matchedText || label,
        pageIndex: result.pageIndex,
        pageLabel: result.pageLabel,
        position: {
          pageIndex: result.pageIndex,
          rects: result.rects,
          ...(result.anchorOffset != null
            ? { zaiAnchorOffset: result.anchorOffset }
            : {}),
          ...(result.headOffset != null
            ? { zaiHeadOffset: result.headOffset }
            : {}),
        },
      });
    }
  } catch (err) {
    debugZai("reading-route.pdf-links.failed", { error: errorMessage(err) });
  } finally {
    locator?.dispose();
  }
  return links;
}

async function readingRoutePdfQuoteJumpLinks(
  doc: Document,
  itemID: number | null,
  markdown: string,
): Promise<Map<string, PdfSelectionLocator>> {
  const links = new Map<string, PdfSelectionLocator>();
  if (itemID == null) return links;

  const body = doc.createElement("div");
  renderMarkdownInto(body, markdown.trim(), "source");
  const quotes = uniqueStrings(
    pdfQuoteBlocks(body, PDF_QUOTE_MIN_CHARS)
      .slice(0, PDF_QUOTE_MAX_PER_RENDER)
      .map((block) =>
        firstPdfQuoteLocateCandidate(
          pdfQuoteBlockLocateText(block),
          PDF_QUOTE_MIN_CHARS,
        ),
      )
      .filter(Boolean),
  );
  debugZai("reading-route.quote-links:quotes", {
    itemID,
    count: quotes.length,
    sample: quotes.slice(0, 6).map((quote) => ({
      quote: textDebugInfo(quote, 120),
      chars: readingRouteStringDiagnostics(quote),
    })),
  });
  if (!quotes.length) return links;

  const reader = getReaderForAttachmentOrItem(doc.defaultView, itemID, null);
  if (!reader) return links;

  let locator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    locator = await createPdfLocator(reader);
    for (const quote of quotes) {
      debugZai("reading-route.quote-links:locate", {
        quote: textDebugInfo(quote, 120),
        chars: readingRouteStringDiagnostics(quote),
      });
      const result = await locatePdfQuoteBlock(locator, quote);
      if (!result) continue;
      links.set(pdfQuoteLinkKey(quote), result);
    }
  } catch (err) {
    debugZai("reading-route.pdf-quote-links.failed", {
      error: errorMessage(err),
    });
  } finally {
    locator?.dispose();
  }
  return links;
}

function noteTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const collect = (node: Node) => {
    if (node.nodeType === 3) {
      nodes.push(node as Text);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.closest("a")) return;
    for (const child of Array.from(node.childNodes)) {
      if (child) collect(child);
    }
  };
  collect(root);
  return nodes;
}

function linkReadingRoutePdfReferences(
  root: HTMLElement,
  jumpLinks: Map<string, PdfSelectionLocator>,
  itemID: number | null = null,
) {
  const doc = root.ownerDocument!;
  const textNodes = noteTextNodes(root);
  const pattern =
    /\b(?:Fig(?:ure)?\.?|Table)\s*\d+[A-Za-z]?\b|\b(?:Eq(?:uation)?\.?|Equation)\s*\(?\d+[A-Za-z]?\)?(?:\s*[-–—]\s*\(?\d+[A-Za-z]?\)?)?/gi;
  for (const node of textNodes) {
    const text = node.textContent || "";
    pattern.lastIndex = 0;
    let lastIndex = 0;
    let changed = false;
    const fragment = doc.createDocumentFragment();
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const raw = match[0];
      const locator = jumpLinks.get(readingRouteReferenceKey(raw));
      if (start > lastIndex) {
        fragment.append(doc.createTextNode(text.slice(lastIndex, start)));
      }
      fragment.append(
        locator
          ? readingRoutePdfReferenceLink(doc, raw, locator)
          : readingRoutePdfReferenceFallbackLink(doc, raw, itemID),
      );
      lastIndex = start + raw.length;
      changed = true;
    }
    if (!changed) continue;
    if (lastIndex < text.length) {
      fragment.append(doc.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode?.replaceChild(fragment, node);
  }
}

const NOTE_PDF_REFERENCE_HASH_MARKER = "#zaiReference=";

function readingRoutePdfReferenceFallbackLink(
  doc: Document,
  label: string,
  itemID: number | null,
): HTMLAnchorElement {
  const link = doc.createElement("a");
  const kind = readingRouteReferenceParts(label)?.kind;
  link.className = "zai-note-pdf-selection-link";
  link.href = `${NOTE_PDF_REFERENCE_HASH_MARKER}${encodeURIComponent(label)}`;
  link.textContent = label;
  link.title = "点击后临时定位 PDF 图表/公式位置";
  link.setAttribute("data-zai-pdf-reference-label", label);
  if (kind) link.setAttribute("data-zai-pdf-reference-kind", kind);
  if (itemID != null) {
    link.setAttribute("data-zai-pdf-source-item-id", String(itemID));
  }
  return link;
}

function readingRoutePdfReferenceLink(
  doc: Document,
  label: string,
  locator: PdfSelectionLocator,
): HTMLAnchorElement {
  const link = doc.createElement("a");
  const href = pdfOpenUrlForSelection(locator);
  const data = JSON.stringify(pdfSelectionForNoteData(locator));
  link.className = "zai-note-pdf-selection-link";
  link.href = `${href || "#"}${NOTE_PDF_LOCATION_HASH_MARKER}${encodeURIComponent(
    data,
  )}`;
  link.textContent = label;
  link.title = `跳转到 PDF 第 ${locator.pageLabel ?? String((locator.pageIndex ?? 0) + 1)} 页`;
  link.setAttribute("data-zai-pdf-location", data);
  link.setAttribute("data-zai-pdf-location-only", "true");
  const kind = readingRouteReferenceParts(label)?.kind;
  if (kind) link.setAttribute("data-zai-pdf-reference-kind", kind);
  return link;
}

function extractReadingRouteManualNodes(
  doc: Document,
  existing: string,
): Node[] {
  if (!existing.trim()) return [];
  const htmlDoc = doc.implementation.createHTMLDocument(
    "zai-reading-route-existing",
  );
  const body = htmlDoc.body;
  if (!body) return [];
  body.innerHTML = existing;
  const heading = (
    Array.from(body.querySelectorAll("h1,h2,h3,h4,h5,h6")) as HTMLElement[]
  ).find((node) => node.textContent?.trim() === READING_ROUTE_MANUAL_HEADING);
  if (!heading) return [];

  const nodes: Node[] = [];
  for (let node: any = heading; node; node = node.nextSibling) {
    nodes.push(doc.importNode(node, true));
  }
  return nodes;
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function resolveStandaloneAttachmentNote(
  pdf: Zotero.Item,
): Promise<{ note: Zotero.Item; created: boolean }> {
  // Create a parent item and reparent the PDF under it so both the PDF and
  // the note end up as children of the same Zotero item.
  const parent = await createParentForStandalonePDF(pdf);
  const note = await createChildNote(parent);
  return { note, created: true };
}

// Walk the item's dc:relation URIs looking for a note item.
async function findRelatedNote(item: Zotero.Item): Promise<Zotero.Item | null> {
  const relations = (item as any).getRelations?.() as
    | Record<string, string | string[]>
    | undefined;
  if (!relations) return null;

  const raw = relations["dc:relation"];
  const uris: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  for (const uri of uris) {
    try {
      const related = await (Zotero as any).URI.getURIItem(uri);
      if (related && isZoteroNote(related)) return related as Zotero.Item;
    } catch {
      // ignore stale or malformed URIs
    }
  }
  return null;
}

// Add a mutual dc:relation between two items (Zotero's official relation API).
async function linkItemsViaRelation(
  a: Zotero.Item,
  b: Zotero.Item,
): Promise<void> {
  try {
    const uriA = (Zotero as any).URI.getItemURI(a) as string;
    const uriB = (Zotero as any).URI.getItemURI(b) as string;
    (a as any).addRelation("dc:relation", uriB);
    await a.saveTx();
    (b as any).addRelation("dc:relation", uriA);
    await b.saveTx();
  } catch (err) {
    debugZai("standalone-note:link-relation-failed", { err: String(err) });
  }
}

async function createStandaloneNote(pdf: Zotero.Item): Promise<Zotero.Item> {
  const note = new (
    Zotero as unknown as { Item: new (type: string) => any }
  ).Item("note") as Zotero.Item;
  note.libraryID = pdf.libraryID;
  const title =
    (pdf as any).getField?.("title") || (pdf as any).getDisplayTitle?.() || "";
  note.setNote(`<p>AI 笔记${title ? ` — ${title}` : ""}</p>`);
  // Place the note in the same collections as the PDF so it stays visible alongside it.
  const collectionIDs = (pdf as any).getCollections?.() as number[] | undefined;
  if (collectionIDs && collectionIDs.length > 0) {
    (note as any).setCollections?.(collectionIDs);
  }
  await note.saveTx();
  return note;
}

interface PdfQuoteButtonOptions {
  onJump?: (quote: string, block: HTMLElement) => void | Promise<void>;
  sourceItemID?: number | null;
  preferredAttachmentID?: number | null;
  preferredPageIndex?: number | null;
  quoteLinks?: Map<string, PdfSelectionLocator>;
}

function installPdfQuoteButtonsInElement(
  root: HTMLElement,
  options: PdfQuoteButtonOptions = {},
): void {
  const blocks = pdfQuoteBlocks(root, PDF_QUOTE_MIN_CHARS).slice(
    0,
    PDF_QUOTE_BUTTON_LIMIT,
  );
  if (!blocks.length) return;
  for (const block of blocks) {
    // Idempotent across re-renders: chat blocks carry the .zai-pdf-quote-block
    // class, note blocks carry an <a.zai-pdf-quote-jump> child.
    if (
      block.classList.contains("zai-pdf-quote-block") ||
      block.querySelector(".zai-pdf-quote-jump")
    )
      continue;
    const quote = firstPdfQuoteLocateCandidate(
      pdfQuoteBlockLocateText(block),
      PDF_QUOTE_MIN_CHARS,
    );
    if (!quote) continue;
    wrapPdfQuoteBlock(block, quote, {
      ...options,
      prelocatedSelection: options.quoteLinks?.get(pdfQuoteLinkKey(quote)),
    });
  }
}

type PdfQuoteBlockOptions = PdfQuoteButtonOptions & {
  prelocatedSelection?: PdfSelectionLocator;
};

async function locatePdfQuoteBlock(
  locator: Awaited<ReturnType<typeof createPdfLocator>>,
  rawText: string,
  preferredPageIndex: number | null = null,
): Promise<PdfSelectionLocator | null> {
  const scopedPageIndex = normalizedPreferredPageIndex(
    preferredPageIndex,
    locator.pageCount,
  );
  if (scopedPageIndex != null) {
    const scoped = await locatePdfQuoteBlockInScope(
      locator,
      rawText,
      scopedPageIndex,
      false,
    );
    if (scoped) return scoped;
  }
  return locatePdfQuoteBlockInScope(locator, rawText, null, true);
}

async function locatePdfQuoteBlockInScope(
  locator: Awaited<ReturnType<typeof createPdfLocator>>,
  rawText: string,
  pageIndex: number | null,
  logMiss: boolean,
): Promise<PdfSelectionLocator | null> {
  const candidates = pdfQuoteLocateCandidates(rawText, PDF_QUOTE_MIN_CHARS);

  // Phase 1 — exact match, every candidate. `indexOf` is cheap and page
  // bundles are memoized, so trying all candidates here costs almost nothing.
  // The model usually quotes text verbatim from getFullText() output, so this
  // resolves most jumps — and a verbatim sentence inside a noise-perturbed
  // full quote is now found here instead of after a full fuzzy scan of the
  // full quote. Only quotes with NO verbatim candidate fall through to fuzzy.
  for (const quote of candidates) {
    const exact = await locator.locate(quote, {
      exactOnly: true,
      ...(pageIndex != null ? { pageIndex } : {}),
    });
    if (exact) {
      return pdfSelectionLocatorFromLocateResult(
        locator.attachmentID,
        exact.matchedText || quote,
        exact,
      );
    }
  }

  // Phase 2 — fuzzy fallback, reached only when nothing matched verbatim.
  let bestConfidence = 0;
  for (const quote of candidates) {
    // Locate with no floor, then gate with a length-aware confidence floor
    // here. Gating ourselves also lets a miss report how close it got — for
    // diagnosing quotes that fail to jump — without paying for a second scan.
    const result = await locator.locate(quote, {
      minConfidence: 0,
      ...(pageIndex != null ? { pageIndex } : {}),
    });
    if (!result) continue;
    if (result.confidence > bestConfidence) bestConfidence = result.confidence;
    if (result.confidence >= pdfQuoteConfidenceFloor(quote.length)) {
      return pdfSelectionLocatorFromLocateResult(
        locator.attachmentID,
        result.matchedText || quote,
        result,
      );
    }
  }
  if (logMiss && candidates.length) {
    debugZai("pdf-quote.locate.miss", {
      candidates: candidates.length,
      bestConfidence: Number(bestConfidence.toFixed(3)),
      head: candidates[0]!.slice(0, 80),
    });
  }
  return null;
}

function normalizedPreferredPageIndex(
  pageIndex: number | null | undefined,
  pageCount: number,
): number | null {
  if (
    typeof pageIndex !== "number" ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= pageCount
  ) {
    return null;
  }
  return pageIndex;
}

async function jumpToPdfQuote(
  mount: HTMLElement,
  state: PanelState,
  quote: string,
  preferredAttachmentID: number | null = null,
  _button?: HTMLElement,
  sourceItemID: number | null = null,
  preferredPageIndex: number | null = null,
): Promise<void> {
  setTempLoadMarkStatus(mount, "原文定位中");
  try {
    const itemID = sourceItemID ?? state.itemID;
    const locator = await locatePdfQuoteForItem(
      mount.ownerDocument!,
      itemID,
      quote,
      preferredAttachmentID,
      preferredPageIndex,
    );
    if (!locator) {
      setTempLoadMarkStatus(mount, "原文未定位");
      return;
    }
    setTempLoadMarkStatus(mount, "原文定位");
    void jumpToPdfSelectionPreview(mount, state, locator);
  } catch (err) {
    setTempLoadMarkStatus(mount, "原文异常");
    debugZai("pdf-quote.jump.failed", { error: errorMessage(err) });
  }
}

async function locatePdfQuoteForItem(
  doc: Document,
  itemID: number | null,
  rawText: string,
  preferredAttachmentID: number | null = null,
  preferredPageIndex: number | null = null,
): Promise<PdfSelectionLocator | null> {
  if (itemID == null) return null;
  const quote = firstPdfQuoteLocateCandidate(rawText, PDF_QUOTE_MIN_CHARS);
  if (!quote) return null;
  const reader = getReaderForAttachmentOrItem(
    doc.defaultView,
    itemID,
    preferredAttachmentID,
  );
  if (!reader) return null;
  const attachmentID = preferredAttachmentID ?? readerAttachmentID(reader) ?? 0;
  const pageKey =
    preferredPageIndex != null &&
    Number.isInteger(preferredPageIndex) &&
    preferredPageIndex >= 0
      ? preferredPageIndex
      : "";
  const cacheKey = [itemID, attachmentID, pageKey, quote].join("\u0001");
  const cached = pdfQuoteLocateCache.get(cacheKey);
  if (cached) return cached;
  const promise = locatePdfQuoteWithReader(
    reader,
    quote,
    preferredPageIndex,
  ).catch((err) => {
    debugZai("pdf-quote.locate.failed", { error: errorMessage(err) });
    return null;
  });
  pdfQuoteLocateCache.set(cacheKey, promise);
  trimPdfQuoteLocateCache();
  return promise;
}

async function locatePdfQuoteWithReader(
  reader: unknown,
  quote: string,
  preferredPageIndex: number | null = null,
): Promise<PdfSelectionLocator | null> {
  // Reuse a cached locator (see getSharedPdfLocator) instead of rebuilding and
  // disposing one per click. It is intentionally not disposed here: the
  // locator lives as long as its Reader and is collected together with it.
  const locator = await getSharedPdfLocator(reader);
  return locatePdfQuoteBlock(locator, quote, preferredPageIndex);
}

function trimPdfQuoteLocateCache(): void {
  while (pdfQuoteLocateCache.size > 160) {
    const first = pdfQuoteLocateCache.keys().next().value;
    if (typeof first !== "string") return;
    pdfQuoteLocateCache.delete(first);
  }
}

function pdfSelectionLocatorFromLocateResult(
  attachmentID: number,
  selectedText: string,
  result: {
    pageIndex: number;
    pageLabel: string;
    rects: PdfRectTuple[];
    anchorOffset?: number;
    headOffset?: number;
  },
): PdfSelectionLocator {
  return {
    attachmentID,
    selectedText,
    pageIndex: result.pageIndex,
    pageLabel: result.pageLabel,
    position: {
      pageIndex: result.pageIndex,
      rects: result.rects,
      ...(result.anchorOffset != null
        ? { zaiAnchorOffset: result.anchorOffset }
        : {}),
      ...(result.headOffset != null
        ? { zaiHeadOffset: result.headOffset }
        : {}),
    },
  };
}

function wrapPdfQuoteBlock(
  block: HTMLElement,
  quote: string,
  options: PdfQuoteBlockOptions = {},
): void {
  // Chat: the whole quote block IS the click target — no separate marker.
  // A live click listener works because chat DOM is never serialized.
  if (options.onJump) {
    decoratePdfQuoteBlockClickable(block, quote, options.onJump);
    return;
  }
  // Note: a saved note is serialized HTML with no live listeners, so the jump
  // must ride on an <a> whose hash href installZoteroNotePdfJumpLinks reopens.
  appendNotePdfQuoteLink(block, quote, options);
}

function decoratePdfQuoteBlockClickable(
  block: HTMLElement,
  quote: string,
  onJump: NonNullable<PdfQuoteButtonOptions["onJump"]>,
): void {
  block.classList.add("zai-pdf-quote-block");
  block.title = "点击跳到 PDF 原文，并选中这段论据";
  // A persistent low-key 「原文」 marker at the end so the quote reads as
  // clickable without hovering. A <span> (not <a>) — a click on it still
  // bubbles to the block listener below.
  const marker = block.ownerDocument!.createElement("span");
  marker.className = "zai-pdf-quote-jump";
  marker.textContent = "原文";
  block.append(marker);
  block.addEventListener("click", (event) => {
    // Clicking a real link inside the quote, or finishing a drag-selection,
    // must not be hijacked into a jump.
    if ((event.target as Element | null)?.closest?.("a")) return;
    const selection = block.ownerDocument?.defaultView?.getSelection();
    if (selection && !selection.isCollapsed) return;
    event.preventDefault();
    event.stopPropagation();
    markActiveQuoteElement(block);
    void onJump(quote, block);
  });
}

// Keep the quote the user last jumped from visibly "selected" — exactly one
// at a time. Scoped per document, so the chat panel and the note-editor
// iframe each track their own active quote independently.
function markActiveQuoteElement(target: Element): void {
  target.ownerDocument
    ?.querySelectorAll(".zai-pdf-quote-active")
    .forEach((el: Element) => el.classList.remove("zai-pdf-quote-active"));
  target.classList.add("zai-pdf-quote-active");
}

function appendNotePdfQuoteLink(
  block: HTMLElement,
  quote: string,
  options: PdfQuoteBlockOptions,
): void {
  const doc = block.ownerDocument!;
  const link = doc.createElement("a");
  link.className = "zai-pdf-quote-jump";
  link.textContent = "原文";
  link.title = "点击回到 PDF 原文，并选中这段论据";
  link.dataset.zaiPdfQuoteLink = "true";
  if (options.prelocatedSelection) {
    applyPdfSelectionLinkAttributes(link, options.prelocatedSelection);
  } else {
    applyPdfQuoteLinkAttributes(
      link,
      quote,
      options.sourceItemID ?? null,
      options.preferredAttachmentID ?? null,
      options.preferredPageIndex ?? null,
    );
  }
  block.append(link);
}

async function assistantContentToNoteHTML(
  doc: Document,
  itemID: number | null,
  content: string,
  pdfSelection: PdfSelectionLocator | null = null,
): Promise<string> {
  const root = doc.createElement("div");
  root.append(doc.createElement("hr"));

  const title = doc.createElement("h2");
  title.textContent = `AI 总结 ${formatNoteTimestamp(new Date())}`;
  root.append(title);

  const jump = renderNotePdfSelectionJump(doc, pdfSelection);
  if (jump) root.append(jump);

  const body = doc.createElement("div");
  // Notes path: keep $..$ / $$..$$ as plain text. Zotero's note editor
  // (and Better Notes' ProseMirror schema) strips KaTeX-produced HTML and
  // MathML wrappers; the only math syntax that consistently round-trips
  // is the LaTeX source inside dollar delimiters, which Better Notes
  // re-renders via its own KaTeX pass. See the comment in
  // appendInlineMarkdown above for the failure modes we'd hit otherwise.
  renderMarkdownInto(body, content.trim(), "source");
  installPdfQuoteButtonsInElement(body, { sourceItemID: itemID });
  while (body.firstChild) root.appendChild(body.firstChild);
  return String(root.innerHTML);
}

function renderNotePdfSelectionJump(
  doc: Document,
  pdfSelection: PdfSelectionLocator | null,
): HTMLElement | null {
  if (!pdfSelection) return null;
  const href = pdfOpenUrlForSelection(pdfSelection);
  if (!href) return null;

  const row = doc.createElement("p");
  row.className = "zai-note-pdf-jump";
  const link = doc.createElement("a");
  link.className = "zai-note-pdf-selection-link";
  link.textContent = `↗ 查看 PDF 原选区${pdfSelectionPageLabel(pdfSelection)}`;
  link.title = previewSelection(pdfSelection.selectedText);
  applyPdfSelectionLinkAttributes(link, pdfSelection, href);
  row.append(link);
  return row;
}

function applyPdfSelectionLinkAttributes(
  link: HTMLAnchorElement,
  selection: PdfSelectionLocator,
  baseHref: string = pdfOpenUrlForSelection(selection),
): void {
  const data = JSON.stringify(pdfSelectionForNoteData(selection));
  const detail = {
    attachmentID: selection.attachmentID,
    pageIndex: selection.pageIndex,
    selectedText: textDebugInfo(selection.selectedText ?? "", 160),
    data: textDebugInfo(data, 160),
  };
  const encoded = encodeURIComponentWithDebug(data, "pdf-selection", detail);
  assignHrefWithDebug(
    link,
    `${baseHref || "#"}${NOTE_PDF_SELECTION_HASH_MARKER}${encoded}`,
    "pdf-selection",
    detail,
  );
  setAttributeWithDebug(
    link,
    "data-zai-pdf-selection",
    data,
    "pdf-selection",
    detail,
  );
}

function applyPdfQuoteLinkAttributes(
  link: HTMLAnchorElement,
  quote: string,
  sourceItemID: number | null = null,
  preferredAttachmentID: number | null = null,
  preferredPageIndex: number | null = null,
): void {
  const payload =
    sourceItemID == null &&
    preferredAttachmentID == null &&
    preferredPageIndex == null
      ? quote
      : JSON.stringify({
          quote,
          ...(sourceItemID != null ? { sourceItemID } : {}),
          ...(preferredAttachmentID != null ? { preferredAttachmentID } : {}),
          ...(preferredPageIndex != null ? { preferredPageIndex } : {}),
        });
  const detail = {
    sourceItemID,
    preferredAttachmentID,
    preferredPageIndex,
    quote: textDebugInfo(quote, 160),
    quoteChars: readingRouteStringDiagnostics(quote),
    payload: textDebugInfo(payload, 160),
  };
  const encoded = encodeURIComponentWithDebug(payload, "pdf-quote", detail);
  assignHrefWithDebug(
    link,
    `#${NOTE_PDF_QUOTE_HASH_MARKER.slice(1)}${encoded}`,
    "pdf-quote",
    detail,
  );
  setAttributeWithDebug(link, "data-zai-pdf-quote", quote, "pdf-quote", detail);
  if (sourceItemID != null) {
    setAttributeWithDebug(
      link,
      "data-zai-pdf-source-item-id",
      String(sourceItemID),
      "pdf-quote",
      detail,
    );
  }
  if (preferredAttachmentID != null) {
    setAttributeWithDebug(
      link,
      "data-zai-pdf-source-attachment-id",
      String(preferredAttachmentID),
      "pdf-quote",
      detail,
    );
  }
  if (preferredPageIndex != null) {
    setAttributeWithDebug(
      link,
      "data-zai-pdf-source-page-index",
      String(preferredPageIndex),
      "pdf-quote",
      detail,
    );
  }
}

function pdfSelectionPageLabel(selection: PdfSelectionLocator): string {
  const label = selection.pageLabel ?? String((selection.pageIndex ?? 0) + 1);
  return label ? `（第 ${label} 页）` : "";
}

function pdfOpenUrlForSelection(selection: PdfSelectionLocator): string {
  const attachment = getZoteroItem(selection.attachmentID);
  const key = (attachment as any)?.key;
  if (!attachment || !key) return "";

  const page = encodeURIComponent(
    String(selection.pageIndex != null ? selection.pageIndex + 1 : 1),
  );
  const itemURI =
    typeof (Zotero as any).URI?.getItemURI === "function"
      ? String((Zotero as any).URI.getItemURI(attachment))
      : "";
  const group = itemURI.match(/\/groups\/(\d+)\/items\/[^/?#]+/);
  if (group) {
    return `zotero://open-pdf/groups/${encodeURIComponent(
      group[1]!,
    )}/items/${encodeURIComponent(key)}?page=${page}`;
  }
  return `zotero://open-pdf/library/items/${encodeURIComponent(
    key,
  )}?page=${page}`;
}

async function insertHTMLIntoNote(
  note: Zotero.Item,
  html: string,
  forceMetadata = false,
): Promise<boolean> {
  const betterNotesInsert = betterNotesNoteInsert();
  const before = note.getNote?.() || "";
  debugZai("note-insert:start", {
    noteID: note.id,
    forceMetadata,
    betterNotes: Boolean(betterNotesInsert),
    before: textDebugInfo(before, 120),
    beforeHTML: htmlStringDebugInfo(before),
    html: htmlStringDebugInfo(html),
  });
  if (betterNotesInsert) {
    try {
      await betterNotesInsert(note, html, -1, forceMetadata);
      const after = note.getNote?.() || "";
      debugZai("note-insert:better-notes-done", {
        noteID: note.id,
        after: textDebugInfo(after, 120),
        afterHTML: htmlStringDebugInfo(after),
      });
      return true;
    } catch (err) {
      debugZai("note-insert:better-notes-failed:fallback", {
        noteID: note.id,
        error: errorMessage(err),
      });
    }
  }

  note.setNote(appendHTMLToExistingNote(note.getNote() || "", html));
  await note.saveTx();
  const after = note.getNote?.() || "";
  debugZai("note-insert:zotero-done", {
    noteID: note.id,
    after: textDebugInfo(after, 120),
    afterHTML: htmlStringDebugInfo(after),
  });
  return false;
}

function betterNotesInsertAvailable(): boolean {
  return !!betterNotesNoteInsert();
}

function betterNotesNoteInsert():
  | ((
      note: Zotero.Item,
      html: string,
      lineIndex?: number,
      forceMetadata?: boolean,
    ) => Promise<void> | void)
  | null {
  const noteApi = (
    Zotero as unknown as {
      BetterNotes?: {
        api?: {
          note?: {
            insert?: (
              note: Zotero.Item,
              html: string,
              lineIndex?: number,
              forceMetadata?: boolean,
            ) => Promise<void> | void;
          };
        };
      };
    }
  ).BetterNotes?.api?.note;
  return typeof noteApi?.insert === "function"
    ? noteApi.insert.bind(noteApi)
    : null;
}

function appendHTMLToExistingNote(existing: string, addition: string): string {
  if (!existing.trim()) return `<div>${addition}</div>`;
  const closingDiv = existing.lastIndexOf("</div>");
  if (closingDiv >= 0 && existing.slice(closingDiv).trim() === "</div>") {
    return `${existing.slice(0, closingDiv)}${addition}${existing.slice(
      closingDiv,
    )}`;
  }
  return `${existing}${addition}`;
}

function formatNoteTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

// Render the assistant's "建议注释" block (parsed by annotation-draft.ts).
// READ-ONLY display until the user clicks "保存". INVARIANT: this is NOT a
// hidden write — saving requires a button click and routes through
// `saveAnnotationDraftFromBubble`, which goes through the same Zotero
// annotation API as a manual annotation. CLAUDE.md "No hidden Zotero writes".
function renderAnnotationSuggestion(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  index: number,
  draft: AssistantAnnotationDraft,
): HTMLElement {
  const box = el(doc, "div", "annotation-suggestion");
  const head = el(doc, "div", "annotation-suggestion-head");
  head.append(el(doc, "span", "annotation-suggestion-icon", "📌"));
  head.append(el(doc, "span", "annotation-suggestion-title", "建议注释"));
  if (draft.color) {
    const color = el(doc, "span", "annotation-suggestion-color", draft.color);
    color.style.setProperty("--annotation-color", draft.color);
    color.title = "保存时使用该 PDF 注释颜色";
    head.append(color);
  }
  const preview = previewSelection(draft.snapshot.text);
  if (preview) {
    const ctx = el(
      doc,
      "span",
      "annotation-suggestion-context",
      `基于：「${preview}」`,
    );
    ctx.title = draft.snapshot.text;
    head.append(ctx);
  }
  box.append(head);

  const body = el(doc, "div", "annotation-suggestion-body");
  renderMarkdownInto(body, draft.comment);
  box.append(body);

  box.append(
    renderAnnotationSuggestionActions(doc, mount, state, index, draft),
  );
  return box;
}

function renderAnnotationSuggestionActions(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  index: number,
  draft: AssistantAnnotationDraft,
): HTMLElement {
  const actions = el(doc, "div", "annotation-suggestion-actions");
  const button = buttonEl(doc, "");
  button.classList.add("annotation-save");
  applyAnnotationButtonState(button, draft.state, "annotation");
  button.addEventListener("click", () => {
    button.blur();
    void saveAnnotationDraftFromBubble(mount, state, index);
  });
  actions.append(button);

  const textButton = buttonEl(doc, "");
  textButton.classList.add("annotation-save", "annotation-save-text");
  applyAnnotationButtonState(
    textButton,
    draft.textState ?? { kind: "idle" },
    "text",
  );
  textButton.addEventListener("click", () => {
    textButton.blur();
    void saveTextAnnotationDraftFromBubble(mount, state, index);
  });
  actions.append(textButton);

  const failedState =
    draft.state.kind === "failed"
      ? draft.state
      : draft.state.kind !== "saved" && draft.textState?.kind === "failed"
        ? draft.textState
        : null;
  if (failedState) {
    const failedMode =
      draft.state.kind === "failed" ? "高亮+评论保存失败" : "新增文字保存失败";
    const err = el(
      doc,
      "div",
      "annotation-suggestion-error",
      `${failedMode}: ${friendlyAnnotationError(failedState.error)}`,
    );
    actions.append(err);
  }
  return actions;
}

function friendlyAnnotationError(raw: string): string {
  if (/Permission denied to pass object to privileged code/i.test(raw)) {
    return "插件与 Zotero 主窗口之间的对象权限边界没穿过去——重试一次通常就行；持续失败请反馈日志。";
  }
  if (/attachment is no longer available/i.test(raw)) {
    return "原 PDF 附件已被删除或移走，无法定位选区。";
  }
  if (/position data|usable rect data/i.test(raw)) {
    return "选区缺少有效的 PDF 坐标信息，请重新选取一段文字后再试。";
  }
  return raw;
}

function applyAnnotationButtonState(
  button: HTMLButtonElement,
  state: AssistantAnnotationDraft["state"],
  mode: "annotation" | "text",
) {
  // Wording mirrors Zotero Reader's official toolbar (reader.ftl):
  //   - `highlight` annotation = "高亮文本 / Highlight Text" (we call the
  //     comment-bearing variant "高亮+评论").
  //   - `text` annotation = "新增文字 / Add Text" (the T toolbar tool).
  // Keeping these labels aligned with Zotero's own UI also lets users speak
  // about the action with the same vocabulary the model sees in the tool
  // descriptions, so prompts like "新增文字" route correctly without having
  // to mention "T 工具".
  switch (state.kind) {
    case "idle":
      button.textContent = mode === "text" ? "🅣 新增文字" : "💾 高亮+评论";
      button.disabled = false;
      button.title =
        mode === "text"
          ? "Zotero Reader 的「新增文字 / Add Text」(T 工具)：在选区下方放一段可见文字"
          : "Zotero Reader 的「高亮文本 / Highlight Text」并附上评论";
      return;
    case "saving":
      button.textContent = "保存中…";
      button.disabled = true;
      button.title = "";
      return;
    case "saved":
      button.textContent = "✓ 已保存";
      button.disabled = true;
      button.title =
        state.annotationID > 0
          ? `Zotero annotation #${state.annotationID}`
          : "已写入 Zotero（条目 ID 暂未回填）";
      return;
    case "failed":
      button.textContent =
        mode === "text" ? "↻ 重试新增文字" : "↻ 重试高亮+评论";
      button.disabled = false;
      button.title = state.error;
      return;
  }
}

function previewSelection(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 60)}…`;
}

async function saveAnnotationDraftFromBubble(
  mount: HTMLElement,
  state: PanelState,
  index: number,
) {
  const message = state.messages[index];
  const draft = message?.annotationDraft;
  if (!message || !draft) return;
  if (draft.state.kind === "saving" || draft.state.kind === "saved") return;

  const scrollSnapshot = lockMessagesScroll(mount);
  draft.state = { kind: "saving" };
  refreshAnnotationSuggestion(mount, index, scrollSnapshot);
  try {
    const { id } = await saveSelectionAnnotation(draft.snapshot, {
      comment: draft.comment,
      ...(draft.color ? { color: draft.color } : {}),
    });
    lockMessagesScroll(mount, scrollSnapshot);
    scheduleMessagesScrollRestore(mount, scrollSnapshot);
    draft.state = { kind: "saved", annotationID: id, savedAt: Date.now() };
  } catch (err) {
    lockMessagesScroll(mount, scrollSnapshot);
    scheduleMessagesScrollRestore(mount, scrollSnapshot);
    draft.state = {
      kind: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  void saveChatMessages(state.itemID, state.messages);
  refreshAnnotationSuggestion(mount, index, scrollSnapshot);
}

async function saveTextAnnotationDraftFromBubble(
  mount: HTMLElement,
  state: PanelState,
  index: number,
) {
  const message = state.messages[index];
  const draft = message?.annotationDraft;
  if (!message || !draft) return;
  const textState = draft.textState ?? { kind: "idle" as const };
  if (textState.kind === "saving" || textState.kind === "saved") return;

  const scrollSnapshot = lockMessagesScroll(mount);
  draft.textState = { kind: "saving" };
  refreshAnnotationSuggestion(mount, index, scrollSnapshot);
  try {
    const reader = getActiveReaderForItem(
      mount.ownerDocument?.defaultView,
      state.itemID,
    );
    const readerForSelection = getReaderForAttachmentOrItem(
      mount.ownerDocument?.defaultView,
      state.itemID,
      draft.snapshot.attachmentID,
    );
    const fontSize = loadToolSettings(zoteroPrefs()).textAnnotationFontSize;
    const { id } = await saveTextAnnotationNearSelection(
      draft.snapshot,
      {
        comment: draft.comment,
        ...(draft.color ? { color: draft.color } : {}),
        fontSize,
        placement: "below",
      },
      readerForSelection ?? reader,
    );
    lockMessagesScroll(mount, scrollSnapshot);
    scheduleMessagesScrollRestore(mount, scrollSnapshot);
    draft.textState = { kind: "saved", annotationID: id, savedAt: Date.now() };
  } catch (err) {
    lockMessagesScroll(mount, scrollSnapshot);
    scheduleMessagesScrollRestore(mount, scrollSnapshot);
    draft.textState = {
      kind: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  void saveChatMessages(state.itemID, state.messages);
  refreshAnnotationSuggestion(mount, index, scrollSnapshot);
}

function refreshAnnotationSuggestion(
  mount: HTMLElement,
  index: number,
  scrollSnapshot?: MessagesScrollSnapshot | null,
) {
  const state = states.get(mount);
  if (!state) return;
  const message = state.messages[index];
  if (!message?.annotationDraft) return;
  const root = mount.querySelector(
    `[data-message-index="${index}"]`,
  ) as HTMLElement | null;
  if (!root) return;
  const existing = root.querySelector(
    ".annotation-suggestion",
  ) as HTMLElement | null;
  const next = renderAnnotationSuggestion(
    root.ownerDocument!,
    mount,
    state,
    index,
    message.annotationDraft,
  );
  // INVARIANT: this is a local in-bubble swap; messages-list scroll position
  // must NOT shift. Without preservation, swapping in a slightly shorter
  // suggestion (e.g. "✓ 已保存" replacing "💾 高亮+评论") clamps scrollTop
  // when the user is near the bottom and visually pages the chat backward.
  preserveMessagesScroll(
    mount,
    () => {
      if (existing) existing.replaceWith(next);
      else root.append(next);
    },
    scrollSnapshot,
  );
}

// Renders the "思考与上下文" collapsible block above an assistant bubble.
// IMPORTANT: pulls context from the PREVIOUS USER turn, NOT the assistant
// itself. WHY: context (selectedText / passages / tool calls) is recorded
// on the user message — that's the turn that triggered the model. The
// assistant message is just the response, with no context of its own.
// Matches Claudian's pattern of pinning the context card to the question
// that triggered the answer.
function renderAssistantProcess(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  root: HTMLElement,
  sourceUser: Message | undefined,
) {
  if (!sourceUser?.context) return;

  const summary = contextSummaryLine(sourceUser);
  const tools = sourceUser.context.toolCalls;
  if (!summary && !tools?.length) return;

  const details = el(doc, "details", "assistant-process") as HTMLDetailsElement;
  details.open = true;
  details.append(
    el(
      doc,
      "summary",
      "",
      summary ? `思考与上下文 · ${summary}` : "思考与上下文",
    ),
  );

  const body = el(doc, "div", "assistant-process-body");
  if (summary) {
    const contextRow = el(doc, "div", "bubble-context-row");
    const chip = el(doc, "div", "bubble-context-chip", summary);
    const locator = sourceUser.task?.pdfSelection;
    if (locator) {
      const jumpOriginal = () => {
        void jumpToPdfSelection(mount, state, locator);
      };
      chip.classList.add("bubble-context-chip-clickable");
      chip.setAttribute("role", "button");
      chip.setAttribute("tabindex", "0");
      chip.title = "回到 PDF 原选区，并重新选中这句话";
      chip.addEventListener("click", jumpOriginal);
      chip.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        jumpOriginal();
      });

      const jump = buttonEl(doc, "查看原选区");
      jump.className = "bubble-context-jump";
      jump.title = "回到 PDF 原选区，并重新选中这句话";
      jump.addEventListener("click", () => {
        jump.blur();
        jumpOriginal();
      });
      contextRow.append(chip, jump);
    } else if (sourceUser.context.planReason) {
      chip.title = sourceUser.context.planReason;
      contextRow.append(chip);
    } else {
      contextRow.append(chip);
    }
    body.append(contextRow);
    if (sourceUser.context.selectedText) {
      body.append(
        el(
          doc,
          "div",
          "bubble-context-selected-text",
          sourceUser.context.selectedText,
        ),
      );
    }
  }
  renderToolTrace(doc, body, tools);
  details.append(body);
  root.append(details);
}

function renderMessageImages(
  doc: Document,
  root: HTMLElement,
  images: Message["images"] | undefined,
) {
  if (!images?.length) return;
  const tray = el(doc, "div", "message-images");
  for (const image of images) {
    const figure = el(doc, "figure", "message-image");
    const img = doc.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name;
    const caption = el(doc, "figcaption", "", image.name);
    figure.append(img, caption);
    tray.append(figure);
  }
  root.append(tray);
}

function renderToolTrace(
  doc: Document,
  root: HTMLElement,
  tools: NonNullable<Message["context"]>["toolCalls"] | undefined,
) {
  if (!Array.isArray(tools) || tools.length === 0) return;
  const box = el(doc, "div", "bubble-tool-trace");
  for (const tool of tools) {
    const row = el(doc, "div", `bubble-tool-row tool-${tool.status}`);
    row.append(
      el(doc, "span", "bubble-tool-dot"),
      el(doc, "span", "bubble-tool-name", tool.name),
    );
    if (tool.summary)
      row.append(el(doc, "span", "bubble-tool-summary", tool.summary));
    box.append(row);
  }
  root.append(box);
}

// Plugin lifecycle entry.
// `registerSidebar` runs once on bootstrap; `registerSidebarForWindow`
// runs for each Zotero main window (Zotero supports multiple windows).
// INVARIANT: must be idempotent — `registered` flag and per-window
// `windowSidebars` Map dedupe re-entries.
export function registerSidebar() {
  registered = true;
  registerReaderSelectionCapture();
  for (const win of Zotero.getMainWindows()) {
    registerSidebarForWindow(win);
  }
}

export function registerSidebarForWindow(win: Window) {
  if (!registered || windowSidebars.has(win)) return;

  const doc = win.document;
  const contextPane = doc.getElementById("zotero-context-pane");
  const parent = contextPane?.parentElement;
  if (!contextPane || !parent) {
    scheduleWindowRegisterRetry(win);
    return;
  }
  windowRegisterRetries.delete(win);

  doc.getElementById(SPLITTER_ID)?.remove();
  doc.getElementById(COLUMN_ID)?.remove();
  doc.getElementById(NOTE_SPLITTER_ID)?.remove();
  doc.getElementById(NOTE_COLUMN_ID)?.remove();
  // XUL splitter + vbox: native Zotero column rather than a React mount.
  // WHY native DOM (not React): Zotero 7+'s ItemPane DOES NOT recover
  // gracefully from a React tree crash inside its custom-element column.
  // CLAUDE.md: "avoid reintroducing React UI in the Zotero pane unless
  // crash behavior has been revalidated."
  // `zotero-persist=width` lets Zotero remember the user's column width
  // across restarts. The wheel-stopPropagation prevents scroll events from
  // bleeding through to the items pane underneath.
  const splitter = doc.createXULElement("splitter");
  splitter.id = SPLITTER_ID;
  splitter.setAttribute("resizebefore", "closest");
  splitter.setAttribute("resizeafter", "closest");
  splitter.setAttribute("orient", "horizontal");

  const noteSplitter = doc.createXULElement("splitter");
  noteSplitter.id = NOTE_SPLITTER_ID;
  noteSplitter.setAttribute("resizebefore", "closest");
  noteSplitter.setAttribute("resizeafter", "closest");
  noteSplitter.setAttribute("orient", "horizontal");
  noteSplitter.setAttribute("hidden", "true");

  const noteColumn = doc.createXULElement("vbox");
  noteColumn.id = NOTE_COLUMN_ID;
  noteColumn.setAttribute("class", "zai-note-column");
  noteColumn.setAttribute("width", String(DEFAULT_NOTE_COLUMN_WIDTH));
  noteColumn.setAttribute("minwidth", String(MIN_NOTE_COLUMN_WIDTH));
  noteColumn.setAttribute("maxwidth", String(MAX_NOTE_COLUMN_WIDTH));
  noteColumn.setAttribute("zotero-persist", "width");
  noteColumn.setAttribute("collapsed", "true");
  noteColumn.setAttribute("hidden", "true");
  noteColumn.addEventListener(
    "wheel",
    (event: Event) => event.stopPropagation(),
    {
      passive: true,
    },
  );

  const column = doc.createXULElement("vbox");
  column.id = COLUMN_ID;
  column.setAttribute("class", "zai-column");
  column.setAttribute("width", String(DEFAULT_AI_COLUMN_WIDTH));
  column.setAttribute("minwidth", String(MIN_AI_COLUMN_WIDTH));
  column.setAttribute("maxwidth", String(MAX_AI_COLUMN_WIDTH));
  column.setAttribute("zotero-persist", "width");
  column.addEventListener("wheel", (event: Event) => event.stopPropagation(), {
    passive: true,
  });

  const link = doc.createElementNS(XHTML_NS, "link") as HTMLLinkElement;
  link.rel = "stylesheet";
  link.href = `chrome://${addon.data.config.addonRef}/content/sidebar.css`;

  const katexLink = doc.createElementNS(XHTML_NS, "link") as HTMLLinkElement;
  katexLink.rel = "stylesheet";
  katexLink.href = `chrome://${addon.data.config.addonRef}/content/katex/katex.min.css`;

  const noteLink = doc.createElementNS(XHTML_NS, "link") as HTMLLinkElement;
  noteLink.rel = "stylesheet";
  noteLink.href = `chrome://${addon.data.config.addonRef}/content/sidebar.css`;

  const noteKatexLink = doc.createElementNS(
    XHTML_NS,
    "link",
  ) as HTMLLinkElement;
  noteKatexLink.rel = "stylesheet";
  noteKatexLink.href = `chrome://${addon.data.config.addonRef}/content/katex/katex.min.css`;

  const mount = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  mount.id = ROOT_ID;
  mount.className = "zai-root-independent";

  const noteMount = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  noteMount.id = NOTE_ROOT_ID;
  noteMount.className = "zai-note-root";

  noteColumn.append(noteLink, noteKatexLink, noteMount);
  column.append(link, katexLink, mount);
  parent.insertBefore(noteSplitter, contextPane.nextSibling);
  parent.insertBefore(noteColumn, noteSplitter.nextSibling);
  parent.insertBefore(splitter, noteColumn.nextSibling);
  parent.insertBefore(column, splitter.nextSibling);

  const state: WindowSidebarState = {
    column,
    splitter,
    mount,
    noteColumn,
    noteSplitter,
    noteMount,
  };
  splitter.addEventListener("command", () => updateToggleButton(state));
  splitter.addEventListener("mouseup", () => updateToggleButton(state));
  windowSidebars.set(win, state);
  mountedWindows.add(win);
  installReaderLayoutMemory(win, state);
  installToggleButton(win, state);
  installFloatingToggle(win, state);
  patchItemSelection(win, state);
  startSelectionMonitor(win, state);
  installSidebarCopyHandler(win, state);
  installSidebarSelectionMenu(win, state);
  installReaderPromptShortcutHandler(win, state);
  renderWindowSidebar(win);
  scheduleInitialSidebarRefresh(win, state);
}

function scheduleWindowRegisterRetry(win: Window): void {
  const attempt = (windowRegisterRetries.get(win) ?? 0) + 1;
  windowRegisterRetries.set(win, attempt);
  if (attempt > 24) {
    Zotero.debug("[Zotero AI Sidebar] Could not find Zotero pane container");
    return;
  }
  win.setTimeout(() => registerSidebarForWindow(win), 250);
}

function installReaderLayoutMemory(
  win: Window,
  state: WindowSidebarState,
): void {
  const remember = () => rememberLastNoteWidth(state);
  const scheduleRemember = () => {
    if (state.layoutSaveTimer != null) win.clearTimeout(state.layoutSaveTimer);
    state.layoutSaveTimer = win.setTimeout(() => {
      state.layoutSaveTimer = undefined;
      rememberLastNoteWidth(state);
    }, 180);
  };
  let resizeObserver:
    | { observe: (target: Element) => void; disconnect: () => void }
    | undefined;
  const ResizeObserverCtor = (win as any).ResizeObserver;
  if (typeof ResizeObserverCtor === "function") {
    resizeObserver = new ResizeObserverCtor(scheduleRemember);
    resizeObserver?.observe(state.noteColumn);
  }
  state.noteSplitter.addEventListener("command", scheduleRemember);
  state.noteSplitter.addEventListener("mouseup", remember);
  win.addEventListener("mouseup", remember, true);
  state.layoutCleanup = () => {
    resizeObserver?.disconnect();
    state.noteSplitter.removeEventListener("command", scheduleRemember);
    state.noteSplitter.removeEventListener("mouseup", remember);
    win.removeEventListener("mouseup", remember, true);
    win.removeEventListener("beforeunload", remember);
    if (state.layoutSaveTimer != null) {
      win.clearTimeout(state.layoutSaveTimer);
      state.layoutSaveTimer = undefined;
    }
  };
  win.addEventListener("beforeunload", remember);
}

function isNoteColumnVisible(state: WindowSidebarState): boolean {
  const noteColumn = state.noteColumn as Element & {
    hidden?: boolean;
    collapsed?: boolean;
  };
  return !(
    noteColumn.hidden === true ||
    noteColumn.collapsed === true ||
    state.noteColumn.getAttribute("hidden") === "true" ||
    state.noteColumn.getAttribute("collapsed") === "true"
  );
}

function applyLastNoteWidth(state: WindowSidebarState): void {
  const width = loadReaderLayoutPrefs().noteWidth ?? DEFAULT_NOTE_COLUMN_WIDTH;
  setColumnWidth(
    state.noteColumn,
    clampWidth(width, MIN_NOTE_COLUMN_WIDTH, MAX_NOTE_COLUMN_WIDTH),
  );
}

function rememberLastNoteWidth(state: WindowSidebarState): void {
  if (!isNoteColumnVisible(state)) return;
  const noteWidth = measuredElementWidth(state.noteColumn);
  if (noteWidth == null) return;
  saveReaderLayoutPrefs({ noteWidth });
}

function measuredElementWidth(
  element: Element | null | undefined,
): number | undefined {
  if (!element) return undefined;
  const rectWidth = element.getBoundingClientRect?.().width;
  if (Number.isFinite(rectWidth) && rectWidth > 0.5) {
    return Math.round(rectWidth);
  }
  const attrWidth = Number(element.getAttribute("width"));
  return Number.isFinite(attrWidth) && attrWidth > 0
    ? Math.round(attrWidth)
    : undefined;
}

function setColumnWidth(element: Element, width: number): void {
  const rounded = Math.round(width);
  element.removeAttribute("flex");
  element.setAttribute("width", String(rounded));
  (element as HTMLElement).style.width = `${rounded}px`;
  (element as HTMLElement).style.minWidth = `${MIN_NOTE_COLUMN_WIDTH}px`;
  (element as HTMLElement).style.maxWidth = `${MAX_NOTE_COLUMN_WIDTH}px`;
}

function loadReaderLayoutPrefs(): ReaderLayoutPrefs {
  try {
    const raw = (
      Zotero as unknown as {
        Prefs: { get: (key: string, global: boolean) => unknown };
      }
    ).Prefs.get(READER_LAYOUT_PREF_KEY, true);
    if (typeof raw !== "string" || !raw) return {};
    return normalizeReaderLayoutPrefs(JSON.parse(raw));
  } catch {
    return {};
  }
}

function saveReaderLayoutPrefs(partial: ReaderLayoutPrefs): void {
  const next = normalizeReaderLayoutPrefs({
    ...partial,
    updatedAt: Date.now(),
  });
  try {
    (
      Zotero as unknown as {
        Prefs: {
          set: (key: string, value: string, global: boolean) => void;
        };
      }
    ).Prefs.set(READER_LAYOUT_PREF_KEY, JSON.stringify(next), true);
  } catch (err) {
    debugZai("reader-layout.save.failed", { error: errorMessage(err) });
  }
}

function normalizeReaderLayoutPrefs(value: unknown): ReaderLayoutPrefs {
  const input =
    value && typeof value === "object" ? (value as ReaderLayoutPrefs) : {};
  return {
    ...(typeof input.noteWidth === "number"
      ? {
          noteWidth: clampWidth(
            input.noteWidth,
            MIN_NOTE_COLUMN_WIDTH,
            MAX_NOTE_COLUMN_WIDTH,
          ),
        }
      : {}),
    ...(typeof input.updatedAt === "number"
      ? { updatedAt: input.updatedAt }
      : {}),
  };
}

function clampWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;
  return Math.round(Math.max(min, Math.min(max, width)));
}

function installReaderTranslateToolbar(
  win: Window,
  state: WindowSidebarState,
): void {
  const mountedGroups: HTMLElement[] = [];

  const mountIntoActiveReader = () => {
    const reader = getActiveReader(win) as any;
    for (const readerWin of activeReaderWindows(reader)) {
      const doc = readerWin.document;
      if (!doc || doc.getElementById(READER_TRANSLATE_GROUP_ID)) {
        if (doc) syncReaderTranslateButtons(win, doc);
        continue;
      }
      const toolbar = findReaderToolbar(doc);
      if (!toolbar) continue;
      ensureReaderTranslateToolbarStyle(doc);
      const group = doc.createElement("span");
      group.id = READER_TRANSLATE_GROUP_ID;
      group.className = "zai-reader-translate-group";

      const translateBtn = doc.createElement("button");
      translateBtn.type = "button";
      translateBtn.className = "zai-reader-translate-button";
      translateBtn.textContent = "译";
      translateBtn.title = "逐句翻译模式 (Alt+T)，翻译参数在插件设置中配置";
      translateBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggleTranslateMode(win, translateBtn);
      });

      group.append(translateBtn);
      insertReaderTranslateGroup(toolbar, group);
      mountedGroups.push(group);
      syncReaderTranslateButtons(win, doc);
    }
  };

  mountIntoActiveReader();
  const monitorID = win.setInterval(mountIntoActiveReader, 500);
  state.readerTranslateToolbarCleanup = () => {
    win.clearInterval(monitorID);
    for (const group of mountedGroups) group.remove();
  };
}

function findReaderToolbar(doc: Document): HTMLElement | null {
  if (
    !doc.querySelector(
      ".textLayer,.pdfViewer,.page[data-page-number],#viewerContainer",
    )
  ) {
    return null;
  }
  const selectors = [
    ".reader-toolbar",
    "#toolbarViewer",
    "#toolbarViewerLeft",
    "#toolbarContainer",
    "[role='toolbar']",
    ".toolbar",
    ".toolbar-container",
  ];
  for (const selector of selectors) {
    for (const candidate of Array.from(doc.querySelectorAll(selector))) {
      const toolbar = candidate as HTMLElement;
      if (
        typeof toolbar.querySelector === "function" &&
        toolbar.querySelector("button,toolbarbutton")
      ) {
        return toolbar;
      }
    }
  }
  return null;
}

function insertReaderTranslateGroup(
  toolbar: HTMLElement,
  group: HTMLElement,
): void {
  const before =
    toolbar.querySelector("spacer[flex='1'], .spacer, .toolbar-spacer") ??
    toolbar.querySelector("#scaleSelectContainer, #numPages") ??
    null;
  toolbar.insertBefore(group, before);
}

function syncReaderTranslateButtons(win: Window, doc?: Document): void {
  const targetDoc = doc ?? win.document;
  const enabled = translateControllers.get(win)?.isEnabled() ?? false;
  const buttons = Array.from(
    targetDoc.querySelectorAll(".zai-reader-translate-button"),
  ) as HTMLElement[];
  for (const button of buttons) {
    button.classList.toggle("zai-reader-translate-button--active", enabled);
    setTranslateButtonLabel(button, enabled);
  }
}

function ensureReaderTranslateToolbarStyle(doc: Document): void {
  if (doc.getElementById(READER_TRANSLATE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = READER_TRANSLATE_STYLE_ID;
  style.textContent = READER_TRANSLATE_STYLE_TEXT;
  (doc.head ?? doc.documentElement)?.append(style);
}

const READER_TRANSLATE_STYLE_TEXT = `
.zai-reader-translate-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-inline: 6px;
  vertical-align: middle;
}
.zai-reader-translate-button {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.zai-reader-translate-button:hover {
  background: rgba(128, 128, 128, 0.14);
}
.zai-reader-translate-button--active {
  color: #d34a24;
  background: rgba(239, 91, 43, 0.14);
  border-color: #ef5b2b;
}
body.zai-translate-mode-on .page { cursor: crosshair !important; }
body.zai-translate-mode-on .textLayer span:hover {
  background: rgba(74, 140, 247, 0.10);
  border-radius: 2px;
}
`;

function installReaderPromptShortcutHandler(
  win: Window,
  sidebar: WindowSidebarState,
): void {
  const installedWindows = new WeakSet<Window>();
  const cleanupCallbacks: Array<() => void> = [];
  const addWindow = (targetWin: Window | null | undefined) => {
    if (!targetWin || installedWindows.has(targetWin)) return;
    installedWindows.add(targetWin);
    const handler = (event: KeyboardEvent) => {
      if (handleTranslateModeShortcut(win, event)) return;
      if (handleReaderTaskEscape(win, targetWin, sidebar, event)) return;
      void handleReaderPromptShortcut(win, targetWin, sidebar, event);
    };
    targetWin.addEventListener("keydown", handler, true);
    cleanupCallbacks.push(() =>
      targetWin.removeEventListener("keydown", handler, true),
    );
  };
  const installLikelyReaderWindows = () => {
    addWindow(win);
    const reader = getActiveReader(win) as any;
    for (const readerWin of activeReaderWindows(reader)) addWindow(readerWin);
  };
  installLikelyReaderWindows();
  const monitorID = win.setInterval(installLikelyReaderWindows, 500);
  sidebar.promptShortcutCleanup = () => {
    win.clearInterval(monitorID);
    for (const cleanup of cleanupCallbacks) cleanup();
  };
}

function handleTranslateModeShortcut(
  win: Window,
  event: KeyboardEvent,
): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return false;
  if (event.key.toLowerCase() !== "t") return false;
  if (isEditableEventTarget(event.target)) return false;
  event.preventDefault();
  event.stopPropagation();
  const readerDoc = (event.target as Node | null)?.ownerDocument;
  const button =
    readerDoc?.querySelector<HTMLElement>(".zai-reader-translate-button") ??
    win.document.querySelector<HTMLElement>(".zai-reader-translate-button");
  const fallback = win.document.documentElement as HTMLElement | null;
  if (!button && !fallback) return true;
  void toggleTranslateMode(win, button ?? fallback!);
  return true;
}

async function handleReaderPromptShortcut(
  win: Window,
  sourceWin: Window,
  sidebar: WindowSidebarState,
  event: KeyboardEvent,
): Promise<void> {
  const key = shortcutKeyFromEvent(event);
  if (!key || !isReaderShortcutContext(win, sourceWin, event)) return;

  const settings = loadQuickPromptSettings(zoteroPrefs());
  const prompt = settings.customButtons.find(
    (button) => button.shortcut === key && button.prompt.trim(),
  );
  if (!prompt) return;

  const itemID = safeSelectedItemID(win);
  const selectedText = await getSelectedTextForPrompt(sidebar.mount, itemID);
  if (!selectedText) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  setColumnCollapsed(win, sidebar, false);
  const state = states.get(sidebar.mount);
  if (!state) return;
  void sendMessage(sidebar.mount, state, prompt.prompt, {
    taskTitle: prompt.label?.trim() || `快捷键 ${key.toUpperCase()}`,
  });
}

function handleReaderTaskEscape(
  win: Window,
  sourceWin: Window,
  sidebar: WindowSidebarState,
  event: KeyboardEvent,
): boolean {
  if (
    event.defaultPrevented ||
    event.key !== "Escape" ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    !isReaderShortcutContext(win, sourceWin, event)
  ) {
    return false;
  }
  const state = states.get(sidebar.mount);
  if (!state || (!state.queueOpen && !state.sending)) return false;
  const handled = handleTaskEscape(sidebar.mount, state, event);
  if (handled) event.stopImmediatePropagation();
  return handled;
}

function shortcutKeyFromEvent(event: KeyboardEvent): string {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return "";
  }
  const key = event.key.toLowerCase();
  return /^[a-z0-9]$/.test(key) ? key : "";
}

function isReaderShortcutContext(
  win: Window,
  sourceWin: Window,
  event: KeyboardEvent,
): boolean {
  if (isEditableEventTarget(event.target)) return false;
  const reader = getActiveReader(win);
  if (!reader) return false;
  const readerWindows = activeReaderWindows(reader);
  if (readerWindows.some((readerWin) => readerWin === sourceWin)) return true;

  const active = win.document.activeElement;
  return readerWindows.some(
    (readerWin) => active === safeFrameElement(readerWin),
  );
}

function activeReaderWindows(reader: any): Window[] {
  const windows: Window[] = [];
  const add = (value: unknown) => {
    const win = value as Window | null | undefined;
    if (win && !windows.includes(win)) windows.push(win);
  };
  add(reader?._internalReader?._primaryView?._iframeWindow);
  add(reader?._internalReader?._secondaryView?._iframeWindow);
  add(reader?._iframeWindow);
  return windows;
}

function safeFrameElement(win: Window): Element | null {
  try {
    return win.frameElement;
  } catch {
    return null;
  }
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  const element =
    target && (target as { nodeType?: number }).nodeType === 1
      ? (target as Element)
      : null;
  if (!element) return false;
  const editable = element.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
  );
  return !!editable;
}

// Zotero's main window keybindings intercept Ctrl/Cmd+C before any native
// `copy` event fires inside our XHTML sidebar — pressing the shortcut
// triggers Zotero's "copy selected items" instead of copying the text the
// user highlighted in our chat. Hook a capture-phase keydown at the window
// level: if the current selection lives inside our column or noteColumn,
// write its text to the clipboard ourselves and stop the event so Zotero
// doesn't override it. We deliberately don't touch other Ctrl+C presses
// (selection in items list, search bar, etc.) — the column.contains check
// keeps this scoped.
function installSidebarCopyHandler(
  win: Window,
  sidebar: WindowSidebarState,
): void {
  const doc = win.document;
  const installedWindows = new WeakSet<Window>();
  const installedTargets: EventTarget[] = [];
  const addTarget = (
    target: EventTarget | null | undefined,
    sourceWin: Window,
  ) => {
    if (!target || installedTargets.includes(target)) return;
    const keydownHandler = (event: KeyboardEvent) => {
      const isCopyCombo =
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "c";
      if (!isCopyCombo) return;
      copySidebarSelectionFromEvent(
        doc,
        win,
        sourceWin,
        sidebar,
        event,
        "copy-keydown",
      );
    };
    const copyHandler = (event: ClipboardEvent) => {
      handleSidebarCopyEvent(doc, win, sourceWin, sidebar, event);
    };
    const commandHandler = (event: Event) => {
      if (!isCopyCommandEvent(event)) return;
      copySidebarSelectionFromEvent(
        doc,
        win,
        sourceWin,
        sidebar,
        event,
        "copy-command",
      );
    };

    target.addEventListener("keydown", keydownHandler as EventListener, true);
    target.addEventListener("copy", copyHandler as EventListener, true);
    target.addEventListener("command", commandHandler, true);
    installedTargets.push(target);
    cleanupCallbacks.push(() => {
      target.removeEventListener(
        "keydown",
        keydownHandler as EventListener,
        true,
      );
      target.removeEventListener("copy", copyHandler as EventListener, true);
      target.removeEventListener("command", commandHandler, true);
    });
  };
  const addWindow = (targetWin: Window | null | undefined) => {
    if (!targetWin || installedWindows.has(targetWin)) return;
    installedWindows.add(targetWin);
    addTarget(targetWin, targetWin);
    try {
      addTarget(targetWin.document, targetWin);
      addTarget(targetWin.document.getElementById("cmd_copy"), targetWin);
      addTarget(targetWin.document.getElementById("key_copy"), targetWin);
      addTarget(
        targetWin.document.getElementById("editMenuCommands"),
        targetWin,
      );
      addTarget(targetWin.document.getElementById("editMenuKeys"), targetWin);
    } catch {
      // Cross-origin / destroyed frame; ignore.
    }
  };
  const cleanupCallbacks: Array<() => void> = [];
  const cacheSelection = () => {
    const sel = win.getSelection();
    if (!selectionBelongsToSidebar(sel, sidebar)) return;
    const text = serializeSidebarSelectionForClipboard(sel);
    if (!text) return;
    cacheSidebarSelection(sidebar, text, "selection-cache");
  };
  const installLikelyFrameWindows = () => {
    addWindow(win);
    installDescendantFrameCopyHandlers(win, addWindow);
    const reader = getActiveReader(win) as any;
    addWindow(reader?._internalReader?._primaryView?._iframeWindow);
    addWindow(reader?._internalReader?._secondaryView?._iframeWindow);
    addWindow(reader?._iframeWindow);
    const noteEditor = findActiveNoteEditor(sidebar);
    addWindow(noteEditor?.getCurrentInstance?.()?._iframeWindow);
  };
  installLikelyFrameWindows();
  const frameMonitorID = win.setInterval(installLikelyFrameWindows, 500);
  doc.addEventListener("selectionchange", cacheSelection, true);
  sidebar.column.addEventListener("mouseup", cacheSelection, true);
  sidebar.column.addEventListener("keyup", cacheSelection, true);
  sidebar.noteColumn.addEventListener("mouseup", cacheSelection, true);
  sidebar.noteColumn.addEventListener("keyup", cacheSelection, true);
  cleanupCallbacks.push(() => {
    win.clearInterval(frameMonitorID);
    doc.removeEventListener("selectionchange", cacheSelection, true);
    sidebar.column.removeEventListener("mouseup", cacheSelection, true);
    sidebar.column.removeEventListener("keyup", cacheSelection, true);
    sidebar.noteColumn.removeEventListener("mouseup", cacheSelection, true);
    sidebar.noteColumn.removeEventListener("keyup", cacheSelection, true);
  });
  sidebar.copyHandlerCleanup = () => {
    for (const cleanup of cleanupCallbacks.splice(0)) cleanup();
  };
}

function handleSidebarCopyEvent(
  doc: Document,
  topWin: Window,
  sourceWin: Window,
  sidebar: WindowSidebarState,
  event: ClipboardEvent,
): void {
  const pendingSidebarCopy = getPendingSidebarCopy();
  if (pendingSidebarCopy) {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", pendingSidebarCopy.text);
    if (pendingSidebarCopy.html) {
      event.clipboardData.setData("text/html", pendingSidebarCopy.html);
    }
    debugZai(`${pendingSidebarCopy.label}: clipboardData-set`, {
      text: textDebugInfo(pendingSidebarCopy.text),
      html: pendingSidebarCopy.html
        ? htmlStringDebugInfo(pendingSidebarCopy.html)
        : null,
    });
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }
  if (isProgrammaticClipboardWrite()) return;
  const sel = topWin.getSelection();
  if (!selectionBelongsToSidebar(sel, sidebar)) return;
  if (editableTargetHasOwnSelection(event.target, sel)) return;
  const text = serializeSidebarSelection(sel, "copy-event");
  if (!text || !event.clipboardData) return;
  cacheSidebarSelection(sidebar, text, "copy-event");
  const html = markdownToClipboardHTML(doc, text);
  event.clipboardData.setData("text/plain", text);
  event.clipboardData.setData("text/html", html);
  debugZai("copy-event: clipboardData-set", textDebugInfo(text));
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (sourceWin !== topWin) {
    void copyToClipboard(doc, text, "copy-event:ensure", html);
  }
}

function installDescendantFrameCopyHandlers(
  rootWin: Window,
  addWindow: (win: Window | null | undefined) => void,
): void {
  const frames = rootWin.frames;
  for (let i = 0; i < frames.length; i++) {
    let frame: Window | null = null;
    try {
      frame = frames.item(i);
    } catch {
      frame = null;
    }
    if (!frame) continue;
    addWindow(frame);
    installDescendantFrameCopyHandlers(frame, addWindow);
  }
}

function copySidebarSelectionFromEvent(
  doc: Document,
  topWin: Window,
  sourceWin: Window,
  sidebar: WindowSidebarState,
  event: Event,
  label: string,
): boolean {
  const selectionResult = sidebarClipboardText(topWin, sourceWin, sidebar);
  if (!selectionResult) return false;
  const { text, fromCache } = selectionResult;
  if (editableTargetHasOwnSelection(event.target, topWin.getSelection())) {
    return false;
  }

  debugZai(`${label}: intercepted`, {
    fromCache,
    sourceIsTop: sourceWin === topWin,
    target: eventTargetDebugInfo(event.target),
    text: textDebugInfo(text, 160),
  });
  cacheSidebarSelection(sidebar, text, label);

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  let copied = false;
  const html = markdownToClipboardHTML(doc, text);
  setPendingSidebarCopy({ text, label, html });
  try {
    copied = doc.execCommand("copy");
    debugZai(`${label}: execCommand`, { copied });
  } catch (err) {
    debugZai(`${label}: execCommand-failed`, {
      error: errorMessage(err),
    });
  } finally {
    clearPendingSidebarCopy();
  }

  // Even when execCommand reports success, Zotero/Firefox chrome can still
  // leave the native KaTeX/selection text on the clipboard. The async write
  // path is known to work from the context-menu copy action, so use it as a
  // final authoritative overwrite for keyboard/command copies.
  void copyToClipboard(doc, text, `${label}:ensure`, html);
  return true;
}

function sidebarClipboardText(
  topWin: Window,
  sourceWin: Window,
  sidebar: WindowSidebarState,
): { text: string; fromCache: boolean } | null {
  const topSelection = topWin.getSelection();
  if (selectionBelongsToSidebar(topSelection, sidebar)) {
    const text = serializeSidebarSelection(
      topSelection,
      "copy-active-selection",
    );
    return text ? { text, fromCache: false } : null;
  }

  if (hasNonCollapsedSelection(sourceWin) || hasNonCollapsedSelection(topWin)) {
    return null;
  }
  if (sourceWin === topWin) return null;

  const cached = sidebar.lastCopySelection;
  if (!cached || Date.now() - cached.updatedAt > 10000) return null;
  return { text: cached.text, fromCache: true };
}

function hasNonCollapsedSelection(win: Window): boolean {
  try {
    const sel = win.getSelection();
    return Boolean(sel && !sel.isCollapsed && sel.rangeCount > 0);
  } catch {
    return false;
  }
}

function cacheSidebarSelection(
  sidebar: WindowSidebarState,
  text: string,
  label: string,
): void {
  const previous = sidebar.lastCopySelection;
  sidebar.lastCopySelection = { text, updatedAt: Date.now() };
  if (
    !previous ||
    previous.text !== text ||
    Date.now() - previous.updatedAt > 1000
  ) {
    debugZai(`${label}: cached`, textDebugInfo(text, 120));
  }
}

function serializeSidebarSelectionForClipboard(selection: Selection): string {
  return serializeSelectionAsMarkdown(selection) || selection.toString();
}

function isCopyCommandEvent(event: Event): boolean {
  const target = event.target;
  const id = eventTargetId(target).toLowerCase();
  const command = eventTargetCommand(target).toLowerCase();
  return (
    id === "cmd_copy" ||
    command === "cmd_copy" ||
    id.includes("copy") ||
    command.includes("copy")
  );
}

function eventTargetId(target: EventTarget | null): string {
  const id = (target as unknown as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : "";
}

function eventTargetCommand(target: EventTarget | null): string {
  const getter = (
    target as { getAttribute?: (name: string) => string | null } | null
  )?.getAttribute;
  return typeof getter === "function"
    ? getter.call(target, "command") || ""
    : "";
}

function eventTargetDebugInfo(target: EventTarget | null): unknown {
  return {
    id: eventTargetId(target),
    command: eventTargetCommand(target),
    tag: (target as { tagName?: string } | null)?.tagName ?? "",
  };
}

function selectionBelongsToSidebar(
  selection: Selection | null,
  sidebar: WindowSidebarState,
): selection is Selection {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  return Boolean(
    (anchor &&
      (sidebar.column.contains(anchor) ||
        sidebar.noteColumn.contains(anchor))) ||
    (focus &&
      (sidebar.column.contains(focus) || sidebar.noteColumn.contains(focus))),
  );
}

function isEditableCopyTarget(target: EventTarget | null): boolean {
  return !!editableCopyRoot(target);
}

function editableCopyRoot(target: EventTarget | null): Element | null {
  const el = target as unknown as Element | null;
  if (!el || (el as unknown as { nodeType?: number }).nodeType !== 1) {
    return null;
  }
  const closest = (
    el as unknown as {
      closest?: (selector: string) => Element | null;
    }
  ).closest;
  const root =
    typeof closest === "function"
      ? closest.call(el, "textarea,input,[contenteditable='true']")
      : null;
  if (root) return root;
  const tag = el.tagName;
  return tag === "TEXTAREA" ||
    tag === "INPUT" ||
    el.getAttribute("contenteditable") === "true"
    ? el
    : null;
}

function editableTargetHasOwnSelection(
  target: EventTarget | null,
  selection: Selection | null,
): boolean {
  const root = editableCopyRoot(target);
  if (!root) return false;
  const tag = root.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") {
    const input = root as HTMLInputElement | HTMLTextAreaElement;
    try {
      return (input.selectionStart ?? 0) !== (input.selectionEnd ?? 0);
    } catch {
      return true;
    }
  }
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  return Boolean(
    (anchor && root.contains(anchor)) || (focus && root.contains(focus)),
  );
}

function serializeSidebarSelection(
  selection: Selection,
  label: string,
): string {
  const nativeText = selection.toString();
  const markdown = serializeSelectionAsMarkdown(selection);
  const text = markdown || nativeText;
  debugZai(`${label}: selection`, {
    rangeCount: selection.rangeCount,
    native: textDebugInfo(nativeText),
    markdown: textDebugInfo(markdown),
    used: markdown ? "markdown" : "native",
    output: textDebugInfo(text),
    ranges: rangeDebugInfo(selection),
  });
  return text;
}

// Right-click on a chat selection → floating menu with 复制 / 导入笔记.
// We deliberately don't replace the entire context menu (that would require
// fighting Zotero's XUL menupopup system); instead we suppress the default
// browser menu only when our criteria are met, then render a lightweight
// HTML menu at the click point.
function installSidebarSelectionMenu(
  win: Window,
  sidebar: WindowSidebarState,
): void {
  const doc = win.document;
  let activeMenu: HTMLElement | null = null;
  const dismiss = () => {
    activeMenu?.remove();
    activeMenu = null;
    doc.removeEventListener("mousedown", outsideClick, true);
    doc.removeEventListener("keydown", escClose, true);
  };
  const outsideClick = (e: Event) => {
    if (activeMenu && !activeMenu.contains(e.target as Node)) dismiss();
  };
  const escClose = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismiss();
  };

  const onContextMenu = (event: MouseEvent) => {
    const sel = win.getSelection();
    if (!selectionBelongsToSidebar(sel, sidebar)) return;
    const text = serializeSidebarSelection(sel, "context-menu");
    if (!text) return;

    event.preventDefault();
    event.stopPropagation();
    dismiss();

    const menu = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    menu.className = "zai-selection-menu";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    const copyBtn = doc.createElementNS(
      XHTML_NS,
      "button",
    ) as HTMLButtonElement;
    copyBtn.type = "button";
    copyBtn.className = "zai-selection-menu-item";
    copyBtn.textContent = "复制";
    copyBtn.addEventListener("click", () => {
      debugZai("context-menu-copy: click", textDebugInfo(text));
      void copyToClipboard(
        doc,
        text,
        "context-menu-copy",
        markdownToClipboardHTML(doc, text),
      );
      dismiss();
    });

    const importBtn = doc.createElementNS(
      XHTML_NS,
      "button",
    ) as HTMLButtonElement;
    importBtn.type = "button";
    importBtn.className = "zai-selection-menu-item";
    importBtn.textContent = "导入笔记";
    importBtn.addEventListener("click", () => {
      debugZai("context-menu-import: click", textDebugInfo(text));
      void importSelectionToNote(doc, sidebar, text);
      dismiss();
    });

    menu.append(copyBtn, importBtn);
    (doc.body ?? doc.documentElement)?.append(menu);
    activeMenu = menu;
    doc.addEventListener("mousedown", outsideClick, true);
    doc.addEventListener("keydown", escClose, true);
  };

  win.addEventListener("contextmenu", onContextMenu, true);
  sidebar.selectionMenuCleanup = () => {
    win.removeEventListener("contextmenu", onContextMenu, true);
    dismiss();
  };
}

// Insert a chat selection into the user's note. If the note panel is open
// AND its editor exposes a usable cursor (ProseMirror selection), insert
// at that cursor; otherwise append to the end of the note. The end-of-note
// fallback uses the existing append path (with Better Notes if available)
// but without the "AI 总结 [timestamp]" header — that header is for whole-
// message exports, not for snippet imports.
async function importSelectionToNote(
  doc: Document,
  sidebar: WindowSidebarState,
  selectionMarkdown: string,
): Promise<void> {
  const itemID = sidebar.noteItemID ?? currentItemIdForSidebar(sidebar);
  if (itemID == null) {
    Zotero.debug("[zai] importSelectionToNote: no item selected");
    return;
  }

  const html = markdownToNoteHTMLFragment(doc, selectionMarkdown);
  debugZai("import-selection:prepared", {
    itemID,
    noteItemID: sidebar.noteItemID,
    currentItemID: currentItemIdForSidebar(sidebar),
    markdown: textDebugInfo(selectionMarkdown),
    html: htmlDebugInfo(doc, html),
  });

  try {
    const noteScroll = captureVisibleNoteScrollForDocument(doc);
    armVisibleNoteRestoreForDocument(
      doc,
      noteScroll,
      "import-selection:before-insert",
    );
    const target = await resolveTargetNote(itemID);
    debugZai("import-selection:target-note", {
      noteID: target.note.id,
      created: target.created,
      noteBefore: textDebugInfo(target.note.getNote?.() || "", 120),
    });
    const activeEditor = findActiveNoteEditor(sidebar);
    const activeCaret = noteCaretSnapshotForSidebar(sidebar);
    if (
      activeEditor &&
      sidebar.noteItemID === target.note.id &&
      tryInsertHTMLAtCursor(activeEditor, html, activeCaret)
    ) {
      activeEditor.saveSync?.();
      sidebar.noteCaretSnapshot =
        captureNoteCaretSnapshot(activeEditor, sidebar.noteItemID) ??
        sidebar.noteCaretSnapshot;
      ensureAllZoteroNoteEditorKatexCSS(doc);
      debugZai("import-selection:cursor-inserted", {
        noteID: target.note.id,
        caret: activeCaret ? noteCaretSnapshotDebugInfo(activeCaret) : null,
        noteAfterInsert: textDebugInfo(target.note.getNote?.() || "", 120),
      });
      return;
    }
    // Better Notes' editor insertion path uses ProseMirror insertHTML(),
    // which can truncate multi-block snippets after display math. Force
    // metadata insertion for selection imports, then refresh the visible
    // editor so all blocks after the formula survive.
    await insertHTMLIntoNote(target.note, html, true);
    refreshVisibleNoteWindow(doc, target.note.id, noteScroll);
    ensureAllZoteroNoteEditorKatexCSS(doc);
    doc.defaultView?.setTimeout(() => {
      ensureAllZoteroNoteEditorKatexCSS(doc);
    }, 300);
    debugZai("import-selection:refreshed", {
      noteID: target.note.id,
      noteAfterRefreshCall: textDebugInfo(target.note.getNote?.() || "", 120),
    });
  } catch (err) {
    debugZai("import-selection:failed", { error: errorMessage(err) });
  }
}

function currentItemIdForSidebar(sidebar: WindowSidebarState): number | null {
  return states.get(sidebar.mount)?.itemID ?? null;
}

function markdownToNoteHTMLFragment(doc: Document, markdown: string): string {
  const tmp = doc.createElement("div");
  renderMarkdownInto(tmp, markdown.trim(), "source");
  return String(tmp.innerHTML);
}

function markdownToClipboardHTML(doc: Document, markdown: string): string {
  const htmlDoc = doc.implementation.createHTMLDocument("zai-clipboard");
  const tmp = htmlDoc.createElement("div");
  renderMarkdownInto(tmp, markdown.trim(), "source");
  return String(tmp.innerHTML);
}

export function unregisterSidebarForWindow(win: Window) {
  const state = windowSidebars.get(win);
  if (!state) return;

  disableTranslateMode(win);

  const pane = (win as any).ZoteroPane;
  if (
    state.originalItemSelected &&
    state.patchedItemSelected &&
    pane?.itemSelected === state.patchedItemSelected
  ) {
    pane.itemSelected = state.originalItemSelected;
  }

  state.splitter.remove();
  state.column.remove();
  state.noteSplitter.remove();
  state.noteEditorCleanup?.();
  state.noteEditorCleanup = undefined;
  state.copyHandlerCleanup?.();
  state.copyHandlerCleanup = undefined;
  state.selectionMenuCleanup?.();
  state.selectionMenuCleanup = undefined;
  state.promptShortcutCleanup?.();
  state.promptShortcutCleanup = undefined;
  state.readerTranslateToolbarCleanup?.();
  state.readerTranslateToolbarCleanup = undefined;
  state.layoutCleanup?.();
  state.layoutCleanup = undefined;
  state.initialRefreshCleanup?.();
  state.initialRefreshCleanup = undefined;
  state.noteColumn.remove();
  state.toggleButton?.remove();
  state.floatingButton?.remove();
  stopSelectionMonitor(win, state);
  mountedWindows.delete(win);
  windowSidebars.delete(win);
}

export function unregisterSidebar() {
  registered = false;
  unregisterReaderSelectionCapture();
  for (const win of Array.from(mountedWindows)) {
    unregisterSidebarForWindow(win);
  }
}

function renderWindowSidebar(win: Window) {
  const state = windowSidebars.get(win);
  if (!state) return;

  const itemID = safeSelectedItemID(win);
  const panelState = states.get(state.mount);
  if (panelState?.sending) {
    updateSelectionIndicators(state.mount, panelState.itemID);
    updateToggleButton(state);
    return;
  }

  const previousItemID = panelState?.itemID ?? null;
  renderMount(state.mount, itemID);
  if (itemID !== previousItemID) {
    if (state.noteItemID) switchNoteForItem(state, itemID);
    void migrateTranslateModeOnReaderSwitch(win);
  }
  updateToggleButton(state);
}

function switchNoteForItem(
  sidebar: WindowSidebarState,
  itemID: number | null,
): void {
  const note = findExistingNoteForItem(itemID);
  if (note) {
    sidebar.noteEditorCleanup?.();
    sidebar.noteEditorCleanup = undefined;
    sidebar.noteMount.replaceChildren();
    sidebar.noteItemID = note.id;
    renderNoteWindow(sidebar, note);
  } else {
    sidebar.noteItemID = undefined;
    sidebar.noteEditorCleanup?.();
    sidebar.noteEditorCleanup = undefined;
    sidebar.noteMount.replaceChildren();
    setNoteColumnVisible(sidebar, false);
  }
  updateOpenNoteButton(sidebar);
}

function findExistingNoteForItem(itemID: number | null): Zotero.Item | null {
  if (itemID == null) return null;
  const item = getZoteroItem(itemID);
  if (!item) return null;
  if (isZoteroNote(item)) {
    return isAiNote(item) || isReadingRouteNote(item) ? item : null;
  }
  const parent = parentItemForNotes(item);
  return childNotesForItem(parent).find(isAiNote) ?? null;
}

function safeSelectedItemID(win: Window): number | null {
  try {
    return getSelectedItemID(win);
  } catch (err) {
    debugZai("sidebar.selected-item.failed", { error: errorMessage(err) });
    return null;
  }
}

function scheduleInitialSidebarRefresh(win: Window, state: WindowSidebarState) {
  const timers: number[] = [];
  let raf = 0;
  const refresh = () => {
    if (windowSidebars.get(win) !== state) return;
    renderWindowSidebar(win);
  };

  // On cold start Zotero can call plugin window-load hooks before the item
  // pane selection and stylesheet layout have fully settled. A few delayed
  // refreshes mirror the later hide/show path without changing normal chat.
  if (win.requestAnimationFrame) {
    raf = win.requestAnimationFrame(refresh);
  }
  for (const delay of [0, 100, 400, 1200]) {
    timers.push(win.setTimeout(refresh, delay));
  }
  state.initialRefreshCleanup = () => {
    if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    for (const timer of timers) win.clearTimeout(timer);
  };
}

function installToggleButton(win: Window, state: WindowSidebarState) {
  const doc = win.document;
  const toolbar = doc.getElementById("zotero-items-toolbar");
  if (!toolbar) return;

  doc.getElementById(TOGGLE_BUTTON_ID)?.remove();

  const button = doc.createXULElement("toolbarbutton");
  button.id = TOGGLE_BUTTON_ID;
  button.setAttribute("class", "zotero-tb-button zai-toggle-button");
  button.setAttribute("label", "AI");
  button.setAttribute("tooltiptext", "显示/隐藏 AI 对话");
  const icon = `chrome://${addon.data.config.addonRef}/content/icons/ai-chat.svg`;
  button.setAttribute("image", icon);
  button.setAttribute("style", `list-style-image: url("${icon}");`);
  button.addEventListener("command", () => {
    setColumnCollapsed(win, state, !isColumnCollapsed(state));
  });

  const spacer = toolbar.querySelector('spacer[flex="1"]');
  toolbar.insertBefore(button, spacer ?? null);
  state.toggleButton = button;
  updateToggleButton(state);
}

function installFloatingToggle(win: Window, state: WindowSidebarState) {
  const doc = win.document;
  const stack = doc.getElementById("zotero-pane-stack") ?? doc.documentElement;
  if (!stack) return;
  doc.getElementById(FLOATING_TOGGLE_ID)?.remove();

  const button = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  button.id = FLOATING_TOGGLE_ID;
  button.className = "zai-floating-toggle";
  button.type = "button";
  button.title = "打开/隐藏 AI 对话";

  const icon = doc.createElementNS(XHTML_NS, "img") as HTMLImageElement;
  icon.src = `chrome://${addon.data.config.addonRef}/content/icons/ai-chat.svg`;
  icon.alt = "";
  const label = doc.createElementNS(XHTML_NS, "span");
  label.textContent = "AI";
  button.append(icon, label);

  button.addEventListener("click", () => {
    setColumnCollapsed(win, state, !isColumnCollapsed(state));
  });

  stack.append(button);
  state.floatingButton = button;
  updateToggleButton(state);
}

function setColumnCollapsed(
  win: Window,
  state: WindowSidebarState,
  collapsed: boolean,
) {
  const column = state.column as Element & { collapsed?: boolean };
  const splitter = state.splitter as Element & { hidden?: boolean };
  if (collapsed) {
    disableTranslateMode(win);
    column.collapsed = true;
    splitter.hidden = true;
    state.column.setAttribute("collapsed", "true");
    state.splitter.setAttribute("hidden", "true");
    state.noteItemID = undefined;
    state.noteEditorCleanup?.();
    state.noteEditorCleanup = undefined;
    state.noteMount.replaceChildren();
    setNoteColumnVisible(state, false);
  } else {
    column.collapsed = false;
    splitter.hidden = false;
    state.column.removeAttribute("collapsed");
    state.column.removeAttribute("hidden");
    state.splitter.removeAttribute("hidden");
    state.splitter.removeAttribute("state");
    if (!state.column.getAttribute("width")) {
      state.column.setAttribute("width", String(DEFAULT_AI_COLUMN_WIDTH));
    }
    renderWindowSidebar(win);
  }
  updateToggleButton(state);
}

function hideCurrentSidebar(mount: HTMLElement) {
  for (const win of mountedWindows) {
    const state = windowSidebars.get(win);
    if (state?.mount === mount) {
      setColumnCollapsed(win, state, true);
      return;
    }
  }
}

function isColumnCollapsed(state: WindowSidebarState): boolean {
  const column = state.column as Element & {
    collapsed?: boolean;
    hidden?: boolean;
  };
  return (
    column.collapsed === true ||
    column.hidden === true ||
    state.splitter.getAttribute("state") === "collapsed" ||
    state.column.getAttribute("collapsed") === "true" ||
    state.column.getAttribute("hidden") === "true"
  );
}

function updateToggleButton(state: WindowSidebarState) {
  const collapsed = isColumnCollapsed(state);
  for (const button of [state.toggleButton, state.floatingButton]) {
    if (!button) continue;
    const tooltip = collapsed ? "打开 AI 对话" : "隐藏 AI 对话";
    button.setAttribute("tooltiptext", tooltip);
    button.setAttribute("title", tooltip);
    button.setAttribute("aria-pressed", collapsed ? "false" : "true");
    button.toggleAttribute("checked", !collapsed);
    button.classList.toggle("is-open", !collapsed);
    if (button === state.floatingButton) {
      button.toggleAttribute("hidden", !collapsed);
    }
  }
}

// Monkey-patches `ZoteroPane.itemSelected` so we re-render after the user
// selects an item. WHY patch (not just a setInterval): item selection is
// the single trigger we MUST react to to swap chat threads, and Zotero
// doesn't expose a clean event for it on every supported version.
// INVARIANT: `unregisterSidebarForWindow` only restores the original if
// our patched function is still installed — defends against another
// plugin patching after us (we'd otherwise undo their patch).
// REF: Zotero source `chrome/content/zotero/zoteroPane.js` ZoteroPane.itemSelected.
function patchItemSelection(win: Window, state: WindowSidebarState) {
  const pane = (win as any).ZoteroPane;
  if (typeof pane?.itemSelected !== "function") return;

  const original = pane.itemSelected;
  const patched = function patchedItemSelected(
    this: unknown,
    ...args: unknown[]
  ) {
    let result: unknown;
    try {
      result = original.apply(this, args);
    } catch (err) {
      renderWindowSidebar(win);
      throw err;
    }

    Promise.resolve(result).finally(() => renderWindowSidebar(win));
    return result;
  };

  state.originalItemSelected = original;
  state.patchedItemSelected = patched;
  pane.itemSelected = patched;
}

function getSelectedItemID(win: Window): number | null {
  const readerID = activeReaderConversationItemID(win);
  if (readerID != null) return readerID;

  const pane = (win as any).ZoteroPane;
  const selected = pane?.getSelectedItems?.();
  const item = Array.isArray(selected) ? selected[0] : null;
  return conversationItemID(item);
}

// "Conversation item ID" = the parent regular item, NOT the PDF
// attachment. WHY: a chat thread is keyed by the bibliographic item so
// the same conversation persists across opening different attachments
// (e.g. paper PDF vs supplementary PDF). When the Reader is on the
// attachment, walk up to its parent.
function activeReaderConversationItemID(win: Window): number | null {
  const reader = getActiveReader(win);
  const r = reader as {
    itemID?: number;
    _item?: { id?: number; parentID?: number };
  } | null;
  return typeof r?._item?.parentID === "number"
    ? r._item.parentID
    : typeof r?._item?.id === "number"
      ? itemIDToParentID(r._item.id)
      : itemIDToParentID(r?.itemID);
}

function conversationItemID(item: unknown): number | null {
  const i = item as {
    id?: number;
    parentID?: number;
    isAttachment?: () => boolean;
  } | null;
  if (!i) return null;
  if (typeof i.parentID === "number") return i.parentID;
  const id = i.id;
  return typeof id === "number" ? id : null;
}

function itemIDToParentID(itemID: unknown): number | null {
  if (typeof itemID !== "number") return null;
  try {
    const item = Zotero.Items.get(itemID) as {
      id?: number;
      parentID?: number;
    } | null;
    return conversationItemID(item);
  } catch {
    return itemID;
  }
}

async function migrateTranslateModeOnReaderSwitch(win: Window): Promise<void> {
  const existing = translateControllers.get(win);
  if (!existing?.isEnabled()) return;
  const reader = getActiveReader(win);
  if (!reader || existing.isForReader(reader)) return;
  existing.disable();
  const prefs = zoteroPrefs();
  const ctrl = new TranslateModeController({
    prefs,
    presets: loadPresets(prefs),
    reader,
  });
  translateControllers.set(win, ctrl);
  try {
    await ctrl.enable();
  } catch {
    translateControllers.delete(win);
  }
  syncTranslateButtons(win);
}

async function toggleTranslateMode(
  win: Window,
  btn: HTMLElement,
): Promise<void> {
  const ctrl = await getOrCreateTranslateController(win);
  if (!ctrl) {
    syncTranslateBtnState(win, btn);
    flashButton(btn as HTMLButtonElement, "无PDF");
    return;
  }
  if (ctrl.isEnabled()) {
    ctrl.disable();
    translateControllers.delete(win);
    syncTranslateBtnState(win, btn);
  } else {
    try {
      await ctrl.enable();
      syncTranslateBtnState(win, btn);
    } catch (err) {
      debugZai("translate.enable.failed", { error: errorMessage(err) });
      syncTranslateBtnState(win, btn);
      flashButton(btn as HTMLButtonElement, "失败");
    }
  }
}

async function getOrCreateTranslateController(
  win: Window,
): Promise<TranslateModeController | null> {
  const reader = getActiveReader(win);
  if (!reader) return null;
  const existing = translateControllers.get(win);
  const prefs = zoteroPrefs();
  const presets = loadPresets(prefs);
  if (existing?.isForReader(reader)) {
    existing.refreshPresets(presets);
    return existing;
  }
  existing?.disable();
  const ctrl = new TranslateModeController({
    prefs,
    presets,
    reader,
  });
  translateControllers.set(win, ctrl);
  return ctrl;
}

function syncTranslateBtnState(win: Window, btn: HTMLElement): void {
  const enabled = translateControllers.get(win)?.isEnabled() ?? false;
  btn.classList.toggle("zai-toolbar-icon--active", enabled);
  btn.classList.toggle("zai-reader-translate-button--active", enabled);
  setTranslateButtonLabel(btn, enabled);
  syncReaderTranslateButtons(win, btn.ownerDocument ?? undefined);
}

function disableTranslateMode(win: Window): void {
  translateControllers.get(win)?.disable();
  translateControllers.delete(win);
  syncTranslateButtons(win);
}

function syncTranslateButtons(win: Window): void {
  const docs = [win.document];
  const reader = getActiveReader(win) as any;
  for (const readerWin of activeReaderWindows(reader))
    docs.push(readerWin.document);
  const enabled = translateControllers.get(win)?.isEnabled() ?? false;
  for (const doc of docs) {
    const buttons = Array.from(
      doc.querySelectorAll(
        ".zai-sidebar-translate-button,.zai-reader-translate-button",
      ),
    ) as HTMLElement[];
    for (const button of buttons) {
      button.classList.toggle("zai-toolbar-icon--active", enabled);
      button.classList.toggle("zai-reader-translate-button--active", enabled);
      setTranslateButtonLabel(button, enabled);
    }
  }
}

function setTranslateButtonLabel(btn: HTMLElement, enabled: boolean): void {
  if (
    !btn.classList.contains("zai-sidebar-translate-button") &&
    !btn.classList.contains("zai-reader-translate-button")
  ) {
    return;
  }
  btn.textContent = enabled ? "译✓" : "译";
}

declare global {
  interface Document {
    createXULElement(tagName: string): Element;
  }
}
