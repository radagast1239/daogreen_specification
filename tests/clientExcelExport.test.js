import { describe, it, expect, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { buildClientWorkbook } from "../src/lib/clientExcelExport.js";
import { PURCHASE_STATUSES } from "../src/data/modules.js";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";

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
    ...overrides,
  };
}

const project = { name: "Тестовый проект", client: "Клиент", city: "Москва", version: 1 };

const fullItems = [
  mkItem({ id: "pl", name: "Насос", responsible: "plumber", clientSection: "pumps" }),
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
  mkItem({ id: "nl", name: "Без ссылки", link: "", supplier: "", clientSection: "stellage" }),
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
  it("содержит листы в правильном порядке", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    expect(wb.SheetNames).toEqual([
      "01 Инструкция",
      "02 Итоги",
      "03 К закупке по поставщикам",
      "04 К закупке по разделам",
      "05 Без ссылок",
      "06 Сантехник",
      "07 Электрик",
      "08 Монтажник",
      "09 Климат",
      "10 Клиент",
      "10б Монтаж",
      "11 Детализация по модулям",
    ]);
  });

  it("«01 Инструкция» содержит обновлённую нумерацию и «Цена уточняется»", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const text = sheetCsv(wb, "01 Инструкция");
    expect(text).toMatch(/06 Сантехник/);
    expect(text).toMatch(/07 Электрик/);
    expect(text).toMatch(/08 Монтажник/);
    expect(text).toMatch(/09 Климат/);
    expect(text).toMatch(/10 Клиент/);
    expect(text).toMatch(/10б Монтаж/);
    expect(text).toMatch(/11 Детализация по модулям/);
    expect(text).toMatch(/Цена уточняется/);
    expect(text).toMatch(/объединены в одну строку/);
  });

  it("листы 03–10б с таблицами имеют автофильтр", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    for (const name of [
      "03 К закупке по поставщикам",
      "04 К закупке по разделам",
      "05 Без ссылок",
      "06 Сантехник",
      "07 Электрик",
      "08 Монтажник",
      "09 Климат",
      "10 Клиент",
      "10б Монтаж",
    ]) {
      const ws = wb.Sheets[name];
      expect(ws?.["!autofilter"]?.ref, name).toBeTruthy();
    }
  });

  it("листы данных имеют !cols", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    for (const name of wb.SheetNames) {
      const cols = wb.Sheets[name]?.["!cols"];
      expect(Array.isArray(cols) && cols.length > 0, name).toBe(true);
    }
  });

  it("гиперссылка «Открыть товар» содержит Target", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const target = findHyperlinkTarget(wb.Sheets["03 К закупке по поставщикам"]);
    expect(target).toBe("https://example.com/item");
  });

  it("cooling_spec без цены выводит «цена уточняется»", () => {
    const wb = buildClientWorkbook(project, fullItems, { purchaseStatuses: PURCHASE_STATUSES });
    const climate = sheetCsv(wb, "09 Климат");
    expect(climate).toMatch(/цена уточняется/i);
    expect(climate).not.toMatch(/,0,/);
  });

  it("пустой проект не ломает экспорт", () => {
    const wb = buildClientWorkbook({ name: "Пустой", version: 1 }, [], {
      purchaseStatuses: PURCHASE_STATUSES,
    });
    expect(wb.SheetNames).toEqual(["01 Инструкция", "02 Итоги"]);
    expect(sheetCsv(wb, "01 Инструкция")).toContain("Цена уточняется");
  });
});
