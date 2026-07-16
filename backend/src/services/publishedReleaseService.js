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
  workingItemsPublishFingerprint,
} from "../../../shared/projectPublishedRelease.js";
import { buildClientImageManifest } from "../../../shared/clientImageManifest.js";
import { stripClientTechnicalFields } from "../../../shared/clientPurchaseRows.js";
import { normalizePurchaseStatus, getPurchaseStatusLabel } from "../../../shared/purchaseStatusRules.js";
import { lineVisibleToClient } from "../../../shared/itemTypes.js";
import { validateProjectForPublish } from "./publishRules.js";

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

export function buildClientProjectFromRelease(workingProject, snapshot, { overlayLive = true } = {}) {
  const snapshotItems = Array.isArray(snapshot) ? snapshot : snapshot?.items || [];
  const clientImages = Array.isArray(snapshot) ? { projectSchemes: [], rackImages: [] } : snapshot?.imageManifest || { projectSchemes: [], rackImages: [] };
  const liveItems = workingProject?.items || [];
  const merged = overlayLive
    ? mergeLivePurchaseOverlay(snapshotItems, liveItems)
    : snapshotItems;
  const clientItems = clientItemsFromReleaseSnapshot(merged).map(prepareSnapshotItemForClient);
  const {
    clientToken,
    selectedModules,
    stellageConfigs,
    zones,
    purchaseStartedAt,
    installationDoneAt,
    manualParams: _manualParams,
    items: _drop,
    ...safe
  } = workingProject;
  const release = parsePublishedRelease(workingProject.manualParams);
  return {
    ...safe,
    items: clientItems,
    publishedRelease: release,
    isPublishedRelease: true,
    clientImages,
  };
}

export function getProjectReleaseInfo(project) {
  const release = parsePublishedRelease(project?.manualParams);
  const publishedItems = release ? loadPublishedSnapshotItems(project) : [];
  const publishedSnapshot = release ? loadPublishedReleaseSnapshot(project) : null;
  const workingImages = buildClientImageManifest(project);
  const publishedImages = publishedSnapshot?.imageManifest || { projectSchemes: [], rackImages: [] };
  const unpublished = release
    ? detectUnpublishedChanges(project?.items || [], publishedItems, workingImages, publishedImages)
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
 * ready_to_send → always ensure publish
 * sent_to_client from ready_to_send → skip duplicate if fingerprint matches
 */
export function shouldPublishOnStatusChange(currentProject, nextStatus) {
  if (!isPublishWorkflowStatus(nextStatus)) return false;
  const release = parsePublishedRelease(currentProject?.manualParams);
  if (!release) return true;
  const publishedItems = loadPublishedSnapshotItems(currentProject);
  const publishedSnapshot = loadPublishedReleaseSnapshot(currentProject);
  const fpWork = workingItemsPublishFingerprint(currentProject?.items || []);
  const fpPub = workingItemsPublishFingerprint(publishedItems);
  const imagesChanged = detectUnpublishedChanges(
    currentProject?.items || [], publishedItems,
    buildClientImageManifest(currentProject),
    publishedSnapshot?.imageManifest || { projectSchemes: [], rackImages: [] },
  ).hasChanges;
  if (fpWork === fpPub && !imagesChanged) return false;
  return imagesChanged;
}

export function buildReleaseSnapshotJson(project) {
  return JSON.stringify(buildReleaseSnapshotPayload(project, project?.items || []));
}

export { parseReleaseSnapshot, releaseSnapshotItems, releaseSnapshotImageManifest, parsePublishedRelease, isPublishWorkflowStatus };
