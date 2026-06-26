/**
 * Smoke test for step 1: snapshot isolation + refresh-from-material
 * Run: node scripts/verify-step1.mjs
 */
import { initDb, loadProject, db } from "../backend/src/db.js";
import {
  createProject,
  refreshItemsFromMaterial,
  patchItem,
} from "../backend/src/routes/projects.js";
import { updateMaterial } from "../backend/src/routes/materials.js";

initDb();

const existing = db.prepare("SELECT id FROM projects ORDER BY created_at DESC LIMIT 1").get();
if (!existing) {
  console.error("No projects in DB — create one manually first");
  process.exit(1);
}

const before = loadProject(existing.id);
const sample = before.items.find((i) => i.materialId);
if (!sample) {
  console.error("No item with materialId in project", existing.id);
  process.exit(1);
}

const oldPrice = sample.price;
const oldName = sample.name;
const matId = sample.materialId;

const matRow = db.prepare("SELECT base_price, name FROM materials WHERE id = ?").get(matId);
const newPrice = (Number(matRow.base_price) || 0) + 777;
const newName = (matRow.name || "x") + " [TEST]";

updateMaterial(matId, { basePrice: newPrice, name: newName });

const afterMatChange = loadProject(existing.id);
const sameItem = afterMatChange.items.find((i) => i.id === sample.id);
if (sameItem.price !== oldPrice || sameItem.name !== oldName) {
  console.error("FAIL: project changed after material update without refresh");
  console.error({ oldPrice, got: sameItem.price, oldName, got: sameItem.name });
  updateMaterial(matId, { basePrice: matRow.base_price, name: matRow.name });
  process.exit(1);
}
console.log("OK: old project unchanged after material edit");

const refreshed = refreshItemsFromMaterial(existing.id, {
  itemIds: [sample.id],
  fields: ["price", "all"],
});
const afterRefresh = loadProject(existing.id);
const refreshedItem = afterRefresh.items.find((i) => i.id === sample.id);
if (refreshedItem.price !== newPrice) {
  console.error("FAIL: refresh did not update price", refreshedItem.price, newPrice);
  process.exit(1);
}
console.log("OK: refresh-from-material updates price");

updateMaterial(matId, { basePrice: matRow.base_price, name: matRow.name });
patchItem(existing.id, sample.id, { price: oldPrice, name: oldName });

const flags = afterRefresh.items[0];
console.log("Sample flags:", {
  includedInProject: flags.includedInProject,
  visibleToClient: flags.visibleToClient,
  itemType: flags.itemType,
});

console.log("Step 1 verification passed");
