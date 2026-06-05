import { beforeEach, describe, expect, it } from "vitest";
import {
  createZoteroAgentTools,
  createZoteroAgentToolSession,
} from "../../src/context/agent-tools";
import type { ContextSource } from "../../src/context/builder";
import type { OverviewData } from "../../src/context/overview-types";
import { writeArxivSource } from "../../src/context/arxiv-store";

const source: ContextSource = {
  getItem: async () => null,
  getFullText: async () => "",
};

let savedJSON: Record<string, unknown> | null = null;
let saveCount = 0;
let paperCacheStore = "{}";

beforeEach(() => {
  savedJSON = null;
  saveCount = 0;
  paperCacheStore = "{}";
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Items: {
        getAsync: async (id: number) => ({ id, libraryID: 1 }),
      },
      DataObjectUtilities: {
        generateKey: () => "GENKEY",
      },
      Annotations: {
        DEFAULT_COLOR: "#ffd400",
        saveFromJSON: async (
          _attachment: unknown,
          json: Record<string, unknown>,
        ) => {
          savedJSON = json;
          saveCount += 1;
          return { id: 99 };
        },
      },
      // paper-cache needs DataDirectory + File to read/write the cache file.
      DataDirectory: { dir: "/tmp/zotero-data" },
      Profile: { dir: "/tmp/zotero-profile" },
      File: {
        getContentsAsync: async () => paperCacheStore,
        putContentsAsync: async (_path: string, contents: string) => {
          paperCacheStore = contents;
        },
      },
    },
  });
});

