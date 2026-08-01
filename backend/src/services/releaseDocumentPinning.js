/**
 * Pin client-visible project documents into uploads/releases/{projectId}/{versionId}/.
 * Fail-closed per file: missing sources are omitted (not borrowed from other projects).
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { buildDocumentManifestEntry } from "../../../shared/publishedDocumentManifest.js";
import { resolveUploadRoot } from "./uploadRoot.js";
import { uploadsRelativeFromUrl } from "./uploadValidation.js";
import {
  assertPublicationAssetScope,
  publicationCheckpoint,
} from "./publicationAssetStage.js";

export { resolveUploadRoot };

function sanitizeFileName(name, fallback = "file") {
  const base = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return base || fallback;
}

function sha256File(absPath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(absPath));
  return hash.digest("hex");
}

/**
 * Copy each live client document into the release folder and build manifest entries.
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.versionId
 * @param {object[]} opts.liveDocuments from getClientProjectDocuments
 * @param {string} [opts.uploadRoot]
 * @returns {{ documentManifest: object[], pinnedCount: number, skippedCount: number }}
 */
export function pinClientDocumentsForRelease({
  projectId,
  versionId,
  liveDocuments = [],
  uploadRoot = resolveUploadRoot(),
  assetScope = null,
} = {}) {
  // Explicit scope only: a write path must never journal into nothing.
  const scope = assertPublicationAssetScope(assetScope);
  const pid = String(projectId || "").trim();
  const vid = String(versionId || "").trim();
  if (!pid || !vid) {
    return { documentManifest: [], pinnedCount: 0, skippedCount: (liveDocuments || []).length };
  }

  const releaseDir = path.join(uploadRoot, "releases", pid, vid);
  // Fail closed: a version directory that already exists belongs to another
  // attempt or an earlier release. Never merge, overwrite or reuse it.
  if (fs.existsSync(releaseDir)) {
    const err = new Error("Release asset directory already exists");
    err.code = "RELEASE_ASSET_DIR_EXISTS";
    throw err;
  }
  fs.mkdirSync(releaseDir, { recursive: true });
  scope.recordDir(releaseDir);
  console.info(`PUBLICATION_ASSET_STAGE_CREATED project=${pid} version=${vid}`);

  const documentManifest = [];
  let pinnedCount = 0;
  let skippedCount = 0;
  const usedNames = new Set();

  for (const doc of liveDocuments || []) {
    const rel = uploadsRelativeFromUrl(doc?.url);
    if (!rel) {
      skippedCount++;
      continue;
    }
    // Never pin files that already live under another project's release tree as "source"
    // unless they belong to this project's live /uploads path (checked via abs existence).
    const srcAbs = path.join(uploadRoot, rel);
    if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
      skippedCount++;
      continue;
    }

    const ext = path.extname(srcAbs) || path.extname(doc.filename || "") || "";
    let safeName = sanitizeFileName(doc.filename || path.basename(srcAbs), `doc-${doc.id || "x"}`);
    if (ext && !safeName.toLowerCase().endsWith(ext.toLowerCase())) {
      safeName = `${safeName}${ext}`;
    }
    let unique = safeName;
    let n = 1;
    while (usedNames.has(unique.toLowerCase())) {
      const stem = safeName.slice(0, Math.max(1, safeName.length - ext.length));
      unique = `${stem}-${n}${ext}`;
      n += 1;
    }
    usedNames.add(unique.toLowerCase());

    const destAbs = path.join(releaseDir, unique);
    // Journal before the write: a partially written file is still owned.
    scope.recordFile(destAbs);
    publicationCheckpoint(pinnedCount === 0 ? "before_first_document_copy" : "before_next_document_copy");
    fs.copyFileSync(srcAbs, destAbs);
    publicationCheckpoint(pinnedCount === 0 ? "after_first_document_copy" : "after_next_document_copy");

    let sha256 = "";
    let size = 0;
    try {
      const st = fs.statSync(destAbs);
      size = st.size;
      sha256 = sha256File(destAbs);
    } catch {
      /* optional */
    }

    const pinnedUrl = `/uploads/releases/${pid}/${vid}/${unique}`.replace(/\\/g, "/");
    const entry = buildDocumentManifestEntry(doc, {
      sourceFileId: doc.id,
      url: pinnedUrl,
      filename: unique,
      size,
      sha256,
      uploadedAt: doc.uploadedAt,
    });
    if (!entry) {
      skippedCount++;
      continue;
    }
    documentManifest.push(entry);
    pinnedCount++;
  }

  return { documentManifest, pinnedCount, skippedCount };
}
