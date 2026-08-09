import { describe, expect, it, vi } from "vitest";

import { checkLatexSourceAvailability } from "../../src/modules/latex-source-availability";

describe("checkLatexSourceAvailability", () => {
  it("reports an available source after the source check succeeds", async () => {
    const ensureSource = vi.fn().mockResolvedValue(true);
    const readMeta = vi.fn();

    await expect(
      checkLatexSourceAvailability("2504.16054", {
        ensureSource,
        readMeta,
      }),
    ).resolves.toBe("available");
    expect(ensureSource).toHaveBeenCalledOnce();
    expect(readMeta).not.toHaveBeenCalled();
  });

  it("reuses a settled result for later renders of the same paper", async () => {
    const ensureSource = vi.fn().mockResolvedValue(true);
    const dependencies = { ensureSource, readMeta: vi.fn() };

    await checkLatexSourceAvailability("2504.16055", dependencies);
    await checkLatexSourceAvailability("2504.16055", dependencies);

    expect(ensureSource).toHaveBeenCalledOnce();
  });

  it("distinguishes an explicit no-source result from a failed check", async () => {
    const ensureSource = vi.fn().mockResolvedValue(false);

    await expect(
      checkLatexSourceAvailability("2401.00001", {
        ensureSource,
        readMeta: vi.fn().mockResolvedValue({ status: "no-source" }),
      }),
    ).resolves.toBe("no-source");

    await expect(
      checkLatexSourceAvailability("2401.00002", {
        ensureSource,
        readMeta: vi.fn().mockResolvedValue(null),
      }),
    ).resolves.toBe("error");
  });

  it("coalesces concurrent checks for the same arXiv ID", async () => {
    let resolveEnsure!: (value: boolean) => void;
    const ensureSource = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveEnsure = resolve;
        }),
    );
    const dependencies = { ensureSource, readMeta: vi.fn() };

    const first = checkLatexSourceAvailability("2504.16056", dependencies);
    const second = checkLatexSourceAvailability("2504.16056", dependencies);
    expect(ensureSource).toHaveBeenCalledOnce();

    resolveEnsure(true);
    await expect(Promise.all([first, second])).resolves.toEqual([
      "available",
      "available",
    ]);
  });

  it("reports thrown checks as errors and releases the in-flight entry", async () => {
    const ensureSource = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(true);
    const dependencies = { ensureSource, readMeta: vi.fn() };

    await expect(
      checkLatexSourceAvailability("2504.16057", dependencies),
    ).resolves.toBe("error");
    await expect(
      checkLatexSourceAvailability("2504.16057", dependencies),
    ).resolves.toBe("available");
    expect(ensureSource).toHaveBeenCalledTimes(2);
  });
});
