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
      return { category: "Требует разбора", clientSection: "requires_review" };
    case "clearReview":
      return { category: "", clientSection: "" };
    default:
      return {};
  }
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
      fields = `Категория = Требует разбора, Раздел = На проверке`;
      break;
    case "clearReview":
      fields = `Убрать из "На проверке" (очистить раздел)`;
      break;
    default:
      fields = "Неизвестное действие";
  }
  return `Будет изменено ${count} выбранных материалов.\nИзменяемые поля: ${fields}\nПродолжить?`;
}
