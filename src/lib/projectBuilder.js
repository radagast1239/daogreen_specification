import { uid } from "../store/helpers.js";
import { defaultResponsible } from "./itemHelpers.js";
import { hydrateLinePhoto } from "./photoHelpers.js";
import { groupLabel, materialCompositionGroup } from "../../shared/stellageComposition.js";
import { projectStellageLinesFromCatalog, stellageModulePhoto, resolveStellagePhoto } from "./stellageCatalogConfig.js";
import { syncFastenersFromCrabs } from "../../shared/fastenerRules.js";
import { resolvePipeCuts, normalizePipeCuts } from "../../shared/profilePipeCuts.js";
import { resolveBreakerSpecs, normalizeBreakerSpecs } from "../../shared/breakerSpecs.js";
import { resolveFlowSpecs, normalizeFlowSpecs } from "../../shared/flowSpecs.js";
import { resolveSplitSpecs, normalizeSplitSpecs } from "../../shared/splitSpecs.js";
import { patchMaterialModules, normalizeMaterialModules, primaryMaterialModule, materialInModule } from "../../shared/materialModules.js";

export function blankLine(overrides = {}) {
  return {
    id: uid("ln"),
    materialId: null,
    name: "",
    unit: "шт.",
    category: "Прочее",
    subcategory: "",
    supplier: "",
    link: "",
    linkAlt: "",
    imageUrl: "",
    photoUrl: "",
    qty: 1,
    price: 0,
    vatRate: 0,
    techNote: "",
    clientNote: "",
    pipeCuts: [],
    breakerSpecs: [],
    flowSpecs: [],
    splitSpecs: [],
    coolingKw: 0,
    coolingBtu: 0,
    exhaustM3: 0,
    roomId: "",
    included: true,
    ...overrides,
  };
}

export function lineToMaterialPayload(line, moduleName, farmSectionId = "") {
  return {
    name: line.name.trim(),
    unit: line.unit || "шт.",
    module: moduleName,
    modules: normalizeMaterialModules([moduleName]),
    category: line.category || "Прочее",
    subcategory: line.subcategory || "",
    farmSectionId: farmSectionId || line.farmSectionId || "",
    defaultQty: 0,
    basePrice: Number(line.price) || 0,
    link: line.link || "",
    linkAlt: line.linkAlt || "",
    vatRate: Number(line.vatRate) || 0,
    techNote: line.techNote || "",
    clientNote: line.clientNote || "",
    pipeCuts: normalizePipeCuts(line.pipeCuts ?? resolvePipeCuts(line)),
    breakerSpecs: normalizeBreakerSpecs(line.breakerSpecs ?? resolveBreakerSpecs(line)),
    flowSpecs: normalizeFlowSpecs(line.flowSpecs ?? resolveFlowSpecs(line)),
    splitSpecs: normalizeSplitSpecs(line.splitSpecs ?? resolveSplitSpecs(line)),
    supplier: line.supplier || "",
    coolingKw: Number(line.coolingKw) || 0,
    coolingBtu: Number(line.coolingBtu) || 0,
    exhaustM3: Number(line.exhaustM3) || 0,
    status: "active",
  };
}

export function syncLineFromMaterial(line, mat) {
  const img = mat.imageUrl || mat.photoUrl || "";
  return {
    ...line,
    materialId: mat.id,
    name: mat.name,
    unit: mat.unit,
    category: mat.category,
    subcategory: mat.subcategory || line.subcategory,
    supplier: mat.supplier || "",
    link: mat.link || "",
    linkAlt: mat.linkAlt || "",
    imageUrl: img,
    photoUrl: img,
    price: Number(mat.basePrice) || line.price,
    vatRate: Number(mat.vatRate) || 0,
    coolingKw: Number(mat.coolingKw) || 0,
    coolingBtu: Number(mat.coolingBtu) || 0,
    exhaustM3: Number(mat.exhaustM3) || 0,
    pipeCuts: resolvePipeCuts(mat),
    breakerSpecs: resolveBreakerSpecs(mat),
    flowSpecs: resolveFlowSpecs(mat),
    splitSpecs: resolveSplitSpecs(mat),
    clientNote: mat.clientNote || mat.comment || "",
  };
}

/** Строки каталога для раздела «Ферма целиком» */
export function catalogLinesForFarmSection(materials, sectionId) {
  return materials
    .filter(
      (m) =>
        m.module === "Общая закупка на ферму" &&
        m.farmSectionId === sectionId &&
        m.status === "active"
    )
    .map((m) => lineFromMaterial(m, { included: false }));
}

/** Строки каталога для сборки — все видны, по умолчанию не отмечены */
export function catalogLinesForModule(materials, moduleName) {
  return materials
    .filter((m) => materialInModule(m, moduleName) && m.status === "active")
    .map((m) => lineFromMaterial(m, { included: false }));
}

export function activeLines(lines) {
  return (lines || []).filter((ln) => ln.included && ln.name?.trim());
}

export function lineFromMaterial(mat, overrides = {}) {
  const img = mat.imageUrl || mat.photoUrl || "";
  const qty = overrides.qty ?? 0;
  return blankLine({
    materialId: mat.id,
    name: mat.name,
    unit: mat.unit,
    category: mat.category,
    subcategory: mat.subcategory || materialCompositionGroup(mat),
    supplier: mat.supplier || "",
    link: mat.link || "",
    linkAlt: mat.linkAlt || "",
    imageUrl: img,
    photoUrl: img,
    qty,
    price: Number(mat.basePrice) || 0,
    vatRate: [0, 5, 20].includes(Number(mat.vatRate)) ? Number(mat.vatRate) : 0,
    techNote: mat.techNote || "",
    clientNote: mat.clientNote || mat.comment || "",
    pipeCuts: resolvePipeCuts(mat),
    breakerSpecs: resolveBreakerSpecs(mat),
    flowSpecs: resolveFlowSpecs(mat),
    splitSpecs: resolveSplitSpecs(mat),
    coolingKw: Number(mat.coolingKw) || 0,
    coolingBtu: Number(mat.coolingBtu) || 0,
    exhaustM3: Number(mat.exhaustM3) || 0,
    ...overrides,
  });
}

