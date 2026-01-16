/**
 * AISettings - Provider configuration component
 */

import { useState, useCallback, useEffect } from "react";
import { Loader2, Trash2, Check, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiService, DEFAULT_PPQ_PROVIDER } from "@/services/ai-service";
import type { AIProvider } from "@/services/db";

interface AISettingsProps {
  provider?: AIProvider;
  onSaved?: () => void;
  onCancel?: () => void;
}

export function AISettings({ provider, onSaved, onCancel }: AISettingsProps) {
  // Form state
  const [name, setName] = useState(provider?.name || DEFAULT_PPQ_PROVIDER.name);
  const [baseUrl, setBaseUrl] = useState(
    provider?.baseUrl || DEFAULT_PPQ_PROVIDER.baseUrl,
  );
  const [apiKey, setApiKey] = useState(provider?.apiKey || "");
  const [defaultModel, setDefaultModel] = useState(
    provider?.defaultModel || DEFAULT_PPQ_PROVIDER.defaultModel || "",
  );
  const [models, setModels] = useState<string[]>(provider?.models || []);

  // UI state
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Reset form when provider changes
  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setBaseUrl(provider.baseUrl);
      setApiKey(provider.apiKey);
      setDefaultModel(provider.defaultModel || "");
      setModels(provider.models);
    }
  }, [provider]);

  const handleTestConnection = useCallback(async () => {
    if (!apiKey) {
      setError("API key is required");
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const tempProvider: AIProvider = {
        id: provider?.id || "temp",
        name,
        baseUrl,
        apiKey,
        models: [],
        createdAt: Date.now(),
      };

      const success = await aiService.testConnection(tempProvider);
      setTestResult(success ? "success" : "error");
      if (!success) {
        setError("Connection failed. Check your API key and URL.");
      }
    } catch (err) {
      setTestResult("error");
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setIsTesting(false);
    }
  }, [apiKey, baseUrl, name, provider?.id]);

  const handleFetchModels = useCallback(async () => {
    if (!apiKey) {
      setError("API key is required");
      return;
    }

    setIsFetchingModels(true);
    setError(null);

    try {
      const tempProvider: AIProvider = {
        id: provider?.id || "temp",
        name,
        baseUrl,
        apiKey,
        models: [],
        createdAt: Date.now(),
      };

      const fetchedModels = await aiService.fetchModels(tempProvider);
      setModels(fetchedModels);
      if (fetchedModels.length > 0 && !defaultModel) {
        setDefaultModel(fetchedModels[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setIsFetchingModels(false);
    }
  }, [apiKey, baseUrl, name, provider?.id, defaultModel]);

  const handleSave = useCallback(async () => {
    if (!name || !baseUrl || !apiKey) {
      setError("Name, URL, and API key are required");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await aiService.saveProvider({
        id: provider?.id,
        name,
        baseUrl,
        apiKey,
        models,
        defaultModel: defaultModel || undefined,
      });
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setIsSaving(false);
    }
  }, [name, baseUrl, apiKey, models, defaultModel, provider?.id, onSaved]);

  const handleDelete = useCallback(async () => {
    if (!provider?.id) return;

    if (!confirm("Delete this provider and all its conversations?")) return;

    try {
      await aiService.deleteProvider(provider.id);
      onSaved?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete provider",
      );
    }
  }, [provider?.id, onSaved]);

  return (
    <div className="flex flex-col h-full p-4 overflow-auto">
      <div className="max-w-md mx-auto w-full space-y-6">
        <div>
          <h2 className="text-lg font-semibold">
            {provider ? "Edit Provider" : "Add AI Provider"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure an OpenAI-compatible AI provider like PPQ.ai
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Name */}
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            Provider Name
          </label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PPQ.ai"
          />
        </div>

        {/* Base URL */}
        <div className="space-y-2">
          <label htmlFor="baseUrl" className="text-sm font-medium">
            API Base URL
          </label>
          <Input
            id="baseUrl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.ppq.ai"
          />
          <p className="text-xs text-muted-foreground">
            Base URL for the OpenAI-compatible API
          </p>
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <label htmlFor="apiKey" className="text-sm font-medium">
            API Key
          </label>
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>

        {/* Test Connection */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={isTesting || !apiKey}
          >
            {isTesting ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : testResult === "success" ? (
              <Check className="size-4 mr-2 text-green-500" />
            ) : testResult === "error" ? (
              <X className="size-4 mr-2 text-destructive" />
            ) : null}
            Test Connection
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFetchModels}
            disabled={isFetchingModels || !apiKey}
          >
            {isFetchingModels ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="size-4 mr-2" />
            )}
            Fetch Models
          </Button>
        </div>

        {/* Models */}
        {models.length > 0 && (
          <div className="space-y-2">
            <label htmlFor="defaultModel" className="text-sm font-medium">
              Default Model
            </label>
            <select
              id="defaultModel"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="w-full h-9 rounded border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {models.length} models available
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4">
          <Button
            onClick={handleSave}
            disabled={isSaving || !name || !baseUrl || !apiKey}
          >
            {isSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Save Provider
          </Button>
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {provider && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="ml-auto"
            >
              <Trash2 className="size-4 mr-2" />
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
