#!/usr/bin/env bash
# Builds, signs and checks the Android APK for the current version, and
# (with --upload) attaches it to the GitHub release v<version>.
#
#   scripts/android-release.sh            build and check only
#   scripts/android-release.sh --upload   also upload to the release (needs gh)
#
# Run it from a clean checkout of main, after the desktop builds of
# release.yml have finished (RELEASE.md, step 6). The output goes to
# dist-android/ (git-ignored):
#
#   PaperPad_<version>_android_arm64.apk
#   PaperPad_<version>_android_arm64.apk.sha256
#
# Signing needs src-tauri/gen/android/keystore.properties (git-ignored) with
# storeFile and keyAlias. The passwords are asked here and passed to Gradle
# through the environment only (see app/build.gradle.kts).
set -euo pipefail

UPLOAD=0
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=1 ;;
    *) echo "android-release: unknown option $arg" >&2; exit 2 ;;
  esac
done

fail() { echo "android-release: $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ANDROID_DIR="src-tauri/gen/android"
OUT_DIR="dist-android"

# --- Preconditions --------------------------------------------------------

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TAG="v$VERSION"
APK_NAME="PaperPad_${VERSION}_android_arm64.apk"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || fail "releases are built from main, you are on $BRANCH"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean, commit or stash first"

[ -f "$ANDROID_DIR/keystore.properties" ] || fail "missing $ANDROID_DIR/keystore.properties (see RELEASE.md, Android)"
STORE_FILE="$(sed -n 's/^storeFile=//p' "$ANDROID_DIR/keystore.properties")"
STORE_FILE="${STORE_FILE/#\~/$HOME}"
[ -f "$STORE_FILE" ] || fail "keystore not found at $STORE_FILE"

[ -n "${ANDROID_HOME:-}" ] || fail "ANDROID_HOME is not set"
# Newest build-tools: apksigner and aapt are not on PATH by default.
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
APKSIGNER="$BUILD_TOOLS/apksigner"
AAPT="$BUILD_TOOLS/aapt"
[ -x "$APKSIGNER" ] && [ -x "$AAPT" ] || fail "apksigner or aapt missing in $BUILD_TOOLS"

# Gradle and apksigner need a JDK. Android Studio ships one.
if [ -z "${JAVA_HOME:-}" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi

if [ "$UPLOAD" = 1 ]; then
  command -v gh >/dev/null || fail "--upload needs the GitHub CLI (brew install gh, then gh auth login)"
  # Upload only into an existing release: never create one from here, so
  # the desktop workflow stays the only thing that starts a release.
  gh release view "$TAG" >/dev/null 2>&1 || fail "release $TAG does not exist on GitHub yet"
  [ "$(git rev-parse HEAD)" = "$(git rev-list -n 1 "$TAG" 2>/dev/null || true)" ] \
    || fail "HEAD is not the commit tagged $TAG (git fetch --tags, then check out $TAG's commit)"
fi

# --- Build ----------------------------------------------------------------

read -r -s -p "Keystore password: " PAPERPAD_KEYSTORE_PASSWORD; echo
[ -n "$PAPERPAD_KEYSTORE_PASSWORD" ] || fail "empty password"
# Exported for Gradle only: it lives in this process tree and ends with it.
export PAPERPAD_KEYSTORE_PASSWORD

# Stale APKs from earlier builds must not be picked up below.
rm -rf "$ANDROID_DIR"/app/build/outputs/apk/*/release

npm run tauri android build -- --apk --target aarch64

APK="$(find "$ANDROID_DIR/app/build/outputs/apk" -path '*/release/*.apk' ! -name '*unsigned*' | head -1)"
[ -n "$APK" ] || fail "no signed release APK found. Is the signing config in app/build.gradle.kts active?"

# --- Checks ---------------------------------------------------------------

echo
echo "Checking $APK"

CERTS="$("$APKSIGNER" verify --print-certs "$APK")" || fail "signature verification failed"
echo "$CERTS" | grep -q "CN=Android Debug" && fail "APK is signed with the debug key"
CERT_SHA256="$(echo "$CERTS" | sed -n 's/.*certificate SHA-256 digest: //p' | head -1)"
[ -n "$CERT_SHA256" ] || fail "could not read the signing certificate digest"

# PaperPad never uses the network: the release Manifest removes INTERNET.
PERMS="$("$AAPT" dump permissions "$APK")"
echo "$PERMS" | grep -q "android.permission.INTERNET" && fail "INTERNET permission found in a release APK"

# versionName must match the release, versionCode comes from it (Tauri).
BADGING="$("$AAPT" dump badging "$APK" | head -1)"
echo "$BADGING" | grep -q "versionName='$VERSION'" || fail "versionName is not $VERSION: $BADGING"

mkdir -p "$OUT_DIR"
cp "$APK" "$OUT_DIR/$APK_NAME"
(cd "$OUT_DIR" && shasum -a 256 "$APK_NAME" > "$APK_NAME.sha256")

echo
echo "Built  $OUT_DIR/$APK_NAME"
echo "$BADGING"
echo "File SHA-256:        $(cut -d' ' -f1 "$OUT_DIR/$APK_NAME.sha256")"
echo "Certificate SHA-256: $CERT_SHA256"
echo "Put the certificate digest in the release notes."

# --- Upload ---------------------------------------------------------------

if [ "$UPLOAD" = 1 ]; then
  gh release upload "$TAG" "$OUT_DIR/$APK_NAME" "$OUT_DIR/$APK_NAME.sha256"
  echo "Uploaded to $TAG"
else
  echo "Not uploaded. Run again with --upload, or attach both files to $TAG on GitHub by hand."
fi
