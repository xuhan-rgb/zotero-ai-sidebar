import type { PrefsStore } from './storage';
import { appendLocalPath } from '../utils/local-path';

export type BuiltInPromptID =
  | 'summary'
  | 'readingRoute'
  | 'fullTextHighlight'
  | 'explainSelection';

export interface BuiltInPromptSettings {
  summary: string;
  readingRoute: string;
  fullTextHighlight: string;
  explainSelection: string;
}

export interface CustomPromptButton {
  id: string;
  label: string;
  prompt: string;
  shortcut?: string;
}

export interface QuickPromptSettings {
  builtIns: BuiltInPromptSettings;
  customButtons: CustomPromptButton[];
  selectionQuestionAnnotationEnabled: boolean;
}

export const DEFAULT_SUMMARY_PROMPT = [
  '请用中文总结这篇论文，按以下小标题分段输出（每段 1-3 句，可用 `- ` 列要点）：',
  '## 研究背景与问题',
  '## 核心方法',
  '## 关键公式 / 算法步骤',
  '## 主要贡献',
  '## 实验结果与结论',
  '## 适用场景',
  '## 局限性 / 不适用情形',
  '## 后续改进方向',
  '',
  '最后用一句话总体概括。',
].join('\n');

export const DEFAULT_READING_ROUTE_PROMPT = [
  '按 Keshav three-pass approach 输出阅读路线，但使用 AI 增强版第一遍：重点挖出论文的研究脉络、前作关系、问题缺口、本文切入点和效果锚点。不要写成普通论文摘要。',
  '',
  '先调用 zotero_get_current_item 获取标题、作者、年份、摘要；随后调用 zotero_get_full_pdf 或检索 PDF，扫读 abstract、introduction、related work、section headings、关键图表 caption、experiments 总览、conclusion、references。第一遍可以从整篇文章挖 context，但不要逐段精读方法/实验细节。',
  '',
  '三遍边界：',
  '- 第一遍：建立研究地图和阅读决策；提出“需要第二遍验证的问题”。',
  '- 第二遍：理解方法和实验内容；审计证据是否支撑第一遍识别出的 claim。',
  '- 第三遍：虚拟重建/复现/审稿；挑战隐含假设、缺失引用和技术细节。',
  '',
  '## 第一遍：Context-rich 论文定位（输出 1000-1500 字）',
  '',
  '仍遵守 Keshav 第一遍的精神：只做鸟瞰和决策，不做实验/公式/实现细节审计。输出固定为 5 块，5 个块标题必须严格使用下面的 Markdown 三级标题格式，不要改成加粗行内标题：',
  '',
  '### A. 一句话定位',
  '- 用 1 句说明：这篇论文属于什么方向、接在哪条研究脉络后面、试图解决什么核心缺口。句子必须包含“相对谁/哪类方法”和“往前推进了什么”。',
  '',
  '### B. Context：研究脉络',
  '- 上游问题：这个领域长期在解决什么问题？为什么这个问题重要？',
  '- 直接前作 / 相关脉络：只从当前论文 References / Related Work 中选择 3-6 篇当前论文明确引用的工作，按年份从早到晚排序；每条子项必须先写一个语义前缀，便于回看和溯源：`基础：` / `限制：` / `批评：` / `数据：` / `机制：` / `效果：` / `关系：`（只选一个，不要混用）。然后再写“作者 年份 — 论文全名（若 References 中有 URL/arXiv/DOI 就用 Markdown 链接）”，并说明它给本文提供了什么基础/留下了什么问题；若当前论文明确批评/指出该工作的不足，写出批评点，否则写“本文未直接批评”。来源：当前论文第 X 节/Related Work/Introduction/References [编号]/Fig. N caption 中的哪一句或哪一段。',
  '  不要凭常识或记忆补论文；不要编 arXiv/DOI/URL；如果 References 里没有链接，就只写论文全名。',
  '- 本文切入点：前作还没有解决什么，所以本文要做什么？',
  '- 关系判断：本文是延续、组合、修正、扩展，还是换范式？不要夸大；例如“YOLOv8 相对 YOLOv7 是结构/训练配方升级”，而不是泛泛说“提出新方法”。',
  '',
  '### C. 本文方案与效果锚点',
  '- 核心想法：1-2 句讲清本文用什么机制解决 B 中的缺口。',
  '- 关键改动：列 2-4 点，相对前作/常见做法具体改了什么。',
  '- 声称效果：写作者声称达到的主要效果；如果第一遍能看到数字/任务/benchmark，就给出具体对象，否则说明“第一遍只看到方向性 claim”。',
  '- 第二遍证据锚点：列 3-5 个必须回看的图/表/节/实验，每项说明它验证哪个 claim；多个图号分开写成 `Fig. 10 和 Fig. 13`，不要写 `Fig. 10/13`；不要写裸引用编号如 `[8]`，改写作者年份或主题。',
  '',
  '### D. Five Cs 快速判定',
  '- Category: What type of paper is this? 给出主类型 + 子类型 + 归类依据。',
  '- Context: 用 1 句总结 B 中最重要的研究脉络，不重复 B 的子列表。',
  '- Correctness: 写“承重假设 + 第一遍能否初步接受 + 第二遍必须查哪一处”；第一遍只能说 appears/needs check，不做最终实验证据判断。',
  '- Contributions: 只列 2-3 个主贡献，区分“作者声称”和“第一遍可见”。',
  '- Clarity: 按 Keshav 的 five-minute gist 标准判断：标题、摘要、小标题、结论是否足够让读者抓住 highlights。',
  '',
  '### E. 第一遍决策',
  '- 决策只选一个：继续第二遍 / 暂停补背景 / 停止。',
  '- 理由：一句话，必须对应 Keshav 的三类停止理由（不相关、背景不足、假设不稳）或继续理由。',
  '- 下一步：如果继续，写“第二遍优先看 X 图/节/公式，因为它验证 Y”；如果暂停，写“先补 X 引用/概念”；如果停止，写“保留 X 用途”。',
  '',
  '## 第二遍：内容理解与证据审计路线（若第一遍说“继续”，输出 350-500 字）',
  '目标：验证第一遍建立的研究地图是否站得住，而不是重新写摘要。',
  '- 方法主线：如果是模型/算法论文，按“输入 → 核心模块/训练配方 → 输出/目标”压缩说明；如果是系统/实验论文，按“系统组件 → 数据/任务 → 评估协议”说明。',
  '- 关键证据审计：列 3 个第一遍锚定的图/表/实验。每项说明它支持哪个 claim，以及最需要检查的混淆因素。',
  '- 反证与薄弱点：列 2 个最可能推翻作者结论的检查点。',
  '- 需要追的引用：列 2-3 篇真正值得补读的引用，并说明补读目的。',
  '',
  '## 第三遍：虚拟重建 / 复现 / 审稿路线（始终输出，250-400 字）',
  '目标：按 Keshav 的 third pass，尝试在脑中重建整篇论文，并用重建结果暴露隐含假设和失败点。',
  '- 重建计划：从零复现/复核，第一步做什么？最关键的 3 类资源是什么？哪一项最可能拿不到？',
  '- 机制重建：如果是模型/算法论文，用 2-3 句概括“参数 / 数据流 / loss-objective”；如果论文没有可训练模型，改写为“系统状态 / 流程 / 评价目标”。',
  '- 假设挑战：列 2-3 个最承重隐含假设、缺失引用或实验设计漏洞。',
  '- 复现风险与替代验证：最不放心的一步是什么？如果你来做，会补哪个验证或消融？',
  '',
  '约束：',
  '- 第一遍可以引用 2-4 句 PDF 原文：优先用于 context 缺口、作者贡献声明、关键假设或效果 claim；紧跟相关判断用 Markdown 引用块，先逐字抄录 1 句原文，再另起一行写中文译文，格式固定为 `> 原文` 换行 `> 译：中文译文`；不要为每个 bullet 都引用',
  '- 第二遍图表评价、第三遍失败模式等有 PDF 原文依据的判断，也可用同样的 `> 原文` + `> 译：...` 引用块；没有原文锚点的阅读路径建议可以省略引用',
  '- Context 的二级子列表必须用两个空格缩进 `  - `，不要用分号挤在一行',
  '- 完整性优先：必须完整写完第三遍，并以 `--- 阅读路线结束 ---` 作为最后一行；如果篇幅不足，优先压缩第一遍引用、第二遍和第三遍细节，绝不能在句子中间截断',
  '- 不要写“如果你关心 X……”的伪条件句',
  '- 不要调用 zotero_append_to_note / zotero_annotate_passage（插件会自动保存到专用阅读路线笔记）',
].join('\n');

