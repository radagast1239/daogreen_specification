import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import { FRAME_BOM_SOURCE } from "../shared/frameBomProjectItems.js";
import { PURCHASE_STATUS } from "../shared/purchaseStatusRules.js";
import {
  buildProjectDashboardSummary,
  filterProjectItems,
  resolveDashboardFilterLabel,
  shortPublishHeadline,
  isCoolingPublishBlocker,
} from "../shared/projectDashboardSummary.js";
import { buildAdminPurchaseProgress } from "../shared/clientPurchaseStats.js";
import { buildHqMetrics, coolingSubLabel, summarizeCoolingRooms } from "../src/lib/projectHqStats.js";
import { matchSpecLineFilter } from "../shared/specLineFilters.js";
import { prepareClientPurchaseItems } from "../shared/clientPurchaseRows.js";

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

function baseItem(over = {}) {
  return {
    id: over.id || "it1",
    name: "Болт M6",
    unit: "шт",
    qty: 2,
    price: 50,
    itemType: "material",
    includedInProject: true,
    visibleToClient: true,
    clientSection: "stellage",
    clientSubsection: "Каркас и профиль",
    supplier: "КрепёжПро",
    link: "https://example.com/bolt",
    photoUrl: "/photos/bolt.jpg",
    purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT,
    ...over,
  };
}

describe("buildProjectDashboardSummary", () => {
  it("counts total/clientVisible/hidden", () => {
    const items = [
      baseItem({ id: "a" }),
      baseItem({ id: "b", visibleToClient: false }),
      baseItem({ id: "c", includedInProject: false }),
      { id: "n1", name: "Заметка", itemType: "note", includedInProject: true },
    ];
    const s = buildProjectDashboardSummary(items);
    expect(s.totalItems).toBe(2);
    expect(s.clientVisibleItems).toBe(1);
    expect(s.hiddenFromClientItems).toBe(1);
  });

  it("counts no_price/no_photo/no_link/no_supplier", () => {
    const items = [
      baseItem({ id: "p", price: 0 }),
      baseItem({ id: "ph", photoUrl: "", imageUrl: "" }),
      baseItem({ id: "l", link: "" }),
      baseItem({ id: "s", supplier: "" }),
    ];
    const summary = buildProjectDashboardSummary(items);
    expect(summary.noPrice).toBe(1);
    expect(summary.noPhoto).toBe(1);
    expect(summary.noLink).toBe(1);
    expect(summary.noSupplier).toBe(1);
  });

  it("counts purchase statuses", () => {
    const items = [
      baseItem({ purchaseStatus: PURCHASE_STATUS.NEED_HELP }),
      baseItem({ id: "r", purchaseStatus: PURCHASE_STATUS.REPLACEMENT_CHECK }),
      baseItem({ id: "f", purchaseStatus: PURCHASE_STATUS.NOT_FIT }),
      baseItem({ id: "h", purchaseStatus: PURCHASE_STATUS.HAVE }),
    ];
    const s = buildProjectDashboardSummary(items);
    expect(s.purchaseStatusCounts[PURCHASE_STATUS.NEED_HELP]).toBe(1);
    expect(s.purchaseStatusCounts[PURCHASE_STATUS.REPLACEMENT_CHECK]).toBe(1);
    expect(s.purchaseStatusCounts[PURCHASE_STATUS.NOT_FIT]).toBe(1);
    expect(s.purchaseStatusCounts[PURCHASE_STATUS.HAVE]).toBe(1);
  });

  it("counts frame_bom items", () => {
    const items = [
      baseItem(),
      baseItem({ id: "bom", source: FRAME_BOM_SOURCE, sourceType: FRAME_BOM_SOURCE }),
    ];
    const s = buildProjectDashboardSummary(items);
    expect(s.bomItems).toBe(1);
    expect(s.manualItems).toBe(1);
  });

  it("not_fit creates blocker via publish check", () => {
    const s = buildProjectDashboardSummary([baseItem({ purchaseStatus: PURCHASE_STATUS.NOT_FIT })]);
    expect(s.readiness.blockers).toBeGreaterThan(0);
    expect(s.readiness.status).toBe("blocked");
  });

  it("need_help creates warning", () => {
    const s = buildProjectDashboardSummary([baseItem({ purchaseStatus: PURCHASE_STATUS.NEED_HELP })]);
    expect(s.readiness.warnings).toBeGreaterThan(0);
    expect(s.readiness.status).not.toBe("blocked");
  });

  it("replacement_check creates warning", () => {
    const s = buildProjectDashboardSummary([
      baseItem({ purchaseStatus: PURCHASE_STATUS.REPLACEMENT_CHECK }),
    ]);
    expect(s.readiness.warnings).toBeGreaterThan(0);
  });

  it("have does not count as remaining to buy in budget", () => {
    const items = [
      baseItem({ id: "open", purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT, price: 100, qty: 1 }),
      baseItem({ id: "have", purchaseStatus: PURCHASE_STATUS.HAVE, price: 200, qty: 1 }),
    ];
    const s = buildProjectDashboardSummary(items);
    expect(s.budget.remainingToBuyKnown).toBe(100);
    expect(s.budget.alreadyHaveKnown).toBe(200);
  });

  it("bought/delivered do not block publish", () => {
    const bought = buildProjectDashboardSummary([baseItem({ purchaseStatus: PURCHASE_STATUS.BOUGHT })]);
    const delivered = buildProjectDashboardSummary([
      baseItem({ purchaseStatus: PURCHASE_STATUS.DELIVERED }),
    ]);
    expect(bought.readiness.status).not.toBe("blocked");
    expect(delivered.readiness.status).not.toBe("blocked");
  });

  it("missing price is without price, not treated as valid", () => {
    const s = buildProjectDashboardSummary([baseItem({ price: 0 })]);
    expect(s.noPrice).toBe(1);
    expect(s.budget.missingPriceCount).toBe(1);
    expect(s.budget.totalKnown).toBe(0);
  });

  it("builds pre-send messages for issues", () => {
    const s = buildProjectDashboardSummary([
      baseItem({ price: 0 }),
      baseItem({ id: "h", purchaseStatus: PURCHASE_STATUS.NEED_HELP }),
    ]);
    expect(s.preSendMessages.some((m) => m.key === "no_price")).toBe(true);
    expect(s.preSendMessages.some((m) => m.key === "need_help")).toBe(true);
  });
});

