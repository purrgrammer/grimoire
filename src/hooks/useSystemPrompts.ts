/**
 * React hooks for system prompts
 */

import { useCallback, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import {
  systemPromptManager,
  GRIMOIRE_PROMPT_ID,
  NO_PROMPT_ID,
} from "@/services/llm/system-prompts";
import type { LLMSystemPrompt } from "@/types/llm";

export { GRIMOIRE_PROMPT_ID, NO_PROMPT_ID };

// ─────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────

interface UseSystemPromptsResult {
  /** All available prompts (built-in + custom) */
  prompts: LLMSystemPrompt[];

  /** Get a specific prompt by ID */
  getPrompt: (id: string) => LLMSystemPrompt | undefined;

  /** Get the content of a prompt by ID */
  getPromptContent: (id: string | undefined) => string | undefined;

  /** Create a new custom prompt */
  createPrompt: (
    name: string,
    content: string,
    description?: string,
  ) => Promise<string>;

  /** Update an existing prompt */
  updatePrompt: (
    id: string,
    updates: Partial<Pick<LLMSystemPrompt, "name" | "content" | "description">>,
  ) => Promise<void>;

  /** Delete a custom prompt */
  deletePrompt: (id: string) => Promise<void>;
}

/**
 * Hook to access and manage system prompts.
 */
export function useSystemPrompts(): UseSystemPromptsResult {
  const prompts = use$(systemPromptManager.prompts$) ?? [];

  const getPrompt = useCallback(
    (id: string) => systemPromptManager.getPrompt(id),
    [],
  );

  const getPromptContent = useCallback(
    (id: string | undefined) => systemPromptManager.getPromptContent(id),
    [],
  );

  const createPrompt = useCallback(
    (name: string, content: string, description?: string) =>
      systemPromptManager.createPrompt(name, content, description),
    [],
  );

  const updatePrompt = useCallback(
    (
      id: string,
      updates: Partial<
        Pick<LLMSystemPrompt, "name" | "content" | "description">
      >,
    ) => systemPromptManager.updatePrompt(id, updates),
    [],
  );

  const deletePrompt = useCallback(
    (id: string) => systemPromptManager.deletePrompt(id),
    [],
  );

  return useMemo(
    () => ({
      prompts,
      getPrompt,
      getPromptContent,
      createPrompt,
      updatePrompt,
      deletePrompt,
    }),
    [
      prompts,
      getPrompt,
      getPromptContent,
      createPrompt,
      updatePrompt,
      deletePrompt,
    ],
  );
}

// ─────────────────────────────────────────────────────────────
// Prompt Options Hook (for select dropdowns)
// ─────────────────────────────────────────────────────────────

interface PromptOption {
  id: string;
  name: string;
  description?: string;
  isBuiltin: boolean;
}

/**
 * Hook to get prompt options for selection UI.
 * Includes a "No system prompt" option.
 */
export function usePromptOptions(): PromptOption[] {
  const prompts = use$(systemPromptManager.prompts$) ?? [];

  return useMemo(() => {
    const options: PromptOption[] = prompts.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isBuiltin: p.isBuiltin,
    }));

    // Add "No prompt" option at the end
    options.push({
      id: NO_PROMPT_ID,
      name: "No system prompt",
      description: "Start with a blank context",
      isBuiltin: true,
    });

    return options;
  }, [prompts]);
}
