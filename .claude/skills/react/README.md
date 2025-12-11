# React 19 Skill

A comprehensive Claude skill for working with React 19, including hooks, components, server components, and modern React architecture.

## Contents

### Main Skill File
- **SKILL.md** - Main skill document with React 19 fundamentals, hooks, components, and best practices

### References
- **hooks-quick-reference.md** - Quick reference for all React hooks with examples
- **server-components.md** - Complete guide to React Server Components and Server Functions
- **performance.md** - Performance optimization strategies and techniques

### Examples
- **practical-patterns.tsx** - Real-world React patterns and solutions

## What This Skill Covers

### Core Topics
- React 19 features and improvements
- All built-in hooks (useState, useEffect, useTransition, useOptimistic, etc.)
- Component patterns and composition
- Server Components and Server Functions
- React Compiler and automatic optimization
- Performance optimization techniques
- Form handling and validation
- Error boundaries and error handling
- Context and global state management
- Code splitting and lazy loading

### Best Practices
- Component design principles
- State management strategies
- Performance optimization
- Error handling patterns
- TypeScript integration
- Testing considerations
- Accessibility guidelines

## When to Use This Skill

Use this skill when:
- Building React 19 applications
- Working with React hooks
- Implementing server components
- Optimizing React performance
- Troubleshooting React-specific issues
- Understanding concurrent features
- Working with forms and user input
- Implementing complex UI patterns

## Quick Start Examples

### Basic Component
```typescript
interface ButtonProps {
  label: string
  onClick: () => void
}

const Button = ({ label, onClick }: ButtonProps) => {
  return <button onClick={onClick}>{label}</button>
}
```

### Using Hooks
```typescript
const Counter = () => {
  const [count, setCount] = useState(0)
  
  useEffect(() => {
    console.log(`Count is: ${count}`)
  }, [count])
  
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Count: {count}
    </button>
  )
}
```

### Server Component
```typescript
const Page = async () => {
  const data = await fetchData()
  return <div>{data}</div>
}
```

### Server Function
```typescript
'use server'

export async function createUser(formData: FormData) {
  const name = formData.get('name')
  return await db.user.create({ data: { name } })
}
```

## Related Skills

- **typescript** - TypeScript patterns for React
- **ndk** - Nostr integration with React
- **skill-creator** - Creating reusable component libraries

## Resources

- [React Documentation](https://react.dev)
- [React API Reference](https://react.dev/reference/react)
- [React Hooks Reference](https://react.dev/reference/react/hooks)
- [React Server Components](https://react.dev/reference/rsc)
- [React Compiler](https://react.dev/reference/react-compiler)

## Version

This skill is based on React 19.2 and includes the latest features and APIs.

