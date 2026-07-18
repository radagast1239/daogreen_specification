import { uid } from "./ids.js";
import { DEFAULT_MANUAL_PARAMS } from "./itemHelpers.js";
import { projectStellageLinesFromCatalog } from "./stellageCatalogConfig.js";
import { projectLinesFromCatalog } from "./farmSectionsConfig.js";
import { AC_ITEM_SECTION } from "../../shared/roomAcSpec.js";
import { defaultRooms } from "./roomHelpers.js";
import { resolveBuilderLineQty } from "../../shared/flowSpecs.js";
import { resolvePipeCuts } from "../../shared/profilePipeCuts.js";
import { resolveBreakerSpecs } from "../../shared/breakerSpecs.js";
import { resolveFlowSpecs } from "../../shared/flowSpecs.js";
import { resolveSplitSpecs } from "../../shared/splitSpecs.js";
import { resolveItemType } from "../../shared/itemTypes.js";
import { applyMaterialCatalogFields } from "./specLineCore.js";
import { fillEmptyCatalogFieldsFromMaterial } from "../../shared/materialCatalogSnapshot.js";
import {
  FRAME_BOM_SOURCE,
  frameBomItemsForModuleRack,
  enrichProjectItemFromMaterial,
  FRAME_BOM_ADMIN_SOURCE_LABEL,
  isFrameBomLine,
  resolveFrameBomDedupeKey,
} from "../../shared/frameBomProjectItems.js";
import { buildModuleRackKey } from "../../shared/moduleRackIds.js";
import { builderWizardFromManualParams } from "../../shared/projectLifecycle.js";

export const FRAME_BOM_SOURCE_LABEL = FRAME_BOM_ADMIN_SOURCE_LABEL;

export function frameBomItemsForStellage(project, stellageConfig) {
  const moduleRackKey = buildModuleRackKey({
    moduleId: stellageConfig.moduleId,
    rackId: stellageConfig.id,
  });
  return frameBomItemsForModuleRack(project?.items || [], moduleRackKey);
}

function materialExistsInCatalog(materialId, materials = []) {
  if (!materialId || !materials?.length) return false;
  return materials.some((m) => (m.id || m.materialId) === materialId);
}

export function frameBomProjectItemToBuilderLine(item, { materials = null } = {}) {
  const enriched = materials?.length
    ? enrichProjectItemFromMaterial(item, materials)
    : item;
  const line = projectItemToBuilderLine(enriched, { stCount: 1 });
  const bomQty = Number(line.qty) || 0;
  return {
    ...line,
    qty: bomQty,
    defaultQty: bomQty,
    included: true,
    source: FRAME_BOM_SOURCE,
    sourceType: FRAME_BOM_SOURCE,
    sourceKey: item.sourceKey || item.source_key || "",
    sourceLabel: FRAME_BOM_SOURCE_LABEL,
    visibleToClient: item.visibleToClient !== false && item.visible !== false,
    pipeCuts: enriched.pipeCuts?.length ? enriched.pipeCuts : line.pipeCuts,
    techNote: enriched.techNote || line.techNote,
    clientNote: enriched.clientNote || enriched.comment || line.clientNote,
  };
}

function applyFrameBomOverlayToCatalogLine(catalogLine, bomLine) {
  const bomQty = Number(bomLine.qty) || 0;
  return {
    ...catalogLine,
    ...bomLine,
    id: catalogLine.id,
    // Keep catalog commercial fields if BOM snapshot left them empty
    supplier: bomLine.supplier || catalogLine.supplier || "",
    link: bomLine.link || catalogLine.link || "",
    linkAlt: bomLine.linkAlt || catalogLine.linkAlt || "",
    name: bomLine.name || catalogLine.name || "",
    unit: bomLine.unit || catalogLine.unit || "шт.",
    category: bomLine.category || catalogLine.category || "Прочее",
    price: Number(bomLine.price) > 0 ? Number(bomLine.price) : Number(catalogLine.price) || 0,
    included: true,
    qty: bomQty,
    defaultQty: bomQty,
    pipeCuts: bomLine.pipeCuts?.length ? bomLine.pipeCuts : catalogLine.pipeCuts,
  };
}

function pushBomMultiMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function takeBomMultiMap(map, key) {
  const list = map.get(key);
  if (!list?.length) return null;
  return list.shift();
}

function overlayFrameBomOnLines(lines, frameBomItems, { stCount = 1, materials = null } = {}) {
  if (!frameBomItems?.length) return lines || [];
  const bomByMaterial = new Map();
  const bomByName = new Map();
  const bomById = new Map();
  for (const it of frameBomItems) {
    if (it.id) bomById.set(it.id, it);
    if (it.materialId) pushBomMultiMap(bomByMaterial, String(it.materialId), it);
    if (it.name) pushBomMultiMap(bomByName, String(it.name), it);
  }
  const usedBomIds = new Set();
  const merged = (lines || []).map((ln) => {
    let bom = null;
    if (ln.id && bomById.has(ln.id)) bom = bomById.get(ln.id);
    // Catalog / editor lines receive Frame BOM overlay by materialId (existing UX).
    // Explicit manual rows must not absorb BOM purchase fields — leave for append.
    const lineSource = String(ln.source || ln.sourceType || "").trim();
    const isExplicitManual = lineSource === "manual";
    if (!bom && !isExplicitManual && ln.materialId) {
      bom = takeBomMultiMap(bomByMaterial, String(ln.materialId));
    }
    if (!bom && !isExplicitManual && ln.name) {
      bom = takeBomMultiMap(bomByName, String(ln.name));
    }
    if (!bom) return ln;
    usedBomIds.add(bom.id);
    const bomLine = frameBomProjectItemToBuilderLine(bom, { materials });
    const overlaid = applyFrameBomOverlayToCatalogLine(ln, bomLine);
    return materials?.length
      ? applyMaterialCatalogFields(overlaid, materials)
      : overlaid;
  });
  const usedMaterialIds = new Set(merged.map((ln) => ln.materialId).filter(Boolean));
  for (const bom of frameBomItems) {
    if (usedBomIds.has(bom.id)) continue;
    if (materials?.length && bom.materialId && !materialExistsInCatalog(bom.materialId, materials)) {
      continue;
    }
    // Append unused BOM when materialId is only on an explicit manual line (keep separate).
    if (bom.materialId && usedMaterialIds.has(bom.materialId)) {
      const onlyManual = merged
        .filter((ln) => String(ln.materialId || "") === String(bom.materialId))
        .every((ln) => String(ln.source || ln.sourceType || "").trim() === "manual");
      if (!onlyManual) continue;
    }
    merged.push(frameBomProjectItemToBuilderLine(bom, { materials }));
    if (bom.materialId) usedMaterialIds.add(bom.materialId);
  }
  return merged;
}

export function mergeStellageEditorLines({
  catalogLines = [],
  manualItems = [],
  frameBomItems = [],
  stCount = 1,
  materials = null,
} = {}) {
  const lines = catalogLines.length
    ? applySavedItemsToCatalogLines(catalogLines, manualItems, { stCount, materials })
    : manualItems.map((it) => projectItemToBuilderLine(it, { stCount, materials }));
  const merged = overlayFrameBomOnLines(lines, frameBomItems, { stCount, materials });
  if (!materials?.length) return merged;
  return merged.map((ln) => fillEmptyCatalogFieldsFromMaterial(ln, materials));
}

export function parseBuilderLineIdFromProjectItem(itemId, instanceId = "") {
  const id = String(itemId || "");
  const prefix = instanceId ? `${instanceId}__` : "";
  if (prefix && id.startsWith(prefix)) return id.slice(prefix.length) || uid("ln");
  const parts = id.split("__");
  if (parts.length > 1) return parts.slice(1).join("__") || uid("ln");
  return id || uid("ln");
}

