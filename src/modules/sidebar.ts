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
import {
  createPdfLocator,
  getReaderPdfApp,
  getSharedPdfLocator,
  type LocateResult,
  type PdfRect,
} from "../context/pdf-locator";
import { extractPdfRange, searchPdfPassages } from "../context/retrieval";
import { ensureArxivSource } from "../context/arxiv-source";
import { hasArxivSource } from "../context/arxiv-store";
import { buildArxivTocFrontBlock } from "../context/arxiv-tools";
import { resolveArxivIdForItemID } from "../context/arxiv-id";
import { toolsForPinnedFullTextTurn } from "../context/tool-filter";
import {
  findSection,
  isArxivTocBlock,
  type TexSection,
} from "../context/tex-sections";
import {
  normalizeLatexListEnvironments,
  normalizeLatexSourceCommands,
} from "../context/tex-clean";
import { zoteroContextSource } from "../context/zotero-source";
import { checkLatexSourceAvailability } from "./latex-source-availability";
import { getProvider } from "../providers/factory";
import type {
  AssistantAnnotationDraft,
  ChatTaskMeta,
  Message,
  PdfSelectionLocator,
  WebAnnotationBatchDraft,
  WebTaskStatus,
} from "../providers/types";
import {
  clearAffectedBranchOriginsAfterDeletion,
  createBranchedConversation,
  createChatConversation,
  loadChatConversations,
  saveChatConversations,
  type ChatConversation,
} from "../settings/chat-history";
import {
  freezeFullText,
  getFrozenFullText,
  isPaperPinned,
  setPaperPinned,
} from "../settings/paper-cache";
import { loadQuickPromptSettings } from "../settings/quick-prompts";
import {
  createFullTranslationState,
  saveFullTranslationState,
} from "../settings/full-translation-store";
import { loadPresets, zoteroPrefs } from "../settings/storage";
import {
  DEFAULT_LOCAL_UI_SETTINGS,
  loadLocalUiSettings,
  normalizeLocalUiSettings,
  saveLocalUiSettings,
  type CustomWebProvider,
  type FullTranslationReadingSettings,
  type LocalUiSettings,
} from "../settings/local-ui-settings";
import {
  loadToolSettings,
  saveToolSettings,
  type WebSearchMode,
} from "../settings/tool-settings";
import {
  loadUiSettings,
  saveUiSettings,
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
  type TranslateThinking,
} from "../settings/types";
import {
  expandSlashCommandMessage,
  matchingSlashCommandsForSendMode,
  type SlashCommand,
} from "../ui/slash-commands";
import { serializeSelectionAsMarkdown } from "../ui/selection-serialize";
import { mountSelectionPopupGuard } from "../translate/overlay";
import { TranslateModeController } from "../translate/translate-mode";
import {
  AskModeController,
  getImmersiveModeShortcut,
  isImmersiveModeShortcut,
} from "../translate/ask-mode";
import { getReadingConversations } from "../translate/reading-log";
import { summarizeReadingConversations } from "../translate/reading-summary";
import {
  collapseFullDocumentThinking,
  createFullDocumentTranslator,
  fullDocumentModelsForPreset,
  fullDocumentThinkingOptions,
  resolveFullDocumentModelSelection,
  saveFullDocumentModelSelection,
  type FullDocumentTranslator,
} from "../translate/full-document-provider";
import { runFullDocumentTranslation } from "../translate/full-document-runner";
import { loadFullTranslationAssetPreviews } from "../translate/full-document-assets";
import {
  loadFullTranslationSession,
  type FullTranslationSession,
} from "../translate/full-document-session";
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
  revealFullTranslationSourceBlock,
  renderFullTranslationView,
  type FullTranslationModelSettings,
  updateFullTranslationAssetPreview,
} from "./full-translation-view";
import {
  findFullTranslationSourceBlockId,
  readFullTranslationSourceSelection,
} from "./full-translation-interactions";
import {
  buildQuickAskApiMessages,
  createQuickAskState,
  createQuickAskUserMessage,
  getQuickAskShortcut,
  isQuickAskShortcut,
  loadQuickAskModelSelection,
  quickAskReadOnlyTools,
  saveQuickAskModelSelection,
  type QuickAskReference,
  type QuickAskState,
} from "./quick-ask";
import {
  renderQuickAskDialog,
  type QuickAskModelOption,
} from "./quick-ask-dialog";
import {
  selectConversationHistory,
  type ConversationHistoryMode,
} from "./conversation-history";
import {
  mountFullTranslationHost,
  syncFullTranslationHostBounds,
  unmountFullTranslationHost,
  type FullTranslationHost,
} from "./full-translation-host";
import {
  formatConversationMarkdown,
  messageToClipboard,
} from "./clipboard-format";
import { saveFrontBlockDebugFileOnce } from "./front-block-debug-file";
import { migrateLegacyDeepSeekMessages } from "./web-history-migration";
import {
  createWebPromptTask,
  type WebPromptProvider,
  type WebPromptResult,
} from "./web-prompt-hub";
import {
  advanceWebProgressText,
  advanceWebReasoningSnapshot,
  interruptStaleWebPromptTasks,
  isWebPromptUserMessage,
  webPromptProviderForUserMessage,
  webPromptStatusBubbleContent,
  webPromptTaskPending,
} from "./web-prompt-runtime";
import { buildWebPrompt, completedWebHistory } from "./web-prompt-format";
import {
  hasWebAnnotationProtocol,
  parseWebAnnotationBatch,
  type WebAnnotationCandidate,
  webAnnotationTaskQuestion,
} from "./web-annotation-batch";
import { locateWebAnnotationQuoteSegments } from "./web-annotation-locate";
import { saveWebAnnotationEntry } from "./web-annotation-save";
import { locateWebSelectionAnnotationDraft } from "./web-selection-annotation";
import { renderWebTaskProgress, webTaskProgressFor } from "./web-task-progress";
import { renderEmptySignatures } from "./empty-signatures";
import {
  cancelWebAgentTask,
  dispatchWebAgentTask,
  getWebAccountStatus,
  hideWebAccount,
  openWebAccount,
} from "./web-agent-client";
import {
  installLocalWebAgentRuntime,
  inspectWebAgentInstallation,
  repairWebAgentInstallation,
  webAgentRuntimeRelease,
  WebAgentRuntimeDownloadError,
  type WebAgentInstallationReport,
} from "./web-agent-installer";
import {
  createWebContextAttachment,
  createWebTocAttachment,
  resolveWebPaperMaterial,
} from "./web-paper-material";
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
  NOTE_PDF_REFERENCE_HASH_MARKER,
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
  dedicatedNoteMarker,
  findReadingRouteNote,
  getZoteroItem,
  isAiNote,
  isReadingRouteNote,
  isZoteroNote,
  noteTitle,
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
  stripSummarySectionHTML,
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
import { renderOverviewBlock, type OverviewNavState } from "./overview-view";
import { renderNetworkDiagramAnalysisCard } from "./network-diagram-view";
import { buildOverviewExportHtml } from "./overview-export";
import {
  buildPanelPdfHtml,
  copyPdfFileToClipboard,
  panelPdfFileName,
  pickPanelPdfSavePath,
  saveContentWindowAsPdf,
  savePanelHtmlAsPdf,
} from "./tab-pdf-export";
import {
  renderPdfExportDialog,
  type PdfExportDialogActions,
  type PdfExportDialogState,
} from "./pdf-export-dialog";
import {
  collectPluginCss,
  openOverviewInBrowser,
  writeOverviewAttachment,
  type ZoteroExportApi,
} from "./overview-attachment";
import { saveReadingRouteToDedicatedNote } from "./reading-route-note";
import {
  autosaveNoteNow,
  scheduleAutosaveNote,
  updateNoteSaveState,
} from "./note-autosave";
import {
  assistantContentToNoteHTML,
  betterNotesInsertAvailable,
  formatNoteTimestamp,
  insertHTMLIntoNote,
  installPdfQuoteButtonsInElement,
  jumpToPdfQuote,
  locatePdfQuoteBlock,
  markActiveQuoteElement,
  pdfOpenUrlForSelection,
  pdfSelectionPageLabel,
  previewSelection,
} from "./note-pdf-render";
import {
  cachedArxivSections,
  clearReaderTransientPdfState,
  destroyActiveRouteHighlight,
  focusReaderViewForSelection,
  jumpToOverviewSection,
  jumpToPdfLocationOnly,
  jumpToPdfSelectionPreview,
  jumpToReadingRouteReference,
  pdfSelectionLocatorFromLocateResult,
  resolveItemKeyForCache,
  selectionRangeOffset,
  selectionRangePageIndex,
  selectionRangesFromLocator,
  setReaderTextLayerSelection,
  setTempLoadMarkStatus,
  sleepInWindow,
  textFromReaderChars,
} from "./pdf-navigation";
import { buildPromptCacheDebug, shortHash } from "./prompt-cache-debug";
import {
  activeReaderConversationItemID,
  activeReaderViews,
  activeReaderWindows,
  allZoteroReaders,
  conversationItemID,
  firstText,
  getActiveReader,
  getActiveReaderForItem,
  getActiveReaderSelection,
  getReaderForAttachmentOrItem,
  getReaderForCurrentSelection,
  getStoredSelectedText,
  getStoredSelectionAnnotation,
  itemIDToParentID,
  normalizeSelectedText,
  readerAttachmentID,
  readerConversationItemID,
  readerHasAttachmentID,
  readerItemIDs,
  safeSelectionText,
} from "./reader-access";
import {
  closestNoteElement,
  isNotePdfJumpLink,
  isPdfLocationJumpLink,
  isPdfQuoteJumpLink,
  normalizeZoteroNotePdfLocationOnlyLinks,
  normalizeZoteroNotePdfQuoteLinks,
  notePdfJumpEventTargets,
  notePdfJumpLinkAtPoint,
  notePdfJumpLinkFromEvent,
  pdfReferenceLabelFromNoteHref,
  pdfReferenceLabelFromNoteLink,
  sourceItemIDFromNoteLink,
} from "./note-pdf-link-parse";
import {
  bestOverlappingClientRect,
  clientRectArray,
  clientRectListOverlaps,
  clientRectMidY,
  clientRectOverlapArea,
  clientRectsOverlap,
  collectSelectionTextNodes,
  extractVisualTextFromClientRects,
  isUsableVisualSelectionText,
  isUsefulClientRect,
  selectionClientRects,
  shouldInsertVisualSpace,
  textCodeUnitSegments,
  textFromVisualFragments,
  unionClientRects,
  visualCharFragments,
  visualRowText,
  type VisualCharFragment,
} from "./client-rect-geometry";
import {
  ensureAllZoteroNoteEditorKatexCSS,
  ensureZoteroNoteEditorKatexCSS,
} from "./note-katex-css";
import {
  assignHrefWithDebug,
  encodeURIComponentWithDebug,
  readingRouteElementDebugInfo,
  readingRouteErrorDebugInfo,
  readingRouteNodesDebugInfo,
  readingRouteStringDiagnostics,
  setAttributeWithDebug,
} from "./reading-route-debug";
import {
  formatSelectedTextSemantically,
  repairPdfSelectionLineBreaks,
} from "./selected-text-format";
import {
  charOffsetsForPdfRects,
  charOffsetsForReaderText,
  clonePlainForScope,
  normalizedReaderCharsWithMap,
  normalizedReaderTextWithMap,
  normalizedReaderTokensWithMap,
  pdfRectCenterInside,
  pdfRectDistance,
  pdfRectFromChar,
  pdfRectUnion,
  pdfRects,
  rectDistanceScore,
  rectsFromReaderChars,
  selectionSortIndex,
  type PdfRectTuple,
} from "./pdf-geometry";
import {
  activeMessagesScrollLock,
  isMessagesElementNearBottom,
  isMessagesNearBottom,
  lockMessagesScroll,
  preserveMessagesScroll,
  preserveStreamingMessagesScroll,
  restoreMessagesScroll,
  scheduleMessagesScrollRestore,
} from "./message-scroll";
import {
  COLUMN_ID,
  DEFAULT_AI_COLUMN_WIDTH,
  DEFAULT_NOTE_COLUMN_WIDTH,
  FLOATING_TOGGLE_ID,
  MAX_AI_COLUMN_WIDTH,
  MAX_NOTE_COLUMN_WIDTH,
  MIN_AI_COLUMN_WIDTH,
  MIN_NOTE_COLUMN_WIDTH,
  NOTE_COLUMN_ID,
  NOTE_ROOT_ID,
  NOTE_SPLITTER_ID,
  OPENAI_QUICK_MODELS,
  PDF_QUOTE_BUTTON_LIMIT,
  PDF_QUOTE_MAX_PER_RENDER,
  PDF_QUOTE_MIN_CHARS,
  READER_LAYOUT_PREF_KEY,
  ROOT_ID,
  SELECTION_CONTEXT_QUERY_CHARS,
  SELECTION_CONTEXT_RADIUS_CHARS,
  SELECTION_MONITOR_MS,
  SPLITTER_ID,
  TOGGLE_BUTTON_ID,
  XHTML_NS,
  ZOTERO_TOOL_MANUAL,
  activeRouteHighlights,
  contextPolicy,
  ignoredSelectedTextByItem,
  mountedWindows,
  pdfQuoteLocateCache,
  readerByAttachmentID,
  selectedAnnotationByItem,
  selectedTextByItem,
  states,
  translateControllers,
  askControllers,
  windowRegisterRetries,
  windowSidebars,
  type MessagesScrollLock,
  type MessagesScrollSnapshot,
  type ConversationTaskRuntime,
  type PanelState,
  type ReaderLayoutPrefs,
  type VisualSelectionSnapshot,
  type WindowSidebarState,
} from "./sidebar-state";
import { appendLocalPath } from "../utils/local-path";
import {
  describeUnavailableGeneratedFiles,
  saveWebGeneratedFileToCurrentItem,
  webGeneratedFilePath,
} from "./web-generated-file";
import {
  stripWebChartPlaceholders,
  webChartImage,
  webChartPlaceholderOrdinal,
} from "./web-chart-placeholder";
import { loadOverview, saveOverview } from "../context/overview-store";
import {
  buildNetworkDiagramUserPrompt,
  runNetworkDiagramAgent,
} from "../context/network-diagram-agent";
import { parsePublicGitHubRepositoryURL } from "../context/github-repository";
import {
  appendNetworkDiagramRevision,
  clearNetworkDiagramMessages,
  loadNetworkDiagramWorkspace,
  restoreLatestNetworkDiagramRevision,
  saveNetworkDiagramWorkspace,
  undoNetworkDiagramRevision,
} from "../context/network-diagram-store";
import {
  currentNetworkDiagramRevision,
  detailedNetworkGraphToMindmap,
  type DetailedNetworkNode,
  type EvidenceReference,
  type NetworkDiagramAnalysisProgress,
  type NetworkDiagramAgentResult,
  type NetworkDiagramMessage,
  type NetworkDiagramWorkspace,
} from "../context/network-diagram-types";
import { loadReading, saveReading } from "../context/reading-store";
import type { OverviewData, OverviewSection } from "../context/overview-types";
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
  reasoningEffortOptionsForPreset,
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

let registered = false;

const fullTranslationSessions = new WeakMap<
  WindowSidebarState,
  FullTranslationSession
>();
const fullTranslationHosts = new WeakMap<
  WindowSidebarState,
  FullTranslationHost
>();
const fullTranslationRequests = new WeakMap<WindowSidebarState, symbol>();
const fullTranslationModelSettingsOpen = new WeakMap<
  WindowSidebarState,
  boolean
>();
const fullTranslationNoteVisibility = new WeakMap<
  WindowSidebarState,
  boolean
>();

interface QuickAskController {
  root: HTMLElement;
  itemID: number | null;
  state: QuickAskState;
  modelSettingsOpen: boolean;
  abort?: AbortController;
}

const quickAskControllers = new WeakMap<
  WindowSidebarState,
  QuickAskController
>();
const quickAskOpenRequests = new WeakMap<WindowSidebarState, symbol>();

interface DockedSidebarLayout {
  mainWindow: Window;
  columnWidth: number;
  noteColumnWidth: number;
  dockedColumnWidth: number;
  dockedNoteColumnWidth: number;
  columnPersistence: string | null;
  noteColumnPersistence: string | null;
  columnParent: Node;
  columnNextSibling: Node | null;
  splitterDragCleanup?: () => void;
  noteSplitterDragCleanup?: () => void;
  frameCleanup?: () => void;
  titleCleanup?: () => void;
}

const dockedSidebarLayouts = new WeakMap<
  WindowSidebarState,
  DockedSidebarLayout
>();
const DOCKED_AI_SPLITTER_WIDTH = 4;
const DOCKED_NOTE_SPLITTER_WIDTH = 4;
const MIN_ZOTERO_DOCKED_CONTENT_WIDTH = 720;

interface PreparedFullTranslationRun {
  controller: AbortController;
  translator: FullDocumentTranslator;
}

let readerSelectionHandler: ((event: unknown) => void) | null = null;

function hostWindowForSidebar(sidebar: WindowSidebarState): Window | null {
  for (const win of mountedWindows) {
    if (windowSidebars.get(win) === sidebar) return win;
  }
  return null;
}

function hostWindowForMount(mount: HTMLElement): Window | null {
  const sidebar = findSidebarStateByMount(mount);
  return (
    (sidebar ? hostWindowForSidebar(sidebar) : null) ??
    mount.ownerDocument?.defaultView ??
    null
  );
}
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
      conversations: [],
      activeConversationID: "default",
      historyMode: "previous",
      editing: presets.length === 0,
      messages: [],
      historyLoaded: false,
      sending: false,
      conversationTaskRuntimes: new Map(),
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
  if (state.historyLoaded) void processNextQueuedChatTask(mount, state);
}

function renderPanel(mount: HTMLElement, state: PanelState) {
  const doc = mount.ownerDocument!;
  const sidebar = findSidebarStateByMount(mount);
  if (migrateLegacyDeepSeekMessages(state.messages)) {
    // A sidebar can render a restored conversation before the workspace-load
    // callback has finished. Migrate the visible turn as a final guard so an
    // old reasoning trace can never be painted as the answer body.
    const current = activeConversation(state);
    if (current) current.messages = state.messages;
    void persistPanelConversations(state);
  }
  capturePanelState(mount, state);
  try {
    const hostWindow = hostWindowForMount(mount);
    if (sidebar?.fullTranslationActive) {
      refreshFullTranslationSelection(sidebar, state.itemID, false);
    } else {
      refreshActiveReaderSelection(hostWindow, state.itemID, false);
    }
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
    panel.append(
      renderContextCard(
        doc,
        state.itemID,
        state.networkDiagramTarget ||
          sidebar?.overviewNav?.activeView === "network"
          ? sidebar?.networkDiagramDraftRepositoryURL
          : undefined,
      ),
    );
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
    if (state.networkDiagramTarget) {
      const messages = mount.querySelector<HTMLElement>(".messages");
      if (messages) {
        const follow =
          !!shouldScroll || state.networkDiagramAutoFollowMessages !== false;
        messages.scrollTop = follow
          ? messages.scrollHeight
          : (state.networkDiagramMessagesScrollTop ?? 0);
      }
      restoreChatInput(mount, state, !!shouldFocus);
      return;
    }
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
    if (messages.dataset.conversationKind === "network") {
      state.networkDiagramMessagesScrollTop = messages.scrollTop;
      state.networkDiagramAutoFollowMessages =
        isMessagesElementNearBottom(messages);
      return;
    }
    const lockedScroll = activeMessagesScrollLock(state);
    if (lockedScroll) {
      state.messagesScrollTop = lockedScroll.top;
      state.autoFollowMessages = lockedScroll.atBottom;
      return;
    }
    state.messagesScrollTop = messages.scrollTop;
  }
}

const compactMenuOutsideClickDocuments = new WeakSet<Document>();

function installCompactMenuOutsideClick(doc: Document): void {
  if (compactMenuOutsideClickDocuments.has(doc)) return;
  compactMenuOutsideClickDocuments.add(doc);
  doc.addEventListener(
    "click",
    (event) => {
      const target = event.target as Node | null;
      const path = event.composedPath?.() ?? [];
      const menus = Array.from(
        doc.querySelectorAll("details.zai-compact-menu[open]"),
      ) as HTMLElement[];
      const insideMenu = menus.some(
        (menu) =>
          path.includes(menu) || (target != null && menu.contains(target)),
      );
      if (insideMenu) return;

      for (const menu of menus) {
        for (const choice of menu.querySelectorAll(
          ".header-layout-choice[open]",
        )) {
          choice.removeAttribute("open");
        }
        menu.removeAttribute("open");
      }
    },
    true,
  );
}

function compactMenu(
  doc: Document,
  className: string,
  label: string,
  title: string,
): { menu: HTMLElement; content: HTMLElement } {
  installCompactMenuOutsideClick(doc);
  const menu = doc.createElement("details");
  menu.className = `zai-compact-menu ${className}`;
  menu.setAttribute("data-zai-menu-key", className);
  const summary = doc.createElement("summary");
  summary.textContent = label;
  summary.title = title;
  summary.setAttribute("aria-label", title);
  summary.addEventListener("click", (event) => {
    // Zotero's mixed XUL/XHTML documents do not consistently perform the
    // native <summary> toggle, so control the open state explicitly.
    event.preventDefault();
    if (menu.hasAttribute("open")) {
      for (const choice of menu.querySelectorAll(
        ".header-layout-choice[open]",
      )) {
        choice.removeAttribute("open");
      }
    }
    menu.toggleAttribute("open");
    if (menu.classList.contains("header-layout-menu")) {
      if (menu.hasAttribute("open")) {
        const rect = summary.getBoundingClientRect();
        const viewportWidth = doc.defaultView?.innerWidth ?? rect.right + 210;
        const menuWidth = 210;
        const left = Math.min(
          Math.max(6, rect.left),
          Math.max(6, viewportWidth - menuWidth - 6),
        );
        content.style.top = `${rect.bottom + 6}px`;
        content.style.left = `${left}px`;
      } else {
        content.style.top = "";
        content.style.left = "";
      }
    }
  });
  const content = el(doc, "div", "zai-compact-menu-content");
  menu.append(summary, content);
  return { menu, content };
}

function renderPanelPreservingOpenMenus(
  mount: HTMLElement,
  state: PanelState,
): void {
  const openMenuKeys = Array.from(
    mount.querySelectorAll("details.zai-compact-menu[open]"),
  ) as HTMLElement[];
  const menuKeys = openMenuKeys
    .map((menu) => menu.getAttribute("data-zai-menu-key"))
    .filter((key): key is string => Boolean(key));
  renderPanel(mount, state);
  for (const menu of mount.querySelectorAll("details.zai-compact-menu")) {
    if (menuKeys.includes(menu.getAttribute("data-zai-menu-key") ?? "")) {
      menu.setAttribute("open", "");
    }
  }
}

function applySidebarDisplayMode(
  mount: HTMLElement,
  state: PanelState,
  selectedMode: unknown,
): void {
  const previousMode = state.localUiSettings.sidebarDisplayMode;
  const next = normalizeLocalUiSettings({
    ...state.localUiSettings,
    sidebarDisplayMode: selectedMode,
  });
  state.localUiSettings = next;
  saveLocalUiSettings(zoteroPrefs(), next);

  const sidebar = findSidebarStateByMount(mount);
  const hostWindow = hostWindowForMount(mount);
  if (sidebar && hostWindow) {
    reconcileSidebarDisplayMode(hostWindow, sidebar, next, previousMode);
  }
  renderPanelPreservingOpenMenus(mount, state);
}

function renderLayoutChoice(
  doc: Document,
  selectedValue: string,
  choices: ReadonlyArray<readonly [string, string]>,
  onSelect: (value: string) => void,
): HTMLElement {
  const control = el(doc, "div", "header-layout-choice");
  const selectedLabel =
    choices.find(([value]) => value === selectedValue)?.[1] ?? choices[0]?.[1];
  const trigger = buttonEl(doc, selectedLabel ?? "");
  trigger.className = "header-layout-choice-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", () => {
    const opening = !control.hasAttribute("open");
    for (const sibling of control.parentElement?.querySelectorAll(
      ".header-layout-choice[open]",
    ) ?? []) {
      sibling.removeAttribute("open");
      sibling
        .querySelector(".header-layout-choice-trigger")
        ?.setAttribute("aria-expanded", "false");
    }
    control.toggleAttribute("open", opening);
    trigger.setAttribute("aria-expanded", opening ? "true" : "false");
  });

  const options = el(doc, "div", "header-layout-choice-options");
  options.setAttribute("role", "listbox");
  for (const [value, label] of choices) {
    const option = buttonEl(doc, label);
    option.className = "header-layout-choice-option";
    option.setAttribute("role", "option");
    option.setAttribute(
      "aria-selected",
      value === selectedValue ? "true" : "false",
    );
    option.classList.toggle("active", value === selectedValue);
    option.addEventListener("click", () => onSelect(value));
    options.append(option);
  }
  control.append(trigger, options);
  return control;
}

function renderLayoutMenu(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const { menu, content } = compactMenu(
    doc,
    "header-layout-menu",
    "模式",
    "切换对话排版和侧栏显示方式",
  );
  const layoutField = el(doc, "div", "header-layout-field");
  layoutField.append(el(doc, "span", "", "对话排版"));
  layoutField.append(
    renderLayoutChoice(
      doc,
      state.localUiSettings.chatLayout,
      [
        ["classic", "原始排版"],
        ["compact", "专注模式"],
      ],
      (value) => {
        const next = normalizeLocalUiSettings({
          ...state.localUiSettings,
          chatLayout: value,
        });
        state.localUiSettings = next;
        saveLocalUiSettings(zoteroPrefs(), next);
        renderPanelPreservingOpenMenus(mount, state);
      },
    ),
  );

  const displayField = el(doc, "div", "header-layout-field");
  displayField.append(el(doc, "span", "", "显示方式"));
  displayField.append(
    renderLayoutChoice(
      doc,
      state.localUiSettings.sidebarDisplayMode,
      [
        ["embedded", "阅读器侧栏"],
        ["docked", "右侧并排"],
      ],
      (value) => applySidebarDisplayMode(mount, state, value),
    ),
  );
  content.append(layoutField, displayField);
  return menu;
}

function renderToolbar(doc: Document, mount: HTMLElement, state: PanelState) {
  const sidebar = findSidebarStateByMount(mount);
  const toolbarPresets = configuredPresets(state);
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
  const layoutMenu = renderLayoutMenu(doc, mount, state);

  if (toolbarPresets.length === 0) {
    topRow.append(el(doc, "span", "", "未配置模型"));
    const button = buttonEl(doc, "添加模型");
    button.addEventListener("click", () => {
      openAddonPreferences(doc);
    });
    bottomRow.append(button, layoutMenu);
    bar.append(topRow, bottomRow);
    return bar;
  }

  const copyAll = buttonEl(doc, "复制MD");
  copyAll.disabled = state.messages.length === 0;
  copyAll.title = copyAll.disabled
    ? "当前对话还没有可复制的消息"
    : state.copyDebugContext
      ? "复制当前对话为 Markdown（含工具上下文和 PDF 片段）"
      : "复制当前对话为 Markdown（只含论文介绍和对话）";
  copyAll.addEventListener("click", () => {
    void copyCurrentConversation(doc, state, copyAll);
  });
  const clear = buttonEl(doc, "清空");
  const visibleMessageCount = state.networkDiagramTarget
    ? (sidebar?.networkDiagramMessages?.length ?? 0)
    : state.messages.length;
  const visibleConversationBusy = state.networkDiagramTarget
    ? sidebar?.networkDiagramBusy === true
    : conversationIsSending(state, state.activeConversationID);
  clear.disabled = visibleConversationBusy || visibleMessageCount === 0;
  clear.title = visibleConversationBusy
    ? state.networkDiagramTarget
      ? "请先停止网络图分析，再清空网络图对话"
      : "请先停止当前回答，再清空对话"
    : visibleMessageCount === 0
      ? "当前对话还没有可清空的消息"
      : state.networkDiagramTarget
        ? "只清空网络图对话；保留网络图、版本和仓库关联"
        : "清空当前对话的全部消息";
  clear.addEventListener("click", () => {
    if (state.networkDiagramTarget) {
      if (
        doc.defaultView?.confirm &&
        !doc.defaultView.confirm(
          "确定清空当前网络图对话吗？网络图、版本记录、代码证据和 GitHub 仓库关联都会保留。",
        )
      ) {
        return;
      }
      if (sidebar) void clearNetworkDiagramConversation(sidebar, state);
      return;
    }
    state.messages = [];
    void persistPanelConversations(state);
    renderPanel(mount, state);
  });
  const settings = buttonEl(doc, "设置");
  settings.addEventListener("click", () => {
    openAddonPreferences(doc);
  });
  // Panel chrome (collapse this column) lives at the header's top-right corner,
  // not among the content-action buttons.
  const collapse = buttonEl(doc, "»");
  collapse.className = "zai-collapse-btn";
  collapse.title = "隐藏 AI 对话列（收起面板）";
  collapse.addEventListener("click", () => hideCurrentSidebar(mount));
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
  const win = hostWindowForMount(mount)!;
  const translateBtn = buttonEl(doc, "译");
  translateBtn.className = "zai-sidebar-translate-button";
  translateBtn.title = "逐句翻译模式（点击切换开关）";
  syncTranslateBtnState(win, translateBtn);
  translateBtn.addEventListener("click", () => {
    void toggleTranslateMode(win, translateBtn);
  });
  const askBtn = buttonEl(doc, "沉浸");
  askBtn.className = "zai-sidebar-ask-button";
  askBtn.title = `沉浸式阅读（快捷键：${getImmersiveModeShortcut(zoteroPrefs())}）：单击句子高亮，旁边弹出 [✦ 问 AI] / [译] 选择（点击切换开关）`;
  syncAskBtnState(win, askBtn);
  askBtn.addEventListener("click", () => {
    void toggleAskMode(win, askBtn);
  });
  // Content actions, then 设置 (opens full preferences), the 字号 menu (🎚 icon
  // → font-size popup) and the 调试 (copy-debug context) toggle.
  settings.title = "打开 AI 对话完整设置";
  if (state.localUiSettings.chatLayout === "compact") {
    const { menu, content: menuContent } = compactMenu(
      doc,
      "header-actions-menu",
      "⋯",
      "更多对话功能",
    );
    menuContent.append(
      copyAll,
      clear,
      settings,
      renderFontIconMenu(doc, mount, state),
      renderCopyDebugToggle(doc, mount, state),
    );
    // 「译」独立快捷翻译按钮暂时隐藏（功能代码保留）。
    // menuContent.append(translateBtn);
    bottomRow.append(openNote, layoutMenu, askBtn, menu, collapse);
    bar.append(bottomRow);
  } else {
    bottomRow.append(
      openNote,
      layoutMenu,
      askBtn,
      settings,
      renderFontIconMenu(doc, mount, state),
      renderCopyDebugToggle(doc, mount, state),
      collapse,
    );
    // 「译」独立快捷翻译按钮暂时隐藏（功能代码保留）。
    // bottomRow.append(translateBtn);
    bar.append(bottomRow);
  }
  return bar;
}

async function clearNetworkDiagramConversation(
  sidebar: WindowSidebarState,
  state: PanelState,
): Promise<void> {
  if (sidebar.networkDiagramBusy) return;
  const itemKey = resolveItemKeyForCache(state.itemID);
  if (!itemKey) return;
  const stored = await loadNetworkDiagramWorkspace(itemKey);
  if (stored?.workspace) {
    await saveNetworkDiagramWorkspace(
      itemKey,
      clearNetworkDiagramMessages(stored.workspace),
    );
  }
  sidebar.networkDiagramMessages = [];
  state.networkDiagramMessagesScrollTop = 0;
  state.networkDiagramAutoFollowMessages = true;
  renderPanel(sidebar.mount, state);
}

function renderConversationSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const conversationBusy = conversationIsSending(
    state,
    state.activeConversationID,
  );
  const wrap = el(doc, "div", "conversation-switcher");
  const tabs = el(doc, "div", "conversation-tabs");
  const copyAll = buttonEl(doc, "⧉");
  copyAll.className = "conversation-action conversation-copy";
  copyAll.setAttribute("aria-label", "复制 Markdown");
  copyAll.disabled = state.messages.length === 0;
  copyAll.title = "复制当前对话为 Markdown";
  copyAll.addEventListener("click", () => {
    void copyCurrentConversation(doc, state, copyAll);
  });
  const clear = buttonEl(doc, "⌫");
  clear.className = "conversation-action conversation-clear";
  clear.setAttribute("aria-label", "清空当前对话");
  const sidebar = findSidebarStateByMount(mount);
  const visibleMessageCount = state.networkDiagramTarget
    ? (sidebar?.networkDiagramMessages?.length ?? 0)
    : state.messages.length;
  const visibleConversationBusy = state.networkDiagramTarget
    ? sidebar?.networkDiagramBusy === true
    : conversationBusy;
  clear.disabled = visibleConversationBusy || visibleMessageCount === 0;
  clear.title = visibleConversationBusy ? "请先停止当前回答" : "清空当前对话";
  clear.addEventListener("click", () => {
    if (state.networkDiagramTarget) {
      if (
        doc.defaultView?.confirm &&
        !doc.defaultView.confirm("确定清空当前网络图对话吗？")
      )
        return;
      if (sidebar) void clearNetworkDiagramConversation(sidebar, state);
      return;
    }
    state.messages = [];
    void persistPanelConversations(state);
    renderPanel(mount, state);
  });
  if (!state.historyLoaded) {
    tabs.append(el(doc, "span", "conversation-loading", "正在载入对话…"));
  } else {
    for (const [index, conversation] of state.conversations.entries()) {
      const tab = buttonEl(doc, String(index + 1));
      tab.className = "conversation-tab";
      tab.title = `${index + 1}. ${conversation.title}`;
      tab.setAttribute("aria-label", `切换到${conversation.title}`);
      if (conversation.branchOrigin) {
        const sourceTitle = conversation.branchOrigin.sourceConversationTitle;
        tab.classList.add("has-branch-origin");
        tab.title += ` · 分支自${sourceTitle}`;
        tab.setAttribute(
          "aria-label",
          `切换到${conversation.title}，分支自${sourceTitle}`,
        );
        tab.append(
          el(
            doc,
            "span",
            "conversation-tab-branch-origin",
            `↳${branchOriginConversationLabel(sourceTitle)}`,
          ),
        );
      }
      tab.disabled = !state.historyLoaded;
      if (conversation.id === state.activeConversationID) {
        tab.classList.add("is-active");
        tab.setAttribute("aria-current", "page");
      }
      if (conversationIsSending(state, conversation.id)) {
        tab.classList.add("is-running");
        tab.title += " · 回答中";
        tab.append(el(doc, "span", "conversation-tab-running", "●"));
      } else if (
        conversation.id !== state.activeConversationID &&
        conversationHasUnreadAnswer(conversation)
      ) {
        tab.classList.add("has-unread");
        tab.title += " · 回答完成，尚未查看";
        tab.append(el(doc, "span", "conversation-tab-unread", "●"));
      }
      tab.addEventListener("click", () => {
        switchConversation(mount, state, conversation.id);
      });
      tabs.append(tab);
    }
  }

  const add = buttonEl(doc, "+");
  add.className = "conversation-icon conversation-add";
  add.title = "新建独立对话（默认不携带历史）";
  add.setAttribute("aria-label", "新建独立对话");
  add.disabled = !state.historyLoaded;
  add.addEventListener("click", () => addConversation(mount, state));

  const historyLabel = el(doc, "label", "conversation-history-control");
  const historySelect = doc.createElement("select");
  const historyOptions: Array<[ConversationHistoryMode, string]> = [
    ["none", "无"],
    ["previous", "1轮"],
    ["all", "全部"],
  ];
  const historyTooltips: Record<ConversationHistoryMode, string> = {
    none: "只发送当前问题，不向模型发送此前问答；界面中的消息仍会保留。",
    previous:
      "向模型附带上一轮用户提问和 AI 回答，帮助延续上下文；更早的消息不会发送。",
    all: "向模型附带当前对话的全部历史消息；界面中的消息不会删除。",
  };
  for (const [value, label] of historyOptions) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    historySelect.append(option);
  }
  historySelect.value = state.historyMode;
  historySelect.disabled = conversationBusy || !state.historyLoaded;
  const updateHistoryTooltip = () => {
    const tooltip = historyTooltips[state.historyMode];
    historyLabel.title = tooltip;
    historyLabel.setAttribute("tooltiptext", tooltip);
    historySelect.title = tooltip;
    historySelect.setAttribute("tooltiptext", tooltip);
  };
  updateHistoryTooltip();
  historySelect.setAttribute("aria-label", "发送历史范围");
  historySelect.addEventListener("change", () => {
    state.historyMode = normalizeConversationHistoryMode(historySelect.value);
    updateHistoryTooltip();
    void persistPanelConversations(state);
  });
  historyLabel.append(historySelect);

  const remove = buttonEl(doc, "×");
  remove.className = "conversation-icon conversation-delete";
  remove.setAttribute("aria-label", "删除当前对话");
  const defaultConversationActive = activeConversation(state)?.id === "default";
  remove.disabled =
    conversationBusy ||
    !state.historyLoaded ||
    defaultConversationActive ||
    state.conversations.length <= 1;
  remove.title = defaultConversationActive
    ? "默认对话不能删除"
    : state.conversations.length <= 1
      ? "至少保留一个对话"
      : "删除当前对话";
  remove.addEventListener("click", () =>
    deleteActiveConversation(mount, state),
  );
  if (state.localUiSettings.chatLayout === "compact") {
    const quickPrompts = renderQuickPrompts(doc, mount, state);
    const { menu, content: menuContent } = compactMenu(
      doc,
      "conversation-actions-menu",
      "⋯",
      "快捷提示",
    );
    menuContent.append(quickPrompts);
    const controls = el(doc, "div", "conversation-controls");
    historyLabel.prepend(
      el(doc, "span", "conversation-history-label", "上下文"),
    );
    controls.append(historyLabel, add, remove, copyAll, clear, menu);
    wrap.append(tabs, controls);
  } else {
    const controls = el(doc, "div", "conversation-controls");
    controls.append(historyLabel, add, remove, copyAll, clear);
    wrap.append(tabs, controls);
  }
  return wrap;
}

