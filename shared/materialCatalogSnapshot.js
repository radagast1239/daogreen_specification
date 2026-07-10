/** Catalog snapshot policy: copy on add, explicit update only. */

import { REFRESH_FROM_MATERIAL_FIELDS } from "./itemTypes.js";

/** Fields copied from materials catalog into project item snapshot. */
export const CATALOG_SNAPSHOT_FIELD_KEYS = [
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

const FIELD_LABELS = {
  name: "Название",
  unit: "Единица",
  category: "Категория",
  supplier: "Поставщик",
  link: "Ссылка",
  linkAlt: "Альт. ссылка",
  imageUrl: "Фото",
  photoUrl: "Фото",
  price: "Базовая цена",
  vatRate: "НДС",
  clientSection: "Раздел клиента",
  clientSubsection: "Подраздел клиента",
  purchaseKey: "Ключ закупки",
  itemType: "Тип",
  techNote: "Тех. примечание",
  clientNote: "Клиентское примечание",
};

function findMaterial(materials, materialId) {
  const id = String(materialId || "").trim();
  if (!id || !materials?.length) return null;
  return materials.find((m) => (m.id || m.materialId) === id) || null;
}

function snapshotValueFromMaterial(mat, key) {
  if (!mat) return undefined;
  if (key === "price") return Number(mat.basePrice) || 0;
  if (key === "imageUrl" || key === "photoUrl") return mat.imageUrl || mat.photoUrl || "";
  if (key === "clientNote") return mat.clientNote || mat.comment || "";
  if (key === "itemType") return mat.itemType || "material";
  return mat[key];
}

function itemSnapshotValue(item, key) {
  if (key === "photoUrl" && !item.photoUrl && item.imageUrl) return item.imageUrl;
  if (key === "imageUrl" && !item.imageUrl && item.photoUrl) return item.photoUrl;
  return item[key];
}

/**
 * Copy catalog-owned fields from material into line (for new project items).
 * @param {object} line
 * @param {object[]} materials
 */
export function copyCatalogSnapshotFromMaterial(line, materials = []) {
  if (!line) return line;
  const materialId = String(line.materialId || "").trim();
  if (!materialId) return line;
  const mat = findMaterial(materials, materialId);
  if (!mat) return line;

  const img = mat.imageUrl || mat.photoUrl || "";
  const next = {
    ...line,
    materialId: mat.id || materialId,
    name: mat.name,
    unit: mat.unit || line.unit || "шт.",
    category: mat.category || line.category || "Прочее",
    supplier: mat.supplier || "",
    link: mat.link || "",
    linkAlt: mat.linkAlt || "",
    imageUrl: img,
    photoUrl: img,
    price: Number(mat.basePrice) || 0,
    vatRate: [0, 5, 20].includes(Number(mat.vatRate)) ? Number(mat.vatRate) : Number(line.vatRate) || 0,
    clientSection: mat.clientSection || "",
    clientSubsection: mat.clientSubsection || "",
    purchaseKey: mat.purchaseKey || "",
    itemType: mat.itemType || line.itemType || "material",
    techNote: mat.techNote || "",
    clientNote: mat.clientNote || mat.comment || "",
    coolingKw: Number(mat.coolingKw) || 0,
    coolingBtu: Number(mat.coolingBtu) || 0,
    exhaustM3: Number(mat.exhaustM3) || 0,
    catalogSnapshottedAt: line.catalogSnapshottedAt || new Date().toISOString(),
  };
  return next;
}

/**
 * Fill empty legacy catalog fields only — never overwrite existing snapshot.
 * @param {object} line
 * @param {object[]} materials
 */
export function fillEmptyCatalogFieldsFromMaterial(line, materials = []) {
  if (!line) return line;
  const materialId = String(line.materialId || "").trim();
  if (!materialId || !materials?.length) return line;
  const mat = findMaterial(materials, materialId);
  if (!mat) return line;

  const next = { ...line };
  let changed = false;
  for (const key of CATALOG_SNAPSHOT_FIELD_KEYS) {
    const cur = itemSnapshotValue(next, key);
    const empty =
      cur === null ||
      cur === undefined ||
      (typeof cur === "string" && !cur.trim()) ||
      (key === "price" && (Number(cur) || 0) === 0);
    if (empty) {
      const val = snapshotValueFromMaterial(mat, key);
      if (val !== undefined && val !== "") {
        next[key] = val;
        changed = true;
      }
    }
  }
  if (changed && !next.catalogSnapshottedAt) {
    next.catalogSnapshottedAt = new Date().toISOString();
  }
  return next;
}

/**
 * Effective unit price: project actualPrice if set, else snapshot base price.
 * @param {object} item
 */
export function effectiveItemPrice(item) {
  const actual = item?.actualPrice ?? item?.actual_price;
  if (actual != null && actual !== "" && Number.isFinite(Number(actual))) {
    return Number(actual);
  }
  return Number(item?.price) || 0;
}

/**
 * Diff catalog vs project snapshot for one item.
 * @param {object} item
 * @param {object|null} material
 * @param {string[]} [fields]
 */
export function diffItemCatalogSnapshot(item, material, fields = CATALOG_SNAPSHOT_FIELD_KEYS) {
  if (!item?.materialId || !material) return [];
  const diffs = [];
  for (const key of fields) {
    const before = itemSnapshotValue(item, key);
    const after = snapshotValueFromMaterial(material, key);
    const type = key === "price" || key === "vatRate" ? "number" : "string";
    const same =
      type === "number"
        ? (Number(before) || 0) === (Number(after) || 0)
        : String(before ?? "").trim() === String(after ?? "").trim();
    if (!same) {
      diffs.push({
        field: key,
        label: FIELD_LABELS[key] || key,
        before,
        after,
      });
    }
  }
  return diffs;
}

/**
 * @param {object[]} items
 * @param {object[]} materials
 */
export function buildProjectCatalogUpdateDiff(items = [], materials = []) {
  const changes = [];
  for (const item of items) {
    const materialId = String(item.materialId || "").trim();
    if (!materialId) continue;
    const mat = findMaterial(materials, materialId);
    if (!mat) continue;
    const diffs = diffItemCatalogSnapshot(item, mat);
    if (diffs.length) {
      changes.push({
        itemId: item.id,
        materialId,
        name: item.name || mat.name,
        module: item.module || item.section || "",
        diffs,
      });
    }
  }
  return {
    changes,
    changedMaterialCount: new Set(changes.map((c) => c.materialId)).size,
    changedItemCount: changes.length,
  };
}

/**
 * Apply catalog diff to item — preserves project-owned fields and actualPrice.
 * @param {object} item
 * @param {object} material
 * @param {string[]} [fields] — REFRESH_FROM_MATERIAL_FIELDS subset or all snapshot keys
 */
export function applyCatalogDiffToItem(item, material, fields) {
  if (!item || !material) return item;
  const allowed = fields?.length
    ? new Set(fields)
    : new Set([...CATALOG_SNAPSHOT_FIELD_KEYS, ...REFRESH_FROM_MATERIAL_FIELDS]);
  const next = { ...item };
  for (const key of CATALOG_SNAPSHOT_FIELD_KEYS) {
    if (!allowed.has(key)) continue;
    const val = snapshotValueFromMaterial(material, key);
    if (val !== undefined) next[key] = val;
  }
  if (allowed.has("photo")) {
    const img = material.imageUrl || material.photoUrl || "";
    next.imageUrl = img;
    next.photoUrl = img;
  }
  next.catalogSnapshottedAt = new Date().toISOString();
  return next;
}
