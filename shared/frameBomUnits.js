/**
 * Frame BOM quantity contract:
 * - geometry and pipe cut lengths are millimetres;
 * - profile tube purchase qty is metres;
 * - piece materials are pieces;
 * - a purchase draft is per rack, a project item is the all-racks total.
 */

export const FRAME_BOM_QTY_PRECISION = 3;

/** Parse a decimal from either UI locale without treating the separator as grouping. */
export function parseFrameBomDecimal(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined || value === "") return fallback;

  let raw = String(value)
    .trim()
    .replace(/[\s\u00a0\u202f']/g, "");
  if (!raw) return fallback;

  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimalAt = Math.max(comma, dot);
    const integerPart = raw.slice(0, decimalAt).replace(/[.,]/g, "");
    const fractionalPart = raw.slice(decimalAt + 1).replace(/[.,]/g, "");
    raw = `${integerPart}.${fractionalPart}`;
  } else {
    raw = raw.replace(",", ".");
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundFrameBomQty(value, precision = FRAME_BOM_QTY_PRECISION) {
  const qty = parseFrameBomDecimal(value, 0);
  const factor = 10 ** precision;
  return Math.round((qty + Number.EPSILON) * factor) / factor;
}
