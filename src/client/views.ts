/**
 * The configuration page's presentational components.
 *
 * Each one is a pure function of its props: the stateful container in `page.ts` owns drafts,
 * expanded rows and in-flight writes, and these render exactly what it passes in. Keeping them
 * hook-free is what lets a test render a row or a state by calling the function.
 */
import { createElement as h } from "react";
import type { ModelRow } from "./derive.ts";
import { formatWindow, windowSourceLabel } from "./derive.ts";
import type { DerivedPage } from "./derive.ts";
import { PACKAGE_NAME } from "../constants.ts";

/** Every interaction the page offers. */
export interface PageHandlers {
  onReload: () => void;
  onSave: () => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onExpand: (id: string) => void;
  onTier: (id: string, value: string | undefined) => void;
  onWindow: (id: string, text: string) => void;
  onFast: (id: string, value: string | undefined) => void;
  onMaxMode: (id: string, value: string | undefined) => void;
  onContext: (value: string) => void;
  /** Write the new-model default immediately; this control has no draft. */
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
  expanded: string | undefined;
  catalogLoading: boolean;
  catalogError?: string;
  catalogAge?: number;
  knownContextEnabled: boolean;
  key: {
    reference: string;
    value: string;
    configured: boolean | undefined;
    busy: boolean;
    /** Whether the field is open to replace a stored key. */
    editing: boolean;
  };
  saving: boolean;
  /** Whether the new-model toggle has an immediate write in flight. */
  savingNewModels: boolean;
  dirty: boolean;
  writable: boolean;
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

/** The global context preference. */
export function ContextSection(props: { state: PageState; handlers: PageHandlers }): any {
  const { derived, writable } = props.state;
  return section("Context", "Applies to every model without its own tier. The provider tier wins when a model publishes one.", h("label", { className: "ctd-field" },
    h("span", { className: "ctd-field-label" }, "Default tier"),
    h("select", {
      className: "ctd-input ctd-select",
      value: derived.context,
      disabled: !writable,
      "aria-label": "Default context tier",
      onChange: (event: any) => props.handlers.onContext(event.target.value),
    },
    h("option", { value: "max" }, "Largest the Max Mode policy allows"),
    h("option", { value: "min" }, "Smallest offered"))));
}

function option(value: string, label: string): any {
  return h("option", { key: value, value }, label);
}

function tierLabel(tier: ModelRow["tiers"][number]): string {
  return formatWindow(tier.tokens) + (tier.maxMode ? " - Max Mode" : "");
}

/** One model's expanded settings. */
export function ModelOptions(props: { row: ModelRow; writable: boolean; handlers: PageHandlers }): any {
  const { row, writable } = props;
  const { handlers } = props;
  const disabled = !writable;
  const children: any[] = [];
  if (row.tierOffered) {
    children.push(h("label", { key: "tier", className: "ctd-field" },
      h("span", { className: "ctd-field-label" }, "Context tier"),
      h("select", {
        className: "ctd-input ctd-select",
        value: row.tierOverride ?? "",
        disabled,
        "aria-label": "Context tier for " + row.name,
        onChange: (event: any) => handlers.onTier(row.id, event.target.value === "" ? undefined : event.target.value),
      },
      option("", "Inherit (" + (row.tiers.find((tier) => tier.selected)?.value ?? "provider default") + ")"),
      ...row.tiers.map((tier) => option(tier.value, tierLabel(tier))))));
  }
  if (row.manualWindow.editable) {
    children.push(h("label", { key: "window", className: "ctd-field" },
      h("span", { className: "ctd-field-label" }, "Context window (tokens)"),
      h("input", {
        type: "text",
        inputMode: "numeric",
        className: "ctd-input",
        value: row.manualWindow.value === undefined ? "" : String(row.manualWindow.value),
        placeholder: "Default " + formatWindow(row.window.tokens),
        disabled,
        "aria-label": "Context window for " + row.name,
        onChange: (event: any) => handlers.onWindow(row.id, event.target.value),
      })));
  } else {
    children.push(h("p", { key: "window-note", className: "ctd-note" },
      "Window: " + formatWindow(row.window.tokens) + " from " + windowSourceLabel(row.window.source, row.window.tier) + "."));
  }
  if (row.fastOffered) {
    children.push(h("label", { key: "fast", className: "ctd-field" },
      h("span", { className: "ctd-field-label" }, "Fast mode"),
      h("select", {
        className: "ctd-input ctd-select",
        value: row.fastValue ?? "",
        disabled,
        "aria-label": "Fast mode for " + row.name,
        onChange: (event: any) => handlers.onFast(row.id, event.target.value === "" ? undefined : event.target.value),
      }, option("", "Inherit (" + row.fastInherited + ")"), option("off", "Off"), option("on", "On"), option("auto", "Provider default"))));
  }
  if (row.maxModeOffered) {
    children.push(h("label", { key: "maxmode", className: "ctd-field" },
      h("span", { className: "ctd-field-label" }, "Max Mode"),
      h("select", {
        className: "ctd-input ctd-select",
        value: row.maxModeValue ?? "",
        disabled,
        "aria-label": "Max Mode for " + row.name,
        onChange: (event: any) => handlers.onMaxMode(row.id, event.target.value === "" ? undefined : event.target.value),
      }, option("", "Inherit (" + row.maxModeInherited + ")"), option("off", "Off"), option("on", "On"), option("auto", "Provider default"))));
  }
  if (!row.described) {
    children.push(h("p", { key: "undescribed", className: "ctd-note" }, "The catalog publishes no parameters for this model, so only enablement and the context window are available."));
  }
  return h("div", { className: "ctd-model-body" }, ...children);
}

/** One model row: enablement, the window in effect, and a fold with the per-model settings. */
export function ModelRowView(props: { row: ModelRow; expanded: boolean; writable: boolean; handlers: PageHandlers }): any {
  const { row, expanded, writable, handlers } = props;
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
      h("span", { className: "ctd-model-id" }, row.id),
      h("span", { className: "ctd-chip" + (row.window.source === "default" ? " ctd-chip-dim" : "") }, formatWindow(row.window.tokens)),
      h("span", { className: "ctd-model-source" }, windowSourceLabel(row.window.source, row.window.tier)),
      h("button", {
        type: "button",
        className: "ctd-button",
        "aria-expanded": expanded,
        onClick: () => handlers.onExpand(row.id),
      }, expanded ? "Hide" : "Settings")),
    expanded ? h(ModelOptions, { row, writable, handlers }) : null);
}

