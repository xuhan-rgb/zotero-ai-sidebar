import type {
  TranslateOverlayPosition,
  TranslateOverlaySize,
} from "../settings/types";
import type { PdfPageContent, PdfRect } from "../context/pdf-locator";
import type { BreakdownSeg } from "./asker";
import { logTranslateDebug } from "./debug-log";

export interface OverlayHandle {
  el: HTMLElement;
  setText(text: string): void;
  // Render a saved Zotero annotation's comment as a distinct "📌 已有注释" note
  // card (not a plain译文), so the user can tell at a glance this is their stored
  // note rather than a fresh translation. Cleared on ↻ / view toggle.
  setExistingNote(comment: string): void;
  appendText(delta: string): void;
  // Reset the translation body (collapse follow-up turns, undo term spans, clear
  // 原文 decoration) so a re-translation can stream into the SAME card without a
  // full rebuild — keeps position, 拆解 panel, and the checkbox stable.
  resetForRetranslate(): void;
  // Re-run the 拆解 analysis if its panel is currently open (used by ↻ so one
  // redo covers both译文 and an open breakdown). No-op when closed / absent.
  redoBreakdownIfOpen(): void;
  setDone(): void;
  setError(message: string): void;
  setStatus(message: string): void;
  setStatusLabel(message: string): void;
  destroy(): void;
  // Multi-turn helpers (ask flow only). The translate flow never calls these,
  // so its single-body behavior stays byte-identical.
  appendUserTurn(text: string): void;
  beginAssistantTurn(): void;
  focusComposer(): void;
  // Scroll the highlighted sentence into view if it isn't fully on screen. Used
  // by immersive keyboard stepping so advancing past the fold keeps the source
  // sentence visible; a no-op when it's already visible.
  scrollSentenceIntoView(): void;
  // 拆解长句 panel (read card only). No-ops when the card has no breakdown chip.
  setBreakdownStatus(message: string): void;
  appendBreakdown(delta: string): void;
  setBreakdown(text: string): void;
  setBreakdownError(message: string): void;
  // Final structured 拆解 render: inline ruby gloss + green 主语 + grey 〔定语〕.
  // `tokenLabel` (may be empty) shows the 拆解 token cost at the bottom-right.
  setBreakdownStructured(
    segs: BreakdownSeg[],
    legend: string,
    tokenLabel: string,
  ): void;
  // Replace the body text mid-stream WITHOUT marking the turn done (used by the
  // term-pairs translation, which streams then re-renders with hover spans).
  setBodyStreaming(text: string): void;
  // 逐句对照 view: render 英文意群 / 中文 rows into the body. When `termPairs` is
  // given (重点词对应 on), key terms in each cell get per-pair colors + hover link.
  setInterleaved(pairs: TermPair[], termPairs?: TermPair[]): void;
  // Show/hide the 原文 row (hidden in 逐句对照, where 原文 is in the lines).
  setSourceVisible(visible: boolean): void;
  // 自适应宽度 toggle: re-size + re-position the card without re-translating.
  setAutoWidth(on: boolean): void;
  // 重点词对应: re-render the 原文 row and 译文 with linked hover spans, lighting
  // matched 原文↔译 terms together on hover.
  decorateTerms(source: string, translation: string, pairs: TermPair[]): void;
}

// One 原文↔译 word pair for 重点词对应 hover linking.
export interface TermPair {
  en: string;
  zh: string;
}

export interface OverlayActions {
  onPrev?: () => void;
  onNext?: () => void;
  onSave?: () => void;
  onRetry?: () => void;
  onClose: () => void;
  hint: string;
}

// Optional follow-up composer for the ask flow. When present, the overlay
// renders an input row whose Enter/Send submits the typed text. Absent for
// translate, which keeps no composer.
export interface OverlayComposer {
  placeholder?: string;
  onSubmit: (text: string) => void;
}

// Per-mode text shown in the overlay's meta row and status badge. Defaults
// keep the translate flow unchanged; the ask flow passes its own labels.
export interface OverlayMeta {
  lang: string;
  busyStatus: string;
  doneStatus: string;
  errorStatus: string;
  busyKeyword: string;
}

const TRANSLATE_OVERLAY_META: OverlayMeta = {
  lang: "EN → 简体中文",
  busyStatus: "● 翻译中…",
  doneStatus: "● 已完成",
  errorStatus: "● 翻译失败",
  busyKeyword: "翻译",
};

export interface MountOverlayInput {
  iframeDoc: Document;
  pageEl: HTMLElement;
  rects: PdfRect[];
  pageContent: PdfPageContent;
  position: TranslateOverlayPosition;
  size: TranslateOverlaySize;
  actions: OverlayActions;
  initialText?: string;
  meta?: OverlayMeta;
  // "ask" drops the translate-only action buttons (save/retry/prev/next),
  // keeping just close, and renders a follow-up composer when `composer` is
  // set. "translate" (default) is unchanged.
  variant?: "translate" | "ask";
  composer?: OverlayComposer;
  // 原文 row rendered locally above the body (read card, 0 token).
  sourceText?: string;
  // 拆解长句 chip: lazy. `onRequest(force)` runs the analysis; force=true ignores
  // the cache (used by ↻), force=false reuses it (a plain open won't re-request).
  breakdown?: { label: string; onRequest: (force: boolean) => void };
  // 结合上下句 toggle chip: a per-card on/off switch; `onToggle` gets the new state.
  contextToggle?: {
    label: string;
    checked: boolean;
    onToggle: (on: boolean) => void;
  };
  // 逐句对照 view toggle chip (block ⇄ interleaved 意群 lines).
  lineViewToggle?: {
    label: string;
    checked: boolean;
    onToggle: (on: boolean) => void;
  };
  // 自适应宽度: when true the card widens to the available space (fewer 1–2 word
  // orphan wraps). Default false.
  autoWidth?: boolean;
  autoWidthToggle?: {
    label: string;
    checked: boolean;
    onToggle: (on: boolean) => void;
  };
}

