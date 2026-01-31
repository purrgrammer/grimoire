/**
 * React hooks for AI Chat functionality
 */

import { useState, useCallback, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { providerManager } from "@/services/llm/provider-manager";
import { AI_PROVIDER_PRESETS } from "@/lib/ai-provider-presets";
import type { LLMProviderInstance, LLMModel } from "@/types/llm";

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
    presets: AI_PROVIDER_PRESETS,
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
// Recent Models
// ─────────────────────────────────────────────────────────────

export function useRecentModels() {
  const recentModels = use$(providerManager.recentModels$);
  return recentModels ?? [];
}

// ─────────────────────────────────────────────────────────────
// Connection Test
// ─────────────────────────────────────────────────────────────

export function useTestConnection() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  const testConnection = useCallback(async (instance: LLMProviderInstance) => {
    setTesting(true);
    setResult(null);
    try {
      const res = await providerManager.testConnection(instance);
      setResult(res);
      return res;
    } finally {
      setTesting(false);
    }
  }, []);

  return {
    testing,
    result,
    testConnection,
    reset: () => setResult(null),
  };
}
