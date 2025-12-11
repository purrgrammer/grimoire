# React Practical Examples

This file contains real-world examples of React patterns and solutions.

## Example 1: Custom Hook for Data Fetching

```typescript
import { useState, useEffect } from 'react'

interface FetchState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

const useFetch = <T,>(url: string) => {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null
  })
  
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    
    const fetchData = async () => {
      try {
        setState(prev => ({ ...prev, loading: true, error: null }))
        
        const response = await fetch(url, { 
          signal: controller.signal 
        })
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        
        const data = await response.json()
        
        if (!cancelled) {
          setState({ data, loading: false, error: null })
        }
      } catch (error) {
        if (!cancelled && error.name !== 'AbortError') {
          setState({ 
            data: null, 
            loading: false, 
            error: error as Error 
          })
        }
      }
    }
    
    fetchData()
    
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [url])
  
  return state
}

// Usage
const UserProfile = ({ userId }: { userId: string }) => {
  const { data, loading, error } = useFetch<User>(`/api/users/${userId}`)
  
  if (loading) return <Spinner />
  if (error) return <ErrorMessage error={error} />
  if (!data) return null
  
  return <UserCard user={data} />
}
```

## Example 2: Form with Validation

```typescript
import { useState, useCallback } from 'react'
import { z } from 'zod'

const userSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  age: z.number().min(18, 'Must be 18 or older')
})

type UserForm = z.infer<typeof userSchema>
type FormErrors = Partial<Record<keyof UserForm, string>>

const UserForm = () => {
  const [formData, setFormData] = useState<UserForm>({
    name: '',
    email: '',
    age: 0
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const handleChange = useCallback((
    field: keyof UserForm,
    value: string | number
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    setErrors(prev => ({ ...prev, [field]: undefined }))
  }, [])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate
    const result = userSchema.safeParse(formData)
    if (!result.success) {
      const fieldErrors: FormErrors = {}
      result.error.errors.forEach(err => {
        const field = err.path[0] as keyof UserForm
        fieldErrors[field] = err.message
      })
      setErrors(fieldErrors)
      return
    }
    
    // Submit
    setIsSubmitting(true)
    try {
      await submitUser(result.data)
      // Success handling
    } catch (error) {
      console.error(error)
    } finally {
      setIsSubmitting(false)
    }
  }
  
  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="name">Name</label>
        <input
          id="name"
          value={formData.name}
          onChange={e => handleChange('name', e.target.value)}
        />
        {errors.name && <span className="error">{errors.name}</span>}
      </div>
      
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={formData.email}
          onChange={e => handleChange('email', e.target.value)}
        />
        {errors.email && <span className="error">{errors.email}</span>}
      </div>
      
      <div>
        <label htmlFor="age">Age</label>
        <input
          id="age"
          type="number"
          value={formData.age || ''}
          onChange={e => handleChange('age', Number(e.target.value))}
        />
        {errors.age && <span className="error">{errors.age}</span>}
      </div>
      
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  )
}
```

## Example 3: Modal with Portal

```typescript
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
}

const Modal = ({ isOpen, onClose, children, title }: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null)
  
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      // Prevent body scroll
      document.body.style.overflow = 'hidden'
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])
  
  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) {
      onClose()
    }
  }
  
  if (!isOpen) return null
  
  return createPortal(
    <div
      ref={modalRef}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          {title && <h2 className="text-xl font-bold">{title}</h2>}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

// Usage
const App = () => {
  const [isOpen, setIsOpen] = useState(false)
  
  return (
    <>
      <button onClick={() => setIsOpen(true)}>Open Modal</button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="My Modal">
        <p>Modal content goes here</p>
        <button onClick={() => setIsOpen(false)}>Close</button>
      </Modal>
    </>
  )
}
```

## Example 4: Infinite Scroll

