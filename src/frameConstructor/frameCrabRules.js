/** Проточная гидропония: 6 стоек, 6–8 балок */
import { getCrabPostOverride } from './frameCrabOverrides.js';

export function isFlowRack(rackType) {
  return rackType === 'nft' || rackType === 'strawberry' || rackType === 'custom';
}

/** Рассада / подтопление: 4 стойки, 3 балки, только T-крабы */
export function isCompactRack(rackType) {
  return rackType === 'seedling' || rackType === 'flood';
}

/** Поддоны: подтопление, рассада, клубника */
export function supportsTrays(rackType) {
  return rackType === 'flood' || rackType === 'seedling' || rackType === 'strawberry';
}

/** Шаг между центрами соседних рядов стоек (общая стойка на стыке модулей) */
export function modulePostPitchMm(moduleDepthMm, tubeWidthMm) {
  return moduleDepthMm - tubeWidthMm;
}

/** Полная глубина каркаса при пристройке модулей по Y */
export function totalFrameDepthMm(moduleDepthMm, tubeWidthMm, postCountY) {
  if (postCountY <= 1) return moduleDepthMm;
  return tubeWidthMm + (postCountY - 1) * modulePostPitchMm(moduleDepthMm, tubeWidthMm);
}

/** Позиция ряда стоек py: модули пристраиваются снаружи, не делят одну глубину */
export function postYPosition(py, moduleDepthMm, tubeWidthMm) {
  return tubeWidthMm / 2 + py * modulePostPitchMm(moduleDepthMm, tubeWidthMm);
}

/** Длина поперечной балки в одном модуле (пролёт между стойками модуля) */
export function crossBayLengthMm(moduleDepthMm, tubeWidthMm) {
  return moduleDepthMm - 2 * tubeWidthMm;
}

export function suggestedTraySize(lengthMm, moduleDepthMm, tubeWidthMm) {
  const bayLength = crossBayLengthMm(moduleDepthMm, tubeWidthMm);
  return {
    trayLengthMm: Math.max(100, lengthMm - 40),
    trayWidthMm: Math.max(100, bayLength - 20),
  };
}

/** При изменении числа стоек по Y — масштабировать поперечины и подгонять поддоны */
export function getPostGridDefaults(prevParams, newPostCountY) {
  const postCountY = Math.max(2, Math.round(newPostCountY) || 2);
  const prevY = Math.max(2, prevParams.postCountY);
  const prevBays = Math.max(1, prevY - 1);
  const newBays = Math.max(1, postCountY - 1);
  const perBay = prevParams.crossBeamsPerLevel / prevBays;
  const crossBeamsPerLevel = Math.max(2, Math.round(perBay * newBays));

  const updates = { postCountY, crossBeamsPerLevel };
  if (supportsTrays(prevParams.rackType)) {
    Object.assign(
      updates,
      suggestedTraySize(
        prevParams.lengthMm,
        prevParams.depthMm,
        prevParams.tubeWidthMm
      )
    );
  }
  return updates;
}

export function getRackTypeDefaults(rackType, dims = {}) {
  const { lengthMm = 3000, depthMm = 500, tubeWidthMm = 20 } = dims;
  const base = isCompactRack(rackType)
    ? { postCountX: 2, postCountY: 2, crossBeamsPerLevel: 3 }
    : { postCountX: 3, postCountY: 2, crossBeamsPerLevel: 6 };

  if (supportsTrays(rackType)) {
    const tray = suggestedTraySize(lengthMm, depthMm, tubeWidthMm);
    return { ...base, trayEnabled: true, ...tray };
  }
  if (rackType === 'nft') {
    return { ...base, trayEnabled: false, channelsEnabled: true };
  }
  return { ...base, trayEnabled: false, channelsEnabled: false };
}

function postXY(px, py, spanX, tubeWidthMm, moduleDepthMm) {
  const x = px * (spanX + tubeWidthMm) + tubeWidthMm / 2;
  const y = postYPosition(py, moduleDepthMm, tubeWidthMm);
  return { x, y };
}

function connectorPositionKey(c) {
  return `${Math.round(c.x)}|${Math.round(c.y)}|${Math.round(c.z)}`;
}

function connectorKey(c) {
  return `${connectorPositionKey(c)}|${c.type ?? ''}|${c.slot ?? 0}`;
}