describe("createZoteroAgentTools", () => {
  it("creates a permission-aware Zotero annotation from the current selection", async () => {
    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      selectionAnnotation: () => ({
        text: "Selected PDF text",
        attachmentID: 2,
        annotation: {
          id: "ANNKEY",
          type: "highlight",
          text: "Selected PDF text",
          color: "#ff6666",
          pageLabel: "3",
          sortIndex: "00042",
          position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
        },
      }),
    });

    const tool = tools.find(
      (candidate) => candidate.name === "zotero_add_annotation_to_selection",
    );
    expect(tool?.requiresApproval).toBe(true);

    const result = await tool!.execute({ comment: "AI generated note" });

    expect(result.summary).toBe("新增 PDF 注释 17 字");
    expect(result.output).toContain("Annotation item ID: 99");
    expect(savedJSON).toMatchObject({
      key: "ANNKEY",
      type: "highlight",
      text: "Selected PDF text",
      comment: "AI generated note",
      color: "#ff6666",
      pageLabel: "3",
      sortIndex: "00042",
      position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
    });
  });

  it("exposes the current PDF selection as a read-only model tool", async () => {
    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      selectionAnnotation: () => ({
        text: "Paragraph one.\n\n1) First question.\n2) Second question.",
        attachmentID: 2,
        annotation: {
          text: "Paragraph one.\n\n1) First question.\n2) Second question.",
          pageLabel: "8",
          position: { pageIndex: 7, rects: [[1, 2, 3, 4]] },
        },
      }),
    });

    const tool = tools.find(
      (candidate) => candidate.name === "zotero_get_current_pdf_selection",
    );
    expect(tool?.requiresApproval).toBeUndefined();

    const result = await tool!.execute({});

    expect(result.summary).toBe("读取当前 PDF 选区 54 字");
    expect(result.output).toContain("[Current PDF selection]");
    expect(result.output).toContain("Page: 8");
    expect(result.output).toContain("1) First question.\n2) Second question.");
    expect(result.context).toMatchObject({
      planMode: "selected_text",
      sourceKind: "zotero_item",
      sourceID: "1",
      selectedText: "Paragraph one.\n\n1) First question.\n2) Second question.",
    });
  });

  it("reports when the current PDF selection tool has no selection", async () => {
    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      selectionAnnotation: () => null,
    });

    const tool = tools.find(
      (candidate) => candidate.name === "zotero_get_current_pdf_selection",
    );
    const result = await tool!.execute({});

    expect(result.output).toContain("No live PDF text selection is available");
  });

  it("creates a visible PDF text annotation near the current selection", async () => {
    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      selectionAnnotation: () => ({
        text: "Anchor text",
        attachmentID: 2,
        annotation: {
          text: "Anchor text",
          color: "#ffd400",
          pageLabel: "5",
          sortIndex: "00004|000000|00100",
          position: { pageIndex: 4, rects: [[100, 200, 220, 214]] },
        },
      }),
    });

    const tool = tools.find(
      (candidate) =>
        candidate.name === "zotero_add_text_annotation_to_selection",
    );
    expect(tool?.requiresApproval).toBe(true);

    const result = await tool!.execute({
      comment: "你好",
      color: "#ffcc00",
      fontSize: 16,
      placement: "below",
    });

    expect(result.summary).toBe("新增 PDF 文字（T 工具） 2 字");
    expect(result.output).toContain("Visible text: 你好");
    expect(savedJSON).toMatchObject({
      type: "text",
      text: "",
      comment: "你好",
      color: "#ffcc00",
      pageLabel: "5",
      sortIndex: "00004|000000|00100",
      position: {
        pageIndex: 4,
        fontSize: 16,
        rotation: 0,
      },
    });
    expect((savedJSON?.position as any).rects[0][1]).toBeGreaterThan(214);
  });

  it("writes visible text annotations directly through saveFromJSON, bypassing Reader's read-only UI lock", async () => {
    let selectedIDs: string[] = [];
    const manager = {
      _readOnly: true,
      setReadOnly(readOnly: boolean) {
        this._readOnly = readOnly;
      },
      // Reader.addAnnotation MUST NOT be called: a previous save failure left
      // it read-only and re-entering it would just keep failing. saveFromJSON
      // is the chrome-side write path that ignores the Reader UI lock.
      addAnnotation() {
        throw new Error("Reader.addAnnotation must not be invoked");
      },
    };
    const reader = {
      itemID: 2,
      _item: { id: 2 },
      _iframeWindow: {},
      _internalReader: {
        _state: { readOnly: true },
        _annotationManager: manager,
        setReadOnly(readOnly: boolean) {
          this._state.readOnly = readOnly;
        },
        setSelectedAnnotations(ids: string[]) {
          selectedIDs = ids;
        },
      },
    };

    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      getActiveReader: () => reader,
      selectionAnnotation: () => ({
        text: "Anchor text",
        attachmentID: 2,
        annotation: {
          text: "Anchor text",
          color: "#ffd400",
          pageLabel: "5",
          sortIndex: "00004|000000|00100",
          position: { pageIndex: 4, rects: [[100, 200, 220, 214]] },
        },
      }),
    });

    const tool = tools.find(
      (candidate) =>
        candidate.name === "zotero_add_text_annotation_to_selection",
    );
    const result = await tool!.execute({ comment: "你好", fontSize: 16 });

    expect(result.output).toContain("Annotation item ID: 99");
    expect(saveCount).toBe(1);
    // Best-effort UI niceties on the Reader: stale read-only is cleared and
    // the new annotation is selected so the user sees it highlighted.
    expect(reader._internalReader._state.readOnly).toBe(false);
    expect(manager._readOnly).toBe(false);
    expect(selectedIDs).toEqual(["GENKEY"]);
  });

  it("succeeds when post-save Reader nudges throw, since they're best-effort cosmetics", async () => {
    const reader = {
      itemID: 2,
      _item: { id: 2 },
      _iframeWindow: {},
      _internalReader: {
        _annotationManager: { _readOnly: false },
        setSelectedAnnotations() {
          throw new Error(
            "Permission denied to pass object to privileged code",
          );
        },
      },
    };

    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      getActiveReader: () => reader,
      selectionAnnotation: () => ({
        text: "Anchor text",
        attachmentID: 2,
        annotation: {
          text: "Anchor text",
          color: "#ffd400",
          pageLabel: "5",
          sortIndex: "00004|000000|00100",
          position: { pageIndex: 4, rects: [[100, 200, 220, 214]] },
        },
      }),
    });

    const tool = tools.find(
      (candidate) =>
        candidate.name === "zotero_add_text_annotation_to_selection",
    );
    const result = await tool!.execute({ comment: "你好", fontSize: 16 });

    expect(result.output).toContain("Annotation item ID: 99");
    expect(saveCount).toBe(1);
  });

  it("recovers via Notifier observation when saveFromJSON rejects after the item already landed", async () => {
    const savedByKey = new Map<string, { id: number; libraryID: number }>();
    const Z = (globalThis as any).Zotero;
    Z.Items.getByLibraryAndKey = (_libraryID: number, key: string) =>
      savedByKey.get(key) ?? false;
    Z.Annotations.saveFromJSON = async (
      _attachment: unknown,
      json: Record<string, unknown>,
    ) => {
      saveCount += 1;
      // Simulate the racy case: item is written to DB before the cross-scope
      // promise resolution chokes on the wrapped result object.
      savedByKey.set(json.key as string, { id: 250, libraryID: 1 });
      throw new Error("Permission denied to pass object to privileged code");
    };

    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      selectionAnnotation: () => ({
        text: "Anchor text",
        attachmentID: 2,
        annotation: {
          text: "Anchor text",
          color: "#ffd400",
          pageLabel: "5",
          sortIndex: "00004|000000|00100",
          position: { pageIndex: 4, rects: [[100, 200, 220, 214]] },
        },
      }),
    });

    const tool = tools.find(
      (candidate) =>
        candidate.name === "zotero_add_text_annotation_to_selection",
    );
    const result = await tool!.execute({ comment: "你好", fontSize: 16 });

    expect(result.output).toContain("Annotation item ID: 250");
    expect(saveCount).toBe(1);
  });

  it("propagates saveFromJSON errors when no item ever landed", async () => {
    const Z = (globalThis as any).Zotero;
    Z.Items.getByLibraryAndKey = () => false;
    Z.Annotations.saveFromJSON = async () => {
      saveCount += 1;
      throw new Error("Permission denied to pass object to privileged code");
    };

    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      selectionAnnotation: () => ({
        text: "Anchor text",
        attachmentID: 2,
        annotation: {
          text: "Anchor text",
          color: "#ffd400",
          pageLabel: "5",
          sortIndex: "00004|000000|00100",
          position: { pageIndex: 4, rects: [[100, 200, 220, 214]] },
        },
      }),
    });

    const tool = tools.find(
      (candidate) =>
        candidate.name === "zotero_add_text_annotation_to_selection",
    );

    await expect(
      tool!.execute({ comment: "你好", fontSize: 16 }),
    ).rejects.toThrow(/Permission denied/);
  });

  it("discovers an open Zotero Reader for the post-save UI nudge when no active reader is passed", async () => {
    let selectedIDs: string[] = [];
    const Z = (globalThis as any).Zotero;
    Z.Reader = {
      _readers: [
        {
          itemID: 2,
          _item: { id: 2 },
          _iframeWindow: {},
          _internalReader: {
            _annotationManager: { _readOnly: false },
            setSelectedAnnotations(ids: string[]) {
              selectedIDs = ids;
            },
          },
        },
      ],
    };

    const tools = createZoteroAgentTools({
      source,
      itemID: 1,
      selectionAnnotation: () => ({
        text: "Anchor text",
        attachmentID: 2,
        annotation: {
          text: "Anchor text",
          color: "#ffd400",
          pageLabel: "5",
          sortIndex: "00004|000000|00100",
          position: { pageIndex: 4, rects: [[100, 200, 220, 214]] },
        },
      }),
    });

    const tool = tools.find(
      (candidate) =>
        candidate.name === "zotero_add_text_annotation_to_selection",
    );
    const result = await tool!.execute({ comment: "你好", fontSize: 16 });

    expect(result.output).toContain("Annotation item ID: 99");
    expect(saveCount).toBe(1);
    expect(selectedIDs).toEqual(["GENKEY"]);
  });

  it("creates a full-text highlight annotation from a located passage", async () => {
    const session = createZoteroAgentToolSession({
      source,
      itemID: 1,
      getActiveReader: () =>
        readerWithPdfText("Important contribution improves retrieval."),
    });

    const tool = session.tools.find(
      (candidate) => candidate.name === "zotero_annotate_passage",
    );
    expect(tool?.requiresApproval).toBe(true);

    const result = await tool!.execute({
      text: "Important contribution improves retrieval.",
      comment: "核心贡献句",
      color: "#ffcc00",
    });

    expect(result.summary).toBe("p.1 高亮 +5字");
    expect(result.context?.planMode).toBe("annotation_write");
    expect(savedJSON).toMatchObject({
      type: "highlight",
      text: "Important contribution improves retrieval.",
      comment: "核心贡献句",
      color: "#ffcc00",
      pageLabel: "1",
      position: { pageIndex: 0, rects: [[0, 100, 420, 110]] },
    });
    expect(savedJSON?.sortIndex).toBe("00000|000000|00110");
    session.dispose();
  });

  it("returns an error when full-text highlight has no active reader", async () => {
    const session = createZoteroAgentToolSession({
      source,
      itemID: 1,
      getActiveReader: () => null,
    });
    const tool = session.tools.find(
      (candidate) => candidate.name === "zotero_annotate_passage",
    );

    const result = await tool!.execute({ text: "Important", comment: "note" });

    expect(result.output).toContain("No Reader/PDF.js text layer is available");
    expect(result.output).toContain("Please open the PDF in Zotero Reader");
    expect(saveCount).toBe(0);
  });

  it("validates required annotate passage arguments", async () => {
    const session = createZoteroAgentToolSession({
      source,
      itemID: 1,
      getActiveReader: () => readerWithPdfText("Important text."),
    });
    const tool = session.tools.find(
      (candidate) => candidate.name === "zotero_annotate_passage",
    );

    await expect(tool!.execute({ comment: "note" })).resolves.toMatchObject({
      output: "zotero_annotate_passage requires a non-empty `text`.",
    });
    await expect(
      tool!.execute({ text: "Important text." }),
    ).resolves.toMatchObject({
      output: "zotero_annotate_passage requires a non-empty `comment`.",
    });
    expect(saveCount).toBe(0);
  });

  it("does not cap full-text highlight writes within one tool session", async () => {
    const session = createZoteroAgentToolSession({
      source,
      itemID: 1,
      getActiveReader: () =>
        readerWithPdfText("First sentence. Second sentence."),
    });
    const tool = session.tools.find(
      (candidate) => candidate.name === "zotero_annotate_passage",
    );

    await tool!.execute({ text: "First sentence.", comment: "第一条" });
    const result = await tool!.execute({
      text: "Second sentence.",
      comment: "第二条",
    });

    expect(result.output).toContain("[Saved annotation #99]");
    expect(saveCount).toBe(2);
  });

  it("exposes reader-text and write tools in the default tool set", () => {
    const session = createZoteroAgentToolSession({
      source,
      itemID: 1,
      getActiveReader: () => readerWithPdfText("Text."),
    });

    expect(session.tools.map((tool) => tool.name)).toEqual([
      "zotero_get_current_item",
      "zotero_get_annotations",
      "chat_get_previous_context",
      "zotero_outline_pdf",
      "zotero_search_pdf",
      "zotero_read_pdf_range",
      "zotero_get_full_pdf",
      "arxiv_list_sections",
      "arxiv_get_figure",
      "arxiv_get_table",
      "arxiv_get_section",
      "arxiv_get_equation",
      "arxiv_get_bibliography",
      "draw_article_mindmap",
      "render_paper_overview",
      "paper_search_arxiv",
      "paper_fetch_arxiv_fulltext",
      "zotero_get_reader_pdf_text",
      "zotero_get_current_pdf_selection",
      "zotero_add_text_annotation_to_selection",
      "zotero_add_annotation_to_selection",
      "zotero_annotate_passage",
      "zotero_append_to_note",
    ]);
    expect(
      session.tools.find((tool) => tool.name === "zotero_annotate_passage")
        ?.requiresApproval,
    ).toBe(true);
  });

  it("exposes full PDF truncation metadata", async () => {
    const session = createZoteroAgentToolSession({
      source: {
        ...source,
        getFullText: async () => "A".repeat(20),
      },
      itemID: 1,
      policy: {
        ...sourcePolicy(),
        fullPdfTokenBudget: 2,
      },
    });
    const tool = session.tools.find(
      (candidate) => candidate.name === "zotero_get_full_pdf",
    );

    const result = await tool!.execute({});

    expect(result.frontBlock).toBe("A".repeat(8));
    expect(result.output).toContain("[Paper full text]");
    expect(result.output).not.toContain("A".repeat(8));
    expect(result.context).toMatchObject({
      planMode: "full_pdf",
      sourceKind: "zotero_item",
      sourceID: "1",
      fullTextChars: 8,
      fullTextTotalChars: 20,
      fullTextTruncated: true,
      rangeStart: 0,
      rangeEnd: 8,
    });
  });

  it("does not treat a cached arXiv TOC block as the full PDF body", async () => {
    const toc = "[arXiv paper — section index]\nSections only";
    paperCacheStore = JSON.stringify({
      "item:1": {
        pinned: true,
        fullText: toc,
        charCount: toc.length,
        capturedAt: "2026-05-23T00:00:00.000Z",
        source: "full_pdf",
      },
    });
    const session = createZoteroAgentToolSession({
      source: {
        ...source,
        getFullText: async () => "REAL FULL LATEX",
      },
      itemID: 1,
    });
    const tool = session.tools.find(
      (candidate) => candidate.name === "zotero_get_full_pdf",
    );

    const result = await tool!.execute({});

    expect(result.frontBlock).toBe("REAL FULL LATEX");
    expect(result.frontBlock).not.toBe(toc);
    expect(result.context?.fullTextChars).toBe("REAL FULL LATEX".length);
  });

  it("lets the model read cached arXiv bibliography files on demand", async () => {
    const fs = new Map<string, string | Uint8Array>();
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        makeDirectory: async () => undefined,
        writeUTF8: async (p: string, d: string) => void fs.set(p, d),
        write: async (p: string, d: Uint8Array) => void fs.set(p, d),
        readUTF8: async (p: string) => {
          const value = fs.get(p);
          if (value == null) throw new Error("missing file");
          return typeof value === "string"
            ? value
            : new TextDecoder().decode(value);
        },
        read: async (p: string) => fs.get(p) as Uint8Array,
        exists: async (p: string) => fs.has(p),
      },
    });
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        ...(globalThis as any).Zotero,
        Items: {
          ...(globalThis as any).Zotero.Items,
          get: () => ({ key: "BIBKEY01" }),
        },
      },
    });
    await writeArxivSource(
      "BIBKEY01",
      [
        {
          path: "main.tex",
          bytes: new TextEncoder().encode("\\bibliography{references}"),
        },
        {
          path: "main.bbl",
          bytes: new TextEncoder().encode("\\bibitem{pi0} Pi zero paper."),
        },
        {
          path: "references.bib",
          bytes: new TextEncoder().encode("@article{ignored}"),
        },
      ],
      {
        itemKey: "BIBKEY01",
        arxivId: "2504.16054",
        fetchedAt: "2026-05-23T00:00:00.000Z",
        mainTexRelPath: "main.tex",
        status: "ok",
      },
    );
    const session = createZoteroAgentToolSession({ source, itemID: 1 });
    const tool = session.tools.find(
      (t) => t.name === "arxiv_get_bibliography",
    )!;

    const result = await tool.execute({});

    expect(result.output).toContain("[arXiv bibliography file: main.bbl]");
    expect(result.output).toContain("\\bibitem{pi0} Pi zero paper.");
    expect(result.output).not.toContain("@article{ignored}");
    expect(result.context).toMatchObject({
      planMode: "bibliography",
      bibliographyChars: result.output.length,
      bibliographyFiles: ["main.bbl"],
    });
  });

  it("lets the model read a numbered arXiv equation deterministically", async () => {
    const fs = new Map<string, string | Uint8Array>();
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        makeDirectory: async () => undefined,
        writeUTF8: async (p: string, d: string) => void fs.set(p, d),
        write: async (p: string, d: Uint8Array) => void fs.set(p, d),
        readUTF8: async (p: string) => {
          const value = fs.get(p);
          if (value == null) throw new Error("missing file");
          return typeof value === "string"
            ? value
            : new TextDecoder().decode(value);
        },
        read: async (p: string) => fs.get(p) as Uint8Array,
        exists: async (p: string) => fs.has(p),
      },
    });
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        ...(globalThis as any).Zotero,
        Items: {
          ...(globalThis as any).Zotero.Items,
          get: () => ({ key: "EQKEY001" }),
        },
      },
    });
    await writeArxivSource(
      "EQKEY001",
      [
        {
          path: "main.tex",
          bytes: new TextEncoder().encode(
            [
              "\\section{Method}",
              "\\begin{equation}",
              "a = b",
              "\\label{eq:first}",
              "\\end{equation}",
              "\\paragraph{Mixed-pose training.}",
              "The probability of using predicted poses follows a schedule:",
              "[Equation (2) label=eq:mix_schedule]",
              "\\begin{equation}",
              "p_{\\text{pred}}(e) = p_{\\text{start}} + (p_{\\text{end}} - p_{\\text{start}})",
              "\\label{eq:mix_schedule}",
              "\\end{equation}",
            ].join("\n"),
          ),
        },
      ],
      {
        itemKey: "EQKEY001",
        arxivId: "2604.28130",
        fetchedAt: "2026-05-23T00:00:00.000Z",
        mainTexRelPath: "main.tex",
        status: "ok",
      },
    );
    const session = createZoteroAgentToolSession({ source, itemID: 1 });
    const tool = session.tools.find((t) => t.name === "arxiv_get_equation")!;

    const result = await tool.execute({ number: 2 });

    expect(result.output).toContain("[arXiv equation (2)]");
    expect(result.output).toContain("Label: eq:mix_schedule");
    expect(result.output).toContain("Display math for final answers");
    expect(result.output).toContain("$$");
    expect(result.output).toContain("p_{\\text{pred}}(e)");
    expect(result.output).toContain("Exact LaTeX source for verification only");
    expect(result.output).toContain("```tex");
    expect(result.output).toContain("Mixed-pose training");
    expect(result.context).toMatchObject({
      planMode: "equation",
      equationNumber: 2,
      equationLabel: "eq:mix_schedule",
    });

    const section = session.tools.find((t) => t.name === "arxiv_get_section")!;
    const sectionResult = await section.execute({ section: "Mixed-pose" });
    expect(sectionResult.output).toContain(
      "[Equation (2) label=eq:mix_schedule]",
    );
    expect(sectionResult.output).toContain("p_{\\text{pred}}(e)");
  });

  it("lets the model attach a numbered arXiv figure image", async () => {
    const fs = new Map<string, string | Uint8Array>();
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        makeDirectory: async () => undefined,
        writeUTF8: async (p: string, d: string) => void fs.set(p, d),
        write: async (p: string, d: Uint8Array) => void fs.set(p, d),
        readUTF8: async (p: string) => {
          const value = fs.get(p);
          if (value == null) throw new Error("missing file");
          return typeof value === "string"
            ? value
            : new TextDecoder().decode(value);
        },
        read: async (p: string) => fs.get(p) as Uint8Array,
        exists: async (p: string) => fs.has(p),
      },
    });
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        ...(globalThis as any).Zotero,
        Items: {
          ...(globalThis as any).Zotero.Items,
          get: () => ({ key: "FIGKEY01" }),
        },
      },
    });
    await writeArxivSource(
      "FIGKEY01",
      [
        {
          path: "main.tex",
          bytes: new TextEncoder().encode(
            [
              "\\section{Results}",
              "\\begin{figure}",
              "\\includegraphics{figures/occupancy.png}",
              "\\caption{The **occupancy trade-off** between 2D grids \\& 3D points.}",
              "\\label{fig:occupancy}",
              "\\end{figure}",
            ].join("\n"),
          ),
        },
        {
          path: "figures/occupancy.png",
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
      ],
      {
        itemKey: "FIGKEY01",
        arxivId: "2303.05367",
        fetchedAt: "2026-05-23T00:00:00.000Z",
        mainTexRelPath: "main.tex",
        status: "ok",
      },
    );
    const session = createZoteroAgentToolSession({ source, itemID: 1 });
    const tool = session.tools.find((t) => t.name === "arxiv_get_figure")!;

    const result = await tool.execute({ number: 1 });

    expect(result.output).toContain("[arXiv figure 1]");
    expect(result.output).toContain("Caption:");
    expect(result.output).toContain("Image attached: yes");
    expect(result.images).toHaveLength(1);
    expect(result.images?.[0].mediaType).toBe("image/png");
    expect(result.context).toMatchObject({
      planMode: "figure",
      figureNumber: 1,
      figureLabel: "fig:occupancy",
      figureImageAttached: true,
    });
  });

  it("lets the model read a numbered arXiv table deterministically", async () => {
    const fs = new Map<string, string | Uint8Array>();
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        makeDirectory: async () => undefined,
        writeUTF8: async (p: string, d: string) => void fs.set(p, d),
        write: async (p: string, d: Uint8Array) => void fs.set(p, d),
        readUTF8: async (p: string) => {
          const value = fs.get(p);
          if (value == null) throw new Error("missing file");
          return typeof value === "string"
            ? value
            : new TextDecoder().decode(value);
        },
        read: async (p: string) => fs.get(p) as Uint8Array,
        exists: async (p: string) => fs.has(p),
      },
    });
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        ...(globalThis as any).Zotero,
        Items: {
          ...(globalThis as any).Zotero.Items,
          get: () => ({ key: "TABKEY01" }),
        },
      },
    });
    await writeArxivSource(
      "TABKEY01",
      [
        {
          path: "main.tex",
          bytes: new TextEncoder().encode(
            [
              "\\section{Results}",
              "\\begin{table}",
              "\\caption{Table one caption.}",
              "\\begin{tabular}{c}A\\end{tabular}",
              "\\end{table}",
              "\\begin{table*}",
              "\\caption{Comparisons among range view approaches on SemanticKITTI.}",
              "\\label{tab:range-view}",
              "\\begin{tabular}{cc}Method & mIoU\\\\ RangeFormer & 73.3\\end{tabular}",
              "\\end{table*}",
            ].join("\n"),
          ),
        },
      ],
      {
        itemKey: "TABKEY01",
        arxivId: "2303.05367",
        fetchedAt: "2026-05-23T00:00:00.000Z",
        mainTexRelPath: "main.tex",
        status: "ok",
      },
    );
    const session = createZoteroAgentToolSession({ source, itemID: 1 });
    const tool = session.tools.find((t) => t.name === "arxiv_get_table")!;

    const result = await tool.execute({ number: 2 });

    expect(result.output).toContain("[arXiv table 2]");
    expect(result.output).toContain("Label: tab:range-view");
    expect(result.output).toContain("Caption: Comparisons among range view");
    expect(result.output).toContain("Exact LaTeX source for this table");
    expect(result.output).toContain("RangeFormer");
    expect(result.context).toMatchObject({
      planMode: "table",
      tableNumber: 2,
      tableLabel: "tab:range-view",
    });
  });

  it("lets the model reuse prior retained snippets without reading the PDF again", async () => {
    const session = createZoteroAgentToolSession({
      source,
      itemID: 1,
      previousMessages: [
        {
          role: "user",
          content: "解释第三章",
          context: {
            planMode: "pdf_range",
            sourceKind: "zotero_item",
            sourceID: "1",
            sourceTitle: "Range View Paper",
            retrievedPassages: [
              {
                text: "Chapter 3 method text.",
                start: 12000,
                end: 13000,
                score: 1,
              },
            ],
          },
        },
      ],
    });
    const tool = session.tools.find(
      (candidate) => candidate.name === "chat_get_previous_context",
    );

    const result = await tool!.execute({
      sourceKind: "zotero_item",
      sourceID: "1",
      start: 11800,
      end: 14000,
    });

    expect(result.output).toContain("[Previous chat context]");
    expect(result.output).toContain("Chapter 3 method text.");
    expect(result.summary).toBe("复用历史上下文 1 段 / 22 字");
    expect(result.context).toMatchObject({
      planMode: "previous_context",
      sourceKind: "zotero_item",
      sourceID: "1",
      sourceTitle: "Range View Paper",
      retrievedPassages: [
        {
          text: "Chapter 3 method text.",
          start: 12000,
          end: 13000,
        },
      ],
    });
  });

  it("keeps cache full text separate from Reader text for annotation", async () => {
    const session = createZoteroAgentToolSession({
      source: {
        ...source,
        getFullText: async () => "cache text for ordinary summary",
      },
      itemID: 1,
      getActiveReader: () =>
        readerWithPdfText("reader text used for highlighting"),
    });
    const fullPdf = session.tools.find(
      (candidate) => candidate.name === "zotero_get_full_pdf",
    );
    const search = session.tools.find(
      (candidate) => candidate.name === "zotero_search_pdf",
    );
    const readerText = session.tools.find(
      (candidate) => candidate.name === "zotero_get_reader_pdf_text",
    );

    const fullResult = await fullPdf!.execute({});
    const searchResult = await search!.execute({
      query: "ordinary",
      topK: 1,
    });
    const readerResult = await readerText!.execute({});

    expect(fullResult.frontBlock).toContain("cache text for ordinary summary");
    expect(fullResult.frontBlock).not.toContain("reader text");
    expect(fullResult.output).toContain("[Paper full text]");
    expect(fullResult.output).not.toContain("cache text for ordinary summary");
    expect(searchResult.output).toContain("cache text for ordinary summary");
    expect(readerResult.output).toContain("[Reader PDF text for annotation]");
    expect(readerResult.output).toContain("reader text used for highlighting");
    expect(readerResult.context).toMatchObject({
      planMode: "reader_pdf_text",
      fullTextChars: "reader text used for highlighting".length,
      fullTextTotalChars: "reader text used for highlighting".length,
      fullTextTruncated: false,
      rangeStart: 0,
      rangeEnd: "reader text used for highlighting".length,
    });
  });

  it("reads capped ranges from Reader text", async () => {
    const session = createZoteroAgentToolSession({
      source,
      itemID: 1,
      policy: {
        ...sourcePolicy(),
        maxRangeChars: 4,
      },
      getActiveReader: () => readerWithPdfText("0123456789"),
    });
    const readerText = session.tools.find(
      (candidate) => candidate.name === "zotero_get_reader_pdf_text",
    );

    const result = await readerText!.execute({ start: 2, end: 9 });

    expect(result.output).toContain("Range: 2-6");
    expect(result.output).toContain("\n2345");
    expect(result.context).toMatchObject({
      planMode: "reader_pdf_text",
      rangeStart: 2,
      rangeEnd: 6,
    });
  });

  describe("zotero_append_to_note", () => {
    it("appends markdown to the child note via the injected callback and reports counts", async () => {
      const calls: string[] = [];
      const tools = createZoteroAgentTools({
        source,
        itemID: 1,
        appendToChildNote: async (content) => {
          calls.push(content);
          return { noteID: 555, created: false, usedBetterNotes: true };
        },
      });

      const tool = tools.find((t) => t.name === "zotero_append_to_note");
      expect(tool).toBeDefined();
      expect(tool!.requiresApproval).toBe(true);

      const md = "# 第一章\n\n关键观点 X 和 Y。";
      const result = await tool!.execute({ content: md });

      expect(calls).toEqual([md]);
      expect(result.summary).toContain("已追加");
      expect(result.output).toContain("Note item ID: 555");
      expect(result.output).toContain("Used Better Notes: yes");
      expect(result.context?.planMode).toBe("note_write");
    });

    it("reports note creation when the callback returns created: true", async () => {
      const tools = createZoteroAgentTools({
        source,
        itemID: 1,
        appendToChildNote: async () => ({
          noteID: 777,
          created: true,
          usedBetterNotes: false,
        }),
      });
      const tool = tools.find((t) => t.name === "zotero_append_to_note");
      const result = await tool!.execute({ content: "first ever entry" });
      expect(result.summary).toContain("已新建笔记");
      expect(result.output).toContain("Created new note: yes");
    });

    it("returns an error when no item is selected (no child-note target)", async () => {
      const tools = createZoteroAgentTools({
        source,
        itemID: null,
        appendToChildNote: async () => ({
          noteID: 1,
          created: false,
          usedBetterNotes: false,
        }),
      });
      const tool = tools.find((t) => t.name === "zotero_append_to_note");
      const result = await tool!.execute({ content: "anything" });
      expect(result.output).toContain("No Zotero item is currently selected");
    });

    it("returns an error when content is blank", async () => {
      const tools = createZoteroAgentTools({
        source,
        itemID: 1,
        appendToChildNote: async () => ({
          noteID: 1,
          created: false,
          usedBetterNotes: false,
        }),
      });
      const tool = tools.find((t) => t.name === "zotero_append_to_note");
      const result = await tool!.execute({ content: "   \n  " });
      expect(result.output).toContain("non-empty");
    });

    it("surfaces callback failures as a tool error rather than throwing", async () => {
      const tools = createZoteroAgentTools({
        source,
        itemID: 1,
        appendToChildNote: async () => {
          throw new Error("note locked");
        },
      });
      const tool = tools.find((t) => t.name === "zotero_append_to_note");
      const result = await tool!.execute({ content: "x" });
      expect(result.output).toContain("Failed to write");
      expect(result.output).toContain("note locked");
    });
  });

  describe("draw_article_mindmap", () => {
    it("calls onMindmapReady with validated node/edge data", async () => {
      let received: unknown = null;
      const tools = createZoteroAgentTools({
        source,
        itemID: 1,
        onMindmapReady: (data) => {
          received = data;
        },
      });
      const tool = tools.find((t) => t.name === "draw_article_mindmap");
      expect(tool).toBeDefined();
      expect(tool?.requiresApproval).toBeUndefined();

      const result = await tool!.execute({
        title: "Test Paper",
        nodes: [
          { id: "root", label: "Main Thesis", type: "root" },
          { id: "s1", label: "Section One", type: "section" },
          { id: "p1", label: "Detail Point", type: "point" },
        ],
        edges: [
          { source: "root", target: "s1" },
          { source: "s1", target: "p1" },
        ],
      });

      expect(result.output).toContain("3 nodes");
      expect(result.output).toContain("2 edges");
      expect(result.summary).toContain("生成结构图");
      expect(received).toMatchObject({
        title: "Test Paper",
        nodes: [
          { id: "root", label: "Main Thesis", type: "root" },
          { id: "s1", label: "Section One", type: "section" },
          { id: "p1", label: "Detail Point", type: "point" },
        ],
        edges: [
          { source: "root", target: "s1" },
          { source: "s1", target: "p1" },
        ],
      });
    });

    it("returns an error when nodes array is missing", async () => {
      const tools = createZoteroAgentTools({ source, itemID: 1 });
      const tool = tools.find((t) => t.name === "draw_article_mindmap");
      const result = await tool!.execute({ edges: [] });
      expect(result.output).toContain("requires 'nodes' and 'edges' arrays");
    });

    it("skips edges referencing unknown node ids", async () => {
      let received: unknown = null;
      const tools = createZoteroAgentTools({
        source,
        itemID: 1,
        onMindmapReady: (d) => {
          received = d;
        },
      });
      const tool = tools.find((t) => t.name === "draw_article_mindmap");
      await tool!.execute({
        nodes: [{ id: "root", label: "Root" }],
        edges: [{ source: "root", target: "missing" }],
      });
      // The tool stores the raw edges list; rendering skips invalid ones
      expect((received as { edges: unknown[] }).edges).toHaveLength(1);
    });

    it("works without onMindmapReady callback", async () => {
      const tools = createZoteroAgentTools({ source, itemID: 1 });
      const tool = tools.find((t) => t.name === "draw_article_mindmap");
      const result = await tool!.execute({
        nodes: [{ id: "n1", label: "Only Node" }],
        edges: [],
      });
      expect(result.output).toContain("1 nodes");
    });
  });

  it("zotero_get_full_pdf returns a front block and an ack, not the buried text", async () => {
    const session = createZoteroAgentToolSession({
      source: {
        ...source,
        getFullText: async () => "PAPER BODY",
      },
      itemID: 1,
    });
    const tools = session.tools;
    const tool = tools.find((t) => t.name === "zotero_get_full_pdf")!;
    const result = await tool.execute({});

    expect(result.frontBlock).toBe("PAPER BODY");
    expect(result.output).not.toContain("PAPER BODY");
    expect(result.output).toContain("[Paper full text]");
    expect(result.context?.planMode).toBe("full_pdf");
  });

  it("zotero_get_full_pdf can save the exact debug front block once", async () => {
    let savedText = "";
    let savedMeta: unknown = null;
    const session = createZoteroAgentToolSession({
      source: {
        ...source,
        getFullText: async () => "PAPER BODY",
      },
      itemID: 1,
      debugFullTextSaver: async (text, meta) => {
        savedText = text;
        savedMeta = meta;
        return "/tmp/zotero-data/zotero-ai-sidebar/prompt-front-blocks/item-1-pdf.txt";
      },
    });
    const tool = session.tools.find((t) => t.name === "zotero_get_full_pdf")!;
    const result = await tool.execute({});

    expect(savedText).toBe("PAPER BODY");
    expect(savedMeta).toMatchObject({
      source: "pdf",
      tool: "zotero_get_full_pdf",
    });
    expect(result.context).toMatchObject({
      frontBlockDebugPath:
        "/tmp/zotero-data/zotero-ai-sidebar/prompt-front-blocks/item-1-pdf.txt",
      fullTextSource: "pdf",
    });
  });

  it("zotero_get_full_pdf reuses a frozen cache entry without re-extracting", async () => {
    // Pre-seed the in-memory paper-cache file with a frozen entry for item 1.
    paperCacheStore = JSON.stringify({
      "item:1": {
        pinned: false,
        fullText: "FROZEN PAPER TEXT",
        charCount: 17,
        capturedAt: "2026-01-01T00:00:00.000Z",
        source: "full_pdf",
      },
    });
    const tools = createZoteroAgentTools({
      source: {
        ...source,
        // A frozen copy exists, so extraction must not happen: a call here
        // means the reuse path was skipped.
        getFullText: async () => {
          throw new Error("getFullText must not be called when cache exists");
        },
      },
      itemID: 1,
    });
    const tool = tools.find((t) => t.name === "zotero_get_full_pdf")!;
    const result = await tool.execute({});

    expect(result.frontBlock).toBe("FROZEN PAPER TEXT");
    expect(result.context?.planMode).toBe("full_pdf");
  });

  it("zotero_get_full_pdf summary says arXiv LaTeX source (not PDF) when an arXiv source is cached", async () => {
    const latex = "\\section{Intro}\nGraspNet LaTeX body.";
    paperCacheStore = JSON.stringify({
      "item:1": {
        pinned: true,
        fullText: latex,
        charCount: latex.length,
        capturedAt: "2026-06-06T00:00:00.000Z",
        source: "full_pdf",
      },
    });
    const fs = new Map<string, string | Uint8Array>();
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        makeDirectory: async () => undefined,
        writeUTF8: async (p: string, d: string) => void fs.set(p, d),
        write: async (p: string, d: Uint8Array) => void fs.set(p, d),
        readUTF8: async (p: string) => {
          const value = fs.get(p);
          if (value == null) throw new Error("missing file");
          return typeof value === "string"
            ? value
            : new TextDecoder().decode(value);
        },
        read: async (p: string) => fs.get(p) as Uint8Array,
        exists: async (p: string) => fs.has(p),
      },
    });
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        ...(globalThis as any).Zotero,
        Items: {
          ...(globalThis as any).Zotero.Items,
          get: () => ({ key: "LATEXKEY1" }),
        },
      },
    });
    await writeArxivSource(
      "LATEXKEY1",
      [{ path: "main.tex", bytes: new TextEncoder().encode(latex) }],
      {
        itemKey: "LATEXKEY1",
        arxivId: "1912.13470",
        fetchedAt: "2026-06-06T00:00:00.000Z",
        mainTexRelPath: "main.tex",
        status: "ok",
      },
    );
    const session = createZoteroAgentToolSession({ source, itemID: 1 });
    const tool = session.tools.find(
      (candidate) => candidate.name === "zotero_get_full_pdf",
    )!;

    const result = await tool.execute({});

    expect(result.context?.fullTextSource).toBe("arxiv");
    expect(result.summary).toContain("读取 arXiv LaTeX 源码");
    expect(result.summary).not.toContain("读取 PDF 全文");
  });
});

