export const WEB_GENERATED_FILE_MARKER = "zai-web-download";

export function markWebGeneratedFileHref(href: string): string {
  const url = new URL(href);
  url.hash = WEB_GENERATED_FILE_MARKER;
  return url.href;
}

export function webGeneratedFilePath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") {
    return null;
  }

  let path = decodeURIComponent(url.pathname);
  // Firefox exposes Windows file URLs as /C:/path. Keep POSIX paths intact.
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  const isMarked = url.hash === `#${WEB_GENERATED_FILE_MARKER}`;
  // Keep links from answers created before the marker was introduced working.
  // The directory is owned by the dedicated Web Agent, unlike arbitrary
  // file: links a model could place in its response.
  const isLegacyDownload = /(?:^|[\\/])zai-downloads(?:[\\/]|$)/i.test(path);
  return path && (isMarked || isLegacyDownload) ? path : null;
}

const UNAVAILABLE_FILE_NOTE =
  "> 上面的文件路径只存在于网页服务自己的生成环境中，网页没有返回可下载的附件，" +
  "Zotero 无法打开或保存它。可以让模型直接给出图表源码（Mermaid / SVG / Graphviz DOT），" +
  "或改用会提供真实下载附件的服务。";

// A web service can claim it produced a file by printing an internal path such
// as `sandbox:/mnt/data/chart.pdf` or `/mnt/data/chart.pdf`. The prompt rules
// forbid that, but third-party sites ignore them. Rendering the path unchanged
// gives the user something that looks like a file yet cannot be opened or
// saved, so keep the file name, drop the unusable path, and say so once.
export function describeUnavailableGeneratedFiles(answer: string): string {
  if (!answer) return answer;
  const internalPath =
    /(?:https?:\/\/)?sandbox:\/{0,2}[^\s`)\]<>"']+|(?<![\w.:/~-])\/(?:mnt\/data|tmp)\/[^\s`)\]<>"']+/g;
  let changed = false;
  let result = answer.replace(
    /\[([^\]\n]*)\]\(\s*(?:https?:\/\/)?(?:sandbox:|\/mnt\/data\/|\/tmp\/)[^)\n]*\)/g,
    (_match, label: string) => {
      changed = true;
      return label.trim() || "生成文件";
    },
  );
  result = result.replace(internalPath, (match) => {
    const trimmed = match.replace(/[.,;:!?。，；：！？、]+$/u, "");
    const name = trimmed.split("/").filter(Boolean).pop() || trimmed;
    changed = true;
    return `${name}${match.slice(trimmed.length)}`;
  });
  return changed ? `${result.trimEnd()}\n\n${UNAVAILABLE_FILE_NOTE}` : answer;
}

export async function saveWebGeneratedFileToCurrentItem(
  sourcePath: string,
  itemID: number,
  title: string,
): Promise<number | undefined> {
  if (!(await IOUtils.exists(sourcePath))) {
    throw new Error("生成文件已不存在，请重新生成后再保存");
  }
  const selected = Zotero.Items.get(itemID) as {
    id?: number;
    parentID?: number;
  } | null;
  const parentItemID = selected?.parentID ?? selected?.id;
  if (!parentItemID) throw new Error("无法定位当前论文条目");
  const attachment = await Zotero.Attachments.importFromFile({
    file: sourcePath,
    parentItemID,
    title: title.trim() || sourcePath.replace(/\\/g, "/").split("/").pop(),
    contentType: generatedFileContentType(sourcePath),
  });
  return attachment.id;
}

function generatedFileContentType(path: string): string {
  if (/\.pdf$/i.test(path)) return "application/pdf";
  if (/\.(png|jpe?g|gif|webp)$/i.test(path)) return "image/*";
  if (/\.txt$/i.test(path)) return "text/plain";
  return "application/octet-stream";
}
