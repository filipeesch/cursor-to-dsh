/**
 * The model catalog as a snapshot the request path can read synchronously.
 *
 * A call must never wait for the provider's catalog: the last known snapshot answers it, and a
 * stale snapshot is refreshed out of band. `FALLBACK_MODELS` covers a cold start with no snapshot.
 */
import { debug } from "../debug.ts";
import { FALLBACK_MODELS, type CatalogModel } from "../models.ts";

export interface CatalogSnapshot {
  models: CatalogModel[];
  /** False when the last fetch failed and these models are a stale or fallback answer. */
  live: boolean;
  fetchedAt: number;
}

export interface CatalogDeps {
  listModels: (opts: { apiKey: string }) => Promise<CatalogModel[]>;
  resolveApiKey: () => Promise<string | undefined>;
  /** How long a live snapshot stays fresh. */
  freshMs?: number;
  /** How long to wait before retrying a failed fetch. */
  retryMs?: number;
  now?: () => number;
  persist?: (snapshot: CatalogSnapshot) => void;
  /** Called once a live catalog proves the key works; pays the SDK's per-process setup early. */
  onLive?: (opts: { apiKey: string; modelId: string }) => void;
}

const DEFAULT_FRESH_MS = 10 * 60_000;
const DEFAULT_RETRY_MS = 60_000;

export class ModelCatalog {
  private readonly deps: CatalogDeps;
  private snapshot: CatalogSnapshot | undefined;
  private loading: Promise<CatalogModel[]> | undefined;

  constructor(deps: CatalogDeps) {
    this.deps = deps;
  }

  /** Adopt a persisted snapshot; malformed input is ignored. */
  load(snapshot: CatalogSnapshot | undefined): void {
    if (!snapshot || !Array.isArray(snapshot.models) || snapshot.models.length === 0) return;
    this.snapshot = { models: snapshot.models, live: snapshot.live !== false, fetchedAt: Number(snapshot.fetchedAt) || 0 };
  }

  /** What a request path may read: never blocks, always answers. */
  current(): CatalogModel[] {
    return this.snapshot?.models.length ? this.snapshot.models : FALLBACK_MODELS;
  }

  stale(): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return true;
    const fresh = snapshot.live ? (this.deps.freshMs ?? DEFAULT_FRESH_MS) : (this.deps.retryMs ?? DEFAULT_RETRY_MS);
    return this.now() - snapshot.fetchedAt >= fresh;
  }

  /** Start a background refresh when the snapshot is stale; never awaited by a call. */
  note(): void {
    if (this.stale()) void this.refresh().catch(() => {});
  }

  refresh(): Promise<CatalogModel[]> {
    this.loading ??= this.fetch().finally(() => (this.loading = undefined));
    return this.loading;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private async fetch(): Promise<CatalogModel[]> {
    let models: CatalogModel[] = [];
    let apiKey: string | undefined;
    try {
      apiKey = await this.deps.resolveApiKey();
      if (apiKey) models = (await this.deps.listModels({ apiKey })) ?? [];
    } catch (err) {
      debug(`catalog failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const live = models.length > 0;
    this.snapshot = { models: live ? models : this.current(), live, fetchedAt: this.now() };
    this.deps.persist?.(this.snapshot);
    if (live && apiKey) {
      const modelId = models.find((m) => m.id === "default")?.id ?? models[0].id;
      this.deps.onLive?.({ apiKey, modelId });
    }
    return this.snapshot.models;
  }
}
