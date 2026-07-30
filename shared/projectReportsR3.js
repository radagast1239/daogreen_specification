/** Reports R3 — purchasing excel rows + section/room breakdowns (pure, read-only). */

import {
  isPurchasableLineType,
  resolveItemType,
  resolveEffectiveSupplier,
  lineContributesToSum,
} from "./itemTypes.js";
import {
  normalizePurchaseStatus,
  PURCHASE_STATUS,
  PURCHASE_STATUS_LABELS,
} from "./purchaseStatusRules.js";
import {
  getProjectStatusLabel,
  normalizeProjectStatus,
  isProjectStatusActiveLifecycle,
} from "./projectStatus.js";
import { resolveClientSection, getClientSectionLabelMap } from "./clientSections.js";
import { matchSpecLineFilter } from "./specLineFilters.js";

export const REPORT_BREAKDOWN_TABS = Object.freeze([
  { id: "sections", label: "По разделам" },
  { id: "rooms", label: "По помещениям" },
]);

export const NO_ROOM_GROUP = "Помещение не указано";
export const NO_SUPPLIER_GROUP = "Поставщик не указан";

/** Highlight cards — map onto existing client-section ids + itemType (no new taxonomy). */
export const SECTION_CARD_KEYS = Object.freeze([
  {
    id: "equipment",
    label: "Оборудование",
    sectionIds: ["stellage", "trays_channels", "tanks", "pumps", "lighting", "manipulation", "tools"],
  },
  {
    id: "materials",
    label: "Материалы",
    sectionIds: ["water_prep", "consumables"],
    itemTypes: ["material", "kit"],
  },
  {
    id: "works",
    label: "Работы",
    sectionIds: ["works_delivery"],
    itemTypes: ["service"],
  },
  {
    id: "electrics",
    label: "Электрика",
    sectionIds: ["electrics", "automation"],
  },
  {
    id: "plumbing",
    label: "Сантехника",
    sectionIds: ["irrigation", "drainage", "pumps", "tanks", "water_prep"],
  },
  {
    id: "climate",
    label: "Климат",
    sectionIds: ["climate"],
  },
]);

function lineGross(it) {
  const net = (Number(it.qty) || 0) * (Number(it.price) || 0);
  return net + net * ((Number(it.vatRate) || 0) / 100);
}

function materialById(materials) {
  const map = new Map();
  for (const m of materials || []) map.set(m.id, m);
  return map;
}

function isActiveReportProject(project) {
  return isProjectStatusActiveLifecycle(project?.status);
}

function includedLine(it) {
  if (it?.includedInProject === false || it?.enabled === false) return false;
  if (!(Number(it?.qty) > 0) && Number(it?.qty) !== 0) return false;
  // qty 0 still "included" but sum 0; allow qty>=0 when included
  if (it?.qty != null && Number(it.qty) < 0) return false;
  return isPurchasableLineType(resolveItemType(it)) || resolveItemType(it) === "service";
}

/** Lines that contribute to R3 money totals. */
export function isReportsBreakdownLine(it) {
  if (it?.includedInProject === false || it?.enabled === false) return false;
  if (it?.deleted || it?.archived) return false;
  const qty = Number(it?.qty);
  if (!Number.isFinite(qty) || qty <= 0) return false;
  return lineContributesToSum(it) || isPurchasableLineType(resolveItemType(it));
}

function buildProjectSpecOpenPath(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return "/";
  return `/project/${encodeURIComponent(id)}?view=spec`;
}

function resolveSectionMeta(item) {
  const resolved = resolveClientSection(item || {});
  const labels = getClientSectionLabelMap();
  const id = resolved.section || "";
  const label =
    (id && labels[id]) ||
    resolved.label ||
    String(item?.section || item?.module || "").trim() ||
    "Прочее";
  return { sectionId: id || "other", sectionLabel: label };
}

function itemHasProblem(it) {
  return (
    matchSpecLineFilter(it, "no_price", "project") ||
    matchSpecLineFilter(it, "no_supplier", "project") ||
    matchSpecLineFilter(it, "no_link", "project")
  );
}

function isUnpurchased(it) {
  const s = normalizePurchaseStatus(it);
  if (s === PURCHASE_STATUS.ORDERED || s === PURCHASE_STATUS.SEARCHING) return false;
  if (
    s === PURCHASE_STATUS.BOUGHT ||
    s === PURCHASE_STATUS.DELIVERED ||
    s === PURCHASE_STATUS.HAVE
  ) {
    return false;
  }
  return true;
}

