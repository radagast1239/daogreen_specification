import { postYPosition } from './frameCrabRules.js';

/** Профиль NFT-канала: 110 мм поперёк (Y), 55 мм высота (Z), длина — вдоль стеллажа (X) */
export const NFT_CHANNEL_WIDTH_MM = 110;
export const NFT_CHANNEL_HEIGHT_MM = 55;

export function supportsNftChannels(rackType) {
  return rackType === 'nft';
}

export function shouldShowNftChannels(params) {
  return supportsNftChannels(params?.rackType) && params?.channelsEnabled && params?.showChannels;
}

/** Число каналов в ряд по глубине модуля: 700→6, 1000→9 */
export function countNftChannelsAcrossDepth(depthMm) {
  return Math.max(1, Math.floor(depthMm / NFT_CHANNEL_WIDTH_MM));
}

/** Y-центры каналов, упакованных по 110 мм внутри depthMm */
export function nftChannelYPositions(depthMm) {
  const n = countNftChannelsAcrossDepth(depthMm);
  const packW = n * NFT_CHANNEL_WIDTH_MM;
  const yStart = (depthMm - packW) / 2 + NFT_CHANNEL_WIDTH_MM / 2;
  return Array.from({ length: n }, (_, i) => yStart + i * NFT_CHANNEL_WIDTH_MM);
}

/** Стандартная длина заготовки канала для закупки */
export const NFT_CHANNEL_STOCK_MM = 2000;

/** Запас по умолчанию, % */
export const NFT_CHANNEL_STOCK_MARGIN = 0.08;
export const NFT_CHANNEL_STOCK_MARGIN_PCT_DEFAULT = 8;

/** Нормализация % запаса (0–100) */
export function normalizeNftMarginPct(value, fallbackPct = NFT_CHANNEL_STOCK_MARGIN_PCT_DEFAULT) {
  const num = Number(value);
  if (isNaN(num) || num < 0) return fallbackPct;
  return Math.min(100, Math.round(num));
}

/** % запаса для каналов / муфт / колен из параметров каркаса */
export function resolveNftChannelMargins(params) {
  return {
    channelPct: normalizeNftMarginPct(params?.channelStockMarginPct),
    sleevePct: normalizeNftMarginPct(params?.channelSleeveMarginPct),
    elbowPct: normalizeNftMarginPct(params?.channelElbowMarginPct),
  };
}

export function nftMarginFraction(pct) {
  return normalizeNftMarginPct(pct) / 100;
}

/** Длина канала вдоль стеллажа = длина стеллажа (lengthMm) */
export function nftChannelLengthMm(lengthMm, _tubeWidthMm) {
  return Math.max(100, lengthMm);
}

export function formatMmLengthLabel(mm) {
  return mm % 1000 === 0 ? `${mm / 1000} м` : `${mm} мм`;
}

/** Расшифровка сегментов на линию: «28×2 м + 28×1 м» */
export function buildLineSegmentBreakdown(runLengthMm, lineCount) {
  if (lineCount <= 0 || runLengthMm <= 0) return '';
  return channelSegmentLengthsMm(runLengthMm)
    .map((len) => `${lineCount}×${formatMmLengthLabel(len)}`)
    .join(' + ');
}

export function formatNftQtyWithMargin(qty, baseCount, marginPct) {
  return `${qty} шт (${baseCount} + ${marginPct}%)`;
}

/** Текст сегментов одной линии, напр. «2 м + 1 м» */
export function formatChannelSegmentsDesc(runLengthMm) {
  return channelSegmentLengthsMm(runLengthMm)
    .map((s) => formatMmLengthLabel(s))
    .join(' + ');
}

/** Заготовок 2 м по суммарной длине с запасом */
export function nftChannelStockPieces(totalLengthMm, margin = NFT_CHANNEL_STOCK_MARGIN) {
  if (totalLengthMm <= 0) return 0;
  return Math.ceil((totalLengthMm * (1 + margin)) / NFT_CHANNEL_STOCK_MM);
}

/** Число отрезков 2 м для одной линии канала (2 м → муфта → 2 м → …) */
export function nftChannelSegmentsForRun(runLengthMm) {
  if (runLengthMm <= 0) return 0;
  return Math.ceil(runLengthMm / NFT_CHANNEL_STOCK_MM);
}

/** Муфты между отрезками, если линия длиннее 2 м */
export function nftChannelSleevesForRun(runLengthMm) {
  if (runLengthMm <= NFT_CHANNEL_STOCK_MM) return 0;
  return nftChannelSegmentsForRun(runLengthMm) - 1;
}

/** Колено на каждой стороне канала при межярусном стыке (верх + низ) */
export const NFT_ELBOWS_PER_TIER_JOINT = 2;

