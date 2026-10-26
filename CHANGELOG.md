# Changelog

Version history. For published builds and release details, see [GitHub Releases](https://github.com/xuhan-rgb/zotero-ai-sidebar/releases); [中文](CHANGELOG.zh-CN.md).

## v0.8.20

- **Stable sidebar toggles**: preserve the PDF reader width and chat reading position when hiding or reopening the AI sidebar. Create controls in their destination document to avoid Gecko document-adoption errors.
- **Settings and conversation backups**: local JSON backups include conversations, drafts, images, translation caches, annotations, and reading data alongside settings. Imports merge conversations, retain support for legacy settings-only backups, and stop while AI responses are running.
- **Clearer sync settings**: compact cloud-storage settings and help explain what Zotero sync, attachment storage, and plugin WebDAV sync each handle.
- **Reorganized documentation**: Chinese and English READMEs put installation and API / WEB setup first, keep advanced environment instructions expandable, and clarify data handling. Version history is consolidated here.
- **Upgrade**: install the new XPI and restart Zotero. WEB users should follow the account dialog to check the paired runtime. Backup JSON contains API keys and conversation content; keep it private.

## v0.8.19

- **Firefox in WEB mode**: choose Firefox alongside Chrome and Edge. Native and Snap installations keep separate login profiles, and attachment staging supports Snap's accessible directories.
- **Node.js setup**: detect NVM installations even when Zotero starts from the desktop, or choose a Node executable or installation directory in the account dialog. Path settings stay available and validate before saving.
- **More reliable Web Agent setup**: health checks, runtime downloads, and startup waits use Gecko timers in Zotero's sandbox.
- **Browser management and documentation**: remove manually added browser entries while preserving their login data; Chinese and English setup instructions cover Firefox and Node detection.
- **Upgrade**: install the new XPI and restart Zotero. WEB users should follow the account dialog to check the paired runtime; existing settings and browser login profiles are preserved.

## v0.8.18

- **Prompts follow the interface language**: built-in quick prompts, tool guidance, WEB paper actions, translation instructions, and continuation prompts use Chinese or English according to the interface setting. Saved copies of built-in defaults follow the selection; user-edited prompts are preserved.
- **Sidebar visibility is remembered**: reopening Zotero restores whether the sidebar was open, along with the saved layout and widths. Fresh profiles start with it collapsed.
- **Composer and message styling**: upward model menus remain visible outside the API footer, reasoning labels follow the UI language, and headings in user messages use compact spacing and body-size text.
- **Upgrade**: install the new XPI and restart Zotero. WEB users should follow the account dialog to check the paired runtime; existing settings and browser login profiles are preserved.

## v0.8.17

- **Selectable interface language**: choose Follow system, 中文, or English under Settings → Display settings → Interface language. Views such as the paper overview refresh to match the selection.
- **Bilingual issue forms**: bug reports, feature requests, and usage questions each have Chinese and English forms.
- **More stable note editing**: UI refreshes preserve note editors to reduce interruptions while editing.
- **Recent chat improvements**: reference multiple papers' full readable text with `@`, save reasoning effort per account and model, and remember chat widths separately for the two layouts. Narrow composers compact account captions.
- **WEB upload fix**: attachment status checks exclude status-like text in filenames to avoid mistaking a filename for a website status message.
- **Upgrade**: install the new XPI and restart Zotero. WEB users should follow the account dialog to check the paired runtime; existing settings and browser login profiles are preserved.

## v0.8.14

- **Multiple referenced papers in one question**: use `@` to pick several Zotero papers, then compare them or use them to analyze the current paper. API sends each paper's available original text with a reading tool; WEB uploads each as a separate text attachment.
- **Complete reference text**: the plugin no longer truncates the readable original text of `@`-referenced papers in API or WEB mode. Model context and website upload limits may still apply.
- **Clearer reference display**: multiple references appear on separate lines in the conversation and context status without changing the question text.

## v0.8.12

- **`@` picks the paper's material**: typing `@` in the composer lists the paper's pictures, tables, and formulas. For a MinerU-parsed PDF — including the PDF opened next to a LaTeX paper — material on the page you are reading is listed first and marked 本页, and the chips at the top switch between 本页 / 全部 / 图片 / 表格 / 公式. A picked picture is sent as an image; a picked table or formula stays a short `[表 #1]` marker in the composer and expands to its LaTeX source when you send.
- **`@` works for LaTeX-only papers**: arXiv figure files that are PDF or EPS are rasterised into pictures on the fly, and `\input` / `\include` files are expanded first, so papers whose sections live in separate `.tex` files no longer show an empty list.
- **WEB images are really uploaded**: pictures attached in the composer, including the ones picked with `@`, now travel with the message instead of being silently dropped.
- **Pick on the PDF, not just in the list**: the 素材 chip left of the composer arms click-to-pick (the default `Ctrl+Shift+M` does the same) — click a picture, table, or formula on the page to attach it, pick the same kind again to stack, and a green dashed box marks the current round's references. The page's text is locked while picking, so prose cannot be grabbed into a quote by accident; closing the list with the chip or `Esc` also deletes the half-typed `@`.
- **Straight answers about pages and sources**: material pages are resolved from the page text the reader prints (第 N–M 页·推测 when only the neighbours bound them), a list opened before that text is ready says so and is never cached, and on a LaTeX-only paper a click on the PDF points back to the list instead of pretending there is nothing to pick.
- **A usage notice**: the low-contrast 使用须知 chip right of 原文 in the input row now opens with where the paper's material comes from (LaTeX source / MinerU parse / neither yet) and how material is used (`@` list, picking on the PDF, `[表 #1]` markers, definite pages vs 推测 ranges), then what differs between API and WEB mode — above all that WEB sends no figures by default — and records the 素材 shortcut (default `Ctrl+Shift+M`). The paper card no longer repeats that warning.
- **Upgrade**: install the 0.8.12 XPI and restart Zotero. Existing settings, prompt edits, and WEB logins are kept.

## v0.8.11

- **Quick prompts live in a data-directory file**: built-in and custom prompts are stored as `zotero-ai-sidebar-quick-prompts.json` next to your PDFs (usually `Zotero/` in your home folder), not as a large blob in `prefs.js`. The first launch after upgrade migrates any existing preference value and clears it only after the file write succeeds. Import/export and WebDAV `state.json` still include the prompt library.
- **Full-document translation for ordinary PDFs via MinerU**: when no arXiv LaTeX source is available, full-document translation uploads the PDF to MinerU’s precise parsing API, then reuses the existing bilingual reader. Set a mineru.net token in settings.
- **Sentence-level bilingual alignment**: with the **逐段** layout and **按句换行**, each translated sentence now sits directly under its source sentence. When the two sides split into a different number of sentences, the translation stays as one block under the paragraph instead of being paired wrongly. **阅读设置** also controls font size, line height, font family (system / serif / sans), sentence markers, and the line-break style.
- **Original-PDF comparison**: reading pages for ordinary PDFs can show the real PDF page beside the parsed text or translation. Click a paragraph to locate its PDF region, click a region box to locate the paragraph, and page or zoom as needed; coordinates already cached by MinerU are reused. Outside comparison mode, only **核对 PDF 原文** opens a crop of the original page. LaTeX reading is unchanged.
- **WEB paper material follows the parse**: a cached LaTeX main file is still preferred, but with no source the Markdown parsed by MinerU (`full.md`) is sent once parsing has finished, and the PDF only while parsing is still pending. A conversation whose first message carried the PDF automatically switches to the Markdown on its next message. That Markdown is plain text, so figures are referenced by relative path and the image files are not uploaded; the web model cannot see them (the local full-translation view is unaffected).
- **WEB uploads no longer stall**: attachment progress is now matched against the file name the website really renders, so tasks that previously sat in the upload stage and failed after two minutes now submit. A failed or cancelled task also releases the stuck "processing the previous request" composer placeholder.
- **Deleted DeepSeek chats recover**: when a bound website conversation has been deleted, the plugin detects the missing chat and starts a fresh one instead of failing the task.
- **Upgrade**: install the 0.8.11 XPI and restart Zotero. Existing prompt edits are kept; the error-console warning about writing ~10KB to `extensions.zotero-ai-sidebar.quickPrompts` should stop after restart. WEB users keep their browser login; the paired runtime is reused when its checksum already matches.

## v0.8.10

- **Choose your WEB browser**: use Chrome, Microsoft Edge, or a user-named Chromium-compatible browser from the arrow next to **Account**. Detected executable paths are visible and editable; **Choose program file…** and **Detect again** help correct custom or mistaken paths. Each browser entry keeps its own login profile.
- **Native browser dropdown fix**: selecting a browser keeps the configuration menu open; clicking outside dismisses it. Zotero's native dropdown options are recognized as part of the current selection interaction.
- **WEB reading routes and overviews**: generate both through the selected website using an independent task session. Send available LaTeX source first, otherwise the paper PDF, without chat history or selected-text context. API generation retains its existing flow.
- **Batched LaTeX translation**: send multiple blocks per WEB request, validate returned block markers, and pause on incomplete responses. Improve bilingual reading layout and reference interactions.
- **Chat scroll behavior**: PDF color annotations preserve the current chat position through necessary refreshes; switching papers opens the conversation at the bottom. The fix is shared across Zotero versions.
- **Upgrade**: install the 0.8.10 XPI and restart Zotero. WEB users should follow the account dialog to check the paired runtime; an unchanged runtime package is reused with existing login data.

## v0.8.9

- **Complete algorithm displays**: LaTeX algorithm fragments share one visual region in both source and translation. Loop indentation continues across fragments; comments retain `/* … */` or `//`. Existing translations are reused. This is a reconstructed reader, not a pixel-identical LaTeX compiler.
- **LaTeX download controls**: choose system proxy or direct access from the paper header. The proxy port follows the operating system unless overridden; settings apply only to LaTeX downloads. Chat preparation uses completed local source caches or local PDF text instead of waiting for downloads.
- **More stable reading and chat**: correct sidebar alignment after startup stylesheet loading, retain available tools with attached full text, improve heading matching and streaming scroll behavior, and keep the open note panel following the selected paper.
- **Output budget**: new model presets default to 32768 output tokens. Saved presets keep their existing values; endpoint/model limits still apply.
- **Upgrade**: install the new XPI and restart Zotero. WEB users should follow the account dialog to verify or update the paired runtime ZIP. See the updated [full-translation tutorial](docs/USAGE.md#211-read-an-arxiv-paper-in-full-document-translation).

## v0.8.7

- **Automatic port allocation**: the Web Agent and dedicated browser dynamically select free ports to reduce conflicts with MCP and other plugins; the XPI reads the Agent's actual address.
- **Runtime paired with the XPI**: the Web Agent no longer has an independent release version. Installation and manual updates validate the paired ZIP; ordinary use does not recompute checksums, and upgrades preserve login data.
- **New Z.ai website entry**: configured separately from ChatGLM, with guest text chat and login required for attachments. Login status is detected automatically without closing Chrome.
- **ChatGLM sessions and answers**: preserve the browser session, separate reasoning from the final answer, and remove the fixed restriction label while continuing to report actual website verification states.
- **Setup and tutorial updates**: correct Windows configuration paths and clarify environment checks, manual ZIP installation, and account status in the bilingual guides and illustrated tutorial.

## v0.8.6

- **The XPI stays lightweight**: each version Release carries a separate, prebuilt `zai-web-agent-runtime.zip`; the plugin downloads and verifies the matching asset without running npm on the user's computer.
- **Web Agent setup is recoverable**: failed downloads expose the Release page, direct link, and local-ZIP picker; checksum, version, protocol, and health checks complete before a new runtime replaces a working compatible version.

## v0.8.2

- **Kimi is now a built-in WEB provider**: existing `kimi.com` custom configurations migrate automatically, while ChatGPT, DeepSeek, ChatGLM, Kimi, and third-party sites retain isolated adapters and account sessions.
- **WEB tasks recover and finish more reliably**: retry stays with the original website instead of falling through to the API path, completed answers no longer remain stuck behind a stale Stop state, and `Esc` or the composer Stop button releases interrupted tasks without restarting Zotero.
- **Website failures are visible in Zotero**: login, quota, server, and unsupported-upload page notices are mirrored as clearly distinguished error responses, while normal answers continue to stream incrementally.
- **The composer is tighter and mode-aware**: API-only controls no longer crowd WEB mode, footer status text remains readable in narrow sidebars, and hidden status rows no longer leave blank space.

## v0.8.1

- **WEB paper context is cleaner**: the current paper is uploaded as a real LaTeX/PDF attachment, while the separate arXiv directory TXT contains only the section hierarchy, numbers, and titles.
- **WEB answers can become PDF annotation drafts**: whole-paper highlighting and selection explanation recognize the structured annotation block, locate verbatim quotes locally, and let you preview, relocate, and explicitly save the matches to Zotero without calling a model API.
- **API and WEB controls are now clearly separated**: WEB uses the website's own network/model/search state and paper-attachment flow, so the API-only `Network` and `Original` toggles are disabled there. Enter and the send arrow share the same live account check, and the footer/status layout has been tightened for narrow sidebars.
