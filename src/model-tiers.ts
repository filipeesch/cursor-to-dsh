/**
 * Context tiers, read from the catalog's own parameter definitions.
 *
 * Cursor lists the context sizes a model offers as parameter values (200k, 1m), so a new tier needs
 * no code change. Max Mode is legacy (Cursor removed it for usage-based pricing) and the tier is
 * chosen directly, so the catalog's variant markings no longer filter anything.
 */
import { parameterValues, parametersOf, type CatalogParamDef, type Param } from "./model-catalog.ts";

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

/**
 * The tier to request: the one the provider already accepted for this model, else the preference.
 * An accepted value the catalog no longer offers is ignored. Cursor removed Max Mode for
 * usage-based pricing, so the tier is chosen directly and no tier is filtered out.
 */
export function contextTierValue(model: unknown, accepted: string | undefined, preference: string): string | undefined {
  const offered = offeredTiers(model);
  if (accepted) {
    const match = offered.find((tier) => tier.value.toLowerCase() === accepted.toLowerCase());
    if (match) return match.value;
  }
  if (!offered.length) return undefined;
  const wanted = preference.trim().toLowerCase();
  if (wanted === "max") return offered[offered.length - 1].value;
  if (wanted === "min") return offered[0].value;
  return (offered.find((tier) => tier.value.toLowerCase() === wanted) ?? offered[0]).value;
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
