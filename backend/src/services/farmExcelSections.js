import fs from "fs";
import XLSX from "xlsx";

export const FARM_MODULE = "Общая закупка на ферму";

/** Подраздел Excel → id раздела «Ферма целиком» */
export function farmSectionIdFromHeader(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("манипул")) return "sec_manip";
  if (t.includes("климат") || t.includes("вентил")) return "sec_klimat";
  if (t.includes("проточк")) return "sec_poliv_proto";
  if (t.includes("подтоплен")) return "sec_poliv_pod";
  if (t.includes("насос")) return "sec_poliv_pod";
  if (t.includes("обвязка") || t.includes("дренаж") || t.includes("магистраль") || t.includes("слив")) {
    return t.includes("проточ") ? "sec_poliv_proto" : "sec_poliv_pod";
  }
  return null;
}

function cellStr(v) {
  if (v == null) return "";
  return String(v).trim();
}

function isMaterialRow(row) {
  const name = cellStr(row[1]);
  if (!name) return false;
  const lower = name.toLowerCase();
  if (lower === "итого" || lower.startsWith("итого ")) return false;
  const qtyRaw = cellStr(row[2]);
  const priceRaw = cellStr(row[4]);
  const hasQty = qtyRaw !== "" && !Number.isNaN(Number(qtyRaw.replace(",", ".")));
  const hasPrice = priceRaw !== "" && !Number.isNaN(Number(priceRaw.replace(",", ".")));
  if (hasQty || hasPrice) return true;
  return false;
}

function isSectionRow(row) {
  const name = cellStr(row[1]) || cellStr(row[0]);
  if (!name || name.length < 8) return false;
  if (/^https?:\/\//i.test(name)) return false;
  if (isMaterialRow(row)) return false;
  return !!farmSectionIdFromHeader(name);
}

/** Парсит «ЗАКУП НА ВСЮ ФЕРМУ» — позиции с привязкой к разделу фермы */
export function parseFarmPurchaseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });

  let currentSection = null;
  const items = [];
  const sections = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (isSectionRow(row)) {
      const title = cellStr(row[1]) || cellStr(row[0]);
      currentSection = farmSectionIdFromHeader(title);
      sections.push({ row: r, id: currentSection, title });
      continue;
    }
    if (!isMaterialRow(row) || !currentSection) continue;

    const name = cellStr(row[1]);
    const qty = Number(String(row[2]).replace(",", ".")) || 0;
    const link = cellStr(row[3]);
    const price = Number(String(row[4]).replace(",", ".")) || 0;
    const comment = cellStr(row[6]) || cellStr(row[0]);

    items.push({
      name,
      unit: "шт.",
      basePrice: price,
      defaultQty: qty,
      module: FARM_MODULE,
      category: currentSection === "sec_klimat" ? "Климат и вентиляция" : "Полив и сантехника",
      link: /^https?:\/\//i.test(cellStr(row[0])) ? cellStr(row[0]) : link,
      clientNote: comment,
      farmSectionId: currentSection,
      _row: r,
    });
  }

  const bySection = {};
  for (const it of items) {
    bySection[it.farmSectionId] = (bySection[it.farmSectionId] || 0) + 1;
  }

  return { sheetName, sections, items, bySection };
}

if (process.argv[1]?.includes("farmExcelSections")) {
  const f =
    process.argv[2] ||
    "C:/Users/Нико/Desktop/СПЕЦИФИКАЦИИ/СПЕЦИФИКАЦИЯ ЗАКУП НА ВСЮ ФЕРМУ ОРИГИНАЛ.xlsx";
  const buf = fs.readFileSync(f);
  const r = parseFarmPurchaseExcel(buf);
  console.log("Sections:", r.sections.length);
  console.log("Items:", r.items.length);
  console.log("By section:", r.bySection);
}