function sourcePolicy() {
  return {
    fullPdfTokenBudget: 60_000,
    searchContextTokenBudget: 100_000,
    searchCandidateCount: 8,
    maxSelectedTextChars: 20_000,
    maxPassageChars: 1200,
    passageOverlapChars: 160,
    maxRangeChars: 9000,
    maxAnnotations: 80,
    retainedContextTurnCount: 4,
    retainedContextCharBudget: 8000,
    maxSearchTopK: 8,
    maxSelectedPassages: 3,
    fullTextCacheReadCharLimit: 400_000,
    maxToolIterations: 100,
    maxAnnotationCommentChars: 4000,
    maxFullTextHighlightCommentChars: 80,
    minLocateConfidence: 0.85,
  };
}

function readerWithPdfText(text: string): unknown {
  const pdfDocument = {
    numPages: 1,
    getPageLabels: async () => ["1"],
    getPage: async () => ({
      getTextContent: async () => ({
        items: [
          {
            str: text,
            transform: [1, 0, 0, 10, 0, 100],
            width: text.length * 10,
            height: 10,
          },
        ],
      }),
    }),
  };
  return {
    itemID: 2,
    _item: { id: 2, parentID: 1 },
    _internalReader: {
      _primaryView: {
        _iframeWindow: {
          PDFViewerApplication: { pdfDocument },
        },
      },
    },
  };
}

