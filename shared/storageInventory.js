/**
 * Pure storage inventory model (no filesystem / DB).
 */

export const STORAGE_STATUSES = Object.freeze({
  PINNED: "PINNED",
  LIVE_REFERENCED: "LIVE_REFERENCED",
  PINNED_AND_LIVE: "PINNED_AND_LIVE",
  ORPHAN: "ORPHAN",
  MISSING: "MISSING",
  DUPLICATE: "DUPLICATE",
  UNKNOWN: "UNKNOWN",
});

export const STORAGE_STATUS_LABELS = Object.freeze({
  PINNED: "Защищён публикацией",
  LIVE_REFERENCED: "Используется проектом",
  PINNED_AND_LIVE: "Публикация и проект",
  ORPHAN: "Возможный сирота",
  MISSING: "Битая ссылка",
  DUPLICATE: "Дубликат",
  UNKNOWN: "Неизвестно",
});

export const STORAGE_STATUS_HINTS = Object.freeze({
  PINNED: "Файл используется в опубликованных версиях и защищён от удаления.",
  LIVE_REFERENCED: "Файл используется текущим проектом.",
  PINNED_AND_LIVE: "Файл используется и текущими данными, и историческими публикациями.",
  ORPHAN: "Ссылок на файл не найдено. Удаление пока недоступно — требуется отдельная проверка.",
  MISSING: "Система ссылается на файл, но файл отсутствует в хранилище.",
  DUPLICATE: "Содержимое совпадает с другими файлами. Это не означает, что файл можно безопасно удалить.",
  UNKNOWN: "Статус файла не определён.",
});

export function classifyInventoryStatus({ physicalExists, pinnedReferenceCount, liveReferenceCount, isDuplicate }) {
  const pinned = (Number(pinnedReferenceCount) || 0) > 0;
  const live = (Number(liveReferenceCount) || 0) > 0;
  if (!physicalExists && (pinned || live)) return STORAGE_STATUSES.MISSING;
  if (!physicalExists) return STORAGE_STATUSES.UNKNOWN;
  if (pinned && live) return STORAGE_STATUSES.PINNED_AND_LIVE;
  if (pinned) return STORAGE_STATUSES.PINNED;
  if (live) return STORAGE_STATUSES.LIVE_REFERENCED;
  if (isDuplicate) return STORAGE_STATUSES.DUPLICATE;
  return STORAGE_STATUSES.ORPHAN;
}

export function missingSeverity({ pinnedReferenceCount, liveReferenceCount }) {
  if ((Number(pinnedReferenceCount) || 0) > 0) return "CRITICAL";
  if ((Number(liveReferenceCount) || 0) > 0) return "HIGH";
  return "MEDIUM";
}

