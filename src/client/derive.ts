/**
 * The configuration page's pure logic: what each model row shows, and what a save writes.
 *
 * Everything here is a pure function of the host's accepted configuration and the catalog the route
 * serves, so the page's behavior can be tested without a browser and the same resolution the Host
 * applies decides what the user sees.
 */
import type { CatalogModelView, CatalogPayload } from "../catalog-payload.ts";
import { DEFAULT_KEY_REF } from "../constants.ts";
import { contextTierValue, hasMaxModeVariants, offeredTiers, requiresMaxMode } from "../model-tiers.ts";
import { resolveContextWindow, type ContextWindowResolution } from "../policy/context.ts";
import { contextPreferenceFor, entryFor, fastFor, isEnabled, maxModeFor } from "../policy/model-config.ts";
import { buildPolicy } from "../policy/source.ts";
import type { FastMode, MaxMode, ModelSettings } from "../policy/types.ts";

/** The host's accepted configuration section, as the form hands it over. */
export type ConfigValues = Record<string, unknown>;

/** One tier as the row's selector lists it. */
export interface RowTier {
  value: string;
  tokens: number;
  /** Whether Cursor only offers this tier in Max Mode. */
  maxMode: boolean;
  selected: boolean;
}

/** One model row as the page renders it. */
export interface ModelRow {
  id: string;
  name: string;
  enabled: boolean;
  /** Whether the catalog publishes any parameter or variant for it. */
  described: boolean;
  /** Whether the stored configuration carries an entry of its own. */
  configured: boolean;
  tiers: RowTier[];
  tierOffered: boolean;
  /** The stored tier override, when one is set. */
  tierOverride?: string;
  window: ContextWindowResolution;
  /** The manual window field: editable only when nothing more authoritative applies. */
  manualWindow: { editable: boolean; value?: number };
  fastOffered: boolean;
  fastValue?: FastMode;
  /** The value Fast mode inherits when the model has no override. */
  fastInherited: FastMode;
  maxModeOffered: boolean;
  maxModeValue?: MaxMode;
  /** The value Max Mode inherits when the model has no override. */
  maxModeInherited: MaxMode;
}

/** Everything the page renders for one accepted configuration. */
export interface DerivedPage {
  context: "max" | "min";
  newModels: "enabled" | "disabled";
  rows: ModelRow[];
  enabledCount: number;
  /** Explicit model entries, excluding the wildcard. */
  overrides: number;
}

/** The catalog entry shape the shared resolution functions read. */
function entryOf(view: CatalogModelView): { parameters: CatalogModelView["parameters"]; variants: CatalogModelView["variants"] } {
  return { parameters: view.parameters, variants: view.variants };
}

/**
 * Derive the page from the accepted configuration and the catalog.
 * @param values - accepted configuration section.
 * @param payload - catalog the route served, or undefined while it loads.
 * @returns the rows and the global values the page renders.
 */
export function derivePage(values: ConfigValues | undefined, payload: CatalogPayload | undefined): DerivedPage {
  const policy = buildPolicy(values ?? {});
  const rows: ModelRow[] = (payload?.models ?? []).map((view) => {
    const model = entryOf(view);
    const entry = entryFor(policy, view.id);
    const requestedTier = contextTierValue(model, view.acceptedTier, contextPreferenceFor(policy, view.id), maxModeFor(policy, view.id));
    const window = resolveContextWindow({
      modelId: view.id,
      model,
      accepted: view.acceptedTier,
      policy,
      publishedWindow: view.publishedContextWindow,
    });
    const tiers = offeredTiers(model);
    return {
      id: view.id,
      name: view.name,
      enabled: isEnabled(policy, view.id),
      described: view.parameters.length > 0 || view.variants.length > 0,
      configured: policy.models[view.id] !== undefined,
      tiers: tiers.map((tier) => ({ value: tier.value, tokens: tier.tokens, maxMode: requiresMaxMode(model, tier.value), selected: tier.value === requestedTier })),
      tierOffered: tiers.length > 0,
      ...(entry.context === undefined ? {} : { tierOverride: entry.context }),
      window,
      manualWindow: {
        editable: window.source !== "tier" && window.source !== "published",
        ...(entry.contextWindow === undefined ? {} : { value: entry.contextWindow }),
      },
      fastOffered: view.parameters.some((parameter) => parameter.id === "fast"),
      ...(entry.fast === undefined ? {} : { fastValue: entry.fast }),
      fastInherited: fastFor(policy, undefined),
      maxModeOffered: hasMaxModeVariants(model),
      ...(entry.maxMode === undefined ? {} : { maxModeValue: entry.maxMode }),
      maxModeInherited: maxModeFor(policy, undefined),
    };
  });
  return {
    context: policy.context === "min" ? "min" : "max",
    newModels: policy.newModels,
    rows,
    enabledCount: rows.filter((row) => row.enabled).length,
    overrides: Object.keys(policy.models).filter((id) => id !== "*").length,
  };
}

