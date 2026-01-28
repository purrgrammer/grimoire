/**
 * Core editor utilities and shared code
 */

// Types
export type {
  EmojiTag,
  BlobAttachment,
  AddressRef,
  SerializedContent,
  BaseEditorHandle,
  TextEditorHandle,
} from "./types";

// Extensions
export { EmojiMention } from "./emoji-mention";

// Serialization
export {
  serializeEditorContent,
  serializeEditorContentFromJSON,
  emptySerializedContent,
} from "./serialization";