export const DEFAULT_FULL_TEXT_HIGHLIGHT_PROMPT = [
  '请执行以下流程，对当前 PDF 标注重点：',
  '',
  '1. 先调用 zotero_get_current_item，读取标题、作者、年份和摘要；用摘要建立论文主线（研究问题、方法、结果、结论）。',
  '2. 再调用 zotero_get_reader_pdf_text，读取当前 Reader 的 PDF 文本层。注意：后续要高亮的 text 必须从这个工具输出中逐字复制，不要从 zotero_get_full_pdf 复制。',
  '3. 如果工具输出显示全文被截断（Truncated: yes / sent chars < total chars），请继续调用 zotero_get_reader_pdf_text 并传入 start/end 补读未覆盖的关键范围。',
  '4. 通读后，按用户要求和内容需要选出最值得标注的重点句（论点、关键定义、核心结果、关键限制、贡献点等）；未指定数量时建议 5–10 条。优先选择能支撑摘要主线的正文原句；避免标摘要性的整段、避免标公式。如果摘要里有高度概括贡献/结论的关键句，最多标 1 条。',
  '5. 对每一条调用 zotero_annotate_passage：',
  '   - text 字段必须是 PDF 中的逐字原文，不要改写、不要翻译、不要省略标点。',
  '   - comment 字段用中文，格式 "类别：理由"（如 "方法：先生成低分辨 attention 再上采样"），≤ 80 字。',
  '   - color 字段：按工具参数里的颜色预设描述挑 hex，注意类别映射可能与色彩直觉相反；类别不明确就不传。',
  '6. 全部标注完成后，再用一段中文总结：摘要主线、标了哪几句、正文补充了什么、可能漏掉的角度。',
  '',
  '注意：',
  '- 只有本次全文标注需要写入 PDF；不要调用与本任务无关的写工具。',
  '- 如果某句调用 zotero_annotate_passage 返回 "Passage not found"，可以稍微改写后重试（保持原句 80% 以上文字不变）；连续两次都找不到就放弃这句、继续下一条。',
].join('\n');