export function projectItemToBuilderLine(item, { stCount = 1, materials = null } = {}) {
  const count = Math.max(1, Number(stCount) || 1);
  const qty = Number(item.qty) || 0;
  const baseQty = count > 1 ? Math.round((qty / count) * 100) / 100 : qty;
  const material = item.materialId && materials?.length
    ? materials.find((m) => (m.id || m.materialId) === item.materialId)
    : null;
  const priceOverridden = !!item.priceOverridden || !!(material && (Number(item.price) || 0) !== (Number(material.basePrice) || 0));
  const linkOverridden = !!item.linkOverridden || !!(material && String(item.link || "").trim() !== String(material.link || "").trim());
  const linkAltOverridden = !!item.linkAltOverridden || !!(material && String(item.linkAlt || "").trim() !== String(material.linkAlt || "").trim());
  return {
    id: parseBuilderLineIdFromProjectItem(item.id),
    materialId: item.materialId || null,
    name: item.name || "",
    unit: item.unit || "шт.",
    category: item.category || "Прочее",
    subcategory: item.subcategory || "",
    supplier: item.supplier || "",
    link: item.link || "",
    linkAlt: item.linkAlt || "",
    imageUrl: item.imageUrl || item.photoUrl || "",
    photoUrl: item.photoUrl || item.imageUrl || "",
    qty: baseQty,
    price: Number(item.price) || 0,
    priceOverridden,
    linkOverridden,
    linkAltOverridden,
    vatRate: Number(item.vatRate) || 0,
    techNote: item.techNote || "",
    clientNote: item.clientNote || item.comment || "",
    pipeCuts: item.pipeCuts ?? resolvePipeCuts(item),
    breakerSpecs: item.breakerSpecs ?? resolveBreakerSpecs(item),
    flowSpecs: item.flowSpecs ?? resolveFlowSpecs(item),
    splitSpecs: item.splitSpecs ?? resolveSplitSpecs(item),
    coolingKw: Number(item.coolingKw) || 0,
    coolingBtu: Number(item.coolingBtu) || 0,
    exhaustM3: Number(item.exhaustM3) || 0,
    roomId: item.roomId || "",
    included: item.includedInProject !== false && item.enabled !== false,
    itemType: resolveItemType(item),
    clientSection: item.clientSection || "",
    clientSubsection: item.clientSubsection || "",
    purchaseKey: item.purchaseKey || "",
    responsible: item.responsible || "",
    source: item.source || item.sourceType || "",
    sourceType: item.sourceType || item.source || "",
    sourceKey: item.sourceKey || item.source_key || "",
  };
}

export function stellageItemsFromProject(project, stellageConfig) {
  const items = (project?.items || []).filter(
    (it) => (it.source || it.sourceType) !== FRAME_BOM_SOURCE,
  );
  const prefix = `${stellageConfig.id}__`;
  const byPrefix = items.filter((it) => String(it.id || "").startsWith(prefix));
  if (byPrefix.length) return byPrefix;
  const sectionName = stellageConfig.name || stellageConfig.moduleName;
  return items.filter(
    (it) => (it.section === sectionName || it.module === sectionName) && !it.roomId,
  );
}

function applyStellageGroupsToLines(lines = [], groups = []) {
  if (!Array.isArray(groups) || !groups.length) return lines;
  const byName = new Map();
  for (const g of groups) {
    const name = String(g?.name || "").trim();
    if (name) byName.set(name, g);
  }
  if (!byName.size) return lines;
  return (lines || []).map((ln) => {
    const g = byName.get(String(ln.name || "").trim());
    if (!g) return ln;
    const qty = Number(g.qty);
    return {
      ...ln,
      included: true,
      qty: Number.isFinite(qty) && qty > 0 ? qty : ln.qty,
      subcategory: g.subcategory || ln.subcategory,
    };
  });
}

