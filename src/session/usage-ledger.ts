/**
 * The provider's usage report for the call that is currently open.
 *
 * Cursor reports usage once per provider turn, at that turn's end, and one provider turn is one
 * host call. Timing alone cannot tell a turn's report from the next turn's: a report for turn N
 * can land after call N+1 has already opened. So a report is accepted only while the open call has
 * already produced provider content for its own turn — a turn's report never precedes its own
 * content, which makes an early report belong to a turn that is already closed.
 */
import type { CursorUsage } from "../usage.ts";

export class UsageLedger {
  private open = false;
  private content = false;
  private value: CursorUsage | undefined;

  /** Mark a call as open; anything carried from a previous call is dropped. */
  begin(): void {
    this.open = true;
    this.content = false;
    this.value = undefined;
  }

  /** Close the call; a later report for it cannot be used. */
  end(): void {
    this.open = false;
    this.content = false;
    this.value = undefined;
  }

  /** The open call has produced content of its own, so a report now belongs to this turn. */
  sawContent(): void {
    if (this.open) this.content = true;
  }

  /** A provider report; ignored unless a call is open and has produced its own content. */
  report(usage: CursorUsage | undefined): void {
    if (!this.open || !this.content || !usage) return;
    this.value = usage;
  }

  get ready(): boolean {
    return this.value !== undefined;
  }

  /** Whether the open call has produced content of its own; diagnostics only. */
  get hasContent(): boolean {
    return this.content;
  }

  take(): CursorUsage | undefined {
    const value = this.value;
    this.value = undefined;
    return value;
  }
}

/**
 * Wait up to `waitMs` for the open call's report, then take it.
 * @returns the report, or undefined when none arrived in time.
 */
export async function takeUsage(
  ledger: UsageLedger,
  waitMs: number,
  wait: (ms: number) => Promise<void>,
): Promise<CursorUsage | undefined> {
  const deadline = Date.now() + Math.max(0, waitMs);
  while (!ledger.ready) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;
    await wait(remaining);
  }
  return ledger.take();
}
