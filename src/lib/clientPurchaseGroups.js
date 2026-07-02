import { money } from "../store/helpers.js";
import { getClientSections, resolveClientSection } from "../../shared/clientSections.js";
import { groupMergedByListCategories as buildListCategoryGroups } from "../../shared/clientListCategoryGroups.js";
import { isClosedPurchaseStatus } from "./itemHelpers.js";

const PROBLEM_STATUSES = new Set(["need_help", "replacement_check", "on_review"]);

export function detectRowProblems(row) {
  const problems = [];
  if (!(row.link || "").trim()) problems.push("no_link");
  if (!Number(row.price)) problems.push("no_price");
  if (!(row.supplier || "").trim()) problems.push("no_supplier");
  const statuses = (row.sourceItems || []).map((i) => i.status);
  for (const st of PROBLEM_STATUSES) {
    if (statuses.includes(st)) problems.push(st);
  }
  return problems;
}

function rowIsClosed(row) {
  const src = row.sourceItems || [];
  return src.length > 0 && src.every((i) => isClosedPurchaseStatus(i.status));
}

/**
 * Готова ли строка к покупке прямо сейчас:
 * есть ссылка, есть поставщик, не закрыта (не заказано/куплено/доставлено/уже есть),
 * нет проблемных статусов (нужна помощь / замена / на проверке).
 */
export function isRowReadyToBuy(row) {
  if (!row) return false;
  if (!(row.link || "").trim()) return false;
  if (!(row.supplier || "").trim()) return false;
  if (rowIsClosed(row)) return false;
  const statuses = (row.sourceItems || []).map((i) => i.status);
  for (const st of PROBLEM_STATUSES) {
    if (statuses.includes(st)) return false;
  }
  return true;
}

/** Счётчики проблем по причинам, агрегированные из sectionStats */
export function problemGroupCounts(sectionStats) {
  const counts = {};
  for (const key of Object.keys(sectionStats || {})) {
    for (const pr of sectionStats[key].problemRows || []) {
      for (const p of pr.problems || []) counts[p] = (counts[p] || 0) + 1;
    }
  }
  return counts;
}

export function computeSectionStats(allRows) {
  const stats = new Map();
  for (const row of allRows || []) {
    const rep = row.sourceItems?.[0];
    const { section } = resolveClientSection(rep || row);
    const sKey = section || "__misc__";
    if (!stats.has(sKey)) {
      stats.set(sKey, { totalCount: 0, boughtCount: 0, suppliers: new Set(), problemCount: 0, problemRows: [] });
    }
    const st = stats.get(sKey);
    st.totalCount += 1;
    const closed = (row.sourceItems || []).every((i) => isClosedPurchaseStatus(i.status));
    if (closed && (row.sourceItems || []).length > 0) st.boughtCount += 1;
    const supplier = (row.supplier || "").trim();
    if (supplier) st.suppliers.add(supplier);
    const probs = detectRowProblems(row);
    if (probs.length > 0 && !closed) {
      st.problemCount += 1;
      st.problemRows.push({ row, problems: probs });
    }
  }
  const result = {};
  for (const [key, val] of stats) {
    result[key] = {
      totalCount: val.totalCount,
      boughtCount: val.boughtCount,
      supplierCount: val.suppliers.size,
      problemCount: val.problemCount,
      problemRows: val.problemRows,
    };
  }
  return result;
}

function sectionOrderKey(sectionId) {
  const order = [...getClientSections().map((s) => s.id), "__misc__"];
  return order.indexOf(sectionId);
}

/** Раздел → подраздел → склеенные строки */
export function groupMergedBySectionHierarchy(rows, currency, { sectionStats } = {}) {
  const sections = new Map();
  for (const row of rows || []) {
    const rep = row.sourceItems?.[0];
    const { section, subsection, label } = resolveClientSection(rep || row);
    const sKey = section || "__misc__";
    const sTitle = section ? label : "Уточнить категорию";
    const subKey = (subsection || row.clientSubsection || "").trim() || "__default__";
    const subTitle = subKey === "__default__" ? "" : subKey;

    if (!sections.has(sKey)) {
      sections.set(sKey, { title: sTitle, sectionId: sKey, subsections: new Map(), sum: 0, count: 0 });
    }
    const sec = sections.get(sKey);
    if (!sec.subsections.has(subKey)) {
      sec.subsections.set(subKey, { title: subTitle, rows: [], sum: 0, count: 0 });
    }
    const sub = sec.subsections.get(subKey);
    sub.rows.push(row);
    sub.sum += row.sumVat || 0;
    sub.count += 1;
    sec.sum += row.sumVat || 0;
    sec.count += 1;
  }

  return [...sections.entries()]
    .sort(([a], [b]) => sectionOrderKey(a) - sectionOrderKey(b))
    .map(([, sec]) => {
      const stats = sectionStats?.[sec.sectionId];
      const hints = [];
      if (stats?.boughtCount) hints.push(`${stats.boughtCount}/${stats.totalCount} куплено`);
      if (stats?.supplierCount) hints.push(`${stats.supplierCount} пост.`);
      if (stats?.problemCount) hints.push(`⚠ ${stats.problemCount}`);
      return {
        title: sec.title,
        sectionId: sec.sectionId,
        sum: sec.sum,
        count: sec.count,
        sumLabel: money(sec.sum, currency),
        hint: hints.join(" · ") || undefined,
        boughtCount: stats?.boughtCount || 0,
        totalCount: stats?.totalCount || 0,
        supplierCount: stats?.supplierCount || 0,
        problemCount: stats?.problemCount || 0,
        subsections: [...sec.subsections.entries()].map(([, sub]) => ({
          title: sub.title,
          rows: sub.rows,
          sum: sub.sum,
          count: sub.count,
          sumLabel: money(sub.sum, currency),
        })),
      };
    });
}

export function groupMergedBySupplier(rows, currency) {
  const map = new Map();
  for (const row of rows || []) {
    const key = (row.supplier || "").trim() || "— без поставщика —";
    if (!map.has(key)) map.set(key, { title: key, rows: [], sum: 0, count: 0 });
    const g = map.get(key);
    g.rows.push(row);
    g.sum += row.sumVat || 0;
    g.count += 1;
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .map(([, g]) => ({ ...g, sumLabel: money(g.sum, currency) }));
}

export function flattenMergedBySectionOrder(rows, currency) {
  const groups = groupMergedBySectionHierarchy(rows, currency);
  const flat = [];
  for (const sec of groups) {
    for (const sub of sec.subsections) {
      const sorted = [...sub.rows].sort((a, b) => {
        const ao = Math.min(...(a.sourceItems || []).map((i) => i.sortOrder ?? 99999));
        const bo = Math.min(...(b.sourceItems || []).map((i) => i.sortOrder ?? 99999));
        if (ao !== bo) return ao - bo;
        return (a.name || "").localeCompare(b.name || "", "ru");
      });
      flat.push(...sorted);
    }
  }
  return flat;
}

export function groupMergedFlat(rows, currency) {
  const sum = (rows || []).reduce((s, r) => s + (r.sumVat || 0), 0);
  return [{ title: "Всё к закупке", rows: rows || [], sum, count: rows?.length || 0, sumLabel: money(sum, currency) }];
}

export function groupMergedByListCategories(rows, currency) {
  return buildListCategoryGroups(rows).map((g) => ({
    ...g,
    sumLabel: money(g.sum, currency),
  }));
}
