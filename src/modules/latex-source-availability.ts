import { ensureArxivSource } from "../context/arxiv-source";
import { readArxivMeta } from "../context/arxiv-store";

export type LatexSourceAvailability = "available" | "no-source" | "error";

interface LatexSourceAvailabilityDependencies {
  ensureSource: (arxivId: string) => Promise<boolean>;
  readMeta: (arxivId: string) => Promise<{ status?: string } | null>;
}

const defaultDependencies: LatexSourceAvailabilityDependencies = {
  ensureSource: (arxivId) => ensureArxivSource({ arxivId }),
  readMeta: readArxivMeta,
};

const inFlightChecks = new Map<string, Promise<LatexSourceAvailability>>();
const settledChecks = new Map<string, LatexSourceAvailability>();

export function checkLatexSourceAvailability(
  arxivId: string,
  dependencies: LatexSourceAvailabilityDependencies = defaultDependencies,
): Promise<LatexSourceAvailability> {
  const settled = settledChecks.get(arxivId);
  if (settled) return Promise.resolve(settled);
  const existing = inFlightChecks.get(arxivId);
  if (existing) return existing;

  const pending = (async (): Promise<LatexSourceAvailability> => {
    try {
      if (await dependencies.ensureSource(arxivId)) {
        settledChecks.set(arxivId, "available");
        return "available";
      }
      const meta = await dependencies.readMeta(arxivId);
      if (meta?.status === "no-source") {
        settledChecks.set(arxivId, "no-source");
        return "no-source";
      }
      return "error";
    } catch {
      return "error";
    }
  })();
  inFlightChecks.set(arxivId, pending);
  void pending.finally(() => {
    if (inFlightChecks.get(arxivId) === pending) {
      inFlightChecks.delete(arxivId);
    }
  });
  return pending;
}
