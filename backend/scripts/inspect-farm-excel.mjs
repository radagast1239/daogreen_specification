import fs from "fs";
import XLSX from "xlsx";

const f = "C:/Users/Нико/Desktop/СПЕЦИФИКАЦИИ/СПЕЦИФИКАЦИЯ ЗАКУП НА ВСЮ ФЕРМУ ОРИГИНАЛ.xlsx";
const buf = fs.readFileSync(f);
const wb = XLSX.read(buf, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });

console.log("Sheet:", wb.SheetNames[0], "rows:", rows.length);
for (let i = 0; i < 12; i++) {
  console.log(`r${i}:`, rows[i].slice(0, 8).map((c) => String(c).slice(0, 40)));
}

let currentSection = null;
const sections = [];
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const cells = row.map((c) => String(c || "").trim());
  const joined = cells.join(" ").trim();

  // header row detection
  if (cells.some((c) => /наименование/i.test(c))) {
    console.log(`\nHEADER @ r${i}:`, cells.filter(Boolean).slice(0, 6));
    continue;
  }

  // section: often bold row with text in col 0 or 1, no qty
  const nameCol = cells[1] || cells[0];
  const hasQty = cells.some((c, ci) => ci >= 2 && /^\d+([.,]\d+)?$/.test(c));
  const isNumbered = /^\d+$/.test(cells[0]);

  if (!isNumbered && nameCol && nameCol.length > 5 && !hasQty) {
    const lower = nameCol.toLowerCase();
    if (
      lower.includes("полив") ||
      lower.includes("дренаж") ||
      lower.includes("климат") ||
      lower.includes("манипул") ||
      lower.includes("магистраль") ||
      lower.includes("итого") ||
      lower.includes("насос") ||
      lower.includes("вентил")
    ) {
      currentSection = nameCol;
      sections.push({ row: i, name: nameCol });
      console.log(`SECTION @ r${i}:`, nameCol);
      continue;
    }
  }

  if (isNumbered && cells[1]) {
    // material row
  }
}

console.log("\n=== All potential section rows ===");
for (const s of sections) console.log(`r${s.row}: ${s.name}`);
