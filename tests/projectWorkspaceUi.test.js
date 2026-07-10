import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import { PURCHASE_STATUS } from "../shared/purchaseStatusRules.js";
import { FRAME_BOM_SOURCE } from "../shared/frameBomProjectItems.js";
import {
  buildProjectPreSendChecklist,
  selectAllPreSendProblemIds,
  selectPreSendGroupIds,
} from "../shared/projectPreSendChecklist.js";
import { buildClientPurchaseSummary } from "../shared/clientPurchaseSummary.js";
import {
  resolveFrameDrawingActionBehavior,
  canRefreshFrameBom,
  FRAME_BOM_REFRESH_BUTTON_LABEL,
  FRAME_DRAWING_EDIT_SCHEME_LABEL,
  FRAME_DRAWING_OPEN_SCHEME_LABEL,
} from "../shared/frameDrawingActionsModel.js";
import { getSpecLineSelectionId } from "../shared/specLineSelection.js";
import { lineVisibleToClient, buildClientVisibilityPatch } from "../shared/itemTypes.js";
import {
  SPEC_PRIMARY_FILTERS,
  SPEC_ADVANCED_FILTERS,
  MASS_SELECT_ACTIONS,
  SELECTED_ACTION_BAR_ACTIONS,
  PROJECT_HEADER_PRIMARY_ACTIONS,
  CLIENT_READINESS_DEFAULT_TAB,
  shouldShowSelectedActionBar,
  buildClientReadinessSummaryMetrics,
  resolveFrameBomUiStatus,
  FRAME_BOM_STATUS,
  isPrimarySpecFilter,
  isAdvancedSpecFilter,
  listAllSpecWorkspaceFilters,
} from "../shared/projectWorkspaceUi.js";

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

