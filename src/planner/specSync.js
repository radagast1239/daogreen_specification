import { uid } from "../store/helpers.js";
import { lineFromMaterial, lineToProjectItem } from "../lib/projectBuilder.js";
import { materialInModule } from "../../shared/materialModules.js";

const EXCLUDED_FROM_SPEC_BY_DEFAULT = new Set(["door", "door2", "window", "person"]);
const KIT_BY_DEFAULT = new Set(["rack", "seed_rack"]);

const OBJECT_KIND_HINTS = {
  rack: ["стеллаж", "nft", "проточка"],
  seed_rack: ["рассад"],
  osmosis: ["водоподготов", "осмос"],
  water_prep: ["водоподготов"],
  tank: ["водоподготов", "ёмкости", "емкости", "полив"],
  tank_waste: ["водоподготов", "дренаж", "слив"],
  pump: ["насос", "водоподготов", "полив"],
  table_sow: ["манипуляц", "посев"],
  table_recv: ["манипуляц", "прием", "приём"],
  table_manip: ["манипуляц"],
  fridge: ["холод", "климат"],
  freezer: ["холод", "климат"],
  recirc: ["климат", "вентиляц"],
  blade_fan: ["климат", "вентиляц"],
  vent_unit: ["климат", "вентиляц"],
  ac_indoor: ["климат", "кондиц"],
  ac_outdoor: ["климат", "кондиц"],
  ac_floor: ["климат", "кондиц"],
  ac_duct: ["климат", "вентиляц"],
  panel: ["электр", "щит"],
  socket: ["электр", "розет"],
};

export function defaultObjectSpecSettings(kind) {
  const included = !EXCLUDED_FROM_SPEC_BY_DEFAULT.has(kind);
  return {
    includedInProject: included,
    visibleToClient: true,
    approved: false,
    // custom | material | module | projectSection
    specMode: KIT_BY_DEFAULT.has(kind) ? "projectSection" : "custom",
    linkedMaterialId: "",
    specModuleName: "",
    specSourceSection: "",
    specOutputSection: "",
    specQty: 1,
    specPrice: "",
    specComment: "",
  };
}

