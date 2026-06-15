import { getProvider } from '../providers/factory';
import type { Message, StreamChunk } from '../providers/types';
import type { ModelPreset, ReasoningEffort, TranslateThinking } from '../settings/types';

// In-place "read this sentence" helper for immersive reading. Two first-turn
// shapes (follow-ups are plain Q&A):
//   - "explain": a short Chinese explanation (the chooser's 问 AI).
//   - "translateExplain": 【译】faithful translation + 【解】plain-language
//     meaning + key-term unpacking (the default unified card).
const SYSTEM_PROMPT =
  '你在帮用户精读一篇英文论文、逐句读懂。用简体中文，简洁、具体、就事论事，不要客套，也不要重复已说过的内容。';

const ASK_CONTEXT_CHAR_LIMIT = 800;
const ASK_MAX_OUTPUT_TOKENS = 900;

export type AskMode =
  | "explain"
  | "translateExplain"
  | "breakdown"
  | "translatePairs"
  | "align";

// One 英文意群 ↔ 中文 pair for the 逐句对照 view.
export interface AlignedPair {
  en: string;
  zh: string;
}

// Parse the "align" output: one 意群 per line, "英文 ||| 中文". Tolerant of
// leading bullets/numbers and lines without a separator. Pure + exported.
export function parseAlignedPairs(raw: string): AlignedPair[] {
  const out: AlignedPair[] = [];
  for (const line of (raw ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.indexOf("|||");
    if (idx < 0) continue;
    const en = t
      .slice(0, idx)
      .trim()
      .replace(/^[-*•\d.、)]+\s*/, "");
    const zh = t.slice(idx + 3).trim();
    if (en && zh) out.push({ en, zh });
  }
  return out;
}

export interface TermPair {
  en: string;
  zh: string;
}

export interface TranslationWithPairs {
  translation: string;
  pairs: TermPair[];
}

// Parse the "translatePairs" model output: a translation followed by an optional
// machine-readable 词对 line ("a=b | c=d"). Tolerant of full/half-width colons,
// pipes and equals, a leading 译文： label, and a still-streaming buffer (no 词对
// marker yet → everything is translation, no pairs). Pure + exported for tests.
export function parseTranslationWithPairs(raw: string): TranslationWithPairs {
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  const marker = /(?:^|\n)[ \t]*词对[：:][ \t]*/.exec(text);
  let translation = (marker ? text.slice(0, marker.index) : text)
    .replace(/^[ \t]*译文[：:][ \t]*/, "")
    .trim();
  // Drop a dangling partial "译文" / "词" the model may have started streaming.
  translation = translation.replace(/\n+[ \t]*词?对?[：:]?[ \t]*$/, "").trim();
  const pairs: TermPair[] = [];
  if (marker) {
    const block = text
      .slice(marker.index + marker[0].length)
      .split("\n")
      .filter((line) => line.trim())
      .join(" ");
    for (const chunk of block.split(/[|｜]/)) {
      const m = chunk.match(/^\s*(.+?)\s*[=＝]\s*(.+?)\s*$/);
      if (!m) continue;
      const en = m[1].trim();
      const zh = m[2].trim();
      if (en && zh) pairs.push({ en, zh });
    }
  }
  return { translation, pairs };
}

// One segment of an inline-annotated 拆解 line. "text" is plain English; the
// others carry an English fragment + its Chinese gloss/meaning.
export type BreakdownRole =
  | "text"
  | "subj"
  | "pred"
  | "kw"
  | "def"
  | "adv";
export interface BreakdownSeg {
  role: BreakdownRole;
  en: string;
  zh?: string;
}

const BREAKDOWN_TAG: Record<string, BreakdownRole> = {
  主: "subj",
  谓: "pred",
  词: "kw",
  定: "def",
  状: "adv",
};

// Legend shown under the 拆解.
export const BREAKDOWN_LEGEND =
  "主 =主语(绿) · 谓 =谓语(橙) · 状 =状语(蓝) · 头顶小字=关键词中文 · 〔 〕=定语";

// Parse the breakdown's inline markup ("However, [主:we|我们] need …") into
// renderable segments. Tolerant of a still-streaming buffer (an unterminated
// trailing "[主:we" is dropped) and of plain text with no tags (→ one text seg,
// so legacy/plain output still renders). Pure + exported for tests.
export function parseBreakdownMarkup(raw: string): BreakdownSeg[] {
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  const segs: BreakdownSeg[] = [];
  const re = /\[(主|谓|词|定|状):([^\]|]*)(?:\|([^\]]*))?\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segs.push({ role: "text", en: text.slice(last, m.index) });
    }
    const en = (m[2] ?? "").trim();
    const zh = m[3] != null ? m[3].trim() : "";
    if (en) segs.push({ role: BREAKDOWN_TAG[m[1]]!, en, zh: zh || undefined });
    last = re.lastIndex;
  }
  if (last < text.length) {
    const tail = text.slice(last).replace(/\[(?:主|谓|词|定|状):[^\]]*$/, "");
    if (tail) segs.push({ role: "text", en: tail });
  }
  return segs;
}

