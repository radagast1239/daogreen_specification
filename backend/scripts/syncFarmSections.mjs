import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "../src/db.js";
import { syncFarmSectionsFromExcel } from "../src/services/syncFarmSections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

initDb();

const { ensureFarmSectionIds } = await import("../src/seed.js");
const result = ensureFarmSectionIds();

console.log(JSON.stringify(result, null, 2));

const { listMaterials } = await import("../src/routes/materials.js");
const mats = listMaterials().filter((m) => m.module === "Общая закупка на ферму");
const bySec = {};
for (const m of mats) {
  const k = m.farmSectionId || "(none)";
  bySec[k] = (bySec[k] || 0) + 1;
}
console.log("In DB by section:", bySec);