/** Кол-во колен: 2 шт на канал на каждый межярусный переход */
export function countNftChannelElbows(params, geom) {
  if (!params?.channelsEnabled || !supportsNftChannels(params.rackType)) return 0;
  const tierCount = params.tierCount ?? 0;
  if (tierCount < 2) return 0;
  const channelsPerRow = countNftChannelsAcrossDepth(params.depthMm);
  const yBayCount = Math.max(1, (params.postCountY ?? 2) - 1);
  const tierJoints = tierCount - 1;
  return tierJoints * channelsPerRow * yBayCount * NFT_ELBOWS_PER_TIER_JOINT;
}

/** Кол-во штук с запасом (колена, муфты, заготовки) */
export function nftChannelQtyWithMargin(count, marginPct = NFT_CHANNEL_STOCK_MARGIN_PCT_DEFAULT) {
  if (count <= 0) return 0;
  const margin = nftMarginFraction(marginPct);
  return Math.ceil(count * (1 + margin));
}

/**
 * Закупка NFT-каналов: отрезки 2 м, муфты между ними, колена между ярусами.
 * @returns {null|object}
 */
export function calculateNftChannelBill(params, geom) {
  if (!params?.channelsEnabled || !supportsNftChannels(params.rackType)) return null;
  const nft = geom?.nftChannels;
  if (!nft?.runs?.length) return null;

  const margins = resolveNftChannelMargins(params);
  const channelsPerRow = countNftChannelsAcrossDepth(params.depthMm);
  const yBayCount = Math.max(1, params.postCountY - 1);
  const channelRunLength = params.lengthMm ?? nft.runs[0]?.length ?? 0;

  const horizontalLines = nft.runs.length;
  const horizontalTotalMm = nft.runs.reduce((sum, run) => sum + run.length, 0);
  const horizontalSegments = nft.runs.reduce(
    (sum, run) => sum + nftChannelSegmentsForRun(run.length),
    0,
  );

  const sleeveCount = nft.runs.reduce(
    (sum, run) => sum + nftChannelSleevesForRun(run.length),
    0,
  );
  const sleeveQty = nftChannelQtyWithMargin(sleeveCount, margins.sleevePct);

  const elbowCount = countNftChannelElbows(params, geom);
  const elbowQty = nftChannelQtyWithMargin(elbowCount, margins.elbowPct);
  const tierJoints = Math.max(0, params.tierCount - 1);

  const verticalLines = nft.drops?.length ?? 0;
  const verticalDropLengthMm = verticalLines > 0 ? Math.round(nft.drops[0].length) : 0;
  const verticalTotalMm = (nft.drops || []).reduce((sum, drop) => sum + drop.length, 0);
  const tierSpacingMm = Math.round(params.tierSpacingMm ?? 0);

  const totalChannelLengthMm = horizontalTotalMm + verticalTotalMm;
  const totalStockPieces = Math.ceil(totalChannelLengthMm / NFT_CHANNEL_STOCK_MM);
  const stockTotalQty = nftChannelQtyWithMargin(totalStockPieces, margins.channelPct);

  const horizontalBreakdownDesc = buildLineSegmentBreakdown(channelRunLength, horizontalLines);
  const verticalBreakdownDesc = verticalLines > 0
    ? `шаг ${tierSpacingMm} мм, ${verticalLines}×${verticalDropLengthMm} мм`
    : '';

  return {
    stockLengthMm: NFT_CHANNEL_STOCK_MM,
    profile: `${NFT_CHANNEL_WIDTH_MM}×${NFT_CHANNEL_HEIGHT_MM}`,
    channelMarginPct: margins.channelPct,
    sleeveMarginPct: margins.sleevePct,
    elbowMarginPct: margins.elbowPct,
    marginPct: margins.channelPct,
    channelsPerRow,
    yBayCount,
    tierCount: params.tierCount,
    tierSpacingMm,
    channelRunLengthMm: Math.round(channelRunLength),
    horizontalLines,
    horizontalBreakdownDesc,
    horizontalTotalMm: Math.round(horizontalTotalMm),
    horizontalSegments,
    horizontalStockQty: stockTotalQty,
    verticalLines,
    verticalDropLengthMm,
    verticalTotalMm: Math.round(verticalTotalMm),
    verticalBreakdownDesc,
    totalChannelLengthMm: Math.round(totalChannelLengthMm),
    totalStockPieces,
    sleeveCount,
    sleeveQty,
    tierJoints,
    elbowCount,
    elbowQty,
    elbowsPerChannelJoint: NFT_ELBOWS_PER_TIER_JOINT,
    stockTotalQty,
  };
}

