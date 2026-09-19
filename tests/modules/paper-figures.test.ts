import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  estimateEquationRanges,
  loadPaperFigures,
  paperEquationPage,
  paperFigurePage,
} from "../../src/modules/paper-figures";

const CACHE = "/data/zotero-ai-sidebar-mineru/ROOTKEY";
const PDF_PATH = "/data/storage/paper.pdf";

const contentList = [
  { type: "text", text: "1 Introduction" },
  {
    type: "image",
    img_path: "images/fig1.jpg",
    image_caption: ["Figure 1: System overview of the model."],
    page_idx: "2",
  },
  {
    type: "chart",
    img_path: "images/chart1.png",
    chart_caption: "Figure 2: Latency.",
    page_idx: "4",
  },
  {
    type: "equation",
    text: "$$\nE = m c ^ {2}\\tag{7}\n$$",
    page_idx: "4",
  },
  {
    type: "table",
    img_path: "images/table1.jpg",
    table_caption: ["Table 1: Planning metrics."],
  },
  {
    type: "table",
    table_body:
      "<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>",
    table_caption: ["Table 2: Conversion check."],
    page_idx: "5",
  },
  { type: "image", img_path: "../escape.png", image_caption: "bad path" },
  { type: "image", img_path: "images/missing.jpg", image_caption: "Figure 4" },
];

const existing = new Set([
  `${CACHE}/meta.json`,
  `${CACHE}/full.md`,
  `${CACHE}/content_list.json`,
  `${CACHE}/assets/images/fig1.jpg`,
  `${CACHE}/assets/images/chart1.png`,
  `${CACHE}/assets/images/table1.jpg`,
  PDF_PATH,
]);

const PICTURE_PATHS = [
  `${CACHE}/assets/images/fig1.jpg`,
  `${CACHE}/assets/images/chart1.png`,
  `${CACHE}/assets/images/table1.jpg`,
];

/** MinerU's stored result for this parse, as the extend-result zip download. */
function mineruResultZip(): Uint8Array {
  return zipSync({
    "result/full.md": strToU8("# Paper"),
    "result/images/fig1.jpg": strToU8("fig"),
    "result/images/chart1.png": strToU8("chart"),
    "result/images/table1.jpg": strToU8("table"),
  });
}

function stubMineruDownload(): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/extract-results/batch/batch-1")) {
      return Response.json({
        code: 0,
        data: {
          extract_result: [
            { state: "done", full_zip_url: "https://example.test/result.zip" },
          ],
        },
      });
    }
    if (url === "https://example.test/result.zip") {
      return new Response(mineruResultZip());
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      DataDirectory: { dir: "/data" },
      Profile: { dir: "/data/profile" },
      Items: {
        get: (id: number) =>
          id === 10
            ? {
                key: "ROOTKEY",
                getAttachments: () => [11],
              }
            : id === 11
              ? {
                  key: "PDFKEY",
                  isPDFAttachment: () => true,
                  getFilePathAsync: async () => PDF_PATH,
                }
              : null,
      },
    },
  });
  Object.defineProperty(globalThis, "IOUtils", {
    configurable: true,
    value: {
      exists: async (path: string) => existing.has(path),
      stat: async () => ({ size: 100, lastModified: 200 }),
      readUTF8: async (path: string) => {
        if (path === `${CACHE}/meta.json`) {
          return JSON.stringify({
            itemKey: "ROOTKEY",
            pdfSize: 100,
            pdfMtime: 200,
            sourceHash: "hash",
            batchId: "batch-1",
            parsedAt: "2026-01-01",
          });
        }
        if (path === `${CACHE}/full.md`) return "# Paper";
        if (path === `${CACHE}/content_list.json`)
          return JSON.stringify(contentList);
        throw new Error(`unexpected read: ${path}`);
      },
      read: async () => new Uint8Array(),
      write: async () => undefined,
      makeDirectory: async () => undefined,
      writeUTF8: async () => undefined,
    },
  });
});

