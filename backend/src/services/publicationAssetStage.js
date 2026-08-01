/**
 * Compensating cleanup for release assets copied during a publication attempt.
 *
 * Files are copied into /uploads/releases/<projectId>/<versionId>/ before the
 * surrounding SQLite transaction commits. SQLite cannot roll the filesystem
 * back, so every file an attempt creates is journaled and removed if that
 * transaction ends up rolling back.
 *
 * Only paths this attempt created are ever removed, and only after a
 * containment check against the release root — never a recursive delete of a
 * caller-supplied path.
 */
import fs from "fs";
import path from "path";
import { resolveUploadRoot } from "./uploadRoot.js";

/** Active scopes, innermost last. Publication runs single-threaded per request. */
const scopes = [];

function activeScope() {
  return scopes.length ? scopes[scopes.length - 1] : null;
}

function releasesRoot() {
  return path.join(resolveUploadRoot(), "releases");
}

/**
 * True when `abs` really lives under the releases root: resolves the root via
 * realpath, refuses symlinked entries and requires a relative path that does
 * not escape.
 * @param {string} abs
 */
export function isInsideReleasesRoot(abs) {
  const target = String(abs || "");
  if (!target) return false;
  let root;
  try {
    root = fs.realpathSync(releasesRoot());
  } catch {
    return false;
  }
  const parent = path.dirname(target);
  let realParent;
  try {
    realParent = fs.realpathSync(parent);
  } catch {
    return false;
  }
  const resolved = path.join(realParent, path.basename(target));
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  // Expect <projectId>/<versionId>/<file> — never the root or a project dir itself.
  return rel.split(path.sep).filter(Boolean).length >= 2;
}

/** Path reported in logs — relative to the releases root, never an absolute FS path. */
function reportable(abs) {
  try {
    return path.relative(releasesRoot(), abs).split(path.sep).join("/");
  } catch {
    return "<unresolved>";
  }
}

function removeStagedFile(abs) {
  if (!isInsideReleasesRoot(abs)) return { ok: false, reason: "outside_release_root" };
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { ok: true, reason: "already_absent" };
  }
  // Never follow a symlink out of the tree.
  if (!st.isFile() || st.isSymbolicLink()) return { ok: false, reason: "not_a_regular_file" };
  try {
    fs.unlinkSync(abs);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.code || "unlink_failed" };
  }
}

function removeStagedDir(abs) {
  if (!isInsideReleasesRoot(abs)) return { ok: false, reason: "outside_release_root" };
  try {
    // rmdir only — a non-empty directory means something else owns content here.
    fs.rmdirSync(abs);
    return { ok: true };
  } catch (err) {
    if (err?.code === "ENOENT") return { ok: true, reason: "already_absent" };
    return { ok: false, reason: err?.code || "rmdir_failed" };
  }
}

function rollbackScope(scope) {
  const failures = [];
  let removedFiles = 0;
  for (const abs of [...scope.files].reverse()) {
    const res = removeStagedFile(abs);
    if (res.ok) {
      if (res.reason !== "already_absent") removedFiles += 1;
    } else {
      failures.push({ path: reportable(abs), reason: res.reason });
    }
  }
  let removedDirs = 0;
  for (const abs of [...scope.dirs].reverse()) {
    const res = removeStagedDir(abs);
    if (res.ok) {
      if (res.reason !== "already_absent") removedDirs += 1;
    } else {
      failures.push({ path: reportable(abs), reason: res.reason });
    }
  }
  return { removedFiles, removedDirs, failures };
}

/**
 * Open a journal for one publication attempt.
 * `commit()` keeps the files; `rollback()` removes exactly what was journaled.
 * Both are idempotent.
 */
export function beginPublicationAssetScope() {
  const scope = { files: [], dirs: [], closed: false };
  scopes.push(scope);

  const close = () => {
    if (scope.closed) return false;
    scope.closed = true;
    const idx = scopes.indexOf(scope);
    if (idx >= 0) scopes.splice(idx, 1);
    return true;
  };

  return {
    get stagedFileCount() {
      return scope.files.length;
    },
    /** Paths of this attempt, relative to the releases root (for quarantine follow-up). */
    stagedPaths() {
      return scope.files.map(reportable);
    },
    commit() {
      if (!close()) return null;
      if (scope.files.length) {
        console.info(
          `PUBLICATION_ASSET_COMMIT files=${scope.files.length} dirs=${scope.dirs.length}`,
        );
      }
      return { committed: true, files: scope.files.length };
    },
    rollback() {
      if (!close()) return null;
      if (!scope.files.length && !scope.dirs.length) return { removedFiles: 0, removedDirs: 0, failures: [] };
      const result = rollbackScope(scope);
      if (result.failures.length) {
        console.error(
          `PUBLICATION_ASSET_ROLLBACK_FAIL removed=${result.removedFiles} `
          + `remaining=${JSON.stringify(result.failures)}`,
        );
      } else {
        console.warn(
          `PUBLICATION_ASSET_ROLLBACK files=${result.removedFiles} dirs=${result.removedDirs}`,
        );
      }
      return result;
    },
  };
}

/** Journal a file this attempt created. No-op outside a publication scope. */
export function recordStagedFile(absPath) {
  const scope = activeScope();
  if (scope && absPath) scope.files.push(String(absPath));
}

/** Journal a directory this attempt created (removed only if it ends up empty). */
export function recordStagedDir(absPath) {
  const scope = activeScope();
  if (scope && absPath) scope.dirs.push(String(absPath));
}

/** Test/diagnostic helper: number of open scopes. */
export function openPublicationScopeCount() {
  return scopes.length;
}