export function stellagesFromProject(project, { stellageCatalogs = {}, materials = [] } = {}) {
  const configs = project?.stellageConfigs || [];
  return configs.map((cfg) => {
    const stCount = Math.max(1, Number(cfg.count) || 1);
    const catalogLines = projectStellageLinesFromCatalog(
      stellageCatalogs,
      cfg.moduleId,
      materials,
      cfg.moduleName,
    );
    const savedProjectItems = stellageItemsFromProject(project, cfg);
    const frameBomItems = frameBomItemsForStellage(project, cfg);
    let items = mergeStellageEditorLines({
      catalogLines,
      manualItems: savedProjectItems,
      frameBomItems,
      stCount,
      materials,
    });
    // Recovery: if frame BOM refresh wiped ordinary st_*__ln_* rows, restore
    // included/qty from stellageConfigs.groups snapshot.
    const savedNonFrame = (savedProjectItems || []).filter(
      (it) => (it.source || it.sourceType) !== FRAME_BOM_SOURCE,
    );
    if (!savedNonFrame.length && cfg.groups?.length) {
      items = applyStellageGroupsToLines(items, cfg.groups);
    }
    return {
      id: cfg.id,
      moduleId: cfg.moduleId,
      moduleName: cfg.moduleName,
      tech: cfg.tech || "",
      name: cfg.name,
      count: stCount,
      photoUrl: cfg.photoUrl || "",
      presetId: cfg.presetId || null,
      params: cfg.params || {},
      extraImages: Array.isArray(cfg.extraImages) ? cfg.extraImages : [],
      items,
    };
  });
}

function isStellageProjectItem(item, configs = []) {
  const id = String(item.id || "");
  if (configs.some((cfg) => id.startsWith(`${cfg.id}__`))) return true;
  const section = item.section || item.module || "";
  return configs.some((cfg) => cfg.name === section || cfg.moduleName === section);
}

