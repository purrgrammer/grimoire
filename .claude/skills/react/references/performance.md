# React Performance Optimization Guide

## Overview

This guide covers performance optimization strategies for React 19 applications.

## Measurement & Profiling

### React DevTools Profiler

Record performance data:
1. Open React DevTools
2. Go to Profiler tab
3. Click record button
4. Interact with app
5. Stop recording
6. Analyze flame graph and ranked chart

### Profiler Component

```typescript
import { Profiler } from 'react'

const App = () => {
  const onRender = (
    id: string,
    phase: 'mount' | 'update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    console.log({
      component: id,
      phase,
      actualDuration,  // Time spent rendering this update
      baseDuration     // Estimated time without memoization
    })
  }
  
  return (
    <Profiler id="App" onRender={onRender}>
      <YourApp />
    </Profiler>
  )
}
```

### Performance Metrics

```typescript
// Custom performance tracking
const startTime = performance.now()
// ... do work
const endTime = performance.now()
console.log(`Operation took ${endTime - startTime}ms`)

// React rendering metrics
import { unstable_trace as trace } from 'react'

trace('expensive-operation', async () => {
  await performExpensiveOperation()
})
```

## Memoization Strategies

### React.memo

Prevent unnecessary re-renders:

```typescript
// Basic memoization
const ExpensiveComponent = memo(({ data }: Props) => {
  return <div>{processData(data)}</div>
})

// Custom comparison
const MemoizedComponent = memo(
  ({ user }: Props) => <UserCard user={user} />,
  (prevProps, nextProps) => {
    // Return true if props are equal (skip render)
    return prevProps.user.id === nextProps.user.id
  }
)
```

**When to use:**
- Component renders often with same props
- Rendering is expensive
- Component receives complex prop objects

**When NOT to use:**
- Props change frequently
- Component is already fast
- Premature optimization

### useMemo

Memoize computed values:

```typescript
const SortedList = ({ items, filter }: Props) => {
  // Without memoization - runs every render
  const filteredItems = items.filter(item => item.type === filter)
  const sortedItems = filteredItems.sort((a, b) => a.name.localeCompare(b.name))
  
  // With memoization - only runs when dependencies change
  const sortedFilteredItems = useMemo(() => {
    const filtered = items.filter(item => item.type === filter)
    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [items, filter])
  
  return (
    <ul>
      {sortedFilteredItems.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  )
}
```

**When to use:**
- Expensive calculations (sorting, filtering large arrays)
- Creating stable object references
- Computed values used as dependencies

### useCallback

Memoize callback functions:

```typescript
const Parent = () => {
  const [count, setCount] = useState(0)
  
  // Without useCallback - new function every render
  const handleClick = () => {
    setCount(c => c + 1)
  }
  
  // With useCallback - stable function reference
  const handleClickMemo = useCallback(() => {
    setCount(c => c + 1)
  }, [])
  
  return <MemoizedChild onClick={handleClickMemo} />
}

const MemoizedChild = memo(({ onClick }: Props) => {
  return <button onClick={onClick}>Click</button>
})
```

**When to use:**
- Passing callbacks to memoized components
- Callback is used in dependency array
- Callback is expensive to create

## React Compiler (Automatic Optimization)

### Enable React Compiler

React 19 can automatically optimize without manual memoization:

```javascript
// babel.config.js
module.exports = {
  plugins: [
    ['react-compiler', {
      compilationMode: 'all',  // Optimize all components
    }]
  ]
}
```

### Compilation Modes

```javascript
{
  compilationMode: 'annotation',  // Only components with "use memo"
  compilationMode: 'all',         // All components (recommended)
  compilationMode: 'infer'        // Based on component complexity
}
```

### Directives

```typescript
// Force memoization
'use memo'
const Component = ({ data }: Props) => {
  return <div>{data}</div>
}

// Prevent memoization
'use no memo'
const SimpleComponent = ({ text }: Props) => {
  return <span>{text}</span>
}
```

## State Management Optimization

### State Colocation

Keep state as close as possible to where it's used:

```typescript
// Bad - state too high
const App = () => {
  const [showModal, setShowModal] = useState(false)
  
  return (
    <>
      <Header />
      <Content />
      <Modal show={showModal} onClose={() => setShowModal(false)} />
    </>
  )
}

// Good - state colocated
const App = () => {
  return (
    <>
      <Header />
      <Content />
      <ModalContainer />
    </>
  )
}

const ModalContainer = () => {
  const [showModal, setShowModal] = useState(false)
  
  return <Modal show={showModal} onClose={() => setShowModal(false)} />
}
```

### Split Context

Avoid unnecessary re-renders by splitting context:

```typescript
// Bad - single context causes all consumers to re-render
const AppContext = createContext({ user, theme, settings })

// Good - split into separate contexts
const UserContext = createContext(user)
const ThemeContext = createContext(theme)
const SettingsContext = createContext(settings)
```

### Context with useMemo

```typescript
const ThemeProvider = ({ children }: Props) => {
  const [theme, setTheme] = useState('light')
  
  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    theme,
    setTheme
  }), [theme])
  
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
```

## Code Splitting & Lazy Loading

### React.lazy

Split components into separate bundles:

```typescript
import { lazy, Suspense } from 'react'

// Lazy load components
const Dashboard = lazy(() => import('./Dashboard'))
const Settings = lazy(() => import('./Settings'))
const Profile = lazy(() => import('./Profile'))

const App = () => {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </Suspense>
  )
}
```

### Route-based Splitting

```typescript
// App.tsx
const routes = [
  { path: '/', component: lazy(() => import('./pages/Home')) },
  { path: '/about', component: lazy(() => import('./pages/About')) },
  { path: '/products', component: lazy(() => import('./pages/Products')) },
]

const App = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      {routes.map(({ path, component: Component }) => (
        <Route key={path} path={path} element={<Component />} />
      ))}
    </Routes>
  </Suspense>
)
```

### Component-based Splitting

```typescript
// Split expensive components
const HeavyChart = lazy(() => import('./HeavyChart'))

const Dashboard = () => {
  const [showChart, setShowChart] = useState(false)
  
  return (
    <>
      <button onClick={() => setShowChart(true)}>
        Load Chart
      </button>
      {showChart && (
        <Suspense fallback={<ChartSkeleton />}>
          <HeavyChart />
        </Suspense>
      )}
    </>
  )
}
```

## List Rendering Optimization

### Keys

Always use stable, unique keys:

```typescript
// Bad - index as key (causes issues on reorder/insert)
{items.map((item, index) => (
  <Item key={index} data={item} />
))}

// Good - unique ID as key
{items.map(item => (
  <Item key={item.id} data={item} />
))}

// For static lists without IDs
{items.map(item => (
  <Item key={`${item.name}-${item.category}`} data={item} />
))}
```

### Virtualization

For long lists, render only visible items:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual'

