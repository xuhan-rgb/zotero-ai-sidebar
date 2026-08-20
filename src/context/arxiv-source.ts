// Orchestrates: fetch e-print -> extract -> select+clean main.tex -> store.
// All failures resolve to false (caller falls back to PDF).

import { DEFAULT_CONTEXT_POLICY } from "./policy";
import { extractArchive } from "./arxiv-archive";
import {
  findMainTex,
  inlineInputs,
  stripTexComments,
  expandMacros,
  buildCitationLabels,
  normalizeCitations,
  normalizeLatexCommonCommands,
  normalizeLatexListEnvironments,
  normalizeLatexSourceCommands,
  normalizeLatexTextCommands,
  type TexFile,
} from "./tex-clean";
import {
  writeArxivSource,
  hasArxivSource,
  readArxivMeta,
  type ArxivMeta,
} from "./arxiv-store";
import { annotateNumberedEquations, parseEquations } from "./tex-equations";
import { annotateNumberedFigures, parseFigures } from "./tex-figures";
import { parseSections } from "./tex-sections";
import { annotateNumberedTables, parseTables } from "./tex-tables";
import { appendLocalPath } from "../utils/local-path";

export const ARXIV_SOURCE_CLEANER_VERSION = 15;

export function isFreshArxivSourceMeta(meta: ArxivMeta | null): boolean {
  return (
    meta?.status === "ok" &&
    meta.cleanerVersion === ARXIV_SOURCE_CLEANER_VERSION
  );
}

// Use Zotero's HTTP API, not fetch(): arXiv's e-print response trips a Gecko
// `fetch` bug ("Content-Length header exceeds response Body"). Zotero.HTTP
// (XHR-based) downloads the binary payload cleanly.
interface ZoteroHttpResponse {
  status: number;
  response: ArrayBuffer;
}
function zoteroHttpRequest(
  url: string,
  options: { responseType: string; timeout: number },
): Promise<ZoteroHttpResponse> {
  const Z = (
    globalThis as unknown as {
      Zotero: {
        HTTP: {
          request(
            method: string,
            url: string,
            options: { responseType: string; timeout: number },
          ): Promise<ZoteroHttpResponse>;
        };
      };
    }
  ).Zotero;
  return Z.HTTP.request("GET", url, options);
}

// TEMP diagnostic: append a per-stage trace to a debug file so a failed
// download can be inspected. Uses append mode so it does not clobber the
// reader-side diagnostics written by `appendArxivDiagnostic` in arxiv-store.
// Remove once the feature is verified.
function writeArxivDebug(lines: string[]): void {
  try {
    const g = globalThis as unknown as {
      IOUtils?: {
        writeUTF8(
          p: string,
          d: string,
          options?: { mode?: string },
        ): Promise<unknown>;
      };
      Zotero?: {
        DataDirectory?: { dir?: string; path?: string };
        Profile?: { dir: string };
      };
    };
    const dir = g.Zotero?.DataDirectory?.dir ?? g.Zotero?.Profile?.dir;
    if (dir && g.IOUtils) {
      const stamp = new Date().toISOString();
      void g.IOUtils.writeUTF8(
        appendLocalPath(dir, "zotero-ai-sidebar-arxiv-debug.txt"),
        `\n--- ${stamp} ensureArxivSource ---\n${lines.join("\n")}\n`,
        { mode: "appendOrCreate" },
      );
    }
  } catch {
    // diagnostics only
  }
}

export interface EnsureArxivArgs {
  arxivId: string;
  onProgress?: (msg: string) => void;
}

