import { renderMarkdownInto } from "./markdown-render";
import type {
  FullTranslationBlockState,
  FullTranslationBlockStatus,
  FullTranslationState,
  FullTranslationUsage,
  FullTranslationUsageEvent,
} from "../settings/full-translation-store";
import {
  DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
  normalizeFullTranslationReadingSettings,
  type FullTranslationLanguageMode,
  type FullTranslationReadingSettings,
} from "../settings/local-ui-settings";
import type {
  FullTranslationBlock,
  FullTranslationDocument,
  FullTranslationTableCell,
} from "../translate/full-document";
import type { FullTranslationAssetPreviews } from "../translate/full-document-assets";
import type { FullTranslationAssetPreview } from "../translate/full-document-assets";
import { splitSentences } from "../translate/sentence-splitter";
import { isTranslationPlaceholderReply } from "../translate/translator";
import { decorateSentenceBoundaries } from "./full-translation-sentence-markers";
import type { TranslateThinking } from "../settings/types";

export type FullTranslationLayout = "parallel" | "interleaved";

export interface FullTranslationModelSettings {
  presetId: string;
  presetLabel: string;
  model: string;
  thinking: TranslateThinking;
  inherited: boolean;
  open: boolean;
  presets: Array<{ id: string; label: string }>;
  models: string[];
  thinkingOptions: Array<[TranslateThinking, string]>;
}

export interface FullTranslationViewOptions {
  document: FullTranslationDocument;
  state: FullTranslationState;
  layout: FullTranslationLayout;
  running: boolean;
  preparing?: boolean;
  runError?: string;
  assets: FullTranslationAssetPreviews;
  readingSettings?: FullTranslationReadingSettings;
  expandedSourceBlockId?: string;
  highlightedSourceQuote?: { blockId: string; quote: string };
  modelSettings?: FullTranslationModelSettings;
  onToggleModelSettings?(): void;
  onModelPresetChange?(presetId: string): void;
  onModelChange?(model: string): void;
  onModelThinkingChange?(thinking: TranslateThinking): void;
  onLayoutChange(layout: FullTranslationLayout): void;
  onRun(): void;
  onRetranslate(): void;
  onTranslateBlock?(blockId: string): void;
  onReadingSettingsChange?(settings: FullTranslationReadingSettings): void;
  onCancel(): void;
  onExit(): void;
}

export function renderFullTranslationView(
  doc: Document,
  options: FullTranslationViewOptions,
): HTMLElement {
  const root = doc.createElement("div");
  const reading = readingSettings(options);
  root.className = [
    "zai-full-translation",
    `is-${options.layout}`,
    reading.languageMode === "bilingual"
      ? "is-bilingual"
      : reading.languageMode === "translation"
        ? "is-translation-only"
        : "is-source-only",
  ].join(" ");
  if (options.highlightedSourceQuote) {
    root.dataset.sourceQuoteBlockId = options.highlightedSourceQuote.blockId;
    root.dataset.sourceQuote = options.highlightedSourceQuote.quote;
  }
  root.append(renderToolbar(doc, options));
  if (options.runError) {
    const error = doc.createElement("div");
    error.className = "zai-ft-run-error";
    error.textContent = `翻译中断：${options.runError}`;
    root.append(error);
  }

  const content = doc.createElement("div");
  content.className = "zai-ft-content";
  for (const block of options.document.blocks) {
    content.append(renderBlockPair(doc, block, options));
  }
  const reader = doc.createElement("div");
  reader.className = "zai-ft-reader";
  reader.append(renderOutline(doc, options, content), content);
  const blockMenu = renderBlockContextMenu(doc, root, content, options);
  root.append(reader, blockMenu);
  root.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    if (!target) return;
    const modelSettings = root.querySelector<HTMLElement>(
      ".zai-ft-model-settings",
    );
    if (
      options.modelSettings?.open &&
      modelSettings &&
      !modelSettings.contains(target)
    ) {
      options.onToggleModelSettings?.();
    }
    for (const popover of root.querySelectorAll<HTMLDetailsElement>(
      ".zai-ft-toolbar-popover[open]",
    )) {
      if (!popover.contains(target)) popover.open = false;
    }
    if (!blockMenu.contains(target)) closeBlockContextMenu(blockMenu);
  });
  root.addEventListener("keydown", (event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key !== "Escape") return;
    if (closeBlockContextMenu(blockMenu)) {
      event.preventDefault();
      return;
    }
    const expanded = root.querySelector<HTMLElement>(
      ".zai-ft-block.is-source-peek",
    );
    if (!expanded) return;
    setSourcePeekExpanded(expanded, false);
    event.preventDefault();
  });
  return root;
}

export function revealFullTranslationSourceBlock(
  root: HTMLElement,
  blockId: string,
  quote?: string,
): boolean {
  const view = (
    root.matches(".zai-full-translation")
      ? root
      : root.querySelector(".zai-full-translation")
  ) as HTMLElement | null;
  if (!view) return false;
  const rows = Array.from(
    view.querySelectorAll(".zai-ft-block[data-block-id]"),
  ) as HTMLElement[];
  const target = rows.find((row) => row.dataset.blockId === blockId);
  if (!target) return false;

  removeSourceQuoteHighlights(view);
  if (quote) {
    view.dataset.sourceQuoteBlockId = blockId;
    view.dataset.sourceQuote = quote;
    highlightSourceQuote(target, quote);
  } else {
    delete view.dataset.sourceQuoteBlockId;
    delete view.dataset.sourceQuote;
  }

  if (
    view.classList.contains("is-translation-only") &&
    target.querySelector(".zai-ft-source")
  ) {
    const expanded = Array.from(
      view.querySelectorAll(".zai-ft-block.is-source-peek"),
    ) as HTMLElement[];
    expanded.forEach((row) => setSourcePeekExpanded(row, false));
    setSourcePeekExpanded(target, true);
  }

  const highlighted = Array.from(
    view.querySelectorAll(".zai-ft-block.is-source-target"),
  ) as HTMLElement[];
  highlighted.forEach((row) => row.classList.remove("is-source-target"));
  target.classList.add("is-source-target");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  root.ownerDocument?.defaultView?.setTimeout(
    () => target.classList.remove("is-source-target"),
    1_800,
  );
  return true;
}

