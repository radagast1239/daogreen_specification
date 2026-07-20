/** Manual review marker — matches quality helpers and clientSections. */
export const REVIEW_CLIENT_SECTION = "requires_review";

/** Legacy review state stored in category before 1G.2.1. */
export const LEGACY_REVIEW_CATEGORY = "Требует разбора";

/** Default category when DB/API normalizes empty category (see backend matToParams). */
export const DEFAULT_MATERIAL_CATEGORY = "Прочее";

export function buildBulkPatchPayload(actionType, actionValue, extraValue) {
  switch (actionType) {
    case "responsible":
      return { responsible: actionValue };
    case "supplier":
      return { supplier: actionValue };
    case "clientSection":
      return { clientSection: actionValue, clientSubsection: extraValue || "" };
    case "clientSubsection":
      return { clientSubsection: actionValue };
    case "showClient":
      return { clientVisibleDefault: true };
    case "hideClient":
      return { clientVisibleDefault: false };
    case "setReview":
      return { clientSection: REVIEW_CLIENT_SECTION };
    case "clearReview":
      return { clientSection: "" };
    default:
      return {};
  }
}

/** Per-material review toggle — preserves real category except legacy cleanup. */
export function buildReviewPatchPayload(material, actionType) {
  if (actionType === "setReview") {
    return { clientSection: REVIEW_CLIENT_SECTION };
  }
  if (actionType === "clearReview") {
    const patch = { clientSection: "" };
    if ((material?.category || "").trim() === LEGACY_REVIEW_CATEGORY) {
      patch.category = DEFAULT_MATERIAL_CATEGORY;
    }
    return patch;
  }
  return {};
}

export function resolveBulkPatchPayload(actionType, actionValue, extraValue, material = null) {
  if (actionType === "setReview" || actionType === "clearReview") {
    return buildReviewPatchPayload(material, actionType);
  }
  return buildBulkPatchPayload(actionType, actionValue, extraValue);
}

export function formatBulkActionConfirmation(actionType, actionValue, extraValue, count) {
  let fields = "";
  switch (actionType) {
    case "responsible":
      fields = `Ответственный = ${actionValue || "Общий"}`;
      break;
    case "supplier":
      fields = `Поставщик = ${actionValue || "Очистить"}`;
      break;
    case "clientSection":
      fields = `Раздел клиента = ${actionValue || "Очистить"}${extraValue ? `, Подраздел = ${extraValue}` : ""}`;
      break;
    case "clientSubsection":
      fields = `Подраздел клиента = ${actionValue || "Очистить"}`;
      break;
    case "showClient":
      fields = `Показывать клиенту по умолчанию = Да`;
      break;
    case "hideClient":
      fields = `Показывать клиенту по умолчанию = Нет`;
      break;
    case "setReview":
      fields = `Раздел клиента = На проверке (${REVIEW_CLIENT_SECTION})`;
      break;
    case "clearReview":
      fields = `Снять «На проверке» (очистить clientSection; legacy category «${LEGACY_REVIEW_CATEGORY}» → «${DEFAULT_MATERIAL_CATEGORY}»)`;
      break;
    default:
      fields = "Неизвестное действие";
  }
  return `Будет изменено ${count} выбранных материалов.\nИзменяемые поля: ${fields}\nПродолжить?`;
}
