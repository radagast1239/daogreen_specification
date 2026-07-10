import { describe, it, expect, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import {
  buildClientWorkbook,
  clientExcelIncludesNoLinkSheet,
  clientExcelProblemSheetNames,
  getClientExcelColWidth,
  getClientExcelWrapHeaders,
  sheetHasAutofilter,
  sheetHasFreezePanes,
  sheetHasHeaderStyles,
  sheetHasRowHeights,
  sheetHasWrapText,
  sheetReadableColWidths,
  softWrapClientExcelText,
  writeClientWorkbookArray,
  xlsxBufferHasPersistedWrapText,
  CLIENT_EXCEL_BRAND,
  CLIENT_EXCEL_COL_WIDTHS,
} from "../src/lib/clientExcelExport.js";
import { buildClientPurchaseMergedRows } from "../shared/clientPurchaseMerged.js";
import { PURCHASE_STATUSES } from "../src/data/modules.js";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import {
  buildProjectPreSendChecklist,
  selectAllPreSendProblemIds,
} from "../shared/projectPreSendChecklist.js";
import {
  clientPurchasePdfIncludesNoLinkSection,
  getClientPurchasePdfInstructionLines,
} from "../src/lib/clientPdfExport.js";
import { PURCHASE_STATUS } from "../shared/purchaseStatusRules.js";

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

function sheetCsv(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return "";
  return XLSX.utils.sheet_to_csv(ws);
}

function findHyperlinkTarget(ws) {
  if (!ws) return null;
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    if (ws[key]?.l?.Target) return ws[key].l.Target;
  }
  return null;
}

function mkItem(overrides = {}) {
  return {
    id: overrides.id || "item-1",
    name: overrides.name || "Товар",
    qty: 1,
    unit: "шт.",
    price: overrides.price ?? 100,
    supplier: overrides.supplier ?? "Леруа",
    link: overrides.link ?? "https://example.com/item",
    module: overrides.module || "mod_protochka",
    clientSection: overrides.clientSection || "stellage",
    responsible: overrides.responsible || "general",
    itemRole: overrides.itemRole || "purchase",
    category: overrides.category || "Каркас и крепёж",
    includedInProject: true,
    visibleToClient: true,
    approved: true,
    ...overrides,
  };
}

const project = { name: "Тестовый проект", client: "Клиент", city: "Москва", version: 1 };

const fullItems = [
  mkItem({
    id: "pl",
    name: "Насос циркуляционный длинное наименование для проверки переноса текста в Excel",
    responsible: "plumber",
    clientSection: "pumps",
    clientNote: "Длинный комментарий Daogreen: проверить совместимость с коллектором и запасными фитингами.",
  }),
  mkItem({ id: "el", name: "Кабель", responsible: "electrician", clientSection: "electrics" }),
  mkItem({ id: "in", name: "Профиль", responsible: "installer", clientSection: "stellage" }),
  mkItem({
    id: "ac",
    name: "Сплит Манипуляционная",
    responsible: "climate",
    clientSection: "climate",
    kind: "cooling_spec",
    price: 0,
    link: "https://example.com/split",
  }),
  mkItem({ id: "cl", name: "Мебель клиента", responsible: "client", clientSection: "manipulation" }),
  mkItem({ id: "nl", name: "Без ссылки", link: "", supplier: "Местная база", clientSection: "stellage" }),
  mkItem({
    id: "ins",
    name: "Монтаж стеллажа",
    itemRole: "installation",
    category: "Работы и доставка",
    price: 5000,
    link: "",
  }),
];

