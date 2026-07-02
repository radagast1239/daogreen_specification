import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import {
  groupMergedBySectionHierarchy,
  computeSectionStats,
  detectRowProblems,
  isRowReadyToBuy,
  problemGroupCounts,
} from "../src/lib/clientPurchaseGroups.js";

function mkRow({ name = "Item", clientSection = "stellage", clientSubsection = "", supplier = "Леруа", link = "http://x", price = 100, sumVat = 100, status = "", sourceStatuses = [] } = {}) {
  return {
    mergeKey: name,
    name,
    clientSection,
    clientSubsection,
    supplier,
    link,
    price,
    sumVat,
    sourceItems: sourceStatuses.length
      ? sourceStatuses.map((s, i) => ({ id: `${name}-${i}`, status: s, clientSection, clientSubsection, category: "" }))
      : [{ id: `${name}-0`, status: status || "", clientSection, clientSubsection, category: "" }],
  };
}

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

describe("detectRowProblems", () => {
  it("returns empty for a complete row", () => {
    const row = mkRow();
    expect(detectRowProblems(row)).toEqual([]);
  });

  it("detects no_link", () => {
    const row = mkRow({ link: "" });
    expect(detectRowProblems(row)).toContain("no_link");
  });

  it("detects no_price", () => {
    const row = mkRow({ price: 0 });
    expect(detectRowProblems(row)).toContain("no_price");
  });

  it("detects no_supplier", () => {
    const row = mkRow({ supplier: "" });
    expect(detectRowProblems(row)).toContain("no_supplier");
  });

  it("detects need_help status", () => {
    const row = mkRow({ status: "need_help" });
    expect(detectRowProblems(row)).toContain("need_help");
  });

  it("detects replacement_check status", () => {
    const row = mkRow({ status: "replacement_check" });
    expect(detectRowProblems(row)).toContain("replacement_check");
  });

  it("detects on_review status", () => {
    const row = mkRow({ status: "on_review" });
    expect(detectRowProblems(row)).toContain("on_review");
  });
});

describe("computeSectionStats", () => {
  it("counts totals per section", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage" }),
      mkRow({ name: "B", clientSection: "stellage" }),
      mkRow({ name: "C", clientSection: "lighting" }),
    ];
    const stats = computeSectionStats(rows);
    expect(stats.stellage.totalCount).toBe(2);
    expect(stats.lighting.totalCount).toBe(1);
  });

  it("counts bought items", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage", sourceStatuses: ["bought"] }),
      mkRow({ name: "B", clientSection: "stellage", sourceStatuses: [""] }),
    ];
    const stats = computeSectionStats(rows);
    expect(stats.stellage.boughtCount).toBe(1);
    expect(stats.stellage.totalCount).toBe(2);
  });

  it("counts unique suppliers", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "pumps", supplier: "Леруа" }),
      mkRow({ name: "B", clientSection: "pumps", supplier: "Леруа" }),
      mkRow({ name: "C", clientSection: "pumps", supplier: "OBI" }),
    ];
    const stats = computeSectionStats(rows);
    expect(stats.pumps.supplierCount).toBe(2);
  });

  it("counts problems and excludes bought", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage", link: "" }),
      mkRow({ name: "B", clientSection: "stellage", sourceStatuses: ["bought"], link: "" }),
    ];
    const stats = computeSectionStats(rows);
    expect(stats.stellage.problemCount).toBe(1);
  });
});

describe("isRowReadyToBuy", () => {
  it("ready when has link + supplier + open status", () => {
    expect(isRowReadyToBuy(mkRow())).toBe(true);
  });

  it("not ready without link", () => {
    expect(isRowReadyToBuy(mkRow({ link: "" }))).toBe(false);
  });

  it("not ready without supplier", () => {
    expect(isRowReadyToBuy(mkRow({ supplier: "" }))).toBe(false);
  });

  it("not ready when bought/ordered/have (closed)", () => {
    expect(isRowReadyToBuy(mkRow({ sourceStatuses: ["bought"] }))).toBe(false);
    expect(isRowReadyToBuy(mkRow({ sourceStatuses: ["ordered"] }))).toBe(false);
    expect(isRowReadyToBuy(mkRow({ sourceStatuses: ["have"] }))).toBe(false);
    expect(isRowReadyToBuy(mkRow({ sourceStatuses: ["delivered"] }))).toBe(false);
  });

  it("not ready when needs help / replacement / on review", () => {
    expect(isRowReadyToBuy(mkRow({ status: "need_help" }))).toBe(false);
    expect(isRowReadyToBuy(mkRow({ status: "replacement_check" }))).toBe(false);
    expect(isRowReadyToBuy(mkRow({ status: "on_review" }))).toBe(false);
  });

  it("ready even without price (price is not a blocker for buying)", () => {
    expect(isRowReadyToBuy(mkRow({ price: 0 }))).toBe(true);
  });

  it("ready-only filter hides no-link items", () => {
    const rows = [
      mkRow({ name: "A" }),
      mkRow({ name: "B", link: "" }),
      mkRow({ name: "C", supplier: "" }),
    ];
    const ready = rows.filter(isRowReadyToBuy);
    expect(ready.map((r) => r.name)).toEqual(["A"]);
  });
});

