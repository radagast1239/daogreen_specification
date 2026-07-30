import { describe, expect, it } from "vitest";
import {
  buildFrameBomRepairPlan,
  buildResidualFrameBomTwinRepairPlan,
  countResidualFrameBomTwins,
  frameBomItemsForModuleRack,
  hasLegacyFrameBomRowsForRack,
  isBuilderSyncedFrameBomLine,
  isCanonicalFrameBomItem,
  isNonFrameRackItem,
  isProvenLegacyFrameBomTwin,
  mergeFrameBomIntoProjectItems,
} from "../shared/frameBomProjectItems.js";
import { resolveFrameBomUiStatus, FRAME_BOM_STATUS } from "../shared/projectWorkspaceUi.js";
import { restoreMissingNonFrameRackItems } from "../src/lib/projectBuilderHydrate.js";
import { buildFrameBomRefreshConfirmMessage } from "../src/frameConstructor/frameBomAddToProject.js";

const RACK_ID = "st_mrdwu5kzthoor";
const MODULE_RACK = `mod_protochka:${RACK_ID}`;
const SECTION = "Стеллаж 1";

const rackOpts = {
  projectId: "p_tvRZ7SOwL9",
  drawingId: "fd_drawing",
  moduleRackKey: MODULE_RACK,
  stellageId: RACK_ID,
  rackLabel: SECTION,
};

