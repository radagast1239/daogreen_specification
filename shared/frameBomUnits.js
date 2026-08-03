/**
 * Frame BOM quantity contract:
 * - geometry and pipe cut lengths are millimetres;
 * - profile tube purchase qty is metres;
 * - piece materials are pieces;
 * - a purchase draft is per rack, a project item is the all-racks total.
 */

export const FRAME_BOM_QTY_PRECISION = 3;

const METRE_UNITS = new Set([
  "м",
  "м.",
  "м.п.",
  "м.п",
  "пог.м",
  "пог. м",
  "погонный метр",
  "погонные метры",
]);

const PIECE_UNITS = new Set([
  "шт",
  "шт.",
  "штука",
  "штуки",
  "комплект",
  "компл.",
  "уп.",
  "упаковка",
]);

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

export function normalizeFrameBomUnit(unit) {
  return String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

export function resolveFrameBomUnitKind(unit) {
  const normalized = normalizeFrameBomUnit(unit);
  if (METRE_UNITS.has(normalized)) return "metre";
  if (PIECE_UNITS.has(normalized)) return "piece";
  return "unknown";
}

function hasPipeCuts(raw) {
  return Array.isArray(raw) && raw.length > 0;
}

/** Validate millimetre cut lengths and cut quantities without guessing. */
export function deriveFrameBomPipeCutMetres(rawCuts) {
  if (!hasPipeCuts(rawCuts)) {
    return { ok: false, qty: 0, reason: "PIPE_CUTS_MISSING" };
  }
  let totalMm = 0;
  for (let index = 0; index < rawCuts.length; index += 1) {
    const cut = rawCuts[index];
    const lengthMm = parseFrameBomDecimal(cut?.lengthMm, NaN);
    const cutQty = parseFrameBomDecimal(cut?.qty, NaN);
    if (!Number.isFinite(lengthMm) || lengthMm <= 0) {
      return { ok: false, qty: 0, reason: "PIPE_CUT_LENGTH_INVALID", cutIndex: index };
    }
    if (!Number.isFinite(cutQty) || cutQty <= 0) {
      return { ok: false, qty: 0, reason: "PIPE_CUT_QTY_INVALID", cutIndex: index };
    }
    totalMm += lengthMm * cutQty;
  }
  return { ok: true, qty: roundFrameBomQty(totalMm / 1000), reason: "" };
}

/**
 * Pure commercial quantity normalizer. Dimension comes only from unit.
 * Unknown/piece units never derive a quantity from pipe cuts.
 */
export function normalizeFrameBomDraftQuantity(line = {}) {
  const unitKind = resolveFrameBomUnitKind(line.unit);
  const rawQty = parseFrameBomDecimal(line.qty, NaN);
  if (unitKind === "metre" && hasPipeCuts(line.pipeCuts)) {
    const derived = deriveFrameBomPipeCutMetres(line.pipeCuts);
    if (!derived.ok) return { ...derived, unitKind, source: "pipe_cuts" };
    return { ok: true, qty: derived.qty, unitKind, source: "pipe_cuts", reason: "" };
  }
  if (!Number.isFinite(rawQty) || rawQty < 0) {
    return { ok: false, qty: 0, unitKind, source: "raw", reason: "RAW_QTY_INVALID" };
  }
  return {
    ok: true,
    qty: roundFrameBomQty(rawQty),
    unitKind,
    source: "raw",
    reason: "",
  };
}

export function normalizeFrameBomDraftUnits(draft = []) {
  const items = [];
  const errors = [];
  for (let index = 0; index < (draft || []).length; index += 1) {
    const line = draft[index];
    const normalized = normalizeFrameBomDraftQuantity(line);
    const next = { ...line, qty: normalized.qty };
    if (!normalized.ok) {
      next.unitNormalizationError = normalized.reason;
      errors.push({
        index,
        key: line?.key || "",
        materialId: line?.materialId || "",
        reason: normalized.reason,
        cutIndex: normalized.cutIndex,
      });
    } else {
      delete next.unitNormalizationError;
    }
    items.push(next);
  }
  return { ok: errors.length === 0, items, errors };
}
