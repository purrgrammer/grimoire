# EVENT Command Design

The EVENT command is the counterpart to REQ - while REQ queries events from relays, EVENT creates and publishes events to relays.

## Design Philosophy

**Symmetry with REQ**: Flags that make sense for both querying and creating events should use the same syntax. This makes the CLI intuitive - if you know REQ, you know half of EVENT.

| Concept | REQ (query) | EVENT (create) |
|---------|-------------|----------------|
| Kind | `-k 1` filters for kind 1 | `-k 1` creates kind 1 |
| Event ref | `-e nevent1...` filters #e tags | `-e nevent1...` adds e-tag |
| Pubkey | `-p npub1...` filters #p tags | `-p npub1...` adds p-tag |
| Hashtag | `-t nostr` filters #t tags | `-t nostr` adds t-tag |
| D-tag | `-d article` filters #d tags | `-d article` sets d-tag |
| Generic tag | `-T a value` filters #a tags | `-T a value` adds a-tag |
| Relays | Query these relays | Publish to these relays |

## Flags

### Content & Kind

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --content <text>` | Event content/message | `""` (empty) |
| `-k, --kind <number>` | Event kind | `1` (text note) |
| `--ts, --created-at <time>` | Timestamp (unix, relative, or "now") | Current time |

### Tags (Reused from REQ)

| Flag | Description | Notes |
|------|-------------|-------|
| `-e <ref>` | Add e-tag (event reference) | Supports note1, nevent1, hex. Relay hints extracted. |
| `-p <pubkey>` | Add p-tag (mention) | Supports npub, nprofile, hex, NIP-05, $me |
| `-t <hashtag>` | Add t-tag | Multiple allowed: `-t nostr -t bitcoin` |
| `-d <identifier>` | Set d-tag | For replaceable events (kinds 30000-39999) |
| `-T, --tag <letter> <value> [relay]` | Add any tag | Generic: `-T a 30023:pk:id wss://relay` |

### Publishing

| Flag | Description |
|------|-------------|
| `[relay...]` | Relay URLs to publish to |
| `--dry-run` | Show event JSON without signing/publishing |

### Advanced (Future)

| Flag | Description |
|------|-------------|
| `--pow <difficulty>` | Add NIP-13 proof-of-work |
| `--envelope` | Output in relay message format `["EVENT", {...}]` |

## Behavior

### Without Relays (Dry Run / Preview)

```bash
event -c "hello world"
```

Opens EventBuilder viewer showing:
- Event preview (rendered)
- Raw JSON
- "Sign & Publish" button to select relays

### With Relays (Direct Publish)

```bash
event -c "hello world" relay.damus.io nos.lol
```

Opens EventBuilder viewer:
- Shows event preview
- Auto-signs and publishes to specified relays
- Displays per-relay publish status (pending/success/error)

## Tag Handling

### e-tags (Event References)

The `-e` flag adds event reference tags with proper structure:

```bash
event -c "reply" -e nevent1qqs...
```

Produces:
```json
["e", "<event-id>", "<relay-hint>", "reply"]
```

When referencing via nevent1, relay hints are automatically extracted.

### p-tags (Mentions)

The `-p` flag supports multiple identifier formats:

```bash
event -c "hey @alice" -p fiatjaf.com -p npub1abc...
```

NIP-05 identifiers are resolved async. Relay hints from nprofile are extracted.

### a-tags (Addressable References)

Use the generic `-T` flag:

```bash
event -c "comment on article" -T a 30023:pubkey:article-id wss://relay
```

Produces:
```json
["a", "30023:pubkey:article-id", "wss://relay"]
```

## Examples

### Basic Text Note
```bash
event -c "hello nostr!"
event -c "gm fam" relay.damus.io
```

### Note with Hashtags
```bash
event -c "building on #nostr" -t nostr -t bitcoin
```

### Reply to Event
```bash
event -c "great post!" -e nevent1qqs8lft0t45k92c78n2zfe6ccvqzhpn977cd3h8wnl579zxhw5dvr9qqyz...
```

### Mention Users
```bash
event -c "thanks for the help" -p fiatjaf.com -p npub1dergigi...
```

### Replaceable Event (Article)
```bash
event -k 30023 -d my-article -c "# My Article\n\nContent here..."
```

### Profile Metadata (Kind 0)
```bash
event -k 0 -c '{"name":"Alice","about":"Nostr enthusiast"}'
```

