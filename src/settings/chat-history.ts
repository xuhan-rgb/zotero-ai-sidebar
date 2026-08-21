import type {
  AssistantAnnotationDraft,
  ChatTaskMeta,
  Message,
  WebAnnotationBatchDraft,
} from '../providers/types';
import type { ConversationHistoryMode } from '../modules/conversation-history';

// Per-Zotero-item chat persistence.
//
// Storage shape: a single JSON file in the Zotero profile dir, keyed by
// `item:<itemID>` (or `global` for chats with no current item). Each entry
// holds the entire message history for that item — messages, context
// metadata, thinking traces, image attachments, and annotation drafts.
//
// INVARIANT: writes are SERIALIZED via `writeQueue` to prevent two concurrent
// `saveChatMessages` calls from racing on the same JSON file. WHY: we
// read-modify-write the whole file each time; two unsynchronized writes
// would clobber each other's threads.
//
// INVARIANT: `normalizeMessages` runs on EVERY read. Old persisted threads
// may pre-date the current Message schema (added images, annotationDraft,
// thinking, context). Normalization treats the file as untrusted and only
// re-emits well-typed fields — schema rot recovery, not validation.
//
// REF: CLAUDE.md "Chat history persistence lives in src/settings/chat-history.ts;
//      preserve messages, context traces, thinking summaries, and image metadata."

interface StoredThread {
  itemID: number | null;
  updatedAt: string;
  messages?: Message[];
  activeConversationID?: string;
  conversations?: ChatConversation[];
}

type StoredThreads = Record<string, StoredThread>;

interface ZoteroFileAPI {
  getContentsAsync(path: string, charset?: string): Promise<string>;
  putContentsAsync(path: string, contents: string): Promise<void>;
}

interface ZoteroProfileAPI {
  dir: string;
}

interface ZoteroItemLike {
  key?: string;
  libraryID?: number;
}

interface ZoteroLibraryLike {
  libraryType?: 'user' | 'group';
  groupID?: number;
  id?: number;
}

interface ZoteroItemsAPI {
  get(itemID: number): ZoteroItemLike | false;
  getByLibraryAndKey(libraryID: number, key: string): ZoteroItemLike | false;
}

interface ZoteroLibrariesAPI {
  get(libraryID: number): ZoteroLibraryLike | undefined;
  userLibraryID: number;
}

interface ZoteroGroupLike {
  libraryID?: number;
}

interface ZoteroGroupsAPI {
  get(groupID: number): ZoteroGroupLike | false | undefined;
}

interface ZoteroDataDirectoryAPI {
  dir?: string;
  path?: string;
}

interface ZoteroGlobal {
  File: ZoteroFileAPI;
  Profile: ZoteroProfileAPI;
  DataDirectory?: ZoteroDataDirectoryAPI;
  Items?: ZoteroItemsAPI;
  Libraries?: ZoteroLibrariesAPI;
  Groups?: ZoteroGroupsAPI;
}

// Cross-machine portable form for cloud sync. WHY this shape: the local
// `itemID` numeric key is per-database (Zotero assigns them at insert
// time), so it CANNOT be sent to another machine. The portable identifier
// is `(libraryType, groupID?, itemKey)` — `itemKey` is the 8-char base32
// key Zotero sync uses, and it's stable across machines.
export interface PortableThread {
  libraryType: 'user' | 'group' | 'global';
  groupID?: number;
  itemKey?: string;
  conversationID?: string;
  title?: string;
  presetID?: string;
  draftText?: string;
  historyMode?: ConversationHistoryMode;
  branchOrigin?: ChatConversationBranchOrigin;
  createdAt?: string;
  active?: boolean;
  updatedAt: string;
  messages: Message[];
}

export interface ChatConversationBranchOrigin {
  sourceConversationID?: string;
  sourceConversationTitle: string;
  messagePreview: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  presetID?: string;
  draftText: string;
  historyMode: ConversationHistoryMode;
  branchOrigin?: ChatConversationBranchOrigin;
}

export interface ChatConversationWorkspace {
  activeConversationID: string;
  conversations: ChatConversation[];
}

export function createChatConversation(
  id: string,
  title: string,
  presetID?: string,
  timestamp = new Date().toISOString(),
): ChatConversation {
  return {
    id,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    ...(presetID ? { presetID } : {}),
    draftText: '',
    historyMode: 'none',
  };
}

