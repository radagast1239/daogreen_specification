import { initDb, db, rowToMaterial } from "../src/db.js";
import { analyzeMaterialsQuality } from "../../shared/materialQualityCheck.js";
import { listModulesAdmin } from "../src/routes/materials.js";

initDb();
const materials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);
const modules = listModulesAdmin({ includeArchived: true });
const activeNames = modules.filter((m) => m.active).map((m) => m.name);
const report = analyzeMaterialsQuality(materials, { activeModuleNames: activeNames });

const active = materials.filter((m) => m.status !== "archived");

console.log("=== ОБЩЕЕ ===");
console.log(`Всего: ${materials.length}, активных: ${active.length}, archived status: ${materials.filter((m) => m.status === "archived").length}`);

console.log("\n=== ЗАМЕЧАНИЯ (страница «Проверка») ===");
let issueTotal = 0;
for (const s of report.summary) {
  if (s.count) {
    issueTotal += s.count;
    console.log(`  ${s.count}\t${s.label}`);
  }
}
console.log(`  ---\tИтого строк-замечаний: ${issueTotal}`);

const prochee = active.filter((m) => (m.category || "").trim() === "Прочее");
const trebuet = active.filter((m) => (m.category || "").trim() === "Требует разбора");
const testLike = active.filter((m) => /тест|test|xxx|удал|чернов|temp\b|tmp\b|asdf|12345|мусор|old_/i.test(m.name || ""));
const veryShort = active.filter((m) => (m.name || "").trim().length < 4);
const zeroQtyDefault = active.filter((m) => !m.defaultQty && !m.basePrice && !m.link && !m.supplier);

console.log("\n=== ПРИЗНАКИ «МУСОРА» ===");
console.log(`  Прочее: ${prochee.length}`);
console.log(`  Требует разбора: ${trebuet.length}`);
console.log(`  Похоже на тест/черновик: ${testLike.length}`);
console.log(`  Имя короче 4 символов: ${veryShort.length}`);
console.log(`  Пустышки (нет цены, ссылки, поставщика, defaultQty): ${zeroQtyDefault.length}`);
console.log(`  Групп дублей (имя+ед.): ${report.sections.duplicateCandidates.length}`);

function block(title, list, map = (m) => m.name) {
  if (!list.length) return;
  console.log(`\n--- ${title} (${list.length}) ---`);
  list.slice(0, 20).forEach((m) => console.log(" ", map(m)));
  if (list.length > 20) console.log(`  … ещё ${list.length - 20}`);
}

block("Прочее", prochee, (m) => `${m.name} | раздел: ${m.clientSection || "—"}`);
block("Требует разбора", trebuet);
block("Тест/черновик", testLike);
block("URL в названии", report.sections.urlInName);
block("Без клиентского раздела", report.sections.noClientSection, (m) => `${m.name} | ${m.category}`);
block(
  "Дубли (имя + ед.)",
  report.sections.duplicateCandidates,
  (m) => `${m.duplicateCount}× ${m.name} (${m.unit})`
);
block("Архивные модули у материала", report.sections.archivedModules, (m) => `${m.name} → ${m.archivedModules}`);
