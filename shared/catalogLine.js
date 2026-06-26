/**
 * Каталоги (стеллажи, разделы фермы, пресеты) — только ссылки на базу материалов.
 * materialId + defaultQty + subcategory (группа состава).
 * Строки без materialId — только черновик до сохранения в materials.
 * pipeCuts и др. — локальные overrides строки шаблона/проекта.
 */

import { attachLineSpecOverrides, pickLineSpecOverrides } from "./lineSpecOverrides.js";

export function slimCatalogLine(ln) {
  if (!ln || ln.included === false) return null;
  const defaultQty = Number(ln.qty ?? ln.defaultQty) || 0;
  const subcategory = String(ln.farmGroup || ln.subcategory || "").trim();

  if (ln.materialId) {
    const out = { materialId: ln.materialId, defaultQty, included: true };
    if (subcategory) out.subcategory = subcategory;
    return attachLineSpecOverrides(out, ln);
  }

  const name = String(ln.name || "").trim();
  if (!name) return null;
  const out = {
    name,
    unit: ln.unit || "шт.",
    category: ln.category || "Прочее",
    defaultQty,
    included: true,
  };
  if (subcategory) out.subcategory = subcategory;
  return attachLineSpecOverrides(out, ln);
}

export function stripCatalogLines(lines) {
  return (lines || []).map(slimCatalogLine).filter(Boolean);
}

/** Убрать устаревшие дубликаты полей из сохранённого JSON (миграция на чтении) */
export function normalizeStoredCatalogLine(ln) {
  if (!ln || typeof ln !== "object") return ln;
  if (ln.materialId) {
    const out = {
      materialId: ln.materialId,
      defaultQty: Number(ln.defaultQty ?? ln.qty) || 0,
      included: ln.included !== false,
    };
    const sub = String(ln.farmGroup || ln.subcategory || "").trim();
    if (sub) out.subcategory = sub;
    return attachLineSpecOverrides(out, ln);
  }
  return slimCatalogLine(ln) || ln;
}

export function normalizeStoredCatalog(lines) {
  return (lines || []).map(normalizeStoredCatalogLine).filter(Boolean);
}

/** Минимальная строка для upsert в каталог при изменении материала в базе */
export function slimCatalogEntryFromMaterial(m, prevLine = {}) {
  const defaultQty = Number(prevLine.defaultQty ?? prevLine.qty ?? m.defaultQty) || Number(m.defaultQty) || 0;
  const subcategory = String(prevLine.subcategory || prevLine.farmGroup || m.subcategory || "").trim();
  const out = { materialId: m.id, defaultQty, included: true };
  if (subcategory) out.subcategory = subcategory;
  return out;
}
