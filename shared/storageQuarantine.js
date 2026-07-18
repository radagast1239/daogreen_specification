/**
 * Pure helpers for storage orphan quarantine (no filesystem / DB).
 */

export const QUARANTINE_CONFIRM_PHRASE = "ПЕРЕМЕСТИТЬ В КАРАНТИН";

export const QUARANTINE_STATUSES = Object.freeze({
  QUARANTINED: "QUARANTINED",
  RESTORED: "RESTORED",
});

export const DEFAULT_QUARANTINE_MIN_AGE_DAYS = 14;
export const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;

const BLOCKED_FILENAMES = new Set([".gitkeep", ".ds_store", "thumbs.db", "desktop.ini"]);

export function quarantineMinAgeDays() {
  const n = Number(process.env.STORAGE_QUARANTINE_MIN_AGE_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_QUARANTINE_MIN_AGE_DAYS;
}

export function isBlockedServiceFilename(filename) {
  const name = String(filename || "").trim();
  if (!name) return true;
  const base = name.split(/[/\\]/).pop() || name;
  const lower = base.toLowerCase();
  if (BLOCKED_FILENAMES.has(lower)) return true;
  if (base.startsWith(".")) return true;
  if (lower.endsWith(".tmp") || lower.endsWith(".partial") || lower.endsWith(".uploading")) return true;
  return false;
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string, code: string }}
 */
export function evaluateQuarantineEligibility({
  status,
  isDuplicate,
  pinnedReferenceCount,
  liveReferenceCount,
  physicalExists,
  filename,
  modifiedAt,
  minAgeDays = quarantineMinAgeDays(),
  nowMs = Date.now(),
}) {
  if (!physicalExists) {
    return { ok: false, reason: "Файл отсутствует в хранилище", code: "MISSING" };
  }
  if (isBlockedServiceFilename(filename)) {
    return { ok: false, reason: "Служебный файл нельзя перемещать в карантин", code: "SERVICE_FILE" };
  }
  if ((Number(pinnedReferenceCount) || 0) > 0) {
    return { ok: false, reason: "Файл защищён опубликованной версией", code: "PINNED" };
  }
  if ((Number(liveReferenceCount) || 0) > 0) {
    return { ok: false, reason: "Файл используется текущими данными", code: "LIVE_REFERENCED" };
  }
  if (isDuplicate || status === "DUPLICATE") {
    return {
      ok: false,
      reason: "Дубликаты не отправляются в карантин на этом этапе",
      code: "DUPLICATE",
    };
  }
  if (status === "MISSING" || status === "UNKNOWN") {
    return { ok: false, reason: `Статус ${status} не допускает карантин`, code: status };
  }
  if (status === "PINNED" || status === "LIVE_REFERENCED" || status === "PINNED_AND_LIVE") {
    return { ok: false, reason: `Статус ${status} не допускает карантин`, code: status };
  }
  if (status !== "ORPHAN") {
    return { ok: false, reason: "В карантин можно отправлять только pure ORPHAN", code: "NOT_ORPHAN" };
  }
  const mtime = modifiedAt ? new Date(modifiedAt).getTime() : NaN;
  if (!Number.isFinite(mtime)) {
    return { ok: false, reason: "Не удалось определить возраст файла", code: "NO_MTIME" };
  }
  const ageMs = nowMs - mtime;
  const minMs = (Number(minAgeDays) || 0) * 24 * 60 * 60 * 1000;
  if (ageMs < minMs) {
    return {
      ok: false,
      reason: `Файл младше ${minAgeDays} дн. — карантин недоступен`,
      code: "TOO_YOUNG",
      ageDays: ageMs / (24 * 60 * 60 * 1000),
      minAgeDays,
    };
  }
  return {
    ok: true,
    ageDays: ageMs / (24 * 60 * 60 * 1000),
    minAgeDays,
  };
}

export function sanitizeQuarantineRow(row) {
  if (!row) return null;
  const {
    abs,
    absolutePath,
    quarantineAbsPath,
    sourceAbsPath,
    ...rest
  } = row;
  return {
    ...rest,
    canDelete: false,
  };
}
