import { describe, expect, it } from "vitest";
import {
  clientBudgetTotal,
  clientMatchesQuery,
  clientStatusFilterOptions,
  clientsEmptyMessage,
  filterAndSortClients,
} from "../src/lib/clientsListView.js";

const sample = [
  {
    key: "a",
    name: "АгроФерма",
    city: "Казань",
    status: "in_work",
    comment: "Ждём спецификацию",
    projects: [
      { id: "1", name: "Ферма Север", totals: { budget: 100000 } },
      { id: "2", name: "Доп. зона", totals: { budget: 50000 } },
    ],
  },
  {
    key: "b",
    name: "БетаГрин",
    city: "Москва",
    status: "new",
    comment: "",
    projects: [{ id: "3", name: "Пилот", totals: { budget: 200000 } }],
  },
  {
    key: "c",
    name: "СитиЛейф",
    city: "Сочи",
    status: "buying",
    comment: "Закупка начата",
    projects: [{ id: "4", name: "Ягодник", totals: { budget: 80000 } }],
  },
];

describe("clientsListView", () => {
  it("sums project budgets", () => {
    expect(clientBudgetTotal(sample[0])).toBe(150000);
  });

  it("matches query by name, city, project, comment", () => {
    expect(clientMatchesQuery(sample[0], "агро")).toBe(true);
    expect(clientMatchesQuery(sample[0], "казань")).toBe(true);
    expect(clientMatchesQuery(sample[0], "север")).toBe(true);
    expect(clientMatchesQuery(sample[0], "спецификац")).toBe(true);
    expect(clientMatchesQuery(sample[0], "москва")).toBe(false);
    expect(clientMatchesQuery(sample[0], "")).toBe(true);
  });

  it("filters by status from loaded data options", () => {
    const opts = clientStatusFilterOptions(sample);
    expect(opts[0]).toEqual({ id: "all", label: "Все статусы" });
    expect(opts.map((o) => o.id)).toEqual(expect.arrayContaining(["all", "new", "in_work", "buying"]));
    expect(opts.map((o) => o.id)).not.toContain("lost");
  });

  it("filterAndSortClients filters and sorts without mutating", () => {
    const copy = [...sample];
    const bySum = filterAndSortClients(sample, { sort: "sum" });
    expect(bySum.map((c) => c.key)).toEqual(["b", "a", "c"]);
    expect(sample).toEqual(copy);

    const byName = filterAndSortClients(sample, { sort: "name" });
    expect(byName.map((c) => c.name)).toEqual(["АгроФерма", "БетаГрин", "СитиЛейф"]);

    const filtered = filterAndSortClients(sample, { status: "new" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe("b");

    const searched = filterAndSortClients(sample, { query: "ягод" });
    expect(searched).toHaveLength(1);
    expect(searched[0].key).toBe("c");

    const cleared = filterAndSortClients(sample, { query: "" });
    expect(cleared).toHaveLength(3);
  });

  it("returns clear empty messages", () => {
    expect(clientsEmptyMessage({ sourceCount: 0, visibleCount: 0, query: "", status: "all" })).toBe(null);
    expect(clientsEmptyMessage({ sourceCount: 3, visibleCount: 0, query: "zzz", status: "all" })).toBe(
      "Клиенты не найдены"
    );
    expect(clientsEmptyMessage({ sourceCount: 3, visibleCount: 0, query: "", status: "lost" })).toBe(
      "Нет клиентов с выбранным статусом"
    );
  });
});
