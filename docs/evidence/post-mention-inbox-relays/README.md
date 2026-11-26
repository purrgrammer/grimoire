# Visual evidence: POST tagged people and inbox relays

- **Source:** production build of `c510adb` served locally (`npm run build`,
  `vite preview` on :4173). The comparison captures (`*-main-*`) are a
  production build of `main` at `af52e59`, served the same way on :4174.
- **Viewports:** desktop 1280×900 and mobile 390×844, device scale 2.
- **Session:** a fresh Chromium profile per viewport, logged in with an
  ephemeral key generated for the run. No real account.
- **Relays: all mocked.** Every `ws://`/`wss://` socket the page opened was
  answered in-process by Playwright `routeWebSocket` (REQ → matching fixtures
  then EOSE; EVENT → OK). No connection left the machine, and every
  non-localhost HTTP request was aborted (relay favicons and NIP-11 lookups
  for the mock relay hosts, plus `raw.githubusercontent.com`). Nothing was
  published to a real relay. `published.json` lists every EVENT the page sent
  and to which mock relay.
- The mock harness itself is not committed (it lives outside the source tree).

## Fixtures

| Who | Kind 10002 | Notes |
| --- | --- | --- |
| Tester (logged in) | write `author-one`, `author-two` | |
| Alice | read `alice-inbox`, `shared-inbox`, `author-one` | |
| Bob | read `shared-inbox`, `ws://bob-plain` | |
| Carol | none | no relay list |
| Dave, Frank | never answered | the mock sends no EVENT and no EOSE for their kind 10002 |
| Erin | read `erin-inbox` | wrote the quoted note; `erin-inbox` refuses EVENTs |

The note mentions Alice, Bob and Carol, quotes Erin's note (nevent with no
author TLV), and quotes a note no relay has (nevent whose author TLV says
Carol).

## Captures (`desktop-*` and `mobile-*`)

| # | State |
| --- | --- |
| 01 | No mentions. Compare with `*-main-01-no-mentions`: same list. On mobile the connection and auth icons are now hidden below `sm` to leave room for the reason line (intended). |
| 02 | Right after pasting: tagged people listed, lookups in flight, quote author being found. |
| 03–04 | Resolved: Alice 3, Bob 2, Erin 1 (author of a quoted note), Carol "no relay list found", missing quote "not found, so its author isn't tagged". Relays: `author-one` stays in Your relays with "also inbox of Alice"; `shared-inbox` is one row for Alice and Bob; `ws://bob-plain` listed unchecked as unencrypted. |
| 05–06 | Dave added: "finding inbox relays…", then "relay list lookup timed out" after the 5 s lookup deadline. |
| 07–08 | `alice-inbox` unticked and Bob untagged: Bob shows "not tagged" with Tag again and the explanation; `ws://bob-plain` is gone; `shared-inbox` stays, now for Alice only. |
| 09–10 | After a page reload: the draft restores the text, the untick and the untag. Lookups restart (memo is per window), so people show "finding…" again. |
| 11 | Publish pressed with Frank's lookup still running: "Finding inboxes…", list locked. |
| 12–13 | Published after the 3 s deadline. The toast reports relay answers, not delivery: one person had an inbox relay accept it (Alice), none accepted it for one (Erin's inbox refused), three had no inbox relay in the publish (Carol no list, Dave timed out, Frank still being looked up), and one quoted note went out without its author tagged. Rows show per-relay results. |

`*-main-02-with-mentions`: the same text on `main`: no tagged people and only
the author's write relays.

## What was sent (`published.json`)

The same note was sent once per viewport, to `author-one`, `author-two`,
`shared-inbox` and `erin-inbox`. Not to `alice-inbox` (unticked) or
`ws://bob-plain` (Bob untagged).

- `p` tags: Alice, Carol, Dave, Frank, Erin. Not Bob (untagged).
- `q` tags: Erin's note carries Erin's pubkey, taken from the signed event.
  The missing note keeps the nevent's TLV pubkey in its `q` tag (applesauce's
  existing behaviour), and that TLV produced no `p` tag.
