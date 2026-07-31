/**
 * Published asset hashing + retention guards (filesystem + DB).
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { db } from "../db.js";
import {
  collectPinnedAssetUrlsFromSnapshot,
  isLocalUploadUrl,
  normalizeUploadUrl,
  normalizePinnedFrameDrawings,
} from "../../../shared/publishedAssetPin.js";
import {
  activeStellageIdSet,
  frameDrawingClientTargetKey,
  selectLatestFrameDocuments,
  applyStellageNamesToFrameDocuments,
  stellageNameById,
} from "../../../shared/clientFrameDocuments.js";
import { applyImageAssetMeta, buildClientImageManifest } from "../../../shared/clientImageManifest.js";
import { parseReleaseSnapshot } from "../../../shared/projectPublishedRelease.js";
import { localUploadDir } from "../storage/index.js";

function loadStellageConfigsForProject(projectId) {
  const row = db.prepare("SELECT stellage_configs FROM projects WHERE id = ?").get(projectId);
  if (!row) return [];
  try {
    return JSON.parse(row.stellage_configs || "[]");
  } catch {
    return [];
  }
}

function loadActiveStellageIdsForProject(projectId) {
  return activeStellageIdSet(loadStellageConfigsForProject(projectId));
}

/**
 * Persist current stellage names onto frame_drawings.title so republish freezes the right labels.
 * @returns {number} rows updated
 */
export function syncFrameDrawingTitlesFromStellageConfigs(projectId) {
  const names = stellageNameById(loadStellageConfigsForProject(projectId));
  if (!names.size) return 0;
  const stmt = db.prepare(`
    UPDATE frame_drawings
    SET title = ?, updated_at = datetime('now')
    WHERE project_id = ? AND stellage_id = ? AND IFNULL(title, '') != ?
  `);
  let changed = 0;
  for (const [stellageId, name] of names) {
    const r = stmt.run(name, projectId, stellageId, name);
    changed += Number(r.changes) || 0;
  }
  return changed;
}

/** Same resolved root as saveFile + express.static /uploads. */
export function getUploadRoot() {
  return localUploadDir();
}

export function resolveLocalUploadAbsPath(url) {
  const normalized = normalizeUploadUrl(url);
  if (!normalized.startsWith("/uploads/")) return null;
  const rel = normalized.replace(/^\/uploads\/?/, "").replace(/\\/g, "/");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) return null;
  const root = path.resolve(getUploadRoot());
  const abs = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

export function hashLocalUploadFile(url) {
  const abs = resolveLocalUploadAbsPath(url);
  if (!abs) {
    return { ok: false, reason: "not_local_upload", url };
  }
  if (!fs.existsSync(abs)) {
    return { ok: false, reason: "missing_file", url, abs };
  }
  const buf = fs.readFileSync(abs);
  const contentHash = createHash("sha256").update(buf).digest("hex");
  const ext = path.extname(abs).toLowerCase();
  let mimeType = "application/octet-stream";
  if (ext === ".png") mimeType = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
  else if (ext === ".webp") mimeType = "image/webp";
  else if (ext === ".gif") mimeType = "image/gif";
  else if (ext === ".pdf") mimeType = "application/pdf";
  return {
    ok: true,
    url: normalizeUploadUrl(url),
    assetPath: normalizeUploadUrl(url),
    contentHash,
    sizeBytes: buf.length,
    mimeType,
    abs,
  };
}

export function publishAssetError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

/**
 * Hash all local /uploads/ URLs in image manifest.
 * External https URLs are allowed without hash.
 * Missing local files fail publish.
 */
export function enrichImageManifestForPublish(project) {
  const base = buildClientImageManifest(project);
  const metaByUrl = new Map();
  const missing = [];
  for (const img of [...base.projectSchemes, ...base.rackImages]) {
    const url = String(img.url || "");
    if (!isLocalUploadUrl(url)) {
      metaByUrl.set(url, {
        contentHash: "",
        sizeBytes: 0,
        mimeType: img.mimeType || "image/*",
        assetPath: url,
      });
      continue;
    }
    const hashed = hashLocalUploadFile(url);
    if (!hashed.ok) {
      missing.push({ url, reason: hashed.reason });
      continue;
    }
    metaByUrl.set(url, hashed);
  }
  if (missing.length) {
    throw publishAssetError(
      "PUBLISH_ASSET_MISSING",
      "Не найдены файлы схем/изображений для публикации",
      { missing },
    );
  }
  return applyImageAssetMeta(base, metaByUrl);
}

/**
 * Latest client-visible frame drawings for a project (same target rules as getClientProjectDocuments).
 */
export function listLatestClientVisibleFrameDrawings(projectId) {
  const documents = db.prepare(`
    SELECT
      f.id as fileId,
      f.type,
      f.filename,
      f.url,
      f.uploaded_at as uploadedAt,
      fd.id as drawingId,
      fd.title as drawingTitle,
      fd.source_type as drawingSourceType,
      fd.stellage_id as stellageId,
      fd.module_id as moduleId,
      fd.module_rack_key as moduleRackKey,
      fd.preset_id as presetId,
      fd.version as drawingVersion,
      fd.rack_type as rackType,
      fd.created_at as createdAt,
      fd.pdf_filename as pdfFilename,
      fd.pdf_url as pdfUrl
    FROM files f
    LEFT JOIN frame_drawings fd ON fd.file_id = f.id
    WHERE f.project_id = ?
      AND f.type = 'frame_drawing'
      AND fd.id IS NOT NULL
      AND fd.is_client_visible = 1
    ORDER BY f.uploaded_at DESC
  `).all(projectId);

  return applyStellageNamesToFrameDocuments(
    selectLatestFrameDocuments(documents, {
      activeStellageIds: loadActiveStellageIdsForProject(projectId),
    }),
    loadStellageConfigsForProject(projectId),
  );
}

