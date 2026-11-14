/**
 * Published model capacities: the fallback for models the provider does not describe.
 *
 * The public models.dev catalog publishes a context capacity per model, which is the only source
 * for the models Cursor lists without a context tier. The document is large, so it is fetched out
 * of band on a 24-hour window and projected down to the ids the provider currently lists; the
 * request path only ever reads the snapshot, exactly like the model catalog.
 */
import { debug } from "../debug.ts";

/** The public catalog this plugin falls back to. */
export const MODELS_DEV_URL = "https://models.dev/api.json";

const DEFAULT_FRESH_MS = 24 * 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

/**
 * The projection's own version, so a snapshot written under another rule is discarded instead of
 * trusted for a day. Bump it whenever `projectWindows` changes what it would produce.
 */
export const SNAPSHOT_VERSION = 2;

/** The persisted projection: published capacities keyed by provider model id. */
export interface KnownContextSnapshot {
  version: typeof SNAPSHOT_VERSION;
  fetchedAt: number;
  windows: Record<string, number>;
}

/** One model as the public catalog lists it. */
export interface PublishedModel {
  provider: string;
  id: string;
  name?: string;
  context?: number;
}

/** What the snapshot reads and how it refreshes. */
export interface KnownContextDeps {
  /** Model ids the provider currently lists; only these are projected. */
  modelIds: () => readonly string[];
  /** Whether the fetch may run at all. */
  enabled: () => boolean;
  /** Overridden by tests; defaults to the public catalog over HTTPS. */
  fetchCatalog?: () => Promise<unknown>;
  persist?: (snapshot: KnownContextSnapshot) => void;
  freshMs?: number;
  now?: () => number;
}

/** Comparison key: case, spaces and punctuation do not distinguish two spellings of one model. */
export function normalizeModelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The last path segment of a catalog id, which is the model's own name in the vendored form. */
export function lastSegment(id: string): string {
  const separator = id.lastIndexOf("/");
  return separator < 0 ? id : id.slice(separator + 1);
}

/** Model id prefix to the vendor that publishes it; used to prefer a vendor's own entry. */
const VENDORS: readonly (readonly [string, string])[] = [
  ["claude", "anthropic"],
  ["gpt", "openai"],
  ["gemini", "google"],
  ["grok", "xai"],
  ["kimi", "moonshot"],
  ["glm", "zai"],
  ["deepseek", "deepseek"],
  ["muse", "meta"],
];

/** The vendor a Cursor model id belongs to, when its name says so. */
export function vendorOf(modelId: string): string | undefined {
  const key = normalizeModelKey(modelId);
  for (const [prefix, vendor] of VENDORS) if (key.startsWith(prefix)) return vendor;
  return undefined;
}

/**
 * Read the models the public catalog describes, keeping only the entries that publish a capacity.
 * Malformed documents read as empty rather than throwing.
 */
export function publishedEntries(document: unknown): PublishedModel[] {
  if (!document || typeof document !== "object" || Array.isArray(document)) return [];
  const out: PublishedModel[] = [];
  for (const [provider, value] of Object.entries(document as Record<string, unknown>)) {
    const models = (value as { models?: unknown } | undefined)?.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    for (const [key, model] of Object.entries(models as Record<string, unknown>)) {
      const entry = (model ?? {}) as { id?: unknown; name?: unknown; limit?: { context?: unknown } };
      const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : key;
      const name = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : undefined;
      const context = entry.limit?.context;
      if (typeof context !== "number" || !Number.isFinite(context) || context <= 0) continue;
      out.push({ provider, id, ...(name === undefined ? {} : { name }), context: Math.round(context) });
    }
  }
  return out;
}

/**
 * Whether one published entry belongs to the model's own vendor. Only the provider identity counts:
 * an id path that merely carries the vendor name ("deepseek-ai/...") is a third party's namespace,
 * and its reduced-window variant must not speak for the vendor.
 */
function ownVendor(entry: PublishedModel, vendor: string): boolean {
  return normalizeModelKey(entry.provider).includes(vendor);
}

