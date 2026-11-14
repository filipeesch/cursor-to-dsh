/**
 * The catalog document the configuration page reads.
 *
 * It carries only what a catalog-driven form needs: identity, the parameters each model publishes,
 * the variants that decide whether a tier or a speed needs Max Mode, and the published capacity the
 * fallback found. No credential, key or token material ever enters this shape.
 */
import { modelNames, type CatalogModel, type Param } from "./model-catalog.ts";
import { PROVIDER_ID } from "./constants.ts";

/** One parameter, with the values the model actually accepts. */
export interface CatalogParameterView {
  id: string;
  displayName?: string;
  values: { value: string; displayName?: string }[];
}

/** One selectable variant and whether Cursor only offers it in Max Mode. */
export interface CatalogVariantView {
  params: Param[];
  displayName?: string;
  isMaxMode?: boolean;
  isDefault?: boolean;
}

/** One model as the page renders it. */
export interface CatalogModelView {
  id: string;
  name: string;
  parameters: CatalogParameterView[];
  variants: CatalogVariantView[];
  /** Capacity published upstream, when the fallback describes this model. */
  publishedContextWindow?: number;
  /** Tier the provider already accepted for this model after a step-down, when one is remembered. */
  acceptedTier?: string;
}

/** The whole document served at the catalog route. */
export interface CatalogPayload {
  version: 1;
  provider: string;
  /** Loader row id the page's Configure registration is keyed by. */
  rowId: string;
  /** Settings namespace this row's configuration lives in. */
  settingsNs: string;
  knownContext: { enabled: boolean; fetchedAt?: number };
  models: CatalogModelView[];
}

/** Inputs the payload assembles. */
export interface CatalogPayloadArgs {
  rowId: string;
  settingsNs: string;
  models: readonly CatalogModel[];
  publishedWindow: (modelId: string) => number | undefined;
  acceptedTier: (modelId: string) => string | undefined;
  knownContext: { enabled: boolean; fetchedAt?: number };
}

function parametersOfModel(model: CatalogModel): CatalogParameterView[] {
  return (model.parameters ?? [])
    .filter((def) => typeof def?.id === "string" && def.id.length > 0)
    .map((def) => {
      const parameters: CatalogParameterView = { id: def.id, values: [] };
      if (def.displayName) parameters.displayName = def.displayName;
      parameters.values = (def.values ?? []).map((value) => (typeof value === "object"
        ? { value: String(value.value), ...(value.displayName ? { displayName: value.displayName } : {}) }
        : { value: String(value) }));
      return parameters;
    });
}

function variantsOfModel(model: CatalogModel): CatalogVariantView[] {
  return (model.variants ?? []).map((variant) => {
    const view: CatalogVariantView = {
      params: (variant.params ?? []).map((param) => ({ id: param.id, value: param.value })),
    };
    if (variant.displayName) view.displayName = variant.displayName;
    if (variant.isMaxMode === true) view.isMaxMode = true;
    if (variant.isDefault === true) view.isDefault = true;
    return view;
  });
}

/**
 * Build the catalog document the page reads.
 * @param args - row identity, the current catalog, the published capacities and their state.
 * @returns the payload to serialize.
 */
export function catalogPayload(args: CatalogPayloadArgs): CatalogPayload {
  const names = modelNames(args.models);
  return {
    version: 1,
    provider: PROVIDER_ID,
    rowId: args.rowId,
    settingsNs: args.settingsNs,
    knownContext: args.knownContext,
    models: args.models.map((model) => {
      const view: CatalogModelView = {
        id: model.id,
        name: names.get(model.id) ?? model.id,
        parameters: parametersOfModel(model),
        variants: variantsOfModel(model),
      };
      const published = args.publishedWindow(model.id);
      if (typeof published === "number" && Number.isFinite(published) && published > 0) view.publishedContextWindow = Math.round(published);
      const accepted = args.acceptedTier(model.id);
      if (accepted) view.acceptedTier = accepted;
      return view;
    }),
  };
}
