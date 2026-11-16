# Visual evidence: reveal windows opened from `/run` (#313)

## What these captures are and are not

- **Builds.** Local production builds (`vite build && vite preview`). The
  branch is at its functional head **`fce8512`**, rebased onto `origin/main`
  with #370. The baseline is **`origin/main` at `d9ecde6`**, built from
  `git archive` in a temp directory. Later commits on this branch add a unit test (`c284ce7`) and this folder; neither changes app code.
- **Not the Vercel preview.** No Vercel session was used.
- **Browser.** Headless Google Chrome, driven over the DevTools protocol, with
  a fresh temporary profile for every scenario. No extensions, no login, no
  account and no keys. Nothing was signed or published.
- **No network.** Chrome ran with
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`, so no relay or
  other host resolved, only the local preview server.
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

All 14 runs logged **0 console errors and 0 exceptions**.

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

- **Ask Hex, AI command chips and `grimoire.window`.** They go through the
  same `useGrimoire().addWindow` / `useAddWindow` path the captured clicks
  use. Driving them needs an inference provider.
- **Clicked `nostr:` references and `UserName` / `RelayLink` in a `/run` or
  preview window.** Same path again. Rendering their content needs relays, and
  these captures had none.
- **Napplet intents (`openBuiltinWindow`).** Covered by unit tests only.
- **`/note1…`, `/nevent1…` and `/naddr1…` previews.** None was captured:
  without relays they only show a loading state.
  - They use the same `useRevealOnOpen` hook as `/npub1…`.
  - Their window builders are unit-tested in
    `src/lib/standalone-window.test.ts`.
  - The hook itself is tested on `/run` only.
