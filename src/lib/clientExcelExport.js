import * as XLSX from "xlsx";
import { buildClientPurchaseMergedRows, formatQty, groupBy } from "../store/helpers.js";
import { lineGross, isBoughtStatus } from "./itemHelpers.js";
import { rowsForResponsibleRole } from "./responsibleResolve.js";
import { getClientSections, groupByClientSection } from "../../shared/clientSections.js";
import {
  CLIENT_PRICE_MISSING,
  CLIENT_PRICE_TBD,
  formatClientLineTotal,
  formatClientUnitPrice,
  resolveClientPurchaseStatusLabel,
} from "../../shared/clientPurchaseRows.js";

const RUB_NUMFMT = '#,##0" ₽"';

/** Включить автофильтр по всему диапазону листа */
function withAutofilter(ws) {
  if (ws && ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
  return ws;
}

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

function statusLabel(rowOrStatus, purchaseStatuses) {
  if (rowOrStatus && typeof rowOrStatus === "object" && !Array.isArray(rowOrStatus)) {
    return resolveClientPurchaseStatusLabel(rowOrStatus);
  }
  const id = rowOrStatus;
  return purchaseStatuses.find((s) => s.id === id)?.label || resolveClientPurchaseStatusLabel(id);
}

function applyRubFormats(ws, headerNames, numericHeaders = ["Цена", "Сумма", "Бюджет", "Куплено", "Осталось"]) {
  if (!ws?.["!ref"]) return ws;
  const cols = numericHeaders
    .map((h) => headerNames.indexOf(h))
    .filter((i) => i >= 0);
  if (!cols.length) return ws;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    for (const c of cols) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (!cell || cell.t !== "n") continue;
      cell.z = RUB_NUMFMT;
    }
  }
  return ws;
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
  "Статус закупки",
  "Факт. цена",
  "Откуда взялось",
  "Комментарий Daogreen",
  "Комментарий клиента",
];

function mergedDataRow(r, index, purchaseStatuses) {
  const rep = r.sourceItems?.[0];
  const unitPrice = formatClientUnitPrice(r);
  const lineTotal = formatClientLineTotal(r);
  return {
    "№": index + 1,
    Раздел: r.clientSectionLabel || "",
    Подраздел: r.clientSubsection || "",
    Наименование: r.name,
    "Кол-во всего": formatQty(r.qty, r.unit),
    "Ед.": r.unit || "шт.",
    Цена: unitPrice,
    Сумма: lineTotal,
    Поставщик: r.supplier || "",
    "Открыть товар": r.link ? "Открыть товар" : "без ссылки",
    _link: r.link || "",
    "Статус закупки": statusLabel(r, purchaseStatuses),
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
    if (h === "Наименование" || h === "Откуда взялось") return { wch: 40 };
    if (h === "Комментарий Daogreen" || h === "Комментарий клиента") return { wch: 30 };
    if (h === "Раздел" || h === "Подраздел") return { wch: 18 };
    if (h === "Открыть товар") return { wch: 15 };
    if (h === "№") return { wch: 5 };
    return { wch: 14 };
  });
  applyRubFormats(ws, MERGED_HEADERS, ["Сумма", "Факт. цена"]);
  return ws;
}

function sheetFromRows(rows, colWidths = {}) {
  if (!rows?.length) return null;
  const headers = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const data = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = headers.map((h) => ({ wch: colWidths[h] || (h === "Наименование" ? 42 : 14) }));
  applyRubFormats(ws, headers);
  return ws;
}

function sheetFromRowsWithLinks(rows, linkHeader = "Ссылка", linkText = "Открыть товар", colWidths = {}) {
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
  ws["!cols"] = headers.map((h) => ({
    wch: colWidths[h] || (h === "Позиция" || h === "Наименование" ? 42 : 14),
  }));
  applyRubFormats(ws, headers, ["Сумма"]);
  return ws;
}

