# Visual evidence: the `/run` window is registered in the commit that shows it

Follow-up to #372. The QA run on `main` at `dee3006`
([run 44398997389](https://github.com/purrgrammer/grimoire/actions/runs/44398997389/job/135136559112))
failed one test of `RunCommandPage.reveal.test.tsx`; the same tree had passed
on its branch, and locally the file failed 2 of 25 runs. The cause is a race
between the commit that renders the `/run` window and the passive effect that
registered it; `useStandaloneWindow` now registers in a layout effect. User
visible behaviour in steady state is unchanged, so these captures are the
no-regression set for the flows the hook serves.

## What these captures are and are not

- **Build.** A local production build of this branch's functional head
  **`39c1e71`** (`vite build && vite preview`), the commit that changes
  `src/core/state.ts`. The evidence commit on top of it touches only this
  folder. **Not the Vercel preview.**
- **Baseline on `main`.** The same flows, same seed and same viewports were
  captured for #372 in [`../pr-371-followup/`](../pr-371-followup/) (its
  `pr-*` set, branch `30c52f3`, which is `main` `8519163` minus nothing that
  these flows touch; `main` since then only added `@vercel/analytics`). The
  per-step metadata here matches that set workspace for workspace.
- **Browser.** Headless Google Chrome 157, driven over the DevTools protocol
  with a fresh browser context per run. No extensions, no login, no account,
  no keys. Nothing was signed or published.
- **No network.** Chrome ran with
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`. Every window
  renders from bundled data (man pages, the kinds list), so no relay and no
  mock relay were needed.
- **Seeded workspace.** Each context first loaded `/`, then had its
  `grimoire_v6` state seeded with two tabs: tab 1, focused, with `man req`
  above `kinds` split 40/60; tab 2 with `nip 01`. The `empty` scenario is not
  seeded: a fresh context with its one empty tab.
- **Clicks** are `Input.dispatchMouseEvent` at the element's centre, after
  scrolling it into view.

Viewports: desktop 1440×900 @1x and mobile 390×844 @2x with touch
emulation.

[`scenarios.json`](./scenarios.json) has per-step metadata for each run: the
path, the persisted active workspace number, every workspace's `windowIds`
and layout, the number of mosaic tiles on screen, the TabBar buttons on
screen, and console error and exception counts.

**Exceptions: 0 in all 7 runs.** Console errors: the seeded runs log one
`[ErrorHandler] uncaught_error` per full page load, every one of them
`SyntaxError: Unexpected token '<'` from `/_vercel/insights/script.js`, the
`@vercel/analytics` loader added in #373 that `vite preview` answers with
`index.html`. It is unrelated to this change and absent from the `empty`
runs, which load the page once.

## `/run` opened directly, with a focused tab that has windows

1. The seeded dashboard (tab 1 focused, two windows; tab 2 behind it).
2. `/run?cmd=man kind` opened directly.
3. Click **nips** under SEE ALSO (a `useAddWindow` opener).
4. Click tab **1**.
5. Reload `/` (metadata only).

| Step | Desktop | Mobile |
| --- | --- | --- |
| Seeded dashboard | [png](./pr-direct-seeded-dashboard-desktop.png) | [png](./pr-direct-seeded-dashboard-mobile.png) |
| `/run` | [png](./pr-direct-run-initial-desktop.png) | [png](./pr-direct-run-initial-mobile.png) |
| After the click: **new tab 3, selected, with `man kind` and `nips`** | [png](./pr-direct-after-click-desktop.png) | [png](./pr-direct-after-click-mobile.png) |
| Tab 1 afterwards: **as seeded, 2 windows, 40/60** | [png](./pr-direct-tab-1-after-desktop.png) | [png](./pr-direct-tab-1-after-mobile.png) |
| After reload | tab 1 active (last clicked), tabs 1 to 3 unchanged (`4-after-reload`) | same |

## Pop out a dashboard window, then open from it

1. Tab 1's `man req` window → **More actions → Pop out window**. The URL it
   opens (`/run?cmd=man+req`) is captured and loaded in the same context.
2. Click **kind**, the first entry under that page's SEE ALSO.
3. Click tab **1**.

| Step | Desktop | Mobile |
| --- | --- | --- |
| The popped-out `/run` | [png](./pr-popout-popout-run-desktop.png) | [png](./pr-popout-popout-run-mobile.png) |
| After the click: **new tab 3 with `man req` and `kind`** | [png](./pr-popout-after-click-desktop.png) | [png](./pr-popout-after-click-mobile.png) |
| Tab 1 afterwards: **as seeded, original still there** | [png](./pr-popout-tab-1-after-desktop.png) | [png](./pr-popout-tab-1-after-mobile.png) |

## No regression: a fresh context with one empty tab

`/run?cmd=man kind` → **nips**. Ends on tab 1 with exactly the two windows;
no second tab is created.

| Step | Desktop | Mobile |
| --- | --- | --- |
| `/run` | [png](./pr-empty-run-initial-desktop.png) | [png](./pr-empty-run-initial-mobile.png) |
| After the click | [png](./pr-empty-after-click-desktop.png) | [png](./pr-empty-after-click-mobile.png) |

## Further flows (desktop, `pr-extra-desktop` in `scenarios.json`)

- **Back, then open again.** After the reveal into tab 3, `history.back()`
  to `/run`, click **kinds**: tab 3 gains the window (3 windows); no tab 4,
  no second `man kind`. [png](./pr-extra-back-again-desktop.png)
- **The `/<npub>` preview** (the hook's other placement) still renders its
  single window outside the workspace, with no network a loading skeleton,
  and touches no workspace. [png](./pr-extra-npub-preview-desktop.png)

## The race itself

It cannot be reproduced by hand on purpose, so it is pinned in
`src/hooks/useRevealOnOpen.test.tsx` ("reveals the run window when the click
lands before its passive effects ran"): a render that outlasts one scheduler
slice, and the click from a `MutationObserver` callback. On the previous code
it fails every run with the CI signature (`expected '/run' to be '/'`); after
the change it passes, and `RunCommandPage.reveal.test.tsx` passed 40 of 40
runs (before: 2 failures in 25).
