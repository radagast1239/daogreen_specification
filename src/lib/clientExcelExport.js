import * as XLSX from "xlsx";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { buildClientPurchaseMergedRows, formatQty, groupBy } from "../store/helpers.js";
import { lineGross, isBoughtStatus } from "./itemHelpers.js";
import { rowsForResponsibleRole } from "./responsibleResolve.js";
import { getClientSections } from "../../shared/clientSections.js";
import {
  CLIENT_PRICE_MISSING,
  CLIENT_PRICE_TBD,
  formatClientLineTotal,
  formatClientUnitPrice,
  resolveClientPurchaseStatusLabel,
} from "../../shared/clientPurchaseRows.js";

export const CLIENT_EXCEL_BRAND = "#116355";
export const CLIENT_EXCEL_BRAND_RGB = "116355";
const RUB_NUMFMT = '#,##0" ₽"';

/** Читаемые ширины колонок (символы Excel). */
export const CLIENT_EXCEL_COL_WIDTHS = {
  "№": 5,
  Фото: 12,
  Наименование: 44,
  Позиция: 44,
  Описание: 36,
  "Комментарий Daogreen": 36,
  "Комментарий клиента": 32,
  "Откуда взялось": 28,
  "Кол-во": 10,
  "Кол-во всего": 12,
  Кол: 10,
  "Ед.": 8,
  Ед: 8,
  Цена: 12,
  Сумма: 14,
  "Факт. цена": 12,
  Поставщик: 22,
  Ссылка: 14,
  "Открыть товар": 12,
  "Статус закупки": 16,
  Раздел: 20,
  Подраздел: 18,
  Модуль: 22,
  Блок: 18,
  Текст: 90,
  Поле: 24,
  Значение: 36,
  Бюджет: 14,
  Куплено: 14,
  Осталось: 14,
  Готовность: 12,
};

/** Колонки с переносом текста. */
export const CLIENT_EXCEL_WRAP_HEADERS = [
  "Наименование",
  "Позиция",
  "Описание",
  "Комментарий Daogreen",
  "Комментарий клиента",
  "Откуда взялось",
  "Поставщик",
  "Ссылка",
  "Открыть товар",
  "Статус закупки",
  "Раздел",
  "Подраздел",
  "Модуль",
  "Текст",
  "Значение",
];

/**
 * Soft `\n` только для реально длинных полей.
 * Короткие ярлыки (Раздел/Статус) не режем — Excel wrapText справится.
 */
export const CLIENT_EXCEL_SOFT_WRAP_HEADERS = [
  "Наименование",
  "Позиция",
  "Описание",
  "Комментарий Daogreen",
  "Комментарий клиента",
  "Откуда взялось",
  "Поставщик",
  "Текст",
  "Значение",
];

const HEADER_FILL = { patternType: "solid", fgColor: { rgb: CLIENT_EXCEL_BRAND_RGB } };
const HEADER_FONT = { bold: true, color: { rgb: "FFFFFF" }, name: "Calibri", sz: 11 };
const BODY_FONT = { name: "Calibri", sz: 10 };
const ALT_FILL = { patternType: "solid", fgColor: { rgb: "F3F8F6" } };

export function getClientExcelColWidth(header) {
  return CLIENT_EXCEL_COL_WIDTHS[header] || (String(header).length > 18 ? 20 : 14);
}

export function getClientExcelWrapHeaders() {
  return [...CLIENT_EXCEL_WRAP_HEADERS];
}

/** Отдельный Excel-лист no_link больше не создаём (как в PDF). */
export function clientExcelIncludesNoLinkSheet() {
  return false;
}

/** Имена листов, которые считаются «проблемными» / blocker — no_link сюда не входит. */
export function clientExcelProblemSheetNames() {
  return [];
}

export function sheetHasAutofilter(ws) {
  return Boolean(ws?.["!autofilter"]?.ref);
}

export function sheetHasFreezePanes(ws) {
  if (ws?.["!freeze"]) return true;
  const view = ws?.["!views"]?.[0];
  return Boolean(view && (view.state === "frozen" || view.ySplit > 0));
}

export function sheetHasHeaderStyles(ws) {
  if (!ws?.["!ref"]) return false;
  const a1 = ws.A1;
  return Boolean(a1?.s?.fill?.fgColor?.rgb || a1?.s?.font?.bold);
}

