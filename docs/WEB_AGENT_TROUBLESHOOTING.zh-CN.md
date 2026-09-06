# Web Agent 当前问题与排障

本文记录 Zotero AI Sidebar 的网页对话模式（ChatGPT、DeepSeek、ChatGLM、Z.ai、
Kimi 和 ChatGPT-like 第三方网页）在实际运行中确认的问题、处理策略和当前
限制。普通 API 对话不使用 Web Agent，不应受这些规则影响。

## 运行边界

- 网页模式通过独立 Chrome profile 运行，不复用用户日常 Chrome 的 profile。
- 网页账号登录、验证码和站点内配置由用户手动完成；程序检查可用输入框，
  并识别 GLM 已知的整页访问验证提示。
- 每篇论文和每个网页服务使用独立会话键。切换到新论文时创建新网页会话；
  回到同一论文时复用原网页会话。
- 同一服务同一时刻只处理一个任务，后续任务排队，避免同一网页被并发写入。

## GLM 整页访问验证

**当前状态：chatglm.cn 风控受限，尚未解决。** 当前版本在用户环境中已复现
“验证失败，请刷新”，包括人工操作后仍失败的情况；用户提供的返回值为
`verifyResult: false`、`verifyCode: F001`。因此服务菜单标注“风控受限”，
保留该入口供后续复测；这不表示所有用户或普通浏览器都会被限制。

WEB 服务菜单另提供 **Z.ai（chat.z.ai）**。`https://z.ai/` 当前跳转到
`https://chat.z.ai/`，使用独立的页面适配器和会话记录，需要在该网站完成账号
登录。新增入口的控件选择和任务保存/恢复已通过本地测试，真实站点登录与完整
对话尚未验证；新增入口不保证免验证，也不代表国内站风控已修复。

本节策略仅用于内置 ChatGLM 和网址位于 `chatglm.cn` 或其子域的自定义配置。
GLM 从首次账号检查开始使用有界面的专用 Chrome；后台运行时最小化窗口，
避免首次检查使用无界面模式、登录和聊天之间又重启切换模式。

如果网站仍显示“访问验证”和滑块提示，需要在专用 Chrome 中手动完成验证。
Agent 健康检查正常只说明本地服务可用，不表示网站已经允许聊天。

- 账号配置会明确提示访问验证；验证未完成时，“完成”按钮不可用。
  关闭配置对话框会保留尚待验证的浏览器窗口。
- 尚未提交的后台任务遇到这类页面时，会显示专用 Chrome 并等待人工处理。
  输入框可用后继续原任务；等待中可以取消，不会自动操作验证码。
- 账号状态检查复用当前浏览器模式，不关闭正在等待人工处理的任务页面。
- GLM 的“后台隐藏”采用最小化，保留浏览器会话，无需先遇到验证才生效。
  切换到其他提供商时，恢复其原有的后台模式，不继承 GLM 的会话保留策略。

这些处理消除插件的浏览器模式切换，不保证网站不再要求验证。检测目前覆盖
整页滑块提示及“验证失败，请刷新”状态；人工验证失败的站点原因尚未确认，
不能将本地模拟测试通过视为 GLM 真实网站已可用。

## Z.ai 的 Google 登录被拒绝

Google 登录可能拒绝自动化浏览器环境。Z.ai 使用有界面的专用 Chrome，并自动
检测 Z.ai 网页的游客/登录状态；用户完成登录后无需关闭 Chrome。Chrome 账号
头像、输入框存在或浏览器退出本身均不会被当作 Z.ai 登录成功。

为保留登录会话，Z.ai 登录和聊天使用同一个浏览器，后台隐藏采用最小化。
调试端口由系统选出空闲端口后以非零端口号传给 Chrome；端口被其他进程抢占时
有限重试，通过子进程公布的调试地址确认端点，不接管碰巧占用端口的其他服务。
不修改网页的 `navigator.webdriver`，也不自动操作 Google 登录或验证码。

游客仍可文字聊天，附件仍要求登录。Z.ai 如需切换已有浏览器，必须先完成或取消
其他提供商的 WEB 任务。本地隔离测试覆盖窗口不关闭时自动识别登录、登录后上传、
端口竞争和其他任务保护。Google 真实登录兼容性仍需实际账号验证，不保证免验证。

## 已解决的问题

### Z.ai 游客被误判为已登录，上传时弹出登录提示

