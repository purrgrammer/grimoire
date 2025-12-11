# React Server Components & Server Functions

## Overview

React Server Components (RSC) allow components to render on the server, improving performance and enabling direct data access. Server Functions allow client components to call server-side functions.

## Server Components

### What are Server Components?

Components that run **only on the server**:
- Can access databases directly
- Zero bundle size (code stays on server)
- Better performance (less JavaScript to client)
- Automatic code splitting

### Creating Server Components

```typescript
// app/products/page.tsx
// Server Component by default in App Router

import { db } from '@/lib/db'

const ProductsPage = async () => {
  // Direct database access
  const products = await db.product.findMany({
    where: { active: true },
    include: { category: true }
  })
  
  return (
    <div>
      <h1>Products</h1>
      {products.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}

export default ProductsPage
```

### Server Component Rules

**Can do:**
- Access databases and APIs directly
- Use server-only modules (fs, path, etc.)
- Keep secrets secure (API keys, tokens)
- Reduce client bundle size
- Use async/await at top level

**Cannot do:**
- Use hooks (useState, useEffect, etc.)
- Use browser APIs (window, document)
- Attach event handlers (onClick, etc.)
- Use Context

### Mixing Server and Client Components

```typescript
// Server Component (default)
const Page = async () => {
  const data = await fetchData()
  
  return (
    <div>
      <ServerComponent data={data} />
      {/* Client component for interactivity */}
      <ClientComponent initialData={data} />
    </div>
  )
}

// Client Component
'use client'

import { useState } from 'react'

const ClientComponent = ({ initialData }) => {
  const [count, setCount] = useState(0)
  
  return (
    <button onClick={() => setCount(c => c + 1)}>
      {count}
    </button>
  )
}
```

### Server Component Patterns

#### Data Fetching
```typescript
// app/user/[id]/page.tsx
interface PageProps {
  params: { id: string }
}

const UserPage = async ({ params }: PageProps) => {
  const user = await db.user.findUnique({
    where: { id: params.id }
  })
  
  if (!user) {
    notFound()  // Next.js 404
  }
  
  return <UserProfile user={user} />
}
```

#### Parallel Data Fetching
```typescript
const DashboardPage = async () => {
  // Fetch in parallel
  const [user, orders, stats] = await Promise.all([
    fetchUser(),
    fetchOrders(),
    fetchStats()
  ])
  
  return (
    <>
      <UserHeader user={user} />
      <OrdersList orders={orders} />
      <StatsWidget stats={stats} />
    </>
  )
}
```

#### Streaming with Suspense
```typescript
const Page = () => {
  return (
    <>
      <Header />
      <Suspense fallback={<ProductsSkeleton />}>
        <Products />
      </Suspense>
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews />
      </Suspense>
    </>
  )
}

const Products = async () => {
  const products = await fetchProducts()  // Slow query
  return <ProductsList products={products} />
}
```

## Server Functions (Server Actions)

### What are Server Functions?

Functions that run on the server but can be called from client components:
- Marked with `'use server'` directive
- Can mutate data
- Integrated with forms
- Type-safe with TypeScript

### Creating Server Functions

#### File-level directive
```typescript
// app/actions.ts
'use server'

import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'

export async function createProduct(formData: FormData) {
  const name = formData.get('name') as string
  const price = Number(formData.get('price'))
  
  const product = await db.product.create({
    data: { name, price }
  })
  
  revalidatePath('/products')
  return product
}

export async function deleteProduct(id: string) {
  await db.product.delete({ where: { id } })
  revalidatePath('/products')
}
```

#### Function-level directive
```typescript
// Inside a Server Component
const MyComponent = async () => {
  async function handleSubmit(formData: FormData) {
    'use server'
    const email = formData.get('email') as string
    await saveEmail(email)
  }
  
  return <form action={handleSubmit}>...</form>
}
```

### Using Server Functions

#### With Forms
```typescript
'use client'

import { createProduct } from './actions'

const ProductForm = () => {
  return (
    <form action={createProduct}>
      <input name="name" required />
      <input name="price" type="number" required />
      <button type="submit">Create</button>
    </form>
  )
}
```

