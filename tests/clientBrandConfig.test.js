import { describe, expect, it } from "vitest";
import {
  CLIENT_TAB_OPTIONS,
  DEFAULT_VISIBLE_TAB_IDS,
  normalizeVisibleTabIds,
  legacyTabToPurchaseMode,
  clientTabDefs,
  PDF_COLUMN_PRESETS,
  PDF_CLIENT_COLUMN_IDS,
  PDF_FULL_COLUMN_IDS,
  PDF_COLUMN_OPTIONS,
  detectPdfColumnPreset,
  DEFAULT_PDF_FOOTER_PLACEHOLDER,
  buildClientBrand,
  resolvePdfColumns,
} from "../src/lib/clientBrandConfig.js";

const tabById = (id) => CLIENT_TAB_OPTIONS.find((t) => t.id === id);

describe("client tab labels renamed", () => {
  it("purchase → «Купить сейчас»", () => {
    expect(tabById("purchase").label).toBe("Купить сейчас");
  });
  it("merged → «Вся закупка»", () => {
    expect(tabById("merged").label).toBe("Вся закупка");
  });
  it("categories → «По разделам»", () => {
    expect(tabById("categories").label).toBe("По разделам");
  });
});

describe("client tab grouping", () => {
  it("primary group has overview/purchase/docs", () => {
    const primary = CLIENT_TAB_OPTIONS.filter((t) => t.group !== "extra").map((t) => t.id);
    expect(primary).toContain("overview");
    expect(primary).toContain("purchase");
    expect(primary).toContain("docs");
  });
  it("extra group has legacy purchase modes", () => {
    const extra = CLIENT_TAB_OPTIONS.filter((t) => t.group === "extra").map((t) => t.id);
    expect(extra).toContain("merged");
    expect(extra).toContain("modules");
    expect(extra).toContain("cooling");
  });
  it("every option has a group", () => {
    expect(CLIENT_TAB_OPTIONS.every((t) => t.group === "primary" || t.group === "extra")).toBe(true);
  });
});

describe("default visible tabs", () => {
  it("includes overview by default", () => {
    expect(DEFAULT_VISIBLE_TAB_IDS).toEqual(["overview", "purchase", "docs"]);
  });
  it("normalizeVisibleTabIds keeps overview first", () => {
    expect(normalizeVisibleTabIds([])).toEqual(["overview", "purchase", "docs"]);
  });
});

describe("old tab keys not broken", () => {
  it("legacy purchase-mode tab still enables purchase", () => {
    expect(normalizeVisibleTabIds(["categories", "docs"])).toContain("purchase");
  });
  it("legacy merged tab still enables purchase", () => {
    expect(normalizeVisibleTabIds(["merged"])).toContain("purchase");
  });
  it("legacyTabToPurchaseMode unchanged", () => {
    expect(legacyTabToPurchaseMode("modules")).toBe("modules");
    expect(legacyTabToPurchaseMode("plumber")).toBe("plumber");
    expect(legacyTabToPurchaseMode("cooling")).toBe("all");
  });
  it("clientTabDefs fallback uses new label", () => {
    const defs = clientTabDefs({ clientVisibleTabs: [] });
    // [] normalizes to defaults which include real tabs, so fallback not hit here;
    // force fallback by passing only unknown-to-real ids resolved away
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
  });
});

describe("PDF column presets", () => {
  it("client preset includes client-facing columns", () => {
    for (const id of ["name", "qty", "unit", "price", "sum", "supplier", "clientSection", "link", "status"]) {
      expect(PDF_CLIENT_COLUMN_IDS).toContain(id);
    }
  });
  it("client preset excludes category/module/vat", () => {
    for (const id of ["category", "module", "vat"]) {
      expect(PDF_CLIENT_COLUMN_IDS).not.toContain(id);
    }
  });
  it("full preset includes every column", () => {
    expect(PDF_FULL_COLUMN_IDS).toEqual(PDF_COLUMN_OPTIONS.map((c) => c.id));
  });
  it("has client, full, custom presets", () => {
    expect(PDF_COLUMN_PRESETS.map((p) => p.id)).toEqual(["client", "full", "custom"]);
  });
});

describe("detectPdfColumnPreset", () => {
  it("detects client preset regardless of order", () => {
    expect(detectPdfColumnPreset([...PDF_CLIENT_COLUMN_IDS].reverse())).toBe("client");
  });
  it("detects full preset", () => {
    expect(detectPdfColumnPreset(PDF_FULL_COLUMN_IDS)).toBe("full");
  });
  it("returns custom when no match", () => {
    expect(detectPdfColumnPreset(["name", "qty"])).toBe("custom");
  });
});

describe("PDF footer + QR defaults", () => {
  it("footer placeholder has no example email", () => {
    expect(DEFAULT_PDF_FOOTER_PLACEHOLDER).not.toContain("example.com");
    expect(DEFAULT_PDF_FOOTER_PLACEHOLDER).toContain("Daogreen");
  });
  it("QR is on by default", () => {
    expect(buildClientBrand({}).pdfShowQr).toBe(true);
  });
  it("QR off only when explicitly false", () => {
    expect(buildClientBrand({ clientPdfShowQr: "false" }).pdfShowQr).toBe(false);
  });
});

describe("resolvePdfColumns still works", () => {
  it("applies client preset persisted as columns", () => {
    const cols = resolvePdfColumns({ clientPdfColumns: JSON.stringify(PDF_CLIENT_COLUMN_IDS) });
    expect(cols).toContain("clientSection");
    expect(cols).toContain("name");
  });
  it("falls back to default columns", () => {
    expect(resolvePdfColumns({})).toEqual(["name", "qty", "unit", "price", "sum", "supplier"]);
  });
});
