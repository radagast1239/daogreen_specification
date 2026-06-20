import XLSX from "xlsx";
import { uid } from "./buildItems.js";

const COL_MAP = {
  name: ["наименование", "название", "позиция", "name"],
  unit: ["ед", "ед.", "единица", "ед.изм", "unit"],
  qty: ["кол", "кол.", "количество", "кол-во", "qty"],
  price: ["цена", "price", "стоимость"],
  link: ["ссылка", "link", "url"],
  comment: ["пояснение", "комментарий", "comment", "примечание"],
  supplier: ["поставщик", "supplier", "магазин"],
  category: ["категория", "category", "раздел"],
};

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findCol(headers, keys) {
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (keys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

function cellStr(v) {
  if (v == null) return "";
  if (typeof v === "object" && v.h) return String(v.h);
  return String(v).trim();
}

/**
 * @param {Buffer} buffer
 * @param {string} moduleName — имя модуля (лист или переданное)
 */
export function parseExcelBuffer(buffer, moduleName = "Импорт") {
  const wb = XLSX.read(buffer, { type: "buffer", cellStyles: true });
  const results = [];
  const errors = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (rows.length < 2) continue;

    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const row = rows[i].map(cellStr);
      if (findCol(row, COL_MAP.name) >= 0) {
        headerIdx = i;
        break;
      }
    }

    const headers = rows[headerIdx].map(cellStr);
    const ci = {
      name: findCol(headers, COL_MAP.name),
      unit: findCol(headers, COL_MAP.unit),
      qty: findCol(headers, COL_MAP.qty),
      price: findCol(headers, COL_MAP.price),
      link: findCol(headers, COL_MAP.link),
      comment: findCol(headers, COL_MAP.comment),
      supplier: findCol(headers, COL_MAP.supplier),
      category: findCol(headers, COL_MAP.category),
    };

    if (ci.name < 0) {
      errors.push(`Лист «${sheetName}»: не найдена колонка наименования`);
      continue;
    }

    const mod = moduleName === "Импорт" ? sheetName : moduleName;

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const name = cellStr(row[ci.name]);
      if (!name) continue;

      const qty = ci.qty >= 0 ? Number(String(row[ci.qty]).replace(",", ".")) || 0 : 0;

      results.push({
        id: uid("m"),
        name,
        unit: ci.unit >= 0 ? cellStr(row[ci.unit]) || "шт." : "шт.",
        basePrice: ci.price >= 0 ? Number(String(row[ci.price]).replace(",", ".")) || 0 : 0,
        defaultQty: 0,
        module: mod,
        category: ci.category >= 0 ? cellStr(row[ci.category]) || "Прочее" : "Прочее",
        subcategory: "",
        itemType: "material",
        supplier: ci.supplier >= 0 ? cellStr(row[ci.supplier]) : "",
        link: ci.link >= 0 ? cellStr(row[ci.link]) : "",
        linkAlt: "",
        photoUrl: "",
        imageUrl: "",
        vatRate: 0,
        vatIncluded: false,
        clientNote: ci.comment >= 0 ? cellStr(row[ci.comment]) : "",
        techNote: "",
        internalNote: "",
        status: "active",
        needsApproval: false,
        isConsumable: false,
        isSparePart: false,
        clientVisibleDefault: true,
        _sheet: sheetName,
        _row: r,
      });
    }
  }

  return { materials: results, errors, count: results.length };
}
