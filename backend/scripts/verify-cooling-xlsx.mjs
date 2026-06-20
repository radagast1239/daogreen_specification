import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "РАСЧЁТ ОХЛАЖДЕНИЯ ФЕРМА v2.xlsx"
);
const wb = XLSX.readFile(file, { cellFormula: true });
console.log("Sheets:", wb.SheetNames);
const ws = wb.Sheets["Расчет охлаждения ферма"];
console.log("E94 (кВт с запасом):", ws.E94?.f, "->", ws.E94?.v);
const ws2 = wb.Sheets["Расчёт по сезонам"];
console.log("Seasons E20:", ws2.E20?.f?.slice(0, 60), "->", ws2.E20?.v);
const ws3 = wb.Sheets["Сравнение вариантов"];
console.log("Compare F5:", ws3.F5?.f, "->", ws3.F5?.v);
