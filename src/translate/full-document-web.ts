import type { TranslationBatchEntry } from "./full-document-batch";
import {
  createWebPromptTask,
  discardWebPromptTask,
} from "../modules/web-prompt-hub";
import {
  dispatchWebAgentTask,
  cancelWebAgentTask,
} from "../modules/web-agent-client";
import type {
  LocalUiSettings,
  CustomWebProvider,
} from "../settings/local-ui-settings";
import { cleanTranslationOutput, translationNeedsRetry } from "./translator";

export interface FullDocumentWebOptions {
  settings: LocalUiSettings;
  customProvider?: CustomWebProvider;
  arxivId: string;
  signal: AbortSignal;
}

// Reuse the WEB task callback protocol; the document runner still owns chunking,
// math-token validation and persistence. No API credentials are involved.
export function createFullDocumentWebTranslator(
  options: FullDocumentWebOptions,
) {
  const provider = options.settings.webPromptProvider;
  if (provider.startsWith("custom:") && !options.customProvider) {
    throw new Error("自定义网页配置不存在，请先在 WEB 模式中配置账号。");
  }
  const sessionKey = `full-translation:${options.arxivId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let lastBatchCompleted = 0;
  return {
    preset: { id: `web:${provider}` },
    model: options.customProvider?.name ?? provider,
    stopOnError: true,
    translateBatch: async (entries: TranslationBatchEntry[]) => {
      const wait = lastBatchCompleted
        ? Math.max(0, lastBatchCompleted + 15_000 - Date.now())
        : 0;
      if (wait) await waitBetweenBatches(wait, options.signal);
      const prompt = [
        "把以下一批论文段落翻译成简体中文，不总结、不解释。",
        "将全部译文放在一个 ```text 代码块中。每段保留原样的起始标记 <<<ZAI_TRANSLATION:原段落id>>> 和结束标记 <<<END_ZAI_TRANSLATION:原段落id>>>，标记各独占一行，中间只放译文。每个输入 id 恰好返回一次，不能合并或遗漏段落。",
        "直接输出正文中的 LaTeX 反斜杠和换行，不要使用 JSON 字符串或对正文再次转义。",
        "每段中的 ZAILATEXTOKEN数字X 必须逐字保留且出现次数不变；保留 LaTeX 命令、算法结构和 [1] 等引用编号，不要把引用改成公式。",
        "仅处理本条消息中的段落，不重复之前批次。",
        entries
          .map(
            (entry) =>
              `<<<ZAI_TRANSLATION:${entry.id}>>>\n${entry.text}\n<<<END_ZAI_TRANSLATION:${entry.id}>>>`,
          )
          .join("\n\n"),
      ].join("\n\n");
      try {
        const answer = await requestWebTranslation(prompt, options, sessionKey);
        const values = parseWebTranslationBatch(answer, entries);
        for (const entry of entries) {
          const output = values.find((item) => item.id === entry.id);
          if (output && translationNeedsRetry(entry.text, output.text))
            throw new Error("WEB 批次未返回有效中文译文，已暂停。");
        }
        return values;
      } finally {
        lastBatchCompleted = Date.now();
      }
    },
    translate: async (source: string) => {
      const prompt = [
        "将下面的论文原文翻译为简体中文，只输出译文，不解释、不总结、不添加标题。",
        "所有 ZAILATEXTOKEN数字X 占位符必须逐字保留且各出现一次，不能增加、删除或改写。",
        "保留 LaTeX 命令、算法结构、数字和引用编号；引用 [1] 不要改写为 \\[1\\]。",
        "仅处理本条消息中的原文，忽略之前消息的翻译内容。",
        "原文：",
        source,
      ].join("\n\n");
      const text = cleanTranslationOutput(
        await requestWebTranslation(prompt, options, sessionKey),
      );
      if (!text || translationNeedsRetry(source, text)) {
        throw new Error("网页未返回有效中文译文，请检查网页状态后重试。");
      }
      return { text };
    },
  };
}

// Raw fenced text avoids JSON escape sequences corrupting LaTeX (e.g. \tcc).
function parseWebTranslationBatch(
  answer: string,
  entries: TranslationBatchEntry[],
): TranslationBatchEntry[] {
  const text = answer.trim();
  const values: TranslationBatchEntry[] = [];
  const remainder = text.replace(
    /^<<<ZAI_TRANSLATION:([^<>\r\n]+)>>>\r?\n([\s\S]*?)\r?\n<<<END_ZAI_TRANSLATION:\1>>>[ \t]*(?=\r?$)/gm,
    (_match, id: string, content: string) => {
      values.push({ id, text: content });
      return "";
    },
  );
  // Website code cards can add language labels or controls outside the blocks.
  // Ignore that surrounding text, but never ignore an unmatched protocol marker.
  if (/ZAI_TRANSLATION:/.test(remainder) || !values.length) {
    throw new Error(
      "WEB 批量译文缺少完整的段落起止标记或包含格式错误，已暂停。请重试失败批次。",
    );
  }
  const ids = new Set(values.map((entry) => entry.id));
  if (
    values.length !== entries.length ||
    ids.size !== values.length ||
    entries.some((entry) => !ids.has(entry.id))
  ) {
    throw new Error(
      "WEB 批量译文的段落编号有遗漏、重复或不匹配，已暂停。请重试失败批次。",
    );
  }
  return values;
}

function requestWebTranslation(
  prompt: string,
  options: FullDocumentWebOptions,
  sessionKey: string,
): Promise<string> {
  if (options.signal.aborted) return Promise.reject(new Error("翻译已取消"));
  return new Promise((resolve, reject) => {
    let settled = false;
    let cancelled = false;
    let taskId = "";
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      discardWebPromptTask(taskId);
      if (error) reject(error);
      else resolve(text ?? "");
    };
    const cancel = () => {
      cancelled = true;
      void cancelWebAgentTask(taskId).catch(() => undefined);
    };
    const abort = () => {
      finish(new Error("翻译已取消"));
      cancel();
    };
    const task = createWebPromptTask({
      provider: options.settings.webPromptProvider,
      prompt,
      sourceLabel: `全文翻译 ${options.arxivId}`,
      onImport: (result) => {
        if (result.pageNotice)
          finish(
            new Error(
              /频繁|rate.?limit|too many requests/i.test(result.answer)
                ? "网站提示请求过于频繁，已暂停翻译。请稍后继续，已完成内容会保留。"
                : "网页返回了登录或验证提示，请检查 WEB 账号后重试。",
            ),
          );
        else finish(undefined, result.answer);
      },
      onStatus: (status, error) => {
        if (status === "failed" || status === "cancelled")
          finish(new Error(error || "网页翻译任务已停止。"));
      },
    });
    taskId = task.id;
    options.signal.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(() => {
      finish(new Error("网页翻译等待超时，请检查网页后重试。"));
      cancel();
    }, 10 * 60_000);
    if (options.signal.aborted) {
      abort();
      return;
    }
    void dispatchWebAgentTask({
      id: taskId,
      provider: options.settings.webPromptProvider,
      prompt,
      continuationPrompt: prompt,
      sessionKey,
      paperUrl: `https://arxiv.org/abs/${options.arxivId}`,
      hideBrowser: options.settings.hideWebBrowser,
      chatgptOptions: options.settings.chatgptWeb,
      customProvider: options.customProvider,
    }).then(
      () => {
        // Cancellation can happen during browser/account startup, before enqueue.
        if (cancelled || options.signal.aborted) cancel();
      },
      (error) =>
        finish(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function waitBetweenBatches(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("翻译已取消"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("翻译已取消"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
