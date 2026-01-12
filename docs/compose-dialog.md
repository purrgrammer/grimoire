# Compose/Reply Dialog System

A comprehensive, protocol-aware compose dialog for creating and replying to Nostr events.

## Overview

The compose dialog system provides a unified interface for composing notes, replies, and other Nostr events with automatic threading support for both NIP-10 (kind 1 notes) and NIP-22 (all other kinds).

## Architecture

### Core Components

1. **ComposeDialog** (`src/components/ComposeDialog.tsx`)
   - Main dialog component
   - Rich text editing with MentionEditor
   - Tab-based UI (Edit/Preview)
   - Relay selection
   - Mention management
   - Event publishing

2. **RelaySelector** (`src/components/RelaySelector.tsx`)
   - Visual relay picker with connection status
   - Add/remove relays dynamically
   - Shows relay connection state (connected/connecting/disconnected)
   - Limits maximum relay count

3. **PowerTools** (`src/components/PowerTools.tsx`)
   - Quick access toolbar for formatting
   - Hashtag insertion
   - Profile mention search and insertion
   - Code block insertion
   - Link insertion

4. **Thread Builder** (`src/lib/thread-builder.ts`)
   - Automatic thread tag generation
   - NIP-10 support (kind 1 notes)
   - NIP-22 support (all other kinds)
   - Mention extraction

### Enhanced MentionEditor

Added `insertText(text: string)` method to MentionEditorHandle for programmatic text insertion from PowerTools.

## Features

### ✅ Implemented

- **Rich Text Editing**: TipTap-based editor with @ mentions and : emoji autocomplete
- **Threading**: Automatic NIP-10 (kind 1) and NIP-22 (all others) threading
- **Relay Selection**: Choose which relays to publish to with connection status
- **Mention Management**: Explicit p-tag control with visual badges
- **Preview Mode**: Preview content and tags before publishing
- **Power Tools**: Quick access to hashtags, mentions, code blocks, links
- **Emoji Support**: NIP-30 emoji tags automatically included
- **Reply Context**: Shows who you're replying to with message preview

### 🔮 Future Enhancements

- Media uploads (NIP-94, NIP-95)
- Quote reposts (NIP-48)
- Draft persistence to Dexie
- Rich text formatting toolbar
- Link preview cards
- Poll creation (NIP-69)
- Content warnings (NIP-36)

## Usage

### Basic Compose

```tsx
import { ComposeDialog } from "@/components/compose";
import { useState } from "react";

function MyComponent() {
  const [showCompose, setShowCompose] = useState(false);

  return (
    <>
      <Button onClick={() => setShowCompose(true)}>
        Compose Note
      </Button>

      <ComposeDialog
        open={showCompose}
        onOpenChange={setShowCompose}
        kind={1}
        onPublish={(event) => {
          console.log("Published event:", event.id);
        }}
      />
    </>
  );
}
```

### Reply to Event

```tsx
import { ComposeDialog } from "@/components/compose";
import type { NostrEvent } from "nostr-tools/core";

function ReplyButton({ event }: { event: NostrEvent }) {
  const [showReply, setShowReply] = useState(false);

  return (
    <>
      <Button onClick={() => setShowReply(true)}>
        Reply
      </Button>

      <ComposeDialog
        open={showReply}
        onOpenChange={setShowReply}
        replyTo={event}
        kind={1}
        onPublish={(newEvent) => {
          console.log("Reply published:", newEvent);
        }}
      />
    </>
  );
}
```

### Comment on Non-Note Event (NIP-22)

```tsx
<ComposeDialog
  open={showCompose}
  onOpenChange={setShowCompose}
  replyTo={articleEvent}  // kind 30023 article
  kind={1111}  // Comment kind
  onPublish={(comment) => {
    console.log("Comment published:", comment);
  }}
/>
```

## Threading Behavior

### Kind 1 (Notes) - NIP-10

When replying to a kind 1 note, the dialog automatically adds:

```
["e", "<root-event-id>", "<relay-url>", "root"]
["e", "<reply-to-event-id>", "<relay-url>", "reply"]
["p", "<author-pubkey>"]
["p", "<mentioned-pubkey>", ...]
```

**Thread Structure:**
- Root tag: Points to the thread's first event
- Reply tag: Points to the direct parent event
- P tags: All mentioned users (author + thread participants)

### All Other Kinds - NIP-22

When commenting on other event kinds, the dialog uses NIP-22:

```
["K", "<kind>"]
["E", "<event-id>", "<relay-url>", "<author-pubkey>"]  // OR
["A", "<kind:pubkey:d-tag>", "<relay-url>"]  // For parameterized replaceable
["p", "<author-pubkey>"]
["k", "<kind>"]  // Deprecated, included for compatibility
```

**Behavior:**
- K tag: Kind of the parent event
- E tag: Event pointer (regular/replaceable events)
- A tag: Address pointer (parameterized replaceable events)
- P tags: Mentioned users
- Deprecated k tag: Included for backwards compatibility

## Component Props

### ComposeDialog

