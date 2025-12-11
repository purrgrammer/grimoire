---
name: applesauce-core
description: This skill should be used when working with applesauce-core library for Nostr client development, including event stores, queries, observables, and client utilities. Provides comprehensive knowledge of applesauce patterns for building reactive Nostr applications.
---

# applesauce-core Skill

This skill provides comprehensive knowledge and patterns for working with applesauce-core, a library that provides reactive utilities and patterns for building Nostr clients.

## When to Use This Skill

Use this skill when:
- Building reactive Nostr applications
- Managing event stores and caches
- Working with observable patterns for Nostr
- Implementing real-time updates
- Building timeline and feed views
- Managing replaceable events
- Working with profiles and metadata
- Creating efficient Nostr queries

## Core Concepts

### applesauce-core Overview

applesauce-core provides:
- **Event stores** - Reactive event caching and management
- **Queries** - Declarative event querying patterns
- **Observables** - RxJS-based reactive patterns
- **Profile helpers** - Profile metadata management
- **Timeline utilities** - Feed and timeline building
- **NIP helpers** - NIP-specific utilities

### Installation

```bash
npm install applesauce-core
```

### Basic Architecture

applesauce-core is built on reactive principles:
- Events are stored in reactive stores
- Queries return observables that update when new events arrive
- Components subscribe to observables for real-time updates

## Event Store

### Creating an Event Store

```javascript
import { EventStore } from 'applesauce-core';

// Create event store
const eventStore = new EventStore();

// Add events
eventStore.add(event1);
eventStore.add(event2);

// Add multiple events
eventStore.addMany([event1, event2, event3]);

// Check if event exists
const exists = eventStore.has(eventId);

// Get event by ID
const event = eventStore.get(eventId);

// Remove event
eventStore.remove(eventId);

// Clear all events
eventStore.clear();
```

### Event Store Queries

```javascript
// Get all events
const allEvents = eventStore.getAll();

// Get events by filter
const filtered = eventStore.filter({
  kinds: [1],
  authors: [pubkey]
});

// Get events by author
const authorEvents = eventStore.getByAuthor(pubkey);

// Get events by kind
const textNotes = eventStore.getByKind(1);
```

### Replaceable Events

applesauce-core handles replaceable events automatically:

```javascript
// For kind 0 (profile), only latest is kept
eventStore.add(profileEvent1); // stored
eventStore.add(profileEvent2); // replaces if newer

// For parameterized replaceable (30000-39999)
eventStore.add(articleEvent); // keyed by author + kind + d-tag

// Get replaceable event
const profile = eventStore.getReplaceable(0, pubkey);
const article = eventStore.getReplaceable(30023, pubkey, 'article-slug');
```

## Queries

### Query Patterns

```javascript
import { createQuery } from 'applesauce-core';

// Create a query
const query = createQuery(eventStore, {
  kinds: [1],
  limit: 50
});

// Subscribe to query results
query.subscribe(events => {
  console.log('Current events:', events);
});

// Query updates automatically when new events added
eventStore.add(newEvent); // Subscribers notified
```

### Timeline Query

```javascript
import { TimelineQuery } from 'applesauce-core';

// Create timeline for user's notes
const timeline = new TimelineQuery(eventStore, {
  kinds: [1],
  authors: [userPubkey]
});

// Get observable of timeline
const timeline$ = timeline.events$;

// Subscribe
timeline$.subscribe(events => {
  // Events sorted by created_at, newest first
  renderTimeline(events);
});
```

### Profile Query

```javascript
import { ProfileQuery } from 'applesauce-core';

// Query profile metadata
const profileQuery = new ProfileQuery(eventStore, pubkey);

// Get observable
const profile$ = profileQuery.profile$;

profile$.subscribe(profile => {
  if (profile) {
    console.log('Name:', profile.name);
    console.log('Picture:', profile.picture);
  }
});
```

## Observables

### Working with RxJS

applesauce-core uses RxJS observables:

```javascript
import { map, filter, distinctUntilChanged } from 'rxjs/operators';

// Transform query results
const names$ = profileQuery.profile$.pipe(
  filter(profile => profile !== null),
  map(profile => profile.name),
  distinctUntilChanged()
);

// Combine multiple observables
import { combineLatest } from 'rxjs';

const combined$ = combineLatest([
  timeline$,
  profile$
]).pipe(
  map(([events, profile]) => ({
    events,
    authorName: profile?.name
  }))
);
```

### Creating Custom Observables

