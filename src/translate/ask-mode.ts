import { createPdfLocator, type PdfLocator } from "../context/pdf-locator";
import { detectSentenceAtPoint, type DetectedSentence } from "./sentence-detect";
import {
  mountOverlay,
  mountReadingHighlight,
  mountSelectionPopupGuard,
  mountSentenceChooser,
  type OverlayHandle,
  type OverlayMeta,
  type ReadingHighlightHandle,
  type SentenceChooserHandle,
} from "./overlay";
import {
  answerMessages,
  answerSentence,
  buildUserMessage,
  parseAlignedPairs,
  parseBreakdownMarkup,
  parseTranslationWithPairs,
  stripBreakdownMarkup,
  BREAKDOWN_LEGEND,
  type AskMode,
} from "./asker";
import {
  cacheKey,
  getCachedTranslation,
  setCachedTranslation,
} from "./cache";
import { newConversationId, recordReadingConversation } from "./reading-log";
import { matchesKeybinding, parseKeybinding } from "./keybinding";

const IMMERSIVE_CLICK_MODE_KEY =
  "extensions.zotero-ai-sidebar.immersiveClickMode";
export type ImmersiveClickMode = "card" | "chooser";

// "card" (default): one tap → unified 翻译+解释 card. "chooser": tap → the
// [✦ 问 AI · 译] action bar (legacy behavior). Stored as a plain pref so the ⚙
// menu and the controller share one source of truth.
export function getImmersiveClickMode(prefs: PrefsStore): ImmersiveClickMode {
  return prefs.get(IMMERSIVE_CLICK_MODE_KEY) === "chooser" ? "chooser" : "card";
}
export function setImmersiveClickMode(
  prefs: PrefsStore,
  mode: ImmersiveClickMode,
): void {
  prefs.set(IMMERSIVE_CLICK_MODE_KEY, mode);
}

// Configurable next/prev-sentence shortcuts for immersive mode, stored as plain
// prefs (instant-apply, same pattern as the click mode above). Independent of
// the standalone "译" mode's nextSentenceKey/prevSentenceKey (those live in
// translateSettings and default to Enter/Shift+Enter). Default here is Alt+↑/↓.
const IMMERSIVE_NEXT_KEY_PREF =
  "extensions.zotero-ai-sidebar.immersiveNextSentenceKey";
const IMMERSIVE_PREV_KEY_PREF =
  "extensions.zotero-ai-sidebar.immersivePrevSentenceKey";
export const DEFAULT_IMMERSIVE_NEXT_KEY = "Enter";
export const DEFAULT_IMMERSIVE_PREV_KEY = "Shift+Enter";

export function getImmersiveNextSentenceKey(prefs: PrefsStore): string {
  const value = prefs.get(IMMERSIVE_NEXT_KEY_PREF);
  return typeof value === "string" && value ? value : DEFAULT_IMMERSIVE_NEXT_KEY;
}
export function getImmersivePrevSentenceKey(prefs: PrefsStore): string {
  const value = prefs.get(IMMERSIVE_PREV_KEY_PREF);
  return typeof value === "string" && value ? value : DEFAULT_IMMERSIVE_PREV_KEY;
}
export function setImmersiveNextSentenceKey(
  prefs: PrefsStore,
  value: string,
): void {
  prefs.set(IMMERSIVE_NEXT_KEY_PREF, value);
}
export function setImmersivePrevSentenceKey(
  prefs: PrefsStore,
  value: string,
): void {
  prefs.set(IMMERSIVE_PREV_KEY_PREF, value);
}

// "结合上下句翻译": send the prev + next sentence as context. Default for new
// cards. (整段「结合本段翻译」已移除——邻句上下文够用且更省。) The in-card
// 结合上下句 checkbox seeds from this.
const IMMERSIVE_NEIGHBOR_CONTEXT_PREF =
  "extensions.zotero-ai-sidebar.immersiveNeighborContext";
export function getImmersiveNeighborContext(prefs: PrefsStore): boolean {
  return prefs.get(IMMERSIVE_NEIGHBOR_CONTEXT_PREF) === "on";
}
export function setImmersiveNeighborContext(
  prefs: PrefsStore,
  on: boolean,
): void {
  prefs.set(IMMERSIVE_NEIGHBOR_CONTEXT_PREF, on ? "on" : "off");
}

// "重点词对应": when on, the read card's translation also returns a few key
// 原文↔译 word pairs and links them with a dotted hover highlight. Default off
// (the cheapest path returns translation only).
const IMMERSIVE_TERM_PAIRS_PREF =
  "extensions.zotero-ai-sidebar.immersiveTermPairs";
export function getImmersiveTermPairs(prefs: PrefsStore): boolean {
  return prefs.get(IMMERSIVE_TERM_PAIRS_PREF) === "on";
}
export function setImmersiveTermPairs(prefs: PrefsStore, on: boolean): void {
  prefs.set(IMMERSIVE_TERM_PAIRS_PREF, on ? "on" : "off");
}

// "快捷翻译键": with a PDF text selection active, this key translates the
// selected sentence in place (same card as a click). Default Space; configurable
// because Space is the reader's page-scroll key — we only hijack it WHEN there
// is a selection, so scrolling still works when nothing is selected.
const IMMERSIVE_QUICK_KEY_PREF =
  "extensions.zotero-ai-sidebar.immersiveQuickTranslateKey";
export const DEFAULT_IMMERSIVE_QUICK_KEY = "Space";
export function getImmersiveQuickTranslateKey(prefs: PrefsStore): string {
  const value = prefs.get(IMMERSIVE_QUICK_KEY_PREF);
  return typeof value === "string" && value
    ? value
    : DEFAULT_IMMERSIVE_QUICK_KEY;
}
export function setImmersiveQuickTranslateKey(
  prefs: PrefsStore,
  value: string,
): void {
  prefs.set(IMMERSIVE_QUICK_KEY_PREF, value);
}
import { cleanTranslationOutput, translateSentence } from "./translator";
import { loadTranslateSettings } from "./settings";
import type { ModelPreset } from "../settings/types";
import type { Message } from "../providers/types";
import { loadPresets, type PrefsStore } from "../settings/storage";

// Immersive reading mode ("沉浸"). Independent of TranslateModeController by
// design: it shares the lower-level reader/sentence/overlay modules but keeps
// its own controller so the standalone "译" quick-translate mode is never
// touched. Scope: single-click a sentence → highlight it + float a tiny action
// chooser ([✦ 问 AI] / [译]). The user then picks an action; clicking elsewhere
// or pressing Esc just clears the indication. No drag-select, no save, no cache.
//
// On top of that click→chooser→ask/translate flow, immersive mode adds a
// "reading guide": a single permanent soft highlight (`currentReading`) that
// marks the sentence the reader is on. It moves two ways:
//   1. Hover — moving the mouse over PDF text re-marks the sentence under the
//      cursor (rAF-throttled; only re-detects when the cursor leaves the marked
//      sentence's rects). Paused while a chooser/overlay is open so the soft
//      guide never fights the strong click-action highlight.
//   2. Keyboard — Alt+ArrowDown / Alt+ArrowUp step to the next/previous
//      sentence on the page and scroll it into view.
// The soft guide is purely a reading aid: it never calls a model. It is cleared
// on Esc / disable / reader switch.

interface ReaderLike {
  _internalReader?: {
    _primaryView?: { _iframeWindow?: Window };
    _secondaryView?: { _iframeWindow?: Window };
    _iframeWindow?: Window;
  };
  _iframeWindow?: Window;
}

export interface AskModeContext {
  prefs: PrefsStore;
  presets: ModelPreset[];
  reader: ReaderLike;
  // The host (main Zotero) window. The reading guide is hover-driven, so focus
  // is often outside the reader iframe when the user presses J/K — we bind the
  // key handler here too so those keys are caught regardless of focus.
  hostWindow?: Window;
  // Resolves the current Zotero item ID (the paper being read), so per-sentence
  // conversations are recorded under the right item for later summarization.
  getItemID?: () => number | null;
}

const ASK_OVERLAY_META: OverlayMeta = {
  lang: "就地问答",
  busyStatus: "● 思考中…",
  doneStatus: "● 已完成",
  errorStatus: "● 失败",
  busyKeyword: "解答",
};

const TRANSLATE_OVERLAY_META: OverlayMeta = {
  lang: "EN → 简体中文",
  busyStatus: "● 翻译中…",
  doneStatus: "● 已完成",
  errorStatus: "● 翻译失败",
  busyKeyword: "翻译",
};

