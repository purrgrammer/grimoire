/**
 * Types for AI Chat functionality
 *
 * All providers use OpenAI-compatible APIs.
 */

// ─────────────────────────────────────────────────────────────
// Provider Configuration
// ─────────────────────────────────────────────────────────────

/**
 * User's configured provider instance stored in IndexedDB.
 */
export interface AIProvider {
  id: string; // UUID
  presetId: string; // References preset (ppq, openrouter, openai, custom)
  name: string; // User-friendly name
  baseURL: string; // API base URL
  apiKey?: string; // API key (optional for some providers)
  enabled: boolean;
  createdAt: number;
  lastUsed?: number;
}

// ─────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────

export interface AIModel {
  id: string; // Model ID from API
  name: string; // Display name
  description?: string;
  contextLength?: number;
  pricing?: {
    promptPerMillion: number; // USD per million tokens
    completionPerMillion: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Messages and Conversations
// ─────────────────────────────────────────────────────────────

export interface AIMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface AIConversation {
  id: string;
  title: string;
  providerId: string; // References AIProvider.id
  modelId: string; // Model ID used
  systemPrompt?: string;
  messages: AIMessage[];
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// AI Settings (persisted globally)
// ─────────────────────────────────────────────────────────────

export interface AISettings {
  activeProviderId: string | null;
  activeModelId: string | null; // Format: modelId (within active provider)
  recentModels: string[]; // Format: "providerId/modelId" (last 10)
}

// ─────────────────────────────────────────────────────────────
// Chat Types
// ─────────────────────────────────────────────────────────────

export interface ChatStreamChunk {
  type: "token" | "done" | "error";
  content?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────
// Session State (for ChatSessionManager)
// ─────────────────────────────────────────────────────────────

/**
 * Transient state for an active chat session.
 * Multiple windows can view the same conversation and share this state.
 * Messages are stored in Dexie; this tracks streaming/loading state.
 */
export interface ChatSessionState {
  conversationId: string;
  providerInstanceId: string;
  modelId: string;

  // Streaming state (shared across all windows viewing this conversation)
  isLoading: boolean;
  streamingContent: string;
  abortController?: AbortController;

  // Usage from last completion
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };

  // Cost tracking (USD)
  sessionCost: number;

  // For resume functionality
  finishReason?: "stop" | "length" | "error" | null;
  lastError?: string;

  // Reference counting - how many windows have this session open
  subscriberCount: number;

  // Timing
  lastActivity: number;
}

/**
 * Event emitted during streaming updates.
 */
export interface StreamingUpdateEvent {
  conversationId: string;
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Event emitted when a message is added to a conversation.
 */
export interface MessageAddedEvent {
  conversationId: string;
  message: LLMMessage;
}

/**
 * Event emitted when session loading state changes.
 */
export interface LoadingChangedEvent {
  conversationId: string;
  isLoading: boolean;
}

/**
 * Event emitted on session error.
 */
export interface SessionErrorEvent {
  conversationId: string;
  error: string;
}

// ─────────────────────────────────────────────────────────────
// Legacy types (for DB migration compatibility)
// ─────────────────────────────────────────────────────────────

// Keep these for backwards compatibility with existing DB schema
export interface LLMProviderInstance {
  id: string;
  providerId: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
  lastUsed?: number;
  lastModelId?: string;
  cachedModels?: LLMModel[];
  modelsCachedAt?: number;
}

export interface LLMModel {
  id: string;
  name: string;
  providerId: string;
  contextLength?: number;
  description?: string;
  tags?: string[];
  vramMB?: number;
  downloadSize?: string;
  isDownloaded?: boolean;
  pricing?: {
    inputPerMillion?: number;
    outputPerMillion?: number;
  };
}

export interface LLMMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface LLMConversation {
  id: string;
  title: string;
  providerInstanceId: string;
  modelId: string;
  systemPrompt?: string;
  messages: LLMMessage[];
  createdAt: number;
  updatedAt: number;
}

export type LLMEngineStatus =
  | { state: "idle" }
  | { state: "loading"; progress: number; text: string }
  | { state: "ready"; modelId: string }
  | { state: "generating"; modelId: string }
  | { state: "error"; error: string };
