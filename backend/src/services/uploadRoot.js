/**
 * Canonical upload root resolution and production fail-closed gate.
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** backend/ — package tree that must not hold production uploads */
export function backendPackageRoot() {
  return path.resolve(__dirname, "../..");
}

/** Default local uploads dir (dev/test only): backend/uploads */
export function defaultUploadRoot() {
  return path.join(backendPackageRoot(), "uploads");
}

export function isPathInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve UPLOAD_ROOT from env, or (non-production) default backend/uploads.
 * In production without UPLOAD_ROOT, returns null — assertUploadRootForStartup must reject.
 */
export function resolveUploadRoot(env = process.env) {
  const raw = env.UPLOAD_ROOT != null ? String(env.UPLOAD_ROOT).trim() : "";
  if (raw) return path.resolve(raw);
  if (env.NODE_ENV === "production") return null;
  return defaultUploadRoot();
}

/**
 * Production: require absolute UPLOAD_ROOT outside the backend package tree.
 * Dev/test: allow default backend/uploads.
 * @returns {string} resolved absolute upload root
 */
export function assertUploadRootForStartup(env = process.env) {
  if (env.NODE_ENV !== "production") {
    const root = resolveUploadRoot(env);
    if (!root) {
      const err = new Error("UPLOAD_ROOT could not be resolved");
      err.code = "UPLOAD_ROOT_MISSING";
      throw err;
    }
    return root;
  }

  const raw = env.UPLOAD_ROOT != null ? String(env.UPLOAD_ROOT).trim() : "";
  if (!raw) {
    const err = new Error(
      "UPLOAD_ROOT is required in production (absolute path outside the application package)",
    );
    err.code = "UPLOAD_ROOT_REQUIRED";
    throw err;
  }
  if (!path.isAbsolute(raw)) {
    const err = new Error("UPLOAD_ROOT must be an absolute path in production");
    err.code = "UPLOAD_ROOT_NOT_ABSOLUTE";
    throw err;
  }

  const resolved = path.resolve(raw);
  const pkgRoot = backendPackageRoot();
  if (isPathInside(resolved, pkgRoot)) {
    const err = new Error(
      "UPLOAD_ROOT must not be inside the backend package directory in production",
    );
    err.code = "UPLOAD_ROOT_IN_PACKAGE";
    throw err;
  }

  // Reject if path sits under a sibling "releases/<id>" that contains this package
  // (typical deploy layout: .../releases/<id>/backend).
  let cursor = path.resolve(pkgRoot);
  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    if (path.basename(parent).toLowerCase() === "releases") {
      const releaseRoot = cursor; // .../releases/<id>
      if (isPathInside(resolved, releaseRoot)) {
        const err = new Error(
          "UPLOAD_ROOT must not be stored inside an application release directory",
        );
        err.code = "UPLOAD_ROOT_IN_RELEASE";
        throw err;
      }
      break;
    }
    cursor = parent;
  }

  return resolved;
}