export function mountOverlay(input: MountOverlayInput): OverlayHandle {
  const {
    iframeDoc,
    pageEl,
    rects,
    pageContent,
    position,
    size,
    actions,
    initialText,
  } = input;
  const metaText = input.meta ?? TRANSLATE_OVERLAY_META;
  const isAsk = input.variant === "ask";

  ensureStyle(iframeDoc);
  removeStaleTranslateDom(iframeDoc);
  const popupGuard = mountSelectionPopupGuard(iframeDoc);
  const highlights = mountHighlights(iframeDoc, pageEl, rects, pageContent);

  const el = iframeDoc.createElement("div");
  el.className = "zai-translate-overlay";
  if (isAsk) el.classList.add("zai-translate-overlay--ask");
  // Read card (has a 拆解 chip): pin 原文 + 译 visible and let the breakdown be
  // the part that flexes/scrolls, so opening 拆解 never hides the translation.
  if (input.breakdown) el.classList.add("zai-translate-overlay--read");
  el.setAttribute("data-position", position);
  el.setAttribute("data-size", size);

  const meta = iframeDoc.createElement("div");
  meta.className = "zai-translate-overlay__meta";
  const lang = iframeDoc.createElement("span");
  lang.className = "zai-translate-overlay__lang";
  lang.textContent = metaText.lang;
  meta.appendChild(lang);

  // Option A: view/option toggles live in the top bar, between the lang label
  // and the status badge.
  if (input.lineViewToggle) {
    // Checkbox (not a filled chip) so it matches 结合上下句 / 自适应宽度 and adds no
    // heavy color block competing with the sentence for attention.
    meta.appendChild(
      makeMetaCheck(
        iframeDoc,
        input.lineViewToggle,
        "切换：整段对照 ⇄ 逐句对照（一行英文一行中文）",
      ),
    );
  }
  if (input.contextToggle) {
    meta.appendChild(makeMetaCheck(iframeDoc, input.contextToggle, "结合上下句翻译（仅本卡，不改默认设置）"));
  }
  if (input.autoWidthToggle) {
    meta.appendChild(makeMetaCheck(iframeDoc, input.autoWidthToggle, "自适应宽度：加宽卡片，减少一两个单词单独换行"));
  }

  const metaSp = iframeDoc.createElement("span");
  metaSp.className = "zai-translate-overlay__meta-sp";
  meta.appendChild(metaSp);
  const status = iframeDoc.createElement("span");
  status.className = "zai-translate-overlay__status";
  status.textContent = metaText.busyStatus;
  meta.appendChild(status);
  el.appendChild(meta);

  // 原文 + 译文 share ONE "translation block" container, so the card reads as a
  // clean vertical stack of blocks: this translation block on top, then each
  // follow-up question bubble + answer block below it (same visual language).
  const mainBlock = iframeDoc.createElement("div");
  mainBlock.className = "zai-translate-overlay__main";
  el.appendChild(mainBlock);

  // 原文 row (read card): the clicked sentence, rendered locally — costs no
  // tokens and gives a stable source/译 pairing inside the card.
  let sourceRow: HTMLElement | null = null;
  if (input.sourceText) {
    sourceRow = iframeDoc.createElement("div");
    sourceRow.className = "zai-translate-overlay__source";
    sourceRow.textContent = input.sourceText;
    mainBlock.appendChild(sourceRow);
  }

  // Primary streaming target: the translation (read card) or the first answer
  // (ask card). Sits under 原文 inside the same translation block. The follow-up
  // Q&A `transcript` is created separately below, after 拆解.
  const body = iframeDoc.createElement("div");
  body.className = "zai-translate-overlay__body";
  if (initialText) body.textContent = initialText;
  mainBlock.appendChild(body);

  // 拆解长句 chip + collapsible panel (read card). Currently 暂时取消 (not passed),
  // but the rendering is kept so it can be re-enabled later. The other toggles
  // (逐句对照 / 结合上下句 / 自适应宽度) now live in the meta bar above.
  let breakdownPanel: HTMLElement | null = null;
  let redoBreakdown: (() => void) | null = null;
  if (input.breakdown) {
    const bd = input.breakdown;
    const chipsRow = iframeDoc.createElement("div");
    chipsRow.className = "zai-translate-overlay__chips";
    const chip = iframeDoc.createElement("button");
    chip.type = "button";
    chip.className = "zai-translate-overlay__chip";
    chip.textContent = bd.label;
    const panel = iframeDoc.createElement("div");
    panel.className = "zai-translate-overlay__breakdown";
    chip.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const showing = panel.classList.toggle(
        "zai-translate-overlay__breakdown--show",
      );
      chip.classList.toggle("zai-translate-overlay__chip--on", showing);
      if (showing) bd.onRequest(false);
      schedulePosition();
    });
    redoBreakdown = () => {
      if (panel.classList.contains("zai-translate-overlay__breakdown--show")) {
        bd.onRequest(true);
      }
    };
    chipsRow.appendChild(chip);
    breakdownPanel = panel;
    el.insertBefore(chipsRow, mainBlock);
    el.appendChild(breakdownPanel);
  }

  // Follow-up Q&A transcript (ask variant) — placed BELOW 拆解 so the AI
  // conversation sits under the reading aids (原文 / 译文 / 拆解), above the
  // composer. Empty until the first follow-up.
  const transcript = isAsk ? iframeDoc.createElement("div") : null;
  if (transcript) {
    transcript.className = "zai-translate-overlay__transcript";
    el.appendChild(transcript);
  }

  // Ask multi-turn state. The first answer/translation streams into `body`.
  // When a follow-up turn starts we append a user turn + a fresh answer body to
  // the Q&A transcript and stream into that.
  let activeBody = body;

  const actionsRow = iframeDoc.createElement("div");
  actionsRow.className = "zai-translate-overlay__actions";
  if (!isAsk) {
    actionsRow.appendChild(
      makeBtn(iframeDoc, "💾", "保存为 Zotero 注释", actions.onSave),
    );
    actionsRow.appendChild(
      makeBtn(
        iframeDoc,
        "↻",
        "重新翻译（忽略缓存并覆盖旧结果）",
        actions.onRetry,
      ),
    );
    actionsRow.appendChild(makeBtn(iframeDoc, "▲", "上一句", actions.onPrev));
    actionsRow.appendChild(makeBtn(iframeDoc, "▼", "下一句", actions.onNext));
  } else {
    // Read card: 💾 save the译文 as a Zotero highlight注释, plus a single ↻ to
    // force a fresh translation (ignore cache). The plain ask card has neither.
    if (actions.onSave) {
      actionsRow.appendChild(
        makeBtn(iframeDoc, "💾", "保存为 Zotero 注释", actions.onSave),
      );
    }
    if (actions.onRetry) {
      actionsRow.appendChild(
        makeBtn(
          iframeDoc,
          "↻",
          "重新翻译（忽略缓存并覆盖旧结果）",
          actions.onRetry,
        ),
      );
    }
  }
  const hintEl = iframeDoc.createElement("span");
  hintEl.className = "zai-translate-overlay__hint";
  hintEl.textContent = actions.hint;
  actionsRow.appendChild(hintEl);
  actionsRow.appendChild(
    makeBtn(iframeDoc, "✕", "关闭 (Esc)", actions.onClose),
  );
  el.appendChild(actionsRow);

  // Follow-up composer (ask flow only). A single-line input that submits on
  // Enter or the send button. Stops propagation so the reader's own key/click
  // handlers (and the ask-mode Esc-to-close) don't fight the input.
  let composerInput: HTMLInputElement | null = null;
  if (input.composer) {
    const composer = input.composer;
    const composerRow = iframeDoc.createElement("div");
    composerRow.className = "zai-translate-overlay__composer";
    const field = iframeDoc.createElement("input");
    field.type = "text";
    field.className = "zai-translate-overlay__input";
    field.placeholder = composer.placeholder ?? "追问…";
    const sendBtn = iframeDoc.createElement("button");
    sendBtn.type = "button";
    sendBtn.className =
      "zai-translate-overlay__btn zai-translate-overlay__btn--primary";
    sendBtn.textContent = "↑";
    sendBtn.title = "发送 (Enter)";
    const submit = () => {
      const text = field.value.trim();
      if (!text) return;
      field.value = "";
      composer.onSubmit(text);
    };
    field.addEventListener("keydown", (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === "Enter" && !ev.isComposing) {
        ev.preventDefault();
        submit();
      } else if (ev.key === "Escape") {
        // The input swallows propagation, so the mode-level Esc handler never
        // sees it — close the card here so Esc works while typing a follow-up.
        ev.preventDefault();
        actions.onClose();
      }
    });
    sendBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      submit();
    });
    composerRow.append(field, sendBtn);
    el.appendChild(composerRow);
    composerInput = field;
  }

  // Reveal the chrome (meta/foot/composer) on REAL pointer activity inside the
  // card, not on bare CSS :hover. WHY: keyboard stepping remounts the card next
  // to the new sentence; if it pops up under a parked cursor, :hover would fire
  // immediately (no mouse move) and wrongly count as "the user is on the card".
  // pointermove (not pointerenter) means a stationary cursor the card appears
  // under does nothing; an actual move / click reveals it; leaving hides it.
  el.addEventListener("pointermove", () => {
    el.classList.add("zai-translate-overlay--pointer-active");
  });
  el.addEventListener("pointerdown", () => {
    el.classList.add("zai-translate-overlay--pointer-active");
  });
  el.addEventListener("pointerleave", () => {
    el.classList.remove("zai-translate-overlay--pointer-active");
  });

  el.style.visibility = "hidden";
  (iframeDoc.body ?? pageEl).appendChild(el);

  let destroyed = false;
  let positionFrame = 0;
  let autoWidth = !!input.autoWidth;
  const win = iframeDoc.defaultView;
  const positionNow = () => {
    if (destroyed) return;
    if (positionFrame && win) {
      win.cancelAnimationFrame(positionFrame);
      positionFrame = 0;
    }
    positionOverlay(el, pageEl, rects, pageContent, position, size, autoWidth);
  };
  const schedulePosition = () => {
    if (destroyed) return;
    if (!win) {
      positionNow();
      return;
    }
    if (positionFrame) return;
    positionFrame = win.requestAnimationFrame(() => {
      positionFrame = 0;
      positionOverlay(el, pageEl, rects, pageContent, position, size, autoWidth);
    });
  };
  positionNow();
  win?.addEventListener("scroll", schedulePosition, true);
  win?.addEventListener("resize", schedulePosition);

  const scrollBodyToEnd = () => {
    // Keep the latest turn visible as it streams (ask transcript can scroll).
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  };

  return {
    el,
    setText(text) {
      activeBody.classList.remove("zai-translate-overlay__body--status");
      activeBody.classList.remove("zai-translate-overlay__body--note");
      activeBody.textContent = text;
      status.textContent = metaText.doneStatus;
      schedulePosition();
    },
    setExistingNote(comment) {
      activeBody.classList.remove("zai-translate-overlay__body--status");
      activeBody.classList.add("zai-translate-overlay__body--note");
      activeBody.textContent = "";
      const head = iframeDoc.createElement("div");
      head.className = "zai-translate-overlay__note-head";
      head.textContent = "📌 已有注释（你之前存的）";
      const text = iframeDoc.createElement("div");
      text.className = "zai-translate-overlay__note-text";
      text.textContent = comment;
      activeBody.append(head, text);
      status.textContent = "● 已有注释";
      schedulePosition();
    },
    appendText(delta) {
      if (activeBody.classList.contains("zai-translate-overlay__body--status")) {
        activeBody.textContent = "";
        activeBody.classList.remove("zai-translate-overlay__body--status");
      }
      activeBody.textContent = (activeBody.textContent ?? "") + delta;
      schedulePosition();
      if (isAsk) scrollBodyToEnd();
    },
    setDone() {
      status.textContent = metaText.doneStatus;
      schedulePosition();
    },
    setError(message) {
      activeBody.classList.remove("zai-translate-overlay__body--status");
      activeBody.textContent = `⚠️ ${message}`;
      status.textContent = metaText.errorStatus;
      el.classList.add("zai-translate-overlay--error");
      schedulePosition();
    },
    setStatus(message) {
      activeBody.classList.add("zai-translate-overlay__body--status");
      activeBody.textContent = message;
      status.textContent = message.includes(metaText.busyKeyword)
        ? metaText.busyStatus
        : "● 等待中…";
      schedulePosition();
    },
    setStatusLabel(message) {
      status.textContent = message;
      schedulePosition();
    },
    appendUserTurn(text) {
      // Render the user's follow-up as a labeled transcript turn after the
      // previous answer. Clears any leftover error styling from a prior turn.
      if (!transcript) return;
      el.classList.remove("zai-translate-overlay--error");
      const turn = iframeDoc.createElement("div");
      turn.className =
        "zai-translate-overlay__turn zai-translate-overlay__turn--user";
      turn.textContent = text;
      transcript.appendChild(turn);
      schedulePosition();
      scrollBodyToEnd();
    },
    beginAssistantTurn() {
      // Freeze the current answer in the transcript and stream the next answer
      // into a fresh body element appended at the end.
      if (!transcript) return;
      const next = iframeDoc.createElement("div");
      next.className = "zai-translate-overlay__body";
      transcript.appendChild(next);
      activeBody = next;
      status.textContent = metaText.busyStatus;
      schedulePosition();
      scrollBodyToEnd();
    },
    focusComposer() {
      try {
        composerInput?.focus();
      } catch {
        /* best effort */
      }
    },
    scrollSentenceIntoView() {
      const target = highlights[0];
      if (!target || typeof target.scrollIntoView !== "function") return;
      const rect = target.getBoundingClientRect();
      const viewH = win?.innerHeight || 0;
      if (viewH && rect.top >= 0 && rect.bottom <= viewH) return; // visible
      try {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        try {
          target.scrollIntoView();
        } catch {
          /* best effort */
        }
      }
    },
    setBreakdownStatus(message) {
      if (!breakdownPanel) return;
      breakdownPanel.classList.add("zai-translate-overlay__breakdown--status");
      breakdownPanel.textContent = message;
      schedulePosition();
    },
    appendBreakdown(delta) {
      if (!breakdownPanel) return;
      if (
        breakdownPanel.classList.contains(
          "zai-translate-overlay__breakdown--status",
        )
      ) {
        breakdownPanel.textContent = "";
        breakdownPanel.classList.remove(
          "zai-translate-overlay__breakdown--status",
        );
      }
      breakdownPanel.textContent = (breakdownPanel.textContent ?? "") + delta;
      breakdownPanel.scrollTop = breakdownPanel.scrollHeight;
      schedulePosition();
    },
    setBreakdown(text) {
      if (!breakdownPanel) return;
      breakdownPanel.classList.remove(
        "zai-translate-overlay__breakdown--status",
      );
      breakdownPanel.textContent = text;
      schedulePosition();
    },
    setBreakdownError(message) {
      if (!breakdownPanel) return;
      breakdownPanel.classList.remove(
        "zai-translate-overlay__breakdown--status",
      );
      breakdownPanel.textContent = `⚠️ ${message}`;
      schedulePosition();
    },
    setBreakdownStructured(segs, legend, tokenLabel) {
      if (!breakdownPanel) return;
      breakdownPanel.classList.remove(
        "zai-translate-overlay__breakdown--status",
      );
      breakdownPanel.textContent = "";
      breakdownPanel.appendChild(
        renderBreakdownStruct(iframeDoc, segs, legend, tokenLabel),
      );
      schedulePosition();
    },
    setBodyStreaming(text) {
      activeBody.classList.remove("zai-translate-overlay__body--status");
      activeBody.textContent = text;
      if (isAsk) scrollBodyToEnd();
      schedulePosition();
    },
    setInterleaved(pairs, termPairs) {
      body.classList.remove("zai-translate-overlay__body--status");
      body.classList.add("zai-translate-overlay__body--interleaved");
      body.textContent = "";
      const terms = termPairs && termPairs.length ? termPairs : null;
      for (const pair of pairs) {
        const en = iframeDoc.createElement("div");
        en.className = "zai-il-en";
        const zh = iframeDoc.createElement("div");
        zh.className = "zai-il-zh";
        if (terms) {
          // Color the matching key terms within each cell (same pair → same hue).
          renderTermSpans(iframeDoc, en, pair.en, terms, "en");
          renderTermSpans(iframeDoc, zh, pair.zh, terms, "zh");
        } else {
          en.textContent = pair.en;
          zh.textContent = pair.zh;
        }
        body.append(en, zh);
      }
      if (terms) wireTermHover(body);
      status.textContent = metaText.doneStatus;
      schedulePosition();
    },
    setSourceVisible(visible) {
      if (sourceRow) sourceRow.style.display = visible ? "" : "none";
    },
    setAutoWidth(on) {
      autoWidth = on;
      positionNow();
    },
    resetForRetranslate() {
      el.classList.remove("zai-translate-overlay--error");
      if (transcript) transcript.textContent = ""; // clear the follow-up Q&A
      body.className = "zai-translate-overlay__body";
      activeBody = body;
      // Keep the OLD translation text visible as a placeholder — the first chunk
      // of the new translation replaces it in one step, so no blank flash.
      schedulePosition();
    },
    redoBreakdownIfOpen() {
      redoBreakdown?.();
    },
    decorateTerms(source, translation, pairs) {
      activeBody.classList.remove("zai-translate-overlay__body--status");
      renderTermSpans(iframeDoc, activeBody, translation, pairs, "zh");
      if (sourceRow) renderTermSpans(iframeDoc, sourceRow, source, pairs, "en");
      wireTermHover(el);
      status.textContent = metaText.doneStatus;
      schedulePosition();
    },
    destroy() {
      destroyed = true;
      if (positionFrame && win) win.cancelAnimationFrame(positionFrame);
      win?.removeEventListener("scroll", schedulePosition, true);
      win?.removeEventListener("resize", schedulePosition);
      el.remove();
      for (const highlight of highlights) highlight.remove();
      popupGuard.destroy();
    },
  };
}

