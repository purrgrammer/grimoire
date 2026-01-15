/**
 * OpenAI provider implementation
 */

import OpenAI from "openai";
import { LLMProviderAdapter } from "./base-provider";
import type { StreamChunk, ChatMessage } from "./base-provider";
import type { ProviderConfig, ModelInfo, LLMConfig } from "@/types/llm";

const OPENAI_MODELS: ModelInfo[] = [
  {
    id: "gpt-4-turbo-preview",
    name: "GPT-4 Turbo",
    provider: "openai",
    contextWindow: 128000,
    inputCostPer1k: 0.01,
    outputCostPer1k: 0.03,
    supportsVision: true,
    supportsFunctions: true,
    supportsStreaming: true,
  },
  {
    id: "gpt-4",
    name: "GPT-4",
    provider: "openai",
    contextWindow: 8192,
    inputCostPer1k: 0.03,
    outputCostPer1k: 0.06,
    supportsVision: false,
    supportsFunctions: true,
    supportsStreaming: true,
  },
  {
    id: "gpt-3.5-turbo",
    name: "GPT-3.5 Turbo",
    provider: "openai",
    contextWindow: 16385,
    inputCostPer1k: 0.0005,
    outputCostPer1k: 0.0015,
    supportsVision: false,
    supportsFunctions: true,
    supportsStreaming: true,
  },
];

export class OpenAIProvider extends LLMProviderAdapter {
  readonly provider = "openai" as const;
  readonly name = "OpenAI";

  async getModels(_config: ProviderConfig): Promise<ModelInfo[]> {
    // Static list is more reliable than dynamic fetching
    return OPENAI_MODELS;
  }

  async testConnection(config: ProviderConfig): Promise<boolean> {
    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        organization: config.organization,
        dangerouslyAllowBrowser: true, // We're in a browser context
      });

      // Simple test request - list models
      await client.models.list();
      return true;
    } catch (error) {
      console.error("OpenAI connection test failed:", error);
      return false;
    }
  }

  async *streamCompletion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): AsyncGenerator<StreamChunk> {
    const client = new OpenAI({
      apiKey: config.provider.apiKey,
      baseURL: config.provider.baseUrl,
      organization: config.provider.organization,
      dangerouslyAllowBrowser: true,
    });

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
        presence_penalty: config.presencePenalty,
        frequency_penalty: config.frequencyPenalty,
        stream: true,
        stream_options: {
          include_usage: true, // Get token usage in final chunk
        },
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Stream text content
        if (delta?.content) {
          yield {
            text: delta.content,
            done: false,
          };
        }

        // Final chunk includes usage
        if (chunk.usage) {
          yield {
            text: "",
            done: true,
            usage: {
              prompt: chunk.usage.prompt_tokens,
              completion: chunk.usage.completion_tokens,
              total: chunk.usage.total_tokens,
            },
          };
          return; // Exit after usage chunk
        }
      }

      // If we didn't get usage, send done without it
      yield { text: "", done: true };
    } catch (error) {
      yield {
        text: "",
        done: true,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async completion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: config.provider.apiKey,
      baseURL: config.provider.baseUrl,
      organization: config.provider.organization,
      dangerouslyAllowBrowser: true,
    });

    const response = await client.chat.completions.create({
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      top_p: config.topP,
      presence_penalty: config.presencePenalty,
      frequency_penalty: config.frequencyPenalty,
    });

    return response.choices[0]?.message?.content || "";
  }
}
