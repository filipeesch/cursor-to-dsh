/**
 * The provider's catalog shapes, model identity and display names.
 *
 * Everything here comes from what Cursor publishes; nothing decides how a model is configured or
 * what parameters a request carries.
 */

/** One allowed value of a catalog parameter. */
export interface CatalogParamValue {
  value: string;
  displayName?: string;
}

/** A parameter a model publishes, such as context, fast or effort. */
export interface CatalogParamDef {
  id: string;
  displayName?: string;
  values?: (CatalogParamValue | string)[];
}

/** One parameter/value pair a request may carry. */
export interface Param {
  id: string;
  value: string;
}

/** One selectable combination of parameters, and whether Cursor only offers it in Max Mode. */
export interface CatalogVariant {
  params?: Param[];
  displayName?: string;
  isMaxMode?: boolean;
  isDefault?: boolean;
}

/** One model as the provider's catalog lists it. */
export interface CatalogModel {
  id: string;
  displayName?: string;
  parameters?: CatalogParamDef[];
  variants?: CatalogVariant[];
  aliases?: string[];
}

/** Only the "auto" id is an alias; every other id goes to Cursor unchanged. */
export function resolveModelId(id: string): string {
  return id === "auto" ? "default" : id;
}

/** The parameters a model publishes, however the caller obtained it. */
export function parametersOf(model: unknown): CatalogParamDef[] {
  const source = model as { cursorParameters?: unknown; parameters?: unknown } | undefined;
  const defs = source?.cursorParameters ?? source?.parameters;
  return Array.isArray(defs) ? (defs as CatalogParamDef[]) : [];
}

/** Values of one parameter definition, accepting the plain-string form. */
export function parameterValues(def: CatalogParamDef | undefined): string[] {
  return (def?.values ?? []).map((value) => String(typeof value === "object" ? value.value : value));
}

/** Display name per model id; names Cursor shares across models get the id appended. */
export function modelNames(models: readonly CatalogModel[]): Map<string, string> {
  const base = (model: CatalogModel) => model.displayName || model.id;
  const count = new Map<string, number>();
  for (const model of models) count.set(base(model), (count.get(base(model)) ?? 0) + 1);
  return new Map(models.map((model) => [model.id, count.get(base(model))! > 1 ? base(model) + " (" + model.id + ")" : base(model)]));
}

/** Shown until the live catalog loads (no key yet, or offline). */
export const FALLBACK_MODELS: CatalogModel[] = [
  { id: "default", displayName: "Cursor Default" },
  { id: "claude-opus-5-5", displayName: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", displayName: "Claude Haiku 5.5" },
  { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
  { id: "gemini-4-argon", displayName: "Gemini 4 Argon" },
];
