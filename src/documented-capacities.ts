/**
 * Capacities Cursor documents for its own models without publishing them in the model catalog.
 *
 * Composer 2.5 is the case this exists for: its catalog entry carries only `fast`, models.dev has no
 * entry for it, and the documented window is therefore invisible to every automatic source. The
 * value is the one Cursor's own model page states
 * (https://cursor.com/docs/models/cursor-composer-2-5, read 2026-11-14: "Context window 200k",
 * "Max context -"), so the page configures it instead of falling back to the generic default.
 *
 * Bump or remove an entry when the provider's page changes; a published capacity and a manual value
 * both take precedence over it.
 */
const DOCUMENTED: Readonly<Record<string, number>> = {
  "composer-2.5": 200_000,
};

/**
 * The capacity the provider documents for one model id, when it documents one.
 * @param modelId - provider model id, exactly as the catalog lists it.
 * @returns tokens, or undefined when the provider documents nothing for that id.
 */
export function documentedCapacity(modelId: string): number | undefined {
  return DOCUMENTED[modelId];
}
