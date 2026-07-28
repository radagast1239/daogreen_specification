import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { getAssetReferenceSnapshot } from "./storageInventoryService.js";

export const LEGACY_PUBLIC_UPLOAD_MIGRATION = "legacy-public-uploads-v1";

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normalizeLegacyUrl(value) {
  const url = String(value || "").replace(/\\/g, "/").trim();
  if (!url.startsWith("/uploads/") || url.startsWith("/uploads/public/")) return null;
  const relative = url.slice("/uploads/".length);
  if (!relative || relative.includes("..") || path.posix.isAbsolute(relative)) return null;
  return { url, relative };
}

function resolveInside(root, relative) {
  const canonicalRoot = path.resolve(root);
  const absolute = path.resolve(canonicalRoot, ...String(relative).replace(/\\/g, "/").split("/"));
  const prefix = canonicalRoot.endsWith(path.sep) ? canonicalRoot : `${canonicalRoot}${path.sep}`;
  if (absolute === canonicalRoot || !absolute.startsWith(prefix)) {
    const error = new Error("Upload path escapes canonical UPLOAD_ROOT");
    error.code = "LEGACY_UPLOAD_PATH_ESCAPE";
    throw error;
  }
  return absolute;
}

function allowedPublicReferences(snapshot) {
  const refs = snapshot?.references || [];
  return refs.length > 0 && refs.every((ref) => {
    const type = String(ref?.referenceType || "").toLowerCase();
    return type.includes("material") || type.includes("branding");
  });
}

function collisionDestination(root, relative, sourceHash) {
  const parsed = path.posix.parse(relative);
  const preferredRel = path.posix.join("public", "legacy", relative);
  const preferred = resolveInside(root, preferredRel);
  if (!fs.existsSync(preferred) || sha256(preferred) === sourceHash) {
    return { relative: preferredRel, absolute: preferred, collision: false };
  }
  const suffixed = `${parsed.name}-${sourceHash.slice(0, 12)}${parsed.ext}`;
  const rel = path.posix.join("public", "legacy", parsed.dir, suffixed);
  const absolute = resolveInside(root, rel);
  if (fs.existsSync(absolute) && sha256(absolute) !== sourceHash) {
    const error = new Error(`Unsafe destination collision: ${rel}`);
    error.code = "LEGACY_UPLOAD_COLLISION";
    throw error;
  }
  return { relative: rel, absolute, collision: true };
}

export function buildLegacyPublicUploadPlan({ db, uploadRoot, referenceLookup = getAssetReferenceSnapshot }) {
  const candidates = new Map();
  for (const row of db.prepare(
    "SELECT id, photo_url AS url FROM materials WHERE photo_url LIKE '/uploads/%'"
  ).all()) {
    const parsed = normalizeLegacyUrl(row.url);
    if (parsed) {
      const item = candidates.get(parsed.url) || { ...parsed, materialIds: [], settingKeys: [] };
      item.materialIds.push(row.id);
      candidates.set(parsed.url, item);
    }
  }
  const logo = db.prepare("SELECT key, value AS url FROM settings WHERE key = 'logoUrl'").get();
  const parsedLogo = normalizeLegacyUrl(logo?.url);
  if (parsedLogo) {
    const item = candidates.get(parsedLogo.url) || { ...parsedLogo, materialIds: [], settingKeys: [] };
    item.settingKeys.push(logo.key);
    candidates.set(parsedLogo.url, item);
  }

  const actions = [];
  const skipped = [];
  for (const candidate of candidates.values()) {
    let source;
    try {
      source = resolveInside(uploadRoot, candidate.relative);
    } catch (error) {
      skipped.push({ ...candidate, reason: error.code });
      continue;
    }
    const references = referenceLookup(candidate.url);
    if (!allowedPublicReferences(references)) {
      skipped.push({ ...candidate, reason: "PRIVATE_OR_AMBIGUOUS_REFERENCE" });
      continue;
    }
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      skipped.push({ ...candidate, reason: "SOURCE_MISSING" });
      continue;
    }
    const sourceHash = sha256(source);
    const destination = collisionDestination(uploadRoot, candidate.relative, sourceHash);
    actions.push({
      ...candidate,
      source,
      sourceHash,
      destination: destination.absolute,
      destinationRelative: destination.relative,
      destinationUrl: `/uploads/${destination.relative.replace(/\\/g, "/")}`,
      collision: destination.collision,
    });
  }
  return { migration: LEGACY_PUBLIC_UPLOAD_MIGRATION, actions, skipped };
}

export function runLegacyPublicUploadMigration({
  db,
  uploadRoot,
  dryRun = true,
  createVerifiedBackup,
  referenceLookup,
  failAfterCopy = false,
}) {
  const plan = buildLegacyPublicUploadPlan({ db, uploadRoot, referenceLookup });
  if (dryRun || plan.actions.length === 0) return { ...plan, dryRun: true, applied: 0 };
  if (typeof createVerifiedBackup !== "function") {
    const error = new Error("Verified backup callback is required before migration");
    error.code = "LEGACY_UPLOAD_BACKUP_REQUIRED";
    throw error;
  }
  const backup = createVerifiedBackup();
  if (!backup?.ok) {
    const error = new Error("Verified backup failed");
    error.code = "LEGACY_UPLOAD_BACKUP_REQUIRED";
    throw error;
  }

  const created = [];
  try {
    for (const action of plan.actions) {
      fs.mkdirSync(path.dirname(action.destination), { recursive: true });
      if (!fs.existsSync(action.destination)) {
        fs.copyFileSync(action.source, action.destination, fs.constants.COPYFILE_EXCL);
        created.push(action.destination);
      }
      if (sha256(action.destination) !== action.sourceHash) {
        const error = new Error("Copied asset verification failed");
        error.code = "LEGACY_UPLOAD_COPY_VERIFY_FAILED";
        throw error;
      }
    }
    if (failAfterCopy) throw new Error("Injected migration failure");

    const updateRows = () => {
      for (const action of plan.actions) {
        for (const id of action.materialIds) {
          db.prepare("UPDATE materials SET photo_url = ? WHERE id = ? AND photo_url = ?")
            .run(action.destinationUrl, id, action.url);
        }
        for (const key of action.settingKeys) {
          db.prepare("UPDATE settings SET value = ? WHERE key = ? AND value = ?")
            .run(action.destinationUrl, key, action.url);
        }
      }
    };
    if (typeof db.transaction === "function") {
      db.transaction(updateRows)();
    } else {
      db.exec("BEGIN IMMEDIATE");
      try {
        updateRows();
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
        throw error;
      }
    }
    return { ...plan, dryRun: false, applied: plan.actions.length, backup };
  } catch (error) {
    for (const file of created.reverse()) {
      try { fs.unlinkSync(file); } catch { /* best-effort rollback */ }
    }
    throw error;
  }
}

export const __test = { normalizeLegacyUrl, resolveInside, allowedPublicReferences, sha256 };
