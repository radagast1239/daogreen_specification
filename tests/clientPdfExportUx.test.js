import { describe, expect, it } from "vitest";
import { formatQty } from "../src/store/helpers.js";
import {
  CLIENT_PDF_EXPORT_OPTIONS,
  DEFAULT_CLIENT_PDF_OPTION,
  pdfExportOptionStats,
} from "../src/lib/clientPdfExportMeta.js";
import { groupRowsBySupplier, rowsWithoutLink, clientPdfMoneyOrTbd, getShortPdfTableHead } from "../src/lib/clientPdfExport.js";

describe("formatQty — клиентское количество", () => {
  it("не выводит 10.10 шт (округляет вверх для штук)", () => {
    expect(formatQty(10.1, "шт.")).toBe("11");
    expect(formatQty(10.1, "шт")).toBe("11");
    expect(formatQty(10.9, "шт.")).not.toContain(".");
  });

  it("целые штуки остаются целыми", () => {
    expect(formatQty(10, "шт.")).toBe("10");
    expect(formatQty(10.0, "шт.")).toBe("10");
  });

  it("пустая единица трактуется как штуки", () => {
    expect(formatQty(3.2, "")).toBe("4");
  });

  it("нештучные единицы убирают хвостовые нули", () => {
    expect(formatQty(10.1, "м.п.")).toBe("10,1");
    expect(formatQty(10.0, "м.п.")).toBe("10");
    expect(formatQty(2.5, "кг")).toBe("2,5");
  });

  it("никогда не даёт вид 10.10", () => {
    for (const [q, u] of [[10.1, "шт."], [10.1, "м"], [0.1, "шт."], [12.34, "л"]]) {
      expect(formatQty(q, u)).not.toMatch(/\.\d0$/);
    }
  });
});

describe("PDF export options", () => {
  it("по умолчанию выбран закупочный PDF для клиента, а не полный комплект", () => {
    expect(DEFAULT_CLIENT_PDF_OPTION).toBe("client_purchase");
    const def = CLIENT_PDF_EXPORT_OPTIONS.find((o) => o.id === DEFAULT_CLIENT_PDF_OPTION);
    expect(def.recommended).toBe(true);
    expect(def.group).toBe("primary");
  });

  it("полный комплект не рекомендован по умолчанию", () => {
    const full = CLIENT_PDF_EXPORT_OPTIONS.find((o) => o.id === "client_full");
    expect(full.recommended).toBe(false);
  });

  it("есть вариант по поставщикам", () => {
    expect(CLIENT_PDF_EXPORT_OPTIONS.some((o) => o.id === "supplier")).toBe(true);
  });

  it("специалисты сгруппированы отдельно", () => {
    const specialists = CLIENT_PDF_EXPORT_OPTIONS.filter((o) => o.group === "specialist").map((o) => o.id);
    expect(specialists).toEqual(["plumber", "electric", "installer", "climate", "client_role"]);
  });

  it("клиентский закупочный PDF не обещает списков специалистов (без дублей)", () => {
    const def = CLIENT_PDF_EXPORT_OPTIONS.find((o) => o.id === "client_purchase");
    expect(def.detail.toLowerCase()).toContain("без списков специалистов");
  });

  it("подпись полного комплекта объясняет повторяющиеся представления", () => {
    const line = pdfExportOptionStats("client_full", { mergedCount: 105 });
    expect(line).toContain("повторяются");
    expect(line).toContain("105");
  });

  it("client_short — первый основной режим без колонки «Фото»", () => {
    const primary = CLIENT_PDF_EXPORT_OPTIONS.filter((o) => o.group === "primary");
    expect(primary[0].id).toBe("client_short");
    const head = getShortPdfTableHead();
    expect(head).not.toContain("Фото");
    expect(head).toEqual(["№", "Наименование", "Кол", "Ед", "Сумма", "Поставщик"]);
  });
});

describe("clientPdfMoneyOrTbd", () => {
  it('cooling_spec без цены возвращает "цена уточняется"', () => {
    const row = { price: 0, sumVat: 0, sourceItems: [{ kind: "cooling_spec" }] };
    expect(clientPdfMoneyOrTbd(row, "₽")).toBe("цена уточняется");
  });

  it("обычная строка без цены остаётся денежным форматом 0 ₽", () => {
    const row = { price: 0, sumVat: 0, qty: 1, sourceItems: [{ kind: "material" }] };
    expect(clientPdfMoneyOrTbd(row, "₽")).toBe("0 ₽");
  });

  it("cooling_spec без цены в client_short (та же колонка суммы) — «цена уточняется»", () => {
    const row = { price: 0, sumVat: 0, sourceItems: [{ kind: "cooling_spec" }] };
    expect(getShortPdfTableHead()).not.toContain("Фото");
    expect(clientPdfMoneyOrTbd(row, "₽")).toBe("цена уточняется");
  });
});

