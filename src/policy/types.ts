/**
 * The model policy: what the plugin resolves from configuration before it talks to Cursor.
 *
 * The policy is plain data so the Host and the browser half can both read it, and so a test can
 * describe a policy without a configuration service.
 */

/** The provider's priority-latency mode. */
export type FastMode = "auto" | "on" | "off";

/** Whether a model with no entry of its own is advertised. */
export type NewModelDefault = "enabled" | "disabled";

/** Configuration that applies to one model, or to every model through the wildcard entry. */
export interface ModelSettings {
  enabled?: boolean;
  /** Context tier: max, min, or one offered value such as 300k. */
  context?: string;
  /** Manual advertised window, in tokens; a last resort behind the tier and the published capacity. */
  contextWindow?: number;
  fast?: FastMode;
}

/** Everything the plugin's model decisions read. */
export interface ModelPolicy {
  /** Global tier preference: max or min. */
  context: string;
  fast: FastMode;
  newModels: NewModelDefault;
  /** Per-model entries, keyed by model id; the "*" entry covers models without their own. */
  models: Record<string, ModelSettings>;
}

/** The policy a configuration that names nothing resolves to. */
export const DEFAULT_POLICY: ModelPolicy = {
  context: "max",
  fast: "off",
  newModels: "enabled",
  models: {},
};

/** Accepted values for the Fast mode. */
export const MODE_VALUES: readonly string[] = ["auto", "on", "off"];

/** Accepted values for the new-model default. */
export const NEW_MODEL_VALUES: readonly string[] = ["enabled", "disabled"];
