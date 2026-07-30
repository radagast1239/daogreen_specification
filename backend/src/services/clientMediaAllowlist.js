/**
 * Bind client /media requests to frozen published-release assets.
 * Arbitrary remote/public URLs must not be fetchable with only a token.
 *
 * Version-aware sources:
 * - release_v4: imageManifest + item photo fields + document-adjacent image URLs in snapshot
 * - legacy/incomplete (release_v1, …): only URLs literally stored on frozen snapshot items/fields
 * Never reads live project, materials catalog, or later releases.
 */
import { flattenImageManifest } from "./projectScopedMedia.js";
import { uploadsRelativeFromUrl } from "./uploadValidation.js";

const PRIVATE_UPLOAD_PREFIXES = ["frame-drawings/", "releases/", "projects/"];

/**
 * Normalize a client media URL for exact membership checks.
 * Fail-closed: query/hash, backslashes, traversal, bad encoding, remote schemes for local match.
 */
export function canonicalizeClientMediaUrl(raw) {
  const s0 = String(raw || "").trim();
  if (!s0) return "";
  // Reject protocol-relative and exotic schemes early.
  if (/^\/\//.test(s0) || /^(?:file|data|javascript|blob):/i.test(s0)) return "";
  // Query/hash are not part of the frozen media contract.
  if (s0.includes("?") || s0.includes("#")) return "";
  // Backslash variants are not accepted (do not normalize into a match).
  if (s0.includes("\\") || s0.includes("\0")) return "";

  // Absolute http(s) — keep only for membership against frozen https entries (never served locally).
  if (/^https?:\/\//i.test(s0)) {
    let parsed;
    try {
      parsed = new URL(s0);
    } catch {
      return "";
    }
    if (parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    if (parsed.search || parsed.hash) return "";
    return parsed.toString();
  }

  if (!s0.startsWith("/uploads/")) return "";

  let pathOnly = s0;
  try {
    pathOnly = decodeURIComponent(pathOnly);
  } catch {
    return "";
  }
  // After one decode, reject residual encoded traversal / separators (double-encoding).
  if (/%2e|%2f|%5c/i.test(pathOnly)) return "";
  if (pathOnly.includes("\\") || pathOnly.includes("\0") || pathOnly.includes("?") || pathOnly.includes("#")) {
    return "";
  }
  const norm = pathOnly.replace(/\/{2,}/g, "/");
  if (!norm.startsWith("/uploads/")) return "";
  if (norm.split("/").includes("..")) return "";
  return norm;
}

function addUrl(set, raw) {
  const c = canonicalizeClientMediaUrl(raw);
  // Allowlist stores local upload paths only (remote https entries are never served via /media).
  if (c && c.startsWith("/uploads/")) set.add(c);
}

function addFromObject(set, obj) {
  if (!obj || typeof obj !== "object") return;
  addUrl(set, obj.imageUrl);
  addUrl(set, obj.photoUrl);
  addUrl(set, obj.photo);
  addUrl(set, obj.image);
  addUrl(set, obj.url);
  addUrl(set, obj.assetPath);
}

/**
 * Collect every frozen media URL from a parsed release snapshot (no live DB).
 */
export function collectFrozenClientMediaUrls(snapshot = {}) {
  const set = new Set();
  for (const it of Array.isArray(snapshot?.items) ? snapshot.items : []) {
    addFromObject(set, it);
  }
  for (const img of flattenImageManifest(snapshot?.imageManifest)) {
    addFromObject(set, img);
  }
  // Legacy / incomplete snapshots may store schemes directly on the object.
  for (const img of Array.isArray(snapshot?.projectSchemes) ? snapshot.projectSchemes : []) {
    addFromObject(set, img);
  }
  const meta = snapshot?.projectMeta;
  if (meta && typeof meta === "object") {
    addUrl(set, meta.photoUrl);
    addUrl(set, meta.imageUrl);
    for (const img of Array.isArray(meta.projectSchemes) ? meta.projectSchemes : []) {
      addFromObject(set, img);
    }
  }
  return set;
}

export function isUrlInFrozenClientMedia(rawUrl, snapshot) {
  const c = canonicalizeClientMediaUrl(rawUrl);
  if (!c || !c.startsWith("/uploads/")) return false;
  return collectFrozenClientMediaUrls(snapshot).has(c);
}

/**
 * Paths the legacy /media route may read from disk after allowlist membership.
 */
export function isClientMediaLocalServePath(rawUrl, projectId) {
  const c = canonicalizeClientMediaUrl(rawUrl);
  if (!c.startsWith("/uploads/")) return false;
  const rel = uploadsRelativeFromUrl(c);
  if (!rel) return false;
  if (rel === "public" || rel.startsWith("public/")) return true;
  const pid = String(projectId || "").trim();
  if (pid && (rel === `releases/${pid}` || rel.startsWith(`releases/${pid}/`))) {
    return true;
  }
  const blocked = PRIVATE_UPLOAD_PREFIXES.some(
    (p) => rel === p.slice(0, -1) || rel.startsWith(p),
  );
  return !blocked;
}
