/**
 * The stateful page: it owns the draft, the expanded row and the in-flight writes, and renders the
 * pure components in `views.ts`.
 *
 * The draft starts from the host's accepted values and is saved as path operations against them, so
 * a field the page cannot see is never deleted by a save.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PathOp } from "./derive.ts";
import { derivePage, diffPaths, keyRefOf, parseWindow, withGlobals, withModelPatch, type ConfigValues } from "./derive.ts";
import type { CatalogController } from "./controller.ts";
import type { ModelSettings } from "../policy/types.ts";
import { PageView, SummaryView, type PageHandlers, type PageState } from "./views.ts";

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
  const { view, form, controller } = props;
  const external = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const accepted = (form?.state?.value ?? {}) as ConfigValues;
  const acceptedKey = JSON.stringify(accepted);
  const [draft, setDraft] = useState<ConfigValues>(accepted);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string } | undefined>(undefined);
  const [keyValue, setKeyValue] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  // A stored key keeps the field closed until the user asks to change it.
  const [editingKey, setEditingKey] = useState(false);
  const [newModelsBusy, setNewModelsBusy] = useState(false);

  const reference = keyRefOf(accepted);
  const writable = form?.state?.writable !== false;

  useEffect(() => {
    void controller.loadCatalog();
  }, [controller]);

  useEffect(() => {
    void controller.loadKey(reference);
  }, [controller, reference]);

  // Adopt the host's values while the user has no unsaved edits of their own.
  useEffect(() => {
    if (!dirty) setDraft(accepted);
  }, [acceptedKey, dirty]);

  const derived = useMemo(() => derivePage(draft, external.catalog), [draft, external.catalog]);

  const edit = (next: ConfigValues): void => {
    setDraft(next);
    setDirty(true);
    setMessage(undefined);
  };

  const handlers: PageHandlers = {
    onReload: () => {
      void controller.loadCatalog();
    },
    onSave: () => {
      void save();
    },
    onToggleEnabled: (id, enabled) => edit(withModelPatch(draft, id, { enabled })),
    onExpand: (id) => setExpanded((current) => (current === id ? undefined : id)),
    onTier: (id, value) => edit(withModelPatch(draft, id, { context: value })),
    onWindow: (id, text) => edit(withModelPatch(draft, id, { contextWindow: parseWindow(text) })),
    onFast: (id, value) => edit(withModelPatch(draft, id, { fast: value as ModelSettings["fast"] })),
    onMaxMode: (id, value) => edit(withModelPatch(draft, id, { maxMode: value as ModelSettings["maxMode"] })),
    onContext: (value) => edit(withGlobals(draft, { context: value })),
    onNewModels: (enabled) => {
      void saveNewModels(enabled);
    },
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

  async function save(): Promise<void> {
    if (!form) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const ops = diffPaths(accepted, draft);
      if (ops.length === 0) {
        setDirty(false);
        setMessage({ kind: "saved", text: "Nothing to save." });
        return;
      }
      const acceptedWrite = await form.mutate(ops, form.state.revision);
      if (acceptedWrite === false) {
        setMessage({ kind: "error", text: "The host refused the change; nothing was saved." });
        return;
      }
      setDirty(false);
      setMessage({ kind: "saved", text: "Saved." });
    } catch (error: unknown) {
      setMessage({ kind: "error", text: "The save failed: " + messageOf(error) });
    } finally {
      setSaving(false);
    }
  }

  /** The new-model default has no draft: toggling it writes straight through. */
  async function saveNewModels(enabled: boolean): Promise<void> {
    if (!form) return;
    const value = enabled ? "enabled" : "disabled";
    setNewModelsBusy(true);
    setMessage(undefined);
    try {
      const acceptedWrite = await form.mutate([{ op: "set", path: ["newModels"], value }], form.state.revision);
      if (acceptedWrite === false) {
        setMessage({ kind: "error", text: "The host refused the change; nothing was saved." });
        return;
      }
      setDraft((current) => withGlobals(current, { newModels: value }));
      setMessage({ kind: "saved", text: "Saved." });
    } catch (error: unknown) {
      setMessage({ kind: "error", text: "The save failed: " + messageOf(error) });
    } finally {
      setNewModelsBusy(false);
    }
  }

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

  if (view === "summary") return SummaryView({ derived });

  const state: PageState = {
    derived,
    expanded,
    catalogLoading: external.loading && external.catalog === undefined,
    ...(external.catalogError === undefined ? {} : { catalogError: external.catalogError }),
    ...(external.catalog?.knownContext.fetchedAt === undefined ? {} : { catalogAge: external.catalog.knownContext.fetchedAt }),
    knownContextEnabled: external.catalog?.knownContext.enabled ?? true,
    key: { reference, value: keyValue, configured: external.key.configured, busy: keyBusy, editing: editingKey },
    saving,
    savingNewModels: newModelsBusy,
    dirty,
    writable,
    ...(message === undefined ? {} : { message }),
  };
  return PageView({ state, handlers });
}
