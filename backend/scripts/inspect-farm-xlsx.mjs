import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const file = path.join(root, "СПЕЦИФИКАЦИЯ ЗАКУП НА ВСЮ ФЕРМУ ОРИГИНАЛ.xlsx");
const wb = XLSX.readFile(file, { cellFormula: true });
console.log("Sheets:", wb.SheetNames);
for (const name of wb.SheetNames) {
  if (!/охлажд|климат|cool/i.test(name)) continue;
  console.log("\n===", name, "===");
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    if (r?.some((c) => String(c).trim())) console.log(i + 1, JSON.stringify(r.slice(0, 8)));
  }
}
// search all sheets for cooling keywords
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].join(" ");
    if (/охлажден|BTU|теплоприток|фитоламп/i.test(line)) {
      console.log(`\n[${name} row ${i + 1}]`, line.slice(0, 120));
    }
  }
}