describe("project dashboard filters", () => {
  const items = [
    baseItem({ id: "price0", price: 0 }),
    baseItem({ id: "help", purchaseStatus: PURCHASE_STATUS.NEED_HELP }),
    baseItem({ id: "bom", source: FRAME_BOM_SOURCE }),
    baseItem({ id: "hidden", visibleToClient: false }),
    baseItem({ id: "ok" }),
  ];

  it("filter без цены returns only no-price rows", () => {
    const filtered = filterProjectItems(items, "no_price");
    expect(filtered.map((i) => i.id)).toEqual(["price0"]);
  });

  it("filter need_help returns status need_help", () => {
    const filtered = filterProjectItems(items, "need_help");
    expect(filtered.map((i) => i.id)).toEqual(["help"]);
  });

  it("filter frame_bom returns source frame_bom", () => {
    const filtered = filterProjectItems(items, "frame_bom");
    expect(filtered.map((i) => i.id)).toEqual(["bom"]);
  });

  it("filter client visible respects visibleToClient", () => {
    const filtered = filterProjectItems(items, "client_visible");
    expect(filtered.some((i) => i.id === "hidden")).toBe(false);
    expect(filtered.some((i) => i.id === "ok")).toBe(true);
  });

  it("filter hidden respects item-level visibility", () => {
    const filtered = filterProjectItems(items, "client_hidden");
    expect(filtered.map((i) => i.id)).toEqual(["hidden"]);
  });
});

