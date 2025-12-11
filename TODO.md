# TODO

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

### NIP-05 Resolution with @ Prefix
**Priority**: High
**File**: `src/lib/nip05.ts`

**Issue**: Commands like `req -a @fiatjaf.com` (without username, just @domain) return unexpected results.

**Current behavior**:
- `req -a fiatjaf.com` works (normalized to `_@fiatjaf.com`) ✅
- `req -a user@fiatjaf.com` works ✅
- `req -a @fiatjaf.com` fails - not recognized as valid NIP-05 ❌

**Root cause**: The `isNip05()` regex patterns don't match the `@domain.com` format (@ prefix without username).

**Solution**: Either normalize `@domain.com` → `_@domain.com` or show helpful error message.

### Live Mode Reliability
**Priority**: High
**File**: `src/components/ReqViewer.tsx`

**Issues**:
- Live mode sometimes stops updating (gets stuck)
- May be related to reconnection on errors
- Compact live indicator needed for better UX

**Investigation needed**: Check relay reconnection logic and subscription lifecycle.

### Rendering Issues
**Priority**: Medium

- **Window crashes on unsupported kind event** - Need graceful error handling for unknown kinds
- **Nested lists in Markdown should be padded** - Markdown renderer spacing issue
- **Text rendering**: Avoid inserting `<br>` tags, investigate noStrudel's EOL metadata approach

## Command Palette / UX Improvements

### Enter Key Behavior
When selecting an action from the dropdown, pressing Enter should insert the command at the beginning of the command line (currently requires manual typing).

### Command Options Display
When an action is entered, show the list of available options below and provide auto-completion for flags/arguments.

### Date Display
Show timestamps/dates for notes in feed views for better chronological context.

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

## Planned Improvements

- **App-wide error boundary** - Splash crash screen for unhandled errors
- **Collapsible relay list** - Show user relay links without inbox/outbox icons initially
- **NIP badges everywhere** - Use consistent NIP badge components for linking to NIP documentation
- **External spec event kind support** - Add references and documentation links for commented-out event kinds from external specs (Blossom, Marmot Protocol, NKBIP, nostrocket, Corny Chat, NUD, etc.) in `src/constants/kinds.ts`. Consider adding a separate registry or documentation for non-official-NIP event kinds.

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
