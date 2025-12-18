# Comprehensive Keyboard Navigation Plan for Grimoire

**Date**: 2025-12-18
**Status**: Planning Phase
**Complexity**: High - System-wide architectural enhancement

---

## Executive Summary

This document outlines a comprehensive plan to implement top-tier keyboard navigation across the grimoire application, making every feature accessible via keyboard without compromising usability. The system follows established patterns from vim, VS Code, and tiling window managers while maintaining WCAG 2.1 Level AA accessibility compliance.

**Key Goals**:
- 100% keyboard navigable (no mouse required for any operation)
- Intuitive vim-style + arrow key hybrid navigation
- Spatial window navigation between tiles
- Clear visual focus indicators
- Accessibility-first design

---

## Current State Analysis

### Existing Keyboard Support ✅

1. **Global Shortcuts**:
   - `Cmd/Ctrl+K`: Toggle command launcher (implemented in `Home.tsx:38-48`)
   - `Cmd/Ctrl+1-9`: Switch workspaces by position (implemented in `TabBar.tsx:22-38`)

2. **Command Launcher** (`CommandLauncher.tsx`):
   - Uses `cmdk` library with built-in keyboard navigation
   - `↑↓`: Navigate commands
   - `↵`: Execute command
   - `Esc`: Close launcher

### Missing Keyboard Support ❌

1. **Window-Level Navigation**:
   - No way to move focus between tiled windows with keyboard
   - No visual indicator showing which window is active
   - No keyboard shortcut to close active window

2. **Content Navigation**:
   - **ReqViewer**: No keyboard navigation in event feeds (Virtuoso list)
   - **EventDetailViewer**: No keyboard scrolling controls
   - **ProfileViewer**: Unknown navigation state (needs investigation)
   - Cannot select items in lists, must click

3. **Enhanced Features**:
   - No keyboard shortcuts help dialog
   - No focus management system
   - No accessibility optimizations beyond default browser behavior

---

## Proposed Keyboard Navigation System

### Design Philosophy

**Hybrid Approach**: Support both vim-style keys AND arrow keys
- **Rationale**: Vim users are power users (target audience), arrows are discoverable for newcomers
- **Pattern**: All navigation shortcuts work with both vim keys and arrows
- **Accessibility**: Multiple input methods maximize usability

### Navigation Hierarchy

The system operates on four distinct levels, from highest to lowest priority:

```
┌─────────────────────────────────────────┐
│  1. MODAL LEVEL (highest priority)     │
│     Dialogs, command launcher           │
│     Captures: Esc, Tab, Enter           │
└─────────────────────────────────────────┘
              ↓ (if not handled)
┌─────────────────────────────────────────┐
│  2. WINDOW LEVEL                        │
│     Moving between tiled windows        │
│     Captures: Alt+Arrows, Cmd+W         │
└─────────────────────────────────────────┘
              ↓ (if not handled)
┌─────────────────────────────────────────┐
│  3. CONTENT LEVEL                       │
│     Navigating inside active window     │
│     Captures: J/K, Enter, G, Space      │
└─────────────────────────────────────────┘
              ↓ (if not handled)
┌─────────────────────────────────────────┐
│  4. GLOBAL LEVEL (lowest priority)      │
│     Workspace switching, global actions │
│     Captures: Cmd+1-9, Cmd+K, Shift+?   │
└─────────────────────────────────────────┘
```

---

## Complete Keyboard Shortcut Map

### Global Shortcuts (Work Everywhere)

| Shortcut | Action | Status | Priority |
|----------|--------|--------|----------|
| `Cmd/Ctrl+K` | Toggle command launcher | ✅ Exists | - |
| `Cmd/Ctrl+1-9` | Switch workspace | ✅ Exists | - |
| `Cmd/Ctrl+W` | Close active window | ❌ New | High |
| `Cmd/Ctrl+Shift+W` | Close all windows in workspace | ❌ New | Medium |
| `Cmd/Ctrl+N` | New window (opens launcher) | ❌ New | Low |
| `Shift+?` | Show keyboard shortcuts help | ❌ New | High |
| `Esc` | Close modal or blur focus | 🟡 Partial | High |

### Window Navigation (Between Tiles)

| Shortcut | Action | Status | Priority |
|----------|--------|--------|----------|
| `Alt+←/→/↑/↓` | Move focus to adjacent window | ❌ New | **Critical** |
| `Cmd+Shift+←/→/↑/↓` | Alternative window navigation (Mac) | ❌ New | Medium |
| Visual focus indicator | Show active window with accent border | ❌ New | **Critical** |

**Design Note**: `Alt+Arrow` chosen over `Cmd+Arrow` to avoid conflicts with macOS system shortcuts. Mac users can use `Cmd+Shift+Arrow` as alternative.

### Feed/List Navigation (ReqViewer, Lists)

| Shortcut | Action | Status | Priority |
|----------|--------|--------|----------|
| `J` or `↓` | Next item in list | ❌ New | **Critical** |
| `K` or `↑` | Previous item in list | ❌ New | **Critical** |
| `G` | Jump to first item | ❌ New | High |
| `Shift+G` | Jump to last item | ❌ New | High |
| `Enter` | Open selected item detail | ❌ New | **Critical** |
| `Space` | Page down | ❌ New | Medium |
| `Shift+Space` | Page up | ❌ New | Medium |
| Visual selection | Highlight selected item | ❌ New | **Critical** |

