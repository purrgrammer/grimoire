# Hostile signer fixture (test only, never shipped)

Two throwaway apps that exercise the NIP-55 signer guard
(`SignerGuard.java`, `nip55-signer.ts`) on a real device or emulator:

- **intentsigner** (`rocks.grimoire.e2e.intentsigner`): a NIP-55 signer that
  answers Intents only and declares **no** content providers — legal, and
  the shape the attack needs. It cancels every request.
- **squatter** (`rocks.grimoire.e2e.squatter`): claims the provider
  authorities `rocks.grimoire.e2e.intentsigner.<TYPE>` and answers with its
  own pubkey. It makes itself visible to Grimoire with a `lightning:` VIEW
  activity (Grimoire queries `lightning:` to open wallets), so it does not
  show up as a signer. Without some such visibility, Android 11+ hides its
  providers from Grimoire and the attack fails on its own. Every query it receives is logged as
  `SQUATTER_QUERIED`.

Build (debug-signed, never published):

```bash
../../../android/gradlew -p . assembleDebug
adb install intentsigner/build/outputs/apk/debug/intentsigner-debug.apk
adb install squatter/build/outputs/apk/debug/squatter-debug.apk
```

Expected: Grimoire lists "E2E Intent Signer"; logging in with it fails with
`PROVIDER_HIJACKED`, and logcat shows no `SQUATTER_QUERIED`.
