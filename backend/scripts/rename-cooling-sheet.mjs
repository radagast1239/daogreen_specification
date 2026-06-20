/**
 * Переименовывает лист «Расчёт охлаждения» → «Расчет охлаждения ферма»
 * и обновляет ссылки на других листах.
 */
import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const OLD = "Расчёт охлаждения";
const NEW = "Расчет охлаждения ферма";

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "РАСЧЁТ ОХЛАЖДЕНИЯ ФЕРМА v2.xlsx"
);

const wb = XLSX.readFile(file, { cellFormula: true, cellStyles: true });

if (!wb.Sheets[OLD]) {
  if (wb.Sheets[NEW]) {
    console.log(`Лист «${NEW}» уже существует.`);
    process.exit(0);
  }
  throw new Error(`Лист «${OLD}» не найден. Доступно: ${wb.SheetNames.join(", ")}`);
}

wb.Sheets[NEW] = wb.Sheets[OLD];
delete wb.Sheets[OLD];
wb.SheetNames = wb.SheetNames.map((n) => (n === OLD ? NEW : n));

const refOld = `'${OLD}'!`;
const refNew = `'${NEW}'!`;

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  if (!ws?.["!ref"]) continue;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell?.f && cell.f.includes(OLD)) {
        cell.f = cell.f.split(refOld).join(refNew).split(OLD).join(NEW);
      }
    }
  }
}

XLSX.writeFile(wb, file);
console.log(`Готово: лист переименован в «${NEW}», файл сохранён.`);