```typescript
interface ComposeDialogProps {
  open: boolean;                          // Dialog open state
  onOpenChange: (open: boolean) => void;  // Open state change callback
  replyTo?: NostrEvent;                   // Event being replied to (optional)
  kind?: number;                          // Event kind to create (default: 1)
  initialContent?: string;                // Pre-filled content
  onPublish?: (event: NostrEvent) => void; // Callback after publish
}
```

### RelaySelector

```typescript
interface RelaySelectorProps {
  selectedRelays: string[];                      // Currently selected relays
  onRelaysChange: (relays: string[]) => void;    // Selection change callback
  maxRelays?: number;                            // Max relay limit (default: 10)
}
```

### PowerTools

```typescript
interface PowerToolsProps {
  onInsert?: (text: string) => void;      // Text insertion callback
  onAddMention?: (pubkey: string) => void; // Mention addition callback
}
```

## Thread Tag API

Use the thread builder utilities directly if you need custom tag generation:

```typescript
import { buildThreadTags, buildNip10Tags, buildNip22Tags } from "@/lib/thread-builder";

// Automatic protocol selection
const { tags, relayHint } = buildThreadTags(replyTo, replyKind);

// Explicit NIP-10 (kind 1)
const nip10Tags = buildNip10Tags(replyTo, additionalMentions);

// Explicit NIP-22 (all other kinds)
const nip22Tags = buildNip22Tags(replyTo, additionalMentions);
```

## Keyboard Shortcuts

- **Ctrl/Cmd+Enter**: Submit/publish
- **Shift+Enter**: New line (in editor)
- **Escape**: Close autocomplete suggestions
- **@username**: Trigger profile autocomplete
- **:emoji**: Trigger emoji autocomplete

## Styling

The dialog uses Tailwind CSS with HSL CSS variables from the theme. All components are fully styled and responsive:

- Mobile-friendly layout
- Dark mode support
- Accessible keyboard navigation
- Visual relay connection indicators
- Inline error handling

## Integration Points

### Event Publishing

Events are published using the action system:

```typescript
import { hub, publishEventToRelays } from "@/services/hub";

// Create and sign
const event = await hub.run(async ({ factory }) => {
  const unsigned = factory.event(kind, content, tags);
  return await factory.sign(unsigned);
});

// Publish to selected relays
await publishEventToRelays(event, selectedRelays);
```

### Relay Management

Relays are loaded from the user's NIP-65 relay list (kind 10002):

```typescript
import { relayListCache } from "@/services/relay-list-cache";

const outboxRelays = await relayListCache.getOutboxRelays(pubkey);
```

### Profile Search

Profile autocomplete uses the ProfileSearchService:

```typescript
import { useProfileSearch } from "@/hooks/useProfileSearch";

const { searchProfiles } = useProfileSearch();
const results = await searchProfiles("alice");
```

### Emoji Search

Emoji autocomplete uses the EmojiSearchService with:
- Unicode emojis (built-in)
- User emoji lists (kind 10030)
- Emoji sets (kind 30030)

```typescript
import { useEmojiSearch } from "@/hooks/useEmojiSearch";

const { searchEmojis } = useEmojiSearch();
const results = await searchEmojis("smile");
```

## File Structure

```
src/
├── components/
│   ├── compose/
│   │   └── index.ts              # Public exports
│   ├── ComposeDialog.tsx         # Main dialog
│   ├── RelaySelector.tsx         # Relay picker
│   ├── PowerTools.tsx            # Formatting toolbar
│   └── editor/
│       └── MentionEditor.tsx     # Rich text editor (enhanced)
├── lib/
│   └── thread-builder.ts         # Threading utilities
└── services/
    └── hub.ts                    # Action runner & publishing
```

## Testing

To test the compose dialog:

1. **Unit tests**: Test thread builder functions
```bash
npm test thread-builder
```

2. **Integration tests**: Test in a real viewer component
```tsx
// Add to an existing viewer component
const [showCompose, setShowCompose] = useState(false);

// In render:
<Button onClick={() => setShowCompose(true)}>Reply</Button>
<ComposeDialog
  open={showCompose}
  onOpenChange={setShowCompose}
  replyTo={event}
/>
```

3. **Manual testing**:
   - Compose a new note
   - Reply to an existing note
   - Comment on an article (kind 30023)
   - Test with different relay configurations
   - Test mention and emoji autocomplete
   - Test preview mode
   - Test power tools

## Notes

- The dialog requires an active account with a signer
- At least one relay must be selected to publish
- Thread tags are automatically built based on event kind
- All p-tags (mentions) can be managed explicitly
- Emoji tags (NIP-30) are automatically included for custom emojis
- The editor supports both Unicode and custom emojis

## Related NIPs

- [NIP-10](https://github.com/nostr-protocol/nips/blob/master/10.md): Conventions for clients' use of e and p tags
- [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md): Event `created_at` Limits
- [NIP-30](https://github.com/nostr-protocol/nips/blob/master/30.md): Custom Emoji
- [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md): Relay List Metadata

---

Built with ❤️ for Grimoire
