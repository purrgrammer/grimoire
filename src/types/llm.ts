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
  type: "token" | "reasoning" | "tool_call" | "done" | "error" | "retry";
  content?: string;
  /** Streaming tool call delta */
  tool_call?: StreamingToolCall;
  /** Finish reason from the API */
  finish_reason?: "stop" | "length" | "tool_calls" | null;
  error?: string;
  /** Actual model that generated the response (may differ from requested) */
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** Cost from API response (USD) - preferred over calculated cost */
  cost?: number;
  /** Retry information for error recovery */
  retry?: {
    /** Current attempt number (1-based) */
    attempt: number;
    /** Maximum attempts allowed */
    maxAttempts: number;
    /** Delay before next retry (ms) */
    delayMs: number;
    /** Whether this error is retryable */
    retryable: boolean;
  };
}

/**
 * Tool definition for function calling.
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>; // JSON Schema
  };
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } };
  signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────
// Session State (for ChatSessionManager)
// ─────────────────────────────────────────────────────────────

/**
 * Streaming message state during generation.
 */
export interface StreamingMessage {
  content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
}

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
  streamingMessage?: StreamingMessage;
  abortController?: AbortController;

  // Usage from last completion
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };

  // Cost tracking (USD)
  sessionCost: number;

  // For resume functionality
  finishReason?: "stop" | "length" | "tool_calls" | "error" | null;
  lastError?: string;

  // Retry state for transient errors
  retryState?: {
    /** Current retry attempt (1-based) */
    attempt: number;
    /** Maximum attempts allowed */
    maxAttempts: number;
    /** Whether currently waiting before retry */
    isRetrying: boolean;
    /** Time remaining until next retry (ms) */
    retryDelayMs: number;
  };

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

// ─────────────────────────────────────────────────────────────
// Message Content Types (OpenAI-compatible)
// ─────────────────────────────────────────────────────────────

/**
 * Text content part for multimodal messages.
 */
export interface TextContentPart {
  type: "text";
  text: string;
}

/**
 * Image content part for multimodal messages.
 * Supports both URLs and base64 data URIs.
 */
export interface ImageContentPart {
  type: "image_url";
  image_url: {
    url: string; // URL or data:image/...;base64,...
    detail?: "auto" | "low" | "high";
  };
}

/**
 * Content can be a simple string or an array of content parts (for multimodal).
 */
export type MessageContent = string | (TextContentPart | ImageContentPart)[];

// ─────────────────────────────────────────────────────────────
// Tool Call Types (OpenAI-compatible)
// ─────────────────────────────────────────────────────────────

/**
 * A tool call made by the assistant.
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Streaming tool call (may have partial data).
 */
export interface StreamingToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

// ─────────────────────────────────────────────────────────────
// Message Types (OpenAI-compatible with extensions)
// ─────────────────────────────────────────────────────────────

/**
 * Base message fields shared by all message types.
 */
interface BaseMessage {
  id: string;
  timestamp: number;
}

/**
 * System message - sets context for the conversation.
 */
export interface SystemMessage extends BaseMessage {
  role: "system";
  content: string;
}

/**
 * User message - can include text and/or images.
 */
export interface UserMessage extends BaseMessage {
  role: "user";
  content: MessageContent;
}

/**
 * Assistant message - can include text, reasoning, and tool calls.
 */
export interface AssistantMessage extends BaseMessage {
  role: "assistant";
  content: string;
  /** Extended thinking / reasoning (Claude, DeepSeek, etc.) */
  reasoning_content?: string;
  /** Tool calls requested by the assistant */
  tool_calls?: ToolCall[];

  // ─── Local-only fields (not sent to API) ───
  /** Model that generated this response (may differ from requested due to routing) */
  model?: string;
  /** Token usage for this message */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** Cost in USD for this message */
  cost?: number;
}

/**
 * Tool result message - response to a tool call.
 */
export interface ToolMessage extends BaseMessage {
  role: "tool";
  content: string;
  /** ID of the tool call this responds to */
  tool_call_id: string;
}

/**
 * Union type for all message types.
 */
export type LLMMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

/**
 * Helper to get text content from a message (handles multimodal).
 */
export function getMessageTextContent(message: LLMMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  // For array content, concatenate all text parts
  return message.content
    .filter((part): part is TextContentPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/**
 * Helper to check if a message has tool calls.
 */
export function hasToolCalls(message: LLMMessage): message is AssistantMessage {
  return (
    message.role === "assistant" &&
    "tool_calls" in message &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  );
}

/**
 * Helper to check if a message is a tool result.
 */
export function isToolMessage(message: LLMMessage): message is ToolMessage {
  return message.role === "tool";
}

export interface LLMConversation {
  id: string;
  title: string;
  providerInstanceId: string;
  modelId: string;
  systemPrompt?: string;
  systemPromptId?: string; // Reference to the prompt used (for UI display)
  messages: LLMMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * User-created or built-in system prompt.
 */
export interface LLMSystemPrompt {
  id: string;
  name: string;
  content: string;
  description?: string;
  isBuiltin: boolean; // true for "Grimoire" prompt
  createdAt: number;
  updatedAt: number;
}

export type LLMEngineStatus =
  | { state: "idle" }
  | { state: "loading"; progress: number; text: string }
  | { state: "ready"; modelId: string }
  | { state: "generating"; modelId: string }
  | { state: "error"; error: string };
