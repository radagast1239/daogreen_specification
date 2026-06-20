// Модули фермы. type: stellage | general. У стеллажных модулей количество масштабирует кол-во материалов.
export const seedModules = [
  { id: "mod_protochka", name: "Стеллаж проточка", type: "stellage", tech: "проточка" },
  { id: "mod_podtoplenie", name: "Стеллаж подтопление", type: "stellage", tech: "подтопление" },
  { id: "mod_aeroponika", name: "Стеллаж аэропоника", type: "stellage", tech: "аэропоника" },
  { id: "mod_strawberry", name: "Стеллаж клубника", type: "stellage", tech: "клубника" },
  { id: "mod_seedling", name: "Рассадное отделение подтопление", type: "stellage", tech: "подтопление" },
  { id: "mod_obshchaya", name: "Общая закупка на ферму", type: "general", tech: "—" },
  // Заготовки под расширение (материалов пока нет в сиде — добавишь в базе):
  { id: "mod_klimat", name: "Климат и вентиляция", type: "general", tech: "—" },
  { id: "mod_elektrika", name: "Электрика", type: "general", tech: "—" },
  { id: "mod_vodopodgotovka", name: "Водоподготовка", type: "general", tech: "—" },
  { id: "mod_raskhodniki", name: "Расходники", type: "general", tech: "—" },
  { id: "mod_raboty", name: "Монтажные работы и запуск", type: "general", tech: "—" },
];

// Статусы закупки (клиент)
export const PURCHASE_STATUSES = [
  { id: "not_bought", label: "Не куплено", chip: "neutral" },
  { id: "searching", label: "В поиске", chip: "brand" },
  { id: "ordered", label: "Заказано", chip: "brand" },
  { id: "bought", label: "Куплено", chip: "ok" },
  { id: "delivered", label: "Доставлено", chip: "ok" },
  { id: "have", label: "Уже есть", chip: "ok" },
  { id: "need_help", label: "Нужна помощь", chip: "amber" },
  { id: "not_fit", label: "Не подходит", chip: "danger" },
  { id: "replacement_check", label: "Замена на проверке", chip: "amber" },
];

// Какие статусы считаем "закрытыми" (учитываются в потрачено / прогрессе)
export const DONE_STATUSES = ["bought", "delivered", "have"];

export const CATEGORIES = [
  "Каркас и крепёж",
  "Полив и сантехника",
  "Электрика и свет",
  "Климат и вентиляция",
  "Расходники",
  "Работы и доставка",
  "Прочее",
];

// Списки для специалистов: категория -> исполнитель
export const SPECIALIST_MAP = {
  "Полив и сантехника": "Сантехник",
  "Электрика и свет": "Электрик",
  "Каркас и крепёж": "Монтажник",
  "Климат и вентиляция": "Монтажник",
  "Расходники": "Клиент",
  "Работы и доставка": "Клиент",
  "Прочее": "Клиент",
};

export const FARM_TYPES = ["проточка", "подтопление", "аэропоника", "смешанная"];