export function sheetHasWrapText(ws, headerNames = []) {
  if (!ws?.["!ref"]) return false;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const wrapSet = new Set(headerNames.length ? headerNames : CLIENT_EXCEL_WRAP_HEADERS);
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(cell?.v != null ? String(cell.v) : "");
  }
  for (let r = range.s.r + 1; r <= Math.min(range.e.r, range.s.r + 8); r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      if (!wrapSet.has(headers[c - range.s.c])) continue;
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.s?.alignment?.wrapText) return true;
    }
  }
  return false;
}

export function sheetHasRowHeights(ws) {
  const rows = ws?.["!rows"];
  if (!Array.isArray(rows) || rows.length < 2) return false;
  return rows.slice(1).every((r) => Number(r?.hpt) >= 36);
}

/**
 * Мягкий перенос длинного текста (fallback для SheetJS CE).
 * URL не трогаем. Числа не трогаем.
 */
export function softWrapClientExcelText(text, widthChars = 40) {
  const raw = text == null ? "" : String(text);
  if (!raw) return raw;
  if (typeof text === "number") return text;
  const width = Math.max(8, Number(widthChars) || 40);
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return raw;
  // Не режем короткие ярлыки — только заметно длиннее колонки.
  if (raw.length <= width + 4) return raw;
  if (raw.includes("\n")) return raw;

  const parts = [];
  let line = "";
  const tokens = raw.split(/(\s+)/);
  for (const token of tokens) {
    if (!token) continue;
    if (token.length > width && !/\s/.test(token)) {
      if (line) {
        parts.push(line);
        line = "";
      }
      // длинный токен без пробелов — режем по ширине, но не URL
      for (let i = 0; i < token.length; i += width) {
        parts.push(token.slice(i, i + width));
      }
      continue;
    }
    if ((line + token).length > width && line.trim()) {
      parts.push(line.replace(/\s+$/g, ""));
      line = token.replace(/^\s+/g, "");
    } else {
      line += token;
    }
  }
  if (line) parts.push(line.replace(/\s+$/g, ""));
  // Доп. разрывы после . ; если строка всё ещё длинная
  return parts
    .map((p) => {
      if (p.length <= width * 1.4) return p;
      return p.replace(/([.;])\s+/g, "$1\n");
    })
    .join("\n");
}

export function sheetReadableColWidths(ws, headerNames) {
  const cols = ws?.["!cols"] || [];
  return (headerNames || []).map((h, i) => ({
    header: h,
    wch: cols[i]?.wch ?? getClientExcelColWidth(h),
  }));
}

/** Включить автофильтр по всему диапазону листа */
function withAutofilter(ws) {
  if (ws && ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
  return ws;
}

function withFreezeHeader(ws) {
  if (!ws?.["!ref"]) return ws;
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activeCell: "A2", state: "frozen" };
  ws["!views"] = [
    {
      state: "frozen",
      ySplit: 1,
      topLeftCell: "A2",
      activeCell: "A2",
    },
  ];
  return ws;
}

function headerStyle() {
  return {
    fill: HEADER_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: {
      top: { style: "thin", color: { rgb: "0D4A40" } },
      bottom: { style: "thin", color: { rgb: "0D4A40" } },
      left: { style: "thin", color: { rgb: "0D4A40" } },
      right: { style: "thin", color: { rgb: "0D4A40" } },
    },
  };
}

function bodyStyle({ wrap = false, align = "left", alt = false } = {}) {
  return {
    font: BODY_FONT,
    alignment: {
      horizontal: align,
      vertical: "top",
      wrapText: wrap,
    },
    fill: alt ? ALT_FILL : undefined,
    border: {
      top: { style: "hair", color: { rgb: "D7E5E1" } },
      bottom: { style: "hair", color: { rgb: "D7E5E1" } },
      left: { style: "hair", color: { rgb: "D7E5E1" } },
      right: { style: "hair", color: { rgb: "D7E5E1" } },
    },
  };
}

function estimateRowHeight(values, headers) {
  let maxLines = 1;
  for (let i = 0; i < values.length; i += 1) {
    const h = headers[i];
    if (!CLIENT_EXCEL_WRAP_HEADERS.includes(h)) continue;
    const text = String(values[i] ?? "");
    if (!text) continue;
    const width = getClientExcelColWidth(h) || 14;
    const explicit = text.split("\n").length;
    const byWidth = Math.ceil(text.replace(/\n/g, "").length / Math.max(width, 8));
    const lines = Math.max(explicit, byWidth);
    maxLines = Math.max(maxLines, Math.min(lines, 6));
  }
  // Минимум 36pt, чтобы перенос был виден; длинные — до 80.
  if (maxLines <= 1) return 36;
  if (maxLines === 2) return 48;
  if (maxLines === 3) return 60;
  return Math.min(36 + maxLines * 8, 80);
}

