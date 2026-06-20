import { cloneBuilderLines } from "./presetHelpers.js";
import { catalogLinesForModule, lineFromMaterial } from "./projectBuilder.js";
import { parseJson, stripLineIds } from "./farmSectionsConfig.js";
import { materialCompositionGroup } from "../../shared/stellageComposition.js";

export function parseStellageModuleCatalogs(raw) {
  return parseJson(raw, {});
}

export function parseStellageModuleMeta(raw) {
  return parseJson(raw, {});
}

export function stellageModulePhoto(meta, moduleId) {
  if (!moduleId || !meta?.[moduleId]) return "";
  return meta[moduleId].photoUrl || "";
}

/** Явное фото пресета/черновика; иначе — фото типа стеллажа из «Состав стеллажей». */
export function resolveStellagePhoto(meta, moduleId, override = "") {
  if (override) return override;
  return stellageModulePhoto(meta, moduleId);
}

export function patchStellageModulePhoto(meta, moduleId, photoUrl) {
  return {
    ...(meta || {}),
    [moduleId]: { ...(meta?.[moduleId] || {}), photoUrl: photoUrl || "" },
  };
}

function lineQtyFromCatalog(ln) {
  return Number(ln.defaultQty ?? ln.qty) || 0;
}

/** Строки из базы материалов — qty и галочки по defaultQty */
export function stellageLinesFromMaterials(materials, moduleName) {
  return materials
    .filter((m) => m.module === moduleName && m.status === "active")
    .map((m) => {
      const qty = Number(m.defaultQty) || 0;
      return lineFromMaterial(m, {
        included: qty > 0,
        qty,
        defaultQty: qty,
        subcategory: m.subcategory || materialCompositionGroup(m),
      });
    });
}

/** Редактор шаблона стеллажа в «Модули / разделы» */
export function stellageCatalogEditorLines(catalogs, moduleId, materials, moduleName) {
  const saved = catalogs[moduleId];
  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => {
      const qty = lineQtyFromCatalog(ln);
      if (!ln.materialId) {
        return { ...ln, included: ln.included !== false, qty, defaultQty: qty };
      }
      const mat = materials.find((m) => m.id === ln.materialId);
      return mat
        ? {
            ...lineFromMaterial(mat, {
              ...ln,
              included: ln.included !== false,
              qty,
              defaultQty: qty,
              subcategory: ln.subcategory || materialCompositionGroup(mat),
            }),
            id: ln.id,
          }
        : { ...ln, included: ln.included !== false, qty, defaultQty: qty };
    });
  }
  return stellageLinesFromMaterials(materials, moduleName);
}

/** Состав при сборке проекта — кол-во из шаблона, галочки снимаем */
export function projectStellageLinesFromCatalog(catalogs, moduleId, materials, moduleName) {
  const saved = catalogs[moduleId];
  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => {
      const defaultQty = lineQtyFromCatalog(ln);
      const base = {
        ...ln,
        included: false,
        qty: defaultQty,
        defaultQty,
      };
      if (!ln.materialId) return base;
      const mat = materials.find((m) => m.id === ln.materialId);
      return mat
        ? {
            ...lineFromMaterial(mat, {
              ...base,
              subcategory: ln.subcategory || materialCompositionGroup(mat),
            }),
            id: ln.id,
          }
        : base;
    });
  }
  return catalogLinesForModule(materials, moduleName).map((ln) => {
    const mat = materials.find((m) => m.id === ln.materialId);
    const defaultQty = Number(mat?.defaultQty) || 0;
    return {
      ...ln,
      subcategory: ln.subcategory || (mat ? materialCompositionGroup(mat) : ""),
      qty: defaultQty,
      defaultQty,
      included: false,
    };
  });
}

export function stripStellageCatalogLines(lines) {
  return stripLineIds(lines);
}

export function stellageCatalogCount(catalogs, moduleId) {
  return (catalogs[moduleId] || []).length;
}