const OBJECT_PRESETS = {
  rack:        { module: "Стеллажи из плана", category: "Каркас и крепёж", unit: "шт.", name: "Стеллаж", comment: "Автоматически из планировщика" },
  seed_rack:   { module: "Стеллажи из плана", category: "Каркас и крепёж", unit: "шт.", name: "Рассадный стеллаж", comment: "Автоматически из планировщика" },
  shelf_cons:  { module: "Общая закупка на ферму", category: "Каркас и крепёж", unit: "шт.", name: "Стеллаж расходников" },
  shelf_inv:   { module: "Общая закупка на ферму", category: "Каркас и крепёж", unit: "шт.", name: "Стеллаж инвентаря" },
  table_sow:   { module: "Манипуляционная зона", category: "Прочее", unit: "шт.", name: "Стол посева" },
  table_recv:  { module: "Манипуляционная зона", category: "Прочее", unit: "шт.", name: "Стол приёмки" },
  table_manip: { module: "Манипуляционная зона", category: "Прочее", unit: "шт.", name: "Стол манипуляций" },
  table_subs:  { module: "Манипуляционная зона", category: "Прочее", unit: "шт.", name: "Стол субстрата" },
  chair:       { module: "Общая закупка на ферму", category: "Прочее", unit: "шт.", name: "Стул" },
  bench:       { module: "Общая закупка на ферму", category: "Прочее", unit: "шт.", name: "Лавочка" },
  wardrobe:    { module: "Общая закупка на ферму", category: "Прочее", unit: "шт.", name: "Шкаф раздевалки" },
  hanger:      { module: "Общая закупка на ферму", category: "Прочее", unit: "шт.", name: "Вешалка" },
  notebook:    { module: "Общая закупка на ферму", category: "Прочее", unit: "шт.", name: "Ноутбук" },
  fridge:      { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Холодильник" },
  freezer:     { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Морозилка" },
  trolley:     { module: "Манипуляционная зона", category: "Прочее", unit: "шт.", name: "Тележка для растений" },
  ladder:      { module: "Инструмент и инвентарь", category: "Прочее", unit: "шт.", name: "Стремянка" },
  trashcan:    { module: "Манипуляционная зона", category: "Прочее", unit: "шт.", name: "Мусорный бак" },
  dezmat:      { module: "Расходники запуска", category: "Расходники", unit: "шт.", name: "Дезинфекционный коврик" },
  scales_fl:   { module: "Манипуляционная зона", category: "Прочее", unit: "шт.", name: "Весы напольные" },
  scales_tb:   { module: "Манипуляционная зона", category: "Прочее", unit: "шт.", name: "Весы настольные" },
  recirc:      { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Бактерицидный рециркулятор" },
  dispenser:   { module: "Расходники запуска", category: "Расходники", unit: "шт.", name: "Диспенсер/санитайзер" },
  osmosis:     { module: "Водоподготовка", category: "Полив и сантехника", unit: "шт.", name: "Обратный осмос" },
  water_prep:  { module: "Водоподготовка", category: "Полив и сантехника", unit: "шт.", name: "Водоподготовка" },
  sink_susp:   { module: "Сантехника", category: "Полив и сантехника", unit: "шт.", name: "Раковина подвесная" },
  sink_table:  { module: "Сантехника", category: "Полив и сантехника", unit: "шт.", name: "Раковина настольная" },
  sink_double: { module: "Сантехника", category: "Полив и сантехника", unit: "шт.", name: "Двойная раковина" },
  toilet:      { module: "Сантехника", category: "Полив и сантехника", unit: "шт.", name: "Унитаз" },
  bidet:       { module: "Сантехника", category: "Полив и сантехника", unit: "шт.", name: "Биде" },
  shower_pan:  { module: "Сантехника", category: "Полив и сантехника", unit: "шт.", name: "Душевой поддон" },
  shower_sys:  { module: "Сантехника", category: "Полив и сантехника", unit: "шт.", name: "Душевая система" },
  trap:        { module: "Сантехника", category: "Полив и сантехника", unit: "шт.", name: "Трап" },
  mirror:      { module: "Сантехника", category: "Прочее", unit: "шт.", name: "Зеркало" },
  tank:        { module: "Водоподготовка", category: "Полив и сантехника", unit: "шт.", name: "Ёмкость" },
  tank_waste:  { module: "Водоподготовка", category: "Полив и сантехника", unit: "шт.", name: "Бак отходов" },
  pump:        { module: "Водоподготовка", category: "Полив и сантехника", unit: "шт.", name: "Насос" },
  panel:       { module: "Электрика и щит", category: "Электрика и свет", unit: "шт.", name: "Электрощит" },
  socket:      { module: "Электрика и щит", category: "Электрика и свет", unit: "шт.", name: "Розетка/блок" },
  vent_unit:   { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Вентустановка" },
  blade_fan:   { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Вентилятор" },
  ac_indoor:   { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Внутренний блок кондиционера" },
  ac_outdoor:  { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Внешний блок кондиционера" },
  ac_floor:    { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Напольный кондиционер" },
  ac_duct:     { module: "Климат и вентиляция", category: "Климат и вентиляция", unit: "шт.", name: "Канальный блок" },
};

const LINE_PRESETS = {
  drain:      { module: "Слив / дренаж", category: "Полив и сантехника", unit: "м.п.", name: "Трасса слива / дренажа" },
  irrigation: { module: "Полив", category: "Полив и сантехника", unit: "м.п.", name: "Трасса полива" },
  supply:     { module: "Полив", category: "Полив и сантехника", unit: "м.п.", name: "Трасса полива" },
  power:      { module: "Электрика и щит", category: "Электрика и свет", unit: "м.п.", name: "Кабельная линия" },
  light:      { module: "Электрика и щит", category: "Электрика и свет", unit: "м.п.", name: "Линия освещения" },
  vent:       { module: "Вентиляция", category: "Климат и вентиляция", unit: "м.п.", name: "Воздуховод" },
  climate:    { module: "Кондиционеры", category: "Климат и вентиляция", unit: "м.п.", name: "Трасса кондиционера" },
  ac:         { module: "Кондиционеры", category: "Климат и вентиляция", unit: "м.п.", name: "Трасса кондиционера" },
  staff:      { module: "Персонал", category: "Прочее", unit: "м.п.", name: "Маршрут персонала" },
};

const roundQty = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s || "").trim().toLowerCase();
const includesAny = (text, words) => words.some((w) => norm(text).includes(norm(w)));

const lineLenM = (pts = []) => {
  let mm = 0;
  for (let i = 1; i < pts.length; i++) mm += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return roundQty(mm / 1000);
};

function getMaterial(materials, id) {
  if (!id) return null;
  return materials.find((m) => m.id === id) || null;
}

function getPreset(kind) {
  return OBJECT_PRESETS[kind] || { module: "Общая закупка на ферму", category: "Прочее", unit: "шт.", name: kind || "Объект" };
}

export function projectSectionTemplates(existingItems = []) {
  const map = new Map();
  for (const it of existingItems || []) {
    if (it.source === "planner") continue;
    const name = it.module || it.section || "";
    if (!name || it.includedInProject === false) continue;
    const prev = map.get(name) || { name, count: 0, totalQty: 0 };
    prev.count += 1;
    prev.totalQty += Number(it.qty) || 0;
    map.set(name, prev);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function resolveProjectSection(obj, existingItems = []) {
  if (obj.specSourceSection) return obj.specSourceSection;
  const templates = projectSectionTemplates(existingItems);
  const hints = OBJECT_KIND_HINTS[obj.kind] || [obj.label || ""];
  const found = templates.find((t) => includesAny(t.name, hints));
  return found?.name || "";
}

function resolveModuleName(obj, modules = []) {
  if (obj.specModuleName) return obj.specModuleName;
  const preset = getPreset(obj.kind);
  const hints = OBJECT_KIND_HINTS[obj.kind] || [preset.module, preset.name];
  const found = (modules || []).find((m) => m.active !== false && (includesAny(m.name, hints) || includesAny(m.section, hints)));
  return found?.name || preset.module || "";
}

function outputSectionForObject(obj, sourceSection = "") {
  if (obj.specOutputSection) return obj.specOutputSection;
  if (obj.specMode === "projectSection" && sourceSection) return `План · ${sourceSection}`;
  const preset = getPreset(obj.kind);
  return preset.module || "Планировщик";
}

function baseFlags(obj) {
  return {
    visible: obj.visibleToClient !== false,
    approved: !!obj.approved,
    enabled: obj.includedInProject !== false,
    includedInProject: obj.includedInProject !== false,
    visibleToClient: obj.visibleToClient !== false,
  };
}

function addGrouped(groups, existingByKey, key, item, qty, sourceObjectId) {
  if (!groups.has(key)) {
    const prev = existingByKey.get(key);
    groups.set(key, {
      ...item,
      id: prev?.id || item.id || uid("it"),
      qty: 0,
      status: prev?.status || item.status || "not_bought",
      actualPrice: prev?.actualPrice ?? item.actualPrice ?? null,
      clientComment: prev?.clientComment || item.clientComment || "",
      source: "planner",
      sourceKey: key,
      sourceObjectIds: [],
    });
  }
  const row = groups.get(key);
  row.qty = roundQty((Number(row.qty) || 0) + qty);
  if (sourceObjectId && !row.sourceObjectIds.includes(sourceObjectId)) row.sourceObjectIds.push(sourceObjectId);
}

function itemFromMaterialRow(mat, obj, qty, sortOrder, { section, sourceKey, sourceType }) {
  const line = lineFromMaterial(mat, { included: true, qty });
  const item = lineToProjectItem(line, section, sortOrder);
  return {
    ...item,
    ...baseFlags(obj),
    module: section,
    section,
    source: "planner",
    sourceType,
    sourceKey,
    sourceObjectIds: [obj.id],
    techNote: [item.techNote, obj.specComment].filter(Boolean).join(" · "),
    comment: [item.comment, obj.specComment].filter(Boolean).join(" · "),
  };
}

function itemBaseFromObject(obj, materials) {
  const linked = getMaterial(materials, obj.linkedMaterialId);
  const preset = getPreset(obj.kind);
  const qty = roundQty(obj.specQty || 1);
  const size = `${Math.round(obj.w)}×${Math.round(obj.h)} мм`;
  if (linked) {
    const section = obj.specOutputSection || linked.module || preset.module;
    const key = ["planner:material", linked.id, section, obj.visibleToClient ? "client" : "hidden", obj.approved ? "approved" : "draft"].join(":");
    const item = itemFromMaterialRow(linked, obj, qty, 0, { section, sourceKey: key, sourceType: "material" });
    item.price = obj.specPrice !== "" && obj.specPrice != null ? Number(obj.specPrice) || 0 : Number(linked.basePrice) || 0;
    item.techNote = [item.techNote, `Из плана: ${obj.label || preset.name}, ${size}`].filter(Boolean).join(" · ");
    return { key, item, qty };
  }
  const section = outputSectionForObject(obj);
  const key = ["planner:custom", obj.kind, obj.label || preset.name, section, preset.unit, Math.round(obj.w), Math.round(obj.h), obj.visibleToClient ? "client" : "hidden", obj.approved ? "approved" : "draft"].join(":");
  return {
    key,
    qty,
    item: {
      id: uid("it"),
      materialId: "",
      module: section,
      section,
      name: obj.label || preset.name,
      unit: preset.unit,
      category: obj.specCategory || preset.category,
      link: "",
      comment: [`Из плана: ${size}`, preset.comment, obj.specComment].filter(Boolean).join(" · "),
      techNote: obj.specComment || "",
      price: obj.specPrice !== "" && obj.specPrice != null ? Number(obj.specPrice) || 0 : 0,
      status: "not_bought",
      actualPrice: null,
      clientComment: "",
      source: "planner",
      sourceType: "custom",
      sourceKey: key,
      sourceObjectIds: [obj.id],
      ...baseFlags(obj),
    },
  };
}

function addObjectAsProjectSection({ obj, existingItems, existingByKey, groups }) {
  const sourceSection = resolveProjectSection(obj, existingItems);
  if (!sourceSection) return false;
  const sourceRows = existingItems.filter((it) => it.source !== "planner" && (it.module === sourceSection || it.section === sourceSection) && it.includedInProject !== false && Number(it.qty) > 0);
  if (!sourceRows.length) return false;
  const mult = roundQty(obj.specQty || 1) || 1;
  const outputSection = outputSectionForObject(obj, sourceSection);
  for (const src of sourceRows) {
    const qty = roundQty((Number(src.qty) || 0) * mult);
    if (!qty) continue;
    const key = ["planner:section", sourceSection, outputSection, src.materialId || src.name, src.unit, obj.visibleToClient ? "client" : "hidden", obj.approved ? "approved" : "draft"].join(":");
    addGrouped(groups, existingByKey, key, {
      ...src,
      id: uid("it"),
      module: outputSection,
      section: outputSection,
      visible: obj.visibleToClient !== false,
      approved: !!obj.approved,
      enabled: obj.includedInProject !== false,
      includedInProject: obj.includedInProject !== false,
      visibleToClient: obj.visibleToClient !== false,
      techNote: [src.techNote, `Из планировщика: ${obj.label || obj.kind}`, obj.specComment].filter(Boolean).join(" · "),
      comment: [src.comment, obj.specComment].filter(Boolean).join(" · "),
      sourceType: "projectSection",
    }, qty, obj.id);
  }
  return true;
}

function addObjectAsModule({ obj, materials, modules, existingByKey, groups }) {
  const moduleName = resolveModuleName(obj, modules);
  if (!moduleName) return false;
  const mats = materials.filter((m) => m.status === "active" && materialInModule(m, moduleName) && (Number(m.defaultQty) || 0) > 0);
  if (!mats.length) return false;
  const mult = roundQty(obj.specQty || 1) || 1;
  const outputSection = obj.specOutputSection || moduleName;
  for (const mat of mats) {
    const qty = roundQty((Number(mat.defaultQty) || 0) * mult);
    if (!qty) continue;
    const key = ["planner:module", moduleName, outputSection, mat.id, obj.visibleToClient ? "client" : "hidden", obj.approved ? "approved" : "draft"].join(":");
    const item = itemFromMaterialRow(mat, obj, qty, 0, { section: outputSection, sourceKey: key, sourceType: "module" });
    addGrouped(groups, existingByKey, key, item, qty, obj.id);
  }
  return true;
}

function mergeLineItem(line, existingByKey) {
  const preset = LINE_PRESETS[line.layer];
  if (!preset || line.layer === "staff") return null;
  const qty = lineLenM(line.pts);
  if (!qty) return null;
  const sourceKey = `planner:line:${line.layer}`;
  const prev = existingByKey.get(sourceKey);
  return {
    id: prev?.id || uid("it"),
    materialId: prev?.materialId || "",
    module: prev?.module || preset.module,
    section: prev?.section || prev?.module || preset.module,
    name: prev?.name || preset.name,
    unit: prev?.unit || preset.unit,
    category: prev?.category || preset.category,
    link: prev?.link || "",
    comment: prev?.comment || "Автоматически из линий планировщика",
    qty,
    price: prev?.price ?? 0,
    visible: prev?.visible ?? true,
    approved: prev?.approved ?? false,
    includedInProject: true,
    visibleToClient: prev?.visibleToClient ?? true,
    status: prev?.status || "not_bought",
    actualPrice: prev?.actualPrice ?? null,
    clientComment: prev?.clientComment || "",
    source: "planner",
    sourceType: "line",
    sourceKey,
    sourceObjectIds: [line.id],
  };
}

export function createPlannerSpecItems({ plan, materials = [], modules = [], existingItems = [] }) {
  const existingByKey = new Map(existingItems.filter((it) => it.source === "planner" && it.sourceKey).map((it) => [it.sourceKey, it]));
  const manual = existingItems.filter((it) => it.source !== "planner");
  const groups = new Map();

  for (const raw of plan.items || []) {
    const defaults = defaultObjectSpecSettings(raw.kind);
    const obj = { ...defaults, ...raw };
    if (!obj.includedInProject) continue;

    let expanded = false;
    if (obj.specMode === "projectSection") expanded = addObjectAsProjectSection({ obj, existingItems: manual, existingByKey, groups });
    if (!expanded && obj.specMode === "module") expanded = addObjectAsModule({ obj, materials, modules, existingByKey, groups });
    if (!expanded && obj.specMode === "material" && obj.linkedMaterialId) {
      const base = itemBaseFromObject({ ...obj, specMode: "material" }, materials);
      addGrouped(groups, existingByKey, base.key, base.item, base.qty, obj.id);
      expanded = true;
    }
    if (!expanded) {
      const base = itemBaseFromObject(obj, materials);
      addGrouped(groups, existingByKey, base.key, base.item, base.qty, obj.id);
    }
  }

  for (const line of plan.lines || []) {
    const row = mergeLineItem(line, existingByKey);
    if (!row) continue;
    const prev = groups.get(row.sourceKey);
    if (prev) {
      prev.qty = roundQty(prev.qty + row.qty);
      prev.sourceObjectIds.push(...row.sourceObjectIds);
    } else {
      groups.set(row.sourceKey, row);
    }
  }

  const generated = [...groups.values()]
    .map((it, sortOrder) => ({ ...it, sortOrder: (manual.length || 0) + sortOrder }))
    .sort((a, b) => (a.module || "").localeCompare(b.module || "", "ru") || (a.name || "").localeCompare(b.name || "", "ru"));
  return {
    items: [...manual, ...generated],
    generated,
    generatedCount: generated.length,
    objectCount: (plan.items || []).filter((it) => ({ ...defaultObjectSpecSettings(it.kind), ...it }).includedInProject).length,
    lineCount: generated.filter((it) => it.sourceType === "line").length,
    kitCount: generated.filter((it) => it.sourceType === "projectSection" || it.sourceType === "module").length,
  };
}

export function plannerSpecSummary(plan) {
  const objects = (plan.items || []).filter((it) => ({ ...defaultObjectSpecSettings(it.kind), ...it }).includedInProject).length;
  const hidden = (plan.items || []).filter((it) => ({ ...defaultObjectSpecSettings(it.kind), ...it }).includedInProject && it.visibleToClient === false).length;
  const linked = (plan.items || []).filter((it) => it.linkedMaterialId).length;
  const kitObjects = (plan.items || []).filter((it) => ["projectSection", "module"].includes(({ ...defaultObjectSpecSettings(it.kind), ...it }).specMode)).length;
  const lines = (plan.lines || []).filter((l) => LINE_PRESETS[l.layer] && lineLenM(l.pts) > 0).length;
  return { objects, hidden, linked, lines, kitObjects };
}
