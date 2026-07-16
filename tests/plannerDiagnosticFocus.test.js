/**
 * PHASE 0D — тесты резолвера навигации по diagnostic (чистая функция).
 */
import { describe, it, expect } from "vitest";
import { getDiagnosticFocusTarget } from "../src/planner/ui/diagnostics/diagnosticFocus.js";

const basePlan = () => ({
  nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 } },
  walls: [{ id: "w1", a: "n1", b: "n2" }],
  items: [{ id: "d1", kind: "door", x: 1550, y: -50, w: 900, h: 100, wallId: "w1" }],
  lines: [{ id: "r1", layer: "irrigation", pts: [{ x: 100, y: 100 }, { x: 100, y: 900 }] }],
  dimensions: [{ id: "dm1", p1: { x: 0, y: 0 }, p2: { x: 4000, y: 0 } }],
  rooms: [{ id: "rm1", polygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] }],
  zones: [{ id: "rm1", polygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] }],
  links: [{ id: "lk1", fromId: "d1", toId: "d1" }],
});

describe("diagnosticFocus", () => {
  it("1. wall diagnostic находит wall, selection и bounds", () => {
    const t = getDiagnosticFocusTarget(basePlan(), { entityType: "wall", entityId: "w1" });
    expect(t.selection).toEqual({ coll: "walls", id: "w1" });
    expect(t.canFocus).toBe(true);
    expect(t.point).toEqual({ x: 2000, y: 0 });
    expect(t.bounds).toEqual({ minX: 0, minY: 0, maxX: 4000, maxY: 0 });
  });

  it("2. item/opening diagnostic находит item и центр", () => {
    const t = getDiagnosticFocusTarget(basePlan(), { entityType: "opening", entityId: "d1" });
    expect(t.selection).toEqual({ coll: "items", id: "d1" });
    expect(t.canFocus).toBe(true);
    expect(t.point).toEqual({ x: 1550 + 450, y: -50 + 50 });
  });

  it("3. route diagnostic находит точки трассы", () => {
    const t = getDiagnosticFocusTarget(basePlan(), { entityType: "route", entityId: "r1" });
    expect(t.selection).toEqual({ coll: "lines", id: "r1" });
    expect(t.canFocus).toBe(true);
    expect(t.point).toEqual({ x: 100, y: 500 });
  });

  it("4. node diagnostic находит координату и связанную стену", () => {
    const t = getDiagnosticFocusTarget(basePlan(), { entityType: "node", entityId: "n2" });
    expect(t.point).toEqual({ x: 4000, y: 0 });
    expect(t.selection).toEqual({ coll: "walls", id: "w1" }); // стена, использующая узел
    expect(t.canFocus).toBe(true);
  });

  it("5. missing wall не вызывает исключение → not found", () => {
    const t = getDiagnosticFocusTarget(basePlan(), { entityType: "wall", entityId: "wX" });
    expect(t.canFocus).toBe(false);
    expect(t.selection).toBeNull();
    expect(t.reason).toBe("entity_not_found");
  });

  it("6. NaN geometry → canFocus:false, selection сохраняется", () => {
    const plan = basePlan();
    plan.nodes.n2 = { x: NaN, y: 0 };
    const t = getDiagnosticFocusTarget(plan, { entityType: "wall", entityId: "w1" });
    expect(t.canFocus).toBe(false);
    expect(t.selection).toEqual({ coll: "walls", id: "w1" }); // выбрать source можно
    expect(t.point).toBeNull();
  });

  it("7. missing target (WALL_NODE_MISSING) выбирает source wall", () => {
    const plan = basePlan();
    plan.walls = [{ id: "w1", a: "n1", b: "nX" }]; // nX отсутствует
    const t = getDiagnosticFocusTarget(plan, { entityType: "wall", entityId: "w1", relatedEntityIds: ["nX"] });
    expect(t.selection).toEqual({ coll: "walls", id: "w1" });
    expect(t.canFocus).toBe(false);
  });

  it("8. room diagnostic → selection zones + центр полигона", () => {
    const t = getDiagnosticFocusTarget(basePlan(), { entityType: "room", entityId: "rm1" });
    expect(t.selection).toEqual({ coll: "zones", id: "rm1" });
    expect(t.canFocus).toBe(true);
    expect(t.point).toEqual({ x: 2000, y: 1500 });
  });

  it("dimension → без selection, но с центром", () => {
    const t = getDiagnosticFocusTarget(basePlan(), { entityType: "dimension", entityId: "dm1" });
    expect(t.selection).toBeNull();
    expect(t.canFocus).toBe(true);
    expect(t.point).toEqual({ x: 2000, y: 0 });
  });

  it("plan-level diagnostic → без геометрии", () => {
    const t = getDiagnosticFocusTarget(basePlan(), { entityType: "plan", entityId: null, code: "PLAN_FIELD_INVALID_TYPE" });
    expect(t.canFocus).toBe(false);
    expect(t.selection).toBeNull();
  });

  it("9. функция не мутирует plan", () => {
    const plan = basePlan();
    const clone = structuredClone(plan);
    getDiagnosticFocusTarget(plan, { entityType: "wall", entityId: "w1" });
    getDiagnosticFocusTarget(plan, { entityType: "node", entityId: "n1" });
    expect(plan).toEqual(clone);
  });

  it("устойчивость к мусору (null plan / null diagnostic)", () => {
    expect(() => getDiagnosticFocusTarget(null, { entityType: "wall" })).not.toThrow();
    expect(() => getDiagnosticFocusTarget({}, null)).not.toThrow();
    expect(getDiagnosticFocusTarget(null, {}).canFocus).toBe(false);
  });
});
