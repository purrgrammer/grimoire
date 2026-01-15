# LLM Chat with Multi-Provider Support

## Overview

Design a provider-agnostic LLM chat system that supports OpenAI, Anthropic, local models, and custom API endpoints with a unified interface.

## UI Design

### Config Panel (Expanded)

```
┌──────────────────────────────────────┐
│ ⚙️ Configuration                     │
├──────────────────────────────────────┤
│                                      │
│ Provider                             │
│ ┌──────────────────────────────────┐ │
│ │ OpenAI              ▼            │ │ Dropdown
│ └──────────────────────────────────┘ │
│                                      │
│ API Key                              │
│ ┌──────────────────────────────────┐ │
│ │ sk-...                  [Test]   │ │ With test button
│ └──────────────────────────────────┘ │
│ ☑ Save API key (encrypted)          │
│                                      │
│ Base URL (Optional)                  │
│ ┌──────────────────────────────────┐ │
│ │ https://api.openai.com/v1        │ │ For custom endpoints
│ └──────────────────────────────────┘ │
│                                      │
│ Model                                │
│ ┌──────────────────────────────────┐ │
│ │ gpt-4-turbo-preview  ▼           │ │ Provider-specific
│ └──────────────────────────────────┘ │
│                                      │
│ System Prompt                        │
│ ┌──────────────────────────────────┐ │
│ │ You are a helpful assistant...   │ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Temperature: 0.7                     │
│ ├────────●─────────┤                │ Slider
│                                      │
│ Max Tokens: 4000                     │
│ ┌──────────────────────────────────┐ │
│ │ 4000                             │ │
│ └──────────────────────────────────┘ │
│                                      │
│ [Save Preset] [Clear Chat]           │
│                                      │
└──────────────────────────────────────┘
```

### Provider Options

**Supported Providers:**

1. **OpenAI**
   - API: `https://api.openai.com/v1`
   - Models: GPT-4 Turbo, GPT-4, GPT-3.5 Turbo
   - Features: Vision, function calling, JSON mode

2. **Anthropic**
   - API: `https://api.anthropic.com/v1`
   - Models: Claude 3 Opus, Sonnet, Haiku
   - Features: Long context (200k), vision

3. **OpenRouter**
   - API: `https://openrouter.ai/api/v1`
   - Models: All providers (GPT-4, Claude, Llama, Mistral, etc.)
   - Features: Unified access, per-request provider selection

4. **Local (Ollama)**
   - API: `http://localhost:11434/v1`
   - Models: Llama 2, Mistral, CodeLlama, etc.
   - Features: Privacy, no API costs, offline

5. **Custom OpenAI-Compatible**
   - API: User-specified
   - Models: User-specified
   - Features: Works with any OpenAI-compatible API (LM Studio, LocalAI, vLLM)

### Header Display

```
┌─────────────────────────────────────────────────┐
│ 🤖 GPT-4 Turbo (OpenAI)    [⚙️] [Clear] [×]    │
│    1,234 tokens • $0.02                         │
└─────────────────────────────────────────────────┘
```

Shows:
- Current model + provider
- Token usage + estimated cost
- Config button to change settings

## Type System

```typescript
// src/types/llm.ts

export type LLMProvider =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "ollama"
  | "custom";

export interface ProviderConfig {
  provider: LLMProvider;
  apiKey?: string;      // Not needed for local models
  baseUrl?: string;     // Custom endpoint
  organization?: string; // OpenAI org ID
}

export interface ModelInfo {
  id: string;           // "gpt-4-turbo-preview"
  name: string;         // "GPT-4 Turbo"
  provider: LLMProvider;
  contextWindow: number; // 128000
  inputCostPer1k: number; // 0.01
  outputCostPer1k: number; // 0.03
  supportsVision: boolean;
  supportsFunctions: boolean;
  supportsStreaming: boolean;
}

export interface LLMConfig {
  provider: ProviderConfig;
  model: string;
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
  topP?: number;        // For models that support it
  presencePenalty?: number; // OpenAI specific
  frequencyPenalty?: number; // OpenAI specific
}

export interface LLMMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost?: number;        // Estimated cost in USD
  model?: string;       // Model used for this message
  provider?: LLMProvider; // Provider used
  streaming?: boolean;
  error?: string;
}

export interface LLMConversation {
  id: string;
  title: string;
  messages: LLMMessage[];
  config: LLMConfig;    // Current config
  createdAt: number;
  updatedAt: number;
  totalTokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  totalCost: number;    // Running total in USD
}
```