describe("paper figures from the MinerU cache", () => {
  it("labels figures and tables and skips missing or unsafe images", async () => {
    const figures = await loadPaperFigures(10);

    expect(figures.map((figure) => figure.label)).toEqual([
      "图 1",
      "图 2",
      "公式 7",
      "表 1",
      "表 2",
    ]);
    expect(figures.map((figure) => figure.kind)).toEqual([
      "figure",
      "figure",
      "equation",
      "table",
      "table",
    ]);
    expect(figures[0].caption).toBe("Figure 1: System overview of the model.");
    expect(figures[0].path).toBe(`${CACHE}/assets/images/fig1.jpg`);
    expect(figures[0].mediaType).toBe("image/jpeg");
    expect(figures[0].page).toBe(2);
    expect(figures[2].latex).toContain("E = m c ^ {2}");
    expect(figures[3].mediaType).toBe("image/jpeg");
    expect(figures[4].kind).toBe("table");
    expect(figures[4].latex).toContain("\\begin{tabular}");
    expect(figures[4].path).toBeUndefined();
    expect(figures[4].page).toBe(5);
  });
});

describe("pictures a parse cache never stored locally", () => {
  const tokenPref = JSON.stringify({ token: "test-token" });

  beforeEach(() => {
    for (const path of PICTURE_PATHS) existing.delete(path);
    const zotero = (globalThis as any).Zotero;
    zotero.Prefs = { get: () => tokenPref, set: () => undefined };
    const io = (globalThis as any).IOUtils;
    io.write = async (path: string) => {
      existing.add(path);
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const path of PICTURE_PATHS) existing.add(path);
  });

  it("fetches the crops from MinerU's stored result before listing", async () => {
    const fetch = stubMineruDownload();

    const figures = await loadPaperFigures(10);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(figures.map((figure) => figure.label)).toEqual([
      "图 1",
      "图 2",
      "公式 7",
      "表 1",
      "表 2",
    ]);
    expect(figures[0].path).toBe(`${CACHE}/assets/images/fig1.jpg`);
  });

  it("keeps the text material when the crops cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: -1, msg: "expired" })),
    );

    const figures = await loadPaperFigures(10);

    expect(figures.map((figure) => figure.kind)).toEqual(["equation", "table"]);
  });
});

describe("matching a LaTeX float to a reader page", () => {
  // The reader hands out one char per glyph and drops the spaces between
  // words, so page text arrives as a single unbroken run of characters.
  const pageOne =
    "Fig.1:BEVFusionunifiescameraandLiDARfeaturesinasharedBEVspace.";
  const pageThree =
    "AsTab.IIshows,theproposedmethodwins.ItalsoappearsinFigure4asthebestvariant.";
  const pageFive =
    "Tab.II:BEVFusionachievesstate-of-the-art3DobjectdetectionperformanceonnuScenes.";
  const pageSix =
    "Fig.4:BEVFusionoutperformsstate-of-the-artsingle-andmulti-modalitydetectors.";
  const pages = ["", pageOne, pageThree, "", pageFive, pageSix];

  it("prefers the page that prints the caption over prose mentions", () => {
    expect(
      paperFigurePage(
        "figure",
        4,
        "BEVFusion outperforms state-of-the-art single- and multi-modality detectors",
        pages,
      ),
    ).toBe(5);
    expect(
      paperFigurePage(
        "table",
        2,
        "BEVFusion achieves state-of-the-art 3D object detection performance on nuScenes",
        pages,
      ),
    ).toBe(4);
  });

  it("ignores LaTeX commands the PDF never prints", () => {
    expect(
      paperFigurePage(
        "figure",
        1,
        "\\textbf{BEVFusion} unifies camera and LiDAR features in a shared BEV space.",
        pages,
      ),
    ).toBe(1);
  });

  it("falls back to the float number and reads Roman-numbered tables", () => {
    const printed = [
      "",
      "Fig.2:Somefigurecaption.",
      "Tab.II:Sometablecaption.",
    ];
    expect(paperFigurePage("figure", 2, undefined, printed)).toBe(1);
    expect(paperFigurePage("table", 2, undefined, printed)).toBe(2);
    // "Figure 4a" is a prose cross-reference, not the caption of figure 4.
    expect(
      paperFigurePage("figure", 4, undefined, [
        "",
        "seeFigure4afor",
        "Fig.4:Thecaption.",
      ]),
    ).toBe(2);
  });

  it("says nothing rather than guessing when there is nothing to match", () => {
    expect(paperFigurePage("table", 9, "Too short.", pages)).toBe(undefined);
    expect(paperFigurePage("figure", 3, undefined, [])).toBe(undefined);
  });
});