**现象**：问题仍留在网页输入框中，Zotero 收到“登录即可分析您的文件”的
页面提示，没有正常回答。

**根因**：Z.ai 游客也有可编辑的输入框，但文件上传要求登录。原来的通用
检查只确认输入框可用，误报账号已就绪。

**当前处理**：仅对 `chat.z.ai` 区分游客聊天和登录后上传：

- 输入框可用且网页已明确游客状态时，允许纯文本聊天，账号窗口显示“游客模式
  可用”，不再把游客称为已登录，也不强制登录。
- 游客的历史对话放进文字 Prompt，普通追问不生成历史 TXT 附件。
- 本次需要上传论文或目录附件时，保留原任务和材料，提示登录后继续。
  客户端和 Agent 均阻止游客上传；账号状态尚未加载时也不提前提交。

本地隔离测试已验证游客文字聊天、登录前不上传、登录后只提交一次并返回回答。
真实账号的登录需要用户在专用 Chrome 中完成。

### DeepSeek 文件上传后没有发送

**现象**：文件卡片已出现，Prompt 也写入了输入框，但 DeepSeek 没有开始回答。

**根因**：

1. DeepSeek 的发送控件是 `div[role="button"]`，禁用状态由
   `ds-button--disabled` CSS class 表示；Playwright 的 `isEnabled()` 对这类
   非原生按钮会误判为可用。
2. DeepSeek 在附件处理期间可能暂时清空输入框。若上传阶段同时要求发送按钮
   可用，而完整 Prompt 又在上传结束后才恢复，就会形成等待死锁。

**当前处理**：

- 上传阶段仅确认所有附件可见且不再处于上传/处理状态。
- 恢复完整 Prompt 后，再检查 `disabled`、`aria-disabled` 和
  `ds-button--disabled`，确认发送按钮真正可用。
- DeepSeek 发送最多重试三次；只要检测到停止按钮、新回答、输入框清空或发送
  控件转为禁用，即认定提交已开始并停止重试，避免重复发送。
- ChatGPT 和其他网页服务仍保持单次提交策略。

### 附件上传期间只发送了文件，没有发送问题

**现象**：网页中出现 PDF/TXT 文件卡片，但用户问题丢失或只保留少量文字。

**根因**：部分 ChatGPT-like 编辑器在粘贴文件 URL 时替换当前编辑选区或清空
编辑器文本。

**当前处理**：先写入 Prompt，再快速依次发起全部附件粘贴；全部上传稳定后，
强制恢复并验证完整 Prompt，只有非空时才允许发送。

### DeepSeek `sandbox:/` 下载链接无法使用

**现象**：DeepSeek 回答中显示例如
`https://sandbox:/mnt/data/LAW_flowchart.png` 的“下载链接”，但 Zotero 或
Chrome 无法打开。

**根因**：该地址是 DeepSeek 生成环境内部沙盒路径，网页未把它暴露为浏览器可
下载的附件或 HTTP 资源。

**当前处理**：

- DeepSeek Web 的文件提示词禁止输出 `sandbox:/`、`https://sandbox:/`、
  `/mnt/data/`、`/tmp/` 等内部路径。
- 若网页没有真实附件，DeepSeek 应明确说明“当前网页未提供可下载附件”，并
  返回 Mermaid、SVG、Graphviz DOT 等可复制源代码。
- 回答提取层会把残留的 sandbox 链接降级为普通文字，不能显示为可点击下载。
- ChatGPT Web 的真实下载事件和真实附件仍会下载到 Web Agent 的受管目录，
  并在 Zotero 回答中显示可打开、可右键保存到当前论文的链接。

### Mermaid 渲染失败时 CSS 泄漏到 Zotero 回答

**现象**：DeepSeek 的图表卡显示“渲染失败”，Zotero 左侧回答却出现大量
`#mermaid-svg`、`@keyframes` 和 CSS 文本。

**根因**：网页回答 DOM 内嵌了渲染器的 `<style>` 和 `<svg>` 内容，旧的 DOM
转 Markdown 逻辑将这些展示实现误认为正文。

**当前处理**：网页回答转换会忽略 `style`、`svg`、`script`、`noscript`、
`template`、`canvas` 等渲染实现节点。失败图表不再泄漏 CSS。

### DeepSeek 网页已成功显示 SVG，但 Zotero 没有图表