function instructionSheet() {
  const rows = [
    {
      Блок: "О файле",
      Текст:
        "Это рабочий список закупки Daogreen. Его можно открыть в Excel или Google Таблицах и использовать параллельно с онлайн-версией по ссылке клиента.",
    },
    {
      Блок: "О файле",
      Текст:
        "Одинаковые позиции из разных модулей проекта объединены в одну строку с общим количеством — не покупайте дубликаты.",
    },
    {
      Блок: "Как пользоваться",
      Текст: "Начните с листа «03 К закупке по поставщикам» — удобно идти магазин за магазином.",
    },
    {
      Блок: "Как пользоваться",
      Текст: "Лист «04 К закупке по разделам» — тот же список, сгруппированный по блокам фермы.",
    },
    {
      Блок: "Как пользоваться",
      Текст: "Лист «05 Без ссылок» — позиции без ссылки или поставщика, их нужно подобрать вместе с Daogreen.",
    },
    {
      Блок: "Как пользоваться",
      Текст:
        "Листы 06–10 — срезы по ответственным: 06 Сантехник, 07 Электрик, 08 Монтажник, 09 Климат, 10 Клиент.",
    },
    {
      Блок: "Как пользоваться",
      Текст: "Лист «10б Монтаж» — монтажные работы (если есть в проекте).",
    },
    {
      Блок: "Как пользоваться",
      Текст: "Лист «11 Детализация по модулям» — для проверки расчёта, не для закупки.",
    },
    {
      Блок: "Как пользоваться",
      Текст: "В онлайн-версии отмечайте статусы — они сохраняются автоматически при следующем открытии ссылки.",
    },
    {
      Блок: "Цена уточняется",
      Текст:
        `В колонках «Цена» и «Сумма» может стоять «${CLIENT_PRICE_TBD}» или «${CLIENT_PRICE_MISSING}» — это не ошибка. Так отмечены позиции без цены в базе или с ручным подбором (часто климат).`,
    },
    {
      Блок: "Если товара нет",
      Текст:
        "Если позиции нет в наличии или не подходит — отметьте в онлайн-версии «Нужна помощь» или напишите Daogreen: подберём замену.",
    },
    {
      Блок: "Статусы",
      Текст: "Не заказано / Не куплено — позиция ещё не куплена.",
    },
    {
      Блок: "Статусы",
      Текст: "Заказано — оплачено или заказано, ожидается доставка.",
    },
    {
      Блок: "Статусы",
      Текст: "Куплено — получено на объект.",
    },
    {
      Блок: "Статусы",
      Текст: "Уже есть — позиция уже есть на объекте, покупать не нужно.",
    },
    {
      Блок: "Статусы",
      Текст: "Нужна помощь — нужна проверка или замена Daogreen.",
    },
    {
      Блок: "Статусы",
      Текст:
        "Цена уточняется — позиция рассчитана автоматически или требует ручного подбора (часто на листе «09 Климат»).",
    },
  ];
  return sheetFromRows(rows, { Блок: 16, Текст: 88 });
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
  return sheetFromRows(rows, { Поле: 22, Значение: 18 });
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
  return sheetFromRows(rows, { Раздел: 28, Сумма: 16 });
}

function mergedByCategorySheet(merged, purchaseStatuses) {
  const order = [...getClientSections().map((s) => s.label), "Уточнить категорию", "Прочее"];
  const sorted = [...merged].sort((a, b) => {
    const la = a.clientSectionLabel || "";
    const lb = b.clientSectionLabel || "";
    const ia = order.indexOf(la);
    const ib = order.indexOf(lb);
    if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    const sub = (a.clientSubsection || "").localeCompare(b.clientSubsection || "", "ru");
    if (sub !== 0) return sub;
    return (a.name || "").localeCompare(b.name || "", "ru");
  });
  return sheetFromMergedRows(sorted, purchaseStatuses);
}

function supplierMergedSheet(merged) {
  const rows = merged.map((r) => ({
    Поставщик: r.supplier || "—",
    Позиция: r.name,
    "Кол-во": formatQty(r.qty, r.unit),
    "Ед.": r.unit || "шт.",
    Цена: formatClientUnitPrice(r),
    Сумма: formatClientLineTotal(r),
    Ссылка: r.link ? "Открыть товар" : "без ссылки",
    _link: r.link || "",
    Раздел: r.clientSectionLabel || "",
    "Комментарий Daogreen": r.clientNote || "",
  }));
  return sheetFromRowsWithLinks(rows, "Ссылка", "Открыть товар", {
    Поставщик: 18,
    Позиция: 42,
    Раздел: 20,
    "Комментарий Daogreen": 36,
  });
}

