import { test } from "node:test";
import assert from "node:assert/strict";

import type { CatalogPayload } from "../src/catalog-payload.ts";
import { CatalogController } from "../src/client/controller.ts";
import {
  derivePage,
  diffPaths,
  formatWindow,
  keyRefOf,
  modelFieldOps,
  newModelsOps,
  parseWindow,
  windowSourceLabel,
  withGlobals,
  withModelPatch,
  type ModelRow,
} from "../src/client/derive.ts";
import type { PageHandlers, PageState } from "../src/client/views.ts";
import { KeySection, ModelsSection, ModelRowView, NewModelsSection, PageView, SummaryView } from "../src/client/views.ts";

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
      parameters: [{ id: "context", values: [{ value: "300k" }, { value: "1m" }] }, { id: "fast", values: [{ value: "false" }, { value: "true" }] }],
      variants: [],
      acceptedTier: "300k",
    },
    { id: "deepseek", name: "DeepSeek", parameters: [], variants: [], publishedContextWindow: 1_048_576 },
    { id: "kimi", name: "Kimi", parameters: [], variants: [] },
    { id: "composer", name: "Composer", parameters: [{ id: "fast", values: [{ value: "false" }, { value: "true" }] }], variants: [] },
  ],
};

const handlers: PageHandlers = {
  onReload: () => {},
  onToggleEnabled: () => {},
  onTier: () => {},
  onWindow: () => {},
  onFast: () => {},
  onNewModels: () => {},
  onKeyValue: () => {},
  onSaveKey: () => {},
  onChangeKey: () => {},
  onCancelKey: () => {},
};

function collected(node: any): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collected).join(" ");
  if (typeof node === "object" && node.props !== undefined) return collected(node.props.children);
  return "";
}

function findByType(node: any, type: unknown): any {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByType(child, type);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node.type === type) return node;
  return findByType(node.props?.children, type);
}

function findByProp(node: any, predicate: (element: any) => boolean): any {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByProp(child, predicate);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof node.type === "string" && predicate(node)) return node;
  return findByProp(node.props?.children, predicate);
}

function hasTag(node: any, tag: string): boolean {
  if (node === null || node === undefined || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => hasTag(child, tag));
  if (node.type === tag) return true;
  return hasTag(node.props?.children, tag);
}

/** Stand-in for the product's segmented control: the views only need a component identity. */
const FakeSegmented = (props: any): any => null;

function row(id: string, derived = derivePage(undefined, payload)): ModelRow {
  const found = derived.rows.find((candidate) => candidate.id === id);
  assert.ok(found, "row " + id);
  return found;
}

function pageState(overrides: Partial<PageState> = {}): PageState {
  return {
    derived: derivePage(undefined, payload),
    catalogLoading: false,
    key: { reference: "CURSOR_API_KEY", value: "", configured: false, busy: false, editing: false },
    writable: true,
    ...overrides,
  };
}

test("derivation follows the catalog: tiers, published capacity and the manual last resort", () => {
  const derived = derivePage(undefined, payload);
  assert.equal(derived.rows.length, 4);
  assert.equal(derived.overrides, 0);
  assert.equal(derived.newModels, "enabled");

  const claude = row("claude", derived);
  assert.equal(claude.tierOffered, true);
  assert.deepEqual(claude.tierOptions, [{ value: "300k", label: "300k" }, { value: "1m", label: "1m" }]);
  assert.equal(claude.tierValue, undefined, "no override means the automatic choice");
  assert.equal(claude.window.source, "tier");
  assert.equal(claude.window.tokens, 300_000, "the accepted tier wins");
  assert.equal(claude.fastOffered, true);
  assert.equal(claude.manualWindow.editable, false);

  const deepseek = row("deepseek", derived);
  assert.equal(deepseek.window.source, "published");
  assert.equal(deepseek.window.tokens, 1_048_576);
  assert.equal(deepseek.manualWindow.editable, false);
  assert.equal(deepseek.described, false);

  const kimi = row("kimi", derived);
  assert.equal(kimi.window.source, "default");
  assert.equal(kimi.manualWindow.editable, true);
  assert.equal(kimi.manualWindow.value, 200_000, "the field shows the window in effect, not an empty box");
  assert.equal(kimi.tierOffered, false);
  assert.equal(kimi.fastOffered, false);

  const composer = row("composer", derived);
  assert.equal(composer.tierOffered, false);
  assert.equal(composer.fastOffered, true);
});

test("a per-model tier overrides the automatic choice, and clearing it restores Auto", () => {
  const chosen = derivePage({ models: { claude: { context: "1m" } } }, payload);
  assert.equal(row("claude", chosen).tierValue, "1m");
  assert.equal(row("claude", chosen).window.tokens, 1_000_000);
  assert.equal(row("claude", chosen).configured, true);
  assert.equal(chosen.overrides, 1);

  const cleared = withModelPatch({ models: { claude: { context: "1m", fast: "off" } } }, "claude", { context: undefined });
  assert.deepEqual(cleared, { models: { claude: { fast: "off" } } });
  assert.deepEqual(withModelPatch(cleared, "claude", { fast: undefined }), {}, "the last cleared field removes the entry");
});

test("a manual window fills a model nothing describes, and only then", () => {
  const manual = derivePage({ models: { kimi: { contextWindow: 500_000 }, deepseek: { contextWindow: 900_000 } } }, payload);
  assert.deepEqual(row("kimi", manual).window, { tokens: 500_000, source: "manual" });
  assert.equal(row("kimi", manual).manualWindow.value, 500_000);
  assert.deepEqual(row("deepseek", manual).window, { tokens: 1_048_576, source: "published" }, "the published capacity still wins");
});