describe("matching a LaTeX equation to a reader page", () => {
  // The reader hands out one char per glyph and drops the spaces between
  // words, so page text arrives as a single unbroken run of characters.
  const pageTwo =
    "wherep(t)denotesthe3Degoposition.A(st,...,s(t-T+1))={p(t),p(t+1),...,p(t+T-1)}(1)and(2)";
  const pageThree =
    "theconventionalpipelinecanbeformulatedas:p(z(T+1),...,p(T-1))=p(st,st-1)(2)despite(2)offering";
  const pageFour =
    "aswork(17,18,25),itusuallyrequiresground-truthlabelsw(t)=f(y(T-T+1),p(T+1))(3)";
  const pages = ["", "", pageTwo, pageThree, pageFour];

  it("finds the page that prints the equation number", () => {
    expect(paperEquationPage(1, "A(s^t) = \\{p^t\\}", pages)).toBe(2);
    expect(paperEquationPage(3, "w(t)=f(y^{t-T+1})", pages)).toBe(4);
  });

  it("disambiguates prose mentions with the equation body", () => {
    // "(2)" is printed on pages 2 and 3, but only page 3 carries the body.
    expect(
      paperEquationPage(
        2,
        "p(z^{t+1}, \\ldots, p^{T-1}) = p_{\\tau}(\\{s^t, s^{t-1}\\})",
        pages,
      ),
    ).toBe(3);
  });

  it("matches a body the PDF prints with operator names and accent glyphs", () => {
    // Real case (OccWorld, arXiv 2311.16038): "(4)" prints on the equation's
    // page and again in a reference, and the printed body carries "min" plus
    // the hat over z, which the LaTeX-derived body never contains.
    const equationPage =
      "zij=N(z\u02C6ij,C)=minc\u2208C||z\u02C6ij\u2212c||2,(4)where||\u00B7||2denotestheL2norm";
    const referencePage =
      "ALearnedArchitectureforLearning,Planning,andReacting.ACMSigartBulletin,2(4):160\u2013163,1991";
    const printed = ["", "", referencePage, equationPage];

    expect(
      paperEquationPage(
        4,
        "\\mathbf{z}_{ij} = \\mathcal{N}(\\hat{\\mathbf{z}}_{ij}, \\mathbf{C}) = \\min_{\\mathbf{c} \\in \\mathbf{C}} ||\\hat{\\mathbf{z}}_{ij} - \\mathbf{c} ||_2,",
        printed,
      ),
    ).toBe(3);
  });

  it("refuses to pin a page when the relaxed body also matches two", () => {
    const printed = ["", "see(4)zijnzijcmincczijc2x", "yzijnzijcmincczijc2(4)z"];

    expect(
      paperEquationPage(
        4,
        "\\mathbf{z}_{ij} = \\mathcal{N}(\\hat{\\mathbf{z}}_{ij}, \\mathbf{C}) = \\min_{\\mathbf{c} \\in \\mathbf{C}} ||\\hat{\\mathbf{z}}_{ij} - \\mathbf{c} ||_2,",
        printed,
      ),
    ).toBe(undefined);
  });

  it("says nothing when the number is ambiguous and the body is too generic", () => {
    expect(paperEquationPage(2, "x = y", pages)).toBe(undefined);
    expect(paperEquationPage(9, "x = y", pages)).toBe(undefined);
    expect(paperEquationPage(1, "A(s^t) = \\{p^t\\}", [])).toBe(undefined);
  });

  it("does not match a longer number's digits as the shorter one", () => {
    const printed = ["", "see(12)and(13)for", "thebodyx=y=z(a+b)(2)"];
    expect(paperEquationPage(2, "x = y = z (a + b)", printed)).toBe(2);
    expect(paperEquationPage(1, "x = y = z (a + b)", printed)).toBe(undefined);
  });
});

describe("estimating an equation's page range from its neighbors", () => {
  it("interpolates between the nearest known pages on both sides", () => {
    expect(
      estimateEquationRanges([0, undefined, undefined, 3, undefined], 6),
    ).toEqual([undefined, [0, 3], [0, 3], undefined, [3, 5]]);
  });

  it("clamps a one-sided anchor to the document edge", () => {
    expect(estimateEquationRanges([undefined, 2], 6)).toEqual([
      [0, 2],
      undefined,
    ]);
    expect(estimateEquationRanges([4, undefined], 6)).toEqual([
      undefined,
      [4, 5],
    ]);
  });

  it("leaves the equation page-less when no neighbor is known", () => {
    expect(estimateEquationRanges([undefined, undefined], 6)).toEqual([
      undefined,
      undefined,
    ]);
  });
});
