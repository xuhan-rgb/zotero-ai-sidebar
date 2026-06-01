# 论文总揽地图（Paper Overview Map）设计

状态：已批准（2026-06-02）。Mockup：`design_overview_map_mockup.html`、`design_note_header_mockup.html`（未跟踪草稿）。

## 目标

读者阅读 PDF 全程，始终对整篇论文有一个「概念」——而不是读一点懂一点。提供一个常驻、可一眼扫的全文总揽，让每段局部细节落进全局框架。

## 非目标 / 约束（与 CLAUDE.md 一致）

- 不做语义意图路由：是否生成总揽由模型在工具循环里自己决定，不写关键词/正则触发。
- 不自动发送整篇 PDF：骨架取数廉价（≈3–4k 字）；深读仍走现有按需工具。
- 预算集中在 `src/context/policy.ts`，不散落魔数。
- 写操作（存成笔记）显式、可见、需审批，复用现有路径。
- 不与 Zotero Reader 键盘/焦点冲突：总揽视图只读（无 contenteditable）。

## 形态（方案 1 + 工具栏方案 A）

总揽是笔记面板里的**第三个独立视图**，分两层叠放：

1. **叙事骨架**（文档结构）：章节顺序，每节「节号 + 标题 + 一句话 gist + 关键图表锚点」。圆点标记已读/未读/章节级。
2. **结构图纸**（论证结构）：mermaid `flowchart` 风格的「问题→方法→结果 + 依赖」有向图，可跨章节重组；每个节点锚定 `sectionNo` 回链文档层。可折叠，带「渲染/原格式」切换与「复制图片」。

工具栏（笔记面板 header）：把现有两个视图 pill 收成一个**分段控件** `[笔记｜路线｜总揽]`，右侧**复用同一个变形动作按钮**——在「总揽」视图时显示 `生成总揽`/`更新总揽`。净增常驻按钮 = 0。命名用短词。

## 落位与持久化（Option 1：活视图 + state 同步 + 可选存笔记）

- 总揽视图是**只读 live DOM 视图**（非 Zotero 笔记）：骨架可点、图纸节点可点；二期支持随 Reader 滚动实时高亮当前节。
- 结构化数据缓存进 chat-history / state，**随现有 WebDAV `state.json` 同步** → 跨设备从缓存实时重渲染，无需为同步存 PNG。
- 工具栏「保存」按钮可选地把当前总揽**快照成「AI 全文总揽」笔记**（图纸转 PNG + 骨架文字），用于永久收进 Zotero 笔记。该写操作复用现有 `appendToChildNote`（需审批）。

## 架构与组件

数据流：
```
模型决定要总揽
 └─ zotero_outline_pdf      （读：廉价骨架；harness 侧，无审批）
       ├─ arXiv 条目 → 复用 loadArxivSections / buildToc
       └─ 普通 PDF → detectOutline(全文缓存) 启发式；检出过少→等距窗口兜底
 └─ render_paper_overview   （渲：模型据骨架产出结构化总揽；无 Zotero 写，仅渲染+缓存）
       └─ 经回调推给 sidebar → 渲染 live 总揽视图 + 写入 chat-history/state 缓存
 └─（按需）点骨架/节点 → note-pdf-link 跳 PDF；点「保存」→ 快照成笔记（审批）
```

新增 / 改动：

