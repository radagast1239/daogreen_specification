#!/bin/bash
# release-deps.sh — helpers for immutable release dependency install.
# Sourced by immutable-release-deploy.sh and by tests.
# shellcheck shell=bash

release_combined_lock_hash() {
  local root="$1"
  local root_lock="$root/package-lock.json"
  local backend_lock="$root/backend/package-lock.json"
  if [[ ! -f "$root_lock" || ! -f "$backend_lock" ]]; then
    echo "missing package-lock.json" >&2
    return 1
  fi
  # Portable SHA256 (Linux sha256sum / macOS shasum)
  if command -v sha256sum >/dev/null 2>&1; then
    cat "$root_lock" "$backend_lock" | sha256sum | awk '{print $1}'
  else
    cat "$root_lock" "$backend_lock" | shasum -a 256 | awk '{print $1}'
  fi
}

release_deps_cache_dir() {
  local shared_root="$1"
  local lock_hash="$2"
  echo "$shared_root/deps-cache/$lock_hash"
}

release_cache_is_valid() {
  local cache_dir="$1"
  [[ -f "$cache_dir/.complete" ]] || return 1
  [[ -f "$cache_dir/root/vite/dist/node/cli.js" ]] || return 1
  [[ -f "$cache_dir/backend/express-rate-limit/dist/index.mjs" ]] || return 1
  [[ -f "$cache_dir/backend/express/package.json" ]] || return 1
  return 0
}

release_install_or_restore_deps() {
  # Args: release_dir shared_root
  # Uses npm ci. Restores from lock-hash cache when valid.
  local release_dir="$1"
  local shared_root="$2"
  local lock_hash cache_dir
  lock_hash="$(release_combined_lock_hash "$release_dir")"
  cache_dir="$(release_deps_cache_dir "$shared_root" "$lock_hash")"
  echo "LOCK_HASH=$lock_hash"
  echo "DEPS_CACHE=$cache_dir"

  rm -rf "$release_dir/node_modules" "$release_dir/backend/node_modules"

  if release_cache_is_valid "$cache_dir"; then
    echo "DEPS_CACHE_HIT"
    mkdir -p "$release_dir/node_modules" "$release_dir/backend/node_modules"
    rsync -a "$cache_dir/root/" "$release_dir/node_modules/"
    rsync -a "$cache_dir/backend/" "$release_dir/backend/node_modules/"
  else
    echo "DEPS_CACHE_MISS — npm ci"
    (
      cd "$release_dir"
      npm ci --include=dev
    )
    (
      cd "$release_dir/backend"
      npm ci --omit=dev
    )
    mkdir -p "$cache_dir"
    rm -rf "$cache_dir/root" "$cache_dir/backend"
    mkdir -p "$cache_dir/root" "$cache_dir/backend"
    rsync -a "$release_dir/node_modules/" "$cache_dir/root/"
    rsync -a "$release_dir/backend/node_modules/" "$cache_dir/backend/"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$cache_dir/.complete"
    echo "$lock_hash" > "$cache_dir/LOCK_HASH"
    echo "DEPS_CACHE_WRITTEN"
  fi

  release_assert_required_modules "$release_dir"
}

release_assert_required_modules() {
  local release_dir="$1"
  local missing=0
  local req=(
    "node_modules/vite/dist/node/cli.js"
    "backend/node_modules/express-rate-limit/dist/index.mjs"
    "backend/node_modules/express/package.json"
    "backend/node_modules/dotenv/package.json"
    "backend/node_modules/cors/package.json"
    "backend/node_modules/helmet/package.json"
    "backend/node_modules/multer/package.json"
    "backend/node_modules/nanoid/package.json"
  )
  local f
  for f in "${req[@]}"; do
    if [[ ! -e "$release_dir/$f" ]]; then
      echo "MISSING_MODULE $f" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
  echo "REQUIRED_MODULES_OK"
}

release_backend_module_load_smoke() {
  # Import critical backend deps without starting the server / touching DB.
  local release_dir="$1"
  local node_cmd="node"
  if [[ -n "${NODE_BIN:-}" ]]; then
    if [[ -x "${NODE_BIN}/node" ]]; then
      node_cmd="${NODE_BIN}/node"
    elif [[ -x "${NODE_BIN}" && ! -d "${NODE_BIN}" ]]; then
      node_cmd="${NODE_BIN}"
    fi
  fi
  (
    cd "$release_dir/backend"
    "$node_cmd" --input-type=module <<'JS'
import "express";
import "express-rate-limit";
import "dotenv";
import "cors";
import "helmet";
import "multer";
import "nanoid";
console.log("BACKEND_MODULE_LOAD_OK");
JS
  )
}