export class AskModeController {
  private overlay: OverlayHandle | null = null;
  private chooser: SentenceChooserHandle | null = null;
  private modePopupGuard: { destroy(): void } | null = null;
  private current: DetectedSentence | null = null;
  private locator: PdfLocator | null = null;
  // Conversation history for the current in-place Q&A card (ask flow only).
  // Seeded on the first answer; appended on every follow-up. Reset whenever the
  // card is dismissed or a different sentence is picked, so each "问 AI" starts
  // a fresh thread.
  private askMessages: Message[] = [];
  // Id of the conversation currently shown in the card, so multi-turn updates
  // upsert the same recorded entry. Reset per new sentence in streamAsk.
  private currentConvId = 0;
  // First-turn shape for the next ask: "translateExplain" (unified card) or
  // "explain" (chooser's 问 AI). Set before each runFlow("ask").
  private askMode: AskMode = "explain";
  // The flow the open card is showing. "read" = translation-first default card
  // (原文 + 译, cached, with 追问 + 拆解). Recorded on every runFlow so a keyboard
  // sentence-step re-opens the SAME kind of card on the neighbouring sentence.
  private lastFlow: "read" | "ask" | "translate" = "read";
  // Separate abort for the lazy 拆解 stream so closing the card (or re-clicking
  // away) cancels an in-flight breakdown without touching the main translation.
  private breakdownAbort: AbortController | null = null;
  // In-card quick override: include the prev + next sentence as translation
  // context. Toggled by the card's 结合上下句 chip; session-scoped and INDEPENDENT
  // of the global 结合本段翻译 default (never writes a pref). Reset on disable.
  private cardNeighborContext = false;
  // Read-card view: false = 原文整段 + 译文整段; true = 逐句对照 (interleaved
  // 意群 lines). Session-scoped; reset on disable.
  private cardLineView = false;
  // 自适应宽度: widen the card to reduce orphan-word wraps. Session-scoped.
  private cardAutoWidth = false;
  private pointerDownHandler: ((ev: PointerEvent) => void) | null = null;
  private mouseDownHandler: ((ev: MouseEvent) => void) | null = null;
  private clickHandler: ((ev: MouseEvent) => void) | null = null;
  private mouseMoveHandler: ((ev: MouseEvent) => void) | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  // Shields the card's pointer/selection events from the reader so text inside
  // the card can be selected & copied (the reader preventDefaults selection
  // outside its text layer). Capture-phase, no preventDefault.
  private selectionShieldHandler: ((ev: Event) => void) | null = null;
  private keyWindows: Window[] = [];
  // Reading guide ("当前在读句"): a single soft highlight that follows hover /
  // keyboard. `reading` is the marked sentence; `readingHighlight` owns its DOM.
  private reading: DetectedSentence | null = null;
  private readingHighlight: ReadingHighlightHandle | null = null;
  // rAF handle + last pointer position for the throttled hover detection.
  private hoverFrame = 0;
  private hoverPoint: { x: number; y: number } | null = null;
  // True while a hover detect is awaiting. Single-flight: no new detect starts
  // until the current one finishes, so dragging the cursor across many sentences
  // can never pile up concurrent detectSentenceAtPoint() calls.
  private hoverBusy = false;
  // After a keyboard jump (J/K / Alt+↑↓), keyboard owns the mark: hover stays
  // suppressed while nav is active (within a short window of the last jump) AND
  // the cursor hasn't made a clearly deliberate move — so a parked/drifting
  // cursor over the previous sentence can't drag the mark back mid-step.
  private suppressUntil = 0;
  private suppressAnchor: { x: number; y: number } | null = null;
  private lastMousePos: { x: number; y: number } | null = null;
  // Bumped whenever the reading sentence is cleared/replaced so an in-flight
  // hover/jump detect can tell it was superseded and not resurrect a stale mark.
  private readingSeq = 0;
  private abortCtrl: AbortController | null = null;
  private boundWindow: Window | null = null;
  private pointerStart: { x: number; y: number } | null = null;
  private lastActivation: { at: number; x: number; y: number } | null = null;
  private active = false;
  // Bumped on every disable()/enable() so an enable() awaiting createPdfLocator()
  // can detect it was superseded (e.g. a rapid translate↔ask toggle) and bail
  // instead of binding stale handlers that can never be cleaned up.
  private enableSeq = 0;
  // Bumped on every activation/dismiss so a handleActivation() awaiting
  // detectSentenceAtPoint() can tell it was superseded (a newer click, or a
  // click-away / disable) and not resurrect a stale highlight/chooser.
  private activationSeq = 0;

  constructor(private ctx: AskModeContext) {}

  isForReader(reader: ReaderLike): boolean {
    return this.ctx.reader === reader;
  }

  isEnabled(): boolean {
    return this.active && this.boundWindow !== null;
  }

  refreshPresets(presets: ModelPreset[]): void {
    this.ctx.presets = presets;
  }

  async enable(): Promise<void> {
    const win = readerWindow(this.ctx.reader);
    if (!win) throw new Error("No active PDF Reader window is available.");
    if (
      this.boundWindow === win &&
      this.pointerDownHandler &&
      this.clickHandler &&
      this.mouseMoveHandler &&
      this.keyHandler
    )
      return;
    if (this.boundWindow) this.disable();
    const seq = ++this.enableSeq;
    // Capture the locator in a local so a concurrent enable()/disable() can't
    // make us clobber the winner's this.locator (which would leave handlers
    // bound but locator null → dead clicks).
    const locator = this.locator ?? (await createPdfLocator(this.ctx.reader));
    if (this.enableSeq !== seq) {
      // Superseded during the await — dispose only the locator we created here,
      // never the winner's, and bail without binding.
      if (locator !== this.locator) locator.dispose();
      return;
    }
    this.locator = locator;

    this.boundWindow = win;
    this.active = true;
    // Seed the in-card 结合上下句 state from its global default for this session.
    this.cardNeighborContext = getImmersiveNeighborContext(this.ctx.prefs);
    ensureModeStyle(win.document);
    win.document.body?.classList.add("zai-ask-mode-on");
    try {
      this.modePopupGuard = mountSelectionPopupGuard(win.document);
    } catch {
      /* best effort — never let enable() crash */
    }
    this.pointerDownHandler = (ev) => {
      this.rememberPointerStart(ev);
    };
    this.mouseDownHandler = (ev) => {
      if (!("PointerEvent" in win)) this.rememberPointerStart(ev);
    };
    this.clickHandler = (ev) => {
      if (ev.detail !== 1 || !this.isClickWithoutDrag(ev)) return;
      this.scheduleActivation(ev);
    };
    this.mouseMoveHandler = (ev) => {
      this.scheduleHover(ev);
    };
    this.keyHandler = (ev) => {
      this.handleKey(ev);
    };
    // Let native selection work inside the card: stop the reader's pointer /
    // selectstart handlers (which preventDefault outside the text layer) from
    // seeing card events — capture-phase, BEFORE the reader, and never call
    // preventDefault, so the browser's own selection proceeds.
    this.selectionShieldHandler = (ev) => {
      const target = ev.target as Node | null;
      if (
        closestElement(target, ".zai-translate-overlay,.zai-sentence-chooser")
      ) {
        ev.stopPropagation();
      }
    };
    win.addEventListener("pointerdown", this.pointerDownHandler, true);
    win.addEventListener("mousedown", this.mouseDownHandler, true);
    win.addEventListener("click", this.clickHandler, true);
    win.addEventListener("mousemove", this.mouseMoveHandler, true);
    for (const type of SELECTION_SHIELD_EVENTS) {
      win.addEventListener(type, this.selectionShieldHandler, true);
    }
    this.keyWindows = keyEventWindows(win);
    // keyEventWindows stops at the chrome boundary, so the host window is usually
    // absent. Bind it too: hover sets the reading mark without focusing the reader
    // iframe, so J/K keydowns frequently land on the host window instead.
    const host = this.ctx.hostWindow;
    if (host && !this.keyWindows.includes(host)) this.keyWindows.push(host);
    for (const keyWin of this.keyWindows) {
      keyWin.addEventListener("keydown", this.keyHandler, true);
    }
  }

  disable(): void {
    this.enableSeq++;
    this.active = false;
    if (this.boundWindow && this.pointerDownHandler) {
      this.boundWindow.removeEventListener("pointerdown", this.pointerDownHandler, true);
    }
    if (this.boundWindow && this.mouseDownHandler) {
      this.boundWindow.removeEventListener("mousedown", this.mouseDownHandler, true);
    }
    if (this.boundWindow && this.clickHandler) {
      this.boundWindow.removeEventListener("click", this.clickHandler, true);
    }
    if (this.boundWindow && this.mouseMoveHandler) {
      this.boundWindow.removeEventListener("mousemove", this.mouseMoveHandler, true);
    }
    if (this.boundWindow && this.selectionShieldHandler) {
      for (const type of SELECTION_SHIELD_EVENTS) {
        this.boundWindow.removeEventListener(
          type,
          this.selectionShieldHandler,
          true,
        );
      }
    }
    this.selectionShieldHandler = null;
    if (this.keyHandler) {
      for (const keyWin of this.keyWindows) {
        keyWin.removeEventListener("keydown", this.keyHandler, true);
      }
    }
    if (this.hoverFrame && this.boundWindow) {
      this.boundWindow.cancelAnimationFrame(this.hoverFrame);
    }
    this.hoverFrame = 0;
    this.hoverPoint = null;
    this.cardNeighborContext = false;
    this.cardLineView = false;
    this.cardAutoWidth = false;
    this.clearReading();
    this.boundWindow?.document.body?.classList.remove("zai-ask-mode-on");
    this.modePopupGuard?.destroy();
    this.modePopupGuard = null;
    this.boundWindow = null;
    this.pointerDownHandler = null;
    this.mouseDownHandler = null;
    this.clickHandler = null;
    this.mouseMoveHandler = null;
    this.keyHandler = null;
    this.keyWindows = [];
    this.pointerStart = null;
    this.lastActivation = null;
    this.dismissOverlay();
    this.locator?.dispose();
    this.locator = null;
  }

  private rememberPointerStart(ev: MouseEvent): void {
    this.pointerStart =
      ev.button === 0 ? { x: ev.clientX, y: ev.clientY } : null;
  }

  private isClickWithoutDrag(ev: MouseEvent): boolean {
    if (!this.pointerStart) return true;
    return distance(this.pointerStart, { x: ev.clientX, y: ev.clientY }) <= 6;
  }

  private scheduleActivation(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    const target = ev.target as Node | null;
    if (closestElement(target, ".zai-translate-overlay,.zai-sentence-chooser"))
      return;
    const win = this.boundWindow;
    if (!this.isEnabled() || !win || !this.locator) return;
    if (!win.document.body?.classList.contains("zai-ask-mode-on")) {
      this.disable();
      return;
    }
    if (!eventHitsPage(win, ev.clientX, ev.clientY, target)) {
      // Clicked outside any page (gutter / between pages / background) and not
      // on the chooser/overlay (excluded above) → treat as click-away and clear
      // the current indication.
      this.dismissOverlay();
      return;
    }
    if (this.isDuplicateActivation(ev)) return;

    const clientX = ev.clientX;
    const clientY = ev.clientY;
    void this.handleActivation(clientX, clientY);
  }

