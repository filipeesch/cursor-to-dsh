/**
 * The host `LlmAdapter` for the `cursor` route.
 *
 * `stream()` converts the request, runs one call on the session's Cursor agent and yields its
 * chunks. The model catalog is a snapshot the request path reads without blocking, and the policy
 * is read from the live configuration on every decision, so a saved setting applies to the next
 * call without remounting the plugin.
 */
import { LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";

import { PROVIDER_ID } from "./constants.ts";
import type { ModelCatalog } from "./cursor/catalog.ts";
import type { ContextTierStore } from "./cursor/context-tier.ts";
import { modelNames, resolveModelId, type CatalogModel } from "./model-catalog.ts";
import { reasoningInfo } from "./model-params.ts";
import { resolveContextWindow } from "./policy/context.ts";
import { isEnabled } from "./policy/model-config.ts";
import type { ModelPolicy } from "./policy/types.ts";
import type { Image } from "./prompt/content.ts";
import { ChunkQueue, Reply } from "./reply.ts";
import type { HandoffWindow } from "./session/handoff-window.ts";
import { sessionKeyFor, type SessionRegistry } from "./session/registry.ts";
import { runTurn } from "./session/turn.ts";
import type { CursorSession } from "./session/session.ts";
import type { TimingDeps } from "./session/timing.ts";
import type { StallInfo } from "./session/watchdog.ts";
import { imageRefs, readRequest } from "./transcript.ts";

/** Attachments are immutable, and every request carries the whole history: read each once. */
const IMAGE_CACHE_SIZE = 64;

export interface AdapterDeps {
  createAgent: (opts: any) => Promise<any>;
  resolveApiKey: () => Promise<string | undefined>;
  cwdFor: (sessionId: string | undefined) => string;
  /** Base64 bytes of one image attachment; undefined when no attachment service is mounted. */
  readImage?: (ref: any, signal?: AbortSignal) => Promise<Image | undefined>;
  catalog: ModelCatalog;
  tiers: ContextTierStore;
  registry: SessionRegistry;
  /** How long a tool-call delivery may hold, per model. */
  handoff: HandoffWindow;
  /** Per-step timing; disabled unless the operator enabled it. */
  timing: TimingDeps;
  /** Reads the model policy from the configuration as it currently stands. */
  readPolicy: () => ModelPolicy;
  /** Capacity published upstream for one model, when the fallback snapshot describes it. */
  publishedWindow: (modelId: string) => number | undefined;
  /** Provider inactivity window before a run is abandoned; 0 disables it. */
  stallTimeoutMs: number;
  onStall?: (session: CursorSession, info: StallInfo) => void;
}

export class CursorAdapter extends LlmAdapter {
  private readonly deps: AdapterDeps;
  private readonly images = new Map<string, Image>();

  constructor(deps: AdapterDeps) {
    super();
    this.deps = deps;
  }

  override providerInfo(provider: string): any {
    return { id: provider, name: "Cursor" };
  }

  override async listModels(provider: string): Promise<any[]> {
    this.deps.catalog.note();
    const policy = this.deps.readPolicy();
    const models = this.models();
    const names = modelNames(models);
    return models
      .filter((model) => isEnabled(policy, model.id))
      .map((model) => ({ provider, id: model.id, name: names.get(model.id), inputModalities: this.modalities() }));
  }

  override async resolveModel(provider: string, model: string): Promise<any> {
    const models = this.models();
    const entry = models.find((candidate) => candidate.id === model);
    const modelId = resolveModelId(model);
    const window = resolveContextWindow({
      modelId,
      model: entry,
      accepted: this.deps.tiers.get(modelId),
      policy: this.deps.readPolicy(),
      publishedWindow: this.deps.publishedWindow(modelId),
    });
    const info: any = {
      provider,
      id: model,
      name: modelNames(models).get(model) ?? model,
      inputModalities: this.modalities(),
      context: { contextWindow: window.tokens },
      systemPromptUpdate: "in-history",
    };
    const reasoning = reasoningInfo(entry);
    if (reasoning) info.reasoning = reasoning;
    return info;
  }

  override async *stream(options: any): AsyncIterable<any> {
    if (options?.stop?.length) throw new LlmError("Cursor does not support stop sequences", "UNSUPPORTED_OPTION");
    const [apiKey, images] = await Promise.all([this.deps.resolveApiKey(), this.loadImages(options)]);
    const model = this.models().find((candidate) => candidate.id === options.model);
    const transcript = readRequest(options, images);
    const sessionId = typeof options.sessionId === "string" ? options.sessionId : undefined;
    const queue = new ChunkQueue();
    void runTurn(
      {
        model: { id: options.model, cursorParameters: model?.parameters },
        transcript,
        reasoning: options.reasoningEffort,
        signal: options.signal,
        apiKey,
        sessionKey: sessionKeyFor(sessionId, transcript, options.purpose),
        cwd: this.deps.cwdFor(sessionId),
        reply: new Reply(queue),
      },
      {
        createAgent: this.deps.createAgent,
        registry: this.deps.registry,
        tiers: this.deps.tiers,
        handoff: this.deps.handoff,
        timing: this.deps.timing,
        readPolicy: this.deps.readPolicy,
        stallTimeoutMs: this.deps.stallTimeoutMs,
        onStall: this.deps.onStall,
      },
    );
    yield* queue;
  }

  /** The catalog as the request path may read it: a snapshot, never a fetch. */
  private models(): CatalogModel[] {
    this.deps.catalog.note();
    return this.deps.catalog.current();
  }

  private modalities(): string[] {
    return this.deps.readImage ? ["text", "image"] : ["text"];
  }

  private async loadImages(options: any): Promise<Map<string, Image>> {
    const out = new Map<string, Image>();
    const read = this.deps.readImage;
    if (!read) return out;
    await Promise.all(
      imageRefs(options).map(async (ref) => {
        const id = String(ref.attachmentId);
        let image = this.images.get(id);
        if (!image) {
          try {
            image = await read(ref, options.signal);
          } catch {
            /* an unreadable attachment becomes a text note downstream */
          }
          if (image) {
            this.images.set(id, image);
            if (this.images.size > IMAGE_CACHE_SIZE) this.images.delete(this.images.keys().next().value!);
          }
        }
        if (image) out.set(id, image);
      }),
    );
    return out;
  }
}

export { PROVIDER_ID };
