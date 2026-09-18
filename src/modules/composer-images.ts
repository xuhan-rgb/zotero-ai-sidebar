import {
  captureDraftFromInput,
  type ComposerDraftState,
} from "./composer-state";
import { buttonEl, el } from "./dom-utils";
import { appendLocalPath } from "../utils/local-path";

const IMAGE_PROMPT_MAX_DIMENSION = 2048;

export interface DraftImage {
  id: string;
  marker: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  size: number;
  /** Set when the picture already exists on disk, so WEB chat can upload it. */
  path?: string;
}

export interface DraftImageState extends ComposerDraftState {
  draftImages: DraftImage[];
  nextPasteID: number;
}

export interface ComposerImageButtonDeps<TState extends DraftImageState> {
  selectedChatPreset(state: any): unknown;
  renderPanel(mount: HTMLElement, state: any): void;
}

export interface ComposerImageRenderDeps<TState extends DraftImageState> {
  renderPanel(mount: HTMLElement, state: any): void;
}

export function renderImageAttachButton<TState extends DraftImageState>(
  doc: Document,
  mount: HTMLElement,
  state: TState,
  input: HTMLTextAreaElement,
  updateStatus: (captureFocus?: boolean) => void,
  deps: ComposerImageButtonDeps<TState>,
): HTMLElement {
  const control = el(doc, "span", "image-attach-control");
  const fileInput = doc.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.className = "image-attach-input";

  const button = buttonEl(doc, "图片");
  button.type = "button";
  button.className = "image-attach-btn";
  button.disabled = !deps.selectedChatPreset(state);
  button.title = "系统截图后可直接 Ctrl+V 粘贴；也可以点击选择图片文件";
  button.addEventListener("click", () => {
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    if (files.length === 0) return;
    captureDraftFromInput(input, state);
    void addDraftImages(doc, state, files, input).then(() => {
      fileInput.value = "";
      updateStatus(false);
      deps.renderPanel(mount, state);
    });
  });

  control.append(button, fileInput);
  return control;
}

export function renderScreenshotAttachButton<TState extends DraftImageState>(
  doc: Document,
  mount: HTMLElement,
  state: TState,
  input: HTMLTextAreaElement,
  updateStatus: (captureFocus?: boolean) => void,
  status: HTMLElement,
  deps: ComposerImageButtonDeps<TState>,
): HTMLElement {
  const button = buttonEl(doc, "截图");
  button.type = "button";
  button.className = "screenshot-attach-btn";
  button.disabled = !deps.selectedChatPreset(state);
  button.title =
    "选择屏幕/窗口截图；如果系统不支持，请用系统截图后 Ctrl+V 粘贴";
  button.addEventListener("click", () => {
    void attachScreenshotImage(
      doc,
      mount,
      state,
      input,
      updateStatus,
      status,
      deps,
    );
  });
  return button;
}

async function attachScreenshotImage<TState extends DraftImageState>(
  doc: Document,
  mount: HTMLElement,
  state: TState,
  input: HTMLTextAreaElement,
  updateStatus: (captureFocus?: boolean) => void,
  status: HTMLElement,
  deps: ComposerImageRenderDeps<TState>,
) {
  captureDraftFromInput(input, state);
  setComposerTransientStatus(status, "请拖拽框选要截图的区域…");
  const file = await captureScreenImage(doc);
  if (!file) {
    input.focus();
    setComposerTransientStatus(
      status,
      "当前环境不能直接截图；请用系统截图复制后 Ctrl+V 粘贴",
    );
    return;
  }
  await addDraftImages(doc, state, [file], input);
  updateStatus(false);
  deps.renderPanel(mount, state);
}

function setComposerTransientStatus(status: HTMLElement, text: string) {
  const node = status.ownerDocument!.createElement("span");
  node.className = "composer-status-badge composer-status-badge-image";
  node.textContent = text;
  status.replaceChildren(node);
}

export function renderDraftImages<TState extends DraftImageState>(
  doc: Document,
  mount: HTMLElement,
  state: TState,
  input: HTMLTextAreaElement,
  deps: ComposerImageRenderDeps<TState>,
): HTMLElement {
  const tray = el(
    doc,
    "div",
    state.draftImages.length ? "draft-images" : "draft-images is-empty",
  );
  for (const image of state.draftImages) {
    const item = el(doc, "div", "draft-image");
    const img = doc.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name;
    const label = el(doc, "span", "draft-image-label", image.marker);
    label.title = image.name;
    const remove = buttonEl(doc, "×");
    remove.title = "移除截图";
    remove.addEventListener("click", () => {
      removeDraftImage(state, input, image);
      deps.renderPanel(mount, state);
    });
    item.append(img, label, remove);
    tray.append(item);
  }
  return tray;
}

