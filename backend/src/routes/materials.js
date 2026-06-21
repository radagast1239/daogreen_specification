import { db, rowToMaterial, rowToModule } from "../db.js";
import { uid } from "../services/buildItems.js";
import { logPriceChange } from "../services/priceHistory.js";
import { normalizePipeCuts, resolvePipeCuts } from "../../../shared/profilePipeCuts.js";
import { normalizeBreakerSpecs, resolveBreakerSpecs } from "../../../shared/breakerSpecs.js";
import {
  normalizeFlowSpecs,
  resolveFlowSpecs,
  aggregateFlowM3,
  primaryFlowLink,
  isFlowSpecName,
} from "../../../shared/flowSpecs.js";
import {
  normalizeSplitSpecs,
  resolveSplitSpecs,
  aggregateSplitCoolingKw,
  isSplitSystemName,
} from "../../../shared/splitSpecs.js";
import { structuredClientNote } from "../../../shared/structuredClientNote.js";
import {
  normalizeMaterialModules,
  primaryMaterialModule,
  materialInModule,
  patchMaterialModules,
  resolveMaterialModules,
} from "../../../shared/materialModules.js";

const INSERT_MAT = db.prepare(`
  INSERT INTO materials (
    id, name, unit, base_price, default_qty, module, category, subcategory, farm_section_id, item_type,
    supplier, link, link_alt, photo_url, vat_rate, vat_included,
    client_note, tech_note, internal_note, status,
    needs_approval, is_consumable, is_spare_part, client_visible_default, responsible,
    cooling_kw, cooling_btu, exhaust_m3, tags, alternative_material_id, min_order_qty, order_step, default_item_role, pipe_cuts, breaker_specs, flow_specs, split_specs, modules_json, client_section, client_subsection, updated_at
  ) VALUES (
    @id, @name, @unit, @base_price, @default_qty, @module, @category, @subcategory, @farm_section_id, @item_type,
    @supplier, @link, @link_alt, @photo_url, @vat_rate, @vat_included,
    @client_note, @tech_note, @internal_note, @status,
    @needs_approval, @is_consumable, @is_spare_part, @client_visible_default, @responsible,
    @cooling_kw, @cooling_btu, @exhaust_m3, @tags, @alternative_material_id, @min_order_qty, @order_step, @default_item_role, @pipe_cuts, @breaker_specs, @flow_specs, @split_specs, @modules_json, @client_section, @client_subsection, datetime('now')
  )
`);

const UPDATE_MAT = db.prepare(`
  UPDATE materials SET
    name=@name, unit=@unit, base_price=@base_price, default_qty=@default_qty,
    module=@module, category=@category, subcategory=@subcategory, farm_section_id=@farm_section_id, item_type=@item_type,
    supplier=@supplier, link=@link, link_alt=@link_alt, photo_url=@photo_url,
    vat_rate=@vat_rate, vat_included=@vat_included,
    client_note=@client_note, tech_note=@tech_note, internal_note=@internal_note,
    status=@status, needs_approval=@needs_approval, is_consumable=@is_consumable,
    is_spare_part=@is_spare_part, client_visible_default=@client_visible_default,
    responsible=@responsible, cooling_kw=@cooling_kw, cooling_btu=@cooling_btu, exhaust_m3=@exhaust_m3,
    tags=@tags, alternative_material_id=@alternative_material_id, min_order_qty=@min_order_qty,
    order_step=@order_step, default_item_role=@default_item_role,
    pipe_cuts=@pipe_cuts,
    breaker_specs=@breaker_specs,
    flow_specs=@flow_specs,
    split_specs=@split_specs,
    modules_json=@modules_json,
    client_section=@client_section,
    client_subsection=@client_subsection,
    updated_at=datetime('now')
  WHERE id=@id
`);