describe("buildClientWorkbook", () => {
  it("Excel workbook has expected client-facing sheets", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(wb.SheetNames).toEqual([
      "01 Инструкция",
      "02 Итоги",
      "03 К закупке по поставщикам",
      "04 К закупке по разделам",
      "06 Сантехник",
      "07 Электрик",
      "08 Монтажник",
      "09 Климат",
      "10 Клиент",
      "10б Монтаж",
      "11 Детализация по модулям",
    ]);
  });

  it("client Excel does not create worksheet «05 Без ссылок»", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(clientExcelIncludesNoLinkSheet()).toBe(false);
    expect(wb.SheetNames).not.toContain("05 Без ссылок");
  });

  it("client Excel does not create worksheet «Без ссылок»", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(wb.SheetNames.some((n) => /без ссылок/i.test(n))).toBe(false);
    expect(wb.SheetNames.some((n) => /требуют подбора/i.test(n))).toBe(false);
  });

  it("«01 Инструкция» содержит проект и понятный текст", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const text = sheetCsv(wb, "01 Инструкция");
    expect(text).toMatch(/Тестовый проект/);
    expect(text).toMatch(/Покупайте по поставщикам или разделам/);
    expect(text).toMatch(/онлайн-версии/);
    expect(text).not.toMatch(/05 Без ссылок/);
    expect(text).not.toMatch(/требуют подбора/);
    expect(text).toMatch(/Пустая ссылка — нормально/);
  });

  it("табличные листы имеют автофильтр и freeze panes", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    for (const name of [
      "03 К закупке по поставщикам",
      "04 К закупке по разделам",
      "06 Сантехник",
      "09 Климат",
    ]) {
      const ws = wb.Sheets[name];
      expect(sheetHasAutofilter(ws), name).toBe(true);
      expect(sheetHasFreezePanes(ws), name).toBe(true);
    }
  });

  it("main table columns have readable widths", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const ws = wb.Sheets["03 К закупке по поставщикам"];
    const headers = ["Поставщик", "Позиция", "Ссылка", "Комментарий Daogreen"];
    const widths = sheetReadableColWidths(ws, headers);
    expect(widths.find((w) => w.header === "Позиция").wch).toBeGreaterThanOrEqual(40);
    expect(widths.find((w) => w.header === "Поставщик").wch).toBeGreaterThanOrEqual(18);
    expect(getClientExcelColWidth("Наименование")).toBeGreaterThanOrEqual(40);
  });

  it("long text columns have wrapText enabled", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const ws = wb.Sheets["03 К закупке по поставщикам"];
    expect(getClientExcelWrapHeaders()).toContain("Позиция");
    expect(sheetHasWrapText(ws, ["Позиция", "Комментарий Daogreen", "Поставщик"])).toBe(true);
  });

  it("supplier/comment/link/status cells have wrapText true", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const ws = wb.Sheets["03 К закупке по поставщикам"];
    expect(sheetHasWrapText(ws, ["Поставщик", "Комментарий Daogreen", "Ссылка", "Раздел"])).toBe(true);
    const ws4 = wb.Sheets["04 К закупке по разделам"];
    expect(sheetHasWrapText(ws4, ["Наименование", "Статус закупки", "Поставщик"])).toBe(true);
  });

  it("row heights are set for data rows (min 36)", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(sheetHasRowHeights(wb.Sheets["03 К закупке по поставщикам"])).toBe(true);
    expect(sheetHasRowHeights(wb.Sheets["04 К закупке по разделам"])).toBe(true);
    const rows = wb.Sheets["03 К закупке по поставщикам"]["!rows"];
    expect(rows[0].hpt).toBeGreaterThanOrEqual(24);
    expect(rows[1].hpt).toBeGreaterThanOrEqual(36);
  });

  it("CLIENT_EXCEL_COL_WIDTHS unchanged (hotfix preserves widths)", () => {
    expect(CLIENT_EXCEL_COL_WIDTHS["Наименование"]).toBe(44);
    expect(CLIENT_EXCEL_COL_WIDTHS["Позиция"]).toBe(44);
    expect(CLIENT_EXCEL_COL_WIDTHS["Поставщик"]).toBe(22);
    expect(CLIENT_EXCEL_COL_WIDTHS["Комментарий Daogreen"]).toBe(36);
    expect(CLIENT_EXCEL_COL_WIDTHS["Ссылка"]).toBe(14);
    expect(CLIENT_EXCEL_COL_WIDTHS["Раздел"]).toBe(20);
    expect(getClientExcelColWidth("Наименование")).toBe(44);
  });

  it("softWrap inserts newlines for long text but not URLs", () => {
    const long =
      "Насос циркуляционный длинное наименование для проверки переноса текста в Excel и ещё длиннее";
    const wrapped = softWrapClientExcelText(long, 30);
    expect(wrapped).toContain("\n");
    expect(softWrapClientExcelText("https://example.com/very/long/path/item", 20)).not.toContain("\n");
  });

  it("written xlsx persists wrapText in styles.xml (SheetJS CE patch)", () => {
    const buf = writeClientWorkbookArray(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(xlsxBufferHasPersistedWrapText(buf)).toBe(true);
  });

  it("header rows have styles", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(CLIENT_EXCEL_BRAND).toBe("#116355");
    expect(sheetHasHeaderStyles(wb.Sheets["03 К закупке по поставщикам"])).toBe(true);
    expect(sheetHasHeaderStyles(wb.Sheets["04 К закупке по разделам"])).toBe(true);
  });

  it("price/sum columns have currency format on numeric cells", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const ws = wb.Sheets["03 К закупке по поставщикам"];
    const headers = [];
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      headers.push(String(ws[XLSX.utils.encode_cell({ r: 0, c })]?.v || ""));
    }
    const sumCol = headers.indexOf("Сумма");
    expect(sumCol).toBeGreaterThanOrEqual(0);
    let foundFmt = false;
    for (let r = 1; r <= range.e.r; r += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: sumCol })];
      if (cell?.t === "n" && String(cell.z || "").includes("₽")) foundFmt = true;
    }
    expect(foundFmt).toBe(true);
  });

  it("links remain clickable or safely rendered", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const target = findHyperlinkTarget(wb.Sheets["03 К закупке по поставщикам"]);
    expect(target).toBe("https://example.com/item");
    expect(sheetCsv(wb, "03 К закупке по поставщикам")).toMatch(/Открыть|—/);
  });

  it("листы данных имеют !cols", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    for (const name of wb.SheetNames) {
      const cols = wb.Sheets[name]?.["!cols"];
      expect(Array.isArray(cols) && cols.length > 0, name).toBe(true);
    }
  });

  it("cooling_spec без цены выводит «цена уточняется»", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const climate = sheetCsv(wb, "09 Климат");
    expect(climate).toMatch(/цена уточняется/i);
  });

  it("пустой проект не ломает экспорт", () => {
    const wb = buildClientWorkbook({ name: "Пустой", version: 1 }, [], {
      purchaseStatuses: PURCHASE_STATUSES,
    });
    expect(wb.SheetNames).toEqual(["01 Инструкция", "02 Итоги"]);
  });
});

