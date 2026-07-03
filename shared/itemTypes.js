/** Типы позиций: справочник materials vs строки проекта / шаблонов */

export const MATERIAL_CATALOG_TYPES = ["material", "service", "kit"];

export const PROJECT_LINE_TYPES = [
  "material",
  "service",
  "kit",
  "note",
  "video",
  "internal_note",
  "subtotal",
];

export const PROJECT_LINE_TYPE_LABELS = {
  material: "Материал",
  service: "Услуга",
  kit: "Комплект",
  note: "Заметка",
  video: "Видео",
  internal_note: "Внутр. заметка",
  subtotal: "Подитог",
};

export const REFRESH_FROM_MATERIAL_FIELDS = [
  "price",
  "link",
  "supplier",
  "photo",
  "clientSection",
];

export function resolveItemType(it) {
  return it?.itemType || it?.item_type || "material";
}

export function isPurchasableLineType(type) {
  return MATERIAL_CATALOG_TYPES.includes(type || "material");
}

/** Признак строки-спецификации сплит-систем (расчёт охлаждения по комнате). */
export const COOLING_SPEC_KIND = "cooling_spec";

/**
 * Строка сплит-систем — это отдельная расчётная спецификация, а не обычный
 * материал каталога. К ней нельзя применять требования «фото / материал из базы /
 * цена > 0 / клиентский подраздел». Остаётся видимой клиенту и считается в сумме,
 * если цена заполнена вручную.
 */
export function isCoolingSpecItem(it) {
  if (!it) return false;
  if (it.kind === COOLING_SPEC_KIND) return true;
  if ((it.itemType || it.item_type) === COOLING_SPEC_KIND) return true;
  return Array.isArray(it.splitSpecs) && it.splitSpecs.length > 0;
}

export function isDisplayOnlyLineType(type) {
  return ["note", "video"].includes(type);
}

export function requiresMaterialId(type) {
  return isPurchasableLineType(type);
}

/** Участвует в сумме проекта */
export function lineContributesToSum(it) {
  const t = resolveItemType(it);
  if (t === "subtotal" || isDisplayOnlyLineType(t) || t === "internal_note") return false;
  if (it.includedInProject === false) return false;
  if (it.includedInProject == null && it.enabled === false) return false;
  return isPurchasableLineType(t);
}

/** Показывается клиенту (закупка / экспорт) */
export function lineVisibleToClient(it) {
  const t = resolveItemType(it);
  if (t === "internal_note") return false;

  const included =
    it.includedInProject != null ? it.includedInProject !== false : it.enabled !== false;
  if (!included) return false;

  if (it.visibleToClient != null) return !!it.visibleToClient;
  return true;
}

/** Синхронизация legacy-полей visible / approved / enabled */
export function normalizeItemFlags(it) {
  const includedInProject =
    it.includedInProject != null ? !!it.includedInProject : it.enabled !== false;
  const visibleToClient =
    it.visibleToClient != null ? !!it.visibleToClient : includedInProject;
  return {
    ...it,
    includedInProject,
    visibleToClient,
    enabled: includedInProject,
    visible: visibleToClient,
    approved: visibleToClient,
  };
}

export function itemFlagsToDb(it) {
  const { includedInProject, visibleToClient } = normalizeItemFlags(it);
  return {
    included_in_project: includedInProject ? 1 : 0,
    visible_to_client: visibleToClient ? 1 : 0,
    enabled: includedInProject ? 1 : 0,
    visible: visibleToClient ? 1 : 0,
    approved: visibleToClient ? 1 : 0,
  };
}