describe("regression: client export rows unchanged", () => {
  it("prepareClientPurchaseItems still receives same visible rows", () => {
    const items = [
      baseItem({ id: "c1" }),
      baseItem({ id: "c2", source: FRAME_BOM_SOURCE, sourceKey: "frame_bom:x:y:z" }),
      baseItem({ id: "hidden", visibleToClient: false }),
    ];
    const visible = items.filter((it) => matchSpecLineFilter(it, "client_visible", "project"));
    const rows = prepareClientPurchaseItems(visible);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => !r.sourceKey && !r.source)).toBe(true);
  });
});

describe("dashboard UX polish", () => {
  it("purchase summary does not label total as bought", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      baseItem({ id: `it${i}`, purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT })
    );
    const card = buildAdminPurchaseProgress(items);
    expect(card.headline).toBe("0 из 10 закрыто");
    expect(card.title).toBe("Закупка");
    expect(card.detail).toBe("заказано: 0 · куплено/доставлено: 0");
    expect(card.headline).not.toContain("куплено / 10");
  });

  it("closed purchase count = ordered + bought + delivered + have", () => {
    const items = [
      baseItem({ id: "b", purchaseStatus: PURCHASE_STATUS.BOUGHT }),
      baseItem({ id: "d", purchaseStatus: PURCHASE_STATUS.DELIVERED }),
      baseItem({ id: "h", purchaseStatus: PURCHASE_STATUS.HAVE }),
      baseItem({ id: "o", purchaseStatus: PURCHASE_STATUS.ORDERED }),
      baseItem({ id: "n", purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT }),
    ];
    const card = buildAdminPurchaseProgress(items);
    expect(card.closedCount).toBe(4);
    expect(card.headline).toBe("4 из 5 закрыто");
    expect(card.orderedCount).toBe(1);
    expect(card.boughtDeliveredCount).toBe(2);
    expect(card.haveCount).toBe(1);
  });

  it("pre-send message maps to correct filter", () => {
    const s = buildProjectDashboardSummary([
      baseItem({ price: 0 }),
      baseItem({ id: "l", link: "" }),
      baseItem({ id: "s", supplier: "" }),
    ]);
    const byKey = Object.fromEntries(s.preSendMessages.map((m) => [m.key, m.filter]));
    expect(byKey.no_price).toBe("no_price");
    expect(byKey.no_link).toBe("no_link");
    expect(byKey.no_supplier).toBe("no_supplier");
  });

  it("filter no_price works via helper contract", () => {
    const items = [baseItem({ price: 0 }), baseItem({ id: "ok", price: 100 })];
    expect(filterProjectItems(items, "no_price").map((i) => i.id)).toEqual(["it1"]);
  });

  it("resolveDashboardFilterLabel returns active filter label", () => {
    expect(resolveDashboardFilterLabel("no_price")).toBe("Без цены");
    expect(resolveDashboardFilterLabel("")).toBe("Все позиции");
  });

  it("short publish headline avoids duplicating full status card text", () => {
    expect(shortPublishHeadline("warnings", { warnings: 3 })).toBe("Предупреждения: 3");
    expect(shortPublishHeadline("ok")).toBe("Готово");
  });

  it("cooling warning is not publish blocker", () => {
    expect(isCoolingPublishBlocker()).toBe(false);
    const cooling = summarizeCoolingRooms({
      rooms: [
        { id: "r1", name: "A" },
        { id: "r2", name: "B" },
        { id: "r3", name: "C" },
      ],
    });
    expect(cooling.status).toBe("warning");
    expect(coolingSubLabel(cooling)).toBe("Не заполнено для 3 комнат");
    const hq = buildHqMetrics({
      project: { rooms: [{ id: "r1" }, { id: "r2" }, { id: "r3" }] },
      items: [baseItem()],
      publishCheck: { status: "ok", readiness: { readinessPercent: 100 }, counts: {} },
    });
    expect(hq.coolingSummary.status).toBe("warning");
  });
});