### Reaction
```bash
event -k 7 -c "+" -e nevent1...
```

### Custom Tags
```bash
event -c "live comment" -T a 30311:pubkey:stream-id wss://relay
```

### With Explicit Timestamp
```bash
event -c "backdated" --ts 1704067200
event -c "now" --ts now
```

## Parser Implementation

The parser should be implemented in `src/lib/event-parser.ts` and reuse utilities from `req-parser.ts`:

- `parseNpubOrHex()` - for -p flag
- `parseEventIdentifier()` - for -e flag
- `parseTimestamp()` - for --ts flag
- `normalizeRelayURL()` - for relay args
- `isRelayDomain()` - for relay detection
- `parseCommaSeparated()` - for multi-value flags

### Parsed Result Interface

```typescript
interface ParsedEventCommand {
  kind: number;
  content: string;
  createdAt?: number;
  tags: string[][];
  relays?: string[];
  dryRun?: boolean;

  // For async resolution
  nip05PTags?: string[];
  domainPTags?: string[];
  needsAccount?: boolean;
}
```

## UI Component: EventBuilder

The viewer component should:

1. **Preview Mode**: Show rendered event preview + raw JSON
2. **Edit Mode**: Allow content editing before signing
3. **Publish Controls**:
   - Relay selector (with write relays pre-selected)
   - Sign & Publish button
   - Per-relay status indicators
4. **Result Display**:
   - Show signed event ID (nevent1)
   - Copy buttons for ID/JSON
   - "Open" button to view published event

## Comparison with nak

| nak | Grimoire EVENT |
|-----|----------------|
| `--content, -c` | `-c, --content` ✓ |
| `--kind, -k` | `-k, --kind` ✓ |
| `--created-at, --time, --ts` | `--ts, --created-at` ✓ |
| `-e` (shortcut for tag) | `-e` ✓ |
| `-p` (shortcut for tag) | `-p` ✓ (with NIP-05 resolution) |
| `-d` (shortcut for tag) | `-d` ✓ |
| `-t` (generic tag) | `-T, --tag` (Grimoire uses -t for hashtags) |
| `--sec` | N/A (uses account signer) |
| `--pow` | Future |
| `--envelope` | Future |
| `--nevent` | Auto-displayed in result |
| Relay args | Same ✓ |

## Man Page Entry

```typescript
event: {
  name: "event",
  section: "1",
  synopsis: "event [options] [relay...]",
  description:
    "Create and publish Nostr events. Build events with specified kind, content, and tags. Without relays, displays event JSON for preview. With relays, signs and publishes the event.",
  options: [
    { flag: "-c, --content <text>", description: "Event content/message" },
    { flag: "-k, --kind <number>", description: "Event kind (default: 1)" },
    { flag: "-e <ref>", description: "Add e-tag (note, nevent, hex)" },
    { flag: "-p <pubkey>", description: "Add p-tag (npub, nprofile, NIP-05, $me)" },
    { flag: "-t <hashtag>", description: "Add t-tag (hashtag)" },
    { flag: "-d <identifier>", description: "Set d-tag (replaceable events)" },
    { flag: "-T, --tag <letter> <value>", description: "Add any tag" },
    { flag: "--ts, --created-at <time>", description: "Set timestamp" },
    { flag: "--dry-run", description: "Preview without publishing" },
    { flag: "[relay...]", description: "Relays to publish to" },
  ],
  examples: [
    "event -c \"hello nostr!\"                    Create text note (preview)",
    "event -c \"gm\" relay.damus.io               Publish to relay",
    "event -c \"#nostr\" -t nostr                 Note with hashtag",
    "event -c \"reply\" -e nevent1...             Reply to event",
    "event -c \"hey\" -p fiatjaf.com              Mention user",
    "event -k 7 -c \"+\" -e nevent1...            React to event",
    "event -k 30023 -d article -c \"# Title\"     Create article",
  ],
  seeAlso: ["req", "post", "open"],
  appId: "event",
  category: "Nostr",
}
```

## Future Enhancements

1. **Proof-of-Work**: `--pow <difficulty>` for NIP-13
2. **Stdin Support**: Pipe content from file/stdin
3. **Templates**: Pre-defined event templates (reaction, repost, etc.)
4. **Event Modification**: Accept existing event JSON and re-sign
5. **Batch Publishing**: Multiple events in sequence
