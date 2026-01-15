# LLM Chat Interface - Technical Proposal

## Overview

Create a separate LLM chat interface for conversing with AI models, reusing generic scroll/layout patterns from ChatViewer while building LLM-specific features.

## Architecture

```
src/components/
  LLMChatViewer.tsx          # Main LLM chat component (similar to ChatViewer)
  llm/
    MessageItem.tsx           # LLM message renderer (user/assistant/system)
    CodeBlock.tsx             # Syntax-highlighted code with copy button
    StreamingMessage.tsx      # Real-time token streaming display
    ConfigPanel.tsx           # Model/temperature/system prompt settings
    MessageActions.tsx        # Copy, regenerate, edit buttons
  shared/                     # Extracted from ChatViewer
    VirtualizedTimeline.tsx   # Generic Virtuoso wrapper
    DayMarker.tsx             # Date separator component
    ScrollToMessage.ts        # Scroll utilities

src/lib/
  llm/
    anthropic-client.ts       # Claude API client (streaming support)
    message-formatter.ts      # Markdown + code block parsing
    token-counter.ts          # Token usage tracking
  llm-parser.ts               # Command parser for `llm` command

src/types/
  llm.ts                      # LLM-specific types (separate from chat.ts)

src/services/
  llm-history.ts              # Persist conversations to Dexie
```

## Type System

```typescript
// src/types/llm.ts

export interface LLMMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokens?: number;
  model?: string;
  streaming?: boolean; // Currently being streamed
  error?: string;      // Error message if failed
}

export interface LLMConversation {
  id: string;
  title: string; // Auto-generated from first message
  messages: LLMMessage[];
  systemPrompt?: string;
  model: string; // "claude-3-5-sonnet-20241022", etc.
  temperature?: number;
  maxTokens?: number;
  createdAt: number;
  updatedAt: number;
  totalTokens: number; // Running total
}

export interface LLMConfig {
  model: string;
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
}

export interface StreamChunk {
  text: string;
  done: boolean;
  error?: string;
}
```

## Key Components

### 1. LLMChatViewer (Main Component)

Similar structure to ChatViewer, but simplified:

```typescript
interface LLMChatViewerProps {
  conversationId?: string; // Optional, creates new if not provided
  customTitle?: string;
}

function LLMChatViewer({ conversationId, customTitle }: LLMChatViewerProps) {
  const [conversation, setConversation] = useState<LLMConversation>();
  const [streamingMessageId, setStreamingMessageId] = useState<string>();
  const [isStreaming, setIsStreaming] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Load/create conversation
  // Render messages with Virtuoso
  // Handle send (streaming response)
  // Handle regenerate, edit, copy
}
```

**Reuses from ChatViewer:**
- Virtuoso scroll setup (lines 549-580)
- Day marker injection logic (lines 288-312)
- Scroll-to-bottom on new messages
- Message hover effects

**LLM-specific additions:**
- Streaming message updates
- Stop generation button
- Token counter display
- Config panel toggle

### 2. MessageItem (LLM Messages)

```typescript
interface MessageItemProps {
  message: LLMMessage;
  onRegenerate?: () => void;
  onEdit?: () => void;
  onCopy?: () => void;
}

function MessageItem({ message, onRegenerate, onEdit, onCopy }: MessageItemProps) {
  // Different styling for user vs assistant
  // Parse markdown and code blocks
  // Show tokens, timestamp
  // Action buttons (copy, regenerate, edit)
}
```

**Styling approach:**
- User messages: Right-aligned, primary color background
- Assistant messages: Left-aligned, with robot icon
- System messages: Centered, subtle styling
- Streaming: Blinking cursor after last token

### 3. CodeBlock (Syntax Highlighting)

```typescript
interface CodeBlockProps {
  code: string;
  language: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  // Use Prism.js or Shiki for syntax highlighting
  // Copy button in top-right corner
  // Language badge
}
```

