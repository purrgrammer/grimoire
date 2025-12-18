# TODO

## Support passing nevent,naddr,npub to -T option

**Priority**: Low
**File**: `src/services/command-parser.ts`

Allow `-T` (target) option to accept not just raw tag values, but also naddr and npub identifiers for more flexible targeting of events, addresses, or public keys.

## Known Issues

### RTL Support in Rich Text
**Priority**: Medium
**File**: `src/components/nostr/RichText/Text.tsx`

Current RTL implementation is partial and has limitations:
- RTL text direction works (`dir` attribute on spans)
- RTL text alignment (right-align) doesn't work properly with inline elements
- Mixed LTR/RTL content with inline elements (hashtags, mentions) creates layout conflicts

**The core problem**:
- Inline elements (hashtags, mentions) need inline flow to stay on same line
- RTL alignment requires block-level containers
- These two requirements conflict

**Potential solutions to explore**:
1. Line-aware rendering at RichText component level (parse and group by lines)
2. CSS-based approach with unicode-bidi and direction properties
3. Separate rendering paths for pure RTL content vs mixed content
4. Accept partial RTL support and document limitations

**Test case**: Arabic text with hashtags on same line should display properly with right-alignment.

### Rendering Issues
**Priority**: Medium

- **Nested lists in Markdown should be padded** - Markdown renderer spacing issue
- **Text rendering**: Avoid inserting `<br>` tags, investigate noStrudel's EOL metadata approach

## Command Palette / UX Improvements

### Enter Key Behavior
When selecting an action from the dropdown, pressing Enter should insert the command at the beginning of the command line (currently requires manual typing).

### Command Options Display
When an action is entered, show the list of available options below and provide auto-completion for flags/arguments.

## Feature Requests

### Command History
**Priority**: High
- Remember command history across sessions
- Allow editing a selected command before executing
- Arrow up/down navigation through history

### Column Command Editing
**Priority**: Medium
- Allow users to edit the command that defines a column/window
- Useful for adjusting filters without recreating the window

### NIP-05 and Name Autocomplete
**Priority**: Medium
**File**: Command parser, author flag handler
- Autocomplete NIP-05 identifiers when using `--author` flag
- Autocomplete by display name from cached profiles
- Improve discoverability of user identifiers

### Generic Feed Command
**Priority**: Low
**Description**: Add a `feed` command to show the full personalized feed for the logged-in user.

**Note**: May be "too much" for this tool's focused approach - consider carefully whether it fits the Unix philosophy.

### Column Sharing
**Priority**: Medium
**Description**:
- Export a column definition (command + relays + filters) as shareable JSON/URL
- Import column definitions from others
- Enable sharing of useful views and configurations

### Per-Column Theming
**Priority**: Low
**Description**: Allow setting background color or theme for individual columns, helping visually organize workspace.

## Recent Improvements ✅

### Relay Liveness Persistence
**Completed**: 2024-12-17
**Files**: `src/services/db.ts`, `src/services/relay-liveness.ts`

Relay health tracking now persists across sessions:
- Added Dexie v8 migration with `relayLiveness` table
- Created storage adapter implementing `LivenessStorage` interface
- Relay failure counts, backoff states persist across app restarts
- Prevents repeated connection attempts to dead relays

### Detail Renderer Registry
**Completed**: 2024-12-17
**Files**: `src/components/nostr/kinds/index.tsx`, `src/components/EventDetailViewer.tsx`

Refactored detail view rendering to use registry pattern:
- Removed 25-line hardcoded if-else chain from EventDetailViewer
- Created `detailRenderers` map with 11 specialized detail renderers
- New detail renderers can be added without modifying EventDetailViewer
- Falls back to feed renderer for kinds without custom detail views

### Event Error Boundaries
**Completed**: 2024-12-17
**Files**: `src/components/EventErrorBoundary.tsx`, `src/components/nostr/Feed.tsx`, `src/components/EventDetailViewer.tsx`

All event renderers now protected with error boundaries:
- One broken event no longer crashes entire feed
- Diagnostic UI shows kind, ID, error message, component stack
- Retry button and collapsible details for debugging
- Auto-resets when event changes