/** Лист «Без ссылок / требует подбора»: строки без ссылки или без поставщика */
function noLinkSheet(merged, purchaseStatuses) {
  const rows = merged.filter((r) => !(r.link || "").trim() || !(r.supplier || "").trim());
  if (!rows.length) return null;
  const out = rows.map((r, i) => ({
    "№": i + 1,
    Наименование: r.name,
    "Кол-во": formatQty(r.qty, r.unit),
    "Ед.": r.unit || "шт.",
    Раздел: r.clientSectionLabel || "",
    Поставщик: r.supplier || "— нет поставщика —",
    Проблема: !(r.link || "").trim()
      ? (!(r.supplier || "").trim() ? "без ссылки и поставщика" : "без ссылки")
      : "без поставщика",
    "Статус закупки": statusLabel(r, purchaseStatuses),
  }));
  return sheetFromRows(out, { Наименование: 42, Проблема: 24, Поставщик: 22, Раздел: 18 });
}

function mergedForRole(items, role) {
  return rowsForResponsibleRole(buildClientPurchaseMergedRows(items), role);
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
      "Статус закупки": "",
    });
    for (const it of list) {
      n += 1;
      rows.push({
        "№": n,
        Модуль: mod || "",
        Наименование: it.name,
        Ед: it.unit,
        Кол: formatQty(it.qty, it.unit),
        Цена: it.price,
        Сумма: Math.round(lineGross(it)),
        Поставщик: it.supplier || "",
        "Статус закупки": statusLabel(it, purchaseStatuses),
        Ссылка: it.link ? "Открыть товар" : "без ссылки",
        _link: it.link || "",
      });
    }
  }
  return sheetFromRowsWithLinks(rows, "Ссылка", "Открыть товар", {
    Модуль: 22,
    Наименование: 40,
  });
}

export function buildClientWorkbook(project, items, { purchaseStatuses = [], branding = {}, versionInfo } = {}) {
  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const installItems = (items || []).filter(
    (i) => i.itemRole === "installation" || i.category === "Работы и доставка"
  );
  const merged = buildClientPurchaseMergedRows(purchaseItems);
  const wb = XLSX.utils.book_new();

  const append = (ws, name, filter = false) => {
    if (ws) XLSX.utils.book_append_sheet(wb, filter ? withAutofilter(ws) : ws, name.slice(0, 31));
  };

  append(instructionSheet(), "01 Инструкция");
  append(summarySheet(project, purchaseItems, branding, purchaseStatuses), "02 Итоги");
  append(supplierMergedSheet(merged), "03 К закупке по поставщикам", true);
  append(mergedByCategorySheet(merged, purchaseStatuses), "04 К закупке по разделам", true);
  append(noLinkSheet(merged, purchaseStatuses), "05 Без ссылок", true);

  for (const [sheetName, role] of [
    ["06 Сантехник", "plumber"],
    ["07 Электрик", "electrician"],
    ["08 Монтажник", "installer"],
    ["09 Климат", "climate"],
    ["10 Клиент", "client"],
  ]) {
    const roleMerged = mergedForRole(purchaseItems, role);
    if (roleMerged.length) append(sheetFromMergedRows(roleMerged, purchaseStatuses), sheetName, true);
  }

  if (installItems.length) {
    append(sheetFromMergedRows(buildClientPurchaseMergedRows(installItems), purchaseStatuses), "10б Монтаж", true);
  }

  append(moduleDetailSheet(purchaseItems, project, purchaseStatuses), "11 Детализация по модулям");

  if (versionInfo?.summary) {
    append(
      sheetFromRows([
        {
          Версия: versionInfo.versionNumber,
          Дата: versionInfo.createdAt || "",
          Изменение: versionInfo.summary.delta ?? "",
        },
      ]),
      "12 Изменения"
    );
  }

  return wb;
}

export function downloadClientWorkbook(project, items, options = {}) {
  const wb = buildClientWorkbook(project, items, options);
  const { branding = {}, versionInfo } = options;
  const projectRef = project || { name: "проект", version: 1 };
  const safeName = (projectRef.name || "проект").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const ver = projectRef.version > 1 ? `_v${projectRef.version}` : "";
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  triggerDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Daogreen_Закупочный_лист_${safeName}${ver}.xlsx`
  );
}
