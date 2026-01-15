/**
 * LLM Configuration Panel
 * Allows users to configure API key, model, and other settings
 */

import { useState, useEffect } from "react";
import { getProvider } from "@/lib/llm/providers/registry";
import type { LLMConfig, ModelInfo } from "@/types/llm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { saveApiKey } from "@/services/api-key-storage";

interface ConfigPanelProps {
  config: LLMConfig;
  onChange: (config: LLMConfig) => void;
  onClear: () => void;
}

export function ConfigPanel({ config, onChange, onClear }: ConfigPanelProps) {
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "failure" | null>(
    null,
  );
  const [showApiKey, setShowApiKey] = useState(false);

  // Load models when provider changes
  useEffect(() => {
    async function loadModels() {
      try {
        const provider = getProvider(config.provider.provider);
        const models = await provider.getModels(config.provider);
        setAvailableModels(models);

        // Auto-select first model if none selected
        if (models.length > 0 && !config.model) {
          onChange({ ...config, model: models[0].id });
        }
      } catch (error) {
        console.error("Failed to load models:", error);
        setAvailableModels([]);
      }
    }
    loadModels();
  }, [config.provider]);

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);

    try {
      const provider = getProvider(config.provider.provider);
      const success = await provider.testConnection(config.provider);
      setTestResult(success ? "success" : "failure");

      // Save API key if successful
      if (success && config.provider.apiKey) {
        saveApiKey(config.provider.provider, config.provider.apiKey);
      }
    } catch (error) {
      setTestResult("failure");
    } finally {
      setTesting(false);
    }
  }

  const currentModel = availableModels.find((m) => m.id === config.model);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h3 className="mb-3 font-semibold">Configuration</h3>
      </div>

      {/* API Key */}
      <div>
        <Label>OpenAI API Key</Label>
        <div className="mt-1 flex gap-2">
          <Input
            type={showApiKey ? "text" : "password"}
            value={config.provider.apiKey || ""}
            onChange={(e) =>
              onChange({
                ...config,
                provider: { ...config.provider, apiKey: e.target.value },
              })
            }
            placeholder="sk-..."
            className="font-mono text-xs"
          />
          <Button
            onClick={() => setShowApiKey(!showApiKey)}
            variant="outline"
            size="sm"
          >
            {showApiKey ? "Hide" : "Show"}
          </Button>
          <Button
            onClick={handleTestConnection}
            disabled={testing || !config.provider.apiKey}
            variant="outline"
            size="sm"
          >
            {testing ? "Testing..." : "Test"}
          </Button>
        </div>
        {testResult === "success" && (
          <p className="mt-1 text-xs text-green-500">✓ Connection successful</p>
        )}
        {testResult === "failure" && (
          <p className="mt-1 text-xs text-red-500">✗ Connection failed</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Keys are stored locally with basic encryption
        </p>
      </div>

      {/* Model Selection */}
      <div>
        <Label>Model</Label>
        <select
          value={config.model}
          onChange={(e) => onChange({ ...config, model: e.target.value })}
          className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {availableModels.length === 0 && (
            <option value="">Select a model</option>
          )}
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {currentModel && (
          <div className="mt-1 text-xs text-muted-foreground">
            Context: {currentModel.contextWindow.toLocaleString()} tokens
            {currentModel.inputCostPer1k > 0 && (
              <>
                {" "}
                • ${currentModel.inputCostPer1k}/1k in, $
                {currentModel.outputCostPer1k}/1k out
              </>
            )}
          </div>
        )}
      </div>

      {/* System Prompt */}
      <div>
        <Label>System Prompt (Optional)</Label>
        <Textarea
          value={config.systemPrompt || ""}
          onChange={(e) =>
            onChange({ ...config, systemPrompt: e.target.value })
          }
          placeholder="You are a helpful assistant..."
          rows={4}
          className="mt-1"
        />
      </div>

      {/* Temperature */}
      <div>
        <Label>Temperature: {config.temperature.toFixed(1)}</Label>
        <Slider
          min={0}
          max={2}
          step={0.1}
          value={[config.temperature]}
          onValueChange={([value]) =>
            onChange({ ...config, temperature: value })
          }
          className="mt-2"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Lower = focused, Higher = creative
        </p>
      </div>

      {/* Max Tokens */}
      <div>
        <Label>Max Tokens</Label>
        <Input
          type="number"
          value={config.maxTokens}
          onChange={(e) =>
            onChange({ ...config, maxTokens: parseInt(e.target.value) || 1000 })
          }
          min={1}
          max={currentModel?.contextWindow || 4096}
          className="mt-1"
        />
      </div>

      {/* Clear Conversation */}
      <div className="mt-auto pt-4">
        <Button onClick={onClear} variant="destructive" className="w-full">
          Clear Conversation
        </Button>
      </div>
    </div>
  );
}