### Layout System Enhancements
**Completed**: 2024-12-18
**Files**: `src/lib/layout-presets.ts`, `src/components/LayoutControls.tsx`, `src/components/TabBar.tsx`

Quick-win improvements to window management:
- **Keyboard Workspace Switching**: Cmd+1-9 (or Ctrl+1-9) to instantly switch to workspace by position
  - Browser-safe shortcuts (prevents default browser behavior)
  - Switches by visual position in tab bar, not workspace number
  - Significantly faster workflow for power users
- **Adaptive Layout Presets**: All presets now handle any number of windows
  - Grid layout adapts to any N ≥ 2 windows (2×2, 2×3, 3×3, etc.)
  - Side-by-side handles 2-4 windows with equal splits
  - Main+sidebar naturally adapts to any number
- Comprehensive test coverage for grid layouts with odd numbers

## Window Management Improvements

### Balance Splits
**Priority**: Medium | **Effort**: Low (1 hour)
**Description**: Action to equalize all split percentages to 50/50 after manual resizing
**Implementation**:
- Recursive tree traversal that preserves window IDs and directions
- Reset all `splitPercentage` values to 50
- Add to layout dropdown (once basic features are validated)
- Smooth animation on balance operation

**Use Case**: After manually resizing windows, quickly restore clean 50/50 proportions

**Note**: Deferred until core preset/insertion features are validated in real usage

### Fullscreen Mode
**Priority**: High | **Effort**: Medium (2-3 hours)
**Description**: Toggle window to fill entire workspace with minimal chrome
**Implementation**:
- CSS-based approach (hide siblings, expand target)
- Keep workspace tabs visible for navigation
- Toolbar button + right-click menu to enter fullscreen
- ESC or button click to exit
- Add `fullscreenWindowId` to workspace state
- Smooth animation on enter/exit

**Use Case**: Reading long-form content, focused analysis of single event/profile

### Move Window to Different Workspace
**Priority**: Medium | **Effort**: High (3-4 hours)
**Description**: Reorganize windows by moving them between workspaces
**Implementation**:
- Right-click window → "Move to Workspace N" submenu
- Extract window from current layout tree
- Insert into target workspace layout
- Handle edge cases (last window, invalid workspace)

**Use Case**: "This profile is actually relevant to workspace 2's topic"

### Rotate/Mirror Layout
**Priority**: Low | **Effort**: Medium (2 hours)
**Description**: Swap all row↔column directions in layout tree
**Implementation**:
- Recursive tree traversal
- Swap `direction: "row"` ↔ `direction: "column"`
- Keep split percentages unchanged
- Add to Actions section in LayoutControls

**Use Case**: "This arrangement works better vertically than horizontally"

### Tab Navigation Between Windows
**Priority**: Low | **Effort**: Low (1 hour)
**Description**: Keyboard navigation within workspace
**Implementation**:
- Tab/Shift+Tab to cycle focus between windows
- Focus management via mosaic window refs
- Visual focus indicator (border highlight)

**Use Case**: Keyboard-driven workflow without mouse

## Planned Improvements

- **App-wide error boundary** - Splash crash screen for unhandled errors (separate from event-level boundaries)
- **Collapsible relay list** - Show user relay links without inbox/outbox icons initially
- **NIP badges everywhere** - Use consistent NIP badge components for linking to NIP documentation
- **External spec event kind support** - Add references and documentation links for commented-out event kinds from external specs (Blossom, Marmot Protocol, NKBIP, nostrocket, Corny Chat, NUD, etc.) in `src/constants/kinds.ts`. Consider adding a separate registry or documentation for non-official-NIP event kinds.

## Code Quality & Refactoring

### Semantic Component Naming
**Priority**: Low | **Effort**: Medium
**Files**: All Kind*Renderer.tsx files, EventDetailViewer.tsx, and import locations

**Current State**:
- Component names use technical kind numbers: Kind0DetailRenderer, Kind3DetailView, Kind30023DetailRenderer
- Makes code less self-documenting for developers unfamiliar with Nostr kind numbers
- Requires mental mapping between kind numbers and their semantic meaning

