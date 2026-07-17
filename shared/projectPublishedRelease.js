/** Published client release — pure helpers (frontend + backend). */

import { lineVisibleToClient } from "./itemTypes.js";
import { projectItemMatchKey } from "./projectItemKey.js";
import { buildClientImageManifest, normalizeClientImageManifest, clientImageManifestFingerprint } from "./clientImageManifest.js";
import { buildFarmPowerSnapshot, farmPowerFingerprint, normalizeFarmPower } from "./farmPower.js";

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

/** Client-safe, immutable room cooling calculations for a published release. */
export function buildPublishedCoolingRooms(rooms = []) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter((room) => room?.cooling?.params && typeof room.cooling.params === "object")
    .map((room) => ({
      id: String(room.id || ""),
      name: String(room.name || "Комната"),
      area: room.area ?? "",
      height: room.height ?? "",
      volume: room.volume ?? "",
      targetTempC: room.targetTempC ?? "",
      reservePct: room.reservePct ?? "",
      lightingW: room.lightingW ?? "",
      peopleEquipW: room.peopleEquipW ?? "",
      heatGainW: room.heatGainW ?? "",
      cooling: cloneJson(room.cooling, {}),
      acUnits: (Array.isArray(room.acUnits) ? room.acUnits : []).map((unit) => ({
        id: String(unit?.id || ""),
        qty: unit?.qty ?? "",
        coolingKw: unit?.coolingKw ?? "",
        dayElectricKw: unit?.dayElectricKw ?? unit?.electricKw ?? "",
        dayHours: unit?.dayHours ?? 16,
        nightElectricKw: unit?.nightElectricKw ?? "",
        nightHours: unit?.nightHours ?? 8,
        link: String(unit?.link || ""),
        comment: String(unit?.comment || ""),
      })),
    }));
}

export function coolingRoomsFingerprint(rooms = []) {
  return JSON.stringify(buildPublishedCoolingRooms(rooms));
}

/** Workflow statuses that require / imply a published client release. */
export const PUBLISH_WORKFLOW_STATUSES = new Set([
  "ready_to_send",
  "sent_to_client",
  "client_buying",
  "purchase_complete",
]);

export function isPublishWorkflowStatus(status) {
  return PUBLISH_WORKFLOW_STATUSES.has(String(status || "").trim());
}

export function parsePublishedRelease(manualParams = {}) {
  const raw = manualParams?.publishedRelease;
  if (!raw || typeof raw !== "object") return null;
  const versionId = String(raw.versionId || "").trim();
  const versionNumber = Number(raw.versionNumber) || 0;
  if (!versionId || !versionNumber) return null;
  return {
    versionId,
    versionNumber,
    publishedAt: raw.publishedAt || "",
    workflowStatus: raw.workflowStatus || "",
  };
}

/** Build publishedRelease object stored in manual_params. */
export function buildPublishedReleaseMeta(versionRow, workflowStatus = "") {
  return {
    versionId: versionRow.id,
    versionNumber: versionRow.versionNumber,
    publishedAt: versionRow.createdAt || new Date().toISOString(),
    workflowStatus: workflowStatus || "",
  };
}

/**
 * Full release snapshot payload stored in spec_versions.snapshot.
 * Backward compatible: legacy rows may be a bare items[] array.
 */
export function buildReleaseSnapshotPayload(project, items = project?.items || []) {
  const list = Array.isArray(items) ? items : [];
  return {
    schema: "release_v2",
    publishedAt: new Date().toISOString(),
    projectMeta: {
      id: project?.id || "",
      name: project?.name || "",
      client: project?.client || "",
      city: project?.city || "",
      currency: project?.currency || "₽",
      vat: !!project?.vat,
      versionNumber: Number(project?.version) || 0,
    },
    items: list.map((it) => ({ ...it })),
    imageManifest: buildClientImageManifest(project),
    coolingRooms: buildPublishedCoolingRooms(project?.rooms),
    farmPower: buildFarmPowerSnapshot(project?.manualParams?.farmPower, project?.rooms),
  };
}

export function parseReleaseSnapshot(raw) {
  if (!raw) return { items: [], projectMeta: null, imageManifest: normalizeClientImageManifest(), coolingRooms: [], farmPower: normalizeFarmPower(), schema: null };
  if (Array.isArray(raw)) {
    return { items: raw, projectMeta: null, imageManifest: normalizeClientImageManifest(), coolingRooms: [], farmPower: normalizeFarmPower(), schema: "legacy_items_array" };
  }
  if (typeof raw === "object" && Array.isArray(raw.items)) {
    return {
      items: raw.items,
      projectMeta: raw.projectMeta || null,
      schema: raw.schema || "release_v1",
      publishedAt: raw.publishedAt || "",
      imageManifest: normalizeClientImageManifest(raw.imageManifest),
      coolingRooms: buildPublishedCoolingRooms(raw.coolingRooms),
      farmPower: normalizeFarmPower(raw.farmPower),
    };
  }
  return { items: [], projectMeta: null, imageManifest: normalizeClientImageManifest(), coolingRooms: [], farmPower: normalizeFarmPower(), schema: null };
}

