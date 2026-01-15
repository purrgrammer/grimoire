/**
 * Base provider adapter for LLM chat
 * All providers must implement this interface
 */

import type {
  LLMProvider,
  ProviderConfig,
  ModelInfo,
  LLMConfig,
  TokenUsage,
} from "@/types/llm";

export interface StreamChunk {
  text: string;
  done: boolean;
  error?: string;
  usage?: TokenUsage;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export abstract class LLMProviderAdapter {
  abstract readonly provider: LLMProvider;
  abstract readonly name: string;

  /**
   * Get available models for this provider
   */
  abstract getModels(config: ProviderConfig): Promise<ModelInfo[]>;

  /**
   * Test API connection and credentials
   */
  abstract testConnection(config: ProviderConfig): Promise<boolean>;

  /**
   * Stream completion from the provider
   */
  abstract streamCompletion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): AsyncGenerator<StreamChunk>;

  /**
   * Non-streaming completion (fallback)
   */
  abstract completion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): Promise<string>;

  /**
   * Calculate estimated cost for a message
   */
  calculateCost(
    model: ModelInfo,
    tokens: { prompt: number; completion: number },
  ): number {
    const promptCost = (tokens.prompt / 1000) * model.inputCostPer1k;
    const completionCost = (tokens.completion / 1000) * model.outputCostPer1k;
    return promptCost + completionCost;
  }
}
