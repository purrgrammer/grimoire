# Visual evidence: removing `agent`, `ai`, Ask Hex and `concord`

## What these captures are

- **Builds.** Local production builds served with `vite preview`, each from a
  clean `npm ci`. The branch build is **`9668f7c`**, the last functional commit
  on this branch; the commit that adds this folder changes nothing else. The
  baseline is `origin/main` at **`6a3ff19`**. Files prefixed `pr-` are the
  branch, and files prefixed `main-` are the baseline.
- **Not the Vercel preview.** That preview sits behind Vercel Authentication.
- **Browser.** Headless Google Chrome driven over the DevTools protocol. Every
  capture used a fresh temporary profile with no extensions, session or
  account, and the profile was deleted afterwards.
- **State.** Each scenario seeds `grimoire_v6` in localStorage before the app
  loads. This is how a returning user's saved windows, or a loaded spellbook,
  arrive. No relay mock was needed, because no scenario depends on relay
  content.
- **Read-only, measured.** Every WebSocket frame the app sent was recorded. The
  app's default indexer sockets did open, and they received only `REQ` and
  `CLOSE`, with **0 `EVENT` and 0 `AUTH`** in every capture
  (`scenarios.json`). No page errors or `console.error` calls were logged.
- **No keys.** Nothing was signed, and no secret key was generated or loaded.
  The profile window uses a pubkey derived as
  `sha256("grimoire-evidence-fixture-profile")`, which belongs to no one.
- **Inference shim.** In `ask-hex-sites` and `run-ai-link`, a stub
  `window.LanguageModel` was installed. On `main`, Ask Hex renders only when
  some inference is reachable, so without the stub the baseline would hide the
  buttons this change removes. Nothing calls the stub.

Viewports are desktop 1440×900 @1x and mobile 390×844 @2x.

## Scenarios

| Scenario | What it shows |
| --- | --- |
| `legacy-windows` | A saved workspace holding `ai`, `agent`, `concord` and a bare `chat` window. On `main` the old apps run. On the branch the first three show the "no longer available" notice and the chat browser is unchanged. |
| `concord-open-chat` | Branch only. A saved `concord` window after its **Open chat** button is pressed: a chat browser opens beside it, and only on that click. |
| `ask-hex-sites` | The kind 1, NIP-01 and profile windows. `main` shows an Ask Hex button in each, and the branch shows none. |
| `palette-a`, `palette-concord` | Cmd+K. Typing `a` lists `agent` on `main` but not on the branch. Typing `concord` gives "No command found" on the branch. |
| `run-ai-link` | `/run?cmd=ai what is a relay?`. `main` opens the ai window. The branch shows "Unknown command: ai" and opens nothing. |
| `run-reveal-initial`, `run-reveal-after-click` | The `/run` reveal flow (#313) still works. From `/run?cmd=kind 1`, clicking the NIP-10 badge opens a new, selected tab 3 that holds `kind` and `nip`. Tabs 1 and 2 are untouched, identically on both builds (`tabs` in `scenarios.json`). |

## Not captured

- **The event menu's Ask Hex item.** Showing it needs an event in a feed, and
  that needs either a signed fixture (a private key) or replaying someone's
  public event. Its removal is covered by the build. No source references
  `askAi` or `HexHoverAvatar`, and the shared component was deleted.
- **Agent run dots under chat messages.** They needed decrypted agent gift
  wraps for an account. The reply-only row that replaces them renders the same
  way for a message with no runs, which was every message without an agent.
