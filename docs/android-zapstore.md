# Android build and Zapstore distribution

**Status:** the Android app builds, is tested on an emulator, and its CI is in
place. **Nothing has been released or published.** The first release needs a
signing key, a Nostr publisher key and a NIP-C1 proof. Only the owner can
create those (see [Owner setup](#owner-setup-and-release-gates)).

**Decided by the owner (2026-11-27):**

- wrapper: Capacitor, with the web build bundled into the APK;
- package id: `rocks.grimoire.app`. This is **permanent**.

Facts below name their source and commit so they can be checked again.

## How it fits together

```
dist/ (npm run build) ──cap sync──▶ android/app/src/main/assets/public
                                     │  loaded from https://localhost
src/lib/native/   ◀── one adapter; the web build never runs its native paths
  platform.ts   isNativeApp, publicOrigin/publicUrl, classifyNavigation
  shell.ts      Back, deep links, link/window.open routing, system bars
  links.ts      openExternal (scheme allowlist, "no app can open this")
  files.ts      saveBlob (web: <a download>; app: system save-as picker)
  nip55-signer  NIP-55 signer apps (Amber…) over capacitor-plugin-nostr-signer
android/app/src/main/java/rocks/grimoire/app/
  GrimoireNativePlugin   navigation backstop, openExternal, saveDocument (SAF)
  NavigationPolicy       the same allowlist, unit-tested with JUnit
```

| Concern | Web (unchanged) | Android app |
| --- | --- | --- |
| Origin | the serving origin | `https://localhost`. Shareable links and NIP-46 metadata use `https://grimoire.rocks` (`publicUrl`) |
| Service worker | registered (production) | **not registered**: the build ships inside the APK, and a worker would pin an old shell across updates |
| Vercel analytics | on | off |
| Login | NIP-07 extension, read-only, nsec, NIP-46 | **NIP-55 signer app** replaces the extension tab, with a note on why NIP-07 can't exist there; NIP-46 gets "Open signer app" |
| Links | `window.open` / anchors | in-app routes stay in the app; `https`, `http`, `mailto`, `lightning`, `bitcoin` and `nostrconnect` go to other apps; everything else is refused, both in JS and natively |
| Downloads | `<a download>` | system save-as picker (Storage Access Framework), no permission needed |
| Uploads | `<input type=file>` | the same input; Capacitor opens the system picker, no permission needed |
| Back | browser | 1. close an overlay, 2. route history, 3. a deep-linked route goes to `/`, 4. minimize. Windows are never closed by Back: they tile, and closing one loses its state |
| Deep links | n/a | `nostr:` (NIP-21, decoded and refused unless it is npub/nprofile/note/nevent/naddr) and `https://grimoire.rocks/*` (unverified until `assetlinks.json` is deployed) |
| Relays | `ws://` allowed | cleartext only to `localhost`/`127.0.0.1`, e.g. an on-device relay like Citrine |
| Backup | n/a | `allowBackup=false` plus data-extraction rules: WebView storage holds accounts and nsec keys |

**Permissions:** `INTERNET` only. App info on the emulator reads "No
permissions requested".

## Release contract

| | |
| --- | --- |
| Artifact | one universal APK (no native libraries, no ABI splits), minSdk 24, target/compile 36 |
| versionCode | number of commits reachable from HEAD (`scripts/android/version.mjs`). It only grows on `main` (merges, never force-pushes) and is reproducible from source. Shallow clones are refused |
| versionName | `<package.json version>+<versionCode>`, unique per release, which matters because Zapstore keys a release on it |
| Signing | only from `ANDROID_KEYSTORE_{PATH,PASSWORD}` and `ANDROID_KEY_{ALIAS,PASSWORD}`. Without them a release build is **unsigned**, never debug-signed. `--require-signing` fails without them. v2+v3 signatures, no v1 |
| Cert continuity | `verify-apk.sh <apk> <pinned sha256>` refuses any other certificate. Android itself refuses an update signed by another key (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, verified) |
| Downgrade | refused by Android (`INSTALL_FAILED_VERSION_DOWNGRADE`, verified) and by Zapstore's relay |
| Reproducible | two clean unsigned builds of the same commit produced the same SHA-256 (`425acfb1…`) on the build machine. Not yet compared across machines |

Toolchain: Node from `.nvmrc`, JDK 21 (Temurin), Go 1.27.4 for zsp v2.0.1
(its go.mod requires ≥ 1.27.3; CI pins it with `GOTOOLCHAIN=local`), Android SDK platform 36 and
build-tools 36.0.0, Gradle 8.14.3 (wrapper jar matches the published
checksum; the distribution is pinned by SHA-256), AGP 8.13.0, Capacitor 8.6.3.

```bash
npm run android:build:debug          # debug APK (debug key), android-dist/
npm run android:build:release        # unsigned release APK
npm run android:test                 # JUnit + Android lint
npm run android:verify -- <apk> [cert-sha256]
npm run android:icons                # regenerate icons from public/logo.svg
```

## CI

| Workflow | Trigger | Secrets | Does |
| --- | --- | --- | --- |
| `qa.yml` (existing) | PR, push to main | none | lint, typecheck, tests, web build |
| `android.yml` | PR, push to main | none (fork-safe) | clean install, web build, cap sync, wrapper validation, JUnit, Android lint, debug and **unsigned** release APKs (asserts unsigned), `verify-apk.sh`, `zsp check` of `zapstore.yaml` plus the APK (read-only), debug APK as a 7-day artifact |
| `release-android.yml` | push to main, manual | `android-release` environment | **every job skipped unless `vars.ANDROID_RELEASE_ENABLED == 'true'`**. Signs, verifies against the pinned cert, keeps the APK as an artifact; optionally publishes to Zapstore and optionally creates a GitHub Release |

Why releases don't simply happen "on every push": signing and publishing are
irreversible and identity-bearing.

- Pull requests and forks never run the release workflow, so they can never
  reach a secret.
- Merging the workflow does nothing until the owner sets the variable.
- Publishing on push is a separate switch (`ZAPSTORE_PUBLISH_ON_PUSH`).

Inside the release job, the signing secrets are in the environment while
`cap sync` and Gradle run, so a compromised build dependency could read them.
That is the residual risk. It is bounded by the lockfile, `npm ci` with no
cache, wrapper validation, the protected environment and the cert pin.

Once all three are configured, every push to `main` can produce a signed,
verified build and a Zapstore release.

- **Idempotent:** zsp first reports the published versionCode. A rerun of
  the same commit is skipped, and so is a duplicate.
- **Failures are explicit:** a missing secret is named; an unauthorized
  signer stops with the NIP-C1 step to take.

GitHub Releases and Zapstore are separate:

- zsp uploads the APK to Zapstore's Blossom server and publishes kinds
  32267, 30063 and 3063. It needs no GitHub Release.
- A public GitHub Release (`android-<versionCode>`) is optional
  (`ANDROID_GITHUB_RELEASE`), for people who sideload from GitHub.

## Owner setup and release gates

**APK signing key vs Nostr publisher key.** These are two unrelated keys.

- The **APK key** (Android keystore) proves who built the APK. It becomes the
  app's identity on every phone and on Zapstore; lose it and the listing is
  gone.
- The **Nostr key** signs the Zapstore events.

A NIP-C1 proof (kind 30509) links the two. Only the interactive `zsp` wizard
creates it, and it is the only step that reads the keystore.

In order:

1. **Release keystore.** Generate it offline on a machine you control. Back
   it up in two places. Never commit it or paste it anywhere.

   ```bash
   keytool -genkeypair -keystore grimoire-release.p12 -storetype PKCS12 \
     -alias grimoire -keyalg RSA -keysize 4096 -validity 10000
   keytool -list -v -keystore grimoire-release.p12 | grep SHA256   # → ANDROID_CERT_SHA256
   ```

2. **GitHub environment `android-release`.** Settings → Environments. Add:
   - required reviewers (you);
   - deployment branches: `main` only.

   Do this **before** step 4: GitHub creates a missing environment
   unprotected the first time a job uses it.

3. **Secrets in that environment** (names only; values never leave you):

   | Name | Kind | Value |
   | --- | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | secret | `base64 < grimoire-release.p12` |
   | `ANDROID_KEYSTORE_PASSWORD` | secret | store password |
   | `ANDROID_KEY_ALIAS` | secret | `grimoire` |
   | `ANDROID_KEY_PASSWORD` | secret | key password |
   | `ZAPSTORE_SIGN_WITH` | secret | the **delegate** key (below), `nsec1…` or a `bunker://` URL |
   | `ANDROID_CERT_SHA256` | variable | the certificate's SHA-256 from step 1 (public) |

4. **Repository variables:**
   - `ANDROID_RELEASE_ENABLED=true` turns the signed build on;
   - `ZAPSTORE_PUBLISH_ON_PUSH=true` publishes every push to `main`; leave
     it unset to publish only from a manual run with `publish: true`;
   - `ANDROID_GITHUB_RELEASE=true` (optional) creates GitHub Releases.

5. **First publication, locally, once.**
   - Build a signed APK: `npm run android:build:release` with
     `ANDROID_KEYSTORE_*` set.
   - Run `zsp check` on it.
   - Run the `zsp` wizard. It signs the NIP-C1 proof with your publisher
     npub and can name a **delegate** key for CI.
   - Put that delegate in `ZAPSTORE_SIGN_WITH`. Your own key never goes
     into CI.

   A `bunker://` signer that needs you to tap "approve" cannot publish
   unattended; CI would wait and fail. For unattended publishing, use a
   delegate `nsec` or a bunker set to auto-approve that client.

   Zapstore admits a new publisher key through a whitelist, a previous
   listing or a web-of-trust check (`relay/pkg/policy/gate.go`).

6. **Optional:** deploy `/.well-known/assetlinks.json` on grimoire.rocks
   (not in `public/` until the cert exists). It verifies
   `https://grimoire.rocks` links so they open in the app:

   ```json
   [{"relation":["delegate_permission/common.handle_all_urls"],
     "target":{"namespace":"android_app","package_name":"rocks.grimoire.app",
               "sha256_cert_fingerprints":["<ANDROID_CERT_SHA256 as AA:BB:…>"]}}]
   ```

## Verification (emulator, PR #384)

**Setup.** Android 16 (API 36) arm64 `google_apis` emulator, started
`-read-only`, WebView 133.0.6943.137.

- **Network off:** wifi and data disabled, "Network is unreachable", DNS
  fails. Only the fixture ports were reachable, through `adb reverse`.
- **Signers:** the NIP-46 bunker used a per-run key; Amber
  `amber-offline-arm64-v8a-v6.6.9.apk` (SHA-256 `c2e39534…71d4`, matches
  its release manifest; cert `e8ab8c69…3bbf`) got a throwaway account
  created inside the emulator.
- **Builds:** the E2E debug build (`VITE_E2E_RELAY`, versionCode 970), then
  a production debug build of `e7b8262` (versionCode 973, SHA-256
  `ea2d83cc…1a42`) for the final smoke run.
- **Runbook:** `scripts/android-e2e/README.md`.

**Network audit (all runs).** The local relay accepted 2 kind 1, 9 kind
24133 and **0 AUTH**, all with valid signatures. The WebView *tried* to read
from `wss://nos.lol` (relay hints outside the E2E seam) and from
`https://fiatjaf.com` (a NIP-05 lookup a test triggered). Neither connected:
there was no route.

| Area | Result |
| --- | --- |
| Launcher icon, adaptive icon, app info | **Pass.** Grimoire icon in the app drawer; app info shows "No permissions requested" |
| Cold start | **Pass.** 595 ms to first frame on first launch, 420 ms offline, 564 ms for the final build; dark launch window, no white flash. The Android 12 splash icon was not caught by screenshots |
| Status bar, navigation bar, safe areas | **Pass.** Dark bars with light icons; content clears both bars; landscape reflows (863×360 CSS px) |
| Keyboard | **Pass.** `adjustResize`: the viewport shrinks (527 px) and the palette and Run stay above the keyboard |
| NIP-55 login (Amber) | **Pass.** Signer listed through package visibility. Cancel → "Amber closed without answering…", no account saved. Connect → account `android-nip55`, pubkey equals Amber's npub |
| NIP-55 sign | **Pass.** Reject → nothing published, toast. Accept → kind 1 verified locally and accepted by the relay |
| NIP-46 bunker login and sign | **Pass.** connect, get_public_key, sign_event (kind 1 and 24242), all against the local bunker |
| NIP-46 `nostrconnect://` | **Partial.** QR, Copy URI, and the URI carries `url=https://grimoire.rocks`. "Open signer app" sends the intent; with no app installed for that scheme it reports "No app on this device can open this link". **Handing off to a real NIP-46 signer app was not tested** |
| NIP-07 | Not available in a WebView (`window.nostr` undefined); the UI says so and offers NIP-55 and NIP-46 |
| Session persistence, logout | **Pass.** Account survives a cold restart; logout clears it and stays cleared after a restart |
| Upload (file picker) | **Pass.** System picker opens with no permission; the `image/*,video/*,audio/*` filter hides a `.txt`; cancel → nothing selected, 0 requests; the PNG reads as 177 B `image/png`; BUD-06 preflight 401 → kind 24242 signed over NIP-46 → PUT of 177 B, sha256 `e4a9bf91…` identical to the original file; injected 500 shows "Failed (1) …"; retry succeeds; the published note carries `imeta` with `m`, `x` and `size` |
| Media | **Pass** for images and video: the uploaded image renders in the composer and feed; a 14,693 B `video/mp4` (sha256 `894b6bf3…`) uploads and plays in the feed (`readyState` 4, 320×240, playhead advancing). Audio was not tested |
| Download (export JSONL) | **Pass.** System save-as with the suggested name; cancel → no file, no error; save → `/sdcard/Download/nostr-events.jsonl`, 1167 B, 2 valid events |
| External links | **Pass.** https → Chrome; `lightning:` with no wallet → toast; `javascript:` → refused; top-level `intent:` → blocked natively (logged); `file:` and `content:` → blocked by Chromium, page unchanged |
| Deep links | **Pass.** Cold `nostr:npub…` → profile from the local relay; warm `https://grimoire.rocks/run?cmd=help` → `/run`; `nostr:nsec…` → refused. A duplicate history entry on cold start was found and fixed |
| Back | **Pass.** Closes the menu first; `/run` → profile → `/` → minimize (same pid, state kept) |
| Offline and reconnect | **Pass.** Offline cold start renders the bundled build and the cached session; after the relay restarted the app reconnected on its own within 20 s (`navigator.onLine` stays `true` without a network, a WebView quirk) |
| Update and downgrade | **Pass.** `install -r` of a newer versionCode keeps the session; 969 over 970 → `INSTALL_FAILED_VERSION_DOWNGRADE`; another key → `INSTALL_FAILED_UPDATE_INCOMPATIBLE` |
| NIP-55 signer guard | **Pass.** `checkSigner` on the emulator: Amber `installed`, no foreign providers, `frameSafeBridge: true`; an uninstalled package → `installed: false`; a bad name → `INVALID`. Login and signing go through the guard. A hostile app squatting the authorities was **not** reproduced on the device (that needs a malicious APK); the logic is covered by JUnit (`SignerGuardTest`) and Vitest |
| Release build (throwaway key) | **Pass.** `--require-signing` build of `03f4620` plus the guard, signed with a throwaway key (deleted afterwards): installs, launches in 753 ms, `run-as` → "not debuggable", 0 Capacitor plugin-argument lines in logcat. The WebView DevTools socket stays open, but this emulator is `userdebug` (`ro.debuggable=1`), where WebView turns DevTools on for every app; Google Search had its socket too. Capacitor ties DevTools to `FLAG_DEBUGGABLE`, which is false here. **Not confirmed on a `user` build or a physical device** |
| Web regression | **Pass.** Production build in headless Chrome 158 (fresh profile): `sw.js` registered, no `data-native`, login keeps the Extension tab as default |

**Not tested, and why:**

| Item | Status |
| --- | --- |
| **Physical device** | Nothing was run on hardware. Emulator results don't guarantee OEM WebView or signer behaviour |
| Camera capture | No `capture` input in the app; the camera-app path is configured (FileProvider) but unused |
| Audio upload and playback | Not run |
| Signer-authority hijack on device | Needs a hostile test APK; unit-tested only |
| NIP-55 nip44/nip04 (DMs, NWC) | Covered by unit tests only |
| Release-signed install with the **real** key | A throwaway-key release build was installed and launched; the real key exists only after owner step 1 |
| Real Zapstore publication | Out of scope until the owner gates above |
| `https://grimoire.rocks` App Links verification | Needs `assetlinks.json` (owner step 6) |
| R8/minify | Off; enabling it needs keep rules and a device run |

## Security review (adversarial pass, `03f4620`)

No blockers. Two findings were fixed in this PR:

1. **Medium, fixed.** capacitor-plugin-nostr-signer queries
   `content://<signer>.<TYPE>` before the package-addressed Intent. An
   authority belongs to whichever app declared it, so with a signer that
   declares none, another app could answer as the signer: its own key, and
   every plaintext.
   - `GrimoireNative.checkSigner` (`SignerGuard.java`) resolves every NIP-55
     authority and reports any that another package owns.
   - `Nip55Signer` refuses (`PROVIDER_HIJACKED`) before **every** request,
     not only at login.
2. **Low, fixed.** On a WebView without `WEB_MESSAGE_LISTENER`, Capacitor
   falls back to `addJavascriptInterface`, which iframes can reach. NIP-55
   is refused there (`UNSAFE_WEBVIEW`), with NIP-46 offered instead.

Accepted, documented: a deep link to `https://grimoire.rocks/run?cmd=…` opens
the same window a web link would. No command signs or publishes without a
tap; at most a link can make the app read from a relay it names, as on the
web.

## Known follow-ups

- Relay hints and NIP-05 lookups still reach public hosts in an E2E build;
  the `VITE_E2E_RELAY` seam covers discovery and fallback only.
- `nostr-signer-capacitor-plugin@0.0.5` with a nested `@capacitor/core@7`
  is installed as an optional dependency of applesauce-signers v6. Grimoire
  never imports it and `cap sync` doesn't link it. It disappears with
  applesauce v7.

## Background research (2026-11-27)

### What Zapstore requires

Sources:

- the publishing guide at <https://zapstore.dev/help/publish>
- `zapstore/zsp` at `a10cd7ae614401bb0060707449dbe826d565dda4` and tag
  `v2.0.1` at `8a54d7657965fb6fcee71331656bfbd016b45d4d`
- `zapstore/relay` at `9229935f4f83d82830544195501cf8fe3de9867e`

| Topic | Requirement |
| --- | --- |
| Artifact | APK only; one complete arm64-v8a or universal APK per release; a web-only app cannot be listed |
| App id | read from the APK; a new id is a new app |
| Version | versionCode must only increase per channel (`versionGuard`); zsp refuses an equal one without `--overwrite-release` |
| Signing cert | publicly known keys are refused (`known_keys.txt`); later releases need the same cert or a v3-lineage successor (`listing.go` `checkRelease`) |
| Publisher | `SIGN_WITH`: `nsec1…` or `bunker://`; hex keys are refused; no browser signer |
| Proof | NIP-C1 kind 30509, `d` = cert SHA-256, owner and optional delegate, about 2 years; created by the `zsp` wizard |
| Admission | whitelist, previous listing or Vertex web-of-trust; releases `pending` until automated checks pass; limits of 3 new apps per pubkey per day and 10 releases per IP per hour |
| Events | 32267 app, 30063 release, 3063 asset (sha256, version_code, cert hash), 24242 Blossom auth |

`zapstore.yaml` passes zsp's strict `config.Parse` + `Validate()`, and
`zsp check` accepts it together with the APK (`ok: true`).

### Ditto (reference only, not copied)

Ditto is **AGPL-3.0**; Grimoire is MIT. Nothing was copied.

- **Studied:** `soapbox-pub/ditto` (GitHub mirror) at
  `dfd7fea141f29d66668a48179a9ea456c3300848`; the canonical repository is
  gitlab.com/soapbox-pub/ditto.
- **Practices adopted independently:**
  - Capacitor with the build bundled;
  - signing only from CI secrets;
  - a monotonic versionCode;
  - zsp with a NIP-46 signer;
  - the service worker off in the app;
  - a NIP-55 login using the same MIT plugin.
- **Ditto on Zapstore:** listed as `pub.ditto.app` (event `e48c02b2…607b`),
  published by Team Soapbox
  (`npub10qdp2fc9ta6vraczxrcs8prqnv69fru2k6s2dj48gqjcylulmtjsg9arpj`), 2.46.8
  / 3695, cert `7c05a85a…9e71`. It has no NIP-C1 proof and shows as
  "Unclaimed"; Grimoire will need the proof.
- **zsp version:** Ditto pins zsp v0.4.17; this repo uses v2.0.1, whose
  `RELAYS` replaces the old `RELAY_URLS`.

### Alternatives considered

- **TWA (Bubblewrap):** rejected. It needs Chrome, the code isn't pinned by
  the APK hash, and it needs an `assetlinks.json` deployment before it works
  properly.
- **`zapstore/goapk`:** rejected. Its repository has no license.
