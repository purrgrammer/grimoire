# Spell System Implementation Plan

## Executive Summary

Refactor the spell system to support:
1. **Alias** (local-only quick name) + **Name** (published spell name)
2. Non-technical user-friendly spell creator wizard
3. Spell discovery and browsing UI
4. Improved command palette integration

## Data Model Changes

### Current State
```typescript
LocalSpell {
  localName?: string;  // Local only
  description?: string; // Published
  command: string;
}

SpellEvent (kind 777) {
  tags: [
    ["cmd", "REQ"],
    ["client", "grimoire"],
    // NO name tag
  ],
  content: description
}
```

### New State
```typescript
LocalSpell {
  alias?: string;      // NEW: Local-only quick name
  name?: string;       // NEW: Mirror from published event
  description?: string;
  command: string;
  isPublished: boolean;
  eventId?: string;
}

SpellEvent (kind 777) {
  tags: [
    ["cmd", "REQ"],
    ["client", "grimoire"],
    ["name", "Bitcoin Feed"], // NEW: Published name
    ["t", "bitcoin"],          // Topic tags
  ],
  content: description // Optional
}
```

### Key Distinction
- **Alias**: Personal shortcut, typed in command palette (e.g., `btc`)
- **Name**: Public spell title, shown in discovery (e.g., "Bitcoin Feed")
- **Description**: Detailed explanation of what the spell does

## Implementation Phases

### Phase 1: Foundation Fixes (Immediate - 2-3 hours)

**Goal:** Fix data model and current UI

**Changes:**
1. Add `name` field to `CreateSpellOptions` and `ParsedSpell` types
2. Add name tag encoding/decoding in `spell-conversion.ts`
3. Rename `localName` → `alias` in `LocalSpell` interface
4. Add database migration v9→v10
5. Update `SpellDialog`:
   - Add alias field (local-only, top)
   - Add name field (published)
   - Rename "Filter" label to "Command"
   - Remove Cancel button
6. Update `spell-storage.ts` for alias field
7. Update all tests

**Files Modified:**
- `src/types/spell.ts`
- `src/lib/spell-conversion.ts`
- `src/services/db.ts`
- `src/services/spell-storage.ts`
- `src/components/nostr/SpellDialog.tsx`
- `src/lib/spell-conversion.test.ts`

**Success Criteria:**
- ✅ Build passes
- ✅ All tests pass
- ✅ Migration preserves existing spells
- ✅ Can create spells with alias + name
- ✅ Published spells include name tag

---

### Phase 2: Spell Browser (2-3 days)

**Goal:** Create spell discovery and management UI

**New Components:**

1. **SpellsViewer** (`src/components/SpellsViewer.tsx`)
   - Main window component (appId: "spells")
   - Three tabs: My Spells, Discover, Favorites
   - Search bar and filters
   - "New Spell" button

2. **SpellList** (`src/components/nostr/SpellList.tsx`)
   - Virtual scrolling for performance
   - Sort by: recent, popular, name
   - Filter by: content type, author, tags

3. **SpellCard** (`src/components/nostr/SpellCard.tsx`)
   - Compact display with metadata
   - Quick actions: Run (▶), Edit (✏), More (⋮)
   - Visual distinction: local vs published

4. **SpellDetailModal** (`src/components/nostr/SpellDetailModal.tsx`)
   - Expanded spell view
   - Friendly metadata display (no technical REQ syntax)
   - Stats: reactions, forks, usage
   - Actions: Run, Edit, Fork, Share

**Features:**
- Browse local and network spells
- Run spells directly from browser
- Fork published spells
- Search by name, alias, description, tags
- Filter by content type (kinds)
- Sort by popularity or recency

**Command Palette Integration:**
- `spells` → Open spell browser
- `spell create` → Open spell creator
- `<alias>` → Run spell by alias
- Autocomplete shows spell suggestions

**Success Criteria:**
- ✅ Can browse local spells
- ✅ Can discover network spells
- ✅ Can run spells from browser
- ✅ Search and filtering work
- ✅ Command palette integration functional
- ✅ Performance good with 100+ spells

---

### Phase 3: Spell Creator Wizard (3-4 days)

**Goal:** Non-technical friendly spell creation

**Wizard Steps:**

**Step 1: Content Type**
```
What do you want to see?

[📝 Notes & Posts]  [📰 Long Articles]
[👤 Profiles]       [🎨 Images]
[💬 Replies]        [🎵 Audio/Video]
[📚 Custom...]
```