function purchaseBucket(status) {
  const s = normalizePurchaseStatus(status);
  if (s === PURCHASE_STATUS.ORDERED || s === PURCHASE_STATUS.SEARCHING) return "ordered";
  if (
    s === PURCHASE_STATUS.BOUGHT ||
    s === PURCHASE_STATUS.DELIVERED ||
    s === PURCHASE_STATUS.HAVE
  ) {
    return "received";
  }
  return "notOrdered";
}

function matchesCard(card, sectionId, itemType) {
  if (card.sectionIds?.includes(sectionId)) return true;
  if (card.itemTypes?.includes(itemType) && card.id === "works" && sectionId === "works_delivery") {
    return true;
  }
  if (card.id === "works" && card.itemTypes?.includes(itemType)) return true;
  if (card.id === "materials" && card.itemTypes?.includes(itemType)) {
    // materials card: materials/kits not already in more specific cards
    const special = ["electrics", "automation", "climate", "irrigation", "drainage", "works_delivery"];
    return !special.includes(sectionId);
  }
  return false;
}

function resolveRoomLabel(project, item) {
  const rid = String(item?.roomId || item?.room_id || "").trim();
  if (!rid) return NO_ROOM_GROUP;
  const rooms = project?.rooms || [];
  const room = rooms.find((r) => String(r.id) === rid);
  if (room?.name) return String(room.name).trim();
  if (item?.roomName) return String(item.roomName).trim();
  return `Помещение ${rid}`;
}

/**
 * Enrich filtered purchase report rows for Excel (same money/status/supplier as screen).
 */
export function buildPurchaseExportRows(filteredPurchaseRows = []) {
  return (filteredPurchaseRows || []).map((r) => ({
    supplier: r.supplier || NO_SUPPLIER_GROUP,
    projectName: r.projectName || "—",
    section: r.section || "—",
    itemName: r.itemName || "—",
    unit: r.unit || "шт.",
    qty: Number(r.qty) || 0,
    price: Number(r.price) || 0,
    sum: Number(r.sum) || 0,
    statusLabel: r.statusLabel || PURCHASE_STATUS_LABELS[r.status] || r.status || "",
    link: r.link || "",
    comment: r.comment || "",
    projectId: r.projectId,
  }));
}

export function summarizePurchaseExport(filteredPurchaseRows = []) {
  const rows = buildPurchaseExportRows(filteredPurchaseRows);
  const bySupplier = new Map();
  const byProject = new Map();
  let totalSum = 0;

  for (const raw of filteredPurchaseRows || []) {
    const r = {
      supplier: raw.supplier || NO_SUPPLIER_GROUP,
      projectName: raw.projectName || "—",
      section: raw.section || "—",
      itemName: raw.itemName || "—",
      unit: raw.unit || "шт.",
      qty: Number(raw.qty) || 0,
      price: Number(raw.price) || 0,
      sum: Number(raw.sum) || 0,
      statusLabel: raw.statusLabel || PURCHASE_STATUS_LABELS[raw.status] || raw.status || "",
      link: raw.link || "",
      comment: raw.comment || "",
      status: raw.status,
    };
    totalSum += r.sum;

    if (!bySupplier.has(r.supplier)) bySupplier.set(r.supplier, { supplier: r.supplier, items: [], sum: 0 });
    const sg = bySupplier.get(r.supplier);
    sg.items.push(r);
    sg.sum += r.sum;

    if (!byProject.has(r.projectName)) {
      byProject.set(r.projectName, {
        projectName: r.projectName,
        itemCount: 0,
        notOrderedSum: 0,
        orderedSum: 0,
        receivedSum: 0,
        totalSum: 0,
      });
    }
    const pg = byProject.get(r.projectName);
    pg.itemCount += 1;
    pg.totalSum += r.sum;
    const b = purchaseBucket(r.status);
    if (b === "ordered") pg.orderedSum += r.sum;
    else if (b === "received") pg.receivedSum += r.sum;
    else pg.notOrderedSum += r.sum;
  }

  const supplierGroups = [...bySupplier.values()]
    .map((g) => ({ ...g, sum: Math.round(g.sum * 100) / 100 }))
    .sort((a, b) => {
      if (a.supplier === NO_SUPPLIER_GROUP) return 1;
      if (b.supplier === NO_SUPPLIER_GROUP) return -1;
      return a.supplier.localeCompare(b.supplier, "ru");
    });

  const projectRows = [...byProject.values()].map((p) => ({
    ...p,
    notOrderedSum: Math.round(p.notOrderedSum * 100) / 100,
    orderedSum: Math.round(p.orderedSum * 100) / 100,
    receivedSum: Math.round(p.receivedSum * 100) / 100,
    totalSum: Math.round(p.totalSum * 100) / 100,
  }));

  const flatRows = supplierGroups.flatMap((g) => g.items);
  const noSupplierRows = flatRows.filter((r) => r.supplier === NO_SUPPLIER_GROUP);

  return {
    rows: flatRows,
    supplierGroups,
    projectRows,
    noSupplierRows,
    totalSum: Math.round(totalSum * 100) / 100,
  };
}