## Provider Abstraction

### Base Provider Interface

```typescript
// src/lib/llm/providers/base-provider.ts

export interface StreamChunk {
  text: string;
  done: boolean;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export abstract class LLMProviderAdapter {
  abstract readonly provider: LLMProvider;
  abstract readonly name: string;

  /**
   * Get available models for this provider
   */
  abstract getModels(config: ProviderConfig): Promise<ModelInfo[]>;

  /**
   * Test API connection and credentials
   */
  abstract testConnection(config: ProviderConfig): Promise<boolean>;

  /**
   * Stream completion from the provider
   */
  abstract streamCompletion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): AsyncGenerator<StreamChunk>;

  /**
   * Non-streaming completion (fallback)
   */
  abstract completion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): Promise<string>;

  /**
   * Calculate estimated cost for a message
   */
  calculateCost(model: ModelInfo, tokens: { prompt: number; completion: number }): number {
    const promptCost = (tokens.prompt / 1000) * model.inputCostPer1k;
    const completionCost = (tokens.completion / 1000) * model.outputCostPer1k;
    return promptCost + completionCost;
  }
}
```

### OpenAI Provider Implementation

```typescript
// src/lib/llm/providers/openai-provider.ts

import OpenAI from "openai";
import type { LLMProviderAdapter, StreamChunk, ChatMessage } from "./base-provider";

const OPENAI_MODELS: ModelInfo[] = [
  {
    id: "gpt-4-turbo-preview",
    name: "GPT-4 Turbo",
    provider: "openai",
    contextWindow: 128000,
    inputCostPer1k: 0.01,
    outputCostPer1k: 0.03,
    supportsVision: true,
    supportsFunctions: true,
    supportsStreaming: true,
  },
  {
    id: "gpt-4",
    name: "GPT-4",
    provider: "openai",
    contextWindow: 8192,
    inputCostPer1k: 0.03,
    outputCostPer1k: 0.06,
    supportsVision: false,
    supportsFunctions: true,
    supportsStreaming: true,
  },
  {
    id: "gpt-3.5-turbo",
    name: "GPT-3.5 Turbo",
    provider: "openai",
    contextWindow: 16385,
    inputCostPer1k: 0.0005,
    outputCostPer1k: 0.0015,
    supportsVision: false,
    supportsFunctions: true,
    supportsStreaming: true,
  },
];

export class OpenAIProvider implements LLMProviderAdapter {
  readonly provider = "openai" as const;
  readonly name = "OpenAI";

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    // Could fetch dynamically from API, but static list is more reliable
    return OPENAI_MODELS;
  }

  async testConnection(config: ProviderConfig): Promise<boolean> {
    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        organization: config.organization,
      });

      // Simple test request
      await client.models.list();
      return true;
    } catch (error) {
      console.error("OpenAI connection test failed:", error);
      return false;
    }
  }

  async *streamCompletion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): AsyncGenerator<StreamChunk> {
    const client = new OpenAI({
      apiKey: config.provider.apiKey,
      baseURL: config.provider.baseUrl,
      organization: config.provider.organization,
    });

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
        presence_penalty: config.presencePenalty,
        frequency_penalty: config.frequencyPenalty,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield {
            text: delta.content,
            done: false,
          };
        }

        // Final chunk includes usage
        if (chunk.usage) {
          yield {
            text: "",
            done: true,
            usage: {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
            },
          };
        }
      }

      yield { text: "", done: true };
    } catch (error) {
      yield {
        text: "",
        done: true,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async completion(messages: ChatMessage[], config: LLMConfig): Promise<string> {
    const client = new OpenAI({
      apiKey: config.provider.apiKey,
      baseURL: config.provider.baseUrl,
      organization: config.provider.organization,
    });

    const response = await client.chat.completions.create({
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });

    return response.choices[0]?.message?.content || "";
  }
}
```

