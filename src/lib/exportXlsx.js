import * as XLSX from "xlsx";
import { triggerDownload } from "./exportDownload.js";

/** Скачать .xlsx с колонками (ссылки — гиперссылки) */
export function downloadXlsx(filename, rows, sheetName = "Спецификация", linkHeaders = ["Ссылка", "Фото", "Открыть товар"]) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const data = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  for (const linkHeader of linkHeaders) {
    const linkCol = headers.indexOf(linkHeader);
    if (linkCol < 0) continue;
    for (let i = 0; i < rows.length; i++) {
      const link = rows[i]._link || (linkHeader === "Фото" ? rows[i]._photo : null);
      if (!link) continue;
      const ref = XLSX.utils.encode_cell({ r: i + 1, c: linkCol });
      ws[ref] = {
        v: rows[i][linkHeader] || "Открыть",
        t: "s",
        l: { Target: link, Tooltip: link },
      };
    }
  }
  ws["!cols"] = headers.map((h) => {
    if (h === "Фото" || h === "Ссылка") return { wch: 36 };
    if (h === "Наименование") return { wch: 42 };
    return { wch: 14 };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const name = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  triggerDownload(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
}
