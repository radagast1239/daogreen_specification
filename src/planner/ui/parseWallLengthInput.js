/**
 * PHASE 1B-1B — парсинг typed-length ввода для wall.setLength UI.
 *
 * Чистый leaf helper: не импортирует React/DOM/geometry core. Locale-парсинг
 * (запятая как разделитель) остаётся здесь, а не внутри geometryCommands.js —
 * command получает уже нормализованный конечный lengthMm.
 *
 * Использует parseFloat-эквивалентную семантику через явный regex + Number(),
 * не parseInt — дробная часть не должна теряться.
 */

const MIN_LENGTH_MM = 50;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

export const WALL_LENGTH_INPUT_EMPTY = "WALL_LENGTH_INPUT_EMPTY";
export const WALL_LENGTH_INPUT_NOT_A_NUMBER = "WALL_LENGTH_INPUT_NOT_A_NUMBER";
export const WALL_LENGTH_INPUT_NOT_POSITIVE = "WALL_LENGTH_INPUT_NOT_POSITIVE";
export const WALL_LENGTH_INPUT_TOO_SHORT = "WALL_LENGTH_INPUT_TOO_SHORT";

/**
 * @param {string} raw
 * @returns {{ok:true, lengthMm:number} | {ok:false, code:string, message:string}}
 */
export function parseWallLengthInput(raw) {
  if (typeof raw !== "string") {
    return { ok: false, code: WALL_LENGTH_INPUT_EMPTY, message: "Введите длину." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, code: WALL_LENGTH_INPUT_EMPTY, message: "Введите длину." };
  }
  const normalized = trimmed.replace(",", ".");
  if (!NUMBER_PATTERN.test(normalized)) {
    return { ok: false, code: WALL_LENGTH_INPUT_NOT_A_NUMBER, message: "Введите число, например 3000." };
  }
  const lengthMm = Number(normalized);
  if (!Number.isFinite(lengthMm)) {
    return { ok: false, code: WALL_LENGTH_INPUT_NOT_A_NUMBER, message: "Введите число, например 3000." };
  }
  if (lengthMm <= 0) {
    return { ok: false, code: WALL_LENGTH_INPUT_NOT_POSITIVE, message: "Длина должна быть больше нуля." };
  }
  if (lengthMm < MIN_LENGTH_MM) {
    return { ok: false, code: WALL_LENGTH_INPUT_TOO_SHORT, message: `Минимальная длина стены — ${MIN_LENGTH_MM} мм.` };
  }
  return { ok: true, lengthMm };
}

/** Обратное форматирование для инициализации rawValue при открытии редактора. */
export function formatWallLengthMm(lengthMm) {
  if (!Number.isFinite(lengthMm)) return "";
  const rounded = Math.round(lengthMm * 10) / 10;
  return String(rounded);
}
