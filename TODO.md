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
