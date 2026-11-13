/**
 * One Cursor agent per host session, and the state of its current run.
 *
 * The session owns the provider run lifecycle, the tool calls waiting to be handed to the host,
 * the usage ledger for the open call and the inactivity watchdog. It does not decide what to send;
 * `turn.ts` does.
 */
import { asObject } from "../prompt/content.ts";
import { debug } from "../debug.ts";
import type { Param } from "../models.ts";
import { UsageLedger } from "./usage-ledger.ts";
import { StallWatchdog, type StallInfo } from "./watchdog.ts";

const IDLE_CLOSE_MS = 20 * 60_000;
const PENDING_CLOSE_MS = 60 * 60_000;

export interface PendingCall {
  id: string;
  name: string;
  args: Record<string, any>;
  handed: boolean;
  resolve: (result: any) => void;
}

export interface SessionOptions {
  /** The provider model id this session runs; used for diagnostics. */
  modelId?: string;
  /** Called when the session has been idle long enough to be closed. */
  onIdle: (session: CursorSession) => void;
  /** Window for the inactivity watchdog; 0 disables it. */
  stallTimeoutMs: number;
  onStall?: (session: CursorSession, info: StallInfo) => void;
}

export class CursorSession {
  agent: any;
  run: any;
  events: any[] = [];
  /** Read cursor into `events`, so draining a long stream stays linear. */
  eventCursor = 0;
  runDone = true;
  runResult: any;
  runError: unknown;
  sentFirst = false;
  pending: PendingCall[] = [];
  lastCallAt = 0;
  toolsKey = "";
  toolNames: string[] = [];
  /** The system prompt as Cursor knows it: the first send plus later additions. */
  systemPrompt = "";
  /** Fingerprints of the messages Cursor has seen, including its own replies. */
  seen: string[] = [];
  busy = false;
  closed = false;
  /** Set once the watchdog gives up on the current run. */
  stall: StallInfo | undefined;

  readonly key: string;
  readonly signature: string;
  readonly params: Param[] | undefined;
  readonly modelId: string;
  readonly ledger = new UsageLedger();
  readonly watchdog: StallWatchdog;

  private readonly options: SessionOptions;
  private wakers: (() => void)[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(key: string, signature: string, params: Param[] | undefined, options: SessionOptions) {
    this.key = key;
    this.signature = signature;
    this.params = params;
    this.modelId = options.modelId ?? "";
    this.options = options;
    this.watchdog = new StallWatchdog({
      timeoutMs: options.stallTimeoutMs,
      onStall: (info) => {
        this.stall = info;
        options.onStall?.(this, info);
        this.wake();
      },
    });
  }

  wake(): void {
    const wakers = this.wakers;
    this.wakers = [];
    for (const fn of wakers) fn();
  }

  waitForChange(ms?: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
      this.wakers.push(() => {
        if (timer) clearTimeout(timer);
        resolve();
      });
    });
  }

  registerCall(name: string, args: unknown, toolCallId: string | undefined): Promise<any> {
    // A tool call is provider output for the open turn, even when the model sent no prose first.
    this.ledger.sawContent();
    return new Promise((resolve) => {
      this.pending.push({
        id: toolCallId || `call_${name}_${Date.now().toString(36)}_${this.pending.length}`,
        name,
        args: asObject(args),
        handed: false,
        resolve,
      });
      this.lastCallAt = Date.now();
      this.wake();
    });
  }

  startRun(run: any): void {
    Object.assign(this, { run, events: [], eventCursor: 0, runDone: false, runResult: undefined, runError: undefined, stall: undefined });
    this.watchdog.resume();
    void (async () => {
      try {
        const sent = Date.now();
        let waiting = true;
        for await (const msg of run.stream()) {
          if (waiting && msg?.type !== "status") {
            waiting = false;
            debug(`first ${msg?.type} key=${this.key.slice(0, 12)} after ${Date.now() - sent}ms`);
          }
          if (msg?.type === "usage") {
            // The arrival time relative to the tool handoff decides whether this report is usable.
            debug(`usage key=${this.key.slice(0, 12)} after=${Date.now() - sent}ms handed=${this.pending.filter((p) => p.handed).length} content=${this.ledger.hasContent}`);
            this.ledger.report(msg.usage);
          } else {
            if (msg?.type !== "status") this.ledger.sawContent();
            this.watchdog.touch(String(msg?.type ?? "unknown"));
          }
          this.events.push(msg);
          this.wake();
        }
      } catch (err) {
        this.runError = err;
      }
      try {
        this.runResult = await run.wait();
      } catch (err) {
        this.runError ??= err;
      }
      this.watchdog.stop();
      this.runDone = true;
      this.wake();
    })();
  }

  touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.options.onIdle(this),
      this.pending.length ? PENDING_CLOSE_MS : IDLE_CLOSE_MS,
    );
    this.idleTimer.unref?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.watchdog.stop();
    this.ledger.end();
    for (const p of this.pending) settle(() => p.resolve({ content: [{ type: "text", text: "Cancelled by the host." }], isError: true }));
    this.pending = [];
    settle(() => void Promise.resolve(this.run?.cancel?.()).catch(() => {}));
    settle(() => this.agent?.close?.());
    this.wake();
  }
}

function settle(fn: () => void): void {
  try {
    fn();
  } catch {
    /* best effort */
  }
}
