# Visual evidence: `/run` opens windows in a tab of their own (follow-up to #371)

## What these captures are and are not

- **Builds.** Local production builds (`vite build && vite preview`).
  - **This branch:** its functional head **`30c52f3`**. Later commits touch
    only this folder.
  - **`main`:** `origin/main` at **`1cd40a0`** (the #371 merge), built from
    `git archive` in a temp directory.
- **Not the Vercel preview.** No Vercel session was used.
- **Browser.** Headless Google Chrome, driven over the DevTools protocol,
  with a fresh temporary profile for every scenario. No extensions, no
  login, no account and no keys. Nothing was signed or published.
- **No network.** Chrome ran with
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`, so no relay or
  other host resolved, only localhost. Every window here renders from
  bundled data (man pages, the kinds list); no relay was needed, so no mock
  relay was used either.
- **Seeded workspace.** Each profile first loaded `/`, then had its
  `grimoire_v6` state seeded with **two tabs**: tab 1, focused, with
  `man req` above `kinds` split 40/60; tab 2 with `nip 01`. The
  `*-seeded-dashboard-*` captures show that state. The `empty` scenario is
  not seeded: a fresh profile with its one empty tab, the case the report
  says already worked.

Viewports are desktop 1440×900 @1x and mobile 390×844 @2x with touch
emulation.

[`scenarios.json`](./scenarios.json) has per-step metadata for each run:
the path, the persisted active workspace number, every workspace's
`windowIds` and layout, the number of mosaic tiles on screen, the TabBar
buttons on screen, and console errors and exceptions.

All 14 runs logged **0 console errors and 0 exceptions**.

## `/run` opened directly, with a focused tab that has windows

The reported bug. Steps, each a real click in the UI:
1. The seeded dashboard (tab 1 focused, two windows; tab 2 behind it).
2. `/run?cmd=man kind` opened directly.
3. Click **nips** under SEE ALSO (a `useAddWindow` opener).
4. Click tab **1**.
5. Reload `/` (metadata only).

| Step | `main` (`1cd40a0`) | This branch (`30c52f3`) |
| --- | --- | --- |
| Seeded dashboard | [desktop](./main-direct-seeded-dashboard-desktop.png) · [mobile](./main-direct-seeded-dashboard-mobile.png) | [desktop](./pr-direct-seeded-dashboard-desktop.png) · [mobile](./pr-direct-seeded-dashboard-mobile.png) |
| `/run` | [desktop](./main-direct-run-initial-desktop.png) · [mobile](./main-direct-run-initial-mobile.png) | same — [desktop](./pr-direct-run-initial-desktop.png) · [mobile](./pr-direct-run-initial-mobile.png) |
| After the click | **Tab 1 now holds 4 windows**, no tab created — [desktop](./main-direct-after-click-desktop.png) · [mobile](./main-direct-after-click-mobile.png) | **A new tab 3, selected, with `man kind` and `nips`** — [desktop](./pr-direct-after-click-desktop.png) · [mobile](./pr-direct-after-click-mobile.png) |
| Tab 1 afterwards | the 4 windows — [desktop](./main-direct-tab-1-after-desktop.png) · [mobile](./main-direct-tab-1-after-mobile.png) | **as seeded: 2 windows, 40/60** — [desktop](./pr-direct-tab-1-after-desktop.png) · [mobile](./pr-direct-tab-1-after-mobile.png) |
| After reload | tab 1, 4 windows | tab 3 active, 2 windows; tabs 1 and 2 unchanged (`4-after-reload` in `scenarios.json`) |

## Pop out a dashboard window, then open from it

1. Tab 1's `man req` window → **More actions → Pop out window**. The URL it
   opens is captured and loaded in the same profile (a new browser tab
   shares `localStorage` the same way).
2. Click **kind**, the first entry under that page's SEE ALSO.
3. Click tab **1**.

| Step | `main` (`1cd40a0`) | This branch (`30c52f3`) |
| --- | --- | --- |
| Pop-out URL | `/run?cmd=man+req&window=seed-man-req` | `/run?cmd=man+req` |
| The popped-out `/run` | [desktop](./main-popout-popout-run-desktop.png) · [mobile](./main-popout-popout-run-mobile.png) | [desktop](./pr-popout-popout-run-desktop.png) · [mobile](./pr-popout-popout-run-mobile.png) |
| After the click | **`kind` added to tab 1** (3 windows) — [desktop](./main-popout-after-click-desktop.png) · [mobile](./main-popout-after-click-mobile.png) | **New tab 3 with `man req` and `kind`** — [desktop](./pr-popout-after-click-desktop.png) · [mobile](./pr-popout-after-click-mobile.png) |
| Tab 1 afterwards | 3 windows — [desktop](./main-popout-tab-1-after-desktop.png) · [mobile](./main-popout-tab-1-after-mobile.png) | **as seeded, original still there** — [desktop](./pr-popout-tab-1-after-desktop.png) · [mobile](./pr-popout-tab-1-after-mobile.png) |

## No regression: a fresh profile with one empty tab

`/run?cmd=man kind` → **nips**. Both builds end on tab 1 with exactly the
two windows; no second tab is created.

| `main` | This branch |
| --- | --- |
| [desktop](./main-empty-after-click-desktop.png) · [mobile](./main-empty-after-click-mobile.png) | [desktop](./pr-empty-after-click-desktop.png) · [mobile](./pr-empty-after-click-mobile.png) |

## Further flows (metadata only, `*-extra-desktop` in `scenarios.json`)

From the seeded state, on this branch:
- **Back, then open again.** After the reveal into tab 3, `history.back()`
  to `/run`, click **kinds**: tab 3 gains the window (3 windows); no tab 4,
  no second `man kind`. On `main` both went into tab 1 (5 windows).
- **Cmd+K on `/run`.** `man open` from the launcher goes to tab 3 as well.
- **Error page.** `/run?cmd=notacommand` has nothing to bring along; Cmd+K
  `man open` opens a new tab 4 with only that window. Tabs 1 to 3 are
  unchanged.
- **Out of scope, unchanged.** The `/<npub>` preview keeps #371's behaviour:
  Cmd+K there adds the preview and the new window to the focused tab (tab 4
  at that point), and creates none.
