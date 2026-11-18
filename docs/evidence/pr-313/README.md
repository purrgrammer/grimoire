# Visual evidence: reveal windows opened from `/run` (#313)

## What these captures are and are not

- **Builds.** Local production builds (`vite build && vite preview`).
  - **This branch:** its functional head **`a5343c3`**, which includes the
    pop-out fix. The build was made from that commit's app code; later edits
    touched only a test's timeout and this folder.
  - **`main`:** `origin/main` at **`d9ecde6`**, built from `git archive` in a
    temp directory.
  - **Before the pop-out fix:** the `popout-*-before-*` captures come from the
    previous PR head, **`51084d1`**.
- **Not the Vercel preview.** No Vercel session was used.
- **Browser.** Headless Google Chrome, driven over the DevTools protocol, with
  a fresh temporary profile for every scenario. No extensions, no login, no
  account and no keys. Nothing was signed or published.
- **No network.** Chrome ran with
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`, so no relay or
  other host resolved, only localhost.
  - The pop-out captures read from a **local fixture relay** at
    `ws://localhost:4390`. It serves two kind-1 notes signed by a throwaway
    in-memory key. It answers `EVENT` and `AUTH` with a refusal, and none
    were sent.
  - Ask Hex shows only when inference is reachable, so a stub
    `globalThis.LanguageModel` that answers `"unavailable"` stood in for one.
    Opening the window sends nothing.
  - The man pages and the kinds list render from bundled data.
  - The npub preview shows its loading skeleton, because no relay is
    reachable. That is expected here.
- **Seeded workspace.** Each profile first loaded `/`, then had its
  `grimoire_v6` state seeded with two windows: `man req` above `kinds`, split
  40/60. The `seeded-dashboard-*` captures show that state, so you can check
  afterwards that it was preserved.

Viewports are desktop 1440×900 @1x and mobile 390×844 @2x with touch
emulation.

[`scenarios.json`](./scenarios.json) has per-step metadata for each run:
- path and `history.length`;
- the persisted active workspace's `windowIds` and layout;
- the number of mosaic tiles on screen;
- console errors and exceptions.

The runs from earlier scenarios logged **0 console errors and 0 exceptions**.

## Pop out a dashboard window, then Ask Hex / Chat from its event menu

This regression was found in review of this PR. Every step is a real click
or key press in the UI:
1. A fresh profile opens `req -k 1 ws://localhost:4390` with Cmd+K.
2. That window's **More actions → Pop out window**.
3. The URL it opens, in the same profile. The new tab shares `localStorage`.
4. The first note's **⋯** menu → **Ask Hex** or **Chat**.

| Step | Before the fix (`51084d1`) | After (`a5343c3`) |
| --- | --- | --- |
| Dashboard with the one window | [desktop](./popout-ask-hex-dashboard-original-desktop.png) · [mobile](./popout-ask-hex-dashboard-original-mobile.png) | same flow, one window |
| The popped-out `/run` | same view; only the relative times differ ("6m ago") | [desktop](./popout-run-desktop.png) · [mobile](./popout-run-mobile.png) |
| Ask Hex | **3 tiles**: the original `req`, a `pop-out:req …` copy of it, and `ASK KIND 1` — [desktop](./popout-ask-hex-before-desktop.png) · [mobile](./popout-ask-hex-before-mobile.png) | **2 tiles**: the original and `ASK KIND 1` — [desktop](./popout-ask-hex-after-desktop.png) · [mobile](./popout-ask-hex-after-mobile.png) |
| Chat | **3 tiles**, with the same copy — [desktop](./popout-chat-before-desktop.png) · [mobile](./popout-chat-before-mobile.png) | **2 tiles**: the original and the NIP-10 chat — [desktop](./popout-chat-after-desktop.png) · [mobile](./popout-chat-after-mobile.png) |

**Cause.** Each click made one state write and one `pushState`, and added one
requested window, so no handler ran twice. The copy came from identity: the
`/run` window's id is derived from the command (`pop-out:<cmd>`), so the
reveal could not tell it was the dashboard window seen in another tab.

**Fix.** The pop-out URL now carries `&window=<id>`. While that window is
still in the active workspace, the reveal adds only the requested window.
`scenarios.json` (`popout-*`) records the ids before and after.

## `/run?cmd=man kind`, then click **nips** under SEE ALSO