1. **`src/context/pdf-outline.ts`（新）** — `detectOutline(fullText, policy) → OutlineEntry[]`。纯函数、可单测。检测数字标题（`1`、`3.1`）、全大写节名（ABSTRACT/INTRODUCTION/REFERENCES…）、短行标题；检出 < 阈值时退化为 N 个等距窗口（每段首句预览 + char range）。附带抓取 `Figure N:` / `Table N:` 行作为 anchors。
2. **`zotero_outline_pdf` 工具**（`src/context/agent-tools.ts`） — arXiv 走现有 sections，否则走 `detectOutline`；输出统一 JSON（见数据契约）。`planMode: "outline"`。
3. **`render_paper_overview` 工具**（`src/context/agent-tools.ts`） — 入参为结构化总揽（sections + flowchart）。校验后经 `onOverviewReady`（仿 `onMindmapReady`）回调推给 sidebar，渲染视图并缓存。
4. **`src/modules/mermaid-flowchart.ts`（新）** — `parseMermaidFlowchart(src) → MindmapData`：支持 `flowchart/graph TD|LR`、`A[..] --> B`、`-->|label|`、基本节点形状。
5. **`src/modules/markdown-render.ts`** — `flushCode` 在 `parseMermaidMindmap` 返回 null 时再试 `parseMermaidFlowchart`（让对话区/任意 mermaid flowchart 也能渲染，而不是退成代码块）。
6. **`src/providers/types.ts`** — `MindmapEdge` 加可选 `label`；`MindmapData` 加可选 `rankdir`；`MindmapNode` 加可选 `sectionNo`。
7. **`src/modules/mindmap-render.ts`** — `renderMindmapSvg` 读 `data.rankdir`（默认沿用 LR）；绘制边标签；节点 `data-section-no` 供点击回链。
8. **笔记面板 UI**（`src/modules/note-dedicated.ts` / `src/modules/sidebar.ts`） — 分段切换器 + 变形动作按钮的第三组状态；总揽 live 视图渲染（骨架列表 + 图纸 SVG）；点击跳转复用 `src/modules/note-pdf-link.ts`。
9. **缓存/同步**（`src/settings/chat-history.ts` / `src/sync/state.ts`） — 持久化 + 同步总揽结构化数据（per item）。
10. **`src/context/policy.ts`** — 新增 `outlineCharBudget`、`outlinePreviewChars`、`maxOutlineEntries`、`outlineFallbackWindows`。

## 数据契约（`zotero_outline_pdf` / `render_paper_overview`）

```json
{
  "title": "…",
  "source": "arxiv | pdf",
  "coverage": "headings | uniform-fallback",
  "sections": [
    { "no": "3", "level": 1, "title": "Method",
      "gist": "编码器→掩码流模块→解码器。",
      "charStart": 8120, "charEnd": 15040,
      "pageLabel": "3", "anchors": ["Fig.4"] }
  ],
  "flowchart": {
    "rankdir": "TD",
    "nodes": [ { "id":"m", "label":"掩码流场", "type":"section", "sectionNo":"3" } ],
    "edges": [ { "source":"m", "target":"r", "label":"" } ]
  }
}
```

- `zotero_outline_pdf` 返回 `sections`（含 section 原文预览供模型写 gist）+ 元信息；gist 由模型生成。
- `render_paper_overview` 接收模型补全 gist 后的 `sections` + 模型构造的 `flowchart`。

## 状态机

生成中（骨架占位）｜成功（headings）｜检测失败→等距降级｜arXiv 高质量｜无全文缓存（提示打开 PDF）｜非 PDF 条目（隐藏视图）｜超长论文（骨架不受影响，深读受 `fullPdfTokenBudget` 限制）。

## 分期

- **一期**：取数（`zotero_outline_pdf` + `detectOutline` + 等距兜底）、渲染（flowchart 解析器 + 渲染器改动）、`render_paper_overview` + live 视图、工具栏方案 A、点击跳转、state 缓存/同步、可选存笔记。
- **二期**：伴读「你在这」——随 Reader 滚动高亮当前节、已读节填实（接 Reader 滚动事件 + 位置↔章节映射）。

## 测试

- `pdf-outline.test.ts`：数字标题、全大写节名、子节层级、检出过少→等距兜底、anchors 抓取。
- `mermaid-flowchart.test.ts`：`flowchart TD/LR`、边标签、节点形状、非 flowchart 返回 null（不抢 mindmap）。
- `agent-tools.test.ts`：`zotero_outline_pdf`（arXiv vs 普通 PDF 分支、预算裁剪）、`render_paper_overview`（校验 + 回调）。
- 渲染器：`rankdir` 与边标签快照/结构断言。

## 风险

- 普通 PDF 标题检测启发式不可靠 → 等距兜底保证「覆盖」永远成立。
- 图纸"论证层"可能归纳失真 → 节点锚 `sectionNo`，可回查原文。
- live 视图托管在面板：只读，规避键盘/焦点冲突；SVG 复用现有渲染器。
