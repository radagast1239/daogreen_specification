/**
 * Storage orphan quarantine — move only confirmed pure ORPHANs.
 * No permanent delete. No duplicate handling.
 */
import fs from "fs";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { getUploadRoot, resolveLocalUploadAbsPath } from "./publishedAssetRetention.js";
import { normalizeUploadUrl, isLocalUploadUrl } from "../../../shared/publishedAssetPin.js";
import {
  getAssetReferenceSnapshot,
  getLastStorageInventory,
  streamSha256,
} from "./storageInventoryService.js";
import {
  QUARANTINE_CONFIRM_PHRASE,
  QUARANTINE_STATUSES,
  PREVIEW_TOKEN_TTL_MS,
  quarantineMinAgeDays,
  evaluateQuarantineEligibility,
  sanitizeQuarantineRow,
  isBlockedServiceFilename,
} from "../../../shared/storageQuarantine.js";

const previewTokens = new Map();

function quarantineError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.status = code.startsWith("STORAGE_") && /CHANGED|REFERENCED|TOKEN|CONFLICT|EXISTS/.test(code) ? 409 : 400;
  if (code === "UNAUTHORIZED") err.status = 401;
  if (code === "NOT_FOUND") err.status = 404;
  return err;
}

export function getQuarantineRoot() {
  if (process.env.STORAGE_QUARANTINE_ROOT) {
    return path.resolve(process.env.STORAGE_QUARANTINE_ROOT);
  }
  const uploadRoot = path.resolve(getUploadRoot());
  return path.join(path.dirname(uploadRoot), "quarantine");
}

function ensureQuarantineRoot() {
  const root = getQuarantineRoot();
  fs.mkdirSync(root, { recursive: true });
  const uploadRoot = path.resolve(getUploadRoot());
  let uploadReal = uploadRoot;
  let qReal = root;
  try {
    uploadReal = fs.realpathSync(uploadRoot);
  } catch {
    /* ignore */
  }
  try {
    qReal = fs.realpathSync(root);
  } catch {
    /* ignore */
  }
  const uploadSep = uploadReal.endsWith(path.sep) ? uploadReal : uploadReal + path.sep;
  if (qReal === uploadReal || qReal.startsWith(uploadSep)) {
    throw quarantineError(
      "STORAGE_QUARANTINE_ROOT_INVALID",
      "Карантин не может находиться внутри UPLOAD_ROOT"
    );
  }
  return root;
}

function assertInsideRoot(abs, root) {
  const resolved = path.resolve(abs);
  const r = path.resolve(root);
  const sep = r.endsWith(path.sep) ? r : r + path.sep;
  if (resolved !== r && !resolved.startsWith(sep)) {
    throw quarantineError("STORAGE_PATH_ESCAPE", "Путь вне разрешённого корня");
  }
  return resolved;
}

function mimeFromExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  if (e === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function logEvent({ action, actor, assetPath, quarantineId, contentHash, sizeBytes, result, detail }) {
  db.prepare(
    `INSERT INTO storage_quarantine_events
      (id, action, actor, created_at, asset_path, quarantine_id, content_hash, size_bytes, result, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nanoid(12),
    action,
    actor || "",
    new Date().toISOString(),
    assetPath || "",
    quarantineId || null,
    contentHash || "",
    Number(sizeBytes) || 0,
    result || "",
    JSON.stringify(detail || {})
  );
}

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [k, v] of previewTokens) {
    if (!v || v.expiresAt <= now) previewTokens.delete(k);
  }
}

function fingerprintCandidate(c) {
  return [c.assetPath, c.contentHash, String(c.sizeBytes), c.modifiedAt || ""].join("|");
}

function buildPreviewToken(candidates) {
  purgeExpiredTokens();
  const token = randomBytes(24).toString("hex");
  const fingerprints = candidates.map(fingerprintCandidate).sort();
  previewTokens.set(token, {
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
    fingerprints,
    assetPaths: candidates.map((c) => c.assetPath).sort(),
    used: false,
  });
  return token;
}

function consumePreviewToken(token, candidates) {
  purgeExpiredTokens();
  const rec = previewTokens.get(token);
  if (!rec) throw quarantineError("STORAGE_TOKEN_INVALID", "Токен подтверждения недействителен или истёк");
  if (rec.used) throw quarantineError("STORAGE_TOKEN_REPLAY", "Токен подтверждения уже использован");
  if (rec.expiresAt <= Date.now()) {
    previewTokens.delete(token);
    throw quarantineError("STORAGE_TOKEN_EXPIRED", "Токен подтверждения истёк");
  }
  const fingerprints = candidates.map(fingerprintCandidate).sort();
  if (fingerprints.length !== rec.fingerprints.length) {
    throw quarantineError("STORAGE_TOKEN_MISMATCH", "Состав файлов не совпадает с preview");
  }
  for (let i = 0; i < fingerprints.length; i++) {
    if (fingerprints[i] !== rec.fingerprints[i]) {
      throw quarantineError("STORAGE_TOKEN_MISMATCH", "Hash/size файлов не совпадает с preview");
    }
  }
  rec.used = true;
  previewTokens.delete(token);
  return rec;
}

/**
 * Fresh eligibility check for one assetPath.
 */
export async function inspectQuarantineCandidate(assetPath, { expectedHash, expectedSize, expectedModifiedAt } = {}) {
  const url = normalizeUploadUrl(assetPath);
  if (!isLocalUploadUrl(url) || !url.startsWith("/uploads/")) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: "Допустим только путь /uploads/…",
      code: "INVALID_ASSET_PATH",
    };
  }
  if (url.includes("..") || url.includes("\\") || /^[A-Za-z]:/.test(url)) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: "Недопустимый путь",
      code: "INVALID_ASSET_PATH",
    };
  }

  const abs = resolveLocalUploadAbsPath(url);
  if (!abs) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: "Путь вне UPLOAD_ROOT",
      code: "PATH_ESCAPE",
    };
  }

  const uploadRoot = path.resolve(getUploadRoot());
  assertInsideRoot(abs, uploadRoot);

  const filename = path.basename(url);
  if (isBlockedServiceFilename(filename)) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: "Служебный файл",
      code: "SERVICE_FILE",
      filename,
    };
  }

  if (!fs.existsSync(abs)) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: "Файл отсутствует",
      code: "MISSING",
      filename,
    };
  }

  const st = fs.statSync(abs);
  if (!st.isFile()) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: "Не файл",
      code: "NOT_FILE",
      filename,
    };
  }

  const contentHash = await streamSha256(abs);
  const sizeBytes = st.size;
  const modifiedAt = st.mtime.toISOString();

  if (expectedHash && expectedHash !== contentHash) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: "Hash изменился после сканирования",
      code: "STORAGE_ASSET_CHANGED",
      filename,
      contentHash,
      sizeBytes,
      modifiedAt,
    };
  }
  if (expectedSize != null && Number(expectedSize) !== sizeBytes) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: "Размер изменился после сканирования",
      code: "STORAGE_ASSET_CHANGED",
      filename,
      contentHash,
      sizeBytes,
      modifiedAt,
    };
  }
  if (expectedModifiedAt && String(expectedModifiedAt) !== modifiedAt) {
    // allow tiny drift? strict per spec
    const a = new Date(expectedModifiedAt).getTime();
    const b = st.mtimeMs;
    if (!Number.isFinite(a) || Math.abs(a - b) > 1500) {
      return {
        assetPath: url,
        eligible: false,
        blocked: true,
        reason: "Файл изменён после сканирования (mtime)",
        code: "STORAGE_ASSET_CHANGED",
        filename,
        contentHash,
        sizeBytes,
        modifiedAt,
      };
    }
  }

  const refs = getAssetReferenceSnapshot(url);
  const last = getLastStorageInventory();
  const fromScan = last?.files?.find((f) => f.assetPath === url);
  const isDuplicate = !!(fromScan?.isDuplicate || fromScan?.status === "DUPLICATE");

  // If hash matches another physical file in last scan — treat as duplicate group
  let duplicateFromHash = false;
  if (last?.files) {
    const sameHash = last.files.filter(
      (f) => f.physicalExists && f.contentHash === contentHash && f.assetPath !== url
    );
    if (sameHash.length) duplicateFromHash = true;
  }

  const eligibility = evaluateQuarantineEligibility({
    status: refs.referenceCount > 0 ? refs.status : isDuplicate || duplicateFromHash ? "DUPLICATE" : "ORPHAN",
    isDuplicate: isDuplicate || duplicateFromHash,
    pinnedReferenceCount: refs.pinnedReferenceCount,
    liveReferenceCount: refs.liveReferenceCount,
    physicalExists: true,
    filename,
    modifiedAt,
    minAgeDays: quarantineMinAgeDays(),
  });

  if (!eligibility.ok) {
    return {
      assetPath: url,
      eligible: false,
      blocked: true,
      reason: eligibility.reason,
      code: eligibility.code === "PINNED" || eligibility.code === "LIVE_REFERENCED"
        ? "STORAGE_ASSET_REFERENCED"
        : eligibility.code,
      filename,
      contentHash,
      sizeBytes,
      modifiedAt,
      mimeType: mimeFromExt(path.extname(filename)),
      pinnedReferenceCount: refs.pinnedReferenceCount,
      liveReferenceCount: refs.liveReferenceCount,
      status: refs.referenceCount > 0 ? refs.status : isDuplicate || duplicateFromHash ? "DUPLICATE" : "ORPHAN",
      ageDays: eligibility.ageDays,
      minAgeDays: eligibility.minAgeDays,
    };
  }

  return {
    assetPath: url,
    eligible: true,
    blocked: false,
    reason: "Подтверждённый pure ORPHAN — можно переместить в карантин",
    code: "ELIGIBLE",
    filename,
    contentHash,
    sizeBytes,
    modifiedAt,
    mimeType: mimeFromExt(path.extname(filename)),
    pinnedReferenceCount: 0,
    liveReferenceCount: 0,
    status: "ORPHAN",
    ageDays: eligibility.ageDays,
    minAgeDays: eligibility.minAgeDays,
  };
}

export async function previewQuarantine({ assetPaths = [], actor = "admin" } = {}) {
  const paths = [...new Set((assetPaths || []).map((p) => normalizeUploadUrl(p)).filter(Boolean))];
  const eligible = [];
  const blocked = [];

  for (const assetPath of paths) {
    const last = getLastStorageInventory();
    const fromScan = last?.files?.find((f) => f.assetPath === assetPath);
    const inspected = await inspectQuarantineCandidate(assetPath, {
      expectedHash: fromScan?.contentHash,
      expectedSize: fromScan?.sizeBytes,
      expectedModifiedAt: fromScan?.modifiedAt,
    });
    if (inspected.eligible) eligible.push(inspected);
    else blocked.push(inspected);
  }

  const totalBytes = eligible.reduce((s, f) => s + (Number(f.sizeBytes) || 0), 0);
  const confirmationToken = eligible.length ? buildPreviewToken(eligible) : null;

  logEvent({
    action: "preview",
    actor,
    assetPath: paths.join(","),
    contentHash: "",
    sizeBytes: totalBytes,
    result: eligible.length ? "ok" : "none_eligible",
    detail: {
      eligibleCount: eligible.length,
      blockedCount: blocked.length,
      paths,
    },
  });

  return {
    ok: true,
    confirmationToken,
    confirmationPhrase: QUARANTINE_CONFIRM_PHRASE,
    expiresInMs: PREVIEW_TOKEN_TTL_MS,
    eligible: eligible.map((e) => sanitizeQuarantineRow(e)),
    blocked: blocked.map((e) => sanitizeQuarantineRow(e)),
    totalFiles: eligible.length,
    totalBytes,
    minAgeDays: quarantineMinAgeDays(),
  };
}

async function moveOneToQuarantine(candidate, { actor, reason, inventoryScanId }) {
  const abs = resolveLocalUploadAbsPath(candidate.assetPath);
  if (!abs || !fs.existsSync(abs)) {
    throw quarantineError("STORAGE_ASSET_CHANGED", "Файл исчез перед перемещением", {
      assetPath: candidate.assetPath,
    });
  }

  // Final revalidation
  const fresh = await inspectQuarantineCandidate(candidate.assetPath, {
    expectedHash: candidate.contentHash,
    expectedSize: candidate.sizeBytes,
    expectedModifiedAt: candidate.modifiedAt,
  });
  if (!fresh.eligible) {
    throw quarantineError(
      fresh.code === "STORAGE_ASSET_CHANGED" ? "STORAGE_ASSET_CHANGED" : "STORAGE_ASSET_REFERENCED",
      fresh.reason || "Файл больше не eligible",
      { assetPath: candidate.assetPath, code: fresh.code }
    );
  }

  const qRoot = ensureQuarantineRoot();
  const day = new Date().toISOString().slice(0, 10);
  const dayDir = path.join(qRoot, day);
  fs.mkdirSync(dayDir, { recursive: true });
  assertInsideRoot(dayDir, qRoot);

  const ext = path.extname(candidate.filename) || path.extname(candidate.assetPath) || "";
  const base = path.basename(candidate.filename || candidate.assetPath, ext).replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
  const id = nanoid(14);
  const rel = `${day}/${id}_${base}${ext}`.replace(/\\/g, "/");
  const dest = path.join(qRoot, ...rel.split("/"));
  assertInsideRoot(dest, qRoot);
  if (fs.existsSync(dest)) {
    throw quarantineError("STORAGE_QUARANTINE_EXISTS", "Целевой файл карантина уже существует");
  }

  // Atomic rename
  try {
    fs.renameSync(abs, dest);
  } catch (e) {
    // cross-device fallback: copy+unlink (still not "delete" of user data — relocating)
    try {
      fs.copyFileSync(abs, dest);
      const hashDest = await streamSha256(dest);
      if (hashDest !== candidate.contentHash) {
        fs.unlinkSync(dest);
        throw quarantineError("STORAGE_HASH_MISMATCH", "Hash после копирования не совпал");
      }
      fs.unlinkSync(abs);
    } catch (e2) {
      if (fs.existsSync(dest) && fs.existsSync(abs)) {
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
      }
      throw quarantineError("STORAGE_MOVE_FAILED", e2.message || e.message || "Не удалось переместить файл");
    }
  }

  const hashAfter = await streamSha256(dest);
  if (hashAfter !== candidate.contentHash) {
    // try rollback
    try {
      if (!fs.existsSync(abs)) fs.renameSync(dest, abs);
    } catch {
      /* ignore */
    }
    throw quarantineError("STORAGE_HASH_MISMATCH", "Hash после перемещения не совпал");
  }

  const row = {
    id,
    original_asset_path: candidate.assetPath,
    quarantine_relative_path: rel,
    filename: candidate.filename,
    size_bytes: candidate.sizeBytes,
    content_hash: candidate.contentHash,
    mime_type: candidate.mimeType || mimeFromExt(ext),
    quarantined_at: new Date().toISOString(),
    quarantined_by: actor || "admin",
    reason: reason || "pure ORPHAN",
    inventory_scan_id: inventoryScanId || getLastStorageInventory()?.summary?.scanCompletedAt || "",
    original_modified_at: candidate.modifiedAt || null,
    restored_at: null,
    status: QUARANTINE_STATUSES.QUARANTINED,
  };

  try {
    db.prepare(
      `INSERT INTO storage_quarantine
        (id, original_asset_path, quarantine_relative_path, filename, size_bytes, content_hash, mime_type,
         quarantined_at, quarantined_by, reason, inventory_scan_id, original_modified_at, restored_at, status)
       VALUES (@id, @original_asset_path, @quarantine_relative_path, @filename, @size_bytes, @content_hash, @mime_type,
         @quarantined_at, @quarantined_by, @reason, @inventory_scan_id, @original_modified_at, @restored_at, @status)`
    ).run(row);
  } catch (e) {
    // rollback move
    try {
      if (!fs.existsSync(abs) && fs.existsSync(dest)) fs.renameSync(dest, abs);
    } catch {
      /* ignore */
    }
    throw quarantineError("STORAGE_DB_FAILED", e.message || "Не удалось записать manifest");
  }

  logEvent({
    action: "quarantine",
    actor,
    assetPath: candidate.assetPath,
    quarantineId: id,
    contentHash: candidate.contentHash,
    sizeBytes: candidate.sizeBytes,
    result: "ok",
    detail: { quarantineRelativePath: rel },
  });

  return sanitizeQuarantineRow({
    quarantineId: id,
    originalAssetPath: row.original_asset_path,
    quarantineRelativePath: row.quarantine_relative_path,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    mimeType: row.mime_type,
    quarantinedAt: row.quarantined_at,
    quarantinedBy: row.quarantined_by,
    reason: row.reason,
    inventoryScanId: row.inventory_scan_id,
    originalModifiedAt: row.original_modified_at,
    restoredAt: null,
    status: row.status,
  });
}

export async function executeQuarantine({
  assetPaths = [],
  confirmationToken,
  confirmationPhrase,
  actor = "admin",
  reason = "pure ORPHAN",
} = {}) {
  if (String(confirmationPhrase || "").trim() !== QUARANTINE_CONFIRM_PHRASE) {
    throw quarantineError(
      "STORAGE_CONFIRM_REQUIRED",
      `Требуется точная фраза подтверждения: ${QUARANTINE_CONFIRM_PHRASE}`
    );
  }
  if (!confirmationToken) {
    throw quarantineError("STORAGE_TOKEN_REQUIRED", "Нужен confirmationToken из preview");
  }

  // Validate token early (replay / expiry) before mutating anything
  purgeExpiredTokens();
  const tokenRec = previewTokens.get(confirmationToken);
  if (!tokenRec) throw quarantineError("STORAGE_TOKEN_INVALID", "Токен подтверждения недействителен или истёк");
  if (tokenRec.used) throw quarantineError("STORAGE_TOKEN_REPLAY", "Токен подтверждения уже использован");
  if (tokenRec.expiresAt <= Date.now()) {
    previewTokens.delete(confirmationToken);
    throw quarantineError("STORAGE_TOKEN_EXPIRED", "Токен подтверждения истёк");
  }

  // Re-inspect all candidates fresh
  const paths = [...new Set((assetPaths || []).map((p) => normalizeUploadUrl(p)).filter(Boolean))];
  if (!paths.length) throw quarantineError("STORAGE_EMPTY", "Нет файлов для карантина");

  const candidates = [];
  for (const assetPath of paths) {
    const last = getLastStorageInventory();
    const fromScan = last?.files?.find((f) => f.assetPath === assetPath);
    const inspected = await inspectQuarantineCandidate(assetPath, {
      expectedHash: fromScan?.contentHash,
      expectedSize: fromScan?.sizeBytes,
      expectedModifiedAt: fromScan?.modifiedAt,
    });
    if (!inspected.eligible) {
      throw quarantineError(
        inspected.code === "STORAGE_ASSET_CHANGED" ? "STORAGE_ASSET_CHANGED" : "STORAGE_ASSET_REFERENCED",
        inspected.reason || "Файл не eligible",
        { assetPath, code: inspected.code }
      );
    }
    candidates.push(inspected);
  }

  consumePreviewToken(confirmationToken, candidates);

  const moved = [];
  try {
    for (const c of candidates) {
      const row = await moveOneToQuarantine(c, {
        actor,
        reason,
        inventoryScanId: getLastStorageInventory()?.summary?.scanCompletedAt || "",
      });
      moved.push(row);
    }
  } catch (e) {
    // Best-effort rollback of already moved items in this batch
    for (const m of [...moved].reverse()) {
      try {
        await restoreQuarantinedFile(m.quarantineId, { actor, forceRollback: true });
      } catch {
        /* ignore */
      }
    }
    logEvent({
      action: "quarantine",
      actor,
      assetPath: paths.join(","),
      result: "failed",
      detail: { error: e.message, code: e.code },
    });
    throw e;
  }

  // Invalidate inventory cache — files moved
  const { __test } = await import("./storageInventoryService.js");
  __test.resetLastScan();

  return {
    ok: true,
    quarantined: moved,
    totalFiles: moved.length,
    totalBytes: moved.reduce((s, f) => s + (Number(f.sizeBytes) || 0), 0),
  };
}

function rowToDto(row) {
  if (!row) return null;
  return sanitizeQuarantineRow({
    quarantineId: row.id,
    originalAssetPath: row.original_asset_path,
    quarantineRelativePath: row.quarantine_relative_path,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    mimeType: row.mime_type,
    quarantinedAt: row.quarantined_at,
    quarantinedBy: row.quarantined_by,
    reason: row.reason,
    inventoryScanId: row.inventory_scan_id,
    originalModifiedAt: row.original_modified_at,
    restoredAt: row.restored_at,
    status: row.status,
  });
}

export function listQuarantine({ status = "QUARANTINED", page = 1, pageSize = 50 } = {}) {
  const st = String(status || "QUARANTINED").toUpperCase();
  const rows =
    st === "ALL"
      ? db.prepare(`SELECT * FROM storage_quarantine ORDER BY quarantined_at DESC`).all()
      : db
          .prepare(`SELECT * FROM storage_quarantine WHERE status = ? ORDER BY quarantined_at DESC`)
          .all(st);
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const start = (p - 1) * size;
  const items = rows.slice(start, start + size).map(rowToDto);
  return {
    ok: true,
    page: p,
    pageSize: size,
    total: rows.length,
    items,
    files: items,
  };
}

export async function restoreQuarantinedFile(quarantineId, { actor = "admin", forceRollback = false } = {}) {
  const row = db.prepare(`SELECT * FROM storage_quarantine WHERE id = ?`).get(quarantineId);
  if (!row) throw quarantineError("NOT_FOUND", "Запись карантина не найдена");
  if (row.status === QUARANTINE_STATUSES.RESTORED && !forceRollback) {
    throw quarantineError("STORAGE_ALREADY_RESTORED", "Файл уже восстановлен");
  }

  const qRoot = ensureQuarantineRoot();
  const destQuarantine = path.join(qRoot, ...String(row.quarantine_relative_path).split("/"));
  assertInsideRoot(destQuarantine, qRoot);
  if (!fs.existsSync(destQuarantine)) {
    throw quarantineError("STORAGE_ASSET_CHANGED", "Файл в карантине отсутствует");
  }

  const hashNow = await streamSha256(destQuarantine);
  if (hashNow !== row.content_hash) {
    throw quarantineError("STORAGE_HASH_MISMATCH", "Hash файла в карантине не совпадает с manifest");
  }

  const targetAbs = resolveLocalUploadAbsPath(row.original_asset_path);
  if (!targetAbs) {
    throw quarantineError("INVALID_ASSET_PATH", "Некорректный originalAssetPath");
  }
  assertInsideRoot(targetAbs, path.resolve(getUploadRoot()));

  if (fs.existsSync(targetAbs)) {
    throw quarantineError(
      "STORAGE_RESTORE_EXISTS",
      "Целевой путь уже занят — восстановление заблокировано"
    );
  }

  // Fresh reference check: restoring is allowed even if still orphan; if somehow referenced while missing, still OK to restore
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });

  try {
    fs.renameSync(destQuarantine, targetAbs);
  } catch (e) {
    try {
      fs.copyFileSync(destQuarantine, targetAbs);
      const h = await streamSha256(targetAbs);
      if (h !== row.content_hash) {
        fs.unlinkSync(targetAbs);
        throw quarantineError("STORAGE_HASH_MISMATCH", "Hash после восстановления не совпал");
      }
      fs.unlinkSync(destQuarantine);
    } catch (e2) {
      throw quarantineError("STORAGE_MOVE_FAILED", e2.message || e.message || "Не удалось восстановить");
    }
  }

  const hashAfter = await streamSha256(targetAbs);
  if (hashAfter !== row.content_hash) {
    try {
      fs.renameSync(targetAbs, destQuarantine);
    } catch {
      /* ignore */
    }
    throw quarantineError("STORAGE_HASH_MISMATCH", "Hash после восстановления не совпал");
  }

  const restoredAt = new Date().toISOString();
  db.prepare(
    `UPDATE storage_quarantine SET status = ?, restored_at = ? WHERE id = ?`
  ).run(QUARANTINE_STATUSES.RESTORED, restoredAt, quarantineId);

  logEvent({
    action: "restore",
    actor,
    assetPath: row.original_asset_path,
    quarantineId,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    result: "ok",
    detail: { forceRollback: !!forceRollback },
  });

  const { __test } = await import("./storageInventoryService.js");
  __test.resetLastScan();

  return {
    ok: true,
    file: rowToDto({
      ...row,
      status: QUARANTINE_STATUSES.RESTORED,
      restored_at: restoredAt,
    }),
  };
}

export const __test = {
  previewTokens,
  getQuarantineRoot,
  ensureQuarantineRoot,
  resetPreviewTokens() {
    previewTokens.clear();
  },
  buildPreviewToken,
  consumePreviewToken,
};
