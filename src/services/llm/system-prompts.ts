/**
 * System Prompts for AI Chat
 *
 * Manages built-in and custom system prompts.
 * The Grimoire prompt is dynamically constructed with protocol knowledge.
 */

import { BehaviorSubject } from "rxjs";
import db from "@/services/db";
import { toolRegistry } from "./tools";
import { manPages } from "@/types/man";
import { EVENT_KINDS } from "@/constants/kinds";
import { NIP_TITLES } from "@/constants/nips";
import type { LLMSystemPrompt } from "@/types/llm";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Special ID for the built-in Grimoire prompt */
export const GRIMOIRE_PROMPT_ID = "grimoire";

/** Special ID for "no system prompt" */
export const NO_PROMPT_ID = "none";

// ─────────────────────────────────────────────────────────────
// Grimoire Prompt Builder
// ─────────────────────────────────────────────────────────────

/**
 * Build the dynamic Grimoire system prompt.
 * Includes Nostr protocol knowledge, available commands, and tools.
 */
export function buildGrimoirePrompt(): string {
  const sections: string[] = [];

  // Introduction
  sections.push(`You are an AI assistant running inside Grimoire, a Nostr protocol explorer and developer tool. Grimoire is a tiling window manager where each window is a Nostr "app" (profile viewer, event feed, relay inspector, etc.). Commands are launched via Cmd+K palette.

You have access to tools that can interact with the Nostr network on behalf of the user. Use them when helpful.`);

  // Nostr Protocol Overview
  sections.push(`## Nostr Protocol Basics

Nostr (Notes and Other Stuff Transmitted by Relays) is a decentralized social protocol:

- **Events**: All data is stored as signed JSON events with: id, pubkey, created_at, kind, tags, content, sig
- **Kinds**: Event types identified by number (0=profile, 1=note, 3=follows, 7=reaction, etc.)
- **Relays**: WebSocket servers that store and forward events. Users choose which relays to use.
- **Keys**: Users have keypairs (npub/nsec in bech32). Public key = identity.
- **Tags**: Metadata arrays like ["e", "<event-id>"], ["p", "<pubkey>"], ["t", "<hashtag>"]
- **NIPs**: Nostr Implementation Possibilities - protocol specifications`);

  // Common Event Kinds
  const commonKinds = [0, 1, 3, 4, 5, 6, 7, 9735, 10002, 30023];
  const kindLines = commonKinds
    .map((k) => {
      const info = EVENT_KINDS[k];
      if (!info) return null;
      return `- Kind ${k}: ${info.name} - ${info.description}`;
    })
    .filter(Boolean);

  if (kindLines.length > 0) {
    sections.push(`## Common Event Kinds

${kindLines.join("\n")}`);
  }

  // Key NIPs
  const keyNips = ["01", "02", "05", "10", "19", "21", "23", "25", "57", "65"];
  const nipLines = keyNips
    .map((n) => {
      const title = NIP_TITLES[n];
      if (!title) return null;
      return `- NIP-${n}: ${title}`;
    })
    .filter(Boolean);

  if (nipLines.length > 0) {
    sections.push(`## Key NIPs (Protocol Specs)

${nipLines.join("\n")}

Use the \`nip <number>\` command to read full NIP specifications.`);
  }

  // Available Grimoire Commands
  const commandCategories = {
    Documentation: [] as string[],
    Nostr: [] as string[],
    System: [] as string[],
  };

  for (const [cmd, page] of Object.entries(manPages)) {
    const line = `- \`${cmd}\`: ${page.description.split(".")[0]}`;
    if (page.category in commandCategories) {
      commandCategories[page.category as keyof typeof commandCategories].push(
        line,
      );
    }
  }

  const commandSections: string[] = [];
  if (commandCategories.Documentation.length > 0) {
    commandSections.push(
      `**Documentation**\n${commandCategories.Documentation.join("\n")}`,
    );
  }
  if (commandCategories.Nostr.length > 0) {
    commandSections.push(
      `**Nostr Operations**\n${commandCategories.Nostr.join("\n")}`,
    );
  }
  if (commandCategories.System.length > 0) {
    commandSections.push(`**System**\n${commandCategories.System.join("\n")}`);
  }

  if (commandSections.length > 0) {
    sections.push(`## Grimoire Commands

Users can run these commands via Cmd+K:

${commandSections.join("\n\n")}`);
  }

  // Available Tools
  const tools = toolRegistry.getAll();
  if (tools.length > 0) {
    const toolLines = tools.map((t) => `- \`${t.name}\`: ${t.description}`);
    sections.push(`## Available Tools

You can use these tools to help the user:

${toolLines.join("\n")}`);
  }

  // Guidelines
  sections.push(`## Guidelines

- Be concise and helpful
- When discussing Nostr, use correct terminology (events, kinds, relays, pubkeys)
- Suggest relevant Grimoire commands when appropriate
- Use tools proactively when they can help answer questions
- If asked about NIPs or kinds, you can suggest the user view them with \`nip <n>\` or \`kind <n>\``);

  return sections.join("\n\n");
}

