/**
 * React hooks for ChatSessionManager
 *
 * Provides reactive access to chat sessions with proper cleanup.
 * Combines session state (streaming) with conversation data (Dexie).
 */

import { useEffect, useMemo, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { map, distinctUntilChanged } from "rxjs/operators";
import { use$ } from "applesauce-react/hooks";
import { sessionManager } from "@/services/llm/session-manager";
import db from "@/services/db";
import type { ChatSessionState, LLMConversation } from "@/types/llm";

// ─────────────────────────────────────────────────────────────
// Main Session Hook
// ─────────────────────────────────────────────────────────────

interface UseChatSessionOptions {
  /** Provider instance ID (required for new sessions) */
  providerInstanceId?: string;
  /** Model ID (required for new sessions) */
  modelId?: string;
}

interface UseChatSessionResult {
  // Conversation data (from Dexie - persistent)
  conversation: LLMConversation | undefined;
  messages: LLMConversation["messages"];
  title: string;

  // Session state (from SessionManager - transient)
  session: ChatSessionState | undefined;
  isLoading: boolean;
  streamingContent: string;
  error: string | undefined;

  // Usage and cost
  usage: ChatSessionState["usage"];
  cost: number;

  // Resume state
  canResume: boolean;
  finishReason: ChatSessionState["finishReason"];
}

/**
 * Hook to access and manage a chat session.
 * Automatically registers/unregisters with SessionManager on mount/unmount.
 *
 * @param conversationId - The conversation ID (null for no selection)
 * @param options - Provider and model configuration
 */
export function useChatSession(
  conversationId: string | null,
  options: UseChatSessionOptions = {},
): UseChatSessionResult {
  const { providerInstanceId, modelId } = options;

  // Register/unregister session on mount/unmount
  useEffect(() => {
    if (!conversationId || !providerInstanceId || !modelId) return;

    sessionManager.openSession(conversationId, providerInstanceId, modelId);

    return () => {
      sessionManager.closeSession(conversationId);
    };
  }, [conversationId, providerInstanceId, modelId]);

  // Subscribe to session state from SessionManager
  const session = use$(
    () =>
      sessionManager.sessions$.pipe(
        map((sessions) =>
          conversationId ? sessions.get(conversationId) : undefined,
        ),
        distinctUntilChanged(),
      ),
    [conversationId],
  );

  // Subscribe to conversation data from Dexie (reactive)
  const conversation = useLiveQuery(
    () =>
      conversationId ? db.llmConversations.get(conversationId) : undefined,
    [conversationId],
  );

  // Derive computed values
  const result = useMemo(
    (): UseChatSessionResult => ({
      // Conversation data
      conversation,
      messages: conversation?.messages ?? [],
      title: conversation?.title ?? "New conversation",

      // Session state
      session,
      isLoading: session?.isLoading ?? false,
      streamingContent: session?.streamingContent ?? "",
      error: session?.lastError,

      // Usage and cost
      usage: session?.usage,
      cost: session?.sessionCost ?? 0,

      // Resume state
      canResume: Boolean(
        session &&
        !session.isLoading &&
        session.finishReason !== "stop" &&
        session.finishReason !== "error",
      ),
      finishReason: session?.finishReason,
    }),
    [conversation, session],
  );

  return result;
}

// ─────────────────────────────────────────────────────────────
// Actions Hook
// ─────────────────────────────────────────────────────────────

interface UseChatActionsResult {
  /** Send a message to the current conversation */
  sendMessage: (conversationId: string, content: string) => Promise<void>;

  /** Create a new conversation */
  createConversation: (
    providerInstanceId: string,
    modelId: string,
    title?: string,
  ) => Promise<string>;

  /** Delete a conversation */
  deleteConversation: (conversationId: string) => Promise<void>;

  /** Stop generation for a conversation */
  stopGeneration: (conversationId: string) => void;

  /** Resume generation for a conversation */
  resumeGeneration: (conversationId: string) => Promise<void>;
}

/**
 * Hook providing chat actions.
 * These are stable functions that don't change between renders.
 */
export function useChatActions(): UseChatActionsResult {
  const sendMessage = useCallback(
    (conversationId: string, content: string) =>
      sessionManager.sendMessage(conversationId, content),
    [],
  );

  const createConversation = useCallback(
    (providerInstanceId: string, modelId: string, title?: string) =>
      sessionManager.createConversation(providerInstanceId, modelId, title),
    [],
  );

  const deleteConversation = useCallback(
    (conversationId: string) =>
      sessionManager.deleteConversation(conversationId),
    [],
  );

  const stopGeneration = useCallback(
    (conversationId: string) => sessionManager.stopGeneration(conversationId),
    [],
  );

  const resumeGeneration = useCallback(
    (conversationId: string) => sessionManager.startGeneration(conversationId),
    [],
  );

  return useMemo(
    () => ({
      sendMessage,
      createConversation,
      deleteConversation,
      stopGeneration,
      resumeGeneration,
    }),
    [
      sendMessage,
      createConversation,
      deleteConversation,
      stopGeneration,
      resumeGeneration,
    ],
  );
}

// ─────────────────────────────────────────────────────────────
// Conversations List Hook
// ─────────────────────────────────────────────────────────────

interface UseConversationsResult {
  /** All conversations, sorted by updatedAt descending */
  conversations: LLMConversation[];
  /** Loading state */
  isLoading: boolean;
}

/**
 * Hook to get all conversations from Dexie.
 * Automatically updates when conversations change.
 */
export function useConversations(): UseConversationsResult {
  const conversations = useLiveQuery(
    () => db.llmConversations.orderBy("updatedAt").reverse().toArray(),
    [],
  );

  return useMemo(
    () => ({
      conversations: conversations ?? [],
      isLoading: conversations === undefined,
    }),
    [conversations],
  );
}

// ─────────────────────────────────────────────────────────────
// Streaming Events Hook
// ─────────────────────────────────────────────────────────────

/**
 * Hook to subscribe to streaming updates for a specific conversation.
 * Useful for components that only need streaming content, not full session state.
 */
export function useStreamingContent(conversationId: string | null): string {
  const content = use$(
    () =>
      sessionManager.sessions$.pipe(
        map((sessions) => {
          if (!conversationId) return "";
          const session = sessions.get(conversationId);
          return session?.streamingContent ?? "";
        }),
        distinctUntilChanged(),
      ),
    [conversationId],
  );

  return content ?? "";
}

// ─────────────────────────────────────────────────────────────
// Loading State Hook
// ─────────────────────────────────────────────────────────────

/**
 * Hook to check if a conversation is currently loading.
 */
export function useIsLoading(conversationId: string | null): boolean {
  const isLoading = use$(
    () =>
      sessionManager.sessions$.pipe(
        map((sessions) => {
          if (!conversationId) return false;
          const session = sessions.get(conversationId);
          return session?.isLoading ?? false;
        }),
        distinctUntilChanged(),
      ),
    [conversationId],
  );

  return isLoading ?? false;
}

// ─────────────────────────────────────────────────────────────
// Active Sessions Hook
// ─────────────────────────────────────────────────────────────

/**
 * Hook to get all active session IDs.
 * Useful for debugging or status displays.
 */
export function useActiveSessions(): string[] {
  const sessionIds = use$(
    () =>
      sessionManager.sessions$.pipe(
        map((sessions) => Array.from(sessions.keys())),
      ),
    [],
  );

  return sessionIds ?? [];
}
