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

## TODO: compact Live indicator for REQ viewer
## TODO: nested lists in Markdown should be padded
## TODO: "live" sometimes not working?
look into reconnecting on errors
## TODO: improve text rendering

avoid inserting `br`, look into noStrudel's eol metadata

## TODO: window crashes on unsupported kind event
## TODO: app-wide error boundary. splash crash screen.
