#!/bin/sh
# Download TradingView Advanced Charts into client/public/charting_library before the build.
#
# The library is licensed to BlockFinaX and must not be committed to this (public) repository,
# so it lives in the private repository BlockFinaX-LTD/tv-charting-library. Railway passes a
# read-only token for that one repository as CHARTING_LIBRARY_TOKEN.
#
# Without the token (for example a local run), nothing is downloaded and the app falls back to
# its built-in chart. A download problem never fails the build, for the same reason.
set -u
cd "$(dirname "$0")/.."
DEST="client/public/charting_library"
REPO="BlockFinaX-LTD/tv-charting-library"
REF="${CHARTING_LIBRARY_REF:-main}"

if [ -f "$DEST/charting_library.standalone.js" ] && [ -z "${CHARTING_LIBRARY_REFRESH:-}" ]; then
  echo "[charting-library] already present"
  exit 0
fi

TOKEN="${CHARTING_LIBRARY_TOKEN:-}"
if [ -z "$TOKEN" ] && command -v gh >/dev/null 2>&1; then
  TOKEN="$(gh auth token 2>/dev/null || true)"   # local: the developer's own GitHub login
fi
if [ -z "$TOKEN" ]; then
  echo "[charting-library] no CHARTING_LIBRARY_TOKEN: using the built-in chart"
  exit 0
fi

TMP="$(mktemp -d)"
if curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/tarball/$REF" -o "$TMP/lib.tgz" \
  && tar -xzf "$TMP/lib.tgz" -C "$TMP"; then
  SRC="$(find "$TMP" -maxdepth 2 -type d -name charting_library | head -1)"
  if [ -n "$SRC" ] && [ -f "$SRC/charting_library.standalone.js" ]; then
    rm -rf "$DEST" && mkdir -p "$(dirname "$DEST")" && cp -R "$SRC" "$DEST"
    echo "[charting-library] installed from $REPO@$REF"
  else
    echo "[charting-library] download did not contain the library: using the built-in chart"
  fi
else
  echo "[charting-library] download failed: using the built-in chart"
fi
rm -rf "$TMP"
exit 0
