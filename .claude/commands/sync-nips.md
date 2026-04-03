Sync NIP and event kind definitions with the upstream nostr-protocol/nips repository.

## Step 1: Fetch upstream data

```bash
curl -s https://raw.githubusercontent.com/nostr-protocol/nips/master/README.md
```

Parse two tables from the README:

1. **NIP list table** — rows like `| [01](01.md) | Basic protocol flow description | final |`
   - Extract: NIP identifier (from link target, e.g. `01`, `7D`), title, status (`draft`/`final`/`deprecated`)
2. **Event Kinds table** — rows like `| 0 | User Metadata | [01](01.md) |`
   - Extract: kind number, description, NIP reference
   - Ranges like `5000-5999` are categories — do NOT expand into individual entries

## Step 2: Update `src/constants/nips.ts`

Read the current file, then:

### VALID_NIPS array
- Add new NIP identifiers found upstream
- Remove NIPs no longer listed upstream (unless referenced by a kind in `kinds.ts`)
- Maintain sort order: numeric first (`"01"`–`"99"`), then hexadecimal (`"5A"`, `"7D"`, `"A0"`, etc.)
- Preserve the `// Numeric NIPs` and `// Hexadecimal NIPs` section comments

### NIP_TITLES record
- Add entries for new NIPs
- Update titles that changed upstream
- Keep existing entries that still match

### DEPRECATED_NIPS array
- Sync with upstream: add NIPs marked `unrecommended`/`deprecated`, remove ones no longer deprecated
- Keep `as const` assertion

## Step 3: Update `src/lib/nip-icons.ts`

Read the current file. The `NIP_METADATA` record provides icons, short names, and descriptions for each NIP — used by NIPBadge and NipsViewer.

### For every new NIP added in Step 2:
- Add a corresponding entry to `NIP_METADATA` with: `id` (string, matches the NIP identifier), `name` (short), `description`, `icon` (lucide-react), and `deprecated` if applicable
- All keys and `id` values are strings (e.g., `"01"`, `"5A"`, `"A0"`)
- Pick an icon from existing imports; add new imports if needed
- Place in correct position (numeric keys first, then hex keys sorted)

### For deprecated status changes:
- Add or remove the `deprecated: true` field to match upstream

### Preserve existing entries:
- Never change icons on existing entries
- Only update name/description if upstream changed

## Step 4: Update `src/constants/kinds.ts`

Read the current file, then apply changes carefully.

### PROTECTED — never modify or remove:
- **Grimoire custom kinds**: 777, 10777, 30777 — identified by `nip: ""`
- **Other custom kinds with `nip: ""`**: e.g., 32267, 34139, 36787
- **Community NIPs**: any entry with `communityNip` field (e.g., 30142)
- **Commented-out external specs**: Marmot, NKBIP, nostrocket, geocaching, Corny Chat, Lightning.Pub, Nostr Epoxy, Tidal, joinstr, Blossom (24242), etc.
- **All existing `icon` assignments** — never change icons on existing entries
- **Section comments**: `// Core protocol kinds`, `// Lists`, `// Channels`, etc.

### Adding new kinds:
- Add individually-listed kind numbers from the upstream Event Kinds table
- Place in correct position by kind number (follow existing ordering)
- Pick an appropriate lucide-react icon from the existing imports at the top of the file
- If no existing import fits, add a new import and explain the choice
- Match the existing code style and format

### Updating existing kinds:
- If upstream name/description changed, update `name` and `description`
- If the NIP reference changed, update the `nip` field
- **Never** change the `icon` field on existing entries

## Step 5: Cross-reference validation

- Every `nip` field in `EVENT_KINDS` should exist in `VALID_NIPS` (except empty strings `""` and external specs like `"BUD-03"`, `"AMB"`, `"Marmot"`)
- Every NIP in `DEPRECATED_NIPS` should also be in `VALID_NIPS`
- Every NIP in `VALID_NIPS` should have a corresponding entry in `NIP_METADATA` (`src/lib/nip-icons.ts`)
- Flag and fix any inconsistencies

## Step 6: Update the Nostr skill

Using the upstream data fetched in Step 1, update the Nostr protocol skill files in `.claude/skills/nostr/`.

### Update `references/event-kinds.md`

Regenerate this file from the upstream Event Kinds table. For each kind:
- Kind number, name, NIP reference
- Replaceability behavior (based on kind range)
- Brief description of purpose and key tags

Preserve the existing document structure:
- Section grouping: Core Events (0-999), Regular (1000-9999), Replaceable (10000-19999), Ephemeral (20000-29999), Parameterized Replaceable (30000-39999)
- The "Event Kind Ranges Summary" table
- The "Common Patterns" section with JSON examples for frequently-used kinds (kinds 0, 1, 7, 10002, 30023)
- The "Event Kind Selection Guide" section

### Update `references/nips-overview.md`

Update NIP entries to match upstream:
- Add new NIPs with a brief description of purpose and key details
- Update titles/descriptions that changed upstream
- Mark deprecated NIPs with their status
- Maintain the existing grouping structure (Core Protocol, Social Features, Advanced, etc.)
- Place new NIPs in the appropriate section based on their topic

### Update the Key NIPs table in `SKILL.md`

Update the "Key NIPs Reference" table in `.claude/skills/nostr/SKILL.md`:
- Keep it as a curated summary (15-20 most important NIPs), not an exhaustive list
- Add any newly-important NIPs (final status, widely implemented)
- Remove deprecated NIPs from the table
- Update descriptions if they changed upstream

Also update the "Common kinds" one-liner in the "Event Kind Ranges" section if new widely-used kinds were added.

### Do NOT change in `SKILL.md`:
- The protocol fundamentals sections (event structure, tags, filters, WebSocket messages)
- The nostr-tools code examples
- The "Common Patterns" code examples
- The "Security Essentials" section

## Step 7: Verify

```bash
npm run lint && npm run test:run && npm run build
```

Fix any lint/type/build issues before reporting.

## Step 8: Report

Summarize:
- NIPs added / removed / title-updated
- NIP icons added / updated in `nip-icons.ts`
- Kinds added / updated (with icon choices explained for new ones)
- Nostr skill files updated (which reference files changed, what was added/removed)
- Inconsistencies found and resolved
- Verification results (lint/test/build)