/** Промежуточный ряд стоек по глубине (при postCountY > 2). */
export function isMiddleYPost(py, postCountY) {
  return postCountY > 2 && py > 0 && py < postCountY - 1;
}

/** Длинная сторона каркаса (периметр по X). */
export function isLongSidePost(px, postCountX) {
  return px === 0 || px === postCountX - 1;
}

/**
 * Расстановка крабов при postCountY > 2 (доп. ряды по глубине).
 * null — использовать стандартную логику Г/T/X.
 */
export function postCrabCountsForLevel({ px, py, postCountX, postCountY, isTopLevel }) {
  if (postCountY <= 2) return null;

  const middleY = isMiddleYPost(py, postCountY);
  const longSide = isLongSidePost(px, postCountX);
  const internalX = px > 0 && px < postCountX - 1;
  const frontBack = py === 0 || py === postCountY - 1;
  const corner = isCornerPost(px, py, postCountX, postCountY);

  if (isTopLevel) {
    if (longSide) {
      return { g: 1, t: 0, x: 0, a4: 0, a6: 0 };
    }
    if (middleY && internalX) {
      return { g: 0, t: 1, x: 0, a4: 0, a6: 0 };
    }
    if (frontBack && internalX) {
      return { g: 0, t: 1, x: 0, a4: 0, a6: 0 };
    }
    return null;
  }

  if (middleY && internalX) {
    return { g: 0, t: 0, x: 0, a4: 0, a6: 1 };
  }
  if (middleY && longSide) {
    return { g: 0, t: 1, x: 0, a4: 0, a6: 0 };
  }
  if (frontBack && internalX) {
    return { g: 0, t: 0, x: 1, a4: 0, a6: 0 };
  }
  if (longSide) {
    return { g: 0, t: 1, x: 0, a4: 0, a6: 0 };
  }
  return null;
}

/** @deprecated используйте postCrabCountsForLevel */
export function fourWayCrabSetsForPost({ px, py, postCountX, postCountY, isTopLevel }) {
  const plan = postCrabCountsForLevel({ px, py, postCountX, postCountY, isTopLevel });
  if (!plan) return { a4: 0, x: 0 };
  return { a4: plan.a4, x: plan.x };
}

export function isCornerPost(px, py, postCountX, postCountY) {
  return (px === 0 || px === postCountX - 1) && (py === 0 || py === postCountY - 1);
}

/** Внутренняя стойка — не на периметре сетки; на ней крестовое X-соединение */
export function isInternalPost(px, py, postCountX, postCountY) {
  const internalX = px > 0 && px < postCountX - 1;
  const internalY = py > 0 && py < postCountY - 1;
  return internalX || internalY;
}

/** Автоматическая расстановка крабов на стойке (без ручных override). */
export function defaultPostCrabCounts({ px, py, postCountX, postCountY, isTopLevel }) {
  const yExpansionPlan = postCrabCountsForLevel({
    px,
    py,
    postCountX,
    postCountY,
    isTopLevel,
  });
  if (yExpansionPlan) return yExpansionPlan;

  if (isTopLevel && isCornerPost(px, py, postCountX, postCountY)) {
    return { g: 1, t: 0, x: 0, a4: 0, a6: 0 };
  }
  if (isInternalPost(px, py, postCountX, postCountY) && !isTopLevel) {
    return { g: 0, t: 0, x: 1, a4: 0, a6: 0 };
  }
  return { g: 0, t: 1, x: 0, a4: 0, a6: 0 };
}

/**
 * @param {object} frameParams
 * @param {number} levelIndex
 * @param {number} px
 * @param {number} py
 * @param {boolean} isTopLevel
 * @param {object|null|undefined} crabPostOverrides
 */
export function resolvePostCrabCounts(frameParams, levelIndex, px, py, isTopLevel, crabPostOverrides) {
  const manual = getCrabPostOverride(crabPostOverrides, px, py, isTopLevel);
  if (manual) return manual;
  return defaultPostCrabCounts({
    px,
    py,
    postCountX: frameParams.postCountX,
    postCountY: frameParams.postCountY,
    isTopLevel,
  });
}

/** G, T, X: одинаковые детали, 1 комплект = 2 шт. */
export const CRAB_PIECES_PER_SET = 2;