### Detail View Navigation (EventDetailViewer, ProfileViewer)

| Shortcut | Action | Status | Priority |
|----------|--------|--------|----------|
| `J` or `↓` | Scroll down | ❌ New | High |
| `K` or `↑` | Scroll up | ❌ New | High |
| `G` | Scroll to top | ❌ New | Medium |
| `Shift+G` | Scroll to bottom | ❌ New | Medium |
| `Space` | Page down | ❌ New | High |
| `Shift+Space` | Page up | ❌ New | High |

### Command Launcher (Already Implemented)

| Shortcut | Action | Status |
|----------|--------|--------|
| `↑↓` | Navigate commands | ✅ Exists |
| `↵` | Execute command | ✅ Exists |
| `Esc` | Close launcher | ✅ Exists |

---

## Technical Architecture

### 1. Focus State Management

**Location**: `src/core/keyboard-nav-state.ts` (new file)

```typescript
interface KeyboardNavState {
  // Current focus level in hierarchy
  focusLevel: 'global' | 'window' | 'content' | 'modal';

  // ID of currently active window (for window-level nav)
  activeWindowId: string | null;

  // Per-window focus state (persists when switching windows)
  windowFocus: Map<string, WindowFocusState>;

  // Stack of open modals (for nested modal handling)
  modalStack: string[];

  // Registered keyboard shortcuts
  shortcuts: Map<string, KeyboardShortcut>;
}

interface WindowFocusState {
  selectedIndex: number;      // For list-based viewers
  scrollPosition: number;      // For detail viewers
  lastFocusTime: number;       // For focus history
  viewerType: 'list' | 'detail' | 'other';
}

interface KeyboardShortcut {
  key: string;
  modifiers: ('cmd' | 'ctrl' | 'shift' | 'alt')[];
  level: 'global' | 'window' | 'content' | 'modal';
  handler: (event: KeyboardEvent) => boolean; // Return true if handled
  description: string;
  enabled: (state: KeyboardNavState) => boolean;
}
```

**Jotai Atoms**:
```typescript
export const keyboardNavStateAtom = atom<KeyboardNavState>({...});
export const activeWindowIdAtom = atom(
  (get) => get(keyboardNavStateAtom).activeWindowId
);
export const focusLevelAtom = atom(
  (get) => get(keyboardNavStateAtom).focusLevel
);
```

### 2. Focus Manager Service

**Location**: `src/services/focus-manager.ts` (new file)

```typescript
class FocusManager {
  private spatialGrid: Map<string, WindowPosition> = new Map();

  /**
   * Calculate window positions in a spatial grid
   * Used for directional navigation (Alt+Arrow)
   */
  updateSpatialGrid(layout: MosaicNode<string>, windowElements: Map<string, HTMLElement>): void;

  /**
   * Find window in given direction from current window
   * Returns null if no window exists in that direction
   */
  getWindowInDirection(
    fromWindowId: string,
    direction: 'up' | 'down' | 'left' | 'right'
  ): string | null;

  /**
   * Move focus to a window with smooth transition
   */
  focusWindow(windowId: string): void;

  /**
   * Get ordered list of windows (for Tab navigation)
   */
  getWindowOrder(): string[];

  /**
   * Persist focus state to localStorage
   */
  saveFocusState(state: KeyboardNavState): void;

  /**
   * Restore focus state from localStorage
   */
  loadFocusState(): KeyboardNavState | null;
}

export const focusManager = new FocusManager();
```

**Spatial Grid Algorithm**:
```typescript
interface WindowPosition {
  windowId: string;
  bounds: DOMRect;
  centerX: number;
  centerY: number;
}

// For direction 'right': find window with centerX > current.centerX,
// closest in Y-axis, then closest in X-axis
function findInDirection(
  current: WindowPosition,
  direction: Direction,
  allWindows: WindowPosition[]
): WindowPosition | null {
  // Filter windows in the correct direction
  // Sort by distance (Y-axis first for left/right, X-axis first for up/down)
  // Return closest window
}
```

### 3. Keyboard Event Router

**Location**: `src/lib/keyboard-router.ts` (new file)

```typescript
class KeyboardRouter {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private state: KeyboardNavState;

  /**
   * Register a keyboard shortcut
   */
  register(shortcut: KeyboardShortcut): () => void; // Returns unregister function

  /**
   * Handle keyboard event and route to appropriate level
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    const key = this.normalizeKey(event);

    // Try levels in order: modal → window → content → global
    for (const level of ['modal', 'window', 'content', 'global']) {
      if (this.state.focusLevel !== level && level !== 'global') continue;

      const shortcuts = this.getShortcutsForLevel(level);
      for (const shortcut of shortcuts) {
        if (this.matchesShortcut(event, shortcut) && shortcut.enabled(this.state)) {
          const handled = shortcut.handler(event);
          if (handled) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
        }
      }
    }

    return false; // Not handled, allow default behavior
  }

  private normalizeKey(event: KeyboardEvent): string {
    // Normalize key names across browsers
    // Handle special cases (Meta vs Cmd, etc.)
  }

  private matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
    // Check if event matches shortcut's key + modifiers
  }
}

export const keyboardRouter = new KeyboardRouter();
```

