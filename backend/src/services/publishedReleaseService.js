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
  workingItemsPublishFingerprint,
} from "../../../shared/projectPublishedRelease.js";
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

export function buildClientProjectFromRelease(workingProject, snapshotItems, { overlayLive = true } = {}) {
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
    items: _drop,
    ...safe
  } = workingProject;
  const release = parsePublishedRelease(workingProject.manualParams);
  return {
    ...safe,
    items: clientItems,
    publishedRelease: release,
    isPublishedRelease: true,
  };
}

export function getProjectReleaseInfo(project) {
  const release = parsePublishedRelease(project?.manualParams);
  const publishedItems = release ? loadPublishedSnapshotItems(project) : [];
  const unpublished = release
    ? detectUnpublishedChanges(project?.items || [], publishedItems)
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
  const fpWork = workingItemsPublishFingerprint(currentProject?.items || []);
  const fpPub = workingItemsPublishFingerprint(publishedItems);
  if (fpWork === fpPub) return false;
  return detectUnpublishedChanges(currentProject?.items || [], publishedItems).hasChanges;
}

export function buildReleaseSnapshotJson(project) {
  return JSON.stringify(buildReleaseSnapshotPayload(project, project?.items || []));
}

export { parseReleaseSnapshot, releaseSnapshotItems, parsePublishedRelease, isPublishWorkflowStatus };
