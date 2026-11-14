/**
 * The stateful page: it owns the optimistic values, the key state and the debounced writes, and
 * renders the hook-free components in `views.ts`.
 *
 * A control change updates the view at once and schedules one write after a short quiet period, so
 * there is no save button and no in-flight indicator. A refused write is the only thing the page
 * announces for settings, and it rolls the control back to what the host accepted.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Autosave } from "./autosave.ts";
import {
  derivePage,
  keyRefOf,
  modelFieldOps,
  newModelsOps,
  parseWindow,
  withGlobals,
  withModelPatch,
  type ConfigValues,
  type PathOp,
} from "./derive.ts";
import type { CatalogController } from "./controller.ts";
import type { ModelSettings } from "../policy/types.ts";
import { PageView, SummaryView, type PageHandlers, type PageState, type Segmented } from "./views.ts";

/** The host form snapshot the plugin page hands over, narrowed to what this page reads. */
export interface RowConfigSnapshot {
  status: "loading" | "ready" | "unavailable";
  value?: Record<string, unknown>;
  base?: unknown;
  user?: unknown;
  revision?: number;
  writable: boolean;
}

/** The host form the plugin page hands the row's configuration through. */
export interface RowConfigForm {
  state: RowConfigSnapshot;
  mutate: (ops: readonly PathOp[], revision?: number) => Promise<boolean>;
}

/** Props the slot delivers: the requested view, the host form and this plugin's controller. */
export interface RowConfigProps {
  view: "summary" | "page";
  form?: RowConfigForm;
  controller: CatalogController;
  /** The product's segmented control, injected by the plugin entry. */
  segmented: Segmented;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Render the Cursor configuration for one row.
 * @param props - slot props: view, host form and controller.
 * @returns the summary line or the page.
 */
export function CursorRowConfig(props: RowConfigProps): any {
  const { view, controller, segmented } = props;
  const external = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const accepted = (props.form?.state?.value ?? {}) as ConfigValues;
  const acceptedKey = JSON.stringify(accepted);
  const formRef = useRef<RowConfigForm | undefined>(props.form);
  formRef.current = props.form;
  const acceptedRef = useRef<ConfigValues>(accepted);
  acceptedRef.current = accepted;

  const [values, setValues] = useState<ConfigValues>(accepted);
  const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string } | undefined>(undefined);
  const [keyValue, setKeyValue] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  // A stored key keeps the field closed until the user asks to change it.
  const [editingKey, setEditingKey] = useState(false);

  const autosaveRef = useRef<Autosave | undefined>(undefined);
  if (!autosaveRef.current) {
    autosaveRef.current = new Autosave({
      write: (ops, revision) => (formRef.current ? formRef.current.mutate(ops, revision) : Promise.resolve(false)),
      onFailure: (error) => {
        setValues(acceptedRef.current);
        setMessage({ kind: "error", text: "The change was not saved: " + messageOf(error) });
      },
    });
  }

  useEffect(() => () => {
    autosaveRef.current?.dispose();
  }, []);

  useEffect(() => {
    void controller.loadCatalog();
  }, [controller]);

  const reference = keyRefOf(accepted);
  useEffect(() => {
    void controller.loadKey(reference);
  }, [controller, reference]);

  // Adopt the host's values once nothing of ours is still on its way.
  useEffect(() => {
    if (autosaveRef.current?.size === 0) setValues(accepted);
  }, [acceptedKey]);

  const change = (field: string, next: ConfigValues, ops: PathOp[]): void => {
    setValues(next);
    setMessage(undefined);
    autosaveRef.current?.schedule(field, ops, formRef.current?.state.revision);
  };

  const handlers: PageHandlers = {
    onReload: () => {
      void controller.loadCatalog();
    },
    onToggleEnabled: (id, enabled) => change("models." + id + ".enabled", withModelPatch(values, id, { enabled }), modelFieldOps(id, "enabled", enabled)),
    onTier: (id, value) => change("models." + id + ".context", withModelPatch(values, id, { context: value }), modelFieldOps(id, "context", value)),
    onWindow: (id, text) => {
      const tokens = parseWindow(text);
      change("models." + id + ".contextWindow", withModelPatch(values, id, { contextWindow: tokens }), modelFieldOps(id, "contextWindow", tokens));
    },
    onFast: (id, value) => change("models." + id + ".fast", withModelPatch(values, id, { fast: value as ModelSettings["fast"] }), modelFieldOps(id, "fast", value)),
    onNewModels: (enabled) => change("newModels", withGlobals(values, { newModels: enabled ? "enabled" : "disabled" }), newModelsOps(enabled)),
    onKeyValue: setKeyValue,
    onSaveKey: () => {
      void saveKey();
    },
    onChangeKey: () => setEditingKey(true),
    onCancelKey: () => {
      setEditingKey(false);
      setKeyValue("");
    },
  };

  async function saveKey(): Promise<void> {
    const value = keyValue.trim();
    if (!value) return;
    setKeyBusy(true);
    setMessage(undefined);
    try {
      const refusal = await controller.saveKey(reference, value);
      if (refusal !== undefined) {
        setMessage({ kind: "error", text: "The API key was not stored: " + refusal });
        return;
      }
      setKeyValue("");
      setEditingKey(false);
      setMessage({ kind: "saved", text: "API key stored." });
    } catch (error: unknown) {
      setMessage({ kind: "error", text: "The API key was not stored: " + messageOf(error) });
    } finally {
      setKeyBusy(false);
    }
  }

  if (view === "summary") return SummaryView({ derived: derivePage(values, external.catalog) });

  const state: PageState = {
    derived: derivePage(values, external.catalog),
    catalogLoading: external.loading && external.catalog === undefined,
    ...(external.catalogError === undefined ? {} : { catalogError: external.catalogError }),
    key: { reference, value: keyValue, configured: external.key.configured, busy: keyBusy, editing: editingKey },
    writable: props.form?.state?.writable !== false,
    ...(message === undefined ? {} : { message }),
  };
  return PageView({ state, handlers, segmented });
}
