/**
 * LLM Provider Manager
 * Handles provider selection, configuration, and API key storage
 */

import type { LLMProviderAdapter, LLMProvider } from "./types";
import { MockProviderAdapter, mockProvider } from "./providers/mock-provider";
import { PPQProviderAdapter, ppqProvider } from "./providers/ppq-provider";

/**
 * Provider configuration stored in localStorage
 */
export interface ProviderConfig {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Storage key for provider config
 */
const STORAGE_KEY = "llm-provider-config";

/**
 * Get all available providers
 */
export function getAvailableProviders(): LLMProvider[] {
  return [mockProvider, ppqProvider];
}

/**
 * Get provider by ID
 */
export function getProviderById(id: string): LLMProvider | undefined {
  return getAvailableProviders().find((p) => p.id === id);
}

/**
 * Load provider configuration from localStorage
 */
export function loadProviderConfig(): ProviderConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to load provider config:", e);
  }

  // Default to PPQ with Claude 3.7 Sonnet (recommended)
  return {
    providerId: "ppq",
    apiKey: "",
  };
}

/**
 * Save provider configuration to localStorage
 */
export function saveProviderConfig(config: ProviderConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Failed to save provider config:", e);
  }
}

/**
 * Create provider adapter from configuration
 */
export function createProviderAdapter(
  config: ProviderConfig,
): LLMProviderAdapter {
  switch (config.providerId) {
    case "ppq":
      if (!config.apiKey) {
        throw new Error("PPQ provider requires an API key");
      }
      return new PPQProviderAdapter(config.apiKey, config.baseUrl);

    case "mock":
      return new MockProviderAdapter();

    default:
      throw new Error(`Unknown provider: ${config.providerId}`);
  }
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(providerId: string): string {
  switch (providerId) {
    case "ppq":
      // Use Claude 3.7 Sonnet as recommended by PPQ
      return "claude-3-7-sonnet";
    case "mock":
      return "mock-fast";
    default:
      return "";
  }
}