const VirtualList = ({ items }: { items: Item[] }) => {
  const parentRef = useRef<HTMLDivElement>(null)
  
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,  // Estimated item height
    overscan: 5  // Render 5 extra items above/below viewport
  })
  
  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative'
        }}
      >
        {virtualizer.getVirtualItems().map(virtualItem => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`
            }}
          >
            <Item data={items[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Pagination

```typescript
const PaginatedList = ({ items }: Props) => {
  const [page, setPage] = useState(1)
  const itemsPerPage = 20
  
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * itemsPerPage
    const end = start + itemsPerPage
    return items.slice(start, end)
  }, [items, page, itemsPerPage])
  
  return (
    <>
      {paginatedItems.map(item => (
        <Item key={item.id} data={item} />
      ))}
      <Pagination 
        page={page} 
        total={Math.ceil(items.length / itemsPerPage)}
        onChange={setPage}
      />
    </>
  )
}
```

## Transitions & Concurrent Features

### useTransition

Keep UI responsive during expensive updates:

```typescript
const SearchPage = () => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isPending, startTransition] = useTransition()
  
  const handleSearch = (value: string) => {
    setQuery(value)  // Urgent - update input immediately
    
    // Non-urgent - can be interrupted
    startTransition(() => {
      const filtered = expensiveFilter(items, value)
      setResults(filtered)
    })
  }
  
  return (
    <>
      <input value={query} onChange={e => handleSearch(e.target.value)} />
      {isPending && <Spinner />}
      <ResultsList results={results} />
    </>
  )
}
```

### useDeferredValue

Defer non-urgent renders:

```typescript
const SearchPage = () => {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  
  // Input updates immediately
  // Results update with deferred value (can be interrupted)
  const results = useMemo(() => {
    return expensiveFilter(items, deferredQuery)
  }, [deferredQuery])
  
  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <ResultsList results={results} />
    </>
  )
}
```

## Image & Asset Optimization

### Lazy Load Images

```typescript
const LazyImage = ({ src, alt }: Props) => {
  const [isLoaded, setIsLoaded] = useState(false)
  
  return (
    <div className="relative">
      {!isLoaded && <ImageSkeleton />}
      <img
        src={src}
        alt={alt}
        loading="lazy"  // Native lazy loading
        onLoad={() => setIsLoaded(true)}
        className={isLoaded ? 'opacity-100' : 'opacity-0'}
      />
    </div>
  )
}
```

### Next.js Image Component

```typescript
import Image from 'next/image'

const OptimizedImage = () => (
  <Image
    src="/hero.jpg"
    alt="Hero"
    width={800}
    height={600}
    priority  // Load immediately for above-fold images
    placeholder="blur"
    blurDataURL="data:image/jpeg;base64,..."
  />
)
```

## Bundle Size Optimization

### Tree Shaking

Import only what you need:

```typescript
// Bad - imports entire library
import _ from 'lodash'

// Good - import only needed functions
import debounce from 'lodash/debounce'
import throttle from 'lodash/throttle'

// Even better - use native methods when possible
const debounce = (fn, delay) => {
  let timeoutId
  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}
```

### Analyze Bundle

```bash
# Next.js
ANALYZE=true npm run build

# Create React App
npm install --save-dev webpack-bundle-analyzer
```

### Dynamic Imports

```typescript
// Load library only when needed
const handleExport = async () => {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  doc.save('report.pdf')
}
```

## Common Performance Pitfalls

### 1. Inline Object Creation

```typescript
// Bad - new object every render
<Component style={{ margin: 10 }} />

// Good - stable reference
const style = { margin: 10 }
<Component style={style} />

// Or use useMemo
const style = useMemo(() => ({ margin: 10 }), [])
```

### 2. Inline Functions

```typescript
// Bad - new function every render (if child is memoized)
<MemoizedChild onClick={() => handleClick(id)} />

// Good
const handleClickMemo = useCallback(() => handleClick(id), [id])
<MemoizedChild onClick={handleClickMemo} />
```

### 3. Spreading Props

```typescript
// Bad - causes re-renders even when props unchanged
<Component {...props} />

// Good - pass only needed props
<Component value={props.value} onChange={props.onChange} />
```

### 4. Large Context

```typescript
// Bad - everything re-renders on any state change
const AppContext = createContext({ user, theme, cart, settings, ... })

// Good - split into focused contexts
const UserContext = createContext(user)
const ThemeContext = createContext(theme)
const CartContext = createContext(cart)
```

## Performance Checklist

- [ ] Measure before optimizing (use Profiler)
- [ ] Use React DevTools to identify slow components
- [ ] Implement code splitting for large routes
- [ ] Lazy load below-the-fold content
- [ ] Virtualize long lists
- [ ] Memoize expensive calculations
- [ ] Split large contexts
- [ ] Colocate state close to usage
- [ ] Use transitions for non-urgent updates
- [ ] Optimize images and assets
- [ ] Analyze and minimize bundle size
- [ ] Remove console.logs in production
- [ ] Use production build for testing
- [ ] Monitor real-world performance metrics

## References

- React Performance: https://react.dev/learn/render-and-commit
- React Profiler: https://react.dev/reference/react/Profiler
- React Compiler: https://react.dev/reference/react-compiler
- Web Vitals: https://web.dev/vitals/

