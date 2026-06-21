/** Клиентские разделы закупки (отдельно от внутренних category в базе) */

export const DEFAULT_CLIENT_SECTIONS = [
  {
    id: "stellage",
    label: "Стеллажи и каркас",
    order: 1,
    subsections: [
      "Каркас и профиль",
      "Крепёж",
      "Краб-система / соединители",
      "Покраска / обработка",
      "Опоры / стойки",
    ],
  },
  {
    id: "trays_channels",
    label: "Лотки, поддоны и каналы",
    order: 2,
    subsections: [
      "Гидропонные поддоны",
      "NFT-каналы",
      "Кассеты",
      "Крышки / вставки",
      "Сливные элементы поддонов",
    ],
  },
  {
    id: "irrigation",
    label: "Полив — подача раствора",
    order: 3,
    subsections: [
      "Магистраль подачи",
      "Фитинги подачи",
      "Краны и клапаны",
      "Коллекторы / распределение",
      "Шланги / трубки подачи",
      "Форсунки / дождеватели",
    ],
  },
  {
    id: "drainage",
    label: "Дренаж и слив",
    order: 4,
    subsections: [
      "Магистраль слива",
      "Канализационные трубы и фитинги",
      "Сливные клапаны",
      "Гибкие сливные соединения",
      "Заглушки / муфты / тройники слива",
    ],
  },
  {
    id: "pumps",
    label: "Насосы",
    order: 5,
    subsections: ["Насосы подачи", "Насосы дренажа", "Обвязка насосов", "Обратные клапаны"],
  },
  {
    id: "tanks",
    label: "Ёмкости и баки",
    order: 6,
    subsections: [
      "Баки раствора / накопительные ёмкости",
      "Бак чистой воды",
      "Малые технические ёмкости",
      "Врезки и штуцеры для баков",
      "Аксессуары ёмкостей",
    ],
  },
  {
    id: "water_prep",
    label: "Водоподготовка",
    order: 7,
    subsections: [
      "Фильтрация / осмос",
      "Растворный узел",
      "pH / EC / TDS контроль",
      "pH-коррекция и химия",
      "Канистры и тара для растворов",
    ],
  },
  {
    id: "lighting",
    label: "Освещение",
    order: 8,
    subsections: [
      "Светильники",
      "Проводка света",
      "Блоки питания / драйверы",
      "Крепления и подвесы света",
      "Управление освещением",
    ],
  },
  {
    id: "electrics",
    label: "Электрика и щит",
    order: 9,
    subsections: [
      "Электрощит",
      "Автоматы и защита",
      "Кабель и провод",
      "Розетки / вилки / клеммы",
      "Кабель-каналы и гофра",
    ],
  },
  {
    id: "automation",
    label: "Автоматика и датчики",
    order: 10,
    subsections: [
      "Датчики уровня воды",
      "Датчики микроклимата",
      "Таймеры и реле",
      "Электромагнитные клапаны",
      "Контроллеры",
      "Блоки питания автоматики",
    ],
  },
  {
    id: "climate",
    label: "Климат и вентиляция",
    order: 11,
    subsections: [
      "Кондиционирование / охлаждение",
      "Вентиляция / вытяжка",
      "Воздуховоды и соединители",
      "Обдув",
      "Увлажнение / осушение",
      "Скотч / герметизация воздуховодов",
    ],
  },
  {
    id: "manipulation",
    label: "Манипуляционная зона",
    order: 12,
    subsections: ["Столы и мойки", "Санитарная зона", "Инвентарь манипуляционной зоны"],
  },
  {
    id: "consumables",
    label: "Расходники и запуск",
    order: 13,
    subsections: [
      "Семена",
      "Удобрения",
      "Субстрат",
      "Санитария и дезинфекция",
      "Средства защиты",
      "Первый запуск",
      "Упаковка и маркировка",
    ],
  },
  {
    id: "tools",
    label: "Инструмент и инвентарь",
    order: 14,
    subsections: [
      "Ручной инструмент",
      "Измерительный инвентарь",
      "Ёмкости / ведра / мерная тара",
      "Уборочный инвентарь",
      "Средства контроля",
      "Складской инвентарь",
    ],
  },
  {
    id: "works_delivery",
    label: "Работы, услуги и доставка",
    order: 15,
    subsections: [
      "Доставка",
      "Монтажные работы",
      "Сантехнические работы",
      "Электромонтаж",
      "Пусконаладка / запуск",
      "Обучение / сопровождение",
    ],
  },
  /** Старый код — скрыт, миграция через normalizeClientSectionCode */
  {
    id: "works",
    label: "Работы и доставка (архив)",
    order: 99,
    subsections: [],
    hidden: true,
  },
];

