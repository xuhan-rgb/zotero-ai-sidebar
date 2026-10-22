import { describe, expect, it, vi } from "vitest";
import { renderWebAgentNodePicker } from "../../src/modules/web-agent-node-picker";
import { selectWebAgentNode } from "../../src/modules/web-agent-installer";

vi.mock("../../src/modules/web-agent-installer", () => ({
  selectWebAgentNode: vi.fn(),
}));
vi.mock("../../src/utils/ui-locale", () => ({ uiText: (zh: string) => zh }));

describe("manual Node path controls", () => {
  it("shows the path controls by default without requiring a missing dependency error", () => {
    const root = renderWebAgentNodePicker(document, vi.fn(), vi.fn());
    expect(root.tagName).toBe("DETAILS");
    expect(root.querySelector("summary")!.textContent).toBe("Node.js 路径设置");
    expect(root.querySelector("input")).not.toBeNull();
    expect(root.open).toBe(true);
    root.open = false;
    expect(root.open).toBe(false);
  });
  it("accepts a pasted directory and rechecks the environment after validation", async () => {
    const onSaved = vi.fn(async () => {});
    vi.mocked(selectWebAgentNode).mockResolvedValueOnce({
      path: "/portable/bin/node",
      version: "24.0.0",
    });
    const root = renderWebAgentNodePicker(document, vi.fn(), onSaved);
    root.querySelector("input")!.value = "/portable";
    root.querySelectorAll<HTMLButtonElement>("button")[1].click();
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(selectWebAgentNode).toHaveBeenLastCalledWith("/portable");
  });
  it("fills a chosen executable without saving until the user applies it", async () => {
    vi.mocked(selectWebAgentNode).mockClear();
    const choose = vi.fn(async () => "/path/node");
    const root = renderWebAgentNodePicker(document, choose, vi.fn());
    root.querySelector("button")!.click();
    await vi.waitFor(() =>
      expect(root.querySelector("input")!.value).toBe("/path/node"),
    );
    expect(selectWebAgentNode).not.toHaveBeenCalled();
  });
  it("displays validation errors and keeps the controls usable for correction", async () => {
    const onSaved = vi.fn(async () => {});
    vi.mocked(selectWebAgentNode).mockRejectedValueOnce(
      new Error("请选择 node 而不是 install.sh"),
    );
    const root = renderWebAgentNodePicker(document, vi.fn(), onSaved);
    root.querySelector("input")!.value = "/home/user/.nvm/install.sh";
    const apply = root.querySelectorAll<HTMLButtonElement>("button")[1];
    apply.click();
    await vi.waitFor(() => expect(apply.disabled).toBe(false));
    expect(root.querySelector('[role="status"]')!.textContent).toContain(
      "install.sh",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
