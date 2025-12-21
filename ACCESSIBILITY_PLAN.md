# Accessibility Improvement Plan

This document outlines the accessibility improvements planned for Grimoire to achieve WCAG 2.1 AA compliance.

## Current State Assessment

**Current Coverage**: ~16% of components have ARIA attributes

| Category | Status | Details |
|----------|--------|---------|
| Keyboard Navigation | ⚠️ Partial | Cmd+K works, limited elsewhere |
| Screen Reader Support | ⚠️ Partial | Basic labels, missing live regions |
| Focus Management | ✅ Good | Visible focus rings |
| Color Contrast | ⚠️ Unchecked | No WCAG verification |
| Loading States | ✅ Good | Skeletons with aria-busy |
| Error Handling | ⚠️ Partial | Errors not announced |

---

## Phase 1: Foundation (Priority: High)

### 1.1 Keyboard Navigation Improvements

**Files to update**: `CommandLauncher.tsx`, `Home.tsx`, `TabBar.tsx`

```typescript
// Add keyboard shortcuts help modal (Cmd+?)
const KEYBOARD_SHORTCUTS = [
  { keys: ['⌘', 'K'], description: 'Open command palette' },
  { keys: ['⌘', '1-9'], description: 'Switch workspace' },
  { keys: ['Escape'], description: 'Close dialog/modal' },
  { keys: ['↑', '↓'], description: 'Navigate list items' },
  { keys: ['Enter'], description: 'Select/confirm' },
];
```

**Tasks**:
- [ ] Create `KeyboardShortcutsDialog` component
- [ ] Add `Cmd+?` shortcut to show help
- [ ] Add keyboard navigation to window tiles (focus, close, resize)
- [ ] Implement roving tabindex for command list
- [ ] Add skip links for main content areas

### 1.2 Focus Management

**Files to update**: `components/ui/dialog.tsx`, `GlobalAuthPrompt.tsx`

```typescript
// Focus trap for modals
import { FocusTrap } from '@radix-ui/react-focus-trap';

// Return focus after dialog close
const previousFocusRef = useRef<HTMLElement | null>(null);

useEffect(() => {
  if (open) {
    previousFocusRef.current = document.activeElement as HTMLElement;
  } else {
    previousFocusRef.current?.focus();
  }
}, [open]);
```

**Tasks**:
- [ ] Verify all dialogs trap focus properly
- [ ] Return focus to trigger element on close
- [ ] Add `autoFocus` to first interactive element in dialogs
- [ ] Prevent focus from leaving modal while open

### 1.3 Screen Reader Announcements (Live Regions)

**Create new file**: `src/components/ui/Announcer.tsx`

```typescript
import { createContext, useContext, useState, useCallback } from 'react';

interface AnnouncerContextValue {
  announce: (message: string, politeness?: 'polite' | 'assertive') => void;
}

const AnnouncerContext = createContext<AnnouncerContextValue | null>(null);

export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  const announce = useCallback((message: string, politeness: 'polite' | 'assertive' = 'polite') => {
    if (politeness === 'assertive') {
      setAssertiveMessage(message);
      setTimeout(() => setAssertiveMessage(''), 1000);
    } else {
      setPoliteMessage(message);
      setTimeout(() => setPoliteMessage(''), 1000);
    }
  }, []);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeMessage}
      </div>
      <div
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveMessage}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce() {
  const context = useContext(AnnouncerContext);
  if (!context) throw new Error('useAnnounce must be used within AnnouncerProvider');
  return context.announce;
}
```

**Integration points**:
- [ ] Wrap app in `AnnouncerProvider`
- [ ] Announce when command executes: "Opening profile viewer"
- [ ] Announce when window closes: "Window closed"
- [ ] Announce loading complete: "Timeline loaded, 50 events"
- [ ] Announce errors: "Error: Failed to load profile"

---

## Phase 2: Form Accessibility (Priority: High)

### 2.1 Form Error Association

**Pattern to implement across all forms**:

```typescript
interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  description?: string;
}

function FormField({ id, label, error, description, children }: FormFieldProps) {
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {description && (
        <span id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </span>
      )}
      {React.cloneElement(children as React.ReactElement, {
        id,
        'aria-describedby': [
          description ? descriptionId : null,
          error ? errorId : null,
        ].filter(Boolean).join(' ') || undefined,
        'aria-invalid': !!error,
      })}
      {error && (
        <span id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
```

**Files to update**:
- [ ] `SpellDialog.tsx` - Spell creation form
- [ ] `SettingsDialog.tsx` - Settings inputs
- [ ] `WorkspaceSettings.tsx` - Workspace name input
- [ ] `CommandLauncher.tsx` - Command input

### 2.2 Required Field Indicators

```typescript
// Add to Label component
function Label({ required, children, ...props }) {
  return (
    <label {...props}>
      {children}
      {required && <span aria-hidden="true" className="text-destructive ml-1">*</span>}
      {required && <span className="sr-only"> (required)</span>}
    </label>
  );
}
```

---

## Phase 3: Component ARIA Improvements (Priority: Medium)

### 3.1 Event Renderers

**Base pattern for all renderers**:

```typescript
// BaseEventRenderer.tsx additions
<article
  aria-label={`${kindName} by ${authorName}`}
  aria-describedby={`event-${event.id}-content`}
>
  <header>
    <UserName pubkey={pubkey} aria-label={`Author: ${displayName}`} />
    <time dateTime={isoDate} aria-label={`Posted ${relativeTime}`}>
      {relativeTime}
    </time>
  </header>
  <div id={`event-${event.id}-content`}>
    {children}
  </div>
</article>
```