**Proposed Renaming**:
- `Kind0DetailRenderer` → `ProfileMetadataRenderer` (kind 0)
- `Kind0Renderer` → `ProfileMetadataFeedRenderer`
- `Kind3DetailView` / `Kind3Renderer` → `ContactListRenderer` (kind 3)
- `Kind1621Renderer` / `Kind1621DetailRenderer` → `IssueRenderer` / `IssueDetailRenderer` (kind 1621, NIP-34)
- `Kind30023Renderer` / `Kind30023DetailRenderer` → `LongFormArticleRenderer` / `ArticleDetailRenderer` (kind 30023)
- `Kind30617Renderer` / `Kind30617DetailRenderer` → `RepositoryRenderer` / `RepositoryDetailRenderer` (kind 30617, NIP-34)
- `Kind9802Renderer` / `Kind9802DetailRenderer` → `HighlightRenderer` / `HighlightDetailRenderer` (kind 9802)
- `Kind10002Renderer` / `Kind10002DetailRenderer` → `RelayListRenderer` / `RelayListDetailRenderer` (kind 10002)
- And all other Kind*Renderer files following this pattern

**Implementation Tasks**:
1. Rename all Kind*Renderer.tsx files to semantic names
2. Update component exports and function names
3. Update all imports in EventDetailViewer.tsx
4. Update kind registry in src/components/nostr/kinds/index.tsx
5. Run build and tests to verify no breakage
6. Update any documentation references

**Benefits**:
- Self-documenting code - component name explains what it renders
- Better developer experience for new contributors
- Easier to find components by searching for semantic names
- Aligns with common practices in React codebases

**Note**: Keep kind number comments in files to maintain traceability to Nostr specs

### Locale-Aware Date Formatting Audit
**Priority**: Medium | **Effort**: Low
**Files**: All component files that display dates/times

**Current State**:
- `BaseEventRenderer.tsx` correctly implements locale-aware formatting using `formatTimestamp` from useLocale hook
- `useGrimoire()` provides locale state from grimoire state atom
- Pattern: `formatTimestamp(event.created_at, "relative", locale.locale)` for relative times
- Pattern: `formatTimestamp(event.created_at, "absolute", locale.locale)` for full dates

**Audit Tasks**:
1. Search codebase for all date/time formatting
2. Identify any components using `new Date().toLocaleString()` without locale parameter
3. Identify any hardcoded date formats
4. Replace with formatTimestamp utility where applicable
5. Verify all date displays respect user's locale setting
6. Test with different locales (en-US, es-ES, ja-JP, ar-SA for RTL)

**Known Good Patterns**:
- ✅ BaseEventRenderer - Uses formatTimestamp with locale
- ✅ EventDetailViewer - No date display (delegates to renderers)
- ✅ ProfileViewer - No date display currently

**Files to Check**:
- All Kind*Renderer.tsx files
- Timeline/feed components
- Any custom date displays
- Comment/reply timestamps
- Event metadata displays

**Testing**:
- Change locale in grimoire state
- Verify all dates update to new locale format
- Test relative times ("2m ago", "3h ago") in different languages
- Test absolute times with various locale date formats

**Benefits**:
- Consistent internationalization support
- Better UX for non-English users
- Follows best practices for locale-aware applications
- Prepares codebase for full i18n implementation (see Phase 3.4)

### NIP-22 Comment Threading Support
**Priority**: High
**Files**: `src/components/nostr/kinds/Kind1Renderer.tsx`, potentially new `Kind1111Renderer.tsx`

**Current State**:
- Kind 1111 (Comment) is registered in constants with MessageCircle icon
- Kind 1111 currently falls back to DefaultKindRenderer (just shows raw content)
- Kind1Renderer only handles NIP-10 threading (kind 1 notes), not NIP-22 comments

**NIP-22 Requirements**:
- Kind 1111 events are **not** replies to kind 1 notes - they use a different threading model
- Comments MUST use uppercase tags (K, E, A, I, P) for root scope
- Comments MUST use lowercase tags (k, e, a, i, p) for parent item
- Comments can thread on:
  - Nostr events (using E/e, A/a tags with K/k for kinds, P/p for authors)
  - External identifiers (using I/i tags with K/k for types - URLs, podcast GUIDs, etc.)
- Comments MUST NOT reply to kind 1 notes (NIP-10 should be used instead)

**Implementation Tasks**:

1. **Create Kind1111Renderer component**:
   - Parse uppercase tags (K, E, A, I, P) to identify root scope
   - Parse lowercase tags (k, e, a, i, p) to identify parent item
   - Display comment content with RichText (plaintext only, no HTML/Markdown per spec)
   - Show "replying to" context with appropriate UI based on tag types:
     - For E/e tags: Fetch and display parent nostr event
     - For A/a tags: Fetch and display addressable event
     - For I/i tags: Display external identifier (URL, podcast, etc.)
   - Handle nested comment threading (when parent is also kind 1111)
   - Show root context indicator (what the comment thread is about)

2. **Tag Parsing Utilities** (potentially in `src/lib/nip22.ts`):
   - `getRootScope(event)` - extracts K, E, A, or I tags
   - `getParentItem(event)` - extracts k, e, a, or i tags
   - `getRootAuthor(event)` - extracts P tag
   - `getParentAuthor(event)` - extracts p tag
   - `isTopLevelComment(event)` - checks if root === parent
   - Helper to determine comment type (event comment vs external identifier comment)

3. **UI Components**:
   - Comment thread visualization (show depth/nesting)
   - Root context banner (e.g., "Comment on article", "Comment on podcast episode")
   - External identifier display (for I tags - URLs, podcasts, etc.)
   - Parent comment preview (for nested threads)
   - Kind badge display (show what kind of event is being commented on)

4. **Integration Points**:
   - Update kind registry to use Kind1111Renderer
   - Consider how comments relate to other viewers (e.g., showing comments on a 30023 article)
   - Timeline/feed integration (how to display comment threads)
   - Reply UI for creating new comments

5. **Edge Cases to Handle**:
   - Comments on replaceable/addressable events (both `a` and `e` tags present)
   - Comments on external identifiers without nostr events
   - Comments with q tags (quote references)
   - Invalid comment structure (missing required K/k tags)
   - Mixed case handling and validation

6. **Testing Scenarios**:
   - Top-level comment on blog post (kind 30023)
   - Top-level comment on file (kind 1063)
   - Nested reply to another comment (kind 1111 → 1111)
   - Comment on external URL (I tag with "web" type)
   - Comment on podcast episode (I tag with podcast GUID)
   - Validation: ensure kind 1 notes don't use kind 1111 (should fail/warn)

