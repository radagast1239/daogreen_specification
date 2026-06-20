import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { parseExcelBuffer } from "../src/services/excelImport.js";
import { extractExcelImages } from "../src/services/excelImages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  "C:/Users/Нико/Desktop/СПЕЦИФИКАЦИИ/СПЕЦИФИКАЦИЯ ЗАКУП НА ВСЮ ФЕРМУ ОРИГИНАЛ.xlsx",
  "C:/Users/Нико/Desktop/СПЕЦИФИКАЦИИ/СПЕЦИФИКАЦИЯ ПОДТОПЛЕНИЕ ОРИГИНАЛ (1).xlsx",
  "C:/Users/Нико/Desktop/СПЕЦИФИКАЦИИ/СПЕЦИФИКАЦИЯ ПОДТОПЛЕНИЕ ОРИГИНАЛ.xlsx",
  "C:/Users/Нико/Desktop/СПЕЦИФИКАЦИИ/СПЕЦИФИКАЦИЯ СТЕЛЛАЖ ПРОТОЧКА ОРИГИНАЛ.xlsx",
  "C:/Users/Нико/Desktop/СПЕЦИФИКАЦИИ/СПЕЦИФИКАЦИЯ АЭРОПОНИКА ОРИГИНАЛ!!!!.xlsx",
];

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log("MISSING:", f);
    continue;
  }
  const buf = fs.readFileSync(f);
  const wb = XLSX.read(buf, { type: "buffer" });
  const parsed = parseExcelBuffer(buf);
  const images = await extractExcelImages(buf, wb.SheetNames);

  console.log("\n===", path.basename(f), "===");
  console.log("Sheets:", wb.SheetNames.join(" | "));
  console.log("Rows parsed:", parsed.count, "errors:", parsed.errors.length);
  console.log("Images extracted:", images.length);

  const bySheet = {};
  for (const img of images) {
    bySheet[img.sheetName] = (bySheet[img.sheetName] || 0) + 1;
  }
  console.log("Images by sheet:", bySheet);

  let matched = 0;
  for (const m of parsed.materials) {
    const img = images.find(
      (i) => i.sheetName === m._sheet && (i.row === m._row || i.row === m._row - 1 || i.row === m._row + 1)
    );
    if (img) matched++;
  }
  console.log("Rows matched by position:", matched, "/", parsed.materials.length);

  if (images.length && parsed.materials.length) {
    for (const img of images.slice(0, 5)) {
      const near = parsed.materials.filter(
        (m) => m._sheet === img.sheetName && Math.abs(m._row - img.row) <= 2
      );
      console.log(
        `  img row=${img.row} col=${img.col} sheet=${img.sheetName} ->`,
        near.map((m) => `r${m._row}:${m.name.slice(0, 50)}`).join("; ") || "(no row)"
      );
    }
  }
}
