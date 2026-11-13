/**
 * What Cursor sees of the host transcript.
 *
 * Cursor has no usable system-prompt slot (the SDK option is server-gated), so the first send of a
 * session carries the host system prompt and the history as one text. Later sends carry only what
 * is new; fingerprints tell which messages Cursor already has.
 */
import { textOf } from "./content.ts";

const TOOLS_NOTE = "Only the tools attached to this request are available. Cursor's built-in file, shell and edit tools are disabled; do not try them.";

// Cursor account rules often say "read ~/.../AGENTS.md first"; the host injects instruction files itself.
const INSTRUCTIONS_NOTE =
  "The system prompt and context messages below come from the host agent and already include the user's instruction files (AGENTS.md and similar). If Cursor user rules ask you to read such a file first, treat it as already read; do not call a tool for it unless the user asks.";

function renderMessage(m: any): string {
  switch (m?.role) {
    case "user":
      return `### user\n${textOf(m.content)}`;
    case "developer":
      return `### context\n${textOf(m.content)}`;
    case "assistant": {
      const parts: string[] = [];
      for (const b of m.content ?? []) {
        if (b?.type === "text" && b.text) parts.push(b.text);
        else if (b?.type === "toolCall") parts.push(`calls ${b.name} (${b.id}) with ${JSON.stringify(b.arguments ?? {})}`);
      }
      return `### assistant\n${parts.join("\n")}`;
    }
    case "toolResult":
      return `### ${m.toolName ?? "tool"} (${m.toolCallId ?? ""})${m.isError ? " [error]" : ""}\n${textOf(m.content) || "(no output)"}`;
    default:
      return "";
  }
}

/** The first send of a session: tool rules, the system prompt, then the history so far. */
export function renderTranscript(systemPrompt: string | undefined, messages: any[]): string {
  const parts = [TOOLS_NOTE];
  const system = systemPrompt?.trim();
  if (system) parts.push(INSTRUCTIONS_NOTE, system);
  const history = messages.map(renderMessage).filter(Boolean);
  if (history.length) parts.push("Conversation so far:", ...history);
  return parts.join("\n\n");
}

/** Text Cursor gets for messages sent after the first: context messages keep their label. */
export function incrementText(m: any): string {
  const text = textOf(m?.content);
  return m?.role === "developer" && text ? `[context]\n${text}` : text;
}

/** A tool result in the shape a Cursor custom tool returns. */
export function toolResultForCursor(m: any, extraText?: string): { content: any[]; isError: boolean } {
  const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content ?? [];
  const content: any[] = [];
  for (const b of blocks) {
    if (b?.type === "text" && b.text) content.push({ type: "text", text: b.text });
    else if (b?.type === "image" && b.data) content.push({ type: "image", data: b.data, mimeType: b.mimeType });
  }
  if (extraText) content.push({ type: "text", text: extraText });
  if (!content.length) content.push({ type: "text", text: "(no output)" });
  return { content, isError: Boolean(m.isError) };
}

/**
 * Lines added to the system prompt since Cursor last saw it, as a note for the next send
 * ("" when nothing changed). `undefined` when lines were removed or rewritten: Cursor cannot
 * unlearn them, so the session must start over.
 */
export function systemPromptAddition(before: string, after: string): string | undefined {
  if (before === after) return "";
  const left = new Map<string, number>();
  for (const line of before.split("\n")) left.set(line, (left.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after.split("\n")) {
    const n = left.get(line) ?? 0;
    if (n > 0) left.set(line, n - 1);
    else added.push(line);
  }
  for (const [line, n] of left) if (n > 0 && line.trim()) return undefined;
  const text = added.join("\n").trim();
  return text ? `[system prompt update: these lines were added to the system prompt]\n${text}` : "";
}
