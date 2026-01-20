/**
 * Default suggestion configurations for NostrEditor
 *
 * These provide ready-to-use configurations for common Nostr autocomplete features:
 * - Profile mentions (@)
 * - Emoji autocomplete (:)
 * - Slash commands (/)
 */

import type { SuggestionConfig } from "./types";
import type { ProfileSearchResult } from "@/services/profile-search";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { ChatAction } from "@/types/chat-actions";
import {
  ProfileSuggestionList,
  type ProfileSuggestionListProps,
} from "./ProfileSuggestionList";
import {
  EmojiSuggestionList,
  type EmojiSuggestionListProps,
} from "./EmojiSuggestionList";
import {
  SlashCommandSuggestionList,
  type SlashCommandSuggestionListProps,
} from "./SlashCommandSuggestionList";

/**
 * Create a profile mention suggestion config (@mentions)
 */
export function createProfileSuggestion(
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>,
): SuggestionConfig<ProfileSearchResult> {
  return {
    char: "@",
    allowSpaces: false,
    search: searchProfiles,
    component:
      ProfileSuggestionList as React.ComponentType<ProfileSuggestionListProps>,
    onSelect: (profile) => ({
      type: "mention",
      attrs: {
        id: profile.pubkey,
        label: profile.displayName,
      },
    }),
    placement: "bottom-start",
  };
}

/**
 * Create an emoji suggestion config (:emoji:)
 */
export function createEmojiSuggestion(
  searchEmojis: (query: string) => Promise<EmojiSearchResult[]>,
): SuggestionConfig<EmojiSearchResult> {
  return {
    char: ":",
    allowSpaces: false,
    search: searchEmojis,
    component:
      EmojiSuggestionList as React.ComponentType<EmojiSuggestionListProps>,
    onSelect: (emoji) => ({
      type: "emoji",
      attrs: {
        id: emoji.shortcode,
        label: emoji.shortcode,
        url: emoji.url,
        source: emoji.source,
      },
    }),
    placement: "bottom-start",
  };
}

/**
 * Create a slash command suggestion config (/commands)
 */
export function createSlashCommandSuggestion(
  searchCommands: (query: string) => Promise<ChatAction[]>,
  onExecute: (action: ChatAction) => Promise<void>,
): SuggestionConfig<ChatAction> {
  return {
    char: "/",
    allowSpaces: false,
    // Only allow at the start of input
    allow: ({ range }) => range.from === 1,
    search: searchCommands,
    component:
      SlashCommandSuggestionList as React.ComponentType<SlashCommandSuggestionListProps>,
    onSelect: (action) => ({
      type: "slashCommand",
      attrs: {
        id: action.name,
        label: action.name,
      },
    }),
    onExecute,
    clearOnSelect: true,
    placement: "top-start",
  };
}

/**
 * Helper to create all standard Nostr editor suggestions
 */
export function createNostrSuggestions(options: {
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  searchEmojis?: (query: string) => Promise<EmojiSearchResult[]>;
  searchCommands?: (query: string) => Promise<ChatAction[]>;
  onCommandExecute?: (action: ChatAction) => Promise<void>;
}): SuggestionConfig<unknown>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const suggestions: SuggestionConfig<any>[] = [
    createProfileSuggestion(options.searchProfiles),
  ];

  if (options.searchEmojis) {
    suggestions.push(createEmojiSuggestion(options.searchEmojis));
  }

  if (options.searchCommands && options.onCommandExecute) {
    suggestions.push(
      createSlashCommandSuggestion(
        options.searchCommands,
        options.onCommandExecute,
      ),
    );
  }

  return suggestions;
}
