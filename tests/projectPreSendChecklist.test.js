import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import { FRAME_BOM_SOURCE } from "../shared/frameBomProjectItems.js";
import { PURCHASE_STATUS } from "../shared/purchaseStatusRules.js";
import { matchSpecLineFilter } from "../shared/specLineFilters.js";
import {
  buildProjectPreSendChecklist,
  selectAllPreSendProblemIds,
  selectPreSendGroupIds,
} from "../shared/projectPreSendChecklist.js";
import { buildClientPurchaseSummary } from "../shared/clientPurchaseSummary.js";
import { getSpecLineSelectionId } from "../shared/specLineSelection.js";

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

const m034Material = {
  id: "m034",
  name: "Соединитель пластикового воздуховода 55×110 мм",
  unit: "шт",
  basePrice: 85,
  supplier: "ВентПро",
  link: "https://example.com/m034",
  clientSection: "trays_channels",
  clientSubsection: "NFT-каналы",
  clientVisibleDefault: false,
  visibleToClient: false,
};

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
    approved: true,
    clientSection: "stellage",
    clientSubsection: "Каркас и профиль",
    supplier: "КрепёжПро",
    link: "https://example.com/bolt",
    photoUrl: "/photos/bolt.jpg",
    purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT,
    ...over,
  };
}