### Anthropic Provider Implementation

```typescript
// src/lib/llm/providers/anthropic-provider.ts

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProviderAdapter, StreamChunk, ChatMessage } from "./base-provider";

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: "claude-3-opus-20240229",
    name: "Claude 3 Opus",
    provider: "anthropic",
    contextWindow: 200000,
    inputCostPer1k: 0.015,
    outputCostPer1k: 0.075,
    supportsVision: true,
    supportsFunctions: false,
    supportsStreaming: true,
  },
  {
    id: "claude-3-sonnet-20240229",
    name: "Claude 3 Sonnet",
    provider: "anthropic",
    contextWindow: 200000,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    supportsVision: true,
    supportsFunctions: false,
    supportsStreaming: true,
  },
  {
    id: "claude-3-haiku-20240307",
    name: "Claude 3 Haiku",
    provider: "anthropic",
    contextWindow: 200000,
    inputCostPer1k: 0.00025,
    outputCostPer1k: 0.00125,
    supportsVision: true,
    supportsFunctions: false,
    supportsStreaming: true,
  },
];

export class AnthropicProvider implements LLMProviderAdapter {
  readonly provider = "anthropic" as const;
  readonly name = "Anthropic";

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  async testConnection(config: ProviderConfig): Promise<boolean> {
    try {
      const client = new Anthropic({
        apiKey: config.apiKey,
      });

      // Test with minimal request
      await client.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });

      return true;
    } catch (error) {
      console.error("Anthropic connection test failed:", error);
      return false;
    }
  }

  async *streamCompletion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): AsyncGenerator<StreamChunk> {
    const client = new Anthropic({
      apiKey: config.provider.apiKey,
    });

    // Anthropic requires system message separate
    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    try {
      const stream = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        top_p: config.topP,
        system: systemMessage?.content,
        messages: chatMessages.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        })),
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          yield {
            text: event.delta.text,
            done: false,
          };
        }

        if (event.type === "message_delta") {
          // Usage info available in message_delta
          yield {
            text: "",
            done: true,
            usage: {
              promptTokens: event.usage?.input_tokens || 0,
              completionTokens: event.usage?.output_tokens || 0,
            },
          };
        }
      }

      yield { text: "", done: true };
    } catch (error) {
      yield {
        text: "",
        done: true,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async completion(messages: ChatMessage[], config: LLMConfig): Promise<string> {
    const client = new Anthropic({
      apiKey: config.provider.apiKey,
    });

    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemMessage?.content,
      messages: chatMessages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
    });

    return response.content[0].type === "text" ? response.content[0].text : "";
  }
}
```

### Ollama Provider (Local Models)

```typescript
// src/lib/llm/providers/ollama-provider.ts

import type { LLMProviderAdapter, StreamChunk, ChatMessage } from "./base-provider";

export class OllamaProvider implements LLMProviderAdapter {
  readonly provider = "ollama" as const;
  readonly name = "Ollama (Local)";

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    try {
      const baseUrl = config.baseUrl || "http://localhost:11434";
      const response = await fetch(`${baseUrl}/api/tags`);
      const data = await response.json();

      return data.models.map((model: any) => ({
        id: model.name,
        name: model.name,
        provider: "ollama",
        contextWindow: 4096, // Default, could parse from model
        inputCostPer1k: 0,   // Local = free
        outputCostPer1k: 0,
        supportsVision: false,
        supportsFunctions: false,
        supportsStreaming: true,
      }));
    } catch (error) {
      console.error("Failed to fetch Ollama models:", error);
      return [];
    }
  }

  async testConnection(config: ProviderConfig): Promise<boolean> {
    try {
      const baseUrl = config.baseUrl || "http://localhost:11434";
      const response = await fetch(`${baseUrl}/api/tags`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async *streamCompletion(
    messages: ChatMessage[],
    config: LLMConfig,
  ): AsyncGenerator<StreamChunk> {
    const baseUrl = config.provider.baseUrl || "http://localhost:11434";

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
          options: {
            temperature: config.temperature,
            num_predict: config.maxTokens,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const chunk = JSON.parse(line);
          if (chunk.message?.content) {
            yield {
              text: chunk.message.content,
              done: false,
            };
          }

          if (chunk.done) {
            yield { text: "", done: true };
          }
        }
      }
    } catch (error) {
      yield {
        text: "",
        done: true,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async completion(messages: ChatMessage[], config: LLMConfig): Promise<string> {
    const baseUrl = config.provider.baseUrl || "http://localhost:11434";

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
      }),
    });

    const data = await response.json();
    return data.message?.content || "";
  }
}
```

