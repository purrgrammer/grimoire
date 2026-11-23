Drive the running app to confirm a change actually works. Use after anything touching relays, dependencies, the React tree, or the service worker — `npm run lint && npm run typecheck && npm run test:run && npm run build` passing does **not** mean the app runs.

## Start the dev server

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill   # free the port first
nohup npm run dev > /tmp/grimoire-dev.log 2>&1 &
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173
```

Vite 8 (rolldown) builds in well under a second, so a slow start means something is wrong. Clear `node_modules/.vite` after any dependency change — a stale optimizer hash breaks dynamic imports.

## Drive it

Use the `claude-in-chrome` skill. Load the tools in one `ToolSearch` call, `tabs_context_mcp` first, then `navigate` to `http://localhost:5173`.

Check these, in this order — each has caught a real bug:

1. **App boots.** A blank frame means a module-init crash. Read `read_console_messages` with `onlyErrors: true`; tracking starts when the tool is first called, so reload after calling it to catch load-time errors.
2. **A feed reaches a settled state.** `req -k 1 --limit 5` via Cmd+K should reach `LIVE` with `n/n` relays and stream events. Stuck on `LOADING` means EOSE handling is broken.
3. **Chat loads messages.** `chat groups.0xchat.com'NkeVhXuWHGKKJCpn`. NIP-29 is the only enabled protocol, and NIP-29 relays commonly require AUTH.
4. **Routes render.** `/`, `/run?cmd=profile%20fiatjaf.com`, `/note1…`, `/npub1…`, `/:actor/:identifier`, and a bad path (should show the 404 page inside `AppShell`, not react-router's dev screen).
5. **A click that opens a window from `/run` reveals it.** `/run?cmd=kind%201`, then click the NIP badge: the dashboard comes back with a new tab holding the `/run` window and the `nip` one, and the previously focused tab untouched (issue #313).
6. **Saved windows of removed commands stay inert.** A persisted or spellbook window whose appId is `ai`, `agent` or `concord` shows the "no longer available" notice and nothing else; `concord`'s "Open chat" opens the chat browser only when clicked.

## Gotchas that have wasted time here

- **Phone mode.** The device selector in the top bar shrinks each window's content area to ~150px, so messages render *outside* the visible scroll region and the window looks empty. Confirm via the DOM (`document.body.innerText`, `[data-index]` node count) before concluding anything is broken. This once looked like a total regression and was not.
- **Your own instrumentation lies.** Creating adapters or subscriptions from the console adds events, moves scroll positions, and has frozen the renderer. When a result looks alarming, re-check in a clean tab with no injected JS.
- **This is the user's real session** — their accounts, workspaces and persisted layouts. Don't answer NIP-42 auth prompts (that's an authentication decision), and close any windows you open.
- **Compare against `main` before blaming the branch.** `git stash` and reload; an identical result means the cause is environmental.

## Relay edge cases

Don't hunt for a misbehaving relay in the wild — use `src/test/mock-relay.ts`, which serves `normal`, `auth-required`, `silent` and `close-after-eose`. It works from the browser too: start it on a port and pass `ws://localhost:<port>'group` as an identifier (`parseIdentifier` keeps an explicit `ws://`). Anything reproducible this way belongs in `src/lib/relay-subscription.test.ts` instead of being re-verified by hand.
