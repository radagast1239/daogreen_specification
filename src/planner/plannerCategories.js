/**
 * Вертикальная панель категорий (этап 1 — иконки и привязка к листам).
 */
export const CATEGORIES = [
  { id: "walls",      sheetId: "source",     icon: "walls",      label: "Стены / исходный план" },
  { id: "openings",   sheetId: "source",     icon: "openings",   label: "Окна и двери" },
  { id: "parts",      sheetId: "partitions", icon: "parts",      label: "Перегородки" },
  { id: "zones",      sheetId: "zones",      icon: "zones",      label: "Помещения / зоны" },
  { id: "racks",      sheetId: "racks",      icon: "racks",      label: "Стеллажи" },
  { id: "furn",       sheetId: "furn",       icon: "furn",       label: "Мебель / рабочие зоны" },
  { id: "plumb",      sheetId: "sanitary",   icon: "plumb",      label: "Сантехника" },
  { id: "water",      sheetId: "water",      icon: "water",      label: "Водоснабжение" },
  { id: "drain",      sheetId: "drain",      icon: "drain",      label: "Дренаж" },
  { id: "power",      sheetId: "wiring",     icon: "power",      label: "Электрика" },
  { id: "light",      sheetId: "light",      icon: "light",      label: "Освещение" },
  { id: "climate",    sheetId: "climate",    icon: "climate",    label: "Климат" },
  { id: "ac",         sheetId: "ac",         icon: "ac",         label: "Кондиционеры" },
  { id: "vent",       sheetId: "vent",       icon: "vent",       label: "Вентиляция" },
  { id: "cold",       sheetId: "climate",    icon: "cold",       label: "Холодильное оборудование" },
  { id: "hygiene",    sheetId: "hygiene",    icon: "hygiene",    label: "Санитария" },
  { id: "routes",     sheetId: "routes",     icon: "routes",     label: "Персонал / маршруты" },
  { id: "safety",     sheetId: "safety",     icon: "safety",     label: "Безопасность" },
  { id: "comments",   sheetId: "source",     icon: "comments",   label: "Комментарии" },
  { id: "search",     sheetId: "source",     icon: "search",     label: "Поиск" },
];

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id);
