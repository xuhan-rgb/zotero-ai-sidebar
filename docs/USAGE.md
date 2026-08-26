# Zotero AI Sidebar — Usage Guide

English | [中文](USAGE.zh-CN.md)

This document targets **end users** and is split in two halves:

1. **5-Minute Quick Start** — install → configure → ask a question with PDF context → save the answer to a Zotero note.
2. **Reference Manual** — every feature, organized by task: where to find it, what each field does, and the gotchas worth knowing.

> Install steps and the bare-minimum config are already in [README.md](../README.md); this guide does not repeat them.
> See [Troubleshooting](#troubleshooting) and [Related docs](#related-docs) at the bottom.

---

## Contents

- [1. 5-Minute Quick Start](#1-5-minute-quick-start)
- [2. Common Workflows](#2-common-workflows)
  - [2.1 Ask the AI about a section or selection](#21-ask-the-ai-about-a-section-or-selection)
  - [2.2 Translate a PDF immersively (Immersive mode)](#22-translate-a-pdf-immersively-immersive-mode)
  - [2.3 Let the AI add highlights / annotations to the PDF](#23-let-the-ai-add-highlights--annotations-to-the-pdf)
  - [2.4 Use slash commands for arXiv or web search](#24-use-slash-commands-for-arxiv-or-web-search)
  - [2.5 Distill answers into a paper note](#25-distill-answers-into-a-paper-note)
  - [2.6 Read arXiv papers with exact equations and figures](#26-read-arxiv-papers-with-exact-equations-and-figures)
  - [2.7 See the whole paper at a glance (overview map)](#27-see-the-whole-paper-at-a-glance-overview-map)
  - [2.8 Sync chats and config across devices (WebDAV)](#28-sync-chats-and-config-across-devices-webdav)
  - [2.9 Back up and migrate config](#29-back-up-and-migrate-config)
  - [2.10 Use Quick Ask for a temporary multi-turn conversation](#210-use-quick-ask-for-a-temporary-multi-turn-conversation)
  - [2.11 Read an arXiv paper in full-document translation](#211-read-an-arxiv-paper-in-full-document-translation)
  - [2.12 Use a built-in website through WEB mode](#212-use-a-built-in-website-through-web-mode)
- [3. Reference Manual](#3-reference-manual)
  - [3.1 Model presets](#31-model-presets)
  - [3.2 Sidebar UI map](#32-sidebar-ui-map)
  - [3.3 Agent tools](#33-agent-tools)
  - [3.4 Slash commands](#34-slash-commands)
  - [3.5 PDF immersive translation](#35-pdf-immersive-translation)
  - [3.6 Quick prompts](#36-quick-prompts)
  - [3.7 Note-editing panel](#37-note-editing-panel)
  - [3.8 Screenshots and multimodal input](#38-screenshots-and-multimodal-input)
  - [3.9 PDF highlight color rubric](#39-pdf-highlight-color-rubric)
  - [3.10 WebDAV cloud sync](#310-webdav-cloud-sync)
  - [3.11 Config export / import](#311-config-export--import)
  - [3.12 Chat history](#312-chat-history)
  - [3.13 arXiv LaTeX source mode](#313-arxiv-latex-source-mode)
  - [3.14 Paper overview map & reading routes](#314-paper-overview-map--reading-routes)
  - [3.15 API and WEB chat modes](#315-api-and-web-chat-modes)
  - [3.16 Empty-chat signatures](#316-empty-chat-signatures)
- [Troubleshooting](#troubleshooting)
- [Related docs](#related-docs)

---

## 1. 5-Minute Quick Start

### Step 1 · Configure your first model preset

Open Zotero `Tools → Plugins`, click the gear icon next to *Zotero AI Sidebar*, and open settings. (Or: open the sidebar with no preset configured — it drops you straight into the "Add preset" form.)

Four fields are required:

| Field | Purpose |
|---|---|
| Provider | `anthropic` / `openai` / any OpenAI-compatible endpoint |
| API key | Stored in Zotero prefs; leaves this machine only inside *your own* WebDAV `state.json` or a config-export file — never to zotero.org or third parties |
| Base URL | Official endpoint, or your self-hosted reverse proxy |
| Model | Any model id supported by that endpoint (e.g. `claude-opus-4-7`, `gpt-5`) |

Click **Test connection** — failures fail loudly. Save the preset.

> You can save multiple presets. The sidebar footer shows a switcher you can flip mid-conversation.

### Step 2 · Open the sidebar

The sidebar lives in Zotero's **Item Pane / Reader Context Pane** as the *AI* tab.

Pick any paper in the main library. The sidebar binds to that item — chat history, context traces, and notes are kept per-paper.

### Step 3 · Ask your first question

A solid starter prompt:

```
Summarize this paper in 5 lines, then call out its core contribution and biggest limitation.
```

Hit Enter or click **Send**. If the item has a PDF attached, the model will autonomously call `zotero_get_current_item` (for metadata + abstract) and `zotero_get_full_pdf` / `zotero_search_pdf` (for body text). **The tool loop is model-driven — no local keyword routing decides what to fetch.**

### Step 4 · See which tools the AI used

Each AI message renders two collapsible blocks above its body:

- **Thinking** — reasoning summary (when the provider supplies one).
- **Tool trace** — every `zotero_*` / `paper_*` call this turn, with its arguments and return.

`★ Tip — if an answer feels invented, check the trace first. No PDF tool calls means the model never read the paper. Usually that's because (a) max tool iterations is too low, or (b) the item has no PDF attached.`

### Step 5 · Save the answer to a note

Two paths:

1. **Manual** — hover any AI message, click **Copy** or **Save to note** (placement and label are configurable in settings).
2. **Let the AI write it** — say "append this summary to the note for this paper". The model calls `zotero_append_to_note`; if no child note exists, it creates one automatically.

That closes the loop: **read paper → AI interprets → permanent record in Zotero**.

---

## 2. Common Workflows

### 2.1 Ask the AI about a section or selection

Two ways to scope what the AI looks at:

**By default, the whole paper is in context** — the `📄 原文` toggle next to the composer is on. Ask anything, the model sees the full paper. Best for "summarize", "what's the contribution", "compare with related work".

**To focus on a passage**: select text in the Reader. A *selection chip* (with a character-count preview) appears above the composer. Ask your question — the selection is added on top of the pinned paper context, so the model still knows the surrounding context but focuses on what you highlighted.

**To use selection only (no full paper)**: click `📄 原文` to turn pinning off (a one-time dialog explains the trade-off). The toggle is remembered per paper.

**One-turn override**: flip `+ 本轮原文` above the composer to escalate just one question to the full paper, without changing the global setting.

**Watch out for:**
- Disabling `原文` saves tokens but can leave the model without crucial context for whole-paper questions ("what does this paper conclude" with `原文` off may fail).
- The selection chip never auto-clears — click × on the chip when you're done with it.
- The sidebar doesn't re-render when the PDF selection changes; the chip is the only visible signal.

### 2.2 Translate a PDF immersively (Immersive mode)

Best for: first read of a non-native-language paper, or speed-building whole-paper comprehension.

1. Open the PDF in the Reader. Click **沉浸 (Immersive)** on the sidebar toolbar to enter immersive mode. Hovering a sentence shows a "reading" highlight.
2. **Click** any sentence for an in-place card (original + translation, cheapest path); or **select (or hover)** a sentence and press the **quick-translate key (default Space)** to translate just that sentence.
3. The card can switch to **interleaved EN/中文** (逐句对照), **key-term linking** (重点词对应), **neighbour context** (结合上下句) and **adaptive width**; the footer lets you **💾 save** the translation as a Zotero highlight annotation (if the sentence already has one, it's shown instead of re-translating) or keep asking (**追问**) for an explanation or examples.
4. **Enter** advances to the next sentence, **Shift+Enter** goes back; **/** jumps the cursor into the card's 追问 box (Enter is reserved for stepping); **h** collapses the toolbar down to just the composer; **Esc** closes the card while keeping that sentence on the reading highlight, so you can keep stepping.
5. Click **沉浸** again to exit and return the PDF to normal scroll/select.

Tunables and shortcuts: see [§3.5](#35-pdf-immersive-translation).

### 2.3 Let the AI add highlights / annotations to the PDF

The model can **actually write** Zotero annotations, not just produce text. These tools are blocked by default — they require **approval or YOLO mode**.

Write tools:

- `zotero_add_annotation_to_selection` — highlight the current selection in a chosen color, with an optional comment.
- `zotero_add_text_annotation_to_selection` — add a text-only annotation at the selection.
- `zotero_annotate_passage` — let the model pick sentences across a larger passage and highlight them in batch.

Sample prompt:

```
Read §3 (Method). Highlight in different colors: problem statement,
method steps, dataset, and headline results.
```

The model first reads context (`zotero_search_pdf` / `zotero_read_pdf_range`), then issues highlight calls. Every write **shows up in the trace** — you can audit or undo retrospectively.

Color mapping: see [§3.9](#39-pdf-highlight-color-rubric).

In **WEB mode**, **🔖 全文重点** sends the paper context to the active web model and asks it to append a structured annotation manifest after its normal reply. The sidebar keeps the complete web reply, recognizes the manifest even when the website wraps it in a JSON code block, locates each verbatim quote in the current PDF with local algorithms, and shows a previewable “PDF annotation draft” card. You can preview or relocate matches before clicking **Save all located entries**. **Explain selection** uses the same path when the web answer includes `建议注释`, so its suggested comments can be reused on the selected passage. Zotero is modified only after an explicit save. This path does not call a model API and does not change the existing API-mode tool, approval, or YOLO behavior.

### 2.4 Use slash commands for arXiv or web search

Type `/` in the composer to surface command suggestions. Two are built-in:

| Command | Usage | What it does |
|---|---|---|
| `/arxiv-search` | `/arxiv-search <query or arXiv URL>` | Tells the model the user explicitly wants arXiv search or paper inspection — model picks the best tool (general search, or the precise arXiv-source tools if the current item has a cached LaTeX source) |
| `/web-search` | `/web-search <query>` | Calls the built-in web-search tool (provider-side feature; must be enabled in settings) |

Slash commands don't run logic locally — they just inject "the user explicitly chose this" into the prompt and let the model decide how to act.

### 2.5 Distill answers into a paper note

The note panel is designed as a **work area independent from the chat**: opening, editing, or closing it never re-renders chat, resets composer drafts, or interrupts streaming.

- **Manual** — open the note panel beside the Reader and edit rich text directly. The underlying engine is Zotero's official `<note-editor>` / `EditorInstance`, so list behavior, Enter/Backspace, focus, and autosave match the rest of Zotero.
- **AI write** — invoke `zotero_append_to_note`. The tool finds (or creates) the paper's child note and appends.
- **Hybrid** — let the AI summarize, then hand-edit. Same loop as code review.

### 2.6 Read arXiv papers with exact equations and figures

For arXiv papers, the plugin automatically downloads the LaTeX source and reads from it instead of the PDF text layer. Equations arrive at the model verbatim instead of as garbled `f l θ`-style fragments from the PDF.

**You'll know it's active when** a `LaTeX 源` badge appears next to the paper title in the sidebar.

**How to use it:**

- **Ask about an equation by number** — "What does Equation (3) say?" / "Walk me through Eq. 5." The plugin pulls the exact LaTeX of that equation.
- **Ask about a figure by number** — "Walk me through Figure 2." The figure image appears inline in the chat, and follow-up questions ("what's in the bottom-right of that figure?") still have the image available to vision-capable models.
- **Ask about a table by number** — "Summarize Table 1." The plugin pulls the table source.
- **Ask about a section by name** — "Explain the Method section." The plugin fetches just that section instead of the whole paper.

**Watch out for:**
- The first question on a new arXiv paper takes a few extra seconds — the source is being downloaded and cached.
- Use **numbers** ("Figure 2", "Eq. 3", "Table 1"), not descriptions ("the figure with the loss curves"). The lookup is by number/label.
- Very old papers or papers where the author chose to withhold source will silently fall back to the PDF flow — your prompt doesn't have to change.

See [§3.13](#313-arxiv-latex-source-mode) for details on what changes under the hood.

### 2.7 See the whole paper at a glance (overview map)

Best for: deciding which sections are worth a close read before you sink time into the PDF, and keeping your place across sessions and machines.

The overview map is the **总览** view — one of three tabs in the note column (`AI 笔记` / `阅读路线` / `总览`). It is *not* a note: it's a generated, clickable map of the paper that lives beside the Reader.

1. Open the note column (toolbar **Open Note**), click the **总览** tab, then **生成总览** in the top-right. The model runs `zotero_outline_pdf` (a cheap whole-paper skeleton — no full-PDF send) then `render_paper_overview`.
2. You get: a 2–4 sentence **核心讲述**, a **section skeleton grouped by phase** (动机与背景 / 方法 / 验证与结论) with a ≤30-char gist per section and **创新 / 效果锚点** markers, collapsible subsections, and a folded structural **flowchart**.
3. **Click any section to jump the PDF to it.** The map uses the PDF's embedded outline for an exact scroll-to-top when present, with a text-match fallback otherwise.
4. The sticky header tracks where you are: `↩ 在读 N` jumps back to your reading anchor, `↶ 返回 N` steps back through where you've been (and moves the PDF too), and the **🔒 lock** lets you browse other sections without moving your `在读` anchor.
5. **`↗ 浏览器`** opens the full overview as a standalone HTML page in your system browser. The overview is also auto-saved as a child HTML attachment on the item, so it rides Zotero's own sync.

**Your reading position is remembered and synced.** Each paper's `在读` anchor survives restarts and travels in `state.json` (WebDAV).

> **Reading routes (`阅读路线`)** are the note-based cousin: the morphing route button (`生成路线` → `阅读路线` → `更新路线`) generates a reading guide saved into a dedicated *AI 阅读路线* child note. Regenerating overwrites the AI section but preserves your own `「我的补充笔记」`. Use the overview map to *navigate*, the route note to *keep editable prose*.

**Watch out for:**
- Section jumping relies on the PDF outline / text matching (no SyncTeX), so for sections not in the PDF's own outline the landing spot can be approximate.
- For non-arXiv PDFs the skeleton uses heuristic heading detection; if it can't find headings it falls back to even-sized windows (the header shows `· 估算分段`).
- The overview is generated on demand — it never sends the full PDF automatically.

### 2.8 Sync chats and config across devices (WebDAV)

Use case: keep chat history, prompt library, and UI settings consistent between desktop and laptop.

1. In settings, fill in WebDAV endpoint (URL, user, password). Nutstore, self-hosted Nextcloud, anything WebDAV-compatible works.
2. **Push** packages this machine's state into a single `state.json` and uploads it.
3. **Pull** downloads `state.json` and overwrites local state.
4. **Auto sync** is off by default; when enabled, startup and every 10 minutes run download-and-merge, then upload.

What `state.json` contains:

- ✅ Chat threads (per-paper conversations, thinking, tool traces, image metadata)
- ✅ Model presets **including API keys**, plus UI settings, quick prompts, tool/MCP settings, translation settings
- ✅ Sentence-translation cache (cached translations for already translated sentences)
- ✅ PDF annotations (highlight / underline / note / ink), matched by PDF + annotation key, last-write-wins by modified time
- ✅ Per-item paper overviews and reading positions (the `在读` anchor)
- ❌ **PDF files are not uploaded** (those go through Zotero File Sync on a separate WebDAV path)
- ❌ The **WebDAV account password** is never written into `state.json`

Because `state.json` carries your keys, the WebDAV endpoint is yours to protect — it's your own server, never zotero.org or the plugin author.

`★ Three-layer split` — (1) zotero.org for library metadata, (2) Zotero File Sync for PDFs over WebDAV, (3) this plugin for `state.json` over WebDAV. The three layers are decoupled; killing one does not break the others.

### 2.9 Back up and migrate config

If you don't want WebDAV, plain export/import works:

- **Export** writes a JSON file with model presets (**API keys included**), UI settings, quick prompts, tool/MCP settings, and translation settings.
- **Import** loads that JSON on the new machine — keys come across too, nothing to re-enter.
- Because the file holds your keys, keep it private: don't paste it into a public issue or a shared drive.

### 2.10 Use Quick Ask for a temporary multi-turn conversation

Use this when you want to ask a few questions without switching or adding noise to the current paper's research chat. You can also select text in the PDF or full-document translation view first and ask about that passage.

1. Press `Alt+Q` by default. Remap it under `Settings → Immersive reading → Quick Ask`; the shortcut is ignored while focus is inside an editable field.
2. If PDF text or full-translation source text was selected before opening, Quick Ask attaches it to the first turn. Without a selection, the model can still use read-only tools to inspect the current paper when needed.
3. Ask the first question. After the answer, a compact **Continue asking** composer stays at the bottom. Later requests include the completed turns from this popup, so follow-ups such as “why?”, “give another example”, and “how could this claim be verified?” work directly.
4. Click the model summary or **Model settings** to change the account, model, and reasoning effort. The first use follows the active AI-chat model; later Quick Ask remembers its own selection without changing the research chat or translation defaults.
5. **Copy** copies only the latest answer. **Transfer to research chat** writes every turn from this popup into the current paper's research chat, then closes Quick Ask.

Quick Ask does not read saved research-chat history and exposes no write tools. Press `Esc`, use the close button, or click the backdrop to destroy the entire temporary conversation; reopening starts a new one.

### 2.11 Read an arXiv paper in full-document translation

When the current paper shows the `LaTeX 源` badge, click **全文翻译 (Full translation)** beside it to open a reconstructed full-paper reader. This requires an available arXiv LaTeX source, so ordinary PDFs and arXiv entries without public source do not show the entry point.

- Use **中英 / 中文 / 英文** for bilingual / translation / source display, and **左右 / 逐段** for parallel / interleaved layout. **阅读设置** also controls source color, font size, line height, and paragraph spacing.
- Click the model name in the progress bar to open **Account / Model / Reasoning effort** selectors. The first use inherits the **Default translation model** from settings; after a change, full-document translation remembers an independent global selection and does not modify the immersive-reading default.
- **开始翻译 (Start)** translates pending blocks. After interruption it becomes **继续翻译 (Continue)** without clearing completed work; use **重新翻译 (Retranslate)** only when you want to rebuild all translations.
- The full-translation view can stay beside the AI sidebar. Select source or translated text and press `Alt+Q` to start a temporary multi-turn Quick Ask about it.
- Click **返回 PDF (Back to PDF)** to exit the full-translation reader.

### 2.12 Use a built-in website through WEB mode

WEB mode mirrors a real AI website into the Zotero conversation. It is useful when you want to use a website account instead of an API key. API mode remains independent and does not need Chrome or the companion process.

**One-time installation (Windows / Linux / macOS):**

1. Install Node.js 20 or newer and Google Chrome. Linux additionally needs `xclip`:

   ```bash
   sudo apt install xclip
   ```

2. Install the XPI. In the composer footer select **WEB**, choose **ChatGPT**, **DeepSeek**, **ChatGLM**, or **Kimi**, then click **Account**.
3. The account dialog checks the environment automatically. When Node.js or Chrome is missing it provides an official download button; when Linux `xclip` is missing it provides copyable installation guidance. The plugin never runs an installer or system command. After resolving the dependency, click **Check environment again**, then use **Install**, **Repair**, or **Upgrade Web Agent** as shown. The plugin downloads the matching prebuilt runtime from the version's GitHub Release, verifies its size and SHA-256, and continues only after the protocol and runtime-version health check passes. The user's computer does not run npm. If automatic download fails, open or copy the provided link, download the ZIP in a browser, and select it in the same dialog.
4. Complete login in the temporary Chrome window. Keep **Hide browser in the background while chatting** checked to minimize the dedicated browser after setup; this is the default.

**Daily use:**

1. Select **WEB** and the destination service. The service menu also lists saved custom sites and **Manage third-party web pages…**. Opening the manager does not change the active service.
2. Ask normally and press Enter or click the send arrow. Both use the same live account check; if the selected website is not configured or no longer logged in, sending stops and the sidebar asks you to open **Account**. The sidebar then reports preparation, upload, submission, generation, and synchronization progress; growing website answers are mirrored incrementally instead of appearing only at the end.
3. Paper-reading tasks attach the current paper automatically through the website's real file input. A cached LaTeX main file is preferred when available; otherwise the PDF is used. For arXiv items, a separate TXT attachment contains only the section hierarchy, numbers, and titles—not Zotero tool instructions or section bodies. If a site has no usable file input, the task fails explicitly instead of flashing the browser and using clipboard fallback.
4. Ask for **whole-paper highlights** or **selection explanation** when you want annotation suggestions. The prompt tells the web model how to return the structured manifest; the plugin parses it from the normal answer and builds a local draft. Review the matched page and quote before saving.
5. A generated website file is exposed only when the site provides a real attachment or downloadable URL. A textual `sandbox:/...` path is not a downloadable file.

Press `Esc` or the composer **Stop** button to cancel a running WEB task. Any answer already mirrored into Zotero is kept and marked as cancelled; retrying the message uses the same website again. Login, quota, server, and unsupported-upload notices detected on the website are shown as error responses instead of being mistaken for normal answers.

The Web Agent uses a dedicated Chrome profile and a random localhost bearer token. It does not read your normal Chrome profile. Login, CAPTCHA, uploads, and website scripts still require a real browser, so “hidden” means minimized—not a headless API. Zotero does not change the site's fast/deep-thinking/search switches; the current website state is authoritative.

---

## 3. Reference Manual

### 3.1 Model presets

Each preset is a complete `provider + endpoint + model + parameters` set. Save as many as you like, named.

| Field | Required | Purpose |
|---|---|---|
| Provider | ✓ | `anthropic` or `openai`; selects the SDK path |
| Display name | | Shown in the footer switcher |
| API key | ✓ | Stored in local prefs; included in your own `state.json` and config-export file, never sent to zotero.org / third parties |
| Base URL | ✓ | Official endpoint or OpenAI-compatible reverse proxy |
| Model | ✓ | Model id, e.g. `claude-opus-4-7`, `gpt-5` |
| Max output tokens | | Output length cap |
| Max tool iterations | | A **safety fuse** — the maximum tool-loop steps per turn. **Not a task-routing knob.** Setting it too low makes the model abandon PDF reads partway through |
| Reasoning / Thinking | | Enable reasoning effort (OpenAI) or extended thinking (Anthropic); the model must support it |
| Agent permission mode | | Governs write tools: blocked / approval-required / YOLO |

**Test connection** issues a minimal request to validate endpoint + key.

Each preset maintains its own model list — same base URL, different model ids, fast switch.

### 3.2 Sidebar UI map

Top to bottom:

```
┌───────────────────────────────────────────────┐
│  [打开笔记] [沉浸] [设置] [🎚] [调试]          │  ← toolbar
├───────────────────────────────────────────────┤
│  Paper title  [LaTeX 源]                      │  ← metadata (badge on arXiv items)
├───────────────────────────────────────────────┤
│  AI: ...                                       │  ← message stream
│  ┌─ Thinking (collapsed) ─┐                    │
│  └────────────────────────┘                    │
│  ┌─ Tool trace (collapsed) ─┐                  │
│  └──────────────────────────┘                  │
│  You: ...                                      │
├───────────────────────────────────────────────┤
│  [📎 Selection: "..." × ]                     │  ← chip (selection / images)
│  [📄 原文]  [+ 本轮原文]  [🌐 联网]            │  ← context toggles
│  ┌─────────────────────────┐                   │
│  │  / ...                   │                   │  ← composer
│  └─────────────────────────┘                   │
│   Preset switcher                       [Send] │  ← footer
└───────────────────────────────────────────────┘
```

Things to know:

- **Toolbar controls** (left to right):
  - **打开笔记 (Open Note)** — opens the note column.
  - **沉浸 (Immersive)** — toggles immersive PDF translation (click a sentence for an in-place card).
  - **设置 (Settings)** — opens the full Zotero preferences pane for this plugin: model presets / API keys / display / translation / sync.
  - **🎚** — a slider-icon button; click it to open a small popup with the chat **字号 (font size)** selector.
  - **调试 (Debug)** — a toggle. When ON, **复制MD** includes the tool context, PDF passages, and thinking; when OFF it copies only the paper intro and the conversation.
- **`📄 原文` toggle** (on by default): pins the paper's text into every turn. Turn it off for selection-only questions; click `+ 本轮原文` for a one-time full-paper send.
- **`LaTeX 源` badge** appears next to the title when the paper is being read from its arXiv LaTeX source. Equations come out exact. See [§3.13](#313-arxiv-latex-source-mode).
- **Note column tabs** (via **Open Note**): `AI 笔记` / `阅读路线` / `总览` — the default note, the reading-route note, and the overview map.

### 3.3 Agent tools

Useful when reading the tool trace — these are the names you'll see.

**Reading the paper (always available):**

| Tool | What it does |
|---|---|
| `zotero_get_current_item` | Title, authors, year, abstract, tags |
| `zotero_get_annotations` | Existing highlights/notes on this paper |
| `zotero_search_pdf` | Keyword search across the PDF |
| `zotero_read_pdf_range` | Read a specific page or paragraph range |
| `zotero_get_full_pdf` | Pull the full PDF text in one call |
| `zotero_get_current_pdf_selection` | The text you have selected in the Reader |
| `zotero_get_reader_pdf_text` | Text of the current page |
| `chat_get_previous_context` | Re-inspect earlier context without spending tokens replaying it |
| `paper_search_arxiv` | Search arXiv (any paper, not just the current one) |
| `paper_fetch_arxiv_fulltext` | Fetch full text of an arXiv paper by query/URL |
| `draw_article_mindmap` | Generate a mindmap of the paper structure |
| `zotero_outline_pdf` | Cheap whole-paper skeleton (headings, char ranges, first-line previews, figure/table anchors) without reading the full PDF — the first step for an overview |
| `render_paper_overview` | Render the overview map (核心讲述 + phase-grouped section skeleton + flowchart) into the **总览** view; called after `zotero_outline_pdf` |

**Reading arXiv source** (only visible to the model when the current paper has a cached LaTeX source — see [§3.13](#313-arxiv-latex-source-mode)):

| Tool | What it does |
|---|---|
| `arxiv_list_sections` | List the section index (titles, sizes) — cheap way to scout before fetching |
| `arxiv_get_section` | Fetch one section's body, by name or number |
| `arxiv_get_equation` | Fetch a numbered equation as exact LaTeX |
| `arxiv_get_figure` | Fetch a figure by number/label — image is attached as multimodal context |
| `arxiv_get_table` | Fetch a table by number/label, cleaned from the source |
| `arxiv_get_bibliography` | Fetch the bibliography |

**Writing to Zotero (blocked by default — needs approval or YOLO mode in the preset):**

| Tool | What it does |
|---|---|
| `zotero_add_annotation_to_selection` | Highlight current selection in a chosen color, with optional comment |
| `zotero_add_text_annotation_to_selection` | Text-only annotation at the selection |
| `zotero_annotate_passage` | Batch-highlight sentences across a passage |
| `zotero_append_to_note` | Append content to this paper's child note (creates one if missing) |

Every write call shows up in the tool trace so you can audit (or undo via Zotero's normal annotation list).

### 3.4 Slash commands

Type `/` in the composer to open completion. The two built-in commands:

| Command | Usage | What it does |
|---|---|---|
| `/arxiv-search` | `/arxiv-search <query or arXiv URL>` | Signals "I want to search / read arXiv." The model picks the best tool itself — general arXiv search, or the more precise arXiv-source tools when the current item has a cached LaTeX source |
| `/web-search` | `/web-search <query>` | Signals "I want a web search." The model calls the built-in web-search tool to answer |

**What they are** — slash commands are **explicit shortcuts, not switches, and they run no local logic**. They only inject "the user explicitly chose this action" into your message; the model still decides which tool to call. This is the plugin's Codex-style invariant: **no local keyword router guesses your intent**.

**When to use them** — most of the time you don't need them: as long as the question is clear, the model picks the right tool on its own (e.g. with the **联网 (web)** toggle on, it searches for real-time questions by itself). Their value is **disambiguation** — when a question is off-topic or vague relative to the current paper (e.g. asking about the weather while reading a paper), the model may first hesitate over "should I, and with which tool?"; an explicit `/web-search` makes it **act directly**: fewer detours, fewer repeated calls, fewer tokens.

**Caveats**

- `/web-search` **does not enable web search by itself**. The real gate is the **联网 (web)** toggle at the bottom-left of the composer (or Web search mode in settings). With it off, even `/web-search` only makes the model **honestly say search isn't enabled** rather than faking it.
- The built-in web search is a **provider-side hosted tool**; if your Base URL doesn't support it, it may not work even with the toggle on.
- Sending a command with no argument makes the model ask you for a query first.

### 3.5 PDF immersive translation

The **Default translation model** in Settings → Immersive reading controls the account, model, and reasoning effort used by the immersive card. arXiv full-document translation inherits it on first use, then can remember an independent selection from its own toolbar; neither surface overwrites the other. Result position, card size, and the options below apply to the immersive card.

| Setting (Immersive reading) | Meaning |
|---|---|
| Single-click opens the card | Off → show a "问 AI / 译" chooser strip first |
| Neighbour context | Send the previous + next sentence as context for accuracy |
| Key-term linking | Highlight original ↔ translated key-term pairs, cross-lit on hover |
| Next / previous keys | Default `Enter` / `Shift+Enter`, remappable |
| Selection quick-translate key | Default Space; only intercepted when a reading highlight / selection exists, otherwise Space still scrolls |
| Focus-ask key | Default `/`; with a card open, moves the cursor into the 追问 box (Enter is reserved for stepping) |
| Collapse toolbar key | Default `h`; folds the card's meta bar + foot button row down to just the composer |

The card can also toggle interleaved EN/中文 and adaptive width; `Esc` closes it and keeps the sentence on the reading highlight.

Use 💾 to save the current translation as a Zotero highlight annotation; if the sentence already has one, reopening shows that saved note instead of re-translating, and saving upserts by key (no duplicate highlights on the same sentence).

While immersive mode is active, Zotero's native selection popup is suppressed to avoid colliding with the card, and returns on exit. Translations are cached by sentence-content hash — translating the same sentence again does not re-call the model.

### 3.6 Quick prompts

A row of **one-click prompts** beside the composer — e.g. *"Summarize"*, *"Explain the method"*, *"Pull out the experimental numbers"*. Each button's label and its prompt template are editable in settings.

Use it to bind your own high-frequency questions to a single click.

### 3.7 Note-editing panel

Target layout: `PDF Reader | Note panel | AI chat`.

- **Engine** — Zotero's official `<note-editor>` / `EditorInstance`. Rich text (headings, lists, links, inline code, blockquotes) behaves identically to Zotero's main note editor.
- **Decoupled from chat** — opening, closing, or editing the note never re-renders the sidebar, resets composer drafts, or interrupts streaming.
- **AI writes** — `zotero_append_to_note` finds the paper's child note (or creates one) and appends.
- **Three tabs** — the note column header switches between `AI 笔记` (the default note that chat "Write to note" appends to), `阅读路线` (a dedicated *AI 阅读路线* reading-guide note; the button morphs `生成路线` → `阅读路线` → `更新路线`), and `总览` (the overview map view — see [§3.14](#314-paper-overview-map--reading-routes)). Regenerating a route overwrites its AI section but keeps your own `「我的补充笔记」`.

### 3.8 Screenshots and multimodal input

The toolbar **Screenshot** button captures a region of the PDF / Reader and attaches the result to the composer. Capture works on Linux (`gnome-screenshot` / `flameshot` / `import`) and Windows (Snip & Sketch area selection); on other platforms, drag-drop an image file instead. You can also drag-drop image files directly on any platform.

On send, images are passed as **real multimodal inputs** to the provider (not just shown locally). The model must support vision (Claude 3+, GPT-4o/5, etc.).

**arXiv figures count too** — figures pulled by the model from arXiv source appear in the chat and stay available for vision follow-up questions ("what's in the bottom-left of that figure?").

### 3.9 PDF highlight color rubric

Zotero's six default annotation colors are exposed by hex code. This plugin maps each color to a semantic label (background / problem / method / dataset / results / …) and injects the rubric as a natural-language prompt so the model can pick a color when calling `zotero_add_annotation_to_selection`.

The rubric is editable in settings — for a literature review you might switch to *"established / contested / my critique / …"*; the model will follow.

### 3.10 WebDAV cloud sync

| Item | Behavior |
|---|---|
| Endpoint | URL + user + password (use an *app password* where the service offers one) |
| Push | Uploads the current `state.json` |
| Pull | Downloads `state.json` and overwrites local state |
| Conflict policy | No automatic merge — last write wins; *you* are the source of truth |
| Path stability | Threads carry portable keys, so cross-machine migration survives itemID drift |

`★ The plugin uses a different WebDAV path from Zotero's built-in File Sync. Sharing the same WebDAV account is safe.`

### 3.11 Config export / import

| Field | Included |
|---|---|
| UI settings (nicknames, avatars, signatures, theme, action-button placement) | ✅ |
| Model presets | ✅ |
| API keys (inside the presets) | ✅ — keep the file private |
| Quick prompts | ✅ |
| Tool / MCP settings | ✅ |
| Translation settings | ✅ |
| Chat history | ❌ (use WebDAV for this) |
| PDF annotations | ❌ (use WebDAV for this) |

Right tool when you want to *carry config to a new machine but leave conversations behind*.

### 3.12 Chat history

- One thread per paper, bound to itemID (carried across machines via portable thread keys).
- Each message preserves: text, thinking (reasoning summary), tool trace, image attachment metadata.
- **Copy as Markdown** has two modes:
  - **Clean** — paper intro + dialogue. For sharing or blog posts.
  - **Debug** — full thinking, context traces, PDF snippets, error logs. For bug reports or auditing model decisions.

### 3.13 arXiv LaTeX source mode

For arXiv papers, the plugin reads from the LaTeX source instead of the PDF text. A `LaTeX 源` badge next to the paper title means this mode is active.

What changes:
- Equations come out as exact LaTeX, not garble from broken PDF text.
- Numbered references work — "Eq. (3)", "Figure 2", "Table 1" all map cleanly.

If the paper has no arXiv source available (no arXiv ID, source withheld, download failure), the plugin silently falls back to the PDF flow.

### 3.14 Paper overview map & reading routes

Two related ways to get a structural read on a paper, both reached from the note column header.

**总览 — the overview map** (a generated view, not a note):

| Element | What it is |
|---|---|
| `生成总览` / `更新总览` | Top-right button. Generates (or regenerates) the map through `zotero_outline_pdf` → `render_paper_overview`. No automatic full-PDF send |
| 核心讲述 | A 2–4 sentence summary of what the paper does and its contribution |
| Section skeleton | Sections in document order, grouped by phase — **动机与背景 / 方法 / 验证与结论** — each with a ≤30-char gist; subsections collapse |
| 创新 / 效果锚点 | Emphasis markers; `创新` sections call out what is *new*, `效果锚点` marks headline results / SOTA |
| Structural flowchart | A folded problem → method → result logic diagram |
| `↩ 在读 N` | Header control: jump back to your reading anchor |
| `↶ 返回 N` | Step back through visited sections (moves the PDF too) |
| 🔒 / 🔓 lock | Browse other sections without moving the `在读` anchor |
| `↗ 浏览器` | Open the full overview as standalone HTML in the system browser |

Click a section row to navigate the PDF to it — exact scroll-to-top via the PDF's embedded outline when present, text-match fallback otherwise. The map and the `在读` anchor are stored per item, auto-saved as a child HTML attachment, and synced inside `state.json`.

**阅读路线 — the reading-route note** (editable prose): the morphing route button generates a reading guide saved to a dedicated *AI 阅读路线* child note. Regenerating overwrites the AI-generated region but preserves your `「我的补充笔记」` section.

Caveat: jumping relies on the PDF outline / text matching (no SyncTeX); for non-arXiv PDFs the skeleton uses heuristic heading detection and may fall back to even-sized windows (`· 估算分段`).

### 3.15 API and WEB chat modes

| Control | API mode | WEB mode |
|---|---|---|
| Destination | A configured local model preset | ChatGPT, DeepSeek, ChatGLM, Kimi, or a custom ChatGPT-like site |
| Authentication | API key in Zotero prefs | Manual login in a dedicated Chrome profile |
| Tools | Zotero/model tool loop is available | Website answer mirroring; no API tool loop |
| Browser | Not used | Minimized by default after account setup |
| Progress | Provider streaming and tool traces | Five-stage task progress plus incremental DOM snapshots |
| Site mode | Controlled by preset parameters | Current website model/search/thinking state; Zotero does not switch it |
| Paper context | `Original` controls API prompt context | Attached automatically through the WEB file-upload flow |
| Network control | `Network` uses the configured API web-search feature | `Network` is disabled; use the website's own search control |

WEB footer controls are intentionally small:

- **Service menu** — switches ChatGPT, DeepSeek, ChatGLM, Kimi, and saved custom sites. Its final **Manage third-party web pages…** action opens URL management and restores the previous selection. A legacy custom `kimi.com` entry is migrated to the built-in Kimi service to avoid duplicate entries.
- **Account** — opens the current service for login and controls whether its dedicated browser stays minimized during chat.
- **Send** — Enter and the arrow follow the same path and perform a live account check immediately before submission.
- There are no Zotero-side fast/deep-thinking/search toggles. Change those on the website itself when the account window is visible.

### 3.16 Empty-chat signatures

Open `Settings → Zotero AI Sidebar → Display settings → AI signatures`:

- Each signature has its own input row and is limited to 80 characters. Use `＋ Add signature` to create another.
- Use `↑` / `↓` to change display order and `×` to delete one entry.
- When **Show AI signatures in empty chats** is enabled, the ordered group appears in the center of the empty conversation area while the ready message stays at the top.
- Hover the centered group to reveal `×`. Dismissing it disables display without deleting the list; re-enable it from settings.
- The group disappears as soon as the first message is sent, and returns only in a new or cleared empty conversation.
- Plugin upgrades preserve customized text, explicit empty lists, the disabled state, and user-defined order.
- Legacy strings separated by ASCII `;` or full-width `；` are migrated into ordered rows.

The defaults are:

1. `Why am I reading this paper? Keep the question in sight.`
2. `Answers can be borrowed, but the thinking must be your own.`

---

## Troubleshooting

### "WEB mode says the account is not configured"

Click **Account**, wait for the dedicated Chrome window, complete login, and make sure the page exposes an editable composer. Custom sites must be added through **Manage third-party web pages…** before account setup.

### "WEB mode is stuck / the answer does not update"

Check whether the progress card is still advancing. A stale companion is rejected before submission; open **Account** and click **Check and repair Web Agent** when the protocol warning appears. Closing Zotero during a running task can leave a persisted progress card, but it does not mean the website is still generating after the agent process has stopped.

If a live task needs to be interrupted, press `Esc` or click the composer **Stop** button. The partial answer remains in the conversation and is marked as cancelled; you can retry it without switching away from the selected WEB service.

### "Chrome appears while I ask a WEB question"

Open **Account** and enable **Hide browser in the background while chatting**. Hidden attachment upload only uses a real file input; when the site does not expose one, the task reports an error rather than focusing Chrome for clipboard paste. Login and CAPTCHA setup remain intentionally visible.

### "API call fails / 401 / 403"

1. Click **Test connection** to surface the exact error code.
2. Check the base URL — `/v1` suffix or trailing `/` mismatches are common.
3. For self-hosted reverse proxies, verify the corresponding API surface (OpenAI Responses for `openai`, Anthropic Messages for `anthropic`) is fully implemented.

### "AI didn't read the PDF / answer feels invented"

1. Confirm an item with a PDF attachment is selected in the main pane.
2. Open the trace — is `zotero_get_current_item` / `zotero_get_full_pdf` actually there?
3. If tools were truncated, raise the preset's **Max tool iterations**.
4. Provider rate-limited? The model may bail on the tool loop and answer cold; the trace will show the error.

### "Immersive translate does nothing / the quick key won't translate"

1. You must be in a Reader tab — not the main library pane — with **沉浸** toggled on in the toolbar.
2. The quick-translate key acts on the *current* sentence: hover or select a sentence (so it highlights) before pressing the key; with no highlight, Space just scrolls.
3. Other PDF-annotation extensions can intercept click events; disable temporarily and retry.

### "WebDAV push fails"

1. URL must end with `/`.
2. Nutstore, Mailbox, etc. require an **app-specific password**, not your login password.
3. The destination path must be writable, including subdirectory creation.

### "AI tries to annotate but is blocked"

Default is no-write. Two paths forward:

- Short-term: ask the AI to *describe* the highlights it wants (text + color), then add them by hand.
- Long-term: enable **YOLO mode** or the appropriate permission mode on that preset (per-preset, not global).

### "Sidebar jitters when the PDF selection changes"

That's an explicit anti-goal of the design. If you see it, suspect a stale extension or an old build — the selection chip is *explicit* UI and should not trigger a sidebar re-render.

### "Copy button drops thinking / tool calls"

Switch to **Debug** copy mode. **Clean** mode intentionally strips them — it is the share-friendly variant.

### "The model keeps reading the whole paper but I only want it to look at my selection"

That's the `📄 原文` toggle next to the composer (on by default). Click it to turn off — the next turn will rely only on the selection plus what the model fetches via tools. The setting is per-paper.

### "First question on an arXiv or math-heavy paper is slow"

Expected. The plugin is building a one-time per-paper cache (arXiv source download, or PDF formula cleanup for non-arXiv math). Subsequent questions on the same paper are fast.

### "On an arXiv paper, the model can't find Figure 2 / Equation 3"

Reference figures, equations, and tables **by number** ("Figure 2", "Eq. 3", "Table 1"), not by content description. The arXiv tools look up by number/label.

---

## Related docs

- [README.md](../README.md) — project intro, install, minimal config
- [docs/HARNESS_ENGINEERING.md](HARNESS_ENGINEERING.md) — design contract for the Codex-style agent loop (developer-facing)
- [docs/TOOLS_AND_MCP.md](TOOLS_AND_MCP.md) — Tool / Web Search / MCP decision guide
- [docs/MATH_RENDERING.md](MATH_RENDERING.md) — math rendering details
- [docs/RELEASE.md](RELEASE.md) — release flow
- [CLAUDE.md](../CLAUDE.md) — project modification constraints and non-negotiables