/** @deprecated используйте getClientSections() */
export const CLIENT_SECTIONS = DEFAULT_CLIENT_SECTIONS;

const SECTION_LABEL_TO_ID = Object.fromEntries(
  DEFAULT_CLIENT_SECTIONS.flatMap((s) => [
    [s.label.toLowerCase().replace(/ё/g, "е"), s.id],
    [s.id, s.id],
  ])
);

SECTION_LABEL_TO_ID["полив"] = "irrigation";
SECTION_LABEL_TO_ID["полив и сантехника"] = "irrigation";
SECTION_LABEL_TO_ID["электрика"] = "electrics";
SECTION_LABEL_TO_ID["электрика и свет"] = "electrics";
SECTION_LABEL_TO_ID["работы и доставка"] = "works_delivery";
SECTION_LABEL_TO_ID["работы, услуги и доставка"] = "works_delivery";
SECTION_LABEL_TO_ID["расходники"] = "consumables";
SECTION_LABEL_TO_ID["расходники запуска"] = "consumables";
SECTION_LABEL_TO_ID["каркас и крепёж"] = "stellage";
SECTION_LABEL_TO_ID["крепёж и соединители"] = "stellage";
SECTION_LABEL_TO_ID["склад и хранение"] = "tools";
SECTION_LABEL_TO_ID["упаковка"] = "consumables";
SECTION_LABEL_TO_ID["инструмент"] = "tools";

const LEGACY_SECTION_CODES = {
  works: "works_delivery",
  работы_услуги_и_доставка: "works_delivery",
  работы_и_доставка: "works_delivery",
};

export function normalizeClientSectionCode(value, { category = "" } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (LEGACY_SECTION_CODES[raw]) {
    if (raw === "works" && /инструмент|инвентар|склад/i.test(category)) return "tools";
    return LEGACY_SECTION_CODES[raw];
  }

  if (/^[a-z][a-z0-9_]*$/.test(raw)) return raw;

  const key = raw.toLowerCase().replace(/ё/g, "е");
  return SECTION_LABEL_TO_ID[key] || raw;
}

function normalizeSection(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const id = normalizeClientSectionCode(raw.id || "");
  const label = String(raw.label || "").trim();
  if (!id || !label) return null;
  const subsections = Array.isArray(raw.subsections)
    ? [...new Set(raw.subsections.map((s) => String(s).trim()).filter(Boolean))]
    : [];
  return {
    id,
    label,
    subsections,
    hidden: raw.hidden === true,
    order: Number.isFinite(raw.order) ? raw.order : index,
  };
}