/** A6: 1 комплект = 4 шт. */
export const CRAB_A6_PIECES_PER_SET = 4;

/** @param {'G'|'T'|'X'|'A4'|'A6'} type */
export function crabPiecesPerSet(type = 'G') {
  if (type === 'A6') return CRAB_A6_PIECES_PER_SET;
  return CRAB_PIECES_PER_SET;
}

/** @param {number} sets @param {'G'|'T'|'X'|'A4'|'A6'} [type] */
export function crabPiecesFromSets(sets, type = 'G') {
  const n = Math.max(0, Number(sets) || 0);
  if (type === 'A4') return n;
  return n * crabPiecesPerSet(type);
}

/** @param {number} pieces @param {'G'|'T'|'X'|'A4'|'A6'} type */
export function crabSetsFromPieces(pieces, type) {
  const n = Math.max(0, Number(pieces) || 0);
  if (type === 'A4') return n;
  const perSet = crabPiecesPerSet(type);
  return perSet > 0 ? n / perSet : 0;
}

/** @param {number} sets @param {'G'|'T'|'X'|'A4'|'A6'} type */
export function crabSpecNote(sets, type) {
  const s = Math.max(0, Number(sets) || 0);
  if (type === 'A4') return `${s} компл.`;
  const pieces = crabPiecesFromSets(s, type);
  const perSet = crabPiecesPerSet(type);
  return `${s} компл. × ${perSet} шт = ${pieces} шт`;
}

/** Кол-во в спецификации: G/T/X/A6 — шт., A4 — компл. */
export function crabCutListQty(sets, type) {
  const s = Math.max(0, Number(sets) || 0);
  if (type === 'A4') return s;
  return crabPiecesFromSets(s, type);
}

/** Перевод qty из спецификации в комплекты (для сверки). */
export function crabCutListQtyToPieces(qty, type) {
  const n = Math.max(0, Number(qty) || 0);
  if (type === 'A4') return n;
  return n;
}

/**
 * Ручной ввод: G/T/X/A6 — шт., A4 — компл.
 * @param {number|string} manual
 * @param {'G'|'T'|'X'|'A4'|'A6'} type
 * @param {number} autoSets
 */
export function resolveManualCrabSets(manual, type, autoSets) {
  if (manual === '' || manual === undefined || manual === null) return autoSets;
  const n = Math.max(0, Number(manual) || 0);
  if (type === 'A4') return n;
  return crabSetsFromPieces(n, type);
}

/** Подпись количества для UI: G/T/X/A6 — шт., A4 — компл. */
export function crabDisplayQty(sets, type) {
  const s = Math.max(0, Number(sets) || 0);
  if (type === 'A4') return { qty: s, unit: 'компл.' };
  return { qty: crabPiecesFromSets(s, type), unit: 'шт.' };
}

export function countConnectorsByType(connectors) {
  return {
    G: connectors.filter((c) => c.type === 'G').length,
    T: connectors.filter((c) => c.type === 'T').length,
    X: connectors.filter((c) => c.type === 'X').length,
    A4: connectors.filter((c) => c.type === 'A4').length,
    A6: connectors.filter((c) => c.type === 'A6').length,
  };
}

/** Каркас с двумя рядами стоек по Y: каждый горизонтальный уровень — полноценный ярус. */
export function isSingleBayRack(postCountY) {
  return Math.max(2, Math.round(postCountY) || 2) === 2;
}

function inferPostCountYFromConnectors(connectors) {
  let maxPy = -1;
  for (const c of connectors || []) {
    if (c.axis === 'post' && c.py != null) maxPy = Math.max(maxPy, c.py);
  }
  return maxPy >= 0 ? maxPy + 1 : 2;
}

/**
 * Для спецификации — все уровни (1-й рабочий … верх) входят в закупку.
 */
export function countConnectorsByTypeForBom(connectors, zLevels, postCountY) {
  return countConnectorsByType(connectors);
}

function postConnectorOrientation(px, py, postCountX, postCountY, type) {
  if (type === 'G') return px === 0 ? 'right' : 'left';
  if (type === 'X') return 'center';
  if (px === 0) return 'right';
  if (px === postCountX - 1) return 'left';
  if (py === 0) return 'down';
  if (py === postCountY - 1) return 'up';
  return 'center';
}

