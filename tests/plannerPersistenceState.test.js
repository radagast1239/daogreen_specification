/**
 * PHASE 0B — frontend write-guard helper (6.3, чистая часть).
 */
import { describe, it, expect } from "vitest";
import {
  isPlannerPlanCorrupt,
  canPersistPlannerPlan,
  getPlannerPersistenceState,
  PLANNER_PLAN_JSON_INVALID,
} from "../src/planner/plannerPersistenceState.js";

describe("plannerPersistenceState", () => {
  const corruptProject = {
    id: "p1",
    name: "Проект",
    plan: null,
    plannerPlanState: { status: "corrupt", code: PLANNER_PLAN_JSON_INVALID },
  };
  const okProject = { id: "p2", name: "Проект 2", plan: { walls: [] } };
  const emptyProject = { id: "p3", name: "Проект 3", plan: null };

  it("распознаёт повреждённый план проекта", () => {
    expect(isPlannerPlanCorrupt(corruptProject)).toBe(true);
    expect(isPlannerPlanCorrupt(okProject)).toBe(false);
    expect(isPlannerPlanCorrupt(emptyProject)).toBe(false);
    expect(isPlannerPlanCorrupt(null)).toBe(false);
    expect(isPlannerPlanCorrupt(undefined)).toBe(false);
  });

  it("запрещает запись только при повреждении", () => {
    expect(canPersistPlannerPlan(corruptProject)).toBe(false);
    expect(canPersistPlannerPlan(okProject)).toBe(true);
    expect(canPersistPlannerPlan(emptyProject)).toBe(true);
    expect(canPersistPlannerPlan(null)).toBe(true);
  });

  it("getPlannerPersistenceState возвращает статус и код", () => {
    expect(getPlannerPersistenceState(corruptProject)).toEqual({
      status: "corrupt",
      canPersist: false,
      code: PLANNER_PLAN_JSON_INVALID,
    });
    expect(getPlannerPersistenceState(okProject)).toEqual({ status: "ok", canPersist: true });
  });
});
