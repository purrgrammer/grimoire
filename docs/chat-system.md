# Chat System

**Status**: only NIP-29 (relay-based groups) is enabled. Other protocol adapters
are implemented but commented out.

## Architecture

A protocol adapter pattern:

- `src/lib/chat/adapters/base-adapter.ts` — interface all adapters implement
- `src/lib/chat/adapters/nip-29-adapter.ts` — NIP-29 relay groups (enabled)
- NIP-10, NIP-22, NIP-53 adapters exist but are not registered

## Key components

- `src/components/ChatViewer.tsx` — protocol-agnostic chat interface
- `src/components/chat/ReplyPreview.tsx` — reply context with scroll-to
- `src/lib/chat-parser.ts` — auto-detects protocol from identifier format
- `src/types/chat.ts` — protocol-agnostic types (`Conversation`, `Message`, …)

## NIP-29 identifier format

`relay'group-id` (the `wss://` prefix is optional):

```bash
chat relay.example.com'bitcoin-dev
chat wss://nos.lol'welcome
```

Groups live on a single relay that enforces membership and moderation.
Messages are kind 9, metadata kind 39000, admins kind 39001, members kind 39002.

## Adding a protocol

1. Extend `ChatProtocolAdapter` in `src/lib/chat/adapters/`
2. Implement `parseIdentifier`, `resolveConversation`, `loadMessages`, `sendMessage`
3. Register the adapter in `src/lib/chat-parser.ts` and `src/components/ChatViewer.tsx`
4. Update the command docs in `src/types/man.ts`