```javascript
import { Observable } from 'rxjs';

function createEventObservable(store, filter) {
  return new Observable(subscriber => {
    // Initial emit
    subscriber.next(store.filter(filter));

    // Subscribe to store changes
    const unsubscribe = store.onChange(() => {
      subscriber.next(store.filter(filter));
    });

    // Cleanup
    return () => unsubscribe();
  });
}
```

## Profile Helpers

### Profile Metadata

```javascript
import { parseProfile, ProfileContent } from 'applesauce-core';

// Parse kind 0 content
const profileEvent = await getProfileEvent(pubkey);
const profile = parseProfile(profileEvent);

// Profile fields
console.log(profile.name);      // Display name
console.log(profile.about);     // Bio
console.log(profile.picture);   // Avatar URL
console.log(profile.banner);    // Banner image URL
console.log(profile.nip05);     // NIP-05 identifier
console.log(profile.lud16);     // Lightning address
console.log(profile.website);   // Website URL
```

### Profile Store

```javascript
import { ProfileStore } from 'applesauce-core';

const profileStore = new ProfileStore(eventStore);

// Get profile observable
const profile$ = profileStore.getProfile(pubkey);

// Get multiple profiles
const profiles$ = profileStore.getProfiles([pubkey1, pubkey2]);

// Request profile load (triggers fetch if not cached)
profileStore.requestProfile(pubkey);
```

## Timeline Utilities

### Building Feeds

```javascript
import { Timeline } from 'applesauce-core';

// Create timeline
const timeline = new Timeline(eventStore);

// Add filter
timeline.setFilter({
  kinds: [1, 6],
  authors: followedPubkeys
});

// Get events observable
const events$ = timeline.events$;

// Load more (pagination)
timeline.loadMore(50);

// Refresh (get latest)
timeline.refresh();
```

### Thread Building

```javascript
import { ThreadBuilder } from 'applesauce-core';

// Build thread from root event
const thread = new ThreadBuilder(eventStore, rootEventId);

// Get thread observable
const thread$ = thread.thread$;

thread$.subscribe(threadData => {
  console.log('Root:', threadData.root);
  console.log('Replies:', threadData.replies);
  console.log('Reply count:', threadData.replyCount);
});
```

### Reactions and Zaps

```javascript
import { ReactionStore, ZapStore } from 'applesauce-core';

// Reactions
const reactionStore = new ReactionStore(eventStore);
const reactions$ = reactionStore.getReactions(eventId);

reactions$.subscribe(reactions => {
  console.log('Likes:', reactions.likes);
  console.log('Custom:', reactions.custom);
});

// Zaps
const zapStore = new ZapStore(eventStore);
const zaps$ = zapStore.getZaps(eventId);

zaps$.subscribe(zaps => {
  console.log('Total sats:', zaps.totalAmount);
  console.log('Zap count:', zaps.count);
});
```

## NIP Helpers

### NIP-05 Verification

```javascript
import { verifyNip05 } from 'applesauce-core';

// Verify NIP-05
const result = await verifyNip05('alice@example.com', expectedPubkey);

if (result.valid) {
  console.log('NIP-05 verified');
} else {
  console.log('Verification failed:', result.error);
}
```

### NIP-10 Reply Parsing

```javascript
import { parseReplyTags } from 'applesauce-core';

// Parse reply structure
const parsed = parseReplyTags(event);

console.log('Root event:', parsed.root);
console.log('Reply to:', parsed.reply);
console.log('Mentions:', parsed.mentions);
```

### NIP-65 Relay Lists

```javascript
import { parseRelayList } from 'applesauce-core';

// Parse relay list event (kind 10002)
const relays = parseRelayList(relayListEvent);

console.log('Read relays:', relays.read);
console.log('Write relays:', relays.write);
```

## Integration with nostr-tools

### Using with SimplePool

```javascript
import { SimplePool } from 'nostr-tools';
import { EventStore } from 'applesauce-core';

const pool = new SimplePool();
const eventStore = new EventStore();

// Load events into store
pool.subscribeMany(relays, [filter], {
  onevent(event) {
    eventStore.add(event);
  }
});

// Query store reactively
const timeline$ = createTimelineQuery(eventStore, filter);
```

### Publishing Events

```javascript
import { finalizeEvent } from 'nostr-tools';

// Create event
const event = finalizeEvent({
  kind: 1,
  content: 'Hello!',
  created_at: Math.floor(Date.now() / 1000),
  tags: []
}, secretKey);

// Add to local store immediately (optimistic update)
eventStore.add(event);

// Publish to relays
await pool.publish(relays, event);
```

## Svelte Integration

### Using in Svelte Components

