/**
 * The context window the plugin advertises to the host, and where that number comes from.
 *
 * Order: the tier in effect, then the capacity published upstream, then a manual per-model value,
 * then the documented default. A manual value never overrides a provider tier or a published
 * capacity, so the number the host meters against is the one the provider will apply.
 */
import { contextTierValue, tierTokens } from "../model-tiers.ts";
import { acceptedTierFor, contextPreferenceFor, entryFor } from "./model-config.ts";
import type { ModelPolicy } from "./types.ts";

/** Advertised when nothing describes a model; documented as a default, not a measured capacity. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Which source decided the advertised window. */
export type ContextWindowSource = "tier" | "published" | "manual" | "default";

/** One resolved window and the fact it came from. */
export interface ContextWindowResolution {
  tokens: number;
  source: ContextWindowSource;
  /** The tier value the window came from, when the source is the provider's tier. */
  tier?: string;
}

/**
 * Resolve the advertised window for one model.
 * @param args - model identity, catalog entry, accepted tier, policy and published capacity.
 * @returns the window in tokens plus the source that decided it.
 */
export function resolveContextWindow(args: {
  modelId: string;
  model: unknown;
  accepted?: string;
  policy: ModelPolicy;
  publishedWindow?: number;
}): ContextWindowResolution {
  const { modelId, model, accepted, policy, publishedWindow } = args;
  const tier = contextTierValue(model, acceptedTierFor(policy, modelId, accepted), contextPreferenceFor(policy, modelId));
  const tokens = tier === undefined ? undefined : tierTokens(model, tier);
  if (tier !== undefined && tokens !== undefined) return { tokens, source: "tier", tier };
  if (typeof publishedWindow === "number" && Number.isFinite(publishedWindow) && publishedWindow > 0) {
    return { tokens: Math.round(publishedWindow), source: "published" };
  }
  const manual = entryFor(policy, modelId).contextWindow;
  if (typeof manual === "number" && Number.isFinite(manual) && manual > 0) return { tokens: Math.round(manual), source: "manual" };
  return { tokens: DEFAULT_CONTEXT_WINDOW, source: "default" };
}
