/**
 * Reading the live configuration into a policy, and the source the rest of the plugin reads.
 *
 * Every field the user can change is volatile: the loader commits new values into the same
 * references and notifies the plugin, so a save applies without a remount and without touching a
 * live provider run.
 */
import { MODE_VALUES, NEW_MODEL_VALUES, type FastMode, type ModelPolicy, type ModelSettings, type NewModelDefault } from "./types.ts";

/** Values as configuration carries them, before validation. */
export interface PolicyValues {
  context?: unknown;
  fast?: unknown;
  newModels?: unknown;
  models?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mode(value: unknown, fallback: FastMode): FastMode {
  const normalized = text(value).toLowerCase();
  return (MODE_VALUES as readonly string[]).includes(normalized) ? (normalized as FastMode) : fallback;
}

function newModelDefault(value: unknown): NewModelDefault {
  const normalized = text(value).toLowerCase();
  return (NEW_MODEL_VALUES as readonly string[]).includes(normalized) ? (normalized as NewModelDefault) : "enabled";
}

/** Keep one entry's usable fields; a field with an unusable value is dropped, not coerced. */
function modelSettings(value: unknown): ModelSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const entry: ModelSettings = {};
  if (typeof raw.enabled === "boolean") entry.enabled = raw.enabled;
  const context = text(raw.context);
  if (context) entry.context = context;
  const window = typeof raw.contextWindow === "number" ? raw.contextWindow : Number(text(raw.contextWindow));
  if (Number.isFinite(window) && window > 0) entry.contextWindow = Math.round(window);
  const fast = text(raw.fast).toLowerCase();
  if ((MODE_VALUES as readonly string[]).includes(fast)) entry.fast = fast as FastMode;
  return entry;
}

function models(value: unknown): Record<string, ModelSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, ModelSettings> = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    const key = id.trim();
    if (!key) continue;
    const settings = modelSettings(entry);
    if (Object.keys(settings).length) out[key] = settings;
  }
  return out;
}

/**
 * Validate configuration into a policy. An unusable value falls back to the documented default
 * instead of failing the plugin, matching how every other option resolves.
 * @param values - the live configuration values.
 * @returns the policy the request path reads.
 */
export function buildPolicy(values: PolicyValues): ModelPolicy {
  const preference = text(values.context).toLowerCase();
  return {
    context: preference === "min" ? "min" : "max",
    fast: mode(values.fast, "off") as FastMode,
    newModels: newModelDefault(values.newModels),
    models: models(values.models),
  };
}

/** Reads the live configuration each time a decision is made. */
export class ModelPolicySource {
  private readonly read: () => PolicyValues;

  constructor(read: () => PolicyValues) {
    this.read = read;
  }

  /** The policy as configuration currently stands. */
  current(): ModelPolicy {
    return buildPolicy(this.read());
  }
}
