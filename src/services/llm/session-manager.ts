/**
 * Chat Session Manager
 *
 * Manages active chat sessions with RxJS patterns.
 * Supports multiple concurrent sessions (one per conversation).
 * Multiple windows can view the same conversation and share streaming state.
 *
 * Architecture:
 * - Conversation data (messages) → Dexie (persistent, shared)
 * - Session state (streaming) → Memory (transient, reactive)
 */

import { BehaviorSubject, Subject } from "rxjs";
import db from "@/services/db";
import { providerManager } from "./provider-manager";
import type {
  ChatSessionState,
  StreamingUpdateEvent,
  MessageAddedEvent,
  LoadingChangedEvent,
  SessionErrorEvent,
  LLMMessage,
  LLMConversation,
} from "@/types/llm";

// Session cleanup delay (ms) - wait before cleaning up after last subscriber leaves
const CLEANUP_DELAY = 5000;

class ChatSessionManager {
  // ─────────────────────────────────────────────────────────────
  // Reactive State
  // ─────────────────────────────────────────────────────────────

  /**
   * All active sessions, keyed by conversationId.
   * Multiple sessions can be active simultaneously.
   */
  sessions$ = new BehaviorSubject<Map<string, ChatSessionState>>(new Map());

  // ─────────────────────────────────────────────────────────────
  // Event Streams
  // ─────────────────────────────────────────────────────────────

  /** Emitted during streaming with incremental content */
  streamingUpdate$ = new Subject<StreamingUpdateEvent>();

  /** Emitted when a message is added to a conversation */
  messageAdded$ = new Subject<MessageAddedEvent>();

  /** Emitted when loading state changes */
  loadingChanged$ = new Subject<LoadingChangedEvent>();

  /** Emitted on errors */
  error$ = new Subject<SessionErrorEvent>();

  // ─────────────────────────────────────────────────────────────
  // Internal State
  // ─────────────────────────────────────────────────────────────

  /** Cleanup timers for sessions with no subscribers */
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ─────────────────────────────────────────────────────────────
  // Session Lifecycle
  // ─────────────────────────────────────────────────────────────

  /**
   * Open a session for a conversation.
   * If session already exists, increments subscriber count.
   * Call this when a window starts viewing a conversation.
   */
  openSession(
    conversationId: string,
    providerInstanceId: string,
    modelId: string,
  ): ChatSessionState {
    // Cancel any pending cleanup
    const cleanupTimer = this.cleanupTimers.get(conversationId);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.cleanupTimers.delete(conversationId);
    }

    const sessions = this.sessions$.value;
    const existing = sessions.get(conversationId);

    if (existing) {
      // Increment subscriber count
      const updated: ChatSessionState = {
        ...existing,
        subscriberCount: existing.subscriberCount + 1,
        // Update provider/model if changed (e.g., user switched model)
        providerInstanceId,
        modelId,
      };
      this.updateSession(conversationId, updated);
      return updated;
    }

    // Create new session
    const session: ChatSessionState = {
      conversationId,
      providerInstanceId,
      modelId,
      isLoading: false,
      streamingContent: "",
      sessionCost: 0,
      subscriberCount: 1,
      lastActivity: Date.now(),
    };

