import { db } from "../db.js";
import {
  buildPublishedReleaseMeta,
  buildReleaseSnapshotPayload,
  clientItemsFromReleaseSnapshot,
  detectUnpublishedChanges,
  isPublishWorkflowStatus,
  mergeLivePurchaseOverlay,
  parsePublishedRelease,
  parseReleaseSnapshot,
  releaseSnapshotItems,
  releaseSnapshotImageManifest,
  releaseHasPinnedAssets,
  workingItemsPublishFingerprint,
  RELEASE_SCHEMA_V3,
} from "../../../shared/projectPublishedRelease.js";
import { buildClientImageManifest } from "../../../shared/clientImageManifest.js";
import { buildFarmPowerSnapshot } from "../../../shared/farmPower.js";
import { stripClientTechnicalFields } from "../../../shared/clientPurchaseRows.js";
import { normalizePurchaseStatus, getPurchaseStatusLabel } from "../../../shared/purchaseStatusRules.js";
import { applyPublishedProjectMeta } from "../../../shared/publishedClientMeta.js";
import { documentsFromPinnedFrameDrawings } from "../../../shared/publishedAssetPin.js";
import { publishedPlannedTotal } from "../../../shared/publishedPurchaseTotals.js";
import { formatReleaseSummaryText } from "../../../shared/releaseHistoryDiff.js";
import {
  enrichImageManifestForPublish,
  buildPinnedFrameDrawingsForPublish,
  listLatestClientVisibleFrameDrawings,
} from "./publishedAssetRetention.js";

export function loadVersionRow(projectId, versionId) {
  const row = db
    .prepare("SELECT * FROM spec_versions WHERE id = ? AND project_id = ?")
    .get(versionId, projectId);
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    createdAt: row.created_at,
    createdBy: row.created_by,
    summary: JSON.parse(row.summary || "{}"),
    snapshot: row.snapshot,
  };
}

export function loadLatestVersionRow(projectId) {
  const row = db
    .prepare("SELECT * FROM spec_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1")
    .get(projectId);
  if (!row) return null;
  return loadVersionRow(projectId, row.id);
}

export function loadPublishedSnapshotItems(project) {
  const release = parsePublishedRelease(project?.manualParams);
  if (!release) return [];
  const ver = loadVersionRow(project.id, release.versionId);
  if (!ver) return [];
  return releaseSnapshotItems(ver.snapshot);
}

export function loadPublishedReleaseSnapshot(project) {
  const release = parsePublishedRelease(project?.manualParams);
  if (!release) return null;
  const ver = loadVersionRow(project.id, release.versionId);
  if (!ver) return null;
  return parseReleaseSnapshot(JSON.parse(ver.snapshot || "[]"));
}

export function prepareSnapshotItemForClient(item) {
  const base = stripClientTechnicalFields({ ...item });
  const status = normalizePurchaseStatus(base);
  return {
    ...base,
    status,
    purchaseStatus: status,
    statusLabel: getPurchaseStatusLabel(status),
  };
}

/**
 * Build client project DTO from immutable snapshot.
 * Live project is NOT spread — only allowlisted meta (snapshot-first) + intentional purchase overlay.
 *
 * Options:
 * - overlayLive: merge live purchase status/actualPrice/clientComment (default true for current client link)
 * - historicalMode: force overlayLive=false; annotate DTO; no silent latest-drawing fallback
 * - versionRow: { id, versionNumber, createdAt, createdBy } for historical annotations
 */
