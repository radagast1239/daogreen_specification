import { describe, expect, it } from "vitest";
import {
  FRAME_BOM_MATERIALS,
  normalizeFrameCutSegments,
  buildTubeCrabBomPurchaseDraft,
  buildPerforatedAngleBomPurchaseDraft,
  buildFrameBomPurchaseDraft,
  validateFrameBomMaterialMap,
  assertNoExcludedTubeMaterials,
  totalPipeCutMeters,
  tubeCrabFastenerQtyFromCutList,
} from "../shared/frameBomMaterialMap.js";
import { calculateAngleFasteners } from "../src/frameConstructor/frameAngleStock.js";

describe("normalizeFrameCutSegments", () => {
  it("aggregates post/longitudinal/cross and ignores crabs", () => {
    const cuts = normalizeFrameCutSegments([
      { id: "post", length: 3200, qty: 6 },
      { id: "longitudinal", length: 1470, qty: 32 },
      { id: "cross", length: 460, qty: 48 },
      { id: "connector-t", length: "-", qty: 126 },
      { id: "nft-channel-horizontal", length: 2000, qty: 5 },
    ]);
    expect(cuts).toEqual([
      { lengthMm: 3200, qty: 6 },
      { lengthMm: 1470, qty: 32 },
      { lengthMm: 460, qty: 48 },
    ]);
  });

  it("merges identical lengths", () => {
    const cuts = normalizeFrameCutSegments([
      { id: "post", length: 1000, qty: 2 },
      { id: "cross", length: 1000, qty: 3 },
    ]);
    expect(cuts).toEqual([{ lengthMm: 1000, qty: 5 }]);
  });
});

