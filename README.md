# Zotero AI Sidebar

[English](README.md) | [中文](README.zh-CN.md)

An AI research assistant that lives inside Zotero. Ask about the paper you're reading; the sidebar reads its PDF (or the arXiv LaTeX source when available), shows its work, and writes back to your notes.

> 👀 **[Illustrated usage guide →](https://xuhan-rgb.github.io/zotero-ai-sidebar/quick-start.html)** (pure-HTML, product-faithful UI: overview · model config · chat · Quick Ask · immersive/full translation · notes & overview · shortcuts)

📖 [Full usage guide](docs/USAGE.md) ([中文](docs/USAGE.zh-CN.md)) — quick start, workflows, reference, and troubleshooting.

## What you can do with it

- **Ask anything about the paper you're reading** — *"summarize this"*, *"what's the core contribution"*, *"compare with X"*. The model fetches the parts of the PDF it needs and shows its work in a tool trace.
- **Choose API or WEB for each conversation** — use configured API presets directly, or mirror ChatGPT, DeepSeek, and custom ChatGPT-like sites through a local Web Agent. WEB mode keeps the website's current model/search/thinking state, reports staged progress, and incrementally mirrors the growing answer into Zotero.
- **Open Quick Ask anywhere and keep following up** — press `Alt+Q` by default for a temporary conversation that remembers turns while the window stays open, is destroyed on close, and can be explicitly transferred into the current paper's research chat.
- **See the whole paper at a glance** — generate a *全文总览* map: a phase-grouped section skeleton (motivation / method / validation) with one-line gists, innovation / result markers, and a structural flowchart. Click a section to jump to that spot in the PDF; your reading position is remembered per paper and synced across machines.
- **arXiv papers come through clean** — equations and figures are pulled from the LaTeX source instead of broken PDF text. *"Explain Eq. (3)"* and *"walk me through Figure 2"* actually work.
- **Immersive PDF translation** — turn on immersive mode, click a sentence to get a translation card in place; walk the paper with `Enter` / `Shift+Enter`, `/` jumps the cursor into the ask box, and `Esc` closes the card while keeping the sentence on the reading highlight.
- **Write back into Zotero** — append answers to the paper's note, or ask the model to add color-coded highlights to the PDF (gated by per-preset permission).
- **Bring your own model** — Anthropic, OpenAI, or any OpenAI-compatible endpoint; all configured locally in Zotero preferences.
- **Local-first, and you own the sync target** — nothing leaves this machine until you turn on WebDAV sync, which pushes a single `state.json` to *your own* endpoint. It carries settings, model presets (API keys included), chat history, PDF annotations, and translation cache — never to zotero.org or any third party.

## Install

1. Download the latest `zotero-ai-sidebar.xpi` from [GitHub Releases](https://github.com/xuhan-rgb/zotero-ai-sidebar/releases/latest).
2. Open Zotero 7, 8, or 9.
3. Go to `Tools` -> `Plugins`.
4. Click the gear icon and choose `Install Plugin From File...`.
5. Select the downloaded `.xpi` file and restart Zotero if prompted.

Installed plugins also update automatically: each release publishes `update.json` / `update-beta.json` to a fixed `release` Release, which the plugin's `update_url` checks, so both stable and preview installs are offered new versions in-place.

### What's new in v0.8.1

- **WEB paper context is cleaner**: the current paper is uploaded as a real LaTeX/PDF attachment, while the separate arXiv directory TXT contains only the section hierarchy, numbers, and titles.
- **WEB answers can become PDF annotation drafts**: whole-paper highlighting and selection explanation recognize the structured annotation block, locate verbatim quotes locally, and let you preview, relocate, and explicitly save the matches to Zotero without calling a model API.
- **API and WEB controls are now clearly separated**: WEB uses the website's own network/model/search state and paper-attachment flow, so the API-only `Network` and `Original` toggles are disabled there. Enter and the send arrow share the same live account check, and the footer/status layout has been tightened for narrow sidebars.

## Configuration

Open the AI Sidebar settings in Zotero and configure at least one model preset:

- Provider: `anthropic` or `openai`
- API key: stored locally in Zotero preferences
- Base URL: official endpoint or an OpenAI-compatible endpoint
- Model: any model ID supported by that endpoint
- Max tokens / tool iterations: local safety and output controls

Configure PDF translation in the **Immersive reading** section:

- Default translation model — immersive reading always uses this account, model, and reasoning effort; arXiv full-document translation inherits it on first use, then remembers its own selection from the translation toolbar
- Result position (above or below) / card size — controls the immersive translation card
- Neighbour context: send the previous and next sentence as context for a more accurate translation
- Key-term linking: highlight original ↔ translated key-term pairs, cross-lit on hover
- Shortcuts: next/prev sentence (default `Enter` / `Shift+Enter`), a selection quick-translate key (default Space), a focus-ask key (default `/`), and a collapse-toolbar key (default `h`), all remappable

Quick Ask opens with `Alt+Q` by default. It initially uses the active AI-chat model, then independently remembers the account, model, and reasoning effort selected inside Quick Ask; changing it does not modify the research chat or translation defaults.

Do not hardcode personal API keys, base URLs, or private model IDs in this repository.

### Optional WEB mode (Linux/X11)

WEB mode uses a local companion process and a dedicated Google Chrome profile. API mode does not need these components and is unaffected if the Web Agent is not installed.

Requirements: Node.js 20 or newer, Google Chrome, and `xclip`. From a checkout of this repository, install the companion into your Zotero data directory:

```bash
sudo apt install xclip
bash scripts/install-web-agent.sh "$HOME/Zotero"
```

Replace `$HOME/Zotero` if your Zotero data directory is elsewhere. Then select `WEB` in the composer, choose ChatGPT, DeepSeek, or a custom service, and click **Account**. Complete login in the temporary Chrome window and keep **Hide browser in the background while chatting** checked if desired; it is enabled by default.

The browser is minimized rather than replaced by a headless API: login, CAPTCHA, uploads, and each site's scripts still run in the dedicated Chrome profile. The plugin does not switch the site's fast/deep-thinking/search controls. The footer's service menu also contains **Manage third-party web pages…**; opening it does not change the active service. See [Web Agent troubleshooting](docs/WEB_AGENT_TROUBLESHOOTING.zh-CN.md) for current compatibility limits.

In WEB mode, paper material is attached automatically for paper-reading tasks. The composer’s **Network** and **Original** switches are API-only and therefore disabled; the website's own search state and the WEB attachment pipeline remain authoritative.

## Features

### Chat & UI

- **AI chat inside Zotero**: open a dedicated sidebar and discuss the current paper without leaving Zotero.
- **Stable browser-backed WEB chat**: send to ChatGPT, DeepSeek, or custom ChatGPT-like sites through a localhost-authenticated companion; account setup is opened from Zotero, the dedicated browser is hidden by default during chat, and staged progress plus incremental answer snapshots remain visible in the sidebar.
- **Temporary multi-turn Quick Ask**: press `Alt+Q` by default, ask follow-up questions in the same popup, copy the latest answer, or transfer every turn into the research chat. It neither reads research-chat history nor persists after the popup closes.
- **Configurable providers**: supports Anthropic, OpenAI, and OpenAI-compatible endpoints through local Zotero preferences. Model presets include connectivity tests and a per-preset model list with a footer switcher.
- **Quick prompts & slash commands**: customizable prompt buttons next to the composer plus built-in slash commands (`/arxiv-search`, `/web-search`) that expand into explicit instructions for the model.
- **Markdown output**: renders headings, lists, code blocks, quotes, links, thinking/context blocks, and tool-call traces.
- **Selection context bar**: when PDF text is selected, the composer shows whether the next turn is `只看选区` or `选区 + 全文`, with a one-turn full-text override and selection preview.
- **Customizable chat UI**: nickname and avatar (emoji or image URL) for both user and AI, plus an ordered list of empty-chat reminders that can be edited, reordered, or dismissed on hover. Per-message action placement and layout remain configurable.
- **Clean / debug copy modes**: copy the conversation as Markdown with the paper introduction, dialogue, and selected PDF text; debug mode also includes tool context, PDF snippets, model-input layout, and thinking summaries.

### Paper overview map

- **Whole-paper 全文总览**: a dedicated middle-column view — a core-summary narrative, a section skeleton grouped by phase (动机 / 方法 / 验证) with one-line gists and 创新 / 效果锚点 emphasis, collapsible subsections, and a folded structural flowchart. Generated on demand through the model's tool loop (`zotero_outline_pdf` → `render_paper_overview`); no automatic full-PDF send.
- **Click-to-jump with a sticky header**: clicking a section navigates the PDF to it (using the PDF's embedded outline when present — exact, scroll-to-top — with a text-match fallback). The header keeps a ↶ back-stack, an ↩ jump-to-`在读` control, and a 🔒 lock to browse without moving your anchor.
- **Export & save**: open the overview as a standalone HTML in the system browser (`↗ 浏览器`), and it's auto-saved as a child HTML attachment on the item so it rides Zotero's own sync.
- **Reading position remembered & synced**: each paper's `在读` anchor persists across restarts and travels in `state.json`.
- Caveat: section jumping relies on the PDF's outline / text matching (no SyncTeX), so for sections that aren't in the PDF's own outline the landing spot can be approximate.

### PDF & research tools

- **Model-driven Zotero tools**: follows a Codex-style tool loop; no local keyword/regex intent planner decides what PDF content to send.
- **PDF context tools**: current item metadata, annotations, PDF search, PDF range reading, full PDF reading, and selected-text context.
- **Selected-text source tracing**: selected passages are preserved in chat bubbles and Markdown exports, with a jump control back to the original PDF selection when Zotero provides location data.
- **Image context**: attach screenshots/images so the model can analyze figures, UI states, or PDF screenshots. The toolbar screenshot button captures a Reader region on Linux and Windows.
- **Customizable annotation color guide**: edit the natural-language rubric the model uses when picking PDF highlight colors, with a default that maps Zotero's six preset hexes to common review categories (background, problem, method, dataset, results, etc.).
- **arXiv paper tools**: `paper_search_arxiv` and `paper_fetch_arxiv_fulltext` let the model search arXiv and fetch full text on demand.

### Notes

- **Unified note-column navigation**: one segmented switcher (笔记 · 路线 · 总览) flips between the AI note, the reading route, and the paper overview — switching only navigates, never regenerates. A generated view shows a centered 生成 button while empty and a header `↻ 更新` once it exists, so reading route and overview behave the same way. The note view's `⋯` menu holds 对话总结, which digests the immersive-reading Q&A into the note and replaces its prior digest in place instead of stacking duplicates.
- **In-pane note editor**: open a note column alongside the chat to edit Zotero's rich note in place, with an assistant-to-note write tool.
- **Model-driven note writes**: the model can also call `zotero_append_to_note` on its own to append assistant output to the current item's child note, auto-creating one when none exists.
- **Cursor-aware note imports**: select part of an assistant response, right-click `Import to note`, and the snippet is inserted at the current Zotero note cursor instead of always appending.
- **Stable note position**: after writing to a note, the note pane restores the previous scroll / mouse anchor / caret position instead of jumping to the top.
- **Back to original PDF selection**: exported note blocks and assistant context chips include a `View original selection` jump so you can return from notes or chat to the PDF passage that produced the answer.

### Translation

- **Immersive PDF translation**: turn on `沉浸` (immersive) in the PDF Reader toolbar, then click a sentence for an in-place card (original + translation, cheapest path). The card can switch to interleaved EN/中文 (逐句对照), key-term linking (重点词对应), neighbour context (结合上下句), and adaptive width — and you can keep asking (追问) for an explanation or examples.
- **arXiv full-document translation**: when a paper has the `LaTeX 源` badge, open a reconstructed full-paper reader and switch between bilingual / translation / source and parallel / interleaved layouts. Click the model name in its toolbar to choose the account, model, and reasoning effort; the first run inherits the translation default, then remembers an independent selection.
- **Save & reuse translations**: save a card's translation as a Zotero highlight annotation (💾); if the sentence already carries one, the card shows that saved note instead of re-translating, and saving upserts by key so you never get duplicate highlights. While immersive mode is on, Zotero's native selection popup is suppressed so the card stays the single surface.
- **Stepping, quick-translate & ask**: `Enter` / `Shift+Enter` move to the next / previous sentence; selecting (or hovering) a sentence and pressing the quick key (default Space) translates it directly; `/` moves the cursor into the card's 追问 box (Enter is reserved for stepping); `Esc` closes the card while keeping the sentence on the reading highlight, so you can keep stepping; a collapse-toolbar key (default `h`) folds the card's meta bar and foot row down to just the composer. All keys are configurable in settings.

### Sync & config

- **Config backup & restore**: export/import model presets (API keys included), UI settings, quick prompts, tool/MCP settings, and translation settings as a single JSON file — handy for moving a setup to a new machine. The file holds your keys, so keep it private.
- **WebDAV cloud sync**: push and pull a single `state.json` snapshot to a WebDAV endpoint (e.g. Nutstore) — model presets (API keys included), UI settings, quick prompts, tool/MCP settings, translation settings, AI chat history, sentence-translation cache, full PDF annotations (highlight / underline / note / ink), per-item paper overviews, and reading positions (the `在读` anchor).
- **Auto sync**: disabled by default; when enabled, startup and every 10 minutes pull from cloud first, merge local chat/cache data, then push the merged state back to WebDAV.
- **Non-destructive chat sync**: cloud chat messages are appended when missing locally; existing local-only chat messages are preserved.
- **You-controlled secrets**: API keys, base URLs, and model IDs live in Zotero prefs and are never hardcoded in source or sent to zotero.org / the plugin author / any third party. They *do* travel inside your own `state.json` (WebDAV sync) and config-export file — both are private artifacts you control, so treat them like any file that holds credentials. The WebDAV account password itself is never written into the snapshot.

## Architecture

```mermaid
flowchart TB
    User([You])

    subgraph UI[Zotero main window]
        direction LR
        Side[AI sidebar]
        PDF[PDF Reader]
        Note[Note editor]
        Side --> PDF
        Side --> Note
    end

    subgraph Local[Local data boundary]
        direction LR
        Core[(Zotero library<br/>items + Zotero annotations)]
        Files[(Attachment files<br/>storage/*)]
        PluginState[(Plugin sync state<br/>presets + API keys / UI / prompts / tools+MCP<br/>chat / translation cache / PDF annotations)]
        Secrets[(Local-only<br/>WebDAV account password)]
    end

    subgraph Runtime[Runtime integrations]
        direction LR
        Provider[LLM provider API<br/>OpenAI / Anthropic / compatible]
        WebAgent[Local Web Agent<br/>localhost token + task queue]
        Browser[Dedicated Chrome profile<br/>manual login + site state]
        Tools[Local AgentTool<br/>optional automation]
    end

    subgraph Cloud[Cloud sync targets]
        direction LR
        ZoteroOrg[(zotero.org<br/>metadata sync)]
        FileDAV[(WebDAV<br/>Zotero File Sync)]
        PluginDAV[(Plugin WebDAV<br/>state.json)]
        WebApps[(AI web apps<br/>ChatGPT / DeepSeek / custom)]
    end

    User -->|prompt / selection / screenshot| Side
    Side <-->|HTTPS| Provider
    Side <-->|localhost| WebAgent
    WebAgent --> Browser
    Browser <-->|HTTPS| WebApps
    Side -->|tools| Tools
    Tools --> Core
    Side --> Secrets
    Side --> PluginState
    Core --- Files

    Core -.items + Zotero annotations.-> ZoteroOrg
    Files -.attachment sync.-> FileDAV
    PluginState -.push / pull.-> PluginDAV

    classDef actor fill:#fff7ed,stroke:#fb923c,color:#7c2d12,stroke-width:1px;
    classDef zotero fill:#eef2ff,stroke:#818cf8,color:#312e81,stroke-width:1px;
    classDef local fill:#ecfeff,stroke:#06b6d4,color:#164e63,stroke-width:1px;
    classDef runtime fill:#f5f3ff,stroke:#a78bfa,color:#4c1d95,stroke-width:1px;
    classDef cloud fill:#f0fdf4,stroke:#22c55e,color:#14532d,stroke-width:1px;
    class User actor;
    class Side,PDF,Note zotero;
    class Core,Files,PluginState,Secrets local;
    class Provider,WebAgent,Browser,Tools runtime;
    class ZoteroOrg,FileDAV,PluginDAV,WebApps cloud;
    style UI fill:#f8fafc,stroke:#c7d2fe,stroke-width:1px
    style Local fill:#ecfeff,stroke:#67e8f9,stroke-width:1px
    style Runtime fill:#faf5ff,stroke:#d8b4fe,stroke-width:1px
    style Cloud fill:#f0fdf4,stroke:#86efac,stroke-width:1px
```

### Three-layer cloud-sync split

```mermaid
flowchart LR
    subgraph Local[Local machine]
        direction TB
        Lib[(Zotero library metadata<br/>items + Zotero annotations)]
        Storage[Zotero attachment files<br/>storage/*]
        Plugin[Plugin sync state<br/>presets + API keys / settings / prompts<br/>chat history / translation cache / full PDF annotations]
        Secrets[Local-only<br/>WebDAV account password]
    end
    subgraph Cloud[Cloud]
        direction TB
        ZS[zotero.org<br/>metadata sync]
        WD1[WebDAV<br/>Zotero File Sync writes]
        WD2[WebDAV plugin namespace<br/>plugin state snapshot]
        NoCloud[Password never enters state.json]
    end
    Lib <-->|metadata sync| ZS
    Storage <-->|file sync| WD1
    Plugin <-->|push / pull| WD2
    Secrets -.never synced.-> NoCloud

    classDef local fill:#ecfeff,stroke:#06b6d4,color:#164e63,stroke-width:1px;
    classDef cloud fill:#f0fdf4,stroke:#22c55e,color:#14532d,stroke-width:1px;
    classDef blocked fill:#fff1f2,stroke:#fb7185,color:#881337,stroke-width:1px,stroke-dasharray:4 3;
    class Lib,Storage,Plugin,Secrets local;
    class ZS,WD1,WD2 cloud;
    class NoCloud blocked;
    style Local fill:#ecfeff,stroke:#67e8f9,stroke-width:1px
    style Cloud fill:#f8fafc,stroke:#cbd5e1,stroke-width:1px
```

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build a local XPI:

```bash
npm run build
```

The build output is written to `.scaffold/build/`. Local `.xpi` files are ignored by Git and should not be committed.

### Code structure

The native Zotero-pane sidebar entry is `src/modules/sidebar.ts`, which keeps the core chat orchestration (panel render, send/stream, reader selection, note-window orchestration) and delegates focused concerns to sibling modules — `sidebar-state` (shared state/types), `reader-access` → `pdf-navigation` → `note-pdf-render` (the reader/PDF-jump/quote subsystem), plus `pdf-geometry`, `client-rect-geometry`, `message-scroll`, `selected-text-format`, `prompt-cache-debug`, `reading-route-note`, `overview-attachment`, and more. See the **Code Reference Map** in [`CLAUDE.md`](CLAUDE.md) for the full file map.

## Release

After `/auto-commit` updates the version, run `npm run release:xpi` — it tags, pushes, builds via GitHub Actions, and publishes the Release in one step. Flags (`--republish`, explicit tag) and verification details are in [`docs/RELEASE.md`](docs/RELEASE.md).

## Design notes

Project-specific modification guidance (Codex-style agent direction, Claudian-style chat UI, Better Notes-inspired note editing, non-negotiables) lives in [`CLAUDE.md`](CLAUDE.md). Tool / Web Search / MCP usage is in [`docs/TOOLS_AND_MCP.md`](docs/TOOLS_AND_MCP.md).

## License

AGPL-3.0-or-later.