/** Опциональный шаблон — только по кнопке, не по умолчанию */
export function templateLinesForModule(materials, moduleName) {
  return materials
    .filter((m) => materialInModule(m, moduleName) && m.status === "active")
    .map((m) => lineFromMaterial(m));
}

export function lineToProjectItem(line, section, sortOrder) {
  const qty = Number(line.qty) || 0;
  const on = line.included !== false;
  const img = line.imageUrl || line.photoUrl || "";
  return {
    id: uid("it"),
    materialId: line.materialId || null,
    module: section,
    section,
    name: line.name,
    unit: line.unit || "шт.",
    category: line.category || "Прочее",
    supplier: line.supplier || "",
    link: line.link || "",
    linkAlt: line.linkAlt || "",
    imageUrl: img,
    photoUrl: img,
    clientNote: line.clientNote || "",
    techNote: line.techNote || "",
    comment: line.clientNote || line.techNote || "",
    pipeCuts: normalizePipeCuts(line.pipeCuts ?? resolvePipeCuts(line)),
    breakerSpecs: normalizeBreakerSpecs(line.breakerSpecs ?? resolveBreakerSpecs(line)),
    flowSpecs: normalizeFlowSpecs(line.flowSpecs ?? resolveFlowSpecs(line)),
    splitSpecs: normalizeSplitSpecs(line.splitSpecs ?? resolveSplitSpecs(line)),
    qty,
    price: Number(line.price) || 0,
    vatRate: Number(line.vatRate) || 0,
    coolingKw: Number(line.coolingKw) || 0,
    coolingBtu: Number(line.coolingBtu) || 0,
    exhaustM3: Number(line.exhaustM3) || 0,
    roomId: line.roomId || "",
    responsible: line.responsible || defaultResponsible(line.category, line),
    visible: on && qty > 0,
    approved: on && qty > 0,
    enabled: on,
    needsApproval: false,
    status: "not_bought",
    actualPrice: null,
    clientComment: "",
    sortOrder,
  };
}

export function buildProjectFromBuilder({
  form,
  stellages,
  farmSections,
  generalLines,
  materials = [],
  rooms = [],
  stellageModuleMeta = {},
}) {
  const items = [];
  const stellageConfigs = [];
  let order = 0;

  const pushLine = (line, section) => {
    const hydrated = hydrateLinePhoto(line, materials);
    items.push(lineToProjectItem(hydrated, section, order++));
  };

  for (const st of stellages) {
    const section = st.name?.trim() || st.moduleName;
    const stCount = Math.max(1, Number(st.count) || 1);
    stellageConfigs.push({
      id: st.id,
      name: section,
      count: stCount,
      moduleId: st.moduleId,
      moduleName: st.moduleName,
      tech: st.tech || "",
      presetId: st.presetId || null,
      photoUrl: resolveStellagePhoto(stellageModuleMeta, st.moduleId, st.photoUrl || st.params?.photoUrl),
      params: st.params || {},
      groups: activeLines(st.items).map((ln) => ({
        name: ln.name,
        qty: ln.qty,
        subcategory: ln.subcategory,
        group: groupLabel(ln.subcategory),
      })),
    });
    for (const line of activeLines(syncFastenersFromCrabs(st.items))) {
      const baseQty = Number(line.qty) || 0;
      if (baseQty <= 0) continue;
      pushLine({ ...line, qty: Math.round(baseQty * stCount * 100) / 100 }, section);
    }
  }

  if (farmSections?.length) {
    for (const sec of farmSections) {
      const sectionName = sec.sectionName || sec.name;
      const defaultResp = sec.defaultResponsible || "";
      for (const line of activeLines(syncFastenersFromCrabs(sec.items))) {
        if ((Number(line.qty) || 0) <= 0) continue;
        pushLine(
          { ...line, responsible: line.responsible || defaultResp || undefined },
          sectionName
        );
      }
    }
  } else if (generalLines?.length) {
    const generalSection = "Общая закупка на ферму";
    for (const line of activeLines(generalLines)) {
      if ((Number(line.qty) || 0) <= 0) continue;
      pushLine(line, generalSection);
    }
  }

  return {
    ...form,
    area: Number(form.area) || 0,
    height: Number(form.height) || 0,
    sowingArea: Number(form.sowingArea) || 0,
    selectedModules: [],
    stellageConfigs,
    zones: [],
    manualParams: form.manualParams || {},
    rooms: rooms || [],
    items,
  };
}

export function newStellageDraft(modules, materials, index, stellageCatalogs = {}, stellageModuleMeta = {}) {
  const stellageMods = modules.filter((m) => m.type === "stellage");
  const mod = stellageMods[0] || modules[0];
  return {
    id: uid("st"),
    moduleId: mod?.id || "",
    moduleName: mod?.name || "Стеллаж",
    tech: mod?.tech || "",
    name: `Стеллаж ${index}`,
    count: 1,
    photoUrl: mod?.id ? stellageModulePhoto(stellageModuleMeta, mod.id) : "",
    items: mod?.id
      ? projectStellageLinesFromCatalog(stellageCatalogs, mod.id, materials, mod.name)
      : [],
  };
}
