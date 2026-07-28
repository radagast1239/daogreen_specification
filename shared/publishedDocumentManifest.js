/**
 * Client-safe document entries for published release snapshots.
 * No absolute FS paths, secrets, or admin-only comments.
 */

const SAFE_DRAWING_KEYS = [
  "drawingTitle",
  "title",
  "drawingSourceType",
  "stellageId",
  "moduleId",
  "moduleRackKey",
  "presetId",
  "drawingVersion",
  "rackType",
];

function safeStr(v) {
  return v == null ? "" : String(v);
}

/**
 * Normalize a live client document row into a release manifest entry.
 * @param {object} doc
 * @param {object} [overrides] pinned url / sha / size
 */
export function buildDocumentManifestEntry(doc = {}, overrides = {}) {
  const id = safeStr(doc.id || overrides.id).trim();
  if (!id) return null;
  const url = safeStr(overrides.url ?? doc.url).trim();
  if (!url.startsWith("/uploads/")) return null;

  const entry = {
    id,
    sourceFileId: safeStr(overrides.sourceFileId ?? doc.sourceFileId ?? doc.id).trim() || id,
    type: safeStr(doc.type || overrides.type || "file"),
    filename: safeStr(overrides.filename ?? doc.filename),
    url,
    uploadedAt: safeStr(overrides.uploadedAt ?? doc.uploadedAt),
  };

  const mime = safeStr(overrides.mime ?? doc.mime ?? doc.mimeType);
  if (mime) entry.mime = mime;

  if (overrides.size != null && Number.isFinite(Number(overrides.size))) {
    entry.size = Number(overrides.size);
  } else if (doc.size != null && Number.isFinite(Number(doc.size))) {
    entry.size = Number(doc.size);
  }

  const sha = safeStr(overrides.sha256 ?? doc.sha256);
  if (sha) entry.sha256 = sha;

  for (const key of SAFE_DRAWING_KEYS) {
    const val = overrides[key] ?? doc[key];
    if (val != null && String(val).trim() !== "") entry[key] = val;
  }
  if (entry.drawingTitle && !entry.title) entry.title = entry.drawingTitle;
  if (entry.title && !entry.drawingTitle) entry.drawingTitle = entry.title;

  return entry;
}

/** Normalize an array of raw/manifest docs into safe client-facing rows. */
export function normalizeDocumentManifest(raw = []) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    const entry = buildDocumentManifestEntry(row);
    if (!entry) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
