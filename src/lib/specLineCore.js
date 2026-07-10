import { uid } from "./ids.js";
import { FRAME_BOM_SOURCE, isFrameBomLine } from "../../shared/frameBomProjectItems.js";
import {
  copyCatalogSnapshotFromMaterial,
  fillEmptyCatalogFieldsFromMaterial,
} from "../../shared/materialCatalogSnapshot.js";
import { normalizeStoredCatalogLine } from "../../shared/catalogLine.js";
import { mergeLineSpecOverrides } from "../../shared/lineSpecOverrides.js";
import { materialCompositionGroup } from "../../shared/stellageComposition.js";
import { resolvePipeCuts, normalizePipeCuts } from "../../shared/profilePipeCuts.js";
import { resolveBreakerSpecs, normalizeBreakerSpecs } from "../../shared/breakerSpecs.js";
import { resolveFlowSpecs, normalizeFlowSpecs } from "../../shared/flowSpecs.js";
import { resolveSplitSpecs, normalizeSplitSpecs } from "../../shared/splitSpecs.js";
import { resolveItemType } from "../../shared/itemTypes.js";

/** Поля материала, которые всегда берутся из базы при materialId */
export const MATERIAL_CATALOG_FIELD_KEYS = [
  "name",
  "unit",
  "category",
  "supplier",
  "link",
  "linkAlt",
  "imageUrl",
  "photoUrl",
  "price",
  "vatRate",
  "clientSection",
  "clientSubsection",
  "purchaseKey",
  "itemType",
  "techNote",
  "clientNote",
  "coolingKw",
  "coolingBtu",
  "exhaustM3",
];

/** @deprecated use MATERIAL_CATALOG_FIELD_KEYS — kept for fill-if-empty merge in lineFromMaterial */
const MATERIAL_SYNC_KEYS = MATERIAL_CATALOG_FIELD_KEYS;