// Returns true when a usable arXiv source cache exists for the paper after
// this call (already cached, or freshly downloaded). Never throws.
export async function ensureArxivSource(
  args: EnsureArxivArgs,
): Promise<boolean> {
  const trace: string[] = [];
  const arxivId = args.arxivId;
  trace.push(`arxivId=${arxivId}`);
  try {
    if (!arxivId) return false;
    if (await hasArxivSource(arxivId)) {
      const meta = await readArxivMeta(arxivId);
      if (isFreshArxivSourceMeta(meta)) {
        trace.push(
          `already cached status=ok cleaner=${ARXIV_SOURCE_CLEANER_VERSION} -> true`,
        );
        return true;
      }
      if (meta?.status === "no-source") {
        trace.push("already cached status=no-source -> false");
        return false;
      }
      trace.push(
        `cached source stale cleaner=${meta?.cleanerVersion ?? "missing"} -> rebuild`,
      );
    }
    args.onProgress?.("下载 arXiv 源码…");
    let bytes: Uint8Array;
    try {
      const resp = await zoteroHttpRequest(
        `https://arxiv.org/e-print/${arxivId}`,
        {
          responseType: "arraybuffer",
          timeout: DEFAULT_CONTEXT_POLICY.arxivFetchTimeoutMs,
        },
      );
      trace.push(
        `download: status=${resp.status} bytes=${resp.response ? resp.response.byteLength : "none"}`,
      );
      if (resp.status !== 200 || !resp.response) return false;
      bytes = new Uint8Array(resp.response);
    } catch (e) {
      trace.push(`download threw: ${String(e)}`);
      return false;
    }
    if (bytes.length > DEFAULT_CONTEXT_POLICY.maxArxivSourceBytes) {
      trace.push(`payload too large: ${bytes.length}`);
      return false;
    }

    const files = await extractArchive(bytes);
    trace.push(`extractArchive -> ${files.length} files`);
    const texFiles: TexFile[] = files
      .filter((file) => /\.(tex|cls|sty|bbl)$/i.test(file.path))
      .map((file) => ({
        path: file.path,
        text: new TextDecoder().decode(file.bytes),
      }));
    const main = findMainTex(texFiles);
    trace.push(
      `findMainTex -> ${main ? main.path : "NULL"} (texFiles=${texFiles.length}: ${texFiles
        .map((t) => t.path)
        .join(",")})`,
    );

    if (!main) {
      // No LaTeX source (e.g. PDF-only submission). Record it so we do not
      // re-download every analysis.
      await writeArxivSource(arxivId, [], {
        arxivId,
        fetchedAt: new Date().toISOString(),
        mainTexRelPath: "",
        status: "no-source",
      });
      trace.push("stored: no-source -> false");
      return false;
    }

    const inlined = inlineInputs(main.text, texFiles);
    const expanded = expandMacros(inlined);
    const uncommented = stripTexComments(expanded);

    const citationLabels = buildCitationLabels(texFiles);
    const referenceLabels = new Map<string, string>();
    for (const item of [
      ...parseSections(uncommented),
      ...parseEquations(uncommented),
      ...parseFigures(uncommented),
      ...parseTables(uncommented),
    ]) {
      if (item.label) referenceLabels.set(item.label, String(item.number));
    }

    const listsNormalized = normalizeLatexListEnvironments(uncommented);
    const textNormalized = normalizeLatexTextCommands(listsNormalized);
    const citationsNormalized = normalizeCitations(
      textNormalized,
      citationLabels,
    );
    const commonCommandsNormalized =
      normalizeLatexCommonCommands(citationsNormalized);
    const sourceCommandsNormalized = normalizeLatexSourceCommands(
      commonCommandsNormalized,
      {
        preserveSectionLabels: true,
        preserveEquationLabels: true,
        preserveFigureLabels: true,
        preserveTableLabels: true,
        referenceLabels,
      },
    );
    const equationsAnnotated = annotateNumberedEquations(
      sourceCommandsNormalized,
    );
    const figuresAnnotated = annotateNumberedFigures(equationsAnnotated);
    const cleaned = annotateNumberedTables(figuresAnnotated);
    const meta: ArxivMeta = {
      arxivId,
      fetchedAt: new Date().toISOString(),
      mainTexRelPath: "main.tex",
      status: "ok",
      cleanerVersion: ARXIV_SOURCE_CLEANER_VERSION,
    };
    // Store the raw archive files plus the cleaned main.tex (overwriting the
    // raw main entry) so readArxivMainText returns chat-ready text directly.
    const toStore = files.filter((file) => file.path !== main.path);
    toStore.push({
      path: "main.tex",
      bytes: new TextEncoder().encode(cleaned),
    });
    await writeArxivSource(arxivId, toStore, meta);
    trace.push(`stored: ok (main.tex ${cleaned.length} chars) -> true`);
    args.onProgress?.("arXiv 源码就绪");
    return true;
  } catch (e) {
    trace.push(`ERROR: ${String(e)}`);
    return false;
  } finally {
    writeArxivDebug(trace);
  }
}
