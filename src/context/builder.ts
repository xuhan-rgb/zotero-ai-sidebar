import type { ItemAnnotation } from './types';
import { promptText } from '../utils/prompt-locale';

// Legacy context builder.
//
// In production today, `sidebar.ts` calls `buildContext(..., 0)` — the
// `pdfTokenBudget=0` short-circuits the PDF-text path so this function
// effectively returns just (system prompt + metadata). The PDF-text branch
// remains exercised by:
//   - tests/context/builder.test.ts (regression coverage)
//   - the React UI tree under src/ui/ (not currently mounted in the Zotero
//     pane — see CLAUDE.md "Native DOM sidebar code lives mainly in
//     src/modules/sidebar.ts").
//
// INVARIANT: PDF text fetched at PROMPT-BUILD time is the legacy path and
// has no place in the agent loop. The model fetches PDF text on demand via
// `agent-tools.ts` (zotero_get_full_pdf / zotero_search_pdf / zotero_read_pdf_range)
// so it can decide what's worth its context budget.

export interface ItemMetadata {
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  tags: string[];
}

export interface ContextSource {
  getItem(itemID: number): Promise<ItemMetadata | null>;
  getFullText(itemID: number): Promise<string>;
  getParsedPdfText?(itemID: number): Promise<string | null>;
  getAnnotations?(itemID: number): Promise<ItemAnnotation[]>;
}

export interface BuiltContext {
  systemPrompt: string;
  pdfText: string | null;
}

function systemBase(): string {
  return promptText(
    '你是帮助用户理解学术论文的研究助手。回答论文内容问题时引用论文，表达准确、简洁。\n\n' +
      '证据输出的关键规则：凡是用来支持论文相关论点的内容——无论称为原文论据、原文依据、证据、引用或 supporting point，也无论采用何种格式——都必须先用论文所用语言逐字引用 PDF 原文，不能翻译、转述、缩短或改写；引用须单独放在 Markdown 引用块（>）中，解释另起一行。原文论据必须是原文，不能用自己的转述代替；转述绝不能作为原文论据或证据。如果 PDF 中没有可逐字引用的句子，请写（原文无直接对应句），不要编造或转述。\n\n' +
      '数学公式使用 $...$（行内）或 $$...$$（独立行）的 LaTeX。不要用反引号包裹公式；反引号用于代码，聊天和笔记渲染器会自动排版普通文本中的公式。',
    'You are a research assistant helping the user understand academic papers. Cite the paper when answering questions about its content. Be precise and concise.\n\n' +
      'CRITICAL OUTPUT RULE for evidence. Whenever you support a claim about the paper — including any 原文论据 / 原文依据 / 证据 / evidence / supporting point, however you label or format it — you MUST first quote the actual PDF passage verbatim, word-for-word, in the language used in the PDF (do NOT translate, paraphrase, shorten, or rephrase it), as its own Markdown blockquote (>), then put any explanation on a separate line after it. 原文论据 means the literal original passage — NOT your restatement of it; a paraphrased bullet is NEVER acceptable as 原文论据 or as evidence. If the PDF has no verbatim sentence for a point, write （原文无直接对应句） rather than inventing or paraphrasing one.\n\n' +
      'For math, write LaTeX inside $...$ (inline) or $$...$$ (display). Do NOT wrap math formulas in backticks (`) — backticks are for code, and the chat and note renderers typeset math automatically when it appears in plain text.',
  );
}

export async function buildContext(
  source: ContextSource,
  itemID: number | null,
  pdfTokenBudget: number,
): Promise<BuiltContext> {
  if (itemID == null) return { systemPrompt: systemBase(), pdfText: null };

  const item = await source.getItem(itemID);
  if (!item) return { systemPrompt: systemBase(), pdfText: null };

  const meta = formatMetadata(item);
  const pdfText = pdfTokenBudget > 0 ? await source.getFullText(itemID) : '';
  const truncated = truncate(pdfText, pdfTokenBudget);

  return {
    systemPrompt: `${systemBase()}\n\n${promptText('用户当前正在查看这篇论文：', 'The user is currently viewing this paper:')}\n${meta}`,
    pdfText: truncated || null,
  };
}

function formatMetadata(item: ItemMetadata): string {
  const lines: string[] = [`Title: ${item.title}`];
  if (item.authors.length) lines.push(`Authors: ${item.authors.join(', ')}`);
  if (item.year) lines.push(`Year: ${item.year}`);
  if (item.tags.length) lines.push(`Tags: ${item.tags.join(', ')}`);
  if (item.abstract) lines.push(`Abstract: ${item.abstract}`);
  return lines.join('\n');
}

function truncate(text: string, tokenBudget: number): string {
  const charBudget = tokenBudget * 4;
  return text.length > charBudget ? text.slice(0, charBudget) : text;
}
