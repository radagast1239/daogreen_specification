import { crabCatalogByConnectorId } from './frameCrabCatalog.js';
import {
  CRAB_TIER_REGULAR,
  CRAB_TIER_TOP,
  countCrabPostOverrides,
  hasCrabPostOverride,
} from './frameCrabOverrides.js';
import {
  countConnectorsByTypeForBom,
  crabCutListQtyToPieces,
  crabPiecesFromSets,
  crabSetsFromPieces,
  isCornerPost,
  isLongSidePost,
  isMiddleYPost,
  isSingleBayRack,
} from './frameCrabRules.js';

export const CRAB_CHIP_COLORS = {
  G: '#d28c1e',
  T: '#e6b800',
  X: '#3282d2',
  A4: '#a050be',
  A6: '#783c96',
};

const CRAB_ORDER = ['G', 'T', 'X', 'A4', 'A6'];

/** @param {number} px @param {number} py @param {number} postCountX @param {number} postCountY */
export function describePostRole(px, py, postCountX, postCountY) {
  const corner = isCornerPost(px, py, postCountX, postCountY);
  const longSide = isLongSidePost(px, postCountX);
  const middleY = isMiddleYPost(py, postCountY);
  const internalX = px > 0 && px < postCountX - 1;
  const frontBack = py === 0 || py === postCountY - 1;

  if (corner) return 'Угол стеллажа';
  if (middleY && internalX) return 'Внутренняя стойка (средний ряд по глубине)';
  if (middleY && longSide) return 'Торцевая стойка (средний ряд по глубине)';
  if (frontBack && internalX) return 'Внутренняя стойка (перед/зад)';
  if (longSide) return 'Торцевая стойка (длинная сторона)';
  return 'Стойка';
}

function badgesFromConnectors(list) {
  const counts = {};
  for (const c of list) {
    counts[c.type] = (counts[c.type] || 0) + 1;
  }
  return CRAB_ORDER.filter((type) => counts[type]).map((type) => ({
    type,
    count: counts[type],
  }));
}

function levelCountsFromBadges(grid) {
  const totals = { G: 0, T: 0, X: 0, A4: 0, A6: 0 };
  for (const row of grid) {
    for (const cell of row) {
      for (const badge of cell.badges) {
        totals[badge.type] += badge.count;
      }
    }
  }
  return totals;
}

/** Ожидаемое кол-во комплектов по шаблонам ярусов (должно совпадать с BOM). */
export function impliedCrabSetsFromTiers(regularTier, topTier, tierCount, postCountY = 2) {
  const repeat = isSingleBayRack(postCountY)
    ? Math.max(0, tierCount ?? 0)
    : Math.max(0, (tierCount ?? 1) - 1);
  const types = ['G', 'T', 'X', 'A4', 'A6'];
  const totals = {};
  for (const type of types) {
    totals[type] = (regularTier.postCounts[type] || 0) * repeat + (topTier.postCounts[type] || 0);
  }
  totals.T += (regularTier.crossBeamT || 0) * repeat + (topTier.crossBeamT || 0);
  return totals;
}

function buildTierGrid({
  levelIndex,
  isTop,
  tierId,
  label,
  hint,
  z,
  params,
  connectors,
  postCountX,
  postCountY,
}) {
  const postAtLevel = connectors.filter(
    (c) => c.axis === 'post' && Math.abs(c.z - z) < 0.01,
  );
  const crossAtLevel = connectors.filter(
    (c) => c.axis === 'cross' && Math.abs(c.z - z) < 0.01,
  );

  const byPost = new Map();
  for (const c of postAtLevel) {
    const key = `${c.px}|${c.py}`;
    const list = byPost.get(key) || [];
    list.push(c);
    byPost.set(key, list);
  }

  const grid = [];
  for (let py = 0; py < postCountY; py++) {
    const row = [];
    for (let px = 0; px < postCountX; px++) {
      const key = `${px}|${py}`;
      const list = byPost.get(key) || [];
      row.push({
        px,
        py,
        isCorner: isCornerPost(px, py, postCountX, postCountY),
        isLongSide: isLongSidePost(px, postCountX),
        isMiddleY: isMiddleYPost(py, postCountY),
        role: describePostRole(px, py, postCountX, postCountY),
        badges: badgesFromConnectors(list),
        endCap: list.some((c) => c.endCap),
        isOverride: hasCrabPostOverride(params.crabPostOverrides, px, py, isTop),
      });
    }
    grid.push(row);
  }

  return {
    id: tierId,
    index: levelIndex,
    z: Math.round(z),
    label,
    hint,
    isTop,
    grid,
    postCounts: levelCountsFromBadges(grid),
    crossBeamT: crossAtLevel.filter((c) => c.type === 'T').length,
    totalPostConnectors: postAtLevel.length,
    hasEndCap: postAtLevel.some((c) => c.endCap),
  };
}