interface SearchTextPoint {
  node: Text;
  start: number;
  end: number;
}

function highlightSourceQuote(row: HTMLElement, quote: string): boolean {
  const body = row.querySelector<HTMLElement>(
    ".zai-ft-source .zai-ft-block-body",
  );
  if (!body) return false;
  const searchable = sourceSearchText(body);
  const candidates = [quote, ...splitSentences(quote).map((item) => item.text)]
    .map(normalizeVisibleSearchText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const match = candidates
    .map((candidate) => ({
      candidate,
      index: searchable.text.indexOf(candidate),
    }))
    .find((candidate) => candidate.index >= 0);
  if (!match) return false;
  const matchEnd = match.index + match.candidate.length;
  const sourceSentences = splitSentences(searchable.text);
  const sourceIndexes = sourceSentences
    .map((sentence, index) => ({ sentence, index }))
    .filter(
      ({ sentence }) => sentence.end > match.index && sentence.start < matchEnd,
    )
    .map(({ index }) => index);
  const translationBody = row.querySelector<HTMLElement>(
    ".zai-ft-translation .zai-ft-block-body",
  );
  const translationSearch = translationBody
    ? sourceSearchText(translationBody)
    : null;
  const translationSentences = translationSearch
    ? splitSentences(translationSearch.text)
    : [];

  const sourceHighlighted = insertSearchHighlight(
    body,
    searchable,
    match.index,
    matchEnd,
    "zai-ft-source-quote-highlight",
  );
  if (
    translationBody &&
    translationSearch &&
    sourceIndexes.length &&
    sourceSentences.length &&
    translationSentences.length
  ) {
    const firstSource = sourceIndexes[0]!;
    const lastSource = sourceIndexes[sourceIndexes.length - 1]!;
    const firstTranslation = Math.floor(
      (firstSource * translationSentences.length) / sourceSentences.length,
    );
    const translationEnd = Math.min(
      translationSentences.length,
      Math.max(
        firstTranslation + 1,
        Math.ceil(
          ((lastSource + 1) * translationSentences.length) /
            sourceSentences.length,
        ),
      ),
    );
    const firstSentence = translationSentences[firstTranslation];
    const lastSentence = translationSentences[translationEnd - 1];
    if (firstSentence && lastSentence) {
      insertSearchHighlight(
        translationBody,
        translationSearch,
        firstSentence.start,
        lastSentence.end,
        "zai-ft-translation-quote-highlight",
      );
    }
  }
  return sourceHighlighted;
}

function insertSearchHighlight(
  body: HTMLElement,
  searchable: ReturnType<typeof sourceSearchText>,
  startOffset: number,
  endOffset: number,
  className: string,
): boolean {
  const start = searchable.points[startOffset];
  const end = searchable.points[endOffset - 1];
  if (!start || !end) return false;
  const range = body.ownerDocument!.createRange();
  range.setStart(start.node, start.start);
  range.setEnd(end.node, end.end);
  const mark = body.ownerDocument!.createElement("mark");
  mark.className = className;
  mark.append(range.extractContents());
  range.insertNode(mark);
  return true;
}

function sourceSearchText(root: HTMLElement): {
  text: string;
  points: SearchTextPoint[];
} {
  const chars: string[] = [];
  const points: SearchTextPoint[] = [];
  const appendText = (node: Text) => {
    for (let offset = 0; offset < node.data.length; offset++) {
      const normalized = normalizeVisibleSearchChar(node.data[offset]!);
      for (const char of normalized) {
        if (
          char === " " &&
          (!chars.length || chars[chars.length - 1] === " ")
        ) {
          continue;
        }
        chars.push(char);
        points.push({ node, start: offset, end: offset + 1 });
      }
    }
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      appendText(node as Text);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (
      element.matches(".zai-ft-sentence-boundary, .katex-mathml, script, style")
    ) {
      return;
    }
    for (const child of Array.from(element.childNodes)) {
      if (child) walk(child);
    }
  };
  for (const child of Array.from(root.childNodes)) {
    if (child) walk(child);
  }
  return { text: chars.join(""), points };
}

function normalizeVisibleSearchText(value: string): string {
  return Array.from(value)
    .map(normalizeVisibleSearchChar)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVisibleSearchChar(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s/g, " ")
    .toLocaleLowerCase();
}

function removeSourceQuoteHighlights(root: HTMLElement): void {
  const marks = Array.from(
    root.querySelectorAll(
      ".zai-ft-source-quote-highlight, .zai-ft-translation-quote-highlight",
    ),
  ) as HTMLElement[];
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  }
}

