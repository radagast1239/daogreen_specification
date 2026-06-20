import { db } from "../db.js";

const DEFAULT_UNITS = ["шт.", "м", "м²", "м³", "кг", "л", "компл.", "уп."];

const DEFAULT_PURCHASE_STATUSES = [
  { id: "not_bought", label: "Не куплено", chip: "neutral", clientVisible: true },
  { id: "searching", label: "В поиске", chip: "brand", clientVisible: true },
  { id: "ordered", label: "Заказано", chip: "brand", clientVisible: true },
  { id: "bought", label: "Куплено", chip: "ok", clientVisible: true },
  { id: "delivered", label: "Доставлено", chip: "ok", clientVisible: true },
  { id: "have", label: "Уже есть", chip: "ok", clientVisible: true },
  { id: "need_help", label: "Нужна помощь", chip: "amber", clientVisible: true },
  { id: "not_fit", label: "Не подходит", chip: "danger", clientVisible: true },
  { id: "replacement_check", label: "Замена на проверке", chip: "amber", clientVisible: true },
];

const DEFAULT_TAGS = [
  "охлаждение", "электрика", "гидропоника", "сантехника", "климат",
  "расходники", "монтаж", "семена", "освещение",
];

const DEFAULT_FARM_TYPES = ["проточка", "подтопление", "аэропоника", "смешанная", "NFT", "микрозелень"];

const DEFAULT_STELLAGE_GROUPS = [
  { id: "karkas", label: "Каркас и крепёж", order: 1 },
  { id: "poliv", label: "Полив стеллажа", order: 2 },
  { id: "drenazh", label: "Дренаж на стеллаже", order: 3 },
  { id: "klimat", label: "Вентиляция", order: 4 },
  { id: "osveshchenie", label: "Освещение", order: 5 },
  { id: "elektrika", label: "Электрика стеллажа", order: 6 },
  { id: "emkosti", label: "Ёмкости и баки", order: 7 },
  { id: "opcii", label: "Опции (не в базовый состав)", order: 8 },
];

function loadSettingsMap() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadReferenceData() {
  const s = loadSettingsMap();
  const tags = parseJson(s.refTags, null);
  const units = parseJson(s.refUnits, null);
  const purchaseStatuses = parseJson(s.refPurchaseStatuses, null);
  const responsibleRoles = parseJson(s.refResponsibleRoles, null);
  const farmTypes = parseJson(s.refFarmTypes, null);
  const stellageGroups = parseJson(s.refStellageGroups, null);

  return {
    tags: Array.isArray(tags) && tags.length ? tags : DEFAULT_TAGS,
    units: Array.isArray(units) && units.length ? units : DEFAULT_UNITS,
    purchaseStatuses:
      Array.isArray(purchaseStatuses) && purchaseStatuses.length
        ? purchaseStatuses
        : DEFAULT_PURCHASE_STATUSES,
    responsibleRoles:
      Array.isArray(responsibleRoles) && responsibleRoles.length
        ? responsibleRoles
        : [
            { id: "plumber", label: "Сантехник" },
            { id: "electrician", label: "Электрик" },
            { id: "installer", label: "Монтажник" },
            { id: "client", label: "Клиент" },
            { id: "purchaser", label: "Закупщик" },
            { id: "consumables", label: "Расходники" },
            { id: "general", label: "Общий" },
          ],
    farmTypes: Array.isArray(farmTypes) && farmTypes.length ? farmTypes : DEFAULT_FARM_TYPES,
    stellageGroups:
      Array.isArray(stellageGroups) && stellageGroups.length
        ? stellageGroups
        : DEFAULT_STELLAGE_GROUPS,
  };
}

export function clientPurchaseStatuses() {
  return loadReferenceData().purchaseStatuses.filter((s) => s.clientVisible !== false);
}
