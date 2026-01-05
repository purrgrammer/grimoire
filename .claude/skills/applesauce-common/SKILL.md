---
name: applesauce-common
description: This skill should be used when working with applesauce-common library for social/NIP-specific helpers, casting system, blueprints, and operations. New in applesauce v5 - contains helpers that moved from applesauce-core.
---

# applesauce-common Skill (v5)

This skill provides comprehensive knowledge for working with applesauce-common, a new package in applesauce v5 that contains social/NIP-specific utilities, the casting system, blueprints, and operations.

**Note**: applesauce-common was introduced in v5. Many helpers that were previously in `applesauce-core/helpers` have moved here.

## When to Use This Skill

Use this skill when:
- Working with article, highlight, threading, zap, or reaction helpers
- Using the casting system for typed event access
- Creating events with blueprints
- Modifying events with operations
- Working with NIP-specific social features

## Package Structure

```
applesauce-common/
├── helpers/          # Social/NIP-specific helpers
│   ├── article.js    # NIP-23 article helpers
│   ├── highlight.js  # NIP-84 highlight helpers
│   ├── threading.js  # NIP-10 thread helpers
│   ├── comment.js    # NIP-22 comment helpers
│   ├── zap.js        # NIP-57 zap helpers
│   ├── reaction.js   # NIP-25 reaction helpers
│   ├── lists.js      # NIP-51 list helpers
│   └── ...
├── casts/            # Typed event classes
│   ├── Note.js
│   ├── User.js
│   ├── Profile.js
│   ├── Article.js
│   └── ...
├── blueprints/       # Event creation blueprints
└── operations/       # Event modification operations
```

## Helpers (Migrated from applesauce-core)

### Article Helpers (NIP-23)

```typescript
import {
  getArticleTitle,
  getArticleSummary,
  getArticleImage,
  getArticlePublished
} from 'applesauce-common/helpers/article';

// All helpers cache internally - no useMemo needed
const title = getArticleTitle(event);
const summary = getArticleSummary(event);
const image = getArticleImage(event);
const publishedAt = getArticlePublished(event);
```

### Highlight Helpers (NIP-84)

```typescript
import {
  getHighlightText,
  getHighlightSourceUrl,
  getHighlightSourceEventPointer,
  getHighlightSourceAddressPointer,
  getHighlightContext,
  getHighlightComment
} from 'applesauce-common/helpers/highlight';

const text = getHighlightText(event);
const sourceUrl = getHighlightSourceUrl(event);
const eventPointer = getHighlightSourceEventPointer(event);
const addressPointer = getHighlightSourceAddressPointer(event);
const context = getHighlightContext(event);
const comment = getHighlightComment(event);
```

### Threading Helpers (NIP-10)

```typescript
import { getNip10References } from 'applesauce-common/helpers/threading';

// Parse NIP-10 thread structure
const refs = getNip10References(event);

if (refs.root) {
  console.log('Root event:', refs.root.e);
  console.log('Root address:', refs.root.a);
}

if (refs.reply) {
  console.log('Reply to:', refs.reply.e);
}
```

### Comment Helpers (NIP-22)

```typescript
import { getCommentReplyPointer } from 'applesauce-common/helpers/comment';

const pointer = getCommentReplyPointer(event);
if (pointer) {
  // Handle reply target
}
```

### Zap Helpers (NIP-57)

```typescript
import {
  getZapAmount,
  getZapSender,
  getZapRecipient,
  getZapComment
} from 'applesauce-common/helpers/zap';

const amount = getZapAmount(event);     // In millisats
const sender = getZapSender(event);     // Pubkey
const recipient = getZapRecipient(event);
const comment = getZapComment(event);
```

### List Helpers (NIP-51)

```typescript
import { getRelaysFromList } from 'applesauce-common/helpers/lists';

const relays = getRelaysFromList(event);
```

## Casting System

The casting system transforms raw Nostr events into typed classes with both synchronous properties and reactive observables.

