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

/**
 * The host shape for one request; `totalTokens` stays omitted on purpose.
 *
 * @param u - the provider's report.
 * @param divisor - how many model calls that report covers. The provider reports once per run,
 *   accumulated over every call the run served, so the run's total is divided by that count to
 *   describe one request. Both operands are facts; nothing here is estimated.
 */
export function toTokenUsage(u: CursorUsage, divisor = 1): TokenUsage {
  const b = buckets(u);
  const calls = Math.max(1, Math.round(divisor) || 1);
  const share = (value: number) => Math.max(0, Math.round(value / calls));
  return { inputTokens: share(b.input), outputTokens: share(b.output), cacheReadTokens: share(b.cacheRead), cacheWriteTokens: share(b.cacheWrite) };
}