    this.updateSession(conversationId, session);
    return session;
  }

  /**
   * Close a session subscription.
   * Decrements subscriber count; cleans up when count reaches 0.
   * Call this when a window stops viewing a conversation.
   */
  closeSession(conversationId: string): void {
    const sessions = this.sessions$.value;
    const session = sessions.get(conversationId);

    if (!session) return;

    const updatedCount = session.subscriberCount - 1;

    if (updatedCount <= 0) {
      // Schedule cleanup after delay (in case user switches back quickly)
      const timer = setTimeout(() => {
        this.cleanupSession(conversationId);
        this.cleanupTimers.delete(conversationId);
      }, CLEANUP_DELAY);
      this.cleanupTimers.set(conversationId, timer);

      // Update count to 0
      this.updateSession(conversationId, {
        ...session,
        subscriberCount: 0,
      });
    } else {
      // Just decrement
      this.updateSession(conversationId, {
        ...session,
        subscriberCount: updatedCount,
      });
    }
  }

  /**
   * Clean up a session completely.
   * Aborts any in-progress generation and removes from state.
   */
  private cleanupSession(conversationId: string): void {
    const sessions = this.sessions$.value;
    const session = sessions.get(conversationId);

    if (!session) return;

    // Don't cleanup if subscribers came back
    if (session.subscriberCount > 0) return;

    // Abort any in-progress generation
    session.abortController?.abort("Session closed");

    // Remove from state
    const newSessions = new Map(sessions);
    newSessions.delete(conversationId);
    this.sessions$.next(newSessions);
  }

  /**
   * Get a session by conversation ID.
   */
  getSession(conversationId: string): ChatSessionState | undefined {
    return this.sessions$.value.get(conversationId);
  }

  /**
   * Update a session in the state map.
   */
  private updateSession(
    conversationId: string,
    session: ChatSessionState,
  ): void {
    const newSessions = new Map(this.sessions$.value);
    newSessions.set(conversationId, session);
    this.sessions$.next(newSessions);
  }

  // ─────────────────────────────────────────────────────────────
  // Conversation Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new conversation and return its ID.
   */
  async createConversation(
    providerInstanceId: string,
    modelId: string,
    title?: string,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    const conversation: LLMConversation = {
      id,
      title: title || "New conversation",
      providerInstanceId,
      modelId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    await db.llmConversations.add(conversation);
    return id;
  }

  /**
   * Delete a conversation and its session.
   */
  async deleteConversation(conversationId: string): Promise<void> {
    // Clean up session first
    const session = this.getSession(conversationId);
    if (session) {
      session.abortController?.abort("Conversation deleted");
      const newSessions = new Map(this.sessions$.value);
      newSessions.delete(conversationId);
      this.sessions$.next(newSessions);
    }

    // Cancel any pending cleanup
    const timer = this.cleanupTimers.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(conversationId);
    }

    // Delete from Dexie
    await db.llmConversations.delete(conversationId);
  }

  // ─────────────────────────────────────────────────────────────
  // Message Handling
  // ─────────────────────────────────────────────────────────────

  /**
   * Send a message and stream the response.
   * This is the main entry point for chat interactions.
   */
  async sendMessage(conversationId: string, content: string): Promise<void> {
    const session = this.getSession(conversationId);
    if (!session) {
      throw new Error(`No session found for conversation ${conversationId}`);
    }

    if (session.isLoading) {
      throw new Error("Session is already generating a response");
    }

    // Get conversation from Dexie
    const conversation = await db.llmConversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Create user message
    const userMessage: LLMMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    // Add user message to Dexie
    const isFirstMessage = conversation.messages.length === 0;
    await db.llmConversations.update(conversationId, {
      messages: [...conversation.messages, userMessage],
      updatedAt: Date.now(),
      // Auto-title from first message
      title: isFirstMessage
        ? content.slice(0, 50) + (content.length > 50 ? "..." : "")
        : conversation.title,
    });

    this.messageAdded$.next({ conversationId, message: userMessage });

    // Start generation
    await this.startGeneration(conversationId);
  }

  /**
   * Start or resume AI generation for a conversation.
   */
  async startGeneration(conversationId: string): Promise<void> {
    const session = this.getSession(conversationId);
    if (!session) {
      throw new Error(`No session found for conversation ${conversationId}`);
    }

    if (session.isLoading) {
      return; // Already generating
    }

    // Get conversation from Dexie
    const conversation = await db.llmConversations.get(conversationId);
    if (!conversation || conversation.messages.length === 0) {
      throw new Error("No messages in conversation");
    }

    // Create abort controller
    const abortController = new AbortController();

    // Update session to loading state
    this.updateSession(conversationId, {
      ...session,
      isLoading: true,
      streamingContent: "",
      abortController,
      lastError: undefined,
      finishReason: null,
      lastActivity: Date.now(),
    });

    this.loadingChanged$.next({ conversationId, isLoading: true });

    try {
      // Stream response from provider
      let fullContent = "";
      let usage: ChatSessionState["usage"];

      const chatGenerator = providerManager.chat(
        session.providerInstanceId,
        session.modelId,
        conversation.messages,
        { signal: abortController.signal },
      );

      for await (const chunk of chatGenerator) {
        // Check if session still exists and is loading
        const currentSession = this.getSession(conversationId);
        if (!currentSession?.isLoading) {
          break;
        }

        if (chunk.type === "token" && chunk.content) {
          fullContent += chunk.content;

          // Update streaming content
          this.updateSession(conversationId, {
            ...currentSession,
            streamingContent: fullContent,
            lastActivity: Date.now(),
          });

          this.streamingUpdate$.next({
            conversationId,
            content: fullContent,
          });
        } else if (chunk.type === "done") {
          usage = chunk.usage;
        } else if (chunk.type === "error") {
          throw new Error(chunk.error || "Unknown error");
        }
      }

      // Create assistant message
      const assistantMessage: LLMMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: fullContent,
        timestamp: Date.now(),
      };

      // Add to Dexie
      const updatedConv = await db.llmConversations.get(conversationId);
      if (updatedConv) {
        await db.llmConversations.update(conversationId, {
          messages: [...updatedConv.messages, assistantMessage],
          updatedAt: Date.now(),
        });
      }

      this.messageAdded$.next({ conversationId, message: assistantMessage });

      // Calculate cost if we have usage and pricing
      let cost = 0;
      if (usage) {
        cost = await this.calculateCost(
          session.providerInstanceId,
          session.modelId,
          usage.promptTokens,
          usage.completionTokens,
        );
      }

      // Update session to completed state
      const finalSession = this.getSession(conversationId);
      if (finalSession) {
        this.updateSession(conversationId, {
          ...finalSession,
          isLoading: false,
          streamingContent: "",
          abortController: undefined,
          usage,
          sessionCost: finalSession.sessionCost + cost,
          finishReason: "stop",
          lastActivity: Date.now(),
        });
      }

      this.loadingChanged$.next({ conversationId, isLoading: false });
    } catch (error) {
      // Handle abort
      if (error instanceof DOMException && error.name === "AbortError") {
        const currentSession = this.getSession(conversationId);
        if (currentSession) {
          this.updateSession(conversationId, {
            ...currentSession,
            isLoading: false,
            abortController: undefined,
            finishReason: null, // Can resume
            lastActivity: Date.now(),
          });
        }
        this.loadingChanged$.next({ conversationId, isLoading: false });
        return;
      }

      // Handle error
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      const currentSession = this.getSession(conversationId);
      if (currentSession) {
        this.updateSession(conversationId, {
          ...currentSession,
          isLoading: false,
          streamingContent: "",
          abortController: undefined,
          lastError: errorMessage,
          finishReason: "error",
          lastActivity: Date.now(),
        });
      }

      this.error$.next({ conversationId, error: errorMessage });
      this.loadingChanged$.next({ conversationId, isLoading: false });
    }
  }

  /**
   * Stop generation for a conversation.
   */
  stopGeneration(conversationId: string): void {
    const session = this.getSession(conversationId);
    if (!session) return;

    session.abortController?.abort("User stopped generation");

    // If there's streaming content, save it as a partial message
    if (session.streamingContent) {
      this.savePartialMessage(conversationId, session.streamingContent);
    }

    this.updateSession(conversationId, {
      ...session,
      isLoading: false,
      streamingContent: "",
      abortController: undefined,
      finishReason: null, // Can resume
      lastActivity: Date.now(),
    });

    this.loadingChanged$.next({ conversationId, isLoading: false });
  }

  /**
   * Save partial streaming content as a message (when stopped mid-stream).
   */
  private async savePartialMessage(
    conversationId: string,
    content: string,
  ): Promise<void> {
    if (!content.trim()) return;

    const conversation = await db.llmConversations.get(conversationId);
    if (!conversation) return;

    const assistantMessage: LLMMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: content + "\n\n_(generation stopped)_",
      timestamp: Date.now(),
    };

    await db.llmConversations.update(conversationId, {
      messages: [...conversation.messages, assistantMessage],
      updatedAt: Date.now(),
    });

    this.messageAdded$.next({ conversationId, message: assistantMessage });
  }

  // ─────────────────────────────────────────────────────────────
  // Cost Calculation
  // ─────────────────────────────────────────────────────────────

  /**
   * Calculate cost for a completion based on model pricing.
   */
  private async calculateCost(
    providerInstanceId: string,
    modelId: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<number> {
    try {
      const models = await providerManager.listModels(providerInstanceId);
      const model = models.find((m) => m.id === modelId);

      if (!model?.pricing) {
        return 0;
      }

      const inputCost =
        (promptTokens / 1_000_000) * (model.pricing.inputPerMillion ?? 0);
      const outputCost =
        (completionTokens / 1_000_000) * (model.pricing.outputPerMillion ?? 0);

      return inputCost + outputCost;
    } catch {
      return 0;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Utility Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if a conversation can be resumed (was interrupted).
   */
  canResume(conversationId: string): boolean {
    const session = this.getSession(conversationId);
    return Boolean(
      session &&
      !session.isLoading &&
      session.finishReason !== "stop" &&
      session.finishReason !== "error",
    );
  }

  /**
   * Get all active session IDs.
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.sessions$.value.keys());
  }

  /**
   * Clear all sessions (for cleanup/logout).
   */
  clearAllSessions(): void {
    // Abort all in-progress generations
    for (const session of this.sessions$.value.values()) {
      session.abortController?.abort("Clearing all sessions");
    }

    // Clear all cleanup timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();

    // Clear sessions
    this.sessions$.next(new Map());
  }
}

// Singleton instance
export const sessionManager = new ChatSessionManager();
