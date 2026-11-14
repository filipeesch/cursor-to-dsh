/**
 * How the host's new messages map onto the live Cursor session.
 *
 * The host sends the whole derived history on every call, so the session keeps fingerprints of
 * what Cursor has seen. Anything that no longer matches what Cursor saw (compaction, a rewritten
 * system prompt, a lost run) must replay from a fresh agent.
 */
import { imagesOf, type Image } from "../prompt/content.ts";
import { incrementText } from "../prompt/render.ts";
import type { CursorSession, PendingCall } from "./session.ts";

export type Results = { call: PendingCall; message: any; extra?: string }[];
export type Plan = { kind: "fresh" } | { kind: "send"; text: string; images?: Image[] } | { kind: "results"; results: Results };

const sendable = (m: any) => m?.role === "user" || m?.role === "developer";

/**
 * @param s - the session that may continue the conversation.
 * @param messages - the host's derived history for this call.
 * @param fingerprints - one fingerprint per message, computed once by the caller.
 */
export function planIncrement(s: CursorSession | undefined, messages: any[], fingerprints: readonly string[]): Plan {
  if (!s || s.closed || !s.sentFirst || messages.length <= s.seen.length) return { kind: "fresh" };
  if (s.seen.some((fp, i) => fingerprints[i] !== fp)) return { kind: "fresh" };
  const added = messages.slice(s.seen.length);
  const handed = s.pending.filter((p) => p.handed);

  if (handed.length) {
    if (s.runDone) return { kind: "fresh" };
    const results: Results = [];
    let i = 0;
    for (; i < added.length && added[i]?.role === "toolResult"; i++) {
      const call = handed.find((p) => p.id === added[i].toolCallId);
      if (!call || results.some((r) => r.call === call)) return { kind: "fresh" };
      results.push({ call, message: added[i] });
    }
    if (results.length !== handed.length) return { kind: "fresh" };
    const steering = added.slice(i);
    if (!steering.every(sendable)) return { kind: "fresh" };
    const text = steering.map(incrementText).filter(Boolean).join("\n\n");
    if (text) results[results.length - 1].extra = `[The user sent this message while the tool was running]\n${text}`;
    return { kind: "results", results };
  }

  if (!s.runDone || s.pending.length || !added.every(sendable)) return { kind: "fresh" };
  return { kind: "send", text: added.map(incrementText).filter(Boolean).join("\n\n"), images: imagesOf(added) };
}
