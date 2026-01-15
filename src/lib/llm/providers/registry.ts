/**
 * Provider registry for LLM chat
 * Manages available providers and retrieves them by type
 */

import { OpenAIProvider } from "./openai-provider";
import { LLMProviderAdapter } from "./base-provider";
import type { LLMProvider } from "@/types/llm";

const providers = new Map<LLMProvider, LLMProviderAdapter>([
  ["openai", new OpenAIProvider()],
  // Add more providers as they're implemented:
  // ["anthropic", new AnthropicProvider()],
  // ["ollama", new OllamaProvider()],
]);

export function getProvider(type: LLMProvider): LLMProviderAdapter {
  const provider = providers.get(type);
  if (!provider) {
    throw new Error(`Provider not found: ${type}`);
  }
  return provider;
}

export function getAllProviders(): LLMProviderAdapter[] {
  return Array.from(providers.values());
}
