# Napplets (NIP-5D)

Content-addressed, sandboxed mini-applications published to Nostr and run inside
a grimoire window. A manifest names its files; grimoire verifies the signature,
fetches the signed HTML artifact from Blossom (or legacy path-tagged files),
checks the artifact hash (or each file hash and the NIP-5A aggregate),
and only then renders the bytes in a sandboxed iframe that can reach nothing
except what the user grants it.

The runtime is **Kehto** (`@kehto/*`) and **`@napplet/*`** — external packages,
all pre-1.0, against a draft NIP. That fact shapes most of the decisions below.

| Kind    | What                        |
| ------- | --------------------------- |
| `5129`  | Napplet Snapshot            |
| `15129` | Root Napplet Manifest       |
| `35129` | Named Napplet (addressable) |

Two commands: **`app [--debug] <identifier\|archetype> [target]`** runs one and
**`apps`** is the launcher, which is also where remembered grants are reviewed
and revoked — a running napplet's own chrome has the same list behind its
shield, and both render `NappletDecisions` so they cannot drift.

`--debug` opens the host↔napplet traffic drawer. It is for the person *writing*
a napplet, so it is off unless asked for.

Current npm integration: `@kehto/nip` 0.7.0, `@kehto/services` 0.25.1,
`@kehto/shell` 0.24.4, and `@napplet/core` / `@napplet/nap` 0.34.0.
Transitive runtime 0.26.0, ACL 0.19.1 and firewall 0.6.1 share the compatible
Napplet peer range `>=0.32.0 <0.35.0`.

Current manifests use `R` for required domains and independent `z` / `i` tags
for roles and queryless intent contracts, including ordered parameter names.
Legacy `requires` / `archetype` tags remain supported.

## Where it lives

| Concern | File |
| --- | --- |
| **The only place `@kehto/*` / `@napplet/*` values may be imported** | `src/services/kehto.ts` |
| Adapter, bridge, manifest resolution | `src/services/napplet-host.ts` |
| The iframe, and its lifecycle | `src/components/NappletViewer.tsx` |
| Manifest kinds and parsing, off the startup path | `src/lib/napplet-parser.ts` |
| The srcdoc CSP | `src/lib/napplet-csp.ts` |
| Manifest `requires` → ACL capabilities | `src/services/napplet-capabilities.ts` |
| ACL policy and remembered decisions | `src/services/napplet-acl.ts` |
| The remembered-decision list, shared by both surfaces | `src/components/NappletDecisions.tsx` |
| Per-use consent prompts | `src/services/napplet-consent.ts` |
| Per-origin network grants (NAP-RESOURCE) | `src/services/napplet-origins.ts`, `napplet-devices.ts` |
| Archetype dispatch (NAP-INTENT) | `src/services/napplet-intent.ts`, `napplet-intent-defaults.ts` |
| Grimoire's own commands as intent handlers | `src/services/napplet-builtins.ts` |
| `app <archetype>` resolution | `src/services/napplet-archetype.ts` |
| Opening the target and waiting for it | `src/services/napplet-targets.ts`, `napplet-readiness.ts` |
| Which napplet is asking the signer to sign | `src/services/napplet-attribution.ts` |
| The napplets a user has run | `src/services/napplet-library.ts` |
| Host↔napplet traffic log (`app --debug`) | `src/services/napplet-messages.ts` |

`kehto.ts` is a re-export module — no logic, no state, nothing importing back
into `src/services/` — and `no-restricted-imports` in `eslint.config.js` blocks
those packages everywhere else. Type-only imports are exempt: they are erased at
build and a breaking type change fails `tsc` loudly. Before that rule existed
the same claim was a comment in `napplet-host.ts`, and it was false for five
files, one of them written in the same change as the comment.

Required domains are a compatibility declaration, not a launch gate. If a
verified napplet requires domains grimoire does not expose, it still loads with
a warning listing the missing capabilities. The environment stays unchanged;
the napplet is responsible for detecting unsupported features and degrading
gracefully. Verification, sandboxing and user consent still apply.

## Load-bearing decisions

**`inc` is a privilege escalation if you map it naively.** `incMap()` in
`@kehto/acl` resolves `inc.emit` to `relay:write` and the rest of `inc.*` to
`relay:read` — there are no `inc:*` capabilities. A napplet declaring only `inc`
therefore needs the same bits that authorize `relay.publish`. What stops the
escalation is `narrowEnvironment`, which removes `relay` from the napplet's
advertised domains when it was not declared. **Both halves are required. Neither
is sufficient alone.**

**Kehto's ACL store is never the source of truth.** Three of its behaviours are
worked around rather than accepted, and each is load-bearing:

- `createRuntime` hardcodes `createAclState(persistence, 'permissive')` and
  never exposes the policy argument. Seeding the persisted store *before* the
  bridge is built brings the container up restrictive without forking the shell.
- `aclState.persist()` serializes the whole live state, and `runtime.destroy()`
  calls it unconditionally — so a grant made for one operation would land on
  disk and outlive the session, making "Remember my choice" decorative. We keep
  our own record, wipe Kehto's blob every boot, and replay only what was
  actually remembered.
