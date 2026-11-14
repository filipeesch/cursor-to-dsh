/**
 * Request parameters: Cursor catalog parameters in, the params one request carries out.
 *
 * Cursor describes each model with parameter definitions (thinking, effort, fast, context, ...)
 * whose allowed values differ per model. Everything here works from those definitions, so a new
 * model or value needs no code change.
 */
import { parameterValues, parametersOf, type CatalogParamDef, type Param } from "./model-catalog.ts";
import { contextTierValue } from "./model-tiers.ts";
import { contextPreferenceFor, fastFor, maxModeFor } from "./policy/model-config.ts";
import { DEFAULT_POLICY, type ModelPolicy } from "./policy/types.ts";

const LEVEL_RANK: Record<string, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  "extra-high": 5,
  max: 6,
};

function find(defs: CatalogParamDef[], ...ids: string[]): CatalogParamDef | undefined {
  return defs.find((def) => ids.includes(def?.id));
}

// "thinking" is Claude's on/off switch and must not be mistaken for the effort param.
const effortDef = (defs: CatalogParamDef[]) => find(defs, "effort", "reasoning_effort", "reasoning");

/** Cursor effort value for a level: exact match, else the nearest lower, else the lowest. */
export function effortFor(offered: string[], level: string): string | undefined {
  const target = LEVEL_RANK[level];
  if (target === undefined) return undefined;
  const ranked = offered.filter((value) => value in LEVEL_RANK).sort((left, right) => LEVEL_RANK[left] - LEVEL_RANK[right]);
  const exact = ranked.find((value) => LEVEL_RANK[value] === target);
  if (exact) return exact;
  const usable = ranked.filter((value) => value !== "none");
  return usable.filter((value) => LEVEL_RANK[value] < target).pop() ?? usable[0] ?? ranked[0];
}

/**
 * Explicit Cursor params for one request. Without them Cursor picks its own defaults, including
 * Fast (priority pricing) and a smaller context than the catalog offers.
 * @param model - the catalog entry (or a frozen copy carrying its parameters).
 * @param reasoning - the host-selected effort, if any.
 * @param policy - the policy in effect.
 * @param accepted - the tier Cursor accepted earlier for this model, if any.
 * @param modelId - the model id whose per-model overrides apply.
 */
export function modelParams(
  model: unknown,
  reasoning: string | undefined,
  policy: ModelPolicy = DEFAULT_POLICY,
  accepted?: string,
  modelId?: string,
): Param[] | undefined {
  const defs = parametersOf(model);
  const params: Param[] = [];
  const off = !reasoning || reasoning === "off";
  if (reasoning === ON) reasoning = "high";

  const thinking = find(defs, "thinking");
  if (thinking && parameterValues(thinking).includes(off ? "false" : "true")) {
    params.push({ id: thinking.id, value: off ? "false" : "true" });
  }

  const effort = effortDef(defs);
  if (effort) {
    const offered = parameterValues(effort);
    let value: string | undefined;
    if (!off) value = effortFor(offered, reasoning!);
    else if (!thinking) value = offered.includes("none") ? "none" : effortFor(offered, "minimal");
    if (value) params.push({ id: effort.id, value });
  }

  const fast = find(defs, "fast");
  if (fast) {
    const mode = fastFor(policy, modelId);
    const wanted = mode === "on" ? "true" : mode === "off" ? "false" : undefined;
    if (wanted && parameterValues(fast).includes(wanted)) params.push({ id: fast.id, value: wanted });
  }

  const context = contextTierValue(model, accepted, contextPreferenceFor(policy, modelId), maxModeFor(policy, modelId));
  if (context) params.push({ id: "context", value: context });

  return params.length ? params : undefined;
}

/** Effort id for models whose only reasoning switch is thinking on/off. */
export const ON = "on";

const EFFORT_NAMES: Record<string, string> = { off: "Off", on: "On", xhigh: "Extra high", "extra-high": "Extra high" };

function effortName(id: string): string {
  return EFFORT_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Host reasoning efforts for a model, least to greatest: Cursor's own effort values, with "off"
 * when the model can turn reasoning off. Undefined for models without reasoning params.
 */
export function reasoningInfo(model: unknown): { efforts: { id: string; name: string }[]; defaultEffort?: string } | undefined {
  const defs = parametersOf(model);
  const thinking = find(defs, "thinking");
  const offered = parameterValues(effortDef(defs))
    .filter((value) => value in LEVEL_RANK)
    .sort((left, right) => LEVEL_RANK[left] - LEVEL_RANK[right]);
  const canOff = offered.includes("none") || parameterValues(thinking).includes("false");
  const ids = offered.filter((value) => value !== "none");
  if (!ids.length && thinking) ids.push(ON);
  if (!ids.length) return undefined;
  if (canOff) ids.unshift("off");
  const defaultEffort = ids.includes("high") ? "high" : ids[ids.length - 1];
  return { efforts: ids.map((id) => ({ id, name: effortName(id) })), defaultEffort };
}
