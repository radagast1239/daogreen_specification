import { cloneBuilderLines } from "./builderLines.js";
import { hydrateCatalogEditorLine } from "./specLineCore.js";
import { parseJson } from "./jsonUtils.js";
import { stripLineIds } from "./builderLines.js";
import { normalizeStoredCatalog } from "../../shared/catalogLine.js";
import { materialCompositionGroup } from "../../shared/stellageComposition.js";
import { lineFromMaterial } from "./specLineCore.js";

export function parseStellageModuleCatalogs(raw) {
  const obj = parseJson(raw, {});
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = Array.isArray(v) ? normalizeStoredCatalog(v) : v;
  }
  return out;
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

/** @deprecated Только для служебной совместимости — не использовать при сборке проекта */
export function stellageLinesFromMaterials() {
  return [];
}

/** Редактор шаблона стеллажа в «Модули / разделы» */
export function stellageCatalogEditorLines(catalogs, moduleId, materials, moduleName) {
  const saved = catalogs[moduleId];
  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => hydrateCatalogEditorLine(ln, materials));
  }
  return [];
}

/** Состав при сборке проекта — кол-во из шаблона, галочки снимаем */
export function projectStellageLinesFromCatalog(catalogs, moduleId, materials, moduleName) {
  const saved = catalogs[moduleId];
  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => {
      const defaultQty = lineQtyFromCatalog(ln);
      const sub = ln.subcategory || ln.farmGroup || "";
      if (!ln.materialId) {
        return {
          ...hydrateCatalogEditorLine(ln, materials),
          included: false,
          qty: defaultQty,
          defaultQty,
        };
      }
      const mat = materials.find((m) => m.id === ln.materialId);
      return mat
        ? {
            ...lineFromMaterial(mat, {
              included: false,
              qty: defaultQty,
              defaultQty,
              subcategory: sub || materialCompositionGroup(mat),
              farmGroup: sub,
            }),
            id: ln.id,
          }
        : hydrateCatalogEditorLine({ ...ln, included: false, qty: defaultQty, defaultQty }, materials);
    });
  }
  return [];
}

export function stripStellageCatalogLines(lines) {
  return stripLineIds(lines);
}

export function stellageCatalogCount(catalogs, moduleId) {
  return (catalogs[moduleId] || []).length;
}

/** Строки редактора: шаблон источника, подставленный под тип стеллажа назначения */
export function stellageCatalogLinesCopiedFrom(catalogs, fromModuleId, toModuleId, materials, toModuleName) {
  const source = catalogs[fromModuleId];
  if (!source?.length) return null;
  return stellageCatalogEditorLines({ ...catalogs, [toModuleId]: source }, toModuleId, materials, toModuleName);
}

/** Копия сохранённого шаблона между типами стеллажей */
export function copyStellageCatalogEntry(catalogs, fromModuleId, toModuleId) {
  const source = catalogs[fromModuleId];
  if (!source?.length) return catalogs;
  return {
    ...catalogs,
    [toModuleId]: stripLineIds(cloneBuilderLines(source)),
  };
}