## Provider Registry

```typescript
// src/lib/llm/providers/registry.ts

import { OpenAIProvider } from "./openai-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { OllamaProvider } from "./ollama-provider";
import type { LLMProviderAdapter } from "./base-provider";

const providers = new Map<LLMProvider, LLMProviderAdapter>([
  ["openai", new OpenAIProvider()],
  ["anthropic", new AnthropicProvider()],
  ["ollama", new OllamaProvider()],
  // Add more as needed
]);

export function getProvider(type: LLMProvider): LLMProviderAdapter {
  const provider = providers.get(type);
  if (!provider) {
    throw new Error(`Provider not found: ${type}`);
  }
  return provider;
}

export function getAllProviders(): LLMProviderAdapter[] {
  return Array.from(providers.values());
}
```

## Enhanced Config Panel Component

```typescript
// src/components/llm/ConfigPanel.tsx

import { useState, useEffect } from "react";
import { getProvider, getAllProviders } from "@/lib/llm/providers/registry";
import type { LLMConfig, ProviderConfig, ModelInfo } from "@/types/llm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";

interface ConfigPanelProps {
  config: LLMConfig;
  onChange: (config: LLMConfig) => void;
  onClear: () => void;
}

export function ConfigPanel({ config, onChange, onClear }: ConfigPanelProps) {
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "failure" | null>(null);

  // Load models when provider changes
  useEffect(() => {
    async function loadModels() {
      try {
        const provider = getProvider(config.provider.provider);
        const models = await provider.getModels(config.provider);
        setAvailableModels(models);
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
    } catch (error) {
      setTestResult("failure");
    } finally {
      setTesting(false);
    }
  }

  const providers = getAllProviders();
  const currentModel = availableModels.find((m) => m.id === config.model);

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {/* Provider Selection */}
      <div>
        <Label>Provider</Label>
        <Select
          value={config.provider.provider}
          onChange={(value) =>
            onChange({
              ...config,
              provider: { ...config.provider, provider: value },
            })
          }
        >
          {providers.map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      {/* API Key (if not local) */}
      {config.provider.provider !== "ollama" && (
        <div>
          <Label>API Key</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              value={config.provider.apiKey || ""}
              onChange={(e) =>
                onChange({
                  ...config,
                  provider: { ...config.provider, apiKey: e.target.value },
                })
              }
              placeholder="sk-..."
            />
            <Button
              onClick={handleTestConnection}
              disabled={testing || !config.provider.apiKey}
              variant="outline"
            >
              {testing ? "Testing..." : "Test"}
            </Button>
          </div>
          {testResult === "success" && (
            <p className="text-xs text-green-500 mt-1">✓ Connection successful</p>
          )}
          {testResult === "failure" && (
            <p className="text-xs text-red-500 mt-1">✗ Connection failed</p>
          )}
        </div>
      )}

      {/* Base URL (optional) */}
      <div>
        <Label>Base URL (Optional)</Label>
        <Input
          value={config.provider.baseUrl || ""}
          onChange={(e) =>
            onChange({
              ...config,
              provider: { ...config.provider, baseUrl: e.target.value },
            })
          }
          placeholder={
            config.provider.provider === "ollama"
              ? "http://localhost:11434"
              : "https://api.openai.com/v1"
          }
        />
        <p className="text-xs text-muted-foreground mt-1">
          For custom endpoints or local servers
        </p>
      </div>

      {/* Model Selection */}
      <div>
        <Label>Model</Label>
        <Select
          value={config.model}
          onChange={(value) => onChange({ ...config, model: value })}
        >
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        {currentModel && (
          <div className="text-xs text-muted-foreground mt-1">
            Context: {currentModel.contextWindow.toLocaleString()} tokens
            {currentModel.inputCostPer1k > 0 && (
              <> • ${currentModel.inputCostPer1k}/1k in, ${currentModel.outputCostPer1k}/1k out</>
            )}
          </div>
        )}
      </div>

      {/* System Prompt */}
      <div>
        <Label>System Prompt</Label>
        <Textarea
          value={config.systemPrompt || ""}
          onChange={(e) => onChange({ ...config, systemPrompt: e.target.value })}
          placeholder="You are a helpful assistant..."
          rows={4}
        />
      </div>

      {/* Temperature */}
      <div>
        <Label>Temperature: {config.temperature}</Label>
        <Slider
          min={0}
          max={2}
          step={0.1}
          value={[config.temperature]}
          onValueChange={([value]) => onChange({ ...config, temperature: value })}
        />
        <p className="text-xs text-muted-foreground mt-1">
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
            onChange({ ...config, maxTokens: parseInt(e.target.value) })
          }
          min={1}
          max={currentModel?.contextWindow || 4096}
        />
      </div>

      {/* Clear Conversation */}
      <Button onClick={onClear} variant="destructive" className="mt-4">
        Clear Conversation
      </Button>
    </div>
  );
}
```

