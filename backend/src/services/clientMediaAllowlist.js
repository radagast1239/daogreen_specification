/**
 * Bind client /media requests to frozen published-release assets.
 * Arbitrary remote/public URLs must not be fetchable with only a token.
 */
import { flattenImageManifest } from "./projectScopedMedia.js";
import { uploadsRelativeFromUrl } from "./uploadValidation.js";

/** Normalize a client media URL for exact membership checks. */
export function canonicalizeClientMediaUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  if (s.startsWith("/uploads/")) {
    let pathOnly = s.split("?")[0].split("#")[0];
    try {
      pathOnly = decodeURIComponent(pathOnly);
    } catch {
      return "";
    }
    const norm = pathOnly.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    if (!norm.startsWith("/uploads/")) return "";
    if (norm.includes("\0") || norm.split("/").includes("..")) return "";
    return norm;
  }

  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  if (parsed.username || parsed.password) return "";
  parsed.hash = "";
  return parsed.toString();
}

function addUrl(set, raw) {
  const c = canonicalizeClientMediaUrl(raw);
  if (c) set.add(c);
}

/**
 * Collect every client-visible media URL frozen into a release snapshot.
 * Includes purchase-item photos and imageManifest entries (already filtered at publish).
 */
export function collectFrozenClientMediaUrls(snapshot = {}) {
  const set = new Set();
  for (const it of Array.isArray(snapshot?.items) ? snapshot.items : []) {
    addUrl(set, it?.imageUrl);
    addUrl(set, it?.photoUrl);
  }
  for (const img of flattenImageManifest(snapshot?.imageManifest)) {
    addUrl(set, img?.url);
    addUrl(set, img?.assetPath);
  }
  return set;
}

export function isUrlInFrozenClientMedia(rawUrl, snapshot) {
  const c = canonicalizeClientMediaUrl(rawUrl);
  if (!c) return false;
  return collectFrozenClientMediaUrls(snapshot).has(c);
}

/**
 * Paths the legacy /media route may read from disk after allowlist membership.
 * Scoped /images and /files remain the path for private project/release prefixes.
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
  // Legacy catalog material photos (e.g. /uploads/m003.png) — never private prefixes.
  const privatePrefixes = ["frame-drawings/", "releases/", "projects/"];
  const blocked = privatePrefixes.some((p) => rel === p.slice(0, -1) || rel.startsWith(p));
  return !blocked;
}
