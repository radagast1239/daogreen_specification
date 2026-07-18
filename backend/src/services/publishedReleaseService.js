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
 */
export function buildClientProjectFromRelease(workingProject, snapshot, { overlayLive = true } = {}) {
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

  const snapshotItems = parsed.items || [];
  const clientImages = parsed.imageManifest || { projectSchemes: [], rackImages: [] };
  const coolingRooms = parsed.coolingRooms || [];
  const farmPower = parsed.farmPower || { devices: [] };
  const liveItems = workingProject?.items || [];
  const merged = overlayLive
    ? mergeLivePurchaseOverlay(snapshotItems, liveItems)
    : snapshotItems;
  const clientItems = clientItemsFromReleaseSnapshot(merged).map(prepareSnapshotItemForClient);

  const hasProjectMeta = !!(parsed.projectMeta && typeof parsed.projectMeta === "object");
  // Legacy items[] without projectMeta → live allowlist fallback. release_v2/v3 use snapshot meta.
  const allowLiveFallback = !hasProjectMeta && parsed.schema === "legacy_items_array";
  const metaFields = applyPublishedProjectMeta(parsed.projectMeta, workingProject, { allowLiveFallback });

  const release = parsePublishedRelease(workingProject?.manualParams);
  const assetsPinned = releaseHasPinnedAssets(parsed);

  return {
    id: workingProject?.id || parsed.projectMeta?.id || "",
    ...metaFields,
    rooms: coolingRooms,
    farmPower,
    items: clientItems,
    publishedRelease: release,
    isPublishedRelease: true,
    clientImages,
    pinnedFrameDrawings: parsed.pinnedFrameDrawings || [],
    assetsPinned,
    releaseSchema: parsed.schema || null,
    purchaseStartedAt: workingProject?.purchaseStartedAt || "",
    installationDoneAt: workingProject?.installationDoneAt || "",
    lastClientActivityAt: workingProject?.lastClientActivityAt || "",
    clientTokenExpiresAt: workingProject?.clientTokenExpiresAt || "",
    revision: Number(workingProject?.revision) || 1,
    version: Number(parsed.projectMeta?.versionNumber) || Number(workingProject?.version) || 0,
    createdAt: workingProject?.createdAt || "",
    updatedAt: workingProject?.updatedAt || "",
  };
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
