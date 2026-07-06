export const CRAB_COUNT_KEYS = ['g', 't', 'x', 'a4', 'a6'];
export const CRAB_TIER_REGULAR = 'regular';
export const CRAB_TIER_TOP = 'top';

const EMPTY_COUNTS = { g: 0, t: 0, x: 0, a4: 0, a6: 0 };

/** @param {boolean} isTopLevel @param {number} px @param {number} py */
export function crabOverrideKey(isTopLevel, px, py) {
  const tier = isTopLevel ? CRAB_TIER_TOP : CRAB_TIER_REGULAR;
  return `${tier}_p${px}_p${py}`;
}

function safeCount(val) {
  const n = Math.round(Number(val));
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

/** @param {unknown} raw */
export function normalizeCrabCountSet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const counts = {
    g: safeCount(raw.g),
    t: safeCount(raw.t),
    x: safeCount(raw.x),
    a4: safeCount(raw.a4),
    a6: safeCount(raw.a6),
  };
  if (!CRAB_COUNT_KEYS.some((k) => counts[k] > 0)) return null;
  return counts;
}

/**
 * Ключи: regular_p{px}_p{py} и top_p{px}_p{py}.
 * Старые l{N}_p{px}_p{py} сворачиваются в regular/top по levelCount.
 * @param {unknown} raw
 * @param {number} [levelCount]
 */
export function migrateCrabPostOverrides(raw, levelCount = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const topIdx = Math.max(0, (levelCount || 1) - 1);
  const out = {};

  for (const [key, value] of Object.entries(raw)) {
    const counts = normalizeCrabCountSet(value);
    if (!counts) continue;

    if (/^(regular|top)_p\d+_p\d+$/.test(key)) {
      out[key] = counts;
      continue;
    }

    const legacy = key.match(/^l(\d+)_p(\d+)_p(\d+)$/);
    if (legacy) {
      const tier = Number(legacy[1]) === topIdx ? CRAB_TIER_TOP : CRAB_TIER_REGULAR;
      out[`${tier}_p${legacy[2]}_p${legacy[3]}`] = counts;
    }
  }
  return out;
}

/** @deprecated используйте migrateCrabPostOverrides */
export function normalizeCrabPostOverrides(raw, levelCount = 0) {
  return migrateCrabPostOverrides(raw, levelCount);
}

/** @param {object|null|undefined} overrides @param {number} px @param {number} py @param {boolean} isTopLevel */
export function getCrabPostOverride(overrides, px, py, isTopLevel) {
  const key = crabOverrideKey(isTopLevel, px, py);
  return normalizeCrabCountSet(overrides?.[key]);
}

/** @param {object|null|undefined} overrides */
export function hasCrabPostOverride(overrides, px, py, isTopLevel) {
  return getCrabPostOverride(overrides, px, py, isTopLevel) != null;
}

/** @param {object} a @param {object} b */
export function crabCountsEqual(a, b) {
  return CRAB_COUNT_KEYS.every((k) => safeCount(a?.[k]) === safeCount(b?.[k]));
}

/** @param {{ g?: number, t?: number, x?: number, a4?: number, a6?: number }} counts */
export function crabCountsToBadges(counts) {
  const map = { g: 'G', t: 'T', x: 'X', a4: 'A4', a6: 'A6' };
  return CRAB_COUNT_KEYS
    .filter((k) => safeCount(counts?.[k]) > 0)
    .map((k) => ({ type: map[k], count: safeCount(counts[k]) }));
}

/** @param {{ type: string, count: number }[]} badges */
export function badgesToCrabCounts(badges) {
  const counts = { ...EMPTY_COUNTS };
  const map = { G: 'g', T: 't', X: 'x', A4: 'a4', A6: 'a6' };
  for (const b of badges || []) {
    const key = map[b.type];
    if (key) counts[key] = safeCount(b.count);
  }
  return counts;
}

/**
 * @param {object} params
 * @param {boolean} isTopLevel
 * @param {number} px
 * @param {number} py
 * @param {object|null} counts — null удаляет override
 */
export function setCrabPostOverride(params, isTopLevel, px, py, counts) {
  const key = crabOverrideKey(isTopLevel, px, py);
  const levelCount = (params.tierCount ?? 0) + 1;
  const prev = migrateCrabPostOverrides(params.crabPostOverrides, levelCount);
  const next = { ...prev };
  const normalized = normalizeCrabCountSet(counts);
  if (!normalized) {
    delete next[key];
  } else {
    next[key] = normalized;
  }
  return { ...params, crabPostOverrides: next };
}

/** @param {object|null|undefined} overrides */
export function countCrabPostOverrides(overrides) {
  return Object.keys(migrateCrabPostOverrides(overrides)).length;
}