```svelte
<script>
  import { onMount, onDestroy } from 'svelte';
  import { EventStore, TimelineQuery } from 'applesauce-core';

  export let pubkey;

  const eventStore = new EventStore();
  let events = [];
  let subscription;

  onMount(() => {
    const timeline = new TimelineQuery(eventStore, {
      kinds: [1],
      authors: [pubkey]
    });

    subscription = timeline.events$.subscribe(e => {
      events = e;
    });
  });

  onDestroy(() => {
    subscription?.unsubscribe();
  });
</script>

{#each events as event}
  <div class="event">
    {event.content}
  </div>
{/each}
```

### Svelte Store Adapter

```javascript
import { readable } from 'svelte/store';

// Convert RxJS observable to Svelte store
function fromObservable(observable, initialValue) {
  return readable(initialValue, set => {
    const subscription = observable.subscribe(set);
    return () => subscription.unsubscribe();
  });
}

// Usage
const events$ = timeline.events$;
const eventsStore = fromObservable(events$, []);
```

```svelte
<script>
  import { eventsStore } from './stores.js';
</script>

{#each $eventsStore as event}
  <div>{event.content}</div>
{/each}
```

## Best Practices

### Store Management

1. **Single store instance** - Use one EventStore per app
2. **Clear stale data** - Implement cache limits
3. **Handle replaceable events** - Let store manage deduplication
4. **Unsubscribe** - Clean up subscriptions on component destroy

### Query Optimization

1. **Use specific filters** - Narrow queries perform better
2. **Limit results** - Use limit for initial loads
3. **Cache queries** - Reuse query instances
4. **Debounce updates** - Throttle rapid changes

### Memory Management

1. **Limit store size** - Implement LRU or time-based eviction
2. **Clean up observables** - Unsubscribe when done
3. **Use weak references** - For profile caches
4. **Paginate large feeds** - Don't load everything at once

### Reactive Patterns

1. **Prefer observables** - Over imperative queries
2. **Use operators** - Transform data with RxJS
3. **Combine streams** - For complex views
4. **Handle loading states** - Show placeholders

## Common Patterns

### Event Deduplication

```javascript
// EventStore handles deduplication automatically
eventStore.add(event1);
eventStore.add(event1); // No duplicate

// For manual deduplication
const seen = new Set();
events.filter(e => {
  if (seen.has(e.id)) return false;
  seen.add(e.id);
  return true;
});
```

### Optimistic Updates

```javascript
async function publishNote(content) {
  // Create event
  const event = await createEvent(content);

  // Add to store immediately (optimistic)
  eventStore.add(event);

  try {
    // Publish to relays
    await pool.publish(relays, event);
  } catch (error) {
    // Remove on failure
    eventStore.remove(event.id);
    throw error;
  }
}
```

### Loading States

```javascript
import { BehaviorSubject, combineLatest } from 'rxjs';

const loading$ = new BehaviorSubject(true);
const events$ = timeline.events$;

const state$ = combineLatest([loading$, events$]).pipe(
  map(([loading, events]) => ({
    loading,
    events,
    empty: !loading && events.length === 0
  }))
);

// Start loading
loading$.next(true);
await loadEvents();
loading$.next(false);
```

### Infinite Scroll

```javascript
function createInfiniteScroll(timeline, pageSize = 50) {
  let loading = false;

  async function loadMore() {
    if (loading) return;

    loading = true;
    await timeline.loadMore(pageSize);
    loading = false;
  }

  function onScroll(event) {
    const { scrollTop, scrollHeight, clientHeight } = event.target;
    if (scrollHeight - scrollTop <= clientHeight * 1.5) {
      loadMore();
    }
  }

  return { loadMore, onScroll };
}
```

## Troubleshooting

### Common Issues

**Events not updating:**
- Check subscription is active
- Verify events are being added to store
- Ensure filter matches events

**Memory growing:**
- Implement store size limits
- Clean up subscriptions
- Use weak references where appropriate

**Slow queries:**
- Add indexes for common queries
- Use more specific filters
- Implement pagination

**Stale data:**
- Implement refresh mechanisms
- Set up real-time subscriptions
- Handle replaceable event updates

## References

- **applesauce GitHub**: https://github.com/hzrd149/applesauce
- **RxJS Documentation**: https://rxjs.dev
- **nostr-tools**: https://github.com/nbd-wtf/nostr-tools
- **Nostr Protocol**: https://github.com/nostr-protocol/nostr

## Related Skills

- **nostr-tools** - Lower-level Nostr operations
- **applesauce-signers** - Event signing abstractions
- **svelte** - Building reactive UIs
- **nostr** - Nostr protocol fundamentals
