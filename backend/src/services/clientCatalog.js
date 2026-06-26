import { lineVisibleToClient } from "../../../shared/itemTypes.js";
import { listMaterials, listModules } from "../routes/materials.js";
import { loadReferenceData } from "./referenceData.js";

/** Минимальный каталог для клиентской закупки (группы стеллажа, типы модулей). */
export function clientCatalogForProject(project) {
  const ids = new Set(
    (project.items || []).filter(lineVisibleToClient).map((i) => i.materialId).filter(Boolean)
  );
  const materials = listMaterials()
    .filter((m) => ids.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      subcategory: m.subcategory,
      category: m.category,
    }));
  const modules = listModules().map((m) => ({ id: m.id, name: m.name, type: m.type }));
  const { stellageGroups } = loadReferenceData();
  return { materials, modules, stellageGroups };
}