**References**:
- [NIP-22 Spec](https://github.com/nostr-protocol/nips/blob/master/22.md)
- [NIP-73 External Identities](https://github.com/nostr-protocol/nips/blob/master/73.md) (for I/i tag types)
- [NIP-10 Threading](https://github.com/nostr-protocol/nips/blob/master/10.md) (for contrast - what NOT to do)

**Note**: This is a significant feature requiring careful attention to the threading model differences between NIP-10 (kind 1 notes) and NIP-22 (kind 1111 comments).

---

## Event Rendering System Improvements

**Reference**: See `claudedocs/event-rendering-system-analysis.md` for comprehensive analysis

### Phase 1: Foundation Fixes (1-2 weeks)
**Goal:** Fix critical architectural issues and quick wins

#### 1.1 Systematic Depth Tracking
**Priority**: High | **Effort**: Medium
**Files**: All `*Renderer.tsx` files

**Problem**: Depth tracking inconsistent - can cause infinite loops in Kind6Renderer (reposts), Kind9735Renderer (zaps)

**Solution**:
- Add `MAX_EMBED_DEPTH = 3` constant
- Update `BaseEventProps` to require depth
- Audit all renderers using `EmbeddedEvent`
- Implement `CollapsedPreview` component for max depth exceeded

#### 1.2 Renderer Memoization
**Priority**: Medium | **Effort**: Low
**Files**: All `*Renderer.tsx` files

**Problem**: Renderers recalculate on every parent render - no performance optimization

**Solution**:
- Wrap all renderer components with `React.memo`
- Add `useMemo` for expensive computations (parsing, extraction)
- Add `useCallback` for event handlers

### Phase 2: Component Library (2-3 weeks)
**Goal:** Build reusable abstractions for common patterns

#### 2.1 Generic Threading Components
**Priority**: High | **Effort**: High
**Files**: `src/lib/threading.ts`, `src/components/Thread/`

**Problem**: Only NIP-10 threading supported, need NIP-22, NIP-28, NIP-29

**Solution**: Create abstraction layer
- `getThreadReferences()` helper supporting multiple NIPs
- `<ThreadIndicator>` component (universal "replying to")
- `<ThreadContext>` for parent preview
- `<ThreadTree>` for detail view reply chains

**Related**: Works with NIP-22 Comment Support (existing TODO)

#### 2.2 Relationship Panels
**Priority**: Medium | **Effort**: Medium
**Files**: `src/components/nostr/Relationships/`

**Problem**: Detail views don't show replies, zaps, reactions

**Solution**: Create reusable relationship components
- `<RepliesPanel>` - Show replies to event
- `<ZapsPanel>` - Show zaps with total/list
- `<ReactionsPanel>` - Group reactions by emoji
- `<EngagementFooter>` - Universal engagement indicators

#### 2.3 Enhanced Media Components
**Priority**: Medium | **Effort**: Medium
**Files**: `src/components/nostr/MediaEmbed.tsx`

**Problem**: No multi-stage rendering, no lazy loading, no NSFW handling

**Solution**: Enhance MediaEmbed with
- Multi-stage rendering (placeholder → thumbnail → full → error)
- Lazy loading with IntersectionObserver
- NSFW blur with content-warning tag support
- Quality selection for videos
- Accessibility improvements (alt text, captions)

#### 2.4 Context-Aware Rendering
**Priority**: Medium | **Effort**: Low
**Files**: `src/components/nostr/kinds/index.tsx`, all renderers

**Problem**: Same rendering for feed, detail, and embed contexts

**Solution**: Add `context` prop to BaseEventProps, renderers adapt display

### Phase 3: Architecture Evolution (3-4 weeks)
**Goal:** Transform into production-grade framework

#### 3.1 Performance Optimization
**Priority**: High | **Effort**: Medium
**Files**: `src/components/ReqViewer.tsx`, `EventDetailViewer.tsx`

**Target**: Feed with 10,000 events scrolls at 60fps

**Tasks**:
- Virtual scrolling with react-virtuoso
- Code splitting for detail renderers (lazy load)
- Batch profile fetching (avoid N+1 queries)
- Suspense boundaries for async content
- Performance monitoring

#### 3.2 Helper Library Expansion
**Priority**: High | **Effort**: High
**Files**: `src/lib/helpers/` directory

**Problem**: Many renderers parse tags manually instead of using helpers

**Solution**: Create helpers for all NIPs
- File metadata (1063): url, hash, size, mime, dimensions
- Media events (20, 21, 22): URLs, thumbnails, dimensions
- Lists (30000+): systematic list item extraction
- Reposts (6, 16, 18): reposted event extraction
- Highlights (9802): context, highlight text
- Calendar (31922-31925): date/time parsing
- Polls (1068): options, votes, tally

**Note**: Submit generic ones to applesauce-core upstream

#### 3.3 Accessibility Improvements
**Priority**: Medium | **Effort**: Medium
**Files**: All renderers, BaseEventContainer

**Target**: WCAG AA compliance

**Tasks**:
- Semantic HTML (`<article>`, `<time>`, proper headings)
- ARIA labels and roles (`role="feed"`, `aria-label` on actions)
- Keyboard navigation system (arrow keys, enter, escape)
- Focus management (modals, detail views)
- Screen reader testing and fixes
- Color contrast audit

#### 3.4 Internationalization
**Priority**: Medium | **Effort**: Medium
**Files**: Setup i18n infrastructure, translate all components

**Problem**: Hardcoded English strings, inconsistent locale usage

**Solution**:
- i18next integration
- Extract all hardcoded strings
- Locale-aware number/date formatting (zap amounts, timestamps)
- Kind name translations
- RTL support improvements (related to existing RTL TODO)

#### 3.5 Composable Renderer System
**Priority**: Medium | **Effort**: High
**Files**: Refactor complex renderers

**Problem**: Renderers are monolithic, hard to reuse pieces

**Solution**: Break into smaller components
- Content components (primary payload display)
- Metadata components (structured data display)
- Relationship components (connections/replies)
- Action components (user interactions)
- Enable mix-and-match composition