test("enablement follows the entry and the new-model default", () => {
  const disabled = derivePage({ newModels: "disabled", models: { kimi: { enabled: true } } }, payload);
  assert.equal(row("claude", disabled).enabled, false);
  assert.equal(row("kimi", disabled).enabled, true);
  assert.equal(disabled.enabledCount, 1);
});

test("each model renders one line with inline segmented controls, without a Settings toggle", () => {
  const claude = ModelRowView({ row: row("claude"), writable: true, handlers, segmented: FakeSegmented });
  const tiers = findByType(claude, FakeSegmented);
  assert.ok(tiers, "the tier control is inline");
  assert.deepEqual(tiers.props.options.map((option: any) => option.value), ["", "300k", "1m"]);
  assert.equal(tiers.props.value, "", "Auto is selected without an override");
  assert.match(tiers.props.label, /Context tier for Claude/);
  assert.doesNotMatch(collected(claude), /Settings/);
  assert.equal(hasTag(claude, "input"), true, "enablement stays inline");

  const kimi = ModelRowView({ row: row("kimi"), writable: true, handlers, segmented: FakeSegmented });
  assert.equal(findByType(kimi, FakeSegmented), undefined, "a model with no tier or fast offers no segmented control");
  assert.match(collected(kimi), /not described by the catalog/);
  assert.match(collected(kimi), /200k/);

  const withFast = ModelRowView({ row: row("composer"), writable: true, handlers, segmented: FakeSegmented });
  const fast = findByType(withFast, FakeSegmented);
  assert.ok(fast, "a model that publishes fast gets the control");
  assert.deepEqual(fast.props.options.map((option: any) => option.value), ["", "off", "on"]);
});

test("the model list states its loading and unavailable conditions", () => {
  const segmented = FakeSegmented;
  const loading = ModelsSection({ state: pageState({ catalogLoading: true, derived: derivePage(undefined, undefined) }), handlers, segmented });
  assert.match(collected(loading), /Loading the model catalog/);

  const unavailable = ModelsSection({ state: pageState({ catalogError: "route answered 401", derived: derivePage(undefined, undefined) }), handlers, segmented });
  assert.match(collected(unavailable), /model catalog is unavailable/);
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

test("the new-model default is a checkbox, and the page has no save control", () => {
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

  const page = PageView({ state: pageState(), handlers, segmented: FakeSegmented });
  const json = JSON.stringify(page);
  assert.doesNotMatch(json, /ctd-footer/, "the page carries no save footer");
  assert.doesNotMatch(json, /"Save"/, "no button labelled Save");
});

test("a failed write is announced as an alert", () => {
  const failed = PageView({ state: pageState({ message: { kind: "error", text: "The change was not saved: refused" } }), handlers, segmented: FakeSegmented });
  const alert = findByProp(failed, (element: any) => element.type === "p" && element.props.role === "alert");
  assert.ok(alert, "the failure is announced as an alert, not a status");
  assert.match(collected(alert), /The change was not saved/);
});

test("diffing and field operations produce the edits the host accepts", () => {
  assert.deepEqual(diffPaths({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(diffPaths({ a: 1, b: 2 }, { a: 1, b: 3 }), [{ op: "set", path: ["b"], value: 3 }]);
  assert.deepEqual(diffPaths({ a: 1, b: 2 }, { a: 1 }), [{ op: "unset", path: ["b"] }]);
  assert.deepEqual(modelFieldOps("m", "context", "1m"), [{ op: "set", path: ["models", "m", "context"], value: "1m" }]);
  assert.deepEqual(modelFieldOps("m", "context", undefined), [{ op: "unset", path: ["models", "m", "context"] }]);
  assert.deepEqual(modelFieldOps("m", "enabled", false), [{ op: "set", path: ["models", "m", "enabled"], value: false }]);
  assert.deepEqual(newModelsOps(false), [{ op: "set", path: ["newModels"], value: "disabled" }]);
  assert.deepEqual(withGlobals({ context: "max" }, { context: "min" }), { context: "min" });
});

test("window and reference formatting", () => {
  assert.equal(keyRefOf({ apiKeyEnv: " MY_KEY " }), "MY_KEY");
  assert.equal(keyRefOf({}), "CURSOR_API_KEY");
  assert.equal(parseWindow("300 000"), 300_000);
  assert.equal(parseWindow(""), undefined);
  assert.equal(formatWindow(300_000), "300k");
  assert.equal(formatWindow(1_000_000), "1m");
  assert.equal(formatWindow(1_048_576), "1,048,576");
  assert.equal(windowSourceLabel("tier", "1m"), "provider tier 1m");
  assert.equal(windowSourceLabel("published"), "published upstream");
  assert.equal(windowSourceLabel("default"), "documented default");
});

test("the row summary names how many models are configured", () => {
  assert.match(collected(SummaryView({ derived: derivePage(undefined, payload) })), /no per-model settings yet/);
  assert.match(collected(SummaryView({ derived: derivePage({ models: { claude: { context: "1m" }, kimi: { enabled: false } } }, payload) })), /2 configured models/);
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
  resolveFetch!(payload);
  assert.equal((await first)?.rowId, "llm-cursor");
  assert.equal((await second)?.rowId, "llm-cursor");

  const failing = new CatalogController({ fetchCatalog: async () => { throw new Error("route answered 401"); }, describeKey: async () => undefined, setKey: async () => undefined });
  assert.equal(await failing.loadCatalog(), undefined);
  assert.match(failing.getState().catalogError ?? "", /401/);
});
