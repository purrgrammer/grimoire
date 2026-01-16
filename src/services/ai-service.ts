/**
 * AI Service - Handles AI provider management and chat completions
 *
 * Supports OpenAI-compatible APIs like PPQ.ai
 */

import db, { type AIProvider, type AIConversation, type AIMessage } from "./db";

/**
 * Default PPQ.ai provider configuration
 */
export const DEFAULT_PPQ_PROVIDER: Omit<
  AIProvider,
  "id" | "apiKey" | "createdAt"
> = {
  name: "PPQ.ai",
  baseUrl: "https://api.ppq.ai",
  models: [],
  defaultModel: "claude-sonnet-4-20250514",
};

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * AI Service singleton
 */
export const aiService = {
  // ==================== Provider Management ====================

  /**
   * Get all configured AI providers
   */
  async getProviders(): Promise<AIProvider[]> {
    return db.aiProviders.orderBy("createdAt").toArray();
  },

  /**
   * Get a specific provider by ID
   */
  async getProvider(id: string): Promise<AIProvider | undefined> {
    return db.aiProviders.get(id);
  },

  /**
   * Save a new or update an existing provider
   */
  async saveProvider(
    provider: Omit<AIProvider, "id" | "createdAt"> & { id?: string },
  ): Promise<AIProvider> {
    const now = Date.now();
    const savedProvider: AIProvider = {
      ...provider,
      id: provider.id || generateId(),
      createdAt: now,
    };
    await db.aiProviders.put(savedProvider);
    return savedProvider;
  },

  /**
   * Delete a provider and all its conversations
   */
  async deleteProvider(id: string): Promise<void> {
    // Delete all conversations for this provider
    const conversations = await db.aiConversations
      .where("providerId")
      .equals(id)
      .toArray();

    for (const conv of conversations) {
      await db.aiMessages.where("conversationId").equals(conv.id).delete();
    }
    await db.aiConversations.where("providerId").equals(id).delete();
    await db.aiProviders.delete(id);
  },

  /**
   * Fetch available models from a provider
   */
  async fetchModels(provider: AIProvider): Promise<string[]> {
    const response = await fetch(`${provider.baseUrl}/v1/models`, {
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json();
    // OpenAI format: { data: [{ id: "model-name" }, ...] }
    return data.data?.map((m: { id: string }) => m.id) || [];
  },

  /**
   * Test connection to a provider
   */
  async testConnection(provider: AIProvider): Promise<boolean> {
    try {
      await this.fetchModels(provider);
      return true;
    } catch {
      return false;
    }
  },

  // ==================== Conversation Management ====================

  /**
   * Get all conversations for a provider, sorted by most recent
   */
  async getConversations(providerId?: string): Promise<AIConversation[]> {
    if (providerId) {
      return db.aiConversations
        .where("providerId")
        .equals(providerId)
        .reverse()
        .sortBy("updatedAt");
    }
    return db.aiConversations.orderBy("updatedAt").reverse().toArray();
  },

  /**
   * Get a specific conversation by ID
   */
  async getConversation(id: string): Promise<AIConversation | undefined> {
    return db.aiConversations.get(id);
  },

  /**
   * Create a new conversation
   */
  async createConversation(
    providerId: string,
    model: string,
    title?: string,
  ): Promise<AIConversation> {
    const now = Date.now();
    const conversation: AIConversation = {
      id: generateId(),
      providerId,
      model,
      title: title || "New Chat",
      createdAt: now,
      updatedAt: now,
    };
    await db.aiConversations.add(conversation);
    return conversation;
  },

  /**
   * Update conversation (e.g., title, model)
   */
  async updateConversation(
    id: string,
    updates: Partial<Pick<AIConversation, "title" | "model">>,
  ): Promise<void> {
    await db.aiConversations.update(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(id: string): Promise<void> {
    await db.aiMessages.where("conversationId").equals(id).delete();
    await db.aiConversations.delete(id);
  },

  // ==================== Message Management ====================

  /**
   * Get all messages for a conversation
   */
  async getMessages(conversationId: string): Promise<AIMessage[]> {
    return db.aiMessages
      .where("conversationId")
      .equals(conversationId)
      .sortBy("timestamp");
  },

  /**
   * Add a message to a conversation
   */
  async addMessage(
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    isStreaming = false,
  ): Promise<AIMessage> {
    const message: AIMessage = {
      id: generateId(),
      conversationId,
      role,
      content,
      timestamp: Date.now(),
      isStreaming,
    };
    await db.aiMessages.add(message);

    // Update conversation's updatedAt
    await db.aiConversations.update(conversationId, {
      updatedAt: Date.now(),
    });

    return message;
  },

  /**
   * Update a message (for streaming)
   */
  async updateMessage(
    id: string,
    updates: Partial<Pick<AIMessage, "content" | "isStreaming">>,
  ): Promise<void> {
    await db.aiMessages.update(id, updates);
  },

  /**
   * Delete a message
   */
  async deleteMessage(id: string): Promise<void> {
    await db.aiMessages.delete(id);
  },

  // ==================== Chat Completions ====================

  /**
   * Stream a chat completion from an AI provider
   * Returns an async iterator that yields content chunks
   */
  async *streamChat(
    provider: AIProvider,
    messages: { role: string; content: string }[],
    model: string,
  ): AsyncGenerator<string, void, unknown> {
    const url = `${provider.baseUrl}/v1/chat/completions`;
    console.log("[AI] Streaming chat request to:", url);
    console.log("[AI] Model:", model);
    console.log("[AI] Messages:", messages.length);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[AI] Chat completion failed:", response.status, error);
      throw new Error(`Chat completion failed (${response.status}): ${error}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    console.log("[AI] Response received, starting stream...");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            console.log("[AI] Stream complete");
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch (e) {
            console.warn("[AI] Failed to parse SSE data:", data, e);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  /**
   * Send a message and stream the response
   * Handles message persistence automatically
   */
  async sendMessage(
    conversationId: string,
    content: string,
    onChunk?: (chunk: string, fullContent: string) => void,
  ): Promise<AIMessage> {
    console.log("[AI] sendMessage called for conversation:", conversationId);

    // Get conversation and provider
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const provider = await this.getProvider(conversation.providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }

    console.log("[AI] Provider:", provider.name, provider.baseUrl);
    console.log("[AI] Model:", conversation.model);

    // Add user message
    await this.addMessage(conversationId, "user", content);
    console.log("[AI] User message added");

    // Get all messages for context
    const messages = await this.getMessages(conversationId);
    const chatMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Create assistant message placeholder
    const assistantMessage = await this.addMessage(
      conversationId,
      "assistant",
      "",
      true,
    );

    // Stream the response
    let fullContent = "";
    let chunkCount = 0;
    try {
      console.log("[AI] Starting to stream response...");
      for await (const chunk of this.streamChat(
        provider,
        chatMessages,
        conversation.model,
      )) {
        chunkCount++;
        fullContent += chunk;
        await this.updateMessage(assistantMessage.id, {
          content: fullContent,
        });
        onChunk?.(chunk, fullContent);
      }

      console.log(
        "[AI] Stream finished. Total chunks:",
        chunkCount,
        "Total chars:",
        fullContent.length,
      );

      // Mark as complete
      await this.updateMessage(assistantMessage.id, {
        isStreaming: false,
      });

      // Auto-generate title from first message if still default
      if (conversation.title === "New Chat" && messages.length <= 1) {
        const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
        await this.updateConversation(conversationId, { title });
      }

      return { ...assistantMessage, content: fullContent, isStreaming: false };
    } catch (error) {
      // On error, update message with error state
      await this.updateMessage(assistantMessage.id, {
        content: fullContent || "Error: Failed to get response",
        isStreaming: false,
      });
      throw error;
    }
  },
};

export default aiService;