// Strip markup to plain English (def fragments keep 〔〕) for the live-streaming
// preview, before the structured render replaces it on completion.
export function stripBreakdownMarkup(raw: string): string {
  return parseBreakdownMarkup(raw)
    .map((s) => (s.role === "def" ? `〔${s.en}〕` : s.en))
    .join("");
}

export interface AskRequest {
  sentence: string;
  contextLabel?: string;
  contextText?: string;
  preset: ModelPreset;
  model: string;
  thinking: TranslateThinking;
  signal: AbortSignal;
  // First-turn shape. Defaults to "explain" for back-compat.
  mode?: AskMode;
  // For "align": also append a 词对 line (重点词对应) so the 逐句对照 view can color
  // key terms. Ignored by other modes.
  withTerms?: boolean;
}

export interface AskChunk {
  type: 'text' | 'usage' | 'error' | 'done';
  text?: string;
  message?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
}

const THINKING_TO_EFFORT: Record<TranslateThinking, ReasoningEffort> = {
  off: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
};

// Per-provider preset adjustments for the ask flow, mirroring the translate
// flow. OpenAI keeps a tight output cap; Anthropic's max_tokens covers
// thinking + visible output, so it needs headroom for any thinking budget.
function buildAskPreset(req: {
  preset: ModelPreset;
  model: string;
  thinking: TranslateThinking;
}): ModelPreset {
  const model = req.model || req.preset.model;
  if (req.preset.provider === 'openai') {
    return {
      ...req.preset,
      model,
      maxTokens: Math.min(
        req.preset.maxTokens || ASK_MAX_OUTPUT_TOKENS,
        ASK_MAX_OUTPUT_TOKENS,
      ),
      extras: {
        ...req.preset.extras,
        reasoningEffort: THINKING_TO_EFFORT[req.thinking],
        reasoningSummary: 'none',
      },
    };
  }
  return {
    ...req.preset,
    model,
    maxTokens: anthropicAskMaxTokens(req.preset, req.thinking),
    extras: {
      ...req.preset.extras,
      translateThinking: req.thinking,
    },
  };
}

function anthropicAskMaxTokens(
  preset: ModelPreset,
  level: TranslateThinking,
): number {
  const vendor = preset.extras?.vendor ?? 'compat';
  if (vendor === 'compat' || level === 'off') {
    return Math.min(
      preset.maxTokens || ASK_MAX_OUTPUT_TOKENS,
      ASK_MAX_OUTPUT_TOKENS,
    );
  }
  const budgetCeiling: Record<Exclude<TranslateThinking, 'off'>, number> = {
    low: 1024 + ASK_MAX_OUTPUT_TOKENS,
    medium: 2048 + ASK_MAX_OUTPUT_TOKENS,
    high: 4096 + ASK_MAX_OUTPUT_TOKENS,
    xhigh: 8192 + ASK_MAX_OUTPUT_TOKENS,
  };
  return Math.max(budgetCeiling[level], 4096);
}