export function createBranchedConversation(
  source: ChatConversation,
  throughMessageIndex: number,
  id: string,
  title: string,
  timestamp = new Date().toISOString(),
): ChatConversation {
  const messageCount = Math.min(
    source.messages.length,
    Math.max(0, Math.trunc(throughMessageIndex) + 1),
  );
  const messages = JSON.parse(
    JSON.stringify(source.messages.slice(0, messageCount)),
  ) as Message[];
  return {
    ...createChatConversation(id, title, source.presetID, timestamp),
    messages,
    historyMode: source.historyMode,
    branchOrigin: {
      sourceConversationID: source.id,
      sourceConversationTitle: source.title,
      messagePreview: branchMessagePreview(
        source.messages[throughMessageIndex],
      ),
    },
  };
}

export function clearAffectedBranchOriginsAfterDeletion(
  conversations: ChatConversation[],
  deletedConversationID: string,
): void {
  const deletedIndex = conversations.findIndex(
    (conversation) => conversation.id === deletedConversationID,
  );
  if (deletedIndex < 0) return;
  for (const conversation of conversations) {
    const origin = conversation.branchOrigin;
    if (!origin) continue;
    const sourceIndex = conversations.findIndex((candidate) =>
      origin.sourceConversationID
        ? candidate.id === origin.sourceConversationID
        : candidate.title === origin.sourceConversationTitle,
    );
    if (sourceIndex < 0 || deletedIndex <= sourceIndex) {
      delete conversation.branchOrigin;
    }
  }
}

function branchMessagePreview(message: Message | undefined): string {
  const text = message?.content.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return message?.role === 'assistant' ? 'AI 回答' : '用户消息';
  return text.length > 36 ? `${text.slice(0, 36)}…` : text;
}

export interface ImportThreadsResult {
  imported: number;
  unchanged: number;
  unresolved: number;
}

const HISTORY_FILE = 'zotero-ai-sidebar-chat-history.json';
let writeQueue: Promise<void> = Promise.resolve();

// ~/Zotero/ (DataDirectory) is the preferred storage location so chat
// history lives alongside PDFs and survives profile resets. Falls back to
// Profile.dir if DataDirectory is unavailable (older Zotero builds).
function historyDir(): string {
  const Z = getZotero();
  return Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
}

export async function loadChatMessages(
  itemID: number | null,
): Promise<Message[]> {
  const workspace = await loadChatConversations(itemID);
  return (
    workspace.conversations.find(
      (conversation) => conversation.id === workspace.activeConversationID,
    )?.messages ?? []
  );
}

export async function loadChatConversations(
  itemID: number | null,
): Promise<ChatConversationWorkspace> {
  const threads = await readThreads();
  return normalizeWorkspace(threads[threadKey(itemID)]);
}

export function saveChatConversations(
  itemID: number | null,
  workspace: ChatConversationWorkspace,
): Promise<void> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const threads = await readThreads();
      const normalized = normalizeWorkspace({
        itemID,
        updatedAt: new Date().toISOString(),
        activeConversationID: workspace.activeConversationID,
        conversations: workspace.conversations,
      });
      threads[threadKey(itemID)] = {
        itemID,
        updatedAt: newestConversationTimestamp(normalized.conversations),
        activeConversationID: normalized.activeConversationID,
        conversations: normalized.conversations,
      };
      await writeThreads(threads);
    });
  return writeQueue;
}

export function saveChatMessages(
  itemID: number | null,
  messages: Message[],
): Promise<void> {
  // Chain the next write onto the queue. `.catch(() => undefined)` ensures
  // a previous write's failure does NOT cancel the next write — callers
  // observe their own write's outcome via the returned promise.
  // GOTCHA: an empty `messages` array deletes the thread entirely. The
  // sidebar uses this for "clear chat" without a separate delete API.
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const threads = await readThreads();
      const key = threadKey(itemID);
      const safeMessages = normalizeMessages(messages);

      if (safeMessages.length === 0) {
        delete threads[key];
      } else {
        const now = new Date().toISOString();
        const workspace = normalizeWorkspace(threads[key]);
        const conversations = workspace.conversations.map((conversation) =>
          conversation.id === workspace.activeConversationID
            ? { ...conversation, updatedAt: now, messages: safeMessages }
            : conversation,
        );
        threads[key] = {
          itemID,
          updatedAt: now,
          activeConversationID: workspace.activeConversationID,
          conversations,
        };
      }

      await writeThreads(threads);
    });
  return writeQueue;
}

