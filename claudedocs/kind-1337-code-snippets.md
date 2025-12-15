# Kind 1337 Code Snippet Renderer (NIP-C0)

## Overview
Added complete support for kind 1337 (Code Snippet) events from NIP-C0, with both feed and detail renderers.

## Files Created

### 1. Helper Functions (`src/lib/nip-c0-helpers.ts`)
Tag extraction utilities using applesauce-core:
- `getCodeLanguage()` - Programming language (l tag)
- `getCodeName()` - Filename (name tag)
- `getCodeExtension()` - File extension without dot (extension tag)
- `getCodeDescription()` - Description text (description tag)
- `getCodeRuntime()` - Runtime specification (runtime tag)
- `getCodeLicenses()` - Array of license identifiers (license tags)
- `getCodeDependencies()` - Array of dependencies (dep tags)
- `getCodeRepo()` - Repository reference with type detection (URL or NIP-34 address)

### 2. Feed Renderer (`src/components/nostr/kinds/Kind1337Renderer.tsx`)
Compact view showing:
- **Clickable title** - Opens detail view, uses filename or "Code Snippet"
- **Language badge** - Shows programming language in styled chip
- **Description** - Truncated to 2 lines if present
- **Code preview** - First 5 lines with line-clamp and "..." indicator
- Wrapped in `BaseEventContainer` for consistency

### 3. Detail Renderer (`src/components/nostr/kinds/Kind1337DetailRenderer.tsx`)
Full view with:
- **Header** - Title with FileCode icon
- **Metadata section** (before code):
  - Language and Extension
  - Description
  - Runtime (if present)
  - Licenses (if present)
  - Dependencies list (if present)
  - Repository link:
    - NIP-34 address → clickable, opens repository event
    - URL → external link with icon
- **Code section**:
  - Full code in `<pre>` with `font-mono` styling
  - Copy button inline (absolute positioned top-right)
  - Matches JsonViewer pattern

## Integration Points

### Kinds Registry
Already existed in `src/constants/kinds.ts`:
```typescript
1337: {
  kind: 1337,
  name: "Code",
  description: "Code Snippet",
  nip: "C0",
  icon: FileCode,
}
```

### Event Title System
Added to `src/lib/event-title.ts`:
```typescript
case 1337: // Code snippet
  title = getCodeName(event);
  break;
```
Window titles show filename or fall back to "Code Snippet"

### Renderer Registry
Added to `src/components/nostr/kinds/index.tsx`:
```typescript
1337: Kind1337Renderer, // Code Snippet (NIP-C0)
```

## Features

### Feed View
- Clean, compact display
- Language identification at a glance
- Quick code preview without opening
- Clickable to open full view

### Detail View
- Complete metadata display
- NIP-34 repository integration (handles both URLs and Nostr addresses)
- One-click copy functionality
- Clean, readable code display
- Professional layout with metadata organized before code

## Design Decisions

### No Syntax Highlighting (MVP)
- Uses plain `<pre>` with `font-mono` styling (matching JsonViewer)
- No new dependencies added
- Can add syntax highlighting later (react-syntax-highlighter) as enhancement

### No Download Button
- Simplified to just Copy functionality
- Users can copy and save manually
- Reduces UI complexity

### Metadata Before Code
- More scannable - users see what the code is before reading it
- Follows natural information hierarchy
- Easier to understand context

### Copy Button Position
- Inline in code section (top-right absolute)
- Matches existing JsonViewer pattern
- Consistent UX across app

## NIP-C0 Compliance

Supports all NIP-C0 tags:
- ✅ `l` - Programming language
- ✅ `name` - Filename
- ✅ `extension` - File extension
- ✅ `description` - Description
- ✅ `runtime` - Runtime specification
- ✅ `license` - License(s) (supports multiple)
- ✅ `dep` - Dependencies (supports multiple)
- ✅ `repo` - Repository reference (URL or NIP-34)

## Future Enhancements

Potential improvements for Phase 2:
1. **Syntax Highlighting** - Add react-syntax-highlighter for color-coded display
2. **Line Numbers** - Optional line numbers for code blocks
3. **Code Formatting** - Auto-format/prettify code
4. **Run Functionality** - Execute supported languages (complex, low priority)
5. **Download Button** - Add back if users request it
6. **Diff View** - For patches or code changes

## Testing

- ✅ Type check passes
- ✅ Integrates with existing event title system
- ✅ Follows established component patterns
- ✅ Uses applesauce-core helpers consistently
- ✅ NIP-34 repository links handled correctly

## Usage

Users can now:
1. View code snippets in feeds with preview
2. Click to open full detail view
3. See all metadata (language, runtime, deps, etc.)
4. Copy code with one click
5. Navigate to referenced repositories (NIP-34 or URLs)
6. See proper window titles with filenames