export function buildPinnedFrameDrawingsForPublish(projectId) {
  const latest = listLatestClientVisibleFrameDrawings(projectId);
  const pins = [];
  const missing = [];
  for (const doc of latest) {
    const url = String(doc.pdfUrl || doc.url || "");
    const hashed = hashLocalUploadFile(url);
    if (!hashed.ok) {
      missing.push({ url, drawingId: doc.drawingId, reason: hashed.reason });
      continue;
    }
    pins.push({
      drawingId: doc.drawingId,
      drawingVersion: Number(doc.drawingVersion) || 0,
      targetKey: frameDrawingClientTargetKey(doc),
      stellageId: doc.stellageId || "",
      moduleId: doc.moduleId || "",
      moduleRackKey: doc.moduleRackKey || "",
      presetId: doc.presetId || "",
      title: doc.drawingTitle || "",
      url: hashed.url,
      pdfFilename: doc.pdfFilename || doc.filename || "",
      createdAt: doc.createdAt || doc.uploadedAt || "",
      contentHash: hashed.contentHash,
      sizeBytes: hashed.sizeBytes,
      mimeType: "application/pdf",
      fileId: doc.fileId || "",
    });
  }
  if (missing.length) {
    throw publishAssetError(
      "PUBLISH_ASSET_MISSING",
      "Не найдены PDF чертежей каркаса для публикации",
      { missing },
    );
  }
  return normalizePinnedFrameDrawings(pins);
}

function iteratePublishedSnapshots() {
  const rows = db.prepare("SELECT id, project_id, version_number, snapshot FROM spec_versions").all();
  return rows.map((row) => {
    let parsed = null;
    try {
      parsed = parseReleaseSnapshot(JSON.parse(row.snapshot || "[]"));
    } catch {
      parsed = null;
    }
    return { ...row, parsed };
  });
}

/** Find published snapshot references to a local upload URL or drawing id. */
export function findPublishedAssetReferences({ url = "", drawingId = "" } = {}) {
  const wantUrl = normalizeUploadUrl(url);
  const wantDrawing = String(drawingId || "").trim();
  const refs = [];
  for (const row of iteratePublishedSnapshots()) {
    if (!row.parsed) continue;
    const urls = collectPinnedAssetUrlsFromSnapshot(row.parsed);
    const hitUrl = wantUrl && urls.includes(wantUrl);
    const hitDrawing =
      wantDrawing &&
      (row.parsed.pinnedFrameDrawings || []).some(
        (p) => String(p.drawingId || "") === wantDrawing || String(p.fileId || "") === wantDrawing,
      );
    // Also scan image urls even if collect missed (normalized)
    let hitImage = false;
    if (wantUrl) {
      for (const img of [
        ...(row.parsed.imageManifest?.projectSchemes || []),
        ...(row.parsed.imageManifest?.rackImages || []),
      ]) {
        if (normalizeUploadUrl(img.url) === wantUrl) hitImage = true;
      }
      for (const pin of row.parsed.pinnedFrameDrawings || []) {
        if (normalizeUploadUrl(pin.url || pin.pdfUrl) === wantUrl) hitImage = true;
      }
      // Legacy: scan snapshot JSON string for url substring as last resort for v2 without pins
      if (!hitUrl && !hitImage && String(row.snapshot || "").includes(wantUrl)) {
        hitImage = true;
      }
    }
    if (hitUrl || hitDrawing || hitImage) {
      refs.push({
        versionId: row.id,
        projectId: row.project_id,
        versionNumber: row.version_number,
      });
    }
  }
  return refs;
}

export function isAssetPinnedByPublishedRelease({ url = "", drawingId = "" } = {}) {
  return findPublishedAssetReferences({ url, drawingId }).length > 0;
}

export function assertCanDeleteOrOverwriteAsset({ url = "", drawingId = "" } = {}) {
  const refs = findPublishedAssetReferences({ url, drawingId });
  if (!refs.length) return;
  throw publishAssetError(
    "ASSET_PINNED_BY_RELEASE",
    "Файл закреплён опубликованным релизом и не может быть удалён или перезаписан",
    { refs, url: normalizeUploadUrl(url), drawingId },
  );
}

/**
 * Delete a local /uploads file after retention check.
 * Returns { deleted: boolean, url }.
 */
export function deleteLocalUploadFile(url) {
  const normalized = normalizeUploadUrl(url);
  assertCanDeleteOrOverwriteAsset({ url: normalized });
  const abs = resolveLocalUploadAbsPath(normalized);
  if (!abs) {
    throw publishAssetError("INVALID_UPLOAD_URL", "Некорректный путь uploads", { url: normalized });
  }
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
    return { deleted: true, url: normalized };
  }
  return { deleted: false, url: normalized };
}