describe("zotero_outline_pdf", () => {
  it("returns a JSON skeleton from the PDF full-text cache", async () => {
    const text =
      "Abstract\nWe study X.\n\n1 Introduction\nMotivation.\n\n2 Method\nWe propose Y. See Figure 2.\n\n3 Conclusion\nDone.";
    const tools = createZoteroAgentTools({
      source: {
        getItem: async () => ({ title: "T" }) as never,
        getFullText: async () => text,
      },
      itemID: 1,
    });
    const tool = tools.find((t) => t.name === "zotero_outline_pdf")!;
    const res = await tool.execute({});
    const payload = JSON.parse(res.output.replace(/^\[Paper outline\]\n/, ""));
    expect(payload.source).toBe("pdf");
    expect(payload.coverage).toBe("headings");
    expect(payload.sections.map((s: { title: string }) => s.title)).toContain(
      "Method",
    );
    const method = payload.sections.find(
      (s: { title: string }) => s.title === "Method",
    );
    expect(method.anchors).toContain("Fig.2");
    expect(res.context?.planMode).toBe("outline");
  });
});

describe("render_paper_overview", () => {
  it("validates and forwards structured overview to the callback", async () => {
    let received: OverviewData | null = null;
    const tools = createZoteroAgentTools({
      source: { getItem: async () => null, getFullText: async () => "x" },
      itemID: 1,
      onOverviewReady: (d) => {
        received = d;
      },
    });
    const tool = tools.find((t) => t.name === "render_paper_overview")!;
    const res = await tool.execute({
      title: "T",
      source: "pdf",
      coverage: "headings",
      sections: [
        { no: "1", level: 1, title: "Intro", gist: "g", charStart: 0, charEnd: 10 },
      ],
      flowchart: {
        rankdir: "TB",
        nodes: [{ id: "a", label: "A", type: "root" }],
        edges: [],
      },
    });
    expect(received!.sections[0].title).toBe("Intro");
    expect(received!.flowchart!.nodes.length).toBe(1);
    expect(res.context?.planMode).toBe("overview");
  });
});