describe("clientPdfNameCol", () => {
  it("включает статус закупки для обычной строки", async () => {
    const { clientPdfNameCol } = await import("../src/lib/clientPdfExport.js");
    const row = { name: "Труба", sourceItems: [{ kind: "material" }] };
    expect(clientPdfNameCol(row)).toBe("Труба Статус: Не куплено");
  });

  it("добавляет характеристики для cooling_spec", async () => {
    const { clientPdfNameCol } = await import("../src/lib/clientPdfExport.js");
    const row = {
      name: "Сплит-система / кондиционер",
      sourceText: "Лаборатория",
      sourceItems: [{ kind: "cooling_spec", coolingKw: 3.5, coolingBtu: 12000 }],
    };
    const text = clientPdfNameCol(row);
    expect(text).toContain("Сплит-система / кондиционер");
    expect(text).toContain("Комната: Лаборатория");
    expect(text).toContain("Холод: 3.5 кВт");
    expect(text).toContain("BTU: 12000");
    expect(text).toContain("Потребление: ~1.09 кВт");
  });

  it("использует clientNote как характеристики и не выводит странную комнату", async () => {
    const { clientPdfNameCol } = await import("../src/lib/clientPdfExport.js");
    const row = {
      name: "Сплит-система / кондиционер",
      clientSection: "Климат и вентиляция",
      clientSubsection: "Охлаждение",
      qty: 1,
      clientNote: "Комната Манипуляционная · холод 75,32 кВт · 60 000 BTU · потребление ~23,54 кВт",
      sourceText: "Климат и вентиляция",
      sourceItems: [{ kind: "cooling_spec" }]
    };
    const text = clientPdfNameCol(row);
    expect(text).toContain("Сплит-система / кондиционер");
    expect(text).toContain("Комната Манипуляционная · холод 75,32 кВт · 60 000 BTU · потребление ~23,54 кВт");
    expect(text).not.toContain("Комната: Климат и вентиляция");
    expect(text).not.toContain("— 1 шт.");
  });

  it("PDF climate по-прежнему содержит характеристики сплитов (clientPdfNameCol)", async () => {
    const { clientPdfNameCol } = await import("../src/lib/clientPdfExport.js");
    const row = {
      name: "Сплит-система / кондиционер",
      sourceItems: [{ kind: "cooling_spec", coolingKw: 5, coolingBtu: 18000 }],
      sourceText: "Теплица",
    };
    const text = clientPdfNameCol(row);
    expect(text).toContain("Сплит-система / кондиционер");
    expect(text).toContain("Холод: 5 кВт");
    expect(text).toContain("BTU: 18000");
  });
});

describe("groupRowsBySupplier", () => {
  const rows = [
    { name: "A", supplier: "Леруа", sumVat: 100, link: "http://x" },
    { name: "B", supplier: "Леруа", sumVat: 50, link: "http://y" },
    { name: "C", supplier: "OBI", sumVat: 200, link: "" },
    { name: "D", supplier: "", sumVat: 30, link: "" },
  ];

  it("группирует по поставщику и считает суммы/количество", () => {
    const groups = groupRowsBySupplier(rows);
    const leroy = groups.find((g) => g.supplier === "Леруа");
    expect(leroy.count).toBe(2);
    expect(leroy.sum).toBe(150);
  });

  it("позиции без поставщика идут отдельным блоком", () => {
    const groups = groupRowsBySupplier(rows);
    expect(groups.some((g) => g.supplier === "— без поставщика —")).toBe(true);
  });
});

describe("rowsWithoutLink", () => {
  it("оставляет только строки без ссылки", () => {
    const rows = [
      { name: "A", link: "http://x" },
      { name: "B", link: "" },
      { name: "C", link: "   " },
    ];
    expect(rowsWithoutLink(rows).map((r) => r.name)).toEqual(["B", "C"]);
  });
});

describe("роль client в PDF", () => {
  it("client-позиции не исключаются группировкой по поставщикам (закупочный и supplier PDF)", () => {
    const rows = [
      { name: "Клиентская", supplier: "Леруа", sumVat: 100, responsible: "client" },
      { name: "Обычная", supplier: "Леруа", sumVat: 50, responsible: "installer" },
    ];
    const grouped = groupRowsBySupplier(rows);
    const leroy = grouped.find((g) => g.supplier === "Леруа");
    expect(leroy.count).toBe(2);
    expect(leroy.rows.map((r) => r.name)).toContain("Клиентская");
  });

  it("в модалке есть отдельный вариант «Список для клиента» (client_role, группа specialist)", () => {
    const opt = CLIENT_PDF_EXPORT_OPTIONS.find((o) => o.id === "client_role");
    expect(opt).toBeTruthy();
    expect(opt.group).toBe("specialist");
    expect(pdfExportOptionStats("client_role", { clientMerged: 7 })).toContain("7");
    expect(pdfExportOptionStats("client_role", { clientMerged: 0 })).toBe("нет позиций");
  });
});