The link is a ManPage `ExecutableCommand`, so the click goes through
`useAddWindow`.

| Step | `main` (before) | This branch |
| --- | --- | --- |
| Persisted dashboard (seeded) | same state | 2 tiles — [desktop](./seeded-dashboard-desktop.png) · [mobile](./seeded-dashboard-mobile.png) |
| `/run` on first load | byte-identical capture | single window, workspace untouched — [desktop](./run-initial-desktop.png) · [mobile](./run-initial-mobile.png) |
| The link about to be clicked (outlined) | same | [desktop](./run-before-click-desktop.png) · [mobile](./run-before-click-mobile.png) |
| After the click | still `/run`, still one window. `man nips` went into the hidden workspace. — [desktop](./main-after-click-desktop.png) · [mobile](./main-after-click-mobile.png) | `/` with 4 tiles: `man req`, `kinds`, the original `man kind` (id `pop-out:man kind`) and `man nips` — [desktop](./pr-after-click-desktop.png) · [mobile](./pr-after-click-mobile.png) |
| `main` only: open `/` by hand | 3 tiles. `man nips` is there, and the `/run` command is lost. — [desktop](./main-dashboard-after-click-desktop.png) · [mobile](./main-dashboard-after-click-mobile.png) | n/a |

The two seeded windows keep their records and stay in the layout. Smart
insertion splits them exactly as a dashboard `addWindow` would.
`history.length` goes 3 → 4 on the transition, so Back returns to the `/run`
view.

## `/npub1…` preview, then Cmd+K → `man profile`

| Step | `main` (before) | This branch |
| --- | --- | --- |
| Preview on load | visually identical: the same skeleton. Bytes differ only by the skeleton's pulse frame. | [desktop](./npub-initial-desktop.png) · [mobile](./npub-initial-mobile.png) |
| After Cmd+K → Enter | `/` with 3 tiles. The previewed profile is dropped. — [desktop](./main-npub-after-launcher-desktop.png) · [mobile](./main-npub-after-launcher-mobile.png) | `/` with 4 tiles, including the profile (`pop-out:profile npub1…`) — [desktop](./pr-npub-after-launcher-desktop.png) · [mobile](./pr-npub-after-launcher-mobile.png) |

## `/run?cmd=man kind`, then Cmd+K → `man open`

| `main` (before) | This branch |
| --- | --- |
| `/` with 3 tiles. The `/run` window is dropped. — [desktop](./main-run-launcher-desktop.png) · [mobile](./main-run-launcher-mobile.png) | `/` with 4 tiles, the `/run` window included — [desktop](./pr-run-launcher-desktop.png) · [mobile](./pr-run-launcher-mobile.png) |

`history.length` goes 3 → 4 on both builds. CommandLauncher no longer
navigates by itself on these routes; the reveal does it. If both navigated,
`/` would be pushed twice.

## Checked, recorded in `scenarios.json` only (`pr-extra-*`)

- **Back to `/run` after the reveal, then a second click** (`kinds`). The
  workspace goes from 4 to 5 windows: `pop-out:man kind` is not added again.
- **`/run?cmd=notacommand` (error page), then Cmd+K.** The dashboard shows the
  new window. The route had nothing on screen to bring along.

## Not covered

- **AI command chips and `grimoire.window`.** Same `useAddWindow` /
  `useGrimoire().addWindow` path as the captured clicks. Driving them needs a
  working inference provider. Ask Hex itself is captured above, from the
  event menu.
- **Clicked `nostr:` references and `UserName` / `RelayLink` in a `/run` or
  preview window.** Same path again. None of them was clicked here.
- **Napplet intents (`openBuiltinWindow`).** Covered by unit tests only.
- **`/note1…`, `/nevent1…` and `/naddr1…` previews.** None was captured:
  without relays they only show a loading state.
  - They use the same `useRevealOnOpen` hook as `/npub1…`.
  - Their window builders are unit-tested in
    `src/lib/standalone-window.test.ts`.
  - The hook itself is tested on `/run` only.
- **The `ai` conversation from the popped-out tab is not carried over.** In
  the pop-out case the reveal shows the original window. A conversation typed
  in the popped-out tab is keyed by `pop-out:<cmd>`, so it does not appear on
  the dashboard. That split already existed for pop-outs on `main`.
- **Pop-out URLs opened before this change** have no `window=` parameter.
  They still add the `/run` window as their own window, because nothing
  identifies their source.
