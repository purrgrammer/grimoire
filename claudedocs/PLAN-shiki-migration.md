# Plan: Migrate from Prism.js to Shiki with Lazy Loading

## Overview

Replace the current Prism.js-based syntax highlighting with Shiki, enabling on-demand language loading while preserving the current minimalistic styling.

---

## Current State Analysis

### Files Using `SyntaxHighlight`

| File | Language(s) Used | Context |
|------|------------------|---------|
| `PatchDetailRenderer.tsx` | `diff` | Git patches |
| `CodeSnippetRenderer.tsx` | dynamic (via `mapLanguage()`) | NIP-C0 code snippets |
| `CodeSnippetDetailRenderer.tsx` | dynamic (via `normalizedLanguage`) | Code snippet detail view |
| `MarkdownContent.tsx` | dynamic (from markdown) | Article code blocks |
| `JsonEventRow.tsx` | `json` | Event JSON view |
| `DebugViewer.tsx` | `json` | App state debug |
| `JsonViewer.tsx` | `json` | JSON dialog |
| `ReqViewer.tsx` | `json` | Filter JSON display |

### Current Prism Setup

**Statically loaded languages** (`src/components/SyntaxHighlight.tsx`):
- diff, javascript, typescript, jsx, tsx
- bash, json, markdown, css, python, yaml

**Theme**: Custom CSS in `src/styles/prism-theme.css` using CSS variables:
- Uses `hsl(var(--foreground))`, `hsl(var(--muted-foreground))`, `hsl(var(--primary))`
- Special handling for diff tokens (deleted, inserted, coord)
- Minimal color palette - mostly foreground/muted with primary accents

### Problems with Current Approach

1. **Bundle bloat**: All 11 language grammars loaded upfront (~30KB)
2. **Limited languages**: Markdown code blocks with unsupported languages show no highlighting
3. **No extension path**: Adding new languages requires editing component imports
4. **Prism limitations**: Less accurate grammars compared to TextMate (used by VS Code/Shiki)

---

## Shiki Benefits

1. **TextMate grammars**: Same grammars as VS Code, more accurate highlighting
2. **Lazy loading**: Languages loaded on-demand via dynamic imports
3. **Fine-grained bundles**: Control exactly what's bundled
4. **Theme flexibility**: CSS variables or inline styles
5. **200+ languages**: Support virtually any language users might use

---

## Migration Plan

### Phase 1: Core Infrastructure

#### 1.1 Install Dependencies

```bash
npm install shiki
```

**Bundle impact**:
- `shiki/core`: ~15KB (min+gzip)
- Oniguruma WASM: ~200KB (one-time, cached)
- Languages: 10-50KB each (lazy loaded)
- Theme: 2-5KB

#### 1.2 Create Shiki Service

**File**: `src/lib/shiki.ts`

