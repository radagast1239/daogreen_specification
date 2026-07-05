import { normalizeFrameConfig } from './frameConfig.js';
import {
  generateConnectors,
  supportsTrays,
  postYPosition,
  crossBayLengthMm,
  totalFrameDepthMm,
  endCapBeamXPositions,
  normalizeEndCapBeamLevelMask,
  normalizeEndCapBeamDropByLevel,
  resolveEndCapBeamZ,
} from './frameCrabRules.js';
import { generateNftChannels } from './frameNftChannels.js';

function crossBeamExists(crossBeams, x, y, z, tubeWidthMm) {
  const tol = tubeWidthMm / 2;
  return crossBeams.some(
    (b) => Math.abs(b.z - z) < 0.01 && Math.abs(b.x - x) < tol && Math.abs(b.y - y) < tol,
  );
}

export function calculateFrameGeometry(rawParams) {
  const params = normalizeFrameConfig(rawParams);
  
  const {
    lengthMm,
    depthMm,
    tierCount,
    tierSpacingMm,
    bottomOffsetMm,
    tubeWidthMm,
    tubeHeightMm,
    postCountX,
    postCountY,
    crossBeamsPerLevel,
    beamSpacingMode = 'equal',
    customBeamLayoutByLevel = [],
    endCapBeamsEnabled = false,
    endCapBeamLevelMask = [],
    endCapBeamDropByLevel = [],
    trayEnabled = false,
    trayLengthMm,
    trayWidthMm,
    trayHeightMm,
    trayEndInsetMm = 0,
    connectionType = 'crab',
    rackType = 'nft',
    channelsEnabled = false,
  } = params;

  const validationErrors = [];
  const moduleDepthMm = depthMm;
  const totalDepthMm = totalFrameDepthMm(moduleDepthMm, tubeWidthMm, postCountY);
  const spanX = (lengthMm - postCountX * tubeWidthMm) / (postCountX - 1);
  const crossBeamLength = crossBayLengthMm(moduleDepthMm, tubeWidthMm);
  const yBayCount = Math.max(1, postCountY - 1);
  const beamsPerBay = Math.max(1, Math.round(crossBeamsPerLevel / yBayCount));
  const postHeight = bottomOffsetMm + tierCount * tierSpacingMm;
  const levelCount = tierCount + 1;
  const zLevels = Array.from({ length: levelCount }, (_, i) => bottomOffsetMm + i * tierSpacingMm);

  if (spanX <= 0) {
    validationErrors.push("Длина каркаса слишком мала для заданного количества стоек.");
  }
  if (crossBeamLength <= 0) {
    validationErrors.push("Глубина каркаса слишком мала для заданного количества стоек.");
  }

  if (validationErrors.length > 0) {
    return { validationErrors };
  }

  const posts = [];
  for (let px = 0; px < postCountX; px++) {
    for (let py = 0; py < postCountY; py++) {
      const x = px * (spanX + tubeWidthMm) + tubeWidthMm / 2;
      const y = postYPosition(py, moduleDepthMm, tubeWidthMm);
      posts.push({ x, y, z: postHeight / 2, length: postHeight });
    }
  }

  const longitudinalBeams = [];
  for (let px = 0; px < postCountX - 1; px++) {
    for (let py = 0; py < postCountY; py++) {
      for (let l = 0; l < levelCount; l++) {
        const x = px * (spanX + tubeWidthMm) + tubeWidthMm + spanX / 2;
        const y = postYPosition(py, moduleDepthMm, tubeWidthMm);
        const z = zLevels[l];
        longitudinalBeams.push({ x, y, z, length: spanX });
      }
    }
  }

  const beamLayouts = [];
  const crossBeams = [];
  
  for (let l = 0; l < levelCount; l++) {
    let xPositions = [];
    let startInsetMm = trayEndInsetMm;
    let spacingsMm = [];
    
    if (beamSpacingMode === 'equal') {
      const usableStartX = trayEndInsetMm;
      const usableEndX = lengthMm - trayEndInsetMm;
      if (beamsPerBay === 1) {
        xPositions.push((usableStartX + usableEndX) / 2);
      } else {
        const step = (usableEndX - usableStartX) / (beamsPerBay - 1);
        for (let i = 0; i < beamsPerBay; i++) {
          xPositions.push(usableStartX + i * step);
          if (i < beamsPerBay - 1) spacingsMm.push(step);
        }
      }
    } else {
      const layout = customBeamLayoutByLevel.find(cl => cl.levelIndex === l) || {
        startInsetMm: trayEndInsetMm,
        spacingsMm: Array(Math.max(0, beamsPerBay - 1)).fill((lengthMm - 2 * trayEndInsetMm) / Math.max(1, beamsPerBay - 1))
      };
      startInsetMm = layout.startInsetMm;
      spacingsMm = layout.spacingsMm || [];
      
      let currentX = startInsetMm;
      xPositions.push(currentX);
      for (let i = 0; i < beamsPerBay - 1; i++) {
        const space = spacingsMm[i] || 0;
        currentX += space;
        xPositions.push(currentX);
      }
    }
    
    const endInsetMm = lengthMm - xPositions[xPositions.length - 1];
    
    beamLayouts.push({
      levelIndex: l,
      z: zLevels[l],
      xPositions,
      spacingsMm,
      startInsetMm,
      endInsetMm
    });
    
    for (let bay = 0; bay < yBayCount; bay++) {
      const y1 = postYPosition(bay, moduleDepthMm, tubeWidthMm);
      const y2 = postYPosition(bay + 1, moduleDepthMm, tubeWidthMm);
      const y = (y1 + y2) / 2;
      const bayLength = y2 - y1 - tubeWidthMm;

      for (let i = 0; i < xPositions.length; i++) {
        const x = xPositions[i];
        const z = zLevels[l];
        crossBeams.push({ x, y, z, length: bayLength });
      }
    }
  }

  const endCapBeamLayouts = [];
  const endCapLevelMask = normalizeEndCapBeamLevelMask(endCapBeamLevelMask, levelCount);
  const endCapDrops = normalizeEndCapBeamDropByLevel(endCapBeamDropByLevel, levelCount);
  const torzecXPositions = endCapBeamXPositions(postCountX, spanX, tubeWidthMm);

  if (endCapBeamsEnabled) {
    for (let l = 0; l < levelCount; l++) {
      const enabled = endCapLevelMask[l];
      const dropMm = endCapDrops[l];
      const baseZ = zLevels[l];
      const z = enabled ? resolveEndCapBeamZ(baseZ, dropMm) : baseZ;
      endCapBeamLayouts.push({
        levelIndex: l,
        z,
        baseZ,
        dropMm: enabled ? dropMm : 0,
        enabled,
        xPositions: enabled ? torzecXPositions : [],
      });

      if (!enabled) continue;

      for (let bay = 0; bay < yBayCount; bay++) {
        const y1 = postYPosition(bay, moduleDepthMm, tubeWidthMm);
        const y2 = postYPosition(bay + 1, moduleDepthMm, tubeWidthMm);
        const y = (y1 + y2) / 2;
        const bayLength = y2 - y1 - tubeWidthMm;

        for (const x of torzecXPositions) {
          if (crossBeamExists(crossBeams, x, y, z, tubeWidthMm)) continue;
          crossBeams.push({ x, y, z, length: bayLength, endCap: true });
        }
      }
    }
  }

  const trays = [];
  if (trayEnabled && supportsTrays(rackType)) {
    for (let i = 0; i < tierCount; i++) {
      const z = zLevels[i] + tubeHeightMm / 2 + trayHeightMm / 2 + 2;
      for (let bay = 0; bay < yBayCount; bay++) {
        const y1 = postYPosition(bay, moduleDepthMm, tubeWidthMm);
        const y2 = postYPosition(bay + 1, moduleDepthMm, tubeWidthMm);
        trays.push({
          x: lengthMm / 2,
          y: (y1 + y2) / 2,
          z,
          length: trayLengthMm,
          width: trayWidthMm,
          height: trayHeightMm,
        });
      }
    }
  }

  const nftChannels = generateNftChannels({
    rackType,
    channelsEnabled,
    lengthMm,
    depthMm: moduleDepthMm,
    tubeWidthMm,
    tubeHeightMm,
    tierCount,
    zLevels,
    postCountY,
  });

  const connectors = generateConnectors({
    rackType,
    connectionType,
    postCountX,
    postCountY,
    levelCount,
    zLevels,
    spanX,
    depthMm: moduleDepthMm,
    tubeWidthMm,
    beamLayouts,
    posts,
    endCapBeamLayouts,
  });

  const dimensions = {
    lengthMm,
    depthMm: totalDepthMm,
    moduleDepthMm,
    postHeight,
    tierSpacingMm,
    bottomOffsetMm,
    trayLengthMm,
    trayWidthMm
  };

  return {
    postHeight,
    levelCount,
    zLevels,
    spanX,
    crossBeamLength,
    posts,
    longitudinalBeams,
    crossBeams,
    trays,
    nftChannels,
    connectors,
    dimensions,
    levels: zLevels,
    beamLayouts,
    endCapBeamLayouts,
    validationErrors: []
  };
}
