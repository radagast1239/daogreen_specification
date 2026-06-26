import { uid } from "./ids.js";
import { stripCatalogLines } from "../../shared/catalogLine.js";

export function cloneBuilderLines(items, { freshIds = false } = {}) {
  return (items || []).map((ln) => ({
    ...ln,
    id: freshIds ? uid("ln") : ln.id || uid("ln"),
  }));
}

/** Сохранение шаблона — только materialId, кол-во, группа состава */
export function stripLineIds(lines) {
  return stripCatalogLines(lines);
}