function sortSavedByStableId(a, b) {
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function pushSavedQueue(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

/**
 * Match catalog line → saved project item (each saved row claimed at most once).
 * Priority: exact id → sourceKey → section/rack → unique materialId → deterministic zip.
 */
function claimSavedForCatalogLine(ln, pools, used) {
  const unused = (it) => it && it.id && !used.has(it.id);

  if (ln?.id) {
    const byExact = pools.byId.get(ln.id);
    if (unused(byExact)) return byExact;
    // Stellage-prefixed project id ↔ short catalog line id
    for (const it of pools.all) {
      if (!unused(it)) continue;
      if (String(it.id).endsWith(`__${ln.id}`) || String(it.id) === String(ln.id)) return it;
    }
  }

  const materialId = String(ln?.materialId || "").trim();
  let candidates = materialId
    ? (pools.byMaterial.get(materialId) || []).filter(unused)
    : [];

  const sourceKey = String(ln?.sourceKey || ln?.source_key || "").trim();
  if (sourceKey && candidates.length) {
    const bySk = candidates.filter(
      (it) => String(it.sourceKey || it.source_key || "").trim() === sourceKey,
    );
    if (bySk.length === 1) return bySk[0];
    if (bySk.length > 1) return [...bySk].sort(sortSavedByStableId)[0];
  }

  const rack =
    String(ln?.moduleRackKey || ln?.module_rack_key || "").trim() ||
    String(ln?.stellageId || ln?.rackId || "").trim();
  if (rack && candidates.length) {
    const byRack = candidates.filter((it) => {
      const itRack =
        String(it.moduleRackKey || it.module_rack_key || "").trim() ||
        String(it.stellageId || it.rackId || "").trim();
      return itRack === rack;
    });
    if (byRack.length === 1) return byRack[0];
    if (byRack.length > 1) candidates = byRack;
  }

  const section = String(ln?.section || ln?.module || "").trim();
  if (section && candidates.length) {
    const bySec = candidates.filter(
      (it) => String(it.section || it.module || "").trim() === section,
    );
    if (bySec.length === 1) return bySec[0];
    if (bySec.length > 1) candidates = bySec;
  }

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return [...candidates].sort(sortSavedByStableId)[0];

  const name = String(ln?.name || "").trim();
  if (name) {
    const byName = (pools.byName.get(name) || []).filter(unused);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) return [...byName].sort(sortSavedByStableId)[0];
  }
  return null;
}

function applySavedItemsToCatalogLines(catalogLines, savedItems, { stCount = 1, materials = null } = {}) {
  const all = [...(savedItems || [])].sort(sortSavedByStableId);
  const pools = {
    all,
    byId: new Map(),
    byMaterial: new Map(),
    byName: new Map(),
  };
  for (const it of all) {
    if (it?.id) pools.byId.set(it.id, it);
    if (it?.materialId) pushSavedQueue(pools.byMaterial, String(it.materialId), it);
    if (it?.name) pushSavedQueue(pools.byName, String(it.name), it);
  }
  const used = new Set();
  const merged = (catalogLines || []).map((ln) => {
    const saved = claimSavedForCatalogLine(ln, pools, used);
    if (!saved) return { ...ln, included: false };
    used.add(saved.id);
    const asLine = projectItemToBuilderLine(saved, { stCount, materials });
    return {
      ...ln,
      ...asLine,
      included: asLine.included,
    };
  });
  for (const it of all) {
    if (used.has(it.id)) continue;
    const asLine = projectItemToBuilderLine(it, { stCount, materials });
    merged.push({ ...asLine, included: asLine.included });
  }
  return merged;
}

export function mergeStellageBuilderLines(
  stellage,
  stellageCatalogs = {},
  materials = [],
  projectItems = [],
) {
  const catalogLines = projectStellageLinesFromCatalog(
    stellageCatalogs,
    stellage.moduleId,
    materials,
    stellage.moduleName,
  );
  const manualItems = (stellage.items || [])
    .filter((ln) => (ln.source || ln.sourceType) !== FRAME_BOM_SOURCE)
    .map((ln) => ({
      id: ln.id,
      materialId: ln.materialId,
      name: ln.name,
      qty: ln.qty,
      includedInProject: ln.included,
      enabled: ln.included,
      unit: ln.unit,
      supplier: ln.supplier,
      link: ln.link,
      linkAlt: ln.linkAlt,
      price: ln.price,
      priceOverridden: ln.priceOverridden,
      linkOverridden: ln.linkOverridden,
      linkAltOverridden: ln.linkAltOverridden,
      techNote: ln.techNote,
      clientNote: ln.clientNote,
      pipeCuts: ln.pipeCuts,
    }));
  const frameBomItems = frameBomItemsForModuleRack(
    projectItems,
    buildModuleRackKey({ moduleId: stellage.moduleId, rackId: stellage.id }),
  );
  return mergeStellageEditorLines({
    catalogLines,
    manualItems,
    frameBomItems,
    // stellage.items are already editor/per-rack quantities. Only project items
    // loaded by stellagesFromProject need total -> per-rack division.
    stCount: 1,
    materials,
  });
}

export function farmSectionLinesFromProject(project, sections = [], farmCatalogs = {}, materials = []) {
  const result = {};
  const configs = project?.stellageConfigs || [];
  const items = project?.items || [];
  for (const sec of sections) {
    const catalogLines = projectLinesFromCatalog(farmCatalogs, sec.id, materials, sec);
    const savedItems = items.filter((it) => {
      const sectionName = it.section || it.module || "";
      if (sectionName !== sec.name) return false;
      if (isStellageProjectItem(it, configs)) return false;
      if (sectionName === AC_ITEM_SECTION || it.roomId) return false;
      return true;
    });
    result[sec.id] = applySavedItemsToCatalogLines(catalogLines, savedItems, { materials });
  }
  return result;
}

export function builderFormFromProject(project) {
  return {
    name: project?.name || "",
    client: project?.client || "",
    city: project?.city || "",
    area: project?.area ?? "",
    height: project?.height ?? "",
    sowingArea: project?.sowingArea ?? "",
    type: project?.type || "проточка",
    currency: project?.currency || "₽",
    vat: !!project?.vat,
    comment: project?.comment || "",
    manualParams: { ...DEFAULT_MANUAL_PARAMS, ...(project?.manualParams || {}) },
  };
}

export function hydrateBuilderFromProject(project, {
  sections = [],
  farmCatalogs = {},
  stellageCatalogs = {},
  materials = [],
} = {}) {
  const form = builderFormFromProject(project);
  const stellages = stellagesFromProject(project, { stellageCatalogs, materials });
  // Explicit empty rooms[] must stay empty (guided create). Only missing rooms → defaults.
  const rooms = Array.isArray(project?.rooms) ? project.rooms : defaultRooms();
  const farmSectionLines = farmSectionLinesFromProject(project, sections, farmCatalogs, materials);
  const farmLoaded = sections.length > 0
    && Object.values(farmSectionLines).some((lines) => (lines || []).some((ln) => ln.included));
  const lastStep = builderWizardFromManualParams(project?.manualParams).lastStep || 'basics';
  return {
    form,
    stellages,
    rooms,
    farmSectionLines,
    farmLoaded,
    lastStep,
  };
}

/**
 * True when a builder draft has real user content worth keeping.
 * Auto-named empty "Стеллаж N" with catalog lines unchecked is NOT meaningful.
 */
export function isMeaningfulRackDraft(draft) {
  if (!draft?.id || !String(draft.name || "").trim()) return false;
  if (draft.presetId) return true;
  if (draft.forcePersistForFrame) return true;
  if ((draft.items || []).some((ln) => ln.included)) return true;
  if (Number(draft.frameDrawingCount) > 0 || draft.hasFrameDrawing) return true;
  if (Number(draft.frameBomCount) > 0) return true;
  return false;
}

/**
 * Empty auto-draft must not be persisted as a second rack.
 * Persist draft when:
 * - it already exists in the list (in-place update),
 * - user checked out an existing rack AND it still has meaning / forcePersist,
 * - user selected at least one line / applied a preset / opened frame for it.
 *
 * editingExisting alone is NOT enough to invent a brand-new empty rack.
 */
export function shouldPersistStellageDraft(draft, stellages = []) {
  if (!draft?.name?.trim() || !draft?.id) return false;
  if ((stellages || []).some((st) => st.id === draft.id)) return true;
  if (isMeaningfulRackDraft(draft)) return true;
  // Checked-out existing rack with no local included lines still must round-trip
  // back into the list (scheme/BOM may live only on project.items).
  if (draft.editingExisting && draft.wasInProjectList) return true;
  return false;
}

export function stellagesForProjectSave(stellages = [], draft = null) {
  const list = stellages.map((st) => ({
    ...st,
    items: (st.items || []).map((ln) => ({ ...ln })),
  }));
  if (!shouldPersistStellageDraft(draft, list)) return list;
  const idx = list.findIndex((st) => st.id === draft.id);
  const {
    editingExisting: _editingExisting,
    wasInProjectList: _wasInProjectList,
    forcePersistForFrame: _forcePersistForFrame,
    frameDrawingCount: _frameDrawingCount,
    frameBomCount: _frameBomCount,
    hasFrameDrawing: _hasFrameDrawing,
    ...rest
  } = draft;
  const snapshot = {
    ...rest,
    items: (draft.items || []).map((ln) => ({ ...ln })),
  };
  if (idx >= 0) {
    list[idx] = snapshot;
    return list;
  }
  return [...list, snapshot];
}

export function findStellageByEditRack(stellages = [], editRack = "") {
  const key = String(editRack || "").trim();
  if (!key) return null;
  return stellages.find(
    (st) =>
      st.id === key
      || buildModuleRackKey({ moduleId: st.moduleId, rackId: st.id }) === key,
  ) || null;
}

export function preserveFrameBomProjectItems(builderItems = [], loadedItems = []) {
  const ids = new Set((builderItems || []).map((it) => it.id));
  const preserved = (loadedItems || []).filter((it) => {
    if (ids.has(it.id)) return false;
    return isFrameBomLine(it);
  });
  return [...builderItems, ...preserved];
}

/**
 * Restore ordinary rack builder lines missing after a bad frame BOM refresh.
 * Adds only absent logical lines; does not mutate existing rows.
 *
 * @param {object[]} existingItems
 * @param {object[]} builderItems from buildProjectFromBuilder (non-frame)
 */
export function restoreMissingNonFrameRackItems(existingItems = [], builderItems = []) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const existingIds = new Set(existing.map((it) => String(it.id || "")).filter(Boolean));
  const existingKeys = new Set(
    existing.map((it) => {
      const mid = String(it.materialId || "").trim();
      const section = String(it.section || it.module || "").trim();
      return mid ? `${mid}::${section}` : `id:${it.id}`;
    }),
  );
  const added = [];
  for (const bi of builderItems || []) {
    if (!bi?.id) continue;
    if (isFrameBomLine(bi)) continue;
    if ((bi.source || bi.sourceType) === FRAME_BOM_SOURCE) continue;
    if (existingIds.has(String(bi.id))) continue;
    const mid = String(bi.materialId || "").trim();
    const section = String(bi.section || bi.module || "").trim();
    const key = mid ? `${mid}::${section}` : `id:${bi.id}`;
    if (existingKeys.has(key)) continue;
    added.push(bi);
    existingIds.add(String(bi.id));
    existingKeys.add(key);
  }
  return {
    items: [...existing, ...added],
    addedCount: added.length,
    addedIds: added.map((it) => it.id),
  };
}