```typescript
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

// Singleton highlighter instance
let highlighter: HighlighterCore | null = null
let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLanguages = new Set<string>()

// Grimoire dark theme matching current Prism styles
const grimoireTheme = {
  name: 'grimoire-dark',
  type: 'dark' as const,
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#e5e5e5',
  },
  tokenColors: [
    // Comments - muted
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#6b7280' }  // muted-foreground
    },
    // Strings - muted but slightly emphasized
    {
      scope: ['string', 'string.quoted'],
      settings: { foreground: '#9ca3af', fontStyle: '' }
    },
    // Keywords, operators - primary color
    {
      scope: ['keyword', 'storage', 'keyword.operator'],
      settings: { foreground: '#a855f7' }  // primary purple
    },
    // Functions, classes - primary bold
    {
      scope: ['entity.name.function', 'entity.name.class', 'entity.name.type'],
      settings: { foreground: '#a855f7', fontStyle: 'bold' }
    },
    // Numbers, constants - primary
    {
      scope: ['constant', 'constant.numeric', 'constant.language'],
      settings: { foreground: '#a855f7' }
    },
    // Variables, parameters - foreground
    {
      scope: ['variable', 'variable.parameter'],
      settings: { foreground: '#e5e5e5' }
    },
    // Punctuation - slightly muted
    {
      scope: ['punctuation'],
      settings: { foreground: '#b3b3b3' }
    },
    // Properties, attributes
    {
      scope: ['variable.other.property', 'entity.other.attribute-name'],
      settings: { foreground: '#d4d4d4' }
    },
    // Tags (HTML/JSX)
    {
      scope: ['entity.name.tag'],
      settings: { foreground: '#a855f7' }
    },
    // Diff - deleted (red)
    {
      scope: ['markup.deleted', 'punctuation.definition.deleted'],
      settings: { foreground: '#ff8787' }
    },
    // Diff - inserted (green)
    {
      scope: ['markup.inserted', 'punctuation.definition.inserted'],
      settings: { foreground: '#69db7c' }
    },
    // Diff - changed
    {
      scope: ['markup.changed'],
      settings: { foreground: '#66d9ef' }
    },
  ]
}

/**
 * Language alias mapping (file extensions and common names to Shiki IDs)
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  // Extensions
  'ts': 'typescript',
  'tsx': 'tsx',
  'js': 'javascript',
  'jsx': 'jsx',
  'py': 'python',
  'rb': 'ruby',
  'rs': 'rust',
  'go': 'go',
  'sh': 'bash',
  'bash': 'bash',
  'shell': 'bash',
  'zsh': 'bash',
  'yml': 'yaml',
  'yaml': 'yaml',
  'md': 'markdown',
  'json': 'json',
  'jsonc': 'jsonc',
  'css': 'css',
  'scss': 'scss',
  'sass': 'sass',
  'less': 'less',
  'html': 'html',
  'htm': 'html',
  'xml': 'xml',
  'svg': 'xml',
  'sql': 'sql',
  'c': 'c',
  'cpp': 'cpp',
  'c++': 'cpp',
  'h': 'c',
  'hpp': 'cpp',
  'cs': 'csharp',
  'java': 'java',
  'kt': 'kotlin',
  'swift': 'swift',
  'php': 'php',
  'lua': 'lua',
  'vim': 'viml',
  'toml': 'toml',
  'ini': 'ini',
  'dockerfile': 'dockerfile',
  'docker': 'dockerfile',
  'makefile': 'makefile',
  'make': 'makefile',
  'diff': 'diff',
  'patch': 'diff',
  'sol': 'solidity',
  'zig': 'zig',
  'ex': 'elixir',
  'exs': 'elixir',
  'erl': 'erlang',
  'hs': 'haskell',
  'ml': 'ocaml',
  'clj': 'clojure',
  'scala': 'scala',
  'graphql': 'graphql',
  'gql': 'graphql',
  'proto': 'protobuf',
  'nix': 'nix',
}

/**
 * Core languages to preload (most commonly used)
 */
const CORE_LANGUAGES = ['javascript', 'typescript', 'json', 'diff', 'bash']

/**
 * Normalize language identifier to Shiki language ID
 */
export function normalizeLanguage(lang: string | null | undefined): string {
  if (!lang) return 'text'
  const normalized = lang.toLowerCase().trim()
  return LANGUAGE_ALIASES[normalized] || normalized
}

/**
 * Get or create the singleton highlighter instance
 */
export async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter

  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [grimoireTheme],
      langs: CORE_LANGUAGES.map(lang => import(`shiki/langs/${lang}.mjs`)),
      engine: createOnigurumaEngine(import('shiki/wasm'))
    }).then(hl => {
      highlighter = hl
      CORE_LANGUAGES.forEach(l => loadedLanguages.add(l))
      return hl
    })
  }

  return highlighterPromise
}

/**
 * Load a language on demand
 */
async function loadLanguage(lang: string): Promise<boolean> {
  if (lang === 'text' || loadedLanguages.has(lang)) return true

  const hl = await getHighlighter()

  try {
    // Dynamic import for the language
    await hl.loadLanguage(import(`shiki/langs/${lang}.mjs`))
    loadedLanguages.add(lang)
    return true
  } catch (e) {
    console.warn(`[shiki] Language "${lang}" not available, falling back to plaintext`)
    return false
  }
}

/**
 * Highlight code with lazy language loading
 * Returns HTML string
 */
export async function highlightCode(
  code: string,
  language: string | null | undefined
): Promise<string> {
  const lang = normalizeLanguage(language)
  const hl = await getHighlighter()

  // Try to load the language if not already loaded
  const loaded = await loadLanguage(lang)
  const effectiveLang = loaded ? lang : 'text'

  return hl.codeToHtml(code, {
    lang: effectiveLang,
    theme: 'grimoire-dark'
  })
}

/**
 * Check if a language is available (loaded or loadable)
 */
export function isLanguageLoaded(lang: string): boolean {
  return loadedLanguages.has(normalizeLanguage(lang))
}

/**
 * Preload languages (e.g., on app startup or before rendering)
 */
export async function preloadLanguages(langs: string[]): Promise<void> {
  await getHighlighter()
  await Promise.all(langs.map(l => loadLanguage(normalizeLanguage(l))))
}
```

#### 1.3 Create React Hook

**File**: `src/hooks/useHighlightedCode.ts`

