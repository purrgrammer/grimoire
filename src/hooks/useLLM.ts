/**
 * React hooks for LLM functionality
 */

import { useState, useCallback, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";
import { providerManager } from "@/services/llm/provider-manager";
import { PROVIDER_CONFIGS } from "@/services/llm/providers";
import type {
  LLMProviderInstance,
  LLMModel,
  LLMMessage,
  LLMEngineStatus,
} from "@/types/llm";

// ─────────────────────────────────────────────────────────────
// Provider Management
// ─────────────────────────────────────────────────────────────

export function useLLMProviders() {
  const instances = use$(providerManager.instances$);
  const activeInstanceId = use$(providerManager.activeInstanceId$);

  const addInstance = useCallback(
    async (instance: Omit<LLMProviderInstance, "id">) => {
      const id = crypto.randomUUID();
      await providerManager.saveProviderInstance({ ...instance, id });
      return id;
    },
    [],
  );

  const updateInstance = useCallback(async (instance: LLMProviderInstance) => {
    await providerManager.saveProviderInstance(instance);
  }, []);

  const removeInstance = useCallback(async (instanceId: string) => {
    await providerManager.removeProviderInstance(instanceId);
  }, []);

  const setActiveInstance = useCallback((instanceId: string | null) => {
    providerManager.setActiveInstance(instanceId);
  }, []);

  return {
    configs: PROVIDER_CONFIGS,
    instances: instances ?? [],
    activeInstanceId,
    activeInstance: instances?.find((i) => i.id === activeInstanceId),
    addInstance,
    updateInstance,
    removeInstance,
    setActiveInstance,
  };
}

// ─────────────────────────────────────────────────────────────
// Model Management
// ─────────────────────────────────────────────────────────────

export function useLLMModels(instanceId: string | null) {
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(
    async (forceRefresh = false) => {
      if (!instanceId) {
        setModels([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const fetchedModels = await providerManager.listModels(
          instanceId,
          forceRefresh,
        );
        setModels(fetchedModels);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load models");
        setModels([]);
      } finally {
        setLoading(false);
      }
    },
    [instanceId],
  );

  // Load models when instance changes
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  return {
    models,
    loading,
    error,
    refresh: () => loadModels(true),
  };
}

// ─────────────────────────────────────────────────────────────
// WebLLM Engine Status
// ─────────────────────────────────────────────────────────────

export function useWebLLMStatus() {
  const status = use$(providerManager.getWebLLMStatus$());
  const loadedModelId = providerManager.getLoadedWebLLMModelId();

  const loadModel = useCallback(
    async (
      modelId: string,
      onProgress?: (progress: { progress: number; text: string }) => void,
    ) => {
      await providerManager.loadWebLLMModel(modelId, onProgress);
    },
    [],
  );

  const deleteModel = useCallback(async (modelId: string) => {
    await providerManager.deleteWebLLMModel(modelId);
  }, []);

  const interrupt = useCallback(() => {
    providerManager.interruptWebLLM();
  }, []);

  return {
    status: status ?? ({ state: "idle" } as LLMEngineStatus),
    loadedModelId,
    isIdle: status?.state === "idle",
    isLoading: status?.state === "loading",
    isReady: status?.state === "ready",
    isGenerating: status?.state === "generating",
    isError: status?.state === "error",
    loadModel,
    deleteModel,
    interrupt,
  };
}

// ─────────────────────────────────────────────────────────────
// Conversations
// ─────────────────────────────────────────────────────────────

export function useLLMConversations() {
  const conversations = useLiveQuery(
    () => db.llmConversations.orderBy("updatedAt").reverse().toArray(),
    [],
  );

  const createConversation = useCallback(
    async (
      providerInstanceId: string,
      modelId: string,
      systemPrompt?: string,
    ): Promise<string> => {
      const id = crypto.randomUUID();
      const now = Date.now();

      await db.llmConversations.add({
        id,
        title: "New conversation",
        providerInstanceId,
        modelId,
        systemPrompt,
        messages: [],
        createdAt: now,
        updatedAt: now,
      });

      return id;
    },
    [],
  );

  const deleteConversation = useCallback(async (conversationId: string) => {
    await db.llmConversations.delete(conversationId);
  }, []);

  const updateTitle = useCallback(
    async (conversationId: string, title: string) => {
      await db.llmConversations.update(conversationId, {
        title,
        updatedAt: Date.now(),
      });
    },
    [],
  );

  return {
    conversations: conversations ?? [],
    createConversation,
    deleteConversation,
    updateTitle,
  };
}

export function useLLMConversation(conversationId: string | null) {
  const conversation = useLiveQuery(
    () =>
      conversationId ? db.llmConversations.get(conversationId) : undefined,
    [conversationId],
  );

  const addMessage = useCallback(
    async (message: Omit<LLMMessage, "id" | "timestamp">) => {
      if (!conversationId) return null;

      const conv = await db.llmConversations.get(conversationId);
      if (!conv) return null;

      const newMessage: LLMMessage = {
        ...message,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };

      const isFirstUserMessage =
        conv.messages.length === 0 && message.role === "user";

      await db.llmConversations.update(conversationId, {
        messages: [...conv.messages, newMessage],
        updatedAt: Date.now(),
        // Auto-title from first user message
        title: isFirstUserMessage
          ? message.content.slice(0, 50) +
            (message.content.length > 50 ? "..." : "")
          : conv.title,
      });

      return newMessage;
    },
    [conversationId],
  );

  const updateLastMessage = useCallback(
    async (content: string) => {
      if (!conversationId) return;

      const conv = await db.llmConversations.get(conversationId);
      if (!conv || conv.messages.length === 0) return;

      const messages = [...conv.messages];
      messages[messages.length - 1] = {
        ...messages[messages.length - 1],
        content,
      };

      await db.llmConversations.update(conversationId, {
        messages,
        updatedAt: Date.now(),
      });
    },
    [conversationId],
  );

  return {
    conversation,
    addMessage,
    updateLastMessage,
  };
}

// ─────────────────────────────────────────────────────────────
// Chat
// ─────────────────────────────────────────────────────────────

export function useLLMChat() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      instanceId: string,
      modelId: string,
      messages: LLMMessage[],
      onToken: (token: string) => void,
      onDone: () => void,
      onError: (error: string) => void,
    ) => {
      const controller = new AbortController();
      setAbortController(controller);
      setIsGenerating(true);

      try {
        const stream = providerManager.chat(instanceId, modelId, messages, {
          signal: controller.signal,
        });

        for await (const chunk of stream) {
          if (chunk.type === "token" && chunk.content) {
            onToken(chunk.content);
          } else if (chunk.type === "error" && chunk.error) {
            onError(chunk.error);
            break;
          } else if (chunk.type === "done") {
            onDone();
            break;
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          onDone();
        } else {
          onError(err instanceof Error ? err.message : "Chat failed");
        }
      } finally {
        setIsGenerating(false);
        setAbortController(null);
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortController?.abort();
    providerManager.interruptWebLLM();
  }, [abortController]);

  return {
    isGenerating,
    sendMessage,
    cancel,
  };
}
