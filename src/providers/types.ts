import type { AgentPermissionMode, ModelPreset } from "../settings/types";
import type { MessageContext } from "../context/types";
import type { OverviewData } from "../context/overview-types";
import type { ToolSettings } from "../settings/tool-settings";
import type { WebPromptProvider } from "../settings/local-ui-settings";

export type MessageRole = "user" | "assistant";

export interface MindmapNode {
  id: string;
  label: string;
  type?: "root" | "section" | "point" | "result" | "innovation";
  sectionNo?: string; // back-link from a structural node to a document section
}

export interface MindmapEdge {
  source: string;
  target: string;
  label?: string;
}

export interface MindmapData {
  title?: string;
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  source?: string; // original mermaid text, when parsed from a code block
  rankdir?: "TB" | "LR"; // layout direction; renderer default stays LR
}

export interface Message {
  role: MessageRole;
  content: string;
  thinking?: string;
  usage?: MessageUsage;
  images?: MessageImage[];
  context?: MessageContext;
  annotationDraft?: AssistantAnnotationDraft;
  webAnnotationBatch?: WebAnnotationBatchDraft;
  mindmap?: MindmapData;
  overview?: OverviewData;
  task?: ChatTaskMeta;
}

export interface WebAnnotationBatchDraft {
  createdAt: number;
  error?: string;
  entries: WebAnnotationBatchEntry[];
}

export interface WebAnnotationBatchEntry {
  quote: string;
  comment: string;
  color?: string;
  locateState: "pending" | "located" | "not_found" | "failed";
  confidence?: number;
  pageLabel?: string;
  snapshot?: AssistantAnnotationDraft["snapshot"];
  state: AssistantAnnotationDraftState;
}

export interface MessageUsage {
  input: number;
  output: number;
  cacheRead?: number;
}

export type ChatTaskKind =
  | "general"
  | "selection"
  | "full_text"
  | "reading_route";

export type WebTaskStatus =
  | "queued"
  | "starting_browser"
  | "needs_login"
  | "uploading_attachment"
  | "submitting"
  | "generating"
  | "processing_answer";

export interface ChatTaskMeta {
  id: string;
  kind: ChatTaskKind;
  title: string;
  promptPreview: string;
  createdAt: number;
  completedAt?: number;
  viewedAt?: number;
  hiddenAt?: number;
  cancelledAt?: number;
  error?: string;
  webProvider?: WebPromptProvider;
  webStatus?: WebTaskStatus;
  pdfSelection?: PdfSelectionLocator;
}

export interface PdfSelectionLocator {
  attachmentID: number;
  selectedText: string;
  pageIndex?: number;
  pageLabel?: string;
  position: Record<string, unknown>;
}

export interface AssistantAnnotationDraft {
  comment: string;
  color?: string;
  snapshot: {
    text: string;
    attachmentID: number;
    annotation: Record<string, unknown>;
  };
  state: AssistantAnnotationDraftState;
  textState?: AssistantAnnotationDraftState;
}

export type AssistantAnnotationDraftState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; annotationID: number; savedAt: number }
  | { kind: "failed"; error: string };

export interface MessageImage {
  id: string;
  marker?: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  size: number;
}

export interface ToolExecutionResult {
  output: string;
  summary?: string;
  // Structured failure: callers may retry/fall back, but must not register
  // this response as successful evidence.
  isError?: boolean;
  context?: MessageContext;
  // Raw paper full text a tool wants pinned as the front block for the rest
  // of this turn's tool loop. Set by zotero_get_full_pdf.
  frontBlock?: string;
  // Images the tool wants to attach to the conversation so the model can
  // actually SEE them. The provider adapter delivers these as a follow-up
  // user-turn multimodal message after the tool's function_call_output —
  // because OpenAI/Anthropic tool results are themselves text-only. Used by
  // multimodal tools like `arxiv_get_figure`.
  images?: MessageImage[];
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: { [key: string]: unknown };
  requiresApproval?: boolean;
  execute(args: unknown): Promise<ToolExecutionResult>;
}

export interface ProviderStreamOptions {
  tools?: AgentTool[];
  // Let the model request several independent tools in one response. Local
  // tool execution remains ordered; callers must opt in explicitly.
  parallelToolCalls?: boolean;
  maxToolIterations?: number;
  permissionMode?: AgentPermissionMode;
  toolSettings?: ToolSettings;
  promptCacheKey?: string;
  // Portable Zotero item key (e.g. "FQRVCCJN") of the current item, or
  // null for global / no-item chats. Used by the OpenAI provider only:
  // it picks a per-paper relay-routing salt so requests that hit a dead
  // backend account auto-retry on a different sticky-session bucket.
  // Stays unset / ignored for providers that don't talk to the relay
  // (Anthropic, etc.).
  relayRoutingItemKey?: string | null;
  // Raw paper full text to pin as a front block (after the system prompt,
  // before conversation history). Set by the manual "原文" toggle.
  pinnedFullText?: string;
}

export type StreamChunk =
  | { type: "status"; message: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_images"; images: MessageImage[] }
  | {
      type: "tool_call";
      name: string;
      status: "started" | "completed" | "error";
      summary?: string;
      context?: MessageContext;
    }
  | { type: "usage"; input: number; output: number; cacheRead?: number }
  | { type: "error"; message: string };

export interface Provider {
  stream(
    messages: Message[],
    systemPrompt: string,
    preset: ModelPreset,
    signal: AbortSignal,
    options?: ProviderStreamOptions,
  ): AsyncIterable<StreamChunk>;
}

export type ProviderFactory = (preset: ModelPreset) => Provider;