**现象**：网页端可看到已渲染图表，Zotero AI 对话只显示文字或 Mermaid 源码。

**当前处理**：

- Web Agent 在回答完成后扫描新回答节点中的可见 SVG。
- 提取 SVG 时移除 `script`、`foreignObject`、事件属性和外部 HTTP 引用。
- 清理后的 SVG 作为 `data:image/svg+xml` 回传到 Zotero 的 `Message.images`。
- 助手消息的回答正文下方会渲染这些同步图表。

**限制**：仅同步网页已经成功渲染、且位于新回答节点中的 SVG。网页本身显示
“渲染失败”时不存在可提取的图形，不能从 CSS 可靠还原为 SVG。

### DeepSeek 图表卡的按钮文字混进回答

**现象**：Zotero 回答里出现「图表代码下载全屏渲染失败」这类连在一起的文字。
其中的「下载」看起来像链接，点击却没有任何反应。

**根因**：DeepSeek 把 Mermaid 代码块渲染成一张带标签页（图表 / 代码）和工具条
（下载 / 全屏）的卡片。这些控件位于回答节点内部，旧的 DOM 转 Markdown 逻辑把
它们的文字当成了正文。

**当前处理**：回答转换会忽略 `button` 以及 `role` 为 `button`、`tab`、
`tablist`、`toolbar`、`menu`、`menuitem` 的节点。`a` 元素不受影响，因此真实
下载链接即使带 `role="button"` 也仍会保留。

### 网页里的「下载」按钮从未被点击

**现象**：网页端能看到生成的文件和下载按钮，但 Zotero 回答里既没有可点击的
文件链接，右键也没有「保存到当前论文目录」。

**根因**：回答下载逻辑只接受 `aria-label` 本身像文件名的控件。ChatGPT 用文件名
标注控件，而 DeepSeek 的卡片按钮只写「下载」，因此永远被跳过，Zotero 也就拿不到
任何真实文件。

**当前处理**：

- 回答节点内的 `button`、`[role="button"]`、`a[download]` 都会被检查，控件名称
  依次取 `aria-label`、`title`、可见文字。
- 名称像文件名（`.pdf`、`.png` 等）时按原逻辑就地替换成链接；名称是「下载 /
  导出 / Download / Save image」这类动作词时，文件名取自下载事件的
  `suggestedFilename()`，链接追加到回答末尾，不会把「下载」两个字变成链接。
- 下载成功的文件仍保存在 Web Agent 受管目录，并带 `#zai-web-download` 标记。

### 回答正文里的 `/mnt/data/` 裸路径

**现象**：回答写着「已生成 PDF：`/mnt/data/law_algorithm_flowchart.pdf`」，
但这个路径既打不开，也无法保存成 Zotero 附件。

**根因**：此前只对 `<a href="sandbox:...">` 这类锚点做了降级。模型直接把内部路径
写进正文（尤其是第三方 ChatGPT-like 站点会忽略提示词里的禁止规则）时，Zotero
会原样渲染，用户看到的是一个像文件却不存在的东西。

**当前处理**：Web 回答导入 Zotero 前会执行
`describeUnavailableGeneratedFiles`：把 `sandbox:`、`/mnt/data/`、`/tmp/`
开头的路径压缩成纯文件名，折叠指向这些路径的 Markdown 链接，并在回答末尾追加
一条说明，告诉用户网页没有返回可下载附件、可以改要 Mermaid/SVG/DOT 源码。真实的
`file://…#zai-web-download` 链接不受影响。

### 回答里多出一堆图标当作图表

**现象**：Zotero 回答下方出现十几个「DeepSeek 图表 N.svg」，内容是放大镜、加号、
下载箭头、展开箭头和破图占位符，而不是真正的流程图。

**根因**：SVG 同步会抓取新回答节点里所有可见 `<svg>`。网页的工具条图标、代码块
的复制/下载图标、以及「渲染失败」旁边的占位图标全都是 SVG。

**当前处理**：只有同时满足以下条件的 SVG 才会同步：

- 不位于 `button`、`[role="button"]`、`a`、`[role="tab"]`、`[role="tablist"]`、
  `[role="toolbar"]` 内部；
- 渲染尺寸至少 160×120；
- 含有 `text`/`tspan` 标签，或至少 12 个图形元素。

图片名称改用当前服务名，不再固定写 DeepSeek。清理事件属性和外链时也会处理根
`<svg>` 节点本身，之前只清理了子节点。