function removeStaleTranslateDom(doc: Document): void {
  doc
    .querySelectorAll(
      ".zai-translate-overlay,.zai-translate-highlight,.zai-sentence-chooser",
    )
    .forEach((node: Element) => node.remove());
}

export interface SentenceChooserAction {
  label: string;
  title: string;
  primary?: boolean;
  onClick: () => void;
}

export interface SentenceChooserInput {
  iframeDoc: Document;
  pageEl: HTMLElement;
  rects: PdfRect[];
  pageContent: PdfPageContent;
  actions: SentenceChooserAction[];
}

export interface SentenceChooserHandle {
  el: HTMLElement;
  destroy(): void;
}

// Immersive reading "indication": highlight the clicked sentence and float a
// tiny action bar next to it. Reuses the overlay's highlight + PDF-rect anchor
// machinery but stays intentionally minimal (no streaming body, no resize fit)
// because it only offers a couple of one-shot actions.
export function mountSentenceChooser(
  input: SentenceChooserInput,
): SentenceChooserHandle {
  const { iframeDoc, pageEl, rects, pageContent, actions } = input;

  ensureStyle(iframeDoc);
  const popupGuard = mountSelectionPopupGuard(iframeDoc);
  const highlights = mountHighlights(iframeDoc, pageEl, rects, pageContent);

  const el = iframeDoc.createElement("div");
  el.className = "zai-sentence-chooser";
  for (const action of actions) {
    const btn = iframeDoc.createElement("button");
    btn.type = "button";
    btn.className = "zai-sentence-chooser__btn";
    if (action.primary) btn.classList.add("zai-sentence-chooser__btn--primary");
    btn.textContent = action.label;
    btn.title = action.title;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      action.onClick();
    });
    el.appendChild(btn);
  }

  el.style.visibility = "hidden";
  (iframeDoc.body ?? pageEl).appendChild(el);

  let destroyed = false;
  let positionFrame = 0;
  const win = iframeDoc.defaultView;
  const positionNow = () => {
    if (destroyed) return;
    positionChooser(el, pageEl, rects, pageContent);
  };
  const schedulePosition = () => {
    if (destroyed) return;
    if (!win) {
      positionNow();
      return;
    }
    if (positionFrame) return;
    positionFrame = win.requestAnimationFrame(() => {
      positionFrame = 0;
      positionChooser(el, pageEl, rects, pageContent);
    });
  };
  positionNow();
  win?.addEventListener("scroll", schedulePosition, true);
  win?.addEventListener("resize", schedulePosition);

  return {
    el,
    destroy() {
      destroyed = true;
      if (positionFrame && win) win.cancelAnimationFrame(positionFrame);
      win?.removeEventListener("scroll", schedulePosition, true);
      win?.removeEventListener("resize", schedulePosition);
      el.remove();
      for (const highlight of highlights) highlight.remove();
      popupGuard.destroy();
    },
  };
}

export interface ReadingHighlightInput {
  iframeDoc: Document;
  pageEl: HTMLElement;
  rects: PdfRect[];
  pageContent: PdfPageContent;
}

export interface ReadingHighlightHandle {
  // Live highlight rect elements, so the caller can hit-test the pointer
  // against their getBoundingClientRect() and skip re-detecting a sentence
  // while the cursor stays inside the one it's already marking.
  elements: HTMLElement[];
  destroy(): void;
}