// Exported so the controller can build the same first-turn user message it then
// stores in the conversation history for follow-up turns.
export function buildUserMessage(req: AskRequest): string {
  const sentence = req.sentence.trim();
  const ctx = req.contextText
    ? `\n${req.contextLabel || '同段参考'}：${trimContext(req.contextText)}`
    : '';
  if (req.mode === 'translateExplain') {
    return (
      '请帮我读懂下面这句话，严格按这个格式输出（简体中文）：\n' +
      '【译】给出准确翻译，术语/缩写/公式/模型名保留原文。\n' +
      '【解】用大白话说清这句到底在讲什么、作者在干嘛（不要复述翻译）；若有关键术语/缩写，顺带点破 1–2 个；若与上下文论证相关，点出它的作用。控制在几句。\n' +
      `\n这句话：${sentence}${ctx}`
    );
  }
  if (req.mode === 'breakdown') {
    return (
      '请把下面这句英文做「长句拆解」，用内联标注格式输出，目的是看清**语法结构**而不是逐词翻译。规则：\n' +
      '- 保留英文原句词序，照常用空格分词；只给真正有结构意义的成分加标注，其余英文原样保留。\n' +
      '- [主:英文|中文]：主句主语。\n' +
      '- [谓:英文|中文]：主句谓语动词（含系动词 + 过去分词等被动结构，如 are shown）。\n' +
      '- [词:英文|中文]：关键实词 / 术语 / 难词（普通常见词不要标）。\n' +
      '- [定:英文|中文]：**修饰名词**的成分（关系从句、of 短语等定语）。\n' +
      '- [状:英文|中文]：**修饰动词或全句**的成分（时间 / 地点 / 方式 / 原因等状语，包括介词短语作状语、副词）。\n' +
      '- 关键区分：介词短语作状语用 [状]，不要用 [定]；[定] 只能修饰名词。例如 “are shown in Figure 8” 里 in Figure 8 是状语 → [状]。\n' +
      '- 不要嵌套标注；层层修饰时只标最外层或拆成相邻片段。不要 Markdown / 代码块 / 额外解释，只输出标注后的句子。\n' +
      '示例：[主:The results of the first experiment|第一次实验的结果] [谓:are shown|被展示] [状:in Figure 8|在图8中] .\n' +
      '示例：However, [主:the diversity of situations|情境的多样性] [谓:requires|需要] more than just [词:scale|规模] : [主:we|我们] [谓:need to design|需要设计] [词:training recipes|训练配方] [定:that can provide the breadth of knowledge|能提供广度知识的] .\n' +
      `\n这句话：${sentence}${ctx}`
    );
  }
  if (req.mode === 'align') {
    const termsLine = req.withTerms
      ? '- 在所有意群行之后，另起一行附上重点词对应，格式：词对：英文词=中文词 | 英文词=中文词（挑 2–5 个关键术语/难词；英文词须为句中出现的片段，中文词须在上面的译文里出现）。\n'
      : '';
    return (
      '请把【目标句】切成几段，做「逐句对照」。每段一行，英文与中文用 ||| 分隔：英文段 ||| 中文意思。\n' +
      '**最重要：只切分并翻译下面"这句话："后面的那一句（目标句）本身。** 如果还给了「上下相邻句」「所在段落」等上下文，那只是帮你理解词义、消除歧义的参考——**绝不要翻译它、不要把上下文里的任何句子放进输出**。输出的英文必须全部来自目标句。\n' +
      '切分原则：\n' +
      '- 在自然停顿处断开：逗号、分号、冒号、并列连词 (and/but/or)、从句引导词 (which/that/who/when/because…)。\n' +
      '- 每段是一个分句或较完整的片段；很短的尾巴（如 in training.）并入相邻段，不要单独成段。\n' +
      '- 有多个分句的长句要切成 **2~5 段**——**绝不要把整句只给成一段**，也不要把单个词单独成段。\n' +
      '- 每段英文可以较长，显示时会自动换行。\n' +
      termsLine +
      '- 不要 Markdown、不要编号、不要额外解释，只输出目标句的这些行。\n' +
      '示例：\n' +
      'Perhaps surprisingly, the second best model is the implicit HL ablation, ||| 或许有些出人意料，排名第二的是隐式分层消融，\n' +
      'which does not perform any high-level inference, ||| 它不做任何高层推理，\n' +
      'but includes the full data mixture, i.e. also subtask prediction, in training. ||| 但在训练中包含完整的数据混合，即也包括子任务预测。\n' +
      `\n这句话：${sentence}${ctx}`
    );
  }
  if (req.mode === 'translatePairs') {
    return (
      '请翻译下面这句英文（简体中文），并附上少量「重点词对应」。严格按这个格式输出：\n' +
      '译文：<准确、通顺的翻译；术语/缩写/公式/模型名保留原文>\n' +
      '词对：<英文词>=<中文词> | <英文词>=<中文词>\n' +
      '词对要求：挑 2–5 个关键实词或术语；英文词必须是这句话里出现的连续原文片段，中文词必须出现在你给的译文里；不确定就少给或留空。\n' +
      `\n这句话：${sentence}${ctx}`
    );
  }
  return (
    '请简洁解释这句话的含义或作用（2–4 句；术语/缩写/公式/模型名保留原文）。\n' +
    `这句话：${sentence}${ctx}`
  );
}

export interface AskFollowupRequest {
  messages: Message[];
  preset: ModelPreset;
  model: string;
  thinking: TranslateThinking;
  signal: AbortSignal;
}

export async function* answerSentence(req: AskRequest): AsyncIterable<AskChunk> {
  yield* streamAskMessages(
    [{ role: 'user', content: buildUserMessage(req) }],
    req,
  );
}

// Multi-turn variant: stream with a full conversation history (system prompt is
// added by the provider). Used for follow-up questions in the in-place card.
export async function* answerMessages(
  req: AskFollowupRequest,
): AsyncIterable<AskChunk> {
  yield* streamAskMessages(req.messages, req);
}

async function* streamAskMessages(
  messages: Message[],
  req: { preset: ModelPreset; model: string; thinking: TranslateThinking; signal: AbortSignal },
): AsyncIterable<AskChunk> {
  const preset = buildAskPreset(req);
  const provider = getProvider(preset);
  try {
    for await (const chunk of provider.stream(messages, SYSTEM_PROMPT, preset, req.signal)) {
      const mapped = mapChunk(chunk);
      if (!mapped) continue;
      yield mapped;
      // A provider error arrives as a chunk and then the stream returns; do not
      // emit a trailing `done`, which would overwrite the error in the overlay.
      if (mapped.type === 'error') return;
    }
    yield { type: 'done' };
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

function trimContext(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= ASK_CONTEXT_CHAR_LIMIT) return normalized;
  return `${normalized.slice(0, ASK_CONTEXT_CHAR_LIMIT)}…`;
}

function mapChunk(chunk: StreamChunk): AskChunk | null {
  switch (chunk.type) {
    case 'text_delta':
      return { type: 'text', text: chunk.text };
    case 'error':
      return { type: 'error', message: chunk.message };
    case 'usage':
      return {
        type: 'usage',
        input: chunk.input,
        output: chunk.output,
        cacheRead: chunk.cacheRead,
      };
    default:
      return null;
  }
}
