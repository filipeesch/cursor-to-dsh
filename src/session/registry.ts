/**
 * Live sessions by key, most recent first.
 *
 * Keys are the host session id for main calls and an anonymous fingerprint for auxiliary calls
 * (titles, compaction), which get their own throwaway agent.
 */
import { fingerprint, hash } from "../prompt/fingerprint.ts";
import type { Transcript } from "../transcript.ts";
import type { CursorSession } from "./session.ts";

const SLOTS_PER_KEY = 3;
export const ANON_PREFIX = "anon:";

/** Auxiliary calls (titles, compaction) carry the session id but must not touch its agent. */
export function sessionKeyFor(sessionId: unknown, t: Transcript, purpose?: string): string {
  if (!purpose && typeof sessionId === "string" && sessionId) return sessionId;
  return ANON_PREFIX + hash(`${purpose ?? ""}\n${t.systemPrompt}\n${t.messages.length ? fingerprint(t.messages[0]) : ""}`);
}

export class SessionRegistry {
  private readonly slots = new Map<string, CursorSession[]>();
  private readonly slotsPerKey: number;

  constructor(slotsPerKey = SLOTS_PER_KEY) {
    this.slotsPerKey = slotsPerKey;
  }

  /** The reusable session for this key and model signature, if one is idle. */
  find(key: string, signature: string): CursorSession | undefined {
    return this.sessions(key).find((s) => s.signature === signature && !s.closed && !s.busy);
  }

  sessions(key: string): CursorSession[] {
    return this.slots.get(key) ?? [];
  }

  store(session: CursorSession): void {
    // Keep a session that is still serving an in-flight call: it is not replaced, it ages out.
    const slots = this.sessions(session.key).filter((s) => s !== session);
    slots.unshift(session);
    while (slots.length > this.slotsPerKey) slots.pop()?.close();
    this.slots.set(session.key, slots);
  }

  drop(session: CursorSession): void {
    session.close();
    const rest = this.sessions(session.key).filter((s) => s !== session);
    if (rest.length) this.slots.set(session.key, rest);
    else this.slots.delete(session.key);
  }

  closeAll(): void {
    for (const sessions of this.slots.values()) for (const session of sessions) session.close();
    this.slots.clear();
  }

  count(): number {
    let total = 0;
    for (const sessions of this.slots.values()) total += sessions.length;
    return total;
  }
}
