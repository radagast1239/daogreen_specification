import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "РАСЧЁТ ОХЛАЖДЕНИЯ ФЕРМА v2.xlsx"
);

const wb = XLSX.readFile(file, { cellFormula: true });
const ws = wb.Sheets["Расчёт охлаждения"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
for (let i = 44; i < 120; i++) {
  const r = rows[i];
  if (!r || r.every((c) => c === "")) continue;
  console.log(String(i + 1).padStart(3), JSON.stringify(r.slice(0, 10)));
}
const range = XLSX.utils.decode_range(ws["!ref"]);
let count = 0;
for (let r = range.s.r; r <= range.e.r; r++) {
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (ws[XLSX.utils.encode_cell({ r, c })]?.f) count++;
  }
}
console.log("\nTotal formulas:", count);
