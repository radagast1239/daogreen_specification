/**
 * Вертикальная панель категорий (этап 1 — иконки и привязка к листам).
 */
export const CATEGORIES = [
  { id: "walls",      sheetId: "base_plan",  icon: "walls",      label: "Стены / исходный план" },
  { id: "openings",   sheetId: "base_plan",  icon: "openings",   label: "Окна и двери" },
  { id: "parts",      sheetId: "partitions", icon: "parts",      label: "Перегородки" },
  { id: "zones",      sheetId: "farm_zones", icon: "zones",      label: "Помещения / зоны" },
  { id: "racks",      sheetId: "racks",      icon: "racks",      label: "Стеллажи" },
  { id: "furn",       sheetId: "equipment",  icon: "furn",       label: "Мебель / рабочие зоны" },
  { id: "plumb",      sheetId: "plumbing",   icon: "plumb",      label: "Сантехника" },
  { id: "water",      sheetId: "irrigation", icon: "water",      label: "Вода и полив" },
  { id: "drain",      sheetId: "drainage",   icon: "drain",      label: "Дренаж" },
  { id: "power",      sheetId: "electrical", icon: "power",      label: "Электрика" },
  { id: "light",      sheetId: "lighting",   icon: "light",      label: "Освещение" },
  { id: "climate",    sheetId: "climate",    icon: "climate",    label: "Климат и кондиционирование" },
  { id: "vent",       sheetId: "ventilation", icon: "vent",      label: "Вентиляция" },
  { id: "hygiene",    sheetId: "safety",     icon: "hygiene",    label: "Санитария" },
  { id: "routes",     sheetId: "safety",     icon: "routes",     label: "Персонал / маршруты" },
  { id: "safety",     sheetId: "safety",     icon: "safety",     label: "Безопасность" },
  { id: "comments",   sheetId: "base_plan",  icon: "comments",   label: "Комментарии" },
  { id: "search",     sheetId: "base_plan",  icon: "search",     label: "Поиск" },
];

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id);
