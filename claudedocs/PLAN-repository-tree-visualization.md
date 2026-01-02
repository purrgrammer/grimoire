# Plan: Repository Tree Visualization for RepositoryDetailRenderer

## Overview

Add file tree exploration and file content viewing to the Repository detail renderer (kind 30617), using the `@fiatjaf/git-natural-api` library to fetch git trees via HTTP from clone URLs.

## Library Analysis: `@fiatjaf/git-natural-api`

**Package**: `jsr:@fiatjaf/git-natural-api@0.1.3`
**Dependencies**: `@noble/hashes` (SHA-1), `fflate` (compression)

### Exported Functions

```typescript
// Get directory tree at a ref (uses blob:none filter - tree structure only, no file contents)
async function getDirectoryTreeAt(url: string, ref: string): Promise<DirectoryTree>

// Get full tree with file contents (shallow clone)
async function shallowCloneRepositoryAt(url: string, ref: string): Promise<DirectoryTree>

// Get a single git object by hash
async function getObject(url: string, hash: string): Promise<GitObject>

// Get info/refs from server (to find default branch, capabilities)
async function getInfoRefs(url: string): Promise<InfoRefs>

// Lower-level utilities
function loadTree(treeObject: GitObject, objects: Map<string, GitObject>): DirectoryTree
function parseTree(data: Uint8Array): TreeEntry[]
```

### Return Types (inferred from source)

```typescript
interface DirectoryTree {
  directories: Array<{
    name: string
    hash: string
    content: DirectoryTree | null  // null when using blob:none filter
  }>
  files: Array<{
    name: string
    hash: string
    content: Uint8Array | null  // null when using blob:none filter
  }>
}

interface InfoRefs {
  service: string | null
  refs: Record<string, string>  // e.g., {"refs/heads/main": "abc123..."}
  capabilities: string[]
  symrefs: Record<string, string>  // e.g., {"HEAD": "refs/heads/main"}
}
```

### Error Classes

```typescript
class MissingCapability extends Error {
  url: string
  capability: string
}

class MissingRef extends Error {}
```

### Required Server Capabilities

The library requires these git protocol capabilities:
- `multi_ack_detailed` - Required, throws if missing
- `side-band-64k` - Required, throws if missing
- `shallow` - Required
- `object-format=sha1` - Required
- `filter` - Required for `getDirectoryTreeAt` (uses `blob:none`)
- `ofs-delta` - Optional, used if available

**Important**: Many git servers (especially self-hosted) may not support the `filter` capability. Fallback to `shallowCloneRepositoryAt` is needed.

---

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Add git-natural-api dependency

```bash
npm install jsr:@fiatjaf/git-natural-api
```

Or via import map / esm.sh for JSR packages.

#### 1.2 Create `useGitTree` hook

**File**: `src/hooks/useGitTree.ts`

```typescript
interface UseGitTreeOptions {
  cloneUrls: string[]  // Try multiple URLs in order
  ref?: string         // Branch/tag/commit, defaults to HEAD
}

interface UseGitTreeResult {
  tree: DirectoryTree | null
  loading: boolean
  error: Error | null
  serverUrl: string | null  // Which server succeeded
  refetch: () => void
}
```

**Logic**:
1. Try each clone URL in sequence
2. First call `getInfoRefs` to check capabilities and resolve ref
3. If `filter` capability exists, use `getDirectoryTreeAt` (lighter)
4. Otherwise fall back to `shallowCloneRepositoryAt`
5. Cache result (possibly in Dexie for offline access)
6. Handle `MissingCapability`, `MissingRef` errors gracefully

#### 1.3 Create `useGitBlob` hook for file content

**File**: `src/hooks/useGitBlob.ts`

```typescript
interface UseGitBlobOptions {
  serverUrl: string
  hash: string
}

interface UseGitBlobResult {
  content: Uint8Array | null
  loading: boolean
  error: Error | null
}
```