function branchOriginConversationLabel(title: string): string {
  return /^对话\s*(\d+)$/.exec(title)?.[1] ?? "源";
}

function conversationHasUnreadAnswer(conversation: ChatConversation): boolean {
  return conversation.messages.some(
    (message) =>
      message.role === "user" &&
      !!message.task?.completedAt &&
      !message.task.viewedAt &&
      !message.task.cancelledAt &&
      !message.task.error,
  );
}

async function copyCurrentConversation(
  doc: Document,
  state: PanelState,
  button: HTMLButtonElement,
): Promise<void> {
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
  flashButton(button, "已复制");
}

function switchConversation(
  mount: HTMLElement,
  state: PanelState,
  conversationID: string,
): void {
  if (!state.historyLoaded || conversationID === state.activeConversationID) {
    return;
  }
  capturePanelState(mount, state);
  captureActiveConversation(state);
  const conversation = state.conversations.find(
    (candidate) => candidate.id === conversationID,
  );
  if (!conversation) return;
  state.activeConversationID = conversationID;
  applyConversation(state, conversation);
  markAllChatTasksRead(state);
  void persistPanelConversations(state);
  renderPanel(mount, state);
}

function addConversation(mount: HTMLElement, state: PanelState): void {
  if (!state.historyLoaded) return;
  capturePanelState(mount, state);
  captureActiveConversation(state);
  const now = new Date().toISOString();
  const conversation = createChatConversation(
    `conversation-${Date.now()}-${Zotero.Utilities.randomString(6)}`,
    nextConversationTitle(state.conversations),
    state.selectedId ?? undefined,
    now,
  );
  state.conversations.push(conversation);
  state.activeConversationID = conversation.id;
  applyConversation(state, conversation);
  void persistPanelConversations(state);
  renderPanel(mount, state);
}

function branchConversationFromMessage(
  mount: HTMLElement,
  state: PanelState,
  messageIndex: number,
): void {
  if (
    conversationIsSending(state, state.activeConversationID) ||
    !state.historyLoaded
  )
    return;
  capturePanelState(mount, state);
  captureActiveConversation(state);
  const source = activeConversation(state);
  if (!source || !source.messages[messageIndex]) return;
  const now = new Date().toISOString();
  const conversation = createBranchedConversation(
    source,
    messageIndex,
    `conversation-${Date.now()}-${Zotero.Utilities.randomString(6)}`,
    nextConversationTitle(state.conversations),
    now,
  );
  state.conversations.push(conversation);
  state.activeConversationID = conversation.id;
  applyConversation(state, conversation);
  void persistPanelConversations(state);
  renderPanel(mount, state);
}

function deleteActiveConversation(mount: HTMLElement, state: PanelState): void {
  if (
    conversationIsSending(state, state.activeConversationID) ||
    state.conversations.length <= 1
  ) {
    return;
  }
  const current = activeConversation(state);
  if (!current || current.id === "default") return;
  if (state.uiSettings.confirmConversationDeletion) {
    const confirmed = mount.ownerDocument?.defaultView?.confirm(
      `删除“${current.title}”及其中的全部消息？`,
    );
    if (!confirmed) return;
  }
  const currentIndex = state.conversations.indexOf(current);
  clearAffectedBranchOriginsAfterDeletion(state.conversations, current.id);
  state.conversations = state.conversations.filter(
    (conversation) => conversation.id !== current.id,
  );
  const next =
    state.conversations[currentIndex] ?? state.conversations[currentIndex - 1];
  state.activeConversationID = next.id;
  applyConversation(state, next);
  void persistPanelConversations(state);
  renderPanel(mount, state);
}

function nextConversationTitle(conversations: ChatConversation[]): string {
  const existing = new Set(
    conversations.map((conversation) => conversation.title),
  );
  let index = conversations.length + 1;
  while (existing.has(`对话 ${index}`)) index += 1;
  return `对话 ${index}`;
}

function activeConversation(state: PanelState): ChatConversation | null {
  return (
    state.conversations.find(
      (conversation) => conversation.id === state.activeConversationID,
    ) ?? null
  );
}

function captureActiveConversation(state: PanelState): void {
  const current = activeConversation(state);
  if (!current) return;
  current.updatedAt = new Date().toISOString();
  current.messages = state.messages;
  current.draftText = state.draftText;
  current.historyMode = state.historyMode;
  if (state.selectedId) current.presetID = state.selectedId;
  else delete current.presetID;
}

function applyConversation(
  state: PanelState,
  conversation: ChatConversation,
): void {
  state.messages = conversation.messages;
  state.draftText = conversation.draftText;
  // The current DOM still belongs to the conversation being left. The next
  // render must not copy that textarea back over the newly restored draft.
  state.skipNextDraftCapture = true;
  state.draftSelectionStart = conversation.draftText.length;
  state.draftSelectionEnd = conversation.draftText.length;
  state.draftHadFocus = false;
  state.historyMode = conversation.historyMode;
  if (
    conversation.presetID &&
    state.presets.some((preset) => preset.id === conversation.presetID)
  ) {
    state.selectedId = conversation.presetID;
  } else if (
    !state.selectedId ||
    !state.presets.some((preset) => preset.id === state.selectedId)
  ) {
    state.selectedId =
      configuredPresets(state)[0]?.id ?? state.presets[0]?.id ?? null;
  }
  state.agentPermissionMode = agentPermissionMode(
    selectedChatPreset(state) ?? selectedPreset(state),
  );
  state.pasteBlocks = [];
  state.draftImages = [];
  state.messagesScrollTop = 0;
  state.autoFollowMessages = true;
  state.scrollToBottom = true;
  state.queueOpen = false;
  resetComposerPromptHistory(state);
}

function persistPanelConversations(state: PanelState): Promise<void> {
  captureActiveConversation(state);
  return saveChatConversations(state.itemID, {
    activeConversationID: state.activeConversationID,
    conversations: state.conversations,
  });
}

function normalizeConversationHistoryMode(
  value: string,
): ConversationHistoryMode {
  return value === "none" || value === "all" ? value : "previous";
}

function scheduleDraftConversationSave(
  mount: HTMLElement,
  state: PanelState,
): void {
  const win = mount.ownerDocument?.defaultView;
  if (!win || !state.historyLoaded) return;
  if (state.draftSaveTimer != null) win.clearTimeout(state.draftSaveTimer);
  state.draftSaveTimer = win.setTimeout(() => {
    state.draftSaveTimer = undefined;
    if (states.get(mount) === state) void persistPanelConversations(state);
  }, 400);
}

const ZAI_SVG_NS = "http://www.w3.org/2000/svg";

// 字号 collapsed behind a slider (🎚) icon button: clicking opens a small popup
// with the font-size selector, keeping the toolbar compact.
function renderFontIconMenu(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const wrap = el(doc, "span", "zai-icon-menu");
  const btn = buttonEl(doc, "");
  btn.className = "zai-icon-btn";
  btn.title = "字号";
  btn.append(sliderIcon(doc));
  const panel = el(doc, "div", "zai-icon-menu-panel");
  panel.style.display = "none";
  panel.append(renderChatFontSizeControl(doc, mount, state));
  wrap.append(btn, panel);
  let isOpen = false;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isOpen) {
      isOpen = false;
      panel.style.display = "none";
      return;
    }
    isOpen = true;
    const w = doc.defaultView;
    const rect = btn.getBoundingClientRect();
    const vw = w?.innerWidth ?? rect.right;
    panel.style.top = `${Math.round(rect.bottom + 4)}px`;
    panel.style.left = `${Math.round(Math.max(8, Math.min(rect.left, vw - 220)))}px`;
    panel.style.display = "block";
  });
  return wrap;
}

// Two-row slider glyph (matches the toolbar's accent color via currentColor).
function sliderIcon(doc: Document): Element {
  const svg = doc.createElementNS(ZAI_SVG_NS, "svg");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  const line = (x1: string, y: string, x2: string): void => {
    const node = doc.createElementNS(ZAI_SVG_NS, "line");
    node.setAttribute("x1", x1);
    node.setAttribute("y1", y);
    node.setAttribute("x2", x2);
    node.setAttribute("y2", y);
    svg.append(node);
  };
  const knob = (cx: string, cy: string): void => {
    const node = doc.createElementNS(ZAI_SVG_NS, "circle");
    node.setAttribute("cx", cx);
    node.setAttribute("cy", cy);
    node.setAttribute("r", "2.4");
    node.setAttribute("fill", "var(--zai-panel, #fffdf8)");
    svg.append(node);
  };
  line("4", "7", "20");
  knob("9", "7");
  line("4", "14", "20");
  knob("15", "14");
  return svg;
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
    renderPanelPreservingOpenMenus(mount, state);
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
    const previousDisplayMode = state.localUiSettings.sidebarDisplayMode;
    state.localUiSettings = loadLocalUiSettings(zoteroPrefs());
    reconcileSidebarDisplayMode(
      win,
      sidebar,
      state.localUiSettings,
      previousDisplayMode,
    );
    renderPanel(sidebar.mount, state);
    void processNextQueuedChatTask(sidebar.mount, state);
  }
}

