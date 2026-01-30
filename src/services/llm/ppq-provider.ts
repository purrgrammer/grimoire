/**
 * PPQ.ai Provider
 *
 * OpenAI-compatible API with Lightning payments.
 * https://ppq.ai/api-docs
 */

import type {
  LLMModel,
  LLMMessage,
  ChatStreamChunk,
  ChatOptions,
} from "@/types/llm";

const PPQ_BASE_URL = "https://api.ppq.ai";

export interface PPQProviderConfig {
  apiKey: string;
}

class PPQProvider {
  private apiKey: string | null = null;

  /**
   * Configure the provider with an API key.
   */
  configure(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Check if provider is configured.
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Clear configuration.
   */
  clear(): void {
    this.apiKey = null;
  }

  /**
   * Fetch available models from PPQ API.
   */
  async listModels(): Promise<LLMModel[]> {
    if (!this.apiKey) {
      throw new Error("PPQ API key not configured");
    }

    const response = await fetch(`${PPQ_BASE_URL}/v1/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json();

    // OpenAI format: { data: [{ id, ... }] }
    return data.data.map((m: any) => ({
      id: m.id,
      name: this.formatModelName(m.id),
      providerId: "ppq",
      contextLength: m.context_length || m.context_window,
      description: m.description,
      pricing: m.pricing
        ? {
            inputPerMillion: this.parsePricing(m.pricing.prompt),
            outputPerMillion: this.parsePricing(m.pricing.completion),
          }
        : undefined,
    }));
  }

  /**
   * Chat with a model (streaming).
   */
  async *chat(
    messages: LLMMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    if (!this.apiKey) {
      yield { type: "error", error: "PPQ API key not configured" };
      return;
    }

    const body = {
      model: options.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    };

    try {
      const response = await fetch(`${PPQ_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: "error",
          error: `API error: ${response.status} - ${errorText}`,
        };
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              yield { type: "done" };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield { type: "token", content };
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      yield { type: "done" };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        yield { type: "done" };
        return;
      }
      const message = error instanceof Error ? error.message : "Request failed";
      yield { type: "error", error: message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private formatModelName(modelId: string): string {
    // Clean up common model ID patterns
    return modelId
      .replace(/^(openai\/|anthropic\/|google\/|meta-llama\/|mistralai\/)/, "")
      .replace(/-\d{4}-\d{2}-\d{2}$/, "") // Remove date suffixes
      .replace(/:free$/, " (Free)");
  }

  private parsePricing(value: string | number | undefined): number | undefined {
    if (value === undefined) return undefined;
    const num = typeof value === "string" ? parseFloat(value) : value;
    // Convert from per-token to per-million
    return num * 1_000_000;
  }
}

// Singleton instance
export const ppqProvider = new PPQProvider();