function normalizeWorkspace(
  thread: Partial<StoredThread> | undefined,
): ChatConversationWorkspace {
  const legacyMessages = normalizeMessages(thread?.messages);
  const conversations = normalizeConversations(thread?.conversations);
  if (conversations.length === 0) {
    const timestamp =
      validTimestamp(thread?.updatedAt) ?? new Date().toISOString();
    conversations.push({
      id: 'default',
      title: '对话 1',
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: legacyMessages,
      draftText: '',
      historyMode: 'previous',
    });
  }
  const requestedActive =
    typeof thread?.activeConversationID === 'string'
      ? thread.activeConversationID
      : '';
  const activeConversationID = conversations.some(
    (conversation) => conversation.id === requestedActive,
  )
    ? requestedActive
    : conversations[0].id;
  return { activeConversationID, conversations };
}

function normalizeConversations(value: unknown): ChatConversation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const createdAt =
      validTimestamp(entry.createdAt) ?? new Date().toISOString();
    const updatedAt = validTimestamp(entry.updatedAt) ?? createdAt;
    const title =
      typeof entry.title === 'string' && entry.title.trim()
        ? entry.title.trim()
        : `对话 ${index + 1}`;
    const presetID =
      typeof entry.presetID === 'string' && entry.presetID
        ? entry.presetID
        : undefined;
    const branchOrigin = normalizeBranchOrigin(entry.branchOrigin);
    return [
      {
        id,
        title,
        createdAt,
        updatedAt,
        messages: normalizeMessages(entry.messages),
        ...(presetID ? { presetID } : {}),
        draftText: typeof entry.draftText === 'string' ? entry.draftText : '',
        historyMode: normalizeHistoryMode(entry.historyMode),
        ...(branchOrigin ? { branchOrigin } : {}),
      },
    ];
  });
}

function normalizeBranchOrigin(
  value: unknown,
): ChatConversationBranchOrigin | null {
  if (!isRecord(value)) return null;
  const sourceConversationTitle =
    typeof value.sourceConversationTitle === 'string'
      ? value.sourceConversationTitle.trim()
      : '';
  const sourceConversationID =
    typeof value.sourceConversationID === 'string' &&
    value.sourceConversationID.trim()
      ? value.sourceConversationID.trim()
      : undefined;
  const messagePreview =
    typeof value.messagePreview === 'string' ? value.messagePreview.trim() : '';
  return sourceConversationTitle && messagePreview
    ? {
        ...(sourceConversationID ? { sourceConversationID } : {}),
        sourceConversationTitle,
        messagePreview,
      }
    : null;
}

function normalizeHistoryMode(value: unknown): ConversationHistoryMode {
  return value === 'none' || value === 'all' || value === 'previous'
    ? value
    : 'previous';
}

function validTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function newestConversationTimestamp(
  conversations: ChatConversation[],
): string {
  return (
    conversations.reduce(
      (latest, conversation) =>
        conversation.updatedAt > latest ? conversation.updatedAt : latest,
      '',
    ) || new Date().toISOString()
  );
}

export function chatHistoryPath(): string {
  return appendLocalFile(historyDir(), HISTORY_FILE);
}

function appendLocalFile(dir: string, file: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const base = dir.replace(/[\\/]+$/g, '');
  return base ? `${base}${sep}${file}` : `${sep}${file}`;
}

async function readThreads(): Promise<StoredThreads> {
  const Z = getZotero();
  // Try new location first (~/Zotero/), then migrate from old profile-dir
  // location if the new one is absent. Migration is one-time: we write the
  // file to the new path and leave the old copy in place as a backup.
  const newPath = chatHistoryPath();
  const oldPath = appendLocalFile(Z.Profile.dir, HISTORY_FILE);
  for (const path of [newPath, oldPath]) {
    try {
      const raw = await Z.File.getContentsAsync(path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (path === oldPath) {
          // Migrate: write to new location so next read uses the new path.
          await Z.File.putContentsAsync(
            newPath,
            JSON.stringify(parsed, null, 2),
          );
        }
        return parsed as StoredThreads;
      }
    } catch {
      // continue to next candidate
    }
  }
  return {};
}

