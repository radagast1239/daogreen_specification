import { describe, expect, it } from "vitest";
import { emptySearchMessage, filterByQuery, matchesQuery } from "../src/lib/modulesListView.js";

describe("modulesListView", () => {
  it("matches and filters by query", () => {
    expect(matchesQuery("Полив проточка", "проточ")).toBe(true);
    expect(matchesQuery("Климат", "электр")).toBe(false);
    const items = [
      { id: "a", label: "Каркас" },
      { id: "b", label: "Дренаж" },
      { id: "c", label: "Вентиляция" },
    ];
    expect(filterByQuery(items, "вент", (x) => x.label).map((x) => x.id)).toEqual(["c"]);
    expect(filterByQuery(items, "", (x) => x.label)).toHaveLength(3);
  });

  it("returns empty search message only when needed", () => {
    expect(emptySearchMessage("", 0)).toBe(null);
    expect(emptySearchMessage("zzz", 0)).toBe("Ничего не найдено");
    expect(emptySearchMessage("zzz", 2)).toBe(null);
  });
});
