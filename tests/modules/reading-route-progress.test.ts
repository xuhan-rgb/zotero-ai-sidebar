import { afterEach, expect, it, vi } from "vitest";
import { bindReadingRouteProgress } from "../../src/modules/reading-route-progress";
import type { ChatTaskMeta } from "../../src/providers/types";

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
it("shows compact feedback without duplicating WEB task stages", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const message = document.createElement("div");
  const button = document.createElement("button");
  host.append(message, button); document.body.append(host);
  let task: ChatTaskMeta | undefined;
  const binding = bindReadingRouteProgress(host, message, button, () => ({ task }));
  let resolve!: () => void;
  const pending = binding.run(() => new Promise<void>(r => { resolve = r; }));
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("正在生成阅读路线…");
  expect(button.querySelector(".assistant-live-spinner")).not.toBeNull();
  task = { id: "route", kind: "reading_route", title: "路线", promptPreview: "", createdAt: Date.now(), webProvider: "deepseek", webStatus: "uploading_attachment" };
  resolve(); await pending;
  expect(button.disabled).toBe(true);
  expect(host.querySelector(".web-task-progress")).toBeNull();
  task.webStatus = "generating";
  vi.advanceTimersByTime(500);
  expect(button.textContent).toBe("正在生成阅读路线…");
  expect(host.textContent).not.toContain("4/5");
  task.error = "上传失败";
  vi.advanceTimersByTime(500);
  expect(button.disabled).toBe(false);
  expect(message.textContent).toContain("上传失败");
  expect(button.querySelector(".assistant-live-spinner")).toBeNull();
  binding.dispose();
});
it("restores a running task when reopening and clears its poller on disposal", () => {
  vi.useFakeTimers();
  const host = document.createElement("div"), message = document.createElement("div"), button = document.createElement("button");
  host.append(message, button); document.body.append(host);
  const task: ChatTaskMeta = { id: "api", kind: "reading_route", title: "路线", promptPreview: "", createdAt: Date.now() };
  const binding = bindReadingRouteProgress(host, message, button, () => ({ task }));
  expect(button.disabled).toBe(true);
  vi.advanceTimersByTime(2000);
  expect(host.textContent).not.toContain("秒");
  expect(button.querySelector(".assistant-live-spinner")).not.toBeNull();
  task.cancelledAt = Date.now(); vi.advanceTimersByTime(500);
  expect(message.textContent).toContain("已取消");
  binding.dispose(); expect(vi.getTimerCount()).toBe(0);
});

it("keeps overview generation feedback after the WEB request is queued", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div"), message = document.createElement("div"), button = document.createElement("button");
  host.append(message, button); document.body.append(host);
  let task: ChatTaskMeta | undefined;
  const binding = bindReadingRouteProgress(host, message, button, () => ({ task }), "全文总览");
  expect(message.textContent).toBe("还没有全文总览。");
  await binding.run(async () => {
    expect(button.textContent).toBe("正在生成全文总览…");
    task = { id: "overview", kind: "general", title: "WEB · 全文总览", promptPreview: "", createdAt: Date.now(), webPaperAction: "overview", webStatus: "queued" };
  });
  vi.advanceTimersByTime(500);
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("正在生成全文总览…");
  expect(host.querySelector(".web-task-progress")).toBeNull();
  task!.completedAt = Date.now();
  vi.advanceTimersByTime(500);
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe("重新生成全文总览");
  binding.dispose();
});