/** Deduplicate references by type+project+version+field+url key. */
export function dedupeReferences(refs = []) {
  const seen = new Set();
  const out = [];
  for (const r of refs) {
    const key = [
      r.referenceType || "",
      r.projectId || "",
      r.versionId || "",
      r.materialId || "",
      r.drawingId || "",
      r.field || "",
      r.url || r.assetPath || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function buildInventorySummary(files = [], { scanStartedAt, scanCompletedAt, durationMs } = {}) {
  let totalSizeBytes = 0;
  let pinnedFiles = 0;
  let liveReferencedFiles = 0;
  let orphanFiles = 0;
  let missingReferences = 0;
  const hashGroups = new Map();

  for (const f of files) {
    if (f.physicalExists) totalSizeBytes += Number(f.sizeBytes) || 0;
    if (f.status === STORAGE_STATUSES.PINNED || f.status === STORAGE_STATUSES.PINNED_AND_LIVE) pinnedFiles += 1;
    if (f.status === STORAGE_STATUSES.LIVE_REFERENCED || f.status === STORAGE_STATUSES.PINNED_AND_LIVE) {
      liveReferencedFiles += 1;
    }
    if (f.status === STORAGE_STATUSES.ORPHAN || f.status === STORAGE_STATUSES.DUPLICATE) orphanFiles += 1;
    if (f.status === STORAGE_STATUSES.MISSING) missingReferences += 1;
    if (f.physicalExists && f.contentHash) {
      const list = hashGroups.get(f.contentHash) || [];
      list.push(f.assetPath);
      hashGroups.set(f.contentHash, list);
    }
  }

  const duplicateGroups = [];
  let reclaimableBytesEstimate = 0;
  for (const [hash, paths] of hashGroups) {
    if (paths.length < 2) continue;
    const groupFiles = files.filter((f) => f.contentHash === hash && f.physicalExists);
    const size = Number(groupFiles[0]?.sizeBytes) || 0;
    duplicateGroups.push({ contentHash: hash, count: paths.length, assetPaths: paths, sizeBytes: size });
    // Estimate: keep one copy, rest potentially reclaimable only if all orphan — conservative: only orphan dupes
    const orphanDupes = groupFiles.filter(
      (f) => f.status === STORAGE_STATUSES.ORPHAN || f.status === STORAGE_STATUSES.DUPLICATE
    );
    if (orphanDupes.length > 1) {
      reclaimableBytesEstimate += size * (orphanDupes.length - 1);
    }
  }

  return {
    totalFiles: files.filter((f) => f.physicalExists).length,
    totalSizeBytes,
    pinnedFiles,
    liveReferencedFiles,
    orphanFiles,
    missingReferences,
    duplicateGroups: duplicateGroups.length,
    duplicateGroupDetails: duplicateGroups,
    reclaimableBytesEstimate,
    scanStartedAt: scanStartedAt || null,
    scanCompletedAt: scanCompletedAt || null,
    durationMs: durationMs ?? null,
  };
}

export function filterInventoryFiles(files = [], query = {}) {
  let list = [...files];
  const status = String(query.status || "").trim().toUpperCase();
  if (status && status !== "ALL") {
    if (status === "DUPLICATE") list = list.filter((f) => f.isDuplicate || f.status === STORAGE_STATUSES.DUPLICATE);
    else if (status === "ORPHAN") {
      list = list.filter(
        (f) => f.status === STORAGE_STATUSES.ORPHAN || f.status === STORAGE_STATUSES.DUPLICATE
      );
    } else if (status === "PINNED") {
      list = list.filter(
        (f) => f.status === STORAGE_STATUSES.PINNED || f.status === STORAGE_STATUSES.PINNED_AND_LIVE
      );
    } else if (status === "LIVE_REFERENCED" || status === "LIVE") {
      list = list.filter(
        (f) => f.status === STORAGE_STATUSES.LIVE_REFERENCED || f.status === STORAGE_STATUSES.PINNED_AND_LIVE
      );
    } else if (status === "MISSING") {
      list = list.filter((f) => f.status === STORAGE_STATUSES.MISSING);
    } else {
      list = list.filter((f) => f.status === status);
    }
  }
  if (query.duplicateOnly === true || query.duplicateOnly === "1" || query.duplicateOnly === "true") {
    list = list.filter((f) => f.isDuplicate);
  }
  if (query.missingOnly === true || query.missingOnly === "1" || query.missingOnly === "true") {
    list = list.filter((f) => f.status === STORAGE_STATUSES.MISSING);
  }
  const category = String(query.category || "").trim();
  if (category) {
    list = list.filter((f) => (f.categories || []).includes(category));
  }
  const projectId = String(query.projectId || "").trim();
  if (projectId) {
    list = list.filter((f) => (f.references || []).some((r) => r.projectId === projectId));
  }
  const extension = String(query.extension || "").trim().toLowerCase().replace(/^\./, "");
  if (extension) {
    list = list.filter((f) => String(f.extension || "").toLowerCase().replace(/^\./, "") === extension);
  }
  const minSize = Number(query.minSize);
  if (Number.isFinite(minSize) && minSize > 0) {
    list = list.filter((f) => (Number(f.sizeBytes) || 0) >= minSize);
  }
  const search = String(query.search || "").trim().toLowerCase();
  if (search) {
    list = list.filter((f) => {
      const hay = [f.filename, f.assetPath, f.url, f.contentHash, ...(f.categories || [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(search);
    });
  }
  return list;
}

export function paginateList(list, { page = 1, pageSize = 50 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const start = (p - 1) * size;
  return {
    page: p,
    pageSize: size,
    total: list.length,
    items: list.slice(start, start + size),
  };
}

/** Strip absolute paths and internal abs fields before API response. */
export function sanitizeInventoryFile(file) {
  if (!file || typeof file !== "object") return file;
  const {
    abs: _abs,
    absolutePath: _ap,
    realPath: _rp,
    serverPath: _sp,
    ...safe
  } = file;
  return {
    ...safe,
    references: (file.references || []).map((r) => {
      const { abs, absolutePath, realPath, serverPath, ...rest } = r || {};
      return rest;
    }),
  };
}

export function statusExplanation(status) {
  return STORAGE_STATUS_HINTS[status] || STORAGE_STATUS_HINTS.UNKNOWN;
}