/** AOA sheets for XLSX (no DOM). */
export function buildPurchaseExportSheetData(filteredPurchaseRows = []) {
  const summary = summarizePurchaseExport(filteredPurchaseRows);
  const sheetPurchase = [
    [
      "Поставщик",
      "Проект",
      "Раздел",
      "Позиция",
      "Единица",
      "Количество",
      "Цена",
      "Сумма",
      "Статус закупки",
      "Ссылка",
      "Комментарий",
    ],
  ];
  for (const g of summary.supplierGroups) {
    for (const r of g.items) {
      sheetPurchase.push([
        r.supplier,
        r.projectName,
        r.section,
        r.itemName,
        r.unit,
        r.qty,
        r.price,
        r.sum,
        r.statusLabel,
        r.link,
        r.comment,
      ]);
    }
    sheetPurchase.push(["Итого " + g.supplier, "", "", "", "", "", "", g.sum, "", "", ""]);
  }
  sheetPurchase.push(["Общий итог", "", "", "", "", "", "", summary.totalSum, "", "", ""]);

  const sheetProjects = [
    ["Проект", "Количество позиций", "Не заказано", "Заказано", "Получено", "Общая сумма закупки"],
  ];
  for (const p of summary.projectRows) {
    sheetProjects.push([
      p.projectName,
      p.itemCount,
      p.notOrderedSum,
      p.orderedSum,
      p.receivedSum,
      p.totalSum,
    ]);
  }

  const sheetNoSupplier = [
    ["Проект", "Раздел", "Позиция", "Единица", "Количество", "Цена", "Сумма", "Статус закупки", "Ссылка"],
  ];
  for (const r of summary.noSupplierRows) {
    sheetNoSupplier.push([
      r.projectName,
      r.section,
      r.itemName,
      r.unit,
      r.qty,
      r.price,
      r.sum,
      r.statusLabel,
      r.link,
    ]);
  }
  if (summary.noSupplierRows.length === 0) {
    sheetNoSupplier.push(["Нет позиций для выгрузки", "", "", "", "", "", "", "", ""]);
  }

  return {
    sheets: [
      { name: "01 Закупка", aoa: sheetPurchase },
      { name: "02 По проектам", aoa: sheetProjects },
      { name: "03 Без поставщика", aoa: sheetNoSupplier },
    ],
    summary,
  };
}

export function buildReportsSections(projects = [], materials = [], { projectId = "" } = {}) {
  const materialsIndex = materialById(materials);
  const active = (projects || []).filter(isActiveReportProject);
  const scoped = projectId ? active.filter((p) => p.id === projectId) : active;
  const bySection = new Map();
  let totalSum = 0;

  for (const p of scoped) {
    for (const raw of p.items || []) {
      if (!isReportsBreakdownLine(raw)) continue;
      const mat = raw.materialId ? materialsIndex.get(raw.materialId) : null;
      const it = { ...raw, supplier: resolveEffectiveSupplier(raw, mat) };
      const { sectionId, sectionLabel } = resolveSectionMeta(it);
      const sum = lineGross(it);
      totalSum += sum;
      if (!bySection.has(sectionLabel)) {
        bySection.set(sectionLabel, {
          sectionId,
          sectionLabel,
          itemCount: 0,
          sum: 0,
          problemCount: 0,
          unpurchasedCount: 0,
          projectIds: new Set(),
        });
      }
      const row = bySection.get(sectionLabel);
      row.itemCount += 1;
      row.sum += sum;
      if (itemHasProblem(it)) row.problemCount += 1;
      if (isUnpurchased(it)) row.unpurchasedCount += 1;
      row.projectIds.add(p.id);
    }
  }

  const rows = [...bySection.values()]
    .map((r) => ({
      sectionId: r.sectionId,
      sectionLabel: r.sectionLabel,
      itemCount: r.itemCount,
      sum: Math.round(r.sum * 100) / 100,
      sharePct: totalSum > 0 ? Math.round((r.sum / totalSum) * 1000) / 10 : 0,
      problemCount: r.problemCount,
      unpurchasedCount: r.unpurchasedCount,
      projectCount: r.projectIds.size,
      openPath:
        r.projectIds.size === 1
          ? buildProjectSpecOpenPath([...r.projectIds][0])
          : projectId
            ? buildProjectSpecOpenPath(projectId)
            : "/",
      primaryProjectId: r.projectIds.size === 1 ? [...r.projectIds][0] : projectId || "",
    }))
    .sort((a, b) => b.sum - a.sum || a.sectionLabel.localeCompare(b.sectionLabel, "ru"));

  const cards = { totalSum: Math.round(totalSum * 100) / 100 };
  for (const card of SECTION_CARD_KEYS) {
    let s = 0;
    for (const p of scoped) {
      for (const raw of p.items || []) {
        if (!isReportsBreakdownLine(raw)) continue;
        const { sectionId } = resolveSectionMeta(raw);
        const type = resolveItemType(raw);
        if (matchesCard(card, sectionId, type)) s += lineGross(raw);
      }
    }
    cards[card.id] = Math.round(s * 100) / 100;
  }

  return { rows, cards, totalSum: cards.totalSum };
}