Libraries to add:
- `react-syntax-highlighter` or `shiki`
- Use theme matching Grimoire's dark mode

### 4. StreamingMessage (Real-time Display)

```typescript
interface StreamingMessageProps {
  messageId: string;
  initialContent: string;
  onChunk: (chunk: StreamChunk) => void;
  onComplete: () => void;
}

function StreamingMessage({ messageId, initialContent, onChunk, onComplete }: StreamingMessageProps) {
  const [content, setContent] = useState(initialContent);

  useEffect(() => {
    // Subscribe to streaming updates
    // Append chunks as they arrive
    // Parse markdown incrementally
    // Show blinking cursor
  }, [messageId]);
}
```

### 5. ConfigPanel (Settings Sidebar/Modal)

```typescript
interface ConfigPanelProps {
  config: LLMConfig;
  onChange: (config: LLMConfig) => void;
  onClear: () => void;
}

function ConfigPanel({ config, onChange, onClear }: ConfigPanelProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Model selector */}
      <Select value={config.model} onChange={...}>
        <option>claude-3-5-sonnet-20241022</option>
        <option>claude-3-opus-20240229</option>
        <option>claude-3-haiku-20240307</option>
      </Select>

      {/* System prompt */}
      <Textarea
        placeholder="You are a helpful assistant..."
        value={config.systemPrompt}
        onChange={...}
      />

      {/* Temperature slider */}
      <Slider
        label="Temperature"
        min={0}
        max={1}
        step={0.1}
        value={config.temperature}
        onChange={...}
      />

      {/* Max tokens */}
      <Input
        type="number"
        label="Max tokens"
        value={config.maxTokens}
        onChange={...}
      />

      {/* Clear conversation */}
      <Button onClick={onClear} variant="destructive">
        Clear Conversation
      </Button>
    </div>
  );
}
```

## Streaming Implementation

Using Anthropic SDK streaming:

```typescript
// src/lib/llm/anthropic-client.ts

import Anthropic from "@anthropic-ai/sdk";

export async function* streamCompletion(
  messages: LLMMessage[],
  config: LLMConfig,
): AsyncGenerator<StreamChunk> {
  const anthropic = new Anthropic({
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  });

  try {
    const stream = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: config.systemPrompt,
      messages: messages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        yield {
          text: event.delta.text,
          done: false,
        };
      }
    }

    yield { text: "", done: true };
  } catch (error) {
    yield {
      text: "",
      done: true,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

## Command Integration

Add to `src/types/man.ts`:

```typescript
llm: {
  description: "Chat with Claude AI models",
  usage: "llm [conversation-id]",
  examples: [
    "llm",                    // Start new conversation
    "llm abc123",             // Resume conversation by ID
  ],
  appId: "llm-chat",
  argParser: async (args) => {
    if (args.length === 0) {
      // New conversation
      return { conversationId: undefined };
    }
    // Resume existing
    return { conversationId: args[0] };
  },
}
```

## Persistence

Store conversations in Dexie:

```typescript
// src/services/llm-history.ts

import { db } from "./db";

export async function saveConversation(conversation: LLMConversation) {
  await db.llmConversations.put(conversation);
}

export async function loadConversation(id: string): Promise<LLMConversation | undefined> {
  return db.llmConversations.get(id);
}

export async function listConversations(): Promise<LLMConversation[]> {
  return db.llmConversations.orderBy("updatedAt").reverse().toArray();
}

export async function deleteConversation(id: string) {
  await db.llmConversations.delete(id);
}
```

Update `src/services/db.ts`:

```typescript
export const db = new Dexie("grimoire") as Dexie & {
  // ... existing tables
  llmConversations: Dexie.Table<LLMConversation, string>;
};

db.version(8).stores({
  // ... existing stores
  llmConversations: "id, createdAt, updatedAt",
});
```

## Extractable Shared Components

### VirtualizedTimeline

```typescript
// src/components/shared/VirtualizedTimeline.tsx