describe("buildProjectPreSendChecklist", () => {
  it("counts no_price group", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem(),
      baseItem({ id: "p", price: 0 }),
    ]);
    const group = checklist.groups.find((g) => g.key === "no_price");
    expect(group.count).toBe(1);
    expect(group.filterKey).toBe("no_price");
  });

  it("counts no_link group", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem(),
      baseItem({ id: "l", link: "" }),
    ]);
    expect(checklist.groups.find((g) => g.key === "no_link").count).toBe(1);
  });

  it("counts no_supplier group", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem(),
      baseItem({ id: "s", supplier: "" }),
    ]);
    expect(checklist.groups.find((g) => g.key === "no_supplier").count).toBe(1);
  });

  it("hidden_from_client is warning severity, not blocker", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ visibleToClient: false, visible: false, approved: false }),
    ]);
    const group = checklist.groups.find((g) => g.key === "hidden_from_client");
    expect(group.severity).toBe("warning");
    expect(group.count).toBe(1);
    expect(checklist.blockers).toBe(0);
    expect(checklist.warnings).toBe(1);
  });

  it("m034 visible override true is not hidden", () => {
    const item = {
      id: "it_m034",
      materialId: "m034",
      name: m034Material.name,
      qty: 12,
      price: 85,
      supplier: "ВентПро",
      link: "https://example.com/m034",
      includedInProject: true,
      itemType: "material",
      visibleToClient: true,
      visible: true,
      approved: true,
      clientSection: "trays_channels",
      clientSubsection: "NFT-каналы",
    };
    const checklist = buildProjectPreSendChecklist([item], [m034Material]);
    expect(checklist.groups.find((g) => g.key === "hidden_from_client").count).toBe(0);
    expect(checklist.groups.find((g) => g.key === "ready_without_issues").count).toBe(1);
  });

  it("m034 visible override false is hidden", () => {
    const item = {
      id: "it_m034",
      materialId: "m034",
      name: m034Material.name,
      qty: 12,
      price: 85,
      supplier: "ВентПро",
      link: "https://example.com/m034",
      includedInProject: true,
      itemType: "material",
      visibleToClient: false,
      visible: false,
      approved: false,
    };
    const checklist = buildProjectPreSendChecklist([item], [m034Material]);
    expect(checklist.groups.find((g) => g.key === "hidden_from_client").count).toBe(1);
    expect(checklist.allProblemIds).toContain("it_m034");
  });

  it("not_fit is blocker", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ purchaseStatus: PURCHASE_STATUS.NOT_FIT }),
    ]);
    const group = checklist.groups.find((g) => g.key === "not_fit");
    expect(group.severity).toBe("blocker");
    expect(checklist.status).toBe("not_ready");
    expect(checklist.blockers).toBe(1);
  });

  it("need_help is warning", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ purchaseStatus: PURCHASE_STATUS.NEED_HELP }),
    ]);
    expect(checklist.groups.find((g) => g.key === "need_help").severity).toBe("warning");
    expect(checklist.status).toBe("warning");
    expect(checklist.blockers).toBe(0);
    expect(checklist.warnings).toBe(1);
  });

  it("replacement_check is warning", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ purchaseStatus: PURCHASE_STATUS.REPLACEMENT_CHECK }),
    ]);
    expect(checklist.groups.find((g) => g.key === "replacement_check").severity).toBe("warning");
    expect(checklist.warnings).toBe(1);
  });

  it("counts frame_bom group", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem(),
      baseItem({ id: "bom", source: FRAME_BOM_SOURCE, sourceType: FRAME_BOM_SOURCE }),
    ]);
    expect(checklist.groups.find((g) => g.key === "frame_bom").count).toBe(1);
  });

  it("select all problematic excludes normal client-ready rows", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "ok" }),
      baseItem({ id: "bad", price: 0 }),
    ]);
    const ids = selectAllPreSendProblemIds(checklist);
    expect(ids).toContain("bad");
    expect(ids).not.toContain("ok");
  });

  it("select all problematic includes hidden/no_price/no_supplier/not_fit but not no_link", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "p", price: 0 }),
      baseItem({ id: "l", link: "" }),
      baseItem({ id: "s", supplier: "" }),
      baseItem({ id: "h", visibleToClient: false, visible: false, approved: false }),
      baseItem({ id: "f", purchaseStatus: PURCHASE_STATUS.NOT_FIT }),
    ]);
    const ids = selectAllPreSendProblemIds(checklist);
    expect(ids).toEqual(expect.arrayContaining(["p", "s", "h", "f"]));
    expect(ids).not.toContain("l");
  });

  it("status not_ready when blockers exist", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ price: 0 }),
      baseItem({ id: "l", link: "" }),
    ]);
    expect(checklist.status).toBe("not_ready");
    expect(checklist.tone).toBe("bad");
    expect(checklist.statusTitle).toBe("Не готово к отправке");
  });

  it("status warning when no blockers but real warnings exist", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ purchaseStatus: PURCHASE_STATUS.NEED_HELP }),
    ]);
    expect(checklist.status).toBe("warning");
    expect(checklist.tone).toBe("warn");
    expect(checklist.statusTitle).toBe("Можно отправлять с предупреждениями");
  });

  it("status ready when only no_link exists", () => {
    const checklist = buildProjectPreSendChecklist([baseItem({ link: "" })]);
    expect(checklist.status).toBe("ready");
    expect(checklist.tone).toBe("ok");
    expect(checklist.statusTitle).toBe("Готово к отправке");
    expect(checklist.blockers).toBe(0);
    expect(checklist.warnings).toBe(0);
    expect(checklist.noLinkCount).toBe(1);
    expect(checklist.statusDetail).toMatch(/не мешает отправке/i);
  });

  it("status ready when no blockers/warnings", () => {
    const checklist = buildProjectPreSendChecklist([baseItem()]);
    expect(checklist.status).toBe("ready");
    expect(checklist.tone).toBe("ok");
    expect(checklist.statusTitle).toBe("Готово к отправке");
    expect(checklist.blockers).toBe(0);
    expect(checklist.warnings).toBe(0);
  });

  it("filterKey maps to existing spec filters", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ link: "" }),
      baseItem({ id: "h", visibleToClient: false }),
    ]);
    for (const group of checklist.groups) {
      if (!group.filterKey || group.key === "ready_without_issues") continue;
      for (const id of group.itemIds) {
        const item = group.key === "hidden_from_client"
          ? baseItem({ id, visibleToClient: false })
          : group.key === "no_link"
            ? baseItem({ id, link: "" })
            : baseItem({ id });
        expect(matchSpecLineFilter(item, group.filterKey, "project")).toBe(true);
      }
    }
  });

  it("BOM ids with colon survive selected ids", () => {
    const bomId = "it_fbom:d1:rack1:m034";
    const checklist = buildProjectPreSendChecklist([
      baseItem({
        id: bomId,
        approved: true,
        source: FRAME_BOM_SOURCE,
        sourceType: FRAME_BOM_SOURCE,
      }),
    ]);
    const ids = selectPreSendGroupIds(checklist, "frame_bom");
    expect(ids).toEqual([bomId]);
    expect(checklist.allProblemIds).not.toContain(bomId);
  });

  it("excluded items are ignored", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "ex", includedInProject: false, price: 0, link: "" }),
      baseItem({ id: "ok" }),
    ]);
    expect(checklist.groups.find((g) => g.key === "no_price").count).toBe(0);
    expect(checklist.groups.find((g) => g.key === "no_link").count).toBe(0);
    expect(checklist.allProblemIds).not.toContain("ex");
    expect(checklist.groups.find((g) => g.key === "ready_without_issues").count).toBe(1);
  });

  it("group item ids use canonical spec selection id", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "it_row", materialId: "m001", link: "" }),
    ]);
    const ids = selectPreSendGroupIds(checklist, "no_link");
    expect(ids).toEqual(["it_row"]);
    expect(ids).not.toContain("m001");
    expect(getSpecLineSelectionId(baseItem({ id: "it_row", materialId: "m001" }))).toBe("it_row");
  });

  it("client total count equals clientPurchaseSummary.totalClientItems", () => {
    const items = [
      baseItem({ id: "a" }),
      baseItem({ id: "b", link: "" }),
      baseItem({ id: "c", visibleToClient: false, visible: false, approved: false }),
    ];
    const summary = buildClientPurchaseSummary(items);
    const checklist = buildProjectPreSendChecklist(items);
    expect(checklist.groups.find((g) => g.key === "client_total").count).toBe(
      summary.totalClientItems
    );
    expect(checklist.clientTotalCount).toBe(summary.totalClientItems);
  });

  it("ready without issues is separate from client total", () => {
    const items = [
      baseItem({ id: "ok1" }),
      baseItem({ id: "ok2" }),
      baseItem({ id: "bad", price: 0 }),
    ];
    const checklist = buildProjectPreSendChecklist(items);
    expect(checklist.groups.find((g) => g.key === "client_total").count).toBe(3);
    expect(checklist.groups.find((g) => g.key === "ready_without_issues").count).toBe(2);
    expect(checklist.groups.find((g) => g.key === "ready_without_issues").label).toBe(
      "Готово без проблем"
    );
  });

  it("no_link-only rows count as ready without issues", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "ok" }),
      baseItem({ id: "nolink", link: "" }),
    ]);
    expect(checklist.groups.find((g) => g.key === "ready_without_issues").count).toBe(2);
    expect(checklist.allProblemIds).not.toContain("nolink");
  });

  it("m034 visible override true counted in client total", () => {
    const item = {
      id: "it_m034",
      materialId: "m034",
      name: m034Material.name,
      qty: 12,
      price: 85,
      supplier: "ВентПро",
      link: "https://example.com/m034",
      includedInProject: true,
      itemType: "material",
      visibleToClient: true,
      visible: true,
      approved: true,
      clientSection: "trays_channels",
      clientSubsection: "NFT-каналы",
    };
    const checklist = buildProjectPreSendChecklist([item], [m034Material]);
    expect(checklist.clientTotalCount).toBe(1);
    expect(checklist.groups.find((g) => g.key === "client_total").count).toBe(1);
  });

  it("frame_bom group counts items with bomKey only", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem(),
      baseItem({
        id: "bom-key",
        sourceObjectIds: { bomKey: "crab_g", moduleRackKey: "rack1" },
      }),
    ]);
    expect(checklist.groups.find((g) => g.key === "frame_bom").count).toBe(1);
  });

  it("frame_bom group counts items with moduleRackKey and sourceKey", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({
        id: "frame_bom:d1:rack1:crab_t",
        sourceKey: "frame_bom:d1:rack1:crab_t",
        sourceObjectIds: { moduleRackKey: "rack1" },
      }),
    ]);
    expect(checklist.groups.find((g) => g.key === "frame_bom").count).toBe(1);
  });

  it("select BOM returns canonical item ids for production-style rows", () => {
    const bomId = "frame_bom:d1:rack1:bolt_m6";
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: bomId, sourceKey: "frame_bom:d1:rack1:bolt_m6" }),
    ]);
    const ids = selectPreSendGroupIds(checklist, "frame_bom");
    expect(ids).toEqual([bomId]);
  });

  it("Выбрать BOM is enabled when frame_bom count > 0", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "frame_bom:d1:rack1:crab_g", sourceKey: "frame_bom:d1:rack1:crab_g" }),
    ]);
    const group = checklist.groups.find((g) => g.key === "frame_bom");
    expect(group.count).toBeGreaterThan(0);
    expect(group.selectable).toBe(true);
  });

  it("no_link group has severity info", () => {
    const checklist = buildProjectPreSendChecklist([baseItem({ link: "" })]);
    expect(checklist.groups.find((g) => g.key === "no_link").severity).toBe("info");
  });

  it("no_link does not increase warnings or blockers", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "a", link: "" }),
      baseItem({ id: "b", link: "" }),
    ]);
    expect(checklist.warnings).toBe(0);
    expect(checklist.blockers).toBe(0);
    expect(checklist.noLinkCount).toBe(2);
  });

  it("no_link is excluded from allProblemIds", () => {
    const checklist = buildProjectPreSendChecklist([baseItem({ id: "l", link: "" })]);
    expect(checklist.allProblemIds).not.toContain("l");
    expect(checklist.groups.find((g) => g.key === "no_link").itemIds).toContain("l");
  });

  it("Выбрать без ссылки still selects no_link rows", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "ok" }),
      baseItem({ id: "l1", link: "" }),
      baseItem({ id: "l2", link: "" }),
    ]);
    expect(selectPreSendGroupIds(checklist, "no_link")).toEqual(["l1", "l2"]);
  });

  it("blocker count ignores no_link when real blocker exists", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "p", price: 0 }),
      baseItem({ id: "l", link: "" }),
    ]);
    expect(checklist.blockers).toBe(1);
    expect(checklist.warnings).toBe(0);
    expect(checklist.noLinkCount).toBe(1);
    expect(checklist.status).toBe("not_ready");
  });

  it("warning count ignores no_link when real warning exists", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "w", purchaseStatus: PURCHASE_STATUS.NEED_HELP }),
      baseItem({ id: "l", link: "" }),
    ]);
    expect(checklist.warnings).toBe(1);
    expect(checklist.blockers).toBe(0);
    expect(checklist.noLinkCount).toBe(1);
    expect(checklist.status).toBe("warning");
  });
});