async function writeThreads(threads: StoredThreads): Promise<void> {
  await getZotero().File.putContentsAsync(
    chatHistoryPath(),
    JSON.stringify(threads, null, 2),
  );
}

// Treat `value` as untrusted JSON (could be from an older plugin version
// or a hand-edited file). flatMap+[] is the discard pattern: any malformed
// entry is silently dropped rather than failing the whole load. WHY silent:
// we'd rather lose one corrupt message than refuse to open the chat.
function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    const m = message as Partial<Message>;
    if (m.role !== 'user' && m.role !== 'assistant') return [];
    if (typeof m.content !== 'string') return [];
    const images = normalizeImages(m.images);
    const annotationDraft = normalizeAnnotationDraft(m.annotationDraft);
    const webAnnotationBatch = normalizeWebAnnotationBatch(
      m.webAnnotationBatch,
    );
    const task = normalizeChatTask(m.task);
    const usage = normalizeMessageUsage(m.usage);
    return [
      {
        role: m.role,
        content: m.content,
        ...(typeof m.thinking === 'string' && m.thinking
          ? { thinking: m.thinking }
          : {}),
        ...(usage ? { usage } : {}),
        ...(images.length ? { images } : {}),
        ...(isRecord(m.context)
          ? { context: m.context as Message['context'] }
          : {}),
        ...(annotationDraft ? { annotationDraft } : {}),
        ...(webAnnotationBatch ? { webAnnotationBatch } : {}),
        ...(task ? { task } : {}),
      },
    ];
  });
}

function normalizeWebAnnotationBatch(
  value: unknown,
): WebAnnotationBatchDraft | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  const createdAt = optionalNumber(value.createdAt) ?? Date.now();
  const entries = value.entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const quote = typeof entry.quote === 'string' ? entry.quote.trim() : '';
    const comment =
      typeof entry.comment === 'string' ? entry.comment.trim() : '';
    if (!quote || !comment) return [];
    const locateState = ['pending', 'located', 'not_found', 'failed'].includes(
      String(entry.locateState),
    )
      ? (entry.locateState as 'pending' | 'located' | 'not_found' | 'failed')
      : 'pending';
    const snapshot = normalizeAnnotationSnapshot(entry.snapshot);
    const effectiveLocateState =
      locateState === 'located' && !snapshot ? 'pending' : locateState;
    const color = normalizeAnnotationColor(entry.color);
    const confidence = optionalNumber(entry.confidence);
    const pageLabel =
      typeof entry.pageLabel === 'string' ? entry.pageLabel : undefined;
    return [
      {
        quote,
        comment,
        ...(color ? { color } : {}),
        locateState: effectiveLocateState,
        ...(confidence != null ? { confidence } : {}),
        ...(pageLabel ? { pageLabel } : {}),
        ...(snapshot ? { snapshot } : {}),
        state: normalizeAnnotationDraftState(entry.state),
      },
    ];
  });
  const error =
    typeof value.error === 'string' && value.error ? value.error : undefined;
  if (!entries.length && !error) return null;
  return { createdAt, ...(error ? { error } : {}), entries };
}

function normalizeAnnotationSnapshot(
  value: unknown,
): AssistantAnnotationDraft['snapshot'] | null {
  if (!isRecord(value)) return null;
  const text = typeof value.text === 'string' ? value.text : '';
  const attachmentID =
    typeof value.attachmentID === 'number' ? value.attachmentID : null;
  const annotation = isRecord(value.annotation) ? value.annotation : null;
  return text && attachmentID != null && annotation
    ? { text, attachmentID, annotation }
    : null;
}

function normalizeMessageUsage(value: unknown): Message['usage'] | null {
  if (!isRecord(value)) return null;
  const input = optionalNumber(value.input) ?? 0;
  const output = optionalNumber(value.output) ?? 0;
  const cacheRead = optionalNumber(value.cacheRead);
  if (input <= 0 && output <= 0 && (cacheRead == null || cacheRead <= 0)) {
    return null;
  }
  return {
    input,
    output,
    ...(cacheRead != null ? { cacheRead } : {}),
  };
}