export function buildClientProjectFromRelease(workingProject, snapshot, {
  overlayLive = true,
  historicalMode = false,
  versionRow = null,
} = {}) {
  const parsed = parseReleaseSnapshot(
    Array.isArray(snapshot)
      ? snapshot
      : snapshot && typeof snapshot === "object" && Array.isArray(snapshot.items)
        ? {
            schema: snapshot.schema,
            assetsPinned: snapshot.assetsPinned,
            projectMeta: snapshot.projectMeta,
            items: snapshot.items,
            imageManifest: snapshot.imageManifest,
            coolingRooms: snapshot.coolingRooms,
            farmPower: snapshot.farmPower,
            pinnedFrameDrawings: snapshot.pinnedFrameDrawings,
            publishedAt: snapshot.publishedAt,
          }
        : snapshot,
  );

  const effectiveOverlay = historicalMode ? false : overlayLive;
  const snapshotItems = parsed.items || [];
  const clientImages = parsed.imageManifest || { projectSchemes: [], rackImages: [] };
  const coolingRooms = parsed.coolingRooms || [];
  const farmPower = parsed.farmPower || { devices: [] };
  const liveItems = workingProject?.items || [];
  const merged = effectiveOverlay
    ? mergeLivePurchaseOverlay(snapshotItems, liveItems)
    : snapshotItems;
  const clientItems = clientItemsFromReleaseSnapshot(merged).map(prepareSnapshotItemForClient);

  const hasProjectMeta = !!(parsed.projectMeta && typeof parsed.projectMeta === "object");
  // Legacy items[] without projectMeta → live allowlist fallback (not in strict historical mode).
  const allowLiveFallback = !historicalMode && !hasProjectMeta && parsed.schema === "legacy_items_array";
  const metaFields = applyPublishedProjectMeta(parsed.projectMeta, workingProject, { allowLiveFallback });

  const release = parsePublishedRelease(workingProject?.manualParams);
  const assetsPinned = releaseHasPinnedAssets(parsed);
  const schema = parsed.schema || null;
  const isLegacy = schema === "legacy_items_array" || (!assetsPinned && schema !== RELEASE_SCHEMA_V3);

  const compatibilityWarnings = [];
  if (historicalMode && isLegacy) {
    compatibilityWarnings.push({
      code: "LEGACY_SNAPSHOT",
      message: "Старая публикация: часть данных восстановлена через совместимость.",
    });
  }
  if (historicalMode && !assetsPinned) {
    compatibilityWarnings.push({
      code: "FRAME_DRAWINGS_NOT_PINNED",
      message: "Для этой старой публикации чертёж не был закреплён по версии.",
    });
  }

  const historicalRelease = versionRow
    ? {
        versionId: versionRow.id,
        versionNumber: versionRow.versionNumber,
        publishedAt: versionRow.createdAt || parsed.publishedAt || "",
        schemaVersion: schema,
        assetsPinned,
      }
    : null;

  return {
    id: workingProject?.id || parsed.projectMeta?.id || "",
    ...metaFields,
    rooms: coolingRooms,
    farmPower,
    items: clientItems,
    publishedRelease: historicalMode ? historicalRelease : release,
    isPublishedRelease: true,
    clientImages,
    pinnedFrameDrawings: assetsPinned ? (parsed.pinnedFrameDrawings || []) : (historicalMode ? [] : (parsed.pinnedFrameDrawings || [])),
    assetsPinned,
    releaseSchema: schema,
    purchaseStartedAt: historicalMode ? "" : (workingProject?.purchaseStartedAt || ""),
    installationDoneAt: historicalMode ? "" : (workingProject?.installationDoneAt || ""),
    lastClientActivityAt: historicalMode ? "" : (workingProject?.lastClientActivityAt || ""),
    clientTokenExpiresAt: historicalMode ? "" : (workingProject?.clientTokenExpiresAt || ""),
    revision: Number(workingProject?.revision) || 1,
    version: Number(versionRow?.versionNumber) || Number(parsed.projectMeta?.versionNumber) || Number(workingProject?.version) || 0,
    createdAt: workingProject?.createdAt || "",
    updatedAt: workingProject?.updatedAt || "",
    historical: !!historicalMode,
    historicalMode: !!historicalMode,
    historicalVersionId: versionRow?.id || null,
    historicalVersionNumber: versionRow?.versionNumber || null,
    historicalPublishedAt: versionRow?.createdAt || parsed.publishedAt || null,
    historicalSchema: schema,
    historicalAssetsPinned: assetsPinned,
    historicalCompatibility: {
      isLegacy,
      warnings: compatibilityWarnings,
      branding: historicalMode ? "live_global_branding" : null,
    },
    readOnly: !!historicalMode,
  };
}

/**
 * Admin historical preview: snapshot of a specific versionId, never the live published pointer alone.
 */
