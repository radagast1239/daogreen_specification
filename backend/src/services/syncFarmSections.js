import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFarmPurchaseExcel, FARM_MODULE } from "./farmExcelSections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\\/.,"'«»!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function namesMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) >= 10 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

const SEARCH_DIRS = [
  path.join(__dirname, "../../import-sources"),
  path.join(__dirname, "../../../import-sources"),
  path.join(__dirname, "../../.."),
];

export function findFarmPurchaseExcel() {
  for (const dir of SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs
      .readdirSync(dir)
      .find((f) => /\.xlsx$/i.test(f) && /закуп/i.test(f) && /ферм/i.test(f));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

/** Проставляет farm_section_id материалам «Общая закупка на ферму» по Excel */
export function syncFarmSectionsFromExcel(db, filePath) {
  const excelPath = filePath || findFarmPurchaseExcel();
  if (!excelPath || !fs.existsSync(excelPath)) {
    return { updated: 0, skipped: true, reason: "excel not found" };
  }

  const parsed = parseFarmPurchaseExcel(fs.readFileSync(excelPath));
  const rows = db
    .prepare("SELECT id, name, module, farm_section_id FROM materials WHERE module = ?")
    .all(FARM_MODULE);

  const upd = db.prepare(
    "UPDATE materials SET farm_section_id = @farm_section_id, updated_at = datetime('now') WHERE id = @id"
  );

  let updated = 0;
  const unmatched = [];

  for (const item of parsed.items) {
    const mat =
      rows.find((m) => namesMatch(m.name, item.name)) ||
      rows.find((m) => {
        const na = norm(m.name);
        const nb = norm(item.name);
        return na.length >= 8 && nb.length >= 8 && (na.includes(nb.slice(0, 18)) || nb.includes(na.slice(0, 18)));
      });

    if (!mat) {
      unmatched.push(item.name);
      continue;
    }
    if (mat.farm_section_id === item.farmSectionId) continue;
    upd.run({ id: mat.id, farm_section_id: item.farmSectionId });
    updated++;
    mat.farm_section_id = item.farmSectionId;
  }

  return {
    updated,
    excel: path.basename(excelPath),
    bySection: parsed.bySection,
    unmatched: unmatched.length,
  };
}
