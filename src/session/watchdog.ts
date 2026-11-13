/**
 * Inactivity monitor for one provider run.
 *
 * A run can keep the transport alive with status frames while producing nothing, so the window
 * measures content, not traffic. It is suspended while a tool call is waiting on the host, which
 * legitimately produces no provider content for as long as the tool runs.
 */
export interface StallInfo {
  elapsedMs: number;
  lastEvent: string;
}

export interface WatchdogOptions {
  /** 0 disables the watchdog. */
  timeoutMs: number;
  onStall: (info: StallInfo) => void;
  now?: () => number;
}

/** Message types that are traffic but not progress. */
const KEEP_ALIVE = "status";

export class StallWatchdog {
  private readonly options: WatchdogOptions;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private startedAt = 0;
  private lastEvent = "none";
  private suspended = false;
  private fired = false;

  constructor(options: WatchdogOptions) {
    this.options = options;
  }

  /** Record provider progress and restart the window. Keep-alives do not count. */
  touch(event: string): void {
    if (event === KEEP_ALIVE && this.startedAt !== 0) return;
    this.lastEvent = event;
    this.arm();
  }

  suspend(): void {
    this.suspended = true;
    this.clear();
  }

  resume(): void {
    this.suspended = false;
    this.fired = false;
    this.arm();
  }

  stop(): void {
    this.suspended = true;
    this.clear();
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private arm(): void {
    this.clear();
    if (this.suspended || this.options.timeoutMs <= 0) return;
    this.startedAt = this.now();
    this.timer = setTimeout(() => this.fire(), this.options.timeoutMs);
    this.timer.unref?.();
  }

  private fire(): void {
    this.timer = undefined;
    if (this.suspended || this.fired) return;
    this.fired = true;
    this.options.onStall({ elapsedMs: Math.max(0, this.now() - this.startedAt), lastEvent: this.lastEvent });
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