- `adaptHooks` never supplies `firewallPersistence`, so the firewall's
  `persist()`/`load()` are no-ops. We drive the container's setters directly.

**Consent cannot suspend the call it is about.** `aclState.check()` is
synchronous and `onAclCheck` is observe-only, so unlike a relay AUTH challenge
there is nothing to await. The flow is: napplet calls → runtime denies → we
observe → prompt → on allow, grant and **reload the frame**. Coarse, but it
re-runs the verified bytes with the capability actually in place instead of
letting a napplet believe a refused call succeeded. Every
`(dTag, aggregateHash, capability)` is asked at most once per session unless
remembered, so a napplet polling a denied capability cannot spam prompts.

**Grants are keyed per `(dTag, aggregateHash)`.** An update re-asks rather than
inheriting the previous version's reach.

**The CSP travels inside the document.** A `srcdoc` frame has an opaque origin
and no HTTP response, so there is no header to carry a policy. The exact
directive string is asserted in `napplet-csp.test.ts` — treat a diff there as a
security review, not a formatting change.

**Remote media is a capability, not a default.** `remoteMedia` widens
`img-src`/`media-src`/`font-src` to `https:`, and a media load is an outbound
GET — a napplet holding it can signal out with no network grant at all. So it is
a per-version grant the user can revoke, not baseline. Withholding it entirely
would leave every feed and profile napplet with broken images, which is not a
defensible default either.

**NAP-RESOURCE cannot be met in full by a browser.** The policy requires the
private-IP block to run *after DNS resolution and before TCP*, per redirect hop;
a page can neither resolve DNS nor see the peer address. So "fetch any https
URL" is never offered — pretending otherwise would be the same class of lie as
`notify` fabricating delivery. What is offered instead: the user grants specific
origins, nothing wildcarded, gated twice — by the CSP baked into the srcdoc
before any napplet code runs, and again by `napplet-origins` on every
shell-mediated fetch, because the CSP governs the frame's own requests and not
what the host does on its behalf.

**Signing is gated here, not by the runtime.** `ConsentRequest` documents a
`'destructive-signing'` type and its JSDoc claims kinds 0, 3, 5 and 10002 are
gated, but that string does not appear in `@kehto/runtime@0.21.0`'s dist. The
only consent the runtime fires is `'firewall-policy'`; both `relay.publish` and
`relay.publishEncrypted` reach `signEvent` with no prompt at all.

**Attribution is exact, not a heuristic.** `getSigner()` takes no window
context, so the signer cannot know its caller — but the runtime's dispatch is
synchronous: the ACL check, `handleRelayPublish` and `signEvent` all run in one
turn, and both the wrapper and the prompt read the slot before their first
`await`. A synchronous record taken at the ACL check therefore cannot be raced.

## NAP-INTENT

An archetype names a *role* ("show a profile"), not an app; the user owns the
mapping. `napplet-intent.ts` annotates each of the spec's MUSTs at the code that
satisfies it. Two consequences worth knowing:

**Grimoire is itself a handler.** An archetype nothing installed handles falls
back to the built-in command that already fills the role. The mapping produces a
**command string**, not props, so the built-in's own parser stays the only
definition of "how to open a profile" — NIP-05 resolution and relay hints
included.

**Intent acceptance retains delivery work.** `IntentTargetController.accept()`
returns a completion promise immediately; the successful source result means the
host accepted responsibility, not that the target has finished receiving it.
The target controller waits for a live shell session, then sends the protected
`intent.deliver` envelope with the selected convention and runtime-attested sender.
Kehto queues delivery until `intent.onDelivery` or a compatible legacy INC
listener is installed. The old `inc.subscribe` / `<role>:ready` observer is no
longer used to gate intent delivery.

**Catalog identities include publisher and kind.** Routing uses
`nip5d:35129:<pubkey>:<identifier>` (or the root/snapshot equivalent), never a
bare d-tag. The host maps each verified iframe to that ID and supplies it through
`resolveSender`; caller message fields cannot supply the sender. Old bare d-tag
defaults and explicit-target permissions no longer match; users must select them
again rather than inheriting authority across publishers. Only cached verified
manifests enter the catalog; an EventStore replacement is not an installed update.

`app <archetype>` reads only the launcher's cached (already-verified) manifests,
so it touches no relay and cannot be steered by one. Resolution is narrow — the
user's default, or a sole candidate — and anything ambiguous errors with the
candidate list rather than guessing, because a silent wrong pick is
indistinguishable from a right one until the wrong napplet has your data.

## Before you change any of it

The library of run napplets is deliberately **local** (`napplet-library.ts`):
neither NIP-51 nor NIP-5D defines a kind for a napplet list, so publishing one
would be inventing a wire format. Everything goes through that module rather
than touching Dexie, so adopting a specced kind later is a migration, not a
rewrite.

`napplet-parser.ts` inlines the manifest kind numbers rather than importing them
from `@kehto/nip/5d`, so the eager command registry does not drag the
verification runtime and its hash libraries into startup. `napplet-parser.test.ts`
asserts they stay in sync.

The outbound half of the traffic log is reconstructed, not tapped — Kehto posts
to frames from eight places with no hook — so treat inbound as ground truth and
outbound as a best effort.
