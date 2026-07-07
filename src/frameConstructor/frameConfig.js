import { crossBayLengthMm, normalizeEndCapBeamLevelMask, normalizeEndCapBeamDropByLevel } from './frameCrabRules.js';
import { migrateCrabPostOverrides } from './frameCrabOverrides.js';

export function normalizeFrameConfig(config) {
  const safeNum = (val, min, def, max = Infinity) => {
    let num;
    if (typeof val === 'string') {
      num = parseFloat(val);
    } else {
      num = Number(val);
    }
    if (isNaN(num) || num < min) return def;
    if (num > max) return max;
    return num;
  };

  const safeOptNum = (val) => {
    if (val === '' || val === null || val === undefined) return '';
    const num = parseFloat(val);
    return isNaN(num) ? '' : Math.max(0, num);
  };

  const lengthMm = safeNum(config.lengthMm, 500, 3000);
  const depthMm = safeNum(config.depthMm, 200, 500);
  const postCountY = safeNum(config.postCountY, 2, 2, 6);
  const tubeWidthMm = safeNum(config.tubeWidthMm, 10, 20);
  const bayLength = crossBayLengthMm(depthMm, tubeWidthMm);
  const maxTrayLength = Math.max(100, lengthMm - 20);
  const maxTrayWidth = Math.max(100, bayLength - 10);
  const defaultTrayLength = Math.max(100, lengthMm - 40);
  const defaultTrayWidth = Math.max(100, bayLength - 20);

  const tierCount = safeNum(config.tierCount, 1, 7);
  const levelCount = tierCount + 1;

  return {
    ...config,
    lengthMm,
    depthMm,
    tierCount,
    tierSpacingMm: safeNum(config.tierSpacingMm, 100, 400),
    bottomOffsetMm: safeNum(config.bottomOffsetMm, 0, 400),
    tubeWidthMm,
    tubeHeightMm: safeNum(config.tubeHeightMm, 10, 20),
    postCountX: safeNum(config.postCountX, 2, 3),
    postCountY,
    crossBeamsPerLevel: safeNum(config.crossBeamsPerLevel, 2, 6, 50),
    trayLengthMm: safeNum(config.trayLengthMm, 100, defaultTrayLength, maxTrayLength),
    trayWidthMm: safeNum(config.trayWidthMm, 100, defaultTrayWidth, maxTrayWidth),
    trayHeightMm: safeNum(config.trayHeightMm, 10, 50),
    crabGQtyManual: safeOptNum(config.crabGQtyManual),
    crabTQtyManual: safeOptNum(config.crabTQtyManual),
    crabXQtyManual: safeOptNum(config.crabXQtyManual),
    crabA4QtyManual: safeOptNum(config.crabA4QtyManual),
    crabA6QtyManual: safeOptNum(config.crabA6QtyManual),
    crabPostOverrides: migrateCrabPostOverrides(config.crabPostOverrides, levelCount),
    endCapBeamsEnabled: config.endCapBeamsEnabled === true,
    endCapBeamLevelMask: normalizeEndCapBeamLevelMask(config.endCapBeamLevelMask, levelCount),
    endCapBeamDropByLevel: normalizeEndCapBeamDropByLevel(config.endCapBeamDropByLevel, levelCount),
    channelsEnabled: config.rackType === 'nft' ? config.channelsEnabled !== false : false,
    showChannels: config.showChannels !== false,
    channelStockMarginPct: safeNum(config.channelStockMarginPct, 0, 8, 100),
    channelSleeveMarginPct: safeNum(config.channelSleeveMarginPct, 0, 8, 100),
    channelElbowMarginPct: safeNum(config.channelElbowMarginPct, 0, 8, 100),
    constructionType: config.constructionType || 'tube_crab',
    angleProfile: config.angleProfile || '30×30',
    angleOverlapMm: safeNum(config.angleOverlapMm, 0, 150, 1000),
    crossBeamFasteningMode: config.crossBeamFasteningMode || 'bolts_only',
    angleStockLengthsMm: config.angleStockLengthsMm || [2000, 2500],
  };
}
