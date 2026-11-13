/**
 * Stable identity of one message as Cursor saw it.
 *
 * A fingerprint covers only what reaches Cursor: text and tool calls. Thinking, ids, sources and
 * other host bookkeeping are invisible to the provider, so they must not move the fingerprint.
 */
import { createHash } from "node:crypto";

import { textOf } from "./content.ts";

export function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function fingerprint(m: any): string {
  switch (m?.role) {
    case "user":
      return hash(`u\n${textOf(m.content)}`);
    case "developer":
      return hash(`d\n${textOf(m.content)}`);
    case "toolResult":
      return hash(`r\n${m.toolCallId ?? ""}\n${m.isError ? 1 : 0}\n${textOf(m.content)}`);
    case "assistant": {
      const parts: string[] = [];
      for (const b of m.content ?? []) {
        if (b?.type === "text" && b.text) parts.push(`t:${b.text}`);
        else if (b?.type === "toolCall") parts.push(`c:${b.id}:${b.name}:${JSON.stringify(b.arguments ?? {})}`);
      }
      return hash(`a\n${parts.join("\n")}`);
    }
    default:
      return hash(`${m?.role ?? "?"}\n${JSON.stringify(m?.content ?? "")}`);
  }
}
