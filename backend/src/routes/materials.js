import { db, rowToMaterial, rowToModule } from "../db.js";
import { uid } from "../services/buildItems.js";
import { logPriceChange } from "../services/priceHistory.js";

const INSERT_MAT = db.prepare(`
  INSERT INTO materials (
    id, name, unit, base_price, default_qty, module, category, subcategory, farm_section_id, item_type,
    supplier, link, link_alt, photo_url, vat_rate, vat_included,
    client_note, tech_note, internal_note, status,
    needs_approval, is_consumable, is_spare_part, client_visible_default, responsible,
    cooling_kw, cooling_btu, exhaust_m3, tags, alternative_material_id, min_order_qty, order_step, default_item_role, updated_at
  ) VALUES (
    @id, @name, @unit, @base_price, @default_qty, @module, @category, @subcategory, @farm_section_id, @item_type,
    @supplier, @link, @link_alt, @photo_url, @vat_rate, @vat_included,
    @client_note, @tech_note, @internal_note, @status,
    @needs_approval, @is_consumable, @is_spare_part, @client_visible_default, @responsible,
    @cooling_kw, @cooling_btu, @exhaust_m3, @tags, @alternative_material_id, @min_order_qty, @order_step, @default_item_role, datetime('now')
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
    updated_at=datetime('now')
  WHERE id=@id
`);

function matToParams(m, id) {
  return {
    id: id || m.id || uid("m"),
    name: m.name,
    unit: m.unit || "шт.",
    base_price: Number(m.basePrice) || 0,
    default_qty: Number(m.defaultQty) ?? 1,
    module: m.module,
    category: m.category || "Прочее",
    subcategory: m.subcategory || "",
    farm_section_id: m.farmSectionId || "",
    item_type: m.itemType || "material",
    supplier: m.supplier || "",
    link: m.link || "",
    link_alt: m.linkAlt || "",
    photo_url: m.imageUrl || m.photoUrl || "",
    vat_rate: Number(m.vatRate) || 0,
    vat_included: m.vatIncluded ? 1 : 0,
    client_note: m.clientNote || m.comment || "",
    tech_note: m.techNote || "",
    internal_note: m.internalNote || "",
    status: m.status || "active",
    needs_approval: m.needsApproval ? 1 : 0,
    is_consumable: m.isConsumable ? 1 : 0,
    is_spare_part: m.isSparePart ? 1 : 0,
    client_visible_default: m.clientVisibleDefault !== false ? 1 : 0,
    responsible: m.responsible || "general",
    cooling_kw: Number(m.coolingKw) || 0,
    cooling_btu: m.coolingBtu || "",
    exhaust_m3: Number(m.exhaustM3) || 0,
    tags: JSON.stringify(Array.isArray(m.tags) ? m.tags : []),
    alternative_material_id: m.alternativeMaterialId || "",
    min_order_qty: Number(m.minOrderQty) || 0,
    order_step: Number(m.orderStep) || 1,
    default_item_role: m.defaultItemRole || "purchase",
  };
}

export function listMaterials({ module, category, q } = {}) {
  let sql = "SELECT * FROM materials WHERE 1=1";
  const params = {};
  if (module) {
    sql += " AND module = @module";
    params.module = module;
  }
  if (category) {
    sql += " AND category = @category";
    params.category = category;
  }
  if (q) {
    sql += " AND name LIKE @q";
    params.q = `%${q}%`;
  }
  sql += " ORDER BY module, name";
  return db.prepare(sql).all(params).map(rowToMaterial);
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

export function upsertModule(mod) {
  db.prepare(`
    INSERT INTO modules (id, name, type, tech, section, active, sort_order)
    VALUES (@id, @name, @type, @tech, @section, 1, @sort_order)
    ON CONFLICT(id) DO UPDATE SET name=@name, type=@type, tech=@tech, section=@section, sort_order=@sort_order
  `).run({
    id: mod.id,
    name: mod.name,
    type: mod.type,
    tech: mod.tech || "",
    section: mod.section || mod.name,
    sort_order: mod.sortOrder || 0,
  });
}