function applyColWidths(ws, headers, overrides = {}) {
  ws["!cols"] = headers.map((h) => ({
    wch: overrides[h] || getClientExcelColWidth(h),
  }));
}

function applyRowHeights(ws, headers, bodyRows) {
  const rows = [{ hpt: 28 }]; // header
  for (const row of bodyRows) {
    const values = headers.map((h) => row[h] ?? "");
    rows.push({ hpt: estimateRowHeight(values, headers) });
  }
  ws["!rows"] = rows;
}

function applySoftWrapToCells(ws, headers, wrapSet) {
  if (!ws?.["!ref"]) return;
  const softSet = new Set(CLIENT_EXCEL_SOFT_WRAP_HEADERS);
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const header = headers[c] || "";
      if (!softSet.has(header)) continue;
      if (wrapSet.size && !wrapSet.has(header)) continue;
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (!cell || cell.t === "n" || typeof cell.v === "number") continue;
      if (cell.v == null || cell.v === "") continue;
      const width = getClientExcelColWidth(header);
      const next = softWrapClientExcelText(cell.v, width);
      if (next !== cell.v) {
        cell.v = next;
        cell.t = "s";
        cell.w = undefined;
      }
    }
  }
}

function applyPresentation(ws, headers, bodyRows, { filter = false, freeze = true, wrapHeaders = CLIENT_EXCEL_WRAP_HEADERS } = {}) {
  if (!ws?.["!ref"]) return ws;
  const wrapSet = new Set(wrapHeaders);
  const numericAlign = new Set(["№", "Кол-во", "Кол-во всего", "Кол", "Цена", "Сумма", "Факт. цена", "Ед.", "Ед"]);
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // Soft-wrap до оценки высоты строк (SheetJS CE не пишет wrapText в файл).
  applySoftWrapToCells(ws, headers, wrapSet);

  // Синхронизируем bodyRows с soft-wrap, чтобы !rows считались по фактическому тексту.
  const syncedRows = bodyRows.map((row, idx) => {
    const next = { ...row };
    for (let c = 0; c < headers.length; c += 1) {
      const h = headers[c];
      if (!wrapSet.has(h)) continue;
      const ref = XLSX.utils.encode_cell({ r: range.s.r + 1 + idx, c });
      if (ws[ref]?.v != null) next[h] = ws[ref].v;
    }
    return next;
  });

  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const ref = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = ws[ref] || { t: "s", v: headers[c] || "" };
    cell.s = headerStyle();
    ws[ref] = cell;
  }

  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const alt = (r - range.s.r) % 2 === 0;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const header = headers[c] || "";
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (!cell) continue;
      const isNum = numericAlign.has(header) || cell.t === "n" || typeof cell.v === "number";
      const align = numericAlign.has(header) ? "center" : "left";
      // Текст — всегда wrap; числа — wrap только если колонка в wrap-списке (обычно нет).
      const wrap = !isNum || wrapSet.has(header);
      cell.s = bodyStyle({ wrap, align, alt });
      if (wrap) cell.s.alignment.wrapText = true;
    }
  }

  applyColWidths(ws, headers);
  applyRowHeights(ws, headers, syncedRows);
  if (freeze) withFreezeHeader(ws);
  if (filter) withAutofilter(ws);

  // Печать: альбомная, вписать по ширине
  ws["!pageSetup"] = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  ws["!printHeader"] = 1;

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

function applyRubFormats(ws, headerNames, numericHeaders = ["Цена", "Сумма", "Бюджет", "Куплено", "Осталось", "Факт. цена"]) {
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
      if (!cell) continue;
      if (cell.t === "n") {
        cell.z = RUB_NUMFMT;
        continue;
      }
      if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
        cell.t = "n";
        cell.z = RUB_NUMFMT;
      }
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
    "Открыть товар": r.link ? "Открыть" : "—",
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
    const prev = ws[ref] || {};
    ws[ref] = {
      ...prev,
      v: "Открыть",
      t: "s",
      l: { Target: link, Tooltip: link },
    };
  }

  applyRubFormats(ws, MERGED_HEADERS, ["Сумма", "Факт. цена", "Цена"]);
  return applyPresentation(ws, MERGED_HEADERS, dataRows, { filter: true, freeze: true });
}