```typescript
import { useState, useEffect } from 'react'
import { highlightCode, normalizeLanguage } from '@/lib/shiki'

interface UseHighlightedCodeResult {
  html: string | null
  loading: boolean
  error: Error | null
}

/**
 * Hook to highlight code asynchronously with lazy language loading
 */
export function useHighlightedCode(
  code: string,
  language: string | null | undefined
): UseHighlightedCodeResult {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    highlightCode(code, language)
      .then(result => {
        if (!cancelled) {
          setHtml(result)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, language])

  return { html, loading, error }
}
```

---

### Phase 2: New SyntaxHighlight Component

#### 2.1 Replace SyntaxHighlight Component

**File**: `src/components/SyntaxHighlight.tsx` (rewrite)

```typescript
import { useHighlightedCode } from '@/hooks/useHighlightedCode'
import { cn } from '@/lib/utils'

interface SyntaxHighlightProps {
  code: string
  language?: string | null
  className?: string
  showLineNumbers?: boolean
}

/**
 * Syntax highlighting component using Shiki with lazy language loading
 *
 * @example
 * <SyntaxHighlight code={patchContent} language="diff" />
 * <SyntaxHighlight code={jsonStr} language="json" />
 */
export function SyntaxHighlight({
  code,
  language,
  className = '',
  showLineNumbers = false,
}: SyntaxHighlightProps) {
  const { html, loading, error } = useHighlightedCode(code, language)

  // Loading state - show code without highlighting
  if (loading) {
    return (
      <pre className={cn(
        'shiki-loading overflow-x-auto max-w-full font-mono text-xs',
        className
      )}>
        <code className="text-foreground/70">{code}</code>
      </pre>
    )
  }

  // Error state - fallback to plain code
  if (error || !html) {
    return (
      <pre className={cn(
        'overflow-x-auto max-w-full font-mono text-xs',
        className
      )}>
        <code>{code}</code>
      </pre>
    )
  }

  // Render highlighted HTML
  return (
    <div
      className={cn(
        'shiki-container overflow-x-auto max-w-full [&_pre]:!bg-transparent [&_code]:text-xs [&_code]:font-mono',
        showLineNumbers && 'line-numbers',
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
```

---

### Phase 3: CSS Theme Migration

#### 3.1 Update Styles

**File**: `src/styles/shiki-theme.css` (new file, replaces prism-theme.css)

```css
/* Shiki syntax highlighting - Grimoire dark theme overrides */

/* Base container styling */
.shiki-container pre {
  background: transparent !important;
  margin: 0;
  padding: 0;
}

.shiki-container code {
  font-family: "Oxygen Mono", monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre;
  word-spacing: normal;
  word-break: normal;
  tab-size: 4;
}

/* Loading state - subtle pulse animation */
.shiki-loading {
  animation: shiki-pulse 1.5s ease-in-out infinite;
}

@keyframes shiki-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 0.5; }
}

/* Diff-specific styling - block-level backgrounds for inserted/deleted */
.shiki-container .line.diff.add {
  background: rgba(52, 199, 89, 0.1);
  display: block;
  margin: 0 -1rem;
  padding: 0 1rem;
}

.shiki-container .line.diff.remove {
  background: rgba(255, 59, 48, 0.1);
  display: block;
  margin: 0 -1rem;
  padding: 0 1rem;
}

/* Hunk headers (@@ lines) */
.shiki-container .line.diff.info {
  background: rgba(102, 217, 239, 0.08);
  display: block;
  margin: 0 -1rem;
  padding: 0 1rem;
  font-weight: 600;
}

/* Optional: Line numbers */
.shiki-container.line-numbers .line::before {
  content: attr(data-line);
  display: inline-block;
  width: 2rem;
  margin-right: 1rem;
  text-align: right;
  color: hsl(var(--muted-foreground));
  border-right: 1px solid hsl(var(--border));
  padding-right: 0.5rem;
}
```

#### 3.2 Update index.css

**File**: `src/index.css` (modify)

```css
/* Replace Prism import with Shiki */
/* @import "./styles/prism-theme.css"; */  /* Remove */
@import "./styles/shiki-theme.css";         /* Add */
```

---

### Phase 4: Component Updates

#### 4.1 Update Consumers (Minimal Changes)

Most components need no changes since the `SyntaxHighlight` interface remains the same:

```typescript
// Before (Prism)
<SyntaxHighlight code={code} language="json" />

// After (Shiki) - same API!
<SyntaxHighlight code={code} language="json" />
```

#### 4.2 Update MarkdownContent for Async Highlighting

The `CodeBlock` component in `MarkdownContent.tsx` needs slight adjustment to handle the async nature:

