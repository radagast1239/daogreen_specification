import * as XLSX from "xlsx";
import { triggerDownload } from "./exportDownload.js";
import { buildPurchaseExportSheetData } from "../../shared/projectReportsR3.js";

const COL_WIDTHS_PURCHASE = [22, 22, 20, 36, 8, 10, 10, 12, 16, 28, 28];
const COL_WIDTHS_PROJECTS = [28, 14, 14, 14, 14, 16];
const COL_WIDTHS_NOSUP = [22, 20, 36, 8, 10, 10, 12, 16, 28];

function sheetFromAoa(aoa, colWidths, linkColIndex = -1) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = (colWidths || []).map((wch) => ({ wch }));
  if (linkColIndex >= 0 && aoa.length > 1) {
    for (let r = 1; r < aoa.length; r += 1) {
      const url = aoa[r][linkColIndex];
      if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
      const cellRef = XLSX.utils.encode_cell({ r, c: linkColIndex });
      const cell = ws[cellRef];
      if (!cell) continue;
      cell.l = { Target: url, Tooltip: url };
      cell.v = "Открыть";
      cell.t = "s";
    }
  }
  // numeric types for qty/price/sum columns where applicable
  return ws;
}

function markMoneyColumns(ws, aoa, moneyCols) {
  for (let r = 1; r < aoa.length; r += 1) {
    for (const c of moneyCols) {
      const val = aoa[r][c];
      if (typeof val !== "number") continue;
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) continue;
      ws[ref].t = "n";
      ws[ref].z = '#,##0.00" ₽"';
    }
  }
}

/** Build workbook ArrayBuffer from currently filtered purchase report rows. */
export function writeReportsPurchaseWorkbook(filteredRows = []) {
  const { sheets, summary } = buildPurchaseExportSheetData(filteredRows);
  const wb = XLSX.utils.book_new();
  sheets.forEach((s, idx) => {
    let ws;
    if (idx === 0) {
      ws = sheetFromAoa(s.aoa, COL_WIDTHS_PURCHASE, 9);
      markMoneyColumns(ws, s.aoa, [6, 7]);
    } else if (idx === 1) {
      ws = sheetFromAoa(s.aoa, COL_WIDTHS_PROJECTS);
      markMoneyColumns(ws, s.aoa, [2, 3, 4, 5]);
    } else {
      ws = sheetFromAoa(s.aoa, COL_WIDTHS_NOSUP, 8);
      markMoneyColumns(ws, s.aoa, [5, 6]);
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return { buffer: raw, summary };
}

export function downloadReportsPurchaseExcel(filteredRows = [], { projectName = "" } = {}) {
  if (!filteredRows?.length) {
    throw new Error("Нет позиций для выгрузки");
  }
  const { buffer } = writeReportsPurchaseWorkbook(filteredRows);
  const day = new Date().toISOString().slice(0, 10);
  const safe = String(projectName || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 40);
  const filename = safe ? `Закупка_${safe}_${day}.xlsx` : `Закупка_${day}.xlsx`;
  triggerDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename
  );
  return filename;
}
