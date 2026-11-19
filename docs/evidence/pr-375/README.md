# Visual evidence — PR #375 (compact previews for NIP-34 git events)

## What these captures are and are not

- **Builds.** Local production builds served with `vite preview`. The PR build
  is **`4279bc0`**, the last functional commit on this branch. Later commits
  add only this folder. The baseline is `origin/main` at **`f0c6a7a`**.
- **Not the Vercel preview.** That preview sits behind Vercel Authentication.
- **Browser.** Headless Google Chrome, with a fresh temporary profile for
  every capture: no extensions, no session, no account. The profile is deleted
  after each capture.
- **Window.** `/run?cmd=req -k 1,1617,1618,1619,1621,1630,1631,1632,1633,30617,30618 -l 200 --view compact ws://localhost:<port>`.
- **Relay.** The only relay in the command is a **local mock**. The app's
  default indexer sockets did open (`websocketsOpened` in `scenarios.json`),
  for profile and relay-list lookups, and received only `REQ` and `CLOSE`.
- **Read-only, measured.** Every frame the app sent was recorded through the
  DevTools protocol: `REQ` and `CLOSE` only. The mock counted
  **0 `EVENT` and 0 `AUTH`** frames in every run.
- **No keys.** Nothing was signed and no secret key was generated or loaded.

Viewports are desktop 1440×900 @1x and mobile 390×844 @2x.

## Two data sources

| Source               | What it is                                                                                                                                                                                                                                                                             | What it can show                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Fixtures**         | 23 unsigned events with made-up identities. Pubkeys are hashes of a label, and `sig` is all zeros. Display names were written into the throwaway profile's local IndexedDB cache.                                                                                                        | Every kind, plus missing fields, malformed tags, markup in a subject and long names.                          |
| **Real-data replay** | 134 public events read from `wss://relay.ngit.dev` with two read-only `REQ`s on 2026-11-19, then served unchanged from the local mock. They carry their authors' own signatures. Display names in these captures are those authors' public profiles, fetched by the app as it does for any feed. | Rows whose referenced ticket is in the EventStore, so a status and a PR update show the ticket's title. |

The EventStore verifies signatures, so the unsigned fixtures are listed by the
feed but never enter the store. That makes the fixture captures the
**unresolved** state of every status and PR update: the row is built from the
event's own tags. The replay captures are the **resolved** state.

## States

| State                                            | `main` (before)                                                                                             | This PR                                                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Real git feed, tickets resolved                  | Most rows are icon, author and date — [desktop](./main-real-desktop.png) · [mobile](./main-real-mobile.png) | Repository, verb and ticket title on desktop; verb and title on mobile — [desktop](./pr-real-desktop.png) · [mobile](./pr-real-mobile.png)                                                                                           |
| Fixtures: fallbacks, malformed tags, long names  | Four rows overflow the row at 390px — [desktop](./main-desktop.png) · [mobile](./main-mobile.png)           | No row overflows — [desktop](./pr-desktop.png) · [mobile](./pr-mobile.png)                                                                                                                                                            |
| A row clicked: the event opens beside the feed   | [desktop](./main-opened-desktop.png) · [mobile](./main-opened-mobile.png)                                   | Same behaviour. On mobile the feed is now about 190px wide and each git row keeps one part — [desktop](./pr-opened-desktop.png) · [mobile](./pr-opened-mobile.png)                                                                    |

Rows to look for in the fixture captures:

- **Unresolved status:** "wyrd closed not worth it", "Sakura merged".
- **Unresolved PR update:** "MORP-Box pushed 6ca202c to a pull request".
- **Repository state with no HEAD:** "… 2 refs", and with no refs at all.
- **Missing fields:** "Untitled patch", "Untitled issue", a status that is
  only "opened" because its `e` and `a` tags are malformed.
- **Markup in a subject:** `<img src=x onerror=alert(1)>` shown as text.
- **Neighbouring kinds:** two kind-1 notes, one from the long-named author.

## Layout, measured

`scenarios.json` records a layout check run in the page for every capture:
row heights, whether the document is wider than the viewport, and whether any
part of a row leaves the row or overlaps its neighbour.

| Capture                    | Row heights | Rows overflowing or colliding |
| -------------------------- | ----------- | ----------------------------- |
| `main-mobile.png`          | 28px, all   | 4                             |
| `main-opened-mobile.png`   | 28px, all   | 9                             |
| every `pr-*` capture       | 28px, all   | 0                             |
| every other `main` capture | 28px, all   | 0                             |

The overflow on `main` is the author's display name: it could not shrink, so
on a narrow row it pushed the preview and the timestamp past the right edge.

## Requests, measured

The previews must not add relay traffic. `idLookupsSent` counts `REQ` frames
with an `ids` filter.

| Capture set                 | `main` | This PR |
| --------------------------- | ------ | ------- |
| Fixture feed                | 0      | 0       |
| Real-data feed              | 0      | 0       |
| REQs received by the mock   | 4      | 4       |

After a row is clicked, both builds look up the one opened event. The count
of those frames varied between 8 and 13 from run to run on both builds, with
the same eight sockets open.
