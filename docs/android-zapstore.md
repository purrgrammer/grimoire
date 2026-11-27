# Android build and Zapstore distribution

Status: **proposal, not shipped.** This branch adds the Zapstore metadata
(`zapstore.yaml`), `.gitignore` guards for signing material and build output,
and this document. There is no Android project, wrapper dependency, signing
key, release workflow or published event. Those wait on the owner decisions in
[Decisions](#decisions-the-owner-makes-these).

Facts below were checked on 2026-11-27. Each one names its source and commit
so it can be re-checked.

## What Zapstore requires

Sources:

- the publishing guide at <https://zapstore.dev/help/publish>
- `zapstore/zsp` at `a10cd7ae614401bb0060707449dbe826d565dda4`; the latest
  tag is `v2.0.1` at `8a54d7657965fb6fcee71331656bfbd016b45d4d`
- `zapstore/relay` at `9229935f4f83d82830544195501cf8fe3de9867e`

| Topic | Requirement |
| --- | --- |
| Artifact | **APK only.** zsp has no AAB path. The guide asks for one complete `arm64-v8a` APK per release; a universal APK also qualifies. A web-only app cannot be listed. |
| App id | The APK's package name, read from the APK. A `zapstore.yaml` `identifier` is ignored. It can never change: a new id is a new app. |
| Version | `versionCode` must only increase per channel. The relay's `versionGuard` refuses a lower one, and zsp refuses an equal one unless given `--overwrite-release`. |
| APK signing cert | Must be a real release cert. The relay refuses certificates with publicly known keys (`relay/pkg/relay/known_keys.txt`: AOSP test/platform keys and the RN/Expo `debug.keystore`). Every later release must be signed by the same cert or a v3-lineage successor (`relay/pkg/relay/listing.go` `checkRelease`). **Losing the key means losing the listing.** |
| Publisher identity | A **Nostr key**, separate from the APK key. zsp signs with `SIGN_WITH`, either `bunker://…` (NIP-46) or `nsec1…`. Hex keys are refused, and there is no browser signer. |
| Linking the two keys | A NIP-C1 proof, kind `30509`, whose `d` is the SHA-256 of the APK cert. It names the publishing pubkey and is valid for about 2 years. The interactive `zsp` wizard creates it and is the only step that reads the keystore; `zsp publish` never does. |
| Admission | A new publisher key must pass a gate (`relay/pkg/policy/gate.go`): an operator whitelist, a previous listing, or a Vertex web-of-trust check. Releases sit at `pending` until automated checks pass, and nobody reviews them by hand. There is a blacklist by key, forge account or cert hash, and the Terms of Service apply. Limits: 3 new apps per pubkey per day, 10 releases per IP per hour. |
| Events | Kind `32267` is the app (`d` = package name), `30063` the release, and `3063` the asset (APK SHA-256, `version_code`, `apk_certificate_hash`, min/target SDK). `24242` is Blossom upload auth, used when the APK has no public URL. |
| Release source | A forge release (GitHub/GitLab/Gitea), F-Droid, a web page, or a local APK, which is uploaded to Blossom. The `x` hash is the APK file's SHA-256. |
| Metadata | `zapstore.yaml`, parsed strictly (unknown keys are errors). `repository` or `release_source` is required. |

`zapstore.yaml` in this repo passes zsp's own `config.Parse` + `Validate()` at
`a10cd7a`, checked with a throwaway Go test against the vendored parser. It
leaves out `release_source`, because no build exists yet. It also sets
`metadata_sources: []`, so nothing is fetched from GitHub that the file does
not say itself.

### How Ditto does it (reference only)

Ditto is **AGPL-3.0**. Grimoire is MIT. Nothing below was copied; it describes
practice, and any implementation here must be written independently. Source:
`soapbox-pub/ditto` (GitHub mirror) at
`dfd7fea141f29d66668a48179a9ea456c3300848`. The canonical repository is
`gitlab.com/soapbox-pub/ditto`.

- **Wrapper:** Capacitor 8 with the Vite build bundled inside the APK. It sets
  `androidScheme: 'https'` and has no remote `server.url`. Package
  `pub.ditto.app`, minSdk 24, target/compile 36.
- **Signing:** `android/key.properties`, read only if it exists. No keystore is
  committed (it is gitignored). CI decodes a base64 keystore from a masked
  variable.
- **Versions:** `versionCode` is the CI pipeline counter (monotonic), and
  `versionName` comes from the `vX.Y.Z` tag.
- **Publishing:** a tag-triggered GitLab job runs `zsp publish --skip-metadata
  --skip-preview` with `SIGN_WITH` set to a NIP-46 bunker approved in Amber.
  `version` and `release_source` are written into `zapstore.yaml` per release.
- **Pinned tool:** zsp is pinned at `v0.4.17`. Their notes say 0.5+ broke
  their pipeline: `RELAY_URLS` became `RELAYS` (and the old name is ignored
  silently), and NIP-C1 proofs became mandatory. Current zsp is 2.x.
- **Android-only code:** a NIP-55 signer through a native plugin, a back-button
  handler, a deep-link handler that rejects off-origin URLs, external links
  through an app launcher, and native downloads. The service worker is
  **disabled on native**.
- **Ditto on Zapstore:** the kind `32267` record `d=pub.ditto.app` (event
  `e48c02b2…607b`) is published by Team Soapbox
  (`npub10qdp2fc9ta6vraczxrcs8prqnv69fru2k6s2dj48gqjcylulmtjsg9arpj`). Latest
  is 2.46.8 / versionCode 3695. The APK cert SHA-256 is
  `7c05a85a070f84ae43de8567a45f7ffb420a050527ceb68cdaafa5e012e09e71` for its
  last three releases. No NIP-C1 proof exists for that cert, and
  zapstore.dev shows the app as "Unclaimed". It is listed under the relay's
  exemption for publishers who predate C1. **A new app such as Grimoire would
  need the C1 proof.**

## Options

| | A. Capacitor, bundled | B. TWA (Bubblewrap) | C. `zapstore/goapk` |
| --- | --- | --- | --- |
| What ships | The `dist/` build inside the APK | A shell that opens `https://grimoire.rocks` in the user's browser | A WebView shell around `dist/` or a URL |
| Code pinned by the APK hash | **Yes**, which matches Zapstore's hash/cert trust model | No. The code is whatever the site serves today | Yes for `dist/` |
| Needs Chrome or a TWA browser | No (system WebView) | Yes. Otherwise it falls back to a Custom Tab or WebView; common on de-Googled phones, which Zapstore users often have | No |
| Origin | `https://localhost`, so origin-derived links break (below) | `https://grimoire.rocks`, unchanged | Depends on mode |
| Web deploys reach users | Only with an APK release | Immediately | Bundled: only with an APK release |
| Domain work | None | `/.well-known/assetlinks.json` on grimoire.rocks with the release cert's SHA-256; without it a URL bar shows | None |
| NIP-55 (Amber) later | Native plugin possible | `nostrsigner:` web intents only | No |
| Build tooling | JDK 21, Android SDK, Gradle | JDK 17, Android SDK | Go 1.25 |
| License | Capacitor is MIT | Bubblewrap is Apache-2.0 | **No license file** at `260661035ee7`, so treat it as all rights reserved; don't adopt |

**Recommendation: A, Capacitor bundled,** the path Ditto proved on Zapstore.

- It runs without Chrome.
- What a user installs is the code Zapstore hashed.
- It leaves room for NIP-55.

B is the cheap fallback if the owner wants web deploys to reach phones
instantly and accepts the Chrome dependency plus a domain change.

## Prototype results (Capacitor, debug)

The prototype was built outside the repo (`/tmp`) with a deliberately throwaway
package id, `dev.prototype.grimoire`. Nothing from it is committed.

| | |
| --- | --- |
| Web build | this branch's `npm run build` (base `origin/main` `1d08f90`) |
| Toolchain | `@capacitor/{core,cli,android}` 8.6.3, AGP 8.13.0, Gradle 8.14.3, Temurin JDK 21.0.13.1+2 (tarball SHA-256 `48067f2b…0b14`, matches Adoptium), build-tools 36.0.0 |
| Output | `app-debug.apk`, 7,799,086 bytes, SHA-256 `af8ba1d0397f4832cb01bda4993d226d95e411bcca1f3bdc056544f0a7ed6698` |
| SDK | minSdk 24, target/compile 36 |
| ABI | no native libraries, so it is ABI-independent (counts as universal) |
| Permissions | `INTERNET` only, plus Android's own `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` |
| Signing | the local SDK debug key (`CN=Android Debug`, cert SHA-256 `8001f4a7…5d22`). Test only. |
| `zsp check` (v2.0.1) | `ok:true`, `listed:false`, `authorized:false`; next step "Prove the app is yours" (C1) |

Emulator smoke on an API 36 (Android 16) arm64 `google_apis` image, run
read-only, with WebView 133.0.6943.137:

| Check | Result |
| --- | --- |
| Launch | **Pass.** The welcome screen renders. |
| Live relay query (`req -k 1 -l 20`) | **Pass.** 45 events from 2/3 relays (`relay.damus.io` errored). |
| Deep route `/run?cmd=help` | **Pass.** The SPA fallback serves it and the man page renders. |
| Secure context | `isSecureContext` and `crypto.subtle` are available. |
| `location.origin` | **`https://localhost`**, which breaks the links in the table below. |
| `window.nostr` (NIP-07) | Absent, as expected; there are no extensions in a WebView. |
| Service worker | The API exists and registration succeeds. **It should be disabled on native**: it would serve stale shells across APK updates. |
| Back button | With one history entry it **exits the app**, even with windows open; window changes don't push history. |
| `navigator.share` | Absent. |
| Status bar / safe area | The system bar is light against the dark app. Capacitor logs "Error injecting safe area CSS" at startup. |

**Not tested** (don't assume these work):

- NIP-46 `nostrconnect://` hand-off to a signer app; only the QR and copy
  buttons exist today
- any NIP-55 path
- `lightning:`, `window.open` (12 call sites) and external media links
- file upload (`BlossomUploadDialog`, `type="file"`) and blob downloads
- offline start and upgrading over an older install
- Napplet/nsite frames on `*.grimoire.rocks`
- TWA (option B) of any kind
- physical devices
- release signing and `minifyEnabled`

## Work option A needs in Grimoire

Each item is small and independently testable.

| What | Why | Where |
| --- | --- | --- |
| A public-origin constant for shareable links | `location.origin` is `https://localhost` on native | `ShareSpellbookDialog.tsx:35`, `SpellbookPage.tsx:195` |
| The same constant for NIP-46 client metadata `url` | `LoginDialog.tsx:328` | |
| Skip SW registration on native | stale shell across APK updates | `src/main.tsx:57` |
| Back-button handling | close the top dialog or window before exiting | new, native only |
| External links through the system browser and intents | `window.open`, `lightning:`, `nostrconnect:` | 12 call sites |
| "Open signer app" button beside the NIP-46 QR | you can't scan your own screen | `LoginDialog.tsx` |
| Status bar colour and safe-area insets | | |

NIP-55 (Amber) is a separate, larger feature. Do it after the first release.

## Decisions the owner makes (these)

1. **Wrapper: A or B.** A adds `@capacitor/*` and an `android/` tree.
2. **Package id. Permanent.** Zapstore, Android and every user's install are
   keyed on it. Candidate: `rocks.grimoire.app` (from the grimoire.rocks
   domain). Nothing in this branch picks it.
3. **APK release key.** Generate it offline on an owner-controlled machine,
   back it up in at least two places, and never commit or paste it. For CI,
   store it as a base64 secret plus password secrets in a protected
   environment that only a manual, owner-approved job can use. Record the
   cert SHA-256; it becomes the app's identity on Zapstore and in
   `assetlinks.json`.
4. **Nostr publisher key.** Which npub publishes. Prefer a NIP-46 bunker
   (Amber/nsecBunker) over an `nsec` in CI. It may need Zapstore's WoT gate
   or a whitelist.
5. **versionCode scheme.** It must increase forever. Either a CI run counter
   (Ditto) or a value derived from semver; pick one once.
6. **Release trigger.** Manual `workflow_dispatch` versus tags, and whether
   GitHub Releases host the APK or zsp uploads it to Blossom.

## Release gates (owner only, in order)

These are not done and not automatable from this branch:

1. Generate the release keystore and record its cert SHA-256.
2. Build a release-signed APK and run `zsp check app-release.apk`.
3. Run the `zsp` wizard once to sign the NIP-C1 proof (kind `30509`) linking
   the cert to the publisher npub.
4. Run `zsp publish` with `SIGN_WITH=bunker://…` and `release_source` set to
   the APK. The relay answers `pending`.
5. Option B only: deploy `/.well-known/assetlinks.json` with the real cert
   SHA-256. Never deploy a placeholder.

A template, kept here and **not** in `public/` (Vercel would serve it):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "<PACKAGE_ID — decision 2>",
    "sha256_cert_fingerprints": ["<RELEASE CERT SHA-256 — decision 3>"]
  }
}]
```

## Reproducing the prototype

Outside the repo, with JDK 21 and the Android SDK:

```bash
mkdir /tmp/grim-cap && cd /tmp/grim-cap
npm init -y && npm i @capacitor/core@8.6.3 @capacitor/cli@8.6.3 @capacitor/android@8.6.3
cp -R <grimoire>/dist ./dist
echo '{"appId":"dev.prototype.grimoire","appName":"Grimoire","webDir":"dist","server":{"androidScheme":"https"}}' > capacitor.config.json
npx cap add android && npx cap sync android
(cd android && JAVA_HOME=<jdk21> ANDROID_HOME=<sdk> ./gradlew assembleDebug)
zsp check android/app/build/outputs/apk/debug/app-debug.apk
```
