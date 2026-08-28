# Inference (the `ai` window)

grimoire asks a model without ever holding a key. Inference comes from the
[Inference Provider API](https://github.com/SamSamskies/inference-provider-api)
— `window.inference`, injected by an extension the user installs and grants per
origin — or, when no extension is present, from Chrome's own on-device model.
The page never sees a key, never names a provider, and never chooses a model.

## The pieces

| File | What it owns |
| --- | --- |
| `src/services/inference.ts` | Lookup, error helpers, `resolveRequest()`, `probeInference()` |
| `src/services/inference-backends.ts` | The two backends, their capabilities, and the preference |
| `src/services/prompt-api.ts` | Chrome's Prompt API as an `ipa-tools` fallback backend |
| `src/services/tool-loop.ts` | The page-side multi-round tool loop |
| `src/lib/ai-registry.ts` | The tool registry: ids, schemas, prompt lines, name mapping |
| `src/lib/ai-tools.ts` | What those tools do |
| `src/lib/ai-draft.ts` | A drafted event, checked before it can be signed |
| `src/actions/publish-draft.ts` | Signing and publishing a draft — from a button, never a tool |
| `src/lib/ai-filter.ts` | A model's arguments as a NIP-01 filter, aliases resolved |
| `src/lib/ai-context.ts` | The system prompt, and the references a question carries |
| `src/lib/nip-refs.ts` | `NIP-01` in a reply, as a link |
| `src/components/AiViewer.tsx` | The window: turns, streaming, persistence |
| `src/types/inference.ts` | `ipa-tools` types, aliased, plus the experimental namespace |

Types and error helpers come from `ipa-tools`; nothing here re-implements the
spec. `parseToolArguments` is the one exception, and says why inline.

## Rules that are not obvious

**Match on `code`, never `instanceof`.** An injector reconstructs an error
across isolated worlds, so the prototype is gone by the time the page sees it.
`isInferenceError` checks for a spec `code` string.

**`window.inference` is non-configurable.** A page cannot replace it, so runtime
mocking is impossible: tests inject below the module boundary
(`src/test/mock-inference.ts`) or stub the global before import.

**Tool calling rides `window.inference.experimental` today.** Inference Bridge
reports `getFeatures().toolCalling === false` and offers tools on its own
namespace anyway. `resolveRequest()` prefers the spec surface, falls back to the
experimental one only to gain tools, and reports which is in use as
`ToolSupport`. The spec asks applications not to depend on injector namespaces —
so if that surface changes, tool calling stops and the fenced-command path takes
over. Nothing else breaks.

**A backend is not a provider.** Two backends exist: an extension injecting
`window.inference`, and the browser's own model. Which company answers and with
which weights is the extension's choice — that is what IPA is for — so the
selector says "Extension" and "On-device" and never a model name. What the page
may decide is whether the question leaves the machine at all, which is why the
preference exists: on-device is private and free, and before this it was
unreachable for anyone who had an extension installed.

**"Prefer on-device" cannot go through the client.** `createInference` is IPA-first
by construction and `normalizeFallbacks` rejects `"ipa"` as an entry, so with an
extension present the client answers through it every time. Forcing on-device
therefore drives the Prompt API backend directly (`onDeviceInference`), and every
other path still goes through the client so a late injection wins. A preference
whose backend is absent is not an error: `resolveRequest` falls back and reports
`substituted`, which the window states in a line.

**Capabilities are derived, never cached.** An extension can appear after the
window opened, and `getFeatures()` is the only truth about tools. `images` is
false for both backends and is the flag an attachment button waits on: the IPA
draft lists images as out of scope and its `content` is a string.

**IPA is decided in `resolveRequest()`, not by the client.** `ipa-tools`'
`createInference({ fallbacks })` re-checks the injector around every probe and
create, which is why a late injection still wins — but it only knows `request`.
Routing an injected provider through it would silently drop tool calling. So:
injector first, decided here; no injector, the client.

**`done.model` is the extension's choice.** Show it, never pick it. The
on-device fallback reports `chrome/on-device`, because Chrome does not name its
model and neither should we.

**The on-device model downloads on first use**, which needs a user gesture. That
is why `ai "prompt"` prefills instead of auto-sending when there is no injector,
and why progress is surfaced as a bar (`ModelDownload`) — a silent
multi-hundred-megabyte wait is the hang class this repo keeps shipping. Chrome
reports progress as a 0..1 fraction in current builds and as bytes loaded in
older ones, with no total either way: a fraction gets a real bar, bytes get a
moving one, because a byte count with no denominator cannot honestly be drawn as
a percentage.

**Chrome has shipped `promptStreaming` chunks both ways** — deltas and
whole-answer-so-far — with nothing in the API to distinguish them. The adapter
diffs each chunk against what it already emitted, so both render once.

## The tool loop

IPA relays tool calls; it is explicitly not an agent runtime, so the loop is
ours (`runToolLoop`). Four rounds maximum. Per round it reports `ToolRun`
snapshots and stamps each run with its round, so the UI can show the reasoning
that led to a call above it and the reasoning that followed below.

- `onDelta` and `onReasoningDelta` emit **snapshots, not deltas**. The loop drops
  the preamble a tool-calling round emits, so a caller that appended deltas
  itself would render text the settled turn does not contain.
- Reasoning is kept **per round**. A `done` chunk carries the whole round's
  reasoning, so assigning it erases what earlier rounds thought — which is
  exactly the part that explains a tool call.
- A failing tool becomes an `output-error` run **and** an error result fed back
  to the model. A turn does not die because one relay did.

## The tools

Every capability lives in one registry (`TOOL_REGISTRY`), named
`<namespace>.<action>`: `grimoire.*` acts on the application, `nostr.*` on the
network. The wire schema, the executor table, the system prompt's tool paragraph
and the transcript's renderers are all derived from it, so a tool's name exists
once.

Two surfaces read that registry, and each entry's `surfaces` says which of them
gets it: **IPA**, where grimoire owns the loop and the conversation, and
**WebMCP**, where the browser's own agent calls into the page. See *The browser's
agent (WebMCP)* below.

**A dot is not portable.** OpenAI-shaped function names are
`^[a-zA-Z0-9_-]{1,64}$`, and IPA relays to whichever provider the user's
extension holds a key for — so the namespace travels as an underscore
(`nostr_req`) and the canonical id keeps its dot (`nostr.req`). `wireName()` and
`canonicalId()` are the only two functions that know this. `canonicalId()` also
maps the pre-registry names, because conversations persist and a stored
transcript still says `query_nostr`.

The surface stays small on purpose: IPA's permission UI lists every function name
and re-prompts whenever the set widens.

- **`grimoire.help`** — a NIP's text, a kind's definition, or a command's manual
  page, from grimoire's own registry and cache. The command name is an enum of
  the commands Hex may also propose; `post`, `zap` and `wallet` are absent from
  both.
- **`grimoire.spells`** — the user's saved spells, as alias plus the `req` each
  one runs, so Hex can open one or run its filter rather than guessing what a
  spell does. Local rows only; nothing here saves, publishes or deletes.
- **`grimoire.command`** — commands handed to the user to run, validated by the
  same check as a ```grimoire fence, which still works and is the whole story on
  a provider with no tools. In Hex's reply they render as buttons; anywhere else
  they are the lines to quote. Nothing runs until the user runs it.
- **`grimoire.window`** — runs a read-only grimoire command. The only tool
  needing application state, so its executor is injected — by the viewer for
  IPA, by the shell for WebMCP. `post`, `zap` and
  `wallet` are refused and must be offered instead.
- **`nostr.req`** — a full NIP-01 filter (`ids`, `authors`, `kinds`, `since`,
  `until`, `search`, single-letter tags via a `tags` object), `$me` and
  `$contacts` expanded page-side. How many events to read is the model's call —
  five to skim, more to summarise a thread — with a 500 bound that exists so the
  pane and the context window survive the answer, not as a policy. The transcript
  draws the first 40 and says how many more it read. Each event carries the `npub`
  and `nevent` to quote: handed only hex, a model invents bech32 with a bad
  checksum, and an undecodable reference renders as dead text.
- **`nostr.resolve`** (`src/lib/resolve-entity.ts`) — a bech32 entity as the
  thing it names: the kind 0 for a person, the event for a note/nevent/naddr,
  EventStore first and relays second. Without it a model that meets an entity in
  a tag or a question can only repeat it, since bech32 is not readable by
  inspection.
- **`nostr.draft`** (IPA only) — drafts an event and stops. Named for what it
  does: `publish` was the one thing it never did, and the name is what a model
  reads before the description. `canonicalId()` still maps the old
  `nostr.publish` and `nostr_publish`, because transcripts persist. The card in
  the transcript carries the button, and the signer is asked from that click; `publishDraft()`
  is not reachable from the loop. `sanitizeDraft` refuses the kinds one click
  must not be able to rewrite — 0, 3, anything replaceable or addressable — plus
  what spends or must be encrypted. The kind is checked again in the action,
  because that is the function that signs. The card shows the body as it will
  render (not the kind renderer, whose header carries a timestamp and a menu an
  unsigned event has no business showing) over the post composer's relay list,
  with connection and auth state and a per-relay result: a publish that half works
  is the normal case.

No tool signs, publishes, spends or follows. Tool arguments are shaped by
whatever the model read — including note text, which is untrusted — so the only
side effects available are a window the user drives themselves and a draft they
press a button to sign.

## The browser's agent (WebMCP)

[WebMCP](https://webmachinelearning.github.io/webmcp/) is the same idea from the
other side: the page declares its tools with `document.modelContext
.registerTool()`, and whatever agent the browser carries calls them instead of
driving the UI by pixels. Chrome 149 and Edge 150 ship it behind an origin
trial; Brave's Leo and ChatGPT Desktop implement it; Firefox and Safari have
positions only.

`src/services/webmcp.ts` registers the same registry entries, and
`useModelContextTools()` mounts it **at the shell** — the tools belong to the
document, so an agent asking what grimoire can do gets the same answer with no
`ai` window open. `grimoire.window`'s executor is shared with the viewer
(`createWindowExecutor`), because both surfaces must refuse the same commands.

- **One tool is not exposed.** `nostr.draft` answers with a card that carries a
  signing button, and outside Hex's transcript there is nothing for the user to
  press — the consent step the tool exists for would be missing. Exposing it
  needs the draft card to open as a window of its own first. Everything else,
  `grimoire.command` included, is reachable: its return is a validated command
  list, which an agent can present in whatever UI it has.
- **`prompt` never reaches a WebMCP agent.** It sees `description`, the parameter
  descriptions and the annotations — nothing else. Anything a caller must know
  belongs in the description; anything that must not happen belongs in the
  executor, which is where the refusals already are.
- **The names keep their dots.** WebMCP allows `[A-Za-z0-9_.-]{1,128}`, so
  `nostr.req` registers as itself and no `wireName()` mangling is needed on this
  side.
- **Annotations are part of the contract.** `readOnlyHint` is false only for
  `grimoire.window` and `nostr.draft`; `untrustedContentHint` is true for
  `nostr.req` and `nostr.resolve`, which is the first time that long-standing
  property of Nostr reads is something a caller can act on.
- **A result must be JSON-serializable and a failure must not throw.** The user
  agent serializes whatever the executor resolves with, and a rejection reaches
  the agent as a bare failure with no reason — so the wrapper round-trips the
  result and turns a throw into `{ error }`.

**`Origin-Agent-Cluster: ?1` is required.** `registerTool()` rejects with
`SecurityError` unless the document is in an origin-keyed agent cluster, and that
is a response header with no `<meta>` equivalent — a page cannot opt in from
script. It is set in `vite.config.ts` (dev and preview) and `vercel.json` (the
deployed origin). A static host that will not send it — an nsite gateway, for
instance — serves a grimoire whose tools no agent can see; everything else works,
which is what makes it easy to miss. The console warns per refused tool.

## Grounding

The point of asking a model inside a Nostr explorer is that the object is already
resident: in the EventStore, in the kind registry, in the cached NIP text. No
retrieval layer, no embeddings — name the thing and its own data goes in the
prompt (`buildAiContext`). `buildMentionContext` does the same for up to three
`nostr:` references in a question.

`ai` takes an event, a profile, a kind or a NIP as its subject, and every one of
those has an entry point in the UI (the event menu, the profile header, the kind
and NIP windows) through `AskHexButton`.

**A conversation is read before it is written.** Turns come from a live query, so
a window opened by id renders — and autofocuses its composer — before that query
resolves. A first message sent in that gap used the empty list as its base and
saved two turns over the whole history. The sender now re-reads the row, and
`reconcileTurns` refuses to let a shorter list that does not begin where the
stored one begins replace it. `/run` pages key their conversation off the command
rather than a constant `"pop-out"`, which made two unrelated chats one row.

**A turn keeps what it named.** A transcript is `nostr:` URIs and the EventStore
is memory, so a conversation reopened tomorrow would render a person as a stub and
an attached note as a dead reference. `buildMentionContext` returns the events it
resolved along with the prose; both the question and the reply keep theirs
(`Turn.mentions`), and loading a conversation — or listing the index, whose titles
render mentions too — puts them back in the store. The reply matters as much as
the question: Hex answers by quoting npubs and nevents, which is exactly what
would otherwise stop rendering.

**Relay selection is not the model's.** grimoire routes reads and writes itself —
NIP-65 inbox/outbox, hints on the pointer, liveness and backoff — so the prompt
says so in three places a model reads: the base rules, `nostr.req`'s prompt line,
and the `relays` field description. A guessed relay URL is a query that answers
nothing.

**A reply is markdown, an event is not.** Model text renders through
`MessageResponse` (Streamdown), so it never passes through applesauce's content
pipeline: `nostr:` references and `NIP-01` are re-linked by hand in `AiViewer`
(`withLinks`, `LinkedText`, `NipText`) at `text-sm`, matching every event body
around it. `nip-refs.ts` deliberately mirrors `nip-transformer`'s pattern so a NIP
in a note and a NIP in a reply open the same window.

The composer is `RichEditor`, the same editor the chat and post windows use: `@`
completes to a profile and a pasted entity becomes a preview. What it serializes
is `nostr:` URIs, which is exactly what `buildMentionContext` resolves and what
the reply renderer links — so a mention is a mention all the way through.

## Testing

`src/test/mock-inference.ts` and `src/test/mock-prompt-api.ts` serve the
behaviours that break a client: a stream that ends without `done`, an error
reconstructed as a plain object, an abort mid-stream, a provider that repeats its
reasoning in `done`, a cumulative chunk stream, a model that is downloadable
rather than ready. Anything reproducible through them belongs in a test rather
than in a live request — a live request costs the user money.

What tests cannot cover: whether an injector is installed, and whether Chrome's
real stream behaves as documented. Drive the app for those.
