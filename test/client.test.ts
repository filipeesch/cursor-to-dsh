import { test } from "node:test";
import assert from "node:assert/strict";

import type { CatalogPayload } from "../src/catalog-payload.ts";
import { CatalogController } from "../src/client/controller.ts";
import {
  derivePage,
  diffPaths,
  formatWindow,
  keyRefOf,
  parseWindow,
  windowSourceLabel,
  withGlobals,
  withModelPatch,
  type ModelRow,
} from "../src/client/derive.ts";
import type { PageHandlers, PageState } from "../src/client/views.ts";
import { KeySection, ModelsSection, ModelOptions, NewModelsSection, PageView, SummaryView } from "../src/client/views.ts";

const payload: CatalogPayload = {
  version: 1,
  provider: "cursor",
  rowId: "llm-cursor",
  settingsNs: "llm-cursor",
  knownContext: { enabled: true, fetchedAt: 1_700_000_000_000 },
  models: [
    {
      id: "claude",
      name: "Claude",
      parameters: [{ id: "context", values: [{ value: "300k" }, { value: "1m" }] }],
      variants: [{ params: [{ id: "context", value: "1m" }], isMaxMode: true }],
      acceptedTier: "300k",
    },
    { id: "deepseek", name: "DeepSeek", parameters: [], variants: [], publishedContextWindow: 1_048_576 },
    { id: "new", name: "New", parameters: [], variants: [] },
  ],
};

const handlers: PageHandlers = {
  onReload: () => {},
  onSave: () => {},
  onToggleEnabled: () => {},
  onExpand: () => {},
  onTier: () => {},
  onWindow: () => {},
  onFast: () => {},
  onMaxMode: () => {},
  onContext: () => {},
  onNewModels: () => {},
  onKeyValue: () => {},
  onSaveKey: () => {},
  onChangeKey: () => {},
  onCancelKey: () => {},
};

function hasTag(node: any, tag: string): boolean {
  if (node === null || node === undefined || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => hasTag(child, tag));
  if (node.type === tag) return true;
  return hasTag(node.props?.children, tag);
}

function collected(node: any): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collected).join(" ");
  if (typeof node === "object" && node.props !== undefined) return collected(node.props.children);
  return "";
}

function row(id: string, derived = derivePage(undefined, payload)): ModelRow {
  const found = derived.rows.find((candidate) => candidate.id === id);
  assert.ok(found, "row " + id);
  return found;
}

function pageState(overrides: Partial<PageState> = {}): PageState {
  return {
    derived: derivePage(undefined, payload),
    expanded: undefined,
    catalogLoading: false,
    knownContextEnabled: true,
    key: { reference: "CURSOR_API_KEY", value: "", configured: false, busy: false, editing: false },
    saving: false,
    savingNewModels: false,
    dirty: false,
    writable: true,
    ...overrides,
  };
}

test("derivation follows the catalog: tiers, published capacity and the manual last resort", () => {
  const derived = derivePage(undefined, payload);
  assert.equal(derived.rows.length, 3);
  assert.equal(derived.overrides, 0);
  assert.equal(derived.newModels, "enabled");

  const claude = row("claude", derived);
  assert.equal(claude.window.source, "tier");
  assert.equal(claude.window.tokens, 300_000);
  assert.deepEqual(claude.tiers.map((tier) => [tier.value, tier.maxMode]), [["300k", false], ["1m", true]]);
  assert.equal(claude.tiers.find((tier) => tier.selected)?.value, "300k");
  assert.equal(claude.manualWindow.editable, false);

  const deepseek = row("deepseek", derived);
  assert.equal(deepseek.window.source, "published");
  assert.equal(deepseek.window.tokens, 1_048_576);
  assert.equal(deepseek.manualWindow.editable, false);
  assert.equal(deepseek.described, false);

  const fresh = row("new", derived);
  assert.equal(fresh.window.source, "default");
  assert.equal(fresh.window.tokens, 200_000);
  assert.equal(fresh.manualWindow.editable, true);
});

test("a manual value fills a model nothing describes, and only then", () => {
  const manual = derivePage({ models: { new: { contextWindow: 500_000 }, deepseek: { contextWindow: 900_000 } } }, payload);
  assert.deepEqual(row("new", manual).window, { tokens: 500_000, source: "manual" });
  assert.equal(row("new", manual).manualWindow.value, 500_000);
  assert.deepEqual(row("deepseek", manual).window, { tokens: 1_048_576, source: "published" }, "the published capacity still wins");
});

