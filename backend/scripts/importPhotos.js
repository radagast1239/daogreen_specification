import path from "path";
import { fileURLToPath } from "url";
import { importPhotosFromDir } from "../src/services/photoImport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(__dirname, "../../materials-photos");
const uploadDir = path.join(__dirname, "../uploads");

const result = importPhotosFromDir(sourceDir, uploadDir);
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
console.log(`Matched: ${result.matched.length}, unmatched: ${result.unmatched.length}`);
for (const r of result.matched) {
  console.log(`  ${r.materialId} ← ${r.file}`);
}
if (result.unmatched.length) {
  console.log("Unmatched:", result.unmatched.join(", "));
}
