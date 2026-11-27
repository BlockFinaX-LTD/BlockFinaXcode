#!/bin/sh
# Download TradingView Advanced Charts into client/public/charting_library before the build.
#
# The library is licensed to BlockFinaX and must not be committed to this (public) repository,
# so it lives in the private repository BlockFinaX-LTD/tv-charting-library. Railway gives the
# build a way in, in this order:
#   CHARTING_LIBRARY_DEPLOY_KEY  a read-only SSH deploy key for that one repository (base64)
#   CHARTING_LIBRARY_TOKEN       or a read-only GitHub token for it
# Locally, the developer's own GitHub login (gh) is used if present.
#
# Without any of them nothing is downloaded and the app falls back to its built-in chart. A
# download problem never fails the build, for the same reason.
set -u
cd "$(dirname "$0")/.."
DEST="client/public/charting_library"
REPO="BlockFinaX-LTD/tv-charting-library"
REF="${CHARTING_LIBRARY_REF:-main}"

if [ -f "$DEST/charting_library.standalone.js" ] && [ -z "${CHARTING_LIBRARY_REFRESH:-}" ]; then
  echo "[charting-library] already present"
  exit 0
fi

TMP="$(mktemp -d)"
install_from() {
  SRC="$(find "$1" -maxdepth 2 -type d -name charting_library | head -1)"
  if [ -n "$SRC" ] && [ -f "$SRC/charting_library.standalone.js" ]; then
    rm -rf "$DEST" && mkdir -p "$(dirname "$DEST")" && cp -R "$SRC" "$DEST"
    echo "[charting-library] installed from $REPO@$REF ($2)"
    return 0
  fi
  return 1
}

DONE=""
# 1. Deploy key over SSH, checked against GitHub's published host key.
if [ -n "${CHARTING_LIBRARY_DEPLOY_KEY:-}" ]; then
  command -v git >/dev/null 2>&1 || echo "[charting-library] git is not installed in this build"
  command -v ssh >/dev/null 2>&1 || echo "[charting-library] ssh is not installed in this build"
fi
if [ -n "${CHARTING_LIBRARY_DEPLOY_KEY:-}" ] && command -v git >/dev/null 2>&1 && command -v ssh >/dev/null 2>&1; then
  printf '%s' "$CHARTING_LIBRARY_DEPLOY_KEY" | base64 -d > "$TMP/key" 2>/dev/null && chmod 600 "$TMP/key"
  printf 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n' > "$TMP/known_hosts"
  if GIT_SSH_COMMAND="ssh -i $TMP/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$TMP/known_hosts -o StrictHostKeyChecking=yes" \
    git clone -q --depth 1 --branch "$REF" "git@github.com:$REPO.git" "$TMP/repo" 2>"$TMP/err"; then
    install_from "$TMP/repo" "deploy key" && DONE=1
  else
    echo "[charting-library] deploy key download failed: $(head -c 200 "$TMP/err")"
  fi
fi

# 2. Token over HTTPS (Railway token, or the local GitHub login).
if [ -z "$DONE" ]; then
  TOKEN="${CHARTING_LIBRARY_TOKEN:-}"
  if [ -z "$TOKEN" ] && [ -z "${CHARTING_LIBRARY_DEPLOY_KEY:-}" ] && command -v gh >/dev/null 2>&1; then
    TOKEN="$(gh auth token 2>/dev/null || true)"
  fi
  if [ -n "$TOKEN" ]; then
    CODE="$(curl -sSL -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO/tarball/$REF" -o "$TMP/lib.tgz" 2>/dev/null)"
    if [ "$CODE" = "200" ] && tar -xzf "$TMP/lib.tgz" -C "$TMP"; then
      install_from "$TMP" "token" && DONE=1
    else
      echo "[charting-library] token download failed (GitHub answered $CODE)"
    fi
  fi
fi

[ -z "$DONE" ] && echo "[charting-library] not installed: using the built-in chart"
rm -rf "$TMP"
exit 0