```typescript
// In MarkdownContent.tsx, update CodeBlock:
function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const { copy, copied } = useCopy()
  const isSingleLine = !code.includes('\n')

  return (
    <div className="relative my-4">
      <SyntaxHighlight
        code={code}
        language={language}
        className="bg-muted p-4 border border-border rounded overflow-x-auto max-w-full"
      />
      {!isSingleLine && (
        <CodeCopyButton onCopy={() => copy(code)} copied={copied} />
      )}
    </div>
  )
}
```

The `language={language as any}` casts can be removed since Shiki accepts any string.

#### 4.3 Update CodeSnippetRenderer Language Mapping

Simplify since Shiki handles more languages:

```typescript
// Before: Complex mapLanguage with limited support
function mapLanguage(lang: string | null | undefined): "javascript" | ... { }

// After: Just normalize, Shiki handles the rest
import { normalizeLanguage } from '@/lib/shiki'
// Use normalizeLanguage(language) - returns valid language or 'text'
```

#### 4.4 Remove Prism-specific Code

In `CodeSnippetDetailRenderer.tsx`, simplify the language validation:

```typescript
// Before: Manual list of supported languages
const supported = ['javascript', 'typescript', ...]
return supported.includes(mapped) ? mapped : null

// After: Let Shiki handle it
const normalizedLanguage = normalizeLanguage(language)
// Always use it - Shiki will fall back to plaintext if unknown
```

---

### Phase 5: Cleanup

#### 5.1 Remove Prism Dependencies

```bash
npm uninstall prismjs @types/prismjs
```

#### 5.2 Delete Old Files

- `src/styles/prism-theme.css` → deleted (replaced by shiki-theme.css)

#### 5.3 Remove Prism Imports

Search and remove all:
```typescript
import Prism from "prismjs"
import "prismjs/components/prism-*"
```

---

## Migration Summary

### Files to Create
| File | Purpose |
|------|---------|
| `src/lib/shiki.ts` | Shiki service with lazy loading |
| `src/hooks/useHighlightedCode.ts` | React hook for async highlighting |
| `src/styles/shiki-theme.css` | Theme styles |

### Files to Modify
| File | Changes |
|------|---------|
| `src/components/SyntaxHighlight.tsx` | Complete rewrite |
| `src/index.css` | Replace Prism import with Shiki |
| `src/components/nostr/MarkdownContent.tsx` | Remove `as any` casts |
| `src/components/nostr/kinds/CodeSnippetRenderer.tsx` | Simplify mapLanguage |
| `src/components/nostr/kinds/CodeSnippetDetailRenderer.tsx` | Remove supported list |

### Files to Delete
| File | Reason |
|------|--------|
| `src/styles/prism-theme.css` | Replaced by shiki-theme.css |

### Dependencies
| Remove | Add |
|--------|-----|
| `prismjs` | `shiki` |
| `@types/prismjs` | - |

---

## Testing Checklist

- [ ] **JSON highlighting**: DebugViewer, JsonViewer, JsonEventRow, ReqViewer
- [ ] **Diff highlighting**: PatchDetailRenderer (git patches)
- [ ] **Code snippets**: CodeSnippetRenderer, CodeSnippetDetailRenderer
- [ ] **Markdown code blocks**: MarkdownContent (articles, NIPs)
  - [ ] JavaScript/TypeScript blocks
  - [ ] Python blocks
  - [ ] Unknown language blocks (should fallback gracefully)
- [ ] **Loading states**: Check flash/pulse during language loading
- [ ] **Bundle size**: Verify lazy loading works (check network tab)
- [ ] **Theme consistency**: Colors match current Prism theme

---

## Performance Considerations

### Initial Load
- Core languages (JS, TS, JSON, diff, bash) preloaded
- WASM engine loaded once, cached by browser
- Other languages loaded on first use

### Caching
- Shiki caches compiled grammars in memory
- WASM binary cached by browser (~200KB, infrequent)
- Language grammars cached per session

### Optimization Tips
1. Preload languages for known content types
2. Use `loading` state to show code immediately (unhighlighted)
3. Consider debouncing for rapidly changing code

---

## Rollback Plan

If issues arise:
1. Revert `package.json` to restore prismjs
2. Restore `prism-theme.css`
3. Restore original `SyntaxHighlight.tsx`
4. Revert `index.css` import

The old Prism setup is self-contained and easy to restore.

---

## Future Enhancements

1. **Line highlighting**: Add ability to highlight specific lines
2. **Copy line numbers**: Option to include line numbers in copy
3. **Language detection**: Auto-detect language from content
4. **Custom themes**: Allow user theme selection
5. **Repository file viewer**: Extend for git tree visualization