  private isDuplicateActivation(ev: MouseEvent): boolean {
    const now = Date.now();
    const last = this.lastActivation;
    if (
      last &&
      now - last.at < 250 &&
      distance(last, { x: ev.clientX, y: ev.clientY }) <= 6
    ) {
      return true;
    }
    this.lastActivation = { at: now, x: ev.clientX, y: ev.clientY };
    return false;
  }

  private async handleActivation(
    clientX: number,
    clientY: number,
  ): Promise<void> {
    if (!this.isEnabled() || !this.boundWindow || !this.locator) return;

    const token = ++this.activationSeq;
    let detected: DetectedSentence | null = null;
    try {
      detected = await detectSentenceAtPoint({
        iframeWindow: this.boundWindow as never,
        clientX,
        clientY,
        locator: this.locator,
      });
    } catch {
      if (this.activationSeq !== token) return; // superseded during detect
      // A detection error means we couldn't resolve a sentence here; treat it
      // like clicking empty space and clear any current indication.
      this.dismissOverlay();
      return;
    }
    if (this.activationSeq !== token) return; // a newer click / dismiss won
    if (!detected) {
      // Clicking off any sentence clears the current highlight/chooser/card.
      this.dismissOverlay();
      return;
    }

    this.current = detected;
    if (getImmersiveClickMode(this.ctx.prefs) === "chooser") {
      this.showChooser(detected);
    } else {
      // Default: one tap → translation-first card (原文 + 译, 最省). Explanation
      // is on-demand via 追问. Each new card re-syncs 结合上下句 to the global
      // default so the card toggle never disagrees with the settings checkbox.
      this.clearReading();
      this.cardNeighborContext = getImmersiveNeighborContext(this.ctx.prefs);
      void this.runFlow("read", detected);
    }
  }

  // --- Reading guide: hover follow ---------------------------------------

  // True while a chooser or in-place card is open. Hover follow pauses then so
  // the soft reading highlight never overlaps / fights the strong click-action
  // highlight; it resumes once the chooser/card is dismissed.
  private isFollowPaused(): boolean {
    return this.chooser !== null || this.overlay !== null;
  }

  private scheduleHover(ev: MouseEvent): void {
    this.lastMousePos = { x: ev.clientX, y: ev.clientY };
    if (!this.isEnabled() || !this.boundWindow) return;
    if (this.isFollowPaused()) return;
    if (this.isHoverSuppressed(ev.clientX, ev.clientY)) return;
    // Cheap fast-path: if the cursor is still inside the sentence we already
    // mark, do nothing — no detection, no rAF. sentenceAtPoint is heavy, so we
    // only re-detect once the cursor leaves the current sentence's rects.
    if (this.pointInsideReading(ev.clientX, ev.clientY)) return;
    this.hoverPoint = { x: ev.clientX, y: ev.clientY };
    this.queueHoverFrame();
  }

  // Hover is suppressed right after a keyboard jump so a parked/jiggling cursor
  // can't drag the mark back. Released by a clearly deliberate move (>40px from
  // where the jump happened) or once the short window passes.
  private isHoverSuppressed(x: number, y: number): boolean {
    if (!this.suppressAnchor) return false;
    const farEnough = distance(this.suppressAnchor, { x, y }) > 40;
    const expired = Date.now() >= this.suppressUntil;
    if (!farEnough && !expired) return true;
    this.suppressAnchor = null;
    return false;
  }

  // Schedule at most one detect: bail if a frame is already queued OR a detect
  // is in flight. The in-flight detect re-queues itself on completion if the
  // cursor has since moved to a new sentence (trailing run).
  private queueHoverFrame(): void {
    if (this.hoverFrame || this.hoverBusy) return;
    const win = this.boundWindow;
    if (!win) return;
    this.hoverFrame = win.requestAnimationFrame(() => {
      this.hoverFrame = 0;
      void this.runHoverDetect();
    });
  }