function removeDraftImage<TState extends DraftImageState>(
  state: TState,
  input: HTMLTextAreaElement,
  image: DraftImage,
) {
  input.value = removeComposerMarkerFromText(input.value, image.marker);
  state.draftImages = state.draftImages.filter(
    (candidate) => candidate.id !== image.id,
  );
  relabelDraftImages(state, input);
  captureDraftFromInput(input, state);
}

export function pastedImageFiles(event: ClipboardEvent): File[] {
  const files: File[] = [];
  const items = event.clipboardData?.items;
  if (!items) return files;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item.type || !item.type.toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export async function addDraftImages<TState extends DraftImageState>(
  doc: Document,
  state: TState,
  files: File[],
  input?: HTMLTextAreaElement,
) {
  for (const file of files) {
    const imageData = await fileToPromptImageData(doc, file);
    const marker = nextImageMarker(state);
    const image: DraftImage = {
      id: `image-${Date.now()}-${state.nextPasteID++}`,
      marker,
      name: file.name || `Screenshot ${state.draftImages.length + 1}`,
      mediaType: imageData.mediaType,
      dataUrl: imageData.dataUrl,
      size: imageData.size,
    };
    state.draftImages.push(image);
    if (input) insertComposerText(input, marker);
  }
  if (input) captureDraftFromInput(input, state);
}

export interface DraftImageAsset {
  name: string;
  mediaType: string;
  bytes: Uint8Array;
  path?: string;
}

/** Adds pictures that already exist on disk (parsed figures, LaTeX sources). */
export async function addDraftImageAssets<TState extends DraftImageState>(
  doc: Document,
  state: TState,
  assets: DraftImageAsset[],
  input?: HTMLTextAreaElement,
) {
  for (const asset of assets) {
    const file = new File([asset.bytes as unknown as BlobPart], asset.name, {
      type: asset.mediaType,
    });
    const imageData = await fileToPromptImageData(doc, file);
    const marker = nextImageMarker(state);
    const image: DraftImage = {
      id: `image-${Date.now()}-${state.nextPasteID++}`,
      marker,
      name: asset.name,
      mediaType: imageData.mediaType,
      dataUrl: imageData.dataUrl,
      size: imageData.size,
      ...(asset.path ? { path: asset.path } : {}),
    };
    state.draftImages.push(image);
    if (input) insertComposerText(input, marker);
  }
  if (input) captureDraftFromInput(input, state);
}

function nextImageMarker<TState extends DraftImageState>(
  state: TState,
): string {
  return `[Image #${state.draftImages.length + 1}]`;
}

/** Inserts text at the caret on its own line, used for markers and LaTeX. */
export function insertComposerText(input: HTMLTextAreaElement, text: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? "\n" : "";
  const suffix = after && !/^\s/.test(after) ? "\n" : "";
  input.value = `${before}${prefix}${text}${suffix}${after}`;
  const cursor = before.length + prefix.length + text.length;
  input.selectionStart = cursor;
  input.selectionEnd = cursor;
}

/** Drops a marker and the blank lines it leaves behind. */
export function removeComposerMarkerFromText(
  text: string,
  marker: string,
): string {
  const index = text.indexOf(marker);
  if (index < 0) return text;
  const before = text.slice(0, index);
  const after = text.slice(index + marker.length);
  return `${before}${after}`
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

function relabelDraftImages<TState extends DraftImageState>(
  state: TState,
  input: HTMLTextAreaElement,
) {
  let text = input.value;
  state.draftImages.forEach((image, index) => {
    const marker = `[Image #${index + 1}]`;
    if (image.marker === marker) return;
    text = text.split(image.marker).join(marker);
    image.marker = marker;
  });
  input.value = text;
}

interface PromptImageData {
  dataUrl: string;
  mediaType: string;
  size: number;
}

async function fileToPromptImageData(
  doc: Document,
  file: File,
): Promise<PromptImageData> {
  const originalDataUrl = await blobToDataUrl(doc, file);
  const mediaType = promptSafeImageType(file.type);
  if (!mediaType)
    return rasterizeImageDataUrl(doc, originalDataUrl, "image/png");

  const image = await decodeImage(doc, originalDataUrl).catch(() => null);
  if (!image) {
    return {
      dataUrl: originalDataUrl,
      mediaType,
      size: file.size,
    };
  }

  if (
    image.naturalWidth <= IMAGE_PROMPT_MAX_DIMENSION &&
    image.naturalHeight <= IMAGE_PROMPT_MAX_DIMENSION
  ) {
    return {
      dataUrl: originalDataUrl,
      mediaType,
      size: file.size,
    };
  }

  return rasterizeImageElement(doc, image, mediaType);
}

function promptSafeImageType(mediaType: string): string | null {
  switch (mediaType) {
    case "image/png":
    case "image/jpeg":
    case "image/gif":
    case "image/webp":
      return mediaType;
    default:
      return null;
  }
}

async function rasterizeImageDataUrl(
  doc: Document,
  dataUrl: string,
  outputType: string,
): Promise<PromptImageData> {
  const image = await decodeImage(doc, dataUrl);
  return rasterizeImageElement(doc, image, outputType);
}

// Downscale + transcode for multimodal API uploads.
// WHY 2048px ceiling (IMAGE_PROMPT_MAX_DIMENSION): both OpenAI Responses
// and Anthropic image inputs cap effective resolution near here; sending
// larger costs more tokens with no quality gain on either provider.
// `Math.min(1, ...)` keeps small images at their native size — never
// upscales (no benefit, just bloats the data URL).
//
// Two graceful-degradation paths return the ORIGINAL image bytes:
//   - canvas getContext fails (rare; XUL window may have GPU init issues)
//   - canvas-to-blob conversion fails
// In both cases we still send the image; only the resize is lost. NOT a
// silent failure — the size mismatch is observable to the caller via the
// returned `size` field which still reflects the data URL byte count.
async function rasterizeImageElement(
  doc: Document,
  image: HTMLImageElement,
  outputType: string,
): Promise<PromptImageData> {
  const scale = Math.min(
    1,
    IMAGE_PROMPT_MAX_DIMENSION / image.naturalWidth,
    IMAGE_PROMPT_MAX_DIMENSION / image.naturalHeight,
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!context) {
    return {
      dataUrl: image.src,
      mediaType: outputType,
      size: dataUrlByteSize(image.src),
    };
  }
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, outputType);
  if (!blob) {
    return {
      dataUrl: image.src,
      mediaType: outputType,
      size: dataUrlByteSize(image.src),
    };
  }
  return {
    dataUrl: await blobToDataUrl(doc, blob),
    mediaType: blob.type || outputType,
    size: blob.size,
  };
}

function decodeImage(
  doc: Document,
  dataUrl: string,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = doc.createElement("img");
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("Failed to decode image")),
      { once: true },
    );
    image.src = dataUrl;
  });
}