describe("buildTubeCrabBomPurchaseDraft", () => {
  const tubeCutList = [
    { id: "post", length: 3200, qty: 6 },
    { id: "longitudinal", length: 1470, qty: 32 },
    { id: "cross", length: 460, qty: 48 },
  ];

  it("maps profile tube to m036 with pipeCuts and meter qty", () => {
    const items = buildTubeCrabBomPurchaseDraft({
      cutList: tubeCutList,
      tubeStock: {
        recommended: {
          title: "Только 6 м",
          stockCounts: { 6000: 15 },
        },
      },
      sourceFrameDrawingId: "fd_1",
      sourceRackKey: "rack_a",
    });

    const tube = items.find((i) => i.key === "profile_tube_20x20");
    expect(tube.materialId).toBe("m036");
    expect(tube.unit).toBe("м");
    expect(tube.qty).toBe(88.32);
    expect(tube.pipeCuts).toEqual([
      { lengthMm: 3200, qty: 6 },
      { lengthMm: 1470, qty: 32 },
      { lengthMm: 460, qty: 48 },
    ]);
    expect(tube.techNote).toContain("Резы профтрубы:");
    expect(tube.techNote).toContain("6 м — 15 шт");
    expect(tube.source).toBe("frame_bom");
    expect(tube.sourceFrameDrawingId).toBe("fd_1");
    expect(tube.sourceRackKey).toBe("rack_a");
    expect(assertNoExcludedTubeMaterials(items)).toBe(true);
    expect(totalPipeCutMeters(tube.pipeCuts)).toBe(88.32);
  });

  it("maps crab connectors from cutList", () => {
    const items = buildTubeCrabBomPurchaseDraft({
      cutList: [
        ...tubeCutList,
        { id: "connector-g", qty: 4, note: "2 компл. × 2 шт = 4 шт" },
        { id: "connector-t", qty: 126, note: "63 компл. × 2 шт = 126 шт" },
        { id: "connector-x", qty: 14, note: "7 компл. × 2 шт = 14 шт" },
        { id: "connector-a6", qty: 8, note: "2 компл. × 4 шт = 8 шт" },
      ],
    });

    expect(items.find((i) => i.key === "crab_g")).toMatchObject({ materialId: "m072", qty: 4 });
    expect(items.find((i) => i.key === "crab_t")).toMatchObject({ materialId: "m071", qty: 126 });
    expect(items.find((i) => i.key === "crab_x")).toMatchObject({ materialId: "m003", qty: 14 });
    expect(items.find((i) => i.key === "crab_a6")).toMatchObject({ materialId: "m__aFEHKzJpe", qty: 8 });
    expect(items.find((i) => i.key === "crab_a4")).toBeUndefined();
  });

  it("includes A4 when qty > 0 as компл.", () => {
    const items = buildTubeCrabBomPurchaseDraft({
      cutList: [{ id: "connector-a4", qty: 3, note: "3 компл." }],
    });
    const a4 = items.find((i) => i.key === "crab_a4");
    expect(a4).toMatchObject({
      materialId: "m_Vsbox6xIlT",
      unit: "компл.",
      qty: 3,
    });
  });

  it("adds bolt/nut/washer fasteners from crab cutList", () => {
    const items = buildTubeCrabBomPurchaseDraft({
      cutList: [
        { id: "connector-g", qty: 8 },
        { id: "connector-t", qty: 252 },
        { id: "connector-x", qty: 28 },
      ],
    });
    const expected = 8 * 0.5 + 252 * 1 + 28 * 2;
    expect(items.find((i) => i.key === "bolt_m6x20")?.qty).toBe(expected);
    expect(items.find((i) => i.key === "nut_m6")?.qty).toBe(expected);
    expect(items.find((i) => i.key === "spring_washer_m6")?.qty).toBe(expected);
  });

  it("maps NFT channel cutList rows to air duct materials", () => {
    const items = buildTubeCrabBomPurchaseDraft({
      cutList: [
        { id: "nft-channel-horizontal", qty: 12, note: "гориз." },
        { id: "nft-channel-sleeve", qty: 8 },
        { id: "nft-channel-elbow", qty: 4 },
      ],
    });
    const duct = items.find((i) => i.key === "air_duct_55x110_2000");
    const sleeve = items.find((i) => i.key === "air_duct_connector_55x110");
    const elbow = items.find((i) => i.key === "air_duct_elbow_55x110_90");
    expect(duct).toMatchObject({
      materialId: "m010",
      name: "Воздуховод пластиковый 55×110 мм, L=2000 мм",
      qty: 12,
    });
    expect(sleeve).toMatchObject({ materialId: "m034", qty: 8 });
    expect(elbow).toMatchObject({ materialId: "m011", qty: 4 });
    expect(duct.techNote).toContain("NFT-канал");
    expect(duct.clientNote).toContain("NFT-канал");
  });
});

describe("tubeCrabFastenerQtyFromCutList", () => {
  it("sums bolt/nut/washer qty from G/T/X crabs", () => {
    expect(tubeCrabFastenerQtyFromCutList([
      { id: "connector-g", qty: 8 },
      { id: "connector-t", qty: 252 },
      { id: "connector-x", qty: 28 },
    ])).toBe(312);
  });
});

