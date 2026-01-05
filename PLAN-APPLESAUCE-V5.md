# Applesauce v5 Upgrade Plan for Grimoire

## Overview

This plan outlines the migration from applesauce v4 to v5, covering breaking changes, new features to adopt, and documentation updates.

## Phase 1: Package Updates & Import Migration

### 1.1 Update package.json Dependencies

**Current versions:**
```json
"applesauce-accounts": "^4.1.0",
"applesauce-actions": "^4.0.0",
"applesauce-content": "^4.0.0",
"applesauce-core": "latest",
"applesauce-loaders": "^4.2.0",
"applesauce-react": "^4.0.0",
"applesauce-relay": "latest",
"applesauce-signers": "^4.1.0"
```

**Target versions:**
```json
"applesauce-accounts": "^5.0.0",
"applesauce-actions": "^5.0.0",
"applesauce-common": "^5.0.0",  // NEW - required for v5
"applesauce-content": "^5.0.0",
"applesauce-core": "^5.0.0",
"applesauce-loaders": "^5.0.0",
"applesauce-react": "^5.0.0",
"applesauce-relay": "^5.0.0",
"applesauce-signers": "^5.0.0"
```

**Remove:**
```json
"applesauce-factory": "..." // Removed in v5 - EventFactory now in applesauce-core
```

### 1.2 EventFactory Import Migration

**File:** `src/services/hub.ts`

```typescript
// Before (v4)
import { EventFactory } from "applesauce-factory";

// After (v5)
import { EventFactory } from "applesauce-core/event-factory";
```

### 1.3 Helper Import Migration

Many helpers moved from `applesauce-core/helpers` to `applesauce-common/helpers`. Need to audit all imports:

**Helpers that moved to applesauce-common/helpers:**
- Profile helpers: `getDisplayName`, `getProfilePicture`
- Social graph: `groupPubkeysByRelay`, `getSeenRelays`
- Threading: `getNip10References`, `interpretThreadTags`
- Zaps: `getZapAmount`, `getZapSender`, `isValidZap`
- Lists: `FAVORITE_RELAYS_KIND`, `getListTags`, `getRelaysFromList`
- Article helpers: `getArticleTitle`, `getArticleSummary`, etc.
- Highlight helpers: all `getHighlight*` functions
- Comment helpers: `getCommentReplyPointer`

**Files to update (from exploration):**
- `src/lib/nostr-utils.ts`
- `src/lib/event-title.ts`
- `src/lib/nip34-helpers.ts`
- `src/lib/nip-c0-helpers.ts`
- `src/services/loaders.ts`
- `src/services/relay-selection.ts`
- `src/hooks/useProfile.ts`
- `src/hooks/useNostrEvent.ts`
- `src/components/nostr/RichText.tsx`
- All kind renderers in `src/components/nostr/kinds/`

**Strategy:** Use grep to find all `applesauce-core/helpers` imports and update to `applesauce-common/helpers` where appropriate. Some low-level helpers remain in `applesauce-core/helpers`.

---

## Phase 2: Loader Migration (Unified Event Loader)

### 2.1 Current Loader Architecture

**File:** `src/services/loaders.ts`

Currently uses:
- `createEventLoader` - for single events
- `createAddressLoader` - for replaceable/addressable events
- `createTimelineLoader` - for timelines
- Custom `eventLoader` wrapper with smart relay hint merging

### 2.2 Unified Loader Setup

Replace separate loaders with unified loader:

```typescript
// Before (v4)
import {
  createEventLoader,
  createAddressLoader,
  createTimelineLoader,
} from "applesauce-loaders/loaders";

const baseEventLoader = createEventLoader(pool, { eventStore, extraRelays });
export const addressLoader = createAddressLoader(pool, { eventStore, extraRelays });
export const profileLoader = createAddressLoader(pool, { eventStore, bufferTime: 200, extraRelays });

// After (v5)
import { createEventLoaderForStore } from "applesauce-loaders/loaders";

// One-time setup - attaches loader to eventStore
createEventLoaderForStore(eventStore, pool, {
  bufferTime: 200,
  followRelayHints: true,
  extraRelays: AGGREGATOR_RELAYS,
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

// Usage changes - use eventStore methods directly
eventStore.event({ id: "event_id" }).subscribe(...);
eventStore.replaceable({ kind: 0, pubkey: "pubkey" }).subscribe(...);
eventStore.addressable({ kind: 30023, pubkey, identifier }).subscribe(...);
```