/** @param {object[]} cutList */
export function cutListCrabTotals(cutList) {
  const totals = { G: 0, T: 0, X: 0, A4: 0, A6: 0 };
  for (const item of cutList || []) {
    const crab = crabCatalogByConnectorId(item.id);
    if (!crab) continue;
    totals[crab.key] = crabCutListQtyToPieces(item.qty ?? 0, crab.key);
  }
  return totals;
}

/** @param {object} params */
export function hasManualCrabQty(params) {
  const keys = ['crabGQtyManual', 'crabTQtyManual', 'crabXQtyManual', 'crabA4QtyManual', 'crabA6QtyManual'];
  if (keys.some((key) => params[key] !== '' && params[key] !== undefined && params[key] != null)) {
    return true;
  }
  return countCrabPostOverrides(params.crabPostOverrides) > 0;
}

/**
 * @param {object} params
 * @param {object} geom
 * @param {object[]} cutList
 */
export function buildCrabAudit(params, geom, cutList = []) {
  const { postCountX, postCountY } = params;
  const connectors = geom.connectors || [];
  const levels = geom.levels || [];
  const levelCount = geom.levelCount ?? levels.length;
  const tierCount = params.tierCount ?? Math.max(0, levelCount - 1);
  const topIdx = Math.max(0, levelCount - 1);
  const singleBay = isSingleBayRack(postCountY);
  const regularIdx = tierCount > 0 ? (singleBay ? 0 : Math.min(1, topIdx)) : 0;
  const regularLevelCount = singleBay ? Math.max(0, tierCount) : Math.max(0, tierCount - 1);

  const regularTier = buildTierGrid({
    levelIndex: regularIdx,
    isTop: false,
    tierId: CRAB_TIER_REGULAR,
    label: 'Обычные ярусы',
    hint: singleBay
      ? `Шаблон для рабочих ярусов 1–${tierCount} (${regularLevelCount} шт.)`
      : `Шаблон для ярусов 1–${tierCount - 1} (${regularLevelCount} шт.)`,
    z: levels[regularIdx] ?? 0,
    params,
    connectors,
    postCountX,
    postCountY,
  });

  const topTier = buildTierGrid({
    levelIndex: topIdx,
    isTop: true,
    tierId: CRAB_TIER_TOP,
    label: 'Верхний ярус',
    hint: 'Отдельная схема только для верхнего уровня',
    z: levels[topIdx] ?? 0,
    params,
    connectors,
    postCountX,
    postCountY,
  });

  const geometryTotals = countConnectorsByTypeForBom(
    connectors,
    geom.levels ?? geom.zLevels,
    postCountY,
  );
  const cutListPieces = cutListCrabTotals(cutList);

  const comparisons = CRAB_ORDER.map((type) => {
    const geometrySets = geometryTotals[type] ?? 0;
    const cutPieces = cutListPieces[type] ?? 0;
    const cutSets = crabSetsFromPieces(cutPieces, type);
    const match = geometrySets === cutSets;
    return {
      type,
      geometrySets,
      geometryPieces: crabPiecesFromSets(geometrySets, type),
      cutSets,
      cutPieces,
      match,
    };
  });

  const allMatch = comparisons.every((row) => row.match) || hasManualCrabQty(params);

  const impliedTotals = impliedCrabSetsFromTiers(regularTier, topTier, tierCount, postCountY);

  return {
    postCountX,
    postCountY,
    levelCount,
    tierCount,
    regularLevelCount,
    tiers: [regularTier, topTier],
    geometryTotals,
    impliedTotals,
    cutListPieces,
    comparisons,
    allMatch,
    manualOverride: hasManualCrabQty(params),
    overrideCount: countCrabPostOverrides(params.crabPostOverrides),
  };
}
