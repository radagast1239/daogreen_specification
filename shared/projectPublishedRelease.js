/** Published client release — pure helpers (frontend + backend). */

import { lineVisibleToClient } from "./itemTypes.js";
import { projectItemIdentityKey, projectItemMaterialMatchKey } from "./projectItemKey.js";
import {
  buildClientImageManifest,
  normalizeClientImageManifest,
  clientImageManifestFingerprint,
} from "./clientImageManifest.js";
import { buildFarmPowerSnapshot, farmPowerFingerprint, normalizeFarmPower } from "./farmPower.js";
import { buildPublishedProjectMeta } from "./publishedClientMeta.js";
import {
  normalizePinnedFrameDrawings,
  pinnedFrameDrawingsFingerprint,
} from "./publishedAssetPin.js";
import { CLIENT_LIVE_PURCHASE_OVERLAY_FIELDS } from "./publishedLiveOverlays.js";

export const RELEASE_SCHEMA_V2 = "release_v2";
export const RELEASE_SCHEMA_V3 = "release_v3";

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
 * release_v3 adds assetsPinned + pinnedFrameDrawings + hashed imageManifest.
 * Backward compatible: legacy rows may be a bare items[] array; release_v2 still readable.
 */
export function buildReleaseSnapshotPayload(project, items = project?.items || [], extras = {}) {
  const list = Array.isArray(items) ? items : [];
  const schema = extras.schema || RELEASE_SCHEMA_V3;
  const assetsPinned = extras.assetsPinned != null ? !!extras.assetsPinned : schema === RELEASE_SCHEMA_V3;
  const imageManifest = extras.imageManifest != null
    ? normalizeClientImageManifest(extras.imageManifest)
    : buildClientImageManifest(project);
  const pinnedFrameDrawings = normalizePinnedFrameDrawings(extras.pinnedFrameDrawings || []);
  return {
    schema,
    assetsPinned,
    publishedAt: extras.publishedAt || new Date().toISOString(),
    projectMeta: extras.projectMeta || buildPublishedProjectMeta(project),
    items: list.map((it) => ({ ...it })),
    imageManifest,
    coolingRooms: buildPublishedCoolingRooms(project?.rooms),
    farmPower: buildFarmPowerSnapshot(project?.manualParams?.farmPower, project?.rooms),
    pinnedFrameDrawings,
  };
}

export function parseReleaseSnapshot(raw) {
  const empty = {
    items: [],
    projectMeta: null,
    imageManifest: normalizeClientImageManifest(),
    coolingRooms: [],
    farmPower: normalizeFarmPower(),
    pinnedFrameDrawings: [],
    assetsPinned: false,
    schema: null,
    publishedAt: "",
  };
  if (!raw) return empty;
  if (Array.isArray(raw)) {
    return {
      ...empty,
      items: raw,
      schema: "legacy_items_array",
      assetsPinned: false,
    };
  }
  if (typeof raw === "object" && Array.isArray(raw.items)) {
    const schema = raw.schema || RELEASE_SCHEMA_V2;
    const assetsPinned = raw.assetsPinned === true || schema === RELEASE_SCHEMA_V3;
    return {
      items: raw.items,
      projectMeta: raw.projectMeta || null,
      schema,
      publishedAt: raw.publishedAt || "",
      imageManifest: normalizeClientImageManifest(raw.imageManifest),
      coolingRooms: buildPublishedCoolingRooms(raw.coolingRooms),
      farmPower: normalizeFarmPower(raw.farmPower),
      pinnedFrameDrawings: normalizePinnedFrameDrawings(raw.pinnedFrameDrawings || []),
      assetsPinned,
    };
  }
  return empty;
}

/** True when client must use pinned drawings (not latest live). */
export function releaseHasPinnedAssets(snapshot) {
  const parsed = typeof snapshot === "string"
    ? parseReleaseSnapshot(JSON.parse(snapshot || "[]"))
    : Array.isArray(snapshot)
      ? parseReleaseSnapshot(snapshot)
      : snapshot?.items
        ? snapshot
        : parseReleaseSnapshot(snapshot);
  if (!parsed) return false;
  if (parsed.assetsPinned === true) return true;
  return parsed.schema === RELEASE_SCHEMA_V3;
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
  const fields = CLIENT_LIVE_PURCHASE_OVERLAY_FIELDS;
  return (snapshotItems || []).map((snap) => {
    const live = liveById.get(snap.id);
    if (!live) return { ...snap };
    const next = { ...snap };
    for (const key of fields) {
      if (live[key] !== undefined) next[key] = live[key];
    }
    return next;
  });
}

const CHANGE_KEYS = [
  "qty",
  "price",
  "actualPrice",
  "name",
  "supplier",
  "link",
  "linkAlt",
  "visibleToClient",
  "unit",
  "vatRate",
  "clientNote",
  "clientSection",
  "clientSubsection",
  "category",
  "subcategory",
  "imageUrl",
  "photoUrl",
];

const CHANGE_JSON_KEYS = ["pipeCuts", "breakerSpecs", "flowSpecs", "splitSpecs"];

function valueChanged(key, va, vb) {
  if (key === "price" || key === "actualPrice" || key === "qty" || key === "vatRate") {
    return (Number(va) || 0) !== (Number(vb) || 0);
  }
  if (key === "visibleToClient") {
    return !!va !== !!vb;
  }
  return String(va ?? "").trim() !== String(vb ?? "").trim();
}

function itemChanged(a, b) {
  for (const k of CHANGE_KEYS) {
    if (valueChanged(k, a?.[k], b?.[k])) return true;
  }
  for (const k of CHANGE_JSON_KEYS) {
    const sa = JSON.stringify(a?.[k] ?? null);
    const sb = JSON.stringify(b?.[k] ?? null);
    if (sa !== sb) return true;
  }
  return false;
}

/** Patch keys that affect published client delivery (prompt republish). */
export function patchTouchesClientDelivery(patch = {}) {
  if (!patch || typeof patch !== "object") return false;
  for (const k of CHANGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) return true;
  }
  for (const k of CHANGE_JSON_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) return true;
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
  workingPinnedDrawings = null,
  publishedPinnedDrawings = null,
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
  const drawingsChanged = workingPinnedDrawings != null && publishedPinnedDrawings != null
    ? pinnedFrameDrawingsFingerprint(workingPinnedDrawings) !== pinnedFrameDrawingsFingerprint(publishedPinnedDrawings)
    : false;
  return {
    hasChanges:
      changedCount > 0 ||
      addedCount > 0 ||
      removedCount > 0 ||
      imagesChanged ||
      coolingChanged ||
      farmPowerChanged ||
      drawingsChanged,
    changedCount,
    addedCount,
    removedCount,
    imagesChanged,
    coolingChanged,
    farmPowerChanged,
    drawingsChanged,
  };
}

/** Compare working items fingerprint for duplicate publish skip. */
export function workingItemsPublishFingerprint(items = []) {
  return (items || [])
    .filter((it) => lineVisibleToClient(it))
    .map((it) => `${projectItemIdentityKey(it)}|${projectItemMaterialMatchKey(it)}|${Number(it.qty) || 0}|${Number(it.price) || 0}|${Number(it.actualPrice) || 0}`)
    .sort()
    .join("\n");
}
