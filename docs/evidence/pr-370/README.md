# Visual evidence — PR #370 (auth-required follow-up, refs #273)

## What these captures are and are not

- **Builds.** Local production builds served with `vite preview`. The PR build
  is **`35731ff`**, the only functional commit on this branch. Later commits
  add only this folder. The baseline is `origin/main` at **`87f3a9d`**, which
  is #369 merged.
- **Not the Vercel preview.** That preview sits behind Vercel Authentication.
- **Browser.** Headless Google Chrome, with a fresh temporary profile for
  every capture. The profile has no extensions, no existing session and no
  owner account. It is deleted after each capture.
- **Account.** NIP-29 chat needs an active account. Each profile was seeded
  with a **read-only** account for a random 32-byte pubkey that was never
  derived from any secret key. A read-only account has no signer, so the app
  could neither AUTH nor sign.
- **Relays.** All relays are **local mocks**, listed below. No real relay was
  addressed. The app's default indexer and fallback sockets did open
  (`websocketsOpened` in `scenarios.json`), and they received only `REQ` and
  `CLOSE`.
- **Fixtures.** The 60- and 3-message fixtures are kind-9 events. The
  evidence script signed them with a throwaway key generated in memory and
  discarded on exit, and served them from localhost only. They were never
  sent to any relay.
- **Read-only, measured.** Every frame the app sent was recorded through the
  DevTools protocol. Across all 16 captures the only frame types were `REQ`
  and `CLOSE`. The mocks counted **0 `AUTH` and 0 `EVENT`** frames.

Viewports are desktop 1440×900 @1x and mobile 390×844 @2x. The per-capture
metadata is in [`scenarios.json`](./scenarios.json): URL, viewport, seconds
until the state appeared, frames sent, sockets opened, console errors and
visible text.

## Mock relays

| Mock           | Behaviour                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `noChallenge`  | Answers every REQ with `CLOSED auth-required`. Never sends `AUTH`.                                                  |
| `challenge`    | Sends `["AUTH", <challenge>]` on connect, then answers every REQ with `CLOSED auth-required`.                       |
| `olderRefused` | Serves the newest page of a 60-message group. Answers any REQ carrying `until` (older history) with `CLOSED auth-required`. |
| `normal`       | Serves 3 messages, then EOSE.                                                                                       |

## States

| State                                                    | `main` (before)                                                                                                                                                                                                              | This PR                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refuses the read, no AUTH challenge                      | Raw `ws://…` URL, generic "respond to the prompt if available" text — [desktop](./main-no-challenge-desktop.png) · [mobile](./main-no-challenge-mobile.png)                                                                    | `RelayLink` with an insecure-`ws` shield; "the relay sent no AUTH challenge, so authentication is not possible"; no button — [desktop](./pr-no-challenge-desktop.png) · [mobile](./pr-no-challenge-mobile.png)                                                                                                               |
| Sent a challenge and refuses the read; read-only account | Same generic text as above — [desktop](./main-challenge-readonly-desktop.png) · [mobile](./main-challenge-readonly-mobile.png)                                                                                                | "Authentication required. Sign in with an account that can sign." — [desktop](./pr-challenge-readonly-desktop.png) · [mobile](./pr-challenge-readonly-mobile.png)                                                                                                                                                           |
| "Load older messages" refused with `auth-required`       | About 10s after the click, the button is gone and nothing says why: the empty page read as the start of the group — [desktop](./main-older-refused-after-desktop.png) · [mobile](./main-older-refused-after-mobile.png) | A toast appears at once: "Couldn't load older messages: ws://localhost:…/ requires authentication." — [desktop](./pr-older-refused-toast-desktop.png) · [mobile](./pr-older-refused-toast-mobile.png). 12s later the button is still offered — [desktop](./pr-older-refused-after-desktop.png) · [mobile](./pr-older-refused-after-mobile.png) |
| Healthy relay with 3 messages (no regression)            | —                                                                                                                                                                                                                            | Messages render with no notice — [desktop](./pr-normal-messages-desktop.png) · [mobile](./pr-normal-messages-mobile.png)                                                                                                                                                                                                    |

The `main-older-refused-*` captures are listed with `reached: false` in
`scenarios.json`. That is by design: no text appears on `main` after the
click, so the script waited on a sentinel and then for 12s before capturing.

The healthy-relay rows were re-captured with a 3s settle, using the same
build and the same mock behaviour. At about 1s the header's connection count
reads `0/1` on both `main` and this PR, so that reading is a timing race and
not a regression. That re-capture also sent only `REQ` and `CLOSE`.
`mockRelayCounters` covers the first 16-capture pass only.

Console errors were network-only and the same on both builds. `relay.damus.io`
returned 503, and one resource failed with `ERR_SSL_PROTOCOL_ERROR`. There were
no JavaScript exceptions.

The `olderRefused` mock received the same number of REQs from both builds for
an identical session: 88 per session including the click, with a 12s settle.
The extra REQs are pre-existing per-message lookups that go to the group
relay. They are not a retry loop added by this PR.

## Not covered

- **The "Authenticate" button.** It appears only for an account that can sign
  on a relay that sent a challenge. Capturing it would need a signer, which
  was ruled out. The manager path behind it is covered by unit tests:
  `authenticate()` falls back to the relay's live challenge after a
  dismissal.
- **The GlobalAuthPrompt toast being re-armed.** This also needs a signer.
  It is covered by `packages/relay-auth-manager/src/__tests__/auth-required.test.ts`.
- **Publishing.** Publishing to a relay that refuses with auth-required
  happens in `src/services/publish-service.auth.test.ts`, against
  `src/test/mock-relay.ts`. It covers both the fast failure without a
  challenge and a 3.5s authentication that still succeeds. Publishing was not
  driven in the UI, because posting needs a signer.
- **The Vercel preview**, for the reason above.
