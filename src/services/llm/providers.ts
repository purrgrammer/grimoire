/**
 * Re-export provider presets for backwards compatibility.
 *
 * Provider presets are now defined in @/lib/ai-provider-presets.ts
 */

export {
  AI_PROVIDER_PRESETS as PROVIDER_CONFIGS,
  getProviderPreset as getProviderConfig,
  type AIProviderPreset as LLMProviderConfig,
} from "@/lib/ai-provider-presets";