// ─────────────────────────────────────────────────────────────
// System Prompt Manager
// ─────────────────────────────────────────────────────────────

class SystemPromptManager {
  /** All prompts (built-in + custom) */
  prompts$ = new BehaviorSubject<LLMSystemPrompt[]>([]);

  private initialized = false;

  /**
   * Initialize and load prompts from Dexie.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.loadPrompts();
  }

  /**
   * Load prompts from Dexie and add built-in prompts.
   */
  async loadPrompts(): Promise<void> {
    const customPrompts = await db.llmSystemPrompts.toArray();

    // Create the Grimoire built-in prompt
    const grimoirePrompt: LLMSystemPrompt = {
      id: GRIMOIRE_PROMPT_ID,
      name: "Grimoire Assistant",
      description: "Nostr-aware AI with protocol knowledge and tools",
      content: buildGrimoirePrompt(),
      isBuiltin: true,
      createdAt: 0,
      updatedAt: Date.now(),
    };

    // Combine built-in + custom, built-in first
    const allPrompts = [
      grimoirePrompt,
      ...customPrompts.filter((p) => !p.isBuiltin),
    ];

    this.prompts$.next(allPrompts);
  }

  /**
   * Get a prompt by ID.
   */
  getPrompt(id: string): LLMSystemPrompt | undefined {
    if (id === GRIMOIRE_PROMPT_ID) {
      return {
        id: GRIMOIRE_PROMPT_ID,
        name: "Grimoire Assistant",
        description: "Nostr-aware AI with protocol knowledge and tools",
        content: buildGrimoirePrompt(),
        isBuiltin: true,
        createdAt: 0,
        updatedAt: Date.now(),
      };
    }

    return this.prompts$.value.find((p) => p.id === id);
  }

  /**
   * Get the content of a prompt by ID.
   * Returns undefined for NO_PROMPT_ID or unknown IDs.
   */
  getPromptContent(id: string | undefined): string | undefined {
    if (!id || id === NO_PROMPT_ID) return undefined;

    const prompt = this.getPrompt(id);
    return prompt?.content;
  }

  /**
   * Create a new custom prompt.
   */
  async createPrompt(
    name: string,
    content: string,
    description?: string,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    const prompt: LLMSystemPrompt = {
      id,
      name,
      content,
      description,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.llmSystemPrompts.add(prompt);
    await this.loadPrompts();

    return id;
  }

  /**
   * Update a custom prompt.
   */
  async updatePrompt(
    id: string,
    updates: Partial<Pick<LLMSystemPrompt, "name" | "content" | "description">>,
  ): Promise<void> {
    const prompt = await db.llmSystemPrompts.get(id);
    if (!prompt || prompt.isBuiltin) {
      throw new Error("Cannot update built-in or non-existent prompt");
    }

    await db.llmSystemPrompts.update(id, {
      ...updates,
      updatedAt: Date.now(),
    });

    await this.loadPrompts();
  }

  /**
   * Delete a custom prompt.
   */
  async deletePrompt(id: string): Promise<void> {
    const prompt = await db.llmSystemPrompts.get(id);
    if (!prompt) return;
    if (prompt.isBuiltin) {
      throw new Error("Cannot delete built-in prompt");
    }

    await db.llmSystemPrompts.delete(id);
    await this.loadPrompts();
  }
}

// Singleton instance
export const systemPromptManager = new SystemPromptManager();

// Initialize on import
systemPromptManager.init();