```typescript
import { useState, useEffect, useRef, useCallback } from 'react'

interface InfiniteScrollProps<T> {
  fetchData: (page: number) => Promise<T[]>
  renderItem: (item: T, index: number) => React.ReactNode
  loader?: React.ReactNode
  endMessage?: React.ReactNode
}

const InfiniteScroll = <T extends { id: string | number },>({
  fetchData,
  renderItem,
  loader = <div>Loading...</div>,
  endMessage = <div>No more items</div>
}: InfiniteScrollProps<T>) => {
  const [items, setItems] = useState<T[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    
    setLoading(true)
    try {
      const newItems = await fetchData(page)
      
      if (newItems.length === 0) {
        setHasMore(false)
      } else {
        setItems(prev => [...prev, ...newItems])
        setPage(prev => prev + 1)
      }
    } catch (error) {
      console.error('Failed to load items:', error)
    } finally {
      setLoading(false)
    }
  }, [page, loading, hasMore, fetchData])
  
  // Set up intersection observer
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )
    
    const currentRef = loadMoreRef.current
    if (currentRef) {
      observerRef.current.observe(currentRef)
    }
    
    return () => {
      if (observerRef.current && currentRef) {
        observerRef.current.unobserve(currentRef)
      }
    }
  }, [loadMore])
  
  // Initial load
  useEffect(() => {
    loadMore()
  }, [])
  
  return (
    <div>
      {items.map((item, index) => (
        <div key={item.id}>
          {renderItem(item, index)}
        </div>
      ))}
      
      <div ref={loadMoreRef}>
        {loading && loader}
        {!loading && !hasMore && endMessage}
      </div>
    </div>
  )
}

// Usage
const PostsList = () => {
  const fetchPosts = async (page: number) => {
    const response = await fetch(`/api/posts?page=${page}`)
    return response.json()
  }
  
  return (
    <InfiniteScroll<Post>
      fetchData={fetchPosts}
      renderItem={(post) => <PostCard post={post} />}
    />
  )
}
```

## Example 5: Dark Mode Toggle

```typescript
import { createContext, useContext, useState, useEffect } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Check localStorage and system preference
    const saved = localStorage.getItem('theme') as Theme | null
    if (saved) return saved
    
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    
    return 'light'
  })
  
  useEffect(() => {
    // Update DOM and localStorage
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  
  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }
  
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// Usage
const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme()
  
  return (
    <button onClick={toggleTheme} aria-label="Toggle theme">
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  )
}
```

## Example 6: Debounced Search

```typescript
import { useState, useEffect, useMemo } from 'react'

const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value)
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    
    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])
  
  return debouncedValue
}

const SearchPage = () => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  
  const debouncedQuery = useDebounce(query, 500)
  
  useEffect(() => {
    if (!debouncedQuery) {
      setResults([])
      return
    }
    
    const searchProducts = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/search?q=${debouncedQuery}`)
        const data = await response.json()
        setResults(data)
      } catch (error) {
        console.error('Search failed:', error)
      } finally {
        setLoading(false)
      }
    }
    
    searchProducts()
  }, [debouncedQuery])
  
  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search products..."
      />
      
      {loading && <Spinner />}
      
      {!loading && results.length > 0 && (
        <div>
          {results.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
      
      {!loading && query && results.length === 0 && (
        <p>No results found for "{query}"</p>
      )}
    </div>
  )
}
```

## Example 7: Tabs Component

```typescript
import { createContext, useContext, useState, useId } from 'react'

interface TabsContextType {
  activeTab: string
  setActiveTab: (id: string) => void
  tabsId: string
}

const TabsContext = createContext<TabsContextType | null>(null)

const useTabs = () => {
  const context = useContext(TabsContext)
  if (!context) throw new Error('Tabs compound components must be used within Tabs')
  return context
}

interface TabsProps {
  children: React.ReactNode
  defaultValue: string
  className?: string
}

const Tabs = ({ children, defaultValue, className }: TabsProps) => {
  const [activeTab, setActiveTab] = useState(defaultValue)
  const tabsId = useId()
  
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab, tabsId }}>
      <div className={className}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

const TabsList = ({ children, className }: { 
  children: React.ReactNode
  className?: string 
}) => (
  <div role="tablist" className={className}>
    {children}
  </div>
)

interface TabsTriggerProps {
  value: string
  children: React.ReactNode
  className?: string
}

const TabsTrigger = ({ value, children, className }: TabsTriggerProps) => {
  const { activeTab, setActiveTab, tabsId } = useTabs()
  const isActive = activeTab === value
  
  return (
    <button
      role="tab"
      id={`${tabsId}-tab-${value}`}
      aria-controls={`${tabsId}-panel-${value}`}
      aria-selected={isActive}
      onClick={() => setActiveTab(value)}
      className={`${className} ${isActive ? 'active' : ''}`}
    >
      {children}
    </button>
  )
}

interface TabsContentProps {
  value: string
  children: React.ReactNode
  className?: string
}

const TabsContent = ({ value, children, className }: TabsContentProps) => {
  const { activeTab, tabsId } = useTabs()
  
  if (activeTab !== value) return null
  
  return (
    <div
      role="tabpanel"
      id={`${tabsId}-panel-${value}`}
      aria-labelledby={`${tabsId}-tab-${value}`}
      className={className}
    >
      {children}
    </div>
  )
}

// Export compound component
export { Tabs, TabsList, TabsTrigger, TabsContent }