function renderToolbar(
  doc: Document,
  options: FullTranslationViewOptions,
): HTMLElement {
  const toolbar = doc.createElement("div");
  toolbar.className = "zai-ft-toolbar";

  const progress = translationProgress(options.document, options.state);
  const summary = doc.createElement("div");
  summary.className = "zai-ft-progress";
  summary.textContent = `${progress.done}/${progress.total} 已翻译`;
  if (options.modelSettings) {
    summary.append(renderModelSettings(doc, options));
  } else {
    const model = doc.createElement("span");
    model.className = "zai-ft-model";
    model.textContent = options.state.model;
    model.title = `翻译模型：${options.state.model}`;
    summary.append(model);
  }
  summary.append(renderUsageHistory(doc, options.document, options.state));

  const viewControls = renderViewControls(doc, options);

  const action = doc.createElement("button");
  action.className = "zai-ft-run";
  action.type = "button";
  if (options.running) {
    action.textContent = "停止";
    action.addEventListener("click", options.onCancel);
  } else if (options.preparing) {
    action.textContent = "准备重译…";
    action.disabled = true;
  } else if (translationComplete(progress)) {
    action.textContent = "重新翻译";
    action.addEventListener("click", () => {
      const warning =
        "确认重新翻译全文？\n\n" +
        "这会清除现有译文和当前 Token 统计，并重新产生 API 调用费用。";
      if (doc.defaultView?.confirm(warning)) options.onRetranslate();
    });
  } else {
    action.textContent = runLabel(progress);
    action.disabled = progress.pending === 0 && progress.errors === 0;
    action.addEventListener("click", options.onRun);
  }

  const exit = doc.createElement("button");
  exit.className = "zai-ft-exit";
  exit.type = "button";
  exit.textContent = "返回 PDF";
  exit.addEventListener("click", options.onExit);

  toolbar.append(summary, viewControls, action, exit);
  return toolbar;
}

function renderModelSettings(
  doc: Document,
  options: FullTranslationViewOptions,
): HTMLElement {
  const settings = options.modelSettings!;
  const root = doc.createElement("div");
  root.className = "zai-ft-model-settings";

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "zai-ft-model-settings-toggle";
  toggle.textContent = settings.model;
  toggle.title = `${settings.presetLabel} · ${fullTranslationThinkingLabel(settings)}`;
  toggle.setAttribute("aria-label", `配置全文翻译模型：${settings.model}`);
  toggle.setAttribute("aria-expanded", String(settings.open));
  toggle.disabled = options.running || !!options.preparing;
  toggle.addEventListener("click", () => options.onToggleModelSettings?.());

  const panel = doc.createElement("div");
  panel.className = "zai-ft-model-settings-panel";
  if (!settings.open) panel.setAttribute("hidden", "hidden");
  const busy = options.running || !!options.preparing;
  panel.append(
    fullTranslationModelSelect(doc, {
      label: "账号",
      className: "zai-ft-model-preset-select",
      value: settings.presetId,
      options: settings.presets.map((preset) => [preset.id, preset.label]),
      disabled: busy,
      onChange: (value) => options.onModelPresetChange?.(value),
    }),
    fullTranslationModelSelect(doc, {
      label: "模型",
      className: "zai-ft-model-select",
      value: settings.model,
      options: settings.models.map((value) => [value, value]),
      disabled: busy,
      onChange: (value) => options.onModelChange?.(value),
    }),
    fullTranslationModelSelect(doc, {
      label: "思考强度",
      className: "zai-ft-model-thinking-select",
      value: settings.thinking,
      options: settings.thinkingOptions,
      disabled: busy,
      onChange: (value) =>
        options.onModelThinkingChange?.(value as TranslateThinking),
    }),
  );
  const help = doc.createElement("p");
  help.className = "zai-ft-model-settings-help";
  help.textContent = settings.inherited
    ? "当前从设置页的默认翻译模型继承；修改后全文翻译会全局记住自己的选择。"
    : "全文翻译正在使用自己的全局选择，不会改动沉浸阅读默认模型。";
  panel.append(help);
  root.append(toggle, panel);
  return root;
}

interface FullTranslationSelectOptions {
  label: string;
  className: string;
  value: string;
  options: Array<[string, string]>;
  disabled: boolean;
  onChange(value: string): void;
}

function fullTranslationModelSelect(
  doc: Document,
  options: FullTranslationSelectOptions,
): HTMLElement {
  const label = doc.createElement("label");
  label.className = "zai-ft-model-setting";
  const text = doc.createElement("span");
  text.textContent = options.label;
  const select = doc.createElement("select");
  select.className = options.className;
  select.disabled = options.disabled || options.options.length === 0;
  for (const [value, title] of options.options) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = title;
    select.append(option);
  }
  select.value = options.value;
  select.addEventListener("change", () => options.onChange(select.value));
  label.append(text, select);
  return label;
}

function fullTranslationThinkingLabel(
  settings: FullTranslationModelSettings,
): string {
  return (
    settings.thinkingOptions.find(
      ([value]) => value === settings.thinking,
    )?.[1] ?? settings.thinking
  );
}

function renderUsageHistory(
  doc: Document,
  document: FullTranslationDocument,
  state: FullTranslationState,
): HTMLDetailsElement {
  const details = doc.createElement("details");
  details.className = "zai-ft-usage-history zai-ft-toolbar-popover";

  const usageSummary = tokenUsageSummary(state.usage);
  const summary = doc.createElement("summary");
  summary.className = "zai-ft-token-usage";
  summary.textContent = usageSummary.label;
  summary.title = usageSummary.title;
  details.append(summary);

  const panel = doc.createElement("div");
  panel.className = "zai-ft-usage-panel";
  const title = doc.createElement("div");
  title.className = "zai-ft-usage-panel-title";
  title.textContent = "逐次翻译统计";
  panel.append(title, renderUsageTotal(doc, state.usage));

  const events = [...(state.usageEvents ?? [])]
    .map((event, index) => ({ event, index }))
    .sort(
      (left, right) =>
        eventTime(right.event) - eventTime(left.event) ||
        right.index - left.index,
    );
  for (const { event, index } of events) {
    panel.append(renderUsageEvent(doc, document, details, event, index + 1));
  }

  const legacyMessage = usageHistoryGapMessage(state, events.length);
  if (legacyMessage) {
    const legacy = doc.createElement("div");
    legacy.className = "zai-ft-usage-legacy";
    legacy.textContent = legacyMessage;
    panel.append(legacy);
  } else if (!events.length) {
    const empty = doc.createElement("div");
    empty.className = "zai-ft-usage-empty";
    empty.textContent = "尚无逐段翻译记录";
    panel.append(empty);
  }

  details.append(panel);
  return details;
}

