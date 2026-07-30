import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { getAssetReferenceSnapshot } from "./storageInventoryService.js";
import {
  detectImageMagic,
  looksLikeSvg,
} from "./uploadValidation.js";

export const LEGACY_PUBLIC_UPLOAD_MIGRATION = "legacy-public-uploads-v1";
export const LEGACY_PUBLIC_COPY_TO_PUBLIC = "legacy-public-copy-to-public-v1";

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
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

function magicExt(magic) {
  if (magic === "jpeg") return ".jpg";
  if (magic === "png") return ".png";
  if (magic === "webp") return ".webp";
  return null;
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

function hashDestination(root, kind, sourceHash, magic) {
  const ext = magicExt(magic);
  if (!ext) {
    const error = new Error("Unknown image type");
    error.code = "LEGACY_UPLOAD_INVALID_MAGIC";
    throw error;
  }
  const folder = kind === "branding" ? "branding" : "materials";
  const relative = path.posix.join("public", "legacy", folder, `${sourceHash}${ext}`);
  const absolute = resolveInside(root, relative);
  let collision = false;
  if (fs.existsSync(absolute)) {
    if (sha256(absolute) !== sourceHash) {
      const error = new Error(`Unsafe destination collision: ${relative}`);
      error.code = "LEGACY_UPLOAD_COLLISION";
      throw error;
    }
    collision = true;
  }
  return { relative, absolute, collision };
}

function validateImageSource(source) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return { ok: false, reason: "SOURCE_MISSING" };
  }
  let realSource;
  try {
    realSource = fs.realpathSync(source);
  } catch {
    return { ok: false, reason: "SOURCE_MISSING" };
  }
  const realRoot = fs.realpathSync(path.dirname(source));
  // Symlink escape: realpath of file must stay under the resolved parent chain of UPLOAD_ROOT check done by caller.
  void realRoot;
  const head = Buffer.alloc(64);
  const fd = fs.openSync(source, "r");
  try {
    fs.readSync(fd, head, 0, 64, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (looksLikeSvg(head, { filename: source })) {
    return { ok: false, reason: "SVG_FORBIDDEN" };
  }
  const magic = detectImageMagic(head);
  if (!magic) {
    return { ok: false, reason: "INVALID_MAGIC" };
  }
  return { ok: true, magic, realSource };
}

/**
 * @param {{ db: any, uploadRoot: string, referenceLookup?: Function, mode?: "strict" | "copy-to-public" }} opts
 */
export function buildLegacyPublicUploadPlan({
  db,
  uploadRoot,
  referenceLookup = getAssetReferenceSnapshot,
  mode = "strict",
}) {
  const copyMode = mode === "copy-to-public";
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
      skipped.push({ ...candidate, reason: error.code || "LEGACY_UPLOAD_PATH_ESCAPE" });
      continue;
    }

    if (!copyMode) {
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
      let destination;
      try {
        destination = collisionDestination(uploadRoot, candidate.relative, sourceHash);
      } catch (error) {
        skipped.push({ ...candidate, reason: error.code || "LEGACY_UPLOAD_COLLISION" });
        continue;
      }
      actions.push({
        ...candidate,
        source,
        sourceHash,
        destination: destination.absolute,
        destinationRelative: destination.relative,
        destinationUrl: `/uploads/${destination.relative.replace(/\\/g, "/")}`,
        collision: destination.collision,
        mode: "strict",
      });
      continue;
    }

    // copy-to-public: require proven material and/or branding DB row; ignore private co-refs.
    if (!candidate.materialIds.length && !candidate.settingKeys.length) {
      skipped.push({ ...candidate, reason: "NO_MATERIAL_DB_REF" });
      continue;
    }

    const validated = validateImageSource(source);
    if (!validated.ok) {
      skipped.push({ ...candidate, reason: validated.reason });
      continue;
    }

    // Confirm realpath stays under upload root (symlink escape).
    try {
      const canonicalRoot = fs.realpathSync(path.resolve(uploadRoot));
      const prefix = canonicalRoot.endsWith(path.sep) ? canonicalRoot : `${canonicalRoot}${path.sep}`;
      if (validated.realSource !== canonicalRoot && !validated.realSource.startsWith(prefix)) {
        skipped.push({ ...candidate, reason: "LEGACY_UPLOAD_PATH_ESCAPE" });
        continue;
      }
    } catch {
      skipped.push({ ...candidate, reason: "LEGACY_UPLOAD_PATH_ESCAPE" });
      continue;
    }

    const sourceHash = sha256(source);
    const kind = candidate.materialIds.length ? "materials" : "branding";
    let destination;
    try {
      destination = hashDestination(uploadRoot, kind, sourceHash, validated.magic);
    } catch (error) {
      skipped.push({ ...candidate, reason: error.code || "LEGACY_UPLOAD_COLLISION" });
      continue;
    }

    actions.push({
      ...candidate,
      source,
      sourceHash,
      magic: validated.magic,
      destination: destination.absolute,
      destinationRelative: destination.relative,
      destinationUrl: `/uploads/${destination.relative.replace(/\\/g, "/")}`,
      collision: destination.collision,
      mode: "copy-to-public",
      // Only rewrite materials.photo_url / branding settings — never project/docs/release refs.
      updateMaterialsOnly: true,
    });
  }

  return {
    migration: copyMode ? LEGACY_PUBLIC_COPY_TO_PUBLIC : LEGACY_PUBLIC_UPLOAD_MIGRATION,
    mode: copyMode ? "copy-to-public" : "strict",
    actions,
    skipped,
  };
}

