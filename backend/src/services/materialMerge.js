import { db } from "../db.js";

/** Найти похожие материалы по нормализованному имени */
export function findDuplicateGroups() {
  const rows = db.prepare("SELECT id, name, module, base_price, supplier FROM materials ORDER BY name").all();
  const map = new Map();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, items]) => ({ key, items }));
}

/** Слить duplicateId в keepId: перепривязать project_items, удалить дубликат */
export function mergeMaterials(keepId, duplicateId) {
  if (keepId === duplicateId) throw new Error("Same material");
  const keep = db.prepare("SELECT id FROM materials WHERE id = ?").get(keepId);
  const dup = db.prepare("SELECT id FROM materials WHERE id = ?").get(duplicateId);
  if (!keep || !dup) throw new Error("Material not found");

  const run = db.transaction(() => {
    db.prepare("UPDATE project_items SET material_id = ? WHERE material_id = ?").run(keepId, duplicateId);
    db.prepare("UPDATE materials SET alternative_material_id = ? WHERE alternative_material_id = ?").run(
      keepId,
      duplicateId
    );
    db.prepare("DELETE FROM materials WHERE id = ?").run(duplicateId);
  });
  run();
  return { ok: true, keepId, removedId: duplicateId };
}
