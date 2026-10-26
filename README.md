# Zotero AI Sidebar

English | [中文](README.zh-CN.md)

An AI research assistant inside Zotero. Discuss papers using PDF text, arXiv LaTeX sources, annotations, and images; translate while reading and save useful answers to Zotero notes.

[Download](https://github.com/xuhan-rgb/zotero-ai-sidebar/releases/latest) · [Illustrated guide](https://xuhan-rgb.github.io/zotero-ai-sidebar/quick-start.html) · [Usage guide](docs/USAGE.md) · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/xuhan-rgb/zotero-ai-sidebar/issues/new/choose)

## Features

- **Paper conversations** — ask about the current paper or a selected passage. In API mode, the model retrieves context through Zotero tools, with visible tool-call traces and source links when location data is available.
- **API and WEB modes** — use Anthropic, OpenAI, or an OpenAI-compatible endpoint, or chat through ChatGPT, DeepSeek, ChatGLM, Z.ai, Kimi, and custom ChatGPT-like websites with a local Web Agent.
- **Paper material and references** — use `@` to attach figures, tables, formulas, or other Zotero papers. Refer to several papers in one question to compare them or analyze the current paper.
- **Translation while reading** — translate sentences in place, ask follow-up questions, and save translations as annotations. Full-document reading uses available arXiv LaTeX source or a MinerU-parsed PDF.
- **Notes, reading routes, and overviews** — edit Zotero rich-text notes beside the paper, generate a reading route or section overview, jump back to the source, and export these views to PDF.
- **Quick Ask** — open a temporary multi-turn conversation with `Alt+Q`. Transfer it to the paper's research chat when needed; closing the popup discards its temporary conversation.
- **Configurable workspace** — switch interface language, edit quick prompts, choose model presets and reasoning effort, and adjust chat layout. Queued messages stay sequential within a chat; separate chats can run in parallel.
- **Backup and sync** — keep settings and reading data locally, export a JSON backup, or sync plugin state to a WebDAV endpoint you configure. See [Data and privacy](#data-and-privacy) for what is sent and stored.

## Quick start

### 1. Install the plugin

The plugin manifest targets **Zotero 7–10** on Windows, Linux, and macOS.

1. Download `zotero-ai-sidebar.xpi` from [GitHub Releases](https://github.com/xuhan-rgb/zotero-ai-sidebar/releases/latest).
2. In Zotero, open **Tools → Plugins**.
3. Click the gear icon, choose **Install Plugin From File…**, and select the `.xpi`.
4. Restart Zotero if prompted, then select a paper or open its PDF and open the **AI** sidebar.

Installed plugins can receive updates through Zotero's plugin updater. WEB users should follow the account dialog after an upgrade to check the paired Web Agent runtime.

### 2. Choose a chat mode

|               | API                                           | WEB                                                       |
| ------------- | --------------------------------------------- | --------------------------------------------------------- |
| Connection    | Configured model endpoint                     | AI website through a local Web Agent                      |
| Setup         | API key, Base URL, model ID                   | Node.js 20+, supported browser, website login as required |
| Models        | Anthropic, OpenAI, OpenAI-compatible services | ChatGPT, DeepSeek, ChatGLM, Z.ai, Kimi, custom sites      |
| Paper context | Zotero tools and explicitly attached context  | Paper material and references uploaded as attachments     |
| Controls      | Plugin model, reasoning, and tool settings    | Website model, search, and thinking settings              |

API mode does not require Node.js, a browser, or the Web Agent. Select `API` or `WEB` in the composer footer.

### 3. Ask about a paper

Complete the matching [API](#api-setup) or [WEB](#web-setup) setup below, then try:

> Summarize this paper's core contribution, explain its method, and identify its main limitations.

Select a passage before asking to include that selection, or use `@` to add paper material and references. In API mode, inspect the tool trace to see what the model read. Save a useful answer to the paper's note or select part of an answer and choose **Import to note**.

## API setup

Open **AI Sidebar settings**, add a model preset, and fill in:

| Field    | Value                                                                  |
| -------- | ---------------------------------------------------------------------- |
| Provider | `anthropic` or `openai`; use the latter for OpenAI-compatible services |
| API key  | The credential for your chosen endpoint                                |
| Base URL | The provider's endpoint or your compatible service URL                 |
| Model    | A model ID supported by that endpoint                                  |

Run **Test connection**, save the preset, and select it in the chat footer.

Optional settings include output-token limits, tool-iteration limits, and per-model reasoning effort. Reasoning choices are saved per account preset and model; available levels depend on model support. See the [model preset reference](docs/USAGE.md#31-model-presets).

## WEB setup

WEB mode runs a local companion process with a dedicated browser profile. It supports automatically detected **Chrome, Microsoft Edge, and Firefox**, plus custom Chromium-compatible browsers.

Requirements:

- **Node.js 20 or newer** for all browsers, including Firefox.
- A supported browser installed on the computer.
- On Linux, **`xclip`**. On Debian/Ubuntu, install it with `sudo apt install xclip`; use your distribution's package manager elsewhere.

To connect:

1. Select **WEB**, choose a website, and click **Account**.
2. Follow the environment check. Missing dependencies have download links or installation instructions; the plugin does not install Node.js or a browser for you.
3. Click **Install**, **Repair**, or **Upgrade Web Agent** as prompted. The plugin downloads the prebuilt runtime paired with the XPI and verifies its size and SHA-256. End users do not run npm.
4. Sign in to the website in the dedicated browser. **Hide browser in the background while chatting** is enabled by default.
5. Return to Zotero and send your question. The sidebar shows task progress and mirrors the website's answer.

If downloading fails, use the Release link and local ZIP picker in the account dialog. Select the `zai-web-agent-runtime.zip` paired with your XPI.

<details>
<summary>Node.js detection and manual paths</summary>

Node detection first reuses a validated saved path, then checks the process PATH and standard installation locations. If those do not provide Node.js 20+, it scans version directories under `~/.nvm`, `~/.config/nvm`, `NVM_DIR`, and `XDG_CONFIG_HOME/nvm`, verifying the executable's actual version. This works even when a desktop-launched Zotero does not inherit an interactive terminal's NVM environment. A working saved Node is kept rather than automatically upgraded.

The account dialog always shows **Node.js path settings**, expanded by default; you can collapse it when it is not needed. The field displays the detected Node path when available, and the section reopens if Node is missing. It accepts a full executable path, a directory containing `node` / `node.exe`, or an installation directory containing `bin/node`. Use **Choose Node executable…** or paste the path, then click **Validate and use** (or press Enter). Choosing a file fills the field; validation saves the path and rechecks the environment. The path is saved only after validation succeeds; installation scripts such as `install.sh` are rejected. Changing the Node path is blocked while WEB tasks are running or queued. No installation script is run automatically.

</details>

<details>
<summary>Browser selection and login profiles</summary>

Open the small arrow next to **Account** (`账号 ▾`). The website selector chooses the AI service; the account menu chooses which browser runs it. The main **Account** button still opens the selected website directly in the saved browser. The account dialog also provides a browser-selection entry.

- **Chrome / Edge / Firefox**: choose a browser from the native dropdown. The program-path field displays the detected or saved executable path. Choosing an option keeps the configuration menu open; click **Apply browser selection** (`应用浏览器选择`) to save.
- **Custom installation path**: edit the complete executable path or use **Choose program file…** (`选择程序文件…`). Select the browser executable, not a document or shortcut: `chrome.exe` / `msedge.exe` on Windows, the browser launcher on Linux, or the executable inside the app's `Contents/MacOS/` directory on macOS.
- **Recover a mistaken path**: for Chrome, Edge, or Firefox, click **Detect again** (`重新检测`). This ignores the saved path and searches the normal installation locations and PATH. Review the result, then apply it; detection alone does not save or launch the browser.
- **Add another browser**: choose **＋ Add another browser…** (`＋ 添加其他浏览器…`), enter a name, select its executable, and click **Save and use** (`保存并使用`). The saved entry appears in the dropdown. Custom browsers must support the existing Chromium remote-debugging connection; saving a path does not verify compatibility or add support for another browser engine.
- **Remove a manually added browser**: select its entry and click **Remove this browser** (`移除此浏览器`). The browser program and login data are kept. Removing the current entry first switches to another available browser; this is blocked while WEB tasks are running or queued, or when no replacement is available. Built-in browser entries cannot be removed.

Click outside the configuration menu to dismiss it without applying changes. Browser choice is shared by all WEB services and does not affect API mode. Each browser entry has a separate login profile; switching back reuses it. Running or queued WEB tasks must finish before switching browsers. Existing Chrome configurations are preserved; a fresh setup with only Edge detected selects Edge automatically.

</details>

<details>
<summary>Firefox sessions and Linux Snap installations</summary>

Firefox uses a persistent profile and supports visible login and headless conversations. Executable detection uses the current computer's PATH, home directory, and system installation locations; it does not embed a developer's home directory. If a saved Firefox executable is missing, the account environment check redetects a local installation and replaces missing profile paths from another computer with a directory under the current Zotero profile. Valid existing login profiles are preserved.

Firefox account setup reuses the startup page, and conversations reuse the existing service page. The pinned browser driver adopts Firefox's initial window rather than creating an extra one. Switching from a custom Firefox entry to the built-in entry for the same executable reuses the active login profile when the destination has no saved profile. Before a plugin-controlled Firefox restart, session cookies are saved privately inside that profile and restored once on startup; cookies and local storage normally persisted by Firefox remain in its profile. Website logout and expired sessions can still require a new login.

On Linux, detection recognizes both native and Snap Firefox, preferring a native installation when both are found automatically. Snap Firefox uses a dedicated profile under the current user's `~/snap/firefox/common/zotero-ai-sidebar/`, with separate directories for each Zotero profile. Native and Snap login profiles are recorded separately and reused when switching back. PDF, text, and image attachments are copied to per-task staging directories inside this accessible area before upload or file-clipboard fallback; task cleanup removes the staged copies and preserves the originals. Browser download staging also uses this accessible directory. No browser is installed automatically. The Web Agent also detects a native installation at `~/.local/opt/firefox/firefox`, resolving `~` to the current user's home. Automatic window minimization through Chrome's CDP is unavailable for Firefox; services that keep a visible browser session (ChatGLM and Z.ai) may require manual minimization.

</details>

<details>
<summary>Runtime updates and website behavior</summary>

Web Agent has no independent release version and uses the ZIP paired with the current XPI. Installation and explicit updates verify the ZIP size and the checksum embedded in the XPI, then record the installed checksum. After an XPI update, the recorded checksum is compared once; an identical package is reused. Normal startup, opening WEB mode, and sending messages do not download archives, scan files, or recompute checksums; only local health checks run. Legacy installations without a recorded checksum need the paired package installed once. Failed updates preserve existing files and login settings without enabling an unmatched old package.

ChatGLM and Z.ai keep a visible browser session when hidden; other services close the setup window and start the selected browser headlessly as needed. Firefox may require manual minimization for services that retain a visible window. The dedicated profile does not read your everyday browser's login data.

Z.ai supports guest text chat, but attachments require login. Keep the browser open while the account dialog detects the website session, then choose **Finish and hide** or **Finish and keep visible**. A browser-profile avatar does not indicate website login.

The plugin keeps the website's model, search, and thinking state. The composer's **Network** and **Original** switches are API-only and disabled in WEB mode. Paper-reading tasks attach available paper material automatically; figures referenced only by paths in text are not uploaded as images. Use `@` or image attachments when the website needs to see a figure.

Each `@`-referenced Zotero paper is uploaded as a separate text attachment, alongside current-paper material and any prior-chat attachment. The plugin does not truncate readable reference text in API or WEB mode, but model context and website upload limits still apply.

Use **Manage third-party web pages…** in the service menu to configure a custom site. See the [WEB tutorial](docs/USAGE.md#212-use-a-built-in-website-through-web-mode) and [Web Agent troubleshooting](docs/WEB_AGENT_TROUBLESHOOTING.zh-CN.md) (Chinese) for details and compatibility limits.

</details>

## Reading and everyday use

| Task                               | How to start                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask about a passage                | Select PDF text, then ask in the sidebar; review the selection context before sending.                                                        |
| Attach a figure, table, or formula | Type `@` or click **Material** (`Ctrl+Shift+M` by default). Pictures are sent as images; table/formula markers expand to source text on send. |
| Compare papers                     | Choose several Zotero articles with `@`, then describe the comparison in your question.                                                       |
| Translate a sentence               | Enable **Immersive** in the PDF Reader toolbar, then click a sentence or use the quick-translate key (Space by default).                      |
| Read a full translation            | Open full-document translation using available LaTeX source, or configure a MinerU token to parse an ordinary PDF.                            |
| Create a reading guide             | Open the note column and select **Route** or **Overview**; generate once, then update explicitly when needed.                                 |
| Keep an answer                     | Save it to a note, import a selected answer fragment, or export a note, reading route, or overview from its `⋯` menu.                         |

The full-document reader for parsed PDFs supports interleaved paragraphs, sentence line breaks, and original-PDF comparison. Material availability depends on LaTeX source or MinerU parsing. Direct PDF picking needs parsed page locations; LaTeX-only material remains available from the list. Overview jumps use PDF outlines or text matching, so some destinations can be approximate.

**Model defaults:** immersive reading uses the translation model configured under **Immersive reading**. Full-document translation inherits it on first use, then remembers its own model choice. Quick Ask initially uses the active chat model and subsequently remembers an independent account, model, and reasoning choice.

**Language and layout:** choose **Follow system / 中文 / English** under **Settings → Display settings → Interface language**. Chinese system locales use Chinese; other locales fall back to English, with Zotero's interface language used if the system locale is unavailable. Built-in prompts and saved copies of their defaults follow the interface language; user-edited prompts retain their text. AI response language is controlled by the prompts actually sent, editable under **Quick prompts**. The reader sidebar and side-by-side layout remember their widths separately.

**Default shortcuts** (remappable in settings):

| Context           | Shortcut                | Action                                           |
| ----------------- | ----------------------- | ------------------------------------------------ |
| Zotero            | `Alt+Q`                 | Open Quick Ask                                   |
| PDF material      | `Ctrl+Shift+M`          | Pick material                                    |
| Immersive reading | `Enter` / `Shift+Enter` | Next / previous sentence                         |
| Immersive reading | `Space`                 | Quick-translate the selected or hovered sentence |
| Immersive reading | `/`                     | Focus the follow-up question box                 |
| Immersive reading | `Esc`                   | Close the card and keep the reading highlight    |
| Immersive reading | `h`                     | Collapse the card toolbar                        |

See the [usage guide](docs/USAGE.md) for annotation permissions, quick prompts, queues, token usage, and detailed workflows.

## Data and privacy

Settings, chat history, prompts, and reading caches are stored locally. **Local storage does not mean offline AI processing:** API requests send prompts and supplied context to the configured model endpoint, using its API key; WEB requests send messages and attachments to the selected website. Using MinerU parsing uploads the PDF to that service.

- **Optional WebDAV sync** sends a `state.json` snapshot to your configured endpoint, including model presets, UI and tool settings, prompts, chats, annotations, translation cache, overviews, reading positions, and network-diagram workspace data.
- **API keys are included** in model presets inside sync snapshots and exported configuration backups. Keep these files private. The WebDAV account password is not included in `state.json`; it is used to authenticate with your WebDAV server.
- **Automatic sync is off by default.** When enabled, it pulls, merges, and pushes at startup and every 10 minutes. Chat merging preserves local-only messages.
- **Zotero sync is separate:** Zotero handles library metadata and its configured attachment sync; plugin WebDAV sync handles plugin state. It does not replace attachment backup or Zotero library sync.

Read the [sync guide](docs/USAGE.md#28-sync-chats-and-config-across-devices-webdav) before configuring another device.

## Documentation

| Document                                                                                          | Contents                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Illustrated guide](https://xuhan-rgb.github.io/zotero-ai-sidebar/quick-start.html)               | Interface overview and common workflows                                                                           |
| [Usage guide](docs/USAGE.md) / [中文](docs/USAGE.zh-CN.md)                                        | Setup, feature reference, and troubleshooting                                                                     |
| [Web Agent troubleshooting](docs/WEB_AGENT_TROUBLESHOOTING.zh-CN.md)                              | Website behavior and compatibility limits (Chinese)                                                               |
| [Tools and MCP](docs/TOOLS_AND_MCP.md)                                                            | Local tools, web search, and MCP boundaries                                                                       |
| [Harness engineering](docs/HARNESS_ENGINEERING.md) / [Context protocol](docs/CONTEXT_PROTOCOL.md) | Tool execution and context handling                                                                               |
| [Changelog](CHANGELOG.md) / [中文](CHANGELOG.zh-CN.md)                                            | Version history; release assets are on [GitHub Releases](https://github.com/xuhan-rgb/zotero-ai-sidebar/releases) |

## Development

From the repository root:

```bash
npm ci
npm test
npm run build
```

The test and build scripts prepare the Web Agent dependencies automatically. The build produces both artifacts in `.scaffold/build/`:

- `zotero-ai-sidebar.xpi` — Zotero plugin.
- `zai-web-agent-runtime.zip` — paired Web Agent runtime.

Do not commit generated artifacts or personal credentials.

| Path                                                        | Responsibility                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| [`src/modules/`](src/modules/)                              | Sidebar, reader integration, note windows, Web Agent client |
| [`src/providers/`](src/providers/)                          | Model adapters, streaming, and tool execution               |
| [`src/context/`](src/context/)                              | Zotero tools, paper context, retrieval, and reading state   |
| [`src/translate/`](src/translate/)                          | Immersive and full-document translation                     |
| [`src/settings/`](src/settings/) / [`src/sync/`](src/sync/) | Preferences, persistence, backups, and WebDAV sync          |
| [`addon/`](addon/)                                          | Manifest, styles, preferences UI, and localization          |
| [`web-agent/`](web-agent/)                                  | Browser automation runtime and website adapters             |
| [`tests/`](tests/)                                          | Automated tests                                             |

See [CLAUDE.md](CLAUDE.md) for project conventions and the detailed code map.

### Publishing a release

Update and commit the version in `package.json`, then run `npm run release:xpi` from a clean working tree. The script runs tests and a local build, tags and pushes the release, and waits for GitHub Actions to publish the XPI and paired runtime. See the [release guide](docs/RELEASE.md) for requirements and republishing options.

## Feedback

Use [Issues](https://github.com/xuhan-rgb/zotero-ai-sidebar/issues/new/choose) for bug reports, feature requests, or usage questions. Chinese and English forms are available. Include the plugin/Zotero versions, operating system, API or WEB mode, reproduction steps, and relevant errors; remove credentials before sharing logs.

## License

[AGPL-3.0-or-later](LICENSE).