### 2.3 Custom eventLoader Wrapper

The current smart relay hint merging in `eventLoader()` needs to be preserved. Options:

**Option A:** Keep custom wrapper, use unified loader internally
```typescript
export function eventLoader(pointer, context) {
  // Keep existing relay hint merging logic
  const enhancedPointer = mergeRelayHints(pointer, context);

  // Use eventStore.event() from unified loader
  return eventStore.event(enhancedPointer);
}
```

**Option B:** Move relay hint logic to a cacheRequest/extraRelays callback
```typescript
createEventLoaderForStore(eventStore, pool, {
  bufferTime: 200,
  followRelayHints: true,
  extraRelays: (pointer) => getRelayHintsForPointer(pointer),
});
```

**Recommendation:** Option A - Keep custom wrapper for backward compatibility and control over relay selection.

### 2.4 Hook Updates for Unified Loader

**Files to update:**
- `src/hooks/useNostrEvent.ts` - Use eventStore.event() / eventStore.replaceable()
- `src/hooks/useProfile.ts` - Use eventStore.replaceable() for kind 0
- `src/hooks/useTimeline.ts` - May continue using createTimelineLoader
- `src/hooks/useLiveTimeline.ts` - No change (uses pool.subscription directly)
- `src/hooks/useAccountSync.ts` - Use eventStore.addressable() for kind 10002

---

## Phase 3: Action System Migration (ActionHub → ActionRunner)

### 3.1 Breaking Changes

**Before (v4):** Actions are async generators that `yield` events
```typescript
export function PublishSpellbook(options) {
  return async function* ({ factory }: ActionContext): AsyncGenerator<NostrEvent> {
    const draft = await factory.build({ kind, content, tags });
    const event = await factory.sign(draft);
    yield event; // ActionHub handles publishing
  };
}
```

**After (v5):** Actions are async functions that call `context.publish()`
```typescript
export function PublishSpellbook(options) {
  return async function ({ factory, publish }: ActionContext): Promise<void> {
    const draft = await factory.build({ kind, content, tags });
    const event = await factory.sign(draft);
    await publish(event); // Explicit publish call
  };
}
```

### 3.2 Files to Migrate

1. **`src/services/hub.ts`:**
   ```typescript
   // Before
   import { ActionHub } from "applesauce-actions";
   export const hub = new ActionHub(eventStore, factory, publishEvent);

   // After
   import { ActionRunner } from "applesauce-actions";
   export const hub = new ActionRunner(eventStore, factory, publishEvent);
   ```

2. **`src/actions/publish-spellbook.ts`:**
   - Convert from async generator to async function
   - Replace `yield event` with `await publish(event)`

3. **`src/actions/publish-spell.ts`:**
   - Same conversion pattern

4. **`src/actions/delete-event.ts`:**
   - Already uses direct factory.sign + pool.publish pattern
   - Consider migrating to ActionRunner for consistency

### 3.3 Action Context Changes

v5 ActionContext provides additional features:
- `publish(event, relays?)` - Explicit publish with optional relay override
- `cast(event, Cast)` - Cast events to typed classes
- Sub-action support for composing actions

---

## Phase 4: React Hooks Migration (use$ Hook)

### 4.1 New use$ Hook

Replace `useObservableMemo` with `use$`:

```typescript
// Before (v4)
import { useObservableMemo } from "applesauce-react/hooks";

const event = useObservableMemo(() => eventStore.event(eventId), [eventId]);
const activeAccount = useObservableMemo(() => accounts.active$, []);

// After (v5)
import { use$ } from "applesauce-react/hooks";

const event = use$(() => eventStore.event(eventId), [eventId]);
const activeAccount = use$(accounts.active$); // Direct observable, no factory needed
```

### 4.2 Files to Update

Search for all `useObservableMemo` imports and update:
- `src/hooks/useNostrEvent.ts`
- `src/hooks/useTimeline.ts`
- `src/hooks/useLiveTimeline.ts`
- `src/hooks/useAccountSync.ts`
- `src/hooks/useStable.ts`
- Any component using `useObservableMemo` directly

### 4.3 Type Differences

`use$` has better TypeScript inference:
- `BehaviorSubject<T>` → returns `T` (never undefined)
- `Observable<T>` → returns `T | undefined`

---

## Phase 5: Adopt New Features

### 5.1 Casting System

Add casting for improved type safety and reactive patterns:

```typescript
import { castEvent, Note, User, Profile } from "applesauce-common/casts";

// Cast events to typed classes
const note = castEvent(event, Note, eventStore);

// Synchronous properties
console.log(note.id, note.createdAt, note.isReply);

// Reactive observables
const profile = use$(note.author.profile$);
const replies = use$(note.replies$);
```

**Potential use cases in Grimoire:**
- Note renderers - cast kind 1 events for cleaner access
- Profile components - use `User` cast for profile data
- Reply threads - use reactive `replies$` observable
- Zap displays - cast for amount/sender access

### 5.2 Encrypted Content Caching

For DM/encrypted content features:

```typescript
import { persistEncryptedContent } from "applesauce-common/helpers";

// Setup in services/event-store.ts or main.tsx
persistEncryptedContent(eventStore, storage);

// Decrypted content automatically cached
await unlockHiddenBookmarks(bookmarks, signer);
```

### 5.3 Blueprints and Operations

Move event creation to blueprints for cleaner code:

```typescript
// Before - manual event building
const draft = await factory.build({
  kind: 30777,
  content: JSON.stringify(content),
  tags: [["d", slug], ["title", title]]
});

// After - using blueprints (if available for kind 30777)
import { SpellbookBlueprint } from "applesauce-common/blueprints";
const draft = await factory.build(SpellbookBlueprint({ title, content, slug }));
```

Note: Custom kinds like 30777 may not have built-in blueprints, but the pattern can be used for standard kinds.

---

## Phase 6: Documentation Updates

### 6.1 CLAUDE.md Updates

Update the following sections:

1. **Package structure** - Add `applesauce-common` to stack description
2. **Import patterns** - Update helper import paths
3. **Loader documentation** - Document unified loader pattern
4. **Action documentation** - Document ActionRunner pattern
5. **Hook documentation** - Document `use$` hook
6. **New features** - Add casting system documentation
7. **Helper caching note** - Update import paths in examples

### 6.2 Skill Updates

**`.claude/skills/applesauce-core/SKILL.md`:**
- Update import paths for helpers that moved to applesauce-common
- Add section on unified event loader
- Update examples to use `use$` hook
- Add casting system documentation
- Note v5 breaking changes

**New skill: `.claude/skills/applesauce-common/SKILL.md`:**
- Document casting system (Note, User, Profile, etc.)
- Document helpers that moved from applesauce-core
- Document blueprints and operations
- Document encrypted content caching

**`.claude/skills/applesauce-signers/SKILL.md`:**
- Verify no breaking changes (appears stable)
- Update if any signer interface changes

### 6.3 Code Comments

Update inline comments in affected files to reflect v5 patterns.

---

## Phase 7: Testing & Verification

### 7.1 Test Updates

Update test files for new patterns:
- `src/actions/publish-spell.test.ts`
- `src/actions/publish-spellbook.test.ts`
- Any tests using mocked applesauce imports

### 7.2 Verification Steps

1. Run `npm install` after package.json updates
2. Fix all TypeScript compilation errors
3. Run `npm run lint` and fix issues
4. Run `npm run test:run` and fix failing tests
5. Run `npm run build` to verify production build
6. Manual testing of critical flows:
   - Profile loading
   - Timeline feeds
   - Event detail views
   - Publishing events
   - Account login/logout

---

## Migration Order

Recommended order to minimize breakage:

1. **Phase 1.1-1.3**: Package updates and imports (required first)
2. **Phase 3**: Action system migration (isolated change)
3. **Phase 2**: Loader migration (larger change, test carefully)
4. **Phase 4**: Hook migration (use$ is compatible alongside useObservableMemo)
5. **Phase 5**: New features adoption (optional enhancements)
6. **Phase 6**: Documentation updates
7. **Phase 7**: Final testing and verification

---

## Rollback Plan

If v5 migration encounters blocking issues:
1. Revert package.json to v4 versions
2. Run `npm install` to restore v4 packages
3. Git revert any code changes
4. Document blocking issues for resolution

---

## Estimated Scope

**Files to modify:**
- `package.json` - 1 file
- Service files (`src/services/`) - 3-4 files
- Hook files (`src/hooks/`) - 5-6 files
- Action files (`src/actions/`) - 3 files
- Helper usage across codebase - 20+ files
- Documentation files - 4-5 files

**New files:**
- `.claude/skills/applesauce-common/SKILL.md`

**Risk areas:**
- Loader migration (most complex, affects data loading)
- Helper import paths (many files, easy to miss some)
- Action generator → async function (behavior change)
