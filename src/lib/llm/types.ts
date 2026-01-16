/**
 * LLM chat types - Provider-agnostic abstractions for AI chat
 */

/**
 * LLM message role
 */
export type LLMRole = "user" | "assistant" | "system";

/**
 * LLM message
 */
export interface LLMMessage {
  id: string;
  role: LLMRole;
  content: string;
  timestamp: number;
  /** Streaming state - message being written */
  streaming?: boolean;
  /** Token count for this message */
  tokens?: number;
  /** Cost in USD (if available) */
  cost?: number;
  /** Model used to generate (for assistant messages) */
  model?: string;
  /** Error message if generation failed */
  error?: string;
}

/**
 * LLM provider configuration
 */
export interface LLMProvider {
  id: string;
  name: string;
  models: LLMModel[];
  /** API key required */
  requiresAuth: boolean;
  /** Base URL for API */
  baseUrl?: string;
}

/**
 * LLM model configuration
 */
export interface LLMModel {
  id: string;
  name: string;
  /** Context window size */
  contextWindow: number;
  /** Cost per 1K input tokens (USD) */
  inputCostPer1k?: number;
  /** Cost per 1K output tokens (USD) */
  outputCostPer1k?: number;
  /** Supports streaming */
  supportsStreaming: boolean;
}

/**
 * LLM conversation settings
 */
export interface LLMConversationSettings {
  /** System prompt */
  systemPrompt?: string;
  /** Temperature (0-2, typically 0-1) */
  temperature: number;
  /** Max tokens to generate */
  maxTokens?: number;
  /** Top P sampling */
  topP?: number;
  /** Model to use */
  model: string;
  /** Provider ID */
  provider: string;
}

/**
 * LLM conversation
 */
export interface LLMConversation {
  id: string;
  title: string;
  messages: LLMMessage[];
  settings: LLMConversationSettings;
  createdAt: number;
  updatedAt: number;
  /** Total tokens used in conversation */
  totalTokens: number;
  /** Total cost in USD */
  totalCost: number;
}

/**
 * Streaming chunk from LLM
 */
export interface LLMStreamChunk {
  content: string;
  done: boolean;
  tokens?: number;
}

/**
 * LLM provider adapter interface
 */
export interface LLMProviderAdapter {
  /** Provider info */
  provider: LLMProvider;

  /**
   * Send a message and get response
   * Can be streaming or non-streaming
   */
  sendMessage(
    messages: LLMMessage[],
    settings: LLMConversationSettings,
    onChunk?: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMMessage>;

  /**
   * Validate API key
   */
  validateAuth(apiKey: string): Promise<boolean>;

  /**
   * Count tokens in text
   */
  countTokens?(text: string, model: string): Promise<number>;

  /**
   * Get account balance (if supported)
   */
  getBalance?(): Promise<number | null>;
}
