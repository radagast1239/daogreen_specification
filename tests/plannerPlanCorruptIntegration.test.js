/**
 * PHASE 0B — интеграция на изолированной временной SQLite (6.2 + backend-часть 6.4).
 *
 * Проверяет реальный путь rowToProject/loadProject/updateProject:
 *   • корректный проект → прежний plan, без diagnostic;
 *   • повреждённый проект → plan:null + corrupt diagnostic;
 *   • апдейт метаданных повреждённого проекта НЕ затирает исходные байты в SQLite.
 *
 * Используется ВРЕМЕННАЯ БД (DATABASE_PATH), production-данные не затрагиваются.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir;
let db;
let loadProject;
let updateProject;

const CORRUPT_RAW = '{"walls":[{"id":"w1"}], "nodes": {oops-not-json';
const VALID_RAW = JSON.stringify({ walls: [{ id: "w1", a: "n1", b: "n2" }], nodes: { n1: { x: 0, y: 0 }, n2: { x: 100, y: 0 } } });

function insertProject(id, plannerPlanRaw) {
  db.prepare(
    "INSERT INTO projects (id, name, client_token, planner_plan) VALUES (?, ?, ?, ?)",
  ).run(id, `Проект ${id}`, `tok_${id}`, plannerPlanRaw);
}

function rawPlannerPlan(id) {
  return db.prepare("SELECT planner_plan FROM projects WHERE id = ?").get(id).planner_plan;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "daogreen-0b-"));
  process.env.DATABASE_PATH = join(tmpDir, "test.db");
  // Импортируем ПОСЛЕ установки DATABASE_PATH, чтобы db подключилась к temp-файлу.
  ({ db, loadProject } = await import("../backend/src/db.js"));
  ({ updateProject } = await import("../backend/src/routes/projects.js"));
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.DATABASE_PATH;
});

describe("PHASE 0B — corrupt planner_plan integration", () => {
  it("валидный проект: план загружается, diagnostic отсутствует", () => {
    insertProject("valid1", VALID_RAW);
    const p = loadProject("valid1");
    expect(p.plan).toEqual(JSON.parse(VALID_RAW));
    expect(p.plannerPlanState).toBeUndefined();
  });

  it("повреждённый проект: plan:null + corrupt diagnostic, raw не в ответе", () => {
    insertProject("bad1", CORRUPT_RAW);
    const p = loadProject("bad1");
    expect(p.plan).toBeNull();
    expect(p.plannerPlanState).toEqual({ status: "corrupt", code: "PLANNER_PLAN_JSON_INVALID" });
    // сырой повреждённый payload не должен утекать в ответ проекта
    expect(JSON.stringify(p)).not.toContain("oops-not-json");
    // прочие поля проекта сохраняются
    expect(p.name).toBe("Проект bad1");
  });

  it("апдейт метаданных повреждённого проекта НЕ затирает исходные байты в SQLite", () => {
    insertProject("bad2", CORRUPT_RAW);
    expect(rawPlannerPlan("bad2")).toBe(CORRUPT_RAW);

    const result = updateProject("bad2", { name: "Переименован" });

    // имя обновилось, но повреждение по-прежнему видно
    expect(result.name).toBe("Переименован");
    expect(result.plannerPlanState).toEqual({ status: "corrupt", code: "PLANNER_PLAN_JSON_INVALID" });
    // КЛЮЧЕВОЕ: исходные повреждённые байты в БД не изменились (не стали "{}")
    expect(rawPlannerPlan("bad2")).toBe(CORRUPT_RAW);
  });

  it("апдейт метаданных валидного проекта сохраняет план как прежде", () => {
    insertProject("valid2", VALID_RAW);
    const result = updateProject("valid2", { name: "Валидный ново" });
    expect(result.name).toBe("Валидный ново");
    expect(result.plan).toEqual(JSON.parse(VALID_RAW));
    expect(result.plannerPlanState).toBeUndefined();
  });
});
