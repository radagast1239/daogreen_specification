/** Списком: крупные категории без дублирования строк */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** Позиции из состава стеллажа — в «Списком» не выводим (см. «По разделам») */
export function isStellagePurchaseModule(item) {
  const mod = norm(item?.module);
  if (!mod) return false;
  return /^стеллаж|к стеллаж/.test(mod);
}

export const CLIENT_LIST_CATEGORY_GROUPS = [
  {
    id: "plumbing",
    label: "Сантехника",
    hint: "Полив/дренаж, подтопление, магистрали, насосы, водоподготовка, растворный узел, капельный полив",
    match(item) {
      const mod = norm(item.module);
      const cat = norm(item.category);
      const hay = `${mod} ${cat}`;
      if (
        /полив|дренаж|подтоплен|магистраль|насос|обвязк|водоподготов|растворн|капель|бак|ёмк|емк|канализ|сантех|полиэтилен|труб|фитинг|клапан|кран|nft|гидропон/.test(
          hay
        )
      ) {
        return true;
      }
      return /полив|дренаж|насос|ёмк|емк|водоподготов/.test(cat);
    },
  },
  {
    id: "electrics",
    label: "Электрика и щит",
    hint: "Щит, автоматы, кабель, розетки, освещение",
    match(item) {
      const hay = `${norm(item.module)} ${norm(item.category)}`;
      return /электрик|освещен|щит|кабель|свет|розетк|автомат|узо|драйвер|блок питан/.test(hay);
    },
  },
  {
    id: "automation",
    label: "Автоматика и датчики",
    match(item) {
      const hay = `${norm(item.module)} ${norm(item.category)}`;
      return /автоматик|датчик|контроллер|реле|таймер/.test(hay);
    },
  },
  {
    id: "farm_general",
    label: "Общая закупка на ферму",
    match(item) {
      return norm(item.module) === "общая закупка на ферму";
    },
  },
  {
    id: "manipulation",
    label: "Манипуляционная",
    match(item) {
      const hay = `${norm(item.module)} ${norm(item.category)}`;
      return /манипуляц/.test(hay);
    },
  },
  {
    id: "climate",
    label: "Климат, вентиляция и охлаждение",
    match(item) {
      const hay = `${norm(item.module)} ${norm(item.category)}`;
      return /климат|вентиля|охлажден|кондицион|вытяж|обдув/.test(hay);
    },
  },
  {
    id: "warehouse",
    label: "Склад",
    match(item) {
      const hay = `${norm(item.module)} ${norm(item.category)}`;
      return /склад/.test(hay);
    },
  },
  {
    id: "launch_consumables",
    label: "Расходники запуска",
    match(item) {
      const hay = `${norm(item.module)} ${norm(item.category)}`;
      return /расходники запуска|расходник.*запуск/.test(hay);
    },
  },
  {
    id: "tools",
    label: "Инструмент и инвентарь",
    match(item) {
      const hay = `${norm(item.module)} ${norm(item.category)}`;
      return /инструмент|инвентар/.test(hay);
    },
  },
  {
    id: "works",
    label: "Работы и доставка",
    match(item) {
      const hay = `${norm(item.module)} ${norm(item.category)}`;
      return item.itemRole === "installation" || /работ|доставк|монтаж|услуг/.test(hay);
    },
  },
];

export function resolveListCategoryGroupId(item) {
  if (!item || isStellagePurchaseModule(item)) return null;
  for (const g of CLIENT_LIST_CATEGORY_GROUPS) {
    if (g.match(item)) return g.id;
  }
  return "__other__";
}

function repItem(row) {
  return row?.sourceItems?.[0] || row;
}

/** Списком: крупные категории без дублирования строк */
export function groupMergedByListCategories(rows) {
  const buckets = new Map(
    CLIENT_LIST_CATEGORY_GROUPS.map((g) => [
      g.id,
      { title: g.label, sectionId: g.id, hint: g.hint || "", rows: [], sum: 0, count: 0 },
    ])
  );
  const other = { title: "Прочее", sectionId: "__other__", hint: "", rows: [], sum: 0, count: 0 };

  for (const row of rows || []) {
    const gid = resolveListCategoryGroupId(repItem(row));
    if (!gid) continue;
    const bucket = gid === "__other__" ? other : buckets.get(gid);
    bucket.rows.push(row);
    bucket.sum += row.sumVat || 0;
    bucket.count += 1;
  }

  const out = CLIENT_LIST_CATEGORY_GROUPS.map((g) => buckets.get(g.id)).filter((g) => g.count > 0);
  if (other.count > 0) out.push(other);
  return out;
}
