/**
 * One timing record per host model call, and the sink that writes them.
 *
 * Off unless the `timing` configuration option is enabled. The record describes the
 * plugin's own view of a call — what it waited for, what it sent, what the provider
 * streamed, and the report it carried. Nothing is estimated: a field the plugin does
 * not observe stays absent. Writing is best effort, happens outside the call's path and
 * never affects a call.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** The usage the plugin reported to the host for one call. */
export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** How one call ended. */
export type StepOutcome = "tool-calls" | "stop" | "error" | "aborted" | "stalled";

/** What one step record carries. */
export interface StepRecord {
  time: string;
  key: string;
  model: string;
  /** Whether the call reused a provider session or created one. */
  reused: boolean;
  /** Collection window in effect for this call, in milliseconds. */
  windowMs: number;
  outcome: StepOutcome;
  /** Time before the provider was asked, from the call start. */
  preSendMs?: number;
  /** Time to the first delivered content, when the call delivered any. */
  firstContentMs?: number;
  /** Time from the call start to its delivery or its end. */
  durationMs: number;
  /** Tool calls delivered by this call. */
  tools?: number;
  /** Conversation characters sent for this call. */
  sentChars?: number;
  /** Text deltas the call delivered. */
  textChunks?: number;
  /** Reasoning deltas the call delivered. */
  thinkingChunks?: number;
  /** Tokens the provider reported streaming in this call's chunks. */
  streamedTokens?: number;
  /** Duration the provider reported for the step, when it reported one. */
  stepDurationMs?: number;
  /** Gap of a sibling call that arrived after the previous delivery. */
  lateSiblingMs?: number;
  usage?: StepUsage;
}

/** What the turn needs from telemetry: whether it is on, and where a record goes. */
export interface TimingDeps {
  enabled: () => boolean;
  write: (record: StepRecord) => void;
}

/** Fields a caller sets as it learns them; the counters are fed through `noteDelta` and `chunk`. */
export type StepNote = Partial<Pick<StepRecord, "tools" | "sentChars" | "lateSiblingMs" | "usage">>;

export interface StepTimingOptions {
  now?: () => number;
}

/** Accumulates one call's marks and produces its record. */
export class StepTiming {
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly record: StepRecord;
  private sentAt: number | undefined;
  private contentAt: number | undefined;
  private streamedTokens = 0;
  private stepDurationMs: number | undefined;
  private textChunks = 0;
  private thinkingChunks = 0;

  constructor(key: string, model: string, windowMs: number, options: StepTimingOptions = {}) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.record = {
      time: new Date(this.startedAt).toISOString(),
      key,
      model,
      reused: false,
      windowMs,
      outcome: "stop",
      durationMs: 0,
    };
  }

  /** The call continued an existing provider session. */
  reuse(): void {
    this.record.reused = true;
  }

  /** The provider was asked for this call. The first mark wins. */
  sent(): void {
    this.sentAt ??= this.now();
  }

  /** The call delivered content for the first time. The first mark wins. */
  content(): void {
    this.contentAt ??= this.now();
  }

  /** One delivered delta of the given kind. */
  chunk(kind: "text" | "thinking"): void {
    if (kind === "text") this.textChunks += 1;
    else this.thinkingChunks += 1;
  }

  /** One SDK per-update callback: a streamed token count or a reported step duration. */
  noteDelta(update: any): void {
    if (!update) return;
    if (update.type === "token-delta" && typeof update.tokens === "number") {
      this.streamedTokens += Math.max(0, update.tokens);
    } else if (update.type === "step-completed" && typeof update.stepDurationMs === "number") {
      this.stepDurationMs = update.stepDurationMs;
    }
  }

  /** Record what the call learned as it went. */
  note(patch: StepNote): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (this.record as unknown as Record<string, unknown>)[key] = value;
    }
  }

  /**
   * Close the record.
   * @param outcome - how the call ended.
   * @returns the record to write.
   */
  finish(outcome: StepOutcome): StepRecord {
    const end = this.now();
    this.record.outcome = outcome;
    this.record.durationMs = Math.max(0, end - this.startedAt);
    if (this.sentAt !== undefined) this.record.preSendMs = Math.max(0, this.sentAt - this.startedAt);
    if (this.contentAt !== undefined) this.record.firstContentMs = Math.max(0, this.contentAt - this.startedAt);
    if (this.streamedTokens > 0) this.record.streamedTokens = this.streamedTokens;
    if (this.stepDurationMs !== undefined) this.record.stepDurationMs = this.stepDurationMs;
    if (this.textChunks > 0) this.record.textChunks = this.textChunks;
    if (this.thinkingChunks > 0) this.record.thinkingChunks = this.thinkingChunks;
    return this.record;
  }
}

/**
 * The sink that appends JSON lines per step next to the plugin's other state.
 *
 * Records are buffered and flushed on the next tick, so the host's terminal chunk never waits on
 * the filesystem. A directory that cannot be written only loses the buffered records.
 */
export function createTimingSink(dir: string): (record: StepRecord) => void {
  const path = join(dir, "timing.log");
  let ready = false;
  let pending: StepRecord[] = [];
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    try {
      if (!ready) {
        mkdirSync(dir, { recursive: true });
        ready = true;
      }
      appendFileSync(path, batch.map((record) => JSON.stringify(record) + "\n").join(""));
    } catch {
      /* diagnostics are best effort */
    }
  };
  return (record) => {
    pending.push(record);
    if (scheduled) return;
    scheduled = true;
    setImmediate(flush);
  };
}
