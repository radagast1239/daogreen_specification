/**
 * Soft-hide frame drawings from client/admin document lists,
 * plus optional hard-purge of eligible soft-hidden live PDFs.
 *
 * Hard-purge never touches /uploads/releases/ and never deletes pinned assets.
 */
import fs from "fs";
import { db } from "../db.js";
import { activeStellageIdSet } from "../../../shared/clientFrameDocuments.js";
import {
  isAssetPinnedByPublishedRelease,
  resolveLocalUploadAbsPath,
} from "./publishedAssetRetention.js";

function hideDrawingRow(row) {
  if (!row?.id) return false;
  if (row.file_id) {
    db.prepare("DELETE FROM files WHERE id = ?").run(row.file_id);
  }
  const r = db.prepare(`
    UPDATE frame_drawings
    SET is_client_visible = 0, file_id = NULL, updated_at = datetime('now')
    WHERE id = ? AND is_client_visible != 0
  `).run(row.id);
  return (Number(r.changes) || 0) > 0;
}

function isLiveFrameDrawingUploadPath(url) {
  const u = String(url || "").replace(/\\/g, "/");
  return u.startsWith("/uploads/frame-drawings/");
}

/**
 * @param {object|null} row frame_drawings row
 * @returns {{ ok: boolean, reason?: string, url?: string }}
 */
export function evaluateHiddenFrameDrawingPurge(row) {
  if (!row?.id) return { ok: false, reason: "missing" };
  if (Number(row.is_client_visible) !== 0) {
    return { ok: false, reason: "still_visible" };
  }
  const url = String(row.pdf_url || "");
  if (!isLiveFrameDrawingUploadPath(url)) {
    return { ok: false, reason: "not_live_frame_path" };
  }
  if (isAssetPinnedByPublishedRelease({ url, drawingId: row.id })) {
    return { ok: false, reason: "pinned" };
  }
  return { ok: true, url };
}

/**
 * Hard-delete one soft-hidden live frame drawing (DB row + PDF) when eligible.
 * @returns {{ purged: boolean, reason?: string, id?: string, url?: string, fileDeleted?: boolean, wouldPurge?: boolean }}
 */
export function purgeHiddenFrameDrawingById(id, { dryRun = false } = {}) {
  if (!id) return { purged: false, reason: "missing" };
  const row = db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(id);
  const verdict = evaluateHiddenFrameDrawingPurge(row);
  if (!verdict.ok) {
    return { purged: false, reason: verdict.reason, id };
  }
  if (dryRun) {
    return { purged: false, reason: "dry_run", id, url: verdict.url, wouldPurge: true };
  }

  if (row.file_id) {
    db.prepare("DELETE FROM files WHERE id = ?").run(row.file_id);
  }
  db.prepare("DELETE FROM frame_drawings WHERE id = ?").run(id);

  let fileDeleted = false;
  const abs = resolveLocalUploadAbsPath(verdict.url);
  if (abs && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
      fileDeleted = true;
    } catch (err) {
      console.warn(`[frame-drawing-purge] failed to unlink ${abs}`, err?.message || err);
    }
  }
  return { purged: true, id, url: verdict.url, fileDeleted };
}

/**
 * Scan soft-hidden drawings and purge those that pass pin/path checks.
 * @returns {{ scanned: number, purged: number, purgedIds: string[], skipped: object[], dryRun: boolean, wouldPurge?: number }}
 */
export function purgeEligibleHiddenFrameDrawings({ projectId = null, dryRun = false, limit = 0 } = {}) {
  let sql = `
    SELECT id, project_id, stellage_id, pdf_url, file_id, is_client_visible
    FROM frame_drawings
    WHERE is_client_visible = 0
  `;
  const params = [];
  if (projectId) {
    sql += " AND project_id = ?";
    params.push(projectId);
  }
  sql += " ORDER BY updated_at ASC, created_at ASC";
  if (limit > 0) {
    sql += " LIMIT ?";
    params.push(Number(limit) || 0);
  }

  const rows = db.prepare(sql).all(...params);
  const purgedIds = [];
  const skipped = [];
  for (const row of rows) {
    const result = purgeHiddenFrameDrawingById(row.id, { dryRun });
    if (result.purged || result.wouldPurge) {
      purgedIds.push(row.id);
    } else {
      skipped.push({ id: row.id, reason: result.reason });
    }
  }
  return {
    scanned: rows.length,
    purged: dryRun ? 0 : purgedIds.length,
    wouldPurge: dryRun ? purgedIds.length : undefined,
    purgedIds,
    skipped,
    dryRun: !!dryRun,
  };
}

