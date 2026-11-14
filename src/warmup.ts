/**
 * Start the provider SDK warm-up as soon as a credential and a known model exist.
 *
 * Applying the plugin is the earliest point with both: the persisted catalog snapshot
 * (or the fallback list) answers the model id without a network call, so a slow or
 * failed live fetch can no longer leave the SDK's setup on the first user step.
 */
import { debug } from "./debug.ts";

export interface WarmUpDeps {
  /** False when the operator disabled warm-up. */
  enabled: boolean;
  resolveApiKey: () => Promise<string | undefined>;
  /** Models known without a network call: the persisted snapshot, else the fallback. */
  models: () => readonly { id: string }[];
  prewarm: (options: { apiKey: string; modelId: string }) => Promise<unknown>;
}

/**
 * Warm the SDK in the background without blocking plugin activation.
 * @returns a promise that settles when the attempt finished; it never rejects.
 */
export function warmUpAtStart(deps: WarmUpDeps): Promise<void> {
  if (!deps.enabled) return Promise.resolve();
  return (async () => {
    try {
      const apiKey = await deps.resolveApiKey();
      if (!apiKey) return;
      const models = deps.models();
      const modelId = models.find((model) => model.id === "default")?.id ?? models[0]?.id;
      if (!modelId) return;
      await deps.prewarm({ apiKey, modelId });
    } catch (err) {
      debug("warm-up failed: " + (err instanceof Error ? err.message : String(err)));
    }
  })();
}
