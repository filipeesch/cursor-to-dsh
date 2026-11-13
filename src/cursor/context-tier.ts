/**
 * The context tier Cursor actually accepted, per model.
 *
 * A rejected tier costs a full failed run, and the provider's catalog is the same on every start,
 * so the accepted value is remembered instead of rediscovered.
 */
import type { TierFile } from "./state.ts";

export class ContextTierStore {
  private readonly values: Record<string, string>;
  private readonly persist: ((tiers: Record<string, string>) => void) | undefined;

  constructor(values: Record<string, string> = {}, persist?: (tiers: Record<string, string>) => void) {
    this.values = ContextTierStore.sanitize(values);
    this.persist = persist;
  }

  static from(file: TierFile | undefined): Record<string, string> {
    return file && typeof file === "object" && file.tiers && typeof file.tiers === "object" ? (file.tiers as Record<string, string>) : {};
  }

  private static sanitize(values: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(values ?? {})) {
      if (typeof key === "string" && typeof value === "string" && key && value) out[key] = value;
    }
    return out;
  }

  get(modelId: string): string | undefined {
    return this.values[modelId];
  }

  set(modelId: string, value: string): void {
    if (!modelId || !value || this.values[modelId] === value) return;
    this.values[modelId] = value;
    this.persist?.({ ...this.values });
  }

  all(): Record<string, string> {
    return { ...this.values };
  }
}