/** One path-addressed edit the host accepts. */
export interface PathOp {
  op: "set" | "unset";
  path: string[];
  value?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The minimal edits that turn one configuration section into another.
 *
 * Paths, not a rebuilt section: the page only names the fields it can see, so a field outside the
 * page (or a secret the host redacted) is never deleted by a save.
 * @param before - accepted configuration.
 * @param after - the draft.
 * @param base - path prefix of the compared subtrees.
 * @returns ordered operations; empty when nothing changed.
 */
export function diffPaths(before: unknown, after: unknown, base: string[] = []): PathOp[] {
  if (isRecord(before) && isRecord(after)) {
    const ops: PathOp[] = [];
    for (const key of Object.keys(after)) {
      if (!Object.hasOwn(before, key)) {
        ops.push({ op: "set", path: [...base, key], value: after[key] });
        continue;
      }
      ops.push(...diffPaths(before[key], after[key], [...base, key]));
    }
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) ops.push({ op: "unset", path: [...base, key] });
    return ops;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ op: "set", path: [...base], value: after }];
}

/** Whether a stored section carries an entry for this model. */
export function modelEntry(values: ConfigValues | undefined, modelId: string): ModelSettings | undefined {
  const models = values?.models;
  if (!isRecord(models)) return undefined;
  const entry = models[modelId];
  return isRecord(entry) ? (entry as ModelSettings) : undefined;
}

/**
 * Copy a configuration section with one model field patched. Clearing the last field removes the
 * entry, so a model with nothing configured is indistinguishable from one the user never touched.
 * @param values - accepted configuration.
 * @param modelId - the model the patch belongs to.
 * @param patch - fields to set; undefined or empty values clear them.
 * @returns the next section.
 */
export function withModelPatch(values: ConfigValues | undefined, modelId: string, patch: Partial<ModelSettings>): ConfigValues {
  const next: ConfigValues = { ...(values ?? {}) };
  const models: Record<string, unknown> = isRecord(next.models) ? { ...(next.models as Record<string, unknown>) } : {};
  const entry: Record<string, unknown> = isRecord(models[modelId]) ? { ...(models[modelId] as Record<string, unknown>) } : {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "") delete entry[field];
    else entry[field] = value;
  }
  if (Object.keys(entry).length) models[modelId] = entry;
  else delete models[modelId];
  if (Object.keys(models).length) next.models = models;
  else delete next.models;
  return next;
}

/** Copy a configuration section with global fields patched. */
export function withGlobals(values: ConfigValues | undefined, patch: Record<string, unknown>): ConfigValues {
  const next: ConfigValues = { ...(values ?? {}) };
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "") delete next[field];
    else next[field] = value;
  }
  return next;
}

/** The credential reference in effect: the configured name, else the plugin's default. */
export function keyRefOf(values: ConfigValues | undefined): string {
  const named = values?.apiKeyEnv;
  return typeof named === "string" && named.trim().length > 0 ? named.trim() : DEFAULT_KEY_REF;
}

/** Parse a typed window into tokens; anything unusable clears the field instead of storing zero. */
export function parseWindow(text: string): number | undefined {
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Exact multiples read as 1m or 300k; any other count keeps its digits so nothing is rounded away. */
export function formatWindow(tokens: number): string {
  if (tokens > 0 && tokens % 1_000_000 === 0) return tokens / 1_000_000 + "m";
  if (tokens > 0 && tokens % 1_000 === 0) return tokens / 1_000 + "k";
  return String(tokens).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The sentence that names where a window came from. */
export function windowSourceLabel(source: ContextWindowResolution["source"], tier?: string): string {
  if (source === "tier") return "provider tier" + (tier === undefined ? "" : " " + tier);
  if (source === "published") return "published upstream";
  if (source === "manual") return "manual value";
  return "documented default";
}
