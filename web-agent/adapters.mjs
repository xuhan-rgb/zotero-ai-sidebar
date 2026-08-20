export const PROVIDERS = {
  chatgpt: {
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    host: "chatgpt.com",
    composer: [
      "#prompt-textarea",
      "textarea[data-id='root']",
      "div[contenteditable='true'][data-virtualkeyboard]",
    ],
    send: [
      "button[data-testid='send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label*='发送']",
    ],
    stop: [
      "button[data-testid='stop-button']",
      "button[aria-label*='Stop']",
      "button[aria-label*='停止']",
    ],
    copy: [
      "button[aria-label*='Copy']",
      "button[aria-label*='复制']",
      "[role='button'][aria-label*='Copy']",
      "[role='button'][aria-label*='复制']",
      "button[title*='Copy']",
      "[data-testid*='copy']",
      "[class*='copy']",
    ],
    answers: ["[data-message-author-role='assistant']"],
    attachmentPreviews: [
      "[data-testid*='attachment']",
      "[class*='file-pill']",
      "[class*='attachment']",
      "[data-composer-body] [role='group'][aria-label$='.pdf' i]",
      "[data-composer-body] [role='group'][aria-label$='.txt' i]",
      "[data-composer-body] [role='group'][aria-label$='.tex' i]",
    ],
    attachmentUploading: [
      "[role='progressbar']",
      "[aria-busy='true']",
      "[data-state='loading']",
      "[data-state='uploading']",
      "[class*='upload'][class*='loading']",
      "[class*='attachment'][class*='loading']",
      "[data-composer-body] [role='group'][aria-label] [class*='animate-spin']",
      "[data-composer-body] [role='group'][aria-label] [class*='spin']",
      "[data-composer-body] [role='group'][aria-label] svg[class*='loading']",
      "[data-composer-body] [role='group'][aria-label] [role='progressbar']",
      "[data-composer-body] [role='group'][aria-label] [aria-busy='true']",
    ],
  },
  deepseek: {
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    host: "chat.deepseek.com",
    composer: [
      "textarea[placeholder*='DeepSeek']",
      "textarea[placeholder*='Message']",
      "textarea[placeholder*='发送']",
      "textarea",
      "div[contenteditable='true']",
    ],
    send: [
      "button[aria-label*='Send']",
      "button[aria-label*='发送']",
      "div[role='button'][aria-label*='Send']",
      "div[role='button'][aria-label*='发送']",
      // Current DeepSeek uses an unlabeled role button for the blue submit
      // control. The primary circle is scoped to the composer by visibility
      // and remains compatible with the older aria-labelled variants above.
      "div[role='button'].ds-button--primary",
    ],
    stop: [
      "button[aria-label*='Stop']",
      "button[aria-label*='停止']",
      "div[role='button'][aria-label*='Stop']",
      "div[role='button'][aria-label*='停止']",
    ],
    copy: [
      "button[aria-label*='Copy']",
      "button[aria-label*='复制']",
      "[role='button'][aria-label*='Copy']",
      "[role='button'][aria-label*='复制']",
      "button[title*='复制']",
      "button[title*='Copy']",
      "[data-testid*='copy']",
      "[class*='copy']",
    ],
    answers: [
      ".ds-message .ds-assistant-message-main-content",
      ".ds-assistant-message-main-content",
      "[class*='ds-assistant-message'] .ds-markdown",
    ],
    reasoning: [".ds-think-content .ds-markdown"],
    attachmentPreviews: [
      "[class*='file']",
      "[class*='attachment']",
      "[class*='upload']",
    ],
    attachmentUploading: [
      "[role='progressbar']",
      "[class*='upload'][class*='loading']",
      "[class*='file'][class*='loading']",
    ],
  },
};

const CUSTOM_COPY_SELECTORS = [
  "button[aria-label*='Copy']",
  "button[aria-label*='复制']",
  "[role='button'][aria-label*='Copy']",
  "[role='button'][aria-label*='复制']",
  "button[title*='Copy']",
  "button[title*='复制']",
  "[data-testid*='copy']",
  "[class*='copy']",
];

export function providerDefinition(provider, customProvider) {
  if (String(provider).startsWith("custom:")) {
    if (!customProvider || `custom:${customProvider.id}` !== provider) {
      throw new Error(`Missing custom provider definition: ${provider}`);
    }
    return customProviderDefinition(customProvider);
  }
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error(`Unsupported provider: ${provider}`);
  return definition;
}

export function customProviderDefinition(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid custom provider definition");
  }
  const id = cleanText(value.id, 48).toLowerCase();
  const name = cleanText(value.name, 80);
  if (!/^[a-z0-9_-]+$/.test(id) || !name) {
    throw new Error("Invalid custom provider id or name");
  }
  const homeUrl = safeHttpUrl(value.homeUrl);
  const newConversationUrl = safeHttpUrl(value.newConversationUrl || value.homeUrl);
  const selectors = value.selectors;
  if (!selectors || typeof selectors !== "object") {
    throw new Error("Custom provider selectors are required");
  }
  const normalized = {
    composer: safeSelectors(selectors.composer, true),
    send: safeSelectors(selectors.send, true),
    stop: safeSelectors(selectors.stop, false),
    // ChatGPT-like sites frequently keep the assistant role in generated
    // class names instead of a stable data attribute. The semantic markdown
    // class is a safe fallback and lets URL-only custom providers keep
    // receiving live answers when their DOM build changes.
    answers: appendSelector(
      safeSelectors(selectors.answers, true),
      "[class*='_markdown'].markdown",
    ),
    reasoning: safeSelectors(selectors.reasoning, false),
    attachmentPreviews: safeSelectors(selectors.attachmentPreviews, false),
    attachmentUploading: safeSelectors(selectors.attachmentUploading, false),
  };
  normalized.stop ||= ["button[aria-label*='Stop']", "button[aria-label*='停止']"];
  normalized.attachmentPreviews ||= ["[class*='attachment']", "[class*='file']"];
  normalized.attachmentUploading ||= ["[role='progressbar']", "[aria-busy='true']"];
  return {
    id,
    name,
    template: "chatgpt-like",
    url: newConversationUrl,
    accountUrl: homeUrl,
    host: new URL(homeUrl).hostname,
    ...normalized,
    copy: CUSTOM_COPY_SELECTORS,
  };
}

function cleanText(value, limit) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit)
    : "";
}

function safeHttpUrl(value) {
  if (typeof value !== "string") throw new Error("Custom provider URL is required");
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Custom provider URL must use http or https");
  }
  return url.toString();
}

function safeSelectors(value, required) {
  const values = Array.isArray(value) ? value : [];
  const result = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const selector = item.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (
      !selector ||
      selector.length > 240 ||
      /(?:javascript:|<script|=>|\b(?:eval|Function|setTimeout|setInterval)\s*\()/i.test(selector)
    ) continue;
    if (!result.includes(selector)) result.push(selector);
    if (result.length >= 24) break;
  }
  if (required && !result.length) throw new Error("Custom provider selector is required");
  return result;
}

function appendSelector(selectors, fallback) {
  if (!selectors.includes(fallback)) selectors.push(fallback);
  return selectors;
}

export function selectorList(selectors) {
  return selectors?.length ? selectors.join(", ") : ":not(*)";
}

export async function firstPopulatedLocator(page, selectors) {
  for (const selector of selectors || []) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0) return locator;
  }
  return page.locator(":not(*)");
}
