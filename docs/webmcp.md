# WebMCP (tools for the browser's own agent)

[WebMCP](https://webmachinelearning.github.io/webmcp/) lets a page declare its
tools with `document.modelContext.registerTool()`, so whatever agent the
browser carries calls them instead of driving the UI by pixels. Chrome 149 and
Edge 150 ship it behind an origin trial; Brave's Leo and ChatGPT Desktop
implement it; Firefox and Safari have positions only.

grimoire has no model of its own and holds no key. It only answers: the loop
belongs to the browser's agent.

## The pieces

| File | What it owns |
| --- | --- |
| `src/lib/ai-registry.ts` | The tool registry: ids, titles, schemas, annotations |
| `src/lib/ai-tools.ts` | What those tools do |
| `src/lib/ai-commands.ts` | Which grimoire commands an agent may read up on, open or offer |
| `src/lib/ai-window-tool.ts` | `grimoire.window`'s executor, which needs application state |
| `src/lib/ai-filter.ts` | An agent's arguments as a NIP-01 filter, aliases resolved |
| `src/lib/resolve-entity.ts` | A bech32 entity as the thing it names |
| `src/services/webmcp.ts` | Registration with `document.modelContext` |
| `src/hooks/useModelContextTools.ts` | Mounts registration at the shell |

`useModelContextTools()` mounts at the shell (`AppShell`) — the tools belong to
the document, so an agent asking what grimoire can do gets the same answer
whichever window is open.

## The tools

Every capability lives in one registry (`TOOL_REGISTRY`), named
`<namespace>.<action>`: `grimoire.*` acts on the application, `nostr.*` on the
network. The id is the registered name — WebMCP allows `[A-Za-z0-9_.-]{1,128}`,
so dots need no mangling — and an agent that has learned a name is pinned to
it, so renaming one is a breaking change.

- **`grimoire.help`** — a NIP's text, a kind's definition, or a command's manual
  page, from grimoire's own registry and cache. The command name is an enum of
  `READABLE_COMMANDS`; `post`, `zap` and `wallet` are absent.
- **`grimoire.spells`** — the user's saved spells, as alias plus the `req` each
  one runs. Local rows only; nothing here saves, publishes or deletes.
- **`grimoire.command`** — commands handed to the user to run, validated against
  the command registry. Nothing runs.
- **`grimoire.window`** — runs a read-only grimoire command, opening its window.
  The only tool needing application state, so its executor is injected by the
  shell. `post`, `zap` and `wallet` are refused and must be offered instead.
- **`nostr.req`** — a full NIP-01 filter (`ids`, `authors`, `kinds`, `since`,
  `until`, `search`, single-letter tags via a `tags` object), `$me` and
  `$contacts` expanded page-side, with a 500-event bound. Each event carries the
  `npub` and `nevent` to quote: handed only hex, a model invents bech32 with a
  bad checksum.
- **`nostr.resolve`** — a bech32 entity as the thing it names: the kind 0 for a
  person, the event for a note/nevent/naddr, EventStore first and relays second.

No tool signs, publishes, spends or follows. Tool arguments are shaped by
whatever the agent read — including note text, which is untrusted — so the only
side effect available is a window the user then drives themselves.

**Relay selection is not the agent's.** grimoire routes reads itself — NIP-65
inbox/outbox, hints on the pointer, liveness and backoff — so `nostr.req`'s
`relays` field description says to leave it out unless the user named one.

## Rules that are not obvious

- **The description is the whole contract.** A WebMCP agent sees `description`,
  the parameter descriptions and the annotations — nothing else. Anything a
  caller must know belongs in the description; anything that must not happen
  belongs in the executor, which is where the refusals are.
- **Annotations are part of the contract.** `readOnlyHint` is false only for
  `grimoire.window`; `untrustedContentHint` is true for `nostr.req` and
  `nostr.resolve`.
- **A result must be JSON-serializable and a failure must not throw.** The user
  agent serializes whatever the executor resolves with, and a rejection reaches
  the agent as a bare failure with no reason — so the wrapper round-trips the
  result and turns a throw into `{ error }`.
- **Registration is serialized.** Registering a name twice rejects with
  `InvalidStateError`, so a remount whose teardown has not landed treats a
  duplicate as already registered.

**Chrome and Edge need an origin-trial token.** WebMCP is not shipped: the API
exists only for an origin that carries a token, delivered as the `Origin-Trial`
response header in `vercel.json`. `grimoire.rocks`'s token is registered for
that origin alone and **expires 2026-11-17** — after that, or on any other
origin, `document.modelContext` is simply absent and the adapter no-ops.
Registration is at
<https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241>.
Localhost is not covered; to drive the WebMCP path locally, shim
`document.modelContext` in `index.html` before `main.tsx` loads.

**`Origin-Agent-Cluster: ?1` is required.** `registerTool()` rejects with
`SecurityError` unless the document is in an origin-keyed agent cluster, and
that is a response header with no `<meta>` equivalent. It is set in
`vite.config.ts` (dev and preview) and `vercel.json` (the deployed origin). A
static host that will not send it serves a grimoire whose tools no agent can
see; everything else works. The console warns per refused tool.

## Testing

`src/services/webmcp.test.ts` stubs `document.modelContext`;
`src/lib/ai-tools.test.ts` drives each executor against mocked relays and
Dexie; `src/lib/ai-registry.test.ts` checks the registry's contract.
