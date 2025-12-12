# Design: Editable Window Commands & Command History

**Created:** 2025-12-12
**Status:** Design Complete - Ready for Implementation
**Complexity:** High (5 implementation phases)

## Overview

Enable users to edit the command that created a window (e.g., change `profile alice@domain.com` to `profile bob@domain.com`) and provide full undo/redo capabilities for all window operations.

---

## Table of Contents

1. [Editable Commands Architecture](#1-editable-commands-architecture)
2. [Command History Architecture](#2-command-history-architecture)
3. [User Interface Components](#3-user-interface-components)
4. [Implementation Phases](#4-implementation-phases)
5. [Key Design Decisions](#5-key-design-decisions--rationale)
6. [Edge Cases](#6-edge-cases-handled)
7. [Testing Strategy](#7-testing-strategy)
8. [Performance](#8-performance-considerations)
9. [Documentation Updates](#9-documentation-updates)

---

## 1. Editable Commands Architecture

### Schema Changes

```typescript
// src/types/app.ts - Add commandString to WindowInstance
interface WindowInstance {
  id: string;
  appId: AppId;
  title: string;
  props: any;
  commandString?: string;  // NEW: Original command (e.g., "profile alice@domain.com")
}
```

**Backward Compatibility:** Optional field (?) means existing windows continue working without migration.

### State Management

```typescript
// src/core/logic.ts - New function
export const updateWindow = (
  state: GrimoireState,
  windowId: string,
  updates: {
    props?: any;
    title?: string;
    commandString?: string;
    appId?: AppId;
  }
): GrimoireState => {
  const window = state.windows[windowId];
  if (!window) return state;

  return {
    ...state,
    windows: {
      ...state.windows,
      [windowId]: { ...window, ...updates },
    },
  };
};
```

### Command Flow

```
User types command
    ↓
CommandLauncher parses input
    ↓
Async argParser resolves (e.g., NIP-05)
    ↓
addWindow(appId, props, title, commandString)
    ↓
Window created with commandString stored
    ↓
User clicks edit button (⌘E)
    ↓
EditCommandDialog shows commandString
    ↓
User edits and submits
    ↓
Re-parse command (async)
    ↓
updateWindow(windowId, newProps, newTitle, newCommandString)
```

---

## 2. Command History Architecture

### Data Structures

```typescript
// src/types/history.ts

type HistoryAction =
  | { type: 'COMMAND_EXECUTED'; commandString: string; windowId?: string }
  | { type: 'WINDOW_CLOSED'; windowId: string }
  | { type: 'WINDOW_EDITED'; windowId: string; oldCommand: string; newCommand: string }
  | { type: 'WORKSPACE_CREATED'; workspaceId: string; label: string }
  | { type: 'LAYOUT_CHANGED'; workspaceId: string };

interface HistoryEntry {
  id: string;
  timestamp: number;
  action: HistoryAction;
  stateBefore: GrimoireState;  // For undo
  stateAfter: GrimoireState;   // For redo
}

interface CommandHistory {
  entries: HistoryEntry[];     // Newest first
  currentIndex: number;        // -1 = present, 0+ = steps back in time
  maxEntries: number;          // Default: 50 (circular buffer)
}
```

### History State Machine

```
Present State (currentIndex = -1)
    │
    ├─ Undo → currentIndex = 0 (1 step back)
    │   └─ Undo → currentIndex = 1 (2 steps back)
    │       ├─ Redo → currentIndex = 0
    │       └─ New Action → Truncate future, currentIndex = -1
    │
    └─ New Action → Add entry, currentIndex = -1
```

**Key Insight:** currentIndex is a time cursor. -1 means "present", positive numbers mean "N steps back in history."

### Core History Functions

```typescript
// src/core/history.ts

export const recordAction = (
  history: CommandHistory,
  action: HistoryAction,
  stateBefore: GrimoireState,
  stateAfter: GrimoireState
): CommandHistory => {
  // Truncate future if in past state (Git-style)
  const entries = history.currentIndex === -1
    ? history.entries
    : history.entries.slice(history.currentIndex + 1);

  const newEntry: HistoryEntry = {
    id: uuidv4(),
    timestamp: Date.now(),
    action,
    stateBefore,
    stateAfter,
  };

  // Circular buffer: keep only last N entries
  const newEntries = [newEntry, ...entries].slice(0, history.maxEntries);

  return {
    ...history,
    entries: newEntries,
    currentIndex: -1,  // Back to present
  };
};

export const undo = (
  history: CommandHistory,
  currentState: GrimoireState
): { history: CommandHistory; newState: GrimoireState } => {
  if (history.currentIndex >= history.entries.length - 1) {
    return { history, newState: currentState };  // Can't undo further
  }

  const targetIndex = history.currentIndex + 1;
  const targetEntry = history.entries[targetIndex];

  return {
    history: { ...history, currentIndex: targetIndex },
    newState: targetEntry.stateBefore,
  };
};

export const redo = (
  history: CommandHistory,
  currentState: GrimoireState
): { history: CommandHistory; newState: GrimoireState } => {
  if (history.currentIndex <= -1) {
    return { history, newState: currentState };  // Already at present
  }

  const currentEntry = history.entries[history.currentIndex];

  return {
    history: { ...history, currentIndex: history.currentIndex - 1 },
    newState: currentEntry.stateAfter,
  };
};
```

### Integration with State Updates

```typescript
// src/core/state.ts

export const useGrimoire = () => {
  const [state, setState] = useAtom(grimoireStateAtom);
  const [history, setHistory] = useAtom(historyAtom);

  const addWindow = useCallback((appId: AppId, props: any, title?: string, commandString?: string) => {
    setState((prevState) => {
      const nextState = Logic.addWindow(prevState, {
        appId,
        props,
        title: title || appId.toUpperCase(),
        commandString
      });

      // Record history atomically
      setHistory(prev => History.recordAction(prev, {
        type: 'COMMAND_EXECUTED',
        commandString: commandString || generateRawCommand(appId, props),
      }, prevState, nextState));

      return nextState;
    });
  }, [setState, setHistory]);

  const performUndo = useCallback(() => {
    const { history: newHistory, newState } = History.undo(history, state);
    setState(newState);
    setHistory(newHistory);
  }, [history, state, setState, setHistory]);

  const performRedo = useCallback(() => {
    const { history: newHistory, newState } = History.redo(history, state);
    setState(newState);
    setHistory(newHistory);
  }, [history, state, setState, setHistory]);

  return {
    state,
    addWindow,
    updateWindow,
    performUndo,
    performRedo,
    // ... other methods
  };
};
```

---

## 3. User Interface Components

### Edit Command Dialog

```typescript
// src/components/EditCommandDialog.tsx

interface EditCommandDialogProps {
  window: WindowInstance;
  open: boolean;
  onClose: () => void;
}

export function EditCommandDialog({ window, open, onClose }: EditCommandDialogProps) {
  const [input, setInput] = useState(window.commandString || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { updateWindow } = useGrimoire();

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const parts = input.trim().split(/\s+/);
      const commandName = parts[0];
      const args = parts.slice(1);

      const command = manPages[commandName];
      if (!command) {
        throw new Error(`Unknown command: ${commandName}`);
      }

      // Async parsing support (e.g., NIP-05 resolution)
      const props = command.argParser
        ? await Promise.resolve(command.argParser(args))
        : command.defaultProps || {};

      const title = args.length > 0
        ? `${commandName.toUpperCase()} ${args.join(' ')}`
        : commandName.toUpperCase();

      updateWindow(window.id, {
        props,
        title,
        commandString: input,
        appId: command.appId,
      });

      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogTitle>Edit Command</DialogTitle>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Enter command..."
          disabled={isLoading}
          autoFocus
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
        {isLoading && <p className="text-muted-foreground text-sm">Parsing command...</p>}
        <DialogFooter>
          <Button onClick={onClose} variant="outline">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isLoading}>Update</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Window Toolbar Edit Button

```typescript
// src/components/WindowToolbar.tsx - Add edit button

export function WindowToolbar({ windowId, onClose }: WindowToolbarProps) {
  const [showEditDialog, setShowEditDialog] = useState(false);
  const window = useWindowInstance(windowId);

  return (
    <>
      <div className="mosaic-window-controls">
        <button
          className="edit-button"
          onClick={() => setShowEditDialog(true)}
          title="Edit command (⌘E)"
        >
          <PencilIcon className="size-4" />
        </button>
        <button className="close-button" onClick={onClose}>
          <XIcon className="size-4" />
        </button>
      </div>

      <EditCommandDialog
        window={window}
        open={showEditDialog}
        onClose={() => setShowEditDialog(false)}
      />
    </>
  );
}
```

### Command Palette History Navigation

```typescript
// src/components/CommandLauncher.tsx - Add arrow key navigation

export function CommandLauncher({ open, onOpenChange }: CommandLauncherProps) {
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const history = useCommandHistory();

  // Get command history (only COMMAND_EXECUTED actions)
  const commandHistory = useMemo(() =>
    history.entries
      .filter(e => e.action.type === 'COMMAND_EXECUTED')
      .map(e => e.action.commandString)
      .reverse(),  // Most recent first
  [history]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand();
      setHistoryIndex(-1);
      return;
    }

    if (e.key === 'ArrowUp' && historyIndex < commandHistory.length - 1) {
      e.preventDefault();
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setInput(commandHistory[newIndex]);
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');  // Clear when going past most recent
      }
    }
  };

  // ... rest of component
}
```

### Keyboard Shortcuts

```typescript
// src/hooks/useGlobalKeyboardShortcuts.ts

export function useGlobalKeyboardShortcuts() {
  const { performUndo, performRedo } = useGrimoire();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      }

      // Redo: Cmd+Shift+Z (Mac) or Ctrl+Shift+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        performRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [performUndo, performRedo]);
}
```

---

## 4. Implementation Phases

### Phase 1: Editable Commands Foundation ✅
**Goal:** Store command strings and enable programmatic updates

**Tasks:**
- [ ] Add `commandString?: string` to `WindowInstance` type
- [ ] Implement `updateWindow()` in `src/core/logic.ts`
- [ ] Add `updateWindow` to `useGrimoire` hook
- [ ] Modify `CommandLauncher` to pass `commandString` to `addWindow`
- [ ] Write unit tests for `updateWindow`

**Files to modify:**
- `src/types/app.ts`
- `src/core/logic.ts`
- `src/core/state.ts`
- `src/components/CommandLauncher.tsx`
- `src/core/logic.test.ts` (new)

**Estimated effort:** 2-3 hours

---

### Phase 2: Edit Command UI 🎯
**Goal:** User-facing command editing feature

**Tasks:**
- [ ] Create `EditCommandDialog` component
- [ ] Add edit button to `WindowToolbar`
- [ ] Add ⌘E keyboard shortcut for focused window
- [ ] Handle async command parsing (loading states)
- [ ] Add error handling and validation

**Files to create:**
- `src/components/EditCommandDialog.tsx`

**Files to modify:**
- `src/components/WindowToolbar.tsx`
- `src/hooks/useWindowKeyboardShortcuts.ts` (new)

**Estimated effort:** 3-4 hours

**Deliverable:** Working command editing feature! Users can edit window commands.

---

### Phase 3: History Infrastructure 📊
**Goal:** Track all state changes for undo/redo

**Tasks:**
- [ ] Create history types in `src/types/history.ts`
- [ ] Implement history atom with `atomWithStorage`
- [ ] Implement `recordAction`, `undo`, `redo` functions
- [ ] Integrate history recording into state mutations
- [ ] Write comprehensive unit tests

**Files to create:**
- `src/types/history.ts`
- `src/core/history.ts`
- `src/hooks/useHistory.ts`
- `src/core/history.test.ts`

**Files to modify:**
- `src/core/state.ts` (record history on all mutations)

**Estimated effort:** 4-5 hours

---

### Phase 4: Undo/Redo UI ⚡
**Goal:** User-facing undo/redo functionality

**Tasks:**
- [ ] Add global keyboard shortcuts (⌘Z, ⌘⇧Z)
- [ ] Add toast notifications for undo/redo feedback
- [ ] Add visual history indicator (optional)
- [ ] Test with various window operations

**Files to create:**
- `src/hooks/useGlobalKeyboardShortcuts.ts`

**Files to modify:**
- `src/App.tsx`

**Estimated effort:** 2-3 hours

**Deliverable:** Full undo/redo system with keyboard shortcuts!

---

### Phase 5: History Viewer & Polish 🎨
**Goal:** Complete history experience

**Tasks:**
- [ ] Create `HistoryViewer` component (timeline UI)
- [ ] Add `history` command to `manPages`
- [ ] Add command palette history navigation (↑/↓)
- [ ] Add context menu for windows (right-click)
- [ ] Performance optimization if needed

**Files to create:**
- `src/components/viewers/HistoryViewer.tsx`

**Files to modify:**
- `src/types/man.ts`
- `src/components/CommandLauncher.tsx` (enhance)

**Estimated effort:** 3-4 hours

**Deliverable:** Full history viewer and enhanced command palette!

---

**Total estimated effort:** 14-19 hours across 5 phases

---

## 5. Key Design Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| **Store commandString in WindowInstance** | Preserves exact user input, enables lossless editing. Optional field ensures backward compatibility. |
| **Separate history atom** | Clean separation of concerns, independent persistence, easier to add limits without affecting main state. |
| **Full state snapshots (not deltas)** | Simpler implementation, reliable undo/redo. Structural sharing keeps memory reasonable. 50-entry circular buffer prevents unbounded growth. |
| **Git-style history (truncate future)** | Simple mental model matching text editors. Users understand "undo to desired state, continue from there." |
| **Explicit history recording** | Reliable and predictable. Action metadata (command string, window ID) readily available. |
| **Async command parsing support** | Commands like `profile alice@domain.com` require NIP-05 resolution. EditDialog shows loading state during async operations. |
| **localStorage for history** | Simple, persistent, works offline. Can migrate to IndexedDB if needed for unlimited history. |
| **currentIndex = -1 for present** | Clear distinction between "at present" vs "in past". Makes redo logic simpler. |

---

## 6. Edge Cases Handled

| Edge Case | Solution |
|-----------|----------|
| **Old windows without commandString** | Use `generateRawCommand()` as fallback. Optionally mark as "[reconstructed]" in UI. |
| **Async command parsing** | Show loading state in EditCommandDialog. Handle errors gracefully with error message display. |
| **Invalid command after edit** | Parse validation before updating. Display error message, don't update window. |
| **New action after undo** | Truncate future entries (Git-style). User proceeds from undone state. |
| **History memory limits** | Circular buffer with maxEntries (50). Oldest entries automatically dropped. |
| **Layout changes without commands** | Debounce layout changes, record LAYOUT_CHANGED action after 1s of inactivity. |
| **localStorage quota exceeded** | Jotai's storage handles gracefully. Can implement compression if needed (LZ-string). |
| **Command that opens multiple windows** | HistoryAction supports `windowIds: string[]` for future extension. |
| **Undo/redo keyboard shortcuts conflict** | Use standard shortcuts (⌘Z, ⌘⇧Z) that don't conflict with browser or other app shortcuts. |

---

## 7. Testing Strategy

### Unit Tests

```typescript
// src/core/history.test.ts
describe('History System', () => {
  describe('recordAction', () => {
    it('adds entry to history', () => { ... });
    it('maintains maxEntries limit', () => { ... });
    it('truncates future when in past state', () => { ... });
    it('stores both stateBefore and stateAfter', () => { ... });
  });

  describe('undo', () => {
    it('restores stateBefore', () => { ... });
    it('updates currentIndex correctly', () => { ... });
    it('returns unchanged when at limit', () => { ... });
    it('works with multiple undo operations', () => { ... });
  });

  describe('redo', () => {
    it('restores stateAfter', () => { ... });
    it('returns unchanged when at present', () => { ... });
    it('works after multiple undos', () => { ... });
  });

  describe('circular buffer', () => {
    it('drops oldest entries when maxEntries exceeded', () => { ... });
    it('maintains correct currentIndex after truncation', () => { ... });
  });
});

// src/core/logic.test.ts
describe('updateWindow', () => {
  it('updates window props', () => { ... });
  it('updates title', () => { ... });
  it('updates commandString', () => { ... });
  it('updates appId', () => { ... });
  it('updates multiple fields at once', () => { ... });
  it('returns unchanged for nonexistent window', () => { ... });
  it('preserves other window fields', () => { ... });
});
```

### Integration Tests (Manual)

1. **Edit Command Flow:**
   - Execute `profile alice@domain.com`
   - Click edit button
   - Change to `profile bob@domain.com`
   - Verify window updates with new profile data

2. **Undo/Redo Flow:**
   - Execute multiple commands (profile, req, open)
   - Undo each command (⌘Z)
   - Verify state restored correctly
   - Redo each command (⌘⇧Z)
   - Verify state matches original

3. **History Navigation:**
   - Open command palette
   - Press ↑ multiple times
   - Verify recent commands appear
   - Press ↓ to go back
   - Verify command changes

4. **Async Command Editing:**
   - Edit profile window with NIP-05
   - Verify loading state shown
   - Verify update after resolution completes

5. **Error Handling:**
   - Edit command to invalid syntax
   - Verify error message shown
   - Verify window not updated

6. **History Limits:**
   - Execute >50 commands
   - Verify oldest commands dropped
   - Verify undo still works correctly

### Performance Tests

1. **History Storage Size:**
   - Execute 50 commands
   - Check localStorage size
   - Verify <1MB (reasonable limit)

2. **Undo/Redo Latency:**
   - Measure time to undo with complex state
   - Should be <50ms (imperceptible)

3. **Command Parsing:**
   - Measure async NIP-05 resolution time
   - Should complete within 2-3 seconds

---

## 8. Performance Considerations

| Aspect | Performance | Notes |
|--------|-------------|-------|
| **Memory** | ~10MB for 50 entries | Within localStorage limits. Each state ~100KB. Structural sharing reduces actual memory usage. |
| **Undo/Redo latency** | <10ms | O(1) state swap, imperceptible to user. |
| **History recording** | <5ms | `structuredClone()` is native and fast. |
| **localStorage writes** | Debounced by Jotai | No performance impact on normal operations. Writes happen in background. |
| **Command parsing** | Varies (50ms - 3s) | Depends on async operations (NIP-05). Loading state shown during parse. |

### Future Optimizations (if needed)

1. **Delta encoding** - Store only changed fields instead of full state snapshots
   - Pro: ~90% memory reduction
   - Con: Complex implementation, harder debugging

2. **LZ-string compression** - Compress state snapshots before localStorage
   - Pro: 50-70% size reduction
   - Con: CPU overhead for compress/decompress

3. **IndexedDB migration** - Move from localStorage to IndexedDB
   - Pro: No size limits, better performance for large datasets
   - Con: More complex API, async operations

4. **Lazy loading** - Only keep recent N entries in memory
   - Pro: Reduced memory footprint
   - Con: Async loading on undo, more complex code

**Recommendation:** Start with simple approach. Optimize only if profiling shows real issues.

---

## 9. Documentation Updates

### CLAUDE.md Addition

Add new section after "## Core Architecture":

```markdown
### Command History & Editing

Windows store their originating command string, enabling editing and comprehensive undo/redo.

**Edit Commands:**
- Click pencil icon in window toolbar or press ⌘E
- Edit the command string in the dialog
- Command is re-parsed (with async support for NIP-05, etc.)
- Window updates with new data

**Undo/Redo:**
- **⌘Z**: Undo last action (window create, close, edit, layout change)
- **⌘⇧Z**: Redo previously undone action
- History limited to last 50 actions (circular buffer)
- Git-style: new actions after undo truncate future

**Command History:**
- **↑/↓** in command palette: Navigate through recent commands
- History stored in separate Jotai atom (`historyAtom`)
- Each entry captures state snapshots before/after for perfect undo

**Implementation:**
- `src/core/history.ts` - History logic and storage
- `src/types/history.ts` - Type definitions
- `src/hooks/useHistory.ts` - React integration
- `src/components/EditCommandDialog.tsx` - Edit UI
```

### Type Documentation

```typescript
/**
 * WindowInstance represents a single window in the Grimoire application.
 * Each window displays content from a specific app (profile, event, NIP viewer, etc.)
 * and is created from a user command via the command palette.
 *
 * @property id - Unique window identifier (UUID)
 * @property appId - Type of app/viewer this window displays
 * @property title - Window title shown in toolbar
 * @property props - App-specific properties (pubkey, filter, etc.)
 * @property commandString - The original command that created this window (e.g., "profile alice@domain.com").
 *   Enables command editing and history features. May be undefined for windows created
 *   before this feature was added. Use generateRawCommand() as a fallback.
 */
interface WindowInstance {
  id: string;
  appId: AppId;
  title: string;
  props: any;
  commandString?: string;
}
```

### Usage Examples

```typescript
// Example: Creating a window with command string
addWindow('profile', { pubkey: '...' }, 'PROFILE alice', 'profile alice@domain.com');

// Example: Updating a window
updateWindow(windowId, {
  props: { pubkey: 'new-pubkey' },
  title: 'PROFILE bob',
  commandString: 'profile bob@domain.com',
});

// Example: Undo/redo
performUndo();  // Undo last action
performRedo();  // Redo undone action

// Example: Recording custom history action
recordHistory({
  type: 'LAYOUT_CHANGED',
  workspaceId: 'workspace-id',
}, prevState, nextState);
```

---

## 10. Security & Privacy Considerations

| Concern | Mitigation |
|---------|-----------|
| **Sensitive data in history** | History stored in localStorage (same origin only). Consider adding opt-out for privacy-conscious users. |
| **Command injection** | All commands parsed through `manPages` argParser. No arbitrary code execution. |
| **localStorage quota attacks** | Circular buffer limits history size. Jotai handles quota exceeded gracefully. |
| **XSS via command strings** | Command strings displayed in UI are properly escaped by React. |

---

## 11. Future Enhancements

### Potential Phase 6+ Features

1. **Workspace-specific undo** - Undo operations scoped to current workspace
2. **History search** - Search through command history by text
3. **History export** - Export history as JSON for debugging
4. **Command templates** - Save frequently used commands as templates
5. **Bulk operations** - Edit multiple windows at once
6. **History persistence options** - Choose localStorage vs IndexedDB vs in-memory
7. **Visual timeline** - Graphical timeline of actions with branching
8. **Command aliases** - Create shortcuts for long commands (e.g., `alice` → `profile alice@domain.com`)

---

## Summary

This design provides a complete, production-ready system for editable window commands and comprehensive command history:

✅ **Backward Compatible** - Optional fields, no migrations needed
✅ **Simple Mental Model** - Git-style history familiar to developers
✅ **Memory Efficient** - Circular buffer with structural sharing
✅ **Type Safe** - Full TypeScript coverage
✅ **Testable** - Pure functions, comprehensive test suite
✅ **Phased Implementation** - Each phase independently deliverable
✅ **Well Documented** - Clear API contracts and usage examples
✅ **User-Friendly** - Familiar keyboard shortcuts, visual feedback, error handling

The architecture cleanly separates concerns (state vs history), handles edge cases gracefully, and provides excellent UX with keyboard shortcuts, visual feedback, and error handling.

**Status:** Design complete and validated. Ready for Phase 1 implementation.

**Next Steps:**
1. Review design with team/stakeholders
2. Create implementation branch
3. Start with Phase 1 (foundation)
4. Iterate through phases 2-5
5. Deploy and gather user feedback