function sheetFromRows(rows, colWidths = {}, { filter = false, freeze = false } = {}) {
  if (!rows?.length) return null;
  const headers = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const data = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  applyRubFormats(ws, headers);
  applyPresentation(ws, headers, rows, { filter, freeze });
  // allow explicit overrides after presentation defaults
  if (Object.keys(colWidths).length) {
    ws["!cols"] = headers.map((h) => ({
      wch: colWidths[h] || getClientExcelColWidth(h),
    }));
  }
  return ws;
}

function sheetFromRowsWithLinks(rows, linkHeader = "Ссылка", linkText = "Открыть", colWidths = {}) {
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
      const prev = ws[ref] || {};
      ws[ref] = { ...prev, v: linkText, t: "s", l: { Target: link, Tooltip: link } };
    }
  }
  applyRubFormats(ws, headers, ["Сумма", "Цена"]);
  applyPresentation(ws, headers, rows, { filter: true, freeze: true });
  if (Object.keys(colWidths).length) {
    ws["!cols"] = headers.map((h) => ({
      wch: colWidths[h] || getClientExcelColWidth(h),
    }));
  }
  return ws;
}

function instructionSheet(project, items, branding, merged) {
  const budget = (items || []).reduce((s, i) => s + lineGross(i), 0);
  const unique = merged?.length ?? 0;
  const rows = [
    {
      Блок: "Проект",
      Текст: project?.name || "—",
    },
    {
      Блок: "Клиент",
      Текст: project?.client || "—",
    },
    {
      Блок: "Версия",
      Текст: project?.version > 1 ? `v${project.version}` : "v1",
    },
    {
      Блок: "Дата",
      Текст: new Date().toLocaleDateString("ru-RU"),
    },
    {
      Блок: "Итого",
      Текст: `${Math.round(budget)} ₽ · уникальных позиций: ${unique}`,
    },
    {
      Блок: "Компания",
      Текст: branding?.companyName || "Daogreen",
    },
    {
      Блок: "Как пользоваться",
      Текст:
        "Покупайте по поставщикам или разделам. Статусы и актуальные ссылки можно смотреть в онлайн-версии.",
    },
    {
      Блок: "О файле",
      Текст:
        "Это рабочий список закупки Daogreen. Одинаковые позиции из разных модулей объединены в одну строку с общим количеством — не покупайте дубликаты.",
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
      Текст:
        "Позиции без ссылки на товар остаются в обычных листах закупки. Пустая ссылка — нормально (телефон, завод, местная база), отдельный лист для них не нужен.",
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
      Блок: "Цена уточняется",
      Текст:
        `В колонках «Цена» и «Сумма» может стоять «${CLIENT_PRICE_TBD}» или «${CLIENT_PRICE_MISSING}» — это не ошибка. Так отмечены позиции без цены в базе или с ручным подбором (часто климат).`,
    },
    {
      Блок: "Если товара нет",
      Текст:
        "Если позиции нет в наличии или не подходит — отметьте в онлайн-версии «Нужна помощь» или напишите Daogreen: подберём замену.",
    },
  ];
  return sheetFromRows(rows, { Блок: 18, Текст: 92 }, { freeze: true });
}

function summarySheet(project, items, branding, purchaseStatuses, merged) {
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
    { Поле: "Уникальных к закупке", Значение: merged?.length ?? "" },
  ];
  return sheetFromRows(rows, { Поле: 26, Значение: 28 }, { freeze: true });
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
    Ссылка: r.link ? "Открыть" : "—",
    _link: r.link || "",
    Раздел: r.clientSectionLabel || "",
    "Комментарий Daogreen": r.clientNote || "",
  }));
  return sheetFromRowsWithLinks(rows, "Ссылка", "Открыть", {
    Поставщик: 22,
    Позиция: 44,
    Раздел: 20,
    "Комментарий Daogreen": 36,
    Ссылка: 12,
  });
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
      Ссылка: "",
      _link: "",
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
        Ссылка: it.link ? "Открыть" : "—",
        _link: it.link || "",
      });
    }
  }
  return sheetFromRowsWithLinks(rows, "Ссылка", "Открыть", {
    Модуль: 22,
    Наименование: 44,
  });
}