export const DEFAULT_EXPLAIN_SELECTION_PROMPT = [
  '请解释当前 PDF 选区的文字，总长度控制在 200-400 字。默认结合本轮已附带的附近上下文分析：先说明选区本身在说什么，再说明它在上下文中的作用，以及为什么值得关注。如果当前选区是在提出观点、给出论据/证据、定义概念、说明方法细节、承接/转折、限制条件或结论，请明确说出它属于哪一类；如果是观点或论据，必须说清楚这句话在论证链条里的作用。',
  '',
  '如果已附带的附近上下文仍不足，且当前模型可以调用 Zotero 工具，请继续用 zotero_search_pdf 或 zotero_read_pdf_range 读取更多相邻内容后再判断；避免基于孤立句子作过度推断。凡现有证据不足以支持的判断，请明确标注为“基于当前上下文尚不能确定”。',
  '',
  '系统会另行注入“建议注释”输出格式，按其要求列出要点即可，无需在本提示中重复格式说明。如果当前没有可用 PDF 选区，请提示我先选中文本。',
].join('\n');

export const DEFAULT_QUICK_PROMPT_SETTINGS: QuickPromptSettings = {
  builtIns: {
    summary: DEFAULT_SUMMARY_PROMPT,
    readingRoute: DEFAULT_READING_ROUTE_PROMPT,
    fullTextHighlight: DEFAULT_FULL_TEXT_HIGHLIGHT_PROMPT,
    explainSelection: DEFAULT_EXPLAIN_SELECTION_PROMPT,
  },
  customButtons: [],
  // Default ON: a free-form selection question gets a "建议注释" card with
  // both 💾 高亮+评论 and 🅣 新增文字 save buttons, so the user picks the
  // annotation type by clicking — no need to type "用 T 工具" in the prompt.
  selectionQuestionAnnotationEnabled: true,
};

