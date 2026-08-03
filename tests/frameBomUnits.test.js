import { describe, expect, it } from "vitest";
import {
  deriveFrameBomPipeCutMetres,
  normalizeFrameBomDraftQuantity,
  normalizeFrameBomDraftUnits,
  resolveFrameBomUnitKind,
} from "../shared/frameBomUnits.js";
import { scaleFrameBomDraftForRackCount } from "../src/frameConstructor/frameBomAddToProject.js";

const cuts10815 = [
  { lengthMm: 2800, qty: 2 },
  { lengthMm: 1300, qty: 3 },
  { lengthMm: 1315, qty: 1 },
];

describe("Frame BOM commercial unit contract", () => {
  it.each(["м", "м.", "м.п.", "м.п", "пог.м", "пог. м", "погонный метр", "погонные метры"])(
    "recognizes metre unit %s",
    (unit) => expect(resolveFrameBomUnitKind(unit)).toBe("metre"),
  );

  it.each(["шт", "шт.", "штука", "штуки", "комплект", "компл.", "уп.", "упаковка"])(
    "recognizes piece unit %s",
    (unit) => expect(resolveFrameBomUnitKind(unit)).toBe("piece"),
  );

  it("derives metres only from valid millimetre pipe cuts", () => {
    expect(deriveFrameBomPipeCutMetres([
      { lengthMm: 2800, qty: 10 },
      { lengthMm: 1300, qty: 35 },
      { lengthMm: 660, qty: 5 },
    ])).toMatchObject({ ok: true, qty: 76.8 });
  });

  it("normalizes a generic metre material with cuts without key/material heuristics", () => {
    const [line] = scaleFrameBomDraftForRackCount([{
      materialId: "m_generic",
      unit: "м",
      qty: 10815,
      pipeCuts: cuts10815,
    }], 1);
    expect(line.qty).toBe(10.815);
  });

  it("keeps a known tube material as pieces when its commercial unit is pieces", () => {
    const [line] = scaleFrameBomDraftForRackCount([{
      key: "profile_tube_20x20",
      materialId: "m036",
      unit: "шт.",
      qty: 10815,
      pipeCuts: cuts10815,
    }], 1);
    expect(line.qty).toBe(10815);
  });

  it("parses dot/comma metres without cuts and never divides a raw metre value", () => {
    expect(normalizeFrameBomDraftQuantity({ unit: "м", qty: "10.815" }).qty).toBe(10.815);
    expect(normalizeFrameBomDraftQuantity({ unit: "м", qty: "10,815" }).qty).toBe(10.815);
    expect(normalizeFrameBomDraftQuantity({ unit: "м", qty: 10815 }).qty).toBe(10815);
  });

  it("does not infer metres for an unknown unit even when cuts exist", () => {
    expect(normalizeFrameBomDraftQuantity({
      materialId: "m036",
      unit: "лист",
      qty: 10815,
      pipeCuts: cuts10815,
    })).toMatchObject({ ok: true, qty: 10815, unitKind: "unknown", source: "raw" });
  });

  it.each([
    [[{ lengthMm: -1, qty: 1 }], "PIPE_CUT_LENGTH_INVALID"],
    [[{ lengthMm: "bad", qty: 1 }], "PIPE_CUT_LENGTH_INVALID"],
    [[{ lengthMm: 1000, qty: -1 }], "PIPE_CUT_QTY_INVALID"],
    [[{ lengthMm: 1000, qty: "bad" }], "PIPE_CUT_QTY_INVALID"],
  ])("blocks invalid metre cut derivation", (pipeCuts, reason) => {
    expect(normalizeFrameBomDraftQuantity({ unit: "м", qty: 5, pipeCuts }))
      .toMatchObject({ ok: false, qty: 0, reason });
  });

  it("allows zero but blocks negative/malformed raw quantities", () => {
    expect(normalizeFrameBomDraftQuantity({ unit: "шт.", qty: 0 })).toMatchObject({ ok: true, qty: 0 });
    expect(normalizeFrameBomDraftQuantity({ unit: "шт.", qty: -1 })).toMatchObject({ ok: false, reason: "RAW_QTY_INVALID" });
    expect(normalizeFrameBomDraftQuantity({ unit: "м", qty: "10,8,15" })).toMatchObject({ ok: false, reason: "RAW_QTY_INVALID" });
  });

  it("is pure and idempotent at three-decimal precision", () => {
    const original = { unit: "м", qty: 10815, pipeCuts: cuts10815.map((cut) => ({ ...cut })) };
    const first = normalizeFrameBomDraftUnits([original]);
    const second = normalizeFrameBomDraftUnits(first.items);
    expect(first).toEqual(second);
    expect(first.items[0].qty).toBe(10.815);
    expect(original.qty).toBe(10815);
  });
});
