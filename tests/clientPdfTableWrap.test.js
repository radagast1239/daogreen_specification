import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  PDF_SOFT_BREAK_CHUNK,
  buildMergedPdfTableBody,
  buildShortPdfTableBody,
  pdfCellText,
  pdfCellTextPlain,
} from "../src/lib/clientPdfExport.js";
import { setupPdfFonts, PDF_FONT, pdfTableFontStyles, pdfTableHeadFontStyles } from "../src/lib/pdfFontSetup.js";
import { PDF_PHOTO_COL_WIDTH_MM } from "../src/lib/pdfImageHelpers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

beforeAll(() => {
  // Same font fetch stub as pdfFontSetup.test.js — vitest has no Vite asset URLs.
  const regular = readFileSync(join(ROOT, "src/assets/fonts/Roboto-Regular.ttf"));
  const bold = readFileSync(join(ROOT, "src/assets/fonts/Roboto-Bold.ttf"));
  globalThis.fetch = async (url) => {
    const buf = String(url).includes("Bold") ? bold : regular;
    return {
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
});

const LONG_SUPPLIER =
  "Производственно-инжиниринговая компания Вертикальные агротехнологии";
const LONG_SOURCE =
  "Каркас стеллажа → ярус 7 → внутренняя поперечная балка → узел крепления";
const LONG_NAME =
  "Светодиодный фитосветильник полного спектра для многоярусной вертикальной фермы";
const LONG_SECTION =
  "Каркас и несущие конструкции многоярусной вертикальной фермы DAOGREEN";
const LONG_URL =
  "https://example.com/catalog/items/phyto-led-full-spectrum-vertical-farm-fixture-sku-ABCDEF1234567890";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "pdf-wrap-visual"
);

function longFixtureRow(overrides = {}) {
  return {
    name: LONG_NAME,
    qty: 12.5,
    unit: "шт.",
    sumVat: 150000,
    price: 12000,
    supplier: LONG_SUPPLIER,
    sourceText: LONG_SOURCE,
    clientSection: "frame",
    clientSectionLabel: LONG_SECTION,
    clientNote: "EN note: full-spectrum LED for vertical farm racks — SKU PHYTO-LED-VF-7",
    status: "not_bought",
    link: LONG_URL,
    sourceItems: [{
      name: LONG_NAME,
      kind: "material",
      status: "not_bought",
      clientNote: "EN note: full-spectrum LED for vertical farm racks — SKU PHYTO-LED-VF-7",
    }],
    ...overrides,
  };
}

describe("pdfCellText — soft break without truncating user text", () => {
  it("keeps full Cyrillic supplier and does not hard-slice to 28", () => {
    expect(LONG_SUPPLIER.length).toBeGreaterThan(28);
    expect(pdfCellTextPlain(LONG_SUPPLIER)).toBe(LONG_SUPPLIER);
    expect(pdfCellTextPlain(LONG_SUPPLIER).length).toBe(LONG_SUPPLIER.length);
  });

  it("keeps full sourceText and does not hard-slice to 48", () => {
    expect(LONG_SOURCE.length).toBeGreaterThan(48);
    expect(pdfCellTextPlain(LONG_SOURCE)).toBe(LONG_SOURCE);
  });

  it("inserts ZWSP only into long unbroken tokens (URL/SKU)", () => {
    const withBreaks = pdfCellText(LONG_URL);
    expect(withBreaks).toContain("\u200B");
    expect(pdfCellTextPlain(LONG_URL)).toBe(LONG_URL);
    expect(withBreaks.replace(/\u200B/g, "")).toBe(LONG_URL);
    const parts = withBreaks.split("\u200B");
    expect(parts.every((p) => p.length <= PDF_SOFT_BREAK_CHUNK)).toBe(true);
  });

  it("does not alter short labels or empty → dash", () => {
    expect(pdfCellText("Daogreen")).toBe("Daogreen");
    expect(pdfCellText("")).toBe("—");
    expect(pdfCellText(null)).toBe("—");
    expect(pdfCellText(undefined)).toBe("—");
  });

  it("preserves hyphenated Russian phrases without cutting content", () => {
    const text = "труба ПВХ-U 32×2,4 мм — напорная для NFT-каналов";
    expect(pdfCellTextPlain(text)).toBe(text);
  });
});

describe("buildShortPdfTableBody / buildMergedPdfTableBody — no hard truncation", () => {
  const project = { currency: "₽", name: "Wrap fixture" };

  it("short table keeps full supplier", () => {
    const body = buildShortPdfTableBody([longFixtureRow()], project);
    const supplier = pdfCellTextPlain(body[0][5]);
    expect(supplier).toBe(LONG_SUPPLIER);
    expect(supplier.length).toBeGreaterThan(28);
    expect(pdfCellTextPlain(body[0][1])).toContain(LONG_NAME);
  });

  it("merged compact=false keeps full supplier + sourceText", () => {
    const body = buildMergedPdfTableBody([longFixtureRow()], project, { compact: false });
    expect(pdfCellTextPlain(body[0][6])).toBe(LONG_SUPPLIER);
    expect(pdfCellTextPlain(body[0][7])).toBe(LONG_SOURCE);
    expect(pdfCellTextPlain(body[0][6]).length).toBeGreaterThan(28);
    expect(pdfCellTextPlain(body[0][7]).length).toBeGreaterThan(48);
  });

  it("merged compact=true keeps full supplier and has no source column", () => {
    const body = buildMergedPdfTableBody([longFixtureRow()], project, { compact: true });
    expect(body[0]).toHaveLength(7);
    expect(pdfCellTextPlain(body[0][6])).toBe(LONG_SUPPLIER);
  });

  it("handles empty supplier/source as dash; English + digits stay intact", () => {
    const body = buildMergedPdfTableBody([
      longFixtureRow({
        supplier: "",
        sourceText: "",
        name: "Pump XP-400 12V / 2.5 A",
        clientNote: "",
      }),
    ], project, { compact: false });
    expect(pdfCellTextPlain(body[0][6])).toBe("—");
    expect(pdfCellTextPlain(body[0][7])).toBe("—");
    expect(pdfCellTextPlain(body[0][2])).toContain("Pump XP-400 12V / 2.5 A");
  });
});

describe("AutoTable wrap styles — visual fixtures", () => {
  it("renders wrap fixtures for short / purchase / specialist tables", async () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const rows = [
      longFixtureRow(),
      longFixtureRow({
        name: "URL-only article https://vendor.example/very/long/path/without/spaces/item-99999",
        supplier: "Vendor Engineering LLC — Vertical Agrotech Supply Chain Division",
        sourceText: LONG_SECTION,
        qty: 1,
        unit: "компл.",
      }),
      longFixtureRow({
        name: "Short",
        supplier: "",
        sourceText: "",
        qty: 0,
        sumVat: 0,
        clientNote: "",
      }),
    ];

    const brandRgb = [17, 99, 85];
    const cases = [
      {
        file: "01-short.pdf",
        head: [["№", "Наименование", "Кол", "Ед", "Сумма", "Поставщик"]],
        body: buildShortPdfTableBody(rows, { currency: "₽" }),
        columnStyles: {
          0: { cellWidth: 8 },
          1: { cellWidth: 78 },
          2: { cellWidth: 14 },
          3: { cellWidth: 12 },
          4: { cellWidth: 24 },
          5: { cellWidth: 46 },
        },
        title: "Short list / general — wrap",
        expectSource: false,
      },
      {
        file: "02-purchase-compact.pdf",
        head: [["№", "Фото", "Наименование", "Кол", "Ед", "Сумма", "Поставщик"]],
        body: buildMergedPdfTableBody(rows, { currency: "₽" }, { compact: true }),
        columnStyles: {
          0: { cellWidth: 8 },
          1: { cellWidth: PDF_PHOTO_COL_WIDTH_MM },
          2: { cellWidth: 70 },
          3: { cellWidth: 14 },
          4: { cellWidth: 12 },
          5: { cellWidth: 22 },
          6: { cellWidth: 42 },
        },
        title: "Purchase compact — wrap",
        expectSource: false,
      },
      {
        file: "03-merged-full.pdf",
        head: [["№", "Фото", "Наименование", "Кол", "Ед", "Сумма", "Поставщик", "Откуда"]],
        body: buildMergedPdfTableBody(rows, { currency: "₽" }, { compact: false }),
        columnStyles: {
          0: { cellWidth: 7 },
          1: { cellWidth: PDF_PHOTO_COL_WIDTH_MM },
          2: { cellWidth: 48 },
          3: { cellWidth: 12 },
          4: { cellWidth: 11 },
          5: { cellWidth: 20 },
          6: { cellWidth: 35 },
          7: { cellWidth: 35 },
        },
        title: "Merged / plumber / electric / frames — wrap",
        expectSource: true,
      },
      {
        file: "04-section-summary.pdf",
        head: [["Раздел", "Позиций", "Сумма", "Готово"]],
        body: [
          [pdfCellText(LONG_SECTION), 12, "150 000 ₽", "0%"],
          [pdfCellText("Сантехника и полив NFT"), 4, "12 000 ₽", "25%"],
          [pdfCellText("Электрика и фитосвет"), 8, "88 000 ₽", "50%"],
        ],
        columnStyles: {
          0: { cellWidth: 90 },
          1: { cellWidth: 28 },
          2: { cellWidth: 36 },
          3: { cellWidth: 28 },
        },
        title: "Section summary — long section names",
        expectSource: false,
        expectSupplier: false,
      },
    ];

    for (const c of cases) {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      await setupPdfFonts(doc);
      expect(doc.getFontList()[PDF_FONT]).toBeTruthy();
      doc.setFont(PDF_FONT, "normal");
      doc.setFontSize(11);
      doc.text(c.title, 14, 16);
      autoTable(doc, {
        startY: 22,
        head: c.head,
        body: c.body,
        styles: {
          fontSize: 8,
          cellPadding: { top: 1.6, right: 1.2, bottom: 1.6, left: 1.2 },
          overflow: "linebreak",
          valign: "top",
          lineWidth: 0.1,
          ...pdfTableFontStyles(),
        },
        headStyles: { fillColor: brandRgb, valign: "middle", ...pdfTableHeadFontStyles() },
        columnStyles: c.columnStyles,
        rowPageBreak: "avoid",
        showHead: "everyPage",
        pageBreak: "auto",
        margin: { left: 14, right: 14, top: 16, bottom: 18 },
      });

      const flat = c.body.flat().map((v) => String(v ?? "").replace(/\u200B/g, "")).join("\n");
      if (c.expectSupplier !== false) {
        expect(flat).toContain(LONG_SUPPLIER);
        expect(flat).toContain(LONG_NAME);
      }
      if (c.expectSource) {
        expect(flat).toContain(LONG_SOURCE);
      }
      if (c.file.includes("section")) {
        expect(flat).toContain(LONG_SECTION);
      }

      writeFileSync(join(FIXTURE_DIR, c.file), Buffer.from(doc.output("arraybuffer")));
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    }
  });
});