Use `getObject(url, hash)` to fetch individual file blobs on demand.

---

### Phase 2: File Tree Component

#### 2.1 Create `FileTreeView` component

**File**: `src/components/ui/FileTreeView.tsx`

Design goals:
- Match Grimoire's dark aesthetic with existing UI primitives
- Use Radix Collapsible/Accordion for expand/collapse
- Lucide icons: `Folder`, `FolderOpen`, `File`, `FileCode`, `FileText`, etc.
- Support keyboard navigation (arrow keys, enter to expand/select)

```typescript
interface FileTreeViewProps {
  tree: DirectoryTree
  onFileSelect: (file: { name: string; hash: string; path: string }) => void
  selectedPath?: string
  className?: string
}
```

**Structure**:
- Recursive component for directories
- File icons based on extension (map common extensions to icons)
- Alphabetical sorting (directories first)
- Expandable directory nodes with chevron
- Click file to select → triggers file content fetch

#### 2.2 File Icon Mapping

```typescript
const fileIcons: Record<string, LucideIcon> = {
  // Code files
  '.ts': FileCode, '.tsx': FileCode, '.js': FileCode, '.jsx': FileCode,
  '.py': FileCode, '.rs': FileCode, '.go': FileCode, '.rb': FileCode,
  // Config/data
  '.json': FileJson, '.yaml': FileText, '.yml': FileText, '.toml': FileText,
  // Documentation
  '.md': FileText, '.txt': FileText, '.rst': FileText,
  // Default
  'default': File,
}
```

---

### Phase 3: Syntax Highlighting (Lazy Loading)

#### 3.1 Migrate to Shiki with on-demand loading

**Current state**: Using Prism.js with statically imported languages (diff, js, ts, jsx, tsx, bash, json, markdown, css, python, yaml).

**Problem**: Loading all highlighters upfront is wasteful for file tree where we need many more languages.

**Solution**: Use Shiki with fine-grained bundles and lazy loading.

**File**: `src/lib/shiki.ts`

```typescript
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

let highlighter: HighlighterCore | null = null
const loadedLanguages = new Set<string>()
const loadedThemes = new Set<string>()

// Language to Shiki language ID mapping
const languageMap: Record<string, string> = {
  'ts': 'typescript',
  'tsx': 'tsx',
  'js': 'javascript',
  'jsx': 'jsx',
  'py': 'python',
  'rs': 'rust',
  'go': 'go',
  'rb': 'ruby',
  'json': 'json',
  'yaml': 'yaml',
  'yml': 'yaml',
  'md': 'markdown',
  'css': 'css',
  'html': 'html',
  'sh': 'bash',
  'bash': 'bash',
  'diff': 'diff',
  // ... more mappings
}

export async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighter) {
    highlighter = await createHighlighterCore({
      themes: [import('@shikijs/themes/github-dark')],
      langs: [],  // Start empty, load on demand
      engine: createOnigurumaEngine(import('shiki/wasm'))
    })
    loadedThemes.add('github-dark')
  }
  return highlighter
}

export async function highlightCode(code: string, ext: string): Promise<string> {
  const lang = languageMap[ext.replace('.', '')] || 'text'
  const hl = await getHighlighter()

  // Load language if not already loaded
  if (!loadedLanguages.has(lang) && lang !== 'text') {
    try {
      await hl.loadLanguage(import(`@shikijs/langs/${lang}`))
      loadedLanguages.add(lang)
    } catch {
      // Language not available, fall back to plaintext
    }
  }

  return hl.codeToHtml(code, { lang: loadedLanguages.has(lang) ? lang : 'text', theme: 'github-dark' })
}
```

#### 3.2 Create `LazyCodeViewer` component

**File**: `src/components/ui/LazyCodeViewer.tsx`

