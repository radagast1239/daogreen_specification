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

release_git_tree_manifest() {
  # Args: git_src commit
  # Prints "<blob_oid> <path>" for every file tracked at <commit>, sorted by path.
  local git_src="$1"
  local commit="$2"
  git -c core.quotepath=false -C "$git_src" ls-tree -r "$commit" \
    | awk '$2 == "blob" { oid = $3; sub(/^[^\t]*\t/, ""); print oid " " $0 }' \
    | LC_ALL=C sort -k2
}

_release_provenance_check() {
  # Args: release_dir git_src commit work_dir
  local release_dir="$1"
  local git_src="$2"
  local commit="$3"
  local work="$4"
  local oid rel_path total=0 missing=0

  if ! git -C "$git_src" rev-parse --verify --quiet "$commit^{commit}" >/dev/null; then
    echo "PROVENANCE_FAIL REVISION is not a commit in $git_src: $commit" >&2
    return 1
  fi
  if ! release_git_tree_manifest "$git_src" "$commit" > "$work/manifest" 2>"$work/err"; then
    echo "PROVENANCE_FAIL cannot read tree $commit: $(cat "$work/err")" >&2
    return 1
  fi
  : > "$work/expected"
  : > "$work/paths"
  while IFS=' ' read -r oid rel_path; do
    [[ -n "$rel_path" ]] || continue
    total=$((total + 1))
    if [[ ! -f "$release_dir/$rel_path" ]]; then
      echo "PROVENANCE_MISSING $rel_path" >&2
      missing=$((missing + 1))
      continue
    fi
    printf '%s\n' "$oid" >> "$work/expected"
    printf '%s\n' "$rel_path" >> "$work/paths"
  done < "$work/manifest"

  if [[ "$total" -eq 0 ]]; then
    echo "PROVENANCE_FAIL empty tree for $commit" >&2
    return 1
  fi
  if [[ "$missing" -ne 0 ]]; then
    echo "PROVENANCE_FAIL missing=$missing of $total tracked files" >&2
    return 1
  fi
  # Hash from inside the release tree: paths stay relative, no path translation.
  if ! git -C "$release_dir" hash-object --no-filters --stdin-paths < "$work/paths" > "$work/actual" 2>"$work/err"; then
    echo "PROVENANCE_FAIL cannot hash release tree: $(cat "$work/err")" >&2
    return 1
  fi
  paste "$work/expected" "$work/actual" "$work/paths" \
    | awk -F'\t' '$1 != $2 { print "PROVENANCE_MISMATCH " $3; bad++ } END { exit bad ? 1 : 0 }' >&2 || {
    echo "PROVENANCE_FAIL tree does not match $commit" >&2
    return 1
  }
  echo "PROVENANCE_OK files=$total commit=$commit"
}

release_assert_tree_matches_commit() {
  # Args: release_dir git_src commit
  # Release tree must reproduce every file tracked at <commit>, byte for byte.
  local release_dir="$1"
  local git_src="$2"
  local commit="$3"
  local work rc=0
  if [[ -z "$git_src" || ! -d "$git_src" ]]; then
    echo "PROVENANCE_FAIL git source unavailable: '$git_src'" >&2
    return 1
  fi
  work="$(mktemp -d)"
  _release_provenance_check "$release_dir" "$git_src" "$commit" "$work" || rc=1
  rm -rf "$work"
  return "$rc"
}

release_assert_shared_paths() {
  # Args: release_dir shared_root
  local release_dir="$1"
  local shared_root="$2"
  [[ -L "$release_dir/backend/.env" ]] || {
    echo "SHARED_FAIL backend/.env is not a symlink" >&2
    return 1
  }
  [[ -L "$release_dir/backend/data" ]] || {
    echo "SHARED_FAIL backend/data is not a symlink" >&2
    return 1
  }
  [[ "$(readlink "$release_dir/backend/data")" == "$shared_root/data" ]] || {
    echo "SHARED_FAIL backend/data -> $(readlink "$release_dir/backend/data") != $shared_root/data" >&2
    return 1
  }
  # `ln -sfn` into an existing directory nests the link instead of replacing it.
  [[ ! -e "$release_dir/backend/data/data" ]] || {
    echo "SHARED_FAIL nested backend/data/data — shared link was not replaced" >&2
    return 1
  }
  # UPLOAD_ROOT points at $shared_root/uploads; backend/uploads stays a real,
  # service-writable directory (the app mkdirs uploads/public at startup).
  [[ -d "$release_dir/backend/uploads" && ! -L "$release_dir/backend/uploads" ]] || {
    echo "SHARED_FAIL backend/uploads must be a real directory" >&2
    return 1
  }
  echo "SHARED_PATHS_OK"
}

release_link_shared_paths() {
  # Args: release_dir shared_root
  # Runtime state lives in $SHARED, never in the commit. rsync mode excluded
  # backend/data and backend/uploads; a `git archive` tree still contains them
  # (backend/data/materialTranslations.en.json, backend/uploads/.gitkeep), so
  # they must be reduced to the runtime layout before the service starts.
  local release_dir="$1"
  local shared_root="$2"
  local owner=""

  rm -rf "$release_dir/backend/.env" "$release_dir/backend/data"
  ln -sfn "$shared_root/env/production.env" "$release_dir/backend/.env"
  ln -sfn "$shared_root/data" "$release_dir/backend/data"

  # Archive-created uploads/ is owned by the deploy user (root); the service
  # runs as the shared/uploads owner and needs to write into it.
  mkdir -p "$release_dir/backend/uploads"
  if [[ -d "$shared_root/uploads" ]]; then
    owner="$(stat -c '%U:%G' "$shared_root/uploads" 2>/dev/null || true)"
  fi
  if [[ -n "$owner" ]]; then
    chown "$owner" "$release_dir/backend/uploads" 2>/dev/null \
      || echo "SHARED_WARN could not chown backend/uploads to $owner" >&2
  fi

  release_assert_shared_paths "$release_dir" "$shared_root"
}

release_pre_switch_gates() {
  local release_dir="$1"
  local expected_revision="$2"
  local git_src="${3:-${GIT_SRC:-}}"
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
  # REVISION is self-declared: comparing it to $expected_revision proves nothing
  # about the tree. Verify the release actually reproduces that commit.
  if [[ -n "$git_src" ]]; then
    release_assert_tree_matches_commit "$release_dir" "$git_src" "$expected_revision" || {
      echo "GATE_FAIL release tree does not match $expected_revision" >&2
      return 1
    }
  elif [[ "${ALLOW_UNVERIFIED_RELEASE:-0}" == "1" ]]; then
    echo "PROVENANCE_UNVERIFIED ALLOW_UNVERIFIED_RELEASE=1 — release content is not tied to $expected_revision"
  else
    echo "GATE_FAIL provenance unverified: set GIT_SRC=<repo> or ALLOW_UNVERIFIED_RELEASE=1" >&2
    return 1
  fi
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