function renderUsageTotal(
  doc: Document,
  usage: FullTranslationUsage | undefined,
): HTMLElement {
  const total = doc.createElement("div");
  total.className = "zai-ft-usage-total";
  if (!usage) {
    total.textContent = "Input 0 · Output 0 · Hit 未返回";
    return total;
  }
  const metrics = tokenUsageMetrics(usage);
  total.textContent = [
    `Input ${formatTokenCount(metrics.rawInput)}`,
    `Output ${formatTokenCount(metrics.output)}`,
    `Hit ${metrics.cacheHit == null ? "未返回" : formatTokenCount(metrics.cacheHit)}`,
  ].join(" · ");
  return total;
}

function renderUsageEvent(
  doc: Document,
  document: FullTranslationDocument,
  history: HTMLDetailsElement,
  event: FullTranslationUsageEvent,
  attemptNumber: number,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "zai-ft-usage-event";
  button.dataset.targetBlockId = event.blockId;

  const top = doc.createElement("span");
  top.className = "zai-ft-usage-event-top";
  const attempt = doc.createElement("strong");
  attempt.textContent = `第 ${attemptNumber} 次`;
  const time = doc.createElement("time");
  time.dateTime = event.recordedAt;
  time.textContent = formatUsageEventTime(event.recordedAt);
  top.append(attempt, time);

  const location = usageEventLocation(document, event.blockId);
  const context = doc.createElement("span");
  context.className = "zai-ft-usage-context";
  context.textContent = location.context;
  const excerpt = doc.createElement("span");
  excerpt.className = "zai-ft-usage-excerpt";
  excerpt.textContent = location.excerpt;

  const metrics = tokenUsageMetrics(event.usage);
  const stats = doc.createElement("span");
  stats.className = "zai-ft-usage-stats";
  stats.append(
    usageStat(doc, "Input", formatTokenCount(metrics.rawInput)),
    usageStat(doc, "Output", formatTokenCount(metrics.output)),
    usageStat(
      doc,
      "Hit",
      metrics.cacheHit == null ? "未返回" : formatTokenCount(metrics.cacheHit),
    ),
  );
  button.append(top, context, excerpt, stats);
  button.addEventListener("click", () => {
    const root = history.closest(".zai-full-translation");
    const target = Array.from(
      root?.querySelectorAll("[data-block-id]") ?? [],
    ).find((row) => (row as HTMLElement).dataset.blockId === event.blockId) as
      | HTMLElement
      | undefined;
    if (!target) return;
    root
      ?.querySelectorAll(".zai-ft-block.is-usage-target")
      .forEach((row: Element) => row.classList.remove("is-usage-target"));
    target.classList.add("is-usage-target");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.open = false;
    doc.defaultView?.setTimeout(
      () => target.classList.remove("is-usage-target"),
      1_800,
    );
  });
  return button;
}

function usageStat(doc: Document, label: string, value: string): HTMLElement {
  const stat = doc.createElement("span");
  stat.textContent = `${label} ${value}`;
  return stat;
}

function usageEventLocation(
  document: FullTranslationDocument,
  blockId: string,
): { context: string; excerpt: string } {
  const blockIndex = document.blocks.findIndex((block) => block.id === blockId);
  if (blockIndex < 0) {
    return { context: "原段落已不存在", excerpt: blockId };
  }
  const block = document.blocks[blockIndex];
  let heading: FullTranslationBlock | undefined;
  for (let index = blockIndex; index >= 0; index -= 1) {
    if (document.blocks[index]?.kind === "heading") {
      heading = document.blocks[index];
      break;
    }
  }
  const headingNumber = heading?.number == null ? "" : String(heading.number);
  const headingTitle = heading ? usageExcerpt(heading.source, 54) : "文章开头";
  return {
    context: [headingNumber, headingTitle].filter(Boolean).join(" "),
    excerpt: usageExcerpt(block.source, 82),
  };
}