/** The whole model list, its loading and unavailable states included. */
export function ModelsSection(props: { state: PageState; handlers: PageHandlers }): any {
  const { derived, catalogLoading, catalogError, expanded, writable } = props.state;
  const { handlers } = props;
  let body: any;
  if (catalogLoading) body = h("p", { className: "ctd-note" }, "Loading the model catalog from Cursor...");
  else if (catalogError !== undefined) body = h("div", { className: "ctd-alert" }, "The model catalog is unavailable right now: " + catalogError);
  else if (derived.rows.length === 0) body = h("p", { className: "ctd-note" }, "Cursor has not published any models yet.");
  else body = h("ul", { className: "ctd-models" }, ...derived.rows.map((row) => h(ModelRowView, {
    key: row.id,
    row,
    expanded: expanded === row.id,
    writable,
    handlers,
  })));
  return section("Models", derived.rows.length === 0 ? undefined : derived.enabledCount + " of " + derived.rows.length + " enabled; a disabled model leaves the picker but a saved conversation keeps working.", body, h("button", {
    type: "button",
    className: "ctd-button",
    onClick: handlers.onReload,
    disabled: catalogLoading,
  }, catalogLoading ? "Loading..." : "Reload catalog"));
}

/** Whether a model with no entry of its own appears; the toggle writes on change. */
export function NewModelsSection(props: { state: PageState; handlers: PageHandlers }): any {
  const { derived, writable, savingNewModels } = props.state;
  return section("New models", "Applies to models the catalog lists without an entry of their own, and saves as soon as it is toggled.", h("label", { className: "ctd-check" },
    h("input", {
      type: "checkbox",
      checked: derived.newModels === "enabled",
      disabled: !writable || savingNewModels,
      "aria-label": "New models appear enabled",
      onChange: (event: any) => props.handlers.onNewModels(event.target.checked),
    }),
    h("span", { className: "ctd-check-label" }, "Models Cursor adds appear enabled")));
}

/** The page itself, plus its messages and save control. */
export function PageView(props: { state: PageState; handlers: PageHandlers }): any {
  const { state, handlers } = props;
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
    h(ContextSection, { state, handlers }),
    h(ModelsSection, { state, handlers }),
    h(NewModelsSection, { state, handlers }),
    h("div", { className: "ctd-footer" },
      h("span", { className: "ctd-note" },
        state.knownContextEnabled
          ? "Models the provider does not describe fall back to capacities published upstream" + (state.catalogAge === undefined ? "." : " (fetched " + new Date(state.catalogAge).toLocaleString() + ").")
          : "The published-capacity fallback is off; those models use a manual value or the documented default."),
      h("button", {
        type: "button",
        className: "ctd-button ctd-button-primary",
        onClick: handlers.onSave,
        disabled: !state.writable || state.saving || !state.dirty,
      }, state.saving ? "Saving..." : state.dirty ? "Save" : "No changes")));
}

/** The one-line summary the plugin row page shows. */
export function SummaryView(props: { derived: DerivedPage }): any {
  const { derived } = props;
  const count = derived.overrides;
  return h("span", null, count === 0
    ? "Cursor: no per-model settings yet."
    : "Cursor: " + count + " configured " + (count === 1 ? "model" : "models") + ".");
}
