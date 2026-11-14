/**
 * Debounced configuration writes for the settings page.
 *
 * One pending write per field: a second change before the delay replaces the first, so a fast
 * sequence of clicks lands as the last value. The page updates its own view immediately and only
 * hears from this writer when a write fails.
 */
import type { PathOp } from "./derive.ts";

/** Callbacks and clock the writer needs. */
export interface AutosaveDeps {
  /** Apply one field edit; resolves false when the host refused it. */
  write: (ops: PathOp[], revision: number | undefined) => Promise<boolean>;
  /** Called with the refusal or the transport failure; the page rolls the control back. */
  onFailure: (error: unknown) => void;
  /** Quiet period before a scheduled write; defaults to 400 ms. */
  delayMs?: number;
  /** Overridden by tests. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface PendingWrite {
  ops: PathOp[];
  revision: number | undefined;
  timer: unknown;
}

const DEFAULT_DELAY_MS = 400;

export class Autosave {
  private readonly deps: AutosaveDeps;
  private readonly pending = new Map<string, PendingWrite>();
  private disposed = false;

  constructor(deps: AutosaveDeps) {
    this.deps = deps;
  }

  /** How many fields are waiting to be written. */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Queue one field write, replacing any write already queued for that field.
   * @param key - the field identity, so two controls never coalesce.
   * @param ops - path operations for the whole change of that field.
   * @param revision - the namespace revision the change was made against.
   */
  schedule(key: string, ops: PathOp[], revision: number | undefined): void {
    if (this.disposed) return;
    const previous = this.pending.get(key);
    if (previous) this.clear(previous.timer);
    const timer = this.timer(() => {
      void this.fire(key);
    }, this.deps.delayMs ?? DEFAULT_DELAY_MS);
    this.pending.set(key, { ops, revision, timer });
  }

  /** Write everything pending now, in the order it was scheduled. */
  async flush(): Promise<void> {
    for (const key of [...this.pending.keys()]) {
      const entry = this.pending.get(key);
      if (!entry) continue;
      this.clear(entry.timer);
      await this.fire(key);
    }
  }

  /** Flush what is pending and stop accepting new writes. */
  dispose(): void {
    this.disposed = true;
    void this.flush();
  }

  private timer(callback: () => void, ms: number): unknown {
    if (this.deps.setTimer) return this.deps.setTimer(callback, ms);
    return setTimeout(callback, ms);
  }

  private clear(handle: unknown): void {
    if (this.deps.clearTimer) this.deps.clearTimer(handle);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  private async fire(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    try {
      const accepted = await this.deps.write(entry.ops, entry.revision);
      if (!accepted) this.deps.onFailure(new Error("the host refused the change"));
    } catch (error: unknown) {
      this.deps.onFailure(error);
    }
  }
}