function addPostCrabCounts(add, { x, y, z, px, py, postCountX, postCountY, counts }) {
  if (counts.g > 0) {
    add({
      x,
      y,
      z,
      type: 'G',
      axis: 'post',
      orientation: postConnectorOrientation(px, py, postCountX, postCountY, 'G'),
      px,
      py,
      slot: 'g',
    });
  }
  if (counts.t > 0) {
    add({
      x,
      y,
      z,
      type: 'T',
      axis: 'post',
      orientation: postConnectorOrientation(px, py, postCountX, postCountY, 'T'),
      px,
      py,
      slot: 't',
    });
  }
  for (let slot = 0; slot < counts.a4; slot++) {
    add({ x, y, z, type: 'A4', axis: 'post', orientation: 'center', px, py, slot: `a4-${slot}` });
  }
  for (let slot = 0; slot < counts.a6; slot++) {
    add({ x, y, z, type: 'A6', axis: 'post', orientation: 'center', px, py, slot: `a6-${slot}` });
  }
  if (counts.x > 0) {
    add({ x, y, z, type: 'X', axis: 'post', orientation: 'center', px, py, slot: 'x' });
  }
}

/** X-позиции торцевых поперечных балок — строго на оси крайних стоек по длине */
export function endCapBeamXPositions(postCountX, spanX, tubeWidthMm) {
  if (postCountX <= 0) return [];
  const positions = [];
  for (const px of [0, postCountX - 1]) {
    positions.push(px * (spanX + tubeWidthMm) + tubeWidthMm / 2);
  }
  return [...new Set(positions.map((x) => Math.round(x * 1000) / 1000))];
}

export function normalizeEndCapBeamLevelMask(rawMask, levelCount) {
  const count = Math.max(1, levelCount);
  const mask = Array.isArray(rawMask) ? rawMask.map(Boolean) : [];
  while (mask.length < count) mask.push(false);
  return mask.slice(0, count);
}

export function normalizeEndCapBeamDropByLevel(rawDrops, levelCount, maxDrop = 5000) {
  const count = Math.max(1, levelCount);
  const drops = Array.isArray(rawDrops)
    ? rawDrops.map((v) => {
      const n = Number(v);
      return Number.isNaN(n) ? 0 : Math.max(0, Math.min(maxDrop, n));
    })
    : [];
  while (drops.length < count) drops.push(0);
  return drops.slice(0, count);
}

export function resolveEndCapBeamZ(levelZ, dropMm) {
  const drop = Math.max(0, Number(dropMm) || 0);
  return Math.max(0, levelZ - drop);
}

export function mergeBeamXPositions(basePositions, extraPositions, tubeWidthMm) {
  const tol = tubeWidthMm / 2;
  const merged = [...basePositions];
  for (const x of extraPositions) {
    if (!merged.some((p) => Math.abs(p - x) < tol)) merged.push(x);
  }
  return merged.sort((a, b) => a - b);
}

/** X-позиции поперечин, не совпадающие с осями стоек. */
export function crossJunctionXPositions(xPositions, posts, tubeWidthMm) {
  return (xPositions || []).filter(
    (x) => !posts.some((p) => Math.abs(p.x - x) < tubeWidthMm),
  );
}

/**
 * T на внешних продольных.
 * Верхний ярус при 4 стойках по X: крайние стыки закрывает G (−4 T).
 * При 3 или 5+ стойках по X на верху — полный набор T как на рабочих ярусах.
 */
export function outerRailCrossXPositions(xPositions, posts, tubeWidthMm, { topLevel, multiBayDepth, postCountX }) {
  const positions = crossJunctionXPositions(xPositions, posts, tubeWidthMm);
  if (multiBayDepth && topLevel && postCountX === 4 && positions.length > 2) {
    return positions.slice(1, -1);
  }
  return positions;
}

