/**
 * The configuration page's presentational components.
 *
 * Each one is a pure function of its props: the stateful container in `page.ts` owns the optimistic
 * values, the key state and the debounced writes, and these render exactly what it passes in.
 * Keeping them hook-free is what lets a test render a row or a state by calling the function.
 */
import { createElement as h } from "react";
import type { ModelRow } from "./derive.ts";
import { formatWindow, windowSourceLabel, type DerivedPage } from "./derive.ts";
import { PACKAGE_NAME } from "../constants.ts";

/** One segment of the product's segmented control. */
export interface SegmentedOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** The product's segmented control, injected by the plugin entry so the views stay testable. */
export type Segmented = (props: {
  id: string;
  value: string;
  options: readonly SegmentedOption[];
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
}) => any;

/** Every interaction the page offers. */
export interface PageHandlers {
  onReload: () => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onTier: (id: string, value: string | undefined) => void;
  onWindow: (id: string, text: string) => void;
  onFast: (id: string, value: string | undefined) => void;
  onNewModels: (enabled: boolean) => void;
  onKeyValue: (value: string) => void;
  onSaveKey: () => void;
  /** Ask to replace a stored key. */
  onChangeKey: () => void;
  /** Discard a replacement without storing it. */
  onCancelKey: () => void;
}

/** Everything the page shows. */
export interface PageState {
  derived: DerivedPage;
  catalogLoading: boolean;
  catalogError?: string;
  key: {
    reference: string;
    value: string;
    configured: boolean | undefined;
    busy: boolean;
    /** Whether the field is open to replace a stored key. */
    editing: boolean;
  };
  writable: boolean;
  /** Only failures and the key confirmation ever produce one. */
  message?: { kind: "saved" | "error"; text: string };
}

function section(title: string, description: string | undefined, children: any, actions?: any): any {
  return h("section", { className: "ctd-section" },
    h("div", { className: "ctd-section-head" },
      h("h3", { className: "ctd-section-title" }, title),
      actions ?? null),
    description === undefined ? null : h("p", { className: "ctd-section-note" }, description),
    children);
}

function keyStatusText(configured: boolean | undefined, reference: string): string {
  if (configured === true) return "A key is stored under " + reference + ".";
  if (configured === false) return "No key is stored under " + reference + ".";
  return "Credential state for " + reference + " is unavailable.";
}

/**
 * The API key section.
 *
 * A stored key is never rendered: once the credential is configured the section shows only its
 * state and a control to replace it, and the replacement field stays closed until asked for.
 */
export function KeySection(props: { state: PageState; handlers: PageHandlers }): any {
  const { key, writable } = props.state;
  const { handlers } = props;
  const replaceable = key.configured === true;
  const open = !replaceable || key.editing;
  const controls = open
    ? h("div", { className: "ctd-key-row" },
      h("input", {
        type: "password",
        className: "ctd-input ctd-key-input",
        value: key.value,
        placeholder: replaceable ? "New key" : "Paste the Cursor API key",
        autoComplete: "new-password",
        spellCheck: false,
        disabled: !writable || key.busy,
        autoFocus: replaceable,
        "aria-label": "Cursor API key",
        onChange: (event: any) => handlers.onKeyValue(event.target.value),
      }),
      h("button", { type: "button", className: "ctd-button ctd-button-primary", onClick: handlers.onSaveKey, disabled: !writable || key.busy || key.value.trim().length === 0 }, key.busy ? "Saving..." : "Save key"),
      replaceable
        ? h("button", { type: "button", className: "ctd-button", onClick: handlers.onCancelKey, disabled: key.busy }, "Cancel")
        : null)
    : h("div", { className: "ctd-key-row" },
      h("button", { type: "button", className: "ctd-button", onClick: handlers.onChangeKey, disabled: !writable || key.busy }, "Change key"));
  return section("API key", "Stored as a credential, never read back by the page.", h("div", { className: "ctd-key" }, controls,
    h("p", { className: "ctd-status " + (key.configured === true ? "ctd-status-ok" : key.configured === false ? "ctd-status-warn" : "ctd-status-dim") }, keyStatusText(key.configured, key.reference))));
}

function tierOptions(row: ModelRow): { value: string; label: string }[] {
  return [{ value: "", label: "Auto" }, ...row.tierOptions];
}

const FAST_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