function matToParams(m, id) {
  const cuts = normalizePipeCuts(m.pipeCuts ?? resolvePipeCuts(m));
  const breakerSpecs = normalizeBreakerSpecs(m.breakerSpecs ?? resolveBreakerSpecs(m));
  const flowSpecs = normalizeFlowSpecs(m.flowSpecs ?? resolveFlowSpecs(m));
  const splitSpecs = normalizeSplitSpecs(m.splitSpecs ?? resolveSplitSpecs(m));
  const modules = normalizeMaterialModules(m.modules ?? resolveMaterialModules(m));
  const enriched = { ...m, pipeCuts: cuts, breakerSpecs, flowSpecs, splitSpecs };
  const clientNote = structuredClientNote(enriched);
  let link = m.link || "";
  let coolingKw = Number(m.coolingKw) || 0;
  let exhaustM3 = Number(m.exhaustM3) || 0;
  if (isFlowSpecName(m.name)) {
    exhaustM3 = aggregateFlowM3(flowSpecs);
    link = primaryFlowLink(flowSpecs, link);
  }
  if (isSplitSystemName(m.name)) {
    coolingKw = aggregateSplitCoolingKw(splitSpecs);
  }
  return {
    id: id || m.id || uid("m"),
    name: m.name,
    unit: m.unit || "шт.",
    base_price: Number(m.basePrice) || 0,
    default_qty: Number(m.defaultQty) ?? 1,
    module: primaryMaterialModule({ ...m, modules }),
    category: m.category || "Прочее",
    subcategory: m.subcategory || "",
    farm_section_id: m.farmSectionId || "",
    item_type: m.itemType || "material",
    supplier: m.supplier || "",
    link,
    link_alt: m.linkAlt || "",
    photo_url: m.imageUrl || m.photoUrl || "",
    vat_rate: Number(m.vatRate) || 0,
    vat_included: m.vatIncluded ? 1 : 0,
    client_note: clientNote,
    tech_note: m.techNote || "",
    internal_note: m.internalNote || "",
    status: m.status || "active",
    needs_approval: m.needsApproval ? 1 : 0,
    is_consumable: m.isConsumable ? 1 : 0,
    is_spare_part: m.isSparePart ? 1 : 0,
    client_visible_default: m.clientVisibleDefault !== false ? 1 : 0,
    responsible: m.responsible || "general",
    cooling_kw: coolingKw,
    cooling_btu: m.coolingBtu || "",
    exhaust_m3: exhaustM3,
    tags: JSON.stringify(Array.isArray(m.tags) ? m.tags : []),
    alternative_material_id: m.alternativeMaterialId || "",
    min_order_qty: Number(m.minOrderQty) || 0,
    order_step: Number(m.orderStep) || 1,
    default_item_role: m.defaultItemRole || "purchase",
    pipe_cuts: JSON.stringify(cuts),
    breaker_specs: JSON.stringify(breakerSpecs),
    flow_specs: JSON.stringify(flowSpecs),
    split_specs: JSON.stringify(splitSpecs),
    modules_json: JSON.stringify(modules),
    client_section: m.clientSection || "",
    client_subsection: m.clientSubsection || "",
  };
}

export function listMaterials({ module, category, q } = {}) {
  let sql = "SELECT * FROM materials WHERE 1=1";
  const params = {};
  if (category) {
    sql += " AND category = @category";
    params.category = category;
  }
  if (q) {
    sql += " AND name LIKE @q";
    params.q = `%${q}%`;
  }
  sql += " ORDER BY module, name";
  let list = db.prepare(sql).all(params).map(rowToMaterial);
  if (module) list = list.filter((m) => materialInModule(m, module));
  return list;
}

export function getMaterial(id) {
  return rowToMaterial(db.prepare("SELECT * FROM materials WHERE id = ?").get(id));
}

export function createMaterial(data) {
  const p = matToParams(data);
  INSERT_MAT.run(p);
  return getMaterial(p.id);
}

export function updateMaterial(id, patch) {
  const cur = getMaterial(id);
  if (!cur) return null;
  const merged = { ...cur, ...patch, id };
  if (patch.basePrice != null && patch.basePrice !== cur.basePrice) {
    logPriceChange(id, cur.basePrice, Number(patch.basePrice) || 0, patch.priceSource || "manual");
  }
  UPDATE_MAT.run(matToParams(merged, id));
  return getMaterial(id);
}

export function deleteMaterial(id) {
  db.prepare("DELETE FROM materials WHERE id = ?").run(id);
}

export function bulkUpsertMaterials(materials, mode = "merge") {
  if (mode === "replace") db.prepare("DELETE FROM materials").run();
  for (const m of materials) {
    const existing = m.id ? getMaterial(m.id) : null;
    if (existing) updateMaterial(existing.id, m);
    else createMaterial(m);
  }
  return materials.length;
}

export function listModules() {
  return db.prepare("SELECT * FROM modules WHERE active = 1 ORDER BY sort_order, name").all().map(rowToModule);
}

export function listModulesAdmin({ includeArchived = true } = {}) {
  const sql = includeArchived
    ? "SELECT * FROM modules ORDER BY active DESC, sort_order, name"
    : "SELECT * FROM modules WHERE active = 1 ORDER BY sort_order, name";
  return db.prepare(sql).all().map(rowToModule);
}

export function getModule(id) {
  return rowToModule(db.prepare("SELECT * FROM modules WHERE id = ?").get(id));
}

const MODULE_TYPES = new Set(["stellage", "general", "assembly", "consumables", "farm_section"]);

