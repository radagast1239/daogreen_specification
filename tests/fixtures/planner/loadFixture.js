import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Загрузить сырой JSON planner-fixture по имени (без расширения). */
export function loadPlannerFixture(name) {
  const raw = readFileSync(join(HERE, `${name}.json`), "utf8");
  return JSON.parse(raw);
}

/** Список всех planner-fixtures (имена без расширения, без служебных .js). */
export function listPlannerFixtures() {
  return readdirSync(HERE)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}
