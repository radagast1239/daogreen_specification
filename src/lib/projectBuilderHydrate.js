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

export function parseBuilderLineIdFromProjectItem(itemId, instanceId = "") {
  const id = String(itemId || "");
  const prefix = instanceId ? `${instanceId}__` : "";
  if (prefix && id.startsWith(prefix)) return id.slice(prefix.length) || uid("ln");
  const parts = id.split("__");
  if (parts.length > 1) return parts.slice(1).join("__") || uid("ln");
  return id || uid("ln");
}

export function projectItemToBuilderLine(item, { stCount = 1 } = {}) {
  const count = Math.max(1, Number(stCount) || 1);
  const qty = Number(item.qty) || 0;
  const baseQty = count > 1 ? Math.round((qty / count) * 100) / 100 : qty;
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
  };
}

export function stellageItemsFromProject(project, stellageConfig) {
  const items = project?.items || [];
  const prefix = `${stellageConfig.id}__`;
  const byPrefix = items.filter((it) => String(it.id || "").startsWith(prefix));
  if (byPrefix.length) return byPrefix;
  const sectionName = stellageConfig.name || stellageConfig.moduleName;
  return items.filter(
    (it) => (it.section === sectionName || it.module === sectionName) && !it.roomId,
  );
}

export function stellagesFromProject(project) {
  const configs = project?.stellageConfigs || [];
  return configs.map((cfg) => {
    const stCount = Math.max(1, Number(cfg.count) || 1);
    const savedItems = stellageItemsFromProject(project, cfg);
    const items = savedItems.length
      ? savedItems.map((it) => projectItemToBuilderLine(it, { stCount }))
      : projectStellageLinesFromCatalog({}, cfg.moduleId, [], cfg.moduleName);
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

function applySavedItemsToCatalogLines(catalogLines, savedItems, { stCount = 1 } = {}) {
  const savedByMaterial = new Map();
  const savedByName = new Map();
  for (const it of savedItems) {
    if (it.materialId) savedByMaterial.set(it.materialId, it);
    if (it.name) savedByName.set(it.name, it);
  }
  const used = new Set();
  const merged = (catalogLines || []).map((ln) => {
    const saved = (ln.materialId && savedByMaterial.get(ln.materialId)) || savedByName.get(ln.name);
    if (!saved) return { ...ln, included: false };
    used.add(saved.id);
    return {
      ...ln,
      ...projectItemToBuilderLine(saved, { stCount: 1 }),
      included: true,
    };
  });
  for (const it of savedItems) {
    if (used.has(it.id)) continue;
    merged.push({ ...projectItemToBuilderLine(it, { stCount: 1 }), included: true });
  }
  return merged;
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
    result[sec.id] = applySavedItemsToCatalogLines(catalogLines, savedItems);
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
  materials = [],
} = {}) {
  const form = builderFormFromProject(project);
  const stellages = stellagesFromProject(project);
  const rooms = Array.isArray(project?.rooms) && project.rooms.length ? project.rooms : defaultRooms;
  const farmSectionLines = farmSectionLinesFromProject(project, sections, farmCatalogs, materials);
  const farmLoaded = sections.length > 0
    && Object.values(farmSectionLines).some((lines) => (lines || []).some((ln) => ln.included));
  return {
    form,
    stellages,
    rooms,
    farmSectionLines,
    farmLoaded,
  };
}

export function stellagesForProjectSave(stellages = [], draft = null) {
  const list = stellages.map((st) => ({
    ...st,
    items: (st.items || []).map((ln) => ({ ...ln })),
  }));
  if (!draft?.name?.trim()) return list;
  if (!draft.items?.some((ln) => ln.included)) return list;
  const idx = list.findIndex((st) => st.id === draft.id);
  const snapshot = {
    ...draft,
    items: draft.items.map((ln) => ({ ...ln })),
  };
  if (idx >= 0) {
    list[idx] = snapshot;
    return list;
  }
  return [...list, snapshot];
}

export function validateStellageForFrameDrawing(stellage) {
  if (!stellage?.name?.trim()) {
    return "Укажите название стеллажа в проекте.";
  }
  const included = (stellage.items || []).filter((ln) => ln.included && ln.name?.trim());
  if (!included.length) {
    return "Отметьте хотя бы одну позицию галочкой.";
  }
  if (included.some((ln) => resolveBuilderLineQty(ln) <= 0)) {
    return "У отмеченных позиций укажите количество.";
  }
  return "";
}