const materials = [
  { id: "m036", name: "Труба профильная", unit: "м", basePrice: 120, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m072", name: "Краб G", unit: "шт", basePrice: 15, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m073", name: "Болт М6", unit: "шт", basePrice: 0.5, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m003", name: "Краб X", unit: "шт", basePrice: 12, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m071", name: "Краб T", unit: "шт", basePrice: 10, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m074", name: "Гайка", unit: "шт", basePrice: 0.3, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m075", name: "Шайба", unit: "шт", basePrice: 0.2, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m076", name: "Уголок", unit: "шт", basePrice: 40, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m077", name: "Заглушка профиля", unit: "шт", basePrice: 5, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
  { id: "m078", name: "Саморез", unit: "шт", basePrice: 0.1, supplier: "M", link: "https://m", photoUrl: "/m.jpg" },
];

const FRAME_BOM_KEYS = [
  ["profile_tube_20x20", "m036", "Труба профильная"],
  ["crab_g", "m072", "Краб G"],
  ["bolt_m6x20", "m073", "Болт М6"],
  ["crab_x", "m003", "Краб X"],
  ["crab_t", "m071", "Краб T"],
  ["nut_m6", "m074", "Гайка"],
  ["washer_m6", "m075", "Шайба"],
  ["angle", "m076", "Уголок"],
  ["cap", "m077", "Заглушка профиля"],
  ["screw", "m078", "Саморез"],
];

const PLUMBING = [
  ["pp_pipe", "m110", "ПП труба д25", 12, 85, "Полив"],
  ["insert", "m111", "Врезка", 4, 45, "Полив"],
  ["flex", "m112", "Гибкая подводка", 8, 120, "Полив"],
  ["plug", "m113", "Заглушка", 6, 15, "Полив"],
  ["glue", "m114", "Клей", 2, 350, "Полив"],
  ["elbow", "m115", "Фитинг угол", 10, 25, "Полив"],
  ["tee", "m116", "Фитинг тройник", 6, 30, "Полив"],
  ["coupling", "m117", "Муфта", 8, 20, "Полив"],
  ["valve", "m118", "Кран", 2, 180, "Полив"],
  ["clamp", "m119", "Хомут", 20, 8, "Полив"],
  ["filter", "m120", "Фильтр", 1, 900, "Полив"],
  ["hose", "m121", "Шланг", 5, 60, "Полив"],
  ["adapter", "m122", "Переходник", 4, 35, "Полив"],
  ["seal", "m123", "Уплотнитель", 10, 12, "Полив"],
  ["bracket", "m124", "Крепёж полива", 8, 18, "Полив"],
  ["tape", "m125", "Фум-лента", 3, 40, "Полив"],
];

function canonicalFrameItem([bomKey, materialId, name], idx) {
  return {
    id: `it_fbom_fd_${MODULE_RACK}_${bomKey}`,
    materialId,
    name,
    qty: 10 + idx,
    price: 10 + idx,
    supplier: "FrameShop",
    actualPrice: 9 + idx,
    clientComment: `frame-${bomKey}`,
    visibleToClient: true,
    module: SECTION,
    section: SECTION,
    source: "frame_bom",
    sourceKey: `frame_bom:fd_drawing:${MODULE_RACK}:${bomKey}`,
    sourceObjectIds: { moduleRackKey: MODULE_RACK, bomKey },
    clientNote: "Из схемы стеллажа",
    status: "ordered",
  };
}

function ordinaryRackItem([idSuffix, materialId, name, qty, price, subcategory], idx) {
  return {
    id: `${RACK_ID}__ln_${idSuffix}`,
    materialId,
    name,
    qty,
    price,
    supplier: "PlumbShop",
    actualPrice: price - 1,
    clientComment: `keep-${idSuffix}`,
    visibleToClient: idx % 2 === 0,
    module: SECTION,
    section: SECTION,
    subcategory,
    status: "not_bought",
  };
}

function buildScenario26() {
  const frameItems = FRAME_BOM_KEYS.map(canonicalFrameItem);
  const ordinaryItems = PLUMBING.map(ordinaryRackItem);
  return { frameItems, ordinaryItems, items: [...frameItems, ...ordinaryItems] };
}

function purchaseDraftFromFrame() {
  return FRAME_BOM_KEYS.map(([key, materialId, name], idx) => ({
    key,
    materialId,
    name,
    unit: "шт",
    qty: 10 + idx,
  }));
}

describe("26-item regression: preserve ordinary rack materials on BOM refresh", () => {
  it("classifies 10 frame BOM + 16 ordinary + 0 safe duplicates", () => {
    const { items, frameItems, ordinaryItems } = buildScenario26();
    const canons = items.filter(isCanonicalFrameBomItem);

    expect(frameItems).toHaveLength(10);
    expect(ordinaryItems).toHaveLength(16);
    expect(items).toHaveLength(26);

    expect(frameBomItemsForModuleRack(items, MODULE_RACK, rackOpts)).toHaveLength(10);
    expect(countResidualFrameBomTwins(items)).toBe(0);
    expect(hasLegacyFrameBomRowsForRack(items, rackOpts)).toBe(false);

    for (const it of ordinaryItems) {
      expect(isBuilderSyncedFrameBomLine(it)).toBe(true); // id pattern only
      expect(isProvenLegacyFrameBomTwin(it, canons)).toBe(false);
      expect(isNonFrameRackItem(it, canons)).toBe(true);
      expect(isCanonicalFrameBomItem(it)).toBe(false);
    }
  });

  it("does not show legacy-dupes badge for ordinary st_*__ln_* lines", () => {
    const { items } = buildScenario26();
    const status = resolveFrameBomUiStatus({
      drawing: { id: "fd_drawing", pdfUrl: "/x.pdf", version: 1 },
      projectItems: items,
      context: { ...rackOpts, rackId: RACK_ID },
    });
    expect(status.id).toBe(FRAME_BOM_STATUS.IN_PURCHASE);
    expect(status.label).toMatch(/BOM каркаса в спецификации/);
    expect(status.label).not.toMatch(/дубл/i);
  });

  it("refresh replaces only 10 frame BOM and preserves all 16 ordinary ids/fields", () => {
    const { items, ordinaryItems } = buildScenario26();
    const ordinaryIds = ordinaryItems.map((it) => it.id);
    const snapshot = Object.fromEntries(
      ordinaryItems.map((it) => [
        it.id,
        {
          name: it.name,
          qty: it.qty,
          price: it.price,
          supplier: it.supplier,
          actualPrice: it.actualPrice,
          clientComment: it.clientComment,
          visibleToClient: it.visibleToClient,
          status: it.status,
        },
      ]),
    );

    const plan = buildFrameBomRepairPlan(items, purchaseDraftFromFrame(), {
      ...rackOpts,
      materials,
    });

    expect(plan.blocked).toBe(false);
    expect(plan.frameBomCount).toBe(10);
    expect(plan.safeDuplicateCount).toBe(0);
    expect(plan.preservedOtherCount).toBe(16);
    expect(plan.cleanedItems).toHaveLength(26);

    for (const id of ordinaryIds) {
      expect(plan.cleanedItems.some((it) => it.id === id)).toBe(true);
      const kept = plan.cleanedItems.find((it) => it.id === id);
      expect(kept).toMatchObject(snapshot[id]);
    }

    const msg = buildFrameBomRefreshConfirmMessage({
      frameBomCount: plan.frameBomCount,
      safeDuplicateCount: plan.safeDuplicateCount,
      preservedOtherCount: plan.preservedOtherCount,
    });
    expect(msg).toContain("Позиций каркаса сейчас: 10");
    expect(msg).toContain("Безопасных дублей BOM: 0");
    expect(msg).toContain("Остальные позиции стеллажа: 16");
    expect(msg).not.toMatch(/legacy/i);
  });

  it("repeated refresh stays at 26 and keeps ordinary ids", () => {
    const { items, ordinaryItems } = buildScenario26();
    const ordinaryIds = ordinaryItems.map((it) => it.id);
    const draft = purchaseDraftFromFrame();
    const opts = { ...rackOpts, materials };

    const first = mergeFrameBomIntoProjectItems(items, draft, opts);
    expect(first.blocked).toBe(false);
    expect(first.items).toHaveLength(26);

    const second = mergeFrameBomIntoProjectItems(first.items, draft, opts);
    expect(second.blocked).toBe(false);
    expect(second.items).toHaveLength(26);
    for (const id of ordinaryIds) {
      expect(second.items.some((it) => it.id === id)).toBe(true);
    }
  });

  it("recovery from 10 frame-only rows restores 16 ordinary builder lines without duplicating frame BOM", () => {
    const { frameItems, ordinaryItems } = buildScenario26();
    const wiped = [...frameItems];
    expect(wiped).toHaveLength(10);

    const restored = restoreMissingNonFrameRackItems(wiped, ordinaryItems);
    expect(restored.addedCount).toBe(16);
    expect(restored.items).toHaveLength(26);
    expect(restored.items.filter(isCanonicalFrameBomItem)).toHaveLength(10);

    const again = restoreMissingNonFrameRackItems(restored.items, ordinaryItems);
    expect(again.addedCount).toBe(0);
    expect(again.items).toHaveLength(26);
  });
});

describe("residual twin: plumbing st__ln with different materialId is preserved", () => {
  it("keeps legitimate plumbing when canonical frame BOM has another materialId", () => {
    const canon = canonicalFrameItem(FRAME_BOM_KEYS[2], 2); // bolt m073
    const plumbing = ordinaryRackItem(PLUMBING[0], 0); // pp pipe m110
    expect(isBuilderSyncedFrameBomLine(plumbing)).toBe(true);
    expect(isProvenLegacyFrameBomTwin(plumbing, [canon])).toBe(false);

    const plan = buildResidualFrameBomTwinRepairPlan([plumbing, canon]);
    expect(plan.removeItemIds).toHaveLength(0);
    expect(plan.cleanedItems.some((it) => it.id === plumbing.id)).toBe(true);
    expect(plan.cleanedItems.some((it) => it.id === canon.id)).toBe(true);
  });
});

describe("B2 safety: same-material ordinary rack line is preserved", () => {
  it("refresh keeps ordinary st__ln with same materialId as canonical frame BOM", () => {
    const canon = canonicalFrameItem(FRAME_BOM_KEYS[2], 2); // m073 bolt
    const ordinarySameMat = {
      id: `${RACK_ID}__ln_extra_bolt_stock`,
      materialId: "m073",
      name: "Болт М6 запас",
      qty: 40,
      price: 0.5,
      supplier: "PlumbShop",
      clientComment: "отдельный запас",
      module: SECTION,
      section: SECTION,
      status: "not_bought",
    };
    const items = [canon, ordinarySameMat];
    const plan = buildFrameBomRepairPlan(items, purchaseDraftFromFrame(), {
      ...rackOpts,
      materials,
    });
    expect(plan.blocked).toBe(false);
    expect(plan.cleanedItems.some((it) => it.id === ordinarySameMat.id)).toBe(true);
    expect(plan.removeItemIds).not.toContain(ordinarySameMat.id);
    const bolts = plan.cleanedItems.filter((it) => it.materialId === "m073");
    expect(bolts.length).toBeGreaterThanOrEqual(2);
    expect(bolts.some((it) => it.id === ordinarySameMat.id)).toBe(true);
    expect(bolts.some((it) => String(it.id).startsWith("it_fbom_"))).toBe(true);
  });
});