/** Нужны ли муфты (длина линии канала > 2 м) */
export function channelNeedsSleeves(runLengthMm) {
  return runLengthMm > NFT_CHANNEL_STOCK_MM;
}

/** Длины последовательных отрезков 2 м вдоль одной линии */
export function channelSegmentLengthsMm(runLengthMm) {
  const segments = [];
  let remaining = runLengthMm;
  while (remaining > 0) {
    const len = Math.min(NFT_CHANNEL_STOCK_MM, remaining);
    segments.push(len);
    remaining -= len;
  }
  return segments;
}

/** Сторона змейки на переходе между tierIndex и tierIndex + 1 */
export function tierSnakeConnectSide(tierIndex) {
  return tierIndex % 2 === 0 ? 'right' : 'left';
}

/** @deprecated use nftChannelLengthMm */
export function suggestedNftChannelLength(lengthMm, endInsetMm = 0) {
  const margin = Math.max(20, endInsetMm || 20);
  return Math.max(100, lengthMm - 2 * margin);
}

/**
 * Горизонтальные каналы на ярусах + вертикальные перемычки змейкой между ярусами.
 * Чётный ярус: переход справа; нечётный — слева.
 */
export function generateNftChannels({
  rackType,
  channelsEnabled,
  lengthMm,
  depthMm,
  tubeWidthMm,
  tubeHeightMm,
  tierCount,
  zLevels,
  postCountY,
}) {
  if (!channelsEnabled || !supportsNftChannels(rackType) || tierCount < 1) {
    return { runs: [], drops: [], elbows: [] };
  }

  const channelLength = nftChannelLengthMm(lengthMm, tubeWidthMm);
  const channelYs = nftChannelYPositions(depthMm);
  const yBayCount = Math.max(1, postCountY - 1);
  const centerX = lengthMm / 2;
  const halfLen = channelLength / 2;
  const rightX = centerX + halfLen - NFT_CHANNEL_HEIGHT_MM / 2;
  const leftX = centerX - halfLen + NFT_CHANNEL_HEIGHT_MM / 2;
  const gapAboveBeam = tubeHeightMm / 2 + NFT_CHANNEL_HEIGHT_MM / 2 + 4;

  const runs = [];
  const drops = [];
  const elbows = [];

  for (let bay = 0; bay < yBayCount; bay++) {
    const y1 = postYPosition(bay, depthMm, tubeWidthMm);
    const y2 = postYPosition(bay + 1, depthMm, tubeWidthMm);
    const bayY = (y1 + y2) / 2;
    const bayPackOffset = bayY - depthMm / 2;

    for (let tier = 0; tier < tierCount; tier++) {
      for (let ch = 0; ch < channelYs.length; ch++) {
        runs.push({
          tierIndex: tier,
          bayIndex: bay,
          channelIndex: ch,
          x: centerX,
          y: channelYs[ch] + bayPackOffset,
          z: zLevels[tier] + gapAboveBeam,
          length: channelLength,
          width: NFT_CHANNEL_WIDTH_MM,
          height: NFT_CHANNEL_HEIGHT_MM,
          flowDir: tier % 2 === 0 ? 1 : -1,
        });
      }
    }

    for (let tier = 0; tier < tierCount - 1; tier++) {
      const zBottom = zLevels[tier] + gapAboveBeam + NFT_CHANNEL_HEIGHT_MM / 2;
      const zTop = zLevels[tier + 1] + gapAboveBeam - NFT_CHANNEL_HEIGHT_MM / 2;
      const connectOnRight = tier % 2 === 0;
      for (let ch = 0; ch < channelYs.length; ch++) {
        const dropX = connectOnRight ? rightX : leftX;
        const dropY = channelYs[ch] + bayPackOffset;
        drops.push({
          tierIndex: tier,
          bayIndex: bay,
          channelIndex: ch,
          x: dropX,
          y: dropY,
          z: (zBottom + zTop) / 2,
          length: Math.max(20, zTop - zBottom),
          width: NFT_CHANNEL_HEIGHT_MM,
          depth: NFT_CHANNEL_HEIGHT_MM,
          connectSide: connectOnRight ? 'right' : 'left',
        });
        elbows.push({
          tierIndex: tier,
          bayIndex: bay,
          channelIndex: ch,
          x: dropX,
          y: dropY,
          z: zBottom,
          connectSide: connectOnRight ? 'right' : 'left',
          end: 'lower',
        });
        elbows.push({
          tierIndex: tier,
          bayIndex: bay,
          channelIndex: ch,
          x: dropX,
          y: dropY,
          z: zTop,
          connectSide: connectOnRight ? 'right' : 'left',
          end: 'upper',
        });
      }
    }
  }

  return { runs, drops, elbows };
}