const KEY = 'extensions.zotero-ai-sidebar.quickPrompts';
const PROMPTS_FILE = 'zotero-ai-sidebar-quick-prompts.json';
const MAX_CUSTOM_BUTTONS = 12;
const MAX_LABEL_CHARS = 32;
const MAX_PROMPT_CHARS = 20_000;

interface ZoteroFileAPI {
  getContentsAsync(path: string, charset?: string): Promise<string>;
  putContentsAsync(path: string, contents: string): Promise<void>;
}

interface ZoteroGlobal {
  File: ZoteroFileAPI;
  Profile: { dir: string };
  DataDirectory?: { dir?: string; path?: string };
  Prefs?: { clear: (key: string, global: boolean) => void };
}

// In-memory cache keeps load/save synchronous for sidebar and prefs UI.
// Disk I/O is queued; hydrate at startup migrates the legacy pref blob.
let cached: QuickPromptSettings | null = null;
let loaded = false;
let writeQueue: Promise<void> = Promise.resolve();
let hydratePromise: Promise<void> | null = null;

export function quickPromptsPath(): string {
  return appendLocalPath(promptsDir(), PROMPTS_FILE);
}

export function loadQuickPromptSettings(prefs: PrefsStore): QuickPromptSettings {
  if (loaded && cached) return cached;
  const fromPrefs = parsePrefs(prefs);
  if (fromPrefs) {
    cached = fromPrefs;
    loaded = true;
    return cached;
  }
  return DEFAULT_QUICK_PROMPT_SETTINGS;
}

export function saveQuickPromptSettings(
  prefs: PrefsStore,
  settings: QuickPromptSettings,
): void {
  cached = normalizeQuickPromptSettings(settings);
  loaded = true;
  if (!canUseFileStorage()) {
    prefs.set(KEY, JSON.stringify(cached));
    return;
  }
  enqueueWrite(prefs);
}

export function hydrateQuickPromptSettings(prefs: PrefsStore): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (!canUseFileStorage()) {
      if (!loaded) {
        cached = parsePrefs(prefs) ?? DEFAULT_QUICK_PROMPT_SETTINGS;
        loaded = true;
      }
      return;
    }
    const fromFile = await readFile();
    if (loaded) return;
    if (fromFile) {
      cached = fromFile;
      loaded = true;
      clearLegacyPref(prefs);
      return;
    }
    const fromPrefs = parsePrefs(prefs);
    if (loaded) return;
    if (fromPrefs) {
      cached = fromPrefs;
      loaded = true;
      enqueueWrite(prefs);
      await flushQuickPromptSettings();
      return;
    }
    cached = DEFAULT_QUICK_PROMPT_SETTINGS;
    loaded = true;
  })();
  return hydratePromise;
}

export function flushQuickPromptSettings(): Promise<void> {
  return writeQueue.catch(() => undefined);
}

export function resetQuickPromptSettingsCache(): void {
  cached = null;
  loaded = false;
  writeQueue = Promise.resolve();
  hydratePromise = null;
}

function getZotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}

function promptsDir(): string {
  const Z = getZotero();
  return Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
}

function canUseFileStorage(): boolean {
  try {
    const file = getZotero().File as Partial<ZoteroFileAPI> | undefined;
    return !!(file?.getContentsAsync && file?.putContentsAsync && promptsDir());
  } catch {
    return false;
  }
}

function parsePrefs(prefs: PrefsStore): QuickPromptSettings | null {
  const raw = prefs.get(KEY);
  if (!raw) return null;
  try {
    return normalizeQuickPromptSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function enqueueWrite(prefs: PrefsStore): void {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    if (!cached) return;
    await writeFile(cached);
    clearLegacyPref(prefs);
  });
  void writeQueue.catch(() => undefined);
}

