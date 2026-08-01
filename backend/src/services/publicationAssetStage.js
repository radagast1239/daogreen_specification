/**
 * Compensating cleanup for release assets copied during a publication attempt.
 *
 * Files are copied into /uploads/releases/<projectId>/<versionId>/ before the
 * surrounding SQLite transaction commits. SQLite cannot roll the filesystem
 * back, so every file an attempt creates is journaled on an explicit scope and
 * removed if that transaction ends up rolling back.
 *
 * The scope is passed explicitly through the publication call chain — there is
 * deliberately no ambient "current scope", so a write path can never silently
 * journal nothing.
 *
 * Only paths this attempt created are ever removed, and only after a
 * containment check against the release root — never a recursive delete of a
 * caller-supplied path.
 */
import fs from "fs";
import path from "path";
import { resolveUploadRoot } from "./uploadRoot.js";

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
  let realParent;
  try {
    realParent = fs.realpathSync(path.dirname(target));
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
    // Journaled but never created (or already gone) — nothing to undo.
    return { ok: true, reason: "already_absent" };
  }
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

/**
 * Open a journal for one publication attempt.
 * `commit()` keeps the files; `rollback()` removes exactly what was journaled.
 * Both are idempotent; neither throws.
 */
export function beginPublicationAssetScope() {
  const files = [];
  const dirs = [];
  let closed = false;

  return {
    /** Marker used to reject a missing/foreign scope at the pinning boundary. */
    isPublicationAssetScope: true,
    get stagedFileCount() {
      return files.length;
    },
    /** Paths of this attempt, relative to the releases root (for quarantine follow-up). */
    stagedPaths() {
      return files.map(reportable);
    },
    recordFile(absPath) {
      if (!closed && absPath) files.push(String(absPath));
    },
    recordDir(absPath) {
      if (!closed && absPath) dirs.push(String(absPath));
    },
    commit() {
      if (closed) return null;
      closed = true;
      if (files.length) {
        console.info(`PUBLICATION_ASSET_COMMIT files=${files.length} dirs=${dirs.length}`);
      }
      return { committed: true, files: files.length };
    },
    rollback() {
      if (closed) return null;
      closed = true;
      if (!files.length && !dirs.length) return { removedFiles: 0, removedDirs: 0, failures: [] };
      const failures = [];
      let removedFiles = 0;
      for (const abs of [...files].reverse()) {
        const res = removeStagedFile(abs);
        if (res.ok) {
          if (res.reason !== "already_absent") removedFiles += 1;
        } else {
          failures.push({ path: reportable(abs), reason: res.reason });
        }
      }
      let removedDirs = 0;
      for (const abs of [...dirs].reverse()) {
        const res = removeStagedDir(abs);
        if (res.ok) {
          if (res.reason !== "already_absent") removedDirs += 1;
        } else {
          failures.push({ path: reportable(abs), reason: res.reason });
        }
      }
      if (failures.length) {
        console.error(
          `PUBLICATION_ASSET_ROLLBACK_FAIL removed=${removedFiles} `
          + `remaining=${JSON.stringify(failures)}`,
        );
      } else {
        console.warn(`PUBLICATION_ASSET_ROLLBACK files=${removedFiles} dirs=${removedDirs}`);
      }
      return { removedFiles, removedDirs, failures };
    },
  };
}

/** Throw unless a real scope was handed down the publication call chain. */
export function assertPublicationAssetScope(scope) {
  if (scope && scope.isPublicationAssetScope === true) return scope;
  const err = new Error("Publication asset scope is required to create release assets");
  err.code = "PUBLICATION_ASSET_SCOPE_REQUIRED";
  throw err;
}

/**
 * Test-only failure injection. Not reachable from any request body or route:
 * the setter is exported for tests and ignored unless NODE_ENV === "test".
 */
let injectedFailurePoint = null;

export function __setPublicationFailurePoint(name) {
  injectedFailurePoint = name || null;
}

/** Named point in the publication flow where a test may force a throw. */
export function publicationCheckpoint(name) {
  if (process.env.NODE_ENV !== "test") return;
  if (!injectedFailurePoint || injectedFailurePoint !== name) return;
  injectedFailurePoint = null;
  const err = new Error(`injected_publication_failure_at_${name}`);
  err.code = "INJECTED_PUBLICATION_FAILURE";
  throw err;
}
