/**
 * PHASE 0B — backend parsing/guard unit tests (6.1).
 * Чистые функции, без БД.
 */
import { describe, it, expect } from "vitest";
import {
  parsePlannerPlan,
  resolveProjectPlanFields,
  shouldPreserveStoredPlan,
  PLANNER_PLAN_JSON_INVALID,
} from "../backend/src/plannerPlanState.js";

describe("parsePlannerPlan", () => {
  it("валидный JSON возвращает план без изменений (status ok)", () => {
    const raw = JSON.stringify({ walls: [{ id: "w1" }], nodes: { n1: { x: 0, y: 0 } } });
    const res = parsePlannerPlan(raw);
    expect(res.status).toBe("ok");
    expect(res.plan).toEqual({ walls: [{ id: "w1" }], nodes: { n1: { x: 0, y: 0 } } });
  });

  it("null/undefined/пусто/'{}' — отсутствие плана (empty), НЕ повреждение", () => {
    for (const raw of [null, undefined, "", "   ", "{}", "  {}  "]) {
      const res = parsePlannerPlan(raw);
      expect(res.status, `raw=${JSON.stringify(raw)}`).toBe("empty");
      expect(res.plan).toBeNull();
    }
  });

  it("малформный JSON — corrupt с plan:null и explicit code", () => {
    for (const raw of ['{"walls":', "{bad json", "not json at all", '{"a":1,'])
    {
      const res = parsePlannerPlan(raw);
      expect(res.status, `raw=${raw}`).toBe("corrupt");
      expect(res.plan).toBeNull();
      expect(res.code).toBe(PLANNER_PLAN_JSON_INVALID);
    }
  });

  it("валидный JSON, но не непустой object → empty (совместимо с прежним контрактом)", () => {
    for (const raw of ["5", "true", '"str"', "[]", "null"]) {
      const res = parsePlannerPlan(raw);
      expect(res.status, `raw=${raw}`).toBe("empty");
      expect(res.plan).toBeNull();
    }
  });

  it("parser никогда не бросает непойманное исключение", () => {
    expect(() => parsePlannerPlan("  broken")).not.toThrow();
    expect(() => parsePlannerPlan({})).not.toThrow();
  });

  it("исходный сырой payload не попадает в результат при повреждении", () => {
    const raw = '{"secret":"do-not-leak", oops';
    const res = parsePlannerPlan(raw);
    expect(res.status).toBe("corrupt");
    expect(JSON.stringify(res)).not.toContain("do-not-leak");
    expect(JSON.stringify(res)).not.toContain("oops");
  });
});

describe("resolveProjectPlanFields", () => {
  it("валидный план → plan сохраняется, plannerPlanState не добавляется", () => {
    const raw = JSON.stringify({ walls: [{ id: "w1" }] });
    const res = resolveProjectPlanFields(raw, null);
    expect(res.plan).toEqual({ walls: [{ id: "w1" }] });
    expect(res.plannerPlanState).toBeUndefined();
  });

  it("пустой план → plan:null, без diagnostic (не повреждение)", () => {
    const res = resolveProjectPlanFields("{}", null);
    expect(res.plan).toBeNull();
    expect(res.plannerPlanState).toBeUndefined();
  });

  it("legacy floorPlan-fallback работает при пустом планере", () => {
    const floor = { walls: [{ id: "legacy" }] };
    const res = resolveProjectPlanFields("{}", floor);
    expect(res.plan).toEqual(floor);
    expect(res.plannerPlanState).toBeUndefined();
  });

  it("повреждённый план → plan:null + corrupt diagnostic, floorPlan НЕ подставляется", () => {
    const floor = { walls: [{ id: "legacy" }] };
    const res = resolveProjectPlanFields("{broken", floor);
    expect(res.plan).toBeNull();
    expect(res.plannerPlanState).toEqual({ status: "corrupt", code: PLANNER_PLAN_JSON_INVALID });
  });

  it("повреждённый план не превращается в {}", () => {
    const res = resolveProjectPlanFields("{broken", null);
    expect(res.plan).not.toEqual({});
    expect(res.plan).toBeNull();
  });
});

describe("shouldPreserveStoredPlan", () => {
  it("corrupt + патч без плана → сохранить исходные байты", () => {
    expect(shouldPreserveStoredPlan("{broken", { name: "new" })).toBe(true);
    expect(shouldPreserveStoredPlan("{broken", {})).toBe(true);
    expect(shouldPreserveStoredPlan("{broken", { plan: null })).toBe(true);
  });

  it("corrupt + явно переданный новый план → перезаписать разрешено", () => {
    expect(shouldPreserveStoredPlan("{broken", { plan: { walls: [] } })).toBe(false);
  });

  it("валидный/пустой сохранённый план → не блокировать запись", () => {
    expect(shouldPreserveStoredPlan(JSON.stringify({ walls: [] }), { name: "x" })).toBe(false);
    expect(shouldPreserveStoredPlan("{}", { name: "x" })).toBe(false);
    expect(shouldPreserveStoredPlan(null, { name: "x" })).toBe(false);
  });
});