**Integration Point** (`src/App.tsx` or `Home.tsx`):
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    keyboardRouter.handleKeyDown(e);
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, []);
```

### 4. Custom Hooks

**Location**: `src/hooks/keyboard-nav/` (new directory)

#### `useKeyboardNav.ts`
```typescript
export function useKeyboardNav(config: KeyboardNavConfig) {
  const [state, setState] = useAtom(keyboardNavStateAtom);

  useEffect(() => {
    const shortcuts = config.shortcuts.map(s =>
      keyboardRouter.register(s)
    );

    return () => shortcuts.forEach(unregister => unregister());
  }, [config.shortcuts]);

  return {
    isActive: state.focusLevel === config.level,
    focusLevel: state.focusLevel,
  };
}
```

#### `useWindowFocus.ts`
```typescript
export function useWindowFocus(windowId: string) {
  const [activeWindowId, setActiveWindowId] = useAtom(activeWindowIdAtom);
  const isActive = activeWindowId === windowId;

  const focus = useCallback(() => {
    setActiveWindowId(windowId);
    focusManager.focusWindow(windowId);
  }, [windowId, setActiveWindowId]);

  return { isActive, focus };
}
```

#### `useListNavigation.ts`
```typescript
export function useListNavigation<T>(config: {
  items: T[];
  onSelect: (item: T, index: number) => void;
  windowId: string;
  virtuosoRef?: React.RefObject<VirtuosoHandle>;
}) {
  const [state, setState] = useAtom(keyboardNavStateAtom);
  const windowFocus = state.windowFocus.get(config.windowId);
  const selectedIndex = windowFocus?.selectedIndex ?? 0;

  const moveSelection = useCallback((delta: number) => {
    const newIndex = Math.max(0, Math.min(config.items.length - 1, selectedIndex + delta));

    setState(prev => ({
      ...prev,
      windowFocus: new Map(prev.windowFocus).set(config.windowId, {
        ...windowFocus,
        selectedIndex: newIndex,
      }),
    }));

    // Scroll to item in Virtuoso
    config.virtuosoRef?.current?.scrollToIndex({
      index: newIndex,
      behavior: 'smooth',
      align: 'center',
    });
  }, [selectedIndex, config, setState]);

  const selectCurrent = useCallback(() => {
    const item = config.items[selectedIndex];
    if (item) config.onSelect(item, selectedIndex);
  }, [selectedIndex, config]);

  // Register keyboard shortcuts
  useKeyboardNav({
    level: 'content',
    shortcuts: [
      { key: 'j', handler: () => { moveSelection(1); return true; } },
      { key: 'k', handler: () => { moveSelection(-1); return true; } },
      { key: 'ArrowDown', handler: () => { moveSelection(1); return true; } },
      { key: 'ArrowUp', handler: () => { moveSelection(-1); return true; } },
      { key: 'Enter', handler: () => { selectCurrent(); return true; } },
      { key: 'g', handler: () => { moveSelection(-selectedIndex); return true; } },
      { key: 'G', modifiers: ['shift'], handler: () => {
        moveSelection(config.items.length - selectedIndex - 1);
        return true;
      } },
    ],
  });

  return { selectedIndex, moveSelection, selectCurrent };
}
```

#### `useScrollNav.ts`
```typescript
export function useScrollNav(config: {
  containerRef: React.RefObject<HTMLElement>;
  windowId: string;
}) {
  const scroll = useCallback((delta: number) => {
    const container = config.containerRef.current;
    if (!container) return;

    container.scrollBy({
      top: delta,
      behavior: 'smooth',
    });
  }, [config.containerRef]);

  const scrollToTop = useCallback(() => {
    const container = config.containerRef.current;
    if (!container) return;

    container.scrollTo({ top: 0, behavior: 'smooth' });
  }, [config.containerRef]);

  const scrollToBottom = useCallback(() => {
    const container = config.containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  }, [config.containerRef]);

  // Register keyboard shortcuts
  useKeyboardNav({
    level: 'content',
    shortcuts: [
      { key: 'j', handler: () => { scroll(100); return true; } },
      { key: 'k', handler: () => { scroll(-100); return true; } },
      { key: 'ArrowDown', handler: () => { scroll(100); return true; } },
      { key: 'ArrowUp', handler: () => { scroll(-100); return true; } },
      { key: ' ', handler: () => { scroll(window.innerHeight * 0.8); return true; } },
      { key: ' ', modifiers: ['shift'], handler: () => { scroll(-window.innerHeight * 0.8); return true; } },
      { key: 'g', handler: () => { scrollToTop(); return true; } },
      { key: 'G', modifiers: ['shift'], handler: () => { scrollToBottom(); return true; } },
    ],
  });

  return { scroll, scrollToTop, scrollToBottom };
}
```

---

## Visual Focus Design

### Window Focus Indicators

```css
/* Active window - accent border */
.mosaic-window[data-active="true"] {
  border: 2px solid hsl(var(--accent));
  box-shadow: 0 0 0 1px hsl(var(--accent) / 0.2);
  z-index: 1;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

/* Inactive window - muted border */
.mosaic-window[data-active="false"] {
  border: 1px solid hsl(var(--border));
  transition: border-color 150ms ease;
}
```

### Content Focus Indicators

```css
/* Selected list item */
.feed-item[data-selected="true"] {
  background-color: hsl(var(--accent) / 0.1);
  border-left: 2px solid hsl(var(--accent));
  transition: background-color 120ms ease, border-color 120ms ease;
}

/* Hover state (distinct from keyboard focus) */
.feed-item:hover:not([data-selected="true"]) {
  background-color: hsl(var(--muted));
}

/* Keyboard focus ring (for accessibility) */
*:focus-visible {
  outline: 2px solid hsl(var(--accent));
  outline-offset: 2px;
}

/* Hide focus ring on mouse/touch interaction */
*:focus:not(:focus-visible) {
  outline: none;
}
```

### Focus Transitions

```css
/* Smooth focus transitions */
.mosaic-window,
.feed-item,
button,
a {
  transition:
    border-color 150ms ease,
    background-color 120ms ease,
    box-shadow 150ms ease,
    outline-color 150ms ease;
}

/* Layout transition animation (for preset changes) */
body.animating-layout .mosaic-window {
  transition:
    all 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## Component-Level Implementation

### 1. Window Tile Wrapper (`WindowTitle.tsx` - enhance existing)

**Changes needed**:
```typescript
export function WindowTile({ id, window, path, onClose, onEditCommand }: WindowTileProps) {
  const { isActive, focus } = useWindowFocus(id);
  const windowRef = useRef<HTMLDivElement>(null);

  // Register window in spatial grid
  useEffect(() => {
    if (windowRef.current) {
      focusManager.registerWindow(id, windowRef.current);
    }
    return () => focusManager.unregisterWindow(id);
  }, [id]);

  // Handle click to focus
  const handleClick = useCallback(() => {
    focus();
  }, [focus]);

  return (
    <MosaicWindow
      path={path}
      title={...}
      toolbarControls={<WindowToolbar />}
      data-window-id={id}
      data-active={isActive}
      ref={windowRef}
      onClick={handleClick}
      tabIndex={0} // Make focusable
      className={cn(
        "mosaic-window",
        isActive && "mosaic-window--active"
      )}
    >
      {/* Render window content */}
    </MosaicWindow>
  );
}
```

### 2. ReqViewer Enhancement (List Navigation)

**Changes needed in `ReqViewer.tsx`**:
```typescript
export default function ReqViewer({ filter, relays, ... }: ReqViewerProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { addWindow } = useGrimoire();

  // Use list navigation hook
  const { selectedIndex } = useListNavigation({
    items: events,
    onSelect: (event) => {
      // Open event detail in new window
      addWindow('event-detail', {
        pointer: { id: event.id, relays: relays || [] }
      });
    },
    windowId: 'req-viewer-id', // Need to track this from props
    virtuosoRef,
  });

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header ... */}

      <div className="flex-1 overflow-y-auto">
        <Virtuoso
          ref={virtuosoRef}
          data={events}
          computeItemKey={(index, item) => item.id}
          itemContent={(index, event) => (
            <div
              data-selected={index === selectedIndex}
              className="feed-item"
            >
              <MemoizedFeedEvent event={event} />
            </div>
          )}
        />
      </div>
    </div>
  );
}
```

### 3. EventDetailViewer Enhancement (Scroll Navigation)

**Changes needed in `EventDetailViewer.tsx`**:
```typescript
export function EventDetailViewer({ pointer }: EventDetailViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Use scroll navigation hook
  useScrollNav({
    containerRef,
    windowId: 'event-detail-id', // Track from props
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header ... */}

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto"
      >
        <EventErrorBoundary event={event}>
          <DetailKindRenderer event={event} />
        </EventErrorBoundary>
      </div>
    </div>
  );
}
```

### 4. Keyboard Shortcuts Help Dialog (New Component)

**Location**: `src/components/KeyboardShortcutsDialog.tsx` (new file)

```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { useState } from 'react';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  const [search, setSearch] = useState('');

  // Get all shortcuts from keyboard router
  const shortcuts = keyboardRouter.getAllShortcuts();

  // Filter by search
  const filtered = shortcuts.filter(s =>
    s.description.toLowerCase().includes(search.toLowerCase()) ||
    s.key.toLowerCase().includes(search.toLowerCase())
  );

  // Group by level
  const grouped = {
    global: filtered.filter(s => s.level === 'global'),
    window: filtered.filter(s => s.level === 'window'),
    content: filtered.filter(s => s.level === 'content'),
    modal: filtered.filter(s => s.level === 'modal'),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <Input
          placeholder="Search shortcuts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4"
        />

        {/* Shortcuts grouped by level */}
        <div className="flex-1 overflow-y-auto space-y-6">
          {Object.entries(grouped).map(([level, shortcuts]) => (
            shortcuts.length > 0 && (
              <div key={level}>
                <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
                  {level} Shortcuts
                </h3>
                <div className="space-y-2">
                  {shortcuts.map((shortcut, i) => (
                    <div key={i} className="flex items-center justify-between py-1">
                      <span className="text-sm">{shortcut.description}</span>
                      <kbd className="kbd">{formatShortcut(shortcut)}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts = [];
  if (shortcut.modifiers.includes('cmd')) parts.push('⌘');
  if (shortcut.modifiers.includes('ctrl')) parts.push('Ctrl');
  if (shortcut.modifiers.includes('shift')) parts.push('⇧');
  if (shortcut.modifiers.includes('alt')) parts.push('Alt');
  parts.push(shortcut.key.toUpperCase());
  return parts.join(' + ');
}
```

**Usage** (add to `Home.tsx`):
```typescript
const [shortcutsOpen, setShortcutsOpen] = useState(false);

// Register global shortcut
useEffect(() => {
  const unregister = keyboardRouter.register({
    key: '?',
    modifiers: ['shift'],
    level: 'global',
    handler: () => {
      setShortcutsOpen(true);
      return true;
    },
    description: 'Show keyboard shortcuts help',
    enabled: () => true,
  });

  return unregister;
}, []);

return (
  <>
    {/* ... existing JSX ... */}
    <KeyboardShortcutsDialog
      open={shortcutsOpen}
      onOpenChange={setShortcutsOpen}
    />
  </>
);
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-3) - **CRITICAL**

**Priority**: Highest - Core infrastructure

**Goals**:
- ✅ Focus state management system working
- ✅ Window-level navigation functional
- ✅ Visual focus indicators in place
- ✅ Basic keyboard event routing

**Tasks**:
1. **Focus State & Infrastructure** (Week 1):
   - [ ] Create `src/core/keyboard-nav-state.ts` with Jotai atoms
   - [ ] Create `src/services/focus-manager.ts` with spatial grid logic
   - [ ] Create `src/lib/keyboard-router.ts` with event routing
   - [ ] Add focus state persistence to localStorage
   - [ ] Write unit tests for focus manager spatial calculations

2. **Window Navigation** (Week 2):
   - [ ] Implement `useWindowFocus()` hook
   - [ ] Enhance `WindowTitle.tsx` with focus management
   - [ ] Add `Alt+Arrow` window navigation shortcuts
   - [ ] Implement `Cmd+W` close window shortcut
   - [ ] Add visual focus indicators (CSS)
   - [ ] Test with 2, 4, 6, 9 window layouts

3. **Integration & Testing** (Week 3):
   - [ ] Integrate keyboard router with `Home.tsx`
   - [ ] Test across different mosaic layouts
   - [ ] Fix edge cases (no neighbor in direction, first focus, etc.)
   - [ ] Performance testing with many windows
   - [ ] Document Phase 1 functionality

**Success Criteria**:
- Can navigate between all windows using keyboard only
- Visual focus indicator always shows active window
- No keyboard traps (can always move focus)
- Works with all layout presets

### Phase 2: Content Navigation (Weeks 4-6) - **HIGH PRIORITY**

**Priority**: High - User-facing navigation

**Goals**:
- ✅ List navigation in ReqViewer working
- ✅ Scroll navigation in detail viewers working
- ✅ Enter key opens event details
- ✅ Vim keys + arrow keys both work

**Tasks**:
1. **List Navigation Hooks** (Week 4):
   - [ ] Create `src/hooks/keyboard-nav/useListNavigation.ts`
   - [ ] Create `src/hooks/keyboard-nav/useScrollNav.ts`
   - [ ] Create `src/hooks/keyboard-nav/useKeyboardNav.ts`
   - [ ] Write unit tests for navigation hooks
   - [ ] Test with Virtuoso integration

2. **ReqViewer Enhancement** (Week 5):
   - [ ] Integrate `useListNavigation` in `ReqViewer.tsx`
   - [ ] Add visual selection indicators (CSS)
   - [ ] Implement J/K and arrow key navigation
   - [ ] Implement G/Shift+G jump to top/bottom
   - [ ] Implement Enter to open event detail
   - [ ] Test with various feed sizes (10, 100, 1000+ events)

3. **Detail Viewers** (Week 6):
   - [ ] Enhance `EventDetailViewer.tsx` with scroll navigation
   - [ ] Enhance `ProfileViewer.tsx` (if applicable)
   - [ ] Test Space/Shift+Space page navigation
   - [ ] Test G/Shift+G top/bottom navigation
   - [ ] Polish scroll behavior (smooth, eased)

**Success Criteria**:
- Can navigate through any feed using keyboard only
- Selected item always visible (scrolls into view)
- Enter key consistently opens details
- Smooth animations for selection changes

### Phase 3: Enhanced Features (Weeks 7-8) - **MEDIUM PRIORITY**

**Priority**: Medium - UX polish

**Goals**:
- ✅ Keyboard shortcuts help dialog functional
- ✅ All global shortcuts implemented
- ✅ Accessibility testing complete
- ✅ Documentation updated

**Tasks**:
1. **Shortcuts Help Dialog** (Week 7):
   - [ ] Create `src/components/KeyboardShortcutsDialog.tsx`
   - [ ] Implement shortcut search/filter
   - [ ] Add context-aware shortcut display
   - [ ] Integrate with `Shift+?` global shortcut
   - [ ] Style dialog with Tailwind

2. **Global Shortcuts** (Week 7):
   - [ ] Implement `Cmd+Shift+W` close all windows
   - [ ] Implement `Cmd+N` new window
   - [ ] Add Esc to blur focus (when no modal open)
   - [ ] Test for conflicts with browser shortcuts

3. **Accessibility & Polish** (Week 8):
   - [ ] ARIA labels for all interactive elements
   - [ ] ARIA-live regions for state changes
   - [ ] Screen reader testing (VoiceOver, NVDA)
   - [ ] Focus trap testing in modals
   - [ ] Tab order verification
   - [ ] Update documentation with keyboard nav guide

**Success Criteria**:
- Help dialog shows all available shortcuts
- All global shortcuts working without conflicts
- WCAG 2.1 Level AA compliance verified
- Screen reader announces state changes correctly

### Phase 4: Testing & Documentation (Week 9) - **CRITICAL**

**Priority**: Critical - Quality assurance

**Goals**:
- ✅ Comprehensive test coverage
- ✅ E2E tests passing
- ✅ Documentation complete
- ✅ Ready for production

**Tasks**:
1. **Unit & Integration Tests**:
   - [ ] Test focus manager spatial calculations
   - [ ] Test keyboard router event routing
   - [ ] Test all navigation hooks
   - [ ] Test focus state persistence
   - [ ] Achieve >80% code coverage

2. **E2E Tests** (Playwright):
   - [ ] Test complete keyboard navigation workflows
   - [ ] Test window navigation in various layouts
   - [ ] Test list navigation with large datasets
   - [ ] Test accessibility with axe-core
   - [ ] Test across browsers (Chrome, Firefox, Safari)

3. **Documentation**:
   - [ ] Update `CLAUDE.md` with keyboard nav info
   - [ ] Create user guide for keyboard navigation
   - [ ] Document all shortcuts in Help command
   - [ ] Add keyboard nav to README
   - [ ] Create video demo (optional)

**Success Criteria**:
- All tests passing
- No regressions in existing functionality
- Complete documentation
- Positive user feedback (if beta testing)

---

## Edge Cases & Mitigations

### 1. Window Navigation Edge Cases

| Edge Case | Behavior | Mitigation |
|-----------|----------|------------|
| No neighbor in direction | Do nothing | Show subtle visual feedback (border flash) |
| Complex split layouts | Calculate spatial position | Cache grid, update only on layout change |
| Window removed while focused | Move focus to nearest window | Track window order, fallback to first window |
| First app load (no focus) | Focus first window automatically | Default focus in `useEffect` on mount |
| Rapid layout changes | Focus might be lost | Debounce grid recalculation, preserve focus ID |

### 2. Content Navigation Edge Cases

| Edge Case | Behavior | Mitigation |
|-----------|----------|------------|
| Empty list (no items) | Navigation disabled | Show "No items" message, allow global shortcuts |
| List loading | Navigation disabled | Show loading skeleton, re-enable when loaded |
| Very large list (10k+ items) | Virtuoso handles rendering | Only scroll to index, don't force render |
| Item heights vary | Virtuoso calculates | Use `defaultItemHeight` for better performance |
| Rapid key presses | Multiple selection changes | Debounce scroll-to-index calls |

### 3. Modal & Focus Trap

| Edge Case | Behavior | Mitigation |
|-----------|----------|------------|
| Nested modals | Focus top modal | Maintain modal stack, Esc closes top modal first |
| Modal closes | Focus returns to previous | Save focus before modal opens, restore on close |
| Keyboard trap in modal | Can't exit with keyboard | Use radix-ui `FocusTrap`, always allow Esc |
| Focus lost on modal open | Can't navigate | Auto-focus first element in modal on open |

### 4. Browser & OS Conflicts

| Conflict | Issue | Solution |
|----------|-------|----------|
| `Cmd+W` closes tab | Browser intercepts | `preventDefault()` + show confirmation before close |
| `Cmd+1-9` switches tabs | Browser behavior | Already works (implemented in `TabBar.tsx`) |
| `Alt+Arrow` moves cursor | Text input conflict | Only capture when not in input field |
| Screen reader shortcuts | May conflict | Test with screen readers, adjust if needed |

---

## Accessibility Compliance (WCAG 2.1 Level AA)

### Requirements

| Criterion | Description | Implementation |
|-----------|-------------|----------------|
| **2.1.1 Keyboard** | All functionality available via keyboard | ✅ 100% keyboard navigable design |
| **2.1.2 No Keyboard Trap** | Can exit any component with keyboard | ✅ Esc closes modals, Alt+Arrow moves windows |
| **2.4.3 Focus Order** | Tab order is logical and sequential | ✅ Follows visual layout, spatial navigation |
| **2.4.7 Focus Visible** | Keyboard focus indicator always visible | ✅ 2px accent outline on focus |
| **3.2.3 Consistent Navigation** | Navigation consistent across app | ✅ Same shortcuts work everywhere |
| **4.1.2 Name, Role, Value** | ARIA labels for all interactive elements | ✅ ARIA labels on all buttons, windows |

### Implementation Checklist

- [x] Focus indicators ≥2px visible outline
- [ ] ARIA labels on all interactive elements
- [ ] ARIA-live regions for dynamic content
- [ ] Screen reader testing (VoiceOver)
- [ ] Screen reader testing (NVDA)
- [ ] Keyboard-only manual testing
- [ ] Automated accessibility testing (axe-core)
- [ ] Tab order follows visual layout
- [ ] No keyboard traps exist
- [ ] Focus restoration after modal close

---

## Testing Strategy

### Unit Tests (Vitest)

**Location**: Colocated with source files (e.g., `focus-manager.test.ts`)

**Test Coverage**:
```typescript
// src/services/focus-manager.test.ts
describe('FocusManager', () => {
  describe('spatial grid calculations', () => {
    it('should calculate window positions correctly', () => {...});
    it('should find window to the right', () => {...});
    it('should find window to the left', () => {...});
    it('should return null when no window in direction', () => {...});
    it('should handle complex split layouts', () => {...});
  });

  describe('focus transitions', () => {
    it('should focus window by ID', () => {...});
    it('should update focus state', () => {...});
    it('should persist focus state to localStorage', () => {...});
  });
});

// src/lib/keyboard-router.test.ts
describe('KeyboardRouter', () => {
  describe('shortcut registration', () => {
    it('should register shortcut', () => {...});
    it('should unregister shortcut', () => {...});
    it('should handle duplicate shortcuts', () => {...});
  });

  describe('event routing', () => {
    it('should route to correct level', () => {...});
    it('should handle modifier keys', () => {...});
    it('should preventDefault when handled', () => {...});
    it('should not preventDefault when not handled', () => {...});
  });
});

// src/hooks/keyboard-nav/useListNavigation.test.ts
describe('useListNavigation', () => {
  it('should move selection down', () => {...});
  it('should move selection up', () => {...});
  it('should not go below 0', () => {...});
  it('should not go above items.length', () => {...});
  it('should select current item on Enter', () => {...});
  it('should jump to top on G', () => {...});
  it('should jump to bottom on Shift+G', () => {...});
});
```

**Coverage Goal**: >80%

### Integration Tests (Vitest + Testing Library)

**Test Scenarios**:
```typescript
describe('Keyboard Navigation Integration', () => {
  it('should navigate between windows with Alt+Arrow', () => {
    // Render Home with multiple windows
    // Simulate Alt+Right keypress
    // Assert focus moved to next window
  });

  it('should navigate list in ReqViewer with J/K', () => {
    // Render ReqViewer with events
    // Simulate J keypress
    // Assert selection moved down
    // Assert item scrolled into view
  });

  it('should open event detail with Enter', () => {
    // Render ReqViewer with events
    // Select first item with J
    // Simulate Enter keypress
    // Assert addWindow called with event detail
  });

  it('should preserve focus when switching workspaces', () => {
    // Render Home with multiple workspaces
    // Focus window 2 in workspace 1
    // Switch to workspace 2 with Cmd+2
    // Switch back to workspace 1 with Cmd+1
    // Assert window 2 still focused
  });
});
```

### E2E Tests (Playwright MCP)

**Test Workflows**:
```typescript
test.describe('Keyboard Navigation E2E', () => {
  test('complete navigation workflow', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // Open command launcher with Cmd+K
    await page.keyboard.press('Meta+K');
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Type command and execute
    await page.keyboard.type('req -k 1 -l 10');
    await page.keyboard.press('Enter');

    // Wait for window to open
    await expect(page.locator('[data-window-id]').first()).toBeVisible();

    // Navigate list with J key
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');

    // Open detail with Enter
    await page.keyboard.press('Enter');

    // Should open new window
    const windows = page.locator('[data-window-id]');
    await expect(windows).toHaveCount(2);

    // Navigate between windows with Alt+Left
    await page.keyboard.press('Alt+ArrowLeft');

    // Should focus first window
    const firstWindow = windows.first();
    await expect(firstWindow).toHaveAttribute('data-active', 'true');

    // Close window with Cmd+W
    await page.keyboard.press('Meta+W');

    // Should have 1 window left
    await expect(windows).toHaveCount(1);
  });

  test('accessibility with axe', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // Run axe accessibility scan
    const results = await page.evaluate(() => {
      return (window as any).axe.run();
    });

    expect(results.violations).toHaveLength(0);
  });

  test('keyboard-only navigation (no mouse)', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // Disable mouse
    await page.mouse.move(-1, -1);

    // Complete workflow using only keyboard
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('req -k 1');
    await page.keyboard.press('Enter');
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+?'); // Open shortcuts help
    await page.keyboard.press('Escape'); // Close help
    await page.keyboard.press('Alt+ArrowRight'); // Navigate windows
    await page.keyboard.press('Meta+W'); // Close window

    // All actions should succeed without mouse
  });
});
```

### Manual Testing Checklist

**Pre-Release Testing** (check all before each release):
- [ ] All shortcuts work in all contexts
- [ ] No keyboard traps exist anywhere
- [ ] Focus indicators always visible when using keyboard
- [ ] Tab order is logical and follows visual layout
- [ ] Screen reader announces all state changes (VoiceOver)
- [ ] Screen reader announces all state changes (NVDA)
- [ ] Works with 2 windows layout
- [ ] Works with 4 windows layout (grid)
- [ ] Works with 9 windows layout
- [ ] Works with complex nested layouts
- [ ] Performance acceptable with 10+ windows
- [ ] Focus persists when switching workspaces
- [ ] Focus restores after closing modal
- [ ] No conflicts with browser shortcuts
- [ ] Touch interaction doesn't break keyboard nav
- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Safari

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Keyboard Coverage | 100% | All features accessible via keyboard |
| Focus Transition Time | <100ms | Time to update visual focus indicator |
| Spatial Grid Calculation | <50ms | Time to calculate window positions |
| Code Coverage | >80% | Vitest coverage report |
| Accessibility Score | 100% | axe-core audit (0 violations) |
| Performance Impact | <5% | Bundle size increase from new code |

### Qualitative Metrics

| Metric | Method | Target |
|--------|--------|--------|
| User Satisfaction | Beta testing feedback | >80% positive |
| Discoverability | User testing (unguided) | >60% discover J/K nav |
| Learnability | Time to proficiency | <10 minutes practice |
| Consistency | Design review | 100% consistent patterns |

### Milestone Criteria

**Phase 1 Complete** (Foundation):
- ✅ Window navigation works with Alt+Arrow
- ✅ Visual focus indicators implemented
- ✅ Can close window with Cmd+W
- ✅ No regressions in existing functionality
- ✅ Unit tests passing (>80% coverage)

**Phase 2 Complete** (Content Navigation):
- ✅ List navigation works in ReqViewer
- ✅ Enter opens event detail
- ✅ Scroll navigation works in detail views
- ✅ Both vim keys and arrows work
- ✅ Integration tests passing

**Phase 3 Complete** (Enhanced Features):
- ✅ Shortcuts help dialog functional
- ✅ All global shortcuts implemented
- ✅ WCAG 2.1 Level AA compliant
- ✅ Screen reader testing complete

**Phase 4 Complete** (Testing & Docs):
- ✅ All tests passing (unit + integration + E2E)
- ✅ Documentation complete
- ✅ No known critical bugs
- ✅ Ready for production release

---

## Risk Assessment & Mitigation

### High-Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Browser shortcut conflicts | Medium | High | Extensive testing, provide alternatives |
| react-mosaic-component limitations | Medium | High | Investigate early, fork if needed |
| Performance with many windows | Low | Medium | Spatial grid caching, debounce |
| Screen reader compatibility | Medium | Medium | Early testing, iterative fixes |
| Focus state bugs (edge cases) | High | High | Comprehensive testing, error boundaries |

### Medium-Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Virtuoso integration issues | Low | Medium | Test early, contact maintainer if needed |
| State persistence bugs | Medium | Low | Version state schema, handle migration |
| Touch vs keyboard UX conflicts | Low | Low | Use :focus-visible, test on mobile |
| Documentation incomplete | Low | Medium | Allocate dedicated time in Phase 4 |

### Contingency Plans

1. **If spatial grid performance is slow**:
   - Cache grid calculations
   - Use Web Worker for calculations
   - Simplify algorithm (bounding box only)

2. **If browser conflicts can't be resolved**:
   - Allow user customization of shortcuts
   - Provide alternative shortcuts
   - Document conflicts clearly

3. **If react-mosaic doesn't support focus**:
   - Fork library and add support
   - Build custom focus layer on top
   - Switch to different layout library (worst case)

---

## Future Enhancements (Post-MVP)

### Phase 5: Advanced Features (Optional)

**After Phase 4 is complete and stable**:

1. **Vim-Style Command Mode**:
   - `:` key opens command input (like vim)
   - Type commands directly: `:req -k 1`, `:close`, `:split`
   - Tab completion for commands
   - Command history with up/down arrows

2. **Customizable Shortcuts**:
   - Settings UI for remapping shortcuts
   - Import/export shortcut profiles
   - Preset profiles (vim, emacs, VS Code)

3. **Marks & Jumps**:
   - `m[a-z]` to set mark at current position
   - `'[a-z]` to jump to mark
   - Persist marks across sessions