function usageExcerpt(source: string, maxLength: number): string {
  const text = source
    .replace(/\$\$?([\s\S]*?)\$\$?/g, "$1")
    .replace(/\\([A-Za-z]+)\*?(?:\{([^{}]*)\})?/g, (_match, command, value) =>
      value == null ? command : value,
    )
    .replace(/[`*_~#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatUsageEventTime(recordedAt: string): string {
  const date = new Date(recordedAt);
  if (!Number.isFinite(date.getTime())) return recordedAt;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function eventTime(event: FullTranslationUsageEvent): number {
  const value = Date.parse(event.recordedAt);
  return Number.isFinite(value) ? value : 0;
}

function usageHistoryGapMessage(
  state: FullTranslationState,
  eventCount: number,
): string | null {
  if (!state.usage) return null;
  if (!eventCount) return "旧记录只有全文累计；后续翻译会记录到段落";
  const accountedTokens = tokenUsageMetrics(state.usage).accountedTokens;
  const eventAccountedTokens = (state.usageEvents ?? []).reduce(
    (sum, event) => sum + tokenUsageMetrics(event.usage).accountedTokens,
    0,
  );
  return eventAccountedTokens < accountedTokens
    ? "旧数据中的部分 Token 没有逐段明细"
    : null;
}

function renderOutline(
  doc: Document,
  options: FullTranslationViewOptions,
  content: HTMLElement,
): HTMLElement {
  const outline = doc.createElement("nav");
  outline.className = "zai-ft-outline";
  const title = doc.createElement("div");
  title.className = "zai-ft-outline-title";
  title.textContent = "文章目录";
  outline.append(title);

  for (const block of options.document.blocks) {
    if (block.kind !== "heading") continue;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `zai-ft-outline-item level-${block.level ?? 1}`;
    button.dataset.targetBlockId = block.id;
    const number = block.number == null ? "" : `${block.number} `;
    const label = doc.createElement("span");
    renderMarkdownInto(label, `${number}${outlineBlockText(block, options)}`);
    button.append(label);
    button.addEventListener("click", () => {
      outline
        .querySelectorAll(".zai-ft-outline-item.is-active")
        .forEach((item: Element) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      const rows = Array.from(
        content.querySelectorAll("[data-block-id]"),
      ) as HTMLElement[];
      const target = rows.find((row) => row.dataset.blockId === block.id);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    outline.append(button);
  }
  return outline;
}

function outlineBlockText(
  block: FullTranslationBlock,
  options: FullTranslationViewOptions,
): string {
  if (readingSettings(options).languageMode !== "translation") {
    return block.source;
  }
  const blockState = options.state.blocks[block.id];
  return effectiveBlockStatus(blockState) === "done" && blockState?.translation
    ? blockState.translation
    : block.source;
}

function renderViewControls(
  doc: Document,
  options: FullTranslationViewOptions,
): HTMLElement {
  const controls = doc.createElement("div");
  controls.className = "zai-ft-view-controls";

  const languages = doc.createElement("div");
  languages.className = "zai-ft-language-modes";
  languages.append(
    languageButton(doc, "中英", "bilingual", options),
    languageButton(doc, "中文", "translation", options),
    languageButton(doc, "英文", "source", options),
  );

  const layouts = doc.createElement("div");
  layouts.className = "zai-ft-layouts";
  layouts.append(
    layoutButton(doc, "左右", "parallel", options),
    layoutButton(doc, "逐段", "interleaved", options),
  );
  controls.append(languages, layouts);
  if (options.onReadingSettingsChange) {
    controls.append(renderReadingSettingsControl(doc, options));
  }
  return controls;
}

function renderReadingSettingsControl(
  doc: Document,
  options: FullTranslationViewOptions,
): HTMLDetailsElement {
  const current = readingSettings(options);
  const details = doc.createElement("details");
  details.className = "zai-ft-reading-settings zai-ft-toolbar-popover";
  const summary = doc.createElement("summary");
  summary.textContent = "阅读设置";

  const panel = doc.createElement("div");
  panel.className = "zai-ft-reading-settings-panel";
  const form = doc.createElement("form");

  const markerStyle = settingsSelect(
    doc,
    "markerStyle",
    [
      ["slashes", "斜线 //"],
      ["circled", "圆圈序号 ①②③"],
      ["decimal", "数字序号 [1][2][3]"],
      ["dot", "圆点 •"],
      ["custom", "自定义"],
      ["off", "关闭标记"],
    ],
    current.markerStyle,
  );
  form.append(settingsField(doc, "句末标记", markerStyle));

  const customMarker = doc.createElement("input");
  customMarker.type = "text";
  customMarker.name = "customMarker";
  customMarker.maxLength = 8;
  customMarker.value = current.customMarker;
  customMarker.placeholder = "例如 //";
  const customField = settingsField(doc, "自定义符号", customMarker);
  customField.hidden = current.markerStyle !== "custom";
  form.append(customField);

  const colorMode = settingsSelect(
    doc,
    "markerColorMode",
    [
      ["palette", "柔和多彩"],
      ["single", "自选单色"],
    ],
    current.markerColorMode,
  );
  form.append(settingsField(doc, "符号颜色", colorMode));

  const markerColor = doc.createElement("input");
  markerColor.type = "color";
  markerColor.name = "markerColor";
  markerColor.value = current.markerColor;
  const colorField = settingsField(doc, "单色", markerColor);
  colorField.hidden = current.markerColorMode !== "single";
  form.append(colorField);

  const lineBreakMode = settingsSelect(
    doc,
    "lineBreakMode",
    [
      ["continuous", "连续排版"],
      ["sentence", "按句换行"],
      ["sentence-semicolon", "句子与分号换行"],
    ],
    current.lineBreakMode,
  );
  form.append(settingsField(doc, "换行方式", lineBreakMode));

  markerStyle.addEventListener("change", () => {
    customField.hidden = markerStyle.value !== "custom";
  });
  colorMode.addEventListener("change", () => {
    colorField.hidden = colorMode.value !== "single";
  });

  const apply = doc.createElement("button");
  apply.type = "submit";
  apply.className = "zai-ft-reading-settings-apply";
  apply.textContent = "应用";
  form.append(apply);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    details.open = false;
    options.onReadingSettingsChange?.(
      normalizeFullTranslationReadingSettings({
        ...current,
        markerStyle: markerStyle.value,
        customMarker: customMarker.value,
        markerColorMode: colorMode.value,
        markerColor: markerColor.value,
        lineBreakMode: lineBreakMode.value,
      }),
    );
  });
  panel.append(form);
  details.append(summary, panel);
  return details;
}

function settingsSelect(
  doc: Document,
  name: string,
  choices: Array<[value: string, label: string]>,
  value: string,
): HTMLSelectElement {
  const select = doc.createElement("select");
  select.name = name;
  for (const [optionValue, label] of choices) {
    const option = doc.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.append(option);
  }
  select.value = value;
  return select;
}

function settingsField(
  doc: Document,
  label: string,
  control: HTMLElement,
): HTMLLabelElement {
  const field = doc.createElement("label");
  field.className = "zai-ft-reading-setting";
  const text = doc.createElement("span");
  text.textContent = label;
  field.append(text, control);
  return field;
}

function languageButton(
  doc: Document,
  label: string,
  mode: FullTranslationLanguageMode,
  options: FullTranslationViewOptions,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.dataset.languageMode = mode;
  button.textContent = label;
  const settings = readingSettings(options);
  if (settings.languageMode === mode) {
    button.classList.add("on");
    button.disabled = true;
  }
  if (!options.onReadingSettingsChange) button.disabled = true;
  button.addEventListener("click", () => {
    options.onReadingSettingsChange?.({ ...settings, languageMode: mode });
  });
  return button;
}

function layoutButton(
  doc: Document,
  label: string,
  layout: FullTranslationLayout,
  options: FullTranslationViewOptions,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.dataset.layout = layout;
  button.textContent = label;
  if (options.layout === layout) {
    button.classList.add("on");
  }
  button.disabled =
    readingSettings(options).languageMode !== "bilingual" ||
    options.layout === layout;
  button.addEventListener("click", () => options.onLayoutChange(layout));
  return button;
}

function readingSettings(
  options: FullTranslationViewOptions,
): FullTranslationReadingSettings {
  return options.readingSettings ?? DEFAULT_FULL_TRANSLATION_READING_SETTINGS;
}

function renderBlockPair(
  doc: Document,
  block: FullTranslationBlock,
  options: FullTranslationViewOptions,
): HTMLElement {
  const row = doc.createElement("article");
  row.className = `zai-ft-block zai-ft-${block.kind}`;
  row.dataset.blockId = block.id;
  const reading = readingSettings(options);
  const blockState = options.state.blocks[block.id];
  const blockStatus = effectiveBlockStatus(blockState);
  if (blockStatus) row.dataset.status = blockStatus;
  const isSharedFormula = block.kind === "formula";
  const hasSharedVisual = !!(
    isSharedFormula ||
    block.assets?.length ||
    block.table
  );
  if (hasSharedVisual) {
    row.classList.add("has-shared-visual");
    row.append(renderSharedVisual(doc, block, options.assets));
  }

  if (!isSharedFormula) {
    const isPairedInterleavedHeading =
      block.kind === "heading" &&
      options.layout === "interleaved" &&
      reading.languageMode === "bilingual";
    const source = renderBlockSide(
      doc,
      block,
      block.source,
      "source",
      !hasSharedVisual,
      undefined,
      reading,
    );
    const translation = renderBlockSide(
      doc,
      block,
      translatedBlockText(block, options.state, blockStatus),
      "translation",
      !hasSharedVisual && !isPairedInterleavedHeading,
      blockStatus,
      reading,
    );
    if (reading.languageMode === "translation" && block.source.trim()) {
      const label = doc.createElement("span");
      label.className = "zai-ft-source-peek-label";
      label.textContent = "原文";
      source.prepend(label);
      translation.classList.add("zai-ft-source-peek-trigger");
      translation.title = "点击左侧查看本段原文；右键重新翻译";
      translation.setAttribute("aria-expanded", "false");
      translation.prepend(renderSourceGutterToggle(doc, row));
    }
    row.append(source, translation);
    if (
      reading.languageMode === "translation" &&
      options.expandedSourceBlockId === block.id
    ) {
      setSourcePeekExpanded(row, true);
    }
    if (options.highlightedSourceQuote?.blockId === block.id) {
      highlightSourceQuote(row, options.highlightedSourceQuote.quote);
    }
  }
  return row;
}

function renderSourceGutterToggle(
  doc: Document,
  row: HTMLElement,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "zai-ft-source-gutter-toggle";
  button.title = "显示本段原文";
  button.setAttribute("aria-label", "显示本段原文");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSourcePeek(row);
  });
  return button;
}

function toggleSourcePeek(row: HTMLElement): void {
  const expanded = row.classList.contains("is-source-peek");
  if (!expanded) {
    row
      .closest(".zai-full-translation")
      ?.querySelectorAll<HTMLElement>(".zai-ft-block.is-source-peek")
      .forEach((other: HTMLElement) => setSourcePeekExpanded(other, false));
  }
  setSourcePeekExpanded(row, !expanded);
}

function setSourcePeekExpanded(row: HTMLElement, expanded: boolean): void {
  row.classList.toggle("is-source-peek", expanded);
  const trigger = row.querySelector<HTMLElement>(".zai-ft-source-peek-trigger");
  if (trigger) {
    trigger.title = expanded
      ? "点击左侧隐藏本段原文；右键重新翻译"
      : "点击左侧查看本段原文；右键重新翻译";
    trigger.setAttribute("aria-expanded", String(expanded));
  }
  const gutter = row.querySelector<HTMLButtonElement>(
    ".zai-ft-source-gutter-toggle",
  );
  if (gutter) {
    gutter.title = expanded ? "隐藏本段原文" : "显示本段原文";
    gutter.setAttribute(
      "aria-label",
      expanded ? "隐藏本段原文" : "显示本段原文",
    );
    gutter.setAttribute("aria-expanded", String(expanded));
  }
}

function renderBlockContextMenu(
  doc: Document,
  root: HTMLElement,
  content: HTMLElement,
  options: FullTranslationViewOptions,
): HTMLElement {
  const menu = doc.createElement("div");
  menu.className = "zai-ft-block-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "段落操作");
  menu.hidden = true;

  content.addEventListener("contextmenu", (event) => {
    const mouseEvent = event as MouseEvent;
    const target = event.target as Element | null;
    const translation = target?.closest(
      ".zai-ft-translation",
    ) as HTMLElement | null;
    const row = translation?.closest(".zai-ft-block") as HTMLElement | null;
    if (!translation || !row || !content.contains(row)) return;

    const block = options.document.blocks.find(
      (candidate) => candidate.id === row.dataset.blockId,
    );
    if (!block) return;
    const canTranslate = block.translatable && !!options.onTranslateBlock;
    if (!canTranslate) return;

    event.preventDefault();
    event.stopPropagation();
    menu.replaceChildren();

    const status = effectiveBlockStatus(options.state.blocks[block.id]);
    const busy = options.running && status === "translating";
    const translateAction = renderBlockMenuAction(
      doc,
      "zai-ft-block-menu-translate",
      busy ? "正在翻译…" : status === "done" ? "重新翻译" : "翻译此段",
    );
    translateAction.disabled = options.running || !!options.preparing;
    translateAction.addEventListener("click", () => {
      closeBlockContextMenu(menu);
      options.onTranslateBlock?.(block.id);
    });
    menu.append(translateAction);

    openBlockContextMenu(doc, menu, mouseEvent.clientX, mouseEvent.clientY);
  });
  content.addEventListener("scroll", () => closeBlockContextMenu(menu));
  root.addEventListener("contextmenu", () => closeBlockContextMenu(menu));
  return menu;
}

function renderBlockMenuAction(
  doc: Document,
  className: string,
  label: string,
): HTMLButtonElement {
  const action = doc.createElement("button");
  action.type = "button";
  action.className = `zai-ft-block-menu-item ${className}`;
  action.setAttribute("role", "menuitem");
  action.textContent = label;
  return action;
}

function openBlockContextMenu(
  doc: Document,
  menu: HTMLElement,
  clientX: number,
  clientY: number,
): void {
  const margin = 8;
  menu.hidden = false;
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;

  const rect = menu.getBoundingClientRect();
  const viewportWidth = doc.defaultView?.innerWidth ?? 0;
  const viewportHeight = doc.defaultView?.innerHeight ?? 0;
  if (viewportWidth && rect.right > viewportWidth - margin) {
    menu.style.left = `${Math.max(margin, clientX - rect.width)}px`;
  }
  if (viewportHeight && rect.bottom > viewportHeight - margin) {
    menu.style.top = `${Math.max(margin, clientY - rect.height)}px`;
  }
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

function closeBlockContextMenu(menu: HTMLElement): boolean {
  if (menu.hidden) return false;
  menu.hidden = true;
  return true;
}

function renderBlockSide(
  doc: Document,
  block: FullTranslationBlock,
  text: string,
  side: "source" | "translation",
  showMarker: boolean,
  status?: string,
  readingSettings?: FullTranslationReadingSettings,
): HTMLElement {
  const cell = doc.createElement("div");
  cell.className = `zai-ft-cell zai-ft-${side}`;

  const label = showMarker ? blockLabel(block) : "";
  if (label) {
    const marker = doc.createElement("span");
    marker.className = "zai-ft-marker";
    marker.textContent = label;
    cell.append(marker);
  }

  const body = doc.createElement("div");
  body.className = "zai-ft-block-body";
  if (
    side === "translation" &&
    status &&
    status !== "done" &&
    status !== "skipped"
  ) {
    body.classList.add("zai-ft-state");
  }
  renderMarkdownInto(body, block.kind === "formula" ? `$$\n${text}\n$$` : text);
  if (
    readingSettings &&
    block.kind !== "heading" &&
    block.kind !== "title" &&
    (side === "source" || status === "done" || status === "skipped")
  ) {
    decorateSentenceBoundaries(body, readingSettings);
  }
  cell.append(body);
  return cell;
}

function renderSharedVisual(
  doc: Document,
  block: FullTranslationBlock,
  assets: FullTranslationAssetPreviews,
): HTMLElement {
  const visual = doc.createElement("div");
  visual.className = "zai-ft-shared-visual";
  const label = blockLabel(block);
  if (label) {
    const marker = doc.createElement("span");
    marker.className = "zai-ft-marker";
    marker.textContent = label;
    visual.append(marker);
  }
  if (block.assets?.length) {
    visual.append(renderFigureAssets(doc, block, assets));
  }
  if (block.table) visual.append(renderTable(doc, block.table.rows));
  if (block.kind === "formula") {
    const body = doc.createElement("div");
    body.className = "zai-ft-block-body zai-ft-shared-formula";
    renderMarkdownInto(body, `$$\n${block.source}\n$$`);
    visual.append(body);
  }
  return visual;
}

function renderFigureAssets(
  doc: Document,
  block: FullTranslationBlock,
  assets: FullTranslationAssetPreviews,
): HTMLElement {
  const frame = doc.createElement("div");
  frame.className = "zai-ft-assets";
  for (const path of block.assets ?? []) {
    const item = doc.createElement("div");
    item.className = "zai-ft-asset";
    item.dataset.assetPath = path;
    if (block.number != null) item.dataset.figureNumber = String(block.number);
    const preview = assets[path];
    renderAssetItem(doc, item, preview, block.number);
    frame.append(item);
  }
  return frame;
}

export function updateFullTranslationAssetPreview(
  root: HTMLElement,
  path: string,
  preview: FullTranslationAssetPreview,
): void {
  const items = (
    Array.from(
      root.querySelectorAll(".zai-ft-asset[data-asset-path]"),
    ) as HTMLElement[]
  ).filter((item) => item.dataset.assetPath === path);
  for (const item of items) {
    renderAssetItem(
      root.ownerDocument!,
      item,
      preview,
      item.dataset.figureNumber,
    );
  }
}

function renderAssetItem(
  doc: Document,
  item: HTMLElement,
  preview?: FullTranslationAssetPreview,
  figureNumber?: string | number,
): void {
  item.replaceChildren();
  if (preview?.previewUrl) {
    const image = doc.createElement("img");
    image.src = preview.previewUrl;
    image.alt = `Figure ${figureNumber ?? ""}`.trim();
    image.loading = "lazy";
    item.append(image);
    return;
  }
  const placeholder = doc.createElement("div");
  placeholder.className = `zai-ft-asset-placeholder${preview?.error ? " is-error" : ""}`;
  placeholder.textContent = preview?.error ?? "正在加载图片…";
  item.append(placeholder);
}

function renderTable(
  doc: Document,
  rows: FullTranslationTableCell[][],
): HTMLElement {
  const frame = doc.createElement("div");
  frame.className = "zai-ft-table-frame";
  const table = doc.createElement("table");
  rows.forEach((row, rowIndex) => {
    const tr = doc.createElement("tr");
    row.forEach((value) => {
      const cell = doc.createElement(rowIndex === 0 ? "th" : "td");
      const text = typeof value === "string" ? value : value.text;
      if (typeof value !== "string") {
        if (value.colSpan) cell.colSpan = value.colSpan;
        if (value.rowSpan) cell.rowSpan = value.rowSpan;
      }
      renderMarkdownInto(cell, text);
      tr.append(cell);
    });
    table.append(tr);
  });
  frame.append(table);
  return frame;
}

function translatedBlockText(
  block: FullTranslationBlock,
  state: FullTranslationState,
  status?: FullTranslationBlockStatus,
): string {
  const blockState = state.blocks[block.id];
  if (!block.translatable || status === "skipped") return block.source;
  if (status === "done") return blockState?.translation ?? "";
  if (status === "translating") return "正在翻译…";
  if (status === "error") {
    return `翻译失败：${blockState.error || "未知错误"}`;
  }
  return "等待翻译";
}

function effectiveBlockStatus(
  blockState?: FullTranslationBlockState,
): FullTranslationBlockStatus | undefined {
  if (
    blockState?.status === "done" &&
    isTranslationPlaceholderReply(blockState.translation ?? "")
  ) {
    return "pending";
  }
  return blockState?.status;
}

function blockLabel(block: FullTranslationBlock): string {
  if (block.kind === "heading" && block.number != null)
    return String(block.number);
  if (block.kind === "formula" && block.number != null)
    return `(${block.number})`;
  if (block.kind === "figure-caption" && block.number != null) {
    return `Figure ${block.number}`;
  }
  if (block.kind === "table-caption" && block.number != null) {
    return `Table ${block.number}`;
  }
  return "";
}

function translationProgress(
  document: FullTranslationDocument,
  state: FullTranslationState,
): { done: number; total: number; pending: number; errors: number } {
  const translatable = document.blocks.filter((block) => block.translatable);
  return {
    total: translatable.length,
    done: translatable.filter(
      (block) => effectiveBlockStatus(state.blocks[block.id]) === "done",
    ).length,
    pending: translatable.filter((block) => {
      const status = effectiveBlockStatus(state.blocks[block.id]);
      return status === "pending" || status === "translating";
    }).length,
    errors: translatable.filter(
      (block) => effectiveBlockStatus(state.blocks[block.id]) === "error",
    ).length,
  };
}

function runLabel(progress: {
  done: number;
  pending: number;
  errors: number;
}): string {
  if (progress.errors > 0) return `重试失败 (${progress.errors})`;
  if (progress.done > 0 && progress.pending > 0) return "继续翻译";
  if (progress.pending > 0) return "开始翻译";
  return "已完成";
}

function translationComplete(progress: {
  done: number;
  total: number;
  pending: number;
  errors: number;
}): boolean {
  return (
    progress.total > 0 &&
    progress.done === progress.total &&
    progress.pending === 0 &&
    progress.errors === 0
  );
}

function tokenUsageSummary(usage: FullTranslationState["usage"]): {
  label: string;
  title: string;
} {
  if (!usage) {
    return {
      label: "输入 0 · 输出 0 · 命中暂无",
      title: "全文翻译尚未产生 Token 统计。",
    };
  }
  const metrics = tokenUsageMetrics(usage);
  if (metrics.cacheHit == null) {
    return {
      label: `输入 ${formatCompactTokenCount(metrics.rawInput)} · 输出 ${formatCompactTokenCount(metrics.output)} · 命中未返回`,
      title: [
        "全文翻译累计 Token",
        `Input: ${formatTokenCount(metrics.rawInput)}`,
        `Output: ${formatTokenCount(metrics.output)}`,
        "Cache hit: 服务端未返回",
        `Input cache miss: ${formatTokenCount(metrics.cacheMiss)}`,
      ].join("\n"),
    };
  }

  return {
    label: `输入 ${formatCompactTokenCount(metrics.rawInput)} · 输出 ${formatCompactTokenCount(metrics.output)} · 命中 ${formatCompactTokenCount(metrics.cacheHit)}`,
    title: [
      "全文翻译累计 Token",
      `Input: ${formatTokenCount(metrics.rawInput)}`,
      `Output: ${formatTokenCount(metrics.output)}`,
      `Cache hit: ${formatTokenCount(metrics.cacheHit)}`,
      `Input cache miss: ${formatTokenCount(metrics.cacheMiss)}`,
      `Cache hit rate: ${metrics.cacheRate}%`,
      `统计口径: ${
        metrics.cacheIncluded
          ? "缓存命中包含在 Input 内"
          : "缓存命中独立于 Input"
      }`,
    ].join("\n"),
  };
}

function formatCompactTokenCount(value: number): string {
  if (value < 1_000) return formatTokenCount(value);
  const compact = (value / 1_000).toFixed(1).replace(/\.0$/, "");
  return `${compact}k`;
}

interface TokenUsageMetrics {
  rawInput: number;
  output: number;
  cacheHit?: number;
  cacheMiss: number;
  cacheRate?: number;
  cacheIncluded?: boolean;
  accountedTokens: number;
}

function tokenUsageMetrics(usage: FullTranslationUsage): TokenUsageMetrics {
  const rawInput = Math.max(0, usage.input || 0);
  const output = Math.max(0, usage.output || 0);
  if (usage.cacheRead == null) {
    return {
      rawInput,
      output,
      cacheMiss: rawInput,
      accountedTokens: rawInput + output,
    };
  }
  const cacheHit = Math.max(0, usage.cacheRead || 0);
  const cacheIncluded = usage.cacheReadIncludedInInput ?? cacheHit <= rawInput;
  const cacheMiss = cacheIncluded ? Math.max(0, rawInput - cacheHit) : rawInput;
  const inputTotal = cacheHit + cacheMiss;
  return {
    rawInput,
    output,
    cacheHit,
    cacheMiss,
    cacheRate: inputTotal > 0 ? Math.round((cacheHit / inputTotal) * 100) : 0,
    cacheIncluded,
    accountedTokens: inputTotal + output,
  };
}

function formatTokenCount(value: number): string {
  return value.toLocaleString("en-US");
}