release_pre_switch_gates() {
  local release_dir="$1"
  local expected_revision="$2"
  [[ -f "$release_dir/dist/index.html" ]] || {
    echo "GATE_FAIL missing dist/index.html" >&2
    return 1
  }
  [[ -d "$release_dir/dist/assets" ]] || {
    echo "GATE_FAIL missing dist/assets" >&2
    return 1
  }
  [[ -f "$release_dir/REVISION" ]] || {
    echo "GATE_FAIL missing REVISION" >&2
    return 1
  }
  [[ "$(cat "$release_dir/REVISION")" == "$expected_revision" ]] || {
    echo "GATE_FAIL REVISION mismatch" >&2
    return 1
  }
  [[ -d "$release_dir/backend/src" ]] || {
    echo "GATE_FAIL missing backend/src" >&2
    return 1
  }
  release_assert_required_modules "$release_dir" || return 1
  release_backend_module_load_smoke "$release_dir" || return 1
  # Free space: at least 500MB on the filesystem hosting the release
  local avail_kb
  avail_kb=$(df -Pk "$release_dir" | awk 'NR==2 {print $4}')
  if [[ "${avail_kb:-0}" -lt 512000 ]]; then
    echo "LOW_DISK avail_kb=$avail_kb" >&2
    return 1
  fi
  echo "PRE_SWITCH_GATES_OK"
}

release_replace_current_symlink() {
  local app="$1"
  local target="$2"
  local tmp_link="$app/current.new"
  rm -rf "$tmp_link"
  ln -sfn "$target" "$tmp_link"

  # Linux production: atomic symlink replace via mv -T.
  # Other environments (Git Bash/Windows): recreate — mv -T is unreliable there.
  if [[ "$(uname -s 2>/dev/null || true)" == "Linux" ]]; then
    mv -Tf "$tmp_link" "$app/current"
  else
    rm -rf "$app/current"
    mv "$tmp_link" "$app/current"
  fi

  # Final guarantee: current must be a symlink to target.
  if [[ ! -L "$app/current" ]]; then
    rm -rf "$app/current"
    ln -sfn "$target" "$app/current"
  fi
  [[ -L "$app/current" ]] || return 1
  local resolved
  resolved="$(readlink "$app/current" 2>/dev/null || true)"
  [[ "$resolved" == "$target" || "$resolved" == "$target/" ]] || {
    # Some systems store relative links; compare basenames as soft check.
    [[ "$(basename "$resolved")" == "$(basename "$target")" ]] || return 1
  }
}

release_atomic_switch() {
  local app="$1"
  local release_dir="$2"
  release_replace_current_symlink "$app" "$release_dir"
  echo "CURRENT=$(readlink "$app/current" 2>/dev/null || readlink -f "$app/current")"
}

release_rollback_current() {
  local app="$1"
  local previous_release="$2"
  release_replace_current_symlink "$app" "$previous_release"
  echo "ROLLBACK_CURRENT=$(readlink "$app/current" 2>/dev/null || echo "$previous_release")"
}

release_health_or_rollback() {
  local app="$1"
  local previous_release="$2"
  local expected_revision="$3"
  local service="${SERVICE_NAME:-daogreen-spec}"
  local health_url="${HEALTH_URL:-http://127.0.0.1:3002/api/health}"
  local attempts="${HEALTH_ATTEMPTS:-10}"
  local i code

  systemctl restart "$service"
  for ((i = 1; i <= attempts; i++)); do
    sleep 2
    if systemctl is-active --quiet "$service"; then
      code="$(curl -sS -o /dev/null -w '%{http_code}' "$health_url" || true)"
      if [[ "$code" == "200" ]]; then
        if [[ "$(cat "$app/current/REVISION")" == "$expected_revision" ]]; then
          echo "HEALTH_OK code=$code"
          return 0
        fi
      fi
    fi
    echo "HEALTH_WAIT attempt=$i code=${code:-none}"
  done

  echo "HEALTH_FAIL — rolling back to $previous_release" >&2
  release_rollback_current "$app" "$previous_release"
  systemctl restart "$service"
  sleep 3
  systemctl is-active --quiet "$service" || true
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$health_url" || true)"
  echo "ROLLBACK_HEALTH code=$code"
  return 1
}
