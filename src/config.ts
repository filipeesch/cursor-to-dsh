/**
 * Plugin configuration, resolved once at load into the policy the rest of the plugin reads.
 *
 * Every option is additive: an omission keeps the documented default, and an unknown value falls
 * back to it instead of failing the plugin.
 */
import type { Volatile } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";

import { resolveStateDir } from "./cursor/state.ts";
import { DEFAULT_POLICY, type FastMode, type MaxMode, type ModelPolicy } from "./models.ts";

export interface Config {
  /** Volatile so the settings service gives this plugin a namespace and the Models page lists Cursor. */
  apiKeyEnv: Volatile<string> | string;
  apiKey?: string;
  /** Context tier preference for the request: `min`, `max`, or an offered value such as `300k`. */
  context: string;
  /** Context window advertised to the host: `auto` follows the effective tier, or a token count. */
  contextWindow: string;
  /** Per-model context window, in tokens; `"*"` covers models the catalog does not describe. */
  contextWindows: Record<string, number>;
  /** Cursor Max Mode (extended context, billed differently): `off` (default), `on`, or `auto`. */
  maxMode: string;
  /** Priority-latency mode: `off` (default), `on`, or `auto` to leave it to Cursor. */
  fast: string;
  /** Provider inactivity window, in milliseconds, before a run is abandoned; 0 disables it. */
  stallTimeoutMs: number;
  /** Cursor agent working directory; default is the session's directory. */
  cwd?: string;
}

export const Config: Schema<Config> = Schema.object({
  apiKeyEnv: Schema.string().role("credential-ref").default("CURSOR_API_KEY").description("Credential / environment variable that holds the Cursor API key.").volatile(),
  apiKey: Schema.string().role("secret").description("Cursor API key, used only when the credential and environment are empty."),
  context: Schema.string().default(DEFAULT_POLICY.context).description("Cursor context tier: min, max, or an offered value such as 300k."),
  contextWindow: Schema.string().default("auto").description("Context window reported to the host: auto, or a token count."),
  contextWindows: Schema.dict(Schema.number()).default({}).description('Per-model context window in tokens; "*" covers models the catalog does not describe.'),
  maxMode: Schema.string().default("off").description("Cursor Max Mode (extended context, billed differently): off, on, or auto."),
  fast: Schema.string().default(DEFAULT_POLICY.fast).description("Cursor Fast (priority) mode: off, on, or auto."),
  stallTimeoutMs: Schema.number().default(120_000).description("Milliseconds without provider content before a run is abandoned; 0 disables the watchdog."),
  cwd: Schema.string().description("Cursor agent working directory; default is the session's directory."),
}) as any;

export const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const FAST_MODES: FastMode[] = ["auto", "on", "off"];
const MAX_MODES: MaxMode[] = ["auto", "on", "off"];

export interface Settings {
  policy: ModelPolicy;
  stallTimeoutMs: number;
  /** Base directory for the plugin's small persisted files. */
  stateDir: string;
}

function numberFrom(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const text = typeof value === "number" ? value : String(value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function fastMode(value: unknown): FastMode {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (FAST_MODES as string[]).includes(text) ? (text as FastMode) : DEFAULT_POLICY.fast;
}

function maxMode(value: unknown): MaxMode {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (MAX_MODES as string[]).includes(text) ? (text as MaxMode) : DEFAULT_POLICY.maxMode;
}

/** Keep only usable per-model windows: a model id and a positive finite token count. */
function contextWindows(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [id, tokens] of Object.entries(value as Record<string, unknown>)) {
    const parsed = typeof tokens === "number" ? tokens : Number(String(tokens ?? "").trim());
    if (id.trim() && Number.isFinite(parsed) && parsed > 0) out[id.trim()] = Math.round(parsed);
  }
  return out;
}

function reportedWindow(value: unknown): "auto" | number {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!text || text.toLowerCase() === "auto") return "auto";
  const parsed = Number(text.replace(/_/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : "auto";
}

export function resolveSettings(config: Config | undefined, env: NodeJS.ProcessEnv = process.env): Settings {
  const context = env.DSH_CURSOR_CONTEXT?.trim() || config?.context?.trim() || DEFAULT_POLICY.context;
  return {
    policy: {
      context,
      contextWindow: reportedWindow(config?.contextWindow),
      contextWindows: contextWindows(config?.contextWindows),
      maxMode: maxMode(config?.maxMode),
      fast: fastMode(config?.fast),
    },
    stallTimeoutMs: numberFrom(env.DSH_CURSOR_STALL_TIMEOUT_MS ?? config?.stallTimeoutMs, DEFAULT_STALL_TIMEOUT_MS),
    stateDir: resolveStateDir(env),
  };
}
