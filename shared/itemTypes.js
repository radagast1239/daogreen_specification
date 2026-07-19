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
  "name",
  "price",
  "link",
  "supplier",
  "photo",
  "clientSection",
];

/** Catalog supplier wins; the project value remains an orphan/manual fallback. */
export function resolveEffectiveSupplier(item, material = null) {
  if (item?.materialId && material) return material.supplier || "";
  return item?.supplier || "";
}

export function reconcileItemCatalogFields(item, material = null) {
  return { ...item, supplier: resolveEffectiveSupplier(item, material) };
}

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
  // Явные маркеры (новые строки).
  if (it.kind === COOLING_SPEC_KIND) return true;
  if ((it.itemType || it.item_type) === COOLING_SPEC_KIND) return true;
  const src = it.source || it.origin || it.type;
  if (src === "room-ac" || src === "room_ac" || src === "cooling-spec") return true;
  // Структурный признак: наличие спецификации сплит-систем (переживает загрузку из БД).
  if (Array.isArray(it.splitSpecs) && it.splitSpecs.length > 0) return true;
  // Legacy-строки без маркера: имя сплит-системы + привязка к комнате/AC-строке
  // (не матчим обычный каталожный «кондиционер» без признаков room/ac/split).
  const isSplitName = /сплит/i.test(it.name || it.title || "");
  if (isSplitName && (it.roomId || it.room_id || it.acUnitId || it.acItemId)) return true;
  return false;
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

function itemIncludedInProject(it) {
  return it.includedInProject != null ? it.includedInProject !== false : it.enabled !== false;
}

function materialDefaultHidden(material) {
  if (!material) return false;
  if (material.clientVisibleDefault === false) return true;
  if (material.visibleToClient === false) return true;
  if (material.showToClient === false) return true;
  return false;
}

function legacyItemClientVisible(it) {
  if (it.showToClient != null) return !!it.showToClient;
  if (it.clientVisible != null) return !!it.clientVisible;
  if (it.visible != null) return !!it.visible;
  if (it.approved != null) return !!it.approved;
  return null;
}

/**
 * Item-level override > legacy visible/approved > material default.
 * @param {object|null|undefined} material
 */
export function resolveItemClientVisibility(it, material = null) {
  if (!it) return false;
  const t = resolveItemType(it);
  if (t === "internal_note") return false;
  if (!itemIncludedInProject(it)) return false;

  if (it.visibleToClient === true) return true;
  if (it.visibleToClient === false) {
    // Explicit hide payload (showToClient/clientVisible/visible/approved all false)
    // must win over a single stale legacy flag after PATCH.
    if (it.showToClient === false || it.clientVisible === false) return false;
    if (it.visible === false && it.approved === false) return false;
    // Legacy stale row: visible_to_client=false but visible/approved still true → show.
    const legacy = legacyItemClientVisible(it);
    if (legacy === true) return true;
    return false;
  }

  const legacy = legacyItemClientVisible(it);
  if (legacy != null) return legacy;

  if (materialDefaultHidden(material)) return false;
  return true;
}

/** Показывается клиенту (закупка / экспорт) */
export function lineVisibleToClient(it, material = null) {
  return resolveItemClientVisibility(it, material);
}

/** Синхронизировать visible / approved / visibleToClient после resolve. */
export function reconcileItemClientVisibilityFlags(it, material = null) {
  const visibleToClient = resolveItemClientVisibility(it, material);
  return {
    ...it,
    visibleToClient,
    visible: visibleToClient,
    approved: visibleToClient,
  };
}

/** @param {object[]} items @param {object[]} [materials] */
export function reconcileProjectItemsVisibility(project, materials = []) {
  if (!project?.items?.length) return project;
  const matById = new Map((materials || []).map((m) => [m.id, m]));
  return {
    ...project,
    items: project.items.map((it) =>
      reconcileItemClientVisibilityFlags(
        it,
        it.materialId ? matById.get(it.materialId) : null
      )
    ),
  };
}

/** Синхронизация legacy-полей visible / approved / enabled */
export function normalizeItemFlags(it, material = null) {
  const includedInProject =
    it.includedInProject != null ? !!it.includedInProject : it.enabled !== false;
  return reconcileItemClientVisibilityFlags(
    { ...it, includedInProject, enabled: includedInProject },
    material
  );
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

/** Единый payload show/hide для bulk actions и fallback PATCH. */
export function buildClientVisibilityPatch(visible) {
  if (visible) {
    return {
      visibleToClient: true,
      visible: true,
      approved: true,
      showToClient: true,
      clientVisible: true,
    };
  }
  return {
    visibleToClient: false,
    visible: false,
    approved: false,
    showToClient: false,
    clientVisible: false,
  };
}

/** Принудительно применить show/hide без legacy override после reload. */
export function applyClientVisibilityPatch(item, patch = {}) {
  if (patch.visibleToClient === true) {
    return { ...item, ...buildClientVisibilityPatch(true) };
  }
  if (patch.visibleToClient === false) {
    return { ...item, ...buildClientVisibilityPatch(false) };
  }
  return reconcileItemClientVisibilityFlags({ ...item, ...patch });
}