describe("problemGroupCounts", () => {
  it("counts problems by cause across sections", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage", link: "" }),
      mkRow({ name: "B", clientSection: "stellage", link: "" }),
      mkRow({ name: "C", clientSection: "pumps", supplier: "" }),
      mkRow({ name: "D", clientSection: "pumps", status: "need_help" }),
    ];
    const stats = computeSectionStats(rows);
    const counts = problemGroupCounts(stats);
    expect(counts.no_link).toBe(2);
    expect(counts.no_supplier).toBe(1);
    expect(counts.need_help).toBe(1);
  });

  it("returns empty object when no problems", () => {
    const stats = computeSectionStats([mkRow({ name: "A" })]);
    expect(problemGroupCounts(stats)).toEqual({});
  });
});

describe("section summary fields", () => {
  it("groups expose boughtCount/supplierCount/problemCount from stats", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage", supplier: "Леруа", sourceStatuses: ["bought"] }),
      mkRow({ name: "B", clientSection: "stellage", supplier: "OBI", link: "" }),
    ];
    const stats = computeSectionStats(rows);
    const groups = groupMergedBySectionHierarchy(rows, "₽", { sectionStats: stats });
    const sec = groups.find((g) => g.sectionId === "stellage");
    expect(sec.totalCount).toBe(2);
    expect(sec.boughtCount).toBe(1);
    expect(sec.supplierCount).toBe(2);
    expect(sec.problemCount).toBe(1);
  });
});

describe("groupMergedBySectionHierarchy", () => {
  it("groups by client section", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage" }),
      mkRow({ name: "B", clientSection: "lighting" }),
    ];
    const groups = groupMergedBySectionHierarchy(rows, "₽");
    expect(groups.length).toBe(2);
    expect(groups[0].sectionId).toBe("stellage");
    expect(groups[1].sectionId).toBe("lighting");
  });

  it("groups by subsection inside section", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage", clientSubsection: "Каркас и профиль" }),
      mkRow({ name: "B", clientSection: "stellage", clientSubsection: "Крепёж" }),
    ];
    const groups = groupMergedBySectionHierarchy(rows, "₽");
    expect(groups).toHaveLength(1);
    expect(groups[0].subsections.length).toBe(2);
  });

  it("attaches section stats hint when provided", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage" }),
    ];
    const sectionStats = {
      stellage: { totalCount: 5, boughtCount: 2, supplierCount: 3, problemCount: 1, problemRows: [] },
    };
    const groups = groupMergedBySectionHierarchy(rows, "₽", { sectionStats });
    expect(groups[0].hint).toContain("2/5 куплено");
    expect(groups[0].hint).toContain("3 пост.");
    expect(groups[0].hint).toContain("⚠ 1");
    expect(groups[0].supplierCount).toBe(3);
  });

  it("works without sectionStats (backwards compatible)", () => {
    const rows = [mkRow({ name: "A", clientSection: "stellage" })];
    const groups = groupMergedBySectionHierarchy(rows, "₽");
    expect(groups[0].hint).toBeUndefined();
    expect(groups[0].boughtCount).toBe(0);
  });

  it("supplier filter does not break grouping", () => {
    const rows = [
      mkRow({ name: "A", clientSection: "stellage", supplier: "Леруа" }),
      mkRow({ name: "B", clientSection: "stellage", supplier: "OBI" }),
    ];
    const filtered = rows.filter((r) => r.supplier === "Леруа");
    const groups = groupMergedBySectionHierarchy(filtered, "₽");
    expect(groups[0].count).toBe(1);
  });
});

describe("bought items hidden by default", () => {
  it("splitMergedPurchaseRows separates bought from todo", async () => {
    const { splitMergedPurchaseRows } = await import("../src/lib/itemHelpers.js");
    const rows = [
      { mergeKey: "a", name: "A", sumVat: 100, sourceItems: [{ status: "" }] },
      { mergeKey: "b", name: "B", sumVat: 200, sourceItems: [{ status: "bought" }] },
      { mergeKey: "c", name: "C", sumVat: 50, sourceItems: [{ status: "ordered" }] },
    ];
    const { todo, bought } = splitMergedPurchaseRows(rows);
    expect(todo).toHaveLength(1);
    expect(bought).toHaveLength(2);
    expect(todo[0].name).toBe("A");
  });
});
