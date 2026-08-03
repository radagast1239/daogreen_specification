/**
 * Mutation proof: production base 64f7b912 fails the new Frame BOM contracts;
 * current worktree code passes them.
 *
 * Does not modify the production tag. Old scale behavior is taken from
 * `git show 64f7b912:src/frameConstructor/frameBomAddToProject.js`.
 */
import { describe, expect, it } from "vitest";
import {
  buildFrameBomRepairPlan,
  mergeBuilderTwinPurchaseFields,
} from "../shared/frameBomProjectItems.js";
import { scaleFrameBomDraftForRackCount } from "../src/frameConstructor/frameBomAddToProject.js";

const PROD_BASE = "64f7b91287cf4e195c5396285c807467be64740d";

const cuts10815 = [
  { lengthMm: 2800, qty: 2 },
  { lengthMm: 1300, qty: 3 },
  { lengthMm: 1315, qty: 1 },
];

/** Exact scaleFrameBomDraftForRackCount from production base 64f7b912. */
function scaleFrameBomDraftForRackCountProdBase(purchaseDraft = [], rackCount = 1) {
  const count = Math.max(1, Number(rackCount) || 1);
  return (purchaseDraft || []).map((line) => ({
    ...line,
    qty: Math.round((Number(line.qty) || 0) * count * 100) / 100,
    pipeCuts: Array.isArray(line.pipeCuts)
      ? line.pipeCuts.map((cut) => ({
          ...cut,
          qty: Math.round((Number(cut.qty) || 0) * count * 100) / 100,
        }))
      : line.pipeCuts,
  }));
}

describe(`mutation proof vs production base ${PROD_BASE.slice(0, 7)}`, () => {
  it("1. arbitrary metre material with pipeCuts: prod base keeps raw qty, new code derives metres", () => {
    const draft = [{
      materialId: "m_generic",
      unit: "м",
      qty: 10815,
      pipeCuts: cuts10815,
    }];
    const prod = scaleFrameBomDraftForRackCountProdBase(draft, 1);
    const next = scaleFrameBomDraftForRackCount(draft, 1);
    expect(prod[0].qty).toBe(10815);
    expect(next[0].qty).toBe(10.815);
  });

  it("2–3. exact twin repair + dual-twin fail-closed exist only on new repair plan", () => {
    const opts = {
      projectId: "p1",
      drawingId: "d1",
      moduleRackKey: "rack1",
      stellageId: "st_rack_1",
      materials: [{ id: "m073", name: "Болт" }],
    };
    const canonical = {
      id: "it_fbom_d1_rack1_bolt",
      materialId: "m073",
      name: "Болт М6×20",
      unit: "шт.",
      qty: 10,
      source: "frame_bom",
      sourceType: "frame_bom",
      sourceKey: "frame_bom:d1:rack1:bolt",
      sourceObjectIds: {
        drawingId: "d1",
        moduleRackKey: "rack1",
        stellageId: "st_rack_1",
        bomKey: "bolt",
      },
      itemRole: "purchase",
    };
    const twin = (id) => ({
      id,
      materialId: "m073",
      name: "  Болт   М6×20 ",
      unit: "шт.",
      qty: 999,
      itemRole: "purchase",
      status: "ordered",
      actualPrice: 0,
      visibleToClient: false,
      clientComment: "meta",
    });
    const draft = [{ key: "bolt", materialId: "m073", name: "Болт М6×20", unit: "шт.", qty: 34 }];

    const oneTwin = buildFrameBomRepairPlan([canonical, twin("st_rack_1__ln_old")], draft, opts);
    expect(oneTwin.blocked).toBe(false);
    expect(oneTwin.exactTwinRemovedIds).toEqual(["st_rack_1__ln_old"]);
    expect(oneTwin.cleanedItems).toHaveLength(1);
    expect(oneTwin.cleanedItems[0]).toMatchObject({
      qty: 34,
      status: "ordered",
      actualPrice: 0,
      visibleToClient: false,
      clientComment: "meta",
    });

    const twoTwins = buildFrameBomRepairPlan(
      [canonical, twin("st_rack_1__ln_a"), twin("st_rack_1__ln_b")],
      draft,
      opts,
    );
    expect(twoTwins).toMatchObject({
      blocked: true,
      reason: "EXACT_TWIN_MULTIPLE_ORDINARY",
      removeItemIds: [],
    });
  });

  it("4. visibility=false and actualPrice=0 survive twin→canonical metadata merge", () => {
    const merged = mergeBuilderTwinPurchaseFields(
      {
        id: "canon",
        qty: 10,
        unit: "шт.",
        source: "frame_bom",
        actualPrice: 7,
        visibleToClient: true,
        clientComment: "keep-if-empty-twin",
      },
      {
        id: "st_x__ln_y",
        qty: 999,
        unit: "шт.",
        actualPrice: 0,
        visibleToClient: false,
        visible: false,
        approved: false,
        clientComment: "",
        clientSection: "Каркас",
      },
    );
    expect(merged).toMatchObject({
      id: "canon",
      qty: 10,
      unit: "шт.",
      source: "frame_bom",
      actualPrice: 0,
      visibleToClient: false,
      visible: false,
      approved: false,
      clientComment: "keep-if-empty-twin",
      clientSection: "Каркас",
    });
  });
});
