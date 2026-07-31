/**
 * Tests for scripts/lib/release-deps.sh deploy dependency gates.
 * Runs via Git Bash on Windows / bash on Linux.
 */
import { describe, expect, it } from "vitest";
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
