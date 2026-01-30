/**
 * AI Provider Presets
 *
 * Pre-configured OpenAI-compatible providers that users can add with one click.
 * All providers use the standard OpenAI API format.
 */

export interface AIProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  apiKeysURL?: string;
  docsURL?: string;
  description?: string;
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "ppq",
    name: "PPQ.ai",
    baseURL: "https://api.ppq.ai",
    apiKeysURL: "https://ppq.ai/api-docs",
    docsURL: "https://ppq.ai/api-docs",
    description: "Pay-per-query API with Lightning payments",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeysURL: "https://openrouter.ai/settings/keys",
    docsURL: "https://openrouter.ai/docs",
    description: "Access 200+ models from one API",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKeysURL: "https://platform.openai.com/api-keys",
    docsURL: "https://platform.openai.com/docs",
    description: "GPT-4o, GPT-4, o1, and more",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKeysURL: "https://console.anthropic.com/settings/keys",
    docsURL: "https://docs.anthropic.com",
    description: "Claude 3.5 Sonnet, Opus, Haiku",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    apiKeysURL: "https://platform.deepseek.com/api_keys",
    docsURL: "https://platform.deepseek.com/api-docs",
    description: "DeepSeek V3 and Coder models",
  },
  {
    id: "groq",
    name: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeysURL: "https://console.groq.com/keys",
    docsURL: "https://console.groq.com/docs",
    description: "Ultra-fast inference with Llama, Mixtral",
  },
  {
    id: "together",
    name: "Together AI",
    baseURL: "https://api.together.xyz/v1",
    apiKeysURL: "https://api.together.xyz/settings/api-keys",
    docsURL: "https://docs.together.ai",
    description: "Open-source models at scale",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    baseURL: "https://api.fireworks.ai/inference/v1",
    apiKeysURL: "https://fireworks.ai/api-keys",
    docsURL: "https://docs.fireworks.ai",
    description: "Fast inference for open models",
  },
  {
    id: "xai",
    name: "xAI",
    baseURL: "https://api.x.ai/v1",
    apiKeysURL: "https://console.x.ai",
    docsURL: "https://docs.x.ai",
    description: "Grok models",
  },
  {
    id: "custom",
    name: "Custom Provider",
    baseURL: "",
    description: "Any OpenAI-compatible API",
  },
];

export function getProviderPreset(id: string): AIProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id);
}
