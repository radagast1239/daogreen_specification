import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { clientI18nKeys, tSection } from "../shared/clientI18n.js";
import {
  buildPdfCoverData,
  clientPdfMoneyOrTbd,
  clientPdfNameCol,
  getShortPdfTableHead,
  pickPriorityPurchaseItems,
} from "../src/lib/clientPdfExport.js";
import { buildClientWorkbook } from "../src/lib/clientExcelExport.js";
import { PURCHASE_STATUSES } from "../src/data/modules.js";

const englishProject = {
  name: "Ферма Север",
  client: "ООО Пользователь",
  city: "Москва",
  version: 3,
  currency: "₽",
  manualParams: { clientLanguage: "en" },
};

const russianUserItem = {
  id: "pump-1",
  name: "Насос пользователя",
  qty: 2,
  unit: "шт.",
  price: 125,
  supplier: "Мой поставщик",
  clientSection: "pumps",
  responsible: "plumber",
  itemRole: "purchase",
  category: "Насосы",
  status: "ordered",
  includedInProject: true,
  visibleToClient: true,
  approved: true,
};

describe("complete client localization coverage", () => {
  it("keeps RU/EN dictionaries in parity and localizes built-in sections only", () => {
    expect(clientI18nKeys("ru")).toEqual(clientI18nKeys("en"));
    expect(tSection("en", "pumps", "Насосы")).toBe("Pumps");
    expect(tSection("en", "custom-section", "Авторский раздел")).toBe("Авторский раздел");
  });

  it("builds English PDF model strings while preserving user content", () => {
    const cover = buildPdfCoverData(englishProject, [russianUserItem], {});
    expect(cover.title).toBe("Purchase specification");
    expect(cover.projectName).toBe("Ферма Север");
    expect(getShortPdfTableHead("en")).toEqual(["#", "Name", "Qty", "Unit", "Amount", "Supplier"]);
    expect(pickPriorityPurchaseItems([{ ...russianUserItem, purchasePriority: "urgent" }], 7, "en")[0])
      .toContain("Urgent");
    expect(clientPdfMoneyOrTbd({ ...russianUserItem, kind: "cooling_spec", price: null }, "₽", "en"))
      .toBe("price TBD");
    expect(clientPdfNameCol(russianUserItem, "en")).toContain("Status: Ordered");
    expect(clientPdfNameCol(russianUserItem, "en")).toContain("Насос пользователя");
  });

  it("builds English Excel sheets, headers and system values without altering user values", () => {
    const workbook = buildClientWorkbook(englishProject, [russianUserItem], {
      purchaseStatuses: PURCHASE_STATUSES,
    });
    expect(workbook.SheetNames[0]).toBe("01 Instruction");
    expect(workbook.SheetNames).toContain("04 By section");

    const sheet = workbook.Sheets["04 By section"];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    expect(rows).toHaveLength(1);
    expect(rows[0].Name).toBe("Насос пользователя");
    expect(rows[0].Supplier).toBe("Мой поставщик");
    expect(rows[0].Section).toBe("Pumps");
    expect(rows[0]["Purchase status"]).toBe("Ordered");
    expect(rows[0].Unit).toBe("pcs");
    expect(typeof rows[0].Amount).toBe("number");
  });

  it("guards core client UI files against reintroduced Russian runtime labels", () => {
    const files = [
      "src/components/client/ClientPurchaseTable.jsx",
      "src/components/client/ClientItemCard.jsx",
      "src/components/client/ClientMergedItemCard.jsx",
      "src/components/client/ClientOverviewPanel.jsx",
      "src/components/client/ClientPurchaseDashboard.jsx",
      "src/components/client/ClientPurchaseGuide.jsx",
      "src/components/client/ClientPdfExportModal.jsx",
      "src/pages/client/ClientProjectPage.jsx",
    ];
    const forbidden = [
      ">Скачать PDF<",
      ">Наименование<",
      ">Поставщик<",
      ">Что делать дальше<",
      ">Загрузка…<",
      'title="Количество"',
    ];
    for (const relative of files) {
      const source = fs.readFileSync(path.resolve(relative), "utf8");
      for (const fragment of forbidden) expect(source, `${relative}: ${fragment}`).not.toContain(fragment);
    }
  });
});
