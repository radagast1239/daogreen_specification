export const PURCHASE_PRIORITIES = [
  { id: "urgent", label: "Срочно", today: true },
  { id: "before_install", label: "До монтажа", today: true },
  { id: "before_launch", label: "До запуска", today: false },
  { id: "later", label: "Позже", today: false },
  { id: "optional", label: "Опционально", today: false },
];

export const TODAY_PRIORITY_IDS = new Set(
  PURCHASE_PRIORITIES.filter((p) => p.today).map((p) => p.id)
);

export function purchasePriorityLabel(id) {
  return PURCHASE_PRIORITIES.find((p) => p.id === id)?.label || id || "—";
}

export function isTodayPriority(id) {
  return TODAY_PRIORITY_IDS.has(id);
}
