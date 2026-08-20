import type { ChatTaskMeta, WebTaskStatus } from "../providers/types";
import { el } from "./dom-utils";

const PHASE_LABELS = ["启动", "材料", "提交", "生成", "同步"] as const;

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
    detail: `${index + 1}/${PHASE_LABELS.length} · ${PHASE_LABELS[index]}阶段`,
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
    elapsed.textContent = `已等待 ${formatWebWaitTime(timestamp - progress.startedAt)}`;
  };
  updateElapsed(now);
  head.append(label, elapsed);

  const track = el(doc, "div", "web-task-progress-track");
  PHASE_LABELS.forEach((phase, index) => {
    const segment = el(doc, "span", "web-task-progress-segment");
    segment.classList.toggle("is-complete", index < progress.index);
    segment.classList.toggle("is-active", index === progress.index);
    segment.title = phase;
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
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}分${String(seconds % 60).padStart(2, "0")}秒`;
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
      return `正在连接 ${providerName} 专用浏览器`;
    case "needs_login":
      return `等待完成 ${providerName} 登录`;
    case "uploading_attachment":
      return "正在上传论文和对话材料";
    case "submitting":
      return `正在向 ${providerName} 提交问题`;
    case "generating":
      return `${providerName} 正在思考并生成回答`;
    case "processing_answer":
      return "正在整理图表、文件并同步回答";
    default:
      return `等待执行 ${providerName} 网页任务`;
  }
}
