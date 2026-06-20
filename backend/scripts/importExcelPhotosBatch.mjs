import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, "../uploads");

const sourceDir = process.argv[2] || path.join(__dirname, "../../import-sources");

initDb();

const { runSeedIfEmpty } = await import("../src/seed.js");
runSeedIfEmpty();

const { listMaterials, updateMaterial } = await import("../src/routes/materials.js");
const { importPhotosFromExcelFile } = await import("../src/services/excelImages.js");

if (!fs.existsSync(sourceDir)) {
  console.error("Папка не найдена:", sourceDir);
  process.exit(1);
}

const files = fs
  .readdirSync(sourceDir)
  .filter((f) => /\.xlsx?$/i.test(f))
  .map((f) => path.join(sourceDir, f))
  .sort();

if (!files.length) {
  console.error("Нет .xlsx в", sourceDir);
  process.exit(1);
}

const seen = new Set();
let totalLinked = 0;
const materials = listMaterials();

console.log(`Материалов в базе: ${materials.length}`);
console.log(`Файлов: ${files.length}\n`);

for (const filePath of files) {
  const base = path.basename(filePath).toLowerCase();
  if (/подтоплен/.test(base)) {
    const key = "podtoplenie";
    if (seen.has(key)) {
      console.log("Пропуск дубликата:", path.basename(filePath));
      continue;
    }
    seen.add(key);
  }

  try {
    const r = await importPhotosFromExcelFile(filePath, materials, uploadDir, updateMaterial);
    totalLinked += r.linked;
    console.log(`✓ ${r.file}`);
    console.log(`  модуль: ${r.module}, фото в файле: ${r.imagesFound}, привязано: ${r.linked}`);
    if (r.unmatched?.length) {
      console.log(`  не сопоставлено: ${r.unmatched.length}`);
      for (const u of r.unmatched.slice(0, 5)) {
        console.log(`    — ${u.name}`);
      }
      if (r.unmatched.length > 5) console.log(`    … и ещё ${r.unmatched.length - 5}`);
    }
  } catch (e) {
    console.error(`✗ ${path.basename(filePath)}:`, e.message);
  }
}

const withPhoto = listMaterials().filter((m) => m.imageUrl || m.photoUrl).length;
console.log(`\nИтого привязано за запуск: ${totalLinked}`);
console.log(`Материалов с фото в базе: ${withPhoto}`);
