import { getClientSections, resolveClientSection } from "../../shared/clientSections.js";
import { money } from "../store/helpers.js";

function sectionOrderKey(sectionId) {
  const order = [...getClientSections().map((s) => s.id), "__misc__"];
  return order.indexOf(sectionId);
}

/** Раздел → подраздел → склеенные строки */
export function groupMergedBySectionHierarchy(rows, currency) {
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
    .map(([, sec]) => ({
      title: sec.title,
      sectionId: sec.sectionId,
      sum: sec.sum,
      count: sec.count,
      sumLabel: money(sec.sum, currency),
      subsections: [...sec.subsections.entries()].map(([, sub]) => ({
        title: sub.title,
        rows: sub.rows,
        sum: sub.sum,
        count: sub.count,
        sumLabel: money(sub.sum, currency),
      })),
    }));
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

export function groupMergedFlat(rows, currency) {
  const sum = (rows || []).reduce((s, r) => s + (r.sumVat || 0), 0);
  return [{ title: "Всё к закупке", rows: rows || [], sum, count: rows?.length || 0, sumLabel: money(sum, currency) }];
}
