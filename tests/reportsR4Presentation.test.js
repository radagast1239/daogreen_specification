import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { REPORT_TABS_ALL } from "../shared/projectReportsR2.js";
import {
  shouldShowReportKpi,
  filterIssuesForDisplay,
  publicationDiffChips,
  defaultPurchaseGroupOpen,
  isPurchaseGroupFullyReceived,
  reportFiltersActive,
} from "../shared/reportsUi.js";
import { filterReportPurchases } from "../shared/projectReportsR1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Reports R4 visual polish contracts", () => {
  it("exposes all 7 report tabs", () => {
    expect(REPORT_TABS_ALL.map((t) => t.id)).toEqual([
      "overview",
      "issues",
      "purchases",
      "publications",
      "material-drift",
      "sections",
      "rooms",
    ]);
    const page = fs.readFileSync(path.join(__dirname, "../src/pages/admin/ReportsPage.jsx"), "utf8");
    for (const id of REPORT_TABS_ALL.map((t) => t.id)) {
      expect(page).toContain(`tab === "${id}"`);
    }
  });

  it("hides zero secondary KPIs but keeps important zeros", () => {
    expect(shouldShowReportKpi({ id: "misc", value: 0 })).toBe(false);
    expect(shouldShowReportKpi({ id: "unpublished", value: 0, keepZero: true })).toBe(true);
    expect(shouldShowReportKpi({ id: "receivedSum", value: 0 })).toBe(true);
    expect(shouldShowReportKpi({ id: "activeTotal", value: "10 ₽", important: true })).toBe(true);
  });

  it("does not hide errors/warnings when filtering informational display", () => {
    const issues = [
      { id: "1", level: "error", typeLabel: "E" },
      { id: "2", level: "warning", typeLabel: "W" },
      { id: "3", level: "info", typeLabel: "I" },
    ];
    const hidden = filterIssuesForDisplay(issues, { showInfo: false });
    expect(hidden.map((i) => i.level)).toEqual(["error", "warning"]);
    expect(filterIssuesForDisplay(issues, { showInfo: true })).toHaveLength(3);
  });

  it("hides zero publication diff chips", () => {
    expect(
      publicationDiffChips({
        hasPublished: true,
        addedCount: 1,
        removedCount: 0,
        changedCount: 14,
      }).map((c) => c.label)
    ).toEqual(["Добавлено 1", "Изменено 14"]);
    expect(publicationDiffChips({ hasPublished: true, addedCount: 0, removedCount: 0, changedCount: 0 })).toEqual([]);
  });

  it("collapses fully received purchase groups by default", () => {
    const done = {
      supplier: "А",
      items: [
        { status: "delivered" },
        { status: "have" },
      ],
    };
    const open = {
      supplier: "Б",
      items: [{ status: "not_bought" }, { status: "delivered" }],
    };
    const missing = { supplier: "Поставщик не указан", items: [{ status: "delivered" }] };
    expect(isPurchaseGroupFullyReceived(done)).toBe(true);
    expect(defaultPurchaseGroupOpen(done)).toBe(false);
    expect(defaultPurchaseGroupOpen(open)).toBe(true);
    expect(defaultPurchaseGroupOpen(missing)).toBe(true);
  });

  it("keeps purchase filter semantics", () => {
    const rows = [
      { id: "1", projectId: "p1", supplier: "S", status: "not_bought", itemName: "A", projectName: "P" },
      { id: "2", projectId: "p2", supplier: "T", status: "delivered", itemName: "B", projectName: "Q" },
    ];
    expect(filterReportPurchases(rows, { supplier: "S" }).map((r) => r.id)).toEqual(["1"]);
    expect(reportFiltersActive(["", "S", ""])).toBe(true);
    expect(reportFiltersActive(["", "", ""])).toBe(false);
  });

  it("Excel button still wired to filtered download", () => {
    const page = fs.readFileSync(path.join(__dirname, "../src/pages/admin/ReportsPage.jsx"), "utf8");
    expect(page).toContain("downloadReportsPurchaseExcel(filtered");
    expect(page).toContain("Скачать Excel");
  });

  it("mobile reports css avoids document overflow", () => {
    const css = fs.readFileSync(path.join(__dirname, "../src/styles/reports.css"), "utf8");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).toContain("position: sticky");
    const page = fs.readFileSync(path.join(__dirname, "../src/pages/admin/ReportsPage.jsx"), "utf8");
    expect(page).not.toContain("api.post");
    expect(page).not.toContain("projectUpdate");
    expect(page).not.toContain("itemUpdate");
    expect(page).toContain("getReportsR1");
  });
});
