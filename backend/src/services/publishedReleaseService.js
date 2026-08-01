import { db, rowToMaterial } from "../db.js";
import {
  buildPublishedReleaseMeta,
  buildReleaseSnapshotPayload,
  clientItemsFromReleaseSnapshot,
  detectUnpublishedChanges,
  isLegacyReleaseIncomplete,
  isPublishWorkflowStatus,
  mergeLivePurchaseOverlay,
  parsePublishedRelease,
  parseReleaseSnapshot,
  RELEASE_SCHEMA_V4,
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
import { leanStellageCounts } from "../../../shared/profilePipeCuts.js";
import { documentsFromPinnedFrameDrawings } from "../../../shared/publishedAssetPin.js";
import { frameDrawingClientTargetKey } from "../../../shared/clientFrameDocuments.js";
import { normalizeDocumentManifest } from "../../../shared/publishedDocumentManifest.js";
import { publishedPlannedTotal } from "../../../shared/publishedPurchaseTotals.js";
import { formatReleaseSummaryText } from "../../../shared/releaseHistoryDiff.js";
import {
  enrichImageManifestForPublish,
  buildPinnedFrameDrawingsForPublish,
  listLatestClientVisibleFrameDrawings,
} from "./publishedAssetRetention.js";
import { freezeItemDisplayFields } from "../../../shared/materialTranslations.js";
import {
  getMaterialTranslation,
  sha256Utf8,
} from "./materialTranslationService.js";

function parseSummaryColumn(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
import { normalizeProjectCurrency } from "../../../shared/projectCurrency.js";
import { projectClientLanguage } from "../../../shared/projectClientLanguage.js";

export function loadVersionRow(projectId, versionId) {
  const row = db
    .prepare("SELECT * FROM spec_versions WHERE id = ? AND project_id = ?")
    .get(versionId, projectId);
  if (!row) return null;
  const releaseComment =
    row.release_comment != null && String(row.release_comment).trim()
      ? String(row.release_comment)
      : null;
  return {
    id: row.id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    createdAt: row.created_at,
    createdBy: row.created_by,
    summary: parseSummaryColumn(row.summary),
    releaseComment,
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

/**
 * A published version must belong to the project that points at it.
 * @param {string} projectId
 * @param {string} versionId
 */
export function versionBelongsToProject(projectId, versionId) {
  const pid = String(projectId || "").trim();
  const vid = String(versionId || "").trim();
  if (!pid || !vid) return false;
  const row = db
    .prepare("SELECT 1 AS ok FROM spec_versions WHERE id = ? AND project_id = ?")
    .get(vid, pid);
  return !!row;
}

/** Reasons a stored publishedRelease pointer is not usable. */
export const PUBLISHED_POINTER_STATUS = Object.freeze({
  VALID: "VALID_SAME_PROJECT",
  NULL: "POINTER_NULL",
  MALFORMED: "MALFORMED_POINTER",
  MISSING: "VERSION_MISSING",
  CROSS_PROJECT: "CROSS_PROJECT_POINTER",
});

/**
 * Classify a project's stored pointer without touching it.
 * @param {object} project loaded project (manualParams parsed)
 */
export function describePublishedPointerIntegrity(project) {
  const projectId = String(project?.id || "").trim();
  const raw = project?.manualParams?.publishedRelease;
  if (raw == null) return { status: PUBLISHED_POINTER_STATUS.NULL, ok: true, versionId: null };
  const release = parsePublishedRelease(project?.manualParams);
  if (!release?.versionId) {
    return { status: PUBLISHED_POINTER_STATUS.MALFORMED, ok: false, versionId: null };
  }
  const owner = db
    .prepare("SELECT project_id FROM spec_versions WHERE id = ?")
    .get(release.versionId);
  if (!owner) {
    return { status: PUBLISHED_POINTER_STATUS.MISSING, ok: false, versionId: release.versionId };
  }
  if (String(owner.project_id) !== projectId) {
    return {
      status: PUBLISHED_POINTER_STATUS.CROSS_PROJECT,
      ok: false,
      versionId: release.versionId,
    };
  }
  return { status: PUBLISHED_POINTER_STATUS.VALID, ok: true, versionId: release.versionId };
}

/**
 * Refuse to store a pointer at a version this project does not own.
 * Server-authoritative: called on every pointer write path.
 *
 * @param {string} projectId
 * @param {object|null} publishedRelease
 */
export function assertPublishedReleaseOwnership(projectId, publishedRelease) {
  if (publishedRelease == null) return;
  const versionId = String(publishedRelease?.versionId || "").trim();
  if (!versionId || !versionBelongsToProject(projectId, versionId)) {
    const err = new Error("Published version does not belong to this project");
    err.code = "PUBLISHED_RELEASE_PROJECT_MISMATCH";
    // Admin-context detail only; never surfaced on client routes.
    err.projectId = String(projectId || "");
    err.versionId = versionId;
    throw err;
  }
}

/** Read-only integrity report over every project pointer (admin/ops use). */
export function findInvalidPublishedVersionPointers() {
  const rows = db.prepare("SELECT id, manual_params FROM projects").all();
  const invalid = [];
  for (const row of rows) {
    let manualParams = {};
    try {
      manualParams = JSON.parse(row.manual_params || "{}");
    } catch {
      manualParams = {};
    }
    const res = describePublishedPointerIntegrity({ id: row.id, manualParams });
    if (!res.ok) {
      invalid.push({ projectId: row.id, versionId: res.versionId, status: res.status });
    }
  }
  return invalid;
}

export function loadPublishedReleaseSnapshot(project) {
  const release = parsePublishedRelease(project?.manualParams);
  if (!release) return null;
  const ver = loadVersionRow(project.id, release.versionId);
  if (!ver) return null;
  try {
    return parseReleaseSnapshot(JSON.parse(ver.snapshot || "[]"));
  } catch {
    return parseReleaseSnapshot([]);
  }
}

export function loadPublishedSnapshotItems(project) {
  const parsed = loadPublishedReleaseSnapshot(project);
  return parsed?.items || [];
}

export function prepareSnapshotItemForClient(item) {
  const base = stripClientTechnicalFields({ ...item });
  const status = normalizePurchaseStatus(base);
  // Prefer frozen display* from publish (EN or RU). Never re-resolve live catalog.
  const name = base.displayName || base.name;
  const unit = base.displayUnit || base.unit;
  const category = base.displayCategory || base.category;
  const clientNote =
    base.displayDescription != null && String(base.displayDescription).length
      ? base.displayDescription
      : base.clientNote;
  return {
    ...base,
    name,
    unit,
    category,
    clientNote,
    status,
    purchaseStatus: status,
    statusLabel: getPurchaseStatusLabel(status),
  };
}

/** Merge only approved live purchase fields onto a frozen release item. */
export function prepareClientMutationItemResponse(snapshotItem, liveItem) {
  const merged = mergeLivePurchaseOverlay(
    [snapshotItem || {}],
    [liveItem || snapshotItem || {}],
  )[0];
  return prepareSnapshotItemForClient(merged);
}

const CLIENT_PROJECT_META_KEYS = [
  "id",
  "name",
  "client",
  "city",
  "currency",
  "currencyCode",
  "currencyName",
  "currencyCustom",
  "currencySymbol",
  "vat",
  "comment",
  "area",
  "height",
  "sowingArea",
  "type",
  "status",
  "version",
  "revision",
  "createdAt",
  "updatedAt",
  "lastClientActivityAt",
  "clientTokenExpiresAt",
  "purchaseStartedAt",
  "installationDoneAt",
];

function metaFromSnapshot(projectMeta, workingProject) {
  const meta = projectMeta && typeof projectMeta === "object" ? projectMeta : {};
  const out = {};
  for (const key of CLIENT_PROJECT_META_KEYS) {
    if (meta[key] !== undefined) out[key] = meta[key];
    else if (workingProject?.[key] !== undefined && ["id", "revision", "createdAt", "updatedAt", "lastClientActivityAt", "clientTokenExpiresAt", "purchaseStartedAt", "installationDoneAt", "status"].includes(key)) {
      out[key] = workingProject[key];
    }
  }
  // Prefer snapshotted commercial header fields when present.
  if (meta.name != null) out.name = meta.name;
  if (meta.client != null) out.client = meta.client;
  if (meta.city != null) out.city = meta.city;
  if (meta.currency != null) out.currency = meta.currency;
  if (meta.vat != null) out.vat = !!meta.vat;
  if (meta.comment != null) out.comment = meta.comment;
  if (meta.versionNumber != null) out.version = Number(meta.versionNumber) || 0;
  // Freeze currency from snapshot meta only (never live working project currency).
  const cur = normalizeProjectCurrency({
    currency: meta.currency,
    currencyCode: meta.currencyCode,
    currencySymbol: meta.currencySymbol,
    currencyName: meta.currencyName,
    currencyCustom: meta.currencyCustom,
  });
  out.currency = cur.currencySymbol;
  out.currencyCode = cur.currencyCode;
  out.currencySymbol = cur.currencySymbol;
  out.currencyName = cur.currencyName;
  out.currencyCustom = !!cur.currencyCustom;
  out.id = workingProject?.id || meta.id || "";
  out.clientLanguage = projectClientLanguage(meta);
  out.revision = Number(workingProject?.revision) || 1;
  return out;
}

export function buildClientProjectFromRelease(workingProject, snapshotItemsOrParsed, {
  overlayLive = true,
  historicalMode = false,
  versionRow = null,
} = {}) {
  const parsed = snapshotItemsOrParsed?.items
    ? parseReleaseSnapshot(snapshotItemsOrParsed)
    : parseReleaseSnapshot(snapshotItemsOrParsed);
  const snapshotItems = parsed.items || [];
  const liveItems = workingProject?.items || [];
  const effectiveOverlay = historicalMode ? false : overlayLive;
  const merged = effectiveOverlay
    ? mergeLivePurchaseOverlay(snapshotItems, liveItems)
    : snapshotItems;
  const clientItems = clientItemsFromReleaseSnapshot(merged).map(prepareSnapshotItemForClient);

  const hasProjectMeta = !!(parsed.projectMeta && typeof parsed.projectMeta === "object");
  const allowLiveFallback = !historicalMode && !hasProjectMeta && parsed.schema === "legacy_items_array";
  const metaFields = applyPublishedProjectMeta(parsed.projectMeta, workingProject, { allowLiveFallback });
  // Reinforce currency from snapshot code/symbol (never leave stale ₽ when code is USD).
  if (hasProjectMeta) {
    const cur = normalizeProjectCurrency(parsed.projectMeta);
    metaFields.currency = cur.currencySymbol;
    metaFields.currencyCode = cur.currencyCode;
    metaFields.currencySymbol = cur.currencySymbol;
    metaFields.currencyName = cur.currencyName;
    metaFields.currencyCustom = !!cur.currencyCustom;
  }
  const release = parsePublishedRelease(workingProject?.manualParams);
  const assetsPinned = releaseHasPinnedAssets(parsed);
  const schema = parsed.schema || null;
  const legacyIncomplete = isLegacyReleaseIncomplete(parsed);
  const compatibilityWarnings = [];
  if (historicalMode && legacyIncomplete) {
    compatibilityWarnings.push({
      code: "LEGACY_SNAPSHOT",
      message: "Старая публикация неполна; требуется повторная публикация.",
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
    rooms: parsed.coolingRooms || [],
    farmPower: parsed.farmPower || { devices: [] },
    items: clientItems,
    stellageCounts: legacyIncomplete
      ? []
      : leanStellageCounts(parsed.stellageCounts?.length
        ? parsed.stellageCounts
        : parsed.projectMeta?.stellageCounts || []),
    documentManifest: legacyIncomplete
      ? []
      : normalizeDocumentManifest(parsed.documentManifest || []),
    publishedRelease: historicalMode ? historicalRelease : release,
    isPublishedRelease: true,
    clientImages: parsed.imageManifest || { projectSchemes: [], rackImages: [] },
    pinnedFrameDrawings: assetsPinned ? (parsed.pinnedFrameDrawings || []) : [],
    assetsPinned,
    legacyReleaseIncomplete: legacyIncomplete,
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
      isLegacy: legacyIncomplete,
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
  const currency = String(
    clientProject?.currencySymbol
      || clientProject?.currency
      || parsed.projectMeta?.currencySymbol
      || parsed.projectMeta?.currency
      || "₽",
  );
  return {
    historical: true,
    versionId: ver.id,
    versionNumber: ver.versionNumber,
    publishedAt: ver.createdAt,
    createdBy: ver.createdBy,
    schema: parsed.schema || null,
    assetsPinned: releaseHasPinnedAssets(parsed),
    summary: ver.summary,
    summaryText: formatReleaseSummaryText(ver.summary || {}, currency),
    // Admin-only; never copied onto clientProject DTO.
    releaseComment: ver.releaseComment || null,
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
  const summaryObj = parseSummaryColumn(row.summary);
  const currency = String(meta.currency || "₽");
  const plannedTotal = publishedPlannedTotal(items);
  const delta = Number(summaryObj.delta);
  const releaseComment =
    row.release_comment != null && String(row.release_comment).trim()
      ? String(row.release_comment)
      : null;
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
    releaseComment,
    schema,
    assetsPinned,
    isLegacy,
    isCurrentPublished: isCurrent,
    badge: isCurrent ? "current" : isLegacy ? "legacy" : "historical",
    projectName: String(meta.name || ""),
    clientName: String(meta.client || ""),
    currency,
    vat: !!meta.vat,
    plannedTotal,
    totalDelta: Number.isFinite(delta) ? delta : null,
    sumBefore: Number.isFinite(Number(summaryObj.sumBefore)) ? Number(summaryObj.sumBefore) : null,
    sumAfter: Number.isFinite(Number(summaryObj.sumAfter)) ? Number(summaryObj.sumAfter) : plannedTotal,
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
      `SELECT id, project_id, version_number, created_at, created_by, summary, snapshot, release_comment
       FROM spec_versions
       WHERE project_id = ?
       ORDER BY version_number DESC, created_at DESC, id DESC`
    )
    .all(projectId);
  return rows.map((r) => summarizeVersionRow(r, publishedId));
}

/**
 * Documents for a client GET: snapshot manifest only.
 * Legacy / incomplete releases → [] (no live fallback).
 */
export function resolveClientDocumentsForRelease(projectIdOrSnapshot, maybeSnapshot) {
  const snapshot = maybeSnapshot === undefined ? projectIdOrSnapshot : maybeSnapshot;
  const parsed = snapshot?.items != null && !Array.isArray(snapshot)
    ? snapshot
    : parseReleaseSnapshot(snapshot);
  if (isLegacyReleaseIncomplete(parsed)) return [];
  return normalizeDocumentManifest(parsed.documentManifest || []);
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
    targetKey: frameDrawingClientTargetKey(d),
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
  const plannedTotalCurrent = publishedPlannedTotal(project?.items || []);
  const plannedTotalPublished = publishedItems.length
    ? publishedPlannedTotal(publishedItems)
    : null;
  const meta = publishedSnapshot?.projectMeta || null;
  const publishedSnapshotMeta = meta
    ? (() => {
        const cur = normalizeProjectCurrency(meta);
        return {
          name: meta.name || "",
          client: meta.client || "",
          city: meta.city || "",
          currency: cur.currencySymbol,
          currencyCode: cur.currencyCode,
          currencyName: cur.currencyName,
          currencyCustom: !!cur.currencyCustom,
          currencySymbol: cur.currencySymbol,
          vat: !!meta.vat,
          stellageCounts: Array.isArray(meta.stellageCounts) ? meta.stellageCounts : (publishedSnapshot?.stellageCounts || []),
          versionNumber: Number(meta.versionNumber) || Number(release?.versionNumber) || 0,
          comment: meta.comment || "",
          clientLanguage: projectClientLanguage(meta),
          id: meta.id || project?.id || "",
        };
      })()
    : null;
  const legacyIncomplete = release ? isLegacyReleaseIncomplete(publishedSnapshot || {}) : false;
  const pointerIntegrity = describePublishedPointerIntegrity(project);
  return {
    publishedRelease: release,
    publishedSnapshotItems: publishedItems,
    publishedSnapshotMeta,
    publishedStellageCounts:
      publishedSnapshot?.stellageCounts || publishedSnapshotMeta?.stellageCounts || [],
    publishedDocumentManifest: publishedSnapshot?.documentManifest || [],
    hasUnpublishedChanges: unpublished.hasChanges,
    unpublishedSummary: {
      ...unpublished,
      plannedTotalCurrent,
      plannedTotalPublished,
      totalDelta:
        plannedTotalPublished != null ? plannedTotalCurrent - plannedTotalPublished : plannedTotalCurrent,
    },
    legacyReleaseIncomplete: legacyIncomplete,
    needsRepublish: legacyIncomplete,
    releaseSchema: publishedSnapshot?.schema || null,
    // Admin-only diagnostic. Client routes never expose this.
    publishedPointerIntegrity: pointerIntegrity.ok
      ? null
      : {
          code: "PUBLISHED_RELEASE_PROJECT_MISMATCH",
          status: pointerIntegrity.status,
          projectId: project?.id || "",
          versionId: pointerIntegrity.versionId || "",
        },
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
    targetKey: frameDrawingClientTargetKey(d),
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
 * Prepare release_v4 snapshot JSON. Hashes assets BEFORE any DB write.
 * Throws PUBLISH_ASSET_MISSING if a local client-visible binary is absent.
 */
export function prepareReleaseSnapshotPayload(project, extras = {}) {
  const imageManifest = enrichImageManifestForPublish(project);
  const pinnedFrameDrawings = buildPinnedFrameDrawingsForPublish(project.id);
  const language = projectClientLanguage(project);
  const items = (project?.items || []).map((item) => {
    const materialId = String(item?.materialId || item?.material_id || "").trim();
    const translation = materialId ? getMaterialTranslation(materialId, "en") : null;
    const matRow = materialId
      ? db.prepare("SELECT * FROM materials WHERE id = ?").get(materialId)
      : null;
    const material = matRow ? rowToMaterial(matRow) : null;
    return freezeItemDisplayFields(item, {
      language,
      translation,
      material,
      sourceHashFn: sha256Utf8,
    });
  });
  return buildReleaseSnapshotPayload(project, items, {
    schema: RELEASE_SCHEMA_V4,
    assetsPinned: true,
    imageManifest,
    pinnedFrameDrawings,
    ...extras,
  });
}

export function buildReleaseSnapshotJson(project, extras = {}) {
  return JSON.stringify(prepareReleaseSnapshotPayload(project, extras));
}

export {
  parseReleaseSnapshot,
  releaseSnapshotItems,
  releaseSnapshotImageManifest,
  parsePublishedRelease,
  isPublishWorkflowStatus,
  releaseHasPinnedAssets,
  isLegacyReleaseIncomplete,
  RELEASE_SCHEMA_V4,
};