Visual cards with descriptions, most popular types first.

**Step 2: Authors**
```
Who posted this?

○ Everyone
○ People I follow
○ Specific people: [Search...]
```

People picker with:
- Profile pictures and display names
- Search by name, NIP-05, npub
- Multi-select with chips
- Quick "Add from follows" button

**Step 3: Time Range**
```
When?

[⏰ Last Hour]  [📅 Today]  [🗓️ This Week]
[📆 This Month]  [🌐 All Time]

Or custom: From [___] to [___]
```

Visual preset buttons + custom date picker.

**Step 4: Advanced Filters** (collapsible, optional)
```
▼ More Options

Tags: [#bitcoin] [#nostr] [+ Add]
Mentions: [@jack] [+ Add]
Search: [_____________]
Limit: [50 ▼]
```

**Step 5: Preview & Name**
```
Preview

This spell will show:
📝 Notes from @jack, @alice
⏰ From the last 7 days
🏷 Tagged #bitcoin

[Live preview of results...]

---

Quick Name (alias):       [btc        ]
Spell Name (published):   [Bitcoin Feed]
Description (published):  [___________]

[< Back]  [Save Locally]  [Save & Publish]
```

**Templates:**
Provide curated templates for quick start:
- My Network (posts from follows)
- Trending Topics (popular recent posts)
- Bitcoin News (#bitcoin #btc)
- Art Gallery (images from artists)

**Helper Components:**

1. **PeoplePicker** (`src/components/ui/people-picker.tsx`)
   - Author/mention selection
   - Profile integration
   - Multi-select support

2. **TagInput** (`src/components/ui/tag-input.tsx`)
   - Hashtag selection
   - Autocomplete from popular tags

3. **Wizard Converters** (`src/lib/wizard-converter.ts`)
   ```typescript
   wizardToCommand(state: WizardState): string
   commandToWizard(command: string): WizardState
   filterToFriendlyDescription(filter: NostrFilter): string
   ```

**Success Criteria:**
- ✅ Non-technical users can create spells
- ✅ All wizard steps functional
- ✅ Live preview works
- ✅ Templates load correctly
- ✅ Conversion wizard↔command accurate
- ✅ Keyboard navigation works

---

### Phase 4: Additional Features (Future)

**Spell Templates** (`src/lib/spell-templates.ts`)
```typescript
interface SpellTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'social' | 'media' | 'discovery' | 'monitoring';
  requiresAccount: boolean;
  wizardDefaults: Partial<WizardState>;
}
```

**Spell Discovery Enhancements:**
- Popularity metrics (reactions, forks)
- Trust indicators (verified creators, from follows)
- Categorization by content type
- Network-wide trending spells

**Command Palette Enhancements:**
- Spell autocomplete with descriptions
- Recent spells quick access
- Fuzzy search for spell names/aliases

**Future Enhancements (Phase 5):**
- Parameterized spells (variables)
- Scheduled spells (hourly, daily)
- Spell playlists/collections
- Spell analytics and stats
- Collaborative spell sharing
- AI-assisted spell creation

## Technical Architecture

### Component Structure
```
src/
├── components/
│   ├── SpellsViewer.tsx                 # Main spell browser
│   ├── nostr/
│   │   ├── SpellList.tsx                # List of spells
│   │   ├── SpellCard.tsx                # Spell card
│   │   ├── SpellDetailModal.tsx         # Expanded view
│   │   ├── SpellCreatorWizard.tsx       # Wizard main
│   │   ├── SpellEditor.tsx              # Rename from SpellDialog
│   │   └── wizard/
│   │       ├── ContentTypeStep.tsx
│   │       ├── AuthorStep.tsx
│   │       ├── TimeRangeStep.tsx
│   │       ├── AdvancedStep.tsx
│   │       └── PreviewStep.tsx
│   └── ui/
│       ├── people-picker.tsx
│       └── tag-input.tsx
├── lib/
│   ├── spell-templates.ts               # Curated templates
│   ├── spell-metadata.ts                # Filter formatting
│   └── wizard-converter.ts              # Wizard ↔ command
├── hooks/
│   ├── useSpells.ts                     # Spell data
│   ├── useSpellDiscovery.ts             # Network discovery
│   └── useSpellActions.ts               # Actions
└── types/
    └── wizard.ts                        # Wizard state types
```

### State Management

**Option A: Jotai (Current Pattern)**
```typescript
export const localSpellsAtom = atom<LocalSpell[]>([]);
export const publishedSpellsAtom = atom<ParsedSpell[]>([]);
export const spellDiscoveryAtom = atom<ParsedSpell[]>([]);
```

**Option B: React Query (Recommended for Phase 2+)**
```typescript
export function useLocalSpells() {
  return useQuery({
    queryKey: ['spells', 'local'],
    queryFn: () => getAllSpells(),
  });
}

export function usePublishedSpells() {
  const subscription = useSubscription({
    filter: { kinds: [777] },
    relays: AGGREGATOR_RELAYS,
  });

  return useQuery({
    queryKey: ['spells', 'published'],
    queryFn: () => parsePublishedSpells(subscription.events),
  });
}
```

### Discovery Mechanisms

1. **From Follows:** Query kind 777 from contact list
2. **From Aggregators:** Query AGGREGATOR_RELAYS
3. **By Category:** Filter by "k" tags
4. **Search:** Full-text on name, description, tags
5. **Popularity:** Sort by reaction count (kind 7)

### Performance Considerations

- Virtual scrolling for spell lists (react-window)
- Debounced search (300ms)
- Lazy load published spells
- Cache parsed spells in memory
- Background sync when inactive

## Edge Cases & Validation

### Alias Validation
- Alphanumeric + dash + underscore only: `/^[a-zA-Z0-9_-]+$/`
- Max length: 32 characters
- Cannot conflict with built-in commands (req, profile, etc.)

### Name Validation
- Any Unicode characters allowed
- Max length: 64 characters
- Optional (can be empty)

### Description Validation
- Any Unicode characters allowed
- Max length: 500 characters
- Optional (can be empty)

### Empty Spell Handling
- If no name/alias/description: show "(Unnamed Spell)"
- Auto-derive fallback from command: "Kind 1 Notes"

### Conflict Resolution
- Alias conflicts: Show warning, allow override
- Published spell updates: Show "Local changes not published"
- Duplicate aliases: Last one wins, show warning

## Testing Strategy

### Unit Tests
- Spell encoding/decoding with name tag
- Alias validation
- Filter-to-metadata conversion
- Wizard-to-command conversion
- Database migration

### Integration Tests
- Create and save spell
- Publish spell to network
- Fork published spell
- Run spell via alias
- Search and filter spells

### Manual Testing Checklist
- [ ] Create spell from REQ window
- [ ] Create spell via wizard
- [ ] Edit existing spell
- [ ] Delete local spell
- [ ] Publish local spell
- [ ] Fork published spell
- [ ] Run spell via alias
- [ ] Search spells
- [ ] Filter by category
- [ ] Command palette integration

## Migration Strategy

### Database Migration v9 → v10
```typescript
this.version(10)
  .stores({
    // ... same schema ...
  })
  .upgrade(async (tx) => {
    const spells = await tx.table<any>("spells").toArray();

    for (const spell of spells) {
      // Rename localName → alias
      if (spell.localName) {
        spell.alias = spell.localName;
        delete spell.localName;
      }

      // Initialize name field
      spell.name = spell.name || undefined;

      await tx.table("spells").put(spell);
    }

    console.log(`[DB Migration v10] Migrated ${spells.length} spells`);
  });
```

**Zero Data Loss:** Existing spells preserved with quick names as aliases.

## Implementation Timeline

### Phase 1: Immediate (2-3 hours)
- Foundation fixes
- Data model corrections
- SpellDialog updates
- Tests

### Phase 2: Spell Browser (2-3 days)
- SpellsViewer component
- Discovery and browsing
- Command palette integration
- Basic actions

### Phase 3: Wizard (3-4 days)
- Multi-step wizard
- Visual builders
- Templates
- Live preview

### Total: ~1 week full-time

## Success Metrics

- **User Adoption:** 50%+ of users create at least one spell
- **Non-Technical Success:** 30%+ of spells created via wizard
- **Discovery:** 20%+ of runs are discovered spells (not user-created)
- **Performance:** <100ms to load spell browser
- **Quality:** 0 critical bugs in Phase 1

## Accessibility

- Keyboard navigation for all features
- Screen reader support with ARIA labels
- Focus management in modals
- Clear visual hierarchy
- Empty state guidance

## Conclusion

This plan transforms the spell system from technical CLI-only to user-friendly with visual builders, while maintaining power-user CLI workflows. The phased approach allows incremental delivery and iteration based on feedback.

**Next Steps:**
1. Implement Phase 1 (immediate fixes)
2. Test and validate with users
3. Begin Phase 2 (spell browser)
4. Iterate based on feedback