### Basic Usage

```typescript
import { castEvent, Note, User, Profile } from 'applesauce-common/casts';

// Cast an event to a typed class
const note = castEvent(event, Note, eventStore);

// Access synchronous properties
console.log(note.id);
console.log(note.createdAt);
console.log(note.isReply);

// Subscribe to reactive observables
note.author.profile$.subscribe(profile => {
  console.log('Author name:', profile?.name);
});
```

### Available Casts

- **Note** - Kind 1 short text notes
- **User** - User with profile and social graph
- **Profile** - Kind 0 profile metadata
- **Article** - Kind 30023 long-form articles
- **Reaction** - Kind 7 reactions
- **Zap** - Kind 9735 zap receipts
- **Comment** - NIP-22 comments
- **Share** - Reposts/quotes
- **Bookmarks** - NIP-51 bookmarks
- **Mutes** - NIP-51 mute lists

### With React

```typescript
import { use$ } from 'applesauce-react/hooks';
import { castEvent, Note } from 'applesauce-common/casts';

function NoteComponent({ event }) {
  const note = castEvent(event, Note, eventStore);

  // Subscribe to author's profile
  const profile = use$(note.author.profile$);

  // Subscribe to replies
  const replies = use$(note.replies$);

  return (
    <div>
      <span>{profile?.name}</span>
      <p>{note.content}</p>
      <span>{replies?.length} replies</span>
    </div>
  );
}
```

## Blueprints

Blueprints provide templates for creating events.

```typescript
import { EventFactory } from 'applesauce-core/event-factory';
import { NoteBlueprint } from 'applesauce-common/blueprints';

const factory = new EventFactory({ signer });

// Create a note using blueprint
const draft = await factory.build(NoteBlueprint({
  content: 'Hello Nostr!',
  tags: [['t', 'nostr']]
}));

const event = await factory.sign(draft);
```

## Operations

Operations modify existing events.

```typescript
import { addTag, removeTag } from 'applesauce-common/operations';

// Add a tag to an event
const modified = addTag(event, ['t', 'bitcoin']);

// Remove a tag
const updated = removeTag(event, 'client');
```

## Migration from v4

### Helper Import Changes

```typescript
// ❌ Old (v4)
import { getArticleTitle } from 'applesauce-core/helpers';
import { getNip10References } from 'applesauce-core/helpers/threading';
import { getZapAmount } from 'applesauce-core/helpers/zap';

// ✅ New (v5)
import { getArticleTitle } from 'applesauce-common/helpers/article';
import { getNip10References } from 'applesauce-common/helpers/threading';
import { getZapAmount } from 'applesauce-common/helpers/zap';
```

### Helpers that stayed in applesauce-core

These protocol-level helpers remain in `applesauce-core/helpers`:
- `getTagValue`, `hasNameValueTag`
- `getProfileContent`
- `parseCoordinate`, `getEventPointerFromETag`, `getAddressPointerFromATag`
- `isFilterEqual`, `matchFilter`, `mergeFilters`
- `getSeenRelays`, `mergeRelaySets`
- `getInboxes`, `getOutboxes`
- `normalizeURL`

## Best Practices

### Helper Caching

All helpers in applesauce-common cache internally using symbols:

```typescript
// ❌ Don't memoize helper calls
const title = useMemo(() => getArticleTitle(event), [event]);

// ✅ Call helpers directly
const title = getArticleTitle(event);
```

### Casting vs Helpers

Use **helpers** when you need specific fields:
```typescript
const title = getArticleTitle(event);
const amount = getZapAmount(event);
```

Use **casts** when you need reactive data or multiple related properties:
```typescript
const note = castEvent(event, Note, eventStore);
const profile$ = note.author.profile$;
const replies$ = note.replies$;
```

## Related Skills

- **applesauce-core** - Protocol-level helpers and event store
- **applesauce-signers** - Event signing abstractions
- **nostr** - Nostr protocol fundamentals
