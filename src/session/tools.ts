/**
 * The host's tools as Cursor custom (MCP) tools.
 *
 * Cursor fixes a run's tools when it starts and does not announce later ones, so a changed tool
 * set is carried by a new send and the added names are called out in the text.
 */
import { hash } from "../prompt/fingerprint.ts";

/** The subset of a session that tool synchronization needs. */
export interface ToolHost {
  toolsKey: string;
  toolNames: string[];
  registerCall(name: string, args: unknown, toolCallId: string | undefined): Promise<any>;
}

export function toolsKeyOf(tools: any[]): string {
  return hash(JSON.stringify(tools.map((t) => [t?.name, t?.description ?? "", t?.parameters ?? {}])));
}

/** Point the session at the current tools; returns the send options that carry them. */
export function syncTools(host: ToolHost, tools: any[]): any {
  host.toolsKey = toolsKeyOf(tools);
  host.toolNames = tools.map((t) => t?.name).filter(Boolean);
  const custom: Record<string, any> = {};
  for (const tool of tools) {
    if (!tool?.name) continue;
    custom[tool.name] = {
      description: tool.description || tool.name,
      inputSchema: tool.parameters && typeof tool.parameters === "object" ? tool.parameters : { type: "object", properties: {} },
      execute: (args: unknown, ctx: any) => host.registerCall(tool.name, args, ctx?.toolCallId),
    };
  }
  return Object.keys(custom).length ? { local: { customTools: custom } } : {};
}

/**
 * Cursor lists the custom tools to the model when a conversation starts and does not announce
 * later ones (measured: the model said a tool added on the second send did not exist).
 */
export function addedToolsNote(host: ToolHost, tools: any[]): string {
  const added = tools.map((t) => t?.name).filter((n) => n && !host.toolNames.includes(n));
  return added.length ? `[Tool update: these tools were added and are now available: ${added.join(", ")}. Look up their schemas before calling them.]` : "";
}
