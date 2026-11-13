/**
 * The content shapes shared by rendering, fingerprinting and the session core.
 */

export interface Image {
  data: string;
  mimeType?: string;
}

/** Text of a content value (string or blocks); images and tool calls are skipped. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text ?? "" : ""))
    .filter((t) => t !== "")
    .join("\n");
}

/** Tool arguments arrive as a raw JSON string from the host; the core works on objects. */
export function asObject(value: unknown): Record<string, any> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

export function imagesOf(messages: any[]): Image[] | undefined {
  const images: Image[] = [];
  for (const m of messages) {
    if (!Array.isArray(m?.content)) continue;
    for (const b of m.content) if (b?.type === "image" && b.data) images.push({ data: b.data, mimeType: b.mimeType });
  }
  return images.length ? images : undefined;
}

/** Images since the last assistant message: the host appends context messages after the user's own. */
export function currentTurnImages(messages: any[]): Image[] | undefined {
  let start = messages.length;
  while (start > 0 && messages[start - 1]?.role !== "assistant") start--;
  return imagesOf(messages.slice(start));
}
