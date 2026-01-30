/**
 * LLM Provider Manager
 *
 * Manages provider instances, model caching, and coordinates between
 * WebLLM (local) and PPQ (remote) providers.
 */

import { BehaviorSubject } from "rxjs";
import db from "@/services/db";
import type {
  LLMProviderInstance,
  LLMModel,
  LLMMessage,
  ChatStreamChunk,
  ChatOptions,
  DownloadProgress,
} from "@/types/llm";
import { PROVIDER_CONFIGS } from "./providers";
import { webllmProvider } from "./webllm-provider";
import { ppqProvider } from "./ppq-provider";

const MODEL_CACHE_TTL = 1000 * 60 * 60; // 1 hour

class LLMProviderManager {
  // Reactive state
  instances$ = new BehaviorSubject<LLMProviderInstance[]>([]);
  activeInstanceId$ = new BehaviorSubject<string | null>(null);

  // Model cache (instance ID → models)
  private modelCache = new Map<
    string,
    { models: LLMModel[]; cachedAt: number }
  >();

  /**
   * Initialize the manager - load saved instances from Dexie.
   */
  async initialize(): Promise<void> {
    const instances = await db.llmProviders.toArray();
    this.instances$.next(instances);

    // Configure PPQ provider if there's a saved instance with API key
    const ppqInstance = instances.find(
      (i) => i.providerId === "ppq" && i.apiKey,
    );
    if (ppqInstance?.apiKey) {
      ppqProvider.configure(ppqInstance.apiKey);
    }
  }

  /**
   * Get provider configs (static list of available providers).
   */
  getProviderConfigs() {
    return PROVIDER_CONFIGS;
  }

  /**
   * Add or update a provider instance.
   */
  async saveProviderInstance(instance: LLMProviderInstance): Promise<void> {
    await db.llmProviders.put(instance);
    const instances = await db.llmProviders.toArray();
    this.instances$.next(instances);

    // Configure PPQ if this is a PPQ instance with API key
    if (instance.providerId === "ppq" && instance.apiKey) {
      ppqProvider.configure(instance.apiKey);
    }
  }

  /**
   * Remove a provider instance.
   */
  async removeProviderInstance(instanceId: string): Promise<void> {
    const instance = await db.llmProviders.get(instanceId);
    if (instance?.providerId === "ppq") {
      ppqProvider.clear();
    }

    await db.llmProviders.delete(instanceId);
    this.modelCache.delete(instanceId);

    const instances = await db.llmProviders.toArray();
    this.instances$.next(instances);

    // Clear active if it was deleted
    if (this.activeInstanceId$.value === instanceId) {
      this.activeInstanceId$.next(null);
    }
  }

  /**
   * Get a provider instance by ID.
   */
  async getProviderInstance(
    instanceId: string,
  ): Promise<LLMProviderInstance | undefined> {
    return db.llmProviders.get(instanceId);
  }

  /**
   * Set the active provider instance.
   */
  setActiveInstance(instanceId: string | null): void {
    this.activeInstanceId$.next(instanceId);
  }

  /**
   * List models for a provider instance (with caching).
   */
  async listModels(
    instanceId: string,
    forceRefresh = false,
  ): Promise<LLMModel[]> {
    const instance = await db.llmProviders.get(instanceId);
    if (!instance) {
      throw new Error(`Provider instance ${instanceId} not found`);
    }

    // Check cache
    const cached = this.modelCache.get(instanceId);
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.cachedAt < MODEL_CACHE_TTL
    ) {
      return cached.models;
    }

    // Fetch models based on provider type
    let models: LLMModel[];

    if (instance.providerId === "webllm") {
      models = await webllmProvider.listModels();
    } else if (instance.providerId === "ppq") {
      if (!instance.apiKey) {
        throw new Error("PPQ API key not configured");
      }
      ppqProvider.configure(instance.apiKey);
      models = await ppqProvider.listModels();
    } else {
      throw new Error(`Unknown provider: ${instance.providerId}`);
    }

    // Update cache
    this.modelCache.set(instanceId, { models, cachedAt: Date.now() });

    // Persist to instance
    await db.llmProviders.update(instanceId, {
      cachedModels: models,
      modelsCachedAt: Date.now(),
    });

    return models;
  }

  /**
   * Get WebLLM engine status.
   */
  getWebLLMStatus$() {
    return webllmProvider.status$;
  }

  /**
   * Load a WebLLM model.
   */
  async loadWebLLMModel(
    modelId: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    return webllmProvider.loadModel(modelId, onProgress);
  }

  /**
   * Delete a WebLLM model from cache.
   */
  async deleteWebLLMModel(modelId: string): Promise<void> {
    return webllmProvider.deleteModel(modelId);
  }

  /**
   * Get the currently loaded WebLLM model ID.
   */
  getLoadedWebLLMModelId(): string | null {
    return webllmProvider.getLoadedModelId();
  }

  /**
   * Chat with a model.
   */
  async *chat(
    instanceId: string,
    modelId: string,
    messages: LLMMessage[],
    options: Omit<ChatOptions, "model">,
  ): AsyncGenerator<ChatStreamChunk> {
    const instance = await db.llmProviders.get(instanceId);
    if (!instance) {
      yield { type: "error", error: "Provider instance not found" };
      return;
    }

    const chatOptions: ChatOptions = { ...options, model: modelId };

    if (instance.providerId === "webllm") {
      yield* webllmProvider.chat(messages, chatOptions);
    } else if (instance.providerId === "ppq") {
      if (!instance.apiKey) {
        yield { type: "error", error: "PPQ API key not configured" };
        return;
      }
      ppqProvider.configure(instance.apiKey);
      yield* ppqProvider.chat(messages, chatOptions);
    } else {
      yield {
        type: "error",
        error: `Unknown provider: ${instance.providerId}`,
      };
    }

    // Update lastUsed and lastModelId
    await db.llmProviders.update(instanceId, {
      lastUsed: Date.now(),
      lastModelId: modelId,
    });
  }

  /**
   * Interrupt current WebLLM generation.
   */
  interruptWebLLM(): void {
    webllmProvider.interrupt();
  }

  /**
   * Clean up resources.
   */
  async dispose(): Promise<void> {
    await webllmProvider.dispose();
    ppqProvider.clear();
  }
}

// Singleton instance
export const providerManager = new LLMProviderManager();

// Initialize on import
providerManager.initialize().catch(console.error);
