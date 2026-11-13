/**
 * Cursor usage -> host usage.
 *
 * Cursor states `inputTokens`, `outputTokens`, `cacheReadTokens` and `cacheWriteTokens` and
 * derives `totalTokens` as their sum, so the four are disjoint buckets. The host reads disjoint
 * buckets as one request (`inputTokens` is uncached input) and discards a `totalTokens` that
 * disagrees with them, so the total is never emitted.
 */
import type { TokenUsage } from "./reply.ts";

export interface CursorUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

export interface UsageBuckets {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Disjoint buckets exactly as the provider states them. */
export function buckets(u: CursorUsage): UsageBuckets {
  return {
    input: Math.max(0, u.inputTokens ?? 0),
    output: Math.max(0, u.outputTokens ?? 0),
    cacheRead: Math.max(0, u.cacheReadTokens ?? 0),
    cacheWrite: Math.max(0, u.cacheWriteTokens ?? 0),
  };
}

/** The host shape for one request; `totalTokens` stays omitted on purpose. */
export function toTokenUsage(u: CursorUsage): TokenUsage {
  const b = buckets(u);
  return { inputTokens: b.input, outputTokens: b.output, cacheReadTokens: b.cacheRead, cacheWriteTokens: b.cacheWrite };
}
