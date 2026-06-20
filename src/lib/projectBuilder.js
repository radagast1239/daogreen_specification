import { uid } from "../store/helpers.js";
import { defaultResponsible } from "./itemHelpers.js";
import { groupLabel, materialCompositionGroup } from "../../shared/stellageComposition.js";

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
    included: true,
    ...overrides,
  };
}

export function lineToMaterialPayload(line, moduleName) {
  return {
    name: line.name.trim(),
    unit: line.unit || "шт.",
    module: moduleName,
    category: line.category || "Прочее",
    subcategory: line.subcategory || "",
    defaultQty: 0,
    basePrice: Number(line.price) || 0,
    link: line.link || "",
    linkAlt: line.linkAlt || "",
    vatRate: Number(line.vatRate) || 0,
    techNote: line.techNote || "",
    clientNote: line.clientNote || "",
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
  };
}

/** Строки каталога для сборки — все видны, по умолчанию не отмечены */
export function catalogLinesForModule(materials, moduleName) {
  return materials
    .filter((m) => m.module === moduleName && m.status === "active")
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
    ...overrides,
  });
}

/** Опциональный шаблон — только по кнопке, не по умолчанию */
export function templateLinesForModule(materials, moduleName) {
  return materials
    .filter((m) => m.module === moduleName && m.status === "active")
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
    qty,
    price: Number(line.price) || 0,
    vatRate: Number(line.vatRate) || 0,
    responsible: defaultResponsible(line.category, line),
    visible: on && qty > 0,
    approved: false,
    enabled: on,
    needsApproval: false,
    status: "not_bought",
    actualPrice: null,
    clientComment: "",
    sortOrder,
  };
}

export function buildProjectFromBuilder({ form, stellages, farmSections, generalLines }) {
  const items = [];
  const stellageConfigs = [];
  let order = 0;

  for (const st of stellages) {
    const section = st.name?.trim() || st.moduleName;
    stellageConfigs.push({
      id: st.id,
      name: section,
      moduleId: st.moduleId,
      moduleName: st.moduleName,
      tech: st.tech || "",
      presetId: st.presetId || null,
      groups: activeLines(st.items).map((ln) => ({
        name: ln.name,
        qty: ln.qty,
        subcategory: ln.subcategory,
        group: groupLabel(ln.subcategory),
      })),
    });
    for (const line of activeLines(st.items)) {
      items.push(lineToProjectItem(line, section, order++));
    }
  }

  if (farmSections?.length) {
    for (const sec of farmSections) {
      const sectionName = sec.sectionName || sec.name;
      for (const line of activeLines(sec.items)) {
        items.push(lineToProjectItem(line, sectionName, order++));
      }
    }
  } else if (generalLines?.length) {
    const generalSection = "Общая закупка на ферму";
    for (const line of activeLines(generalLines)) {
      items.push(lineToProjectItem(line, generalSection, order++));
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
    items,
  };
}

export function newStellageDraft(modules, materials, index) {
  const stellageMods = modules.filter((m) => m.type === "stellage");
  const mod = stellageMods[0] || modules[0];
  return {
    id: uid("st"),
    moduleId: mod?.id || "",
    moduleName: mod?.name || "Стеллаж",
    tech: mod?.tech || "",
    name: `Стеллаж ${index}`,
    items: mod?.name ? catalogLinesForModule(materials, mod.name) : [],
  };
}