#### With useActionState
```typescript
'use client'

import { useActionState } from 'react'
import { createProduct } from './actions'

type FormState = {
  message: string
  success: boolean
} | null

const ProductForm = () => {
  const [state, formAction, isPending] = useActionState<FormState>(
    async (previousState, formData: FormData) => {
      try {
        await createProduct(formData)
        return { message: 'Product created!', success: true }
      } catch (error) {
        return { message: 'Failed to create product', success: false }
      }
    },
    null
  )
  
  return (
    <form action={formAction}>
      <input name="name" required />
      <input name="price" type="number" required />
      <button disabled={isPending}>
        {isPending ? 'Creating...' : 'Create'}
      </button>
      {state?.message && (
        <p className={state.success ? 'text-green-600' : 'text-red-600'}>
          {state.message}
        </p>
      )}
    </form>
  )
}
```

#### Programmatic Invocation
```typescript
'use client'

import { deleteProduct } from './actions'

const DeleteButton = ({ productId }: { productId: string }) => {
  const [isPending, setIsPending] = useState(false)
  
  const handleDelete = async () => {
    setIsPending(true)
    try {
      await deleteProduct(productId)
    } catch (error) {
      console.error(error)
    } finally {
      setIsPending(false)
    }
  }
  
  return (
    <button onClick={handleDelete} disabled={isPending}>
      {isPending ? 'Deleting...' : 'Delete'}
    </button>
  )
}
```

### Server Function Patterns

#### Validation with Zod
```typescript
'use server'

import { z } from 'zod'

const ProductSchema = z.object({
  name: z.string().min(3),
  price: z.number().positive(),
  description: z.string().optional()
})

export async function createProduct(formData: FormData) {
  const rawData = {
    name: formData.get('name'),
    price: Number(formData.get('price')),
    description: formData.get('description')
  }
  
  // Validate
  const result = ProductSchema.safeParse(rawData)
  if (!result.success) {
    return { 
      success: false, 
      errors: result.error.flatten().fieldErrors 
    }
  }
  
  // Create product
  const product = await db.product.create({
    data: result.data
  })
  
  revalidatePath('/products')
  return { success: true, product }
}
```

#### Authentication Check
```typescript
'use server'

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export async function createOrder(formData: FormData) {
  const session = await auth()
  
  if (!session?.user) {
    redirect('/login')
  }
  
  const order = await db.order.create({
    data: {
      userId: session.user.id,
      // ... other fields
    }
  })
  
  return order
}
```

#### Error Handling
```typescript
'use server'

export async function updateProfile(formData: FormData) {
  try {
    const userId = await getCurrentUserId()
    
    const profile = await db.user.update({
      where: { id: userId },
      data: {
        name: formData.get('name') as string,
        bio: formData.get('bio') as string
      }
    })
    
    revalidatePath('/profile')
    return { success: true, profile }
  } catch (error) {
    console.error('Failed to update profile:', error)
    return { 
      success: false, 
      error: 'Failed to update profile. Please try again.' 
    }
  }
}
```

#### Optimistic Updates
```typescript
'use client'

import { useOptimistic } from 'react'
import { likePost } from './actions'

const Post = ({ post }: { post: Post }) => {
  const [optimisticLikes, addOptimisticLike] = useOptimistic(
    post.likes,
    (currentLikes) => currentLikes + 1
  )
  
  const handleLike = async () => {
    addOptimisticLike(null)
    await likePost(post.id)
  }
  
  return (
    <div>
      <p>{post.content}</p>
      <button onClick={handleLike}>
        ❤️ {optimisticLikes}
      </button>
    </div>
  )
}
```

## Data Mutations & Revalidation

### revalidatePath
Invalidate cached data for a path:

```typescript
'use server'

import { revalidatePath } from 'next/cache'

export async function createPost(formData: FormData) {
  await db.post.create({ data: {...} })
  
  // Revalidate the posts page
  revalidatePath('/posts')
  
  // Revalidate with layout
  revalidatePath('/posts', 'layout')
}
```