// FileReader#readAsDataURL wrapped in a promise.
// WHY pull FileReader off `doc.defaultView`: tests run with a synthesized
// document; Zotero's XUL window has its own FileReader constructor
// distinct from the global one. `File` extends `Blob`, so this single
// helper serves both image-paste and canvas-blob paths.
function blobToDataUrl(doc: Document, blob: Blob): Promise<string> {
  const Reader = doc.defaultView?.FileReader ?? FileReader;
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Failed to read image blob")),
    );
    reader.readAsDataURL(blob);
  });
}

function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor(payload.length * 0.75);
}

async function captureScreenImage(doc: Document): Promise<File | null> {
  return (
    (await captureScreenImageWithExternalTool(doc)) ??
    (await captureScreenImageWithDisplayMedia(doc))
  );
}

// Two-tier screenshot capture (caller `captureScreenImage` runs them in
// this order; NEVER both — would prompt the user twice).
// Tier 1 — `captureScreenImageWithExternalTool`: OS-native area-select
// tools (Linux gnome-screenshot/flameshot/import; Windows PowerShell +
// ms-screenclip Snip & Sketch). Gives a real area-selection UX rather
// than getDisplayMedia's "pick a window/screen" dialog. Returns null if
// no platform-specific tool is wired up.
// Tier 2 — `getDisplayMedia` (this function): the standard browser screen
// capture API. Cross-platform fallback. In Zotero XUL/chrome context the
// browser API may be unavailable (e.g. Windows 11 Gecko hides it), so
// Tier 1 is the actually-working path on most environments.
async function captureScreenImageWithDisplayMedia(
  doc: Document,
): Promise<File | null> {
  const win = doc.defaultView;
  const mediaDevices = win?.navigator?.mediaDevices;
  if (!win || typeof mediaDevices?.getDisplayMedia !== "function") return null;

  let stream: MediaStream | null = null;
  try {
    stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
    const video = doc.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await waitForVideoMetadata(video);
    await video.play().catch(() => undefined);

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const canvas = doc.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/png");
    if (!blob) return null;
    const FileCtor = win.File ?? File;
    return new FileCtor([blob], `Screenshot ${timestampForFileName()}.png`, {
      type: "image/png",
    });
  } catch (err) {
    Zotero.debug(
      `[Zotero AI Sidebar] screenshot capture failed: ${String(err)}`,
    );
    return null;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

async function captureScreenImageWithExternalTool(
  doc: Document,
): Promise<File | null> {
  const Z = Zotero as any;
  const exec = Z?.Utilities?.Internal?.exec;
  const getBinary = Z?.File?.getBinaryContentsAsync;
  const removeIfExists = Z?.File?.removeIfExists;
  if (typeof exec !== "function" || typeof getBinary !== "function")
    return null;

  if (Z.isWin) {
    return captureScreenImageOnWindows(doc, exec, removeIfExists);
  }
  if (Z.isLinux) {
    return captureScreenImageOnLinux(doc, exec, removeIfExists);
  }
  // macOS and other platforms: no external tool support; fall through to
  // getDisplayMedia in the caller.
  return null;
}

// Linux: area-select tools that already ship with most desktops. Tried in
// "least disruptive UX first" order:
//   gnome-screenshot -a   — area-select, native GNOME UI
//   flameshot gui -p      — area-select, modern annotation overlay
//   ImageMagick `import`  — fullscreen capture, last resort
// `-p path` / `-f path` write to a fixed temp file we read back. The temp
// file is removed on success AND failure (best-effort).
async function captureScreenImageOnLinux(
  doc: Document,
  exec: (cmd: string, args: string[]) => Promise<boolean>,
  removeIfExists: ((path: string) => Promise<void>) | undefined,
): Promise<File | null> {
  const path = `/tmp/zotero-ai-sidebar-screenshot-${Date.now()}.png`;
  const commands: Array<[string, string[]]> = [
    ["/usr/bin/gnome-screenshot", ["-a", "-f", path]],
    ["/usr/bin/flameshot", ["gui", "-p", path]],
    ["/usr/bin/import", [path]],
  ];

  for (const [cmd, args] of commands) {
    try {
      const result = await exec(cmd, args);
      if (result !== true) continue;
      const file = await imageFileFromPath(doc, path, "Screenshot");
      if (file) {
        try {
          await removeIfExists?.(path);
        } catch (_err) {
          // Best-effort cleanup only.
        }
        return file;
      }
    } catch (err) {
      Zotero.debug(
        `[Zotero AI Sidebar] screenshot command failed (${cmd}): ${String(err)}`,
      );
    }
  }
  try {
    await removeIfExists?.(path);
  } catch (_err) {
    // Best-effort cleanup only.
  }
  return null;
}

// Windows 10 1809+ / Windows 11: launch the OS Snip & Sketch UI
// (`ms-screenclip:` URI handler — same area-select flow as Win+Shift+S),
// poll the clipboard for a new image, and write it to a temp PNG.
//
// Subtle but critical: `powershell.exe` is a *console subsystem* binary,
// so Windows attaches a fresh console window when Zotero's `exec` spawns
// it. That window pops up in front of the Zotero reader and ruins the
// area-select UX. To avoid it we wrap the PowerShell invocation in a
// tiny VBS launched via `wscript.exe` (a *GUI subsystem* binary, no
// console). The VBS then uses `WshShell.Run` with WindowStyle=0 (hidden)
// + bWaitOnReturn=True so the PowerShell window never paints AND we
// still block until the snip completes / cancels.
//
// We compare the SHA-1 of the current clipboard image against whatever
// was there BEFORE the snip — that way a prior clipboard image (say, an
// old screenshot from an hour ago) doesn't get mistaken for the snip we
// just asked them to take. ms-screenclip's protocol launcher returns
// immediately, so the polling loop is what gates completion; 60 s of
// headroom is plenty for the area-select interaction.
//
// On cancel (Esc) the clipboard never changes → loop times out,
// PowerShell exits 1, wscript propagates that exit code, exec returns
// false, this returns null, and the user sees the existing "请用系统截图
// 复制后 Ctrl+V 粘贴" hint — which is what they already know how to do.
async function captureScreenImageOnWindows(
  doc: Document,
  exec: (cmd: string, args: string[]) => Promise<boolean>,
  removeIfExists: ((path: string) => Promise<void>) | undefined,
): Promise<File | null> {
  const Z = Zotero as any;
  const tempRoot: string | undefined = Z?.getTempDirectory?.()?.path;
  if (!tempRoot) return null;

  const stamp = Date.now();
  const imagePath = appendLocalPath(
    tempRoot,
    `zotero-ai-sidebar-screenshot-${stamp}.png`,
  );
  const scriptPath = appendLocalPath(
    tempRoot,
    `zotero-ai-sidebar-screenshot-${stamp}.ps1`,
  );
  const vbsPath = appendLocalPath(
    tempRoot,
    `zotero-ai-sidebar-screenshot-${stamp}.vbs`,
  );

  // Single-quoted PowerShell string literals only need `'` doubled to escape.
  const escapedImagePath = imagePath.replace(/'/g, "''");
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
function Get-ClipImageHash {
  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { return $null }
  $img = [System.Windows.Forms.Clipboard]::GetImage()
  $ms = New-Object IO.MemoryStream
  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  return [BitConverter]::ToString([System.Security.Cryptography.SHA1]::Create().ComputeHash($ms.ToArray()))
}
$priorHash = Get-ClipImageHash
Start-Process 'ms-screenclip:'
$timeoutMs = 60000
$start = [Environment]::TickCount
while (([Environment]::TickCount - $start) -lt $timeoutMs) {
  Start-Sleep -Milliseconds 200
  $hash = Get-ClipImageHash
  if ($hash -and $hash -ne $priorHash) {
    [System.Windows.Forms.Clipboard]::GetImage().Save('${escapedImagePath}', [System.Drawing.Imaging.ImageFormat]::Png)
    exit 0
  }
}
exit 1
`;

  // VBS string literals escape `"` by doubling it. `0` = hidden window,
  // `True` = block until the spawned process exits. PowerShell receives
  // the script path through a literal -File arg (no shell interpolation).
  const escapedScriptPath = scriptPath.replace(/"/g, '""');
  const vbs = `Set sh = CreateObject("WScript.Shell")
exitCode = sh.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""${escapedScriptPath}""", 0, True)
WScript.Quit exitCode
`;

  const io = (
    globalThis as unknown as {
      IOUtils?: { writeUTF8(p: string, d: string): Promise<unknown> };
    }
  ).IOUtils;
  if (!io) return null;

  try {
    await io.writeUTF8(scriptPath, script);
    await io.writeUTF8(vbsPath, vbs);
    // wscript.exe is the GUI host for Windows Script — invoking it does
    // NOT allocate a console window for our process tree. //nologo
    // suppresses the WSH banner, //B switches it to batch mode (no UI
    // popups on script errors — we already redirect errors via exit code).
    const ok = await exec("C:\\Windows\\System32\\wscript.exe", [
      "//nologo",
      "//B",
      vbsPath,
    ]);
    if (!ok) return null;
    return await imageFileFromPath(doc, imagePath, "Screenshot");
  } catch (err) {
    Zotero.debug(
      `[Zotero AI Sidebar] Windows screenshot failed: ${String(err)}`,
    );
    return null;
  } finally {
    try {
      await removeIfExists?.(scriptPath);
    } catch (_err) {
      // Best-effort cleanup only.
    }
    try {
      await removeIfExists?.(vbsPath);
    } catch (_err) {
      // Best-effort cleanup only.
    }
    try {
      await removeIfExists?.(imagePath);
    } catch (_err) {
      // Best-effort cleanup only.
    }
  }
}

async function imageFileFromPath(
  doc: Document,
  path: string,
  fallbackName: string,
): Promise<File | null> {
  try {
    const binary: string = await (Zotero as any).File.getBinaryContentsAsync(
      path,
    );
    if (!binary) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index) & 0xff;
    }
    // Split on either separator so we extract the basename correctly on
    // both POSIX (/tmp/...) and Windows (C:\Users\...\Temp\...) paths.
    const name = path.split(/[\\/]/).pop() || `${fallbackName}.png`;
    const FileCtor = doc.defaultView?.File ?? File;
    return new FileCtor([bytes], name, { type: "image/png" });
  } catch (err) {
    Zotero.debug(
      `[Zotero AI Sidebar] screenshot file read failed: ${String(err)}`,
    );
    return null;
  }
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  const win = video.ownerDocument?.defaultView;
  return new Promise((resolve, reject) => {
    if (!win) {
      reject(new Error("Missing window for screen capture"));
      return;
    }
    const timeoutID = win.setTimeout(
      () => reject(new Error("Timed out waiting for screen capture")),
      5000,
    );
    video.addEventListener(
      "loadedmetadata",
      () => {
        win.clearTimeout(timeoutID);
        resolve();
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        win.clearTimeout(timeoutID);
        reject(new Error("Failed to load screen capture"));
      },
      { once: true },
    );
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