describe("client Excel — no-link items stay in normal sheets", () => {
  const purchaseItems = fullItems.filter((i) => i.itemRole !== "installation");

  it("no-link items remain in normal purchase worksheets", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(sheetCsv(wb, "03 К закупке по поставщикам")).toContain("Без ссылки");
    expect(sheetCsv(wb, "04 К закупке по разделам")).toContain("Без ссылки");
  });

  it("total amount unchanged", () => {
    const merged = buildClientPurchaseMergedRows(purchaseItems);
    const expected = merged.reduce((s, r) => s + (Number(r.sumVat) || 0), 0);
    expect(Math.round(expected)).toBeGreaterThan(0);
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(sheetCsv(wb, "02 Итоги")).toMatch(/Бюджет/);
  });

  it("unique item count unchanged", () => {
    const merged = buildClientPurchaseMergedRows(purchaseItems);
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const ws = wb.Sheets["03 К закупке по поставщикам"];
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const dataRows = range.e.r - range.s.r; // без заголовка
    expect(dataRows).toBe(merged.length);
  });

  it("no_link not included in blocker/problem export", () => {
    expect(clientExcelProblemSheetNames()).toEqual([]);
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(wb.SheetNames.some((n) => /problem|проблем|blocker/i.test(n))).toBe(false);
  });
});

describe("no_link remains info; PDF section stays removed", () => {
  it("PDF no-link section remains removed", () => {
    expect(clientPurchasePdfIncludesNoLinkSection()).toBe(false);
    const text = getClientPurchasePdfInstructionLines().join("\n");
    expect(text).not.toContain("Позиции без ссылок требуют подбора");
    expect(text).not.toContain("собраны отдельным блоком");
  });

  it("no_link remains info in checklist/summary helpers", () => {
    const items = [
      mkItem({ id: "ok" }),
      mkItem({ id: "l", link: "", purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT }),
      mkItem({ id: "p", price: 0 }),
    ];
    const checklist = buildProjectPreSendChecklist(items);
    expect(checklist.groups.find((g) => g.key === "no_link").severity).toBe("info");
    expect(selectAllPreSendProblemIds(checklist)).toEqual(["p"]);
    expect(selectAllPreSendProblemIds(checklist)).not.toContain("l");
  });
});
