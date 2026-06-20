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
const range = XLSX.utils.decode_range(ws["!ref"]);
for (let r = range.s.r; r <= range.e.r; r++) {
  const b = ws[XLSX.utils.encode_cell({ r, c: 1 })];
  const c = ws[XLSX.utils.encode_cell({ r, c: 2 })];
  const d = ws[XLSX.utils.encode_cell({ r, c: 3 })];
  const e = ws[XLSX.utils.encode_cell({ r, c: 4 })];
  if (!c?.v && !e?.f && e?.v === undefined) continue;
  const row = r + 1;
  if (e?.f) console.log(`E${row}\t${c?.v || ""}\t=${e.f}\t-> ${e.v}`);
  else if (e?.v !== undefined && e.v !== "") console.log(`E${row}\t${c?.v || ""}\t[IN] ${e.v}`);
}
