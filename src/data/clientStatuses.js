/** Статусы клиента / проекта в разделе «Клиенты» */
export const CLIENT_STATUSES = [
  { id: "new", label: "Новый", chip: "neutral" },
  { id: "in_work", label: "В работе", chip: "brand" },
  { id: "spec", label: "Спецификация", chip: "brand" },
  { id: "approval", label: "Согласование", chip: "amber" },
  { id: "buying", label: "Закупка", chip: "amber" },
  { id: "bought", label: "Куплено", chip: "ok" },
  { id: "assembly", label: "Сборка", chip: "brand" },
  { id: "installed", label: "Смонтировано", chip: "ok" },
  { id: "launched", label: "Запущено", chip: "ok" },
  { id: "done", label: "Готово", chip: "ok" },
  { id: "paused", label: "На паузе", chip: "neutral" },
  { id: "lost", label: "Отказ", chip: "danger" },
];

export function clientStatusMeta(id) {
  return CLIENT_STATUSES.find((s) => s.id === id) || CLIENT_STATUSES[0];
}
