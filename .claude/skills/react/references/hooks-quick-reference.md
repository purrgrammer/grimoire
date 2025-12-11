# React Hooks Quick Reference

## State Hooks

### useState
```typescript
const [state, setState] = useState<Type>(initialValue)
const [count, setCount] = useState(0)

// Functional update
setCount(prev => prev + 1)

// Lazy initialization
const [state, setState] = useState(() => expensiveComputation())
```

### useReducer
```typescript
type State = { count: number }
type Action = { type: 'increment' } | { type: 'decrement' }

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'increment': return { count: state.count + 1 }
    case 'decrement': return { count: state.count - 1 }
  }
}

const [state, dispatch] = useReducer(reducer, { count: 0 })
dispatch({ type: 'increment' })
```

### useActionState (React 19)
```typescript
const [state, formAction, isPending] = useActionState(
  async (previousState, formData: FormData) => {
    // Server action
    return await processForm(formData)
  },
  initialState
)

<form action={formAction}>
  <button disabled={isPending}>Submit</button>
</form>
```

## Effect Hooks

### useEffect
```typescript
useEffect(() => {
  // Side effect
  const subscription = api.subscribe()
  
  // Cleanup
  return () => subscription.unsubscribe()
}, [dependencies])
```

**Timing**: After render & paint
**Use for**: Data fetching, subscriptions, DOM mutations

### useLayoutEffect
```typescript
useLayoutEffect(() => {
  // Runs before paint
  const height = ref.current.offsetHeight
  setHeight(height)
}, [])
```

**Timing**: After render, before paint
**Use for**: DOM measurements, preventing flicker

### useInsertionEffect
```typescript
useInsertionEffect(() => {
  // Insert styles before any DOM reads
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  return () => document.head.removeChild(style)
}, [css])
```

**Timing**: Before any DOM mutations
**Use for**: CSS-in-JS libraries

## Performance Hooks

### useMemo
```typescript
const memoizedValue = useMemo(() => {
  return expensiveComputation(a, b)
}, [a, b])
```

**Use for**: Expensive calculations, stable object references

### useCallback
```typescript
const memoizedCallback = useCallback(() => {
  doSomething(a, b)
}, [a, b])
```

**Use for**: Passing callbacks to optimized components

## Ref Hooks

### useRef
```typescript
// DOM reference
const ref = useRef<HTMLDivElement>(null)
ref.current?.focus()

// Mutable value (doesn't trigger re-render)
const countRef = useRef(0)
countRef.current += 1
```

### useImperativeHandle
```typescript
useImperativeHandle(ref, () => ({
  focus: () => inputRef.current?.focus(),
  clear: () => inputRef.current && (inputRef.current.value = '')
}), [])
```

## Context Hook

### useContext
```typescript
const value = useContext(MyContext)
```

Must be used within a Provider.

## Transition Hooks

### useTransition
```typescript
const [isPending, startTransition] = useTransition()

startTransition(() => {
  setState(newValue)  // Non-urgent update
})
```

### useDeferredValue
```typescript
const [input, setInput] = useState('')
const deferredInput = useDeferredValue(input)

// Use deferredInput for expensive operations
const results = useMemo(() => search(deferredInput), [deferredInput])
```

## Optimistic Updates (React 19)

### useOptimistic
```typescript
const [optimisticState, addOptimistic] = useOptimistic(
  actualState,
  (currentState, optimisticValue) => {
    return [...currentState, optimisticValue]
  }
)
```

## Other Hooks

### useId
```typescript
const id = useId()
<label htmlFor={id}>Name</label>
<input id={id} />
```

### useSyncExternalStore
```typescript
const state = useSyncExternalStore(
  subscribe,
  getSnapshot,
  getServerSnapshot
)
```

### useDebugValue
```typescript
useDebugValue(isOnline ? 'Online' : 'Offline')
```

### use (React 19)
```typescript
// Read context or promise
const value = use(MyContext)
const data = use(fetchPromise)  // Must be in Suspense
```

## Form Hooks (React DOM)

### useFormStatus
```typescript
import { useFormStatus } from 'react-dom'

const { pending, data, method, action } = useFormStatus()
```

## Hook Rules

1. **Only call at top level** - Not in loops, conditions, or nested functions
2. **Only call from React functions** - Components or custom hooks
3. **Custom hooks start with "use"** - Naming convention
4. **Same hooks in same order** - Every render must call same hooks

## Dependencies Best Practices

1. **Include all used values** - Variables, props, state from component scope
2. **Use ESLint plugin** - `eslint-plugin-react-hooks` enforces rules
3. **Functions as dependencies** - Wrap with useCallback or define outside component
4. **Object/array dependencies** - Use useMemo for stable references

## Common Patterns

### Fetching Data
```typescript
const [data, setData] = useState(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState(null)

useEffect(() => {
  const controller = new AbortController()
  
  fetch('/api/data', { signal: controller.signal })
    .then(res => res.json())
    .then(setData)
    .catch(setError)
    .finally(() => setLoading(false))
  
  return () => controller.abort()
}, [])
```

### Debouncing
```typescript
const [value, setValue] = useState('')
const [debouncedValue, setDebouncedValue] = useState(value)

useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedValue(value)
  }, 500)
  
  return () => clearTimeout(timer)
}, [value])
```

### Previous Value
```typescript
const usePrevious = <T,>(value: T): T | undefined => {
  const ref = useRef<T>()
  useEffect(() => {
    ref.current = value
  })
  return ref.current
}
```

### Interval
```typescript
useEffect(() => {
  const id = setInterval(() => {
    setCount(c => c + 1)
  }, 1000)
  
  return () => clearInterval(id)
}, [])
```

### Event Listeners
```typescript
useEffect(() => {
  const handleResize = () => setWidth(window.innerWidth)
  
  window.addEventListener('resize', handleResize)
  return () => window.removeEventListener('resize', handleResize)
}, [])
```