### revalidateTag
Invalidate cached data by tag:

```typescript
'use server'

import { revalidateTag } from 'next/cache'

export async function updateProduct(id: string, data: ProductData) {
  await db.product.update({ where: { id }, data })
  
  // Revalidate all queries tagged with 'products'
  revalidateTag('products')
}
```

### redirect
Redirect after mutation:

```typescript
'use server'

import { redirect } from 'next/navigation'

export async function createPost(formData: FormData) {
  const post = await db.post.create({ data: {...} })
  
  // Redirect to the new post
  redirect(`/posts/${post.id}`)
}
```

## Caching with Server Components

### cache Function
Deduplicate requests within a render:

```typescript
import { cache } from 'react'

export const getUser = cache(async (id: string) => {
  return await db.user.findUnique({ where: { id } })
})

// Called multiple times but only fetches once per render
const Page = async () => {
  const user1 = await getUser('123')
  const user2 = await getUser('123')  // Uses cached result
  
  return <div>...</div>
}
```

### Next.js fetch Caching
```typescript
// Cached by default
const data = await fetch('https://api.example.com/data')

// Revalidate every 60 seconds
const data = await fetch('https://api.example.com/data', {
  next: { revalidate: 60 }
})

// Never cache
const data = await fetch('https://api.example.com/data', {
  cache: 'no-store'
})

// Tag for revalidation
const data = await fetch('https://api.example.com/data', {
  next: { tags: ['products'] }
})
```

## Best Practices

### 1. Component Placement
- Keep interactive components client-side
- Use server components for data fetching
- Place 'use client' as deep as possible in tree

### 2. Data Fetching
- Fetch in parallel when possible
- Use Suspense for streaming
- Cache expensive operations

### 3. Server Functions
- Validate all inputs
- Check authentication/authorization
- Handle errors gracefully
- Return serializable data only

### 4. Performance
- Minimize client JavaScript
- Use streaming for slow queries
- Implement proper caching
- Optimize database queries

### 5. Security
- Never expose secrets to client
- Validate server function inputs
- Use environment variables
- Implement rate limiting

## Common Patterns

### Layout with Dynamic Data
```typescript
// app/layout.tsx
const RootLayout = async ({ children }: { children: React.ReactNode }) => {
  const user = await getCurrentUser()
  
  return (
    <html>
      <body>
        <Header user={user} />
        {children}
        <Footer />
      </body>
    </html>
  )
}
```

### Loading States
```typescript
// app/products/loading.tsx
export default function Loading() {
  return <ProductsSkeleton />
}

// app/products/page.tsx
const ProductsPage = async () => {
  const products = await fetchProducts()
  return <ProductsList products={products} />
}
```

### Error Boundaries
```typescript
// app/products/error.tsx
'use client'

export default function Error({
  error,
  reset
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

### Search with Server Functions
```typescript
'use client'

import { searchProducts } from './actions'
import { useDeferredValue, useState, useEffect } from 'react'

const SearchPage = () => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const deferredQuery = useDeferredValue(query)
  
  useEffect(() => {
    if (deferredQuery) {
      searchProducts(deferredQuery).then(setResults)
    }
  }, [deferredQuery])
  
  return (
    <>
      <input 
        value={query} 
        onChange={e => setQuery(e.target.value)}
      />
      <ResultsList results={results} />
    </>
  )
}
```

## Troubleshooting

### Common Issues

1. **"Cannot use hooks in Server Component"**
   - Add 'use client' directive
   - Move state logic to client component

2. **"Functions cannot be passed to Client Components"**
   - Use Server Functions instead
   - Pass data, not functions

3. **Hydration mismatches**
   - Ensure server and client render same HTML
   - Use useEffect for browser-only code

4. **Slow initial load**
   - Implement Suspense boundaries
   - Use streaming rendering
   - Optimize database queries

## References

- React Server Components: https://react.dev/reference/rsc/server-components
- Server Functions: https://react.dev/reference/rsc/server-functions
- Next.js App Router: https://nextjs.org/docs/app

