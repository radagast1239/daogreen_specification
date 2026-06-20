import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { parseExcelBuffer } from "../src/services/excelImport.js";
import { extractExcelImages } from "../src/services/excelImages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const f = "C:/Users/Нико/Desktop/СПЕЦИФИКАЦИИ/СПЕЦИФИКАЦИЯ СТЕЛЛАЖ ПРОТОЧКА ОРИГИНАЛ.xlsx";
const buf = fs.readFileSync(f);
const wb = XLSX.read(buf, { type: "buffer" });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
for (let i = 0; i < 12; i++) {
  console.log(`r${i}:`, rows[i].map((c, ci) => `[${ci}]${String(c).slice(0, 30)}`).join(" | "));
}
const images = await extractExcelImages(buf, wb.SheetNames);
console.log("\nImages sample:");
for (const img of images.slice(0, 8)) {
  console.log(` row=${img.row} col=${img.col}`);
}
