#!/usr/bin/env bash
# Check an APK before it goes anywhere near Zapstore.
#
#   scripts/android/verify-apk.sh <apk> [expected-cert-sha256]
#
# Fails when: the signature does not verify, the package is not
# rocks.grimoire.app, the APK is signed with an Android debug certificate,
# it asks for any permission beyond INTERNET, or (when given) the signing
# certificate is not the pinned one — shipping under another key would lose
# the Zapstore listing for good.
set -euo pipefail

apk="${1:?usage: verify-apk.sh <apk> [expected-cert-sha256]}"
expected="${2:-}"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?ANDROID_HOME is not set}}"
bt="$sdk/build-tools/${ANDROID_BUILD_TOOLS:-36.0.0}"

badging="$("$bt/aapt2" dump badging "$apk")"
package="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$badging")"
version_code="$(sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" <<<"$badging" | head -1)"
version_name="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$badging" | head -1)"
perms="$(sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p" <<<"$badging" | grep -v '\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION$' || true)"

[[ "$package" == "rocks.grimoire.app" ]] || { echo "FAIL package is '$package'"; exit 1; }
[[ "$perms" == "android.permission.INTERNET" ]] || { echo "FAIL unexpected permissions:"; echo "$perms"; exit 1; }

certs="$("$bt/apksigner" verify --print-certs --verbose "$apk")"
grep -q "^Verified using v2 scheme (APK Signature Scheme v2): true" <<<"$certs" || { echo "FAIL not v2-signed"; exit 1; }
if grep -q "CN=Android Debug" <<<"$certs"; then echo "FAIL signed with an Android debug certificate"; exit 1; fi
cert="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$certs")"
lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
if [[ -n "$expected" && "$(lower "$cert")" != "$(lower "$expected")" ]]; then
  echo "FAIL certificate $cert != pinned $expected"; exit 1
fi

echo "OK package=$package versionCode=$version_code versionName=$version_name"
echo "OK permissions=$perms"
echo "OK cert-sha256=$cert"
echo "OK apk-sha256=$(shasum -a 256 "$apk" | cut -d' ' -f1)"
