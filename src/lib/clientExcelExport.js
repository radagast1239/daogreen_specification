import * as XLSX from "xlsx";
import { mergedPurchaseRows, num, groupBy } from "../store/helpers.js";
import { lineGross, resolveResponsible, isBoughtStatus } from "./itemHelpers.js";
import { groupByClientSection } from "../../shared/clientSections.js";

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

function statusLabel(id, purchaseStatuses) {
  return purchaseStatuses.find((s) => s.id === id)?.label || id || "";
}

const MERGED_HEADERS = [
  "№",
  "Раздел",
  "Подраздел",
  "Наименование",
  "Кол-во всего",
  "Ед.",
  "Цена",
  "Сумма",
  "Поставщик",
  "Открыть товар",
  "Статус",
  "Факт. цена",
  "Откуда взялось",
  "Комментарий Daogreen",
  "Комментарий клиента",
];

function mergedDataRow(r, index, purchaseStatuses) {
  const rep = r.sourceItems?.[0];
  return {
    "№": index + 1,
    Раздел: r.clientSectionLabel || "",
    Подраздел: r.clientSubsection || "",
    Наименование: r.name,
    "Кол-во всего": num(r.qty),
    "Ед.": r.unit || "шт.",
    Цена: r.price ?? "",
    Сумма: Math.round(r.sumVat || 0),
    Поставщик: r.supplier || "",
    "Открыть товар": r.link ? "Открыть товар" : "без ссылки",
    _link: r.link || "",
    Статус: statusLabel(r.status, purchaseStatuses),
    "Факт. цена": rep?.actualPrice ?? "",
    "Откуда взялось": r.sourceText || "",
    "Комментарий Daogreen": r.clientNote || "",
    "Комментарий клиента": rep?.clientComment || "",
  };
}