4. **Search & Navigation**:
   - `/` to search in current window
   - `n/N` to jump to next/previous match
   - Quick jump with single characters (like EasyMotion)

5. **Window Management**:
   - `Ctrl+W s` split window horizontally
   - `Ctrl+W v` split window vertically
   - `Ctrl+W =` equalize window sizes
   - `Ctrl+W o` maximize current window

6. **Macros**:
   - Record keyboard macros with `q[a-z]`
   - Replay with `@[a-z]`
   - Useful for repetitive tasks

---

## Conclusion

This comprehensive keyboard navigation plan transforms grimoire into a fully keyboard-accessible power-user tool. By implementing vim-style shortcuts with arrow key fallbacks, we cater to both experienced developers and newcomers.

**Key Benefits**:
- ⚡ **Efficiency**: Navigate entire app without touching mouse
- ♿ **Accessibility**: WCAG 2.1 Level AA compliant
- 🎓 **Discoverability**: Arrow keys work, vim keys enhance
- 🎯 **Consistency**: Uniform shortcuts across all contexts
- 📈 **Extensibility**: Architecture supports future enhancements

**Total Estimated Timeline**: 6-9 weeks for complete implementation

**Next Steps**:
1. Review plan with stakeholders
2. Prioritize Phase 1 for immediate implementation
3. Create GitHub issues for each task
4. Begin development starting with focus state infrastructure

---

## Appendix: Quick Reference Card

### Quick Keyboard Shortcuts Reference

**Global**:
- `Cmd+K` - Command launcher
- `Cmd+1-9` - Switch workspace
- `Cmd+W` - Close window
- `Shift+?` - Show shortcuts

**Window Navigation**:
- `Alt+←/→/↑/↓` - Move focus

**List Navigation**:
- `J/K` or `↓/↑` - Next/previous
- `G` / `Shift+G` - First/last
- `Enter` - Open detail

**Scroll Navigation**:
- `J/K` or `↓/↑` - Scroll
- `Space` / `Shift+Space` - Page
- `G` / `Shift+G` - Top/bottom

---

*End of Document*