export function buildHistoricalClientPreview(projectId, versionId, workingProject = null) {
  const ver = loadVersionRow(projectId, versionId);
  if (!ver) return null;
  let parsedRaw;
  try {
    parsedRaw = JSON.parse(ver.snapshot || "[]");
  } catch {
    parsedRaw = [];
  }
  const project = workingProject || { id: projectId, items: [], manualParams: {} };
  const clientProject = buildClientProjectFromRelease(project, parsedRaw, {
    historicalMode: true,
    overlayLive: false,
    versionRow: ver,
  });
  const parsed = parseReleaseSnapshot(parsedRaw);
  let documents = [];
  if (releaseHasPinnedAssets(parsed)) {
    documents = documentsFromPinnedFrameDrawings(parsed.pinnedFrameDrawings || []);
  }
  return {
    historical: true,
    versionId: ver.id,
    versionNumber: ver.versionNumber,
    publishedAt: ver.createdAt,
    createdBy: ver.createdBy,
    schema: parsed.schema || null,
    assetsPinned: releaseHasPinnedAssets(parsed),
    summary: ver.summary,
    project: clientProject,
    documents,
    brandingNote: "live_global_branding",
  };
}

export function summarizeVersionRow(row, publishedVersionId = null) {
  let parsed;
  try {
    parsed = parseReleaseSnapshot(JSON.parse(row.snapshot || "[]"));
  } catch {
    parsed = parseReleaseSnapshot([]);
  }
  const meta = parsed.projectMeta && typeof parsed.projectMeta === "object" ? parsed.projectMeta : {};
  const items = parsed.items || [];
  const images = parsed.imageManifest || { projectSchemes: [], rackImages: [] };
  const imageCount =
    (images.projectSchemes || []).length + (images.rackImages || []).length;
  const drawingCount = (parsed.pinnedFrameDrawings || []).length;
  const assetsPinned = releaseHasPinnedAssets(parsed);
  const schema = parsed.schema || "legacy_items_array";
  const isLegacy = schema === "legacy_items_array" || (!assetsPinned && schema !== RELEASE_SCHEMA_V3);
  const isCurrent = !!publishedVersionId && row.id === publishedVersionId;
  const summaryObj = typeof row.summary === "string"
    ? (() => { try { return JSON.parse(row.summary || "{}"); } catch { return {}; } })()
    : (row.summary || {});
  const currency = String(meta.currency || "₽");
  return {
    id: row.id,
    versionId: row.id,
    projectId: row.project_id || row.projectId,
    versionNumber: row.version_number || row.versionNumber,
    createdAt: row.created_at || row.createdAt,
    createdBy: row.created_by || row.createdBy || "",
    workflowStatus: String(meta.status || summaryObj.workflowStatus || ""),
    summary: summaryObj,
    summaryText: formatReleaseSummaryText(summaryObj, currency),
    schema,
    assetsPinned,
    isLegacy,
    isCurrentPublished: isCurrent,
    badge: isCurrent ? "current" : isLegacy ? "legacy" : "historical",
    projectName: String(meta.name || ""),
    clientName: String(meta.client || ""),
    currency,
    vat: !!meta.vat,
    plannedTotal: publishedPlannedTotal(items),
    itemCount: items.length,
    imageCount,
    drawingCount,
  };
}

export function listVersionSummaries(projectId) {
  const project = db.prepare("SELECT id, manual_params FROM projects WHERE id = ?").get(projectId);
  if (!project) return null;
  let manual = {};
  try { manual = JSON.parse(project.manual_params || "{}"); } catch { manual = {}; }
  const publishedId = parsePublishedRelease(manual)?.versionId || null;
  const rows = db
    .prepare(
      `SELECT id, project_id, version_number, created_at, created_by, summary, snapshot
       FROM spec_versions
       WHERE project_id = ?
       ORDER BY version_number DESC, created_at DESC, id DESC`
    )
    .all(projectId);
  return rows.map((r) => summarizeVersionRow(r, publishedId));
}

export function resolveClientDocumentsForRelease(projectId, snapshot) {
  const parsed = snapshot?.items ? snapshot : parseReleaseSnapshot(snapshot);
  if (releaseHasPinnedAssets(parsed) && (parsed.pinnedFrameDrawings || []).length >= 0 && parsed.assetsPinned) {
    // v3: only pinned drawings (may be empty list — intentional)
    const pinnedDocs = documentsFromPinnedFrameDrawings(parsed.pinnedFrameDrawings || []);
    // Keep non-frame project files (legacy attachments) from live files table
    const otherFiles = db.prepare(`
      SELECT id, type, filename, url, uploaded_at as uploadedAt
      FROM files
      WHERE project_id = ? AND type != 'frame_drawing'
      ORDER BY uploaded_at DESC
    `).all(projectId);
    return [...pinnedDocs, ...otherFiles];
  }
  return null; // signal caller to use legacy latest selection
}