## API Key Management

### Secure Storage

```typescript
// src/services/api-key-storage.ts

/**
 * Store API keys securely in localStorage with basic encryption
 * NOTE: This is NOT truly secure - keys are still accessible via devtools
 * For production, recommend using a secure backend or browser extension
 */

// Simple XOR encryption (better than plaintext, but not cryptographically secure)
function simpleEncrypt(text: string, key: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
}

function simpleDecrypt(encrypted: string, key: string): string {
  const decoded = atob(encrypted);
  let result = "";
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

const STORAGE_KEY = "grimoire:llm:api-keys";
const ENCRYPTION_KEY = "grimoire-llm-chat"; // In production, generate per-user

export function saveApiKey(provider: LLMProvider, apiKey: string) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const keys = stored ? JSON.parse(stored) : {};
    keys[provider] = simpleEncrypt(apiKey, ENCRYPTION_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch (error) {
    console.error("Failed to save API key:", error);
  }
}

export function loadApiKey(provider: LLMProvider): string | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return undefined;
    const keys = JSON.parse(stored);
    const encrypted = keys[provider];
    if (!encrypted) return undefined;
    return simpleDecrypt(encrypted, ENCRYPTION_KEY);
  } catch (error) {
    console.error("Failed to load API key:", error);
    return undefined;
  }
}

export function deleteApiKey(provider: LLMProvider) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const keys = JSON.parse(stored);
    delete keys[provider];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch (error) {
    console.error("Failed to delete API key:", error);
  }
}
```

## Cost Tracking

```typescript
// src/lib/llm/cost-tracker.ts

import type { LLMMessage, ModelInfo } from "@/types/llm";

export interface CostBreakdown {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCost: number;
  completionCost: number;
  totalCost: number;
}

export function calculateMessageCost(
  message: LLMMessage,
  model: ModelInfo,
): CostBreakdown {
  const promptTokens = message.tokens?.prompt || 0;
  const completionTokens = message.tokens?.completion || 0;
  const totalTokens = message.tokens?.total || 0;

  const promptCost = (promptTokens / 1000) * model.inputCostPer1k;
  const completionCost = (completionTokens / 1000) * model.outputCostPer1k;
  const totalCost = promptCost + completionCost;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptCost,
    completionCost,
    totalCost,
  };
}

export function formatCost(cost: number): string {
  if (cost === 0) return "Free";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
```

