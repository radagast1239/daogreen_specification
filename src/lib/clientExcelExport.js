import * as XLSX from "xlsx";
import { mergedPurchaseList, money, num } from "../store/helpers.js";
import { lineGross, itemsByResponsible } from "../lib/itemHelpers.js";
import { groupByClientSection, clientSectionLabel } from "../../shared/clientSections.js";
import { isBoughtStatus } from "../components/client/ClientItemCard.jsx";

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sheetFromRows(rows, name) {
  if (!rows?.length) return null;
  const headers = Object.keys(rows[0]);
  const data = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = headers.map((h) => ({ wch: h === "Наименование" ? 42 : 14 }));
  return { ws, name: name.slice(0, 31) };
}

function itemRow(it, project, purchaseStatuses, extra = {}) {
  return {
    Категория: clientSectionLabel(it),
    Наименование: it.name,
    Ед: it.unit,
    Кол: num(it.qty),
    Цена: it.price,
    Сумма: Math.round(lineGross(it)),
    Поставщик: it.supplier || "",
    Ссылка: it.link || "",
    Статус: purchaseStatuses.find((s) => s.id === it.status)?.label || it.status,
    "Факт. цена": it.actualPrice ?? "",
    Комментарий: it.clientComment || "",
    Модуль: it.module || "",
    ...extra,
  };
}

function summaryRows(project, items, purchaseStatuses) {
  const sections = groupByClientSection(items);
  return sections.map(([title, list]) => {
    const sum = list.reduce((s, i) => s + lineGross(i), 0);
    const bought = list.filter((i) => isBoughtStatus(i.status)).length;
    return {
      Раздел: title,
      Позиций: list.length,
      "Куплено, шт": bought,
      Сумма: Math.round(sum),
      Готовность: list.length ? `${Math.round((bought / list.length) * 100)}%` : "0%",
    };
  });
}

function supplierRows(items) {
  const map = new Map();
  for (const it of items) {
    const s = (it.supplier || "—").trim() || "—";
    if (!map.has(s)) map.set(s, { count: 0, sum: 0, links: new Set() });
    const row = map.get(s);
    row.count += 1;
    row.sum += lineGross(it);
    if (it.link) row.links.add(it.link);
  }
  return [...map.entries()].map(([supplier, v]) => ({
    Поставщик: supplier,
    Позиций: v.count,
    Сумма: Math.round(v.sum),
    Ссылки: [...v.links].slice(0, 5).join("; "),
  }));
}

function specialistRows(items, role, project, purchaseStatuses) {
  const list = itemsByResponsible(items, role);
  return list.map((it) => itemRow(it, project, purchaseStatuses));
}

export function downloadClientWorkbook(project, items, { purchaseStatuses = [], branding = {}, versionInfo } = {}) {
  const wb = XLSX.utils.book_new();
  const totals = items.reduce(
    (acc, it) => {
      const g = lineGross(it);
      acc.budget += g;
      if (isBoughtStatus(it.status)) acc.spent += g;
      return acc;
    },
    { budget: 0, spent: 0 }
  );

  const infoRows = [
    { Поле: "Проект", Значение: project.name },
    { Поле: "Клиент", Значение: project.client || "" },
    { Поле: "Город", Значение: project.city || "" },
    { Поле: "Версия", Значение: project.version > 1 ? `v${project.version}` : "v1" },
    { Поле: "Дата", Значение: new Date().toLocaleDateString("ru-RU") },
    { Поле: "Компания", Значение: branding.companyName || "Daogreen" },
    { Поле: "Бюджет", Значение: Math.round(totals.budget) },
    { Поле: "Куплено", Значение: Math.round(totals.spent) },
    { Поле: "Осталось", Значение: Math.round(totals.budget - totals.spent) },
  ];
  const s1 = sheetFromRows(infoRows, "01 Итоги");
  if (s1) XLSX.utils.book_append_sheet(wb, s1.ws, s1.name);
  const s1b = sheetFromRows(summaryRows(project, items, purchaseStatuses), "Итоги-кат");
  if (s1b) XLSX.utils.book_append_sheet(wb, s1b.ws, "02 По разделам");

  const merged = mergedPurchaseList({ ...project, items });
  const mergedRows = merged.map((r, i) => ({
    "№": i + 1,
    Наименование: r.name,
    Ед: r.unit,
    "Кол-во всего": num(r.qty),
    Цена: r.price,
    Сумма: Math.round(r.sumVat),
    Поставщик: r.supplier || "",
    Ссылка: r.link || "",
    Откуда: r.sources.map((s) => `${s.module} (${num(s.qty)})`).join("; "),
  }));
  const s2 = sheetFromRows(mergedRows, "03 Общий список");
  if (s2) XLSX.utils.book_append_sheet(wb, s2.ws, s2.name);

  const flatRows = items.map((it, i) => ({ "№": i + 1, ...itemRow(it, project, purchaseStatuses) }));
  const s3 = sheetFromRows(flatRows, "04 Все позиции");
  if (s3) XLSX.utils.book_append_sheet(wb, s3.ws, s3.name);

  const s4 = sheetFromRows(supplierRows(items), "05 Поставщики");
  if (s4) XLSX.utils.book_append_sheet(wb, s4.ws, s4.name);

  for (const [label, role, sheetName] of [
    ["Сантехник", "plumber", "06 Сантехник"],
    ["Электрик", "electrician", "07 Электрик"],
    ["Монтажник", "installer", "08 Монтажник"],
    ["Расходники", "consumables", "09 Расходники"],
  ]) {
    const rows = specialistRows(items, role, project, purchaseStatuses);
    if (rows.length) {
      const sh = sheetFromRows(rows, sheetName);
      if (sh) XLSX.utils.book_append_sheet(wb, sh.ws, sh.name);
    }
  }

  if (versionInfo?.summary) {
    const ch = versionInfo.summary;
    const chRows = [
      { Версия: versionInfo.versionNumber, Дата: versionInfo.createdAt || "", Изменение: ch.delta ?? "" },
    ];
    const sch = sheetFromRows(chRows, "10 Изменения");
    if (sch) XLSX.utils.book_append_sheet(wb, sch.ws, sch.name);
  }

  const safeName = (project.name || "проект").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const ver = project.version > 1 ? `_v${project.version}` : "";
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  triggerDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Daogreen_Закупочный_лист_${safeName}${ver}.xlsx`
  );
}
