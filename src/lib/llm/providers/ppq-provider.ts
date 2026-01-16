/**
 * PPQ (PayPerQ) Provider - OpenAI-compatible API
 * https://ppq.ai/api-docs
 */

import type {
  LLMProvider,
  LLMProviderAdapter,
  LLMMessage,
  LLMConversationSettings,
  LLMStreamChunk,
} from "../types";

/**
 * PPQ provider configuration
 */
export const ppqProvider: LLMProvider = {
  id: "ppq",
  name: "PPQ (PayPerQ)",
  requiresAuth: true,
  baseUrl: "https://api.ppq.ai",
  models: [
    // Claude models (recommended)
    {
      id: "claude-3-7-sonnet",
      name: "Claude 3.7 Sonnet (Recommended)",
      contextWindow: 200000,
      inputCostPer1k: 0.003,
      outputCostPer1k: 0.015,
      supportsStreaming: true,
    },
    {
      id: "claude-3-5-sonnet-20241022",
      name: "Claude 3.5 Sonnet (Latest)",
      contextWindow: 200000,
      inputCostPer1k: 0.003,
      outputCostPer1k: 0.015,
      supportsStreaming: true,
    },
    {
      id: "claude-3-5-sonnet-20240620",
      name: "Claude 3.5 Sonnet (June)",
      contextWindow: 200000,
      inputCostPer1k: 0.003,
      outputCostPer1k: 0.015,
      supportsStreaming: true,
    },
    {
      id: "claude-3-opus-20240229",
      name: "Claude 3 Opus",
      contextWindow: 200000,
      inputCostPer1k: 0.015,
      outputCostPer1k: 0.075,
      supportsStreaming: true,
    },
    {
      id: "claude-3-5-haiku-20241022",
      name: "Claude 3.5 Haiku",
      contextWindow: 200000,
      inputCostPer1k: 0.001,
      outputCostPer1k: 0.005,
      supportsStreaming: true,
    },
    // OpenAI models
    {
      id: "gpt-4o",
      name: "GPT-4o",
      contextWindow: 128000,
      inputCostPer1k: 0.0025,
      outputCostPer1k: 0.01,
      supportsStreaming: true,
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      contextWindow: 128000,
      inputCostPer1k: 0.00015,
      outputCostPer1k: 0.0006,
      supportsStreaming: true,
    },
    {
      id: "gpt-4-turbo",
      name: "GPT-4 Turbo",
      contextWindow: 128000,
      inputCostPer1k: 0.01,
      outputCostPer1k: 0.03,
      supportsStreaming: true,
    },
    // Gemini models
    {
      id: "gemini-2.0-flash-exp",
      name: "Gemini 2.0 Flash (Experimental)",
      contextWindow: 1000000,
      inputCostPer1k: 0.0,
      outputCostPer1k: 0.0,
      supportsStreaming: true,
    },
    {
      id: "gemini-1.5-pro-latest",
      name: "Gemini 1.5 Pro",
      contextWindow: 2000000,
      inputCostPer1k: 0.00125,
      outputCostPer1k: 0.005,
      supportsStreaming: true,
    },
    {
      id: "gemini-1.5-flash",
      name: "Gemini 1.5 Flash",
      contextWindow: 1000000,
      inputCostPer1k: 0.000075,
      outputCostPer1k: 0.0003,
      supportsStreaming: true,
    },
  ],
};

/**
 * PPQ provider adapter with real API integration
 */
export class PPQProviderAdapter implements LLMProviderAdapter {
  provider = ppqProvider;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || ppqProvider.baseUrl || "https://api.ppq.ai";
  }

  async sendMessage(
    messages: LLMMessage[],
    settings: LLMConversationSettings,
    onChunk?: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMMessage> {
    // Convert LLMMessage[] to OpenAI format
    const openaiMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const requestBody = {
      model: settings.model,
      messages: openaiMessages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: !!onChunk, // Enable streaming if callback provided
    };

    // Make request
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `PPQ API error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    // Handle streaming response
    if (onChunk && response.body) {
      return await this.handleStreamingResponse(
        response,
        settings.model,
        onChunk,
      );
    }

    // Handle non-streaming response
    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error("No response from PPQ API");
    }

    return {
      id: data.id || `msg-${Date.now()}`,
      role: "assistant",
      content: choice.message?.content || "",
      timestamp: Date.now() / 1000,
      model: settings.model,
      tokens: data.usage?.total_tokens,
      cost: this.calculateCost(
        data.usage?.prompt_tokens,
        data.usage?.completion_tokens,
        settings.model,
      ),
    };
  }

  private async handleStreamingResponse(
    response: Response,
    model: string,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMMessage> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim() !== "");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);

            // Check for [DONE] signal
            if (data === "[DONE]") {
              onChunk({
                content: "",
                done: true,
                tokens: totalTokens,
              });
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;

              if (delta?.content) {
                fullContent += delta.content;
                onChunk({
                  content: delta.content,
                  done: false,
                });
              }

              // Capture token usage if provided
              if (parsed.usage) {
                totalTokens = parsed.usage.total_tokens || 0;
                promptTokens = parsed.usage.prompt_tokens || 0;
                completionTokens = parsed.usage.completion_tokens || 0;
              }
            } catch (e) {
              console.warn("Failed to parse SSE data:", data, e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content: fullContent,
      timestamp: Date.now() / 1000,
      model,
      tokens: totalTokens || this.estimateTokens(fullContent),
      cost: this.calculateCost(promptTokens, completionTokens, model),
    };
  }

  async validateAuth(apiKey: string): Promise<boolean> {
    try {
      // Test API key by making a minimal request to models endpoint
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  private calculateCost(
    promptTokens?: number,
    completionTokens?: number,
    model?: string,
  ): number {
    if (!promptTokens || !completionTokens || !model) return 0;

    const modelInfo = this.provider.models.find((m) => m.id === model);
    if (!modelInfo) return 0;

    const inputCost = (promptTokens / 1000) * (modelInfo.inputCostPer1k || 0);
    const outputCost =
      (completionTokens / 1000) * (modelInfo.outputCostPer1k || 0);

    return inputCost + outputCost;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}