export function buildClientWorkbook(project, items, { purchaseStatuses = [], branding = {}, versionInfo } = {}) {
  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const installItems = (items || []).filter(
    (i) => i.itemRole === "installation" || i.category === "Работы и доставка"
  );
  const merged = buildClientPurchaseMergedRows(purchaseItems);
  const wb = XLSX.utils.book_new();

  const append = (ws, name) => {
    if (ws) XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  append(instructionSheet(project, purchaseItems, branding, merged), "01 Инструкция");
  append(summarySheet(project, purchaseItems, branding, purchaseStatuses, merged), "02 Итоги");
  append(supplierMergedSheet(merged), "03 К закупке по поставщикам");
  append(mergedByCategorySheet(merged, purchaseStatuses), "04 К закупке по разделам");
  // no_link позиции остаются только в обычных листах 03/04/… — отдельный «05 Без ссылок» не создаём.

  for (const [sheetName, role] of [
    ["06 Сантехник", "plumber"],
    ["07 Электрик", "electrician"],
    ["08 Монтажник", "installer"],
    ["09 Климат", "climate"],
    ["10 Клиент", "client"],
  ]) {
    const roleMerged = mergedForRole(purchaseItems, role);
    if (roleMerged.length) append(sheetFromMergedRows(roleMerged, purchaseStatuses), sheetName);
  }

  if (installItems.length) {
    append(sheetFromMergedRows(buildClientPurchaseMergedRows(installItems), purchaseStatuses), "10б Монтаж");
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

/** SheetJS CE не пишет wrapText в xlsx — добавляем alignment в cellXfs OOXML. */
export function injectWrapTextIntoStylesXml(stylesXml) {
  return String(stylesXml).replace(/<cellXfs([^>]*)>([\s\S]*?)<\/cellXfs>/, (_full, attrs, inner) => {
    const patched = inner.replace(/<xf\b([^>]*?)(\/>|>([\s\S]*?)<\/xf>)/g, (m, xfAttrs, endOrBody, body) => {
      if (/wrapText\s*=\s*"1"/.test(m)) return m;
      const withAlignFlag = /\bapplyAlignment\s*=/.test(xfAttrs)
        ? xfAttrs.replace(/\bapplyAlignment\s*=\s*"[^"]*"/, 'applyAlignment="1"')
        : `${xfAttrs} applyAlignment="1"`;
      if (endOrBody === "/>") {
        return `<xf${withAlignFlag}><alignment wrapText="1" vertical="top"/></xf>`;
      }
      if (/<alignment\b/.test(body || "")) {
        const nextBody = body.replace(/<alignment\b([^>]*?)(\/>|>)/, (_a, aAttrs, aEnd) => {
          let attrs2 = aAttrs;
          if (!/\bwrapText\s*=/.test(attrs2)) attrs2 += ' wrapText="1"';
          if (!/\bvertical\s*=/.test(attrs2)) attrs2 += ' vertical="top"';
          return aEnd === "/>" ? `<alignment${attrs2}/>` : `<alignment${attrs2}>`;
        });
        return `<xf${withAlignFlag}>${nextBody}</xf>`;
      }
      return `<xf${withAlignFlag}><alignment wrapText="1" vertical="top"/>${body || ""}</xf>`;
    });
    return `<cellXfs${attrs}>${patched}</cellXfs>`;
  });
}

export function xlsxBufferHasPersistedWrapText(buf) {
  try {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const files = unzipSync(u8);
    const styles = files["xl/styles.xml"];
    if (!styles) return false;
    return /wrapText\s*=\s*"1"/.test(strFromU8(styles));
  } catch {
    return false;
  }
}

/** Пропатчить готовый xlsx: wrapText в styles.xml (browser + node). */
export function patchClientExcelXlsxArray(arrayBuf) {
  const u8 = arrayBuf instanceof Uint8Array ? arrayBuf : new Uint8Array(arrayBuf);
  const files = unzipSync(u8);
  const stylesPath = "xl/styles.xml";
  if (files[stylesPath]) {
    const xml = strFromU8(files[stylesPath]);
    files[stylesPath] = strToU8(injectWrapTextIntoStylesXml(xml));
  }
  return zipSync(files, { level: 6 });
}

/** Собрать ArrayBuffer клиентского Excel с persistent wrapText. */
export function writeClientWorkbookArray(project, items, options = {}) {
  const wb = buildClientWorkbook(project, items, options);
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return patchClientExcelXlsxArray(raw);
}

export function downloadClientWorkbook(project, items, options = {}) {
  const projectRef = project || { name: "проект", version: 1 };
  const safeName = (projectRef.name || "проект").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const ver = projectRef.version > 1 ? `_v${projectRef.version}` : "";
  const out = writeClientWorkbookArray(project, items, options);
  triggerDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Daogreen_Закупочный_лист_${safeName}${ver}.xlsx`
  );
}