export function filterReportSections(rows, { q = "" } = {}) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return rows || [];
  return (rows || []).filter((row) =>
    String(row.sectionLabel || "")
      .toLowerCase()
      .includes(query)
  );
}

export function buildReportsRooms(projects = [], materials = []) {
  const materialsIndex = materialById(materials);
  const active = (projects || []).filter(isActiveReportProject);
  const map = new Map();

  for (const p of active) {
    for (const raw of p.items || []) {
      if (!isReportsBreakdownLine(raw)) continue;
      const mat = raw.materialId ? materialsIndex.get(raw.materialId) : null;
      const it = { ...raw, supplier: resolveEffectiveSupplier(raw, mat) };
      const roomLabel = resolveRoomLabel(p, it);
      const { sectionId } = resolveSectionMeta(it);
      const type = resolveItemType(it);
      const sum = lineGross(it);
      const key = `${p.id}::${roomLabel}`;
      if (!map.has(key)) {
        map.set(key, {
          projectId: p.id,
          projectName: p.name || "Проект",
          roomLabel,
          itemCount: 0,
          sum: 0,
          problemCount: 0,
          equipment: 0,
          materials: 0,
          works: 0,
          electrics: 0,
          plumbing: 0,
          climate: 0,
          openPath: buildProjectSpecOpenPath(p.id),
        });
      }
      const row = map.get(key);
      row.itemCount += 1;
      row.sum += sum;
      if (itemHasProblem(it)) row.problemCount += 1;
      for (const card of SECTION_CARD_KEYS) {
        if (matchesCard(card, sectionId, type)) {
          row[card.id === "plumbing" ? "plumbing" : card.id] += sum;
        }
      }
    }
  }

  const rows = [...map.values()]
    .map((r) => ({
      ...r,
      sum: Math.round(r.sum * 100) / 100,
      equipment: Math.round(r.equipment * 100) / 100,
      materials: Math.round(r.materials * 100) / 100,
      works: Math.round(r.works * 100) / 100,
      electrics: Math.round(r.electrics * 100) / 100,
      plumbing: Math.round(r.plumbing * 100) / 100,
      climate: Math.round(r.climate * 100) / 100,
    }))
    .sort(
      (a, b) =>
        a.projectName.localeCompare(b.projectName, "ru") ||
        (a.roomLabel === NO_ROOM_GROUP ? 1 : 0) - (b.roomLabel === NO_ROOM_GROUP ? 1 : 0) ||
        a.roomLabel.localeCompare(b.roomLabel, "ru")
    );

  return { rows };
}

export function filterReportRooms(
  rows,
  { projectId = "", room = "", section = "", q = "" } = {}
) {
  const query = String(q || "").trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (projectId && row.projectId !== projectId) return false;
    if (room && row.roomLabel !== room) return false;
    if (section) {
      // section filter: keep rooms that have money in mapped card or label match
      const card = SECTION_CARD_KEYS.find(
        (c) => c.id === section || c.label.toLowerCase() === section.toLowerCase()
      );
      if (card) {
        const key = card.id === "plumbing" ? "plumbing" : card.id;
        if (!(Number(row[key]) > 0)) return false;
      }
    }
    if (!query) return true;
    const hay = `${row.projectName} ${row.roomLabel}`.toLowerCase();
    return hay.includes(query);
  });
}

export function buildReportsR3(projects = [], materials = [], opts = {}) {
  return {
    sections: buildReportsSections(projects, materials, opts),
    rooms: buildReportsRooms(projects, materials),
  };
}

export function parseReportTabR3(raw, allTabs) {
  const id = String(raw || "").trim();
  if ((allTabs || []).some((t) => t.id === id)) return id;
  return "overview";
}