export function releaseSnapshotItems(rawSnapshot) {
  const parsed = typeof rawSnapshot === "string"
    ? parseReleaseSnapshot(JSON.parse(rawSnapshot || "[]"))
    : parseReleaseSnapshot(rawSnapshot);
  return parsed.items || [];
}

export function releaseSnapshotImageManifest(rawSnapshot) {
  const parsed = typeof rawSnapshot === "string" ? parseReleaseSnapshot(JSON.parse(rawSnapshot || "[]")) : parseReleaseSnapshot(rawSnapshot);
  return normalizeClientImageManifest(parsed.imageManifest);
}

/** Client-visible pool from frozen snapshot — no catalog enrich. */
export function clientItemsFromReleaseSnapshot(items = []) {
  return (items || []).filter((it) => lineVisibleToClient(it));
}

/**
 * Overlay live purchase fields onto published snapshot (status, actualPrice, clientComment).
 * Catalog/commercial fields stay from snapshot.
 */
export function mergeLivePurchaseOverlay(snapshotItems = [], liveItems = []) {
  const liveById = new Map((liveItems || []).map((it) => [it.id, it]));
  return (snapshotItems || []).map((snap) => {
    const live = liveById.get(snap.id);
    if (!live) return { ...snap };
    return {
      ...snap,
      status: live.status ?? snap.status,
      actualPrice: live.actualPrice ?? snap.actualPrice,
      clientComment: live.clientComment ?? snap.clientComment,
    };
  });
}

const CHANGE_KEYS = ["qty", "price", "actualPrice", "name", "supplier", "link", "visibleToClient"];

function itemChanged(a, b) {
  for (const k of CHANGE_KEYS) {
    const va = a?.[k];
    const vb = b?.[k];
    if (k === "price" || k === "actualPrice" || k === "qty") {
      if ((Number(va) || 0) !== (Number(vb) || 0)) return true;
    } else if (String(va ?? "").trim() !== String(vb ?? "").trim()) return true;
  }
  return false;
}

/**
 * Detect unpublished changes vs published snapshot (working draft vs release).
 */
export function detectUnpublishedChanges(
  workingItems = [],
  publishedItems = [],
  workingImages = null,
  publishedImages = null,
  workingCoolingRooms = null,
  publishedCoolingRooms = null,
  workingFarmPower = null,
  publishedFarmPower = null,
) {
  const pubMap = new Map((publishedItems || []).map((it) => [it.id, it]));
  const workMap = new Map((workingItems || []).map((it) => [it.id, it]));
  let changedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  for (const [id, w] of workMap) {
    const p = pubMap.get(id);
    if (!p) {
      if (lineVisibleToClient(w)) addedCount++;
      continue;
    }
    if (itemChanged(w, p)) changedCount++;
  }
  for (const [id, p] of pubMap) {
    if (!workMap.has(id) && lineVisibleToClient(p)) removedCount++;
  }

  const imagesChanged = workingImages != null && publishedImages != null
    ? clientImageManifestFingerprint(workingImages) !== clientImageManifestFingerprint(publishedImages)
    : false;
  const coolingChanged = workingCoolingRooms != null && publishedCoolingRooms != null
    ? coolingRoomsFingerprint(workingCoolingRooms) !== coolingRoomsFingerprint(publishedCoolingRooms)
    : false;
  const farmPowerChanged = workingFarmPower != null && publishedFarmPower != null
    ? farmPowerFingerprint(workingFarmPower) !== farmPowerFingerprint(publishedFarmPower)
    : false;
  return {
    hasChanges: changedCount > 0 || addedCount > 0 || removedCount > 0 || imagesChanged || coolingChanged || farmPowerChanged,
    changedCount,
    addedCount,
    removedCount,
    imagesChanged,
    coolingChanged,
    farmPowerChanged,
  };
}

/** Compare working items fingerprint for duplicate publish skip. */
export function workingItemsPublishFingerprint(items = []) {
  return (items || [])
    .filter((it) => lineVisibleToClient(it))
    .map((it) => `${it.id}|${projectItemMatchKey(it)}|${Number(it.qty) || 0}|${Number(it.price) || 0}|${Number(it.actualPrice) || 0}`)
    .sort()
    .join("\n");
}
