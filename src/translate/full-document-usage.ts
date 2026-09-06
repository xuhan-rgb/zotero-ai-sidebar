import type { FullTranslationUsage } from "../settings/full-translation-store";

export function mergeUsage(
  first?: FullTranslationUsage,
  second?: FullTranslationUsage,
): FullTranslationUsage | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    input: first.input + second.input,
    output: first.output + second.output,
    ...((first.cacheRead != null || second.cacheRead != null) && {
      cacheRead: (first.cacheRead ?? 0) + (second.cacheRead ?? 0),
    }),
    ...(first.cacheReadIncludedInInput === second.cacheReadIncludedInInput &&
      first.cacheReadIncludedInInput != null && {
        cacheReadIncludedInInput: first.cacheReadIncludedInInput,
      }),
  };
}
