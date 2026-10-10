import type { ChatTaskMeta, WebTaskStatus } from "../providers/types";
import { el } from "./dom-utils";
import { uiText } from "../utils/ui-locale";

const PHASE_LABELS = ["启动", "材料", "提交", "生成", "同步"] as const;
const PHASE_LABELS_EN = ["Starting", "Preparing", "Submitting", "Generating", "Syncing"] as const;

export interface WebTaskProgress {
  index: number;
  label: string;
  detail: string;
  startedAt: number;
}

export function webTaskProgressFor(
  task: ChatTaskMeta | undefined,
  providerName: string,
): WebTaskProgress | null {
  if (!task || task.completedAt || task.cancelledAt || task.error) return null;
  const status = task.webStatus || "queued";
  const index = webTaskProgressIndex(status);
  return {
    index,
    label: webTaskProgressLabel(status, providerName),
    detail: uiText(`${index + 1}/${PHASE_LABELS.length} · ${PHASE_LABELS[index]}阶段`, `${index + 1}/${PHASE_LABELS.length} · ${PHASE_LABELS_EN[index]}`),
    startedAt: task.createdAt,
  };
}

export function renderWebTaskProgress(
  doc: Document,
  progress: WebTaskProgress,
  now = Date.now(),
): HTMLElement {
  const root = el(doc, "section", "web-task-progress");
  root.setAttribute("aria-live", "polite");
  const head = el(doc, "div", "web-task-progress-head");
  const label = el(doc, "strong", "web-task-progress-label", progress.label);
  const elapsed = el(doc, "span", "web-task-progress-elapsed");
  const updateElapsed = (timestamp: number) => {
    elapsed.textContent = uiText(`已等待 ${formatWebWaitTime(timestamp - progress.startedAt)}`, `Waiting ${formatWebWaitTime(timestamp - progress.startedAt)}`);
  };
  updateElapsed(now);
  head.append(label, elapsed);

  const track = el(doc, "div", "web-task-progress-track");
  PHASE_LABELS.forEach((phase, index) => {
    const segment = el(doc, "span", "web-task-progress-segment");
    segment.classList.toggle("is-complete", index < progress.index);
    segment.classList.toggle("is-active", index === progress.index);
    segment.title = uiText(phase, PHASE_LABELS_EN[index]);
    track.append(segment);
  });
  root.append(
    head,
    track,
    el(doc, "div", "web-task-progress-detail", progress.detail),
  );

  const view = doc.defaultView;
  if (view) {
    const timer = view.setInterval(() => {
      if (!root.isConnected) {
        view.clearInterval(timer);
        return;
      }
      updateElapsed(Date.now());
    }, 1_000);
  }
  return root;
}

export function formatWebWaitTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return uiText(`${seconds}秒`, `${seconds}s`);
  const minutes = Math.floor(seconds / 60);
  return uiText(`${minutes}分${String(seconds % 60).padStart(2, "0")}秒`, `${minutes}:${String(seconds % 60).padStart(2, "0")}`);
}

function webTaskProgressIndex(status: WebTaskStatus): number {
  switch (status) {
    case "uploading_attachment":
      return 1;
    case "submitting":
      return 2;
    case "generating":
      return 3;
    case "processing_answer":
      return 4;
    default:
      return 0;
  }
}

function webTaskProgressLabel(
  status: WebTaskStatus,
  providerName: string,
): string {
  switch (status) {
    case "starting_browser":
      return uiText(`正在连接 ${providerName} 专用浏览器`, `Connecting to the ${providerName} browser`);
    case "needs_login":
      return uiText(`等待完成 ${providerName} 登录或网页验证`, `Waiting for ${providerName} login or website verification`);
    case "uploading_attachment":
      return uiText("正在上传论文和对话材料", "Uploading paper and conversation materials");
    case "submitting":
      return uiText(`正在向 ${providerName} 提交问题`, `Submitting the prompt to ${providerName}`);
    case "generating":
      return uiText(`${providerName} 正在思考并生成回答`, `${providerName} is thinking and generating a response`);
    case "processing_answer":
      return uiText("正在整理图表、文件并同步回答", "Organizing figures and files, then syncing the response");
    default:
      return uiText(`等待执行 ${providerName} 网页任务`, `Waiting for the ${providerName} web task`);
  }
}