### 同步的图表位置不对、内容是空框

**现象**：图表缩略图挤在整条消息的最下方，而不是网页里图表所在的位置；图里只有
黄色和灰色的空框，看不到节点文字。

**根因**：

1. 图片统一走 `renderMessageImages`，追加在气泡末尾的缩略图托盘里
   （`.message-image` 固定 126×92 且 `object-fit: cover`）。
2. Mermaid 默认 `htmlLabels: true`，节点文字放在 `<foreignObject>` 中，而抽取时
   把 `foreignObject` 整个删掉了，只剩下框线。

**当前处理**：

- 抽取时给被采纳的 SVG 打上 `data-zai-chart` 标记，随后重新转换一次回答，在图表
  原位留下 `[[zai-web-chart:N]]` 占位符。
- 侧边栏渲染时把该占位段落替换成整列宽、保持原比例的 `.message-chart` 图；未匹配
  到占位符的图片仍显示在原来的缩略图托盘里。
- 不再删除 `foreignObject`，Mermaid 标签得以保留。Zotero 通过 `<img>` 渲染 SVG，
  属于 secure static 模式：不执行脚本、不加载外部资源，因此内嵌标记是惰性的。
  清理仍会移除 `script`、事件属性，以及 `href`/`xlink:href`/`src` 中的 http(s) 外链。
- 复制回答或写入笔记时占位符会被剥离，不会泄漏到正文。

## 当前限制

### PDF 和二进制文件

PDF、PNG、DOCX 等二进制文件只有在网页提供真实附件卡片、真实下载事件或可访问
HTTP(S) 下载地址时才能同步为受管本地文件。`sandbox:/` 路径不能恢复为文件。

### 第三方网页兼容性

第三方网页采用 ChatGPT-like 选择器模板。它们的 DOM、上传状态和下载机制可能与
ChatGPT/DeepSeek 不同，需要为该站点配置并验证选择器。页面必须先由用户手动
打开并完成登录，未打开或未配置时不允许发送任务。

### 网页状态与浏览器窗口

独立 Chrome 仍是第三方网页登录、上传、验证码和网页脚本运行的实际载体。侧边栏
会显示流程状态和流式回答，但不能保证把每个网页 UI 原样嵌入 Zotero；第三方站点
常见的 CSP、跨域和反自动化策略使 iframe 嵌入不可靠。

## 调试检查顺序

1. 在侧边栏确认账号状态为已配置；必要时点击账号配置并手动完成登录。
2. 确认独立 Chrome 中当前服务页面已打开，且输入框可编辑。
3. 观察侧边栏状态是否依次经历：准备浏览器、上传附件、提交、生成。
4. 附件任务确认网页里出现所有文件卡片，再检查 Prompt 是否仍在输入框中。
5. 如果没有发送，检查按钮是否仍带 `ds-button--disabled` 或网页是否仍显示上传中。
6. 对文件回答，区分真实下载附件与 `sandbox:/` 假链接；只有前者可下载和保存。
   回答末尾出现「网页没有返回可下载的附件」说明时，网页本身就没给出文件。
7. 对图表回答，网页端成功显示 SVG 时应在 Zotero 回答下方出现同步图表；网页渲染
   失败时请让模型返回 Mermaid/SVG 源码，或改用支持真实附件的服务。
8. 改动 `web-agent/*.mjs` 后必须重启 Web Agent 进程（`pkill -f agent.mjs` 后重新
   启动）。Node 已经把旧代码载入内存，只替换文件不会生效。

## 验证范围

相关自动化检查包括：

- `tests/modules/web-agent-adapters.test.ts`
- `tests/modules/web-send-flow.test.ts`
- `tests/modules/web-prompt-format.test.ts`
- `tests/modules/web-generated-file.test.ts`
- `tests/modules/web-answer-markdown.test.ts`（在真实 DOM 上运行 agent.mjs 里
  的回答转换回调，并额外断言去掉控件规则后会复现按钮文字泄漏）

常用检查命令：

```bash
npx vitest run tests/modules/web-agent-adapters.test.ts \
  tests/modules/web-send-flow.test.ts \
  tests/modules/web-prompt-format.test.ts \
  tests/modules/web-generated-file.test.ts \
  tests/modules/web-answer-markdown.test.ts
npx tsc --noEmit
npm run build
```