/** The capacity most candidates declare, preferring the larger one on a tie. */
export function mostDeclared(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === undefined || value > best))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Project the published catalog onto the ids the provider lists.
 *
 * A candidate matches when its own id segment or display name equals the provider id, ignoring
 * case and punctuation. When candidates disagree, entries published by the model's own vendor
 * provider win; the value is then the capacity most candidates declare, so a single gateway's
 * reduced variant does not become the model's window.
 * @param ids - model ids the provider currently lists.
 * @param entries - published catalog entries.
 * @returns capacity in tokens per provider model id.
 */
export function projectWindows(ids: readonly string[], entries: readonly PublishedModel[]): Record<string, number> {
  const windows: Record<string, number> = {};
  for (const id of ids) {
    const key = normalizeModelKey(id);
    if (!key) continue;
    const matches = entries.filter((entry) =>
      normalizeModelKey(lastSegment(entry.id)) === key || (entry.name !== undefined && normalizeModelKey(entry.name) === key));
    if (!matches.length) continue;
    const vendor = vendorOf(id);
    const preferred = vendor === undefined ? [] : matches.filter((entry) => ownVendor(entry, vendor));
    const pool = preferred.length ? preferred : matches;
    const value = mostDeclared(pool.map((entry) => entry.context as number));
    if (value !== undefined) windows[id] = value;
  }
  return windows;
}

/** Read at most the response cap, so a broken endpoint cannot exhaust memory. */
async function fetchPublishedCatalog(): Promise<unknown> {
  const response = await fetch(MODELS_DEV_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("models.dev answered " + response.status);
  const body = response.body;
  if (!body) throw new Error("models.dev answered no body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("models.dev response exceeded the size cap");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
}

/** The published capacities the request path reads without blocking. */
export class KnownContext {
  private readonly deps: KnownContextDeps;
  private snapshot: KnownContextSnapshot | undefined;
  private loading: Promise<void> | undefined;

  constructor(deps: KnownContextDeps) {
    this.deps = deps;
  }

  /** Adopt a persisted snapshot; malformed input is ignored. */
  load(snapshot: KnownContextSnapshot | undefined): void {
    if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !snapshot.windows || typeof snapshot.windows !== "object") return;
    const windows: Record<string, number> = {};
    for (const [id, tokens] of Object.entries(snapshot.windows)) {
      if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) windows[id] = Math.round(tokens);
    }
    this.snapshot = { version: SNAPSHOT_VERSION, fetchedAt: Number(snapshot.fetchedAt) || 0, windows };
  }

  /** Published capacity for one model id, when the snapshot describes it. */
  windowFor(modelId: string): number | undefined {
    return this.snapshot?.windows[modelId];
  }

  /** When the projection was last refreshed, for display. */
  fetchedAt(): number | undefined {
    return this.snapshot?.fetchedAt;
  }

  /** Whether the snapshot is older than the freshness window. */
  stale(): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return true;
    return this.now() - snapshot.fetchedAt >= (this.deps.freshMs ?? DEFAULT_FRESH_MS);
  }

  /** Refresh out of band when the snapshot is stale; never awaited by a request. */
  note(): void {
    if (!this.deps.enabled()) return;
    if (!this.deps.modelIds().length) return;
    if (this.stale()) void this.refresh().catch(() => {});
  }

  /** Refresh now; a disabled source, an empty catalog and an in-flight refresh resolve without a fetch. */
  refresh(): Promise<void> {
    if (!this.deps.enabled()) return Promise.resolve();
    if (!this.deps.modelIds().length) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.run()
      .catch((err: unknown) => {
        debug("published capacity fetch failed: " + (err instanceof Error ? err.message : String(err)));
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private async run(): Promise<void> {
    const ids = this.deps.modelIds();
    const document = await (this.deps.fetchCatalog ?? fetchPublishedCatalog)();
    const snapshot: KnownContextSnapshot = { version: SNAPSHOT_VERSION, fetchedAt: this.now(), windows: projectWindows(ids, publishedEntries(document)) };
    this.snapshot = snapshot;
    this.deps.persist?.(snapshot);
  }
}
