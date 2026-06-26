import { db } from "../db.js";
import { uid } from "./buildItems.js";

export function logPriceChange(materialId, oldPrice, newPrice, source = "manual", changedBy = "") {
  if (oldPrice === newPrice) return;
  db.prepare(`
    INSERT INTO material_price_history (id, material_id, old_price, new_price, source, changed_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(uid("ph"), materialId, oldPrice, newPrice, source, changedBy || "");
}

export function getPriceHistory(materialId, limit = 50) {
  return db
    .prepare(
      `SELECT old_price as oldPrice, new_price as newPrice, source, changed_by as changedBy, created_at as createdAt
       FROM material_price_history WHERE material_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(materialId, limit);
}
