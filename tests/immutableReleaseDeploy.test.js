/**
 * Tests for scripts/lib/release-deps.sh deploy dependency gates.
 * Runs via Git Bash on Windows / bash on Linux.
 */
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LIB = path.join(ROOT, "scripts", "lib", "release-deps.sh").replace(/\\/g, "/");

function findBash() {
  const candidates = [
    process.env.BASH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "/bin/bash",
    "bash",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["-c", "echo ok"], { encoding: "utf8" });
      if (r.status === 0 && String(r.stdout).includes("ok")) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

const BASH = findBash();

// Every case here spawns bash/git subprocesses; under a full-suite parallel run
// they exceed the 5s default and flake.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

function runBash(script, env = {}) {
  if (!BASH) throw new Error("bash not available");
  const r = spawnSync(BASH, ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function makeFakeReleaseTree(base) {
  writeFile(path.join(base, "package-lock.json"), '{"name":"root","lockfileVersion":3}\n');
  writeFile(path.join(base, "backend", "package-lock.json"), '{"name":"api","lockfileVersion":3}\n');
  writeFile(path.join(base, "package.json"), '{"name":"root"}\n');
  writeFile(path.join(base, "backend", "package.json"), '{"name":"api"}\n');
  writeFile(path.join(base, "backend", "src", "index.js"), "export {};\n");
}

/** Bash prelude: build a one-commit repo in $SRC and extract it into $REL. */
function makeCommitAndRelease(tmp) {
  return `
    set -e
    SRC="${tmp}/repo"
    REL="${tmp}/rel"
    mkdir -p "$SRC/backend/src" "$SRC/shared" "$REL"
    cd "$SRC"
    git init -q .
    git config core.autocrlf false
    git config commit.gpgsign false
    git config user.email deploy@test
    git config user.name deploy
    printf 'export const a = 1;\\n' > backend/src/index.js
    printf 'export const marker = "m";\\n' > shared/marker.js
    printf '{"name":"root"}\\n' > package.json
    git add -A
    git commit -qm init
    SHA=$(git rev-parse HEAD)
    git archive --format=tar "$SHA" | tar -x -C "$REL"
  `;
}

/**
 * Bash prelude: $REL is a release tree as `git archive` produces it — backend/data
 * and backend/uploads are REAL directories carrying tracked files — plus a $SHARED
 * root laid out like production. Echoes SYMLINK_UNSUPPORTED where links are denied.
 */
function makeArchiveLikeRelease(tmp) {
  return `
    set -e
    REL="${tmp}/rel"
    SHARED="${tmp}/shared"
    mkdir -p "$REL/backend/src" "$REL/backend/data" "$REL/backend/uploads"
    mkdir -p "$SHARED/data" "$SHARED/uploads" "$SHARED/env"
    printf '{}\\n' > "$REL/backend/data/materialTranslations.en.json"
    printf '' > "$REL/backend/uploads/.gitkeep"
    printf 'PORT=3002\\n' > "$SHARED/env/production.env"
    printf 'db\\n' > "$SHARED/data/daogreen.db"
    ln -sfn "$SHARED/data" "${tmp}/probe-link" 2>/dev/null || true
    if [[ ! -L "${tmp}/probe-link" ]]; then echo SYMLINK_UNSUPPORTED; exit 0; fi
  `;
}

/**
 * Bash prelude: repo in $SRC committed as $SHA, extracted into $REL. Contains
 * deploy-managed paths (backend/data/**, backend/uploads/**) alongside paths
 * whose names merely look similar and must stay inside the provenance scope.
 */
function makeProvenanceRepo(tmp) {
  return `
    set -e
    T="${tmp}"
    SRC="$T/repo"
    REL="$T/rel"
    mkdir -p "$SRC/backend/src" "$SRC/backend/data" "$SRC/backend/uploads" "$SRC/backend/database" "$SRC/shared" "$REL"
    cd "$SRC"
    git init -q .
    git config core.autocrlf false
    git config commit.gpgsign false
    git config user.email deploy@test
    git config user.name deploy
    printf 'export const a = 1;\\n'        > backend/src/index.js
    printf 'export const marker = "m";\\n' > shared/marker.js
    printf '{"name":"root"}\\n'            > package.json
    printf 'ADMIN_KEY=\\n'                 > backend/.env.example
    printf 'export const d = 1;\\n'        > backend/data.js
    printf 'export const k = 1;\\n'        > backend/database/keep.js
    printf 'export const u = 1;\\n'        > backend/uploads.js
    printf '{}\\n'                         > backend/data/materialTranslations.en.json
    printf ''                              > backend/uploads/.gitkeep
    git add -A
    git commit -qm init
    SHA=$(git rev-parse HEAD)
    git archive --format=tar "$SHA" | tar -x -C "$REL"
    # What release_link_shared_paths leaves behind for these paths.
    strip_deploy_managed() {
      rm -rf "$1/backend/data" "$1/backend/uploads" "$1/backend/.env"
    }
  `;
}

describe("immutable release dependency helpers", () => {
  it("finds bash for shell helper tests", () => {
    expect(BASH).toBeTruthy();
  });

  it("computes stable combined lock hash; changes when backend lock changes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-hash-"));
    makeFakeReleaseTree(tmp);
    const unix = tmp.replace(/\\/g, "/");
    const a = runBash(`. "${LIB}"; release_combined_lock_hash "${unix}"`);
    expect(a.status).toBe(0);
    const hash1 = a.stdout.trim();
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    fs.appendFileSync(path.join(tmp, "backend", "package-lock.json"), "\n");
    const b = runBash(`. "${LIB}"; release_combined_lock_hash "${unix}"`);
    expect(b.status).toBe(0);
    expect(b.stdout.trim()).not.toBe(hash1);
  });

  it("rejects invalid deps cache (package-lock changed / incomplete)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-cache-"));
    const cache = path.join(tmp, "cache").replace(/\\/g, "/");
    const r = runBash(`. "${LIB}"; release_cache_is_valid "${cache}"; echo exit:$?`);
    expect(r.stdout).toMatch(/exit:1/);
  });

  it("accepts cache only when complete marker and required modules exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-cache-ok-"));
    const cache = path.join(tmp, "cache");
    writeFile(path.join(cache, ".complete"), "ok\n");
    writeFile(path.join(cache, "root", "vite", "dist", "node", "cli.js"), "ok\n");
    writeFile(path.join(cache, "backend", "express-rate-limit", "dist", "index.mjs"), "ok\n");
    writeFile(path.join(cache, "backend", "express", "package.json"), "{}\n");
    const unix = cache.replace(/\\/g, "/");
    const r = runBash(`. "${LIB}"; release_cache_is_valid "${unix}" && echo VALID`);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/VALID/);
  });

  it("module assert fails when express-rate-limit missing (would block switch)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-miss-"));
    makeFakeReleaseTree(tmp);
    writeFile(path.join(tmp, "node_modules", "vite", "dist", "node", "cli.js"), "x");
    // intentionally no backend modules
    const unix = tmp.replace(/\\/g, "/");
    const r = runBash(`. "${LIB}"; release_assert_required_modules "${unix}"`);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/MISSING_MODULE/);
  });

  it("pre-switch gates fail without dist (current must not switch)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-gates-"));
    makeFakeReleaseTree(tmp);
    writeFile(path.join(tmp, "REVISION"), "abc123");
    writeFile(path.join(tmp, "node_modules", "vite", "dist", "node", "cli.js"), "x");
    writeFile(path.join(tmp, "backend", "node_modules", "express-rate-limit", "dist", "index.mjs"), "x");
    writeFile(path.join(tmp, "backend", "node_modules", "express", "package.json"), "{}");
    writeFile(path.join(tmp, "backend", "node_modules", "dotenv", "package.json"), "{}");
    writeFile(path.join(tmp, "backend", "node_modules", "cors", "package.json"), "{}");
    writeFile(path.join(tmp, "backend", "node_modules", "helmet", "package.json"), "{}");
    writeFile(path.join(tmp, "backend", "node_modules", "multer", "package.json"), "{}");
    writeFile(path.join(tmp, "backend", "node_modules", "nanoid", "package.json"), "{}");
    // no dist/index.html
    const unix = tmp.replace(/\\/g, "/");
    const r = runBash(`. "${LIB}"; release_pre_switch_gates "${unix}" "abc123"; echo status:$?`);
    expect(r.stdout + r.stderr).toMatch(/GATE_FAIL missing dist\/index\.html/);
    expect(r.stdout).toMatch(/status:1/);
  });

  it("provenance gate accepts a release built from git archive of DEPLOY_COMMIT", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-prov-ok-")).replace(/\\/g, "/");
    const r = runBash(`${makeCommitAndRelease(tmp)}
      . "${LIB}"
      release_assert_tree_matches_commit "$REL" "$SRC" "$SHA"
    `);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/PROVENANCE_OK files=[1-9]/);
  });

  it("provenance gate rejects a release whose file content differs from the commit", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-prov-bad-")).replace(/\\/g, "/");
    const r = runBash(`${makeCommitAndRelease(tmp)}
      printf 'tampered\\n' >> "$REL/backend/src/index.js"
      . "${LIB}"
      set +e
      release_assert_tree_matches_commit "$REL" "$SRC" "$SHA"; echo status:$?
    `);
    expect(r.stdout + r.stderr).toMatch(/PROVENANCE_MISMATCH .*backend\/src\/index\.js/);
    expect(r.stdout).toMatch(/status:1/);
  });

  it("provenance gate rejects a release missing a file tracked at the commit", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-prov-miss-")).replace(/\\/g, "/");
    const r = runBash(`${makeCommitAndRelease(tmp)}
      rm -f "$REL/shared/marker.js"
      . "${LIB}"
      set +e
      release_assert_tree_matches_commit "$REL" "$SRC" "$SHA"; echo status:$?
    `);
    expect(r.stdout + r.stderr).toMatch(/PROVENANCE_MISSING shared\/marker\.js/);
    expect(r.stdout).toMatch(/status:1/);
  });

  it("pre-switch gates refuse an unverifiable release unless explicitly allowed", () => {
    // Each run needs its own repo: makeCommitAndRelease commits into $SRC.
    const buildBase = () => `${makeCommitAndRelease(
      fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-prov-gate-")).replace(/\\/g, "/"),
    )}
      mkdir -p "$REL/dist/assets"
      printf 'x' > "$REL/dist/index.html"
      printf '%s' "$SHA" > "$REL/REVISION"
      printf '{"name":"root","lockfileVersion":3}\\n' > "$REL/package-lock.json"
      printf '{"name":"api","lockfileVersion":3}\\n' > "$REL/backend/package-lock.json"
      for f in node_modules/vite/dist/node/cli.js \\
               backend/node_modules/express-rate-limit/dist/index.mjs \\
               backend/node_modules/express/package.json \\
               backend/node_modules/dotenv/package.json \\
               backend/node_modules/cors/package.json \\
               backend/node_modules/helmet/package.json \\
               backend/node_modules/multer/package.json \\
               backend/node_modules/nanoid/package.json; do
        mkdir -p "$REL/$(dirname "$f")"; printf 'x' > "$REL/$f"
      done
      . "${LIB}"`;

    const denied = runBash(`${buildBase()}
      set +e
      release_pre_switch_gates "$REL" "$SHA"; echo status:$?
    `);
    expect(denied.stdout + denied.stderr).toMatch(/GATE_FAIL provenance unverified/);
    expect(denied.stdout).toMatch(/status:1/);

    const allowed = runBash(`${buildBase()}
      set +e
      release_pre_switch_gates "$REL" "$SHA"; echo status:$?
    `, { ALLOW_UNVERIFIED_RELEASE: "1" });
    expect(allowed.stdout).toMatch(/PROVENANCE_UNVERIFIED/);
    expect(allowed.stdout).not.toMatch(/GATE_FAIL provenance unverified/);
  });

  it("provenance: deploy-managed paths are excluded, not reported missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-exc-")).replace(/\\/g, "/");
    const r = runBash(`${makeProvenanceRepo(tmp)}
      strip_deploy_managed "$REL"
      . "${LIB}"
      release_assert_tree_matches_commit "$REL" "$SRC" "$SHA"
    `);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/PROVENANCE_SCOPE excludes: backend\/\.env backend\/data\/\*\* backend\/uploads\/\*\*/);
    expect(r.stdout).toMatch(/PROVENANCE_EXCLUDED backend\/data\/materialTranslations\.en\.json/);
    expect(r.stdout).toMatch(/PROVENANCE_EXCLUDED backend\/uploads\/\.gitkeep/);
    expect(r.stdout).toMatch(/PROVENANCE_OK files=7 excluded=2/);
    expect(r.stdout + r.stderr).not.toMatch(/PROVENANCE_MISSING/);
  });

  it("provenance: a modified ordinary tracked source still mismatches", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-exc-mod-")).replace(/\\/g, "/");
    const r = runBash(`${makeProvenanceRepo(tmp)}
      strip_deploy_managed "$REL"
      printf 'tampered\\n' >> "$REL/backend/src/index.js"
      . "${LIB}"
      set +e
      release_assert_tree_matches_commit "$REL" "$SRC" "$SHA"; echo status:$?
    `);
    expect(r.stdout + r.stderr).toMatch(/PROVENANCE_MISMATCH backend\/src\/index\.js/);
    expect(r.stdout).toMatch(/status:1/);
  });

  it("provenance: a missing ordinary tracked source still reports missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-exc-del-")).replace(/\\/g, "/");
    const r = runBash(`${makeProvenanceRepo(tmp)}
      strip_deploy_managed "$REL"
      rm -f "$REL/shared/marker.js"
      . "${LIB}"
      set +e
      release_assert_tree_matches_commit "$REL" "$SRC" "$SHA"; echo status:$?
    `);
    expect(r.stdout + r.stderr).toMatch(/PROVENANCE_MISSING shared\/marker\.js/);
    expect(r.stdout).toMatch(/status:1/);
  });

  it("provenance: the exclusion does not leak to similarly named paths", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-exc-near-")).replace(/\\/g, "/");
    const r = runBash(`${makeProvenanceRepo(tmp)}
      . "${LIB}"
      set +e
      for p in backend/.env.example backend/data.js backend/database/keep.js backend/uploads.js; do
        rm -rf "$T/probe"; cp -r "$REL" "$T/probe"
        strip_deploy_managed "$T/probe"
        rm -f "$T/probe/$p"
        out=$(release_assert_tree_matches_commit "$T/probe" "$SRC" "$SHA" 2>&1)
        echo "probe:$p:$(printf '%s' "$out" | grep -c "PROVENANCE_MISSING $p")"
      done
    `);
    expect(r.stdout).toMatch(/probe:backend\/\.env\.example:1/);
    expect(r.stdout).toMatch(/probe:backend\/data\.js:1/);
    expect(r.stdout).toMatch(/probe:backend\/database\/keep\.js:1/);
    expect(r.stdout).toMatch(/probe:backend\/uploads\.js:1/);
  });

  it("provenance: path classifier matches only the deploy-managed paths", () => {
    const r = runBash(`
      . "${LIB}"
      for p in backend/.env backend/data/x.json backend/data/deep/y.json backend/uploads/.gitkeep \\
               backend/.env.example backend/data.js backend/database/keep.js backend/uploads.js \\
               shared/backend/data/z.js src/index.js; do
        release_provenance_path_excluded "$p" && echo "EXCLUDED $p" || echo "INSCOPE  $p"
      done
    `);
    expect(r.stdout).toMatch(/EXCLUDED backend\/\.env\n/);
    expect(r.stdout).toMatch(/EXCLUDED backend\/data\/x\.json/);
    expect(r.stdout).toMatch(/EXCLUDED backend\/data\/deep\/y\.json/);
    expect(r.stdout).toMatch(/EXCLUDED backend\/uploads\/\.gitkeep/);
    expect(r.stdout).toMatch(/INSCOPE  backend\/\.env\.example/);
    expect(r.stdout).toMatch(/INSCOPE  backend\/data\.js/);
    expect(r.stdout).toMatch(/INSCOPE  backend\/database\/keep\.js/);
    expect(r.stdout).toMatch(/INSCOPE  backend\/uploads\.js/);
    expect(r.stdout).toMatch(/INSCOPE  shared\/backend\/data\/z\.js/);
    expect(r.stdout).toMatch(/INSCOPE  src\/index\.js/);
  });

  it("provenance + shared layout: gate passes on the tree the service actually starts", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-e2e-")).replace(/\\/g, "/");
    const r = runBash(`${makeProvenanceRepo(tmp)}
      SHARED="$T/shared"
      mkdir -p "$SHARED/data" "$SHARED/uploads" "$SHARED/env"
      printf 'PORT=3002\\n' > "$SHARED/env/production.env"
      printf 'db\\n' > "$SHARED/data/daogreen.db"
      ln -sfn "$SHARED/data" "$T/probe-link" 2>/dev/null || true
      if [[ ! -L "$T/probe-link" ]]; then echo SYMLINK_UNSUPPORTED; exit 0; fi
      . "${LIB}"
      release_link_shared_paths "$REL" "$SHARED"
      release_assert_tree_matches_commit "$REL" "$SRC" "$SHA"
    `);
    if (r.stdout.includes("SYMLINK_UNSUPPORTED")) {
      const lib = fs.readFileSync(path.join(ROOT, "scripts", "lib", "release-deps.sh"), "utf8");
      expect(lib).toMatch(/release_provenance_path_excluded "\$rel_path"/);
      return;
    }
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SHARED_PATHS_OK/);
    expect(r.stdout).toMatch(/PROVENANCE_OK files=7 excluded=2/);
  });

  it("shared paths: git-archive tree is reduced to the runtime layout", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-shared-")).replace(/\\/g, "/");
    const r = runBash(`${makeArchiveLikeRelease(tmp)}
      . "${LIB}"
      release_link_shared_paths "$REL" "$SHARED"
      echo "data_is_link:$([[ -L "$REL/backend/data" ]] && echo yes || echo no)"
      echo "data_target:$(readlink "$REL/backend/data")"
      echo "nested:$([[ -e "$REL/backend/data/data" ]] && echo yes || echo no)"
      echo "env_is_link:$([[ -L "$REL/backend/.env" ]] && echo yes || echo no)"
      echo "uploads_is_dir:$([[ -d "$REL/backend/uploads" && ! -L "$REL/backend/uploads" ]] && echo yes || echo no)"
      echo "db_visible:$([[ -f "$REL/backend/data/daogreen.db" ]] && echo yes || echo no)"
    `);
    if (r.stdout.includes("SYMLINK_UNSUPPORTED")) {
      const lib = fs.readFileSync(path.join(ROOT, "scripts", "lib", "release-deps.sh"), "utf8");
      expect(lib).toMatch(/rm -rf "\$release_dir\/backend\/\.env" "\$release_dir\/backend\/data"/);
      expect(lib).toMatch(/mkdir -p "\$release_dir\/backend\/uploads"/);
      return;
    }
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SHARED_PATHS_OK/);
    expect(r.stdout).toMatch(/data_is_link:yes/);
    expect(r.stdout).toMatch(/data_target:.*\/shared\/data/);
    // The production failure: ln -sfn nested the link inside the archived dir.
    expect(r.stdout).toMatch(/nested:no/);
    expect(r.stdout).toMatch(/env_is_link:yes/);
    // uploads must stay a real dir — UPLOAD_ROOT already points at shared/uploads.
    expect(r.stdout).toMatch(/uploads_is_dir:yes/);
    // The DB under shared/ must be reachable through the link.
    expect(r.stdout).toMatch(/db_visible:yes/);
  });

  it("shared paths: guard rejects a nested backend/data/data link", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-nested-")).replace(/\\/g, "/");
    const r = runBash(`${makeArchiveLikeRelease(tmp)}
      # Reproduce the old code path verbatim: ln -sfn onto an existing directory.
      ln -sfn "$SHARED/data" "$REL/backend/data"
      echo "nested_created:$([[ -L "$REL/backend/data/data" ]] && echo yes || echo no)"
      ln -sfn "$SHARED/env/production.env" "$REL/backend/.env"
      . "${LIB}"
      set +e
      release_assert_shared_paths "$REL" "$SHARED"; echo status:$?
    `);
    if (r.stdout.includes("SYMLINK_UNSUPPORTED")) return;
    expect(r.stdout).toMatch(/nested_created:yes/);
    expect(r.stdout + r.stderr).toMatch(/SHARED_FAIL/);
    expect(r.stdout).toMatch(/status:1/);
  });

  it("deploy script links shared paths instead of raw ln -sfn", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "immutable-release-deploy.sh"), "utf8");
    expect(script).toMatch(/release_link_shared_paths "\$REL" "\$SHARED"/);
    expect(script).not.toMatch(/ln -sfn "\$SHARED\/data" "\$REL\/backend\/data"/);
    expect(script).not.toMatch(/ln -sfn "\$SHARED\/env\/production\.env" "\$REL\/backend\/\.env"/);
  });

  it("deploy script builds the release from git archive when GIT_SRC is set", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "immutable-release-deploy.sh"), "utf8");
    expect(script).toMatch(/core\.autocrlf=false -c core\.eol=lf -C "\$GIT_SRC"/);
    expect(script).toMatch(/archive --format=tar "\$COMMIT" \| tar -x -C "\$REL"/);
    expect(script).toMatch(/REFUSING INCOMING overlay in GIT_SRC mode/);
    expect(script).toMatch(/release_pre_switch_gates "\$REL" "\$COMMIT" "\$GIT_SRC"/);
  });

  it("rollback helper restores previous current symlink when OS supports symlinks", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-rb-")).replace(/\\/g, "/");
    const probe = runBash(`
      set -e
      APP="${tmp}/probe"
      mkdir -p "$APP/releases/prev"
      ln -sfn "$APP/releases/prev" "$APP/current"
      if [[ -L "$APP/current" ]]; then echo SYMLINK_OK; else echo SYMLINK_UNSUPPORTED; fi
    `);
    if (!probe.stdout.includes("SYMLINK_OK")) {
      // Windows without symlink privilege: assert contract only.
      const lib = fs.readFileSync(path.join(ROOT, "scripts", "lib", "release-deps.sh"), "utf8");
      expect(lib).toMatch(/release_replace_current_symlink/);
      expect(lib).toMatch(/mv -Tf/);
      expect(lib).toMatch(/uname -s/);
      return;
    }
    const r = runBash(`
      set -e
      APP="${tmp}/app"
      PREV="$APP/releases/prev"
      BAD="$APP/releases/bad"
      mkdir -p "$PREV" "$BAD"
      ln -sfn "$BAD" "$APP/current"
      . "${LIB}"
      release_rollback_current "$APP" "$PREV"
      TARGET=$(readlink "$APP/current")
      echo "target:$TARGET"
      case "$TARGET" in
        *"/releases/prev"|*"/releases/prev/") echo OK ;;
        *) echo "BAD_TARGET:$TARGET"; exit 1 ;;
      esac
    `);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/target:.*releases\/prev/);
    expect(r.stdout).toMatch(/\bOK\b/);
  });

  it("deploy script refuses to treat previous node_modules as source of truth (excludes documented)", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "immutable-release-deploy.sh"), "utf8");
    expect(script).toMatch(/--exclude node_modules/);
    expect(script).toMatch(/--exclude backend\/node_modules/);
    expect(script).toMatch(/release_install_or_restore_deps/);
    expect(script).toMatch(/release_pre_switch_gates/);
    expect(script).toMatch(/release_health_or_rollback/);
    expect(script).toMatch(/npm ci/);
    expect(script).not.toMatch(/rsync -a --delete[\s\S]*\$PREV\/" "\$REL\/"/);
  });

  it("simulated npm ci failure leaves current pointer unchanged", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rel-npmfail-")).replace(/\\/g, "/");
    const bin = `${tmp}/bin`;
    writeFile(path.join(tmp, "bin", "npm").replace(/\//g, path.sep), "#!/bin/sh\necho npm_fail >&2\nexit 42\n");
    const r = runBash(`
      set -e
      APP="${tmp}/app"
      PREV="$APP/releases/prev"
      REL="$APP/releases/new"
      SHARED="$APP/shared"
      mkdir -p "$PREV/backend/src" "$REL/backend/src" "$SHARED/data" "$SHARED/env" "$SHARED/backups"
      printf '%s\\n' '{"name":"root","lockfileVersion":3}' > "$PREV/package-lock.json"
      printf '%s\\n' '{"name":"api","lockfileVersion":3}' > "$PREV/backend/package-lock.json"
      printf '%s\\n' '{"name":"root","lockfileVersion":3}' > "$REL/package-lock.json"
      printf '%s\\n' '{"name":"api","lockfileVersion":3}' > "$REL/backend/package-lock.json"
      printf 'prevrev' > "$PREV/REVISION"
      ln -sfn "$PREV" "$APP/current"
      BEFORE=$(cd "$APP/current" && pwd -P)
      chmod +x "${bin}/npm"
      export PATH="${bin}:$PATH"
      . "${LIB}"
      set +e
      release_install_or_restore_deps "$REL" "$SHARED"
      code=$?
      set -e
      AFTER=$(cd "$APP/current" && pwd -P)
      echo "npm_exit:$code"
      echo "before:$BEFORE"
      echo "after:$AFTER"
      test "$BEFORE" = "$AFTER"
      test "$code" -ne 0
    `);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/npm_exit:42|npm_exit:[1-9]/);
    expect(r.stdout).toMatch(/before:/);
  });

  it("health failure path invokes rollback helper contract", () => {
    const lib = fs.readFileSync(path.join(ROOT, "scripts", "lib", "release-deps.sh"), "utf8");
    expect(lib).toMatch(/HEALTH_FAIL — rolling back/);
    expect(lib).toMatch(/release_rollback_current/);
    expect(lib).toMatch(/DEPS_CACHE_HIT|DEPS_CACHE_MISS/);
    expect(lib).toMatch(/release_cache_is_valid/);
  });
});
