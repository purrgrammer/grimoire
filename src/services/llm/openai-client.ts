/**
 * OpenAI Client Factory
 *
 * Creates OpenAI SDK instances for any OpenAI-compatible provider.
 * Handles provider-specific quirks (headers, auth, etc.)
 */

import OpenAI from "openai";
import type { LLMProviderInstance } from "@/types/llm";
import { getProviderPreset } from "@/lib/ai-provider-presets";

/**
 * Create an OpenAI client for a provider instance.
 */
export function createOpenAIClient(provider: LLMProviderInstance): OpenAI {
  const preset = getProviderPreset(provider.providerId);
  const baseURL = provider.baseUrl || preset?.baseURL;

  if (!baseURL) {
    throw new Error(
      `No base URL configured for provider ${provider.providerId}`,
    );
  }

  return new OpenAI({
    baseURL,
    apiKey: provider.apiKey ?? "",
    dangerouslyAllowBrowser: true,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let request = new Request(input, init);

      // Add OpenRouter headers for proper attribution
      if (provider.providerId === "openrouter") {
        const headers = new Headers(request.headers);
        headers.set("HTTP-Referer", "https://grimoire.computer");
        headers.set("X-Title", "Grimoire");
        request = new Request(request, { headers });
      }

      return fetch(request);
    },
  });
}

/**
 * Format a model name for display.
 */
export function formatModelName(modelId: string): string {
  return (
    modelId
      // Remove common provider prefixes
      .replace(/^(openai\/|anthropic\/|google\/|meta-llama\/|mistralai\/)/, "")
      // Remove date suffixes
      .replace(/-\d{4}-\d{2}-\d{2}$/, "")
      // Clean up free model indicators
      .replace(/:free$/, " (Free)")
  );
}

/**
 * Parse error message from API response.
 */
export function parseAPIError(error: unknown): string {
  // Check for OpenAI API errors by duck typing
  if (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const apiError = error as { status: number; message?: string };
    // Handle specific OpenAI error codes
    switch (apiError.status) {
      case 401:
        return "Invalid API key. Please check your credentials.";
      case 402:
        return "Insufficient balance. Please top up your account.";
      case 403:
        return "Access denied. Your API key may have reached its limit.";
      case 404:
        return "Model not found. Please select a different model.";
      case 429:
        return "Rate limit exceeded. Please try again in a moment.";
      case 500:
      case 502:
      case 503:
        return "Provider service is temporarily unavailable.";
      default:
        return apiError.message || `API error: ${apiError.status}`;
    }
  }

  if (error instanceof Error) {
    if (error.message.includes("fetch")) {
      return "Network error. Please check your connection.";
    }
    return error.message;
  }

  return "An unknown error occurred";
}
