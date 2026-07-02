import { resolveClientSection } from "../../shared/clientSections.js";
import { defaultResponsible } from "./responsibleDefaults.js";

/**
 * Fallback ответственного по клиентскому разделу закупки → роль специалиста.
 * Используется, когда у позиции и у материала не назначен конкретный ответственный.
 */
export const SECTION_RESPONSIBLE_FALLBACK = {
  // Сантехник
  irrigation: "plumber",
  drainage: "plumber",
  pumps: "plumber",
  tanks: "plumber",
  water_prep: "plumber",
  // Электрик
  electrics: "electrician",
  automation: "electrician",
  lighting: "electrician",
  // Монтажник
  stellage: "installer",
  trays_channels: "installer",
  climate: "installer",
  manipulation: "installer",
  tools: "installer",
  works_delivery: "installer",
};

/**
 * «Конкретно назначенный» ответственный — это не пусто и не «general».
 * «general» (Общее) для целей списков специалистов считаем не назначенным,
 * чтобы срабатывал fallback по разделу (иначе специалистские списки пустые).
 */
export function isConcreteResponsible(r) {
  return !!r && r !== "general";
}

export function fallbackResponsibleBySection(sectionId) {
  return SECTION_RESPONSIBLE_FALLBACK[sectionId] || null;
}

/**
 * Приоритет назначения ответственного:
 *   project_item.responsible → material default → fallback по разделу закупки → default по категории.
 * @param item позиция (project_item или source-item склеенной строки)
 * @param materialDefault responsible из карточки материала (снимок при добавлении в проект)
 */
export function resolveResponsibleFull(item = {}, { materialDefault } = {}) {
  if (isConcreteResponsible(item.responsible)) return item.responsible;
  if (isConcreteResponsible(materialDefault)) return materialDefault;
  const { section } = resolveClientSection(item);
  const bySection = fallbackResponsibleBySection(section);
  if (bySection) return bySection;
  return defaultResponsible(item.category, item);
}

/**
 * Единая фильтрация склеенных строк по роли специалиста — общая для полного PDF,
 * отдельных PDF специалистов и Excel. Строка попадает к роли, если хотя бы один её
 * source-item разрешается в эту роль через resolveResponsibleFull.
 */
export function rowsForResponsibleRole(mergedRows, role) {
  return (mergedRows || []).filter((row) =>
    (row.sourceItems || []).some((it) => resolveResponsibleFull(it) === role)
  );
}

/**
 * Заполнить недостающих ответственных, НЕ перетирая уже назначенных вручную.
 * @param materialsById необязательный map materialId → { responsible } для material default
 * @returns новый массив позиций
 */
export function fillMissingResponsible(items, { materialsById } = {}) {
  return (items || []).map((it) => {
    if (isConcreteResponsible(it.responsible)) return it;
    const materialDefault = materialsById?.[it.materialId ?? it.matId]?.responsible;
    return { ...it, responsible: resolveResponsibleFull(it, { materialDefault }) };
  });
}