export function parseClientSectionsJson(raw) {
  try {
    const list = raw ? JSON.parse(raw) : null;
    if (Array.isArray(list) && list.length) {
      const out = list.map((item, i) => normalizeSection(item, i)).filter(Boolean);
      if (out.length) {
        return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CLIENT_SECTIONS.map((s, i) => ({ ...s, hidden: s.hidden ?? false, order: s.order ?? i }));
}

export function slugClientSectionId(label, existingIds = new Set()) {
  const base =
    String(label || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-z0-9а-я]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 28) || "section";
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}_${n++}`;
  }
  return id;
}

function createRuntime(sections) {
  const list = (sections || DEFAULT_CLIENT_SECTIONS).map((s, i) => ({
    ...s,
    order: s.order ?? i,
  }));
  const labelMap = Object.fromEntries(list.map((s) => [s.id, s.label]));
  const order = [...list.filter((s) => !s.hidden).map((s) => s.id), "__misc__"];

  function resolveClientSection(item) {
    const explicit = normalizeClientSectionCode(item?.clientSection, { category: item?.category });
    if (explicit && labelMap[explicit]) {
      return {
        section: explicit,
        subsection: (item?.clientSubsection || "").trim(),
        label: labelMap[explicit] || explicit,
      };
    }

    const cat = (item?.category || "").trim();

    if (BROAD_CATEGORIES.has(cat)) {
      const inferred = inferFromName(item?.name);
      if (inferred.section) {
        return { ...inferred, label: labelMap[inferred.section] || inferred.section };
      }
    }

    const mapped = CATEGORY_MAP[cat];
    if (mapped?.section) {
      return { ...mapped, label: labelMap[mapped.section] || mapped.section };
    }

    const inferred = inferFromName(item?.name);
    if (inferred.section) {
      return { ...inferred, label: labelMap[inferred.section] || inferred.section };
    }

    if (explicit === "requires_review" || cat === "Требует разбора") {
      return { section: "requires_review", subsection: "", label: "Требует разбора" };
    }

    return { section: "", subsection: "", label: cat || "Без категории" };
  }

  function groupByClientSection(items) {
    const map = new Map();
    for (const it of items || []) {
      const { section, label } = resolveClientSection(it);
      if (section === "requires_review") continue;
      const key = section || "__misc__";
      const title = section ? label : "Уточнить категорию";
      if (!map.has(key)) map.set(key, { title, items: [] });
      map.get(key).items.push(it);
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      })
      .map(([, v]) => [v.title, v.items]);
  }

  return {
    sections: list,
    labelMap,
    order,
    resolveClientSection,
    groupByClientSection,
  };
}

let activeRuntime = createRuntime(DEFAULT_CLIENT_SECTIONS);

export function configureClientSections(sections) {
  activeRuntime = createRuntime(sections);
}

export function getClientSections({ includeHidden = false } = {}) {
  const list = activeRuntime.sections;
  return includeHidden ? [...list] : list.filter((s) => !s.hidden);
}

export function getClientSectionLabel(sectionId) {
  if (!sectionId) return "";
  return activeRuntime.labelMap[sectionId] || sectionId;
}

export function getClientSectionLabelMap() {
  return { ...activeRuntime.labelMap };
}

/** @deprecated используйте getClientSectionLabelMap() */
export const CLIENT_SECTION_LABEL = Object.fromEntries(DEFAULT_CLIENT_SECTIONS.map((s) => [s.id, s.label]));

export function getClientSubsections(sectionId) {
  return subsectionsForSection(sectionId);
}

const CATEGORY_MAP = {
  "Каркас и крепёж": { section: "stellage", subsection: "Каркас и профиль" },
  "Крепёж и соединители": { section: "stellage", subsection: "Крепёж" },
  "Стеллажи и каркас": { section: "stellage", subsection: "" },
  "Лотки, поддоны и каналы": { section: "trays_channels", subsection: "" },
  "Полив и сантехника": { section: "irrigation", subsection: "" },
  "Полив — подача раствора": { section: "irrigation", subsection: "" },
  "Дренаж и слив": { section: "drainage", subsection: "" },
  Насосы: { section: "pumps", subsection: "" },
  "Ёмкости и баки": { section: "tanks", subsection: "" },
  Водоподготовка: { section: "water_prep", subsection: "" },
  Освещение: { section: "lighting", subsection: "" },
  "Электрика и свет": { section: "electrics", subsection: "" },
  "Электрика и щит": { section: "electrics", subsection: "" },
  "Автоматика и датчики": { section: "automation", subsection: "" },
  "Климат и вентиляция": { section: "climate", subsection: "" },
  "Манипуляционная зона": { section: "manipulation", subsection: "" },
  Расходники: { section: "consumables", subsection: "" },
  "Расходники запуска": { section: "consumables", subsection: "" },
  "Инструмент и инвентарь": { section: "tools", subsection: "" },
  "Склад и хранение": { section: "tools", subsection: "Складской инвентарь" },
  Упаковка: { section: "consumables", subsection: "Упаковка и маркировка" },
  "Работы и доставка": { section: "works_delivery", subsection: "" },
  "Требует разбора": { section: "requires_review", subsection: "" },
  Прочее: { section: "", subsection: "" },
};

function inferFromName(name = "") {
  const n = String(name).toLowerCase().replace(/ё/g, "е");
  if (/краб|профил|каркас|креп|болт|гайк|шайб|покрас|стойк/.test(n)) {
    return { section: "stellage", subsection: "Каркас и профиль" };
  }
  if (/лоток|канал|кассет|поддон|nft/.test(n)) {
    return { section: "trays_channels", subsection: "" };
  }
  if (/насос/.test(n) && /дренаж|слив/.test(n)) {
    return { section: "pumps", subsection: "Насосы дренажа" };
  }
  if (/насос/.test(n)) return { section: "pumps", subsection: "Насосы подачи" };
  if (/полив|капель|форсунк|коллектор|кран|фитинг|магистрал/.test(n) && !/дренаж|слив|канализ/.test(n)) {
    return { section: "irrigation", subsection: "" };
  }
  if (/дренаж|слив|канализ|заглушк/.test(n)) return { section: "drainage", subsection: "" };
  if (/бак|бочк|ёмк|емк|уровнемер|врезк/.test(n)) return { section: "tanks", subsection: "" };
  if (/светиль|освещ|блок питан|подвес|драйвер/.test(n)) return { section: "lighting", subsection: "" };
  if (/кабель|автомат|узо|розетк|щит|клемм|вилк|реле|контактор/.test(n)) {
    return { section: "electrics", subsection: "" };
  }
  if (/кондицион|вытяж|вентиля|воздуховод|увлажн|осуш/.test(n)) {
    return { section: "climate", subsection: "" };
  }
  if (/осмос|фильтр|картридж|солемер|ph|ec|кислот|перекись/.test(n)) {
    return { section: "water_prep", subsection: "" };
  }
  if (/контроллер|таймер|датчик|клапан электромагнит/.test(n)) {
    return { section: "automation", subsection: "" };
  }
  if (/стол|мойк|манипуляц|санитар/.test(n)) return { section: "manipulation", subsection: "" };
  if (/семен|субстрат|удобр|перчатк|этикетк|моющ|упаков/.test(n)) {
    return { section: "consumables", subsection: "" };
  }
  if (/инструмент|ключ|отверт|уровень|ведро|швабр|склад/.test(n)) {
    return { section: "tools", subsection: "" };
  }
  if (/монтаж|доставк|пуск|услуг|работ/.test(n)) {
    return { section: "works_delivery", subsection: "" };
  }
  return { section: "", subsection: "" };
}

const BROAD_CATEGORIES = new Set([
  "Полив и сантехника",
  "Электрика и свет",
  "Прочее",
  "Каркас и крепёж",
]);

export function suggestClientSectionFromCategory(category) {
  const mapped = CATEGORY_MAP[(category || "").trim()];
  return mapped?.section || "";
}

export function suggestClientSubsectionFromCategory(category) {
  const mapped = CATEGORY_MAP[(category || "").trim()];
  return mapped?.subsection || "";
}

export function resolveClientSection(item) {
  return activeRuntime.resolveClientSection(item);
}

export function clientSectionLabel(item) {
  const { section, label, subsection } = resolveClientSection(item);
  const base = label || getClientSectionLabel(section) || section;
  if (subsection) return `${base} → ${subsection}`;
  return base;
}

export function groupByClientSection(items) {
  return activeRuntime.groupByClientSection(items);
}

export function isMiscCategory(item) {
  const cat = (item?.category || "").trim();
  const { section } = resolveClientSection(item);
  return cat === "Прочее" && !section;
}

export function subsectionsForSection(sectionId) {
  const sec = activeRuntime.sections.find((s) => s.id === sectionId);
  return sec?.subsections || [];
}

export function isSubsectionValid(sectionId, subsection) {
  if (!subsection) return false;
  const subs = subsectionsForSection(sectionId);
  return subs.includes(subsection);
}

export function clientSectionsFromExcelSheet(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const order = r.order ?? r[0];
    const label = r.label ?? r[1];
    const id = normalizeClientSectionCode(r.id ?? r[2]);
    const sub = r.subsection ?? r[3];
    if (!id || !label) continue;
    if (!map.has(id)) map.set(id, { id, label, order, subsections: [], hidden: false });
    if (sub && !map.get(id).subsections.includes(sub)) map.get(id).subsections.push(sub);
  }
  return [...map.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
