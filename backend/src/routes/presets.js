import { Router } from "express";
import { db } from "../db.js";
import { uid } from "../services/buildItems.js";

const router = Router();

function rowToPreset(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    presetType: row.preset_type,
    moduleId: row.module_id || "",
    moduleName: row.module_name || "",
    sectionId: row.section_id || "",
    sortOrder: row.sort_order,
    items: JSON.parse(row.items_json || "[]"),
    params: JSON.parse(row.params_json || "{}"),
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LIST = db.prepare(
  "SELECT * FROM spec_presets ORDER BY preset_type, sort_order, name"
);
const GET = db.prepare("SELECT * FROM spec_presets WHERE id = ?");
const INSERT = db.prepare(`
  INSERT INTO spec_presets (
    id, name, preset_type, module_id, module_name, section_id, sort_order, items_json, params_json, note, updated_at
  ) VALUES (
    @id, @name, @preset_type, @module_id, @module_name, @section_id, @sort_order, @items_json, @params_json, @note, datetime('now')
  )
`);
const UPDATE = db.prepare(`
  UPDATE spec_presets SET
    name=@name, preset_type=@preset_type, module_id=@module_id, module_name=@module_name, section_id=@section_id,
    sort_order=@sort_order, items_json=@items_json, params_json=@params_json, note=@note, updated_at=datetime('now')
  WHERE id=@id
`);
const DELETE = db.prepare("DELETE FROM spec_presets WHERE id = ?");

function toParams(p, id) {
  return {
    id: id || p.id || uid("pr"),
    name: p.name,
    preset_type: p.presetType,
    module_id: p.moduleId || "",
    module_name: p.moduleName || "",
    section_id: p.sectionId || "",
    sort_order: Number(p.sortOrder) || 0,
    items_json: JSON.stringify(p.items || []),
    params_json: JSON.stringify(p.params || {}),
    note: p.note || "",
  };
}

router.get("/", (_req, res) => {
  res.json(LIST.all().map(rowToPreset));
});

router.get("/:id", (req, res) => {
  const p = rowToPreset(GET.get(req.params.id));
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(p);
});

router.post("/", (req, res) => {
  const params = toParams(req.body);
  if (!params.name?.trim()) return res.status(400).json({ error: "name required" });
  if (!params.preset_type) return res.status(400).json({ error: "presetType required" });
  INSERT.run(params);
  res.status(201).json(rowToPreset(GET.get(params.id)));
});

router.patch("/:id", (req, res) => {
  const cur = rowToPreset(GET.get(req.params.id));
  if (!cur) return res.status(404).json({ error: "Not found" });
  const merged = { ...cur, ...req.body, id: cur.id };
  UPDATE.run(toParams(merged, cur.id));
  res.json(rowToPreset(GET.get(cur.id)));
});

router.delete("/:id", (req, res) => {
  DELETE.run(req.params.id);
  res.status(204).end();
});

router.post("/reorder", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
  const upd = db.prepare("UPDATE spec_presets SET sort_order = ?, updated_at = datetime('now') WHERE id = ?");
  ids.forEach((id, i) => upd.run(i, id));
  res.json(LIST.all().map(rowToPreset));
});

export default router;