describe("buildPerforatedAngleBomPurchaseDraft", () => {
  const baseAngleStock = (stockCounts, extra = {}) => ({
    recommended: {
      title: "Только 2 м",
      stockCounts,
      cleanCutLengthMm: 94000,
      overlapMaterialMm: 0,
      totalSpliceCount: 0,
      ...extra,
    },
  });

  it("maps only 2 m stock when 2500 count is zero", () => {
    const items = buildPerforatedAngleBomPurchaseDraft({
      cutList: [{ id: "post", length: 1900, qty: 4 }],
      angleStock: baseAngleStock({ 2000: 47, 2500: 0 }),
    });
    expect(items.find((i) => i.materialId === "m_ohPQJOXcD2")?.qty).toBe(47);
    expect(items.find((i) => i.materialId === "m_9CA2mrfCes")).toBeUndefined();
  });

  it("maps mixed 2 m and 2.5 m stock", () => {
    const items = buildPerforatedAngleBomPurchaseDraft({
      cutList: [{ id: "post", length: 1900, qty: 4 }],
      angleStock: baseAngleStock({ 2000: 33, 2500: 11 }, { title: "Автоподбор 2 м / 2.5 м" }),
    });
    expect(items.find((i) => i.materialId === "m_ohPQJOXcD2")?.qty).toBe(33);
    expect(items.find((i) => i.materialId === "m_9CA2mrfCes")?.qty).toBe(11);
  });

  it("fasteners bolts_only mode", () => {
    const frameData = { postCount: 6, longitudinalBeamCount: 32, crossBeamCount: 48 };
    const fasteners = calculateAngleFasteners(frameData, { crossBeamFasteningMode: "bolts_only" });
    const items = buildPerforatedAngleBomPurchaseDraft({
      cutList: [{ id: "post", length: 1900, qty: 6 }],
      angleStock: baseAngleStock({ 2000: 10, 2500: 0 }),
      fasteners,
      crossBeamFasteningMode: "bolts_only",
    });

    expect(items.find((i) => i.key === "fastening_angle")?.qty).toBe(64);
    expect(items.find((i) => i.key === "bolt_m6x20")?.qty).toBe(288);
    expect(items.find((i) => i.key === "nut_m6")?.qty).toBe(288);
    expect(items.find((i) => i.key === "spring_washer_m6")?.qty).toBe(288);
    expect(items.find((i) => i.key === "foot_plate")?.qty).toBe(6);
    expect(items.find((i) => i.key === "foot_plate")?.materialId).toBe("m_XnLhEmrLio");
  });

  it("fasteners brackets mode", () => {
    const frameData = { postCount: 6, longitudinalBeamCount: 32, crossBeamCount: 48 };
    const fasteners = calculateAngleFasteners(frameData, { crossBeamFasteningMode: "brackets" });
    const items = buildPerforatedAngleBomPurchaseDraft({
      cutList: [{ id: "post", length: 1900, qty: 6 }],
      angleStock: baseAngleStock({ 2000: 10, 2500: 0 }),
      fasteners,
      crossBeamFasteningMode: "brackets",
    });

    expect(items.find((i) => i.key === "fastening_angle")?.qty).toBe(160);
    expect(items.find((i) => i.key === "bolt_m6x20")?.qty).toBe(480);
    expect(items.find((i) => i.key === "nut_m6")?.qty).toBe(480);
    expect(items.find((i) => i.key === "spring_washer_m6")?.qty).toBe(480);
    expect(items.find((i) => i.key === "foot_plate")?.qty).toBe(6);
  });
});

describe("buildFrameBomPurchaseDraft", () => {
  it("routes tube_crab vs perforated_angle", () => {
    const tube = buildFrameBomPurchaseDraft({
      constructionType: "tube_crab",
      cutList: [{ id: "post", length: 1000, qty: 1 }],
    });
    expect(tube.some((i) => i.key === "profile_tube_20x20")).toBe(true);

    const angle = buildFrameBomPurchaseDraft({
      constructionType: "perforated_angle",
      angleStock: { recommended: { stockCounts: { 2000: 5, 2500: 0 }, title: "2 м" } },
      fasteners: { fasteningAngles: 1, boltsM6x20: 2, nutsM6: 2, growersM6: 2, footPlates: 1 },
    });
    expect(angle.some((i) => i.materialId === "m_ohPQJOXcD2")).toBe(true);
    expect(angle.some((i) => i.key === "profile_tube_20x20")).toBe(false);
  });
});

describe("validateFrameBomMaterialMap", () => {
  it("reports missing material ids", () => {
    const allIds = Object.values(FRAME_BOM_MATERIALS).map((m) => ({ id: m.materialId }));
    expect(validateFrameBomMaterialMap(allIds)).toEqual({ ok: true, missing: [] });

    const withoutA6 = allIds.filter((m) => m.id !== "m__aFEHKzJpe");
    expect(validateFrameBomMaterialMap(withoutA6)).toEqual({
      ok: false,
      missing: ["m__aFEHKzJpe"],
    });
  });
});