  // Is the client point within any rect of the currently-marked sentence?
  // Uses the live highlight DOM rects (already positioned over the sentence),
  // so this stays correct across zoom/scroll without re-deriving PDF geometry.
  private pointInsideReading(x: number, y: number): boolean {
    const elements = this.readingHighlight?.elements;
    if (!elements || elements.length === 0) return false;
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return true;
      }
    }
    return false;
  }

  private async runHoverDetect(): Promise<void> {
    if (this.hoverBusy) return;
    if (!this.isEnabled() || !this.boundWindow || !this.locator) return;
    if (this.isFollowPaused()) return;
    const point = this.hoverPoint;
    if (!point) return;
    // Keyboard jump just happened and the cursor hasn't deliberately moved → do
    // not let hover (re)assert the under-cursor sentence.
    if (this.isHoverSuppressed(point.x, point.y)) return;
    // Re-check inside-current after coalescing: several mousemoves may have
    // queued one frame; if the latest position is back inside, skip the work.
    if (this.pointInsideReading(point.x, point.y)) return;

    this.hoverBusy = true;
    const token = ++this.readingSeq;
    try {
      const detected = await detectSentenceAtPoint({
        iframeWindow: this.boundWindow as never,
        clientX: point.x,
        clientY: point.y,
        locator: this.locator,
      });
      if (this.readingSeq !== token) return; // superseded by a newer move/jump
      if (this.isFollowPaused()) return; // a chooser/card opened meanwhile
      if (this.isHoverSuppressed(point.x, point.y)) return; // keyboard took over
      if (!detected) return; // off any sentence (gutter / margin): keep prior mark
      if (this.reading && sameSentence(this.reading, detected)) return;
      this.setReading(detected);
    } catch {
      // hover detection failures are silent — keep the prior mark
    } finally {
      this.hoverBusy = false;
      // Trailing run ONLY when the cursor actually moved during the detect — never
      // just because the cursor sits in a gap of the current sentence (that caused
      // an endless re-detect loop that kept undoing keyboard jumps).
      const latest = this.hoverPoint;
      if (
        latest &&
        (latest.x !== point.x || latest.y !== point.y) &&
        this.isEnabled() &&
        !this.isFollowPaused() &&
        !this.isHoverSuppressed(latest.x, latest.y)
      ) {
        this.queueHoverFrame();
      }
    }
  }

  // Mount (or move) the soft reading highlight onto `detected`. Permanent until
  // cleared — that permanence is what makes Alt+↑/↓ sentence stepping work.
  private setReading(detected: DetectedSentence): void {
    if (!this.isEnabled() || !this.boundWindow) return;
    const pageEl = this.boundWindow.document.querySelector(
      `.page[data-page-number="${detected.pageIndex + 1}"]`,
    ) as HTMLElement | null;
    if (!pageEl) return;
    this.readingHighlight?.destroy();
    this.readingHighlight = mountReadingHighlight({
      iframeDoc: this.boundWindow.document,
      pageEl,
      rects: detected.rects,
      pageContent: detected.bundle,
    });
    this.reading = detected;
    this.focusReaderForKeys();
  }

  // Route J/K (and Alt+↑/↓) to the reader after a hover marks a sentence: hover
  // alone doesn't focus the reader iframe, so without this the keydown lands on
  // some other window and never reaches our handler. Never steal focus from a
  // text field the user is typing in (e.g. the sidebar composer).
  private focusReaderForKeys(): void {
    const win = this.boundWindow;
    if (!win) return;
    try {
      if (win.document?.hasFocus?.()) return; // reader already has focus
      const host = this.ctx.hostWindow;
      if (host && isEditableTarget(host.document?.activeElement ?? null)) return;
      if (isEditableTarget(win.document?.activeElement ?? null)) return;
      win.focus();
    } catch {
      /* best effort — focus is an enhancement, never let it crash hover */
    }
  }

  private clearReading(): void {
    this.readingSeq++;
    this.readingHighlight?.destroy();
    this.readingHighlight = null;
    this.reading = null;
    this.suppressAnchor = null;
    this.suppressUntil = 0;
  }

  // --- Reading guide: keyboard sentence stepping -------------------------

  // Alt+ArrowDown / Alt+ArrowUp step the reading mark to the next / previous
  // sentence on the current page and scroll it into view. Page-local, mirroring
  // TranslateModeController.jump: stays within pageSentenceCount, no cross-page
  // walk. Seeds from the first page-1 sentence if nothing is marked yet.
  private async jumpReading(delta: number): Promise<void> {
    if (!this.isEnabled() || !this.boundWindow || !this.locator) return;
    if (!this.locator.sentenceAtIndex) return;
    const current = this.reading;
    const pageIndex = current
      ? current.bundle.pageIndex
      : firstVisiblePageIndex(this.boundWindow);
    if (pageIndex == null) return;
    const count = current ? current.pageSentenceCount : Number.MAX_SAFE_INTEGER;
    let targetIndex = current ? current.pageSentenceIndex + delta : 0;

    // Keyboard owns the mark from the keypress onward: suppress hover up front so
    // a stray mousemove during the async lookup can't cancel or override the jump
    // (and can't snap it back afterward). A real mouse move re-engages hover.
    const token = ++this.readingSeq;
    this.suppressAnchor = this.lastMousePos;
    this.suppressUntil = Date.now() + 600;

    // Skip sentences that fail to locate (formula / citation runs sometimes
    // can't be resolved) so a single bad one doesn't make J/K look broken.
    for (
      let tries = 0;
      tries < 40 && targetIndex >= 0 && targetIndex < count;
      tries++, targetIndex += delta
    ) {
      const located = await this.locator.sentenceAtIndex(pageIndex, targetIndex);
      if (this.readingSeq !== token) return; // superseded by a newer move/jump
      if (!located) continue; // unlocatable sentence — skip to the next index
      const bundle =
        current && located.pageIndex === current.bundle.pageIndex
          ? current.bundle
          : await this.locator.getPageContent(located.pageIndex);
      if (this.readingSeq !== token) return;
      if (!bundle) continue;
      this.setReading({ ...located, bundle });
      this.scrollReadingIntoView();
      return;
    }
  }

  // Scroll the marked sentence into view if it sits outside the visible band.
  // Uses the live highlight DOM (already positioned), so no PDF→client math.
  private scrollReadingIntoView(): void {
    const el = this.readingHighlight?.elements[0];
    if (!el || typeof el.scrollIntoView !== "function") return;
    const win = el.ownerDocument?.defaultView;
    const rect = el.getBoundingClientRect();
    const viewH = win?.innerHeight || 0;
    if (viewH && rect.top >= 0 && rect.bottom <= viewH) return; // already visible
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      try {
        el.scrollIntoView();
      } catch {
        /* best effort */
      }
    }
  }

  // Step 1 of immersive reading: highlight the clicked sentence and float the
  // tiny [✦ 问 AI] / [译] action bar next to it. No model call happens yet — the
  // user explicitly picks an action, or clicks away / Esc to just dismiss.
  private showChooser(detected: DetectedSentence): void {
    if (!this.isEnabled() || !this.boundWindow) return;
    const pageEl = this.boundWindow.document.querySelector(
      `.page[data-page-number="${detected.pageIndex + 1}"]`,
    ) as HTMLElement | null;
    if (!pageEl) return;

    // A fresh click supersedes any prior indication/answer/translation. Also
    // drop the soft reading mark: the strong click highlight now owns this
    // sentence, so the two never overlap. Hover re-establishes the soft mark
    // once the chooser/card is dismissed.
    this.clearOverlay();
    this.clearChooser();
    this.clearReading();

    this.chooser = mountSentenceChooser({
      iframeDoc: this.boundWindow.document,
      pageEl,
      rects: detected.rects,
      pageContent: detected.bundle,
      actions: [
        {
          label: "✦ 问 AI",
          title: "向 AI 提问这句话",
          primary: true,
          onClick: () => {
            this.clearChooser();
            this.askMode = "explain";
            void this.runFlow("ask", detected);
          },
        },
        {
          label: "译",
          title: "翻译这句话",
          onClick: () => {
            this.clearChooser();
            void this.runFlow("translate", detected);
          },
        },
      ],
    });
  }

  private async runFlow(
    flow: "read" | "ask" | "translate",
    detected: DetectedSentence,
    forceRefresh = false,
  ): Promise<void> {
    // The chooser action may fire after a reader switch / disable; re-validate
    // and make sure this is still the active sentence before doing any work.
    if (!this.isEnabled() || this.current !== detected) return;
    this.lastFlow = flow;
    try {
      await this.renderForCurrent(flow, forceRefresh);
    } catch (err) {
      const label = flow === "ask" ? "解答失败" : "翻译失败";
      this.overlay?.setError(`${label}：${errorMessage(err)}`);
    }
  }

  // Non-neighbor immersive context. 结合本段翻译 was removed, so flows that don't
  // use the 结合上下句 neighbor context send only the clicked sentence.
  private immersiveCtxLevel(): "none" {
    return "none";
  }

  // Resolve the read card's translation context. The in-card 结合上下句 override
  // (prev + next sentence) wins when on; otherwise fall back to the global
  // 结合本段翻译 setting (paragraph) or just the sentence. The neighbour level
  // gets its own cache key ("neighbors") so it never collides with plain译文.
  private async resolveImmersiveContext(
    current: DetectedSentence,
  ): Promise<{ level: string; label?: string; text?: string }> {
    if (this.cardNeighborContext) {
      const text = await this.neighborContextText(current);
      if (text) return { level: "neighbors", label: "上下相邻句", text };
    }
    const level = this.immersiveCtxLevel();
    return {
      level,
      label: contextLabel(level),
      text: contextText(current, level),
    };
  }

  // Text of the sentence's immediate neighbours (prev + next) on the same page,
  // for the 结合上下句 context. Undefined at page edges / a single-sentence page.
  private async neighborContextText(
    current: DetectedSentence,
  ): Promise<string | undefined> {
    if (!this.locator?.sentenceAtIndex) return undefined;
    const page = current.bundle.pageIndex;
    const idx = current.pageSentenceIndex;
    if (idx < 0) return undefined; // free selection: no page-sentence neighbors
    const parts: string[] = [];
    const prev = await this.locator.sentenceAtIndex(page, idx - 1);
    if (prev?.text) parts.push(prev.text);
    const next = await this.locator.sentenceAtIndex(page, idx + 1);
    if (next?.text) parts.push(next.text);
    return parts.length ? parts.join(" ") : undefined;
  }

  // 结合上下句 checkbox toggled: update the session override and re-translate the
  // current sentence under the new context. Never touches the global pref.
  private async toggleNeighborContext(on: boolean): Promise<void> {
    this.cardNeighborContext = on;
    await this.retranslate(false);
  }

  // 逐句对照 toggled: switch the read card between block and interleaved views,
  // in place (no rebuild). Each view is cache-keyed separately.
  private async toggleLineView(on: boolean): Promise<void> {
    this.cardLineView = on;
    await this.retranslate(false);
  }

  // 自适应宽度 toggled: just resize/reposition the card — no re-translation.
  private toggleAutoWidth(on: boolean): void {
    this.cardAutoWidth = on;
    this.overlay?.setAutoWidth(on);
  }

  // Re-run the translation INTO the existing card (no rebuild) — toggling
  // 结合上下句 or pressing ↻ must not tear down / reflow the whole card. Only the
  // translation body is reset; position, 拆解 panel and the checkbox stay put.
  private async retranslate(forceRefresh: boolean): Promise<void> {
    const overlay = this.overlay;
    const current = this.current;
    if (!overlay || !current || this.lastFlow === "ask") return;
    const settings = loadTranslateSettings(this.ctx.prefs);
    this.ctx.presets = loadPresets(this.ctx.prefs);
    const preset = pickPreset(this.ctx.presets, settings.presetId);
    const model = settings.model || preset?.model || "";
    this.abortCtrl?.abort();
    this.abortCtrl = new AbortController();
    overlay.resetForRetranslate();
    // Badge-only loading state — keep the old译文 on screen so nothing blanks.
    overlay.setStatusLabel("● 翻译中…");
    if (!preset) {
      overlay.setError("请先在设置中配置一个账号。");
      return;
    }
    if (!model) {
      overlay.setError("请先为账号选择模型。");
      return;
    }
    try {
      await this.renderReadContent(
        current,
        overlay,
        settings,
        preset,
        model,
        forceRefresh,
        this.lastFlow === "read",
      );
    } catch (err) {
      if (this.overlay === overlay) {
        overlay.setError(`翻译失败：${errorMessage(err)}`);
      }
    }
    // ↻ also re-runs the 拆解 if its panel is open, so one redo covers both.
    if (forceRefresh && this.overlay === overlay) {
      overlay.redoBreakdownIfOpen();
    }
  }

  private handleKey(ev: KeyboardEvent): void {
    if (!this.isEnabled()) return;
    // Next/prev-sentence shortcut is user-configurable (default Alt+↑/↓), so it
    // can be remapped when the desktop/WM grabs Alt+Arrow (common on Linux) or
    // to match the user's habit. Fall back to the default binding if a stored
    // value fails to parse, so a typo can never leave stepping completely dead.
    const next =
      parseKeybinding(getImmersiveNextSentenceKey(this.ctx.prefs)) ??
      parseKeybinding(DEFAULT_IMMERSIVE_NEXT_KEY);
    const prev =
      parseKeybinding(getImmersivePrevSentenceKey(this.ctx.prefs)) ??
      parseKeybinding(DEFAULT_IMMERSIVE_PREV_KEY);
    if (next && matchesKeybinding(ev, next)) {
      this.onStepKey(ev, +1);
      return;
    }
    if (prev && matchesKeybinding(ev, prev)) {
      this.onStepKey(ev, -1);
      return;
    }
    // 快捷翻译键 (default Space): translate the current PDF selection in place.
    // Only consumes the key when there IS a selection — otherwise it falls
    // through so Space keeps scrolling the page and typed keys keep working.
    const quick = parseKeybinding(getImmersiveQuickTranslateKey(this.ctx.prefs));
    if (quick && matchesKeybinding(ev, quick)) {
      if (isEditableTarget(ev.target)) return; // typing in 追问 → don't hijack
      if (this.quickTranslateSelection(ev)) return;
      // No selection. If the quick key would otherwise "click" a focused button
      // (Space/Enter on a <button> — e.g. the 沉浸 toggle, which would switch the
      // mode off), swallow that activation. The reader text/body isn't a button,
      // so Space there still falls through to scroll the page as usual.
      if (isActivatableTarget(ev.target)) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        return;
      }
    }
    if (ev.key === "Escape") {
      if (!this.current && !this.chooser && !this.reading) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation?.();
      this.dismissOverlay();
      this.clearReading();
      // The reader keeps its own selection model (_selectionRanges), so closing
      // the card leaves the text selection in place — "Esc 恢复选区" needs no
      // explicit restore.
    }
  }

  // Quick-translate the CURRENT reader text selection, read live at key-press
  // time. Returns true if it consumed the key (a real selection exists); false
  // otherwise (so Space still scrolls). We translate the selection's exact text +
  // rects — no coordinate snapping (snapped to the wrong sentence) and no cache
  // (served a stale/previously-clicked sentence). A collapsed caret left by a
  // click is NOT a selection and is ignored upstream.
  private quickTranslateSelection(ev: KeyboardEvent): boolean {
    if (!this.locator) return false;
    const sel = this.resolveSelectionAnnotation();
    if (!sel) return false;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    const locator = this.locator;
    void (async () => {
      let detected: DetectedSentence | null = null;
      try {
        const bundle = await locator.getPageContent(sel.pageIndex);
        if (bundle) detected = buildSelectionSentence(sel, bundle);
      } catch {
        return;
      }
      if (!detected || !this.isEnabled()) return;
      this.clearReading();
      this.current = detected;
      this.cardNeighborContext = getImmersiveNeighborContext(this.ctx.prefs);
      void this.runFlow("read", detected);
    })();
    return true;
  }

  // TEMP diagnostic (Z9 selection investigation): dumps where the selection model
  // is at quick-key time. Routed to /tmp/zai_translate_debug.log.
  // The current selection's exact text + PDF rects + page. Requires both text and
  // rects so the card translates/highlights exactly what was selected.
  private resolveSelectionAnnotation(): {
    pageIndex: number;
    text: string;
    rects: number[][];
  } | null {
    // 1) Zotero 9's selection model: the active view's _selectionRanges (read
    // live at key-press; a collapsed click-caret is ignored upstream).
    const live = readerLiveSelectionAnnotation(this.ctx.reader);
    if (live) return live;
    // 2) The selection-popup state (fresh right after selecting), if it carries
    // non-empty text. No cache — always the CURRENT selection, never a previous one.
    const popup = readerSelectionPopupPoint(this.ctx.reader);
    if (popup?.text && popup.rects.length) {
      return { pageIndex: popup.pageIndex, text: popup.text, rects: popup.rects };
    }
    return null;
  }

  // A configured next/prev-sentence key fired. Behavior is contextual:
  //  - A card is open  → advance the card to the neighbouring sentence and
  //    re-run the same flow (continuous AI reading). This must work even when
  //    the overlay composer has focus, since it's auto-focused after each
  //    answer — so the editable-target skip applies only when there's no card
  //    to advance (e.g. focus parked in the sidebar composer).
  //  - A chooser is open → leave it alone (a transient pick; Esc/click dismiss).
  //  - Otherwise → move the soft reading guide (no model call).
  private onStepKey(ev: KeyboardEvent, delta: number): void {
    if (this.chooser) return;
    // Yield to text inputs (the 追问 composer) WITHOUT consuming, so Enter there
    // submits the follow-up. Stepping happens when focus is on the reader / card.
    if (isEditableTarget(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    void this.stepSentence(delta);
  }

  private async stepSentence(delta: number): Promise<void> {
    if (!this.isEnabled() || !this.boundWindow || !this.locator) return;
    if (!this.locator.sentenceAtIndex) return;

    // Card open → walk the card itself to the next sentence and re-open the same
    // kind of card there (continuous reading). renderForCurrent scrolls the new
    // sentence into view, so this keeps working past the fold within a page.
    if (this.overlay && this.current) {
      const token = ++this.activationSeq;
      const neighbor = await this.neighborSentence(this.current, delta);
      if (this.activationSeq !== token) return; // a click / dismiss superseded us
      if (!neighbor) return; // page edge (page-local) — keep the current card
      this.current = neighbor;
      await this.runFlow(this.lastFlow, neighbor);
      return;
    }

    // No card open → just move the soft reading guide.
    await this.jumpReading(delta);
  }

  // Find the next locatable sentence on the same page, `delta` steps from
  // `from`. Skips sentences that fail to locate (formula / citation runs) so one
  // bad sentence doesn't stall stepping. Page-local, mirroring jumpReading.
  private async neighborSentence(
    from: DetectedSentence,
    delta: number,
  ): Promise<DetectedSentence | null> {
    if (!this.locator?.sentenceAtIndex) return null;
    const pageIndex = from.bundle.pageIndex;
    const count = from.pageSentenceCount;
    let targetIndex = from.pageSentenceIndex + delta;
    for (
      let tries = 0;
      tries < 40 && targetIndex >= 0 && targetIndex < count;
      tries++, targetIndex += delta
    ) {
      const located = await this.locator.sentenceAtIndex(pageIndex, targetIndex);
      if (!located) continue;
      const bundle =
        located.pageIndex === from.bundle.pageIndex
          ? from.bundle
          : await this.locator.getPageContent(located.pageIndex);
      if (!bundle) continue;
      return { ...located, bundle };
    }
    return null;
  }

  private async renderForCurrent(
    flow: "read" | "ask" | "translate",
    forceRefresh = false,
  ): Promise<void> {
    const current = this.current;
    if (!this.isEnabled() || !current || !this.boundWindow) return;
    const settings = loadTranslateSettings(this.ctx.prefs);
    this.ctx.presets = loadPresets(this.ctx.prefs);
    const preset = pickPreset(this.ctx.presets, settings.presetId);

    const pageEl = this.boundWindow.document.querySelector(
      `.page[data-page-number="${current.pageIndex + 1}"]`,
    ) as HTMLElement | null;
    if (!pageEl) return;

    this.clearOverlay();
    this.abortCtrl = new AbortController();

    const model = settings.model || preset?.model || "";
    const stepHint = `${displayImmersiveKey(
      getImmersivePrevSentenceKey(this.ctx.prefs),
    )} / ${displayImmersiveKey(
      getImmersiveNextSentenceKey(this.ctx.prefs),
    )} 上/下一句`;
    // "read" and the chooser's "译" both translate; only "ask" explains.
    const isAsk = flow === "ask";
    const isRead = flow === "read";
    let overlay: OverlayHandle | null = null;
    overlay = mountOverlay({
      iframeDoc: this.boundWindow.document,
      pageEl,
      rects: current.rects,
      pageContent: current.bundle,
      position: settings.overlayPosition,
      size: settings.overlaySize,
      meta: isAsk ? ASK_OVERLAY_META : TRANSLATE_OVERLAY_META,
      actions: {
        onClose: () => this.dismissOverlay(),
        // ↻ re-translate (ignore cache) in place — mirrors the 译 overlay but
        // without rebuilding the card.
        onRetry: isAsk ? undefined : () => void this.retranslate(true),
        hint: `${stepHint} · Esc 关闭`,
      },
      // "read" uses the ask DOM (transcript + composer) so 追问 lives in the same
      // card; the chooser's plain "译" keeps the minimal translate variant.
      variant: flow === "translate" ? "translate" : "ask",
      // 原文 row: shown locally in the read card (0 token), above the translation.
      sourceText: isRead ? current.text : undefined,
      // 拆解长句 暂时取消（功能保留在 requestBreakdown，仅不渲染按钮）。
      breakdown: undefined,
      composer:
        flow === "translate"
          ? undefined
          : {
              placeholder: isRead ? "追问（让 AI 解释 / 举例…）" : "追问…",
              onSubmit: (text) => void this.submitFollowup(text),
            },
      // 结合上下句 quick toggle (read card only): per-session, re-translates on
      // change, and never changes the global 结合本段翻译 default.
      contextToggle: isRead
        ? {
            label: "结合上下句",
            checked: this.cardNeighborContext,
            onToggle: (on) => void this.toggleNeighborContext(on),
          }
        : undefined,
      // 逐句对照 view toggle (read card only): block ⇄ interleaved 意群 lines.
      lineViewToggle: isRead
        ? {
            label: "逐句对照",
            checked: this.cardLineView,
            onToggle: (on) => void this.toggleLineView(on),
          }
        : undefined,
      // 自适应宽度 toggle (read card only): widen the card to reduce orphan wraps.
      autoWidth: isRead ? this.cardAutoWidth : undefined,
      autoWidthToggle: isRead
        ? {
            label: "自适应宽度",
            checked: this.cardAutoWidth,
            onToggle: (on) => this.toggleAutoWidth(on),
          }
        : undefined,
    });
    this.overlay = overlay;
    // Keep the stepped-to sentence visible when advancing past the fold via the
    // keyboard. No-op when the sentence is already fully on screen (e.g. on the
    // initial click), so it never yanks the view unexpectedly.
    overlay.scrollSentenceIntoView();
    overlay.setStatus(isAsk ? "正在解答…" : "正在翻译…");

    if (!preset) {
      overlay.setError("请先在设置中配置一个账号。");
      return;
    }
    if (!model) {
      overlay.setError("请先为账号选择模型。");
      return;
    }

    if (isAsk) {
      await this.streamAsk(current, overlay, settings, preset, model);
    } else {
      // NOTE: do NOT auto-focus the 追问 composer here — keeping focus off it lets
      // Enter / Shift+Enter step sentences. Click the composer to type a follow-up
      // (Enter there submits, because onStepKey yields to editable targets).
      await this.renderReadContent(
        current,
        overlay,
        settings,
        preset,
        model,
        forceRefresh,
        isRead,
      );
    }
  }

  // Render the read/translate card's main content into `overlay`, picking the
  // view: 逐句对照 (interleaved) when on; else term-pairs (重点词对应) or plain
  // 译文. Shared by the initial render, ↻, and the view/context toggles.
  private async renderReadContent(
    current: DetectedSentence,
    overlay: OverlayHandle,
    settings: ReturnType<typeof loadTranslateSettings>,
    preset: ModelPreset,
    model: string,
    forceRefresh: boolean,
    isRead: boolean,
  ): Promise<void> {
    if (isRead && this.cardLineView) {
      overlay.setSourceVisible(false);
      await this.streamInterleaved(
        current,
        overlay,
        settings,
        preset,
        model,
        forceRefresh,
      );
      return;
    }
    overlay.setSourceVisible(true);
    if (isRead && getImmersiveTermPairs(this.ctx.prefs)) {
      await this.streamTranslationWithPairs(
        current,
        overlay,
        settings,
        preset,
        model,
        forceRefresh,
      );
    } else {
      await this.streamCachedTranslation(
        current,
        overlay,
        settings,
        preset,
        model,
        forceRefresh,
      );
    }
  }

  private async streamAsk(
    current: DetectedSentence,
    overlay: OverlayHandle,
    settings: ReturnType<typeof loadTranslateSettings>,
    preset: ModelPreset,
    model: string,
  ): Promise<void> {
    if (!this.abortCtrl) return;
    // Each sentence starts its OWN scoped conversation (only this sentence as
    // context) — keeps follow-ups cheap and independent per card. Context level
    // follows the immersive "结合本段翻译" toggle, not the "译" mode ctxLevel.
    const level = this.immersiveCtxLevel();
    this.askMessages = [
      {
        role: "user",
        content: buildUserMessage({
          sentence: current.text,
          contextLabel: contextLabel(level),
          contextText: contextText(current, level),
          preset,
          model,
          thinking: settings.thinking,
          signal: this.abortCtrl.signal,
          mode: this.askMode,
        }),
      },
    ];
    this.currentConvId = newConversationId();
    await this.runAskTurn(overlay, settings, preset, model);
    if (this.overlay === overlay) overlay.focusComposer();
  }

  // Stream one assistant turn from the running askMessages history into the
  // overlay's active body; append the reply to the history on completion so
  // follow-ups in this card keep context.
  private async runAskTurn(
    overlay: OverlayHandle,
    settings: ReturnType<typeof loadTranslateSettings>,
    preset: ModelPreset,
    model: string,
  ): Promise<void> {
    // Pin THIS turn's controller. A newer turn (or closing the card) replaces
    // this.abortCtrl and aborts the old one, so we can detect supersession and
    // stop appending — two concurrent streams must never write the same body.
    const ctrl = this.abortCtrl;
    if (!ctrl) return;
    let buffer = "";
    const superseded = () => this.overlay !== overlay || this.abortCtrl !== ctrl;
    try {
      for await (const chunk of answerMessages({
        messages: this.askMessages,
        preset,
        model,
        thinking: settings.thinking,
        signal: ctrl.signal,
      })) {
        if (superseded()) return;
        if (chunk.type === "text" && chunk.text) {
          overlay.appendText(chunk.text);
          buffer += chunk.text;
        } else if (chunk.type === "error" && chunk.message) {
          overlay.setError(chunk.message);
        } else if (chunk.type === "done") {
          if (buffer) {
            overlay.setDone();
            this.askMessages.push({ role: "assistant", content: buffer });
            recordReadingConversation(
              this.ctx.getItemID?.() ?? null,
              this.currentConvId,
              this.current?.text ?? "",
              [...this.askMessages],
              Date.now(),
            );
          } else {
            overlay.setError("模型没有返回内容。");
          }
        }
      }
    } catch (err) {
      // Abort / supersession is expected when a newer turn starts — stay silent
      // so it never overwrites the new turn's body with an error.
      if (ctrl.signal.aborted || superseded()) return;
      if (this.overlay === overlay) overlay.setError(errorMessage(err));
    }
  }

  // A follow-up typed into this card's composer. Adds the question + a fresh
  // assistant turn, preserving only THIS card's conversation context. Works both
  // from an ask card (history already seeded) and from the read card (no prior
  // turn — we seed the first message with the sentence so 解 is on-demand here).
  private async submitFollowup(text: string): Promise<void> {
    const question = text.trim();
    const overlay = this.overlay;
    const current = this.current;
    if (!question || !overlay || !current) return;
    const settings = loadTranslateSettings(this.ctx.prefs);
    this.ctx.presets = loadPresets(this.ctx.prefs);
    const preset = pickPreset(this.ctx.presets, settings.presetId);
    const model = settings.model || preset?.model || "";
    if (!preset || !model) {
      overlay.setError("请先在设置中配置账号与模型。");
      return;
    }
    // Stop any in-flight turn (a still-streaming translation or a prior answer)
    // before starting this one, so their chunks can't interleave in the card.
    this.abortCtrl?.abort();
    overlay.appendUserTurn(question);
    overlay.beginAssistantTurn();
    overlay.setStatus("正在解答…");
    if (this.askMessages.length === 0) {
      // First question on a translation-first card: embed the sentence (and the
      // paragraph if 结合本段翻译 is on) so the model has something to reason about.
      const level = this.immersiveCtxLevel();
      const ctxText = contextText(current, level);
      const ctx = ctxText
        ? `\n${contextLabel(level) || "同段参考"}：${ctxText.slice(0, 800)}`
        : "";
      this.askMessages = [
        {
          role: "user",
          content: `请基于这句英文回答我的问题（简体中文，简洁具体）。\n这句话：${current.text}${ctx}\n\n我的问题：${question}`,
        },
      ];
      this.currentConvId = newConversationId();
    } else {
      this.askMessages.push({ role: "user", content: question });
    }
    this.abortCtrl = new AbortController();
    await this.runAskTurn(overlay, settings, preset, model);
  }

  // Translation for the read card (and the chooser's "译"). Reuses the shared
  // translation cache so re-clicking / stepping back to a sentence is free, and
  // sends only the sentence unless 结合本段翻译 is on (最省 by default).
  private async streamCachedTranslation(
    current: DetectedSentence,
    overlay: OverlayHandle,
    settings: ReturnType<typeof loadTranslateSettings>,
    preset: ModelPreset,
    model: string,
    forceRefresh = false,
  ): Promise<void> {
    const ctrl = this.abortCtrl;
    if (!ctrl) return;
    const ctx = await this.resolveImmersiveContext(current);
    if (this.overlay !== overlay || this.abortCtrl !== ctrl) return;
    const key = cacheKey({
      sentence: current.text,
      target: "zh",
      endpoint: preset.baseUrl,
      model,
      thinking: settings.thinking,
      ctxLevel: ctx.level,
    });
    const cached = forceRefresh ? undefined : await getCachedTranslation(key);
    if (this.overlay !== overlay || this.abortCtrl !== ctrl) return;
    if (cached) {
      overlay.setText(cleanTranslationOutput(cached.text));
      overlay.setStatusLabel("● 已完成 · 缓存");
      return;
    }
    let buffer = "";
    let usageLabel = "";
    const superseded = () => this.overlay !== overlay || this.abortCtrl !== ctrl;
    try {
      for await (const chunk of translateSentence({
        sentence: current.text,
        contextLabel: ctx.label,
        contextText: ctx.text,
        preset,
        model,
        thinking: settings.thinking,
        signal: ctrl.signal,
      })) {
        if (superseded()) return;
        if (chunk.type === "text" && chunk.text) {
          buffer += cleanTranslationOutput(chunk.text);
          // Replace with the accumulated text (not append): on a re-translate the
          // first chunk overwrites the old译文 in place — no blank, no flicker.
          overlay.setBodyStreaming(buffer);
        } else if (chunk.type === "error" && chunk.message) {
          overlay.setError(chunk.message);
        } else if (chunk.type === "usage") {
          usageLabel = formatTokenLabel(chunk.input, chunk.output, chunk.cacheRead);
        } else if (chunk.type === "done") {
          if (buffer) {
            overlay.setDone();
            // Translation token cost → top-right status badge.
            if (usageLabel) overlay.setStatusLabel(`● 已完成 · ${usageLabel}`);
            void setCachedTranslation(key, {
              text: buffer,
              model,
              createdAt: Date.now(),
            });
          } else {
            overlay.setError("模型没有返回译文。");
          }
        }
      }
    } catch (err) {
      // A follow-up (or card close) aborts the in-flight translation — stay
      // silent rather than replacing the partial译文 with an error.
      if (ctrl.signal.aborted || superseded()) return;
      if (this.overlay === overlay) overlay.setError(errorMessage(err));
    }
  }

  // Translation + 重点词对应 (重点词对应 toggle on). Same single request as the
  // plain path but the prompt also returns a parseable 词对 line; the translation
  // streams live, and on completion the 原文 row and 译文 get linked hover spans.
  // Cached under a separate `pairs` kind so it never collides with plain译文.
  private async streamTranslationWithPairs(
    current: DetectedSentence,
    overlay: OverlayHandle,
    settings: ReturnType<typeof loadTranslateSettings>,
    preset: ModelPreset,
    model: string,
    forceRefresh = false,
  ): Promise<void> {
    const ctrl = this.abortCtrl;
    if (!ctrl) return;
    const ctx = await this.resolveImmersiveContext(current);
    if (this.overlay !== overlay || this.abortCtrl !== ctrl) return;
    const key = cacheKey({
      sentence: current.text,
      target: "zh",
      endpoint: preset.baseUrl,
      model,
      thinking: settings.thinking,
      ctxLevel: ctx.level,
      kind: "pairs",
    });
    const apply = (raw: string) => {
      const parsed = parseTranslationWithPairs(raw);
      if (parsed.pairs.length) {
        overlay.decorateTerms(current.text, parsed.translation, parsed.pairs);
      } else {
        overlay.setText(parsed.translation);
      }
    };
    const cached = forceRefresh ? undefined : await getCachedTranslation(key);
    if (this.overlay !== overlay || this.abortCtrl !== ctrl) return;
    if (cached) {
      apply(cached.text);
      overlay.setStatusLabel("● 已完成 · 缓存");
      return;
    }
    let buffer = "";
    let usageLabel = "";
    const superseded = () => this.overlay !== overlay || this.abortCtrl !== ctrl;
    try {
      for await (const chunk of answerSentence({
        sentence: current.text,
        contextLabel: ctx.label,
        contextText: ctx.text,
        preset,
        model,
        thinking: settings.thinking,
        signal: ctrl.signal,
        mode: "translatePairs",
      })) {
        if (superseded()) return;
        if (chunk.type === "text" && chunk.text) {
          buffer += chunk.text;
          // Show the translation portion live; hide the trailing 词对 block until
          // it's parsed into hover spans on completion.
          overlay.setBodyStreaming(parseTranslationWithPairs(buffer).translation);
        } else if (chunk.type === "error" && chunk.message) {
          overlay.setError(chunk.message);
        } else if (chunk.type === "usage") {
          usageLabel = formatTokenLabel(chunk.input, chunk.output, chunk.cacheRead);
        } else if (chunk.type === "done") {
          if (buffer.trim()) {
            apply(buffer);
            if (usageLabel) overlay.setStatusLabel(`● 已完成 · ${usageLabel}`);
            void setCachedTranslation(key, {
              text: buffer,
              model,
              createdAt: Date.now(),
            });
          } else {
            overlay.setError("模型没有返回译文。");
          }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted || superseded()) return;
      if (this.overlay === overlay) overlay.setError(errorMessage(err));
    }
  }

  // 逐句对照 view: the model returns 意群-aligned "英文 ||| 中文" lines, rendered as
  // alternating rows. Cached under its own "align" kind. The old block译文 stays
  // visible as a placeholder until the parsed result replaces it (no blank).
  private async streamInterleaved(
    current: DetectedSentence,
    overlay: OverlayHandle,
    settings: ReturnType<typeof loadTranslateSettings>,
    preset: ModelPreset,
    model: string,
    forceRefresh = false,
  ): Promise<void> {
    const ctrl = this.abortCtrl;
    if (!ctrl) return;
    // When 重点词对应 is on, ask align to also emit a 词对 line and color the
    // matching key terms in each cell. Cache separately so the two outputs
    // (with / without 词对) don't collide.
    const wantTerms = getImmersiveTermPairs(this.ctx.prefs);
    const ctx = await this.resolveImmersiveContext(current);
    if (this.overlay !== overlay || this.abortCtrl !== ctrl) return;
    const key = cacheKey({
      sentence: current.text,
      target: "zh",
      endpoint: preset.baseUrl,
      model,
      thinking: settings.thinking,
      ctxLevel: ctx.level,
      // Bumped on each chunking-rule change so older cached results aren't
      // reused. align4 = target-sentence only (context is reference, never
      // translated), split into 2~5 clause-level segments.
      kind: wantTerms ? "align4-t" : "align4",
    });
    const apply = (raw: string) => {
      overlay.setInterleaved(
        parseAlignedPairs(raw),
        wantTerms ? parseTranslationWithPairs(raw).pairs : undefined,
      );
    };
    const cached = forceRefresh ? undefined : await getCachedTranslation(key);
    if (this.overlay !== overlay || this.abortCtrl !== ctrl) return;
    if (cached) {
      apply(cached.text);
      overlay.setStatusLabel("● 已完成 · 缓存");
      return;
    }
    let buffer = "";
    let usageLabel = "";
    const superseded = () => this.overlay !== overlay || this.abortCtrl !== ctrl;
    try {
      for await (const chunk of answerSentence({
        sentence: current.text,
        contextLabel: ctx.label,
        contextText: ctx.text,
        preset,
        model,
        thinking: settings.thinking,
        signal: ctrl.signal,
        mode: "align",
        withTerms: wantTerms,
      })) {
        if (superseded()) return;
        if (chunk.type === "text" && chunk.text) {
          buffer += chunk.text;
        } else if (chunk.type === "error" && chunk.message) {
          overlay.setError(chunk.message);
        } else if (chunk.type === "usage") {
          usageLabel = formatTokenLabel(chunk.input, chunk.output, chunk.cacheRead);
        } else if (chunk.type === "done") {
          if (parseAlignedPairs(buffer).length) {
            apply(buffer);
            if (usageLabel) overlay.setStatusLabel(`● 已完成 · ${usageLabel}`);
            void setCachedTranslation(key, {
              text: buffer,
              model,
              createdAt: Date.now(),
            });
          } else {
            overlay.setError("模型没有返回对照。");
          }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted || superseded()) return;
      if (this.overlay === overlay) overlay.setError(errorMessage(err));
    }
  }

  // Lazy 拆解长句: only runs when the user opens the chip. The model emits inline
  // markup ([主:en|中文] …); we stream a stripped plain preview, then render the
  // structured (ruby + 主语 + 〔定语〕) view on completion. Cached per sentence.
  private async requestBreakdown(
    current: DetectedSentence,
    overlay: OverlayHandle,
    settings: ReturnType<typeof loadTranslateSettings>,
    preset: ModelPreset,
    model: string,
    forceRefresh = false,
  ): Promise<void> {
    if (this.overlay !== overlay) return;
    const level = this.immersiveCtxLevel();
    const key = cacheKey({
      sentence: current.text,
      target: "zh",
      endpoint: preset.baseUrl,
      model,
      thinking: settings.thinking,
      ctxLevel: level,
      // Bumped on each breakdown-format change: "breakdown3" = 谓语/状语 tags.
      kind: "breakdown3",
    });
    // A plain open reuses the cache (no re-request); ↻ passes force=true.
    if (!forceRefresh) {
      const cached = await getCachedTranslation(key);
      if (this.overlay !== overlay) return;
      if (cached) {
        overlay.setBreakdownStructured(
          parseBreakdownMarkup(cached.text),
          BREAKDOWN_LEGEND,
          "缓存",
        );
        return;
      }
    }
    overlay.setBreakdownStatus("拆解中…");
    this.breakdownAbort?.abort();
    this.breakdownAbort = new AbortController();
    let buffer = "";
    let usageLabel = "";
    try {
      for await (const chunk of answerSentence({
        sentence: current.text,
        contextLabel: contextLabel(level),
        contextText: contextText(current, level),
        preset,
        model,
        thinking: settings.thinking,
        signal: this.breakdownAbort.signal,
        mode: "breakdown",
      })) {
        if (this.overlay !== overlay) return;
        if (chunk.type === "text" && chunk.text) {
          buffer += chunk.text;
          // Live preview: show stripped English while the markup streams in.
          overlay.setBreakdown(stripBreakdownMarkup(buffer));
        } else if (chunk.type === "error" && chunk.message) {
          overlay.setBreakdownError(chunk.message);
        } else if (chunk.type === "usage") {
          usageLabel = formatTokenLabel(chunk.input, chunk.output, chunk.cacheRead);
        } else if (chunk.type === "done") {
          if (buffer.trim()) {
            // 拆解 token cost → bottom-right of the breakdown panel.
            overlay.setBreakdownStructured(
              parseBreakdownMarkup(buffer),
              BREAKDOWN_LEGEND,
              usageLabel,
            );
            void setCachedTranslation(key, {
              text: buffer,
              model,
              createdAt: Date.now(),
            });
          } else {
            overlay.setBreakdownError("模型没有返回拆解。");
          }
        }
      }
    } catch (err) {
      if (this.overlay === overlay) overlay.setBreakdownError(errorMessage(err));
    }
  }

  private clearOverlay(): void {
    this.abortCtrl?.abort();
    this.abortCtrl = null;
    this.breakdownAbort?.abort();
    this.breakdownAbort = null;
    this.overlay?.destroy();
    this.overlay = null;
  }

  private clearChooser(): void {
    this.chooser?.destroy();
    this.chooser = null;
  }

  private dismissOverlay(): void {
    // Invalidate any in-flight handleActivation so a late detect can't
    // resurrect what we're clearing.
    this.activationSeq++;
    this.clearOverlay();
    this.clearChooser();
    this.current = null;
  }
}

function keyEventWindows(win: Window): Window[] {
  const out: Window[] = [];
  let current: Window | null = win;
  for (let i = 0; i < 4 && current; i++) {
    if (!out.includes(current)) out.push(current);
    let parent: Window | null = null;
    try {
      parent = current.parent;
      if (!parent || parent === current) break;
      void parent.document;
    } catch {
      break;
    }
    current = parent;
  }
  return out;
}

// True when the keydown originates from a text-entry control, so the reading
// guide must not swallow Alt+↑/↓ (the user is typing, not navigating sentences).
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as
    | (Element & { isContentEditable?: boolean; tagName?: string })
    | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// True when Space/Enter on the target would "activate" it (fire a click) —
// buttons, links, and ARIA button/link/checkbox roles. Used to stop the quick-
// translate key (default Space) from toggling the focused 沉浸 button off when
// there's no selection to translate.
function isActivatableTarget(target: EventTarget | null): boolean {
  const el = target as (Element & { tagName?: string }) | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
  const role = el.getAttribute?.("role");
  return role === "button" || role === "link" || role === "checkbox";
}

// --- Reader selection model access ---------------------------------------
// Zotero's reader is the source of truth for the current text selection
// (view._selectionRanges), and survives after the transient DOM Selection is
// cleared. These mirror src/modules/pdf-navigation + reader-access but are
// inlined to keep the translate layer decoupled from the sidebar modules; they
// match the reader-internal access ask-mode already does via readerWindow().
function readerSelectionViews(reader: unknown): unknown[] {
  const r = reader as Record<string, any>;
  const internal = r?._internalReader ?? r;
  // _lastView is the active view getter in Zotero 9; the live selection lives
  // there, so try it first, then the explicit primary/secondary views.
  const activeView =
    internal?._lastView ??
    (internal?._lastViewPrimary === false
      ? internal?._secondaryView
      : internal?._primaryView);
  const views = [
    activeView,
    internal?._primaryView,
    internal?._secondaryView,
    r?._primaryView,
    r?._secondaryView,
    r?._view,
  ].filter(Boolean);
  return views.filter((view, index) => views.indexOf(view) === index);
}

// Zotero 9's persistent selection model: view._selectionRanges. Each non-collapsed
// range carries text + position.rects (PDF/viewBox coords). Zotero's own copy /
// drag / read-aloud treat this as the source of truth, and it persists as long as
// the reader selection is active (unlike the transient *ViewSelectionPopup state).
function readerLiveSelectionAnnotation(reader: unknown): {
  pageIndex: number;
  text: string;
  rects: number[][];
} | null {
  for (const view of readerSelectionViews(reader)) {
    const v = view as {
      _selectionRanges?: unknown;
      _getAnnotationFromSelectionRanges?: (
        ranges: unknown,
        type: string,
      ) => unknown;
    };
    const ranges = v?._selectionRanges;
    if (!Array.isArray(ranges) || !ranges.length) continue;
    // A real drag-selection has a NON-collapsed range (anchorOffset != headOffset).
    // A bare collapsed caret is what a single click leaves behind — ignore it, or
    // 选区快捷翻译 would translate the previously-clicked sentence.
    const hasSelection = ranges.some((r) => {
      const range = r as {
        collapsed?: boolean;
        anchorOffset?: unknown;
        headOffset?: unknown;
      };
      if (!range || range.collapsed) return false;
      const a = finiteNum(range.anchorOffset);
      const h = finiteNum(range.headOffset);
      return a == null || h == null || a !== h;
    });
    if (!hasSelection) continue;
    // The range's own .text / .position.rects are usually empty; Zotero rebuilds
    // them from page chars via this helper (the same one it uses to make the
    // highlight annotation). Returns { text, position: { pageIndex, rects } }.
    type SelAnn = {
      text?: unknown;
      position?: { pageIndex?: unknown; rects?: unknown };
    };
    let ann: SelAnn | null = null;
    try {
      const fn = v._getAnnotationFromSelectionRanges;
      if (typeof fn === "function") {
        ann = fn.call(v, ranges, "highlight") as SelAnn;
      }
    } catch {
      ann = null;
    }
    const text = typeof ann?.text === "string" ? ann.text.trim() : "";
    const pageIndex = finiteNum(ann?.position?.pageIndex) ?? -1;
    const rects = parsePdfRects(ann?.position?.rects);
    if (text && pageIndex >= 0 && rects.length) {
      return { pageIndex, text, rects };
    }
  }
  return null;
}

function finiteNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The reliable Zotero 9 text-selection source: the reader stores the selection
// popup params (annotation.text + position.rects in PDF/viewBox coords) in
// _internalReader._state.{primary,secondary}ViewSelectionPopup the moment a
// selection is made — independent of whether the React popup actually renders
// (the renderTextSelectionPopup event is gated by !readOnly and only fires on
// render, so it can never arrive). Mirrors zotero/reader src/common/reader.js
// (_state.*ViewSelectionPopup) and src/pdf/selection.js (position.rects).
interface SelectionPoint {
  pageIndex: number;
  x: number;
  y: number;
  rects: number[][];
  rectCount: number;
  text?: string;
  source: string;
}

function readerSelectionPopupPoint(reader: unknown): SelectionPoint | null {
  const r = reader as Record<string, any>;
  const internal = r?._internalReader ?? r;
  const primaryView = internal?._primaryView;
  const secondaryView = internal?._secondaryView;

  for (const key of [
    "primaryViewSelectionPopup",
    "secondaryViewSelectionPopup",
  ]) {
    const point = pointFromSelectionPopup(
      internal?._state?.[key],
      `state.${key}`,
    );
    if (point) return point;
  }
  for (const view of [primaryView, secondaryView]) {
    const point = pointFromSelectionPopup(
      (view as { _selectionPopup?: unknown })?._selectionPopup,
      "view._selectionPopup",
    );
    if (point) return point;
  }
  try {
    const position =
      typeof internal?.getSelectionPosition === "function"
        ? internal.getSelectionPosition()
        : null;
    const point = pointFromSelectionPosition(
      position,
      "internal.getSelectionPosition",
    );
    if (point) return point;
  } catch {
    /* ignore */
  }
  return null;
}

function pointFromSelectionPopup(
  popup: unknown,
  source: string,
): SelectionPoint | null {
  const p = popup as {
    annotation?: { text?: unknown; position?: unknown };
    position?: unknown;
  } | null;
  const annotation = p?.annotation;
  const position = annotation?.position ?? p?.position;
  const text =
    typeof annotation?.text === "string" ? annotation.text.trim() : "";
  return pointFromSelectionPosition(position, source, text || undefined);
}

function pointFromSelectionPosition(
  position: unknown,
  source: string,
  text?: string,
): SelectionPoint | null {
  const pos = position as {
    pageIndex?: unknown;
    rects?: unknown;
    nextPageRects?: unknown;
  } | null;
  const pageIndex =
    typeof pos?.pageIndex === "number" && Number.isFinite(pos.pageIndex)
      ? Math.floor(pos.pageIndex)
      : -1;
  if (pageIndex < 0) return null;
  const rects = parsePdfRects(pos?.rects);
  if (rects.length) {
    const rect = rects[0];
    return {
      pageIndex,
      x: (rect[0] + rect[2]) / 2,
      y: (rect[1] + rect[3]) / 2,
      rects,
      rectCount: rects.length,
      text,
      source,
    };
  }
  const nextPageRects = parsePdfRects(pos?.nextPageRects);
  if (nextPageRects.length) {
    const rect = nextPageRects[0];
    return {
      pageIndex: pageIndex + 1,
      x: (rect[0] + rect[2]) / 2,
      y: (rect[1] + rect[3]) / 2,
      rects: nextPageRects,
      rectCount: nextPageRects.length,
      text,
      source: `${source}.nextPageRects`,
    };
  }
  return null;
}

// Build a DetectedSentence straight from a text selection (its exact text + PDF
// rects), so the card translates/highlights what was selected — no sentence
// snapping. pageSentenceIndex = -1 marks it as a free selection: neighbor context
// and Enter-stepping skip it (a selection already defines its own scope).
function buildSelectionSentence(
  sel: { pageIndex: number; text: string; rects: number[][] },
  bundle: DetectedSentence["bundle"],
): DetectedSentence {
  return {
    text: sel.text,
    pageIndex: sel.pageIndex,
    pageLabel: bundle.pageLabel,
    rects: sel.rects.map(
      (r) => [r[0], r[1], r[2], r[3]],
    ) as DetectedSentence["rects"],
    sortIndex: "",
    pageSentenceIndex: -1,
    pageSentenceCount: 0,
    paragraphContext: "",
    bundle,
  };
}

// Parse an annotation position's `rects` (array of [x1,y1,x2,y2] PDF tuples).
function parsePdfRects(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  const out: number[][] = [];
  for (const entry of value) {
    if (
      Array.isArray(entry) &&
      entry.length >= 4 &&
      entry.slice(0, 4).every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      out.push(entry.slice(0, 4) as number[]);
    }
  }
  return out;
}

function readerWindow(reader: ReaderLike): Window | null {
  const r = reader as ReaderLike;
  return (
    r._internalReader?._primaryView?._iframeWindow ??
    r._internalReader?._secondaryView?._iframeWindow ??
    r._internalReader?._iframeWindow ??
    r._iframeWindow ??
    null
  );
}

function closestElement(node: Node | null, selector: string): Element | null {
  const start =
    node && node.nodeType === 1
      ? (node as Element)
      : ((node as { parentElement?: Element | null } | null)?.parentElement ??
        null);
  return typeof start?.closest === "function" ? start.closest(selector) : null;
}

function eventHitsPage(
  win: Window,
  clientX: number,
  clientY: number,
  target: Node | null,
): boolean {
  if (closestElement(target, ".page,[data-page-number]")) return true;
  const elements =
    typeof win.document.elementsFromPoint === "function"
      ? Array.from(win.document.elementsFromPoint(clientX, clientY))
      : [];
  return elements.some((el) => closestElement(el, ".page,[data-page-number]"));
}

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Same marked sentence? Compare page + page-local sentence index; fall back to
// text when an index isn't available. Used to avoid re-mounting the soft
// highlight on every hover sample that lands on the sentence already marked.
function sameSentence(a: DetectedSentence, b: DetectedSentence): boolean {
  if (a.pageIndex !== b.pageIndex) return false;
  if (a.pageSentenceIndex >= 0 && b.pageSentenceIndex >= 0) {
    return a.pageSentenceIndex === b.pageSentenceIndex;
  }
  return a.text === b.text;
}

// Page index of the first PDF page currently in (or nearest above) the viewport.
// Seeds Alt+↓ / Alt+↑ when nothing is marked yet so the first step lands on the
// page the reader is actually looking at, not page 0.
function firstVisiblePageIndex(win: Window): number | null {
  const pages = Array.from(
    win.document.querySelectorAll(".page[data-page-number]"),
  ) as HTMLElement[];
  if (!pages.length) return null;
  const viewH = win.innerHeight || 0;
  let best: { index: number; top: number } | null = null;
  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    if (rect.bottom <= 0) continue; // entirely above the viewport
    if (viewH && rect.top >= viewH) continue; // entirely below
    const n = Number(page.getAttribute("data-page-number"));
    if (!Number.isInteger(n) || n <= 0) continue;
    if (!best || rect.top < best.top) best = { index: n - 1, top: rect.top };
  }
  if (best) return best.index;
  // No page intersects the viewport (rare): fall back to the first page.
  const first = Number(pages[0]!.getAttribute("data-page-number"));
  return Number.isInteger(first) && first > 0 ? first - 1 : 0;
}

function pickPreset(
  presets: ModelPreset[],
  desiredId: string,
): ModelPreset | null {
  if (!presets.length) return null;
  return presets.find((p) => p.id === desiredId) ?? presets[0]!;
}

function contextLabel(level: string): string | undefined {
  if (level === "paragraph") return "所在段落";
  if (level === "page") return "当前页上下文";
  return undefined;
}

function contextText(
  current: DetectedSentence,
  level: string,
): string | undefined {
  if (level === "paragraph") return current.paragraphContext;
  if (level === "page") return current.bundle.pageText;
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Compact token-usage label: "token 输入/输出" (+ "缓存N" when prompt cache hit).
function formatTokenLabel(
  input?: number,
  output?: number,
  cacheRead?: number,
): string {
  const i = input ?? 0;
  const o = output ?? 0;
  const c = cacheRead ?? 0;
  return `token ${i}/${o}${c > 0 ? ` 缓存${c}` : ""}`;
}

// Compact a stored keybinding string ("Alt+ArrowDown") for the overlay hint
// ("Alt+↓"). Purely cosmetic — the raw string is what's parsed/matched.
function displayImmersiveKey(raw: string): string {
  return raw
    .replace(/ArrowDown/g, "↓")
    .replace(/ArrowUp/g, "↑")
    .replace(/ArrowLeft/g, "←")
    .replace(/ArrowRight/g, "→")
    .replace(/Enter/g, "↵")
    .replace(/Shift/g, "⇧");
}

// Pointer/selection events shielded from the reader over the card, so native
// text selection (and copy) works inside it.
const SELECTION_SHIELD_EVENTS = [
  "pointerdown",
  "mousedown",
  "pointerup",
  "mouseup",
  "dblclick",
  "selectstart",
];

const MODE_STYLE_ID = "zai-ask-mode-style";

function ensureModeStyle(doc: Document): void {
  if (doc.getElementById(MODE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = MODE_STYLE_ID;
  style.textContent = `
body.zai-ask-mode-on .page { cursor: help !important; }
body.zai-ask-mode-on .textLayer span:hover {
  background: rgba(120, 86, 255, 0.10);
  border-radius: 2px;
}
`;
  (doc.head ?? doc.documentElement)?.append(style);
}