interface TimelineItem<T> {
  id: string;
  data: T;
  timestamp: number;
}

interface VirtualizedTimelineProps<T> {
  items: TimelineItem<T>[];
  renderItem: (item: T) => React.ReactNode;
  showDayMarkers?: boolean;
  followOutput?: boolean;
}

export function VirtualizedTimeline<T>({ items, renderItem, showDayMarkers, followOutput }: VirtualizedTimelineProps<T>) {
  // Inject day markers if enabled
  // Setup Virtuoso with proper config
  // Return scrollToIndex handle
}
```

This can be used by both ChatViewer and LLMChatViewer.

## Features Comparison

| Feature | ChatViewer (Nostr) | LLMChatViewer |
|---------|-------------------|---------------|
| Virtual scrolling | ✅ | ✅ (reused) |
| Day markers | ✅ | ✅ (reused) |
| Reply threading | ✅ | ❌ (not needed) |
| Streaming | ❌ | ✅ (new) |
| Code highlighting | ❌ | ✅ (new) |
| Message editing | ❌ | ✅ (new) |
| Regenerate | ❌ | ✅ (new) |
| Zaps/reactions | ✅ | ❌ |
| Participants list | ✅ | ❌ |
| Protocol adapter | ✅ (Nostr) | N/A (direct API) |
| Markdown rendering | Nostr-specific | Full markdown |

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Define types in `src/types/llm.ts`
- [ ] Create Anthropic client with streaming
- [ ] Setup Dexie table for conversations
- [ ] Create basic LLMChatViewer layout

### Phase 2: Message Display
- [ ] Implement MessageItem component
- [ ] Add markdown parsing
- [ ] Create CodeBlock with syntax highlighting
- [ ] Setup Virtuoso scrolling (reuse pattern)

### Phase 3: Streaming
- [ ] Implement StreamingMessage component
- [ ] Connect to Anthropic streaming API
- [ ] Add stop generation button
- [ ] Handle errors gracefully

### Phase 4: Actions & Config
- [ ] Add message actions (copy, regenerate, edit)
- [ ] Implement ConfigPanel
- [ ] Add token counter display
- [ ] Save config to localStorage

### Phase 5: Polish
- [ ] Extract VirtualizedTimeline shared component
- [ ] Refactor ChatViewer to use shared component
- [ ] Add keyboard shortcuts (Cmd+Enter to send)
- [ ] Auto-generate conversation titles
- [ ] Add conversation history browser

## Benefits of This Approach

1. **Clean Separation**: LLM chat is architecturally separate from Nostr chat
2. **Reuse Patterns**: Virtual scrolling, day markers, scroll logic are extracted and shared
3. **Purpose-Built**: Each chat system optimized for its use case
4. **No Compromises**: Don't force generic abstractions where they don't fit
5. **Maintainable**: Clear boundaries between Nostr-specific and LLM-specific code

## Open Questions

1. **API Key Storage**: Environment variable? User input? Secure storage?
2. **Conversation Browser**: Separate window or sidebar in LLM chat?
3. **Multi-Model Support**: OpenAI, Gemini, local models?
4. **Export**: Export conversations to markdown/JSON?
5. **Sharing**: Share conversation via URL (like ChatGPT)?

## Estimated Complexity

- **Phase 1-2**: ~2-3 hours (basic display working)
- **Phase 3**: ~2-3 hours (streaming complexity)
- **Phase 4-5**: ~3-4 hours (polish and refinement)
- **Total**: ~8-10 hours for full implementation

## Alternative: Quick Prototype

For testing the concept, could start with a simpler non-streaming version:

1. Basic text input + send button
2. Call Anthropic API (non-streaming)
3. Display messages in simple list (no virtualization yet)
4. No config panel, use hardcoded settings

This could be built in ~1-2 hours to validate the approach before investing in full implementation.