// Usage
const App = () => (
  <Tabs defaultValue="profile">
    <TabsList>
      <TabsTrigger value="profile">Profile</TabsTrigger>
      <TabsTrigger value="settings">Settings</TabsTrigger>
      <TabsTrigger value="notifications">Notifications</TabsTrigger>
    </TabsList>
    
    <TabsContent value="profile">
      <h2>Profile Content</h2>
    </TabsContent>
    
    <TabsContent value="settings">
      <h2>Settings Content</h2>
    </TabsContent>
    
    <TabsContent value="notifications">
      <h2>Notifications Content</h2>
    </TabsContent>
  </Tabs>
)
```

## Example 8: Error Boundary

```typescript
import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }
  
  reset = () => {
    this.setState({ hasError: false, error: null })
  }
  
  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <details>
            <summary>Error details</summary>
            <pre>{this.state.error.message}</pre>
          </details>
          <button onClick={this.reset}>Try again</button>
        </div>
      )
    }
    
    return this.props.children
  }
}

// Usage
const App = () => (
  <ErrorBoundary
    fallback={(error, reset) => (
      <div>
        <h1>Oops! Something went wrong</h1>
        <p>{error.message}</p>
        <button onClick={reset}>Retry</button>
      </div>
    )}
    onError={(error, errorInfo) => {
      // Send to error tracking service
      console.error('Error logged:', error, errorInfo)
    }}
  >
    <YourApp />
  </ErrorBoundary>
)
```

## Example 9: Custom Hook for Local Storage

```typescript
import { useState, useEffect, useCallback } from 'react'

const useLocalStorage = <T,>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void, () => void] => {
  // Get initial value from localStorage
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.error(`Error loading ${key} from localStorage:`, error)
      return initialValue
    }
  })
  
  // Update localStorage when value changes
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value
      setStoredValue(valueToStore)
      window.localStorage.setItem(key, JSON.stringify(valueToStore))
      
      // Dispatch storage event for other tabs
      window.dispatchEvent(new Event('storage'))
    } catch (error) {
      console.error(`Error saving ${key} to localStorage:`, error)
    }
  }, [key, storedValue])
  
  // Remove from localStorage
  const removeValue = useCallback(() => {
    try {
      window.localStorage.removeItem(key)
      setStoredValue(initialValue)
    } catch (error) {
      console.error(`Error removing ${key} from localStorage:`, error)
    }
  }, [key, initialValue])
  
  // Listen for changes in other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        setStoredValue(JSON.parse(e.newValue))
      }
    }
    
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [key])
  
  return [storedValue, setValue, removeValue]
}

// Usage
const UserPreferences = () => {
  const [preferences, setPreferences, clearPreferences] = useLocalStorage('user-prefs', {
    theme: 'light',
    language: 'en',
    notifications: true
  })
  
  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={preferences.notifications}
          onChange={e => setPreferences({
            ...preferences,
            notifications: e.target.checked
          })}
        />
        Enable notifications
      </label>
      
      <button onClick={clearPreferences}>
        Reset to defaults
      </button>
    </div>
  )
}
```

## Example 10: Optimistic Updates with useOptimistic

```typescript
'use client'

import { useOptimistic } from 'react'
import { likePost, unlikePost } from './actions'

interface Post {
  id: string
  content: string
  likes: number
  isLiked: boolean
}

const PostCard = ({ post }: { post: Post }) => {
  const [optimisticPost, addOptimistic] = useOptimistic(
    post,
    (currentPost, update: Partial<Post>) => ({
      ...currentPost,
      ...update
    })
  )
  
  const handleLike = async () => {
    // Optimistically update UI
    addOptimistic({ 
      likes: optimisticPost.likes + 1,
      isLiked: true 
    })
    
    try {
      // Send server request
      await likePost(post.id)
    } catch (error) {
      // Server will send correct state via revalidation
      console.error('Failed to like post:', error)
    }
  }
  
  const handleUnlike = async () => {
    addOptimistic({ 
      likes: optimisticPost.likes - 1,
      isLiked: false 
    })
    
    try {
      await unlikePost(post.id)
    } catch (error) {
      console.error('Failed to unlike post:', error)
    }
  }
  
  return (
    <div className="post-card">
      <p>{optimisticPost.content}</p>
      <button 
        onClick={optimisticPost.isLiked ? handleUnlike : handleLike}
        className={optimisticPost.isLiked ? 'liked' : ''}
      >
        ❤️ {optimisticPost.likes}
      </button>
    </div>
  )
}
```

## References

These examples demonstrate:
- Custom hooks for reusable logic
- Form handling with validation
- Portal usage for modals
- Infinite scroll with Intersection Observer
- Context for global state
- Debouncing for performance
- Compound components pattern
- Error boundaries
- LocalStorage integration
- Optimistic updates (React 19)

