/**
 * How one model resolves against the policy: its own entry over the wildcard over the globals.
 */
import type { FastMode, MaxMode, ModelPolicy, ModelSettings } from "./types.ts";

/** The settings in effect for one model, or for the wildcard when no id is given. */
export function entryFor(policy: ModelPolicy, modelId?: string): ModelSettings {
  const wildcard = policy.models["*"] ?? {};
  const own = modelId === undefined ? {} : policy.models[modelId] ?? {};
  return { ...wildcard, ...own };
}

/** Whether the model is advertised; an unconfigured model follows the new-model default. */
export function isEnabled(policy: ModelPolicy, modelId: string): boolean {
  return entryFor(policy, modelId).enabled ?? policy.newModels === "enabled";
}

/** The Max Mode policy in effect for one model. */
export function maxModeFor(policy: ModelPolicy, modelId?: string): MaxMode {
  return entryFor(policy, modelId).maxMode ?? policy.maxMode;
}

/** The Fast policy in effect for one model. */
export function fastFor(policy: ModelPolicy, modelId?: string): FastMode {
  return entryFor(policy, modelId).fast ?? policy.fast;
}

/** The tier preference in effect for one model. */
export function contextPreferenceFor(policy: ModelPolicy, modelId?: string): string {
  return entryFor(policy, modelId).context ?? policy.context;
}
