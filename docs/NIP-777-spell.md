NIP-777
=======

Spells: Shareable REQ Subscription Templates
--------------------------------------------

`draft` `optional`

This NIP defines kind `777` events that encode Nostr REQ subscription filters as shareable, reusable templates called "spells."

## Motivation

Users often want to share interesting subscription queries (feeds, searches, curated lists) without recipients needing to manually construct filters. Spells allow:

- **Shareability**: Publish a useful filter as a discoverable event
- **Dynamic evaluation**: Support relative timestamps (`7d`, `now`) and account aliases (`$me`, `$contacts`)
- **Forking**: Reference and modify existing spells
- **Discoverability**: Tag spells with topics for categorization

## Event Structure

```json
{
  "kind": 777,
  "content": "<human-readable description>",
  "tags": [
    ["cmd", "REQ"],
    ["client", "<client-identifier>"],
    ...filter tags...
    ...metadata tags...
  ]
}
```

### Required Tags

| Tag | Description |
|-----|-------------|
| `["cmd", "REQ"]` | Command type (currently only REQ is defined) |
| `["client", "<name>"]` | Client that created the spell |

### Filter Tags

Filter parameters are encoded as tags. At least one filter constraint must be present.

#### Kind Filter

Kinds are encoded as individual tags (queryable via NIP-50):

```
["k", "1"]
["k", "3"]
["k", "7"]
```

#### Author Filter

Authors are encoded as a single tag with multiple values:

```
["authors", "<hex-pubkey>", "<hex-pubkey>", "$me", "$contacts"]
```

**Special aliases:**
- `$me` — Resolves to the executing user's pubkey at runtime
- `$contacts` — Expands to the executing user's contact list (kind 3 `p` tags)

Aliases are case-insensitive and preserved as literal strings in the event.

#### Tag Filters

Generic tag filters use the format `["tag", "<letter>", ...values]`:

```
["tag", "e", "<event-id>", "<event-id>"]     → filter["#e"]
["tag", "p", "<pubkey>", "$me"]              → filter["#p"]
["tag", "t", "bitcoin", "nostr"]             → filter["#t"]
["tag", "d", "<identifier>"]                 → filter["#d"]
["tag", "a", "<kind>:<pubkey>:<d-tag>"]      → filter["#a"]
```

The `#p` and `#P` tag filters also support `$me` and `$contacts` aliases.

#### Scalar Filters

```
["limit", "<number>"]
["search", "<query>"]
```

#### Time Bounds

Time bounds support both absolute Unix timestamps and relative expressions:

```
["since", "1704067200"]     Absolute Unix timestamp
["since", "7d"]             7 days ago (relative)
["since", "24h"]            24 hours ago
["since", "30m"]            30 minutes ago
["until", "now"]            Current time at execution
["until", "1704153600"]     Absolute Unix timestamp
```

Relative formats:
- `<number>d` — days ago
- `<number>h` — hours ago
- `<number>m` — minutes ago
- `now` — current timestamp

Clients MUST evaluate relative timestamps at execution time, not at event creation.

### Metadata Tags

| Tag | Description |
|-----|-------------|
| `["name", "<spell-name>"]` | Display name for the spell |
| `["alt", "<description>"]` | NIP-31 alt text for clients that don't understand kind 777 |
| `["t", "<topic>"]` | Topic tags for categorization (repeatable) |
| `["relays", "<url>", ...]` | Suggested relay URLs for executing the spell |
| `["close-on-eose"]` | Flag indicating subscription should close after EOSE |

### Provenance Tags

| Tag | Description |
|-----|-------------|
| `["e", "<event-id>"]` | References the spell this was forked from |

## Example Events

### Basic Feed Spell

```json
{
  "kind": 777,
  "content": "Recent text notes from my network",
  "tags": [
    ["cmd", "REQ"],
    ["client", "grimoire"],
    ["name", "My Network Feed"],
    ["k", "1"],
    ["authors", "$me", "$contacts"],
    ["since", "7d"],
    ["limit", "100"],
    ["alt", "Grimoire REQ spell: Recent text notes from my network"]
  ]
}
```

### Bitcoin Discussion Spell

```json
{
  "kind": 777,
  "content": "All posts mentioning bitcoin",
  "tags": [
    ["cmd", "REQ"],
    ["client", "grimoire"],
    ["name", "Bitcoin Feed"],
    ["k", "1"],
    ["tag", "t", "bitcoin", "btc"],
    ["search", "bitcoin"],
    ["limit", "50"],
    ["t", "bitcoin"],
    ["alt", "Grimoire REQ spell: All posts mentioning bitcoin"]
  ]
}
```

### Mentions of Me

```json
{
  "kind": 777,
  "content": "Events that mention me",
  "tags": [
    ["cmd", "REQ"],
    ["client", "grimoire"],
    ["name", "My Mentions"],
    ["k", "1"],
    ["k", "7"],
    ["tag", "p", "$me"],
    ["since", "24h"],
    ["alt", "Grimoire REQ spell: Events that mention me"]
  ]
}
```

## Execution

To execute a spell:

1. Parse filter tags into a NIP-01 filter object
2. Resolve aliases (`$me`, `$contacts`) using the active account
3. Evaluate relative timestamps against current time
4. Construct REQ message and send to relays

If a spell uses `$me` or `$contacts` but no account is active, clients SHOULD display an error rather than silently fail.

## Client Behavior

### Required

- Validate `["cmd", "REQ"]` tag exists
- Support at minimum: `k`, `authors`, `limit` tags
- Preserve aliases in stored/republished events

### Recommended

- Support all tag types defined in this NIP
- Support relative timestamp evaluation
- Allow forking spells with provenance tracking
- Display spell metadata (name, description, topics)

### Optional

- Local spell storage with aliases for quick access
- Spell discovery via topic tags
- Command-line interface for spell creation

## Relation to Other NIPs

- **NIP-01**: Spells encode standard REQ filters
- **NIP-31**: Uses `alt` tag for fallback description
- **NIP-50**: Individual `k` tags enable kind-based search

## Security Considerations

- Clients MUST NOT auto-execute spells from untrusted sources
- The `$contacts` alias may expose the user's social graph to relay operators
- Relative timestamps should be bounded to prevent resource exhaustion

## Appendix: Alias Resolution

```
$me       → active_account.pubkey
$contacts → active_account.contacts.map(c => c.pubkey)
```

Resolution is performed at execution time. If `$me` appears in a filter but no account is active, execution fails. If `$contacts` appears but the contact list is empty or unavailable, it resolves to an empty array.

Both aliases are case-insensitive: `$ME`, `$Me`, `$me` are equivalent.
