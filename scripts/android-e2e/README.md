# Android end-to-end runs, isolated

How the Android build was driven on an emulator for PR #384, and how to do it
again. Nothing here touches a public relay, a public Blossom server or a real
identity:

- the emulator's network is switched off; only the fixture ports are
  reachable, through `adb reverse`;
- the NIP-46 bunker key is generated per run in the fixture process and
  never written down;
- the NIP-55 signer (Amber, offline build) gets a throwaway account created
  inside the emulator, which `-read-only` discards on shutdown;
- every frame the app sends is in the audit log, so "no EVENT or AUTH went
  anywhere else" is checked, not assumed.

## Files

| File | What |
| --- | --- |
| `fixtures.mjs` | relay (`ws://localhost:7777`), NIP-46 bunker, Blossom (`http://localhost:7778`, BUD-01/02/06, verifies upload auth, injectable failures), audit log |
| `cdp.mjs` | `eval '<js>'` in the app's WebView; `netlog <file> <s>` records every request/WebSocket URL (debug builds only) |
| `ui.sh` | `dump` / `tap "<text>"` on native screens (signer, system pickers) via uiautomator |
| `tap-css.sh` | a real tap on a WebView element (file inputs need user activation) |

## Run

```bash
# 1. E2E build: discovery/fallback relays point at the fixture relay
VITE_E2E_RELAY=ws://localhost:7777 npm run build
node scripts/android/build.mjs debug --skip-web       # JDK 21 + ANDROID_HOME

# 2. Emulator, read-only, then cut its network
$ANDROID_HOME/emulator/emulator -avd <api-36-avd> -read-only -no-snapshot-save &
adb wait-for-device
adb shell svc wifi disable && adb shell svc data disable
adb shell ping -c1 -W2 8.8.8.8        # expect: Network is unreachable

# 3. Fixtures, reachable only through adb reverse
node scripts/android-e2e/fixtures.mjs --audit /tmp/audit.jsonl &   # prints bunker://…
adb reverse tcp:7777 tcp:7777 && adb reverse tcp:7778 tcp:7778

# 4. Apps and test files
adb install -r android-dist/grimoire-*-debug.apk
adb install -r amber-offline-arm64-v8a-v6.6.9.apk   # GitHub release, sha256 in its manifest
adb push e2e-purple.png /sdcard/Download/

# 5. Drive it
node scripts/android-e2e/cdp.mjs eval 'location.href'
scripts/android-e2e/ui.sh dump
curl -X POST localhost:7778/__control -d '{"failNextUploads":1}'   # next upload → 500
curl localhost:7778/__audit                                         # what the app sent
```

Never use a debug build with a real identity: Capacitor logs plugin
arguments to logcat in debug builds, a `nostrconnect://` secret included.
Release builds log nothing (`loggingBehavior: "debug"`).

The results of the PR #384 run are in `docs/android-zapstore.md`
("Verification").