/**
 * Hide drawings bound to stellages that are no longer in the project.
 * No-op when active set is empty (legacy / incomplete configs).
 *
 * @param {string} projectId
 * @param {Set<string>|object[]|undefined} activeStellageIdsOrConfigs
 * @returns {{ hidden: number, hiddenIds: string[] }}
 */
export function hideOrphanFrameDrawingsForProject(projectId, activeStellageIdsOrConfigs) {
  if (!projectId) return { hidden: 0, hiddenIds: [] };

  let active;
  if (activeStellageIdsOrConfigs instanceof Set) {
    active = activeStellageIdsOrConfigs;
  } else if (Array.isArray(activeStellageIdsOrConfigs)) {
    active = activeStellageIdSet(activeStellageIdsOrConfigs);
  } else {
    const row = db.prepare("SELECT stellage_configs FROM projects WHERE id = ?").get(projectId);
    let configs = [];
    try {
      configs = JSON.parse(row?.stellage_configs || "[]");
    } catch {
      configs = [];
    }
    active = activeStellageIdSet(configs);
  }

  // Same safety as clientFrameDocuments: empty active set → do not mass-hide.
  if (!active.size) return { hidden: 0, hiddenIds: [] };

  const rows = db.prepare(`
    SELECT id, file_id, stellage_id
    FROM frame_drawings
    WHERE project_id = ?
      AND IFNULL(stellage_id, '') != ''
      AND is_client_visible = 1
  `).all(projectId);

  const hiddenIds = [];
  for (const row of rows) {
    if (active.has(row.stellage_id)) continue;
    if (hideDrawingRow(row)) hiddenIds.push(row.id);
  }
  return { hidden: hiddenIds.length, hiddenIds };
}

/**
 * After a new/replaced drawing becomes current, hide older visible siblings
 * for the same target (project+stellage / module rack / preset).
 *
 * @param {object} opts
 * @param {string} opts.keepId drawing id that must stay visible
 * @returns {{ hidden: number, hiddenIds: string[] }}
 */
export function hideSupersededFrameDrawingVersions({
  keepId,
  projectId = null,
  stellageId = null,
  moduleId = null,
  moduleRackKey = null,
  presetId = null,
} = {}) {
  if (!keepId) return { hidden: 0, hiddenIds: [] };

  let sql = `
    SELECT id, file_id FROM frame_drawings
    WHERE id != ? AND is_client_visible = 1
  `;
  const params = [keepId];

  if (projectId && stellageId) {
    sql += " AND project_id = ? AND stellage_id = ?";
    params.push(projectId, stellageId);
  } else if (moduleId && moduleRackKey) {
    sql += " AND module_id = ? AND module_rack_key = ?";
    params.push(moduleId, moduleRackKey);
  } else if (presetId) {
    sql += " AND preset_id = ?";
    params.push(presetId);
  } else if (projectId) {
    sql += ` AND project_id = ?
      AND COALESCE(stellage_id, '') = ''
      AND COALESCE(module_rack_key, '') = ''
      AND COALESCE(preset_id, '') = ''`;
    params.push(projectId);
  } else {
    return { hidden: 0, hiddenIds: [] };
  }

  const rows = db.prepare(sql).all(...params);
  const hiddenIds = [];
  for (const row of rows) {
    if (hideDrawingRow(row)) hiddenIds.push(row.id);
  }
  return { hidden: hiddenIds.length, hiddenIds };
}