function normalizeChatTask(value: unknown): ChatTaskMeta | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const title = typeof value.title === 'string' ? value.title : '';
  const promptPreview =
    typeof value.promptPreview === 'string' ? value.promptPreview : '';
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : 0;
  if (!id || !title || !createdAt) return null;
  const kind =
    value.kind === 'selection' ||
    value.kind === 'full_text' ||
    value.kind === 'reading_route' ||
    value.kind === 'general'
      ? value.kind
      : 'general';
  const completedAt = optionalNumber(value.completedAt);
  const viewedAt = optionalNumber(value.viewedAt);
  const hiddenAt = optionalNumber(value.hiddenAt);
  const cancelledAt = optionalNumber(value.cancelledAt);
  const error =
    typeof value.error === 'string' && value.error ? value.error : undefined;
  const webProvider = normalizeWebPromptProvider(value.webProvider);
  const webStatus = normalizeWebTaskStatus(value.webStatus);
  const pdfSelection = normalizePdfSelectionLocator(value.pdfSelection);
  return {
    id,
    kind,
    title,
    promptPreview,
    createdAt,
    ...(completedAt != null ? { completedAt } : {}),
    ...(viewedAt != null ? { viewedAt } : {}),
    ...(hiddenAt != null ? { hiddenAt } : {}),
    ...(cancelledAt != null ? { cancelledAt } : {}),
    ...(error ? { error } : {}),
    ...(webProvider ? { webProvider } : {}),
    ...(webStatus ? { webStatus } : {}),
    ...(pdfSelection ? { pdfSelection } : {}),
  };
}

function normalizeWebTaskStatus(
  value: unknown,
): ChatTaskMeta['webStatus'] | undefined {
  return [
    'queued',
    'starting_browser',
    'needs_login',
    'uploading_attachment',
    'submitting',
    'generating',
    'processing_answer',
  ].includes(String(value))
    ? (value as ChatTaskMeta['webStatus'])
    : undefined;
}

function normalizeWebPromptProvider(
  value: unknown,
): ChatTaskMeta['webProvider'] | undefined {
  if (value === 'chatgpt' || value === 'deepseek') return value;
  if (typeof value !== 'string') return undefined;
  return /^custom:[a-z0-9_-]{1,48}$/.test(value)
    ? (value as `custom:${string}`)
    : undefined;
}

function normalizePdfSelectionLocator(
  value: unknown,
): ChatTaskMeta['pdfSelection'] | null {
  if (!isRecord(value)) return null;
  const attachmentID =
    typeof value.attachmentID === 'number' ? value.attachmentID : null;
  const selectedText =
    typeof value.selectedText === 'string' ? value.selectedText : '';
  const position = isRecord(value.position) ? value.position : null;
  if (attachmentID == null || !selectedText || !position) return null;
  const pageIndex = optionalNumber(value.pageIndex);
  const pageLabel =
    typeof value.pageLabel === 'string' ? value.pageLabel : undefined;
  return {
    attachmentID,
    selectedText,
    ...(pageIndex != null ? { pageIndex } : {}),
    ...(pageLabel ? { pageLabel } : {}),
    position: { ...position },
  };
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeAnnotationDraft(
  value: unknown,
): AssistantAnnotationDraft | null {
  if (!isRecord(value)) return null;
  const comment = typeof value.comment === 'string' ? value.comment : '';
  if (!comment) return null;
  const snapshot = isRecord(value.snapshot) ? value.snapshot : null;
  if (!snapshot) return null;
  const text = typeof snapshot.text === 'string' ? snapshot.text : '';
  const attachmentID =
    typeof snapshot.attachmentID === 'number' ? snapshot.attachmentID : null;
  const annotation = isRecord(snapshot.annotation) ? snapshot.annotation : null;
  if (!text || attachmentID == null || !annotation) return null;
  const color = normalizeAnnotationColor(value.color);
  const state = normalizeAnnotationDraftState(value.state);
  const textState = normalizeAnnotationDraftState(value.textState);
  return {
    comment,
    ...(color ? { color } : {}),
    snapshot: { text, attachmentID, annotation },
    state,
    ...(textState.kind !== 'idle' ? { textState } : {}),
  };
}

function normalizeAnnotationColor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const color = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : '';
}

function normalizeAnnotationDraftState(
  value: unknown,
): NonNullable<AssistantAnnotationDraft['textState']> {
  if (!isRecord(value)) return { kind: 'idle' };
  if (value.kind === 'saved' && typeof value.annotationID === 'number') {
    const savedAt =
      typeof value.savedAt === 'number' ? value.savedAt : Date.now();
    return { kind: 'saved', annotationID: value.annotationID, savedAt };
  }
  if (value.kind === 'failed' && typeof value.error === 'string') {
    return { kind: 'failed', error: value.error };
  }
  return { kind: 'idle' };
}

