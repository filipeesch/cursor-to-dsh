/**
 * The page's data: the live catalog the route serves, and whether a key is stored.
 *
 * A plain observable store rather than React state, so the page can render through
 * useSyncExternalStore and a test can drive it with fake services.
 */
import type { CatalogPayload } from "../catalog-payload.ts";

/** What the page reads about the outside world. */
export interface CatalogState {
  catalog?: CatalogPayload;
  catalogError?: string;
  loading: boolean;
  key: { configured?: boolean };
}

/** Host reads and writes the controller performs. */
export interface CatalogControllerDeps {
  fetchCatalog: () => Promise<CatalogPayload>;
  /** Redacted credential state for one reference; undefined when the read failed. */
  describeKey: (reference: string) => Promise<boolean | undefined>;
  /** Store one credential; resolves to a refusal message, or undefined once stored. */
  setKey: (reference: string, value: string) => Promise<string | undefined>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CatalogController {
  private state: CatalogState = { loading: false, key: {} };
  private readonly listeners = new Set<() => void>();
  private readonly deps: CatalogControllerDeps;
  private pending: Promise<CatalogPayload | undefined> | undefined;

  constructor(deps: CatalogControllerDeps) {
    this.deps = deps;
  }

  /** The current snapshot; the reference changes only when the state does. */
  readonly getState = (): CatalogState => this.state;

  /** Observe snapshot replacements. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<CatalogState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Fetch the catalog once at a time.
   * @returns the payload, or undefined when the route refused or failed.
   */
  loadCatalog(): Promise<CatalogPayload | undefined> {
    if (this.pending) return this.pending;
    this.publish({ loading: true });
    this.pending = this.deps.fetchCatalog()
      .then((catalog) => {
        this.publish({ catalog, catalogError: undefined, loading: false });
        return catalog;
      })
      .catch((error: unknown) => {
        this.publish({ catalogError: messageOf(error), loading: false });
        return undefined;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  /** Refresh whether a credential reference holds a key. */
  async loadKey(reference: string): Promise<void> {
    const configured = await this.deps.describeKey(reference);
    this.publish({ key: { configured } });
  }

  /**
   * Store one key and refresh its state.
   * @returns a refusal message, or undefined once stored.
   */
  async saveKey(reference: string, value: string): Promise<string | undefined> {
    const refusal = await this.deps.setKey(reference, value);
    if (refusal !== undefined) return refusal;
    await this.loadKey(reference);
    return undefined;
  }
}
