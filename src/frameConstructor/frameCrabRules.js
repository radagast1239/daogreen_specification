/** Проточная гидропония: 6 стоек, 6–8 балок */
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

function connectorKey(c) {
  return `${Math.round(c.x)}|${Math.round(c.y)}|${Math.round(c.z)}`;
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

/** Один комплект краба = 2 половинки (шт.) */
export function crabHalvesFromSets(sets) {
  return Math.max(0, sets) * 2;
}

export function countConnectorsByType(connectors) {
  return {
    G: connectors.filter((c) => c.type === 'G').length,
    T: connectors.filter((c) => c.type === 'T').length,
    X: connectors.filter((c) => c.type === 'X').length,
  };
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
    const key = connectorKey(c);
    const next = { ...c, type: 'T', endCap: true };
    const idx = connectors.findIndex((item) => connectorKey(item) === key);
    if (idx >= 0) {
      connectors[idx] = { ...connectors[idx], ...next };
      return;
    }
    seen.add(key);
    connectors.push(next);
  };


  for (let l = 0; l < levelCount; l++) {
    const layout = beamLayouts[l];
    const z = zLevels[l];
    const isTopLevel = l === levelCount - 1;

    // Узлы на стойках
    for (let px = 0; px < postCountX; px++) {
      for (let py = 0; py < postCountY; py++) {
        const { x, y } = postXY(px, py, spanX, tubeWidthMm, depthMm);

        let type = 'T';
        let orientation = 'center';

        if (isTopLevel && isCornerPost(px, py, postCountX, postCountY)) {
          type = 'G';
          if (px === 0) orientation = 'right';
          else orientation = 'left';
        } else if (isInternalPost(px, py, postCountX, postCountY) && !isTopLevel) {
          type = 'X';
          orientation = 'center';
        } else {
          type = 'T';
          if (px === 0) orientation = 'right';
          else if (px === postCountX - 1) orientation = 'left';
          else if (py === 0) orientation = 'down';
          else if (py === postCountY - 1) orientation = 'up';
        }

        add({ x, y, z, type, axis: 'post', orientation, px, py });
      }
    }

    // Узлы поперечной балки на продольной (не на стойке) — всегда T
    for (let py = 0; py < postCountY; py++) {
      const y = postXY(0, py, spanX, tubeWidthMm, depthMm).y;
      for (const x of layout.xPositions) {
        const atPost = posts.some((p) => Math.abs(p.x - x) < tubeWidthMm && Math.abs(p.y - y) < tubeWidthMm);
        if (atPost) continue;

        add({
          x,
          y,
          z,
          type: 'T',
          axis: 'cross',
          orientation: py === 0 ? 'down' : 'up',
        });
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
