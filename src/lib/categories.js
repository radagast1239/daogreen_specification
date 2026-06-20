import { CATEGORIES as DEFAULT_CATEGORIES } from "../data/modules.js";

export function parseCategoriesJson(raw) {
  try {
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list) && list.length) {
      return [...new Set(list.map((c) => String(c).trim()).filter(Boolean))];
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_CATEGORIES];
}

export function resolveCategories(settings = {}) {
  return parseCategoriesJson(settings.materialCategories);
}