function nextModuleSortOrder() {
  const row = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM modules").get();
  return row?.n || 0;
}

/** Seed: только добавляет новые модули, не перезаписывает пользовательские правки */
export function ensureModuleSeed(mod) {
  db.prepare(`
    INSERT INTO modules (id, name, type, tech, section, icon, color, farm_section_id, active, sort_order)
    VALUES (@id, @name, @type, @tech, @section, @icon, @color, @farm_section_id, 1, @sort_order)
    ON CONFLICT(id) DO NOTHING
  `).run({
    id: mod.id,
    name: mod.name,
    type: mod.type,
    tech: mod.tech || "",
    section: mod.section || mod.name,
    icon: mod.icon || "",
    color: mod.color || "#116355",
    farm_section_id: mod.farmSectionId || "",
    sort_order: mod.sortOrder ?? 0,
  });
}

export function upsertModule(mod) {
  ensureModuleSeed(mod);
}

export function createModule(data) {
  const type = MODULE_TYPES.has(data.type) ? data.type : "general";
  const id = data.id || uid("mod");
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Укажите название модуля");
  const existing = db.prepare("SELECT id FROM modules WHERE name = ? AND active = 1").get(name);
  if (existing) throw new Error("Модуль с таким названием уже есть");

  db.prepare(`
    INSERT INTO modules (id, name, type, tech, section, icon, color, farm_section_id, active, sort_order)
    VALUES (@id, @name, @type, @tech, @section, @icon, @color, @farm_section_id, 1, @sort_order)
  `).run({
    id,
    name,
    type,
    tech: data.tech || "",
    section: data.section || name,
    icon: data.icon || "",
    color: data.color || "#116355",
    farm_section_id: data.farmSectionId || "",
    sort_order: data.sortOrder ?? nextModuleSortOrder(),
  });
  return getModule(id);
}

export function updateModule(id, patch) {
  const cur = getModule(id);
  if (!cur) return null;

  const name = patch.name != null ? String(patch.name).trim() : cur.name;
  if (!name) throw new Error("Название не может быть пустым");

  if (patch.name != null && name !== cur.name) {
    const dup = db.prepare("SELECT id FROM modules WHERE name = ? AND id != ? AND active = 1").get(name, id);
    if (dup) throw new Error("Модуль с таким названием уже есть");
    for (const row of db.prepare("SELECT * FROM materials").all()) {
      const mat = rowToMaterial(row);
      if (!materialInModule(mat, cur.name)) continue;
      const next = patchMaterialModules(
        mat,
        resolveMaterialModules(mat).map((n) => (n === cur.name ? name : n))
      );
      UPDATE_MAT.run(matToParams(next, mat.id));
    }
  }

  const type = patch.type != null ? (MODULE_TYPES.has(patch.type) ? patch.type : cur.type) : cur.type;

  db.prepare(`
    UPDATE modules SET
      name=@name, type=@type, tech=@tech, section=@section,
      icon=@icon, color=@color, farm_section_id=@farm_section_id,
      sort_order=@sort_order
    WHERE id=@id
  `).run({
    id,
    name,
    type,
    tech: patch.tech != null ? patch.tech : cur.tech,
    section: patch.section != null ? patch.section : cur.section,
    icon: patch.icon != null ? patch.icon : cur.icon,
    color: patch.color != null ? patch.color : cur.color,
    farm_section_id: patch.farmSectionId != null ? patch.farmSectionId : cur.farmSectionId,
    sort_order: patch.sortOrder != null ? patch.sortOrder : cur.sortOrder,
  });
  return getModule(id);
}

export function archiveModule(id) {
  const cur = getModule(id);
  if (!cur) return null;
  db.prepare("UPDATE modules SET active = 0 WHERE id = ?").run(id);
  return getModule(id);
}

export function restoreModule(id) {
  const cur = getModule(id);
  if (!cur) return null;
  db.prepare("UPDATE modules SET active = 1 WHERE id = ?").run(id);
  return getModule(id);
}

export function duplicateModule(id) {
  const src = getModule(id);
  if (!src) return null;

  let copyName = `${src.name} (копия)`;
  let n = 2;
  while (db.prepare("SELECT id FROM modules WHERE name = ?").get(copyName)) {
    copyName = `${src.name} (копия ${n++})`;
  }

  const newMod = createModule({
    name: copyName,
    type: src.type,
    tech: src.tech,
    section: src.section,
    icon: src.icon,
    color: src.color,
    farmSectionId: src.farmSectionId,
  });

  const mats = listMaterials({ module: src.name });
  for (const m of mats) {
    createMaterial({ ...m, id: undefined, modules: [copyName], module: copyName });
  }

  return { module: newMod, materialCount: mats.length };
}
