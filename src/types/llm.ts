/**
 * Types for Local LLM / AI Chat functionality
 */

// ─────────────────────────────────────────────────────────────
// Provider Configuration
// ─────────────────────────────────────────────────────────────

export type LLMProviderType = "webllm" | "openai-compatible";

export interface LLMProviderConfig {
  id: string; // "webllm", "ppq"
  name: string; // "WebLLM (Local)", "PPQ.ai"
  type: LLMProviderType;

  // Connection requirements
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;

  // URLs for user
  apiKeyUrl?: string; // Where to get API key
  topUpUrl?: string; // Where to add credits

  // For openai-compatible providers
  baseUrl?: string;

  // Capabilities
  supportsBalance: boolean;
  isLocal: boolean;
}

// ─────────────────────────────────────────────────────────────
// User's configured provider instance
// ─────────────────────────────────────────────────────────────

export interface LLMProviderInstance {
  id: string; // User-defined ID
  providerId: string; // References LLMProviderConfig.id
  name: string; // User-friendly name

  // Credentials
  apiKey?: string;
  baseUrl?: string;

  // State
  enabled: boolean;
  lastUsed?: number;
  lastModelId?: string; // Last model used with this provider

  // Cached model list
  cachedModels?: LLMModel[];
  modelsCachedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────

export interface LLMModel {
  id: string; // Model identifier
  name: string; // Display name
  providerId: string; // Which provider config this belongs to

  // Sizing
  contextLength?: number;

  // For display
  description?: string;
  tags?: string[]; // ["fast", "coding", "vision"]

  // For WebLLM
  vramMB?: number;
  downloadSize?: string;
  isDownloaded?: boolean;

  // For paid providers
  pricing?: {
    inputPerMillion?: number;
    outputPerMillion?: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Messages and Conversations
// ─────────────────────────────────────────────────────────────

export interface LLMMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface LLMConversation {
  id: string;
  title: string;

  // Provider + model at time of creation
  providerInstanceId: string;
  modelId: string;

  // Content
  systemPrompt?: string;
  messages: LLMMessage[];

  // Metadata
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// Engine Status
// ─────────────────────────────────────────────────────────────

export type LLMEngineStatus =
  | { state: "idle" }
  | { state: "loading"; progress: number; text: string }
  | { state: "ready"; modelId: string }
  | { state: "generating"; modelId: string }
  | { state: "error"; error: string };

// ─────────────────────────────────────────────────────────────
// Provider Interface
// ─────────────────────────────────────────────────────────────

export interface ChatStreamChunk {
  type: "token" | "done" | "error";
  content?: string;
  error?: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderBalance {
  available: number;
  currency: string;
  formatted: string;
}

export interface DownloadProgress {
  progress: number; // 0-1
  text: string;
}
