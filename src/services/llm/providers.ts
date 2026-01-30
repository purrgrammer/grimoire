/**
 * LLM Provider Configurations
 *
 * Currently supported:
 * - WebLLM: Local browser-based inference via WebGPU
 * - PPQ.ai: OpenAI-compatible API with Lightning payments
 */

import type { LLMProviderConfig } from "@/types/llm";

export const PROVIDER_CONFIGS: LLMProviderConfig[] = [
  {
    id: "webllm",
    name: "WebLLM (Local)",
    type: "webllm",
    requiresApiKey: false,
    requiresBaseUrl: false,
    supportsBalance: false,
    isLocal: true,
  },
  {
    id: "ppq",
    name: "PPQ.ai",
    type: "openai-compatible",
    baseUrl: "https://api.ppq.ai",
    requiresApiKey: true,
    requiresBaseUrl: false,
    apiKeyUrl: "https://ppq.ai/api-docs",
    topUpUrl: "https://ppq.ai/api-topups",
    supportsBalance: false, // No API endpoint for balance currently
    isLocal: false,
  },
];

export function getProviderConfig(
  providerId: string,
): LLMProviderConfig | undefined {
  return PROVIDER_CONFIGS.find((p) => p.id === providerId);
}
