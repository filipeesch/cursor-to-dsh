/**
 * Plugin configuration, resolved into the live policy the rest of the plugin reads.
 *
 * Every field the settings page can change is volatile: the settings service projects volatile
 * fields, and the loader commits a volatile-only change into the running references without a
 * remount. An omission keeps the documented default, and an unknown value falls back to it instead
 * of failing the plugin.
 */
import type { Volatile } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";

import { DEFAULT_KEY_REF } from "./constants.ts";
import { resolveStateDir } from "./cursor/state.ts";
import { buildPolicy, type PolicyValues } from "./policy/source.ts";
import { DEFAULT_POLICY, type ModelPolicy, type ModelSettings } from "./policy/types.ts";

export interface Config {
  /** Volatile so the settings service exposes the reference the settings page stores the key under. */
  apiKeyEnv: Volatile<string> | string;
  /** Global context tier preference: max or min. */
  context: Volatile<string>;
  /** Cursor Fast (priority) mode: off, on, or auto. */
  fast: Volatile<string>;
  /** Per-model settings, keyed by model id; "*" covers models without their own entry. */
  models: Volatile<Record<string, ModelSettings>>;
  /** Whether a model with no entry of its own is enabled. */
  newModels: Volatile<string>;
  /** Whether the published-capacity fallback may fetch: on or off. */
  knownContext: Volatile<string>;
  /** Whether one timing record per model step is written to the state directory: on or off. */
  timing: Volatile<string>;
  /** Provider inactivity window, in milliseconds, before a run is abandoned; 0 disables it. */
  stallTimeoutMs: number;
  /** Cursor agent working directory; default is the session's directory. */
  cwd?: string;
}

const modelEntry = Schema.object({
  enabled: Schema.boolean().description("Whether this model is offered for selection."),
  context: Schema.string().description("Context tier requested for this model: max, min, or one offered value such as 300k."),
  contextWindow: Schema.number().description("Manual advertised window in tokens, used only when neither the provider tier nor the published capacity describes the model."),
  fast: Schema.string().description("Fast mode policy for this model: off, on, or auto."),
});

export const Config: Schema<Config> = Schema.object({
  apiKeyEnv: Schema.string().role("credential-ref").default(DEFAULT_KEY_REF).description("Credential / environment variable that holds the Cursor API key.").volatile(),
  context: Schema.string().default(DEFAULT_POLICY.context).description("Global context tier preference: max (largest offered) or min.").volatile(),
  fast: Schema.string().default(DEFAULT_POLICY.fast).description("Cursor Fast (priority) mode: off, on, or auto.").volatile(),
  models: Schema.dict(modelEntry).default({}).description('Per-model settings keyed by model id; "*" covers models without their own entry.').volatile(),
  newModels: Schema.string().default(DEFAULT_POLICY.newModels).description("Whether a model with no entry of its own is enabled: enabled or disabled.").volatile(),
  knownContext: Schema.string().default("on").description("Fetch published model capacities from models.dev as a fallback: on or off.").volatile(),
  timing: Schema.string().default("off").description("Write one timing record per model step to the plugin state directory: on or off.").volatile(),
  stallTimeoutMs: Schema.number().default(120_000).description("Milliseconds without provider content before a run is abandoned; 0 disables the watchdog."),
  cwd: Schema.string().description("Cursor agent working directory; default is the session's directory."),
}) as any;

export const DEFAULT_STALL_TIMEOUT_MS = 120_000;

export interface Settings {
  /** Read the model policy from the configuration as it currently stands. */
  readPolicy: () => ModelPolicy;
  /** Whether the published-capacity fallback may fetch. */
  knownContext: () => boolean;
  /** Whether one timing record per model step is written. */
  timing: () => boolean;
  stallTimeoutMs: number;
  /** Base directory for the plugin's small persisted files. */
  stateDir: string;
}

/** Read a volatile reference (or a plain value) without keeping the value for later operations. */
function unwrap<T>(field: Volatile<T> | T | undefined): T | undefined {
  if (field && typeof field === "object" && typeof (field as { get?: unknown }).get === "function") {
    return (field as { get: () => T }).get();
  }
  return field as T | undefined;
}

/** Read an on/off field; an unusable value falls back to the documented default. */
function switchedOn(value: unknown, fallback: boolean): boolean {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return fallback;
  if (text === "on" || text === "true" || text === "1") return true;
  if (text === "off" || text === "false" || text === "0") return false;
  return fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const text = typeof value === "number" ? value : String(value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Resolve configuration into the live readers the plugin uses.
 * @param config - the plugin configuration, whose editable fields are volatile references.
 * @param env - process environment, for the documented overrides.
 * @returns readers that observe later volatile updates, plus the static settings.
 */
export function resolveSettings(config: Config | undefined, env: NodeJS.ProcessEnv = process.env): Settings {
  const policyValues = (): PolicyValues => ({
    context: env.DSH_CURSOR_CONTEXT?.trim() || unwrap(config?.context),
    fast: unwrap(config?.fast),
    newModels: unwrap(config?.newModels),
    models: unwrap(config?.models),
  });
  return {
    readPolicy: () => buildPolicy(policyValues()),
    knownContext: () => switchedOn(unwrap(config?.knownContext), true),
    timing: () => switchedOn(unwrap(config?.timing), false),
    stallTimeoutMs: numberFrom(env.DSH_CURSOR_STALL_TIMEOUT_MS ?? config?.stallTimeoutMs, DEFAULT_STALL_TIMEOUT_MS),
    stateDir: resolveStateDir(env),
  };
}
