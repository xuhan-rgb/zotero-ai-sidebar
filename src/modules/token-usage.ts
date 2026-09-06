import type { Message } from "../providers/types";

export function messageUsageBreakdown(usage: NonNullable<Message["usage"]>): {
  rawInput: number;
  cacheReturned: boolean;
  cacheHit: number;
  cacheMiss: number;
  output: number;
  total: number;
  cacheRate: number | null;
  mode: string;
} {
  const rawInput = Math.max(0, usage.input || 0);
  const output = Math.max(0, usage.output || 0);
  if (usage.cacheRead == null) {
    return {
      rawInput,
      cacheReturned: false,
      cacheHit: 0,
      cacheMiss: rawInput,
      output,
      total: rawInput + output,
      cacheRate: null,
      mode: "服务端未返回缓存字段",
    };
  }

  const cacheHit = Math.max(0, usage.cacheRead || 0);
  // Official OpenAI-style usage reports cached tokens as a subset of input.
  // Some compatible relays report `input` as cache-miss tokens and cache
  // reads separately. Use the only interpretation that keeps hit rate <=100%.
  const officialLike = cacheHit <= rawInput;
  const cacheMiss = officialLike ? rawInput - cacheHit : rawInput;
  const inputTotal = cacheHit + cacheMiss;
  const cacheRate =
    inputTotal > 0 ? Math.round((cacheHit / inputTotal) * 100) : 0;
  return {
    rawInput,
    cacheReturned: true,
    cacheHit,
    cacheMiss,
    output,
    total: inputTotal + output,
    cacheRate,
    mode: officialLike
      ? "官方口径：缓存命中包含在输入 tokens 内"
      : "兼容口径：输入 tokens 视为未命中，缓存命中单独返回",
  };
}

export function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}
