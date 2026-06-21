/** Клиентские разделы закупки (отдельно от внутренних category в базе) */

export const DEFAULT_CLIENT_SECTIONS = [
  {
    id: "stellage",
    label: "Стеллажи и каркас",
    subsections: ["Каркас", "Крепёж", "Полки и лотки", "Поддоны"],
  },
  {
    id: "irrigation",
    label: "Полив",
    subsections: ["Насосы", "Магистраль подачи", "Фитинги", "Краны и клапаны", "Капельная лента"],
  },
  {
    id: "drainage",
    label: "Дренаж и слив",
    subsections: ["Трубы слива", "Дренажные насосы", "Канализация"],
  },
  {
    id: "tanks",
    label: "Ёмкости и баки",
    subsections: ["Баки", "Уровнемеры"],
  },
  {
    id: "electrics",
    label: "Электрика",
    subsections: ["Кабель", "Автоматы и УЗО", "Розетки и клеммы", "Щит"],
  },
  {
    id: "lighting",
    label: "Освещение",
    subsections: ["Светильники", "Блоки питания", "Подвесы и крепления"],
  },
  {
    id: "climate",
    label: "Климат и вентиляция",
    subsections: ["Вентиляция", "Кондиционирование", "Увлажнение"],
  },
  {
    id: "water_prep",
    label: "Водоподготовка",
    subsections: ["Фильтры", "Осмос", "Дозирование"],
  },
  {
    id: "automation",
    label: "Автоматика и датчики",
    subsections: ["Контроллеры", "Датчики", "Таймеры"],
  },
  {
    id: "consumables",
    label: "Расходники и запуск",
    subsections: ["Семена и субстрат", "Удобрения", "Запуск фермы"],
  },
  {
    id: "works",
    label: "Работы и доставка",
    subsections: ["Монтаж", "Доставка", "Пусконаладка"],
  },
];

/** @deprecated используйте getClientSections() */
export const CLIENT_SECTIONS = DEFAULT_CLIENT_SECTIONS;

function normalizeSection(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
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
  return DEFAULT_CLIENT_SECTIONS.map((s, i) => ({ ...s, hidden: false, order: i }));
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
  const order = [...list.map((s) => s.id), "__misc__"];

  function resolveClientSection(item) {
    const explicit = (item?.clientSection || "").trim();
    if (explicit) {
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

    return { section: "", subsection: "", label: cat || "Без категории" };
  }

  function groupByClientSection(items) {
    const map = new Map();
    for (const it of items || []) {
      const { section, label } = resolveClientSection(it);
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

export function getClientSectionLabelMap() {
  return { ...activeRuntime.labelMap };
}

/** @deprecated используйте getClientSectionLabelMap() */
export const CLIENT_SECTION_LABEL = Object.fromEntries(DEFAULT_CLIENT_SECTIONS.map((s) => [s.id, s.label]));

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

const BROAD_CATEGORIES = new Set(["Полив и сантехника", "Электрика и свет", "Прочее"]);

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
  return resolveClientSection(item).label;
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
