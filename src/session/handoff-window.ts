/**
 * How long one tool-call delivery may hold, per model.
 *
 * The window starts at zero: a delivery leaves as soon as it has a call. It grows
 * only on evidence — a sibling call that arrived after that model's delivery — and
 * only to a size that would have covered the observed gap: the grown window when it
 * fits the ceiling, else the ceiling itself when the gap fits it, else nothing.
 * Measured across six models, siblings arrive in the same tick, 17-120 ms apart, or
 * seconds apart, and a split costs one provider turn, which is why a gap the ceiling
 * cannot cover never raises the window: it would charge every step for a split it
 * cannot prevent.
 *
 * The policy holds no session state: the learning belongs to the model, and a session
 * may be dropped at any time.
 */

/** Documented ceiling for the collection window, in milliseconds. */
export const HANDOFF_CEILING_MS = 50;

/** How much of the observed gap a raised window covers. */
const GROWTH = 1.5;

export interface HandoffWindowOptions {
  /** Window used before this model has ever been observed missing a sibling. */
  baseMs?: number;
  /** Largest window the policy may adopt. */
  ceilingMs?: number;
}

export class HandoffWindow {
  private readonly values = new Map<string, number>();
  private readonly baseMs: number;
  private readonly ceilingMs: number;

  constructor(options: HandoffWindowOptions = {}) {
    this.baseMs = Math.max(0, options.baseMs ?? 0);
    this.ceilingMs = Math.max(0, options.ceilingMs ?? HANDOFF_CEILING_MS);
  }

  /** How long a delivery for this model may hold; 0 when it may not hold at all. */
  windowFor(modelId: string): number {
    return this.values.get(modelId) ?? this.baseMs;
  }

  /**
   * A sibling call arrived after this model's delivery.
   * @param modelId - the model whose delivery missed the sibling.
   * @param gapMs - how long after the delivery the sibling arrived.
   * @returns the window now in effect for that model.
   */
  observe(modelId: string, gapMs: number): number {
    const current = this.windowFor(modelId);
    if (!modelId || !Number.isFinite(gapMs) || gapMs <= 0) return current;
    const wanted = Math.ceil(gapMs * GROWTH);
    const size = wanted <= this.ceilingMs ? wanted : gapMs <= this.ceilingMs ? this.ceilingMs : 0;
    if (size <= current) return current;
    this.values.set(modelId, size);
    return size;
  }
}
