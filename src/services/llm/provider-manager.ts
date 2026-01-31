/**
 * AI Provider Manager
 *
 * Manages provider instances, model fetching, and chat functionality.
 * All providers use OpenAI-compatible APIs.
 */

import { BehaviorSubject } from "rxjs";
import OpenAI from "openai";
import db from "@/services/db";
import type {
  LLMProviderInstance,
  LLMModel,
  LLMMessage,
  ChatStreamChunk,
  ChatOptions,
} from "@/types/llm";
import { createOpenAIClient, formatModelName } from "./openai-client";
import {
  parseError,
  calculateBackoff,
  sleep,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from "./error-handling";
import { AI_PROVIDER_PRESETS } from "@/lib/ai-provider-presets";

const MODEL_CACHE_TTL = 1000 * 60 * 5; // 5 minutes

class AIProviderManager {
  // Reactive state
  instances$ = new BehaviorSubject<LLMProviderInstance[]>([]);
  activeInstanceId$ = new BehaviorSubject<string | null>(null);
  recentModels$ = new BehaviorSubject<string[]>([]); // "providerId/modelId" format

  // Model cache (instance ID → models)
  private modelCache = new Map<
    string,
    { models: LLMModel[]; cachedAt: number }
  >();

  // OpenAI clients (instance ID → client)
  private clients = new Map<string, OpenAI>();

  /**
   * Initialize the manager - load saved instances from Dexie.
   */
  async initialize(): Promise<void> {
    const instances = await db.llmProviders.toArray();
    this.instances$.next(instances);

    // Load recent models from localStorage
    try {
      const saved = localStorage.getItem("ai-recent-models");
      if (saved) {
        this.recentModels$.next(JSON.parse(saved));
      }
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Get provider presets (static list of available providers).
   */
  getProviderPresets() {
    return AI_PROVIDER_PRESETS;
  }

  /**
   * Add or update a provider instance.
   */
  async saveProviderInstance(instance: LLMProviderInstance): Promise<void> {
    await db.llmProviders.put(instance);
    const instances = await db.llmProviders.toArray();
    this.instances$.next(instances);

    // Clear cached client when updating
    this.clients.delete(instance.id);
  }

  /**
   * Remove a provider instance.
   */
  async removeProviderInstance(instanceId: string): Promise<void> {
    await db.llmProviders.delete(instanceId);
    this.modelCache.delete(instanceId);
    this.clients.delete(instanceId);

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
   * Get or create an OpenAI client for an instance.
   */
  private getClient(instance: LLMProviderInstance): OpenAI {
    let client = this.clients.get(instance.id);
    if (!client) {
      client = createOpenAIClient(instance);
      this.clients.set(instance.id, client);
    }
    return client;
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

    try {
      const client = this.getClient(instance);

      // Fetch models from /v1/models endpoint
      const response = await client.models.list({
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      // Transform to our format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const models: LLMModel[] = (response.data as any[])
        .filter((m: Record<string, unknown>) => {
          // Filter to chat models if type is available
          if ("type" in m && m.type !== undefined) {
            return m.type === "chat";
          }
          return true;
        })
        .map((m: Record<string, unknown>) => {
          const modelId = m.id as string;
          const model: LLMModel = {
            id: modelId,
            name:
              "name" in m && typeof m.name === "string"
                ? m.name
                : formatModelName(modelId),
            providerId: instance.providerId,
            description:
              "description" in m && typeof m.description === "string"
                ? m.description
                : undefined,
            contextLength:
              "context_length" in m && typeof m.context_length === "number"
                ? m.context_length
                : undefined,
          };

          // Extract pricing if available
          if ("pricing" in m && m.pricing && typeof m.pricing === "object") {
            const pricing = m.pricing as Record<string, unknown>;
            if ("prompt" in pricing && "completion" in pricing) {
              const prompt = parseFloat(String(pricing.prompt));
              const completion = parseFloat(String(pricing.completion));
              if (!isNaN(prompt) && !isNaN(completion)) {
                model.pricing = {
                  inputPerMillion: prompt * 1_000_000,
                  outputPerMillion: completion * 1_000_000,
                };
              }
            }
          }

          return model;
        });

      // Update cache
      this.modelCache.set(instanceId, { models, cachedAt: Date.now() });

      return models;
    } catch (error) {
      console.warn("Failed to fetch models:", error);

      // Return cached models if available, even if stale
      if (cached) {
        return cached.models;
      }

      throw error;
    }
  }

  /**
   * Add a model to recent models list.
   */
  addRecentModel(providerId: string, modelId: string): void {
    const fullId = `${providerId}/${modelId}`;
    const current = this.recentModels$.value;

    // Remove if already exists, then add to front
    const filtered = current.filter((m) => m !== fullId);
    const updated = [fullId, ...filtered].slice(0, 10);

    this.recentModels$.next(updated);

    // Persist to localStorage
    try {
      localStorage.setItem("ai-recent-models", JSON.stringify(updated));
    } catch {
      // Ignore quota errors
    }
  }

  /**
   * Chat with a model (streaming).
   * Includes automatic retry logic for transient errors.
   */
  async *chat(
    instanceId: string,
    modelId: string,
    messages: LLMMessage[],
    options: Omit<ChatOptions, "model"> & { retryConfig?: RetryConfig },
  ): AsyncGenerator<ChatStreamChunk> {
    const instance = await db.llmProviders.get(instanceId);
    if (!instance) {
      yield { type: "error", error: "Provider instance not found" };
      return;
    }

    if (!instance.apiKey) {
      yield { type: "error", error: "API key not configured" };
      return;
    }

    const retryConfig = options.retryConfig ?? DEFAULT_RETRY_CONFIG;
    const maxAttempts = retryConfig.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Yield all chunks from the stream attempt
        const streamResult = yield* this.streamChat(
          instance,
          modelId,
          messages,
          options,
        );

        // If we got here successfully, update usage tracking and return
        if (streamResult.success) {
          await db.llmProviders.update(instanceId, {
            lastUsed: Date.now(),
            lastModelId: modelId,
          });
          this.addRecentModel(instance.providerId, modelId);
          return;
        }
      } catch (error) {
        // Handle abort - don't retry
        if (error instanceof DOMException && error.name === "AbortError") {
          yield { type: "done" };
          return;
        }

        // Parse the error
        const llmError = parseError(error);

        // If not retryable or last attempt, yield error and stop
        if (!llmError.retryable || attempt >= maxAttempts - 1) {
          yield {
            type: "error",
            error: llmError.message,
            retry: {
              attempt: attempt + 1,
              maxAttempts,
              delayMs: 0,
              retryable: false,
            },
          };
          return;
        }

        // Calculate backoff delay
        const delayMs = calculateBackoff(
          attempt,
          llmError.retryAfter,
          retryConfig,
        );

        // Yield retry event so UI can show progress
        yield {
          type: "retry",
          error: llmError.message,
          retry: {
            attempt: attempt + 1,
            maxAttempts,
            delayMs,
            retryable: true,
          },
        };

        // Wait before retrying (respects abort signal)
        try {
          await sleep(delayMs, options.signal);
        } catch {
          // Aborted during wait
          yield { type: "done" };
          return;
        }
      }
    }
  }

  /**
   * Internal: Stream a single chat completion attempt.
   * Returns a result indicating success/failure.
   */
  private async *streamChat(
    instance: LLMProviderInstance,
    modelId: string,
    messages: LLMMessage[],
    options: Omit<ChatOptions, "model">,
  ): AsyncGenerator<ChatStreamChunk, { success: boolean }> {
    const client = this.getClient(instance);

    // Format messages for OpenAI API
    const formattedMessages = this.formatMessages(messages);

    // Build request params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model: modelId,
      messages: formattedMessages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      params.tools = options.tools;
      if (options.tool_choice) {
        params.tool_choice = options.tool_choice;
      }
    }

    const stream = (await client.chat.completions.create(params, {
      signal: options.signal,
    })) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    let usage: ChatStreamChunk["usage"] | undefined;
    let finishReason: ChatStreamChunk["finish_reason"] = null;
    let actualModel: string | undefined;
    let cost: number | undefined;

    for await (const chunk of stream) {
      // Capture model from first chunk that has it (actual model may differ from requested)
      if (chunk.model && !actualModel) {
        actualModel = chunk.model;
      }

      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Regular content
      if (delta?.content) {
        yield { type: "token", content: delta.content };
      }

      // Extended thinking / reasoning (multiple formats across providers)
      // - Claude/DeepSeek: delta.reasoning_content
      // - OpenAI/OpenRouter: delta.reasoning
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deltaAny = delta as any;
      const reasoning = deltaAny?.reasoning_content || deltaAny?.reasoning;
      if (reasoning) {
        yield { type: "reasoning", content: reasoning };
      }

      // Tool calls (streamed incrementally)
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: "tool_call",
            tool_call: {
              index: tc.index,
              id: tc.id,
              type: tc.type,
              function: tc.function
                ? {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                  }
                : undefined,
            },
          };
        }
      }

      // Capture finish reason
      if (choice.finish_reason) {
        finishReason = choice.finish_reason as ChatStreamChunk["finish_reason"];
      }

      // Capture usage and cost from final chunk
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
        };

        // Extract cost from API response (OpenRouter/PPQ provide this)
        // Prefer upstream_inference_cost (actual cost for BYOK) over cost (which is 0 for BYOK)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usageAny = chunk.usage as any;
        if (usageAny.cost_details?.upstream_inference_cost !== undefined) {
          cost = usageAny.cost_details.upstream_inference_cost;
        } else if (typeof usageAny.cost === "number" && usageAny.cost > 0) {
          cost = usageAny.cost;
        }
      }
    }

    yield {
      type: "done",
      usage,
      finish_reason: finishReason,
      model: actualModel,
      cost,
    };
    return { success: true };
  }

  /**
   * Format LLMMessage array for OpenAI API.
   * Handles tool messages and multimodal content.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatMessages(messages: LLMMessage[]): any[] {
    return messages.map((m) => {
      if (m.role === "tool") {
        // Tool response message
        return {
          role: "tool",
          content: m.content,
          tool_call_id: m.tool_call_id,
        };
      }

      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        // Assistant message with tool calls
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }

      // Standard message (handles string content and array content)
      return {
        role: m.role,
        content: m.content,
      };
    });
  }

  /**
   * Test connection to a provider.
   */
  async testConnection(
    instance: LLMProviderInstance,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const client = createOpenAIClient(instance);
      await client.models.list({ signal: AbortSignal.timeout(5000) });
      return { success: true };
    } catch (error) {
      const llmError = parseError(error);
      return { success: false, error: llmError.message };
    }
  }
}

// Singleton instance
export const providerManager = new AIProviderManager();

// Initialize on import
providerManager.initialize().catch(console.error);