/** Return the active AI-dialog account without changing sidebar state. */
export function getActiveSidebarPresetId(): string | null {
  for (const win of Zotero.getMainWindows()) {
    const sidebar = windowSidebars.get(win);
    const state = sidebar ? states.get(sidebar.mount) : undefined;
    if (state) return selectedChatPreset(state)?.id ?? state.selectedId;
  }
  return null;
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

export function renderContextCard(
  doc: Document,
  itemID: number | null,
  repositoryURL?: string,
) {
  const item = safeGetItem(itemID);
  const title =
    item && typeof item.getField === "function"
      ? item.getField("title") || "未选择条目"
      : "未选择条目";
  const card = el(doc, "div", "ctx-card");
  const metaRow = el(doc, "div", "ctx-meta");
  const canonicalRepositoryURL = (() => {
    if (!repositoryURL?.trim()) return undefined;
    try {
      const { owner, repo } = parsePublicGitHubRepositoryURL(repositoryURL);
      return {
        url: `https://github.com/${owner}/${repo}`,
        label: `GitHub：${owner}/${repo}`,
      };
    } catch {
      return undefined;
    }
  })();
  if (canonicalRepositoryURL) {
    const repository = doc.createElement("a");
    repository.className = "ctx-github-repository";
    repository.href = canonicalRepositoryURL.url;
    repository.target = "_blank";
    repository.rel = "noreferrer";
    repository.textContent = canonicalRepositoryURL.label;
    repository.title = canonicalRepositoryURL.url;
    metaRow.append(repository);
  }
  metaRow.append(
    el(doc, "span", "ctx-item-id", `Item ID: ${itemID ?? "none"}`),
  );
  card.append(el(doc, "div", "ctx-title", title), metaRow);
  const arxivId = resolveArxivIdForItemID(itemID);
  if (arxivId) {
    const arxivBadge = doc.createElement("span");
    arxivBadge.className = "arxiv-source-badge";
    arxivBadge.textContent = "正在检查 LaTeX…";
    metaRow.append(arxivBadge);
    void checkLatexSourceAvailability(arxivId).then((availability) => {
      const sidebar = findSidebarStateByDocument(doc);
      const currentItemID = sidebar
        ? (states.get(sidebar.mount)?.itemID ?? null)
        : null;
      if (!metaRow.isConnected || currentItemID !== itemID) return;
      if (availability === "no-source") {
        arxivBadge.textContent = "无 LaTeX 源";
        arxivBadge.title = "当前 arXiv 条目没有可用的 LaTeX 源码";
        return;
      }
      if (availability === "error") {
        arxivBadge.textContent = "LaTeX 检查失败";
        arxivBadge.title = "无法检查 arXiv LaTeX 源码，请稍后重试";
        return;
      }
      arxivBadge.textContent = "LaTeX 源";
      arxivBadge.title = "正在使用 arXiv LaTeX 源码分析（公式精确）";
      const translateButton = doc.createElement("button");
      translateButton.type = "button";
      translateButton.className = "arxiv-full-translation-button";
      translateButton.textContent = "全文翻译";
      translateButton.title = "用 LaTeX 重建原文与中文译文并进行结构对照";
      translateButton.addEventListener("click", () => {
        const sidebar = findSidebarStateByDocument(doc);
        if (sidebar) void showFullTranslation(sidebar);
      });
      metaRow.append(translateButton);
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
    state.localUiSettings.chatSendMode === "web",
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
    button.disabled =
      conversationIsSending(state, state.activeConversationID) || disabled;
    if (disabled && disabledTitle) button.title = disabledTitle;
    button.addEventListener("click", () => {
      if (state.localUiSettings.chatSendMode === "web") {
        void sendWebPromptMessage(
          mount,
          state,
          prompt,
          state.localUiSettings.webPromptProvider,
          {
            explainSelection,
            annotationBatch: fullTextHighlight,
            taskTitle: label,
          },
        );
        return;
      }
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
      button.disabled = conversationIsSending(
        state,
        state.activeConversationID,
      );
      button.title = custom.shortcut
        ? `自定义提示词按钮；PDF 中按 ${custom.shortcut.toUpperCase()} 触发`
        : "自定义提示词按钮";
      button.addEventListener("click", () => {
        if (state.localUiSettings.chatSendMode === "web") {
          void sendWebPromptMessage(
            mount,
            state,
            custom.prompt,
            state.localUiSettings.webPromptProvider,
          );
          return;
        }
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
    void persistPanelConversations(state);
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
    void persistPanelConversations(state);
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
    void persistPanelConversations(state);
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
    cancel.disabled =
      conversationRuntime(state, state.activeConversationID)
        .cancellingTaskID === view.task.id;
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
  if (
    conversationRuntime(state, state.activeConversationID).activeTaskID ===
    task.id
  )
    return "running";
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
  void persistPanelConversations(state);
  state.queueOpen = true;
}

function cancelChatTask(
  mount: HTMLElement,
  state: PanelState,
  view: ChatTaskView,
) {
  if (view.status === "queued") {
    markMessageTaskCancelled(state.messages[view.userIndex]);
    void persistPanelConversations(state);
    renderPanel(mount, state);
    void processNextQueuedChatTask(mount, state);
    return;
  }
  const runtime = conversationRuntime(state, state.activeConversationID);
  if (runtime.activeTaskID !== view.task.id) return;
  view.task.cancelledAt = Date.now();
  view.task.completedAt ??= view.task.cancelledAt;
  runtime.cancellingTaskID = view.task.id;
  runtime.abort?.abort();
  void persistPanelConversations(state);
  renderPanel(mount, state);
}

function cancelActiveChatTask(mount: HTMLElement, state: PanelState) {
  const active = visibleChatTasks(state).find(
    (view) =>
      view.task.id ===
      conversationRuntime(state, state.activeConversationID).activeTaskID,
  );
  if (active) {
    cancelChatTask(mount, state, active);
    return;
  }
  conversationRuntime(state, state.activeConversationID).abort?.abort();
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
  } else if (
    state.localUiSettings.chatSendMode === "web" &&
    webPromptTaskPending(state)
  ) {
    void cancelPendingWebPromptTask(mount, state);
  } else if (conversationIsSending(state, state.activeConversationID)) {
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
  void persistPanelConversations(state);
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
  const win = hostWindowForMount(mount);
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
      setReaderTextLayerSelection(view, scopedRanges, locator.selectedText);
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

function fullTextHighlightDisabledReason(
  win: Window | null,
  state: PanelState,
  preset: ModelPreset | null,
  webMode = false,
): string {
  if (webMode) {
    return getActiveReaderForItem(win, state.itemID)
      ? ""
      : "请先在 Reader 中打开此 PDF，以便本地定位标注原文";
  }
  if (!preset) return "请先配置并选择一个 OpenAI 模型";
  if (preset.provider !== "openai") return "全文重点 v1 仅支持 OpenAI 工具循环";
  if (state.agentPermissionMode !== "yolo")
    return "批量写注释需要先开启 YOLO 模式";
  if (!getActiveReaderForItem(win, state.itemID))
    return "请先在 Reader 中打开此 PDF";
  return "";
}

function renderMessages(doc: Document, mount: HTMLElement, state: PanelState) {
  if (migrateLegacyDeepSeekMessages(state.messages)) {
    const current = activeConversation(state);
    if (current) current.messages = state.messages;
    void persistPanelConversations(state);
  }
  const restoredWebBatches = migrateRestoredWebAnnotationBatches(
    state.messages,
  );
  if (restoredWebBatches.length) {
    void persistPanelConversations(state);
    for (const message of restoredWebBatches) {
      void locateWebAnnotationBatch(mount, state, message);
    }
  }
  const messages = el(doc, "div", "messages");
  const sidebar = findSidebarStateByMount(mount);
  messages.dataset.conversationKind = state.networkDiagramTarget
    ? "network"
    : "normal";
  messages.addEventListener("scroll", () => {
    if (state.networkDiagramTarget) {
      state.networkDiagramMessagesScrollTop = messages.scrollTop;
      state.networkDiagramAutoFollowMessages =
        isMessagesElementNearBottom(messages);
      return;
    }
    const lockedScroll = activeMessagesScrollLock(state);
    if (lockedScroll) {
      scheduleMessagesScrollRestore(mount, lockedScroll);
      return;
    }
    state.messagesScrollTop = messages.scrollTop;
    state.autoFollowMessages = isMessagesElementNearBottom(messages);
  });
  if (state.networkDiagramTarget) {
    const networkMessages = sidebar?.networkDiagramMessages ?? [];
    if (networkMessages.length === 0) {
      const hint = el(doc, "div", "bubble bubble-assistant bubble-hint");
      hint.append(
        el(doc, "div", "bubble-role", "AI"),
        el(
          doc,
          "div",
          "bubble-body",
          "这是独立的网络图对话。可直接描述要展开、简化或校正的节点。",
        ),
      );
      messages.append(hint);
    } else {
      networkMessages.forEach((message) =>
        messages.append(renderNetworkDiagramMessage(doc, message)),
      );
    }
  } else if (state.messages.length === 0) {
    messages.classList.add("messages-empty");
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
    if (state.uiSettings.assistantSignaturesEnabled) {
      const signatures = renderEmptySignatures(
        doc,
        state.uiSettings.assistantSignatures,
        () => {
          state.uiSettings = {
            ...state.uiSettings,
            assistantSignaturesEnabled: false,
          };
          saveUiSettings(zoteroPrefs(), state.uiSettings);
          messages.querySelector(".empty-signatures")?.remove();
        },
      );
      if (signatures) messages.append(signatures);
    }
  } else {
    state.messages.forEach((message, index) =>
      messages.append(bubble(doc, mount, state, message, index)),
    );
    const branchOrigin = activeConversation(state)?.branchOrigin;
    if (branchOrigin) {
      messages.append(renderConversationBranchOrigin(doc, branchOrigin));
    }
  }

  const taskMatchesItem =
    sidebar?.networkDiagramItemKey ===
    (resolveItemKeyForCache(state.itemID) ?? undefined);
  if (
    sidebar &&
    state.networkDiagramTarget &&
    taskMatchesItem &&
    (sidebar.networkDiagramProgress ||
      sidebar.networkDiagramBusy ||
      sidebar.networkDiagramError)
  ) {
    messages.append(
      renderNetworkDiagramAnalysisCard(
        doc,
        {
          progress: sidebar.networkDiagramProgress ?? null,
          busy: sidebar.networkDiagramBusy === true,
          error: sidebar.networkDiagramError,
        },
        { onCancel: () => cancelNetworkDiagramAnalysis(sidebar) },
      ),
    );
  }
  return messages;
}

function renderConversationBranchOrigin(
  doc: Document,
  origin: NonNullable<ChatConversation["branchOrigin"]>,
): HTMLElement {
  const marker = el(doc, "div", "conversation-branch-origin");
  marker.title = `来自${origin.sourceConversationTitle}`;
  marker.append(
    el(
      doc,
      "span",
      "conversation-branch-origin-label",
      `从“${origin.messagePreview}”建立的分支`,
    ),
  );
  return marker;
}

function renderNetworkDiagramMessage(
  doc: Document,
  message: NetworkDiagramMessage,
): HTMLElement {
  const item = el(
    doc,
    "div",
    `bubble bubble-${message.role} network-diagram-conversation-message`,
  );
  item.append(
    el(
      doc,
      "div",
      "bubble-role",
      message.role === "user" ? "YOU · 网络图指令" : "AI · 网络图结果",
    ),
    el(doc, "div", "bubble-body", message.content),
  );
  return item;
}

function renderNetworkDiagramTargetChip(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement | null {
  if (!state.networkDiagramTarget) return null;
  const sidebar = findSidebarStateByMount(mount);
  const chip = el(doc, "div", "network-diagram-target-chip");
  chip.append(el(doc, "span", "network-diagram-target-label", "📐 网络图"));

  const repositoryURL = sidebar?.networkDiagramDraftRepositoryURL?.trim();
  if (repositoryURL) {
    const repository = doc.createElement("a");
    repository.className = "network-diagram-target-repository";
    repository.href = repositoryURL;
    repository.target = "_blank";
    repository.rel = "noreferrer";
    repository.textContent = repositoryURL.replace(
      /^https:\/\/github\.com\//i,
      "GitHub：",
    );
    repository.title = repositoryURL;
    chip.append(repository);
  }

  const generate = buttonEl(doc, "生成网络图");
  generate.className = "network-diagram-official-prompt";
  generate.disabled = sidebar?.networkDiagramBusy === true;
  generate.title = "填入官方网络图生成提示词，确认后再发送";
  generate.addEventListener("click", () => {
    state.draftText = networkDiagramOfficialPrompt(sidebar);
    state.draftSelectionStart = state.draftText.length;
    state.draftSelectionEnd = state.draftText.length;
    state.skipNextDraftCapture = true;
    state.focusInput = true;
    renderPanel(mount, state);
  });
  chip.append(generate);

  if (sidebar?.networkDiagramSelectedNode) {
    const selected = el(
      doc,
      "span",
      "network-diagram-selected-node",
      `当前节点：${sidebar.networkDiagramSelectedNode.label}`,
    );
    selected.title = "后续指令会自动携带此节点的 shape、说明和代码依据";
    chip.append(selected);
  }

  const close = buttonEl(doc, "×");
  close.className = "network-diagram-target-close";
  close.title = "退出网络图对话，恢复普通对话草稿";
  close.addEventListener("click", () => {
    deactivateNetworkDiagramTarget(mount, state);
  });
  chip.append(close);
  return chip;
}

function renderInput(doc: Document, mount: HTMLElement, state: PanelState) {
  const composer = el(doc, "div", "composer");
  const row = el(doc, "div", "input-row");
  if (state.localUiSettings.chatLayout === "compact") {
    row.classList.add("input-row-compact");
  }
  const input = doc.createElement("textarea");
  input.rows = 3;
  const status = el(doc, "div", "composer-status");

  const preset = selectedChatPreset(state);
  const webPromptTarget = state.localUiSettings.chatSendMode === "web";
  const sidebar = findSidebarStateByMount(mount);
  const networkDiagramBusy = sidebar?.networkDiagramBusy === true;
  const queueAllowed = queueWhileSendingEnabled(state);
  const conversationSending = conversationIsSending(
    state,
    state.activeConversationID,
  );
  const webPromptBusy = webPromptTarget && webPromptTaskPending(state);
  const webPromptStopping =
    webPromptBusy &&
    state.messages.some(
      (message) =>
        isWebPromptUserMessage(message) &&
        !!message.task &&
        !message.task.completedAt &&
        !message.task.cancelledAt &&
        !message.task.error,
    );
  const canSubmit =
    (state.networkDiagramTarget
      ? !!preset?.apiKey && !!preset.model
      : webPromptTarget || (!!preset?.apiKey && !!preset.model)) &&
    (state.networkDiagramTarget
      ? !state.sending && !networkDiagramBusy
      : (!conversationSending || queueAllowed) && !webPromptBusy);
  input.placeholder = state.networkDiagramTarget
    ? networkDiagramBusy
      ? "网络图分析中…可在上方任务卡停止"
      : "输入网络图优化要求…（Enter 发送，Shift+Enter 换行）"
    : webPromptTarget
    ? webPromptBusy
      ? `${webProviderName(state, state.localUiSettings.webPromptProvider)} 正在处理上一条请求…`
      : `发送到 ${webProviderName(state, state.localUiSettings.webPromptProvider)}…（Enter 发送）`
    : preset
      ? conversationSending
        ? queueAllowed
          ? "AI 回答中…当前回复结束后将按顺序执行队列里的消息"
          : "AI 回答中…等待结束后再发送（设置可开启发送中排队）"
        : "问点什么... (Enter 发送，Shift+Enter 换行)"
      : "先添加一个模型预设。";
  input.disabled =
    (state.networkDiagramTarget ? !preset : !webPromptTarget && !preset) ||
    (state.networkDiagramTarget === true && networkDiagramBusy);
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
      ? matchingSlashCommandsForSendMode(
          slashTarget.token,
          state.localUiSettings.chatSendMode,
        )
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
    // A conversation stays serial. Other conversations can use a separate
    // parallel slot while this one is streaming.
    // toggle (UiSettings.composerQueueWhileSending) to allow Enter to
    // register new messages onto the queue. The actual queue handling is
    // Messages in this conversation remain sequential. A different
    // conversation may use another configured parallel slot.
    const shouldSend =
      (state.networkDiagramTarget
        ? !state.sending && !networkDiagramBusy
        : !conversationSending || queueWhileSendingEnabled(state)) &&
      event.key === "Enter" &&
      !event.isComposing &&
      (!event.shiftKey || event.ctrlKey || event.metaKey);
    if (shouldSend) {
      event.preventDefault();
      void sendComposerMessage(
        mount,
        state,
        composerMessageContent(input.value, state),
      );
    }
  });

  input.addEventListener("input", () => {
    resetComposerPromptHistory(state);
    updateStatus();
    if (!state.networkDiagramTarget) {
      scheduleDraftConversationSave(mount, state);
    }
  });
  for (const event of ["select", "click", "keyup", "focus"]) {
    input.addEventListener(event, () => updateStatus());
  }
  input.addEventListener("paste", (event: ClipboardEvent) => {
    const imageFiles = pastedImageFiles(event);
    if (!state.networkDiagramTarget && imageFiles.length > 0) {
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
  if (!state.networkDiagramTarget) {
    inputStack.append(
      renderDraftImages(doc, mount, state, input, { renderPanel }),
    );
  }
  inputStack.append(slashMenu, input);
  const composerSwitchers = el(doc, "div", "composer-switchers");
  if (!state.networkDiagramTarget) {
    composerSwitchers.append(renderWebSearchSwitcher(doc, mount, state));
    if (!getStoredSelectedText(state.itemID)) {
      composerSwitchers.append(renderPaperPinSwitcher(doc, mount, state));
    }
    row.append(inputStack, composerSwitchers);
  } else {
    row.append(inputStack);
  }
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
  if (!state.networkDiagramTarget) {
    const { menu: attachmentMenu, content: attachmentMenuContent } =
      compactMenu(doc, "composer-attachment-menu", "＋", "添加截图或图片");
    attachmentMenuContent.append(screenshotAttach, imageAttach);
    row.append(attachmentMenu);
  }
  const send = buttonEl(doc, conversationSending ? "↑ 排队" : "↑");
  send.className = conversationSending ? "send-btn send-queue-btn" : "send-btn";
  send.disabled = !canSubmit;
  send.title = webPromptTarget
    ? "发送到 Web Prompt Hub；未登录时会提示配置网页账号"
    : preset
      ? !preset.apiKey || !preset.model
      ? "请先填写 API Key 和 Model ID"
      : conversationSending
        ? "加入队列：当前回复结束后按顺序执行"
        : "发送"
      : "发送";
  send.setAttribute("aria-label", conversationSending ? "加入队列" : "发送");
  send.addEventListener(
    "click",
    () =>
      void sendComposerMessage(
        mount,
        state,
        composerMessageContent(input.value, state),
      ),
  );
  row.append(send);
  if (conversationSending || webPromptStopping) {
    const stop = buttonEl(doc, "停止");
    stop.className = "stop-btn";
    stop.addEventListener("click", () => {
      if (webPromptStopping) {
        void cancelPendingWebPromptTask(mount, state);
      } else {
        cancelActiveChatTask(mount, state);
      }
    });
    row.append(stop);
  }
  if (!state.networkDiagramTarget) {
    const selectionChip = state.chatSelectionQuote
      ? renderChatSelectionChip(doc, mount, state)
      : renderSelectionChip(doc, mount, state);
    if (selectionChip) row.prepend(selectionChip);
  }
  const networkTargetChip = renderNetworkDiagramTargetChip(doc, mount, state);
  if (networkTargetChip) row.prepend(networkTargetChip);
  if (!state.networkDiagramTarget) {
    composer.append(renderConversationSwitcher(doc, mount, state));
  }
  if (
    !state.networkDiagramTarget &&
    state.localUiSettings.chatLayout === "classic"
  ) {
    composer.append(renderQuickPrompts(doc, mount, state));
  }
  if (!state.networkDiagramTarget) {
    composer.append(renderTaskQueue(doc, mount, state));
  }
  composer.append(row, renderComposerFooter(doc, mount, state, status));
  return composer;
}

function composerMessageContent(raw: string, state: PanelState): string {
  return expandSlashCommandMessage(expandPasteMarkers(raw, state));
}

async function sendComposerMessage(
  mount: HTMLElement,
  state: PanelState,
  text: string,
): Promise<void> {
  if (!state.networkDiagramTarget) {
    if (state.localUiSettings.chatSendMode === "web") {
      await sendWebPromptMessage(
        mount,
        state,
        text,
        state.localUiSettings.webPromptProvider,
      );
      return;
    }
    await sendMessage(mount, state, text, { fromComposer: true });
    return;
  }
  const instruction = text.trim();
  const sidebar = findSidebarStateByMount(mount);
  if (!instruction || !sidebar || sidebar.networkDiagramBusy) return;

  state.draftText = "";
  state.draftSelectionStart = 0;
  state.draftSelectionEnd = 0;
  state.draftHadFocus = true;
  state.skipNextDraftCapture = true;
  state.focusInput = true;
  state.networkDiagramAutoFollowMessages = true;
  state.scrollToBottom = true;
  renderPanel(mount, state);
  await runNetworkDiagramRequest(sidebar, "", instruction, "refine");
}

async function cancelPendingWebPromptTask(
  mount: HTMLElement,
  state: PanelState,
): Promise<void> {
  const userMessage = [...state.messages]
    .reverse()
    .find(
      (message) =>
        isWebPromptUserMessage(message) &&
        !!message.task &&
        !message.task.completedAt &&
        !message.task.cancelledAt &&
        !message.task.error,
    );
  const taskID = userMessage?.task?.id;
  if (!taskID) return;
  const now = Date.now();
  const provider = webPromptProviderForUserMessage(userMessage);
  const statusMessage = `${provider ? webProviderName(state, provider) : "WEB"} 网页任务已取消，可以重新发送。`;
  for (const message of state.messages) {
    if (message.task?.id !== taskID) continue;
    const partialAnswer =
      message.role === "assistant" && message.task.webStatus === "generating"
        ? message.content
        : "";
    if (message.role === "assistant") {
      message.content = webPromptStatusBubbleContent({
        status: "cancelled",
        statusMessage,
        paintedAnswer: partialAnswer,
      });
    }
    message.task.cancelledAt ??= now;
    message.task.completedAt ??= now;
    delete message.task.webStatus;
  }
  state.webPromptBusy = false;
  state.webPromptBusyTaskID = undefined;
  // Paint the cancelled state before persistence or the Web Agent response.
  // Saving conversations can involve Zotero I/O and should not delay the
  // stop button or the next Enter submission.
  renderPanel(mount, state);
  void persistPanelConversations(state);
  try {
    await cancelWebAgentTask(taskID);
  } catch (error) {
    state.webAccountNotice = `WEB 任务已在 Zotero 中释放；Web Agent 取消失败：${error instanceof Error ? error.message : String(error)}`;
    renderPanel(mount, state);
  }
}

async function sendWebPromptMessage(
  mount: HTMLElement,
  state: PanelState,
  text: string,
  provider: WebPromptProvider,
  options: {
    explainSelection?: boolean;
    annotationBatch?: boolean;
    taskTitle?: string;
    retrySelectedText?: string;
    retrySelectionSnapshot?: SelectionAnnotationDraft | null;
  } = {},
): Promise<void> {
  const content = text.trim();
  if (!content) return;
  if (webPromptTaskPending(state)) return;
  const sourceItemID = state.itemID;
  let selectionSnapshot = options.explainSelection
    ? cloneSelectionAnnotationDraft(
        options.retrySelectionSnapshot ??
          getStoredSelectionAnnotation(sourceItemID),
      )
    : null;
  // Lock before the first await. Account checks and paper-material assembly
  // are asynchronous, so a second click could otherwise create another
  // assistant bubble before the first task is even queued.
  state.webPromptBusy = true;
  renderPanel(mount, state);
  const releaseWebPromptLock = () => {
    state.webPromptBusy = false;
    state.webPromptBusyTaskID = undefined;
  };
  const customProvider = customWebProviderFor(state, provider);
  if (provider.startsWith("custom:") && !customProvider) {
    releaseWebPromptLock();
    state.webAccountConfigured = false;
    state.webAccountNotice = "自定义网页配置不存在，请重新配置网页提供商";
    renderPanel(mount, state);
    return;
  }
  let account: Awaited<ReturnType<typeof getWebAccountStatus>>;
  try {
    account = await getWebAccountStatus(provider, undefined, customProvider);
  } catch (error) {
    releaseWebPromptLock();
    state.webAccountConfigured = false;
    state.webAccountNotice =
      error instanceof Error ? error.message : String(error);
    renderPanel(mount, state);
    return;
  }
  const configureForWebTask = (requiresLogin = false) => {
    releaseWebPromptLock();
    state.webAccountConfigured = false;
    state.webAccountNotice = requiresLogin
      ? "Z.ai 游客可进行文字聊天，本次上传论文附件需要登录"
      : account.verificationRequired
        ? `${webProviderName(state, provider)} 网站要求访问验证，请在专用 Chrome 中手动完成验证`
        : provider.startsWith("custom:")
          ? `未检测到 ${webProviderName(state, provider)} 的可用输入框，请先打开该网址并完成登录`
          : `尚未配置 ${webProviderName(state, provider)} 网页账号，请先点击账号配置按钮并手动登录`;
    renderPanel(mount, state);
    const doc = mount.ownerDocument;
    if (doc) {
      configureWebAccount(
        doc,
        mount,
        state,
        provider,
        webProviderName(state, provider),
        customProvider,
        () => {
          if (states.get(mount) !== state) return;
          void sendWebPromptMessage(mount, state, content, provider, options);
        },
        requiresLogin,
      );
    }
  };
  if (!account.configured) {
    configureForWebTask();
    return;
  }
  state.webAccountConfigured = true;
  state.webAccountNotice = undefined;
  await ensureHistoryLoaded(mount, state);
  if (states.get(mount) !== state) {
    releaseWebPromptLock();
    return;
  }

  const conversation = activeConversation(state);
  if (!conversation) {
    releaseWebPromptLock();
    return;
  }
  const chatQuote = state.chatSelectionQuote;
  const selectedText =
    options.retrySelectedText?.trim() ||
    chatQuote?.excerpt.trim() ||
    selectionSnapshot?.text.trim() ||
    (await getSelectedTextForPrompt(mount, sourceItemID));
  if (options.explainSelection && !selectionSnapshot && selectedText) {
    selectionSnapshot = await rebuildWebSelectionAnnotationSnapshot(
      mount,
      sourceItemID,
      selectedText,
    );
  }
  if (selectionSnapshot && selectedText) selectionSnapshot.text = selectedText;
  const history = completedWebHistory(
    selectConversationHistory(state.messages, state.historyMode),
  );
  const webHistory = chatQuote?.fullReply.trim()
    ? [
        ...history,
        { role: "assistant" as const, content: chatQuote.fullReply.trim() },
      ]
    : history;
  // A chat citation is one-shot. Capture it above for this task, then remove
  // the chip so the next Web question starts with a clean composer.
  state.chatSelectionQuote = undefined;
  const item = sourceItemID == null ? null : Zotero.Items.get(sourceItemID);
  const title = item ? String(item.getField("title") || "") : "";
  const material = await resolveWebPaperMaterial(sourceItemID);
  const arxivToc = await buildArxivTocFrontBlock(sourceItemID);
  // Guest Z.ai conversations carry history in the existing text prompt path.
  const contextAttachment =
    provider === "zai" && account.guest
      ? undefined
      : await createWebContextAttachment(webHistory);
  const tocAttachment = await createWebTocAttachment(arxivToc);
  if (
    provider === "zai" && account.guest && (material.attachment || tocAttachment)
  ) {
    state.chatSelectionQuote = chatQuote;
    configureForWebTask(true);
    return;
  }
  const annotationColorGuide =
    loadToolSettings(zoteroPrefs()).annotationColorGuide;
  const webContent = options.annotationBatch
    ? webAnnotationTaskQuestion()
    : content;
  const prompt = buildWebPrompt({
    content: webContent,
    title,
    selectedText,
    selectedTextOrigin: chatQuote ? "chat" : "pdf",
    history: webHistory,
    paperUrl: material.paperUrl,
    attachmentKind:
      material.attachment?.kind === "latex" ||
      material.attachment?.kind === "pdf"
        ? material.attachment.kind
        : undefined,
    historyAttachmentAvailable: !!contextAttachment,
    historyAttachmentName: contextAttachment?.name,
    tocAttachmentAvailable: !!tocAttachment,
    tocAttachmentName: tocAttachment?.name,
    webProvider: provider,
    annotationBatch: options.annotationBatch,
    annotationSuggestion: options.explainSelection,
    annotationColorGuide,
  });
  const continuationPrompt = buildWebPrompt({
    content: webContent,
    title,
    selectedText,
    selectedTextOrigin: chatQuote ? "chat" : "pdf",
    history: webHistory,
    paperUrl: material.paperUrl,
    attachmentKind:
      material.attachment?.kind === "latex" ||
      material.attachment?.kind === "pdf"
        ? material.attachment.kind
        : undefined,
    attachmentAlreadyAvailable: !!material.attachment,
    historyAttachmentAvailable: !!contextAttachment,
    historyAttachmentName: contextAttachment?.name,
    tocAttachmentAvailable: !!tocAttachment,
    tocAttachmentName: tocAttachment?.name,
    webProvider: provider,
    annotationBatch: options.annotationBatch,
    annotationSuggestion: options.explainSelection,
    annotationColorGuide,
  });
  const createdAt = Date.now();
  let taskID = "";
  const userMessage: Message = {
    role: "user",
    content,
    task: {
      id: "pending-web-task",
      kind: options.annotationBatch
        ? "full_text"
        : options.explainSelection
          ? "selection"
          : "general",
      title: options.taskTitle || `${webProviderName(state, provider)} Web`,
      promptPreview: contentPreview(content, 90),
      createdAt,
      webProvider: provider,
      webStatus: "queued",
    },
    ...(selectedText
      ? {
          context: {
            selectedText,
            explainSelection: options.explainSelection,
            ...(chatQuote
              ? {
                  selectedTextOrigin: "chat" as const,
                  quotedChatReply: {
                    fullReply: chatQuote.fullReply,
                    sourceConversationTitle: chatQuote.sourceConversationTitle,
                    sourceAssistantOrdinal: chatQuote.sourceAssistantOrdinal,
                    sourceQuestionPreview: chatQuote.sourceQuestionPreview,
                  },
                }
              : {}),
          },
        }
      : {}),
  };
  const assistantMessage: Message = {
    role: "assistant",
    content: `正在准备 ${webProviderName(state, provider)} 网页自动回答。`,
    task: {
      id: "pending-web-task",
      kind: options.annotationBatch
        ? "full_text"
        : options.explainSelection
          ? "selection"
          : "general",
      title: "等待网页回答",
      promptPreview: contentPreview(content, 90),
      createdAt,
      webProvider: provider,
      webStatus: "queued",
    },
  };
  const sourceConversationID = conversation.id;
  // Keep one Web conversation per paper and provider. A new Zotero chat for
  // the same paper continues the existing Web thread; changing papers starts
  // a separate Web conversation.
  const paperSessionKey =
    sourceItemID != null
    ? `item:${sourceItemID}`
    : `paper:${material.paperUrl || title || "global"}`;
  const webConversationKey = `${paperSessionKey}:${provider}`;
  // Web Agent sends growing DOM snapshots rather than token deltas. Keep the
  // latest snapshot for persistence, while painting it into the visible bubble
  // in small steps so Web answers read like a live response.
  let webProgressTimer: number | undefined;
  let webProgressFinalized = false;
  let webProgressAnswer = "";
  let webProgressReasoning = "";
  let webProgressImages: Message["images"] = [];
  let latestWebProgress: WebPromptResult | undefined;
  const webProgressWindow = mount.ownerDocument?.defaultView;
  const cancelWebProgress = () => {
    if (webProgressTimer != null) {
      webProgressWindow?.clearTimeout(webProgressTimer);
      webProgressTimer = undefined;
    }
    webProgressFinalized = true;
    latestWebProgress = undefined;
  };
  const renderWebProgressBubble = (
    source: ChatConversation,
    target: Message,
  ) => {
    if (state.activeConversationID !== sourceConversationID) return;
    state.messages = source.messages;
    const index = source.messages.indexOf(target);
    if (index < 0) return;
    if (mount.querySelector(`[data-message-index="${index}"]`)) {
      updateMessageBubble(mount, index, target);
    } else {
      renderPanel(mount, state);
    }
  };
  const scheduleWebProgress = () => {
    if (webProgressFinalized || webProgressTimer != null) return;
    const flush = () => {
      webProgressTimer = undefined;
      if (webProgressFinalized || !latestWebProgress) return;
      const nextAnswer = advanceWebProgressText(
        webProgressAnswer,
        latestWebProgress.answer,
      );
      const nextReasoning = advanceWebReasoningSnapshot(
        webProgressReasoning,
        latestWebProgress.reasoning || "",
      );
      const changed =
        nextAnswer !== webProgressAnswer ||
        nextReasoning !== webProgressReasoning;
      webProgressAnswer = nextAnswer;
      webProgressReasoning = nextReasoning;
      const source = state.conversations.find(
        (candidate) => candidate.id === sourceConversationID,
      );
      const target = source?.messages.find(
        (message) =>
          message.role === "assistant" && message.task?.id === taskID,
      );
      if (target?.task?.cancelledAt) {
        cancelWebProgress();
        return;
      }
      if (source && target && changed) {
        target.content =
          webProgressAnswer ||
          `${webProviderName(state, provider)} 正在生成最终回答。`;
        target.thinking = webProgressReasoning || undefined;
        target.images = webProgressImages;
        source.updatedAt = new Date().toISOString();
        renderWebProgressBubble(source, target);
      }
      const answerCaughtUp = webProgressAnswer === latestWebProgress.answer;
      const reasoningCaughtUp =
        webProgressReasoning === (latestWebProgress.reasoning || "");
      if (answerCaughtUp && reasoningCaughtUp) {
        void persistPanelConversations(state);
      } else {
        const schedule = webProgressWindow?.setTimeout;
        webProgressTimer = schedule
          ? schedule(flush, 35)
          : (setTimeout(flush, 35) as unknown as number);
      }
    };
    const schedule = webProgressWindow?.setTimeout;
    webProgressTimer = schedule
      ? schedule(flush, 0)
      : (setTimeout(flush, 0) as unknown as number);
  };
  const task = createWebPromptTask({
    provider,
    prompt,
    sourceLabel: `${title || "Zotero 条目"} · ${conversation.title}`,
    onProgress: async (result) => {
      if (webProgressFinalized) return;
      latestWebProgress = {
        answer: result.answer || latestWebProgress?.answer || "",
        reasoning: result.reasoning || latestWebProgress?.reasoning || "",
        images: result.images || latestWebProgress?.images,
      };
      scheduleWebProgress();
    },
    onStatus: async (status, error) => {
      // The completed callback is followed immediately by onImport. Painting
      // an intermediate status here would delete the streamed answer and then
      // draw it again a moment later.
      if (status === "completed") return;
      const source = state.conversations.find(
        (candidate) => candidate.id === sourceConversationID,
      );
      const target = source?.messages.find(
        (message) =>
          message.role === "assistant" && message.task?.id === taskID,
      );
      if (!source || !target) return;
      if (target.task && status !== "failed" && status !== "cancelled") {
        target.task.webStatus = status as WebTaskStatus;
      }
      if (status === "generating" && webProgressAnswer) {
        target.content = webProgressAnswer;
        target.thinking = webProgressReasoning || undefined;
      } else {
        target.content = webPromptStatusBubbleContent({
          status,
          statusMessage: webPromptStatusMessage(provider, status, error),
          paintedAnswer: webProgressAnswer,
          queuedAnswer: latestWebProgress?.answer,
        });
        if (
          status === "generating" &&
          (webProgressAnswer || latestWebProgress?.answer)
        ) {
          target.thinking =
            webProgressReasoning || latestWebProgress?.reasoning || undefined;
        }
      }
      if (status === "failed" || status === "cancelled") {
        cancelWebProgress();
        releaseWebPromptLock();
      }
      if (status === "failed") {
        target.content += `\n\n[打开手动 Prompt Hub](${task.url})`;
      }
      if (target.task) target.task.error = error;
      if (status === "failed" || status === "cancelled") {
        const sourceUserMessage = source.messages.find(
          (message) => message.role === "user" && message.task?.id === taskID,
        );
        if (sourceUserMessage?.task) {
          if (status === "failed") sourceUserMessage.task.error = error;
          sourceUserMessage.task.completedAt ??= Date.now();
          if (status === "cancelled") {
            sourceUserMessage.task.cancelledAt ??= Date.now();
          }
        }
      }
      source.updatedAt = new Date().toISOString();
      if (state.activeConversationID === sourceConversationID) {
        state.messages = source.messages;
      }
      await persistPanelConversations(state);
      renderWebProgressBubble(source, target);
    },
    onImport: async (result) => {
      cancelWebProgress();
      releaseWebPromptLock();
      const source = state.conversations.find(
        (candidate) => candidate.id === sourceConversationID,
      );
      const target = source?.messages.find(
        (message) =>
          message.role === "assistant" && message.task?.id === taskID,
      );
      if (!source || !target) return;
      const importedAnswer = describeUnavailableGeneratedFiles(result.answer);
      if (result.pageNotice) {
        target.webPageNotice = true;
        target.content = [
          "网页未返回正常回答。以下为网页本轮新增内容：",
          importedAnswer,
          "请点击底部“账号”检查登录状态、浏览器显示方式或网页配置后重试。",
        ].join("\n\n");
      } else if (options.annotationBatch || hasWebAnnotationProtocol(importedAnswer)) {
        target.content = importedAnswer;
        const parsed = parseWebAnnotationBatch(target.content);
        target.content = parsed.body || "DeepSeek 已返回 PDF 标注草稿。";
        target.webAnnotationBatch = parsed.annotations.length
          ? createPendingWebAnnotationBatch(parsed.annotations)
          : parsed.error
            ? { createdAt: Date.now(), error: parsed.error, entries: [] }
            : {
                createdAt: Date.now(),
                error:
                  "WEB 回答未包含可解析的 Zotero 标注协议；正常回答已保留。",
                entries: [],
              };
      } else {
        target.content = importedAnswer;
        if (options.explainSelection && selectionSnapshot) {
          attachAnnotationDraft(target, selectionSnapshot, true);
        }
      }
      target.thinking = result.reasoning;
      target.images = result.images;
      if (target.task) {
        target.task.completedAt = Date.now();
        delete target.task.webStatus;
        target.task.viewedAt =
          state.activeConversationID === sourceConversationID
            ? Date.now()
            : undefined;
      }
      const sourceUserMessage = source.messages.find(
        (message) => message.role === "user" && message.task?.id === taskID,
      );
      if (sourceUserMessage?.task) {
        sourceUserMessage.task.completedAt = Date.now();
        delete sourceUserMessage.task.webStatus;
      }
      source.updatedAt = new Date().toISOString();
      if (state.activeConversationID === sourceConversationID) {
        state.messages = source.messages;
        state.scrollToBottom = true;
      }
      // The completion callback updates the answer bubble in place, but the
      // composer (including its Stop button and busy placeholder) is rendered
      // separately. Paint the settled state immediately so the next Enter can
      // be used without waiting for persistence or another UI event.
      if (state.activeConversationID === sourceConversationID) {
        renderPanel(mount, state);
      }
      await persistPanelConversations(state);
      if (target.webAnnotationBatch?.entries.length) {
        void locateWebAnnotationBatch(mount, state, target, sourceItemID);
      }
    },
  });
  taskID = task.id;
  state.webPromptBusyTaskID = taskID;
  userMessage.task!.id = taskID;
  assistantMessage.task!.id = taskID;
  state.messages.push(userMessage, assistantMessage);
  state.draftText = "";
  state.draftSelectionStart = 0;
  state.draftSelectionEnd = 0;
  state.skipNextDraftCapture = true;
  state.draftImages = [];
  state.pasteBlocks = [];
  state.scrollToBottom = true;
  await persistPanelConversations(state);
  renderPanel(mount, state);
  try {
    await dispatchWebAgentTask({
      id: task.id,
      provider,
      prompt,
      continuationPrompt,
      sessionKey: webConversationKey,
      paperUrl: material.paperUrl,
      hideBrowser: state.localUiSettings.hideWebBrowser,
      chatgptOptions:
        provider === "chatgpt" ? state.localUiSettings.chatgptWeb : undefined,
      customProvider,
      attachment: material.attachment,
      contextAttachment,
      tocAttachment,
    });
  } catch (error) {
    cancelWebProgress();
    releaseWebPromptLock();
    const message = error instanceof Error ? error.message : String(error);
    assistantMessage.content = `WEB 自动化启动失败：${message}\n\n[打开手动 Prompt Hub](${task.url})`;
    if (assistantMessage.task) assistantMessage.task.error = message;
    if (userMessage.task) {
      userMessage.task.error = message;
      userMessage.task.completedAt ??= Date.now();
    }
    await persistPanelConversations(state);
    renderPanel(mount, state);
  }
}

function webPromptStatusMessage(
  provider: WebPromptProvider,
  status: import("./web-prompt-hub").WebPromptTaskStatus,
  error?: string,
): string {
  const name = webProviderDisplayName(provider);
  switch (status) {
    case "queued":
      return `等待执行 ${name} 网页任务。`;
    case "starting_browser":
      return `正在打开 ${name} 专用浏览器。`;
    case "needs_login":
      return `等待你在专用浏览器中人工完成 ${name} 登录或网页验证。完成后任务会自动继续。`;
    case "uploading_attachment":
      return `正在向 ${name} 对话框粘贴论文文件并等待上传。`;
    case "submitting":
      return `正在向 ${name} 网页发送 Prompt。`;
    case "generating":
      return `${name} 正在生成回答。`;
    case "processing_answer":
      return `正在整理 ${name} 回答中的图表、文件并同步到 Zotero。`;
    case "completed":
      return `正在把 ${name} 回答导回 Zotero。`;
    case "cancelled":
      return `${name} 网页任务已取消。`;
    case "failed":
      return `${name} 网页任务失败：${error || "未知错误"}`;
  }
}

function webProviderName(
  state: PanelState,
  provider: WebPromptProvider,
): string {
  const builtInName = webProviderDisplayName(provider);
  if (builtInName !== provider) return builtInName;
  return customWebProviderFor(state, provider)?.name || "自定义网页";
}

function webProviderDisplayName(provider: WebPromptProvider): string {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "chatglm") return "ChatGLM";
  if (provider === "zai") return "Z.ai";
  if (provider === "kimi") return "Kimi";
  return provider;
}

function customWebProviderFor(
  state: PanelState,
  provider: WebPromptProvider,
): CustomWebProvider | undefined {
  if (!provider.startsWith("custom:")) return undefined;
  const id = provider.slice("custom:".length);
  return state.localUiSettings.customWebProviders.find(
    (candidate) => candidate.id === id,
  );
}

const DEFAULT_CUSTOM_WEB_PROVIDER_SELECTORS: CustomWebProvider["selectors"] = {
  composer: ["textarea", "[contenteditable='true']"],
  send: [
    "button[type='submit']",
    "button[aria-label*='Send']",
    "button[aria-label*='发送']",
  ],
  stop: ["button[aria-label*='Stop']", "button[aria-label*='停止']"],
  answers: ["[data-message-author-role='assistant']", "article"],
  reasoning: [],
  attachmentPreviews: ["[class*='attachment']", "[class*='file']"],
  attachmentUploading: ["[role='progressbar']", "[aria-busy='true']"],
};

function configureCustomWebProvider(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): void {
  const view = doc.defaultView;
  const current = customWebProviderFor(
    state,
    state.localUiSettings.webPromptProvider,
  );
  let editingProvider: CustomWebProvider | undefined = current;
  const layer = el(doc, "div", "zai-custom-web-provider-layer");
  const dialog = el(doc, "section", "zai-custom-web-provider-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "第三方网页配置");

  const head = el(doc, "header", "zai-custom-web-provider-head");
  const heading = el(doc, "div", "zai-custom-web-provider-heading");
  heading.append(
    el(doc, "strong", "zai-custom-web-provider-title", "第三方网页配置"),
    el(
      doc,
      "span",
      "zai-custom-web-provider-subtitle",
      "只配置网页 URL；登录和网页内设置在独立浏览器中手工完成",
    ),
  );
  const close = buttonEl(doc, "×");
  close.className = "zai-custom-web-provider-close";
  close.type = "button";
  close.title = "关闭（Esc）";
  head.append(heading, close);

  const form = doc.createElementNS(XHTML_NS, "form") as HTMLFormElement;
  form.className = "zai-custom-web-provider-form";
  const body = el(doc, "div", "zai-custom-web-provider-scroll");
  const notice = el(doc, "div", "zai-custom-web-provider-notice");

  const input = (value: string, type = "text") => {
    const control = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
    control.type = type;
    control.value = value;
    return control;
  };
  const formField = (label: string, control: HTMLElement, hint?: string) => {
    const wrapper = el(doc, "label", "zai-custom-web-provider-field");
    wrapper.append(
      el(doc, "span", "zai-custom-web-provider-label", label),
      control,
    );
    if (hint)
      wrapper.append(el(doc, "small", "zai-custom-web-provider-hint", hint));
    return wrapper;
  };

  const providerSection = el(doc, "section", "zai-custom-web-provider-list");
  const providerListHead = el(doc, "div", "zai-custom-web-provider-list-head");
  providerListHead.append(
    el(doc, "strong", "zai-custom-web-provider-list-title", "已配置网页"),
  );
  const addProvider = buttonEl(doc, "+ 新增网页");
  addProvider.type = "button";
  addProvider.className = "zai-custom-web-provider-add";
  providerListHead.append(addProvider);
  const providerTable = doc.createElement("table");
  providerTable.className = "zai-custom-web-provider-table";
  const providerTableHead = doc.createElement("thead");
  const providerHeaderRow = doc.createElement("tr");
  for (const label of ["网页", "URL", "状态", "操作"]) {
    const cell = doc.createElement("th");
    cell.textContent = label;
    providerHeaderRow.append(cell);
  }
  providerTableHead.append(providerHeaderRow);
  const providerTableBody = doc.createElement("tbody");
  providerTable.append(providerTableHead, providerTableBody);
  providerSection.append(providerListHead, providerTable);

  const basics = el(doc, "div", "zai-custom-web-provider-editor");
  const homeUrl = input(
    editingProvider?.homeUrl || editingProvider?.newConversationUrl || "",
    "url",
  );
  const editorTitle = el(
    doc,
    "strong",
    "zai-custom-web-provider-editor-title",
    editingProvider ? "编辑网页 URL" : "新增网页 URL",
  );
  basics.append(
    editorTitle,
    formField("网页 URL", homeUrl, "必须是 http:// 或 https:// 地址"),
  );
  body.append(
    providerSection,
    basics,
    el(
      doc,
      "p",
      "zai-custom-web-provider-rule-note",
      "保存后请使用账号按钮打开该网址，手工登录并保持页面打开。",
    ),
    notice,
  );

  const foot = el(doc, "footer", "zai-custom-web-provider-foot");
  const cancel = buttonEl(doc, "取消");
  cancel.type = "button";
  const remove = buttonEl(doc, "删除当前配置");
  remove.type = "button";
  remove.className = "zai-custom-web-provider-danger";
  remove.hidden = !editingProvider;
  const save = buttonEl(doc, editingProvider ? "保存修改" : "保存配置");
  save.type = "submit";
  save.className = "zai-custom-web-provider-primary";
  foot.append(cancel, remove, save);

  const closeDialog = () => {
    layer.remove();
  };
  const showError = (message: string) => {
    notice.textContent = message;
    notice.classList.add("is-error");
  };
  const clearError = () => {
    notice.textContent = "";
    notice.classList.remove("is-error");
  };
  const renderProviderTable = () => {
    providerTableBody.replaceChildren();
    const providers = state.localUiSettings.customWebProviders;
    if (providers.length === 0) {
      const row = doc.createElement("tr");
      const cell = doc.createElement("td");
      cell.colSpan = 4;
      cell.className = "zai-custom-web-provider-empty";
      cell.textContent = "暂无第三方网页配置";
      row.append(cell);
      providerTableBody.append(row);
      return;
    }
    for (const provider of providers) {
      const row = doc.createElement("tr");
      if (state.localUiSettings.webPromptProvider === `custom:${provider.id}`) {
        row.className = "is-active";
      }
      const nameCell = doc.createElement("td");
      nameCell.className = "zai-custom-web-provider-name-cell";
      nameCell.textContent = provider.name;
      const urlCell = doc.createElement("td");
      urlCell.className = "zai-custom-web-provider-url-cell";
      urlCell.textContent = provider.homeUrl;
      urlCell.title = provider.homeUrl;
      const statusCell = doc.createElement("td");
      statusCell.className = "zai-custom-web-provider-status-cell";
      statusCell.textContent =
        state.localUiSettings.webPromptProvider === `custom:${provider.id}`
          ? "当前"
          : "可用";
      const actionCell = doc.createElement("td");
      actionCell.className = "zai-custom-web-provider-actions-cell";
      const edit = buttonEl(doc, "编辑");
      edit.type = "button";
      edit.className = "zai-custom-web-provider-row-button";
      edit.addEventListener("click", () => startEditor(provider));
      const removeRow = buttonEl(doc, "删除");
      removeRow.type = "button";
      removeRow.className = "zai-custom-web-provider-row-button is-danger";
      removeRow.addEventListener("click", () => deleteProvider(provider));
      actionCell.append(edit, removeRow);
      row.append(nameCell, urlCell, statusCell, actionCell);
      providerTableBody.append(row);
    }
  };
  const startEditor = (provider?: CustomWebProvider) => {
    editingProvider = provider;
    homeUrl.value = provider?.homeUrl || provider?.newConversationUrl || "";
    editorTitle.textContent = provider ? "编辑网页 URL" : "新增网页 URL";
    save.textContent = provider ? "保存修改" : "保存配置";
    remove.hidden = !provider;
    clearError();
    renderProviderTable();
    homeUrl.focus();
  };
  const deleteProvider = (provider: CustomWebProvider) => {
    if (!view?.confirm?.(`删除 ${provider.name} 的网页配置？`)) return;
    const deletingActive =
      state.localUiSettings.webPromptProvider === `custom:${provider.id}`;
    const next = normalizeLocalUiSettings({
      ...state.localUiSettings,
      customWebProviders: state.localUiSettings.customWebProviders.filter(
        (candidate) => candidate.id !== provider.id,
      ),
      webPromptProvider: deletingActive
        ? "chatgpt"
        : state.localUiSettings.webPromptProvider,
    });
    state.localUiSettings = next;
    state.webAccountConfigured = undefined;
    saveLocalUiSettings(zoteroPrefs(), next);
    if (editingProvider?.id === provider.id) startEditor();
    else renderProviderTable();
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();
    const providerHomeUrl = homeUrl.value.trim();
    if (!providerHomeUrl) return showError("请填写网页 URL");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(providerHomeUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      return showError("请输入有效的 http:// 或 https:// 网页 URL");
    }
    const hostName = parsedUrl.hostname.replace(/^www\./i, "") || "自定义网页";
    const providerName = editingProvider?.name || hostName;
    const generatedId =
      hostName
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || `site-${Date.now().toString(36)}`;
    const id = editingProvider
        ? editingProvider.id
        : state.localUiSettings.customWebProviders.some(
              (provider) => provider.id === generatedId,
            )
          ? `${generatedId}-${Date.now().toString(36)}`
          : generatedId;
    const candidate: CustomWebProvider = {
      id,
      name: providerName,
      template: "chatgpt-like",
      homeUrl: providerHomeUrl,
      newConversationUrl: providerHomeUrl,
      selectors: editingProvider
          ? editingProvider.selectors
          : DEFAULT_CUSTOM_WEB_PROVIDER_SELECTORS,
    };
    const next = normalizeLocalUiSettings({
      ...state.localUiSettings,
      customWebProviders: [
        ...state.localUiSettings.customWebProviders.filter(
          (item) => item.id !== id,
        ),
        candidate,
      ],
      webPromptProvider: `custom:${id}`,
    });
    const saved = next.customWebProviders.find((item) => item.id === id);
    if (!saved) return showError("网页配置无效：请检查 URL");
    state.localUiSettings = next;
    state.webAccountConfigured = undefined;
    state.webAccountNotice = `已保存 ${saved.name}，请点击账号图标手动登录`;
    saveLocalUiSettings(zoteroPrefs(), next);
    closeDialog();
    renderPanelPreservingOpenMenus(mount, state);
  });
  close.addEventListener("click", closeDialog);
  cancel.addEventListener("click", closeDialog);
  addProvider.addEventListener("click", () => startEditor());
  remove.addEventListener("click", () => {
    if (editingProvider) deleteProvider(editingProvider);
  });
  layer.addEventListener("mousedown", (event) => {
    if (event.target === layer) closeDialog();
  });
  layer.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    closeDialog();
  });
  dialog.append(head, form);
  form.append(body, foot);
  layer.append(dialog);
  mount.before(layer);
  renderProviderTable();
  const focus = () => homeUrl.focus();
  if (view?.requestAnimationFrame) view.requestAnimationFrame(focus);
  else homeUrl.focus();
}

function activateNetworkDiagramTarget(
  mount: HTMLElement,
  state: PanelState,
  instruction?: string,
): void {
  if (!state.networkDiagramTarget) {
    state.networkDiagramReturnDraft = {
      text: state.draftText,
      selectionStart: state.draftSelectionStart,
      selectionEnd: state.draftSelectionEnd,
    };
    state.networkDiagramTarget = true;
    state.draftText = "";
    state.draftSelectionStart = 0;
    state.draftSelectionEnd = 0;
  }
  if (instruction) {
    state.draftText = instruction;
    state.draftSelectionStart = instruction.length;
    state.draftSelectionEnd = instruction.length;
  }
  state.skipNextDraftCapture = true;
  state.focusInput = true;
  state.networkDiagramAutoFollowMessages = true;
  state.scrollToBottom = true;
  renderPanel(mount, state);
  const sidebar = findSidebarStateByMount(mount);
  if (sidebar?.overviewActive) void showOverviewWindow(sidebar);
}

function deactivateNetworkDiagramTarget(
  mount: HTMLElement,
  state: PanelState,
): void {
  state.networkDiagramTarget = false;
  const previous = state.networkDiagramReturnDraft;
  state.networkDiagramReturnDraft = undefined;
  if (previous) {
    state.draftText = previous.text;
    state.draftSelectionStart = previous.selectionStart;
    state.draftSelectionEnd = previous.selectionEnd;
  } else {
    state.draftText = "";
    state.draftSelectionStart = 0;
    state.draftSelectionEnd = 0;
  }
  state.skipNextDraftCapture = true;
  state.focusInput = true;
  renderPanel(mount, state);
  const sidebar = findSidebarStateByMount(mount);
  if (sidebar?.overviewActive) void showOverviewWindow(sidebar);
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
  const matches = target
    ? matchingSlashCommandsForSendMode(
        target.token,
        state.localUiSettings.chatSendMode,
      )
    : [];
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

// 方案 A: the source-selection indicator is a chip rendered INSIDE the composer
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
  const translationSelection = !!fullTranslationSidebarForMount(mount);
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
  body.title = translationSelection
    ? "点击展开 / 收起，核对本轮会随消息发送的英文原句"
    : "点击展开 / 收起，核对本轮会随消息发送的 PDF 选区原文";
  body.append(
    el(doc, "span", "zai-sel-chip-icon", forced ? "📄" : "🎯"),
    el(
      doc,
      "span",
      "zai-sel-chip-label",
      forced ? "选区+全文" : translationSelection ? "英文原句" : "选区",
    ),
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
  fullText.disabled = conversationIsSending(state, state.activeConversationID);
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

  // ✕ — drop the selection from this turn without changing saved highlights.
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "zai-sel-chip-remove";
  remove.textContent = "✕";
  remove.disabled = conversationIsSending(state, state.activeConversationID);
  remove.title = translationSelection
    ? "移除选区：本轮不发送，并同时取消翻译页里的选中"
    : "移除选区：本轮不发送，并同时取消 PDF 里的选中";
  remove.addEventListener("click", () => {
    ignoreSelectedTextForPrompt(mount, state.itemID);
    renderPanel(mount, state);
  });

  chip.append(body, fullText, remove);
  wrap.append(chip);
  if (previewOpen) {
    const preview = el(doc, "div", "zai-sel-chip-preview");
    preview.append(
      el(
        doc,
        "div",
        "zai-sel-chip-preview-title",
        translationSelection ? "本轮会发送的英文原句" : "本轮会发送的 PDF 选区",
      ),
      el(doc, "div", "zai-sel-chip-preview-body", selectedText),
    );
    wrap.append(preview);
  }
  return wrap;
}

function renderChatSelectionChip(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement | null {
  const citation = state.chatSelectionQuote;
  const selectedText = citation?.excerpt.trim();
  if (!citation || !selectedText) return null;

  const previewOpen = state.chatSelectionPreviewOpen === true;
  const wrap = el(doc, "div", "zai-sel-chip-wrap");
  const chip = el(doc, "div", "zai-sel-chip zai-chat-quote-chip");
  const body = doc.createElement("button");
  body.type = "button";
  body.className = "zai-sel-chip-body";
  body.title = "点击展开 / 收起，核对本轮会随问题发送的对话引用";
  body.append(
    el(doc, "span", "zai-sel-chip-icon", "💬"),
    el(doc, "span", "zai-sel-chip-label", "对话引用"),
    el(doc, "span", "zai-sel-chip-text", selectedText.replace(/\s+/g, " ")),
    el(
      doc,
      "span",
      "zai-sel-chip-peek",
      previewOpen
        ? "收起"
        : `仅本轮携带此回复全文 ${citation.fullReply.length} 字 · 点开核对`,
    ),
  );
  body.addEventListener("click", () => {
    state.chatSelectionPreviewOpen = !previewOpen;
    renderPanel(mount, state);
  });

  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "zai-sel-chip-remove";
  remove.textContent = "✕";
  remove.disabled = conversationIsSending(state, state.activeConversationID);
  remove.title = "移除对话引用：本轮不发送这段文字";
  remove.addEventListener("click", () => {
    state.chatSelectionQuote = undefined;
    state.chatSelectionPreviewOpen = false;
    renderPanel(mount, state);
  });

  chip.append(body, remove);
  wrap.append(chip);
  if (previewOpen) {
    const preview = el(doc, "div", "zai-sel-chip-preview");
    preview.append(
      el(
        doc,
        "div",
        "zai-sel-chip-preview-title",
        `仅本轮携带此回复全文（${citation.sourceConversationTitle}，不携带其他聊天历史）`,
      ),
      el(
        doc,
        "div",
        "zai-sel-chip-preview-title",
        "论文目录按“原文”开关发送，正文由模型按需读取",
      ),
      el(doc, "div", "zai-sel-chip-preview-title", "本轮重点引用"),
      el(doc, "div", "zai-sel-chip-preview-body", selectedText),
      el(
        doc,
        "div",
        "zai-sel-chip-preview-title zai-chat-quote-full-title",
        `来源 AI 回复全文 · ${citation.fullReply.length} 字`,
      ),
      el(doc, "div", "zai-sel-chip-preview-body", citation.fullReply),
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
): HTMLElement {
  const footer = el(doc, "div", "composer-footer");
  const left = el(doc, "div", "composer-footer-left");
  const actions = el(doc, "div", "composer-footer-actions");
  left.append(status);
  left.hidden = status.hidden;
  footer.classList.toggle("composer-footer-status-empty", Boolean(left.hidden));
  const sendMode = renderSendTargetSwitcher(doc, mount, state);
  if (state.localUiSettings.chatSendMode === "api") {
    actions.append(
      renderPresetSwitcher(doc, mount, state),
      renderModelSwitcher(doc, mount, state),
      renderYoloToggle(doc, mount, state),
    );
  } else {
    actions.append(
      renderWebPromptProviderSwitcher(doc, mount, state),
      renderWebAccountButton(doc, mount, state),
    );
  }
  footer.append(sendMode, actions, left);
  return footer;
}

function renderSendTargetSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const wrap = el(doc, "div", "composer-send-mode");
  for (const [value, label] of [
    ["api", "API"],
    ["web", "WEB"],
  ] as const) {
    const button = buttonEl(doc, label);
    button.className = "composer-send-mode-button";
    button.classList.toggle(
      "is-active",
      state.localUiSettings.chatSendMode === value,
    );
    button.setAttribute(
      "aria-pressed",
      String(state.localUiSettings.chatSendMode === value),
    );
    button.addEventListener("click", () => {
      state.localUiSettings = normalizeLocalUiSettings({
        ...state.localUiSettings,
        chatSendMode: value,
      });
      saveLocalUiSettings(zoteroPrefs(), state.localUiSettings);
      renderPanelPreservingOpenMenus(mount, state);
    });
    wrap.append(button);
  }
  return wrap;
}

function renderWebPromptProviderSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const select = doc.createElement("select");
  select.className = "composer-web-provider-select";
  select.title = "选择网页模型";
  for (const [value, label] of [
    ["chatgpt", "ChatGPT"],
    ["deepseek", "DeepSeek"],
    ["chatglm", "ChatGLM（chatglm.cn，风控受限）"],
    ["zai", "Z.ai（chat.z.ai）"],
    ["kimi", "Kimi"],
  ] as const) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  for (const provider of state.localUiSettings.customWebProviders) {
    const option = doc.createElement("option");
    option.value = `custom:${provider.id}`;
    option.textContent = provider.name;
    select.append(option);
  }
  const option = doc.createElement("option");
  option.value = "__manage_web_providers__";
  option.textContent = "＋ 管理第三方网页…";
  select.append(option);
  select.value = state.localUiSettings.webPromptProvider;
  select.addEventListener("change", () => {
    const previousProvider = state.localUiSettings.webPromptProvider;
    if (select.value === "__manage_web_providers__") {
      select.value = previousProvider;
      configureCustomWebProvider(doc, mount, state);
      return;
    }
    if (select.value === "chatgpt" && previousProvider !== "chatgpt") {
      const warning =
        "ChatGPT 网页模式风险提示\n\n" +
        "需要在独立浏览器中手动登录。网页自动化可能触发访问频率限制、额外验证或账号风控。\n\n" +
        "确认了解风险并继续使用 ChatGPT 网页版吗？";
      const confirmed = doc.defaultView?.confirm
        ? doc.defaultView.confirm(warning)
        : true;
      if (!confirmed) {
        select.value = previousProvider;
        return;
      }
    }
    state.localUiSettings = normalizeLocalUiSettings({
      ...state.localUiSettings,
      webPromptProvider: select.value,
    });
    state.webAccountConfigured = undefined;
    state.webAccountNotice = undefined;
    saveLocalUiSettings(zoteroPrefs(), state.localUiSettings);
    renderPanelPreservingOpenMenus(mount, state);
  });
  return select;
}

function renderWebAccountButton(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const provider = state.localUiSettings.webPromptProvider;
  const providerName = webProviderName(state, provider);
  const customProvider = customWebProviderFor(state, provider);
  const button = buttonEl(doc, "");
  button.className = "composer-web-account-button";
  button.title = `在 Zotero 配置窗口中管理 ${providerName} 网页账号`;
  button.setAttribute("aria-label", `配置 ${providerName} 网页账号`);
  button.append(
    webAccountIcon(doc),
    el(doc, "span", "composer-web-account-label", "账号"),
  );
  button.disabled = state.webAccountNotice?.startsWith("正在打开") === true;
  button.addEventListener("click", () => {
    configureWebAccount(
      doc,
      mount,
      state,
      provider,
      providerName,
      customProvider,
    );
  });
  return button;
}

function configureWebAccount(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  provider: WebPromptProvider,
  providerName: string,
  customProvider?: CustomWebProvider,
  onConfigured?: () => void,
  requiresLogin = false,
): void {
  const view = doc.defaultView;
  const layer = el(
    doc,
    "div",
    "zai-custom-web-provider-layer zai-web-account-layer",
  );
  const dialog = el(
    doc,
    "section",
    "zai-custom-web-provider-dialog zai-web-account-dialog",
  );
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", `配置 ${providerName} 网页账号`);

  const head = el(doc, "header", "zai-custom-web-provider-head");
  const heading = el(doc, "div", "zai-custom-web-provider-heading");
  heading.append(
    el(
      doc,
      "strong",
      "zai-custom-web-provider-title",
      `${providerName} 账号配置`,
    ),
    el(
      doc,
      "span",
      "zai-custom-web-provider-subtitle",
      "登录网页只在配置期间显示；完成后自动回到后台运行",
    ),
  );
  const close = buttonEl(doc, "×");
  close.className = "zai-custom-web-provider-close";
  close.type = "button";
  close.title = "完成配置并隐藏网页（Esc）";
  head.append(heading, close);

  const form = doc.createElementNS(XHTML_NS, "form") as HTMLFormElement;
  form.className = "zai-custom-web-provider-form zai-web-account-form";
  const body = el(doc, "div", "zai-custom-web-provider-scroll");
  const status = el(
    doc,
    "div",
    "zai-web-account-status",
    "正在检查 Web Agent…",
  );
  const dependencyActions = el(
    doc,
    "div",
    "zai-web-account-dependency-actions",
  );
  dependencyActions.hidden = true;
  dependencyActions.append(
    el(
      doc,
      "p",
      "zai-web-account-dependency-note",
      "系统依赖需要由用户安装，插件不会自动执行安装程序或系统命令。",
    ),
  );
  const dependencyList = el(
    doc,
    "div",
    "zai-web-account-dependency-list",
  );
  dependencyActions.append(dependencyList);
  const downloadActions = el(doc, "div", "zai-web-account-download-actions");
  downloadActions.hidden = true;
  const downloadHint = el(
    doc,
    "span",
    "",
    "自动下载失败，可手动下载 ZIP 后选择本地安装。",
  );
  const openDownloadPage = buttonEl(doc, "打开下载页面");
  openDownloadPage.type = "button";
  const copyDownloadLink = buttonEl(doc, "复制下载链接");
  copyDownloadLink.type = "button";
  const chooseRuntime = buttonEl(doc, "选择已下载的运行包");
  chooseRuntime.type = "button";
  downloadActions.append(
    downloadHint,
    openDownloadPage,
    copyDownloadLink,
    chooseRuntime,
  );
  const explanation = el(
    doc,
    "p",
    "zai-web-account-explanation",
    provider === "zai"
      ? requiresLogin
        ? "本次任务需要上传论文附件，请在 Z.ai 网页完成登录后继续。"
        : "Z.ai 支持不登录进行文字聊天；上传论文附件需要登录。你可以选择后续对话是否显示 Chrome。"
      : `请在临时显示的 ${providerName} 网页中完成登录。你可以选择后续对话是否显示 Chrome。`,
  );
  const pageNoticeExplanation = el(
    doc,
    "p",
    "zai-web-account-explanation",
    "网页未返回正常回答时，插件会将本轮新出现的网页内容原样同步到 Zotero；插件不会判断或改写其含义。",
  );
  const visibilityOption = el(doc, "label", "zai-web-account-option");
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.localUiSettings.hideWebBrowser;
  const optionText = el(doc, "span", "", "对话时在后台隐藏浏览器");
  const optionHint = el(
    doc,
    "small",
    "",
    "默认开启；取消勾选后，生成回答时会显示专用 Chrome。",
  );
  optionText.append(optionHint);
  visibilityOption.append(checkbox, optionText);
  body.append(
    status,
    dependencyActions,
    downloadActions,
    explanation,
    pageNoticeExplanation,
    visibilityOption,
  );

  const foot = el(
    doc,
    "footer",
    "zai-custom-web-provider-foot zai-web-account-foot",
  );
  const repair = buttonEl(doc, "检查环境");
  repair.type = "button";
  const reopen = buttonEl(doc, "重新显示登录网页");
  reopen.type = "button";
  reopen.disabled = true;
  const done = buttonEl(doc, "完成并隐藏");
  done.type = "submit";
  done.className = "zai-custom-web-provider-primary";
  foot.append(repair, reopen, done);
  form.append(body, foot);
  dialog.append(head, form);
  layer.append(dialog);
  mount.before(layer);

  let closed = false;
  let configured = false;
  let guest = false;
  let webAgentReady = false;
  let repairing = false;
  let pollTimer: number | undefined;
  let opening: Promise<void> | undefined;
  const runtimeRelease = webAgentRuntimeRelease();
  let runtimeDownloadUrl = runtimeRelease.downloadUrl;
  let runtimeReleaseUrl = runtimeRelease.releaseUrl;
  const nodeDownloadUrl = "https://nodejs.org/en/download";
  const chromeDownloadUrl = "https://www.google.com/chrome/";
  const xclipInstallGuide = [
    "Ubuntu / Debian: sudo apt install xclip",
    "Fedora: sudo dnf install xclip",
    "Arch Linux: sudo pacman -S xclip",
  ].join("\n");

  const hideDependencyActions = () => {
    dependencyActions.hidden = true;
    dependencyList.replaceChildren();
  };
  const showDependencyActions = (report: WebAgentInstallationReport) => {
    hideDependencyActions();
    if (report.state !== "blocked") return;
    for (const missing of report.missing) {
      const item = el(doc, "div", "zai-web-account-dependency-item");
      const copy = el(doc, "div", "zai-web-account-dependency-copy");
      let action: HTMLButtonElement;
      if (missing === "Node.js 20+") {
        copy.append(
          el(doc, "strong", "", "Node.js 20+ 未找到"),
          el(doc, "small", "", "推荐安装 Node.js 24 LTS 后重新检查。"),
        );
        action = buttonEl(doc, "打开 Node.js 下载页");
        action.addEventListener("click", () => {
          (Zotero as any).launchURL(nodeDownloadUrl);
        });
      } else if (missing === "Google Chrome") {
        copy.append(
          el(doc, "strong", "", "Google Chrome 未找到"),
          el(doc, "small", "", "请安装到系统默认位置或加入 PATH。"),
        );
        action = buttonEl(doc, "打开 Chrome 下载页");
        action.addEventListener("click", () => {
          (Zotero as any).launchURL(chromeDownloadUrl);
        });
      } else {
        copy.append(
          el(doc, "strong", "", "Linux 剪贴板依赖 xclip 未找到"),
          el(doc, "small", "", "请按所用 Linux 发行版安装后重新检查。"),
        );
        action = buttonEl(doc, "复制 xclip 安装说明");
        action.addEventListener("click", () => {
          void copyToClipboard(
            doc,
            xclipInstallGuide,
            "web-agent-xclip-install-guide",
          ).then(() => flashButton(action, "已复制"));
        });
      }
      action.type = "button";
      item.append(copy, action);
      dependencyList.append(item);
    }
    dependencyActions.hidden = false;
  };

  const hideDownloadActions = () => {
    downloadActions.hidden = true;
  };
  const showDownloadActions = (error?: WebAgentRuntimeDownloadError) => {
    runtimeDownloadUrl = error?.downloadUrl || runtimeRelease.downloadUrl;
    runtimeReleaseUrl = error?.releaseUrl || runtimeRelease.releaseUrl;
    downloadActions.hidden = false;
  };

  const updateDoneLabel = () => {
    done.textContent = checkbox.checked ? "完成并隐藏" : "完成并保持显示";
  };
  checkbox.addEventListener("change", () => {
    state.localUiSettings = normalizeLocalUiSettings({
      ...state.localUiSettings,
      hideWebBrowser: checkbox.checked,
    });
    saveLocalUiSettings(zoteroPrefs(), state.localUiSettings);
    updateDoneLabel();
  });
  updateDoneLabel();

  const stopPolling = () => {
    if (pollTimer == null) return;
    if (view) view.clearTimeout(pollTimer);
    else clearTimeout(pollTimer);
    pollTimer = undefined;
  };
  const schedulePoll = () => {
    if (closed || !webAgentReady || pollTimer != null) return;
    const callback = () => {
      pollTimer = undefined;
      void refreshStatus();
    };
    pollTimer = view
      ? view.setTimeout(callback, 1_000)
      : (setTimeout(callback, 1_000) as unknown as number);
  };
  const showResult = (result: {
    configured: boolean;
    browserOpen: boolean;
    verificationRequired?: boolean;
    guest?: boolean;
  }) => {
    if (closed) return;
    guest = provider === "zai" && result.guest === true;
    configured = result.configured && !(requiresLogin && guest);
    status.classList.remove("is-error");
    state.webAccountConfigured = configured;
    done.disabled =
      result.verificationRequired === true || (requiresLogin && !configured);
    status.classList.toggle("is-ready", configured);
    status.textContent = guest && (result.configured || requiresLogin)
      ? requiresLogin
        ? "Z.ai 游客模式：本次上传论文附件需要登录，请在网页完成登录…"
        : "Z.ai 游客模式可用，可以直接文字聊天；上传论文附件需要登录"
      : configured
        ? `${providerName} 已登录，可以完成并隐藏网页`
        : result.verificationRequired
          ? `${providerName} 网站要求访问验证，请在专用 Chrome 中手动完成验证…`
          : result.browserOpen
            ? `等待在 ${providerName} 网页中完成登录…`
            : `${providerName} 登录网页尚未打开`;
  };
  const refreshStatus = async () => {
    try {
      showResult(
        await getWebAccountStatus(provider, undefined, customProvider),
      );
    } catch (error) {
      if (!closed) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
        status.classList.add("is-error");
      }
    } finally {
      schedulePoll();
    }
  };
  const openLoginPage = () => {
    if (opening || closed || !webAgentReady) return;
    reopen.disabled = true;
    status.classList.remove("is-error");
    status.textContent = `正在打开 ${providerName} 登录网页…`;
    opening = openWebAccount(provider, customProvider)
      .then(showResult)
      .catch((error) => {
        if (!closed) {
          status.textContent =
            error instanceof Error ? error.message : String(error);
          status.classList.add("is-error");
        }
      })
      .finally(() => {
        opening = undefined;
        if (!closed) reopen.disabled = false;
        schedulePoll();
      });
  };
  const showInstallation = (report: WebAgentInstallationReport) => {
    if (closed) return;
    hideDownloadActions();
    showDependencyActions(report);
    webAgentReady = report.state === "ready";
    status.classList.toggle("is-ready", webAgentReady);
    status.classList.toggle("is-error", report.state === "blocked");
    status.textContent = report.message;
    reopen.disabled = !webAgentReady;
    repair.textContent =
      report.state === "blocked"
        ? "重新检查环境"
        : webAgentReady
          ? "重新检查 Web Agent"
          : report.configPresent
            ? "修复 Web Agent"
            : "安装 Web Agent";
  };
  const checkAndRepair = async (
    repairIfNeeded: boolean,
    localRuntimePath?: string,
  ) => {
    if (closed || repairing) return;
    repairing = true;
    let usableBeforeRepair = false;
    repair.disabled = true;
    reopen.disabled = true;
    chooseRuntime.disabled = true;
    hideDependencyActions();
    hideDownloadActions();
    status.classList.remove("is-ready", "is-error");
    status.textContent = localRuntimePath
      ? "正在校验并安装本地 Web Agent 运行包…"
      : repairIfNeeded
        ? "正在检查并修复 Web Agent…"
        : "正在检查 Web Agent…";
    try {
      let report = await inspectWebAgentInstallation();
      usableBeforeRepair = report.state === "ready";
      if (localRuntimePath) {
        report = await installLocalWebAgentRuntime(localRuntimePath);
      } else if (repairIfNeeded && report.state !== "blocked") {
        report = await repairWebAgentInstallation();
      }
      showInstallation(report);
      if (report.state === "ready") {
        openLoginPage();
      }
    } catch (error) {
      webAgentReady = usableBeforeRepair;
      status.textContent = error instanceof Error ? error.message : String(error);
      status.classList.add("is-error");
      reopen.disabled = !webAgentReady;
      showDownloadActions(
        error instanceof WebAgentRuntimeDownloadError ? error : undefined,
      );
    } finally {
      repairing = false;
      if (!closed) {
        repair.disabled = false;
        chooseRuntime.disabled = false;
      }
    }
  };
  const closeDialog = async () => {
    if (closed) return;
    closed = true;
    stopPolling();
    reopen.disabled = true;
    repair.disabled = true;
    done.disabled = true;
    done.textContent = checkbox.checked ? "正在隐藏…" : "正在保存…";
    await opening?.catch(() => undefined);
    try {
      if (checkbox.checked && webAgentReady) {
        const result = await hideWebAccount(provider, customProvider);
        guest = provider === "zai" && result.guest === true;
        configured =
          !result.verificationRequired &&
          (result.configured || configured) &&
          !(requiresLogin && guest);
        state.webAccountConfigured = configured;
        state.webAccountNotice = result.verificationRequired
          ? `${providerName} 网站要求访问验证，专用 Chrome 已保持显示，请手动完成验证`
          : guest
            ? "Z.ai 游客模式可用；上传论文附件需要登录"
            : configured
              ? `${providerName} 已就绪`
              : `${providerName} 登录网页已隐藏，尚未检测到登录`;
      } else if (webAgentReady) {
        state.webAccountNotice = guest
          ? "Z.ai 游客模式可用；上传论文附件需要登录"
          : configured
            ? `${providerName} 已就绪`
            : `${providerName} 登录网页保持显示，尚未检测到登录`;
      } else state.webAccountNotice = status.textContent || "Web Agent 尚未就绪";
    } catch (error) {
      state.webAccountNotice =
        error instanceof Error ? error.message : String(error);
    } finally {
      layer.remove();
      if (states.get(mount) === state) {
        renderPanel(mount, state);
        if (configured) onConfigured?.();
      }
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void closeDialog();
  });
  repair.addEventListener("click", () => void checkAndRepair(true));
  openDownloadPage.addEventListener("click", () => {
    (Zotero as any).launchURL(runtimeReleaseUrl);
  });
  copyDownloadLink.addEventListener("click", () => {
    void copyToClipboard(
      doc,
      runtimeDownloadUrl,
      "web-agent-runtime-download-link",
    ).then(() => flashButton(copyDownloadLink, "已复制"));
  });
  chooseRuntime.addEventListener("click", () => {
    void pickWebAgentRuntimeFile(doc).then((path) => {
      if (path) void checkAndRepair(true, path);
    });
  });
  reopen.addEventListener("click", openLoginPage);
  close.addEventListener("click", () => void closeDialog());
  layer.addEventListener("mousedown", (event) => {
    if (event.target === layer) void closeDialog();
  });
  layer.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    void closeDialog();
  });
  void checkAndRepair(false);
}

async function pickWebAgentRuntimeFile(doc: Document): Promise<string | null> {
  const win = doc.defaultView;
  if (!win?.browsingContext) throw new Error("当前窗口不支持文件选择器");
  const nsFilePicker = Components.interfaces.nsIFilePicker;
  const filePickerClass = (
    Components.classes as unknown as Record<
      string,
      { createInstance(iid: typeof nsFilePicker): nsIFilePicker }
    >
  )["@mozilla.org/filepicker;1"];
  const picker = filePickerClass.createInstance(nsFilePicker);
  picker.init(
    win.browsingContext,
    "选择 Web Agent 运行包",
    nsFilePicker.modeOpen,
  );
  picker.appendFilter("Web Agent ZIP", "*.zip");
  picker.appendFilters(nsFilePicker.filterAll ?? 1);
  const result = await new Promise<nsIFilePicker.ResultCode>((resolve) => {
    picker.open({ done: resolve });
  });
  if (result !== nsFilePicker.returnOK) return null;
  return picker.file?.path ?? null;
}

function webAccountIcon(doc: Document): Element {
  const svg = doc.createElementNS(ZAI_SVG_NS, "svg");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of [
    "M20 21a8 8 0 0 0-16 0",
    "M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    "M19 8v3",
    "M17.5 9.5h3",
  ]) {
    const path = doc.createElementNS(ZAI_SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function renderPresetSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const presets = configuredPresets(state);
  const wrap = el(doc, "div", "composer-preset-switcher");
  if (presets.length === 0) {
    wrap.style.display = "none";
    return wrap;
  }
  const select = doc.createElement("select");
  select.className = "composer-preset-select";
  select.title = "切换账号配置";
  for (const preset of presets) {
    const option = doc.createElement("option");
    option.value = preset.id;
    option.textContent = presetSelectLabel(preset);
    select.append(option);
  }
  select.value =
    selectedChatPreset(state)?.id ?? selectedPreset(state)?.id ?? "";
  select.addEventListener("change", () => {
    state.selectedId = select.value;
    state.agentPermissionMode = agentPermissionMode(
      selectedChatPreset(state) ?? selectedPreset(state),
    );
    void persistPanelConversations(state);
    renderPanelPreservingOpenMenus(mount, state);
  });
  wrap.append(select);
  return wrap;
}

function renderWebSearchSwitcher(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
): HTMLElement {
  const settings = loadToolSettings(zoteroPrefs());
  const preset = selectedChatPreset(state);
  const webMode = state.localUiSettings.chatSendMode === "web";
  const enabledForPreset = preset?.provider === "openai";
  const mode = settings.webSearchMode;
  const enabled = mode !== "disabled";
  const wrap = el(doc, "div", `web-search-switcher web-search-${mode}`);
  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "web-search-trigger";
  trigger.textContent = enabled ? "🌐\u00a0联网" : "＋\u00a0联网";
  trigger.title = webMode
    ? "WEB 模式使用网页自身的联网能力；此开关仅用于 API 模式"
    : enabledForPreset
      ? webSearchToggleTitle(mode)
      : "联网工具目前仅对 OpenAI Responses 兼容配置生效";
  trigger.disabled =
    webMode ||
    !enabledForPreset ||
    conversationIsSending(state, state.activeConversationID);
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
  const webMode = state.localUiSettings.chatSendMode === "web";
  const wrap = el(
    doc,
    "div",
    on ? "web-search-switcher web-search-live" : "web-search-switcher",
  );
  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "web-search-trigger";
  const hasItem = state.itemID != null;
  trigger.textContent = on ? "📄\u00a0原文" : "＋\u00a0原文";
  trigger.title = webMode
    ? "WEB 模式由网页附件流程提供论文材料；此开关仅用于 API 模式"
    : !hasItem
      ? "请先在 Zotero 中选择一篇有 PDF 的论文"
      : on
        ? "原文固定已开启：PDF 条目每轮固定全文；arXiv 源条目默认固定章节目录，模型按需读取章节或升级全文。点击关闭。"
        : "点击开启：把论文原文上下文固定在每轮对话最前面；arXiv 源默认先固定章节目录以便缓存复用。";
  trigger.disabled =
    webMode ||
    !hasItem ||
    conversationIsSending(state, state.activeConversationID);
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
  const arxivId = resolveArxivIdForItemID(itemID);
  return arxivId ? await hasArxivSource(arxivId) : false;
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
  trigger.disabled = conversationIsSending(state, state.activeConversationID);
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
  status.hidden = parts.length === 0;
  const container = status.parentElement as HTMLElement | null;
  if (container?.classList.contains("composer-footer-left")) {
    container.hidden = status.hidden;
    container.parentElement?.classList.toggle(
      "composer-footer-status-empty",
      status.hidden,
    );
  }
}

function composeInputStatus(
  input: HTMLTextAreaElement,
  state: PanelState,
): InputStatusPart[] {
  const selected = Math.abs(
    (input.selectionEnd ?? 0) - (input.selectionStart ?? 0),
  );
  const parts: InputStatusPart[] = [];
  if (state.webAccountNotice && state.localUiSettings.chatSendMode === "web") {
    parts.push({
      text: state.webAccountNotice,
      className: "composer-status-web-account",
    });
  }
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

  const chatCitation =
    options.ignoreSelection || options.fullTextHighlight || options.readingRoute
      ? undefined
      : state.chatSelectionQuote;
  const chatSelectionQuote = chatCitation?.excerpt.trim() || "";
  const rawSelectedText = chatSelectionQuote
    ? chatSelectionQuote
    : options.ignoreSelection ||
        options.fullTextHighlight ||
        options.readingRoute
      ? ""
      : await getSelectedTextForPrompt(mount, state.itemID);
  const selectionPayload = chatSelectionQuote
    ? {
        selectedText: chatSelectionQuote,
        context: {
          selectedTextOrigin: "chat" as const,
          quotedChatReply: {
            fullReply: chatCitation!.fullReply,
            sourceConversationTitle: chatCitation!.sourceConversationTitle,
            sourceAssistantOrdinal: chatCitation!.sourceAssistantOrdinal,
            sourceQuestionPreview: chatCitation!.sourceQuestionPreview,
          },
        },
      }
    : options.explainSelection
      ? { selectedText: rawSelectedText, context: {} }
      : await buildSelectionPromptContext(rawSelectedText, state.itemID);
  const selectedText = selectionPayload.selectedText;
  const forcePinnedFullText =
    !chatSelectionQuote && !!selectedText && state.fullTextTurnMode === "force";
  const quickPromptSettings = loadQuickPromptSettings(zoteroPrefs());
  const selectedSnapshot = chatSelectionQuote
    ? null
    : cloneSelectionAnnotationDraft(getStoredSelectionAnnotation(state.itemID));
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
  userMessage.context = {
    ...userMessage.context,
    conversationHistoryMode: chatSelectionQuote ? "none" : state.historyMode,
  };
  const shouldQueue =
    conversationIsSending(state, state.activeConversationID) ||
    activeConversationTaskCount(state) >=
      state.uiSettings.maxParallelConversations;
  state.messages.push(userMessage);
  state.draftText = "";
  state.draftSelectionStart = 0;
  state.draftSelectionEnd = 0;
  state.draftHadFocus = true;
  resetComposerPromptHistory(state);
  state.skipNextDraftCapture = true;
  state.pasteBlocks = [];
  state.draftImages = [];
  state.chatSelectionQuote = undefined;
  state.chatSelectionPreviewOpen = false;
  resetTurnFullTextMode(state);
  state.autoFollowMessages = true;
  state.scrollToBottom = true;
  void persistPanelConversations(state);
  if (shouldQueue) state.queueOpen = true;
  renderPanel(mount, state);
  void processNextQueuedChatTask(mount, state);
}

async function processNextQueuedChatTask(
  mount: HTMLElement,
  state: PanelState,
): Promise<void> {
  if (state.processingQueuedTask) return;
  state.processingQueuedTask = true;
  try {
    while (
      states.get(mount) === state &&
      activeConversationTaskCount(state) <
        state.uiSettings.maxParallelConversations
    ) {
      const excludedConversationIDs = new Set(
        Array.from(state.conversationTaskRuntimes.entries())
          .filter(([, runtime]) => !!runtime.activeTaskID)
          .map(([conversationID]) => conversationID),
      );
      const next = firstQueuedChatTaskAcrossConversations(
        state,
        excludedConversationIDs,
      );
      if (!next) break;
      const messages = next.conversation.messages;
      const userMessage = messages[next.userIndex];
      if (!userMessage || userMessage.role !== "user") break;
      const isolatedHistory =
        userMessage.context?.explainSelection === true ||
        userMessage.context?.selectedTextOrigin === "chat";
      const history = isolatedHistory
        ? []
        : selectConversationHistory(
            messages.slice(0, next.userIndex),
            normalizeConversationHistoryMode(
              userMessage.context?.conversationHistoryMode ??
                next.conversation.historyMode,
            ),
          );
      // Restore whatever annotation context was captured at queue time.
      // INVARIANT: a queued message always uses the PDF selection that was
      // active when it was submitted, NEVER the live selection now —
      // otherwise users would see "建议注释" cards aimed at whatever's
      // currently highlighted in the Reader, which is rarely what they
      // typed against minutes ago.
      const queuedSnapshot = userMessage.context?.queuedAnnotationSnapshot;
      void streamAssistant(mount, state, history, userMessage, {
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
        conversationID: next.conversation.id,
        messages,
      });
    }
  } finally {
    state.processingQueuedTask = false;
  }
}

function firstQueuedChatTaskAcrossConversations(
  state: PanelState,
  excludedConversationIDs = new Set<string>(),
): { conversation: ChatConversation; userIndex: number } | null {
  captureActiveConversation(state);
  let oldest: {
    conversation: ChatConversation;
    userIndex: number;
    createdAt: number;
  } | null = null;
  for (const conversation of state.conversations) {
    if (excludedConversationIDs.has(conversation.id)) continue;
    for (let index = 0; index < conversation.messages.length; index++) {
      const message = conversation.messages[index];
      const task = message?.role === "user" ? message.task : undefined;
      if (
        // Web tasks are dispatched directly to the Web Agent and update the
        // paired assistant message through callbacks. They must never enter
        // the normal API streaming queue as a second request.
        isWebPromptUserMessage(message) ||
        !task ||
        task.completedAt ||
        task.cancelledAt ||
        task.error ||
        Array.from(state.conversationTaskRuntimes.values()).some(
          (runtime) => runtime.activeTaskID === task.id,
        )
      ) {
        continue;
      }
      if (!oldest || task.createdAt < oldest.createdAt) {
        oldest = { conversation, userIndex: index, createdAt: task.createdAt };
      }
    }
  }
  return oldest
    ? { conversation: oldest.conversation, userIndex: oldest.userIndex }
    : null;
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
    kind: selectedText
      ? "selection"
      : options.fullTextHighlight
        ? "full_text"
        : options.readingRoute
          ? "reading_route"
          : "general",
    title:
      options.taskTitle ||
      (selectedText ? "选中文字提问" : contentPreview(content, 14) || "提问"),
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

async function openQuickAsk(
  win: Window,
  sidebar: WindowSidebarState | undefined,
): Promise<void> {
  if (!sidebar) return;
  closeQuickAsk(sidebar);
  setColumnCollapsed(win, sidebar, false);
  const request = Symbol("quick-ask-open");
  quickAskOpenRequests.set(sidebar, request);
  const itemID = safeSelectedItemID(win);
  const reference = await captureQuickAskReference(sidebar, itemID);
  if (quickAskOpenRequests.get(sidebar) !== request) return;
  quickAskOpenRequests.delete(sidebar);
  const panelState = states.get(sidebar.mount);
  const activePreset = panelState ? selectedChatPreset(panelState) : null;
  const savedSelection = loadQuickAskModelSelection(zoteroPrefs());
  const modelOptions = quickAskModelOptions(panelState);
  const initialSelection =
    savedSelection &&
    modelOptions.some(
      (option) =>
        option.presetId === savedSelection.presetId &&
        option.model === savedSelection.model,
    )
      ? savedSelection
      : {
          presetId: activePreset?.id ?? "",
          model: activePreset?.model ?? "",
          reasoningEffort: quickAskReasoningEffort(activePreset ?? undefined),
        };

  const controller: QuickAskController = {
    root: win.document.createElementNS(XHTML_NS, "div") as HTMLElement,
    itemID,
    state: createQuickAskState(reference, initialSelection),
    modelSettingsOpen: false,
  };
  quickAskControllers.set(sidebar, controller);
  renderActiveQuickAsk(sidebar, controller, true);
}

async function captureQuickAskReference(
  sidebar: WindowSidebarState,
  itemID: number | null,
): Promise<QuickAskReference | null> {
  const session = fullTranslationSessions.get(sidebar);
  const host = fullTranslationHosts.get(sidebar);
  if (sidebar.fullTranslationActive && session && host?.root.isConnected) {
    const selection = readFullTranslationSourceSelection(
      host.root,
      session.document.blocks,
    );
    if (selection) {
      refreshFullTranslationSelection(sidebar, itemID, false);
      return {
        kind: selection.origin,
        displayText: selection.displayText,
        sourceText: normalizeSelectedText(selection.selectedText),
      };
    }
  }

  const selectedText = await getSelectedTextForPrompt(sidebar.mount, itemID);
  if (!selectedText) return null;
  return {
    kind: "pdf",
    displayText: selectedText,
    sourceText: selectedText,
  };
}

function renderActiveQuickAsk(
  sidebar: WindowSidebarState,
  controller: QuickAskController,
  focusInput = false,
): void {
  if (quickAskControllers.get(sidebar) !== controller) return;
  const doc = controller.root.ownerDocument!;
  const previousScroll = controller.root.querySelector<HTMLElement>(
    ".zai-quick-ask-scroll",
  );
  const previousScrollTop = previousScroll?.scrollTop ?? 0;
  const wasNearBottom = previousScroll
    ? previousScroll.scrollHeight -
        previousScroll.clientHeight -
        previousScroll.scrollTop <
      40
    : true;
  const panelState = states.get(sidebar.mount);
  const modelOptions = quickAskModelOptions(panelState);
  let selectedPreset = quickAskConfiguredPreset(
    panelState,
    controller.state.modelSelection.presetId,
  );
  if (
    modelOptions.length > 0 &&
    !modelOptions.some(
      (option) =>
        option.presetId === controller.state.modelSelection.presetId &&
        option.model === controller.state.modelSelection.model,
    )
  ) {
    selectedPreset = quickAskConfiguredPreset(
      panelState,
      modelOptions[0].presetId,
    );
    controller.state.modelSelection = {
      presetId: modelOptions[0].presetId,
      model: modelOptions[0].model,
      reasoningEffort: quickAskReasoningEffort(selectedPreset),
    };
  }
  const reasoningOptions =
    selectedPreset && !isReasoningDisabledForDraft(selectedPreset)
      ? reasoningEffortOptionsForPreset(selectedPreset)
      : [];
  if (
    reasoningOptions.length > 0 &&
    !reasoningOptions.some(
      ([effort]) => effort === controller.state.modelSelection.reasoningEffort,
    )
  ) {
    controller.state.modelSelection.reasoningEffort =
      quickAskReasoningEffort(selectedPreset);
    saveQuickAskModelSelection(zoteroPrefs(), controller.state.modelSelection);
  }
  const next = renderQuickAskDialog(
    doc,
    controller.state,
    {
      onQuestionChange: (value) => {
        controller.state.question = value;
      },
      onToggleModelSettings: () => {
        controller.modelSettingsOpen = !controller.modelSettingsOpen;
        renderActiveQuickAsk(sidebar, controller);
      },
      onModelChange: (presetId, model) => {
        const preset = quickAskConfiguredPreset(panelState, presetId);
        controller.state.modelSelection = {
          presetId,
          model,
          reasoningEffort: quickAskReasoningEffort(preset),
        };
        saveQuickAskModelSelection(
          zoteroPrefs(),
          controller.state.modelSelection,
        );
        renderActiveQuickAsk(sidebar, controller);
      },
      onReasoningChange: (reasoningEffort) => {
        controller.state.modelSelection.reasoningEffort = reasoningEffort;
        saveQuickAskModelSelection(
          zoteroPrefs(),
          controller.state.modelSelection,
        );
        renderActiveQuickAsk(sidebar, controller);
      },
      onSend: (value) => void sendQuickAsk(sidebar, controller, value),
      onStop: () => controller.abort?.abort(),
      onCopy: () => void copyQuickAskAnswer(sidebar, controller),
      onTransfer: () => void transferQuickAskToResearch(sidebar, controller),
      onClose: () => closeQuickAsk(sidebar),
    },
    {
      shortcutLabel: getQuickAskShortcut(zoteroPrefs())
        .split("+")
        .map((part) => part.trim())
        .join(" + "),
      modelSettingsOpen: controller.modelSettingsOpen,
      modelOptions,
      reasoningOptions,
      transferDisabled: !!panelState?.sending,
    },
  );
  applyChatAppearance(
    next,
    panelState?.uiSettings ?? loadUiSettings(zoteroPrefs()),
    panelState?.localUiSettings ?? loadLocalUiSettings(zoteroPrefs()),
  );

  if (controller.root.isConnected) {
    controller.root.replaceWith(next);
  } else {
    sidebar.mount.before(next);
  }
  controller.root = next;
  const nextScroll = next.querySelector<HTMLElement>(".zai-quick-ask-scroll");
  if (nextScroll) {
    nextScroll.scrollTop = wasNearBottom
      ? nextScroll.scrollHeight
      : previousScrollTop;
  }
  if (focusInput) {
    // Let the fixed layer finish layout before Gecko asks for the IME caret
    // rectangle; focusing in the insertion tick reports (0, 0) on XUL pages.
    const focus = () => {
      if (quickAskControllers.get(sidebar) !== controller) return;
      controller.root
        .querySelector<HTMLTextAreaElement>(".zai-quick-ask-input")
        ?.focus();
    };
    const requestFrame = doc.defaultView?.requestAnimationFrame.bind(
      doc.defaultView,
    );
    if (requestFrame) {
      requestFrame(() => requestFrame(focus));
    } else {
      doc.defaultView?.setTimeout(focus, 0);
    }
  }
}

function quickAskModelOptions(
  panelState: PanelState | undefined,
): QuickAskModelOption[] {
  if (!panelState) return [];
  return configuredPresets(panelState).flatMap((preset) => {
    const models = preset.models?.length ? preset.models : [preset.model];
    return Array.from(new Set(models.filter(Boolean))).map((model) => ({
      presetId: preset.id,
      presetLabel: presetSelectLabel(preset),
      model,
    }));
  });
}

function quickAskConfiguredPreset(
  panelState: PanelState | undefined,
  presetId: string,
): ModelPreset | undefined {
  return panelState
    ? configuredPresets(panelState).find((preset) => preset.id === presetId)
    : undefined;
}

function quickAskReasoningEffort(
  preset: ModelPreset | undefined,
): ReasoningEffort {
  if (!preset) return DEFAULT_REASONING_EFFORT;
  return collapseReasoningForPreset(
    preset,
    preset.extras?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  );
}

function closeQuickAsk(sidebar: WindowSidebarState): void {
  quickAskOpenRequests.delete(sidebar);
  const controller = quickAskControllers.get(sidebar);
  if (!controller) return;
  controller.abort?.abort();
  controller.abort = undefined;
  controller.root.remove();
  quickAskControllers.delete(sidebar);
}

async function sendQuickAsk(
  sidebar: WindowSidebarState,
  controller: QuickAskController,
  rawQuestion: string,
): Promise<void> {
  if (
    quickAskControllers.get(sidebar) !== controller ||
    controller.state.status === "sending"
  ) {
    return;
  }
  const question = rawQuestion.trim();
  if (!question) return;

  const panelState = states.get(sidebar.mount);
  const selected = controller.state.modelSelection;
  const storedPreset = quickAskConfiguredPreset(panelState, selected.presetId);
  const availableModels = storedPreset?.models?.length
    ? storedPreset.models
    : storedPreset?.model
      ? [storedPreset.model]
      : [];
  const presetWithModel =
    storedPreset && availableModels.includes(selected.model)
      ? { ...storedPreset, model: selected.model }
      : null;
  const preset =
    presetWithModel && !isReasoningDisabledForDraft(presetWithModel)
      ? withReasoningEffort(
          presetWithModel,
          collapseReasoningForPreset(presetWithModel, selected.reasoningEffort),
        )
      : presetWithModel;
  if (!preset?.apiKey || !preset.model) {
    controller.state = {
      ...controller.state,
      question,
      status: "error",
      error: "请先配置可用的 AI 模型。",
    };
    renderActiveQuickAsk(sidebar, controller);
    openAddonPreferences(controller.root.ownerDocument!);
    return;
  }

  controller.state = {
    ...controller.state,
    question,
    answer: "",
    thinking: "",
    status: "sending",
    statusText: "正在准备当前论文上下文……",
    error: "",
    usage: undefined,
  };
  renderActiveQuickAsk(sidebar, controller);

  const reference = controller.state.messages.length
    ? null
    : controller.state.reference;
  const selectionPayload = reference
    ? await buildSelectionPromptContext(reference.sourceText, controller.itemID)
    : { selectedText: "", context: {} };
  if (quickAskControllers.get(sidebar) !== controller) return;
  const userMessage = createQuickAskUserMessage(
    question,
    reference,
    selectionPayload.context,
  );
  const assistantMessage: Message = { role: "assistant", content: "" };
  const conversation = [...controller.state.messages, userMessage];

  const win = hostWindowForSidebar(sidebar)!;
  const abort = new win.AbortController();
  controller.abort = abort;
  let toolSession: ZoteroAgentToolSession | null = null;
  let failed = false;

  try {
    const baseContext = await buildSystemContextOnly(controller.itemID);
    if (quickAskControllers.get(sidebar) !== controller) return;
    toolSession = createZoteroAgentToolSession({
      source: zoteroContextSource,
      itemID: controller.itemID,
      policy: contextPolicy,
      previousMessages: controller.state.messages,
      getActiveReader: () =>
        getReaderForCurrentSelection(win, controller.itemID),
    });
    const tools = quickAskReadOnlyTools(toolSession.tools);
    const messagesForApi = buildQuickAskApiMessages(
      conversation,
      contextPolicy,
    );
    const systemPrompt = `${baseContext.systemPrompt}\n\nQuick Ask mode: this is a temporary in-memory conversation. Use the preceding Quick Ask turns to answer follow-up questions. No saved research conversation history is available. Use read-only tools when the current paper is needed; do not claim to remember chats outside this Quick Ask window.`;
    const promptCacheKey = `${buildPromptCacheKey(preset, controller.itemID)}:quick-ask`;

    controller.state.statusText = "正在等待模型回答……";
    renderActiveQuickAsk(sidebar, controller);
    for await (const chunk of getProvider(preset).stream(
      messagesForApi,
      systemPrompt,
      preset,
      abort.signal,
      {
        tools,
        maxToolIterations: contextPolicy.maxToolIterations,
        permissionMode: "default",
        toolSettings: loadToolSettings(zoteroPrefs()),
        promptCacheKey,
        relayRoutingItemKey: resolveItemKeyForCache(controller.itemID),
      },
    )) {
      if (quickAskControllers.get(sidebar) !== controller) break;
      if (chunk.type === "text_delta") {
        assistantMessage.content += chunk.text;
        controller.state.answer = assistantMessage.content;
        controller.state.statusText = "正在生成回答……";
      } else if (chunk.type === "thinking_delta") {
        assistantMessage.thinking = `${assistantMessage.thinking ?? ""}${chunk.text}`;
        controller.state.thinking = assistantMessage.thinking;
        controller.state.statusText = "正在思考……";
      } else if (chunk.type === "tool_call") {
        recordToolCall(userMessage, chunk);
        controller.state.statusText =
          chunk.status === "started"
            ? `正在使用 ${chunk.name}……`
            : `已完成 ${chunk.name}`;
      } else if (chunk.type === "tool_images") {
        assistantMessage.images = [
          ...(assistantMessage.images ?? []),
          ...chunk.images,
        ];
      } else if (chunk.type === "status") {
        controller.state.statusText = chunk.message;
      } else if (chunk.type === "usage") {
        assistantMessage.usage = mergeMessageUsage(
          assistantMessage.usage,
          chunk,
        );
        controller.state.usage = assistantMessage.usage;
      } else if (chunk.type === "error") {
        failed = true;
        controller.state.error = chunk.message;
        break;
      }
      renderActiveQuickAsk(sidebar, controller);
    }
  } catch (err) {
    failed = true;
    if (quickAskControllers.get(sidebar) === controller) {
      controller.state.error =
        isAbortError(err) || abort.signal.aborted
          ? "已停止本次临时回答。"
          : errorMessage(err);
    }
  } finally {
    toolSession?.dispose();
    if (quickAskControllers.get(sidebar) === controller) {
      controller.abort = undefined;
      if (failed || controller.state.error) {
        controller.state.status = "error";
        controller.state.statusText = "";
      } else {
        if (!controller.state.answer.trim()) {
          controller.state.answer = "本次请求没有返回可显示的回答。";
          assistantMessage.content = controller.state.answer;
        }
        controller.state.messages.push(userMessage, assistantMessage);
        controller.state.question = "";
        controller.state.answer = "";
        controller.state.thinking = "";
        controller.state.status = "answered";
        controller.state.statusText = `临时会话 ${controller.state.messages.length / 2} 轮 · 关闭后销毁`;
      }
      renderActiveQuickAsk(sidebar, controller);
    }
  }
}

async function copyQuickAskAnswer(
  sidebar: WindowSidebarState,
  controller: QuickAskController,
): Promise<void> {
  const answer = latestQuickAskAnswer(controller.state);
  if (!answer || quickAskControllers.get(sidebar) !== controller) return;
  const doc = controller.root.ownerDocument!;
  await copyToClipboard(
    doc,
    answer,
    undefined,
    markdownToClipboardHTML(doc, answer),
  );
  if (quickAskControllers.get(sidebar) !== controller) return;
  controller.state.statusText = "已复制；关闭后仍不会保存本次对话";
  renderActiveQuickAsk(sidebar, controller);
}

function latestQuickAskAnswer(state: QuickAskState): string {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.role === "assistant" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

async function transferQuickAskToResearch(
  sidebar: WindowSidebarState,
  controller: QuickAskController,
): Promise<void> {
  const state = states.get(sidebar.mount);
  if (
    !state ||
    state.itemID !== controller.itemID ||
    !latestQuickAskAnswer(controller.state)
  ) {
    controller.state.error = "当前论文已经切换，请复制回答后再关闭。";
    controller.state.status = "error";
    renderActiveQuickAsk(sidebar, controller);
    return;
  }
  if (conversationIsSending(state, state.activeConversationID)) {
    controller.state.error = "研究对话正在回答，请结束后再转入。";
    controller.state.status = "error";
    renderActiveQuickAsk(sidebar, controller);
    return;
  }
  await ensureHistoryLoaded(sidebar.mount, state);
  if (
    quickAskControllers.get(sidebar) !== controller ||
    states.get(sidebar.mount) !== state
  ) {
    return;
  }
  state.messages.push(
    ...controller.state.messages.map((message) => ({ ...message })),
  );
  await persistPanelConversations(state);
  state.autoFollowMessages = true;
  state.scrollToBottom = true;
  const hostWindow = hostWindowForSidebar(sidebar);
  if (hostWindow) setColumnCollapsed(hostWindow, sidebar, false);
  closeQuickAsk(sidebar);
  renderPanel(sidebar.mount, state);
}

interface StreamAssistantOptions {
  annotationSnapshot?: SelectionAnnotationDraft | null;
  annotationColorEnabled?: boolean;
  fullTextHighlight?: boolean;
  readingRoute?: boolean;
  isolatedHistory?: boolean;
  taskID?: string;
  conversationID?: string;
  messages?: Message[];
}

function conversationRuntime(
  state: PanelState,
  conversationID: string,
): ConversationTaskRuntime {
  let runtime = state.conversationTaskRuntimes.get(conversationID);
  if (!runtime) {
    runtime = {};
    state.conversationTaskRuntimes.set(conversationID, runtime);
  }
  return runtime;
}

function conversationIsSending(
  state: PanelState,
  conversationID: string,
): boolean {
  return !!conversationRuntime(state, conversationID).activeTaskID;
}

function activeConversationTaskCount(state: PanelState): number {
  let count = 0;
  for (const runtime of state.conversationTaskRuntimes.values()) {
    if (runtime.activeTaskID) count++;
  }
  return count;
}

function refreshAggregateSendingState(state: PanelState): void {
  state.sending = activeConversationTaskCount(state) > 0;
}

function assistantProgressForActiveConversation(
  state: PanelState,
  index: number,
  message: Message,
): AssistantProgress | null {
  const runtime = conversationRuntime(state, state.activeConversationID);
  return assistantProgressFor(
    {
      ...state,
      activeAssistantIndex: runtime.activeAssistantIndex,
      activeAssistantStage: runtime.activeAssistantStage,
      activeAssistantDetail: runtime.activeAssistantDetail,
    },
    index,
    message,
  );
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
// INVARIANT: `void persistPanelConversations(...)` fires on every tool_call chunk.
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
  const taskConversationID =
    options.conversationID ?? state.activeConversationID;
  const taskMessages = options.messages ?? state.messages;
  const taskConversation = state.conversations.find(
    (conversation) => conversation.id === taskConversationID,
  );
  const preset =
    (taskConversation?.presetID
      ? configuredPresets(state).find(
          (candidate) => candidate.id === taskConversation.presetID,
        )
      : undefined) ?? selectedChatPreset(state);
  const runtime = conversationRuntime(state, taskConversationID);
  if (!preset || runtime.activeTaskID) return;
  if (taskConversation) taskConversation.messages = taskMessages;

  runtime.activeTaskID = options.taskID;
  refreshAggregateSendingState(state);
  if (state.activeConversationID === taskConversationID) {
    state.autoFollowMessages = true;
    state.scrollToBottom = true;
    state.focusInput = true;
  }
  renderPanel(mount, state);
  const userIndex = taskMessages.indexOf(userMessage);
  const assistantIndex = userIndex >= 0 ? userIndex + 1 : taskMessages.length;
  const assistant: Message = { role: "assistant", content: "" };
  let readingRouteMarkdown = "";
  if (options.readingRoute) {
    assistant.content = readingRouteProgressMessage(0);
  }
  taskMessages.splice(assistantIndex, 0, assistant);
  runtime.activeAssistantIndex = assistantIndex;
  runtime.activeAssistantStage = "building_context";
  if (state.activeConversationID === taskConversationID) {
    state.scrollToBottom = true;
    state.focusInput = true;
  }
  renderPanel(mount, state);

  const updateTaskBubble = () => {
    if (state.activeConversationID === taskConversationID) {
      updateMessageBubble(mount, assistantIndex, assistant);
    }
  };

  const controllerCtor = mount.ownerDocument!.defaultView!.AbortController;
  const controller = new controllerCtor();
  runtime.abort = controller;
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
        : fullTextSource === "arxiv_toc" && userMessage.context?.selectedText
          ? "聚焦提问：发送当前选区/对话引用和精简 arXiv 章节目录；需要核对论文原文时由模型按需读取章节、公式、图表或 PDF 正文"
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
        getReaderForCurrentSelection(hostWindowForMount(mount), state.itemID),
      // Curry the live document and itemID so the model writes to whatever
      // is selected at call time (not at session-creation time). Refresh
      // the visible note panel after the write so the user sees the
      // append immediately, matching the manual button's UX.
      onMindmapReady: (data) => {
        assistant.mindmap = data;
      },
      onOverviewReady: (data) => {
        // Persist + sync, then refresh the 总览 panel view if it is open.
        // The overview is NOT shown in the chat — it lives in its own
        // middle-column view (showOverviewWindow).
        const itemKey = resolveItemKeyForCache(state.itemID);
        const sb = findSidebarStateByDocument(mount.ownerDocument!);
        void (async () => {
          const workspace = itemKey
            ? (await loadNetworkDiagramWorkspace(itemKey))?.workspace
            : undefined;
          const revision = currentNetworkDiagramRevision(workspace);
          const nextData = revision
            ? {
                ...data,
                networkTopology: detailedNetworkGraphToMindmap(revision.graph),
              }
            : data;
          if (itemKey) await saveOverview(itemKey, nextData);
          // Keep the code-derived graph in the synced HTML attachment when a
          // later overview refresh replaces the outline. The overview model
          // itself never produces networkTopology.
          void writeOverviewAttachment(
            mount.ownerDocument!,
            state.itemID,
            nextData,
          );
          if (sb?.overviewActive) void showOverviewWindow(sb);
        })();
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
    if (state.activeConversationID === taskConversationID) {
      state.scrollToBottom = state.autoFollowMessages;
    }
    runtime.activeAssistantStage = "waiting_model";
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
        permissionMode: agentPermissionMode(preset),
        toolSettings: loadToolSettings(zoteroPrefs()),
        promptCacheKey,
        relayRoutingItemKey,
        ...(pinnedFullText ? { pinnedFullText } : {}),
      },
    )) {
      if (chunk.type === "text_delta") {
        runtime.activeAssistantStage = "writing";
        runtime.activeAssistantDetail = undefined;
        if (options.readingRoute) {
          readingRouteMarkdown += chunk.text;
          assistant.content = readingRouteProgressMessage(
            readingRouteMarkdown.length,
          );
        } else {
          assistant.content += chunk.text;
        }
        updateTaskBubble();
      } else if (chunk.type === "thinking_delta") {
        runtime.activeAssistantStage = "thinking";
        runtime.activeAssistantDetail = undefined;
        assistant.thinking = `${assistant.thinking ?? ""}${chunk.text}`;
        updateTaskBubble();
      } else if (chunk.type === "tool_call") {
        runtime.activeAssistantStage =
          chunk.status === "started" ? "using_tool" : "waiting_model";
        runtime.activeAssistantDetail = undefined;
        recordToolCall(userMessage, chunk);
        void persistPanelConversations(state);
        if (state.activeConversationID === taskConversationID) {
          state.scrollToBottom = state.autoFollowMessages;
        }
        renderPanel(mount, state);
      } else if (chunk.type === "tool_images") {
        assistant.images = [...(assistant.images ?? []), ...chunk.images];
        updateTaskBubble();
      } else if (chunk.type === "status") {
        runtime.activeAssistantStage = "waiting_model";
        runtime.activeAssistantDetail = chunk.message;
        updateTaskBubble();
      } else if (chunk.type === "usage") {
        assistant.usage = mergeMessageUsage(assistant.usage, chunk);
        updateTaskBubble();
      } else if (chunk.type === "error") {
        runtime.activeAssistantDetail = undefined;
        markMessageTaskError(userMessage, chunk.message);
        assistant.content += `\n[Error] ${chunk.message}`;
        updateTaskBubble();
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
    updateTaskBubble();
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
    runtime.abort = undefined;
    runtime.activeAssistantIndex = undefined;
    runtime.activeAssistantStage = undefined;
    runtime.activeAssistantDetail = undefined;
    runtime.activeTaskID = undefined;
    runtime.cancellingTaskID = undefined;
    refreshAggregateSendingState(state);
    if (
      state.activeConversationID === taskConversationID &&
      userMessage.task?.completedAt &&
      !userMessage.task.cancelledAt &&
      !userMessage.task.error
    ) {
      userMessage.task.viewedAt = Date.now();
    }
    void persistPanelConversations(state);
    if (state.activeConversationID === taskConversationID) {
      state.scrollToBottom = state.autoFollowMessages;
      state.focusInput = true;
    }
    renderPanel(mount, state);
    void processNextQueuedChatTask(mount, state);
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

function createPendingWebAnnotationBatch(
  candidates: WebAnnotationCandidate[],
): WebAnnotationBatchDraft {
  return {
    createdAt: Date.now(),
    entries: candidates.map((candidate) => ({
      quote: candidate.quote,
      comment: candidate.comment,
      ...(candidate.color ? { color: candidate.color } : {}),
      locateState: "pending",
      state: { kind: "idle" },
    })),
  };
}

function migrateRestoredWebAnnotationBatches(messages: Message[]): Message[] {
  const migrated: Message[] = [];
  for (const message of messages) {
    if (
      message.role !== "assistant" ||
      !message.task?.webProvider ||
      message.webAnnotationBatch ||
      !hasWebAnnotationProtocol(message.content)
    ) {
      continue;
    }
    const parsed = parseWebAnnotationBatch(message.content);
    if (!parsed.annotations.length) continue;
    message.content = parsed.body || "网页模型已返回 PDF 标注草稿。";
    message.webAnnotationBatch = createPendingWebAnnotationBatch(
      parsed.annotations,
    );
    migrated.push(message);
  }
  return migrated;
}

async function rebuildWebSelectionAnnotationSnapshot(
  mount: HTMLElement,
  itemID: number | null,
  selectedText: string,
): Promise<SelectionAnnotationDraft | null> {
  const reader = getActiveReaderForItem(
    mount.ownerDocument?.defaultView,
    itemID,
  );
  if (!reader) return null;
  let locator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    locator = await createPdfLocator(reader);
    return await locateWebSelectionAnnotationDraft(
      locator,
      selectedText,
      DEFAULT_CONTEXT_POLICY.minLocateConfidence,
    );
  } catch (error) {
    debugZai("web.selection-annotation.locate.failed", {
      itemID,
      error: errorMessage(error),
      selectedText: textDebugInfo(selectedText, 120),
    });
    return null;
  } finally {
    locator?.dispose();
  }
}

async function locateWebAnnotationBatch(
  mount: HTMLElement,
  state: PanelState,
  message: Message,
  itemID = state.itemID,
): Promise<void> {
  const batch = message.webAnnotationBatch;
  if (!batch?.entries.length) return;
  const reader = getActiveReaderForItem(
    mount.ownerDocument?.defaultView,
    itemID,
  );
  if (!reader) {
    batch.error = "请先在 Reader 中打开当前 PDF，再重新定位标注草稿。";
    renderPanel(mount, state);
    await persistPanelConversations(state);
    return;
  }

  let locator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    locator = await createPdfLocator(reader);
    for (const entry of batch.entries) {
      if (entry.locateState !== "pending") continue;
      try {
        const results = await locateWebAnnotationQuoteSegments(
          locator,
          entry.quote,
          DEFAULT_CONTEXT_POLICY.minLocateConfidence,
        );
        if (!results?.length) {
          entry.locateState = "not_found";
          continue;
        }
        const result = results[0]!;
        entry.locateState = "located";
        entry.confidence = Math.min(
          ...results.map((located) => located.confidence),
        );
        entry.pageLabel =
          results.length > 1
            ? `${result.pageLabel}–${results[results.length - 1]!.pageLabel}`
            : result.pageLabel;
        entry.color = allowedAnnotationColor(entry.color ?? null) ?? undefined;
        const snapshots = results.map((located) =>
          webAnnotationSnapshotFromLocateResult(locator!.attachmentID, located),
        );
        entry.snapshot = snapshots[0];
        entry.segments =
          snapshots.length > 1
            ? snapshots.map((snapshot) => ({
                snapshot,
                state: { kind: "idle" },
              }))
            : undefined;
      } catch (error) {
        entry.locateState = "failed";
        entry.state = {
          kind: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    delete batch.error;
  } catch (error) {
    batch.error = `本地 PDF 定位失败：${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    locator?.dispose();
  }
  await persistPanelConversations(state);
  renderPanel(mount, state);
}

function webAnnotationSnapshotFromLocateResult(
  attachmentID: number,
  result: LocateResult,
): AssistantAnnotationDraft["snapshot"] {
  return {
    text: result.matchedText,
    attachmentID,
    annotation: {
      type: "highlight",
      text: result.matchedText,
      pageLabel: result.pageLabel,
      sortIndex: result.sortIndex,
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
    },
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
  const arxivId = resolveArxivIdForItemID(itemID);
  if (!arxivId) return false;
  const ok = await ensureArxivSource({ arxivId });
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
    if (!(await isPaperPinned(itemID))) return undefined;
    // For arXiv items, the default pinned block is a compact TOC, not the
    // full source. Keep it out of the generic full-text cache so
    // zotero_get_full_pdf can still upgrade to the actual LaTeX body.
    const tocBlock = await buildArxivTocFrontBlock(itemID);
    if (tocBlock) return tocBlock;
    if (options.suppressPinned) return undefined;
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

export function mergeToolContext(
  previous: Message["context"],
  next: Message["context"],
): Message["context"] {
  if (!next) return previous;
  const merged = {
    ...previous,
    ...next,
  };
  // The TOC describes what was attached to the original user request.
  // Section tools may report the text they fetched, but must not rewrite
  // that request-level provenance or the sidebar will claim no TOC was sent.
  if (previous?.fullTextSource === "arxiv_toc") {
    merged.fullTextSource = previous.fullTextSource;
    merged.fullTextChars = previous.fullTextChars;
  }
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
  if (conversationIsSending(state, state.activeConversationID)) return;
  await ensureHistoryLoaded(mount, state);
  if (states.get(mount) !== state) return;

  const assistantIndex = findLastAssistantIndex(state.messages);
  if (assistantIndex < 0) return;
  const userIndex = findPreviousUserIndex(state.messages, assistantIndex);
  if (userIndex < 0) return;

  const userMessage = state.messages[userIndex];
  const previousAssistant = state.messages[assistantIndex];
  const carriedSnapshot = previousAssistant.annotationDraft?.snapshot ?? null;
  const availableHistory = state.messages.slice(0, userIndex);
  const isolatedHistory =
    userMessage.context?.explainSelection === true ||
    userMessage.context?.selectedTextOrigin === "chat";
  const history = isolatedHistory
    ? []
    : selectConversationHistory(availableHistory, state.historyMode);
  const webProvider = webPromptProviderForUserMessage(userMessage);
  if (webProvider) {
    state.messages = availableHistory;
    await persistPanelConversations(state);
    if (states.get(mount) !== state) return;
    await sendWebPromptMessage(mount, state, userMessage.content, webProvider, {
      explainSelection: userMessage.context?.explainSelection === true,
      annotationBatch: userMessage.task?.kind === "full_text",
      taskTitle: userMessage.task?.title,
      retrySelectedText: userMessage.context?.selectedText,
      retrySelectionSnapshot: carriedSnapshot
        ? {
            text: carriedSnapshot.text,
            attachmentID: carriedSnapshot.attachmentID,
            annotation: { ...carriedSnapshot.annotation },
          }
        : null,
    });
    return;
  }
  resetChatTaskForRetry(userMessage);
  state.messages = [...availableHistory, userMessage];
  void persistPanelConversations(state);
  await streamAssistant(mount, state, history, userMessage, {
    annotationSnapshot: carriedSnapshot
      ? {
          text: carriedSnapshot.text,
          attachmentID: carriedSnapshot.attachmentID,
          annotation: { ...carriedSnapshot.annotation },
        }
      : null,
    readingRoute: userMessage.task?.kind === "reading_route",
    isolatedHistory,
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
  const workspace = await loadChatConversations(state.itemID);
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
  let cancelledStale = 0;
  for (const conversation of workspace.conversations) {
    cancelledStale += cancelStaleQueuedTasks(conversation.messages);
    cancelledStale += interruptStaleWebPromptTasks(conversation.messages);
  }
  state.conversations = workspace.conversations;
  let migratedLegacyWeb = false;
  for (const conversation of state.conversations) {
    migratedLegacyWeb =
      migrateLegacyDeepSeekMessages(conversation.messages) || migratedLegacyWeb;
  }
  state.activeConversationID = workspace.activeConversationID;
  const conversation = activeConversation(state) ?? state.conversations[0];
  applyConversation(state, conversation);
  state.historyLoaded = true;
  state.paperPinned = paperPinned;
  state.scrollToBottom = true;
  if (cancelledStale > 0 || migratedLegacyWeb) {
    void persistPanelConversations(state);
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
// Three concurrent maps track source text selection per Zotero item ID:
//   selectedTextByItem        — current PDF selection or mapped English text.
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
//   3. Full-translation DOM selection → `refreshFullTranslationSelection`.
// Hybrid because neither Reader nor the translation view has one reliable
// selection-clear event.
//
// INVARIANT: an item is keyed by parent-item-id where possible (see
// `readerItemIDs`); the same selection appears under both parent and
// attachment IDs so the chip survives switching between them.

async function getSelectedTextForPrompt(
  mount: HTMLElement,
  itemID: number | null,
): Promise<string> {
  const translationSidebar = fullTranslationSidebarForMount(mount);
  if (translationSidebar) {
    return refreshFullTranslationSelection(translationSidebar, itemID, false);
  }
  const win = hostWindowForMount(mount);
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

function fullTranslationSidebarForMount(
  mount: HTMLElement,
): WindowSidebarState | null {
  const sidebar = findSidebarStateByMount(mount);
  return sidebar?.mount === mount && sidebar.fullTranslationActive
    ? sidebar
    : null;
}

function refreshFullTranslationSelection(
  sidebar: WindowSidebarState,
  itemID: number | null,
  clearWhenEmpty: boolean,
): string {
  const win = hostWindowForSidebar(sidebar);
  const ids = readerItemIDs(getActiveReader(win), itemID);
  const session = fullTranslationSessions.get(sidebar);
  const host = fullTranslationHosts.get(sidebar);
  const selection =
    session && host?.root.isConnected
      ? readFullTranslationSourceSelection(host.root, session.document.blocks)
      : null;
  if (selection) {
    const text = normalizeSelectedText(selection.selectedText);
    if (!text || shouldIgnoreSelectedText(ids, text)) return "";
    for (const id of ids) {
      ignoredSelectedTextByItem.delete(id);
      selectedTextByItem.set(id, text);
      selectedAnnotationByItem.delete(id);
    }
    return text;
  }
  if (clearWhenEmpty) {
    clearStoredSelectedText(ids);
    return "";
  }
  return firstUsableStoredSelectedText(ids);
}

function getActiveReaderSelectionRangeText(reader: unknown): string {
  for (const view of activeReaderViews(reader as any)) {
    const text = selectionRangeTextFromView(view);
    if (text) return text;
  }
  return "";
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

function charsForReaderPage(view: any, pageIndex: number): any[] {
  const pages = view?._pdfPages;
  const page = Array.isArray(pages)
    ? pages[pageIndex]
    : pages?.[String(pageIndex)];
  return Array.isArray(page?.chars) ? page.chars : [];
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
    const after = sidebar.fullTranslationActive
      ? refreshFullTranslationSelection(sidebar, itemID, !focusInSidebar)
      : refreshActiveReaderSelection(win, itemID, !focusInSidebar);
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
      const nextChip = state.chatSelectionQuote
        ? renderChatSelectionChip(mount.ownerDocument!, mount, state)
        : renderSelectionChip(mount.ownerDocument!, mount, state);
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

// User clicked the ✕ on the selection chip. The reliable way to drop the
// selection is to clear the active view's actual text selection: otherwise
// getSelectedTextForPrompt re-reads it at send time and rememberReaderSelection
// re-arms it — the text-keyed ignore flag is defeated whenever the popup-event
// and send-time extraction paths yield even slightly different strings. We
// still set the ignore flag + delete the snapshot as a belt, but clearing the
// source is what actually makes ✕ stick.
function ignoreSelectedTextForPrompt(
  mount: HTMLElement,
  itemID: number | null,
) {
  const hostWindow = hostWindowForMount(mount);
  const reader = getActiveReader(hostWindow);
  const ids = readerItemIDs(reader, itemID);
  const text = firstStoredSelectedText(ids);
  for (const id of ids) {
    if (text) ignoredSelectedTextByItem.set(id, text);
    selectedTextByItem.delete(id);
    selectedAnnotationByItem.delete(id);
  }
  if (fullTranslationSidebarForMount(mount)) {
    hostWindow?.getSelection()?.removeAllRanges();
    return;
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
  preserveStreamingMessagesScroll(mount, shouldStickToBottom, () => {
    root.classList.toggle(
      "bubble-web-page-notice",
      message.webPageNotice === true,
    );
    if (state) {
      updateWebTaskProgress(root, body, state, index, message);
      updateAssistantProgress(
        root,
        body,
        assistantProgressForActiveConversation(state, index, message),
      );
    }

    if (message.thinking) {
      renderMarkdownInto(ensureThinkingBody(root, body), message.thinking);
    }
    renderMarkdownInto(
      body,
      message.content ||
        (state &&
        conversationRuntime(state, state.activeConversationID)
          .activeAssistantIndex === index
          ? " "
          : ""),
    );
    if (state) {
      scheduleAssistantPdfQuoteLinks(body, mount, state, message, index);
      installWebGeneratedFileLinks(body, state);
    }
  });
}

function updateWebTaskProgress(
  root: HTMLElement,
  before: HTMLElement,
  state: PanelState,
  index: number,
  message: Message,
) {
  const existing = root.querySelector(
    ".web-task-progress",
  ) as HTMLElement | null;
  const sourceUser =
    state.messages[findPreviousUserIndex(state.messages, index)];
  const provider = webPromptProviderForUserMessage(sourceUser);
  const progress = provider
    ? webTaskProgressFor(message.task, webProviderName(state, provider))
    : null;
  if (!progress) {
    existing?.remove();
    return;
  }
  const next = renderWebTaskProgress(root.ownerDocument!, progress);
  if (existing) existing.replaceWith(next);
  else root.insertBefore(next, before);
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
      message.webPageNotice === true ? "bubble-web-page-notice" : "",
      `bubble-actions-${state.uiSettings.messageActionsPosition}`,
      `bubble-actions-${state.uiSettings.messageActionsLayout}`,
    ].join(" "),
  );
  root.dataset.messageIndex = String(index);
  const sourceUser =
    message.role === "assistant"
      ? state.messages[findPreviousUserIndex(state.messages, index)]
      : undefined;
  const webProvider = webPromptProviderForUserMessage(sourceUser);
  const progress = assistantProgressForActiveConversation(
    state,
    index,
    message,
  );
  const deferActions = webProvider === "chatglm" && !!progress;
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

  const branch = buttonEl(doc, "分支");
  branch.title = "复制从对话开头到此消息的完整上下文，创建独立对话";
  branch.disabled =
    conversationIsSending(state, state.activeConversationID) ||
    !state.historyLoaded;
  branch.addEventListener("click", () => {
    branchConversationFromMessage(mount, state, index);
  });
  actions.append(branch);

  if (message.role === "assistant" && message.content.trim()) {
    const saveNote = buttonEl(doc, "写入笔记");
    saveNote.title = betterNotesInsertAvailable()
      ? "用 Better Notes 写入当前条目的子笔记"
      : "写入当前条目的 Zotero 子笔记";
    saveNote.disabled =
      state.itemID == null ||
      (conversationIsSending(state, state.activeConversationID) &&
        conversationRuntime(state, state.activeConversationID)
          .activeAssistantIndex === index);
    saveNote.addEventListener("click", () => {
      void writeAssistantMessageToNote(
        doc,
        mount,
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
    retry.disabled = conversationIsSending(state, state.activeConversationID);
    retry.addEventListener(
      "click",
      () => void regenerateLastResponse(mount, state),
    );
    actions.append(retry);
  }

  const del = buttonEl(doc, "删除");
  del.disabled = conversationIsSending(state, state.activeConversationID);
  del.addEventListener("click", () => {
    state.messages = state.messages.filter((_, i) => i !== index);
    void persistPanelConversations(state);
    renderPanel(mount, state);
  });
  actions.append(del);
  if (!deferActions) head.append(actions);

  root.append(head);
  if (message.role === "user") {
    renderMessageImages(doc, root, message.images);
    renderUserPdfSelectionContext(doc, mount, state, root, message);
  }
  if (message.role === "assistant") {
    renderAssistantProcess(doc, mount, state, root, sourceUser);
  }
  if (progress) {
    root.append(renderAssistantProgress(doc, progress));
  }
  const webTaskProgress = webProvider
    ? webTaskProgressFor(message.task, webProviderName(state, webProvider))
    : null;
  if (webTaskProgress) {
    root.append(renderWebTaskProgress(doc, webTaskProgress));
  }
  if (message.role === "assistant" && message.thinking) {
    const details = el(doc, "details", "bubble-thinking") as HTMLDetailsElement;
    details.open = !webProvider;
    details.append(
      el(
        doc,
        "summary",
        "",
        webProvider === "deepseek" ? "DeepSeek 已思考" : "思考过程",
      ),
    );
    const thinkingBody = el(doc, "div", "bubble-thinking-body");
    renderMarkdownInto(thinkingBody, message.thinking);
    details.append(thinkingBody);
    root.append(details);
  }
  if (webProvider && message.task?.completedAt) {
    root.append(el(doc, "div", "bubble-answer-label", "回答"));
  }
  const body = el(doc, "div", "bubble-body");
  renderMarkdownInto(body, message.content || (progress ? " " : ""));
  scheduleAssistantPdfQuoteLinks(body, mount, state, message, index);
  installWebGeneratedFileLinks(body, state);
  const placedCharts =
    message.role === "assistant"
      ? installWebChartImages(doc, body, message.images)
      : new Set<number>();
  if (message.role === "assistant" && message.mindmap) {
    body.append(renderMindmapBlock(doc, message.mindmap));
  }
  root.append(body);
  if (message.role === "assistant") {
    renderMessageImages(doc, root, message.images, placedCharts);
  }
  if (message.role === "assistant" && message.usage) {
    root.append(renderMessageUsage(doc, message.usage));
  }
  if (message.role === "assistant" && message.content.trim()) {
    const rawPre = doc.createElement("pre");
    rawPre.className = "bubble-raw";
    rawPre.textContent = stripWebChartPlaceholders(message.content);
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
  if (message.role === "assistant" && message.webAnnotationBatch) {
    root.append(
      renderWebAnnotationBatch(
        doc,
        mount,
        state,
        message,
        message.webAnnotationBatch,
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
  const webChatCitation =
    message.context?.selectedTextOrigin === "chat" &&
    isWebPromptUserMessage(message);

  const card = el(doc, "div", "bubble-source-selection");
  const head = el(doc, "div", "bubble-source-selection-head");
  const label = el(
    doc,
    "div",
    "bubble-source-selection-label",
    message.context?.selectedTextOrigin === "chat"
      ? [
           "对话引用",
          message.context.quotedChatReply?.sourceConversationTitle,
          webChatCitation
            ? chatCitationLocation(state, message, selectedText)
            : message.context.quotedChatReply?.fullReply
              ? `完整回复 ${message.context.quotedChatReply.fullReply.length} 字`
              : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : locator
        ? `PDF 选区${pdfSelectionPageLabel(locator)}`
        : "原文选区",
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
  const sourceBody = el(doc, "div", "bubble-source-selection-text");
  const quotedReply =
    message.context?.selectedTextOrigin === "chat"
      ? message.context.quotedChatReply?.fullReply?.trim()
      : "";
  if (webChatCitation) renderMarkdownInto(sourceBody, selectedText);
  else if (quotedReply) renderMarkdownInto(sourceBody, quotedReply);
  else sourceBody.textContent = selectedText;
  card.append(head, sourceBody);
  root.append(card);
}

function chatCitationLocation(
  state: PanelState,
  message: Message,
  selectedText: string,
): string {
  const fullReply = message.context?.quotedChatReply?.fullReply ?? "";
  const ordinal = message.context?.quotedChatReply?.sourceAssistantOrdinal;
  const question =
    message.context?.quotedChatReply?.sourceQuestionPreview ||
    sourceQuestionPreviewFromHistory(state, message, fullReply);
  const reply = question
    ? `来源回答“${question}”`
    : ordinal
      ? `来源回答第 ${ordinal} 条`
      : "来源回答";
  const excerpt = contentPreview(selectedText, 30);
  const paragraph = chatCitationParagraph(fullReply, selectedText);
  const start = fullReply.indexOf(selectedText);
  const excerptLabel = excerpt ? ` · 引用“${excerpt}”` : "";
  return start >= 0
    ? `${reply}${excerptLabel}${paragraph ? ` · ${paragraph}` : ""} · 第 ${start + 1}-${start + selectedText.length} 字`
    : `${reply}${excerptLabel}${paragraph ? ` · ${paragraph}` : ""} · 引用 ${selectedText.length} 字`;
}

function sourceQuestionPreviewFromHistory(
  state: PanelState,
  citationMessage: Message,
  fullReply: string,
): string {
  const citationIndex = state.messages.indexOf(citationMessage);
  for (let index = citationIndex - 1; index >= 0; index -= 1) {
    const candidate = state.messages[index];
    if (
      candidate?.role !== "assistant" ||
      candidate.content.trim() !== fullReply.trim()
    ) {
      continue;
    }
    const userIndex = findPreviousUserIndex(state.messages, index);
    return contentPreview(state.messages[userIndex]?.content || "", 28);
  }
  return "";
}

function chatCitationParagraph(
  fullReply: string,
  selectedText: string,
): string {
  const normalizedExcerpt = normalizeChatCitationText(selectedText);
  if (!normalizedExcerpt) return "";
  const paragraphs = fullReply
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const index = paragraphs.findIndex((paragraph) => {
    const normalizedParagraph = normalizeChatCitationText(paragraph);
    return (
      normalizedParagraph.includes(normalizedExcerpt) ||
      normalizedExcerpt.includes(normalizedParagraph)
    );
  });
  return index >= 0 ? `第 ${index + 1} 段` : "";
}

function normalizeChatCitationText(value: string): string {
  return value
    .replace(/[`*_>#\[\]()]/g, "")
    .replace(/\s+/g, "")
    .trim();
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
  if (
    conversationIsSending(state, state.activeConversationID) &&
    conversationRuntime(state, state.activeConversationID)
      .activeAssistantIndex === index
  )
    return;
  // Quote evidence may arrive as a `>` blockquote OR as a `- "…"` list item;
  // pdfQuoteBlocks() handles both, so gate on either element being present.
  if (!body.querySelector("blockquote, li")) return;
  const sourceSelection = pdfSelectionForAssistantMessage(state, index);
  installPdfQuoteButtonsInElement(body, {
    sourceItemID: state.itemID,
    preferredAttachmentID: sourceSelection?.attachmentID ?? null,
    preferredPageIndex: sourceSelection?.pageIndex ?? null,
    onJump: (quote, button) => {
      const sidebar = fullTranslationSidebarForMount(mount);
      if (sidebar) {
        jumpToFullTranslationQuote(sidebar, mount, quote);
        return;
      }
      return jumpToPdfQuote(
        mount,
        state,
        quote,
        sourceSelection?.attachmentID ?? null,
        button,
        state.itemID,
        sourceSelection?.pageIndex ?? null,
      );
    },
  });
}

function jumpToFullTranslationQuote(
  sidebar: WindowSidebarState,
  mount: HTMLElement,
  quote: string,
): void {
  const session = fullTranslationSessions.get(sidebar);
  const host = fullTranslationHosts.get(sidebar);
  const blockId = session
    ? findFullTranslationSourceBlockId(session.document.blocks, quote)
    : null;
  if (
    !blockId ||
    !host?.root.isConnected ||
    !revealFullTranslationSourceBlock(host.root, blockId, quote)
  ) {
    setTempLoadMarkStatus(mount, "原文未定位");
    return;
  }
  setTempLoadMarkStatus(mount, "原文定位");
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
  sidebar.overviewActive = false;
  const isRoute = isReadingRouteNote(note);
  const parts = renderNoteHead(doc, sidebar, {
    view: isRoute ? "readingRoute" : "normal",
    editable: true,
    action: isRoute
      ? {
          label: "↻ 更新路线",
          title: "重新生成阅读路线（覆盖 AI 生成区，保留「我的补充笔记」）",
          onClick: (button) =>
            void generateReadingRouteFromNoteSwitcher(sidebar, button),
        }
      : null,
  });
  const head = parts.head;
  const status = parts.status!;
  const save = parts.save!;
  const close = parts.close;

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

// Segmented view switcher — pure navigation between the note-column
// views. Clicking a segment NEVER generates anything (that footgun is gone);
// it only switches what you're looking at. Generation lives in the contextual
// action button / empty-state CTA instead.
// Rewrite the AI note with any prior 对话总结 section removed, so the next
// append replaces rather than stacks. No-op (and never throws) when there is
// no prior section.
async function removePriorReadingSummary(
  itemID: number | null,
  doc: Document,
): Promise<void> {
  if (itemID == null) return;
  try {
    const { note } = await resolveTargetNote(itemID);
    const current = note.getNote?.() || "";
    const stripped = stripSummarySectionHTML(current, doc);
    if (stripped !== current) {
      note.setNote(stripped || "<p></p>");
      await note.saveTx();
    }
  } catch (err) {
    debugZai("summary:strip-failed", { error: errorMessage(err) });
  }
}

function buildNoteSeg(
  doc: Document,
  sidebar: WindowSidebarState,
  view: NotePanelView,
): HTMLElement {
  const wrap = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrap.className = "zai-note-seg";
  const panelState = states.get(sidebar.mount);

  const makeSeg = (label: string, active: boolean): HTMLButtonElement => {
    const button = buttonEl(doc, label);
    if (active) button.classList.add("on");
    return button;
  };

  const noteBtn = makeSeg("笔记", view === "normal");
  noteBtn.title = "AI 笔记：对话里的「写入笔记」默认保存到这里";
  noteBtn.addEventListener("click", () => {
    if (view !== "normal") void switchNoteFile(sidebar, "normal", noteBtn);
  });

  const routeBtn = makeSeg("路线", view === "readingRoute");
  routeBtn.title = "阅读路线：AI 标出的精读顺序与重点";
  routeBtn.addEventListener("click", () => {
    if (view !== "readingRoute") void openRouteView(sidebar);
  });

  const overviewBtn = makeSeg("总览", view === "overview");
  overviewBtn.title = "全文总览：章节目录 + 逻辑结构图 + 可选网络拓扑图";
  overviewBtn.addEventListener("click", () => {
    if (view !== "overview") void showOverviewWindow(sidebar);
  });

  if (panelState?.sending) {
    routeBtn.disabled = true;
    overviewBtn.disabled = true;
  }

  wrap.append(noteBtn, routeBtn, overviewBtn);
  return wrap;
}

// ⋯ overflow menu for low-frequency note tools. Toggles on click, closes on
// outside-click; items close the menu when clicked unless they opt out via
// data-zai-keep-open (the 对话总结 item keeps it open to show progress).
function buildNoteMenu(doc: Document, items: HTMLButtonElement[]): HTMLElement {
  const wrap = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrap.className = "zai-note-menu";

  const trigger = buttonEl(doc, "⋯");
  trigger.className = "zai-note-icobtn";
  trigger.title = "更多";

  const pop = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  pop.className = "zai-note-menu-pop";
  pop.hidden = true;
  for (const item of items) {
    item.classList.add("zai-note-menu-item");
    pop.append(item);
  }

  let outside: ((event: Event) => void) | undefined;
  const closeMenu = () => {
    pop.hidden = true;
    trigger.classList.remove("on");
    if (outside) {
      doc.removeEventListener("click", outside, true);
      outside = undefined;
    }
  };
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (pop.hidden) {
      pop.hidden = false;
      trigger.classList.add("on");
      outside = (ev: Event) => {
        if (!wrap.contains(ev.target as Node)) closeMenu();
      };
      doc.addEventListener("click", outside, true);
    } else {
      closeMenu();
    }
  });
  pop.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const item = target?.closest?.(".zai-note-menu-item") as HTMLElement | null;
    if (item?.dataset.zaiKeepOpen === "1") return;
    closeMenu();
  });

  wrap.append(trigger, pop);
  return wrap;
}

// 「对话总结」: AI-summarize this paper's immersive-reading in-place Q&A and
// write the digest into the AI note. A note tool (not a view), so it lives in
// the ⋯ menu rather than competing with the artifact-generation action.
function buildSummaryMenuItem(
  doc: Document,
  sidebar: WindowSidebarState,
): HTMLButtonElement {
  const item = buttonEl(doc, "✎ 对话总结");
  item.title = "用 AI 总结本篇沉浸阅读的所有就地问答，写入 AI 笔记";
  item.dataset.zaiKeepOpen = "1";
  item.addEventListener("click", () => {
    void summarizeReadingFromNoteSwitcher(sidebar, item);
  });
  return item;
}

function buildTabPdfExportMenuItem(
  doc: Document,
  sidebar: WindowSidebarState,
): HTMLButtonElement {
  const item = buttonEl(doc, "▣ 转为 PDF");
  item.title = "将当前笔记、路线或总览页面转换为 PDF";
  item.addEventListener("click", () => {
    void openCurrentNotePanelPdfExport(sidebar);
  });
  return item;
}

async function openCurrentNotePanelPdfExport(
  sidebar: WindowSidebarState,
): Promise<void> {
  const doc = sidebar.noteMount.ownerDocument!;
  const mainWindow = hostWindowForSidebar(sidebar);
  if (!mainWindow) throw new Error("无法获取 Zotero 主窗口");
  const info = currentNotePanelPdfInfo(sidebar);
  const fileName = panelPdfFileName(info.paperTitle, info.fileLabel);
  doc.querySelector(".zai-pdf-export-layer")?.remove();

  let dialog: HTMLElement | null = null;
  let completedPath = "";
  const close = () => {
    dialog?.remove();
    dialog = null;
  };
  const actions: PdfExportDialogActions = {
    onCopyFile: () => copyPdfFileToClipboard(completedPath),
    onCopyPath: () =>
      copyToClipboard(doc, completedPath, "pdf-export:copy-path"),
    onOpen: () => Zotero.launchFile(completedPath),
    onClose: close,
  };
  const renderDialog = (state: PdfExportDialogState) => {
    const next = renderPdfExportDialog(doc, state, actions);
    if (dialog?.isConnected) dialog.replaceWith(next);
    else sidebar.mount.before(next);
    dialog = next;
  };

  renderDialog({ status: "choosing", fileName });
  await waitForDocumentPaint(doc);
  const targetPath = await pickPanelPdfSavePath(mainWindow, fileName);
  if (!targetPath) {
    close();
    return;
  }

  renderDialog({ status: "converting", fileName });
  try {
    await exportCurrentNotePanelAsPdf(sidebar, targetPath, mainWindow);
    completedPath = targetPath;
    renderDialog({ status: "done", fileName, path: targetPath });
  } catch (err) {
    renderDialog({
      status: "error",
      fileName,
      message: errorMessage(err),
    });
  }
}

async function exportCurrentNotePanelAsPdf(
  sidebar: WindowSidebarState,
  targetPath: string,
  mainWindow: Window,
): Promise<void> {
  await saveVisibleNoteBeforeSwitch(sidebar);
  const doc = sidebar.noteMount.ownerDocument!;
  const title = currentNotePanelPdfInfo(sidebar).documentTitle;

  if (sidebar.overviewActive) {
    const overview = sidebar.noteMount.querySelector(
      ".zai-overview-window-body .overview-block",
    ) as HTMLElement | null;
    if (!overview) throw new Error("当前总览暂无可导出的内容");
    const clone = overview.cloneNode(true) as HTMLElement;
    keepOnlyActiveOverviewPane(clone);
    const html = buildPanelPdfHtml({
      title,
      bodyHtml: String(clone.outerHTML),
      pluginCss: collectPluginCss(doc),
      kind: "overview",
    });
    await savePanelHtmlAsPdf(html, targetPath, mainWindow);
    return;
  }

  const note = sidebar.noteItemID ? getZoteroItem(sidebar.noteItemID) : null;
  if (!isZoteroNote(note)) throw new Error("当前页面暂无可导出的内容");

  const editorWindow =
    findActiveNoteEditor(sidebar)?.getCurrentInstance?.()?._iframeWindow;
  if (editorWindow?.browsingContext) {
    await saveContentWindowAsPdf(editorWindow, "note", targetPath, mainWindow);
    return;
  }

  const noteHtml = note.getNote?.() || "";
  if (!noteHtml.trim()) throw new Error("当前笔记暂无可导出的内容");
  await savePanelHtmlAsPdf(
    buildPanelPdfHtml({
      title,
      bodyHtml: noteHtml,
      pluginCss: collectPluginCss(doc),
      kind: "note",
    }),
    targetPath,
    mainWindow,
  );
}

function currentNotePanelPdfInfo(sidebar: WindowSidebarState): {
  documentTitle: string;
  paperTitle: string;
  fileLabel: "AI笔记" | "阅读路线" | "全文总览";
} {
  const panelItemID = states.get(sidebar.mount)?.itemID ?? null;
  const panelItem = panelItemID == null ? null : getZoteroItem(panelItemID);
  const parent = panelItem ? parentItemForNotes(panelItem) : null;
  const paperTitle =
    parent?.getField?.("title") || parent?.getDisplayTitle?.() || "";
  if (sidebar.overviewActive) {
    return {
      documentTitle: paperTitle ? `${paperTitle} · 全文总览` : "全文总览",
      paperTitle,
      fileLabel: "全文总览",
    };
  }
  const note = sidebar.noteItemID ? getZoteroItem(sidebar.noteItemID) : null;
  const viewTitle = isZoteroNote(note) ? noteTitle(note) : "AI 笔记";
  const fileLabel =
    isZoteroNote(note) && isReadingRouteNote(note) ? "阅读路线" : "AI笔记";
  return {
    documentTitle: paperTitle ? `${paperTitle} · ${viewTitle}` : viewTitle,
    paperTitle,
    fileLabel,
  };
}

function waitForDocumentPaint(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    const requestFrame = doc.defaultView?.requestAnimationFrame.bind(
      doc.defaultView,
    );
    if (!requestFrame) {
      resolve();
      return;
    }
    requestFrame(() => requestFrame(() => resolve()));
  });
}

function keepOnlyActiveOverviewPane(overview: HTMLElement): void {
  const panes = Array.from(
    overview.querySelectorAll(".overview-view-pane"),
  ) as HTMLElement[];
  const activePane = panes.find((pane) => pane.classList.contains("active"));
  if (activePane) {
    for (const pane of panes) {
      if (pane !== activePane) pane.remove();
    }
  }
  overview.querySelector(".overview-view-tabs")?.remove();
  const controls = Array.from(
    overview.querySelectorAll("button,input,textarea,select"),
  ) as Element[];
  controls.forEach((control) => control.remove());
}

interface NoteHeadParts {
  head: HTMLElement;
  status: HTMLElement | null;
  save: HTMLButtonElement | null;
  close: HTMLButtonElement;
}

// Shared note-column header. Layout:
//   [grip] [ 笔记 · 路线 · 总览 ] …spacer… [action?] [status?] [⋯] [✕]
// Editable views (normal note / reading route) get the autosave `status` text
// and a `save` button (relocated into the ⋯ menu); both elements stay so the
// existing autosave + editor wiring keeps working untouched.
function renderNoteHead(
  doc: Document,
  sidebar: WindowSidebarState,
  opts: {
    view: NotePanelView;
    editable: boolean;
    action?: {
      label: string;
      title: string;
      disabled?: boolean;
      onClick: (button: HTMLButtonElement) => void;
    } | null;
    menuExtra?: HTMLButtonElement[];
  },
): NoteHeadParts {
  const head = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  head.className = "zai-note-window-head";

  const seg = buildNoteSeg(doc, sidebar, opts.view);

  const spacer = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  spacer.className = "zai-note-head-spacer";

  head.append(seg, spacer);

  if (opts.action) {
    const action = opts.action;
    const act = buttonEl(doc, action.label);
    act.className = "zai-note-act";
    act.title = action.title;
    if (action.disabled) act.disabled = true;
    act.addEventListener("click", () => action.onClick(act));
    head.append(act);
  }

  let status: HTMLElement | null = null;
  if (opts.editable) {
    status = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    status.className = "zai-note-window-status";
    status.textContent = "自动保存";
    head.append(status);
  }

  // 对话总结 writes into the AI 笔记, so it only belongs to the 笔记 view; the
  // route/overview views don't need it.
  const menuItems: HTMLButtonElement[] = [];
  if (opts.view === "normal")
    menuItems.push(buildSummaryMenuItem(doc, sidebar));
  menuItems.push(buildTabPdfExportMenuItem(doc, sidebar));
  if (opts.menuExtra) menuItems.push(...opts.menuExtra);
  if (menuItems.length) head.append(buildNoteMenu(doc, menuItems));

  const close = buttonEl(doc, "✕");
  close.className = "zai-note-icobtn";
  close.title = "关闭";
  head.append(close);

  // Editable views keep a `save` element so the autosave wiring, Ctrl+S, and
  // flush-before-switch can reference it — but it stays hidden: the note already
  // autosaves (status shows 已保存) and Ctrl+S works, so a visible manual-save
  // control is redundant clutter.
  let save: HTMLButtonElement | null = null;
  if (opts.editable) {
    save = buttonEl(doc, "保存");
    save.className = "zai-note-window-save";
    save.hidden = true;
    save.disabled = true;
    save.title = "没有未保存修改";
    head.append(save);
  }

  return { head, status, save, close };
}

async function summarizeReadingFromNoteSwitcher(
  sidebar: WindowSidebarState,
  button: HTMLButtonElement,
): Promise<void> {
  const doc = button.ownerDocument!;
  const mainWin = hostWindowForSidebar(sidebar);
  const itemID = mainWin ? safeSelectedItemID(mainWin) : null;
  const original = button.textContent ?? "对话总结";
  const restoreTitle = "用 AI 总结本篇沉浸阅读的所有就地问答，写入 AI 笔记";
  if (getReadingConversations(itemID).length === 0) {
    button.textContent = "暂无对话";
    button.title = "本篇还没有沉浸阅读的就地问答记录";
    doc.defaultView?.setTimeout(() => {
      button.textContent = original;
      button.title = restoreTitle;
    }, 1800);
    return;
  }
  button.disabled = true;
  button.textContent = "总结中…";
  const ctrl = new AbortController();
  try {
    const result = await summarizeReadingConversations(
      itemID,
      zoteroPrefs(),
      ctrl.signal,
    );
    if (!result.text) throw new Error("AI 未返回总结内容");
    const md = `## 沉浸阅读对话总结（${result.count} 段）\n\n${result.text}`;
    // Multiple summaries = replace, not stack: flush any pending editor edits,
    // then strip the prior digest section before appending the fresh one.
    await saveVisibleNoteBeforeSwitch(sidebar);
    await removePriorReadingSummary(itemID, doc);
    const written = await appendAssistantContentToItemNote(doc, itemID, md);
    button.textContent = "已写入笔记";
    // Jump to the 笔记 view so the freshly-written summary is actually visible —
    // the trigger lives in the ⋯ menu, which may be open over another view.
    const targetNote = getZoteroItem(written.noteID);
    if (isZoteroNote(targetNote)) {
      await showNoteWindow(doc, targetNote);
    } else {
      refreshVisibleNoteWindow(doc, written.noteID);
    }
  } catch (err) {
    button.textContent = "总结失败";
    button.title = err instanceof Error ? err.message : String(err);
  } finally {
    doc.defaultView?.setTimeout(() => {
      button.textContent = original;
      button.title = restoreTitle;
      button.disabled = false;
    }, 2000);
  }
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

// Navigate to the reading-route view. If a route note exists, open it; if not,
// show an empty placeholder with a generate CTA (clicking the 路线 segment must
// NOT silently generate — that's what the CTA is for).
async function openRouteView(sidebar: WindowSidebarState): Promise<void> {
  const doc = sidebar.noteMount.ownerDocument!;
  const itemID = states.get(sidebar.mount)?.itemID ?? null;
  try {
    await saveVisibleNoteBeforeSwitch(sidebar);
    const note = await findReadingRouteNote(itemID);
    if (note) {
      await showNoteWindow(doc, note);
      return;
    }
  } catch (err) {
    debugZai("route-view:open-failed", { error: errorMessage(err) });
  }
  renderRouteEmptyView(sidebar);
}

// Empty reading-route view: header (路线 active) + a centered generate CTA.
function renderRouteEmptyView(sidebar: WindowSidebarState): void {
  const doc = sidebar.noteMount.ownerDocument!;
  sidebar.noteEditorCleanup?.();
  sidebar.noteEditorCleanup = undefined;
  sidebar.overviewActive = false;
  sidebar.noteItemID = undefined;
  setNoteColumnVisible(sidebar, true);
  updateOpenNoteButton(sidebar);
  sidebar.noteMount.replaceChildren();

  const itemID = states.get(sidebar.mount)?.itemID ?? null;
  const parts = renderNoteHead(doc, sidebar, {
    view: "readingRoute",
    editable: false,
    action: null,
  });
  parts.close.addEventListener("click", () => {
    sidebar.noteMount.replaceChildren();
    setNoteColumnVisible(sidebar, false);
    updateOpenNoteButton(sidebar);
  });

  const body = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  body.className = "zai-note-window-body";
  const empty = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  empty.className = "zai-note-empty-cta";
  const msg = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  msg.textContent =
    itemID == null
      ? "请先选择一篇带 PDF 的文献，再生成阅读路线。"
      : "还没有阅读路线。";
  const cta = buttonEl(doc, "✨ 生成阅读路线");
  cta.disabled = itemID == null;
  cta.addEventListener("click", () => {
    void generateReadingRouteFromNoteSwitcher(sidebar, cta);
  });
  empty.append(msg, cta);
  body.append(empty);
  sidebar.noteMount.append(parts.head, body);
}

const OVERVIEW_PROMPT = [
  "请为当前 Zotero 论文生成「全文总览」，让我对整篇论文有全局概念，并一眼知道重点读哪几章。",
  "第一步：调用 zotero_outline_pdf 获取章节骨架（标题、字符范围、图表锚点）。",
  "第二步：基于骨架整理出：",
  "  · narrative：2–4 句中文核心讲述，结尾点出本文贡献；",
  "  · 每个章节：一句话 gist（中文，≤30 字）；phase（motivation｜method｜validation）；emphasis（innovation｜result｜normal｜background）。emphasis=innovation 的章节，其 gist 必须写清“新在哪”（本文贡献）；结果/SOTA 章节用 result；相关工作/总结等背景章节用 background。",
  "  · flowchart：问题→方法→结果及关键依赖的逻辑图；把本文新提出的部分节点 type 设为 innovation 并把 sectionNo 设为对应章节号，效果/SOTA 节点用 result，其余用 section/point。",
  "第三步：调用 render_paper_overview，把 narrative、sections（含 gist/charStart/charEnd/anchors/phase/emphasis）与 flowchart 一起渲染。网络图由关联的 GitHub 代码单独生成，不要在全文总览中生成网络图。",
  "重要：narrative 必填；每个 section 都必须带 phase 和 emphasis 两个字段，用英文值（phase: motivation|method|validation；emphasis: innovation|result|normal|background）。不要把“新：/创新：”写进 gist——改用 emphasis=innovation 表达。",
  '示例：render_paper_overview({ "narrative":"……结尾点出贡献", "sections":[ {"no":"1","title":"Introduction","gist":"动机…","phase":"motivation","emphasis":"background"}, {"no":"5","title":"Estimator Initialization","gist":"……（新在哪）","phase":"method","emphasis":"innovation"}, {"no":"9","title":"Experiments","gist":"……","phase":"validation","emphasis":"result"} ], "flowchart":{…} })。',
  "必须调用 render_paper_overview 完成渲染，不要只用文字回答。",
].join("\n");

function networkDiagramOfficialPrompt(
  sidebar: WindowSidebarState | null | undefined,
  repositoryURL?: string,
  paperTitle?: string,
): string {
  const explicitRepositoryURL = repositoryURL?.trim();
  const currentRepositoryURL =
    sidebar?.networkDiagramDraftRepositoryURL?.trim();
  return buildNetworkDiagramUserPrompt({
    repositoryURL:
      explicitRepositoryURL || currentRepositoryURL || "当前已关联仓库",
    commitSHA:
      !explicitRepositoryURL || explicitRepositoryURL === currentRepositoryURL
        ? sidebar?.networkDiagramCommitSHA
        : undefined,
    paperTitle: paperTitle ?? sidebar?.networkDiagramPaperTitle,
  });
}

function networkDiagramInstructionWithSelection(
  sidebar: WindowSidebarState,
  instruction: string,
): string {
  const node: DetailedNetworkNode | undefined =
    sidebar.networkDiagramSelectedNode;
  if (!node) return instruction;
  return [
    "[当前选中的网络图节点]",
    `id: ${node.id}`,
    `label: ${node.label}`,
    `stage: ${node.stage}`,
    node.tensorShape ? `tensorShape: ${node.tensorShape}` : "",
    `description: ${node.description}`,
    node.notes ? `parameters: ${node.notes.parameters}` : "",
    node.notes ? `dataFlow: ${node.notes.dataFlow}` : "",
    node.notes ? `objective: ${node.notes.objective}` : "",
    node.notes ? `attribution: ${node.notes.attribution}` : "",
    node.notes ? `implementation: ${node.notes.implementation}` : "",
    node.evidenceIDs.length
      ? `evidenceIDs: ${node.evidenceIDs.join(", ")}`
      : "",
    "[用户要求]",
    instruction,
  ]
    .filter(Boolean)
    .join("\n");
}

function networkDiagramPaperEvidence(data: OverviewData): EvidenceReference[] {
  return data.sections
    .filter((section) => section.phase === "method")
    .map((section) => ({
      id: `paper:section:${section.no}`,
      kind: "paper" as const,
      label: `§${section.no} ${section.title}`,
      sectionNo: section.no,
    }));
}

function networkDiagramPaperContext(data: OverviewData): string {
  return JSON.stringify(
    {
      title: data.title,
      narrative: data.narrative,
      methodSections: data.sections
        .filter((section) => section.phase === "method")
        .map((section) => ({
          no: section.no,
          title: section.title,
          gist: section.gist,
          charStart: section.charStart,
          charEnd: section.charEnd,
          anchors: section.anchors,
          emphasis: section.emphasis,
        })),
    },
    null,
    2,
  );
}

function emptyNetworkDiagramWorkspace(
  itemKey: string,
): NetworkDiagramWorkspace {
  return {
    itemKey,
    revisions: [],
    messages: [],
    evidenceIndex: [],
  };
}

function canonicalNetworkDiagramRepositoryURL(repositoryURL: string): string {
  const { owner, repo } = parsePublicGitHubRepositoryURL(repositoryURL);
  return `https://github.com/${owner}/${repo}`;
}

async function saveNetworkDiagramRepositoryLink(
  sidebar: WindowSidebarState,
  itemKey: string,
  repositoryURL: string,
): Promise<void> {
  const canonicalURL = canonicalNetworkDiagramRepositoryURL(repositoryURL);
  const stored = await loadNetworkDiagramWorkspace(itemKey);
  const workspace = stored?.workspace ?? emptyNetworkDiagramWorkspace(itemKey);
  const previousURL =
    workspace.linkedRepositoryURL ?? workspace.repository?.url ?? "";
  if (workspace.linkedRepositoryURL !== canonicalURL) {
    await saveNetworkDiagramWorkspace(itemKey, {
      ...workspace,
      linkedRepositoryURL: canonicalURL,
    });
  }
  sidebar.networkDiagramDraftRepositoryURL = canonicalURL;
  if (previousURL && previousURL !== canonicalURL) {
    sidebar.networkDiagramCommitSHA = undefined;
  }
  sidebar.networkDiagramError = undefined;
  if (sidebar.overviewActive) await showOverviewWindow(sidebar);
}

function nextNetworkDiagramRevisionID(
  workspace: NetworkDiagramWorkspace,
): string {
  const numbers = workspace.revisions
    .map((revision) => /^v(\d+)$/.exec(revision.id)?.[1])
    .filter((value): value is string => !!value)
    .map(Number)
    .filter(Number.isFinite);
  return `v${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

function networkDiagramMessageID(role: "user" | "assistant"): string {
  return `network-${role}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function mergeNetworkDiagramEvidence(
  existing: EvidenceReference[],
  incoming: EvidenceReference[],
): EvidenceReference[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()];
}

async function persistNetworkDiagramResult(
  sidebar: WindowSidebarState,
  itemKey: string,
  overview: OverviewData,
  workspace: NetworkDiagramWorkspace,
  result: NetworkDiagramAgentResult,
  instruction: string,
  mode: "initial" | "refine",
): Promise<void> {
  const revisionID = nextNetworkDiagramRevisionID(workspace);
  const parentID = workspace.currentRevisionID;
  let next = appendNetworkDiagramRevision(workspace, {
    id: revisionID,
    parentID,
    createdAt: Date.now(),
    userInstruction: instruction,
    assistantSummary: result.assistantSummary,
    usage: result.usage,
    repository: result.repository,
    graph: result.graph,
    coverage: result.coverage,
    evidenceIDs: Array.from(
      new Set(result.graph.nodes.flatMap((node) => node.evidenceIDs)),
    ),
    changedNodeIDs: result.changedNodeIDs,
  });
  const now = Date.now();
  const messages = [...next.messages];
  messages.push({
    id: networkDiagramMessageID("user"),
    role: "user",
    content: instruction,
    createdAt: now,
  });
  messages.push({
    id: networkDiagramMessageID("assistant"),
    role: "assistant",
    content: result.assistantSummary,
    createdAt: now + 1,
  });
  next = {
    ...next,
    linkedRepositoryURL: result.repository.url,
    repository: result.repository,
    messages,
    evidenceIndex: mergeNetworkDiagramEvidence(
      next.evidenceIndex,
      result.evidence,
    ),
  };
  sidebar.networkDiagramMessages = next.messages;
  sidebar.networkDiagramSelectedNode = sidebar.networkDiagramSelectedNode
    ? result.graph.nodes.find(
        (node) => node.id === sidebar.networkDiagramSelectedNode?.id,
      )
    : undefined;
  const nextOverview: OverviewData = {
    ...overview,
    networkTopology: detailedNetworkGraphToMindmap(result.graph),
  };

  // The candidate has already passed the detail/evidence gate. Keep it out of
  // the visible view until both stores have accepted the complete snapshot.
  await Promise.all([
    saveNetworkDiagramWorkspace(itemKey, next),
    saveOverview(itemKey, nextOverview),
  ]);
  const panelState = states.get(sidebar.mount);
  if (panelState?.networkDiagramTarget) {
    panelState.scrollToBottom = true;
    renderPanel(sidebar.mount, panelState);
  }
  void writeOverviewAttachment(
    sidebar.noteMount.ownerDocument!,
    panelState?.itemID ?? null,
    nextOverview,
  );
}

function initialNetworkDiagramProgress(): NetworkDiagramAnalysisProgress {
  return {
    status: "selecting-code",
    currentDetail: "正在准备论文方法上下文与仓库代码树",
    completedSteps: [],
    readFiles: [],
    readPaperSections: [],
    toolActivities: [],
    coverage: {
      "inputs-preprocess": "missing",
      "backbone-features": "missing",
      "core-innovations": "missing",
      "branches-fusion": "missing",
      "inference-path": "missing",
      "training-path": "missing",
      "parameters-tensors": "missing",
      outputs: "missing",
    },
  };
}

function refreshNetworkDiagramTaskCard(sidebar: WindowSidebarState): void {
  const panelState = states.get(sidebar.mount);
  const messages = sidebar.mount.querySelector<HTMLElement>(".messages");
  if (!panelState || !messages) return;
  const previous = messages.querySelector<HTMLElement>(
    ".network-diagram-task-card",
  );
  if (!panelState.networkDiagramTarget) {
    previous?.remove();
    return;
  }
  if (
    sidebar.networkDiagramItemKey !==
    (resolveItemKeyForCache(panelState.itemID) ?? undefined)
  ) {
    previous?.remove();
    return;
  }
  if (
    !sidebar.networkDiagramProgress &&
    !sidebar.networkDiagramBusy &&
    !sidebar.networkDiagramError
  ) {
    previous?.remove();
    return;
  }
  const card = renderNetworkDiagramAnalysisCard(
    messages.ownerDocument!,
    {
      progress: sidebar.networkDiagramProgress ?? null,
      busy: sidebar.networkDiagramBusy === true,
      error: sidebar.networkDiagramError,
    },
    { onCancel: () => cancelNetworkDiagramAnalysis(sidebar) },
  );
  if (previous) previous.replaceWith(card);
  else messages.append(card);
  if (panelState.networkDiagramAutoFollowMessages !== false) {
    messages.scrollTop = messages.scrollHeight;
  }
}

function cancelNetworkDiagramAnalysis(sidebar: WindowSidebarState): void {
  const abort = sidebar.networkDiagramAbort;
  if (!abort || !sidebar.networkDiagramBusy) return;
  sidebar.networkDiagramAbort = undefined;
  sidebar.networkDiagramBusy = false;
  if (sidebar.networkDiagramProgress) {
    sidebar.networkDiagramProgress = {
      ...sidebar.networkDiagramProgress,
      status: "cancelled",
      currentDetail: "分析已由用户停止；当前网络图和已统计 Token 均已保留",
    };
  }
  abort.abort();
  refreshNetworkDiagramTaskCard(sidebar);
  if (sidebar.overviewActive) void showOverviewWindow(sidebar);
}

async function runNetworkDiagramRequest(
  sidebar: WindowSidebarState,
  repositoryURL: string,
  instruction: string,
  mode: "initial" | "refine",
): Promise<void> {
  const panelState = states.get(sidebar.mount);
  const preset = panelState ? selectedChatPreset(panelState) : null;
  const itemKey = resolveItemKeyForCache(panelState?.itemID ?? null);
  if (!panelState || !preset || !itemKey) {
    sidebar.networkDiagramError =
      "请先选择论文，并配置一个可用的 AI 模型预设。";
    refreshNetworkDiagramTaskCard(sidebar);
    if (sidebar.overviewActive) await showOverviewWindow(sidebar);
    return;
  }
  if (sidebar.networkDiagramBusy) return;

  const [storedOverview, storedWorkspace] = await Promise.all([
    loadOverview(itemKey),
    loadNetworkDiagramWorkspace(itemKey),
  ]);
  if (!storedOverview?.data) {
    sidebar.networkDiagramError = "请先生成全文总览，再分析代码网络图。";
    refreshNetworkDiagramTaskCard(sidebar);
    if (sidebar.overviewActive) await showOverviewWindow(sidebar);
    return;
  }
  let workspace =
    storedWorkspace?.workspace ?? emptyNetworkDiagramWorkspace(itemKey);
  sidebar.networkDiagramMessages = workspace.messages;
  const currentRevision = currentNetworkDiagramRevision(workspace);
  const currentRepository = currentRevision?.repository ?? workspace.repository;
  let targetURL =
    mode === "refine" ? (currentRepository?.url ?? "") : repositoryURL.trim();
  if (mode === "refine" && (!currentRepository || !currentRevision)) {
    sidebar.networkDiagramError = "当前还没有可优化的 GitHub 网络图。";
    refreshNetworkDiagramTaskCard(sidebar);
    if (sidebar.overviewActive) await showOverviewWindow(sidebar);
    return;
  }
  if (mode === "initial") {
    try {
      targetURL = canonicalNetworkDiagramRepositoryURL(targetURL);
    } catch (error) {
      sidebar.networkDiagramError = errorMessage(error);
      refreshNetworkDiagramTaskCard(sidebar);
      if (sidebar.overviewActive) await showOverviewWindow(sidebar);
      return;
    }
    if (workspace.linkedRepositoryURL !== targetURL) {
      workspace = { ...workspace, linkedRepositoryURL: targetURL };
      await saveNetworkDiagramWorkspace(itemKey, workspace);
    }
  }

  sidebar.networkDiagramMessages = [
    ...workspace.messages,
    {
      id: networkDiagramMessageID("user"),
      role: "user",
      content: instruction,
      createdAt: Date.now(),
    },
  ];
  panelState.networkDiagramAutoFollowMessages = true;
  if (panelState.networkDiagramTarget) {
    panelState.scrollToBottom = true;
    renderPanel(sidebar.mount, panelState);
  }

  sidebar.networkDiagramAbort?.abort();
  const AbortControllerCtor =
    sidebar.noteMount.ownerDocument!.defaultView?.AbortController ??
    AbortController;
  const controller = new AbortControllerCtor();
  sidebar.networkDiagramAbort = controller;
  sidebar.networkDiagramBusy = true;
  sidebar.networkDiagramError = undefined;
  sidebar.networkDiagramProgress = initialNetworkDiagramProgress();
  sidebar.networkDiagramDraftRepositoryURL = targetURL;
  sidebar.networkDiagramCommitSHA =
    mode === "refine" ? currentRepository?.commitSHA : undefined;
  sidebar.networkDiagramPaperTitle = storedOverview.data.title;
  sidebar.overviewNav ??= { history: [], locked: false };
  sidebar.overviewNav.activeView = "network";
  if (sidebar.overviewActive) await showOverviewWindow(sidebar);
  refreshNetworkDiagramTaskCard(sidebar);

  let paperToolSession: ZoteroAgentToolSession | null = null;
  try {
    const hasLatexSource =
      panelState.itemID != null
        ? await ensureArxivSourceForItem(panelState.itemID)
        : false;
    paperToolSession = createZoteroAgentToolSession({
      source: zoteroContextSource,
      itemID: panelState.itemID,
      policy: contextPolicy,
      getActiveReader: () =>
        getReaderForCurrentSelection(
          hostWindowForMount(sidebar.mount),
          panelState.itemID,
        ),
    });
    const result = await runNetworkDiagramAgent({
      repositoryURL: targetURL,
      provider: getProvider(preset),
      preset,
      signal: controller.signal,
      paperContext: networkDiagramPaperContext(storedOverview.data),
      paperEvidence: networkDiagramPaperEvidence(storedOverview.data),
      paperSourceMode: hasLatexSource ? "latex" : "pdf",
      paperTools: quickAskReadOnlyTools(paperToolSession.tools).filter((tool) =>
        [
          "zotero_search_pdf",
          "zotero_read_pdf_range",
          "zotero_get_full_pdf",
          "arxiv_list_sections",
          "arxiv_get_section",
          "arxiv_get_equation",
          "arxiv_get_figure",
          "arxiv_get_table",
        ].includes(tool.name),
      ),
      existingEvidence: mode === "refine" ? workspace.evidenceIndex : undefined,
      currentGraph: mode === "refine" ? currentRevision?.graph : undefined,
      mode,
      userInstruction: networkDiagramInstructionWithSelection(
        sidebar,
        instruction,
      ),
      pinnedRepository: mode === "refine" ? currentRepository : undefined,
      conversationContext:
        mode === "refine"
          ? JSON.stringify(workspace.messages.slice(-8))
          : undefined,
      promptCacheKey: buildPromptCacheKey(preset, panelState.itemID),
      relayRoutingItemKey: itemKey,
      toolSettings: loadToolSettings(zoteroPrefs()),
      onProgress: (progress) => {
        if (
          controller.signal.aborted ||
          sidebar.networkDiagramAbort !== controller
        )
          return;
        sidebar.networkDiagramProgress = progress;
        refreshNetworkDiagramTaskCard(sidebar);
      },
    });
    if (controller.signal.aborted || sidebar.networkDiagramAbort !== controller)
      return;
    await persistNetworkDiagramResult(
      sidebar,
      itemKey,
      storedOverview.data,
      workspace,
      result,
      instruction,
      mode,
    );
    sidebar.networkDiagramDraftRepositoryURL = result.repository.url;
    sidebar.networkDiagramCommitSHA = result.repository.commitSHA;
  } catch (error) {
    if (!controller.signal.aborted) {
      sidebar.networkDiagramError = errorMessage(error);
      refreshNetworkDiagramTaskCard(sidebar);
    }
  } finally {
    paperToolSession?.dispose();
    if (sidebar.networkDiagramAbort === controller) {
      sidebar.networkDiagramAbort = undefined;
      sidebar.networkDiagramBusy = false;
      if (sidebar.overviewActive) await showOverviewWindow(sidebar);
      refreshNetworkDiagramTaskCard(sidebar);
    }
  }
}

async function switchNetworkDiagramRevision(
  sidebar: WindowSidebarState,
  target: "undo" | "latest",
): Promise<void> {
  const panelState = states.get(sidebar.mount);
  const itemKey = resolveItemKeyForCache(panelState?.itemID ?? null);
  if (!itemKey || sidebar.networkDiagramBusy) return;
  const [storedOverview, storedWorkspace] = await Promise.all([
    loadOverview(itemKey),
    loadNetworkDiagramWorkspace(itemKey),
  ]);
  if (!storedOverview?.data || !storedWorkspace?.workspace) return;
  const next =
    target === "undo"
      ? undoNetworkDiagramRevision(storedWorkspace.workspace)
      : restoreLatestNetworkDiagramRevision(storedWorkspace.workspace);
  const revision = currentNetworkDiagramRevision(next);
  if (!revision) return;
  sidebar.networkDiagramSelectedNode = sidebar.networkDiagramSelectedNode
    ? revision.graph.nodes.find(
        (node) => node.id === sidebar.networkDiagramSelectedNode?.id,
      )
    : undefined;
  const nextOverview: OverviewData = {
    ...storedOverview.data,
    networkTopology: detailedNetworkGraphToMindmap(revision.graph),
  };
  await Promise.all([
    saveNetworkDiagramWorkspace(itemKey, next),
    saveOverview(itemKey, nextOverview),
  ]);
  void writeOverviewAttachment(
    sidebar.noteMount.ownerDocument!,
    panelState?.itemID ?? null,
    nextOverview,
  );
  if (sidebar.overviewActive) await showOverviewWindow(sidebar);
}

// Collect the plugin's own stylesheet rules so the browser export looks the
// same outside Zotero. Skips unreadable (cross-origin) sheets.
async function showOverviewWindow(sidebar: WindowSidebarState): Promise<void> {
  const doc = sidebar.noteMount.ownerDocument!;
  sidebar.noteEditorCleanup?.();
  sidebar.noteEditorCleanup = undefined;
  sidebar.noteItemID = undefined;
  sidebar.overviewActive = true;
  setNoteColumnVisible(sidebar, true);
  updateOpenNoteButton(sidebar);

  const panelState = states.get(sidebar.mount);
  const itemID = panelState?.itemID ?? null;
  const itemKey = resolveItemKeyForCache(itemID);
  if (sidebar.networkDiagramItemKey !== (itemKey ?? undefined)) {
    sidebar.networkDiagramAbort?.abort();
    sidebar.networkDiagramAbort = undefined;
    sidebar.networkDiagramBusy = false;
    sidebar.networkDiagramProgress = undefined;
    sidebar.networkDiagramMessages = undefined;
    sidebar.networkDiagramSelectedNode = undefined;
    sidebar.networkDiagramError = undefined;
    sidebar.networkDiagramDraftRepositoryURL = undefined;
    sidebar.networkDiagramCommitSHA = undefined;
    sidebar.networkDiagramPaperTitle = undefined;
    sidebar.networkDiagramItemKey = itemKey ?? undefined;
  }
  const [stored, storedNetworkDiagram] = itemKey
    ? await Promise.all([
        loadOverview(itemKey),
        loadNetworkDiagramWorkspace(itemKey),
      ])
    : [null, null];
  // The user may have switched away while the async load was in flight.
  if (!sidebar.overviewActive) return;
  if (!sidebar.networkDiagramBusy) {
    sidebar.networkDiagramMessages =
      storedNetworkDiagram?.workspace.messages ?? [];
    const loadedWorkspace = storedNetworkDiagram?.workspace;
    const loadedRevision = loadedWorkspace
      ? currentNetworkDiagramRevision(loadedWorkspace)
      : undefined;
    const loadedRepositoryURL =
      loadedWorkspace?.linkedRepositoryURL ??
      loadedRevision?.repository?.url ??
      loadedWorkspace?.repository?.url;
    if (loadedRepositoryURL) {
      sidebar.networkDiagramDraftRepositoryURL = loadedRepositoryURL;
    }
    sidebar.networkDiagramCommitSHA =
      loadedRevision?.repository?.commitSHA ??
      loadedWorkspace?.repository?.commitSHA;
    sidebar.networkDiagramPaperTitle = stored?.data?.title;
  }

  // Restore this item's persisted 在读 anchor (survives restart + syncs across
  // machines). The back stack / lock stay ephemeral.
  if (stored?.data && itemKey && sidebar.overviewNavItemKey !== itemKey) {
    const rec = await loadReading(itemKey);
    if (!sidebar.overviewActive) return;
    sidebar.overviewNav = {
      history: [],
      locked: false,
      readingNo: rec?.readingNo,
    };
    sidebar.overviewNavItemKey = itemKey;
  }

  sidebar.noteMount.replaceChildren();

  const overviewExtra: HTMLButtonElement[] = [];
  if (stored?.data) {
    const openBtn = buttonEl(doc, "🌐 在浏览器打开总览");
    openBtn.title = "把总览导出为自包含 HTML 并在浏览器打开";
    openBtn.addEventListener(
      "click",
      () => void openOverviewInBrowser(sidebar),
    );
    overviewExtra.push(openBtn);
  }
  const parts = renderNoteHead(doc, sidebar, {
    view: "overview",
    editable: false,
    action: stored?.data
      ? {
          label: "↻ 更新总览",
          title:
            itemID == null
              ? "请先选择一篇带 PDF 的文献"
              : "调用工具重新生成全文总览",
          disabled: itemID == null,
          onClick: (button) => void generateOverviewIntoPanel(sidebar, button),
        }
      : null,
    menuExtra: overviewExtra,
  });
  const head = parts.head;
  parts.close.addEventListener("click", () => {
    sidebar.overviewActive = false;
    sidebar.noteMount.replaceChildren();
    setNoteColumnVisible(sidebar, false);
    updateOpenNoteButton(sidebar);
  });

  const body = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  body.className = "zai-note-window-body zai-overview-window-body";
  if (stored?.data) {
    body.append(
      renderOverviewBlock(doc, stored.data, {
        nav: (sidebar.overviewNav ??= { history: [], locked: false }),
        maxBack: contextPolicy.overviewBackStackMax,
        onJumpToSection: panelState
          ? (section) => {
              void jumpToOverviewSection(sidebar.mount, panelState, section);
              // Persist the (possibly new) 在读 anchor so it survives restart
              // and syncs across machines. nav.readingNo is already updated.
              if (itemKey && stored?.data) {
                void saveReading(itemKey, {
                  readingNo: sidebar.overviewNav?.readingNo,
                  title: stored.data.title,
                });
              }
            }
          : undefined,
        onOpenInBrowser: () => void openOverviewInBrowser(sidebar),
        onViewChange: (view) => {
          if (view !== "network" && panelState?.networkDiagramTarget) {
            deactivateNetworkDiagramTarget(sidebar.mount, panelState);
          } else if (panelState) renderPanel(sidebar.mount, panelState);
        },
        networkDiagram:
          panelState && itemKey
            ? {
                state: {
                  workspace: storedNetworkDiagram?.workspace ?? null,
                  progress: sidebar.networkDiagramProgress ?? null,
                  busy: sidebar.networkDiagramBusy === true,
                  error: sidebar.networkDiagramError,
                  draftRepositoryURL: sidebar.networkDiagramDraftRepositoryURL,
                  targetActive: panelState.networkDiagramTarget === true,
                },
                handlers: {
                  onAnalyze: (repositoryURL) => {
                    const currentURL =
                      storedNetworkDiagram?.workspace.linkedRepositoryURL ??
                      storedNetworkDiagram?.workspace.repository?.url;
                    if (
                      currentURL &&
                      repositoryURL.trim() !== currentURL &&
                      doc.defaultView?.confirm &&
                      !doc.defaultView.confirm(
                        "要更换 GitHub 仓库吗？当前网络图版本仍会保留，可通过版本记录查看。",
                      )
                    ) {
                      return;
                    }
                    activateNetworkDiagramTarget(sidebar.mount, panelState);
                    void runNetworkDiagramRequest(
                      sidebar,
                      repositoryURL,
                      networkDiagramOfficialPrompt(
                        sidebar,
                        repositoryURL,
                        stored.data.title,
                      ),
                      "initial",
                    );
                  },
                  onSaveRepository: (repositoryURL) =>
                    saveNetworkDiagramRepositoryLink(
                      sidebar,
                      itemKey,
                      repositoryURL,
                    ),
                  onAskNetwork: (instruction) => {
                    if (!instruction && panelState.networkDiagramTarget) {
                      deactivateNetworkDiagramTarget(sidebar.mount, panelState);
                    } else {
                      activateNetworkDiagramTarget(
                        sidebar.mount,
                        panelState,
                        instruction,
                      );
                    }
                  },
                  onSelectNode: (node) => {
                    sidebar.networkDiagramSelectedNode = node;
                    if (panelState.networkDiagramTarget) {
                      renderPanel(sidebar.mount, panelState);
                    }
                  },
                  onOptimizeNode: (node) => {
                    sidebar.networkDiagramSelectedNode = node;
                    activateNetworkDiagramTarget(sidebar.mount, panelState);
                  },
                  onUndo: () =>
                    void switchNetworkDiagramRevision(sidebar, "undo"),
                  onRestoreLatest: () =>
                    void switchNetworkDiagramRevision(sidebar, "latest"),
                },
              }
            : undefined,
      }),
    );
  } else {
    const empty = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    empty.className = "zai-note-empty-cta";
    const msg = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    msg.textContent =
      itemID == null
        ? "请先选择一篇带 PDF 的文献，再生成全文总览。"
        : "还没有全文总览。";
    const cta = buttonEl(doc, "✨ 生成全文总览");
    cta.disabled = itemID == null;
    cta.addEventListener("click", () => {
      void generateOverviewIntoPanel(sidebar, cta);
    });
    empty.append(msg, cta);
    body.append(empty);
  }
  sidebar.noteMount.append(head, body);

  // Pre-warm the expensive bits a section click needs, in the background, so the
  // first jump is fast: the PDF text-layer extraction (per Reader) and the LaTeX
  // section parse (per arXiv paper). Both are cached, so this is a no-op on later opens.
  if (stored?.data && itemID != null) {
    const reader = getReaderForAttachmentOrItem(doc.defaultView, itemID, null);
    if (reader) void getSharedPdfLocator(reader).catch(() => undefined);
    const arxivId = resolveArxivIdForItemID(itemID);
    if (arxivId) void cachedArxivSections(arxivId).catch(() => undefined);
  }
}

async function showFullTranslation(sidebar: WindowSidebarState): Promise<void> {
  const panelState = states.get(sidebar.mount);
  const itemID = panelState?.itemID ?? null;
  const arxivId = resolveArxivIdForItemID(itemID);
  const tabID = activeReaderTabID(sidebar);
  if (!arxivId || !tabID) {
    closeFullTranslation(sidebar);
    return;
  }

  const request = Symbol(arxivId);
  fullTranslationRequests.set(sidebar, request);
  await saveVisibleNoteBeforeSwitch(sidebar);
  if (fullTranslationRequests.get(sidebar) !== request) return;
  if (!sidebar.fullTranslationActive) {
    fullTranslationNoteVisibility.set(sidebar, noteColumnIsVisible(sidebar));
    fullTranslationModelSettingsOpen.set(sidebar, false);
  }
  sidebar.fullTranslationActive = true;
  setNoteColumnVisible(sidebar, false);
  if (!ensureFullTranslationHost(sidebar, tabID)) {
    closeFullTranslation(sidebar);
    return;
  }

  const previous = fullTranslationSessions.get(sidebar);
  if (previous?.document.arxivId === arxivId) {
    renderFullTranslationPanel(sidebar);
    await loadFullTranslationAssets(sidebar, previous, request);
    return;
  }
  if (previous && previous.document.arxivId !== arxivId) {
    sidebar.fullTranslationAbort?.abort();
    sidebar.fullTranslationAbort = undefined;
    fullTranslationSessions.delete(sidebar);
  }

  renderFullTranslationNotice(sidebar, "正在读取 LaTeX 全文…");

  try {
    const session = await loadFullTranslationSession(arxivId);
    if (!isCurrentFullTranslation(sidebar, arxivId, request)) return;
    if (!session) {
      renderFullTranslationNotice(
        sidebar,
        "当前条目没有可用的 LaTeX 正文，无法进行全文翻译。",
        true,
      );
      return;
    }
    fullTranslationSessions.set(sidebar, session);
    renderFullTranslationPanel(sidebar);
    await loadFullTranslationAssets(sidebar, session, request);
  } catch (error) {
    if (!isCurrentFullTranslation(sidebar, arxivId, request)) return;
    renderFullTranslationNotice(sidebar, errorMessage(error), true);
  }
}

function activeReaderTabID(sidebar: WindowSidebarState): string | null {
  const win = hostWindowForSidebar(sidebar);
  const tabID = (win as any)?.Zotero_Tabs?.selectedID;
  return typeof tabID === "string" && getActiveReader(win) ? tabID : null;
}

function ensureFullTranslationHost(
  sidebar: WindowSidebarState,
  tabID = activeReaderTabID(sidebar),
): FullTranslationHost | null {
  if (!tabID) return null;
  const previous = fullTranslationHosts.get(sidebar);
  if (previous?.container.id === tabID && previous.root.isConnected) {
    syncFullTranslationHostBounds(previous);
    return previous;
  }
  if (previous) unmountFullTranslationHost(previous);
  const hostWindow = hostWindowForSidebar(sidebar);
  if (!hostWindow) return null;
  const host = mountFullTranslationHost(
    hostWindow.document,
    tabID,
    [],
    sidebar.splitter,
  );
  if (host) fullTranslationHosts.set(sidebar, host);
  else fullTranslationHosts.delete(sidebar);
  return host;
}

function syncFullTranslationHostLayout(sidebar: WindowSidebarState): void {
  const host = fullTranslationHosts.get(sidebar);
  if (host?.root.isConnected) syncFullTranslationHostBounds(host);
}

async function loadFullTranslationAssets(
  sidebar: WindowSidebarState,
  session: FullTranslationSession,
  request: symbol,
): Promise<void> {
  const doc = hostWindowForSidebar(sidebar)?.document;
  if (!doc) return;
  try {
    session.assets = await loadFullTranslationAssetPreviews(
      session.document,
      doc,
      (path, preview) => {
        if (
          !isCurrentFullTranslation(
            sidebar,
            session.document.arxivId,
            request,
          ) ||
          fullTranslationSessions.get(sidebar) !== session
        ) {
          return;
        }
        session.assets[path] = preview;
        const host = fullTranslationHosts.get(sidebar);
        if (host?.root.isConnected) {
          updateFullTranslationAssetPreview(host.root, path, preview);
        }
      },
    );
  } catch (error) {
    debugZai("full-translation:assets-failed", {
      arxivId: session.document.arxivId,
      error: errorMessage(error),
    });
  }
  if (
    !isCurrentFullTranslation(sidebar, session.document.arxivId, request) ||
    fullTranslationSessions.get(sidebar) !== session
  ) {
    return;
  }
  renderFullTranslationPanel(sidebar);
}

function renderFullTranslationPanel(sidebar: WindowSidebarState): void {
  if (!sidebar.fullTranslationActive) return;
  const session = fullTranslationSessions.get(sidebar);
  if (!session) return;
  const host = ensureFullTranslationHost(sidebar);
  if (!host) return;
  const doc = host.root.ownerDocument!;
  const scrollTop =
    host.root.querySelector<HTMLElement>(".zai-ft-content")?.scrollTop ?? 0;
  const panelState = states.get(sidebar.mount);
  const readingSettings =
    panelState?.localUiSettings.fullTranslationReading ??
    DEFAULT_LOCAL_UI_SETTINGS.fullTranslationReading;
  const expandedSourceBlockId = host.root.querySelector<HTMLElement>(
    ".zai-ft-block.is-source-peek[data-block-id]",
  )?.dataset.blockId;
  const currentView = host.root.querySelector<HTMLElement>(
    ".zai-full-translation",
  );
  const highlightedSourceQuote =
    currentView?.dataset.sourceQuoteBlockId && currentView.dataset.sourceQuote
      ? {
          blockId: currentView.dataset.sourceQuoteBlockId,
          quote: currentView.dataset.sourceQuote,
        }
      : undefined;
  const modelSettings = fullTranslationModelSettings(sidebar);
  const view = renderFullTranslationView(doc, {
    document: session.document,
    state: session.state,
    layout: readingSettings.layout,
    running: !!sidebar.fullTranslationAbort,
    preparing: session.preparing,
    runError: session.runError,
    assets: session.assets,
    readingSettings,
    expandedSourceBlockId,
    highlightedSourceQuote,
    ...(modelSettings
      ? {
          modelSettings,
          onToggleModelSettings: () => {
            fullTranslationModelSettingsOpen.set(
              sidebar,
              !fullTranslationModelSettingsOpen.get(sidebar),
            );
            renderFullTranslationPanel(sidebar);
          },
          onModelPresetChange: (presetId: string) =>
            updateFullTranslationModelPreset(sidebar, presetId),
          onModelChange: (model: string) =>
            updateFullTranslationModel(sidebar, model),
          onModelThinkingChange: (thinking: TranslateThinking) =>
            updateFullTranslationThinking(sidebar, thinking),
        }
      : {}),
    onLayoutChange: (next) => {
      updateFullTranslationReadingSettings(sidebar, {
        ...readingSettings,
        layout: next,
      });
    },
    onReadingSettingsChange: (next) =>
      updateFullTranslationReadingSettings(sidebar, next),
    onRun: () => void startFullTranslation(sidebar),
    onRetranslate: () => void restartFullTranslation(sidebar),
    onTranslateBlock: (blockId) =>
      void startFullTranslation(sidebar, undefined, blockId),
    onCancel: () => sidebar.fullTranslationAbort?.abort(),
    onExit: () => closeFullTranslation(sidebar),
  });
  const captureSelection = () => {
    const itemID = states.get(sidebar.mount)?.itemID ?? null;
    const before = getStoredSelectedText(itemID);
    const after = refreshFullTranslationSelection(sidebar, itemID, false);
    if (before !== after) updateSelectionIndicators(sidebar.mount, itemID);
  };
  view.addEventListener("mouseup", captureSelection);
  view.addEventListener("keyup", captureSelection);
  host.root.replaceChildren(view);
  const content = host.root.querySelector<HTMLElement>(".zai-ft-content");
  if (content) content.scrollTop = scrollTop;
}

function fullTranslationModelSettings(
  sidebar: WindowSidebarState,
): FullTranslationModelSettings | undefined {
  try {
    const prefs = zoteroPrefs();
    const resolved = resolveFullDocumentModelSelection(prefs);
    const presets = loadPresets(prefs).filter(
      (preset) => fullDocumentModelsForPreset(preset).length > 0,
    );
    return {
      ...resolved.selection,
      presetLabel: resolved.preset.label,
      inherited: resolved.inherited,
      open: fullTranslationModelSettingsOpen.get(sidebar) === true,
      presets: presets.map((preset) => ({
        id: preset.id,
        label: presetSelectLabel(preset),
      })),
      models: fullDocumentModelsForPreset(resolved.preset),
      thinkingOptions: fullDocumentThinkingOptions(resolved.preset),
    };
  } catch {
    return undefined;
  }
}

function updateFullTranslationModelPreset(
  sidebar: WindowSidebarState,
  presetId: string,
): void {
  const prefs = zoteroPrefs();
  const current = resolveFullDocumentModelSelection(prefs);
  const preset = loadPresets(prefs).find(
    (candidate) => candidate.id === presetId,
  );
  if (!preset) return;
  const model = fullDocumentModelsForPreset(preset)[0];
  if (!model) return;
  saveFullDocumentModelSelection(prefs, {
    presetId,
    model,
    thinking: collapseFullDocumentThinking(preset, current.selection.thinking),
  });
  renderFullTranslationPanel(sidebar);
}

function updateFullTranslationModel(
  sidebar: WindowSidebarState,
  model: string,
): void {
  const prefs = zoteroPrefs();
  const current = resolveFullDocumentModelSelection(prefs);
  if (!fullDocumentModelsForPreset(current.preset).includes(model)) return;
  saveFullDocumentModelSelection(prefs, { ...current.selection, model });
  renderFullTranslationPanel(sidebar);
}

function updateFullTranslationThinking(
  sidebar: WindowSidebarState,
  thinking: TranslateThinking,
): void {
  const prefs = zoteroPrefs();
  const current = resolveFullDocumentModelSelection(prefs);
  if (
    !fullDocumentThinkingOptions(current.preset).some(
      ([value]) => value === thinking,
    )
  ) {
    return;
  }
  saveFullDocumentModelSelection(prefs, { ...current.selection, thinking });
  renderFullTranslationPanel(sidebar);
}

function updateFullTranslationReadingSettings(
  sidebar: WindowSidebarState,
  readingSettings: FullTranslationReadingSettings,
): void {
  const state = states.get(sidebar.mount);
  if (!state) return;
  state.localUiSettings = normalizeLocalUiSettings({
    ...state.localUiSettings,
    fullTranslationReading: readingSettings,
  });
  saveLocalUiSettings(zoteroPrefs(), state.localUiSettings);
  renderFullTranslationPanel(sidebar);
}

async function restartFullTranslation(
  sidebar: WindowSidebarState,
): Promise<void> {
  const session = fullTranslationSessions.get(sidebar);
  if (!session || sidebar.fullTranslationAbort) return;

  let prepared: PreparedFullTranslationRun;
  try {
    const controller = new AbortController();
    prepared = {
      controller,
      translator: createFullDocumentTranslator(
        zoteroPrefs(),
        controller.signal,
      ),
    };
  } catch (error) {
    session.runError = errorMessage(error);
    renderFullTranslationPanel(sidebar);
    return;
  }

  const previousState = session.state;
  session.runError = undefined;
  session.preparing = true;
  session.state = createFullTranslationState(
    session.document,
    prepared.translator.preset.id,
    prepared.translator.model,
  );
  renderFullTranslationPanel(sidebar);
  try {
    await saveFullTranslationState(session.state);
  } catch (error) {
    session.state = previousState;
    session.preparing = false;
    session.runError = errorMessage(error);
    if (fullTranslationSessions.get(sidebar) === session) {
      renderFullTranslationPanel(sidebar);
    }
    return;
  }
  if (
    fullTranslationSessions.get(sidebar) !== session ||
    !isCurrentFullTranslation(sidebar, session.document.arxivId)
  ) {
    session.preparing = false;
    return;
  }
  session.preparing = false;
  await startFullTranslation(sidebar, prepared);
}

function renderFullTranslationNotice(
  sidebar: WindowSidebarState,
  message: string,
  error = false,
): void {
  if (!sidebar.fullTranslationActive) return;
  const host = ensureFullTranslationHost(sidebar);
  if (!host) return;
  const doc = host.root.ownerDocument!;
  const body = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  body.className = "zai-ft-notice-frame";
  const notice = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  notice.className = `zai-ft-notice${error ? " is-error" : ""}`;
  notice.textContent = message;
  const exit = buttonEl(doc, "返回 PDF");
  exit.className = "zai-ft-exit";
  exit.addEventListener("click", () => closeFullTranslation(sidebar));
  body.append(notice, exit);
  host.root.replaceChildren(body);
}

async function startFullTranslation(
  sidebar: WindowSidebarState,
  prepared?: PreparedFullTranslationRun,
  targetBlockId?: string,
): Promise<void> {
  const session = fullTranslationSessions.get(sidebar);
  if (!session || sidebar.fullTranslationAbort || session.preparing) return;
  const controller = prepared?.controller ?? new AbortController();
  sidebar.fullTranslationAbort = controller;
  session.runError = undefined;
  let fatalError = "";

  try {
    const translator =
      prepared?.translator ??
      createFullDocumentTranslator(zoteroPrefs(), controller.signal);
    session.state = {
      ...session.state,
      presetId: translator.preset.id,
      model: translator.model,
    };
    await saveFullTranslationState(session.state);
    renderFullTranslationPanel(sidebar);
    session.state = await runFullDocumentTranslation({
      document: session.document,
      state: session.state,
      signal: controller.signal,
      targetBlockId,
      translate: translator.translate,
      onState: async (state) => {
        session.state = state;
        await saveFullTranslationState(state);
        if (fullTranslationSessions.get(sidebar) === session) {
          renderFullTranslationPanel(sidebar);
        }
      },
    });
    await saveFullTranslationState(session.state);
  } catch (error) {
    fatalError = errorMessage(error);
    debugZai("full-translation:run-failed", {
      arxivId: session.document.arxivId,
      error: fatalError,
    });
  } finally {
    if (sidebar.fullTranslationAbort === controller) {
      sidebar.fullTranslationAbort = undefined;
    }
    if (
      fullTranslationSessions.get(sidebar) === session &&
      isCurrentFullTranslation(sidebar, session.document.arxivId)
    ) {
      session.runError = fatalError || undefined;
      renderFullTranslationPanel(sidebar);
    }
  }
}

function closeFullTranslation(sidebar: WindowSidebarState): void {
  sidebar.fullTranslationActive = false;
  fullTranslationRequests.delete(sidebar);
  const host = fullTranslationHosts.get(sidebar);
  if (host) unmountFullTranslationHost(host);
  fullTranslationHosts.delete(sidebar);
  fullTranslationModelSettingsOpen.delete(sidebar);
  const hadNoteSnapshot = fullTranslationNoteVisibility.has(sidebar);
  const restoreNote = fullTranslationNoteVisibility.get(sidebar) === true;
  fullTranslationNoteVisibility.delete(sidebar);
  if (hadNoteSnapshot) setNoteColumnVisible(sidebar, restoreNote);
  updateOpenNoteButton(sidebar);
}

function isCurrentFullTranslation(
  sidebar: WindowSidebarState,
  arxivId: string,
  request?: symbol,
): boolean {
  const itemID = states.get(sidebar.mount)?.itemID ?? null;
  return (
    sidebar.fullTranslationActive === true &&
    (request == null || fullTranslationRequests.get(sidebar) === request) &&
    resolveArxivIdForItemID(itemID) === arxivId
  );
}

function noteColumnIsVisible(sidebar: WindowSidebarState): boolean {
  const column = sidebar.noteColumn as Element & {
    hidden?: boolean;
    collapsed?: boolean;
  };
  return !(
    column.hidden ||
    column.collapsed ||
    column.getAttribute("hidden") === "true" ||
    column.getAttribute("collapsed") === "true"
  );
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
  const originalText = button.textContent || "生成总览";
  const originalTitle = button.title;
  button.textContent = "生成中...";
  button.disabled = true;
  try {
    await sendMessage(sidebar.mount, state, OVERVIEW_PROMPT, {
      taskTitle: "生成总览",
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
    syncDockedWorkspaceLayout(state);
    const docked = dockedSidebarLayouts.get(state);
    if (docked) fitDockedWorkspaceToWindow(docked, state);
    return;
  }
  noteColumn.collapsed = true;
  state.noteColumn.setAttribute("collapsed", "true");
  state.noteColumn.setAttribute("hidden", "true");
  state.noteSplitter.setAttribute("hidden", "true");
  syncDockedWorkspaceLayout(state);
  const docked = dockedSidebarLayouts.get(state);
  if (docked) fitDockedWorkspaceToWindow(docked, state);
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
  mount: HTMLElement,
  itemID: number | null,
  message: Message,
  button: HTMLButtonElement,
  pdfSelection: PdfSelectionLocator | null = null,
) {
  const chatScroll = lockMessagesScroll(mount);
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
    lockMessagesScroll(mount, chatScroll);
    refreshVisibleNoteWindow(doc, result.noteID, noteScroll);
    scheduleMessagesScrollRestore(mount, chatScroll);
  } catch (err) {
    lockMessagesScroll(mount, chatScroll);
    scheduleMessagesScrollRestore(mount, chatScroll);
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
    { parentNoteID: target.note.id },
  );
  const usedBetterNotes = await insertHTMLIntoNote(target.note, html);
  return {
    noteID: target.note.id,
    created: target.created,
    usedBetterNotes,
  };
}

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

function renderWebAnnotationBatch(
  doc: Document,
  mount: HTMLElement,
  state: PanelState,
  message: Message,
  batch: WebAnnotationBatchDraft,
): HTMLElement {
  const box = el(doc, "section", "web-annotation-batch");
  const located = batch.entries.filter(
    (entry) => entry.locateState === "located",
  );
  const saved = located.filter((entry) => entry.state.kind === "saved");
  const unresolved = batch.entries.length - located.length;
  const head = el(doc, "div", "web-annotation-batch-head");
  head.append(
    el(doc, "strong", "", `📌 PDF 标注草稿 · ${batch.entries.length}`),
    el(
      doc,
      "span",
      "web-annotation-batch-summary",
      saved.length
        ? `已保存 ${saved.length} · 已定位 ${located.length}`
        : `已定位 ${located.length}${unresolved ? ` · 待检查 ${unresolved}` : ""}`,
    ),
  );
  box.append(head);

  if (batch.error) {
    box.append(el(doc, "div", "web-annotation-batch-error", batch.error));
  }

  const list = el(doc, "div", "web-annotation-batch-list");
  batch.entries.forEach((entry, index) => {
    const row = el(doc, "div", "web-annotation-batch-row");
    const status =
      entry.state.kind === "saved"
        ? "✓"
        : entry.state.kind === "failed"
          ? "⚠"
        : entry.locateState === "located"
          ? "●"
          : entry.locateState === "pending"
            ? "…"
            : "⚠";
    const main = buttonEl(doc, "");
    main.className = "web-annotation-batch-entry";
    main.disabled = !entry.snapshot;
    main.title = entry.snapshot
      ? "在 PDF 中查看这条原文"
      : "这条原文尚未在当前 PDF 中可靠定位";
    const label = el(
      doc,
      "span",
      "web-annotation-batch-entry-label",
      `${status} ${index + 1}. ${entry.comment}`,
    );
    const meta = el(
      doc,
      "small",
      "web-annotation-batch-entry-meta",
      entry.segments?.length && entry.state.kind === "failed"
        ? `已保存 ${entry.segments.filter((segment) => segment.state.kind === "saved").length}/${entry.segments.length} · 保存失败`
        : entry.snapshot
        ? `第 ${entry.pageLabel || "?"} 页 · ${
            entry.segments?.length
              ? "跨页精确匹配"
              : entry.confidence === 1
                ? "精确匹配"
                : `相似度 ${Math.round((entry.confidence ?? 0) * 100)}%`
          }`
        : webAnnotationLocateLabel(entry.locateState),
    );
    main.append(label, meta);
    if (entry.color) {
      const chip = el(doc, "span", "web-annotation-batch-color");
      chip.style.setProperty("--annotation-color", entry.color);
      chip.title = entry.color;
      main.append(chip);
    }
    main.addEventListener("click", () => {
      if (!entry.snapshot) return;
      void jumpToPdfSelectionPreview(
        mount,
        state,
        pdfSelectionFromAnnotationSnapshot(entry.snapshot),
      );
    });
    row.append(main);
    list.append(row);
  });
  box.append(list);

  const actions = el(doc, "div", "web-annotation-batch-actions");
  const preview = buttonEl(doc, "在 PDF 中预览");
  const firstLocated = located.find((entry) => !!entry.snapshot);
  preview.disabled = !firstLocated?.snapshot;
  preview.addEventListener("click", () => {
    if (!firstLocated?.snapshot) return;
    void jumpToPdfSelectionPreview(
      mount,
      state,
      pdfSelectionFromAnnotationSnapshot(firstLocated.snapshot),
    );
  });
  const retry = buttonEl(doc, "重新定位");
  retry.disabled = batch.entries.every(
    (entry) => entry.locateState === "located" || entry.state.kind === "saved",
  );
  retry.addEventListener("click", () => {
    for (const entry of batch.entries) {
      if (
        entry.state.kind === "saved" ||
        entry.segments?.some((segment) => segment.state.kind === "saved")
      ) {
        continue;
      }
      entry.locateState = "pending";
      entry.state = { kind: "idle" };
      delete entry.snapshot;
      delete entry.segments;
      delete entry.pageLabel;
      delete entry.confidence;
    }
    delete batch.error;
    renderPanel(mount, state);
    void locateWebAnnotationBatch(mount, state, message);
  });
  const save = buttonEl(
    doc,
    saved.length ? "保存剩余已定位条目" : "保存全部已定位条目",
  );
  save.className = "web-annotation-batch-save";
  save.disabled = !located.some(
    (entry) => entry.state.kind !== "saved" && entry.state.kind !== "saving",
  );
  save.addEventListener("click", () => {
    save.blur();
    void saveWebAnnotationBatch(mount, state, message);
  });
  actions.append(preview, retry, save);
  box.append(actions);
  return box;
}

function webAnnotationLocateLabel(
  state: WebAnnotationBatchDraft["entries"][number]["locateState"],
): string {
  switch (state) {
    case "pending":
      return "等待本地定位";
    case "not_found":
      return "未在 PDF 中可靠找到";
    case "failed":
      return "定位失败";
    case "located":
      return "已定位";
  }
}

function pdfSelectionFromAnnotationSnapshot(
  snapshot: AssistantAnnotationDraft["snapshot"],
): PdfSelectionLocator {
  const annotation = snapshot.annotation;
  const position = annotation.position;
  const pageIndex =
    position &&
    typeof position === "object" &&
    typeof (position as { pageIndex?: unknown }).pageIndex === "number"
      ? (position as { pageIndex: number }).pageIndex
      : undefined;
  return {
    attachmentID: snapshot.attachmentID,
    selectedText: snapshot.text,
    ...(pageIndex != null ? { pageIndex } : {}),
    ...(typeof annotation.pageLabel === "string"
      ? { pageLabel: annotation.pageLabel }
      : {}),
    position:
      position && typeof position === "object"
        ? (position as Record<string, unknown>)
        : {},
  };
}

async function saveWebAnnotationBatch(
  mount: HTMLElement,
  state: PanelState,
  message: Message,
): Promise<void> {
  const batch = message.webAnnotationBatch;
  if (!batch) return;
  const targets = batch.entries.filter(
    (entry) =>
      entry.locateState === "located" &&
      !!entry.snapshot &&
      entry.state.kind !== "saved" &&
      entry.state.kind !== "saving",
  );
  if (!targets.length) return;
  const scrollSnapshot = lockMessagesScroll(mount);
  for (const entry of targets) entry.state = { kind: "saving" };
  renderPanel(mount, state);
  scheduleMessagesScrollRestore(mount, scrollSnapshot);
  for (const entry of targets) {
    if (entry.segments?.length) {
      await saveWebAnnotationEntry(entry, saveSelectionAnnotation);
      continue;
    }
    try {
      const saved = await saveSelectionAnnotation(entry.snapshot!, {
        comment: entry.comment,
        ...(entry.color ? { color: entry.color } : {}),
      });
      entry.state = {
        kind: "saved",
        annotationID: saved.id,
        savedAt: Date.now(),
      };
    } catch (error) {
      entry.state = {
        kind: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  await persistPanelConversations(state);
  lockMessagesScroll(mount, scrollSnapshot);
  renderPanel(mount, state);
  scheduleMessagesScrollRestore(mount, scrollSnapshot);
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
  void persistPanelConversations(state);
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
      hostWindowForMount(mount),
      state.itemID,
    );
    const readerForSelection = getReaderForAttachmentOrItem(
      hostWindowForMount(mount),
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
  void persistPanelConversations(state);
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
  const webContext = isWebPromptUserMessage(sourceUser);

  const details = el(doc, "details", "assistant-process") as HTMLDetailsElement;
  details.open = !webContext;
  const contextLabel = webContext ? "发送上下文" : "思考与上下文";
  details.append(
    el(
      doc,
      "summary",
      "",
      summary ? `${contextLabel} · ${summary}` : contextLabel,
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
    if (
      sourceUser.context.selectedText &&
      !isWebPromptUserMessage(sourceUser)
    ) {
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

// Charts the Web Agent synced carry a placeholder in the answer text. Paint
// them where the chart actually appeared instead of leaving every figure in
// the thumbnail tray at the bottom of the message.
function installWebChartImages(
  doc: Document,
  body: HTMLElement,
  images: Message["images"] | undefined,
): Set<number> {
  const placed = new Set<number>();
  const blocks = Array.from(body.querySelectorAll("p, li")) as HTMLElement[];
  for (const block of blocks) {
    const ordinal = webChartPlaceholderOrdinal(block.textContent || "");
    if (ordinal == null) continue;
    const image = webChartImage(images, ordinal);
    if (!image) {
      // The answer kept a placeholder but the image never arrived; showing the
      // raw token would be worse than showing nothing.
      block.remove();
      continue;
    }
    const figure = el(doc, "figure", "message-chart");
    const img = doc.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name;
    figure.append(img, el(doc, "figcaption", "", image.name));
    block.replaceWith(figure);
    placed.add(ordinal);
  }
  return placed;
}

function renderMessageImages(
  doc: Document,
  root: HTMLElement,
  images: Message["images"] | undefined,
  placedCharts?: Set<number>,
) {
  if (!images?.length) return;
  const remaining = images.filter((_, index) => !placedCharts?.has(index + 1));
  if (!remaining.length) return;
  const tray = el(doc, "div", "message-images");
  for (const image of remaining) {
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

function fitDockedWorkspaceToWindow(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
): void {
  const { mainWindow } = entry;
  const desiredDockWidth = entry.dockedColumnWidth;
  const noteVisible = isNoteColumnVisible(sidebar);
  const desiredNoteWidth = noteVisible ? entry.dockedNoteColumnWidth : 0;
  const splitterWidth =
    DOCKED_AI_SPLITTER_WIDTH + (noteVisible ? DOCKED_NOTE_SPLITTER_WIDTH : 0);
  const minimumWorkspaceWidth =
    MIN_AI_COLUMN_WIDTH + (noteVisible ? MIN_NOTE_COLUMN_WIDTH : 0);
  const desiredWorkspaceWidth = desiredDockWidth + desiredNoteWidth;
  const availableWorkspaceWidth = Math.max(
    minimumWorkspaceWidth,
    Math.min(
      desiredWorkspaceWidth,
      mainWindow.innerWidth - MIN_ZOTERO_DOCKED_CONTENT_WIDTH - splitterWidth,
    ),
  );
  const dockedWidth = Math.min(
    desiredDockWidth,
    Math.max(
      MIN_AI_COLUMN_WIDTH,
      availableWorkspaceWidth - (noteVisible ? MIN_NOTE_COLUMN_WIDTH : 0),
    ),
  );
  const dockedNoteWidth = noteVisible
    ? Math.min(
        desiredNoteWidth,
        Math.max(MIN_NOTE_COLUMN_WIDTH, availableWorkspaceWidth - dockedWidth),
      )
    : 0;
  setDockedColumnWidth(entry, sidebar, dockedWidth, false);
  if (noteVisible) {
    setDockedNoteColumnWidth(entry, sidebar, dockedNoteWidth, false);
  }
}

function setDockedColumnWidth(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
  width: number,
  remember = true,
): void {
  const clamped = Math.max(
    MIN_AI_COLUMN_WIDTH,
    Math.min(MAX_AI_COLUMN_WIDTH, Math.round(width)),
  );
  if (remember) entry.dockedColumnWidth = clamped;
  setAiColumnWidth(sidebar, clamped);
  syncDockedWorkspaceLayout(sidebar);
}

function setDockedNoteColumnWidth(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
  width: number,
  remember = true,
): void {
  const clamped = Math.max(
    MIN_NOTE_COLUMN_WIDTH,
    Math.min(MAX_NOTE_COLUMN_WIDTH, Math.round(width)),
  );
  if (remember) entry.dockedNoteColumnWidth = clamped;
  setColumnWidth(sidebar.noteColumn, clamped);
  syncDockedWorkspaceLayout(sidebar);
}

function syncDockedWorkspaceLayout(sidebar: WindowSidebarState): void {
  const entry = dockedSidebarLayouts.get(sidebar);
  if (!entry) return;
  const root = entry.mainWindow.document.documentElement as HTMLElement | null;
  if (!root) return;
  const aiWidth =
    measuredElementWidth(sidebar.column) ?? entry.dockedColumnWidth;
  const noteVisible = isNoteColumnVisible(sidebar);
  const noteWidth = noteVisible
    ? (measuredElementWidth(sidebar.noteColumn) ?? entry.dockedNoteColumnWidth)
    : 0;
  const totalWidth =
    aiWidth +
    DOCKED_AI_SPLITTER_WIDTH +
    noteWidth +
    (noteVisible ? DOCKED_NOTE_SPLITTER_WIDTH : 0);
  root.classList.toggle("zai-docked-note-visible", noteVisible);
  root.style.setProperty("--zai-docked-width", `${aiWidth}px`);
  root.style.setProperty("--zai-docked-note-width", `${noteWidth}px`);
  root.style.setProperty("--zai-docked-total-width", `${totalWidth}px`);
}

function installDockedSplitterDrag(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
): () => void {
  const { mainWindow } = entry;
  let removeActiveDrag: (() => void) | undefined;
  const onMouseDown = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (mouseEvent.button !== 0) return;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    const onMouseMove = (moveEvent: Event) => {
      const pointer = moveEvent as MouseEvent;
      setDockedColumnWidth(
        entry,
        sidebar,
        mainWindow.innerWidth - pointer.clientX,
      );
      fitDockedWorkspaceToWindow(entry, sidebar);
    };
    const onMouseUp = () => removeActiveDrag?.();
    removeActiveDrag = () => {
      mainWindow.removeEventListener("mousemove", onMouseMove, true);
      mainWindow.removeEventListener("mouseup", onMouseUp, true);
      removeActiveDrag = undefined;
    };
    mainWindow.addEventListener("mousemove", onMouseMove, true);
    mainWindow.addEventListener("mouseup", onMouseUp, true);
  };
  sidebar.splitter.addEventListener("mousedown", onMouseDown, true);
  return () => {
    removeActiveDrag?.();
    sidebar.splitter.removeEventListener("mousedown", onMouseDown, true);
  };
}

function installDockedNoteSplitterDrag(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
): () => void {
  const { mainWindow } = entry;
  let removeActiveDrag: (() => void) | undefined;
  const onMouseDown = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (mouseEvent.button !== 0 || !isNoteColumnVisible(sidebar)) return;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    const onMouseMove = (moveEvent: Event) => {
      const pointer = moveEvent as MouseEvent;
      const aiWidth =
        measuredElementWidth(sidebar.column) ?? entry.dockedColumnWidth;
      setDockedNoteColumnWidth(
        entry,
        sidebar,
        mainWindow.innerWidth -
          pointer.clientX -
          aiWidth -
          DOCKED_AI_SPLITTER_WIDTH -
          DOCKED_NOTE_SPLITTER_WIDTH,
      );
      fitDockedWorkspaceToWindow(entry, sidebar);
    };
    const onMouseUp = () => removeActiveDrag?.();
    removeActiveDrag = () => {
      mainWindow.removeEventListener("mousemove", onMouseMove, true);
      mainWindow.removeEventListener("mouseup", onMouseUp, true);
      removeActiveDrag = undefined;
    };
    mainWindow.addEventListener("mousemove", onMouseMove, true);
    mainWindow.addEventListener("mouseup", onMouseUp, true);
  };
  sidebar.noteSplitter.addEventListener("mousedown", onMouseDown, true);
  return () => {
    removeActiveDrag?.();
    sidebar.noteSplitter.removeEventListener("mousedown", onMouseDown, true);
  };
}

function mountDockedColumn(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
): void {
  const root = entry.mainWindow.document.documentElement;
  if (!root) return;
  root.append(
    sidebar.noteSplitter,
    sidebar.noteColumn,
    sidebar.splitter,
    sidebar.column,
  );
}

function restoreEmbeddedColumn(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
): void {
  const anchor =
    entry.columnNextSibling?.parentNode === entry.columnParent
      ? entry.columnNextSibling
      : null;
  entry.columnParent.insertBefore(sidebar.noteSplitter, anchor);
  entry.columnParent.insertBefore(sidebar.noteColumn, anchor);
  entry.columnParent.insertBefore(sidebar.splitter, anchor);
  entry.columnParent.insertBefore(sidebar.column, anchor);
}

function alignDockedColumnToWindow(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
): void {
  const { mainWindow } = entry;
  const elements = [
    sidebar.noteColumn,
    sidebar.noteSplitter,
    sidebar.column,
    sidebar.splitter,
  ] as HTMLElement[];
  for (const element of elements) {
    element.style.removeProperty("transform");
    element.style.height = `${mainWindow.innerHeight}px`;
  }
  const topOffset = Math.max(
    0,
    (sidebar.column as HTMLElement).getBoundingClientRect().top,
  );
  if (topOffset > 0) {
    const transform = `translateY(-${topOffset}px)`;
    for (const element of elements) element.style.transform = transform;
  }
  syncDockedWorkspaceLayout(sidebar);
}

function installDockedFrameSync(
  entry: DockedSidebarLayout,
  sidebar: WindowSidebarState,
): () => void {
  const sync = () => {
    alignDockedColumnToWindow(entry, sidebar);
    fitDockedWorkspaceToWindow(entry, sidebar);
  };
  entry.mainWindow.addEventListener("resize", sync);
  const frame = entry.mainWindow.requestAnimationFrame?.(sync) ?? 0;
  return () => {
    entry.mainWindow.removeEventListener("resize", sync);
    if (frame) entry.mainWindow.cancelAnimationFrame?.(frame);
    for (const element of [
      sidebar.noteColumn,
      sidebar.noteSplitter,
      sidebar.column,
      sidebar.splitter,
    ] as HTMLElement[]) {
      element.style.removeProperty("transform");
      element.style.removeProperty("height");
    }
  };
}

function installDockedWindowTitle(entry: DockedSidebarLayout): () => void {
  const { document: doc } = entry.mainWindow;
  const titlebar = doc.getElementById("titlebar");
  if (!titlebar) return () => {};

  const title = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  title.className = "zai-docked-window-title";
  const syncTitle = () => {
    title.textContent = doc.title;
    title.title = doc.title;
  };
  syncTitle();
  titlebar.append(title);

  const observer = new entry.mainWindow.MutationObserver(syncTitle);
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ["title"],
  });
  return () => {
    observer.disconnect();
    title.remove();
  };
}

function closeSidebarNoteColumn(sidebar: WindowSidebarState): void {
  sidebar.noteItemID = undefined;
  sidebar.noteEditorCleanup?.();
  sidebar.noteEditorCleanup = undefined;
  sidebar.noteMount.replaceChildren();
  setNoteColumnVisible(sidebar, false);
}

function collapseEmbeddedSidebar(sidebar: WindowSidebarState): void {
  const column = sidebar.column as Element & {
    collapsed?: boolean;
    hidden?: boolean;
  };
  const splitter = sidebar.splitter as Element & { hidden?: boolean };
  column.collapsed = true;
  column.hidden = false;
  splitter.hidden = true;
  sidebar.column.setAttribute("collapsed", "true");
  sidebar.column.removeAttribute("hidden");
  sidebar.splitter.setAttribute("hidden", "true");
  closeSidebarNoteColumn(sidebar);
}

function expandEmbeddedSidebar(sidebar: WindowSidebarState): void {
  const column = sidebar.column as Element & {
    collapsed?: boolean;
    hidden?: boolean;
  };
  const splitter = sidebar.splitter as Element & { hidden?: boolean };
  column.collapsed = false;
  column.hidden = false;
  splitter.hidden = false;
  sidebar.column.removeAttribute("collapsed");
  sidebar.column.removeAttribute("hidden");
  sidebar.splitter.removeAttribute("hidden");
  sidebar.splitter.removeAttribute("state");
  if (!sidebar.column.getAttribute("width")) {
    sidebar.column.setAttribute("width", String(DEFAULT_AI_COLUMN_WIDTH));
  }
}

function setAiColumnWidth(sidebar: WindowSidebarState, width: number): void {
  const clamped = Math.max(
    MIN_AI_COLUMN_WIDTH,
    Math.min(MAX_AI_COLUMN_WIDTH, Math.round(width)),
  );
  const column = sidebar.column as HTMLElement;
  column.removeAttribute("flex");
  column.setAttribute("width", String(clamped));
  column.style.width = `${clamped}px`;
  column.style.minWidth = `${MIN_AI_COLUMN_WIDTH}px`;
  column.style.maxWidth = `${MAX_AI_COLUMN_WIDTH}px`;
}

function leaveDockedSidebarLayout(
  sidebar: WindowSidebarState,
  showEmbedded: boolean,
): void {
  const entry = dockedSidebarLayouts.get(sidebar);
  if (entry) {
    dockedSidebarLayouts.delete(sidebar);
    entry.splitterDragCleanup?.();
    entry.noteSplitterDragCleanup?.();
    entry.frameCleanup?.();
    entry.titleCleanup?.();
    const root = entry.mainWindow.document
      .documentElement as HTMLElement | null;
    root?.classList.remove("zai-docked-window");
    root?.classList.remove("zai-docked-note-visible");
    root?.style.removeProperty("--zai-docked-width");
    root?.style.removeProperty("--zai-docked-note-width");
    root?.style.removeProperty("--zai-docked-total-width");
    restoreEmbeddedColumn(entry, sidebar);
    sidebar.mount.classList.remove("zai-root-docked");
    setAiColumnWidth(sidebar, entry.columnWidth);
    setColumnWidth(sidebar.noteColumn, entry.noteColumnWidth);
    if (entry.columnPersistence) {
      sidebar.column.setAttribute("zotero-persist", entry.columnPersistence);
    }
    if (entry.noteColumnPersistence) {
      sidebar.noteColumn.setAttribute(
        "zotero-persist",
        entry.noteColumnPersistence,
      );
    }
  }
  if (showEmbedded) expandEmbeddedSidebar(sidebar);
  else collapseEmbeddedSidebar(sidebar);
  updateToggleButton(sidebar);
}

function enterDockedSidebarLayout(
  mainWindow: Window,
  sidebar: WindowSidebarState,
): void {
  const existing = dockedSidebarLayouts.get(sidebar);
  if (existing) {
    expandEmbeddedSidebar(sidebar);
    mountDockedColumn(existing, sidebar);
    alignDockedColumnToWindow(existing, sidebar);
    fitDockedWorkspaceToWindow(existing, sidebar);
    mainWindow.focus();
    return;
  }
  const columnParent = sidebar.column.parentNode;
  if (!columnParent) return;
  const entry: DockedSidebarLayout = {
    mainWindow,
    columnWidth:
      measuredElementWidth(sidebar.column) ?? DEFAULT_AI_COLUMN_WIDTH,
    noteColumnWidth:
      measuredElementWidth(sidebar.noteColumn) ?? DEFAULT_NOTE_COLUMN_WIDTH,
    dockedColumnWidth: 480,
    dockedNoteColumnWidth:
      loadReaderLayoutPrefs().noteWidth ?? DEFAULT_NOTE_COLUMN_WIDTH,
    columnPersistence: sidebar.column.getAttribute("zotero-persist"),
    noteColumnPersistence: sidebar.noteColumn.getAttribute("zotero-persist"),
    columnParent,
    columnNextSibling: sidebar.column.nextSibling,
  };
  dockedSidebarLayouts.set(sidebar, entry);
  sidebar.column.removeAttribute("zotero-persist");
  sidebar.noteColumn.removeAttribute("zotero-persist");
  expandEmbeddedSidebar(sidebar);
  const root = mainWindow.document.documentElement as HTMLElement | null;
  root?.classList.add("zai-docked-window");
  mountDockedColumn(entry, sidebar);
  sidebar.mount.classList.add("zai-root-docked");
  entry.splitterDragCleanup = installDockedSplitterDrag(entry, sidebar);
  entry.noteSplitterDragCleanup = installDockedNoteSplitterDrag(entry, sidebar);
  entry.frameCleanup = installDockedFrameSync(entry, sidebar);
  entry.titleCleanup = installDockedWindowTitle(entry);
  alignDockedColumnToWindow(entry, sidebar);
  fitDockedWorkspaceToWindow(entry, sidebar);
  updateToggleButton(sidebar);
}

function reconcileSidebarDisplayMode(
  mainWindow: Window,
  sidebar: WindowSidebarState,
  localSettings: LocalUiSettings,
  previousMode?: LocalUiSettings["sidebarDisplayMode"],
): void {
  if (localSettings.sidebarDisplayMode === "docked") {
    enterDockedSidebarLayout(mainWindow, sidebar);
    return;
  }
  if (previousMode === "docked" || dockedSidebarLayouts.has(sidebar)) {
    leaveDockedSidebarLayout(sidebar, true);
  }
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
  splitter.addEventListener("command", () => {
    updateToggleButton(state);
    syncFullTranslationHostLayout(state);
  });
  splitter.addEventListener("mouseup", () => {
    updateToggleButton(state);
    syncFullTranslationHostLayout(state);
  });
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
  const panelState = states.get(state.mount);
  if (panelState) {
    reconcileSidebarDisplayMode(win, state, panelState.localUiSettings);
  }
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
  const syncTranslation = () => syncFullTranslationHostLayout(state);
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
    resizeObserver = new ResizeObserverCtor(() => {
      scheduleRemember();
      syncTranslation();
    });
    resizeObserver?.observe(state.noteColumn);
    resizeObserver?.observe(state.column);
  }
  state.noteSplitter.addEventListener("command", scheduleRemember);
  state.noteSplitter.addEventListener("mouseup", remember);
  win.addEventListener("mouseup", remember, true);
  win.addEventListener("resize", syncTranslation);
  state.layoutCleanup = () => {
    resizeObserver?.disconnect();
    state.noteSplitter.removeEventListener("command", scheduleRemember);
    state.noteSplitter.removeEventListener("mouseup", remember);
    win.removeEventListener("mouseup", remember, true);
    win.removeEventListener("resize", syncTranslation);
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
      if (handleImmersiveModeShortcut(win, event)) return;
      if (handleQuickAskShortcut(win, sidebar, event)) return;
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

function handleImmersiveModeShortcut(
  win: Window,
  event: KeyboardEvent,
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    isEditableEventTarget(event.target)
  ) {
    return false;
  }
  if (
    !isImmersiveModeShortcut(event, getImmersiveModeShortcut(zoteroPrefs()))
  ) {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  void toggleAskMode(win);
  return true;
}

function handleQuickAskShortcut(
  win: Window,
  sidebar: WindowSidebarState,
  event: KeyboardEvent,
): boolean {
  if (
    event.defaultPrevented ||
    isEditableEventTarget(event.target) ||
    !isQuickAskShortcut(event, getQuickAskShortcut(zoteroPrefs()))
  ) {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  void openQuickAsk(win, sidebar);
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

// Right-click on a chat selection → floating menu with 复制 / 加入笔记 / 提问.
// We deliberately don't replace the entire context menu (that would require
// fighting Zotero's XUL menupopup system); instead we suppress the default
// browser menu only when our criteria are met, then render a lightweight
// HTML menu at the click point.
function installWebGeneratedFileLinks(
  body: HTMLElement,
  state: PanelState,
): void {
  const links = Array.from(body.querySelectorAll("a")) as HTMLAnchorElement[];
  for (const link of links) {
    const sourcePath = webGeneratedFilePath(link.href);
    if (!sourcePath) continue;
    link.classList.add("zai-web-generated-file");
    link.setAttribute("title", "点击打开文件；右键保存到当前论文目录");
    link.addEventListener("click", (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      void openWebGeneratedFile(sourcePath, link);
    });
    link.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      openWebGeneratedFileContextMenu(event, sourcePath, link, state);
    });
  }
}

async function openWebGeneratedFile(
  sourcePath: string,
  link: HTMLAnchorElement,
): Promise<void> {
  if (!(await IOUtils.exists(sourcePath))) {
    link.title = "生成文件已不存在，请重新生成";
    return;
  }
  Zotero.launchFile(sourcePath);
}

function openWebGeneratedFileContextMenu(
  event: MouseEvent,
  sourcePath: string,
  link: HTMLAnchorElement,
  state: PanelState,
): void {
  const doc = link.ownerDocument!;
  doc.querySelector(".zai-web-generated-file-menu")?.remove();
  const menu = doc.createElement("div");
  menu.className = "zai-selection-menu zai-web-generated-file-menu";
  menu.setAttribute("role", "menu");
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  const save = doc.createElement("button");
  save.type = "button";
  save.className = "zai-selection-menu-item";
  save.setAttribute("role", "menuitem");
  save.textContent = "保存到当前论文目录";
  const itemID = state.itemID;
  save.disabled = itemID == null;
  if (itemID == null) save.title = "请先选择一篇论文";
  save.addEventListener("click", () => {
    if (itemID == null) return;
    save.disabled = true;
    save.textContent = "保存中…";
    void saveWebGeneratedFileToCurrentItem(
      sourcePath,
      itemID,
      link.textContent || "",
    )
      .then((attachmentID) => {
        save.textContent = "已保存";
        save.title = attachmentID
          ? `已添加为附件 #${attachmentID}`
          : "已添加为附件";
        link.title = "已保存到当前论文的 Zotero 附件";
      })
      .catch((error) => {
        save.textContent = "保存失败";
        save.title = errorMessage(error);
        save.disabled = false;
      });
  });
  menu.append(save);
  const root = doc.body ?? doc.documentElement;
  if (!root) return;
  root.append(menu);

  const close = () => {
    menu.remove();
    doc.removeEventListener("mousedown", outside, true);
    doc.removeEventListener("keydown", escape, true);
  };
  const outside = (click: Event) => {
    if (!menu.contains(click.target as Node)) close();
  };
  const escape = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key === "Escape") close();
  };
  doc.defaultView?.setTimeout(() => {
    doc.addEventListener("mousedown", outside, true);
    doc.addEventListener("keydown", escape, true);
  }, 0);
}

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

  const openMenu = (event: MouseEvent, text: string) => {
    dismiss();
    const sourceReply = chatReplyCitationFromTarget(
      event.target,
      sidebar,
      text,
    );

    const menu = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    menu.className = "zai-selection-menu";
    const position = selectionMenuPosition(event, sidebar);
    if (position.docked) menu.style.position = "absolute";
    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;

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
    importBtn.textContent = "加入笔记";
    importBtn.addEventListener("click", () => {
      debugZai("context-menu-import: click", textDebugInfo(text));
      void importSelectionToNote(doc, sidebar, text);
      dismiss();
    });

    menu.append(copyBtn, importBtn);
    if (sourceReply) {
      const askBtn = doc.createElementNS(
        XHTML_NS,
        "button",
      ) as HTMLButtonElement;
      askBtn.type = "button";
      askBtn.className = "zai-selection-menu-item";
      askBtn.textContent = "提问";
      askBtn.addEventListener("click", () => {
        const state = states.get(sidebar.mount);
        if (!state) return;
        state.chatSelectionQuote = sourceReply;
        state.chatSelectionPreviewOpen = false;
        state.focusInput = true;
        state.draftHadFocus = true;
        dismiss();
        renderPanel(sidebar.mount, state);
      });
      menu.append(askBtn);
    }
    sidebar.column.append(menu);
    activeMenu = menu;
    win.setTimeout(() => {
      if (activeMenu !== menu) return;
      doc.addEventListener("mousedown", outsideClick, true);
      doc.addEventListener("keydown", escClose, true);
    }, 0);
  };

  const openMenuForEvent = (event: MouseEvent): boolean => {
    const text = sidebarSelectionMenuText(win, sidebar, event.target);
    if (!text) return false;
    event.preventDefault();
    event.stopPropagation();
    openMenu(event, text);
    return true;
  };

  const onContextMenu = (event: MouseEvent) => {
    openMenuForEvent(event);
  };

  // Zotero's Linux chrome UI can consume `contextmenu` before it reaches
  // add-on listeners. Right-button mousedown still arrives, and also occurs
  // before Firefox collapses the visual selection, so use it as the primary
  // fallback without changing left-click behavior or menus outside the panel.
  const onRightMouseDown = (event: MouseEvent) => {
    if (event.button !== 2) return;
    if (openMenuForEvent(event)) event.stopImmediatePropagation();
  };

  win.addEventListener("contextmenu", onContextMenu, true);
  win.addEventListener("mousedown", onRightMouseDown, true);
  sidebar.selectionMenuCleanup = () => {
    win.removeEventListener("contextmenu", onContextMenu, true);
    win.removeEventListener("mousedown", onRightMouseDown, true);
    dismiss();
  };
}

function chatReplyCitationFromTarget(
  target: EventTarget | null,
  sidebar: WindowSidebarState,
  excerpt: string,
): PanelState["chatSelectionQuote"] {
  const node = target as Node | null;
  const element =
    node?.nodeType === 1
      ? (node as Element)
      : (node?.parentElement as Element | null);
  const bubble = element?.closest(
    ".bubble-assistant[data-message-index]",
  ) as HTMLElement | null;
  if (!bubble || !sidebar.mount.contains(bubble)) return undefined;

  const index = Number(bubble.dataset.messageIndex);
  const state = states.get(sidebar.mount);
  const sourceMessage = Number.isInteger(index) ? state?.messages[index] : null;
  if (!state || sourceMessage?.role !== "assistant") return undefined;
  if (!sourceMessage.content.trim()) return undefined;
  const sourceUserIndex = findPreviousUserIndex(state.messages, index);
  const sourceQuestion = state.messages[sourceUserIndex]?.content.trim() || "";
  return {
    excerpt,
    fullReply: sourceMessage.content,
    sourceConversationTitle: activeConversation(state)?.title ?? "当前对话",
    sourceAssistantOrdinal: state.messages
      .slice(0, index + 1)
      .filter((message) => message.role === "assistant").length,
    sourceQuestionPreview: contentPreview(sourceQuestion, 28),
  };
}

function selectionMenuPosition(
  event: MouseEvent,
  sidebar: WindowSidebarState,
): { left: number; top: number; docked: boolean } {
  const docked = dockedSidebarLayouts.has(sidebar);
  if (!docked) {
    return { left: event.clientX, top: event.clientY, docked: false };
  }

  const rect = sidebar.column.getBoundingClientRect();
  const localCoordinate = (value: number, start: number, size: number) =>
    value >= start && value <= start + size ? value - start : value;
  return {
    left: localCoordinate(event.clientX, rect.left, rect.width),
    top: localCoordinate(event.clientY, rect.top, rect.height),
    docked: true,
  };
}

function sidebarSelectionMenuText(
  win: Window,
  sidebar: WindowSidebarState,
  target: EventTarget | null,
): string {
  const selection = win.getSelection();
  if (selectionBelongsToSidebar(selection, sidebar)) {
    const text = serializeSidebarSelection(selection, "context-menu");
    if (text) cacheSidebarSelection(sidebar, text, "context-menu");
    return text;
  }

  const node = target as Node | null;
  if (
    !node ||
    (!sidebar.column.contains(node) && !sidebar.noteColumn.contains(node))
  ) {
    return "";
  }
  const cached = sidebar.lastCopySelection;
  if (!cached || Date.now() - cached.updatedAt > 10000) return "";
  return cached.text;
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

  leaveDockedSidebarLayout(state, false);
  closeQuickAsk(state);
  state.fullTranslationAbort?.abort();
  state.fullTranslationAbort = undefined;
  closeFullTranslation(state);
  fullTranslationSessions.delete(state);
  disableTranslateMode(win);
  disableAskMode(win);

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
    if (state.fullTranslationActive) {
      void showFullTranslation(state);
    } else if (state.noteItemID) {
      switchNoteForItem(state, itemID);
    }
    void migrateTranslateModeOnReaderSwitch(win);
    void migrateAskModeOnReaderSwitch(win);
  }
  updateToggleButton(state);
  syncFullTranslationHostLayout(state);
  win.requestAnimationFrame?.(() => syncFullTranslationHostLayout(state));
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
  const panelState = states.get(state.mount);
  if (panelState?.localUiSettings.sidebarDisplayMode === "docked") {
    if (collapsed) {
      leaveDockedSidebarLayout(state, false);
    } else {
      enterDockedSidebarLayout(win, state);
    }
    updateToggleButton(state);
    return;
  }
  const column = state.column as Element & { collapsed?: boolean };
  const splitter = state.splitter as Element & { hidden?: boolean };
  if (collapsed) {
    // Keep translate mode running when the AI column is collapsed — it lives on
    // the PDF Reader, independent of this panel. Collapsing the chat must not
    // flip the PDF back to normal mode (it's torn down on window unregister).
    column.collapsed = true;
    splitter.hidden = true;
    state.column.setAttribute("collapsed", "true");
    state.splitter.setAttribute("hidden", "true");
    closeSidebarNoteColumn(state);
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
    syncTranslateButtons(win);
    flashButton(btn as HTMLButtonElement, "无PDF");
    return;
  }
  if (ctrl.isEnabled()) {
    ctrl.disable();
    translateControllers.delete(win);
    syncTranslateButtons(win);
  } else {
    // Mutual exclusion: only one in-place mode at a time.
    disableAskMode(win);
    try {
      await ctrl.enable();
      syncTranslateButtons(win);
    } catch (err) {
      debugZai("translate.enable.failed", { error: errorMessage(err) });
      syncTranslateButtons(win);
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
  const sidebarDocument = windowSidebars.get(win)?.mount.ownerDocument;
  if (sidebarDocument && sidebarDocument !== win.document) {
    docs.push(sidebarDocument);
  }
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

// Immersive reading ("沉浸") mode. Mirrors the translate control flow but kept
// as a separate, independent controller so the standalone "译" quick mode is
// never touched. The two in-place modes are mutually exclusive: enabling one
// disables the other.
async function toggleAskMode(win: Window, btn?: HTMLElement): Promise<void> {
  const ctrl = await getOrCreateAskController(win);
  if (!ctrl) {
    syncAskButtons(win);
    if (btn) flashButton(btn as HTMLButtonElement, "无PDF");
    return;
  }
  if (ctrl.isEnabled()) {
    ctrl.disable();
    askControllers.delete(win);
    syncAskButtons(win);
  } else {
    // Mutual exclusion: only one in-place mode at a time.
    disableTranslateMode(win);
    try {
      await ctrl.enable();
      syncAskButtons(win);
      // Drop keyboard focus off the toggle so a later Space (the default 选区
      // 快捷翻译键, and the universal "click the focused button" key) can't
      // re-trigger this button and switch immersive back off.
      (btn as HTMLButtonElement | undefined)?.blur?.();
    } catch (err) {
      debugZai("ask.enable.failed", { error: errorMessage(err) });
      syncAskButtons(win);
      if (btn) flashButton(btn as HTMLButtonElement, "失败");
    }
  }
}

async function getOrCreateAskController(
  win: Window,
): Promise<AskModeController | null> {
  const reader = getActiveReader(win);
  if (!reader) return null;
  const existing = askControllers.get(win);
  const prefs = zoteroPrefs();
  const presets = loadPresets(prefs);
  if (existing?.isForReader(reader)) {
    existing.refreshPresets(presets);
    return existing;
  }
  existing?.disable();
  const ctrl = new AskModeController({
    prefs,
    presets,
    reader,
    hostWindow: win,
    getItemID: () => safeSelectedItemID(win),
  });
  askControllers.set(win, ctrl);
  return ctrl;
}

function syncAskBtnState(win: Window, btn: HTMLElement): void {
  const enabled = askControllers.get(win)?.isEnabled() ?? false;
  btn.classList.toggle("zai-toolbar-icon--active", enabled);
  setAskButtonLabel(btn, enabled);
}

function disableAskMode(win: Window): void {
  askControllers.get(win)?.disable();
  askControllers.delete(win);
  syncAskButtons(win);
}

function syncAskButtons(win: Window): void {
  const enabled = askControllers.get(win)?.isEnabled() ?? false;
  const docs = [win.document];
  const sidebarDocument = windowSidebars.get(win)?.mount.ownerDocument;
  if (sidebarDocument && sidebarDocument !== win.document) {
    docs.push(sidebarDocument);
  }
  for (const doc of docs) {
    const buttons = Array.from(
      doc.querySelectorAll(".zai-sidebar-ask-button"),
    ) as HTMLElement[];
    for (const button of buttons) {
      button.classList.toggle("zai-toolbar-icon--active", enabled);
      setAskButtonLabel(button, enabled);
    }
  }
}

function setAskButtonLabel(btn: HTMLElement, enabled: boolean): void {
  if (!btn.classList.contains("zai-sidebar-ask-button")) return;
  btn.textContent = enabled ? "沉浸✓" : "沉浸";
}

async function migrateAskModeOnReaderSwitch(win: Window): Promise<void> {
  const existing = askControllers.get(win);
  if (!existing?.isEnabled()) return;
  const reader = getActiveReader(win);
  if (!reader || existing.isForReader(reader)) return;
  existing.disable();
  const prefs = zoteroPrefs();
  const ctrl = new AskModeController({
    prefs,
    presets: loadPresets(prefs),
    reader,
    hostWindow: win,
    getItemID: () => safeSelectedItemID(win),
  });
  askControllers.set(win, ctrl);
  try {
    await ctrl.enable();
  } catch {
    askControllers.delete(win);
  }
  syncAskButtons(win);
}

declare global {
  interface Document {
    createXULElement(tagName: string): Element;
  }
}