test("enablement follows the entry and the new-model default", () => {
  const disabled = derivePage({ newModels: "disabled", models: { new: { enabled: true } } }, payload);
  assert.equal(row("claude", disabled).enabled, false);
  assert.equal(row("new", disabled).enabled, true);
  assert.equal(disabled.enabledCount, 1);
  assert.equal(disabled.newModels, "disabled");
});

test("per-model overrides surface as controls and as the override count", () => {
  const derived = derivePage({ models: { claude: { context: "1m", maxMode: "on" }, deepseek: { enabled: false } } }, payload);
  assert.equal(row("claude", derived).tierOverride, "1m");
  assert.equal(row("claude", derived).maxModeValue, "on");
  assert.equal(row("deepseek", derived).enabled, false);
  assert.equal(derived.overrides, 2);
});

test("diffing produces path operations, including the unset that restores inheritance", () => {
  assert.deepEqual(diffPaths({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(diffPaths({ a: 1, b: 2 }, { a: 1, b: 3 }), [{ op: "set", path: ["b"], value: 3 }]);
  assert.deepEqual(diffPaths({ a: 1, b: 2 }, { a: 1 }), [{ op: "unset", path: ["b"] }]);
  assert.deepEqual(diffPaths({}, { models: { m: { enabled: false } } }), [{ op: "set", path: ["models"], value: { m: { enabled: false } } }]);
  assert.deepEqual(diffPaths({ models: { m: { enabled: false, context: "1m" } } }, { models: { m: { enabled: false } } }), [
    { op: "unset", path: ["models", "m", "context"] },
  ]);
});

test("patching a model clears fields instead of storing empty values", () => {
  const patched = withModelPatch({ models: { m: { enabled: false, context: "1m" } } }, "m", { context: undefined });
  assert.deepEqual(patched, { models: { m: { enabled: false } } });
  assert.deepEqual(withModelPatch(patched, "m", { enabled: undefined }), {}, "the last cleared field removes the entry");
  assert.deepEqual(withGlobals({ context: "max" }, { context: "min" }), { context: "min" });
  assert.deepEqual(withGlobals({ context: "max" }, { context: "" }), {});
});

test("the credential reference and the window field parse from what the page shows", () => {
  assert.equal(keyRefOf({ apiKeyEnv: " MY_KEY " }), "MY_KEY");
  assert.equal(keyRefOf({}), "CURSOR_API_KEY");
  assert.equal(parseWindow("300 000"), 300_000);
  assert.equal(parseWindow(""), undefined);
  assert.equal(parseWindow("0"), undefined);
  assert.equal(formatWindow(300_000), "300k");
  assert.equal(formatWindow(1_000_000), "1m");
  assert.equal(formatWindow(1_048_576), "1,048,576");
  assert.equal(formatWindow(262_144), "262,144");
  assert.equal(formatWindow(999), "999");
  assert.equal(windowSourceLabel("tier", "1m"), "provider tier 1m");
  assert.equal(windowSourceLabel("published"), "published upstream");
  assert.equal(windowSourceLabel("default"), "documented default");
});

test("a stored key is never shown: the section offers to replace it instead", () => {
  const stored = pageState({ key: { ...pageState().key, configured: true } });
  const collapsed = KeySection({ state: stored, handlers });
  assert.match(collected(collapsed), /A key is stored under CURSOR_API_KEY/);
  assert.match(collected(collapsed), /Change key/);
  assert.equal(hasTag(collapsed, "input"), false, "the field stays closed while a key is stored");
  assert.doesNotMatch(collected(collapsed), /Show|Hide|Save key/);

  const replacing = KeySection({ state: { ...stored, key: { ...stored.key, editing: true } }, handlers });
  assert.equal(hasTag(replacing, "input"), true, "asking to change the key opens a field");
  assert.match(collected(replacing), /Save key/);
  assert.match(collected(replacing), /Cancel/);
});

test("without a stored key the field is open, and the states are stated", () => {
  const missing = KeySection({ state: pageState(), handlers });
  assert.equal(hasTag(missing, "input"), true);
  assert.match(collected(missing), /No key is stored under CURSOR_API_KEY/);
  assert.match(collected(missing), /Save key/);
  assert.doesNotMatch(collected(missing), /Change key/);

  const unknown = KeySection({ state: pageState({ key: { ...pageState().key, configured: undefined } }), handlers });
  assert.match(collected(unknown), /Credential state for CURSOR_API_KEY is unavailable/);
});

test("the undescribed-model state is stated instead of offering controls the catalog cannot back", () => {
  const text = collected(ModelOptions({ row: row("deepseek"), writable: true, handlers }));
  assert.match(text, /publishes no parameters for this model/);
});

test("the page renders the catalog-unavailable state and the save control", () => {
  const loadingState = pageState({ catalogLoading: true, derived: derivePage(undefined, undefined) });
  assert.match(collected(ModelsSection({ state: loadingState, handlers })), /Loading the model catalog/);

  const unavailableState = pageState({ catalogError: "route answered 401", derived: derivePage(undefined, undefined) });
  assert.match(collected(ModelsSection({ state: unavailableState, handlers })), /model catalog is unavailable/);

  const dirty = PageView({ state: pageState({ dirty: true }), handlers });
  const footer = dirty.props.children.at(-1);
  assert.equal(footer.props.children.at(-1).props.disabled, false, "a dirty page offers Save");
  assert.match(collected(footer), /Save/);
});

test("the new-model default is a checkbox that writes on change", () => {
  const section = NewModelsSection({ state: pageState(), handlers });
  assert.equal(hasTag(section, "select"), false, "no select for a two-state choice");
  assert.equal(hasTag(section, "input"), true);
  assert.match(collected(section), /Models Cursor adds appear enabled/);
  const checkedOf = (node: any): boolean => {
    if (node === null || node === undefined || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(checkedOf);
    if (node.props?.type === "checkbox") return node.props.checked === true;
    return checkedOf(node.props?.children);
  };
  assert.equal(checkedOf(section), true, "enabled is the default state");
  const disabledState = pageState({ derived: derivePage({ newModels: "disabled" }, payload) });
  assert.equal(checkedOf(NewModelsSection({ state: disabledState, handlers })), false);
});

test("the row summary names how many models are configured", () => {
  assert.match(collected(SummaryView({ derived: derivePage(undefined, payload) })), /no per-model settings yet/);
  assert.match(
    collected(SummaryView({ derived: derivePage({ models: { claude: { enabled: false }, new: {} } }, payload) })),
    /1 configured model/,
  );
});

test("the controller fetches once at a time and reports failures", async () => {
  let calls = 0;
  let resolveFetch: ((payload: CatalogPayload) => void) | undefined;
  const controller = new CatalogController({
    fetchCatalog: () => {
      calls++;
      return new Promise<CatalogPayload>((resolve) => {
        resolveFetch = resolve;
      });
    },
    describeKey: async () => true,
    setKey: async () => undefined,
  });
  const first = controller.loadCatalog();
  const second = controller.loadCatalog();
  assert.equal(calls, 1);
  assert.equal(controller.getState().loading, true);
  resolveFetch!(payload);
  assert.equal((await first)?.rowId, "llm-cursor");
  assert.equal((await second)?.rowId, "llm-cursor");
  assert.equal(controller.getState().loading, false);

  const failing = new CatalogController({ fetchCatalog: async () => { throw new Error("route answered 401"); }, describeKey: async () => undefined, setKey: async () => undefined });
  assert.equal(await failing.loadCatalog(), undefined);
  assert.match(failing.getState().catalogError ?? "", /401/);
});

test("the controller stores a key, surfaces a refusal, and refreshes its state", async () => {
  let configured = false;
  let refusal: string | undefined;
  const controller = new CatalogController({
    fetchCatalog: async () => payload,
    describeKey: async () => configured,
    setKey: async (_reference, value) => {
      if (refusal !== undefined) return refusal;
      configured = value === "good";
      return undefined;
    },
  });
  await controller.loadKey("CURSOR_API_KEY");
  assert.equal(controller.getState().key.configured, false);

  refusal = "write refused";
  assert.equal(await controller.saveKey("CURSOR_API_KEY", "good"), "write refused");
  assert.equal(controller.getState().key.configured, false);

  refusal = undefined;
  assert.equal(await controller.saveKey("CURSOR_API_KEY", "good"), undefined);
  assert.equal(controller.getState().key.configured, true);
});
