/**
 * Editor components for Nostr content creation
 *
 * Available editors:
 * - TextEditor: Base rich text editor with mentions, emoji, media (formerly RichEditor)
 * - MarkdownEditor: TextEditor with markdown formatting toolbar
 * - MentionEditor: Lightweight chat/message editor
 *
 * For backwards compatibility, RichEditor is exported as an alias for TextEditor.
 */

// Core types
export type {
  EmojiTag,
  BlobAttachment,
  AddressRef,
  SerializedContent,
  BaseEditorHandle,
  TextEditorHandle,
} from "./core";

// Text editor (main editor for posts, articles, etc.)
export { TextEditor, type TextEditorProps } from "./TextEditor";

// Markdown editor (TextEditor + formatting toolbar)
export {
  MarkdownEditor,
  type MarkdownEditorProps,
  type MarkdownEditorHandle,
} from "./MarkdownEditor";

// Markdown toolbar (can be used standalone)
export { MarkdownToolbar, type MarkdownToolbarProps } from "./MarkdownToolbar";

// Mention editor (lightweight for chat)
export {
  MentionEditor,
  type MentionEditorProps,
  type MentionEditorHandle,
} from "./MentionEditor";

// Backwards compatibility - RichEditor is now TextEditor
export {
  RichEditor,
  type RichEditorHandle,
  type RichEditorProps,
} from "./RichEditor";