/**
 * Composite rack+BOM identity for frame_bom qty merge (never materialId-only).
 * @param {object} line
 * @param {object} [stellage]
 */
function frameBomBuilderLineDedupeKey(line, stellage) {
  const moduleRackKey = String(
    line?.moduleRackKey
      || buildModuleRackKey({ moduleId: stellage?.moduleId, rackId: stellage?.id })
      || (stellage?.id ? `stellage:${stellage.id}` : ""),
  ).trim();
  if (!moduleRackKey) return "";
  return resolveFrameBomDedupeKey({
    ...line,
    moduleRackKey,
    source: FRAME_BOM_SOURCE,
    sourceType: FRAME_BOM_SOURCE,
  });
}

/**
 * Apply editor qty/pipeCuts from frame_bom builder lines back onto preserved project items.
 * @param {object[]} projectItems
 * @param {object[]} stellages
 */
export function mergeFrameBomQtyFromBuilderLines(projectItems = [], stellages = []) {
  const editorByKey = new Map();
  for (const st of stellages || []) {
    for (const ln of st.items || []) {
      if ((ln.source || ln.sourceType) !== FRAME_BOM_SOURCE) continue;
      const key = frameBomBuilderLineDedupeKey(ln, st);
      if (!key) continue;
      editorByKey.set(key, ln);
    }
  }
  if (!editorByKey.size) return projectItems;
  return (projectItems || []).map((it) => {
    if ((it.source || it.sourceType) !== FRAME_BOM_SOURCE) return it;
    const key = resolveFrameBomDedupeKey(it);
    if (!key) return it;
    const editor = editorByKey.get(key);
    if (!editor) return it;
    const qty = Number(editor.qty);
    const next = { ...it };
    if (Number.isFinite(qty) && qty > 0) next.qty = qty;
    if (editor.pipeCuts?.length) next.pipeCuts = editor.pipeCuts;
    return next;
  });
}

export function validateStellageForFrameDrawing(stellage) {
  if (!stellage?.name?.trim()) {
    return "Укажите название стеллажа в проекте.";
  }
  const included = (stellage.items || []).filter((ln) => ln.included && ln.name?.trim());
  if (included.some((ln) => resolveBuilderLineQty(ln) <= 0)) {
    return "У отмеченных позиций укажите количество.";
  }
  return "";
}
