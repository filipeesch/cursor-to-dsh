/**
 * The one place the plugin looks for the Cursor API key: host credentials, then the launch
 * environment. A key stored from the settings page lives in the credentials service, so it is
 * found by the same lookup the rest of the plugin uses.
 */
import { debug } from "./debug.ts";

/** One resolved credential value, when the service has one. */
export interface CredentialValue {
  value?: string;
}

/** The host credentials service, narrowed to the one call this plugin makes. */
export interface CredentialsService {
  resolve(ref: string): CredentialValue | undefined | Promise<CredentialValue | undefined>;
}

/** The process launch environment, narrowed to the one call this plugin makes. */
export interface EnvironmentService {
  get(name: string): CredentialValue | undefined;
}

/** Where the resolver reads from. */
export interface CredentialResolverDeps {
  /** Reference name in effect (the configured name, or the plugin's default). */
  ref: () => string;
  credentials: () => CredentialsService | undefined;
  environment: () => EnvironmentService | undefined;
}

export class CredentialResolver {
  private readonly deps: CredentialResolverDeps;

  constructor(deps: CredentialResolverDeps) {
    this.deps = deps;
  }

  /**
   * Resolve the key for one operation.
   * @returns the trimmed key, or undefined when neither source has one.
   */
  async resolve(): Promise<string | undefined> {
    const ref = this.deps.ref();
    const credentials = this.deps.credentials();
    if (credentials) {
      try {
        const hit = await credentials.resolve(ref);
        if (hit?.value?.trim()) return hit.value.trim();
      } catch (err) {
        debug("credentials lookup failed: " + (err instanceof Error ? err.message : String(err)));
      }
    }
    return this.deps.environment()?.get(ref)?.value?.trim() || undefined;
  }
}
