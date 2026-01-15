/**
 * Types for LLM chat functionality
 * Supports multiple providers (OpenAI, Anthropic, local models, etc.)
 */

export type LLMProvider = "openai" | "anthropic" | "ollama" | "custom";

export interface ProviderConfig {
  provider: LLMProvider;
  apiKey?: string; // Not needed for local models
  baseUrl?: string; // Custom endpoint (e.g., for proxies or local servers)
  organization?: string; // OpenAI organization ID
}

export interface ModelInfo {
  id: string; // e.g., "gpt-4-turbo-preview"
  name: string; // e.g., "GPT-4 Turbo"
  provider: LLMProvider;
  contextWindow: number; // e.g., 128000
  inputCostPer1k: number; // Cost per 1k input tokens in USD
  outputCostPer1k: number; // Cost per 1k output tokens in USD
  supportsVision: boolean;
  supportsFunctions: boolean;
  supportsStreaming: boolean;
}

export interface LLMConfig {
  provider: ProviderConfig;
  model: string; // Model ID
  systemPrompt?: string;
  temperature: number; // 0-2
  maxTokens: number;
  topP?: number; // For models that support it
  presencePenalty?: number; // OpenAI specific
  frequencyPenalty?: number; // OpenAI specific
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface LLMMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokens?: TokenUsage;
  cost?: number; // Estimated cost in USD
  model?: string; // Model used for this message
  provider?: LLMProvider; // Provider used
  streaming?: boolean; // Currently being streamed
  error?: string; // Error message if failed
}

export interface LLMConversation {
  id: string;
  title: string; // Auto-generated from first message
  messages: LLMMessage[];
  config: LLMConfig; // Current config
  createdAt: number;
  updatedAt: number;
  totalTokens: TokenUsage;
  totalCost: number; // Running total in USD
}

export interface LLMCommandResult {
  conversationId?: string;
  provider?: LLMProvider;
  model?: string;
}