function copyAtomicVerified(source, destination, expectedHash) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    if (sha256(destination) !== expectedHash) {
      const error = new Error("Destination collision with different content");
      error.code = "LEGACY_UPLOAD_COLLISION";
      throw error;
    }
    return { created: false };
  }
  const tmp = `${destination}.tmp.${process.pid}.${Date.now()}`;
  fs.copyFileSync(source, tmp);
  const fd = fs.openSync(tmp, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const stat = fs.statSync(tmp);
  const sourceStat = fs.statSync(source);
  if (stat.size !== sourceStat.size) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    const error = new Error("Copied asset size mismatch");
    error.code = "LEGACY_UPLOAD_COPY_VERIFY_FAILED";
    throw error;
  }
  if (sha256(tmp) !== expectedHash) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    const error = new Error("Copied asset verification failed");
    error.code = "LEGACY_UPLOAD_COPY_VERIFY_FAILED";
    throw error;
  }
  fs.renameSync(tmp, destination);
  return { created: true };
}

export function runLegacyPublicUploadMigration({
  db,
  uploadRoot,
  dryRun = true,
  createVerifiedBackup,
  referenceLookup,
  failAfterCopy = false,
  mode = "strict",
}) {
  const plan = buildLegacyPublicUploadPlan({ db, uploadRoot, referenceLookup, mode });
  if (dryRun || plan.actions.length === 0) {
    return {
      ...plan,
      dryRun: true,
      applied: 0,
      counts: {
        actions: plan.actions.length,
        skipped: plan.skipped.length,
        applied: 0,
      },
    };
  }
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
      const result = copyAtomicVerified(action.source, action.destination, action.sourceHash);
      if (result.created) created.push(action.destination);
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
    return {
      ...plan,
      dryRun: false,
      applied: plan.actions.length,
      backup,
      counts: {
        actions: plan.actions.length,
        skipped: plan.skipped.length,
        applied: plan.actions.length,
      },
    };
  } catch (error) {
    for (const file of created.reverse()) {
      try { fs.unlinkSync(file); } catch { /* best-effort rollback */ }
    }
    throw error;
  }
}

export const __test = {
  normalizeLegacyUrl,
  resolveInside,
  allowedPublicReferences,
  sha256,
  sha256Buffer,
  validateImageSource,
  magicExt,
};
