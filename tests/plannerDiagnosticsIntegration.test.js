/**
 * PHASE 0D — интеграция read-only пайплайна проверки плана:
 *   validatePlanIntegrity → presentation (filter/group) → focus resolver.
 * Проверяет то, что делает клик по кнопке/элементу, без React DOM.
 * Подтверждает, что пайплайн не мутирует plan и не создаёт persisted-данных.
 */
import { describe, it, expect } from "vitest";
import { validatePlanIntegrity } from "../src/planner/core/validation/validatePlanIntegrity.js";
import { filterDiagnostics, groupBySeverity, isDiagnosticsStale } from "../src/planner/ui/diagnostics/diagnosticPresentation.js";
import { getDiagnosticFocusTarget } from "../src/planner/ui/diagnostics/diagnosticFocus.js";

function brokenPlan() {
  return {
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 }, nZ: { x: 9, y: 9 } },
    walls: [
      { id: "w1", a: "n1", b: "n2" },
      { id: "w2", a: "n2", b: "n1" }, // дубль ребра
      { id: "w3", a: "n1", b: "nX" }, // отсутствующий узел
    ],
    items: [],
    lines: [],
    dimensions: [],
  };
}

describe("PHASE 0D — read-only pipeline integration", () => {
  it("проверка → фильтр → группировка даёт панель-готовые данные", () => {
    const plan = brokenPlan();
    const before = structuredClone(plan);

    const result = validatePlanIntegrity(plan);
    expect(result.valid).toBe(false);
    expect(result.summary.errors).toBeGreaterThan(0);

    // фильтр «только ошибки»
    const errorsOnly = filterDiagnostics(result.diagnostics, { error: true, warning: false, info: false });
    expect(errorsOnly.every((d) => d.severity === "error")).toBe(true);
    expect(errorsOnly.some((d) => d.code === "WALL_DUPLICATE_EDGE")).toBe(true);
    expect(errorsOnly.some((d) => d.code === "WALL_NODE_MISSING")).toBe(true);

    // группировка error→warning→info
    const groups = groupBySeverity(result.diagnostics);
    expect(groups[0].severity).toBe("error");

    // клик «Показать на плане» по первой ошибке → фокус
    const focus = getDiagnosticFocusTarget(plan, errorsOnly[0]);
    expect(focus.selection).toBeTruthy();

    // пайплайн ничего не изменил в плане
    expect(plan).toEqual(before);
  });

  it("результат — snapshot; повторная проверка того же плана детерминирована", () => {
    const plan = brokenPlan();
    const a = validatePlanIntegrity(plan);
    const b = validatePlanIntegrity(plan);
    expect(b.diagnostics).toEqual(a.diagnostics);
  });

  it("изменение плана (новая ссылка) помечает результат устаревшим", () => {
    const plan = brokenPlan();
    validatePlanIntegrity(plan);
    const checkedRef = plan;
    // правка плана создаёт новый объект (как setPlan в редакторе)
    const edited = { ...plan, walls: [...plan.walls, { id: "w4", a: "n1", b: "n2" }] };
    expect(isDiagnosticsStale(checkedRef, edited)).toBe(true);
    // viewport/selection не меняют ссылку плана → не устарело
    expect(isDiagnosticsStale(checkedRef, plan)).toBe(false);
  });

  it("результат проверки не содержит ссылок, ведущих обратно в plan (no shared mutation surface)", () => {
    const plan = brokenPlan();
    const result = validatePlanIntegrity(plan);
    // diagnostics — самостоятельные объекты; их мутация не затрагивает plan
    for (const d of result.diagnostics) {
      d.message = "__mutated__";
      d.metadata.__x = 1;
    }
    expect(plan.walls.every((w) => w.message === undefined)).toBe(true);
  });
});
