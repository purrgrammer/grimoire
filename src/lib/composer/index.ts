/**
 * Composer module - Schema-driven event composition
 *
 * This module provides types and schemas for composing different Nostr event kinds.
 */

// Schema types
export type {
  ComposerSchema,
  ComposerContext,
  ComposerInput,
  ContentType,
  EditorVariant,
  TitleFieldConfig,
  LabelsConfig,
  MetadataConfig,
  CustomFieldConfig,
  ContextBinding,
  ThreadingStyle,
  RelayStrategy,
  MediaConfig,
  EmojiConfig,
  IdentifierConfig,
  DraftConfig,
} from "./schema";

// Utilities
export { slugify } from "./schema";

// Predefined schemas
export {
  NOTE_SCHEMA,
  COMMENT_SCHEMA,
  ISSUE_SCHEMA,
  GROUP_MESSAGE_SCHEMA,
  ARTICLE_SCHEMA,
  WIKI_ARTICLE_SCHEMA,
  SCHEMAS,
  getSchema,
  hasSchema,
} from "./schemas";
