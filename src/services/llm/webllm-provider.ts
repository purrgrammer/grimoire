/**
 * WebLLM Provider
 *
 * Local browser-based LLM inference using WebGPU acceleration.
 * Uses web workers to keep UI responsive during model operations.
 */

import * as webllm from "@mlc-ai/web-llm";
import { BehaviorSubject } from "rxjs";
import type {
  LLMModel,
  LLMMessage,
  ChatStreamChunk,
  ChatOptions,
  LLMEngineStatus,
  DownloadProgress,
} from "@/types/llm";

// Curated list of recommended models for browser use
// These are known to work well with reasonable download sizes
const RECOMMENDED_MODEL_IDS = [
  "SmolLM2-360M-Instruct-q4f16_1-MLC",
  "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  "Phi-3.5-mini-instruct-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  "gemma-2-2b-it-q4f16_1-MLC",
];

class WebLLMProvider {
  private engine: webllm.MLCEngineInterface | null = null;
  private worker: Worker | null = null;
  private loadedModelId: string | null = null;

  // Reactive status
  status$ = new BehaviorSubject<LLMEngineStatus>({ state: "idle" });

  /**
   * Get list of available models from WebLLM's prebuilt config.
   * Filters to recommended models and marks which are downloaded.
   */
  async listModels(): Promise<LLMModel[]> {
    const prebuiltModels = webllm.prebuiltAppConfig.model_list;

    // Filter to recommended models
    const filteredModels = prebuiltModels.filter((m) =>
      RECOMMENDED_MODEL_IDS.includes(m.model_id),
    );

    // Check which models are downloaded
    const models: LLMModel[] = await Promise.all(
      filteredModels.map(async (m) => {
        const isDownloaded = await this.isModelDownloaded(m.model_id);
        return {
          id: m.model_id,
          name: this.formatModelName(m.model_id),
          providerId: "webllm",
          vramMB: m.vram_required_MB,
          downloadSize: this.formatSize(m.vram_required_MB),
          isDownloaded,
          description: this.getModelDescription(m.model_id),
        };
      }),
    );

    // Sort: downloaded first, then by name
    models.sort((a, b) => {
      if (a.isDownloaded && !b.isDownloaded) return -1;
      if (!a.isDownloaded && b.isDownloaded) return 1;
      return a.name.localeCompare(b.name);
    });

    return models;
  }

  /**
   * Download and load a model.
   */
  async loadModel(
    modelId: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    // Clean up previous engine
    await this.dispose();

    this.status$.next({
      state: "loading",
      progress: 0,
      text: "Initializing...",
    });

    // Create worker for non-blocking inference
    this.worker = new Worker(new URL("./webllm-worker.ts", import.meta.url), {
      type: "module",
    });

    try {
      this.engine = await webllm.CreateWebWorkerMLCEngine(
        this.worker,
        modelId,
        {
          initProgressCallback: (progress) => {
            const downloadProgress: DownloadProgress = {
              progress: progress.progress,
              text: progress.text,
            };
            onProgress?.(downloadProgress);
            this.status$.next({
              state: "loading",
              progress: progress.progress,
              text: progress.text,
            });
          },
        },
      );

      this.loadedModelId = modelId;
      this.status$.next({ state: "ready", modelId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load model";
      this.status$.next({ state: "error", error: message });
      throw error;
    }
  }

  /**
   * Chat with the loaded model (streaming).
   */
  async *chat(
    messages: LLMMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    if (!this.engine || !this.loadedModelId) {
      yield { type: "error", error: "No model loaded" };
      return;
    }

    const modelId = this.loadedModelId;
    this.status$.next({ state: "generating", modelId });

    try {
      const chatMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const stream = await this.engine.chat.completions.create({
        messages: chatMessages,
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
      });

      for await (const chunk of stream) {
        // Check for abort
        if (options.signal?.aborted) {
          this.engine.interruptGenerate();
          yield { type: "done" };
          break;
        }

        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield { type: "token", content };
        }
      }

      yield { type: "done" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Generation failed";
      yield { type: "error", error: message };
    } finally {
      if (this.loadedModelId) {
        this.status$.next({ state: "ready", modelId: this.loadedModelId });
      }
    }
  }

  /**
   * Check if a model is cached locally.
   */
  async isModelDownloaded(modelId: string): Promise<boolean> {
    try {
      return await webllm.hasModelInCache(modelId);
    } catch {
      return false;
    }
  }

  /**
   * Delete a model from cache.
   */
  async deleteModel(modelId: string): Promise<void> {
    await webllm.deleteModelAllInfoInCache(modelId);
  }

  /**
   * Get the currently loaded model ID.
   */
  getLoadedModelId(): string | null {
    return this.loadedModelId;
  }

  /**
   * Clean up resources.
   */
  async dispose(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        // Ignore unload errors
      }
      this.engine = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.loadedModelId = null;
    this.status$.next({ state: "idle" });
  }

  /**
   * Interrupt current generation.
   */
  interrupt(): void {
    this.engine?.interruptGenerate();
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private formatModelName(modelId: string): string {
    // Convert "Llama-3.2-3B-Instruct-q4f16_1-MLC" to "Llama 3.2 3B"
    return modelId
      .replace(/-MLC$/, "")
      .replace(/-q4f\d+_\d+/, "")
      .replace(/-Instruct/, "")
      .replace(/-/g, " ")
      .replace(/(\d)\.(\d)/g, "$1.$2");
  }

  private formatSize(vramMB?: number): string {
    if (!vramMB) return "Unknown";
    if (vramMB < 1024) return `~${vramMB}MB`;
    return `~${(vramMB / 1024).toFixed(1)}GB`;
  }

  private getModelDescription(modelId: string): string {
    if (modelId.includes("SmolLM2-360M"))
      return "Tiny and fast. Good for testing.";
    if (modelId.includes("SmolLM2-1.7B")) return "Small but capable.";
    if (modelId.includes("Llama-3.2-1B")) return "Meta's efficient 1B model.";
    if (modelId.includes("Llama-3.2-3B"))
      return "Best balance of quality and speed.";
    if (modelId.includes("Phi-3.5")) return "Microsoft's reasoning model.";
    if (modelId.includes("Qwen2.5-1.5B")) return "Alibaba's efficient model.";
    if (modelId.includes("Qwen2.5-3B")) return "Good at coding tasks.";
    if (modelId.includes("gemma-2-2b")) return "Google's compact model.";
    return "";
  }
}

// Singleton instance
export const webllmProvider = new WebLLMProvider();
