/** Клиентские разделы закупки (отдельно от внутренних category в базе) */

export const CLIENT_SECTIONS = [
  { id: "stellage", label: "Стеллажи и каркас" },
  { id: "irrigation", label: "Полив" },
  { id: "drainage", label: "Дренаж и слив" },
  { id: "tanks", label: "Ёмкости и баки" },
  { id: "electrics", label: "Электрика" },
  { id: "lighting", label: "Освещение" },
  { id: "climate", label: "Климат и вентиляция" },
  { id: "water_prep", label: "Водоподготовка" },
  { id: "automation", label: "Автоматика и датчики" },
  { id: "consumables", label: "Расходники и запуск" },
  { id: "works", label: "Работы и доставка" },
];

export const CLIENT_SECTION_LABEL = Object.fromEntries(CLIENT_SECTIONS.map((s) => [s.id, s.label]));

const CATEGORY_MAP = {
  "Каркас и крепёж": { section: "stellage", subsection: "Каркас" },
  "Полив и сантехника": { section: "irrigation", subsection: "" },
  "Электрика и свет": { section: "electrics", subsection: "" },
  "Климат и вентиляция": { section: "climate", subsection: "" },
  Расходники: { section: "consumables", subsection: "" },
  "Работы и доставка": { section: "works", subsection: "" },
  Прочее: { section: "", subsection: "" },
};

function inferFromName(name = "") {
  const n = String(name).toLowerCase().replace(/ё/g, "е");
  if (/краб|профил|каркас|креп|болт|гайк|шайб|покрас|стойк|полк|лоток|канал|кассет|поддон/.test(n)) {
    return { section: "stellage", subsection: "Каркас" };
  }
  if (/насос|полив|капель|форсунк|коллектор|кран|фитинг|магистрал/.test(n) && !/дренаж|слив|канализ/.test(n)) {
    return { section: "irrigation", subsection: "" };
  }
  if (/дренаж|слив|канализ|заглушк/.test(n)) return { section: "drainage", subsection: "" };
  if (/бак|бочк|ёмк|емк|уровнемер/.test(n)) return { section: "tanks", subsection: "" };
  if (/светиль|освещ|блок питан|подвес/.test(n)) return { section: "lighting", subsection: "" };
  if (/кабель|автомат|узо|розетк|щит|клемм|канал|вилк|реле/.test(n)) return { section: "electrics", subsection: "" };
  if (/кондицион|вытяж|вентиля|воздуховод|увлажн|осуш/.test(n)) return { section: "climate", subsection: "" };
  if (/осмос|фильтр|картридж|солемер|ph|ec/.test(n)) return { section: "water_prep", subsection: "" };
  if (/контроллер|таймер|датчик/.test(n)) return { section: "automation", subsection: "" };
  if (/семен|субстрат|удобр|перчатк|этикетк|моющ/.test(n)) return { section: "consumables", subsection: "" };
  if (/монтаж|доставк|пуск|услуг/.test(n)) return { section: "works", subsection: "" };
  return { section: "", subsection: "" };
}

/** Подсказка раздела при выборе внутренней категории */
export function suggestClientSectionFromCategory(category) {
  const mapped = CATEGORY_MAP[(category || "").trim()];
  return mapped?.section || "";
}

export function suggestClientSubsectionFromCategory(category) {
  const mapped = CATEGORY_MAP[(category || "").trim()];
  return mapped?.subsection || "";
}

const BROAD_CATEGORIES = new Set(["Полив и сантехника", "Электрика и свет", "Прочее"]);

export function resolveClientSection(item) {
  const explicit = (item?.clientSection || "").trim();
  if (explicit) {
    return {
      section: explicit,
      subsection: (item?.clientSubsection || "").trim(),
      label: CLIENT_SECTION_LABEL[explicit] || explicit,
    };
  }

  const cat = (item?.category || "").trim();

  if (BROAD_CATEGORIES.has(cat)) {
    const inferred = inferFromName(item?.name);
    if (inferred.section) {
      return { ...inferred, label: CLIENT_SECTION_LABEL[inferred.section] || inferred.section };
    }
  }

  const mapped = CATEGORY_MAP[cat];
  if (mapped?.section) {
    return { ...mapped, label: CLIENT_SECTION_LABEL[mapped.section] || mapped.section };
  }

  const inferred = inferFromName(item?.name);
  if (inferred.section) {
    return { ...inferred, label: CLIENT_SECTION_LABEL[inferred.section] || inferred.section };
  }

  return { section: "", subsection: "", label: cat || "Без категории" };
}

export function clientSectionLabel(item) {
  return resolveClientSection(item).label;
}

export function groupByClientSection(items) {
  const map = new Map();
  for (const it of items || []) {
    const { section, label } = resolveClientSection(it);
    const key = section || "__misc__";
    const title = section ? label : "Уточнить категорию";
    if (!map.has(key)) map.set(key, { title, items: [] });
    map.get(key).items.push(it);
  }
  const order = [...CLIENT_SECTIONS.map((s) => s.id), "__misc__"];
  return [...map.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([, v]) => [v.title, v.items]);
}

export function isMiscCategory(item) {
  const cat = (item?.category || "").trim();
  const { section } = resolveClientSection(item);
  return cat === "Прочее" && !section;
}
