#!/bin/bash
# immutable-release-deploy.sh — create a Linux release with lockfile-based deps,
# build before switch, pre-switch gates, atomic current switch, health rollback.
#
# Required env:
#   DEPLOY_COMMIT   full git SHA written to REVISION
#   PREV_REL        absolute path to previous immutable release
#   REL_NAME        release directory name under $APP/releases/
#
# Optional env:
#   APP             default /opt/daogreen-spec
#   GIT_SRC         repo/mirror on the deploy host; release tree is built from
#                   `git archive $DEPLOY_COMMIT` and verified against it
#   ALLOW_UNVERIFIED_RELEASE=1  build from PREV+INCOMING without provenance proof
#   INCOMING        optional patch tree applied after copy (source only)
#   PREPARE_ONLY=1  build release + gates, do not switch current
#   SKIP_BACKUP=1   skip WAL backup (tests only)
#   NODE_BIN        node binary directory or node path prefix
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/release-deps.sh
source "$SCRIPT_DIR/lib/release-deps.sh"

APP="${APP:-/opt/daogreen-spec}"
NODE_BIN="${NODE_BIN:-/opt/node-v22.16.0-linux-x64/bin}"
export PATH="$NODE_BIN:$PATH"
export VITE_BASE_PATH="${VITE_BASE_PATH:-/spec/}"

COMMIT="${DEPLOY_COMMIT:?DEPLOY_COMMIT required}"
PREV="${PREV_REL:?PREV_REL required}"
REL_NAME="${REL_NAME:?REL_NAME required}"
REL="$APP/releases/$REL_NAME"
SHARED="$APP/shared"
DB="${DB_PATH:-$SHARED/data/daogreen.db}"
INCOMING="${INCOMING:-}"
GIT_SRC="${GIT_SRC:-}"
PREPARE_ONLY="${PREPARE_ONLY:-0}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SHORT="${COMMIT:0:7}"
BACKUP="$SHARED/backups/pre_${SHORT}_${STAMP}.db"

echo "=== PRECHECK ==="
test -d "$PREV"
test -f "$DB"
test ! -e "$REL"
CURRENT_BEFORE="$(readlink -f "$APP/current")"
REVISION_BEFORE="$(cat "$APP/current/REVISION")"
echo "PREV=$PREV"
echo "REL=$REL"
echo "CURRENT_BEFORE=$CURRENT_BEFORE"
echo "REVISION_BEFORE=$REVISION_BEFORE"

if [[ "$SKIP_BACKUP" != "1" ]]; then
  echo "=== WAL-SAFE BACKUP ==="
  echo "BACKUP_PATH=$BACKUP"
  sqlite3 "$DB" ".backup '$BACKUP'"
  BACKUP="$BACKUP" python3 - <<'PY'
import sqlite3, os
backup = os.environ["BACKUP"]
c = sqlite3.connect(backup)
assert c.execute("pragma integrity_check").fetchone()[0] == "ok"
assert len(c.execute("pragma foreign_key_check").fetchall()) == 0
print("integrity_check ok")
print("foreign_key_check 0")
print("projects", c.execute("select count(*) from projects").fetchone()[0])
print("project_items", c.execute("select count(*) from project_items").fetchone()[0])
print("materials", c.execute("select count(*) from materials").fetchone()[0])
PY
fi

if [[ -n "$GIT_SRC" ]]; then
  echo "=== CREATE RELEASE (git archive $COMMIT from $GIT_SRC) ==="
  # Provenance mode: the tree comes from the commit itself, never from $PREV.
  if [[ -n "$INCOMING" ]]; then
    echo "REFUSING INCOMING overlay in GIT_SRC mode (breaks provenance)" >&2
    exit 1
  fi
  mkdir -p "$REL"
  # Pin eol config: git archive honours core.autocrlf, and a CRLF-converted tree
  # would no longer hash to the commit's blobs.
  git -c core.autocrlf=false -c core.eol=lf -C "$GIT_SRC" \
    archive --format=tar "$COMMIT" | tar -x -C "$REL"
else
  echo "=== CREATE RELEASE (source only, no node_modules) ==="
  mkdir -p "$REL"
  # Never rsync node_modules from previous release into the new tree.
  rsync -a \
    --exclude node_modules \
    --exclude backend/node_modules \
    --exclude dist \
    --exclude backend/data \
    --exclude backend/.env \
    --exclude backend/uploads \
    "$PREV/" "$REL/"
fi

# Drop any accidentally copied modules and stale dist.
rm -rf "$REL/node_modules" "$REL/backend/node_modules" "$REL/dist"

if [[ -n "$INCOMING" && -d "$INCOMING" ]]; then
  echo "=== APPLY INCOMING (source patch) ==="
  # Refuse to accept Windows-shipped node_modules via incoming.
  if [[ -d "$INCOMING/node_modules" || -d "$INCOMING/backend/node_modules" ]]; then
    echo "REFUSING incoming node_modules" >&2
    exit 1
  fi
  rsync -a \
    --exclude node_modules \
    --exclude backend/node_modules \
    "$INCOMING/" "$REL/"
fi

chmod 755 "$REL"
chmod -R a+rX "$REL"

echo "=== INSTALL DEPENDENCIES (npm ci / lock-hash cache) ==="
release_install_or_restore_deps "$REL" "$SHARED"

echo "=== BUILD ==="
(
  cd "$REL"
  chmod -R a+rx node_modules/.bin || true
  if [[ -x node_modules/.bin/vite ]]; then
    npm run build
  else
    node node_modules/vite/bin/vite.js build
  fi
)
test -f "$REL/dist/index.html"
test -d "$REL/dist/assets"

printf '%s' "$COMMIT" > "$REL/REVISION"
# Shared runtime layout (.env / data symlinks, service-writable uploads dir).
# Must run for both source modes: git archive ships backend/data and
# backend/uploads, which rsync mode used to exclude.
release_link_shared_paths "$REL" "$SHARED"

chmod 755 "$REL"
chmod -R a+rX "$REL"

echo "=== PRE-SWITCH GATES ==="
release_pre_switch_gates "$REL" "$COMMIT" "$GIT_SRC"

if [[ "$PREPARE_ONLY" == "1" ]]; then
  echo "PREPARE_ONLY=1 — skipping current switch"
  echo "REL=$REL"
  echo "REVISION=$(cat "$REL/REVISION")"
  echo "PREPARE_OK"
  exit 0
fi

# Re-confirm current was not moved during prepare
if [[ "$(readlink -f "$APP/current")" != "$CURRENT_BEFORE" ]]; then
  echo "CURRENT_CHANGED_DURING_PREPARE" >&2
  exit 1
fi

echo "=== ATOMIC SWITCH ==="
release_atomic_switch "$APP" "$REL"

echo "=== RESTART + HEALTH (rollback on failure) ==="
if ! release_health_or_rollback "$APP" "$PREV" "$COMMIT"; then
  echo "DEPLOY_FAILED_ROLLED_BACK" >&2
  exit 1
fi

echo "CURRENT_AFTER=$(readlink -f "$APP/current")"
echo "REVISION_AFTER=$(cat "$APP/current/REVISION")"
echo "BACKUP_PATH=${BACKUP:-skipped}"
echo "REL=$REL"
echo "DEPLOY_OK"
