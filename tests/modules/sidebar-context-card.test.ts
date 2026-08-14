import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderContextCard } from "../../src/modules/sidebar";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);

beforeEach(() => {
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Items: {
        get: () => ({
          getField: (field: string) =>
            field === "title" ? "Current paper" : "",
        }),
      },
    },
  });
});

describe("paper context card", () => {
  it("puts the linked GitHub repository before the item id", () => {
    const card = renderContextCard(
      document,
      1494,
      "https://github.com/owner/repo",
    );
    const metadata = card.querySelector(".ctx-meta")!;
    const repository = metadata.querySelector<HTMLAnchorElement>(
      ".ctx-github-repository",
    )!;

    expect(metadata.firstElementChild).toBe(repository);
    expect(repository.textContent).toBe("GitHub：owner/repo");
    expect(repository.href).toBe("https://github.com/owner/repo");
    expect(repository.target).toBe("_blank");
    expect(metadata.textContent).toContain("Item ID: 1494");
  });

  it("omits the GitHub entry when the paper has no linked repository", () => {
    const card = renderContextCard(document, 1494);

    expect(card.querySelector(".ctx-github-repository")).toBeNull();
    expect(card.querySelector(".ctx-meta")?.textContent).toBe("Item ID: 1494");
  });

  it("passes the linked repository while the paper network view is open", () => {
    expect(sidebarSource).toContain(
      'sidebar?.overviewNav?.activeView === "network"',
    );
    expect(sidebarSource).toContain(
      "else if (panelState) renderPanel(sidebar.mount, panelState)",
    );
  });
});
