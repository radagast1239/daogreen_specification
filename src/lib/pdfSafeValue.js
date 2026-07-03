/**
 * Безопасное форматирование значений для PDF (jsPDF / autoTable).
 *
 * Цель: в PDF не должны попадать undefined, null, NaN, Infinity, управляющие
 * символы, отрицательное охлаждение и абсурдно большие ошибочные числа —
 * из-за них Adobe Acrobat может показывать ошибку или «битый» файл.
 *
 * Эти функции только форматируют ВЫВОД. Они не меняют исходные расчётные данные.
 */

/** Тире-заглушка вместо «пустого»/невалидного значения. */
export const PDF_DASH = "—";

/** Порог, выше которого число считаем ошибочным и не показываем как есть. */
const HUGE_LIMIT = 1e9;

/**
 * Приводит значение к конечному числу.
 * Строки вида "12.5" разбираются; NaN / Infinity / мусор → fallback.
 */
export function finiteNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const n = Number(value.trim().replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Убирает управляющие символы (C0 + DEL), которые ломают PDF-строки. */
function stripControlChars(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x1F\x7F]/g, " ");
}

/**
 * Безопасный текст для doc.text / ячейки autoTable.
 * undefined / null / NaN / Infinity / -Infinity → dash.
 */
export function safePdfText(value, dash = PDF_DASH) {
  if (value === undefined || value === null) return dash;
  if (typeof value === "number") {
    return Number.isFinite(value) ? stripControlChars(String(value)) : dash;
  }
  const str = stripControlChars(String(value)).trim();
  return str.length ? str : dash;
}

/**
 * Безопасное число для PDF. Возвращает строку.
 * NaN / Infinity / -Infinity / слишком большие → dash.
 */
export function safePdfNumber(value, { dash = PDF_DASH, digits } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  if (Math.abs(n) > HUGE_LIMIT) return dash;
  if (typeof digits === "number") return n.toFixed(digits);
  return String(n);
}

/**
 * Безопасное охлаждение в кВт. Возвращает неотрицательное конечное число.
 * NaN / Infinity → 0, отрицательное → 0, абсурдно большое → ограничено.
 */
export function safeCoolingKw(value, { max = 100000 } = {}) {
  const n = finiteNumber(value, 0);
  if (n <= 0) return 0;
  return Math.min(n, max);
}

/**
 * Безопасное охлаждение в BTU/ч. Возвращает неотрицательное конечное число.
 * NaN / Infinity → 0, отрицательное → 0, абсурдно большое → ограничено.
 */
export function safeCoolingBtu(value, { max = HUGE_LIMIT } = {}) {
  const n = finiteNumber(value, 0);
  if (n <= 0) return 0;
  return Math.min(n, max);
}
