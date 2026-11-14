/**
 * The provider's usage report for the call that is currently open.
 *
 * Cursor reports usage once per run, at the run's end, accumulated over every call the run served.
 * Timing alone cannot tell that report from the next run's: a report for one run can land after
 * the next call has already opened. So a report is accepted only while the open call has already
 * produced provider content — a report never precedes its own content, which makes an early report
 * belong to a call that is already closed. Nothing waits for a report; one that has not arrived by
 * the end of a call is simply not reported.
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