// Immersive reading "current sentence" marker: a soft, low-key highlight that
// follows the reader's eye (hover) or the keyboard sentence jump. Distinct from
// the translate highlight (yellow) and the click-action highlight: it uses its
// own `.zai-reading-highlight` class and never touches the others. Reuses the
// same PDF-rect anchoring + scroll/resize repositioning machinery as the
// chooser, but stays permanent until cleared (so keyboard ±1 jumps work).
export function mountReadingHighlight(
  input: ReadingHighlightInput,
): ReadingHighlightHandle {
  const { iframeDoc, pageEl, rects, pageContent } = input;
  ensureStyle(iframeDoc);

  const elements: HTMLElement[] = [];
  for (const rect of rects) {
    const highlight = iframeDoc.createElement("div");
    highlight.className = "zai-reading-highlight";
    positionPdfRect(highlight, pageEl, rect, pageContent);
    pageEl.appendChild(highlight);
    elements.push(highlight);
  }
  // Bracket the span: a corner mark at the very start (first line) and the very
  // end (last line) so the reading sentence's bounds are unmistakable.
  if (elements.length > 0) {
    elements[0].classList.add("zai-reading-highlight--start");
    elements[elements.length - 1].classList.add("zai-reading-highlight--end");
  }

  let destroyed = false;
  let positionFrame = 0;
  const win = iframeDoc.defaultView;
  const reposition = () => {
    if (destroyed) return;
    rects.forEach((rect, index) => {
      const el = elements[index];
      if (el) positionPdfRect(el, pageEl, rect, pageContent);
    });
  };
  const schedulePosition = () => {
    if (destroyed) return;
    if (!win) {
      reposition();
      return;
    }
    if (positionFrame) return;
    positionFrame = win.requestAnimationFrame(() => {
      positionFrame = 0;
      reposition();
    });
  };
  win?.addEventListener("scroll", schedulePosition, true);
  win?.addEventListener("resize", schedulePosition);

  return {
    elements,
    destroy() {
      destroyed = true;
      if (positionFrame && win) win.cancelAnimationFrame(positionFrame);
      win?.removeEventListener("scroll", schedulePosition, true);
      win?.removeEventListener("resize", schedulePosition);
      for (const el of elements) el.remove();
    },
  };
}

