/**
 * PHASE 0D — тесты презентационной логики диагностической панели (чистые функции).
 */
import { describe, it, expect } from "vitest";
import {
  severityLabel,
  entityTypeLabel,
  formatEntityId,
  countBySeverity,
  filterDiagnostics,
  groupBySeverity,
  isDiagnosticsStale,
  computeDrawerAnchor,
  summaryText,
  resultHeadline,
  EMPTY_NOT_RUN,
  EMPTY_NO_MATCH,
  NO_ERRORS_TEXT,
  SEVERITY_ORDER,
} from "../src/planner/ui/diagnostics/diagnosticPresentation.js";

const sample = [
  { code: "WALL_NODE_MISSING", severity: "error", entityType: "wall", entityId: "w1", path: "walls[0].a", message: "..." },
  { code: "WALL_DUPLICATE_EDGE", severity: "error", entityType: "wall", entityId: "w2", path: "walls[1]", message: "..." },
  { code: "NODE_ORPHAN", severity: "warning", entityType: "node", entityId: "nZ", path: "nodes.nZ", message: "..." },
  { code: "LEGACY_WALL_MODEL_PRESENT", severity: "info", entityType: "wall", entityId: "w3", path: "walls[2]", message: "..." },
];

describe("presentation — русские подписи", () => {
  it("severityLabel", () => {
    expect(severityLabel("error")).toBe("Ошибка");
    expect(severityLabel("warning")).toBe("Предупреждение");
    expect(severityLabel("info")).toBe("Информация");
  });
  it("entityTypeLabel", () => {
    expect(entityTypeLabel("wall")).toBe("Стена");
    expect(entityTypeLabel("opening")).toBe("Проём");
    expect(entityTypeLabel("dimension")).toBe("Размер");
    expect(entityTypeLabel("unknown_type")).toBe("unknown_type");
  });
});

describe("presentation — formatEntityId", () => {
  it("короткий id без изменений", () => {
    expect(formatEntityId("w1")).toBe("w1");
  });
  it("длинный uid сокращается", () => {
    const out = formatEntityId("n_mrnape0e277z7abcдлинный");
    expect(out).toContain("…");
    expect(out.length).toBeLessThan("n_mrnape0e277z7abcдлинный".length);
  });
  it("null → тире", () => {
    expect(formatEntityId(null)).toBe("—");
  });
});

describe("presentation — счётчики и фильтрация", () => {
  it("countBySeverity", () => {
    expect(countBySeverity(sample)).toEqual({ error: 2, warning: 1, info: 1, total: 4 });
  });
  it("filterDiagnostics не мутирует вход и убирает выключенные severity", () => {
    const copy = JSON.parse(JSON.stringify(sample));
    const onlyErrors = filterDiagnostics(sample, { error: true, warning: false, info: false });
    expect(onlyErrors).toHaveLength(2);
    expect(onlyErrors.every((d) => d.severity === "error")).toBe(true);
    expect(sample).toEqual(copy); // вход не изменён
  });
  it("filterDiagnostics: все включены по умолчанию (undefined = включено)", () => {
    expect(filterDiagnostics(sample, {})).toHaveLength(4);
  });
});

describe("presentation — группировка", () => {
  it("groupBySeverity в порядке error→warning→info", () => {
    const groups = groupBySeverity(sample);
    expect(groups.map((g) => g.severity)).toEqual(["error", "warning", "info"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].label).toBe("Ошибки");
  });
  it("пустые severity-группы не появляются", () => {
    const groups = groupBySeverity(sample.filter((d) => d.severity === "info"));
    expect(groups).toHaveLength(1);
    expect(groups[0].severity).toBe("info");
  });
  it("severity-порядок совпадает с SEVERITY_ORDER", () => {
    expect(SEVERITY_ORDER).toEqual(["error", "warning", "info"]);
  });
});

describe("presentation — устаревание результата", () => {
  it("тот же plan ref → не устарел", () => {
    const plan = { walls: [] };
    expect(isDiagnosticsStale(plan, plan)).toBe(false);
  });
  it("другой plan ref → устарел", () => {
    expect(isDiagnosticsStale({ walls: [] }, { walls: [] })).toBe(true);
  });
  it("нет проверенного плана → не устарел", () => {
    expect(isDiagnosticsStale(null, { walls: [] })).toBe(false);
  });
});

describe("presentation — привязка drawer к рабочей области (regression 0D smoke)", () => {
  // Дефект, найденный браузерным smoke: фиксированный top:60px перекрывал строку
  // листов (topbar 43 + header-row 43 → workspace начинается на 86).
  it("панель начинается ниже шапки: top берётся у workspace, а не фиксирован", () => {
    const anchor = computeDrawerAnchor({ top: 86, bottom: 768 }, 768);
    expect(anchor).toEqual({ top: 94, bottom: 8 });
    expect(anchor.top).toBeGreaterThanOrEqual(86); // не залезает под header-row
  });

  it("нижний отступ считается от низа рабочей области", () => {
    // workspace заканчивается выше низа окна (например, из-за нижней панели)
    expect(computeDrawerAnchor({ top: 100, bottom: 700 }, 900)).toEqual({ top: 108, bottom: 208 });
  });

  it("минимальный отступ снизу не меньше pad", () => {
    expect(computeDrawerAnchor({ top: 50, bottom: 1000 }, 768).bottom).toBe(8);
  });

  it("нет workspace (harness/иной layout) → null, действуют CSS-значения", () => {
    expect(computeDrawerAnchor(null, 768)).toBeNull();
  });

  it("невалидные размеры не ломают панель", () => {
    expect(computeDrawerAnchor({ top: NaN, bottom: 700 }, 768)).toBeNull();
    expect(computeDrawerAnchor({ top: 10, bottom: 700 }, Infinity)).toBeNull();
  });
});

describe("presentation — тексты резюме", () => {
  it("summaryText со склонением", () => {
    expect(summaryText({ errors: 0, warnings: 2, info: 0, total: 2 })).toContain("0 ошибок");
    expect(summaryText({ errors: 0, warnings: 2, info: 0, total: 2 })).toContain("2 предупреждения");
    expect(summaryText({ errors: 1, warnings: 0, info: 0, total: 1 })).toContain("1 ошибка");
  });
  it("resultHeadline: без ошибок → нейтральная формулировка", () => {
    expect(resultHeadline({ errors: 0, warnings: 3, info: 1, total: 4 })).toBe(NO_ERRORS_TEXT);
    expect(NO_ERRORS_TEXT).not.toContain("полностью исправен");
  });
  it("resultHeadline: есть ошибки", () => {
    expect(resultHeadline({ errors: 2, warnings: 0, info: 0, total: 2 })).toContain("2");
  });
  it("константы пустых состояний заданы", () => {
    expect(EMPTY_NOT_RUN).toBeTruthy();
    expect(EMPTY_NO_MATCH).toBeTruthy();
  });
});

describe("presentation — performance (500 diagnostics)", () => {
  it("фильтрация+группировка 500 diagnostics в широком бюджете", () => {
    const many = [];
    const sev = ["error", "warning", "info"];
    for (let i = 0; i < 500; i++) {
      many.push({ code: `C_${i % 20}`, severity: sev[i % 3], entityType: "wall", entityId: `w${i}`, path: `walls[${i}]`, message: "m" });
    }
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) {
      const f = filterDiagnostics(many, { error: true, warning: true, info: false });
      groupBySeverity(f);
      countBySeverity(many);
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(500);
  });
});
