# TipTap Editor: React Integration Best Practices

> Research compiled for Grimoire project - February 2026

## Overview

TipTap is a headless, framework-agnostic rich text editor built on top of ProseMirror. It's used by companies like The New York Times, The Guardian, and Atlassian. The latest version is **v3.15.3** with significant React-focused improvements.

## Installation

```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit
```

**Required packages:**
- `@tiptap/react` - React bindings including Tiptap's core functionality
- `@tiptap/pm` - ProseMirror dependencies required for the editor
- `@tiptap/starter-kit` - Common extensions (bold, italic, headings, lists, etc.)

**Optional for menus:**
```bash
npm install @floating-ui/dom@^1.6.0
```

## Two Integration Approaches

### 1. Modern Declarative Approach (Recommended)

The new `<Tiptap>` component provides context to all child components automatically:

```tsx
import { useEditor } from '@tiptap/react'
import { Tiptap } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

function Editor() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p>Hello World!</p>',
  })

  return (
    <Tiptap instance={editor}>
      <Tiptap.Loading>Loading editor...</Tiptap.Loading>
      <MenuBar />
      <Tiptap.Content />
      <Tiptap.BubbleMenu>...</Tiptap.BubbleMenu>
      <Tiptap.FloatingMenu>...</Tiptap.FloatingMenu>
    </Tiptap>
  )
}
```

Access editor in child components:
```tsx
import { useTiptap } from '@tiptap/react'

function MenuBar() {
  const { editor, isReady } = useTiptap()

  if (!isReady) return null

  return (
    <button onClick={() => editor.chain().focus().toggleBold().run()}>
      Bold
    </button>
  )
}
```

### 2. Manual Setup with EditorContent

For cases requiring more control:

```tsx
import { useEditor, EditorContent, BubbleMenu, FloatingMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

function Editor() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p>Hello World!</p>',
  })

  return (
    <>
      <EditorContent editor={editor} />
      <BubbleMenu editor={editor}>Bubble menu content</BubbleMenu>
      <FloatingMenu editor={editor}>Floating menu content</FloatingMenu>
    </>
  )
}
```

## useEditor Hook Configuration

```tsx
const editor = useEditor({
  // Required: Array of extensions
  extensions: [StarterKit],

  // Initial content (HTML string or JSON)
  content: '<p>Hello World!</p>',

  // SSR: Set to false to avoid hydration mismatch
  immediatelyRender: false,

  // Performance: Disable re-render on every transaction (v3 default: false)
  shouldRerenderOnTransaction: false,

  // Toggle read-only mode
  editable: true,

  // Focus behavior on mount
  autofocus: 'end', // 'start' | 'end' | 'all' | number | boolean

  // Text direction
  textDirection: 'ltr', // 'ltr' | 'rtl' | 'auto'

  // Enable/disable input rules (markdown shortcuts)
  enableInputRules: true,
  enablePasteRules: true,

  // ProseMirror props for advanced customization
  editorProps: {
    attributes: {
      class: 'prose prose-sm focus:outline-none',
    },
  },

  // Event callbacks
  onCreate: ({ editor }) => { /* Editor created */ },
  onUpdate: ({ editor }) => { /* Content changed */ },
  onSelectionUpdate: ({ editor }) => { /* Selection changed */ },
  onTransaction: ({ transaction }) => { /* Any transaction */ },
  onFocus: ({ editor }) => { /* Editor focused */ },
  onBlur: ({ editor }) => { /* Editor blurred */ },
  onDestroy: () => { /* Editor destroyed */ },
})
```

## Performance Best Practices

### 1. Isolate the Editor Component

The most common performance issue is unnecessary re-renders. Keep the editor in a separate component:

```tsx
// ❌ Bad: Editor re-renders when sidebar state changes
function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const editor = useEditor({ extensions: [StarterKit] })

  return (
    <>
      <Sidebar open={sidebarOpen} />
      <EditorContent editor={editor} />
    </>
  )
}

// ✅ Good: Editor isolated from unrelated state
function IsolatedEditor() {
  const editor = useEditor({ extensions: [StarterKit] })
  return <EditorContent editor={editor} />
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    <>
      <Sidebar open={sidebarOpen} />
      <IsolatedEditor />
    </>
  )
}
```

### 2. Use useEditorState for Selective Updates

Subscribe to specific state properties to avoid re-renders on every change:

```tsx
import { useEditorState } from '@tiptap/react'

function WordCount() {
  const wordCount = useEditorState({
    editor,
    selector: (state) => {
      const text = state.editor.state.doc.textContent
      return text.split(/\s+/).filter(Boolean).length
    },
  })

  return <span>{wordCount} words</span>
}
```

Or with the new `useTiptapState` inside a `<Tiptap>` provider:

```tsx
import { useTiptapState } from '@tiptap/react'

function WordCount() {
  const wordCount = useTiptapState((state) => {
    const text = state.editor.state.doc.textContent
    return text.split(/\s+/).filter(Boolean).length
  })

  return <span>{wordCount} words</span>
}
```

### 3. Control Transaction Re-renders

In v3, `shouldRerenderOnTransaction` defaults to `false`. If you need reactive updates:

```tsx
// Option 1: Enable transaction re-renders
const editor = useEditor({
  extensions: [StarterKit],
  shouldRerenderOnTransaction: true, // Restore v2 behavior
})

// Option 2: Manual state tracking (more efficient)
const [selection, setSelection] = useState({ from: 0, to: 0 })

const editor = useEditor({
  extensions: [StarterKit],
  onTransaction({ transaction }) {
    setSelection({
      from: transaction.selection.from,
      to: transaction.selection.to,
    })
  },
})
```

## React Node Views

Create custom React components as editor nodes:

### 1. Create the Extension

```tsx
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import MyComponent from './MyComponent'

export const MyNode = Node.create({
  name: 'myNode',
  group: 'block',
  content: 'inline*',

  addNodeView() {
    return ReactNodeViewRenderer(MyComponent)
  },
})
```

### 2. Create the React Component

```tsx
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

function MyComponent({ node, updateAttributes, deleteNode, selected, editor }) {
  return (
    <NodeViewWrapper className={selected ? 'selected' : ''}>
      <div className="my-component">
        <NodeViewContent className="content" />
        <button onClick={() => updateAttributes({ count: node.attrs.count + 1 })}>
          Increment
        </button>
        <button onClick={deleteNode}>Delete</button>
      </div>
    </NodeViewWrapper>
  )
}
```

### Props Available in Node Views

| Prop | Type | Description |
|------|------|-------------|
| `editor` | `Editor` | The editor instance |
| `node` | `Node` | Current node with attributes |
| `updateAttributes` | `(attrs) => void` | Update node attributes reactively |
| `deleteNode` | `() => void` | Remove the node |
| `selected` | `boolean` | Whether node is selected |
| `getPos` | `() => number \| undefined` | Get node position (can be undefined in v3!) |
| `extension` | `Extension` | Extension configuration |
| `decorations` | `Decoration[]` | Applied decorations |

### Node View Performance Warning

Node views require synchronous mounting, which can be expensive with many instances. For performance-critical cases:
- Consider plain HTML elements instead of React components
- Use React.memo for node view components
- Minimize state in node view components

## Editor API Methods

```tsx
// Content
editor.getHTML()           // Get content as HTML
editor.getJSON()           // Get content as JSON
editor.getText()           // Get plain text
editor.isEmpty             // Check if empty

// Commands (chainable)
editor.chain().focus().toggleBold().run()
editor.chain().focus().setHeading({ level: 1 }).run()
editor.chain().focus().insertContent('<p>New content</p>').run()

// Check if command is possible
editor.can().toggleBold()
editor.can().setHeading({ level: 1 })

// State
editor.isActive('bold')
editor.isActive('heading', { level: 1 })
editor.isFocused
editor.isEditable

// Lifecycle
editor.setEditable(false)  // Toggle read-only
editor.destroy()           // Cleanup
editor.mount(element)      // Attach to DOM
editor.unmount()           // Detach (reusable in v3)
```

## V3 Breaking Changes Summary

1. **shouldRerenderOnTransaction** defaults to `false`
2. **Menu imports** changed: `import { BubbleMenu } from '@tiptap/react/menus'`
3. **Floating UI** replaced Tippy.js for menus
4. **getPos()** can now return `undefined` - add defensive checks
5. **StarterKit** now includes Link, Underline, ListKeymap by default
6. **History** renamed to **UndoRedo** extension
7. **getCharacterCount()** removed - use `editor.storage.characterCount.characters()`

## UI Components Library

TipTap provides pre-built React components for common editor controls:

**Categories:**
- **Components**: Feature-specific controls (HeadingDropdown, ListButton, ImageUpload)
- **Node Components**: Visual rendering for nodes (Blockquote, CodeBlock, Table)
- **Primitives**: Low-level building blocks (Button, Dropdown, Popover, Input, Tooltip)

**Compatibility**: Currently optimized for React 18 and Next.js 15. React 19 support in progress.

**Licensing**: Open-source components use MIT license. Cloud features require subscription.

## Integration with Grimoire

For Grimoire's use case (Nostr rich text editing), consider:

1. **Use the declarative `<Tiptap>` component** for cleaner composition
2. **Isolate editor state** to prevent re-renders from Jotai atoms
3. **Use `useEditorState`** for toolbar state (bold active, heading level, etc.)
4. **Consider custom node views** for Nostr-specific content (mentions, event embeds)
5. **Set `immediatelyRender: false`** if SSR is ever needed
6. **Keep `shouldRerenderOnTransaction: false`** and use selective state subscriptions

## Sources

- [React Installation Guide](https://tiptap.dev/docs/editor/getting-started/install/react)
- [Integration Performance](https://tiptap.dev/docs/guides/performance)
- [React Node Views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react)
- [Editor API Reference](https://tiptap.dev/docs/editor/api/editor)
- [What's New in V3](https://tiptap.dev/docs/resources/whats-new)
- [V2 to V3 Upgrade Guide](https://tiptap.dev/docs/guides/upgrade-tiptap-v2)
- [UI Components Overview](https://tiptap.dev/docs/ui-components/getting-started/overview)
- [GitHub Repository](https://github.com/ueberdosis/tiptap)
- [NPM Package](https://www.npmjs.com/package/@tiptap/react)
