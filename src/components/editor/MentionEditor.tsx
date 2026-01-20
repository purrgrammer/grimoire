/**
 * MentionEditor - Backward compatibility wrapper around NostrEditor
 *
 * This file provides the legacy MentionEditor API while using NostrEditor internally.
 * New code should import from NostrEditor and use the new API directly.
 *
 * @deprecated Use NostrEditor from "./NostrEditor" instead
 */

import { forwardRef, useMemo, useCallback } from "react";
import { NostrEditor, type NostrEditorProps } from "./NostrEditor";
import { createNostrSuggestions } from "./suggestions";
import type { ProfileSearchResult } from "@/services/profile-search";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { ChatAction } from "@/types/chat-actions";

// Re-export types from the new location for backward compatibility
export type {
  EmojiTag,
  BlobAttachment,
  SerializedContent,
  NostrEditorHandle as MentionEditorHandle,
} from "./types";

/**
 * @deprecated Use NostrEditorProps instead
 */
export interface MentionEditorProps {
  placeholder?: string;
  onSubmit?: (
    content: string,
    emojiTags: import("./types").EmojiTag[],
    blobAttachments: import("./types").BlobAttachment[],
  ) => void;
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  searchEmojis?: (query: string) => Promise<EmojiSearchResult[]>;
  searchCommands?: (query: string) => Promise<ChatAction[]>;
  onCommandExecute?: (action: ChatAction) => Promise<void>;
  autoFocus?: boolean;
  className?: string;
}

/**
 * MentionEditor - Legacy chat composer component
 *
 * @deprecated Use NostrEditor instead with the new API:
 *
 * ```tsx
 * import { NostrEditor } from "./editor/NostrEditor";
 * import { createNostrSuggestions } from "./editor/suggestions";
 *
 * const suggestions = createNostrSuggestions({
 *   searchProfiles,
 *   searchEmojis,
 *   searchCommands,
 *   onCommandExecute,
 * });
 *
 * <NostrEditor
 *   suggestions={suggestions}
 *   submitBehavior="enter"
 *   variant="inline"
 *   onSubmit={(content) => handleSend(content.text, content.emojiTags, content.blobAttachments)}
 * />
 * ```
 */
export const MentionEditor = forwardRef<
  import("./types").NostrEditorHandle,
  MentionEditorProps
>(
  (
    {
      placeholder = "Type a message...",
      onSubmit,
      searchProfiles,
      searchEmojis,
      searchCommands,
      onCommandExecute,
      autoFocus = false,
      className = "",
    },
    ref,
  ) => {
    // Create suggestions configuration
    const suggestions = useMemo(
      () =>
        createNostrSuggestions({
          searchProfiles,
          searchEmojis,
          searchCommands,
          onCommandExecute,
        }),
      [searchProfiles, searchEmojis, searchCommands, onCommandExecute],
    );

    // Adapt the old onSubmit signature to the new one
    const handleSubmit = useCallback<NonNullable<NostrEditorProps["onSubmit"]>>(
      (content) => {
        if (onSubmit) {
          onSubmit(content.text, content.emojiTags, content.blobAttachments);
        }
      },
      [onSubmit],
    );

    return (
      <NostrEditor
        ref={ref}
        placeholder={placeholder}
        suggestions={suggestions}
        submitBehavior="enter"
        variant="inline"
        blobPreview="compact"
        onSubmit={handleSubmit}
        autoFocus={autoFocus}
        className={className}
      />
    );
  },
);

MentionEditor.displayName = "MentionEditor";
