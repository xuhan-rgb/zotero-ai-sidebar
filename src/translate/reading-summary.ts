import { getProvider } from "../providers/factory";
import type { Message } from "../providers/types";
import { loadTranslateSettings } from "./settings";
import { loadPresets, type PrefsStore } from "../settings/storage";
import { getReadingConversations, type ReadingConversation } from "./reading-log";

// Summarize a paper's immersive-reading in-place Q&A (all per-sentence cards)
// into one Markdown digest the caller then writes into the AI note. Reuses the
// same preset/model selection as the ask flow so it needs no separate config.

const SUMMARY_SYSTEM =
  "你在帮用户总结一篇论文的「沉浸式阅读」就地问答记录。用简体中文,条理清晰地归纳读者关注的要点、提出的疑问与对应解答;可按主题分组,突出关键结论与仍存疑之处。不要逐句复述,提炼即可。";

function buildSummaryUserMessage(convos: ReadingConversation[]): string {
  const blocks = convos.map((c, i) => {
    const qa = c.messages
      .map((m) =>
        m.role === "user"
          ? `问:${m.content.trim()}`
          : `答:${m.content.trim()}`,
      )
      .join("\n");
    const sentence = c.sentence.trim();
    return `【片段 ${i + 1}】${sentence ? `原文句:${sentence}\n` : ""}${qa}`;
  });
  return `以下是我阅读这篇论文时,针对若干句子与 AI 的就地问答记录(每段是一句话的独立小对话)。请总结整篇阅读中我关注与弄懂了什么:\n\n${blocks.join(
    "\n\n",
  )}`;
}

export interface ReadingSummaryResult {
  text: string;
  count: number;
}

// Returns the Markdown summary text. Throws on config/model errors; returns an
// empty result (count 0) when there is nothing recorded for this item.
export async function summarizeReadingConversations(
  itemID: number | null,
  prefs: PrefsStore,
  signal: AbortSignal,
): Promise<ReadingSummaryResult> {
  const convos = getReadingConversations(itemID);
  if (convos.length === 0) return { text: "", count: 0 };

  const settings = loadTranslateSettings(prefs);
  const presets = loadPresets(prefs);
  const preset =
    presets.find((p) => p.id === settings.presetId) ?? presets[0] ?? null;
  if (!preset) throw new Error("请先在设置中配置一个账号。");
  const model = settings.model || preset.model || "";
  if (!model) throw new Error("请先为账号选择模型。");

  const tuned = { ...preset, model };
  const messages: Message[] = [
    { role: "user", content: buildSummaryUserMessage(convos) },
  ];
  const provider = getProvider(tuned);
  let out = "";
  for await (const chunk of provider.stream(
    messages,
    SUMMARY_SYSTEM,
    tuned,
    signal,
  )) {
    if (chunk.type === "text_delta") out += chunk.text;
    else if (chunk.type === "error") throw new Error(chunk.message);
  }
  return { text: out.trim(), count: convos.length };
}