/** Лист со склеенными строками и кликабельными ссылками */
function sheetFromMergedRows(rows, purchaseStatuses) {
  if (!rows?.length) return null;
  const dataRows = rows.map((r, i) => mergedDataRow(r, i, purchaseStatuses));
  const linkCol = MERGED_HEADERS.indexOf("Открыть товар");
  const body = dataRows.map((r) => MERGED_HEADERS.map((h) => r[h] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet([MERGED_HEADERS, ...body]);

  for (let i = 0; i < dataRows.length; i++) {
    const link = dataRows[i]._link;
    if (!link) continue;
    const ref = XLSX.utils.encode_cell({ r: i + 1, c: linkCol });
    ws[ref] = {
      v: "Открыть товар",
      t: "s",
      l: { Target: link, Tooltip: link },
    };
  }

  ws["!cols"] = MERGED_HEADERS.map((h) => {
    if (h === "Наименование" || h === "Откуда взялось") return { wch: 38 };
    if (h === "Комментарий Daogreen" || h === "Комментарий клиента") return { wch: 28 };
    if (h === "Открыть товар") return { wch: 14 };
    return { wch: 13 };
  });
  return ws;
}

function sheetFromRows(rows, colWidths = {}) {
  if (!rows?.length) return null;
  const headers = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const data = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = headers.map((h) => ({ wch: colWidths[h] || (h === "Наименование" ? 42 : 14) }));
  return ws;
}

function sheetFromRowsWithLinks(rows, linkHeader = "Ссылка", linkText = "Открыть товар") {
  if (!rows?.length) return null;
  const headers = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const linkCol = headers.indexOf(linkHeader);
  const body = rows.map((r) => headers.map((h) => r[h] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  if (linkCol >= 0) {
    for (let i = 0; i < rows.length; i++) {
      const link = rows[i]._link;
      if (!link) continue;
      const ref = XLSX.utils.encode_cell({ r: i + 1, c: linkCol });
      ws[ref] = { v: linkText, t: "s", l: { Target: link, Tooltip: link } };
    }
  }
  ws["!cols"] = headers.map((h) => ({ wch: h === "Позиция" || h === "Наименование" ? 40 : 14 }));
  return ws;
}

function instructionSheet() {
  const rows = [
    { Шаг: "1", Действие: "Откройте лист «03 Общий список» — там все позиции к закупке в одном виде." },
    { Шаг: "2", Действие: "Покупайте по поставщикам (лист 05) или по разделам (лист 04)." },
    { Шаг: "3", Действие: "В онлайн-версии отмечайте статусы «заказано» / «куплено» — они сохраняются автоматически." },
    { Шаг: "4", Действие: "Если товара нет — откройте ссылку в колонке «Открыть товар» и напишите комментарий в онлайн-версии." },
    { Шаг: "5", Действие: "Лист «10 Детализация» — для проверки расчёта по стеллажам и модулям (не для закупки)." },
  ];
  return sheetFromRows(rows, { Действие: 72 });
}

function summarySheet(project, items, branding, purchaseStatuses) {
  const budget = items.reduce((s, i) => s + lineGross(i), 0);
  const spent = items.filter((i) => isBoughtStatus(i.status)).reduce((s, i) => s + lineGross(i), 0);
  const bought = items.filter((i) => isBoughtStatus(i.status)).length;
  const progress = items.length ? Math.round((bought / items.length) * 100) : 0;
  const rows = [
    { Поле: "Проект", Значение: project.name },
    { Поле: "Клиент", Значение: project.client || "" },
    { Поле: "Город", Значение: project.city || "" },
    { Поле: "Версия", Значение: project.version > 1 ? `v${project.version}` : "v1" },
    { Поле: "Дата выгрузки", Значение: new Date().toLocaleDateString("ru-RU") },
    { Поле: "Компания", Значение: branding.companyName || "Daogreen" },
    { Поле: "Бюджет", Значение: Math.round(budget) },
    { Поле: "Куплено", Значение: Math.round(spent) },
    { Поле: "Осталось", Значение: Math.round(Math.max(budget - spent, 0)) },
    { Поле: "Готовность", Значение: `${progress}%` },
    { Поле: "Позиций (детально)", Значение: items.length },
  ];
  return sheetFromRows(rows);
}

function categorySummarySheet(items) {
  const sections = groupByClientSection(items);
  const rows = sections.map(([title, list]) => {
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
  return sheetFromRows(rows);
}

function mergedByCategorySheet(merged, purchaseStatuses) {
  const sorted = [...merged].sort((a, b) => {
    const c = (a.clientSectionLabel || "").localeCompare(b.clientSectionLabel || "", "ru");
    if (c !== 0) return c;
    return (a.clientSubsection || "").localeCompare(b.clientSubsection || "", "ru");
  });
  return sheetFromMergedRows(sorted, purchaseStatuses);
}

function supplierMergedSheet(merged) {
  const rows = merged.map((r) => ({
    Поставщик: r.supplier || "—",
    Позиция: r.name,
    "Кол-во": num(r.qty),
    "Ед.": r.unit || "шт.",
    Сумма: Math.round(r.sumVat || 0),
    Ссылка: r.link ? "Открыть товар" : "без ссылки",
    _link: r.link || "",
    Раздел: r.clientSectionLabel || "",
  }));
  return sheetFromRowsWithLinks(rows, "Ссылка");
}

function mergedForRole(items, role) {
  return mergedPurchaseRows(items).filter((row) =>
    (row.sourceItems || []).some((it) => resolveResponsible(it) === role)
  );
}

function moduleDetailSheet(items, project, purchaseStatuses) {
  const groups = groupBy(items, "module");
  const rows = [];
  let n = 0;
  for (const [mod, list] of groups) {
    rows.push({
      "№": "",
      Модуль: mod || "Без модуля",
      Наименование: `— ${list.length} поз. —`,
      Ед: "",
      Кол: "",
      Цена: "",
      Сумма: Math.round(list.reduce((s, i) => s + lineGross(i), 0)),
      Поставщик: "",
      Статус: "",
    });
    for (const it of list) {
      n += 1;
      rows.push({
        "№": n,
        Модуль: mod || "",
        Наименование: it.name,
        Ед: it.unit,
        Кол: num(it.qty),
        Цена: it.price,
        Сумма: Math.round(lineGross(it)),
        Поставщик: it.supplier || "",
        Статус: statusLabel(it.status, purchaseStatuses),
        Ссылка: it.link ? "Открыть товар" : "без ссылки",
        _link: it.link || "",
      });
    }
  }
  return sheetFromRowsWithLinks(rows, "Ссылка");
}

export function downloadClientWorkbook(project, items, { purchaseStatuses = [], branding = {}, versionInfo } = {}) {
  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const installItems = (items || []).filter(
    (i) => i.itemRole === "installation" || i.category === "Работы и доставка"
  );
  const merged = mergedPurchaseRows(purchaseItems);
  const wb = XLSX.utils.book_new();

  const append = (ws, name) => {
    if (ws) XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  append(instructionSheet(), "01 Инструкция");
  append(summarySheet(project, purchaseItems, branding, purchaseStatuses), "02 Итоги");
  append(sheetFromMergedRows(merged, purchaseStatuses), "03 Общий список");
  append(mergedByCategorySheet(merged, purchaseStatuses), "04 По категориям");
  append(supplierMergedSheet(merged), "05 По поставщикам");

  for (const [sheetName, role] of [
    ["06 Сантехник", "plumber"],
    ["07 Электрик", "electrician"],
    ["08 Монтажник", "installer"],
    ["09 Расходники", "consumables"],
  ]) {
    const roleMerged = mergedForRole(purchaseItems, role);
    if (roleMerged.length) append(sheetFromMergedRows(roleMerged, purchaseStatuses), sheetName);
  }

  if (installItems.length) {
    append(sheetFromMergedRows(mergedPurchaseRows(installItems), purchaseStatuses), "09б Монтаж");
  }

  append(moduleDetailSheet(purchaseItems, project, purchaseStatuses), "10 Детализация");

  if (versionInfo?.summary) {
    append(
      sheetFromRows([
        {
          Версия: versionInfo.versionNumber,
          Дата: versionInfo.createdAt || "",
          Изменение: versionInfo.summary.delta ?? "",
        },
      ]),
      "11 Изменения"
    );
  }

  const safeName = (project.name || "проект").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const ver = project.version > 1 ? `_v${project.version}` : "";
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  triggerDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Daogreen_Закупочный_лист_${safeName}${ver}.xlsx`
  );
}
