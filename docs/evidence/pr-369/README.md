# Visual evidence — PR #369 (relay load notice, refs #273)

## What these captures are and are not

- **Builds.** A local production build (`npx vite build && npx vite preview`)
  of the PR's functional head **`5ca4678`**. The baseline is the same build of
  `origin/main` at **`5a121aa`**. Commits after `5ca4678` on this branch change
  only documentation (`CLAUDE.md`, this folder), so the captures still apply to
  the PR head.
- **Not the Vercel preview.** The preview deployment sits behind Vercel
  Authentication (an anonymous request gets `302` to `vercel.com/sso-api`), and
  these were taken without anyone's Vercel session.
- **Browser.** Headless Google Chrome 157, with a fresh temporary profile for
  every capture: no extensions, no existing session, no owner account.
- **Account.** A NIP-29 chat does not open without an active account ("No
  active account"). Each profile was seeded with a **read-only** account for a
  throwaway pubkey, whose secret key was discarded on generation. A read-only
  account has no signer (`canAccountSign` → `false`, so `relayAuthManager`
  gets `null`), which means the app could not AUTH or sign.
- **Relays.** Every state except the last row is a **local mock**
  (`src/test/mock-relay.ts`, on localhost). The last row is the only **real
  relay**: the documented welcome chat `groups.0xchat.com'NkeVhXuWHGKKJCpn`,
  opened once at desktop size, read-only.
- **Read-only, measured.** The frames the app sent were recorded through the
  DevTools protocol. Across all 15 captures they were only `REQ` and `CLOSE`,
  with no `AUTH` and no `EVENT`. The mocks recorded 0 authenticated pubkeys and
  0 published events.

Viewports are desktop 1440×900 @1x and mobile 390×844 @2x (touch emulation).
The per-capture metadata (command, viewport, seconds until the state appeared,
frames sent, sockets opened, console errors, visible text) is in
[`scenarios.json`](./scenarios.json).

## States

| State                                                     | Relay                                                 | `main` (before)                                                                                                                                  | This PR                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relay refuses REQ with `auth-required`, no AUTH challenge | mock                                                  | "No messages yet. Start the conversation!" after 25.6s — [desktop](./main-auth-required-desktop.png) · [mobile](./main-auth-required-mobile.png) | "Authentication required…" notice and "Message history is incomplete." after 11.1s — [desktop](./pr-auth-required-desktop.png) · [mobile](./pr-auth-required-mobile.png) |
| Relay accepts REQ, never answers                          | mock                                                  | —                                                                                                                                                | "Timed out waiting for stored messages." after 26s — [desktop](./pr-silent-timeout-desktop.png) · [mobile](./pr-silent-timeout-mobile.png)                               |
| Relay down (nothing listening)                            | mock                                                  | "No messages yet…" — [desktop](./main-relay-down-desktop.png) · [mobile](./main-relay-down-mobile.png)                                           | "Timed out…" notice, `0/1` connected — [desktop](./pr-relay-down-desktop.png) · [mobile](./pr-relay-down-mobile.png)                                                     |
| Healthy relay with 3 messages (no regression)             | mock                                                  | —                                                                                                                                                | messages render, no notice — [desktop](./pr-normal-messages-desktop.png) · [mobile](./pr-normal-messages-mobile.png)                                                     |
| Healthy relay, genuinely empty (no regression)            | mock                                                  | —                                                                                                                                                | "No messages yet…", no notice — [desktop](./pr-normal-empty-desktop.png) · [mobile](./pr-normal-empty-mobile.png)                                                        |
| Documented welcome chat                                   | **real** — `wss://groups.0xchat.com` answers NXDOMAIN | —                                                                                                                                                | "Timed out…" notice, `0/1` connected — [desktop](./live-0xchat-welcome-desktop.png)                                                                                      |

`main-auth-required-*.png` and `pr-normal-empty-*.png` are byte-identical, and
that is the bug #273 describes: before this PR, a relay that refused the read
looked exactly like an empty conversation.

On both builds, about 10s of the time to the auth-required state is spent in
`resolveConversation`, before `loadMessages` runs. It awaits the group's
metadata and member requests in parallel, each bounded at 10s, and both go to
the same refusing relay. This PR does not change that.

Console errors were network-only and the same on both builds: `relay.damus.io`
returned 503 and the down mock refused connections. There were no JavaScript
exceptions.

## Not covered

- A real NIP-29 relay that requires AUTH. That needs a signer, so it was left
  out on purpose. Late authentication is covered by unit tests in
  `src/lib/relay-subscription.test.ts`.
- The Vercel preview, for the reason above.

## Reproduce

From the repository root, with dependencies installed (`npm ci`):

1. Build and serve: `npx vite build && npx vite preview --port 4173 --strictPort`.
2. Start the mocks in `src/test/mock-relay.ts` with the behaviours
   `auth-required`, `silent`, `normal` (with signed kind-9 events tagged
   `["h","group"]`) and `normal` with no events. For a down relay, use a port
   with nothing listening.
3. In a fresh browser profile, before the app loads, seed a read-only account:
   `localStorage["nostr-accounts"] = '[{"id":"<id>","pubkey":"<hex>","type":"readonly"}]'`
   and `localStorage["active-account"] = "<id>"`.
4. Open `http://localhost:4173/run?cmd=` followed by the URL-encoded
   `chat "ws://localhost:<port>'group"`. The quotes are required, because
   `parseGroupArgs` only rejoins `host'group` when the host contains a dot.
5. Wait for the state. Expect up to ~26s for the timeout states (10s metadata
   bound + 15s EOSE backstop).
