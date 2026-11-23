# Visual evidence — welcome screen: spells/spellbooks suggestion

## What these captures are and are not

- **Builds.** Local production builds (`vite build`) served with `vite preview`.
  The PR build is **`51a1fa5`**, the last functional commit on this branch
  (later commits add only this folder; the captured `dist/` was checked
  byte-identical to a rebuild of that commit). The baseline is `origin/main`
  at **`db52bc9`**.
- **Not the Vercel preview.** That preview sits behind Vercel Authentication.
- **Browser.** Headless Google Chrome, a fresh temporary profile per capture
  (no extensions, no session, no account), deleted afterwards. Viewport set
  through the DevTools protocol (`Emulation.setDeviceMetricsOverride`):
  desktop 1440×900 @1x, mobile 390×844 @2x with mobile emulation.
- **No interaction.** Nothing was clicked: the suggestion's query was **not**
  run against any relay and its NIP-05 was not resolved. The click → command
  wiring is covered by `src/components/GrimoireWelcome.test.tsx` instead.
- **No keys.** No account, nothing signed, nothing published.
- **Relays.** Loading the welcome screen opens the app's default
  indexer/fallback sockets and sends its usual lookup `REQ`s, identically on
  `main` and on this branch (recorded via the DevTools protocol). This is
  pre-existing behaviour, unrelated to the suggestion list. No mock relay was
  needed: the change has no relay-dependent state.

## States

| State                     | `main` (before)                                                | This PR                                                    |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| Welcome, desktop 1440×900 | `chat …` welcome-chat entry — [desktop](./main-desktop.png)    | `req -k 777,30777 -a verbiricha@grimoire.rocks` — [desktop](./pr-desktop.png) |
| Welcome, mobile 390×844   | Cards 352px wide, 18px gutter — [mobile](./main-mobile.png)    | Cards 356px wide, 16px gutter; command wraps — [mobile](./pr-mobile.png)      |

Measured layout (CSS px, from the page itself):

| Build | Viewport | Card width | Card right edge | Page scroll width |
| ----- | -------- | ---------- | --------------- | ----------------- |
| main  | 1440     | 446        | 944             | 1440              |
| PR    | 1440     | 446        | 944             | 1440              |
| main  | 390      | 352        | 372             | 390               |
| PR    | 390      | 356        | 374             | 390               |

Without the `px-4` gutter (`72ab47c` alone) the longer command stretched the
cards to 388px, ending 0px from the right edge at 390px; `51a1fa5` fixes it.
