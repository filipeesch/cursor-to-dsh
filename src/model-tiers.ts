/**
 * Context tiers and Max Mode, read from the catalog's own parameter definitions and variants.
 *
 * Cursor lists the context sizes a model offers as parameter values (200k, 1m) and marks the
 * variants only available in Max Mode, so a new tier needs no code change.
 */
import { parameterValues, parametersOf, type CatalogParamDef, type CatalogVariant, type Param } from "./model-catalog.ts";

/** Parsed tier: the value Cursor accepts and its size in tokens. */
export interface Tier {
  value: string;
  tokens: number;
}

/** Token count for a tier value such as 300k or 1m; undefined for anything else. */
export function tierTokensValue(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([km])$/i.exec(value.trim());
  return match ? Math.round(Number(match[1]) * (match[2].toLowerCase() === "m" ? 1e6 : 1e3)) : undefined;
}

/** The context parameter a model publishes, if it publishes one. */
export function contextParam(model: unknown): CatalogParamDef | undefined {
  return parametersOf(model).find((def) => def?.id === "context");
}

/** The tiers a model offers, smallest first. */
export function offeredTiers(model: unknown): Tier[] {
  return parameterValues(contextParam(model))
    .map((value) => ({ value, tokens: tierTokensValue(value) ?? 0 }))
    .filter((tier) => tier.tokens > 0)
    .sort((left, right) => left.tokens - right.tokens);
}

/** Tokens of one offered tier value, matched case-insensitively. */
export function tierTokens(model: unknown, value: string): number | undefined {
  return offeredTiers(model).find((tier) => tier.value.toLowerCase() === value.toLowerCase())?.tokens;
}

/** The largest tier, the smallest, or an offered value such as 300k. Unknown values mean the smallest. */
export function preferredContext(model: unknown, preference: string): Tier | undefined {
  const all = offeredTiers(model);
  if (!all.length) return undefined;
  const wanted = preference.trim().toLowerCase();
  if (wanted === "max") return all[all.length - 1];
  if (wanted === "min") return all[0];
  return all.find((tier) => tier.value.toLowerCase() === wanted) ?? all[0];
}

/** Variants the catalog publishes for this model. */
export function variantsOf(model: unknown): CatalogVariant[] {
  const variants = (model as { variants?: unknown } | undefined)?.variants;
  return Array.isArray(variants) ? (variants as CatalogVariant[]) : [];
}

/**
 * Whether the only catalog variants that carry this tier require Max Mode. A tier the catalog does
 * not describe, or a catalog that carries no marking, is not treated as requiring it.
 */
export function requiresMaxMode(model: unknown, contextValue: string): boolean {
  const matching = variantsOf(model).filter((variant) =>
    (variant.params ?? []).some((param) => param?.id?.trim() === "context" && String(param?.value ?? "").trim().toLowerCase() === contextValue.toLowerCase()),
  );
  return matching.length > 0 && matching.every((variant) => variant.isMaxMode === true);
}

/** Whether any published variant of this model runs only in Max Mode. */
export function hasMaxModeVariants(model: unknown): boolean {
  return variantsOf(model).some((variant) => variant.isMaxMode === true);
}

/**
 * The tier to request: the one the provider already accepted for this model when the Max Mode
 * policy still allows it, else the preference over the tiers the policy allows. An accepted value
 * the catalog no longer offers is ignored.
 */
export function contextTierValue(
  model: unknown,
  accepted: string | undefined,
  preference: string,
  maxMode: string,
): string | undefined {
  const allowed = (value: string) => maxMode !== "off" || !requiresMaxMode(model, value);
  if (accepted) {
    const match = offeredTiers(model).find((tier) => tier.value.toLowerCase() === accepted.toLowerCase());
    if (match && allowed(match.value)) return match.value;
  }
  const usable = offeredTiers(model).filter((tier) => allowed(tier.value));
  if (!usable.length) return undefined;
  const wanted = preference.trim().toLowerCase();
  if (wanted === "max") return usable[usable.length - 1].value;
  if (wanted === "min") return usable[0].value;
  return (usable.find((tier) => tier.value.toLowerCase() === wanted) ?? usable[0]).value;
}

/**
 * Cursor lists context tiers some accounts cannot use (1m on several Claude models) and rejects the
 * run. Returns params with the next smaller offered tier, or undefined.
 */
export function smallerContext(model: unknown, params: Param[] | undefined): Param[] | undefined {
  const current = params?.find((param) => param.id === "context");
  const size = current && tierTokensValue(current.value);
  if (!size) return undefined;
  const next = offeredTiers(model).filter((tier) => tier.tokens < size).pop();
  return next && params!.map((param) => (param.id === "context" ? { id: param.id, value: next.value } : param));
}

/** Whether a provider error names rejected model parameters. */
export function isRejectedParams(message: unknown): boolean {
  return typeof message === "string" && /invalid parameters for registry model/i.test(message);
}