**Tasks**:
- [ ] Add `article` landmark to event containers
- [ ] Add proper `time` elements with dateTime
- [ ] Add aria-labels to interactive elements
- [ ] Ensure all buttons have labels (close, menu, copy, etc.)

### 3.2 Feed/Timeline Components

**Files to update**: `Feed.tsx`, `ReqViewer.tsx`

```typescript
// Add feed landmarks
<section aria-label="Event timeline" role="feed" aria-busy={loading}>
  <h2 className="sr-only">Timeline</h2>
  {events.map((event, index) => (
    <article
      key={event.id}
      aria-posinset={index + 1}
      aria-setsize={events.length}
    >
      <KindRenderer event={event} />
    </article>
  ))}
</section>
```

**Tasks**:
- [ ] Add `role="feed"` to timeline containers
- [ ] Add `aria-posinset` and `aria-setsize` for virtual lists
- [ ] Add `aria-busy` during loading
- [ ] Announce when new events arrive

### 3.3 Collapsible/Accordion

**Files to update**: `ui/accordion.tsx`, `ui/collapsible.tsx`

```typescript
// Ensure proper ARIA states
<button
  aria-expanded={isOpen}
  aria-controls={contentId}
>
  Toggle
</button>
<div
  id={contentId}
  aria-hidden={!isOpen}
  role="region"
>
  {children}
</div>
```

---

## Phase 4: Color & Visual Accessibility (Priority: Medium)

### 4.1 Color Contrast Audit

**Tool**: Use `axe-core` for automated checking

```bash
npm install -D @axe-core/react
```

```typescript
// Development-only accessibility audit
if (process.env.NODE_ENV === 'development') {
  import('@axe-core/react').then(axe => {
    axe.default(React, ReactDOM, 1000);
  });
}
```

**Known issues to check**:
- [ ] Muted foreground text (`hsl(215 20.2% 70%)`)
- [ ] Gradient text (`.text-grimoire-gradient`)
- [ ] Disabled state opacity (50%)
- [ ] Placeholder text color

### 4.2 High Contrast Mode

**Create theme option**:

```css
/* Add to index.css */
@media (prefers-contrast: more) {
  :root {
    --foreground: 0 0% 0%;
    --background: 0 0% 100%;
    --muted-foreground: 0 0% 30%;
    --border: 0 0% 0%;
  }
  .dark {
    --foreground: 0 0% 100%;
    --background: 0 0% 0%;
    --muted-foreground: 0 0% 80%;
    --border: 0 0% 100%;
  }
}
```

**Tasks**:
- [ ] Add system preference detection
- [ ] Create high-contrast theme variables
- [ ] Test with Windows High Contrast Mode
- [ ] Add manual toggle in settings

### 4.3 Reduced Motion

```css
/* Already partially implemented, verify coverage */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Tasks**:
- [ ] Audit all animations (Framer Motion, CSS transitions)
- [ ] Ensure skeleton pulse respects preference
- [ ] Verify window transitions can be disabled

---

## Phase 5: Testing & Documentation (Priority: High)

### 5.1 Automated Testing

**Add to CI pipeline**:

```yaml
# .github/workflows/accessibility.yml
name: Accessibility Checks
on: [push, pull_request]
jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - name: Run axe-core
        run: npx @axe-core/cli http://localhost:4173
```

### 5.2 Manual Testing Checklist

**Keyboard-only testing**:
- [ ] Can navigate entire app without mouse
- [ ] Focus order is logical
- [ ] All interactive elements are reachable
- [ ] Can dismiss dialogs with Escape
- [ ] Can activate buttons with Enter/Space

**Screen reader testing** (with VoiceOver/NVDA):
- [ ] Page structure is announced correctly
- [ ] Links and buttons describe their purpose
- [ ] Form fields have associated labels
- [ ] Errors are announced when they occur
- [ ] Loading states are announced

**Visual testing**:
- [ ] Content readable at 200% zoom
- [ ] No horizontal scrolling at 320px width (for non-tiling views)
- [ ] Focus indicators visible
- [ ] Color not sole means of conveying info

### 5.3 Accessibility Documentation

**Create `docs/ACCESSIBILITY.md`**:
- Document keyboard shortcuts
- List known limitations
- Provide screen reader recommendations
- Document testing procedures

---

## Implementation Phases

### Phase 1: Foundation (2-3 weeks)
- Live region announcer
- Keyboard shortcuts help
- Focus management fixes

### Phase 2: Forms (1-2 weeks)
- Error association pattern
- Required field indicators
- Form validation feedback

### Phase 3: Components (2-3 weeks)
- Event renderer improvements
- Feed landmarks
- Dialog ARIA fixes

### Phase 4: Visual (1-2 weeks)
- Color contrast audit
- High contrast mode
- Reduced motion support

### Phase 5: Testing (Ongoing)
- Automated CI checks
- Manual testing protocol
- Documentation

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| axe-core violations | Unknown | 0 critical, <5 minor |
| ARIA coverage | 16% | 90%+ |
| Keyboard accessibility | Partial | Full |
| Color contrast ratio | Unknown | 4.5:1 minimum |
| WCAG 2.1 Level | Unknown | AA |

---

## Resources

- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [Radix UI Accessibility](https://www.radix-ui.com/docs/primitives/overview/accessibility)
- [React ARIA](https://react-spectrum.adobe.com/react-aria/)
- [axe-core Rules](https://dequeuniversity.com/rules/axe/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