function positionChooser(
  el: HTMLElement,
  pageEl: HTMLElement,
  rects: PdfRect[],
  pageContent: PdfPageContent,
): void {
  if (rects.length === 0) return;
  const xs = rects.map((r) => r[0]);
  const ys = rects.flatMap((r) => [r[1], r[3]]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const x1 = Math.max(...rects.map((r) => r[2]));

  const pageRect = pageEl.getBoundingClientRect();
  const viewportRect = viewportRectForPdfRect(
    pageEl,
    [x0, y0, x1, y1],
    pageContent,
  );
  const win = el.ownerDocument?.defaultView ?? null;
  const viewportWidth = win?.innerWidth || pageRect.width || 1;
  const viewportHeight = win?.innerHeight || pageRect.height || 1;
  const margin = 8;
  const gap = 6;

  el.style.position = "fixed";
  el.style.zIndex = "2147483647";
  el.style.visibility = "visible";
  const chooserRect = el.getBoundingClientRect();
  const chooserW = chooserRect.width || 96;
  const chooserH = chooserRect.height || 28;

  const rectLeft = pageRect.left + viewportRect.left;
  const rectRight = pageRect.left + viewportRect.right;
  const rectTop = pageRect.top + viewportRect.top;
  const rectBottom = pageRect.top + viewportRect.bottom;

  // Prefer just past the sentence's end (right of it); fall back to below the
  // sentence start if that would overflow the viewport.
  let left = rectRight + gap;
  let top = rectTop - 2;
  if (left + chooserW > viewportWidth - margin) {
    left = rectLeft;
    top = rectBottom + gap;
  }
  left = Math.max(margin, Math.min(left, viewportWidth - chooserW - margin));
  top = Math.max(margin, Math.min(top, viewportHeight - chooserH - margin));

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function mountSelectionPopupGuard(doc: Document): { destroy(): void } {
  const docs = relatedDocuments(doc);
  guardLog("mountSelectionPopupGuard", {
    docCount: docs.length,
    urls: docs.map(safeDocUrl),
  });
  for (const targetDoc of docs) {
    try {
      ensureSelectionPopupGuardStyle(targetDoc);
      targetDoc.documentElement?.classList.add(SELECTION_POPUP_GUARD_CLASS);
      guardLog("class added to documentElement", {
        url: safeDocUrl(targetDoc),
        hasClass: targetDoc.documentElement?.classList.contains(
          SELECTION_POPUP_GUARD_CLASS,
        ),
      });
    } catch (err) {
      guardLog("failed to add guard class to doc", {
        url: safeDocUrl(targetDoc),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // CSS-class approach can fail if a guarded popup is rendered in a doc
  // we cannot reach (cross-origin, shadow DOM, late-mount). Add a hard
  // MutationObserver that watches every reachable doc and hides every guarded
  // reader popup it finds — both already-present and newly-inserted.
  const observers: MutationObserver[] = [];
  // Duck-type rather than `instanceof HTMLElement`: in the chrome bootstrap
  // realm, `HTMLElement` is undefined, so `instanceof` throws ReferenceError
  // when the observer callback runs.
  const hidePopup = (el: Element) => {
    try {
      const styled = el as Element & { style?: CSSStyleDeclaration };
      if (styled.style?.setProperty) {
        styled.style.setProperty("visibility", "hidden", "important");
        styled.style.setProperty("pointer-events", "none", "important");
      } else {
        el.setAttribute(
          "style",
          "visibility: hidden !important; pointer-events: none !important;",
        );
      }
    } catch {
      /* ignore — best effort */
    }
  };
  const scanAndHide = (root: ParentNode) => {
    const nodes = root.querySelectorAll?.(GUARDED_POPUP_SELECTOR);
    if (!nodes) return;
    nodes.forEach((el: Element) => {
      hidePopup(el);
      guardLog("hid existing reader popup", {
        cls: (el as HTMLElement).className,
      });
    });
  };
  for (const targetDoc of docs) {
    try {
      scanAndHide(targetDoc);
      const view = targetDoc.defaultView as Window & {
        MutationObserver?: typeof MutationObserver;
      } | null;
      const Observer = view?.MutationObserver ?? MutationObserver;
      if (!targetDoc.body) continue;
      const observer = new Observer((mutations: MutationRecord[]) => {
        for (const m of mutations) {
          m.addedNodes.forEach((node: Node | null) => {
            if (!node || node.nodeType !== 1) return;
            const el = node as Element;
            if (el.matches?.(GUARDED_POPUP_SELECTOR)) {
              hidePopup(el);
              guardLog("hid newly-inserted reader popup", {
                cls: (el as HTMLElement).className,
              });
            }
            scanAndHide(el);
          });
        }
      });
      // Build options inside the target realm so Xray wrappers don't
      // strip the boolean properties (Firefox throws "must not be false"
      // when the wrapper drops the keys it can't see).
      const options = buildObserverOptions(view ?? targetDoc.defaultView);
      observer.observe(targetDoc.body, options);
      observers.push(observer);
      guardLog("MutationObserver attached", { url: safeDocUrl(targetDoc) });
    } catch (err) {
      guardLog("failed to attach observer", {
        url: safeDocUrl(targetDoc),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    destroy() {
      for (const targetDoc of docs) {
        targetDoc.documentElement?.classList.remove(
          SELECTION_POPUP_GUARD_CLASS,
        );
      }
      for (const observer of observers) observer.disconnect();
      guardLog("popup guard destroyed");
    },
  };
}

function buildObserverOptions(view: Window | null): MutationObserverInit {
  const fallback: MutationObserverInit = { childList: true, subtree: true };
  if (!view) return fallback;
  // Try Components.utils.cloneInto so the options object lives in the
  // target realm. Without this, Firefox's Xray wrapper can drop the boolean
  // keys, causing `MutationObserver.observe` to throw "must not be false".
  try {
    const Cu =
      (view as unknown as { Components?: { utils?: { cloneInto?: Function } } })
        .Components?.utils ??
      (globalThis as unknown as { Components?: { utils?: { cloneInto?: Function } } })
        .Components?.utils;
    if (typeof Cu?.cloneInto === "function") {
      return Cu.cloneInto(fallback, view) as MutationObserverInit;
    }
  } catch {
    /* fall through */
  }
  // Fallback: construct via the target realm's Object so properties
  // are owned by that compartment.
  try {
    const ViewObject = (view as unknown as { Object?: ObjectConstructor }).Object;
    if (ViewObject) {
      const obj = new ViewObject() as MutationObserverInit & Record<string, unknown>;
      obj.childList = true;
      obj.subtree = true;
      return obj;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function safeDocUrl(doc: Document): string {
  try {
    return doc.location?.href ?? "(no url)";
  } catch (err) {
    return `(threw: ${err instanceof Error ? err.message : String(err)})`;
  }
}

function guardLog(message: string, extra?: Record<string, unknown>): void {
  logTranslateDebug("zai-translate-guard", message, extra);
}

function relatedDocuments(doc: Document): Document[] {
  const docs: Document[] = [];
  const add = (candidate: Document | null | undefined) => {
    try {
      if (candidate && !docs.includes(candidate)) docs.push(candidate);
    } catch {
      /* ignore */
    }
  };

  add(doc);
  let win: Window | null = null;
  try {
    win = doc.defaultView;
  } catch {
    return docs;
  }
  for (let i = 0; i < 4 && win; i++) {
    try {
      const parent: Window | null = win.parent;
      if (!parent || parent === win) break;
      let parentDoc: Document | null = null;
      try {
        parentDoc = parent.document;
      } catch {
        break; // cross-origin / chrome-privileged — stop walking
      }
      add(parentDoc);
      win = parent;
    } catch {
      break;
    }
  }
  return docs;
}

function ensureSelectionPopupGuardStyle(doc: Document): void {
  if (doc.getElementById(SELECTION_POPUP_GUARD_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = SELECTION_POPUP_GUARD_STYLE_ID;
  style.textContent = `
.${SELECTION_POPUP_GUARD_CLASS} :is(.selection-popup, .annotation-popup) {
  visibility: hidden !important;
  pointer-events: none !important;
}
`;
  (doc.head ?? doc.documentElement)?.append(style);
}

function makeBtn(
  doc: Document,
  label: string,
  title: string,
  handler?: () => void,
  primary = false,
): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = "zai-translate-overlay__btn";
  if (primary) b.classList.add("zai-translate-overlay__btn--primary");
  b.textContent = label;
  b.title = title;
  if (!handler) {
    b.disabled = true;
    return b;
  }
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    handler();
  });
  return b;
}

// Rebuild `container` as text with each pair's `field` term (first, non-
// Distinct, white-card-readable colors for 重点词对应 pairs (原文词 ↔ 译文词
// share index → share color). Cycled for more pairs than colors.
const TERM_COLORS = [
  "#2563a6", // blue
  "#1d6b46", // green
  "#8a4fd0", // purple
  "#c0673d", // orange
  "#0e7c86", // teal
  "#b5377e", // magenta
];

// overlapping occurrence) wrapped in a `.zai-term` span tagged data-k=pairIndex,
// so the matching 原文/译 spans share a key for hover linking.
function renderTermSpans(
  doc: Document,
  container: HTMLElement,
  text: string,
  pairs: TermPair[],
  field: "en" | "zh",
): void {
  const lower = text.toLowerCase();
  const ranges: Array<{ start: number; end: number; k: number }> = [];
  pairs.forEach((pair, k) => {
    const term = pair[field];
    if (!term) return;
    const at = lower.indexOf(term.toLowerCase());
    if (at < 0) return;
    ranges.push({ start: at, end: at + term.length, k });
  });
  ranges.sort((a, b) => a.start - b.start);
  // Greedily drop overlaps so spans never nest or split mid-word.
  const kept: Array<{ start: number; end: number; k: number }> = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start >= cursor) {
      kept.push(r);
      cursor = r.end;
    }
  }
  container.textContent = "";
  let pos = 0;
  for (const r of kept) {
    if (r.start > pos) {
      container.appendChild(doc.createTextNode(text.slice(pos, r.start)));
    }
    const span = doc.createElement("span");
    span.className = "zai-term";
    span.setAttribute("data-k", String(r.k));
    // Per-pair color so 原文词 and its 译文词 share a hue — matchable at a glance
    // without hovering. Cycles through the palette for >palette-length pairs.
    const color = TERM_COLORS[r.k % TERM_COLORS.length]!;
    span.style.color = color;
    span.style.borderBottomColor = color;
    span.textContent = text.slice(r.start, r.end);
    container.appendChild(span);
    pos = r.end;
  }
  if (pos < text.length) {
    container.appendChild(doc.createTextNode(text.slice(pos)));
  }
}

// Build the structured 拆解 DOM from parsed segments, matching the design doc:
// keyword/subject use <ruby> (头顶中文小字); 主语 adds a green 「主」 tag + green
// underline; 定语 is grey, bracketed with 〔 〕 and a小字 gloss; legend at the end.
function renderBreakdownStruct(
  doc: Document,
  segs: BreakdownSeg[],
  legend: string,
  tokenLabel: string,
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "zai-bd";

  const gloss = (zh: string): HTMLElement => {
    const g = doc.createElement("span");
    g.className = "zai-bd-gloss";
    g.textContent = zh;
    return g;
  };
  const ruby = (en: string, zh?: string): HTMLElement => {
    const r = doc.createElement("ruby");
    r.appendChild(doc.createTextNode(en));
    if (zh) {
      const rt = doc.createElement("rt");
      rt.textContent = zh;
      r.appendChild(rt);
    }
    return r;
  };
  // <ruby> justifies a short annotation across a long base ("语 言 跟 随…"), so
  // only use it for short segments; longer phrases get an inline gloss after,
  // which reads cleanly and never spreads.
  const isShortForRuby = (en: string): boolean => {
    const t = en.trim();
    return t.split(/\s+/).length <= 3 && t.length <= 20;
  };

  // 主语 / 谓语: a role tag + green/orange-underlined phrase. Ruby gloss when
  // short, otherwise the underlined phrase + a trailing inline gloss.
  const headPhrase = (
    cls: string,
    tagCls: string,
    tagText: string,
    en: string,
    zh?: string,
  ): void => {
    const span = doc.createElement("span");
    span.className = cls;
    const tag = doc.createElement("span");
    tag.className = tagCls;
    tag.textContent = tagText;
    span.appendChild(tag);
    if (zh && isShortForRuby(en)) {
      span.appendChild(ruby(en, zh));
      wrap.appendChild(span);
    } else {
      span.appendChild(doc.createTextNode(en));
      wrap.appendChild(span);
      if (zh) wrap.appendChild(gloss(zh));
    }
  };

  for (const seg of segs) {
    if (seg.role === "text") {
      wrap.appendChild(doc.createTextNode(seg.en));
    } else if (seg.role === "kw") {
      if (seg.zh && isShortForRuby(seg.en)) {
        wrap.appendChild(ruby(seg.en, seg.zh));
      } else {
        wrap.appendChild(doc.createTextNode(seg.en));
        if (seg.zh) wrap.appendChild(gloss(seg.zh));
      }
    } else if (seg.role === "subj") {
      headPhrase("zai-bd-subj", "zai-bd-tag", "主", seg.en, seg.zh);
    } else if (seg.role === "pred") {
      headPhrase("zai-bd-pred", "zai-bd-tag zai-bd-tag--pred", "谓", seg.en, seg.zh);
    } else if (seg.role === "adv") {
      // 状语: a 「状」 tag + the phrase + a small Chinese gloss (no brackets, so
      // it stays visually distinct from the grey 〔定语〕).
      const span = doc.createElement("span");
      span.className = "zai-bd-adv";
      const tag = doc.createElement("span");
      tag.className = "zai-bd-tag zai-bd-tag--adv";
      tag.textContent = "状";
      span.appendChild(tag);
      span.appendChild(doc.createTextNode(seg.en));
      if (seg.zh) {
        const gloss = doc.createElement("span");
        gloss.className = "zai-bd-gloss";
        gloss.textContent = seg.zh;
        span.appendChild(gloss);
      }
      wrap.appendChild(span);
    } else {
      const span = doc.createElement("span");
      span.className = "zai-bd-def";
      const open = doc.createElement("span");
      open.className = "zai-bd-br";
      open.textContent = "〔";
      span.appendChild(open);
      span.appendChild(doc.createTextNode(seg.en));
      if (seg.zh) {
        const gloss = doc.createElement("span");
        gloss.className = "zai-bd-gloss";
        gloss.textContent = seg.zh;
        span.appendChild(gloss);
      }
      const close = doc.createElement("span");
      close.className = "zai-bd-br";
      close.textContent = "〕";
      span.appendChild(close);
      wrap.appendChild(span);
    }
  }

  if (legend || tokenLabel) {
    const foot = doc.createElement("div");
    foot.className = "zai-bd-foot";
    const lg = doc.createElement("div");
    lg.className = "zai-bd-legend";
    if (legend) {
      const b = doc.createElement("b");
      b.textContent = "主";
      lg.appendChild(b);
      lg.appendChild(doc.createTextNode(legend.replace(/^主/, "")));
    }
    foot.appendChild(lg);
    if (tokenLabel) {
      const tok = doc.createElement("div");
      tok.className = "zai-bd-token";
      tok.textContent = tokenLabel;
      foot.appendChild(tok);
    }
    wrap.appendChild(foot);
  }
  return wrap;
}

// Wire hover linking: hovering any .zai-term lights every term sharing its key.
function wireTermHover(root: HTMLElement): void {
  const terms = Array.from(root.querySelectorAll(".zai-term")) as HTMLElement[];
  for (const term of terms) {
    const k = term.getAttribute("data-k");
    if (k == null) continue;
    const setLit = (lit: boolean) => {
      const peers = Array.from(
        root.querySelectorAll(`.zai-term[data-k="${k}"]`),
      ) as HTMLElement[];
      for (const peer of peers) peer.classList.toggle("zai-term--lit", lit);
    };
    term.addEventListener("mouseenter", () => setLit(true));
    term.addEventListener("mouseleave", () => setLit(false));
  }
}

// A compact checkbox toggle for the meta bar (结合上下句 / 自适应宽度).
function makeMetaCheck(
  doc: Document,
  toggle: { label: string; checked: boolean; onToggle: (on: boolean) => void },
  title: string,
): HTMLElement {
  const label = doc.createElement("label");
  label.className =
    "zai-translate-overlay__check zai-translate-overlay__check--meta";
  label.title = title;
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.checked = toggle.checked;
  const text = doc.createElement("span");
  text.textContent = toggle.label;
  label.append(box, text);
  label.addEventListener("click", (ev) => ev.stopPropagation());
  box.addEventListener("change", (ev) => {
    ev.stopPropagation();
    toggle.onToggle(box.checked);
  });
  return label;
}

function mountHighlights(
  doc: Document,
  pageEl: HTMLElement,
  rects: PdfRect[],
  pageContent: PdfPageContent,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const rect of rects) {
    const highlight = doc.createElement("div");
    highlight.className = "zai-translate-highlight";
    positionPdfRect(highlight, pageEl, rect, pageContent);
    pageEl.appendChild(highlight);
    out.push(highlight);
  }
  return out;
}

function positionOverlay(
  overlay: HTMLElement,
  pageEl: HTMLElement,
  rects: PdfRect[],
  pageContent: PdfPageContent,
  position: TranslateOverlayPosition,
  size: TranslateOverlaySize,
  autoWidth: boolean,
): void {
  guardLog("positionOverlay", {
    rectCount: rects.length,
    pageRect: (() => {
      try {
        const r = pageEl.getBoundingClientRect();
        return { w: r.width, h: r.height, top: r.top, left: r.left };
      } catch {
        return null;
      }
    })(),
  });
  if (rects.length === 0) return;

  const xs = rects.map((r) => r[0]);
  const ys = rects.flatMap((r) => [r[1], r[3]]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);

  const pageRect = pageEl.getBoundingClientRect();
  const viewportRect = viewportRectForPdfRect(
    pageEl,
    [x0, y0, Math.max(...rects.map((r) => r[2])), y1],
    pageContent,
  );
  const cssLeft = viewportRect.left;
  const cssTopOfRect = viewportRect.top;
  const cssBottomOfRect = viewportRect.bottom;
  const win = overlay.ownerDocument?.defaultView ?? null;
  const viewportWidth = win?.innerWidth || pageRect.width || 1;
  const viewportHeight = win?.innerHeight || pageRect.height || 1;
  const margin = 8;
  const gap = 8;
  const bounds = visibleOverlayBounds(pageEl, pageRect, {
    width: viewportWidth,
    height: viewportHeight,
    margin,
  });
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  // 自适应宽度 widens the card toward the available space (capped) so long lines
  // don't orphan 1–2 words; otherwise the fixed compact/adaptive width.
  const targetWidth = autoWidth ? 700 : size === "adaptive" ? 480 : 320;
  const minWidth = size === "adaptive" ? 280 : 220;
  const overlayWidth = Math.min(
    targetWidth,
    Math.max(minWidth, Math.min(pageRect.width, boundsWidth) - margin * 2),
  );
  const anchorLeft = pageRect.left + cssLeft;
  const rectTop = pageRect.top + cssTopOfRect;
  const rectBottom = pageRect.top + cssBottomOfRect;
  const left = clamp(
    anchorLeft,
    bounds.left,
    Math.max(bounds.left, bounds.right - overlayWidth),
  );

  overlay.style.position = "fixed";
  overlay.style.left = `${left}px`;
  overlay.style.width = `${overlayWidth}px`;
  overlay.style.right = "";
  overlay.style.bottom = "";
  const visibleHeight = Math.max(84, bounds.bottom - bounds.top);
  overlay.style.maxHeight = `${visibleHeight}px`;
  overlay.style.setProperty(
    "--zai-overlay-body-max-height",
    size === "adaptive" ? `${Math.max(110, visibleHeight - 64)}px` : "110px",
  );

  const naturalHeight = measureOverlayHeight(overlay);
  const availableAbove = rectTop - gap - bounds.top;
  const availableBelow = bounds.bottom - rectBottom - gap;
  const minUsableHeight = 132;
  let actualPosition = position;
  if (
    position === "below" &&
    (naturalHeight > availableBelow || availableBelow < minUsableHeight) &&
    availableAbove > availableBelow
  ) {
    actualPosition = "above";
  } else if (
    position === "above" &&
    (naturalHeight > availableAbove || availableAbove < minUsableHeight) &&
    availableBelow > availableAbove
  ) {
    actualPosition = "below";
  }

  const availableOnSide =
    actualPosition === "above" ? availableAbove : availableBelow;
  const maxHeight = Math.max(
    84,
    Math.min(
      naturalHeight,
      availableOnSide > 0 ? availableOnSide : visibleHeight,
      visibleHeight,
    ),
  );
  overlay.style.maxHeight = `${maxHeight}px`;
  fitOverlayBody(overlay, maxHeight);

  const overlayHeight = measureOverlayHeight(overlay);
  const preferredTop =
    actualPosition === "above"
      ? rectTop - overlayHeight - gap
      : rectBottom + gap;
  const top = clamp(
    preferredTop,
    bounds.top,
    Math.max(bounds.top, bounds.bottom - overlayHeight),
  );
  const arrowLeft = clamp(anchorLeft - left + 8, 18, overlayWidth - 18);

  overlay.setAttribute("data-position", actualPosition);
  overlay.style.setProperty("--zai-overlay-arrow-left", `${arrowLeft}px`);
  overlay.style.top = `${top}px`;
  overlay.style.zIndex = "2147483647";
  overlay.style.visibility = "visible";
  guardLog("positionOverlay applied", {
    visibility: overlay.style.visibility,
    left: overlay.style.left,
    top: overlay.style.top,
    width: overlay.style.width,
    zIndex: overlay.style.zIndex,
    inDom: overlay.isConnected,
    parentTag: overlay.parentElement?.tagName,
    parentId: overlay.parentElement?.id,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

interface OverlayViewport {
  width: number;
  height: number;
  margin: number;
}

interface OverlayBounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function visibleOverlayBounds(
  pageEl: HTMLElement,
  pageRect: DOMRect,
  viewport: OverlayViewport,
): OverlayBounds {
  let top = viewport.margin;
  let right = viewport.width - viewport.margin;
  let bottom = viewport.height - viewport.margin;
  let left = viewport.margin;

  // Keep the bubble inside the current PDF page. Zotero/PDF.js draws strong
  // separators between pages; crossing them makes the bottom controls unclickable.
  top = Math.max(top, pageRect.top + viewport.margin);
  right = Math.min(right, pageRect.right - viewport.margin);
  bottom = Math.min(bottom, pageRect.bottom - viewport.margin);
  left = Math.max(left, pageRect.left + viewport.margin);

  const clipBounds = nearestClipBounds(pageEl);
  if (clipBounds) {
    top = Math.max(top, clipBounds.top + viewport.margin);
    right = Math.min(right, clipBounds.right - viewport.margin);
    bottom = Math.min(bottom, clipBounds.bottom - viewport.margin);
    left = Math.max(left, clipBounds.left + viewport.margin);
  }

  if (right <= left) {
    left = viewport.margin;
    right = viewport.width - viewport.margin;
  }
  if (bottom <= top) {
    top = viewport.margin;
    bottom = viewport.height - viewport.margin;
  }
  return { top, right, bottom, left };
}

function nearestClipBounds(el: HTMLElement): OverlayBounds | null {
  const win = el.ownerDocument?.defaultView;
  if (!win) return null;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (!style) continue;
    const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
    if (/(auto|scroll|hidden|clip)/.test(overflow)) {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.left + (node.clientWidth || rect.width),
        bottom: rect.top + (node.clientHeight || rect.height),
        left: rect.left,
      };
    }
    if (node === el.ownerDocument.body) break;
  }
  return null;
}

function measureOverlayHeight(overlay: HTMLElement): number {
  const rectHeight = overlay.getBoundingClientRect().height;
  return Math.max(1, rectHeight || overlay.offsetHeight || 120);
}

function fitOverlayBody(overlay: HTMLElement, maxHeight: number): void {
  const body = overlay.querySelector<HTMLElement>(".zai-translate-overlay__body");
  const meta = overlay.querySelector<HTMLElement>(".zai-translate-overlay__meta");
  const actions = overlay.querySelector<HTMLElement>(
    ".zai-translate-overlay__actions",
  );
  if (!body || !meta || !actions) return;
  const win = overlay.ownerDocument?.defaultView;
  const overlayStyle = win?.getComputedStyle(overlay);
  const bodyStyle = win?.getComputedStyle(body);
  const paddingY =
    px(overlayStyle?.paddingTop) + px(overlayStyle?.paddingBottom);
  const bodyMargins =
    px(bodyStyle?.marginTop) + px(bodyStyle?.marginBottom);
  // Ask mode has a transcript scroller and a composer row, both of which need
  // their height subtracted so the scroll region (not individual bodies) is
  // what's capped. Translate has neither, so this stays a no-op there.
  const composer = overlay.querySelector<HTMLElement>(
    ".zai-translate-overlay__composer",
  );
  const extraRows = composer ? measureOverlayHeight(composer) : 0;
  const fixedHeight =
    measureOverlayHeight(meta) +
    measureOverlayHeight(actions) +
    extraRows +
    paddingY;
  const bodyMax = Math.max(28, maxHeight - fixedHeight - bodyMargins - 4);
  overlay.style.setProperty(
    "--zai-overlay-body-max-height",
    `${Math.floor(bodyMax)}px`,
  );
}

function px(value: string | undefined): number {
  const n = value ? Number.parseFloat(value) : 0;
  return Number.isFinite(n) ? n : 0;
}

function positionPdfRect(
  el: HTMLElement,
  pageEl: HTMLElement,
  rect: PdfRect,
  pageContent: PdfPageContent,
): void {
  const pageRect = pageEl.getBoundingClientRect();
  const viewportRect = viewportRectForPdfRect(pageEl, rect, pageContent);
  el.style.position = "absolute";
  el.style.left = `${viewportRect.left}px`;
  el.style.top = `${viewportRect.top}px`;
  el.style.width = `${Math.max(1, viewportRect.right - viewportRect.left)}px`;
  el.style.height = `${Math.max(1, viewportRect.bottom - viewportRect.top)}px`;
}

interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function viewportRectForPdfRect(
  pageEl: HTMLElement,
  rect: PdfRect,
  pageContent: PdfPageContent,
): ViewportRect {
  const viewport = pageEl.ownerDocument
    ? pdfPageViewport(pageEl.ownerDocument, pageContent.pageIndex)
    : null;
  if (viewport) {
    const [x1, y2] = viewport.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y1] = viewport.convertToViewportPoint(rect[2], rect[3]);
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      right: Math.max(x1, x2),
      bottom: Math.max(y1, y2),
    };
  }

  return fallbackViewportRectForPdfRect(pageEl, rect, pageContent);
}

function fallbackViewportRectForPdfRect(
  pageEl: HTMLElement,
  rect: PdfRect,
  pageContent: PdfPageContent,
): ViewportRect {
  const pageRect = pageEl.getBoundingClientRect();
  const viewBox = pageContent.viewBox;
  const x0 = viewBox?.[0] ?? 0;
  const y0 = viewBox?.[1] ?? 0;
  const x1 = viewBox?.[2] ?? (pageRect.width || 1);
  const y1 = viewBox?.[3] ?? (pageRect.height || 1);
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  return {
    left: ((rect[0] - x0) / width) * pageRect.width,
    top: ((y1 - rect[3]) / height) * pageRect.height,
    right: ((rect[2] - x0) / width) * pageRect.width,
    bottom: ((y1 - rect[1]) / height) * pageRect.height,
  };
}

function pdfPageViewport(
  doc: Document,
  pageIndex: number,
): { convertToViewportPoint: (x: number, y: number) => [number, number] } | null {
  const win = doc.defaultView as
    | (Window & {
        PDFViewerApplication?: unknown;
        wrappedJSObject?: { PDFViewerApplication?: unknown };
      })
    | null;
  const app = win?.PDFViewerApplication ?? win?.wrappedJSObject?.PDFViewerApplication;
  const page = (app as { pdfViewer?: { _pages?: unknown[] } } | null)?.pdfViewer
    ?._pages?.[pageIndex] as { viewport?: unknown } | undefined;
  const viewport = page?.viewport as
    | { convertToViewportPoint?: (x: number, y: number) => [number, number] }
    | undefined;
  return typeof viewport?.convertToViewportPoint === "function"
    ? (viewport as { convertToViewportPoint: (x: number, y: number) => [number, number] })
    : null;
}

const SELECTION_POPUP_GUARD_CLASS = "zai-translate-hide-selection-popup";
const SELECTION_POPUP_GUARD_STYLE_ID = "zai-translate-selection-popup-guard";
// Reader popups suppressed while immersive mode is on, so its own card is the
// single surface: `.selection-popup` (text-selection highlight bar) and
// `.annotation-popup` (the native popup shown when clicking an existing
// annotation — immersive shows the saved comment in its own card instead).
const GUARDED_POPUP_SELECTOR = ".selection-popup, .annotation-popup";
const STYLE_ID = "zai-translate-style";

function ensureStyle(doc: Document): void {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    (doc.head ?? doc.documentElement!).appendChild(style);
  }
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
}

const STYLE_TEXT = `
.zai-translate-highlight {
  background: rgba(255, 213, 79, 0.34);
  box-shadow: 0 0 0 1px rgba(255, 171, 0, 0.46) inset;
  border-radius: 2px;
  pointer-events: none;
  z-index: 19;
}
.zai-reading-highlight {
  background: rgba(96, 125, 170, 0.22);
  box-shadow: 0 0 0 1px rgba(96, 125, 170, 0.38) inset;
  border-radius: 2px;
  pointer-events: none;
  z-index: 17;
}
.zai-reading-highlight--start::before,
.zai-reading-highlight--end::after {
  content: "";
  position: absolute;
  width: 7px;
  height: 12px;
  border: 0 solid rgba(60, 100, 165, 0.95);
  pointer-events: none;
  z-index: 18;
}
.zai-reading-highlight--start::before {
  left: -3px;
  top: -2px;
  border-left-width: 2px;
  border-top-width: 2px;
}
.zai-reading-highlight--end::after {
  right: -3px;
  bottom: -2px;
  border-right-width: 2px;
  border-bottom-width: 2px;
}
.zai-translate-overlay {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #d8d8da;
  border-radius: 8px;
  padding: 8px 10px 6px;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  color: #1d1d1f;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(255, 213, 79, 0.55);
  overflow: hidden;
  pointer-events: auto;
  -moz-user-select: text !important;
  user-select: text !important;
}
/* The Zotero reader sets user-select:none on the viewer; force the card's text
   areas selectable with !important so 原文/译文/拆解 can be copied. */
.zai-translate-overlay__source,
.zai-translate-overlay__body,
.zai-translate-overlay__transcript,
.zai-translate-overlay__turn,
.zai-translate-overlay__breakdown,
.zai-bd,
.zai-bd * {
  -moz-user-select: text !important;
  user-select: text !important;
}
.zai-translate-overlay::before {
  content: "";
  position: absolute;
  left: var(--zai-overlay-arrow-left, 26px);
  width: 12px;
  height: 12px;
  background: #fff;
  transform: rotate(45deg);
}
.zai-translate-overlay[data-position="above"]::before {
  bottom: -7px;
  border-right: 1px solid #d8d8da;
  border-bottom: 1px solid #d8d8da;
}
.zai-translate-overlay[data-position="below"]::before {
  top: -7px;
  border-left: 1px solid #d8d8da;
  border-top: 1px solid #d8d8da;
}
.zai-translate-overlay__meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 7px;
  font-size: 10px;
  color: #888;
  margin-bottom: 4px;
}
.zai-translate-overlay__meta-sp { flex: 1 1 auto; min-width: 8px; }
/* compact toggles inside the meta bar — neutral gray (NOT the content's blue),
   so the toggle labels read as chrome and never look like a translated term. */
.zai-translate-overlay__check--meta { font-size: 10px; color: #6b7280; }
.zai-translate-overlay__lang {
  background: #f1f3f6;
  color: #555;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 9.5px;
}
.zai-translate-overlay__body {
  flex: 1 1 auto;
  min-height: 0;
  white-space: pre-wrap;
  color: #1d1d1f;
  font-size: 13px;
  line-height: 1.55;
  margin-bottom: 7px;
  max-height: var(--zai-overlay-body-max-height, 110px);
  overflow-y: auto;
}
.zai-translate-overlay__source {
  flex: 0 0 auto;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 12px;
  line-height: 1.55;
  color: #2f333a;
  background: #fafbfc;
  border-radius: 6px;
  padding: 5px 8px;
  margin-bottom: 7px;
  max-height: 84px;
  overflow-y: auto;
}
/* 译文块：原文 + 译文 合成一张卡，和下面的「追问回答块」同一种视觉语言（灰底卡）。 */
.zai-translate-overlay__main {
  flex: 0 1 auto;
  min-height: 0;
  background: #f6f7f9;
  border: 1px solid #ebedf1;
  border-radius: 7px;
  padding: 7px 9px;
  margin-bottom: 7px;
  max-height: var(--zai-overlay-body-max-height, 130px);
  overflow-y: auto;
}
/* Inside the translation block, 原文 is a lighter reference header (no nested
   panel), split from 译文 by a thin divider; 译文 fills the block as plain text. */
.zai-translate-overlay__main .zai-translate-overlay__source {
  background: transparent;
  border-radius: 0;
  padding: 0 0 5px;
  margin: 0 0 6px;
  border-bottom: 1px solid #e7e9ee;
  max-height: none;
  overflow: visible;
}
.zai-translate-overlay__main .zai-translate-overlay__body {
  margin: 0;
  max-height: none;
  overflow-y: visible;
}
.zai-translate-overlay__chips {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
  margin: 0 0 6px;
}
.zai-translate-overlay__check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: #6b7280;
  cursor: pointer;
  -moz-user-select: none;
  user-select: none;
}
.zai-translate-overlay__check input {
  /* Fully custom checkbox: the reader's Gecko ignores accent-color, so a native
     checkbox stays bright system-blue (looks like a translated term). Draw our own
     gray box + white check instead — guaranteed monochrome, never blue. */
  -moz-appearance: none;
  appearance: none;
  margin: 0;
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  border: 1px solid #b9c0cb;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
}
.zai-translate-overlay__check input:checked {
  background-color: #6b7280;
  border-color: #6b7280;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.6 6.3 5 8.6 9.4 3.6' fill='none' stroke='white' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
}
.zai-translate-overlay__chip {
  background: #fff;
  border: 1px dashed #cdd9ea;
  color: #3a6ea5;
  border-radius: 6px;
  padding: 1px 9px;
  font-size: 10.5px;
  cursor: pointer;
}
.zai-translate-overlay__chip:hover { background: #eef4fc; }
.zai-translate-overlay__chip--on {
  background: #3a6ea5;
  border-style: solid;
  border-color: #3a6ea5;
  color: #fff;
}
.zai-translate-overlay__breakdown {
  display: none;
  flex: 0 0 auto;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.6;
  color: #1d1d1f;
  background: #f7f5ef;
  border: 1px solid #ece3d3;
  border-left: 3px solid #c0673d;
  border-radius: 0 7px 7px 0;
  padding: 8px 10px;
  margin-bottom: 7px;
  max-height: 168px;
  overflow-y: auto;
}
.zai-translate-overlay__breakdown--show { display: block; }
.zai-translate-overlay__breakdown--status { color: #666; font-style: italic; }
.zai-bd {
  white-space: normal;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 12.5px;
  line-height: 2.5;
  color: #1f2328;
  -moz-user-select: text;
  user-select: text;
}
.zai-bd ruby { ruby-position: over; ruby-align: center; }
.zai-bd rt {
  font-size: 8.5px;
  color: #3a6ea5;
  font-family: -apple-system, "PingFang SC", sans-serif;
  font-weight: 600;
  opacity: 0.9;
}
.zai-bd-subj {
  font-weight: 800;
  color: #14233a;
  border-bottom: 2px solid #1d6b46;
  border-radius: 1px;
  padding: 0 1px;
}
.zai-bd-subj rt { color: #1d6b46; }
.zai-bd-pred {
  font-weight: 800;
  color: #14233a;
  border-bottom: 2px solid #c0673d;
  border-radius: 1px;
  padding: 0 1px;
}
.zai-bd-pred rt { color: #c0673d; }
.zai-bd-adv { color: #3a6ea5; }
.zai-bd-tag {
  font-size: 8px;
  background: #1d6b46;
  color: #fff;
  border-radius: 3px;
  padding: 0 3px;
  margin-right: 2px;
  vertical-align: 2px;
  font-weight: 700;
}
.zai-bd-tag--pred { background: #c0673d; }
.zai-bd-tag--adv { background: #3a6ea5; }
.zai-bd-def { color: #6b7280; }
.zai-bd-br { color: #9aa1ab; font-weight: 700; }
.zai-bd-gloss {
  font-size: 9.5px;
  color: #8a93a0;
  font-family: -apple-system, "PingFang SC", sans-serif;
  margin-left: 2px;
}
.zai-bd-foot {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 5px;
}
.zai-bd-legend {
  flex: 1 1 auto;
  font-size: 10px;
  color: #9aa1ab;
  line-height: 1.5;
}
.zai-bd-legend b { color: #1d6b46; }
.zai-bd-token {
  flex: 0 0 auto;
  font-size: 10px;
  color: #9aa1ab;
  white-space: nowrap;
}
.zai-term {
  color: #b5562a;
  font-weight: 600;
  border-bottom: 1.5px solid rgba(181, 86, 42, 0.5);
  border-radius: 2px;
  padding: 0 1px;
  cursor: pointer;
}
.zai-term--lit {
  background: #ffe08a;
  color: #8a3d18;
  border-bottom-color: transparent;
  box-shadow: 0 0 0 1px #e8c25a;
}
.zai-translate-overlay__body--status { color: #666; font-style: italic; }
.zai-translate-overlay--error .zai-translate-overlay__body { color: #b3261e; }
/* 已有注释：把保存过的批注内容包成一张明显的便签卡，和普通译文区分。 */
.zai-translate-overlay__body--note {
  background: #fdf6df;
  border: 1px solid #f0dba0;
  border-radius: 8px;
  padding: 8px 10px;
}
.zai-translate-overlay__note-head {
  font-size: 11px;
  font-weight: 700;
  color: #9a6a10;
  letter-spacing: 0.3px;
  margin-bottom: 5px;
}
.zai-translate-overlay__note-text { white-space: pre-wrap; }
/* 逐句对照：上下堆叠——每段英文一行（可换行）+ 紧跟一行中文，下一段另起。 */
.zai-translate-overlay__body--interleaved { white-space: normal; }
.zai-il-en {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 12.5px;
  color: #2f333a;
  line-height: 1.5;
  margin-top: 9px;
}
.zai-il-en:first-child { margin-top: 0; }
.zai-il-zh {
  font-size: 13px;
  color: #1d1d1f;
  line-height: 1.5;
  margin-top: 1px;
}
.zai-translate-overlay--ask .zai-translate-overlay__transcript {
  /* Q&A only (translation lives in its own body above). Don't grow when empty
     — flex-grow:0 avoids a blank gap before the first follow-up; scroll past a
     cap so long conversations stay bounded. */
  flex: 0 1 auto;
  min-height: 0;
  max-height: 240px;
  overflow-y: auto;
}
.zai-translate-overlay--ask .zai-translate-overlay__transcript:empty {
  margin: 0;
}
.zai-translate-overlay--ask .zai-translate-overlay__transcript:not(:empty) {
  margin-top: 7px;
}
.zai-translate-overlay--ask .zai-translate-overlay__body {
  max-height: none;
  overflow-y: visible;
  margin-bottom: 6px;
}
.zai-translate-overlay__turn {
  border-radius: 6px;
  padding: 5px 8px;
  margin-bottom: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.zai-translate-overlay__turn--user {
  background: #eef0ff;
  color: #3a2f7a;
  border: 1px solid #dddef6;
}
/* AI 回答块：每条「追问」回答也包成一张淡灰卡，让多轮问答读成一问一答的分块，而
   不是气泡后贴一段散文。译文在最上方主体里、不在 transcript，所以保持纯净不受影响。 */
.zai-translate-overlay__transcript .zai-translate-overlay__body {
  background: #f6f7f9;
  border: 1px solid #ebedf1;
  border-radius: 6px;
  padding: 6px 9px;
}
.zai-translate-overlay__composer {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}
.zai-translate-overlay__input {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  height: 26px;
  border: 1px solid #d8d8da;
  border-radius: 6px;
  padding: 0 8px;
  font-size: 12.5px;
  font-family: inherit;
  color: #1d1d1f;
  background: #fff;
  outline: none;
}
.zai-translate-overlay__input:focus {
  border-color: #7856ff;
  box-shadow: 0 0 0 2px rgba(120, 86, 255, 0.18);
}
.zai-translate-overlay--error {
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(179, 38, 30, 0.42);
}
.zai-translate-overlay__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
  min-width: 0;
}
.zai-translate-overlay__btn {
  background: #f5f5f7;
  border: 1px solid #e0e0e3;
  color: #333;
  border-radius: 5px;
  width: 26px;
  height: 24px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  font-size: 12px;
}
.zai-translate-overlay__btn:hover:not(:disabled) {
  background: #ebebef;
}
.zai-translate-overlay__btn--primary {
  background: #4a8cf7;
  border-color: #4a8cf7;
  color: #fff;
}
.zai-translate-overlay__btn:disabled { opacity: 0.4; cursor: default; }
.zai-translate-overlay__hint {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #888;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 视觉层级：把 chrome（顶部 meta 栏、底部按钮行、追问框）默认隐退——降透明度 +
   灰阶——让眼睛落在中间的原文/译文；鼠标悬停卡片或焦点进入卡片时再浮现到全亮。
   内容区（__body / __source / __transcript）不受影响，始终满对比。 */
.zai-translate-overlay__meta,
.zai-translate-overlay__actions,
.zai-translate-overlay__composer {
  opacity: 0.5;
  filter: grayscale(0.7);
  transition: opacity 0.18s ease, filter 0.18s ease;
}
.zai-translate-overlay--pointer-active .zai-translate-overlay__meta,
.zai-translate-overlay--pointer-active .zai-translate-overlay__actions,
.zai-translate-overlay--pointer-active .zai-translate-overlay__composer,
.zai-translate-overlay:focus-within .zai-translate-overlay__meta,
.zai-translate-overlay:focus-within .zai-translate-overlay__actions,
.zai-translate-overlay:focus-within .zai-translate-overlay__composer {
  opacity: 1;
  filter: none;
}
/* 收起工具栏（快捷键，默认 h）：整段藏起 meta 栏 + 底部按钮行，高度一并收掉。追问框
   保留，仍可直接提问。与上面的 hover 变淡是两套独立机制。 */
.zai-translate-overlay--collapsed .zai-translate-overlay__meta,
.zai-translate-overlay--collapsed .zai-translate-overlay__actions {
  display: none;
}
/* 发送键：追问框为空（占位符可见）时压成中性灰；一旦有输入就回到 --primary 的蓝。
   兄弟选择器，不依赖 :has()，旧版 Gecko 也可用。 */
.zai-translate-overlay__input:placeholder-shown
  ~ .zai-translate-overlay__btn--primary {
  background: #e8eaef;
  border-color: #e8eaef;
  color: #9aa3b2;
}
.zai-sentence-chooser {
  box-sizing: border-box;
  display: inline-flex;
  gap: 4px;
  align-items: center;
  background: #fff;
  border: 1px solid #d8d8da;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(120, 86, 255, 0.4);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
  pointer-events: auto;
}
.zai-sentence-chooser__btn {
  background: #f5f5f7;
  border: 1px solid #e0e0e3;
  color: #333;
  border-radius: 5px;
  height: 24px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}
.zai-sentence-chooser__btn:hover {
  background: #ebebef;
}
.zai-sentence-chooser__btn--primary {
  background: #7856ff;
  border-color: #7856ff;
  color: #fff;
}
.zai-sentence-chooser__btn--primary:hover {
  background: #6a48f0;
}
`;