/** One model: enablement, then the controls its catalog entry supports, all on one line. */
export function ModelRowView(props: { row: ModelRow; writable: boolean; handlers: PageHandlers; segmented: Segmented }): any {
  const { row, writable, handlers, segmented } = props;
  return h("li", { className: "ctd-model" + (row.enabled ? "" : " ctd-model-off") },
    h("div", { className: "ctd-model-head" },
      h("label", { className: "ctd-model-toggle" },
        h("input", {
          type: "checkbox",
          checked: row.enabled,
          disabled: !writable,
          "aria-label": "Enable " + row.name,
          onChange: (event: any) => handlers.onToggleEnabled(row.id, event.target.checked),
        }),
        h("span", { className: "ctd-model-name" }, row.name)),
      h("span", { className: "ctd-model-id" }, row.id)),
    h("div", { className: "ctd-model-controls" },
      row.tierOffered
        ? h("div", { className: "ctd-control" },
          h("span", { className: "ctd-control-label" }, "Context"),
          h(segmented, {
            id: "ctd-tier-" + row.id,
            label: "Context tier for " + row.name,
            value: row.tierValue ?? "",
            options: tierOptions(row),
            disabled: !writable,
            onChange: (next: string) => handlers.onTier(row.id, next === "" ? undefined : next),
          }))
        : null,
      row.fastOffered
        ? h("div", { className: "ctd-control" },
          h("span", { className: "ctd-control-label" }, "Fast"),
          h(segmented, {
            id: "ctd-fast-" + row.id,
            label: "Fast mode for " + row.name,
            value: row.fastValue ?? "",
            options: FAST_OPTIONS,
            disabled: !writable,
            onChange: (next: string) => handlers.onFast(row.id, next === "" ? undefined : next),
          }))
        : null,
      // The value lives in the field when it can be edited, and in a chip when it cannot; the source
      // stays on the control's tooltip so the row does not carry a provenance label.
      row.manualWindow.editable
        ? h("label", { className: "ctd-control" },
          h("span", { className: "ctd-control-label" }, "Window"),
          h("input", {
            type: "text",
            inputMode: "numeric",
            className: "ctd-input ctd-window-input",
            value: row.manualWindow.value === undefined ? "" : String(row.manualWindow.value),
            title: windowSourceLabel(row.window.source, row.window.tier),
            disabled: !writable,
            "aria-label": "Context window for " + row.name,
            onChange: (event: any) => handlers.onWindow(row.id, event.target.value),
          }))
        : h("span", { className: "ctd-chip", title: windowSourceLabel(row.window.source, row.window.tier) }, formatWindow(row.window.tokens)),
      row.described ? null : h("span", { className: "ctd-note" }, "not described by the catalog")));
}

/** The whole model list, its loading and unavailable states included. */
export function ModelsSection(props: { state: PageState; handlers: PageHandlers; segmented: Segmented }): any {
  const { derived, catalogLoading, catalogError, writable } = props.state;
  const { handlers, segmented } = props;
  let body: any;
  if (catalogLoading) body = h("p", { className: "ctd-note" }, "Loading the model catalog from Cursor...");
  else if (catalogError !== undefined) body = h("div", { className: "ctd-alert" }, "The model catalog is unavailable right now: " + catalogError);
  else if (derived.rows.length === 0) body = h("p", { className: "ctd-note" }, "Cursor has not published any models yet.");
  else body = h("ul", { className: "ctd-models" }, ...derived.rows.map((row) => h(ModelRowView, {
    key: row.id,
    row,
    writable,
    handlers,
    segmented,
  })));
  return section("Models",
    derived.rows.length === 0 ? undefined : derived.enabledCount + " of " + derived.rows.length + " enabled; changes save as you make them. A disabled model leaves the picker but a saved conversation keeps working.",
    body,
    h("button", {
      type: "button",
      className: "ctd-button",
      onClick: handlers.onReload,
      disabled: catalogLoading,
    }, catalogLoading ? "Loading..." : "Reload catalog"));
}

/** Whether a model with no entry of its own appears; the toggle writes on change. */
export function NewModelsSection(props: { state: PageState; handlers: PageHandlers }): any {
  const { derived, writable } = props.state;
  return section("New models", "Applies to models the catalog lists without an entry of their own.", h("label", { className: "ctd-check" },
    h("input", {
      type: "checkbox",
      checked: derived.newModels === "enabled",
      disabled: !writable,
      "aria-label": "New models appear enabled",
      onChange: (event: any) => props.handlers.onNewModels(event.target.checked),
    }),
    h("span", { className: "ctd-check-label" }, "Models Cursor adds appear enabled")));
}

/** The page itself; messages appear only when something failed or a key was stored. */
export function PageView(props: { state: PageState; handlers: PageHandlers; segmented: Segmented }): any {
  const { state, handlers, segmented } = props;
  return h("div", { className: "ctd-page", "data-plugin": PACKAGE_NAME },
    h("div", { className: "ctd-head" },
      h("div", null,
        h("h2", { className: "ctd-title" }, "Cursor"),
        h("p", { className: "ctd-intro" }, "Configure the Cursor provider: its API key, the context the host advertises, and which models it offers.")),
      state.message === undefined
        ? null
        : h("p", {
          className: "ctd-status " + (state.message.kind === "saved" ? "ctd-status-ok" : "ctd-status-error"),
          role: state.message.kind === "saved" ? "status" : "alert",
        }, state.message.text)),
    h(KeySection, { state, handlers }),
    h(ModelsSection, { state, handlers, segmented }),
    h(NewModelsSection, { state, handlers }));
}

/** The one-line summary the plugin row page shows. */
export function SummaryView(props: { derived: DerivedPage }): any {
  const { derived } = props;
  const count = derived.overrides;
  return h("span", null, count === 0
    ? "Cursor: no per-model settings yet."
    : "Cursor: " + count + " configured " + (count === 1 ? "model" : "models") + ".");
}
