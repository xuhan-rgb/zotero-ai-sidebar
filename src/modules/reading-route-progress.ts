import type { ChatTaskMeta } from "../providers/types";

export function bindReadingRouteProgress(
  host: HTMLElement,
  message: HTMLElement,
  button: HTMLButtonElement,
  read: () => { task?: ChatTaskMeta },
  name: "阅读路线" | "全文总览" = "阅读路线",
) {
  const doc = host.ownerDocument!;
  const win = doc.defaultView!;
  let starting = false;
  let previousTaskID: string | undefined;
  let disposed = false;
  message.setAttribute("role", "status");
  const update = () => {
    if (disposed) return;
    const { task } = read();
    const preparing = starting && (!task || task.id === previousTaskID);
    const active = preparing || !!(task && !task.completedAt && !task.cancelledAt && !task.error);
    host.setAttribute("aria-busy", String(active));
    button.disabled = active;
    const label = active ? `正在生成${name}…` : task ? `重新生成${name}` : `✨ 生成${name}`;
    if (button.textContent !== label) {
      button.textContent = label;
      if (active) {
        const spinner = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        spinner.classList.add("assistant-live-spinner");
        spinner.setAttribute("aria-hidden", "true");
        button.prepend(spinner);
      }
    }
    message.textContent = active ? "完成后会自动打开。"
      : task?.error ? `生成失败：${task.error}`
      : task?.cancelledAt ? `${name}生成已取消。`
      : task?.completedAt ? "任务已结束，请查看对话中的保存结果。" : `还没有${name}。`;

  };
  const timer = win.setInterval(() => {
    if (!host.isConnected) { dispose(); return; }
    update();
  }, 500);
  const dispose = () => { disposed = true; win.clearInterval(timer); };
  update();
  return {
    dispose,
    async run(action: () => Promise<void>) {
      if (button.disabled) return;
      previousTaskID = read().task?.id;
      starting = true;
      update();
      try { await action(); }
      finally { starting = false; update(); }
    },
  };
}