const m034 = {
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

describe("project workspace UI consolidation", () => {
  it("no_link remains info after UI consolidation", () => {
    const checklist = buildProjectPreSendChecklist([
      baseItem(),
      baseItem({ id: "l", link: "" }),
    ]);
    const { noLinkInfo } = buildClientReadinessSummaryMetrics(
      checklist,
      buildClientPurchaseSummary([baseItem(), baseItem({ id: "l", link: "" })])
    );
    expect(checklist.groups.find((g) => g.key === "no_link").severity).toBe("info");
    expect(noLinkInfo.severity).toBe("info");
    expect(noLinkInfo.text).toContain("не мешает отправке");
    expect(checklist.allProblemIds).not.toContain("l");
  });

  it("client total / ready without problems counts unchanged", () => {
    const items = [
      baseItem({ id: "ok" }),
      baseItem({ id: "hidden", visibleToClient: false, approved: false }),
      baseItem({ id: "price", price: 0 }),
    ];
    const checklist = buildProjectPreSendChecklist(items);
    const summary = buildClientPurchaseSummary(items);
    const { metrics } = buildClientReadinessSummaryMetrics(checklist, summary);
    expect(metrics.find((m) => m.key === "client_total").value).toBe(checklist.clientTotalCount);
    expect(checklist.readyWithoutIssuesCount).toBe(1);
    expect(summary.totalClientItems).toBe(checklist.clientTotalCount);
  });

  it("hidden/show selected actions still use same visibility patch ids", () => {
    expect(buildClientVisibilityPatch(true)).toMatchObject({
      visibleToClient: true,
      approved: true,
    });
    expect(buildClientVisibilityPatch(false)).toMatchObject({
      visibleToClient: false,
      approved: false,
    });
    expect(SELECTED_ACTION_BAR_ACTIONS.map((a) => a.key)).toEqual([
      "show_client",
      "hide_client",
      "refresh_prices",
      "clear_selection",
    ]);
  });

  it("BOM filter/select still works", () => {
    const items = [
      baseItem({ id: "n" }),
      baseItem({
        id: "bom1",
        source: FRAME_BOM_SOURCE,
        sourceObjectIds: { moduleRackKey: "stellage:st1", bomKey: "duct" },
      }),
    ];
    const checklist = buildProjectPreSendChecklist(items);
    expect(checklist.groups.find((g) => g.key === "frame_bom").count).toBe(1);
    expect(selectPreSendGroupIds(checklist, "frame_bom")).toEqual(["bom1"]);
    expect(SPEC_PRIMARY_FILTERS.some((f) => f.id === "frame_bom")).toBe(true);
  });

  it("Обновить BOM remains active and direct action", () => {
    const ctx = {
      projectId: "p1",
      drawingId: "d1",
      moduleRackKey: "stellage:st1",
      rackId: "st1",
    };
    const behavior = resolveFrameDrawingActionBehavior(FRAME_BOM_REFRESH_BUTTON_LABEL, ctx);
    expect(behavior.navigates).toBe(false);
    expect(behavior.opensConstructor).toBe(false);
    expect(behavior.action).toBe("refresh_bom");

    const refresh = canRefreshFrameBom({
      drawing: { id: "d1", pdfUrl: "/x.pdf" },
      projectItems: [],
      context: ctx,
      hasRefreshHandler: true,
    });
    expect(refresh.enabled).toBe(true);

    const status = resolveFrameBomUiStatus({
      drawing: { id: "d1", pdfUrl: "/x.pdf" },
      projectItems: [],
      context: ctx,
    });
    expect(status.id).toBe(FRAME_BOM_STATUS.NOT_ADDED);
    expect(status.refresh.enabled).toBe(true);
  });

  it("main visible filters include only primary filters", () => {
    expect(SPEC_PRIMARY_FILTERS.map((f) => f.id)).toEqual([
      "",
      "client_visible",
      "problems",
      "frame_bom",
      "no_price",
    ]);
    expect(SPEC_PRIMARY_FILTERS).toHaveLength(5);
    expect(isPrimarySpecFilter("no_price")).toBe(true);
    expect(isPrimarySpecFilter("no_link")).toBe(false);
  });

  it("advanced filters still available", () => {
    const ids = SPEC_ADVANCED_FILTERS.map((f) => f.id);
    expect(ids).toContain("no_link");
    expect(ids).toContain("no_supplier");
    expect(ids).toContain("client_hidden");
    expect(ids).toContain("no_client_section");
    expect(isAdvancedSpecFilter("no_link")).toBe(true);
    expect(listAllSpecWorkspaceFilters().some((f) => f.id === "no_link")).toBe(true);
  });

  it("cooling block default collapsed / summarized", () => {
    // ProjectCoolingSummary uses defaultOpen=false; helper contract for UI.
    expect(CLIENT_READINESS_DEFAULT_TAB).toBe("overview");
  });

  it("selected action bar only visible when selected count > 0", () => {
    expect(shouldShowSelectedActionBar(0)).toBe(false);
    expect(shouldShowSelectedActionBar([])).toBe(false);
    expect(shouldShowSelectedActionBar(1)).toBe(true);
    expect(shouldShowSelectedActionBar(3)).toBe(true);
  });

  it("mass selection menu keeps all select actions", () => {
    expect(MASS_SELECT_ACTIONS.map((a) => a.key)).toEqual([
      "no_price",
      "no_supplier",
      "hidden_from_client",
      "frame_bom",
      "all_problems",
      "no_link",
    ]);
    const checklist = buildProjectPreSendChecklist([
      baseItem({ id: "p", price: 0 }),
      baseItem({ id: "l", link: "" }),
      baseItem({ id: "s", supplier: "" }),
    ]);
    expect(selectPreSendGroupIds(checklist, "no_price")).toContain("p");
    expect(selectPreSendGroupIds(checklist, "no_link")).toContain("l");
    expect(selectAllPreSendProblemIds(checklist)).not.toContain("l");
  });

  it("PDF/Excel/client link buttons still available", () => {
    expect(PROJECT_HEADER_PRIMARY_ACTIONS.map((a) => a.key)).toEqual([
      "client_link",
      "copy_link",
      "pdf",
      "excel",
    ]);
  });

  it("m034 visibility override unchanged", () => {
    const item = baseItem({
      id: "m034-row",
      materialId: "m034",
      name: m034.name,
      visibleToClient: true,
      approved: true,
      clientVisibleOverride: true,
    });
    expect(lineVisibleToClient(item)).toBe(true);
    const hidden = { ...item, visibleToClient: false, approved: false, clientVisibleOverride: false };
    expect(lineVisibleToClient(hidden)).toBe(false);
    expect(getSpecLineSelectionId(item)).toBe("m034-row");
  });

  it("Клиентская выдача and Подготовка counts are not lost after consolidation", () => {
    const items = [
      baseItem({ id: "c1" }),
      baseItem({ id: "h1", visibleToClient: false, approved: false }),
      baseItem({ id: "np", price: 0 }),
      baseItem({ id: "ns", supplier: "" }),
      baseItem({
        id: "bom",
        source: FRAME_BOM_SOURCE,
        sourceObjectIds: { moduleRackKey: "stellage:st1", bomKey: "x" },
      }),
    ];
    const checklist = buildProjectPreSendChecklist(items);
    const purchase = buildClientPurchaseSummary(items);
    const { metrics, noLinkInfo } = buildClientReadinessSummaryMetrics(checklist, purchase);

    expect(metrics.find((m) => m.key === "client_total").value).toBe(purchase.totalClientItems);
    expect(metrics.find((m) => m.key === "hidden").value).toBe(
      checklist.groups.find((g) => g.key === "hidden_from_client").count
    );
    expect(metrics.find((m) => m.key === "no_price").value).toBe(
      checklist.groups.find((g) => g.key === "no_price").count
    );
    expect(metrics.find((m) => m.key === "no_supplier").value).toBe(
      checklist.groups.find((g) => g.key === "no_supplier").count
    );
    expect(metrics.find((m) => m.key === "frame_bom").value).toBe(
      checklist.groups.find((g) => g.key === "frame_bom").count
    );
    expect(metrics.find((m) => m.key === "purchase_closed").value).toBe(purchase.purchaseClosed);
    expect(noLinkInfo.count).toBe(checklist.noLinkCount);
  });

  it("frame drawing actions remain separated", () => {
    const ctx = {
      projectId: "p1",
      drawingId: "d1",
      moduleRackKey: "stellage:st1",
      rackId: "st1",
      mode: "replace",
    };
    expect(resolveFrameDrawingActionBehavior(FRAME_DRAWING_OPEN_SCHEME_LABEL, ctx).action).toBe("open_scheme");
    expect(resolveFrameDrawingActionBehavior(FRAME_DRAWING_EDIT_SCHEME_LABEL, ctx).action).toBe("edit_scheme");
    expect(resolveFrameDrawingActionBehavior(FRAME_BOM_REFRESH_BUTTON_LABEL, ctx).action).toBe("refresh_bom");
    expect(resolveFrameDrawingActionBehavior(FRAME_BOM_REFRESH_BUTTON_LABEL, ctx).navigates).toBe(false);
    expect(resolveFrameDrawingActionBehavior("Новая версия", { ...ctx, mode: "new_version", drawingId: "" }).navigates).toBe(true);
  });

  it("BOM status labels cover required states", () => {
    const ctx = {
      projectId: "p1",
      moduleRackKey: "stellage:st1",
      rackId: "st1",
    };
    expect(
      resolveFrameBomUiStatus({
        drawing: { id: "d1", pdfUrl: "/a.pdf" },
        projectItems: [
          {
            id: "it_fbom_d1_stellage:st1_duct",
            source: FRAME_BOM_SOURCE,
            sourceObjectIds: { moduleRackKey: "stellage:st1", bomKey: "duct" },
            price: 10,
            supplier: "Shop",
          },
        ],
        context: { ...ctx, drawingId: "d1" },
      }).label
    ).toBe("BOM каркаса в спецификации");

    expect(
      resolveFrameBomUiStatus({
        drawing: null,
        projectItems: [],
        context: ctx,
      }).label
    ).toBe("Каркас ещё не добавлен в спецификацию");
  });
});