```typescript
interface LazyCodeViewerProps {
  content: Uint8Array | string
  filename: string
  className?: string
}

export function LazyCodeViewer({ content, filename, className }: LazyCodeViewerProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const ext = getFileExtension(filename)

  useEffect(() => {
    const text = typeof content === 'string'
      ? content
      : new TextDecoder().decode(content)

    highlightCode(text, ext)
      .then(setHtml)
      .finally(() => setLoading(false))
  }, [content, ext])

  if (loading) return <Skeleton className="h-48" />

  return (
    <div
      className={cn("overflow-auto font-mono text-xs", className)}
      dangerouslySetInnerHTML={{ __html: html || '' }}
    />
  )
}
```

#### 3.3 Theme Integration

Create a Shiki theme that matches Grimoire's CSS variables, or use a compatible preset (github-dark, one-dark-pro) and apply custom CSS overrides.

---

### Phase 4: RepositoryDetailRenderer Integration

#### 4.1 Add Tree Section to Detail Renderer

**File**: `src/components/nostr/kinds/RepositoryDetailRenderer.tsx`

Add new "Files" section after URLs/Maintainers:

```tsx
// In RepositoryDetailRenderer
const cloneUrls = useMemo(() => getCloneUrls(event), [event])

const { tree, loading, error, serverUrl } = useGitTree({
  cloneUrls,
  ref: 'HEAD'  // or allow branch selection later
})

return (
  <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
    {/* ... existing sections ... */}

    {/* Files Section */}
    {cloneUrls.length > 0 && (
      <RepositoryFilesSection
        cloneUrls={cloneUrls}
        tree={tree}
        loading={loading}
        error={error}
        serverUrl={serverUrl}
      />
    )}
  </div>
)
```

#### 4.2 Create `RepositoryFilesSection` component

**File**: `src/components/nostr/kinds/RepositoryFilesSection.tsx`

```tsx
interface RepositoryFilesSectionProps {
  cloneUrls: string[]
  tree: DirectoryTree | null
  loading: boolean
  error: Error | null
  serverUrl: string | null
}

export function RepositoryFilesSection({
  cloneUrls,
  tree,
  loading,
  error,
  serverUrl
}: RepositoryFilesSectionProps) {
  const [selectedFile, setSelectedFile] = useState<{name: string, hash: string, path: string} | null>(null)

  // Fetch file content when selected
  const { content, loading: contentLoading } = useGitBlob({
    serverUrl,
    hash: selectedFile?.hash
  })

  if (loading) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <FolderTree className="size-5" />
          Files
        </h2>
        <Skeleton className="h-48" />
      </section>
    )
  }

  if (error) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <FolderTree className="size-5" />
          Files
        </h2>
        <div className="text-sm text-muted-foreground">
          <p>Unable to load repository files.</p>
          <p className="text-xs mt-1">{error.message}</p>
        </div>
      </section>
    )
  }

  if (!tree) return null

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <FolderTree className="size-5" />
        Files
        {serverUrl && (
          <span className="text-xs text-muted-foreground font-normal ml-2">
            from {new URL(serverUrl).hostname}
          </span>
        )}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* File Tree */}
        <div className="border border-border rounded p-2 max-h-96 overflow-auto">
          <FileTreeView
            tree={tree}
            onFileSelect={setSelectedFile}
            selectedPath={selectedFile?.path}
          />
        </div>

        {/* File Content Preview */}
        <div className="border border-border rounded p-2 max-h-96 overflow-auto">
          {selectedFile ? (
            contentLoading ? (
              <Skeleton className="h-full" />
            ) : content ? (
              <LazyCodeViewer content={content} filename={selectedFile.name} />
            ) : (
              <div className="text-sm text-muted-foreground p-4">
                Unable to load file content
              </div>
            )
          ) : (
            <div className="text-sm text-muted-foreground p-4 flex items-center justify-center h-full">
              Select a file to view its contents
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
```

---

### Phase 5: Resilience & Caching

#### 5.1 Multi-Server Fallback

Repositories have multiple clone URLs. Try each in order:

```typescript
async function tryFetchTree(cloneUrls: string[], ref: string): Promise<{
  tree: DirectoryTree
  serverUrl: string
}> {
  const errors: Error[] = []

  for (const url of cloneUrls) {
    try {
      // Check capabilities first
      const info = await getInfoRefs(url)
      const hasFilter = info.capabilities.includes('filter')

      // Resolve ref if symbolic
      const resolvedRef = ref.startsWith('refs/')
        ? info.refs[ref]
        : info.symrefs['HEAD']?.startsWith('refs/')
          ? info.refs[info.symrefs['HEAD']]
          : ref

      const tree = hasFilter
        ? await getDirectoryTreeAt(url, resolvedRef)
        : await shallowCloneRepositoryAt(url, resolvedRef)

      return { tree, serverUrl: url }
    } catch (e) {
      errors.push(e as Error)
      continue
    }
  }

  throw new AggregateError(errors, 'All servers failed')
}
```

#### 5.2 Dexie Caching

Cache trees and blobs in IndexedDB for offline access:

```typescript
// In src/services/db.ts
interface GitTreeCache {
  id: string  // `${serverUrl}:${ref}`
  tree: DirectoryTree
  fetchedAt: number
}

interface GitBlobCache {
  hash: string
  content: Uint8Array
  fetchedAt: number
}

// Add to Dexie schema
db.version(X).stores({
  // ... existing stores ...
  gitTrees: 'id, fetchedAt',
  gitBlobs: 'hash, fetchedAt'
})
```

TTL: 1 hour for trees, indefinite for blobs (content-addressed).

---

## File Tree UI Options

Given Grimoire's aesthetic (dark theme, Tailwind, Radix primitives), we should build a custom component rather than import a library. Options considered:

1. **Custom with Radix Collapsible** (Recommended)
   - Full control over styling
   - Matches existing app patterns
   - Uses existing dependencies

2. **FlyonUI Tree View**
   - Tailwind-based
   - Would require adding Preline plugins
   - Overkill for our needs

3. **react-arborist**
   - Full-featured tree with virtualization
   - Heavy dependency
   - More than we need

**Recommendation**: Build custom using Radix Collapsible + Lucide icons, following patterns from existing Accordion component.

---

## Bundle Size Considerations

### Current Prism Setup
- `prismjs` core: ~20KB
- Each language: 1-5KB
- Currently importing 11 languages statically

### Shiki Migration
- `shiki/core`: ~15KB
- Each language: 10-50KB (grammars are larger but more accurate)
- WASM engine: ~200KB (one-time)
- Themes: 2-5KB each

**Strategy**:
- Keep Prism for existing uses (diff highlighting in patches)
- Use Shiki only for the file viewer with lazy loading
- Or fully migrate to Shiki with lazy loading everywhere

**Recommendation**: Full Shiki migration for consistency, using lazy loading for all languages.

---

## Implementation Order

1. **Core hooks** (`useGitTree`, `useGitBlob`)
2. **FileTreeView component** (minimal, collapsible tree)
3. **RepositoryFilesSection** integration
4. **Shiki migration** with lazy loading
5. **LazyCodeViewer** component
6. **Caching layer** in Dexie
7. **Polish** (loading states, error handling, keyboard nav)

---

## Testing Strategy

- Unit tests for file extension → language mapping
- Unit tests for tree traversal/sorting
- Integration tests with mock git server responses
- Manual testing with various repository types (GitHub, GitLab, self-hosted)

---

## Known Limitations

1. **Filter capability**: Many self-hosted git servers don't support `blob:none` filter. Fallback to full shallow clone works but is heavier.

2. **Large repositories**: Tree can be huge for monorepos. Consider pagination/virtualization for 1000+ files.

3. **Binary files**: Need detection and handling (show "Binary file" instead of trying to decode).

4. **Private repositories**: The API works with public repos only. Would need auth token support for private.

5. **CORS**: Some git servers may not allow browser requests. May need a proxy or show a helpful error.