export function getProjectReleaseInfo(project) {
  const release = parsePublishedRelease(project?.manualParams);
  const publishedItems = release ? loadPublishedSnapshotItems(project) : [];
  const publishedSnapshot = release ? loadPublishedReleaseSnapshot(project) : null;
  const workingImages = buildClientImageManifest(project);
  const publishedImages = publishedSnapshot?.imageManifest || { projectSchemes: [], rackImages: [] };
  const workingPins = listLatestClientVisibleFrameDrawings(project.id).map((d) => ({
    drawingId: d.drawingId,
    drawingVersion: d.drawingVersion,
    url: d.pdfUrl || d.url,
    targetKey: d.moduleRackKey || d.stellageId || d.presetId || d.drawingId,
  }));
  const unpublished = release
    ? detectUnpublishedChanges(
        project?.items || [],
        publishedItems,
        workingImages,
        publishedImages,
        project?.rooms || [],
        publishedSnapshot?.coolingRooms || [],
        buildFarmPowerSnapshot(project?.manualParams?.farmPower, project?.rooms),
        publishedSnapshot?.farmPower || {},
        workingPins,
        publishedSnapshot?.pinnedFrameDrawings || null,
      )
    : { hasChanges: false, changedCount: 0, addedCount: 0, removedCount: 0 };
  return {
    publishedRelease: release,
    publishedSnapshotItems: publishedItems,
    hasUnpublishedChanges: unpublished.hasChanges,
    unpublishedSummary: unpublished,
  };
}

/**
 * Whether status transition requires publishing first.
 */
export function shouldPublishOnStatusChange(currentProject, nextStatus) {
  if (!isPublishWorkflowStatus(nextStatus)) return false;
  const release = parsePublishedRelease(currentProject?.manualParams);
  if (!release) return true;
  const publishedItems = loadPublishedSnapshotItems(currentProject);
  const publishedSnapshot = loadPublishedReleaseSnapshot(currentProject);
  const fpWork = workingItemsPublishFingerprint(currentProject?.items || []);
  const fpPub = workingItemsPublishFingerprint(publishedItems);
  const workingPins = listLatestClientVisibleFrameDrawings(currentProject.id).map((d) => ({
    drawingId: d.drawingId,
    drawingVersion: d.drawingVersion,
    url: d.pdfUrl || d.url,
    targetKey: d.moduleRackKey || d.stellageId || d.presetId || d.drawingId,
  }));
  const snapshotExtrasChanged = detectUnpublishedChanges(
    currentProject?.items || [], publishedItems,
    buildClientImageManifest(currentProject),
    publishedSnapshot?.imageManifest || { projectSchemes: [], rackImages: [] },
    currentProject?.rooms || [],
    publishedSnapshot?.coolingRooms || [],
    buildFarmPowerSnapshot(currentProject?.manualParams?.farmPower, currentProject?.rooms),
    publishedSnapshot?.farmPower || {},
    workingPins,
    publishedSnapshot?.pinnedFrameDrawings || null,
  ).hasChanges;
  if (fpWork === fpPub && !snapshotExtrasChanged) return false;
  return snapshotExtrasChanged;
}

/**
 * Prepare release_v3 snapshot JSON. Hashes assets BEFORE any DB write.
 * Throws PUBLISH_ASSET_MISSING if a local client-visible binary is absent.
 */
export function prepareReleaseSnapshotPayload(project) {
  const imageManifest = enrichImageManifestForPublish(project);
  const pinnedFrameDrawings = buildPinnedFrameDrawingsForPublish(project.id);
  return buildReleaseSnapshotPayload(project, project?.items || [], {
    schema: RELEASE_SCHEMA_V3,
    assetsPinned: true,
    imageManifest,
    pinnedFrameDrawings,
  });
}

export function buildReleaseSnapshotJson(project) {
  return JSON.stringify(prepareReleaseSnapshotPayload(project));
}

export {
  parseReleaseSnapshot,
  releaseSnapshotItems,
  releaseSnapshotImageManifest,
  parsePublishedRelease,
  isPublishWorkflowStatus,
  releaseHasPinnedAssets,
};
