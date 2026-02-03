# Grimoire REQ Assistant Bot

A Nostr bot that listens for mentions in the Grimoire group chat and helps users craft REQ queries for the Nostr protocol.

## Features

- Listens for mentions in NIP-29 group chats
- Uses LLM (Claude) to understand user questions
- Provides REQ command suggestions for querying Nostr relays
- Has tools to look up event kinds and NIPs

## Setup

### Prerequisites

- Node.js 18+
- An Anthropic API key (for Claude)

### Installation

```bash
cd bot
npm install
```

### Configuration

Set environment variables:

```bash
# Required: Anthropic API key
export ANTHROPIC_API_KEY="your-api-key"

# Optional: Override bot settings
export BOT_PRIVATE_KEY="your-hex-private-key"
export RELAY_URL="wss://groups.0xchat.com"
export GROUP_ID="NkeVhXuWHGKKJCpn"
```

### Running

Development mode (with hot reload):

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Usage

In the group chat, mention the bot with a question about REQ queries:

```
@grimoire-bot how do I find all notes from the last 24 hours?
```

The bot will respond with:

```
To find all notes from the last 24 hours:

req -k 1 --since 1d relay.damus.io

This command:
- `-k 1` filters for kind 1 (short text notes)
- `--since 1d` gets events from the last day
- `relay.damus.io` is the relay to query
```

## Available Tools

The bot can look up:

- **Event Kinds**: What each kind number means
- **NIPs**: Nostr Implementation Possibilities specifications
- **Kinds for NIP**: What kinds are defined in a specific NIP

## Architecture

```
bot/
├── src/
│   ├── index.ts       # Main bot entry point
│   ├── llm.ts         # LLM integration with tools
│   └── data/
│       ├── kinds.ts   # Event kind definitions
│       └── nips.ts    # NIP definitions
├── package.json
└── tsconfig.json
```

## Bot Identity

Default bot pubkey: `4f2d3e...` (derived from the configured private key)

The bot signs messages with its own identity and responds as a member of the group.

## Supported REQ Options

The bot can help with all grimoire REQ options:

- `-k, --kind` - Filter by event kind
- `-a, --author` - Filter by author pubkey
- `-l, --limit` - Limit results
- `-i, --id` - Fetch by event ID
- `-e` - Filter by referenced events
- `-p` - Filter by mentioned pubkey
- `-t` - Filter by hashtag
- `--since`, `--until` - Time filters
- `--search` - Full-text search (NIP-50)
- And more...