## Command Integration

```typescript
// src/lib/llm-parser.ts

export interface LLMCommandResult {
  conversationId?: string;
  provider?: LLMProvider;
  model?: string;
}

export function parseLLMCommand(args: string[]): LLMCommandResult {
  if (args.length === 0) {
    // New conversation with default settings
    return {};
  }

  // If first arg looks like an ID, resume conversation
  if (args[0].match(/^[a-f0-9-]{36}$/)) {
    return { conversationId: args[0] };
  }

  // Otherwise parse as provider/model specification
  // Examples:
  //   llm openai
  //   llm anthropic/claude-3-opus-20240229
  //   llm ollama/llama2

  const [providerOrModel, model] = args[0].split("/");

  // Check if it's a provider name
  const validProviders: LLMProvider[] = ["openai", "anthropic", "ollama", "openrouter"];
  if (validProviders.includes(providerOrModel as LLMProvider)) {
    return {
      provider: providerOrModel as LLMProvider,
      model,
    };
  }

  throw new Error(
    `Invalid LLM command. Usage:
    llm                    # New conversation
    llm <id>               # Resume conversation
    llm <provider>         # New with provider
    llm <provider>/<model> # New with provider and model`,
  );
}
```

## Example Usage

### Command Examples

```bash
# Start new conversation with default (last used) provider
llm

# Start with specific provider
llm openai
llm anthropic
llm ollama

# Start with specific model
llm openai/gpt-4-turbo-preview
llm anthropic/claude-3-opus-20240229
llm ollama/llama2

# Resume existing conversation
llm abc123-def456-...
```

### Header Display Examples

```
OpenAI (GPT-4 Turbo)     │ 1,234 tokens • $0.02
Anthropic (Claude Opus)  │ 5,678 tokens • $0.15
Ollama (Llama 2)         │ 2,345 tokens • Free
```

## Implementation Checklist

- [ ] Define provider types and interfaces
- [ ] Implement base provider adapter class
- [ ] Implement OpenAI provider
- [ ] Implement Anthropic provider
- [ ] Implement Ollama provider (local)
- [ ] Create provider registry
- [ ] Build enhanced config panel with provider selection
- [ ] Add API key storage (encrypted)
- [ ] Implement cost tracking per message
- [ ] Display cost/token usage in header
- [ ] Add model info tooltips (context window, pricing)
- [ ] Test connection button for each provider
- [ ] Handle provider-specific errors gracefully
- [ ] Add model list auto-refresh
- [ ] Support custom OpenAI-compatible endpoints
- [ ] Add preset saving/loading
- [ ] Document provider setup instructions

## Security Considerations

1. **API Keys**: Currently stored in localStorage with basic XOR encryption
   - ⚠️ Still accessible via devtools
   - ✅ Better than plaintext
   - 🎯 Future: Browser extension or secure backend

2. **CORS**: Local Ollama requires CORS headers
   - Add `Access-Control-Allow-Origin: *` to Ollama config

3. **Rate Limits**: Providers have different limits
   - Track requests per minute
   - Show warnings when approaching limits

4. **Error Messages**: Don't expose API keys in error logs

## Future Enhancements

1. **Vision Support**: Upload images for GPT-4V, Claude 3
2. **Function Calling**: Define tools for OpenAI models
3. **Multi-Modal**: Audio input/output (Whisper, TTS)
4. **Context Management**: Summarization when approaching token limit
5. **Prompt Templates**: Save/share system prompts
6. **Conversation Export**: Export to markdown, JSON, PDF
7. **Conversation Sharing**: Generate shareable links
8. **Model Comparison**: Side-by-side comparison mode
9. **Cost Alerts**: Warn when conversation exceeds budget
10. **Local Model Fine-Tuning**: Upload custom Ollama models