function normalizeImages(value: unknown): NonNullable<Message['images']> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((image) => {
    if (!isRecord(image)) return [];
    if (
      typeof image.id !== 'string' ||
      typeof image.name !== 'string' ||
      typeof image.mediaType !== 'string' ||
      typeof image.dataUrl !== 'string' ||
      typeof image.size !== 'number'
    ) {
      return [];
    }
    return [
      {
        id: image.id,
        ...(typeof image.marker === 'string' ? { marker: image.marker } : {}),
        name: image.name,
        mediaType: image.mediaType,
        dataUrl: image.dataUrl,
        size: image.size,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function threadKey(itemID: number | null): string {
  return itemID == null ? 'global' : `item:${itemID}`;
}

function getZotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}

// ---------------------------------------------------------------------------
// Cloud sync export/import.
//
// Both functions go DIRECTLY to the threads file (not through
// `saveChatMessages`) to keep bulk import as a single write — going through
// the public API would write once per thread and serialize on writeQueue.
// We DO chain on writeQueue so a concurrent in-flight chat save doesn't
// race with the import.

export async function exportAllThreads(): Promise<PortableThread[]> {
  const threads = await readThreads();
  const result: PortableThread[] = [];
  for (const [key, thread] of Object.entries(threads)) {
    const identity =
      key === 'global' || thread.itemID == null
        ? { libraryType: 'global' as const }
        : portableFromItemID(thread.itemID);
    if (!identity) continue; // item no longer in local library — drop
    const workspace = normalizeWorkspace(thread);
    for (const conversation of workspace.conversations) {
      result.push({
        ...identity,
        conversationID: conversation.id,
        title: conversation.title,
        ...(conversation.presetID ? { presetID: conversation.presetID } : {}),
        draftText: conversation.draftText,
        historyMode: conversation.historyMode,
        ...(conversation.branchOrigin
          ? { branchOrigin: conversation.branchOrigin }
          : {}),
        createdAt: conversation.createdAt,
        active: conversation.id === workspace.activeConversationID,
        updatedAt: conversation.updatedAt,
        messages: normalizeMessages(conversation.messages),
      });
    }
  }
  return result;
}

export function importAllThreads(
  portable: PortableThread[],
): Promise<ImportThreadsResult> {
  // Chain on writeQueue so we don't race a chat save in flight.
  let outcome: ImportThreadsResult = {
    imported: 0,
    unchanged: 0,
    unresolved: 0,
  };
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const existing = await readThreads();
      let imported = 0;
      let unchanged = 0;
      let unresolved = 0;
      for (const candidate of portable) {
        const localKey = resolvePortableKey(candidate);
        if (!localKey) {
          unresolved += 1;
          continue;
        }
        const safeMessages = normalizeMessages(candidate.messages);
        const candidateBranchOrigin = normalizeBranchOrigin(
          candidate.branchOrigin,
        );
        const existingThread = existing[localKey];
        const isConversationPayload =
          typeof candidate.conversationID === 'string' &&
          candidate.conversationID.length > 0;
        if (!isConversationPayload && safeMessages.length === 0) continue;
        const conversationID = isConversationPayload
          ? candidate.conversationID!
          : 'default';
        const workspace = existingThread
          ? normalizeWorkspace(existingThread)
          : {
              activeConversationID: conversationID,
              conversations: [],
            };
        const before = JSON.stringify(workspace);
        let conversation = workspace.conversations.find(
          (entry) => entry.id === conversationID,
        );
        if (!conversation) {
          conversation = {
            id: conversationID,
            title:
              candidate.title?.trim() ||
              `对话 ${workspace.conversations.length + 1}`,
            createdAt: candidate.createdAt || candidate.updatedAt,
            updatedAt: candidate.updatedAt,
            messages: [],
            ...(candidate.presetID ? { presetID: candidate.presetID } : {}),
            draftText: candidate.draftText ?? '',
            historyMode: normalizeHistoryMode(candidate.historyMode),
            ...(candidateBranchOrigin
              ? { branchOrigin: candidateBranchOrigin }
              : {}),
          };
          workspace.conversations.push(conversation);
        }
        conversation.messages = mergeMessages(
          conversation.messages,
          safeMessages,
        );
        if (candidate.updatedAt >= conversation.updatedAt) {
          conversation.updatedAt = candidate.updatedAt;
          if (candidate.title?.trim())
            conversation.title = candidate.title.trim();
          if (candidate.createdAt) conversation.createdAt = candidate.createdAt;
          if (candidate.draftText !== undefined) {
            conversation.draftText = candidate.draftText;
          }
          if (candidate.historyMode) {
            conversation.historyMode = normalizeHistoryMode(
              candidate.historyMode,
            );
          }
          if (candidateBranchOrigin) {
            conversation.branchOrigin = candidateBranchOrigin;
          } else if (isConversationPayload) {
            delete conversation.branchOrigin;
          }
          if (candidate.presetID) {
            conversation.presetID = candidate.presetID;
          } else if (isConversationPayload) {
            delete conversation.presetID;
          }
        }
        if (candidate.active === true) {
          workspace.activeConversationID = conversationID;
        }
        const after = JSON.stringify(workspace);
        if (existingThread && before === after) {
          unchanged += 1;
          continue;
        }
        existing[localKey] = {
          itemID:
            existingThread?.itemID ??
            (candidate.libraryType === 'global'
              ? null
              : itemIDForKey(localKey)),
          updatedAt: maxIso(existingThread?.updatedAt, candidate.updatedAt),
          activeConversationID: workspace.activeConversationID,
          conversations: workspace.conversations,
        };
        imported += 1;
      }
      await writeThreads(existing);
      outcome = { imported, unchanged, unresolved };
    });
  return writeQueue.then(() => outcome);
}

function mergeMessages(local: Message[], incoming: Message[]): Message[] {
  const seen = new Set(local.map(messageSignature));
  const merged = [...local];
  for (const message of incoming) {
    const signature = messageSignature(message);
    if (seen.has(signature)) continue;
    seen.add(signature);
    merged.push(message);
  }
  return merged;
}

function messageSignature(message: Message): string {
  return JSON.stringify(message);
}

function maxIso(a: string | undefined, b: string): string {
  return a && a >= b ? a : b;
}

function portableFromItemID(
  itemID: number,
): Pick<PortableThread, 'libraryType' | 'groupID' | 'itemKey'> | null {
  const Zotero = getZotero();
  const item = Zotero.Items?.get(itemID);
  if (!item || typeof item.key !== 'string' || item.key.length === 0)
    return null;
  const libraryID = item.libraryID;
  if (typeof libraryID !== 'number') return null;
  const library = Zotero.Libraries?.get(libraryID);
  if (library?.libraryType === 'group') {
    // Prefer the group's portable groupID (stable across machines) over the
    // local libraryID. WHY: libraryID is reassigned per database; groupID
    // is the global Zotero group identifier.
    const groupID =
      typeof library.groupID === 'number' ? library.groupID : undefined;
    if (typeof groupID !== 'number') return null;
    return { libraryType: 'group', groupID, itemKey: item.key };
  }
  return { libraryType: 'user', itemKey: item.key };
}

function resolvePortableKey(thread: PortableThread): string | null {
  if (thread.libraryType === 'global') return 'global';
  const Zotero = getZotero();
  if (typeof thread.itemKey !== 'string' || thread.itemKey.length === 0)
    return null;
  let libraryID: number | undefined;
  if (thread.libraryType === 'group') {
    if (typeof thread.groupID !== 'number') return null;
    const group = Zotero.Groups?.get(thread.groupID);
    if (!group || typeof group.libraryID !== 'number') return null;
    libraryID = group.libraryID;
  } else {
    libraryID = Zotero.Libraries?.userLibraryID;
  }
  if (typeof libraryID !== 'number') return null;
  const item = Zotero.Items?.getByLibraryAndKey(libraryID, thread.itemKey);
  if (!item) return null;
  // We don't have a public itemID accessor on the item-like; the legacy
  // storage layout is `item:<itemID>`, so we round-trip via Zotero's
  // typed shape. The cast is safe — Zotero items always expose `id`.
  const id = (item as unknown as { id?: number }).id;
  if (typeof id !== 'number') return null;
  return `item:${id}`;
}

function itemIDForKey(threadKey: string): number | null {
  if (!threadKey.startsWith('item:')) return null;
  const id = Number(threadKey.slice('item:'.length));
  return Number.isFinite(id) ? id : null;
}