async function writeFile(settings: QuickPromptSettings): Promise<void> {
  await getZotero().File.putContentsAsync(
    quickPromptsPath(),
    JSON.stringify(settings, null, 2),
  );
}

async function readFile(): Promise<QuickPromptSettings | null> {
  try {
    const raw = await getZotero().File.getContentsAsync(
      quickPromptsPath(),
      'utf-8',
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return normalizeQuickPromptSettings(parsed);
  } catch {
    return null;
  }
}

function clearLegacyPref(prefs: PrefsStore): void {
  if (!prefs.get(KEY)) return;
  try {
    if (typeof prefs.clear === 'function') {
      prefs.clear(KEY);
      return;
    }
    const clear = getZotero().Prefs?.clear;
    if (clear) {
      clear(KEY, true);
      return;
    }
  } catch {
    // Fall through to a tiny overwrite so the 10KB blob is gone.
  }
  prefs.set(KEY, '');
}

export function normalizeQuickPromptSettings(value: unknown): QuickPromptSettings {
  const input = value && typeof value === 'object'
    ? (value as Partial<QuickPromptSettings>)
    : {};
  const builtIns = input.builtIns && typeof input.builtIns === 'object'
    ? (input.builtIns as Partial<BuiltInPromptSettings>)
    : {};
  return {
    builtIns: {
      summary: promptValue(builtIns.summary, DEFAULT_SUMMARY_PROMPT),
      readingRoute: promptValue(
        builtIns.readingRoute,
        DEFAULT_READING_ROUTE_PROMPT,
      ),
      fullTextHighlight: promptValue(
        builtIns.fullTextHighlight,
        DEFAULT_FULL_TEXT_HIGHLIGHT_PROMPT,
      ),
      explainSelection: promptValue(
        builtIns.explainSelection,
        DEFAULT_EXPLAIN_SELECTION_PROMPT,
      ),
    },
    customButtons: normalizeCustomButtons(input.customButtons),
    // Treat ONLY explicit `false` as off — undefined / unknown / legacy
    // shapes default to on now (the toggle previously defaulted off).
    // Existing users who saved `false` before keep their disabled state;
    // new and never-touched profiles get the suggestion card by default.
    selectionQuestionAnnotationEnabled:
      input.selectionQuestionAnnotationEnabled !== false,
  };
}

function normalizeCustomButtons(value: unknown): CustomPromptButton[] {
  if (!Array.isArray(value)) return [];
  const buttons: CustomPromptButton[] = [];
  const seen = new Set<string>();
  const seenShortcuts = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<CustomPromptButton>;
    const label = stringValue(item.label).slice(0, MAX_LABEL_CHARS);
    const prompt = stringValue(item.prompt).slice(0, MAX_PROMPT_CHARS);
    const shortcut = uniqueShortcut(item.shortcut, seenShortcuts);
    if (!prompt || (!label && !shortcut)) continue;
    const baseId = stringValue(item.id) || label || shortcut;
    const id = uniqueID(baseId, seen);
    buttons.push({ id, label, prompt, ...(shortcut ? { shortcut } : {}) });
    if (buttons.length >= MAX_CUSTOM_BUTTONS) break;
  }
  return buttons;
}

function uniqueID(value: string, seen: Set<string>): string {
  const base = value
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `prompt-${seen.size + 1}`;
  let id = base;
  let suffix = 2;
  while (seen.has(id)) id = `${base}-${suffix++}`;
  seen.add(id);
  return id;
}

function promptValue(value: unknown, fallback: string): string {
  const prompt = stringValue(value).slice(0, MAX_PROMPT_CHARS);
  return prompt || fallback;
}

function uniqueShortcut(
  value: unknown,
  seenShortcuts: Set<string>,
): string {
  const shortcut = normalizeShortcut(value);
  if (!shortcut || seenShortcuts.has(shortcut)) return '';
  seenShortcuts.add(shortcut);
  return shortcut;
}

function normalizeShortcut(value: unknown): string {
  const shortcut = stringValue(value).toLowerCase();
  return /^[a-z0-9]$/.test(shortcut) ? shortcut : '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