export function generateConnectors({
  rackType,
  connectionType,
  postCountX,
  postCountY,
  levelCount,
  zLevels,
  spanX,
  depthMm,
  tubeWidthMm,
  beamLayouts,
  posts,
  endCapBeamLayouts = [],
  frameParams = null,
  crabPostOverrides = {},
}) {
  const connectors = [];
  if (connectionType !== 'crab') return connectors;

  const seen = new Set();
  const add = (c) => {
    const key = connectorKey(c);
    if (seen.has(key)) return;
    seen.add(key);
    connectors.push(c);
  };

  const upsertEndCapConnector = (c) => {
    const posKey = connectorPositionKey(c);
    const next = { ...c, type: 'T', endCap: true };
    const idx = connectors.findIndex(
      (item) => item.axis === 'post' && connectorPositionKey(item) === posKey,
    );
    if (idx >= 0) {
      const oldKey = connectorKey(connectors[idx]);
      seen.delete(oldKey);
      connectors[idx] = { ...connectors[idx], ...next };
      seen.add(connectorKey(connectors[idx]));
      return;
    }
    add(next);
  };


  const paramsForCrabs = frameParams || {
    postCountX,
    postCountY,
  };

  for (let l = 0; l < levelCount; l++) {
    const layout = beamLayouts[l];
    const z = zLevels[l];
    const isTopLevel = l === levelCount - 1;

    // Узлы на стойках
    for (let px = 0; px < postCountX; px++) {
      for (let py = 0; py < postCountY; py++) {
        const { x, y } = postXY(px, py, spanX, tubeWidthMm, depthMm);
        const counts = resolvePostCrabCounts(
          paramsForCrabs,
          l,
          px,
          py,
          isTopLevel,
          crabPostOverrides,
        );

        addPostCrabCounts(add, {
          x,
          y,
          z,
          px,
          py,
          postCountX,
          postCountY,
          counts,
        });
      }
    }

    // T на внешних продольных; X на средних продольных (стык поперечины с средним рядом)
    const yBayCount = Math.max(1, postCountY - 1);
    const multiBayDepth = postCountY > 2;

    for (let bay = 0; bay < yBayCount; bay++) {
      const y1 = postYPosition(bay, depthMm, tubeWidthMm);
      const y2 = postYPosition(bay + 1, depthMm, tubeWidthMm);
      const yFrontRail = y1 + tubeWidthMm / 2;
      const yBackRail = y2 - tubeWidthMm / 2;
      const isFirstBay = bay === 0;
      const isLastBay = bay === yBayCount - 1;

      const outerCrossX = outerRailCrossXPositions(layout.xPositions, posts, tubeWidthMm, {
        topLevel: isTopLevel,
        multiBayDepth,
        postCountX,
      });

      for (const x of outerCrossX) {
        if (!multiBayDepth || isFirstBay) {
          add({
            x,
            y: yFrontRail,
            z,
            type: 'T',
            axis: 'cross',
            orientation: 'down',
            slot: `cross-rail-f-${bay}`,
          });
        }
        if (!multiBayDepth || isLastBay) {
          add({
            x,
            y: yBackRail,
            z,
            type: 'T',
            axis: 'cross',
            orientation: 'up',
            slot: `cross-rail-b-${bay}`,
          });
        }
      }
    }

    if (multiBayDepth) {
      for (let py = 1; py < postCountY - 1; py++) {
        const yMid = postYPosition(py, depthMm, tubeWidthMm);
        for (const x of crossJunctionXPositions(layout.xPositions, posts, tubeWidthMm)) {
          add({
            x,
            y: yMid,
            z,
            type: 'X',
            axis: 'cross',
            orientation: 'center',
            slot: `cross-mid-${py}`,
          });
        }
      }
    }
  }

  for (const cap of endCapBeamLayouts) {
    if (!cap?.enabled) continue;
    const z = cap.z;
    for (const xPos of cap.xPositions || []) {
      let px = null;
      if (Math.abs(xPos - (tubeWidthMm / 2)) < tubeWidthMm) px = 0;
      else if (Math.abs(xPos - ((postCountX - 1) * (spanX + tubeWidthMm) + tubeWidthMm / 2)) < tubeWidthMm) {
        px = postCountX - 1;
      }
      if (px == null) continue;

      for (let py = 0; py < postCountY; py++) {
        const { x, y } = postXY(px, py, spanX, tubeWidthMm, depthMm);
        upsertEndCapConnector({
          x,
          y,
          z,
          type: 'T',
          axis: 'post',
          orientation: px === 0 ? 'right' : 'left',
        });
      }
    }
  }

  return connectors;
}
