import { describe, expect, it, vi } from "vitest";

import { renderFullTranslationView } from "../../src/modules/full-translation-view";
import { createFullTranslationState } from "../../src/settings/full-translation-store";
import {
  completeFullTranslationPreflight,
  inspectFullTranslationSource,
} from "../../src/translate/full-document-preflight";
import { buildFullTranslationDocument } from "../../src/translate/full-document";

function render(
  document: ReturnType<typeof buildFullTranslationDocument>,
  source: string,
) {
  return renderFullTranslationView(globalThis.document, {
    document,
    state: createFullTranslationState(document, "preset", "model"),
    layout: "parallel",
    running: false,
    assets: {},
    preflight: inspectFullTranslationSource(source, document),
    onLayoutChange: () => undefined,
    onRun: () => undefined,
    onRetranslate: () => undefined,
    onCancel: () => undefined,
    onExit: () => undefined,
  });
}

describe("full-document LaTeX preflight", () => {
  it("accepts renderable math and a structurally complete HTML document", async () => {
    const source = String.raw`\begin{document}
\section{Method}
The range is 0.5$\sim$1.5m and the loss is $L_{task}$.
\begin{equation*}
L = L_{task} + \lambda L_{aux}
\end{equation*}
\end{document}`;
    const document = buildFullTranslationDocument("2403.16967", source);
    const sourceCheck = inspectFullTranslationSource(source, document);

    expect(sourceCheck.issues).toEqual([]);
    const root = render(document, source);
    const result = await completeFullTranslationPreflight(
      sourceCheck,
      document,
      {},
      root,
    );

    expect(result.status).toBe("ready");
  });

  it("blocks raw layout source, malformed math, and unclaimed LaTeX figures", () => {
    const source = String.raw`\begin{document}
\section{Results}
\begin{wrapfigure}{r}{.4\textwidth}
\includegraphics{figs/missing.pdf}
\end{wrapfigure}
Broken $\mathbfq$ formula.
\end{document}`;
    const parsed = buildFullTranslationDocument("2403.16967", source);
    const document = {
      ...parsed,
      blocks: parsed.blocks.map((block) =>
        block.kind === "figure-caption"
          ? { ...block, assets: [] }
          : block.kind === "paragraph"
            ? { ...block, source: `${block.source}\n\\begin{minipage}` }
            : block,
      ),
    };
    const result = inspectFullTranslationSource(source, document);

    expect(result.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["raw-latex", "invalid-math", "unclaimed-figure"]),
    );
  });

  it("blocks failed previews before translation can start", async () => {
    const source = String.raw`\begin{document}
\begin{figure}
\includegraphics{figs/system.png}
\caption{System overview.}
\end{figure}
\end{document}`;
    const document = buildFullTranslationDocument("2403.16967", source);
    const sourceCheck = inspectFullTranslationSource(source, document);
    const root = render(document, source);

    const result = await completeFullTranslationPreflight(
      sourceCheck,
      document,
      {
        "figs/system.png": {
          sourcePath: "figs/system.png",
          error: "未找到 LaTeX 图源",
        },
      },
      root,
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toContain("asset-error");
  });

  it("accepts an already rendered image when chrome image.decode rejects", async () => {
    const source = String.raw`\begin{document}
\begin{figure}
\includegraphics{figs/system.jpg}
\caption{System overview.}
\end{figure}
\end{document}`;
    const document = buildFullTranslationDocument("2403.16967", source);
    const sourceCheck = inspectFullTranslationSource(source, document);
    const assets = {
      "figs/system.jpg": {
        sourcePath: "figs/system.jpg",
        previewUrl: "data:image/jpeg;base64,AQID",
      },
    };
    const root = renderFullTranslationView(globalThis.document, {
      document,
      state: createFullTranslationState(document, "preset", "model"),
      layout: "parallel",
      running: false,
      assets,
      onLayoutChange: () => undefined,
      onRun: () => undefined,
      onRetranslate: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    });
    const image = root.querySelector("img") as HTMLImageElement;
    image.decode = vi.fn().mockRejectedValue(new Error("not implemented"));
    Object.defineProperty(image, "complete", { value: true });
    Object.defineProperty(image, "naturalWidth", { value: 640 });

    const result = await completeFullTranslationPreflight(
      sourceCheck,
      document,
      assets,
      root,
    );

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
  });

  it("waits for an image load when chrome image.decode rejects early", async () => {
    const source = String.raw`\begin{document}
\begin{figure}
\includegraphics{figs/system.jpg}
\caption{System overview.}
\end{figure}
\end{document}`;
    const document = buildFullTranslationDocument("2403.16967", source);
    const sourceCheck = inspectFullTranslationSource(source, document);
    const assets = {
      "figs/system.jpg": {
        sourcePath: "figs/system.jpg",
        previewUrl: "data:image/jpeg;base64,AQID",
      },
    };
    const root = renderFullTranslationView(globalThis.document, {
      document,
      state: createFullTranslationState(document, "preset", "model"),
      layout: "parallel",
      running: false,
      assets,
      onLayoutChange: () => undefined,
      onRun: () => undefined,
      onRetranslate: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    });
    const image = root.querySelector("img") as HTMLImageElement;
    let complete = false;
    let naturalWidth = 0;
    image.decode = vi.fn().mockRejectedValue(new Error("not implemented"));
    Object.defineProperty(image, "complete", {
      configurable: true,
      get: () => complete,
    });
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      get: () => naturalWidth,
    });

    const resultPromise = completeFullTranslationPreflight(
      sourceCheck,
      document,
      assets,
      root,
    );
    setTimeout(() => {
      complete = true;
      naturalWidth = 640;
      image.dispatchEvent(
        new (image.ownerDocument.defaultView as Window).Event("load"),
      );
    }, 0);
    const result = await resultPromise;

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
  });

  it("waits for rendered dimensions after chrome reports complete early", async () => {
    const source = String.raw`\begin{document}
\begin{figure}
\includegraphics{figs/system.jpg}
\caption{System overview.}
\end{figure}
\end{document}`;
    const document = buildFullTranslationDocument("2403.16967", source);
    const sourceCheck = inspectFullTranslationSource(source, document);
    const assets = {
      "figs/system.jpg": {
        sourcePath: "figs/system.jpg",
        previewUrl: "data:image/jpeg;base64,AQID",
      },
    };
    const root = renderFullTranslationView(globalThis.document, {
      document,
      state: createFullTranslationState(document, "preset", "model"),
      layout: "parallel",
      running: false,
      assets,
      onLayoutChange: () => undefined,
      onRun: () => undefined,
      onRetranslate: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    });
    const image = root.querySelector("img") as HTMLImageElement;
    let naturalWidth = 0;
    image.decode = vi.fn().mockRejectedValue(new Error("not implemented"));
    Object.defineProperty(image, "complete", { value: true });
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      get: () => naturalWidth,
    });

    const resultPromise = completeFullTranslationPreflight(
      sourceCheck,
      document,
      assets,
      root,
    );
    setTimeout(() => {
      naturalWidth = 640;
    }, 10);
    const result = await resultPromise;

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
  });
});
