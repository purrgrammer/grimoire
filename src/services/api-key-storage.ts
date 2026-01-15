/**
 * API key storage utilities
 *
 * Stores API keys in localStorage with basic XOR encryption.
 * NOTE: This is NOT cryptographically secure - keys are still accessible via devtools.
 * It's better than plaintext, but for production consider a secure backend.
 */

import type { LLMProvider } from "@/types/llm";

const STORAGE_KEY = "grimoire:llm:api-keys";
const ENCRYPTION_KEY = "grimoire-llm-chat"; // In production, use a per-user key

/**
 * Simple XOR encryption (better than plaintext, not cryptographically secure)
 */
function simpleEncrypt(text: string, key: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(
      text.charCodeAt(i) ^ key.charCodeAt(i % key.length),
    );
  }
  return btoa(result);
}

/**
 * Simple XOR decryption
 */
function simpleDecrypt(encrypted: string, key: string): string {
  const decoded = atob(encrypted);
  let result = "";
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(
      decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length),
    );
  }
  return result;
}

/**
 * Save an API key for a provider
 */
export function saveApiKey(provider: LLMProvider, apiKey: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const keys = stored ? JSON.parse(stored) : {};
    keys[provider] = simpleEncrypt(apiKey, ENCRYPTION_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch (error) {
    console.error("Failed to save API key:", error);
  }
}

/**
 * Load an API key for a provider
 */
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

/**
 * Delete an API key for a provider
 */
export function deleteApiKey(provider: LLMProvider): void {
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

/**
 * Check if an API key exists for a provider
 */
export function hasApiKey(provider: LLMProvider): boolean {
  return loadApiKey(provider) !== undefined;
}