function isEmptyCatalogOverride(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function mergeMaterialWithCatalogOverrides(fromMat, overrides) {
  const merged = { ...fromMat, ...overrides };
  for (const k of MATERIAL_SYNC_KEYS) {
    if (k in overrides && isEmptyCatalogOverride(overrides[k]) && !isEmptyCatalogOverride(fromMat[k])) {
      merged[k] = fromMat[k];
    }
  }
  return merged;
}

export function blankLine(overrides = {}) {
  return {
    id: uid("ln"),
    materialId: null,
    name: "",
    unit: "шт.",
    category: "Прочее",
    subcategory: "",
    supplier: "",
    link: "",
    linkAlt: "",
    imageUrl: "",
    photoUrl: "",
    qty: 1,
    price: 0,
    vatRate: 0,
    techNote: "",
    clientNote: "",
    pipeCuts: [],
    breakerSpecs: [],
    flowSpecs: [],
    splitSpecs: [],
    coolingKw: 0,
    coolingBtu: 0,
    exhaustM3: 0,
    roomId: "",
    included: true,
    itemType: "material",
    clientSection: "",
    clientSubsection: "",
    includedInProject: true,
    visibleToClient: true,
    ...overrides,
  };
}

export function lineFromMaterial(mat, overrides = {}) {
  const img = mat.imageUrl || mat.photoUrl || "";
  const qty = overrides.qty ?? 0;
  const fromMat = {
    materialId: mat.id,
    name: mat.name,
    unit: mat.unit,
    category: mat.category,
    subcategory: mat.subcategory || materialCompositionGroup(mat),
    farmGroup: overrides.farmGroup || overrides.subcategory || "",
    supplier: mat.supplier || "",
    link: mat.link || "",
    linkAlt: mat.linkAlt || "",
    imageUrl: img,
    photoUrl: img,
    qty,
    price: Number(mat.basePrice) || 0,
    vatRate: [0, 5, 20].includes(Number(mat.vatRate)) ? Number(mat.vatRate) : 0,
    techNote: mat.techNote || "",
    clientNote: mat.clientNote || mat.comment || "",
    pipeCuts: resolvePipeCuts(mat),
    breakerSpecs: resolveBreakerSpecs(mat),
    flowSpecs: resolveFlowSpecs(mat),
    splitSpecs: resolveSplitSpecs(mat),
    clientSection: mat.clientSection || "",
    clientSubsection: mat.clientSubsection || "",
    purchaseKey: mat.purchaseKey || "",
    itemType: resolveItemType({ itemType: mat.itemType }),
    visibleToClient: mat.clientVisibleDefault !== false,
    coolingKw: Number(mat.coolingKw) || 0,
    coolingBtu: Number(mat.coolingBtu) || 0,
    exhaustM3: Number(mat.exhaustM3) || 0,
  };
  return blankLine(mergeMaterialWithCatalogOverrides(fromMat, overrides));
}

/**
 * Подтянуть каталожные поля без перезаписи существующего snapshot.
 * Для явного обновления из базы используйте refreshItemFromMaterial / applyCatalogDiffToItem.
 * @param {object} [options]
 * @param {boolean} [options.force] — перезаписать все catalog-owned поля (legacy / explicit refresh)
 * @param {boolean} [options.isNewLine] — новая строка: полный snapshot из каталога
 */
export function applyMaterialCatalogFields(line, materials = [], options = {}) {
  if (!line) return line;
  const { force = false, isNewLine = false } = options;
  if (force || isNewLine) {
    const snapshotted = copyCatalogSnapshotFromMaterial(line, materials);
    if (!String(snapshotted.subcategory || snapshotted.farmGroup || "").trim()) {
      const mat = materials.find((m) => (m.id || m.materialId) === line.materialId);
      if (mat) snapshotted.subcategory = mat.subcategory || materialCompositionGroup(mat) || "";
    }
    if (!Array.isArray(snapshotted.pipeCuts) || !snapshotted.pipeCuts.length) {
      const mat = materials.find((m) => (m.id || m.materialId) === line.materialId);
      if (mat) snapshotted.pipeCuts = resolvePipeCuts(mat);
    }
    if (!Array.isArray(snapshotted.breakerSpecs) || !snapshotted.breakerSpecs.length) {
      const mat = materials.find((m) => (m.id || m.materialId) === line.materialId);
      if (mat) snapshotted.breakerSpecs = resolveBreakerSpecs(mat);
    }
    if (!Array.isArray(snapshotted.flowSpecs) || !snapshotted.flowSpecs.length) {
      const mat = materials.find((m) => (m.id || m.materialId) === line.materialId);
      if (mat) snapshotted.flowSpecs = resolveFlowSpecs(mat);
    }
    if (!Array.isArray(snapshotted.splitSpecs) || !snapshotted.splitSpecs.length) {
      const mat = materials.find((m) => (m.id || m.materialId) === line.materialId);
      if (mat) snapshotted.splitSpecs = resolveSplitSpecs(mat);
    }
    return snapshotted;
  }
  return fillEmptyCatalogFieldsFromMaterial(line, materials);
}

/** Строка каталога/пресета → полная строка редактора (данные только из базы материалов) */
export function hydrateCatalogEditorLine(ln, materials) {
  if (!ln) return blankLine();
  const stored = normalizeStoredCatalogLine(ln);
  const qty = isFrameBomLine(ln)
    ? Number(ln.qty ?? stored.qty ?? stored.defaultQty) || 0
    : Number(stored.defaultQty ?? ln.qty) || 0;
  const sub = stored.subcategory || ln.farmGroup || ln.subcategory || "";
  const included = ln.included !== false;

  if (stored.materialId) {
    const mat = materials.find((m) => m.id === stored.materialId);
    if (!mat) {
      return blankLine({
        materialId: stored.materialId,
        id: ln.id,
        qty,
        defaultQty: qty,
        subcategory: sub,
        farmGroup: sub,
        included,
      });
    }
    return mergeLineSpecOverrides(
      {
        ...lineFromMaterial(mat, {
          included,
          qty,
          defaultQty: qty,
          subcategory: sub,
          farmGroup: sub,
        }),
        id: ln.id || uid("ln"),
      },
      ln
    );
  }

  return blankLine({
    id: ln.id,
    name: stored.name || "",
    unit: stored.unit || "шт.",
    category: stored.category || "Прочее",
    qty,
    defaultQty: qty,
    subcategory: sub,
    farmGroup: sub,
    included,
  });
}

export function hydrateCatalogEditorLines(lines, materials) {
  return (lines || []).map((ln) => hydrateCatalogEditorLine(ln, materials));
}
