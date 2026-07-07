import {
  canExportFramePdf,
  prepareFramePdfData,
} from './framePdfData.js';
import { loadHardwareRowImages } from './frameCrabImages.js';
import {
  drawFramePdfBrandFooter,
  drawFramePdfBrandHeader,
  FRAME_PDF_BRAND_HEADER_H,
  loadFramePdfLogoDataUrl,
  normalizeFramePdfBranding,
} from './framePdfBranding.js';
import { supportsTrays } from './frameCrabRules.js';
import {
  countNftChannelsAcrossDepth,
  NFT_CHANNEL_HEIGHT_MM,
  NFT_CHANNEL_WIDTH_MM,
  NFT_CHANNEL_STOCK_MM,
  channelNeedsSleeves,
  channelSegmentLengthsMm,
  formatNftQtyWithMargin,
  tierSnakeConnectSide,
  shouldShowNftChannels,
} from './frameNftChannels.js';

export { buildFramePdfFilename, canExportFramePdf, prepareFramePdfData } from './framePdfData.js';
export { normalizeFramePdfBranding } from './framePdfBranding.js';

const PAGE_W = 420;
const PAGE_H = 297;

/** Отступы листа и штампа — без наложения рамок */
const SHEET_INSET = 10;
const SHEET_PAD = 5;
const STAMP_W = 110;
const STAMP_H = 36;
const STAMP_X = PAGE_W - SHEET_INSET - STAMP_W - SHEET_PAD;
const STAMP_Y = PAGE_H - SHEET_INSET - STAMP_H - SHEET_PAD;
const CONTENT_BOTTOM = STAMP_Y - 6;
const RIGHT_COL_X = 218;
const RIGHT_COL_W = STAMP_X + STAMP_W - RIGHT_COL_X;

const COLORS = {
  post: [79, 91, 102],
  longitudinal: [204, 85, 0],
  cross: [102, 102, 102],
  tray: [176, 184, 192],
  trayStroke: [96, 104, 112],
  channel: [78, 196, 235],
  channelStroke: [21, 122, 163],
  channelDrop: [30, 159, 212],
  channelSleeve: [255, 143, 0],
  channelSleeveStroke: [230, 110, 0],
  dim: [0, 0, 0],
  frame: [180, 180, 180],
};

export const CRAB_COLORS = {
  G: [210, 140, 30],
  T: [255, 200, 0],
  X: [50, 130, 210],
  A4: [160, 80, 190],
  A6: [120, 60, 150],
};

export const CRAB_LABELS = {
  G: 'Г',
  T: 'T',
  X: 'X',
  A4: '4',
  A6: '6',
};

/** Ось горизонтальной трубы яруса (от пола) */
export function levelCenterMm(levelIndex, bottomOffsetMm, tierSpacingMm) {
  return bottomOffsetMm + levelIndex * tierSpacingMm;
}

/** Верхняя грань продольной/поперечной трубы яруса (от пола) — для размерных линий */
export function tierTopMm(levelIndex, bottomOffsetMm, tierSpacingMm, tubeHeightMm = 20) {
  return levelCenterMm(levelIndex, bottomOffsetMm, tierSpacingMm) + tubeHeightMm / 2;
}

export function isTopClosingLevelZ(z, geom) {
  const topZ = geom.levels[geom.levels.length - 1];
  return Math.abs(z - topZ) < 0.01;
}

/** Центр трубы на виде спереди/сбоку: верхний замыкающий ярус — верх вровень с верхом стойки */
export function beamElevationCenterZ(beamZ, geom, tubeHeightMm) {
  if (isTopClosingLevelZ(beamZ, geom)) {
    return beamZ - tubeHeightMm / 2;
  }
  return beamZ;
}

const BRAND_Y = FRAME_PDF_BRAND_HEADER_H;

export const PDF_LAYOUT = {
  frontBox: { x: 15, y: 20 + BRAND_Y, w: 185, h: 136 - BRAND_Y },
  sideBox: { x: 208, y: 20 + BRAND_Y, w: 85, h: 136 - BRAND_Y },
  topBox: { x: 15, y: 154 + BRAND_Y, w: STAMP_X - 20, h: CONTENT_BOTTOM - (154 + BRAND_Y) },
  isoBox: { x: 290, y: 20 + BRAND_Y, w: 110, h: 136 - BRAND_Y },
  stampBox: { x: STAMP_X, y: STAMP_Y, w: STAMP_W, h: STAMP_H },
};

/** Рамки отдельной страницы NFT-каналов */
export const PDF_CHANNELS_LAYOUT = {
  frontBox: { x: 15, y: 22 + BRAND_Y, w: 195, h: 124 - BRAND_Y },
  sideBox: { x: RIGHT_COL_X, y: 22 + BRAND_Y, w: RIGHT_COL_W, h: 124 - BRAND_Y },
  topBox: { x: 15, y: 152 + BRAND_Y, w: 195, h: CONTENT_BOTTOM - (152 + BRAND_Y) },
  infoBox: { x: RIGHT_COL_X, y: 152 + BRAND_Y, w: RIGHT_COL_W, h: CONTENT_BOTTOM - (152 + BRAND_Y) },
  stampBox: { x: STAMP_X, y: STAMP_Y, w: STAMP_W, h: STAMP_H },
};

/** @returns {{ scale: number, originX: number, originY: number, drawW: number, drawH: number }} */
export function fitToBox(realW, realH, box, padding = 8) {
  const availW = Math.max(1, box.w - padding * 2);
  const availH = Math.max(1, box.h - padding * 2);
  const scale = Math.min(availW / realW, availH / realH);
  const drawW = realW * scale;
  const drawH = realH * scale;
  const originX = box.x + (box.w - drawW) / 2;
  const originY = box.y + padding + drawH;
  return { scale, originX, originY, drawW, drawH };
}

export function visualTubeWidth(tubeWidthMm, scale, min = 0.8, max = 2.2) {
  return Math.min(max, Math.max(min, tubeWidthMm * scale));
}

/** Тонкие линии труб на виде сверху — не перекрывают крабы и пролёты */
export function topViewVisualTubeWidth(tubeWidthMm, scale) {
  return Math.min(1.05, Math.max(0.35, tubeWidthMm * scale * 0.58));
}

/** Маркеры крабов на плане — масштаб от размера чертежа и плотности сетки */
export function resolveTopViewCrabMarkerOptions(scale, connectorCount = 0, beamCount = 0) {
  let r = Math.min(2.4, Math.max(0.95, scale * 22));
  if (beamCount > 10) r *= 0.82;
  else if (beamCount > 6) r *= 0.9;
  if (connectorCount > 28) r *= 0.88;
  return { radius: r, fitLabel: true, lineWidth: 0.22 };
}

export function shouldDrawPdfTrays(params) {
  return (
    params.showTrays !== false
    && params.trayEnabled
    && supportsTrays(params.rackType)
  );
}

export function shouldDrawPdfChannels(params, geometry) {
  return shouldShowNftChannels(params) && (geometry?.nftChannels?.runs?.length ?? 0) > 0;
}

/** Внешняя длина каркаса (по наружным граням крайних стоек) */
export function frameOuterLengthMm(lengthMm) {
  return lengthMm;
}

/** Внутренняя длина между внутренними гранями крайних стоек */
export function frameInnerLengthMm(lengthMm, tubeWidthMm) {
  return lengthMm - 2 * tubeWidthMm;
}

/** Просвет между внутренними гранями соседних стоек */
export function frameInnerBayMm(spanX) {
  return spanX;
}

export function tubeInnerLeft(center, tubeWidthMm) {
  return center - tubeWidthMm / 2;
}

export function tubeInnerRight(center, tubeWidthMm) {
  return center + tubeWidthMm / 2;
}

/** Сегменты между поперечными балками — только от края трубы до края трубы */
export function edgeBasedCrossBeamSegments(xPositions, lengthMm, tubeWidthMm) {
  if (!xPositions?.length) return [];
  const half = tubeWidthMm / 2;
  const segments = [];

  segments.push({
    x1: 0,
    x2: xPositions[0] - half,
    value: Math.round(xPositions[0] - half),
  });

  for (let i = 1; i < xPositions.length; i++) {
    segments.push({
      x1: xPositions[i - 1] + half,
      x2: xPositions[i] - half,
      value: Math.round(xPositions[i] - xPositions[i - 1] - tubeWidthMm),
    });
  }

  const last = xPositions[xPositions.length - 1];
  segments.push({
    x1: last + half,
    x2: lengthMm,
    value: Math.round(lengthMm - last - half),
  });

  return segments;
}

/** Цепочка подписей для небольшого числа поперечин (≤6) */
function chainItemsForCrossBeamSegments(segments) {
  if (!segments?.length) return [];
  if (segments.length <= 5) {
    return segments.map((seg) => ({ seg, label: String(seg.value) }));
  }

  const interior = segments.slice(1, -1);
  const allInteriorEqual = interior.length > 0 && interior.every((s) => s.value === interior[0].value);

  if (allInteriorEqual && interior.length >= 2) {
    const mid = interior[Math.floor(interior.length / 2)];
    return [
      { seg: segments[0], label: String(segments[0].value) },
      { seg: mid, label: `${interior[0].value} × ${interior.length}` },
      { seg: segments[segments.length - 1], label: String(segments[segments.length - 1].value) },
    ];
  }

  return segments.map((seg) => ({ seg, label: String(seg.value) }));
}

/**
 * План размеров поперечин на виде сверху.
 * ≤6 — на плане; >6 — сжатая цепочка снизу + подпись в легенде.
 */
export function planTopViewCrossBeamDims(xPositions, lengthMm, tubeWidthMm) {
  if (!xPositions?.length) {
    return { mode: 'none', chainItems: [], note: null };
  }

  const beamCount = xPositions.length;
  const segments = edgeBasedCrossBeamSegments(xPositions, lengthMm, tubeWidthMm);

  if (beamCount > 6) {
    const leading = segments[0];
    const interior = segments.slice(1, -1);
    const allEqual = interior.length > 0 && interior.every((s) => s.value === interior[0].value);
    let note;
    if (allEqual) {
      note = `Поперечины: ${beamCount} шт., шаг ${interior[0].value} мм, торец ${leading.value} мм`;
    } else {
      const unique = [...new Set(interior.map((s) => s.value))].sort((a, b) => a - b);
      note = `Поперечины: ${beamCount} шт., шаги ${unique.join(', ')} мм, торец ${leading.value} мм`;
    }
    return {
      mode: 'summary',
      chainItems: chainItemsForCrossBeamSegments(segments),
      note,
    };
  }

  return { mode: 'chain', chainItems: chainItemsForCrossBeamSegments(segments), note: null };
}

/** @deprecated используйте planTopViewCrossBeamDims */
export function summarizeCrossBeamSegmentDims(segments) {
  return chainItemsForCrossBeamSegments(segments);
}

/**
 * Раскладывает подписи по «ярусам», если в PDF они наезжают друг на друга.
 * @param {{ seg: object, label: string }[]} items
 */
export function assignCrossBeamDimRows(items, transform, minLabelMm = 8) {
  const placed = [];

  for (const item of items) {
    const x1 = transform.toX(item.seg.x1);
    const x2 = transform.toX(item.seg.x2);
    const center = (x1 + x2) / 2;
    const labelW = Math.max(minLabelMm, String(item.label).length * 2.1);

    let row = 0;
    while (placed.some((p) => p.row === row && Math.abs(center - p.center) < (labelW + p.labelW) / 2)) {
      row += 1;
    }
    placed.push({ ...item, row, labelW, center });
  }
  return placed;
}

/** Оценка числа ярусов размеров снизу (для отступа рамки вида) */
export function estimateCrossBeamDimRowCount(params, geom) {
  const layout = geom.beamLayouts?.[geom.beamLayouts.length - 1];
  if (!layout?.xPositions?.length) return 1;
  const plan = planTopViewCrossBeamDims(
    layout.xPositions,
    params.lengthMm,
    params.tubeWidthMm,
  );
  if (plan.mode !== 'chain' && plan.mode !== 'summary') return 1;
  if (plan.chainItems.length <= 4) return 1;
  return Math.min(plan.mode === 'summary' ? 3 : 4, Math.ceil(plan.chainItems.length / 3));
}

function createViewTransform(box, contentW, contentH, padding = 10) {
  const fit = fitToBox(contentW, contentH, box, padding);
  return {
    ...fit,
    box,
    toX: (x) => fit.originX + x * fit.scale,
    toY: (y) => fit.originY - y * fit.scale,
  };
}

function clampToBox(box, x, y) {
  return {
    x: Math.max(box.x, Math.min(box.x + box.w, x)),
    y: Math.max(box.y, Math.min(box.y + box.h, y)),
  };
}

/** @returns {boolean} */
export function isRectInsideBox(left, top, right, bottom, box, tolerance = 0.5) {
  return (
    left >= box.x - tolerance
    && right <= box.x + box.w + tolerance
    && top >= box.y - tolerance
    && bottom <= box.y + box.h + tolerance
  );
}

/** @returns {{ left: number, top: number, right: number, bottom: number }} */
export function computeTrayTopViewPdfRect(tray, transform) {
  const left = transform.toX(tray.x - tray.length / 2);
  const right = transform.toX(tray.x + tray.length / 2);
  const top = transform.toY(tray.y + tray.width / 2);
  const bottom = transform.toY(tray.y - tray.width / 2);
  return {
    left: Math.min(left, right),
    right: Math.max(left, right),
    top: Math.min(top, bottom),
    bottom: Math.max(top, bottom),
  };
}

/**
 * @param {import('jspdf').jsPDF} doc
 */
export function drawPdfTube(doc, x1, y1, x2, y2, options = {}) {
  const {
    color = COLORS.post,
    strokeWidth = 1,
    box = null,
  } = options;

  if (box) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    if (maxX < box.x || minX > box.x + box.w || maxY < box.y || minY > box.y + box.h) {
      return;
    }
    const a = clampToBox(box, x1, y1);
    const b = clampToBox(box, x2, y2);
    x1 = a.x;
    y1 = a.y;
    x2 = b.x;
    y2 = b.y;
  }

  doc.setDrawColor(...color);
  doc.setLineWidth(strokeWidth);
  doc.line(x1, y1, x2, y2);
}

function drawPdfTubeH(doc, transform, yModel, x1Model, x2Model, tubeWidthMm, color, box) {
  const sw = visualTubeWidth(tubeWidthMm, transform.scale);
  const y = transform.toY(yModel);
  drawPdfTube(doc, transform.toX(x1Model), y, transform.toX(x2Model), y, {
    color,
    strokeWidth: sw,
    box,
  });
}

function drawPdfTubeV(doc, transform, xModel, y1Model, y2Model, tubeWidthMm, color, box) {
  const sw = visualTubeWidth(tubeWidthMm, transform.scale);
  const x = transform.toX(xModel);
  drawPdfTube(doc, x, transform.toY(y1Model), x, transform.toY(y2Model), {
    color,
    strokeWidth: sw,
    box,
  });
}

function drawViewFrame(doc, box, title) {
  doc.setDrawColor(...COLORS.frame);
  doc.setLineWidth(0.25);
  doc.rect(box.x, box.y, box.w, box.h);
  doc.setFontSize(7);
  doc.setTextColor(40);
  doc.text(title, box.x + 2, box.y + 5);
}

/** Допуск выноса размерных линий за рамку вида (мм PDF) */
const PDF_DIM_OUTSIDE = 16;

/** Координата подписи размера в зоне без стоек (мм модели) */
export function pickDimLabelCoord(from, to, posts, tubeWidthMm, axis = 'x') {
  const minGap = tubeWidthMm * 2.5;
  const span = to - from;
  if (span <= 0) return from;

  const candidates = [];
  const steps = Math.max(4, Math.ceil(span / Math.max(80, tubeWidthMm * 4)));
  for (let i = 1; i < steps; i++) {
    const c = from + (span * i) / steps;
    const blocked = posts.some((p) => {
      const pos = axis === 'x' ? p.x : p.y;
      return Math.abs(pos - c) < minGap;
    });
    if (!blocked) candidates.push(c);
  }

  if (candidates.length > 0) {
    return candidates[Math.floor(candidates.length / 2)];
  }
  return from + span * 0.25;
}

function drawDimHInline(doc, x1, y, x2, label, box, fontSize = 4.2) {
  if (box && (y < box.y - 2 || y > box.y + box.h + 2)) return;
  doc.setDrawColor(...COLORS.dim);
  doc.setLineWidth(0.2);
  doc.line(x1, y, x2, y);
  doc.line(x1, y, x1 + 0.9, y - 0.55);
  doc.line(x1, y, x1 + 0.9, y + 0.55);
  doc.line(x2, y, x2 - 0.9, y - 0.55);
  doc.line(x2, y, x2 - 0.9, y + 0.55);
  doc.setFontSize(fontSize);
  doc.setTextColor(...COLORS.dim);
  doc.text(String(label), (x1 + x2) / 2, y + 1.3, { align: 'center' });
}

function drawDimH(doc, x1, y1, x2, y2, label, offset = 4, box = null, labelOffset = -1.8, labelPdfX = null, fontSize = 5.5) {
  const y = y1 + offset;
  if (box && (y < box.y - PDF_DIM_OUTSIDE || y > box.y + box.h + PDF_DIM_OUTSIDE)) return;
  doc.setDrawColor(...COLORS.dim);
  doc.setLineWidth(fontSize <= 4.6 ? 0.25 : 0.3);
  doc.line(x1, y1, x1, y);
  doc.line(x2, y2, x2, y);
  doc.line(x1, y, x2, y);
  doc.line(x1, y, x1 + 1.2, y - 0.7);
  doc.line(x1, y, x1 + 1.2, y + 0.7);
  doc.line(x2, y, x2 - 1.2, y - 0.7);
  doc.line(x2, y, x2 - 1.2, y + 0.7);
  doc.setFontSize(fontSize);
  doc.setTextColor(...COLORS.dim);
  const lx = labelPdfX ?? (x1 + x2) / 2;
  const labelText = typeof label === 'number' ? String(Math.round(label)) : String(label);
  doc.text(labelText, lx, y + labelOffset, { align: 'center' });
}

function drawDimV(doc, x1, y1, x2, y2, label, offset = 4, box = null, side = 'left', labelGap = 1.2, labelPdfY = null) {
  const x = side === 'right' ? x1 + Math.abs(offset) : x1 - offset;
  if (box && (x < box.x - PDF_DIM_OUTSIDE || x > box.x + box.w + PDF_DIM_OUTSIDE)) return;
  doc.setDrawColor(...COLORS.dim);
  doc.setLineWidth(0.3);
  doc.line(x1, y1, x, y1);
  doc.line(x2, y2, x, y2);
  doc.line(x, y2, x, y1);
  doc.line(x, y1, x - 0.7, y1 - 1.2);
  doc.line(x, y1, x + 0.7, y1 - 1.2);
  doc.line(x, y2, x - 0.7, y2 + 1.2);
  doc.line(x, y2, x + 0.7, y2 + 1.2);
  doc.setFontSize(5.5);
  doc.setTextColor(...COLORS.dim);
  const labelX = side === 'right' ? x + labelGap : x - labelGap;
  const align = side === 'right' ? 'left' : 'right';
  const ly = labelPdfY ?? (y1 + y2) / 2;
  doc.text(String(Math.round(label)), labelX, ly, { align, angle: 90 });
}

const PT_TO_MM = 0.352778;
const CRAB_LABEL_CAP_RATIO = 0.72;
const CRAB_LABEL_WIDTH_RATIO = { G: 0.82, T: 0.55, X: 0.68 };

/** Размер шрифта (pt), чтобы буква помещалась внутри маркера краба */
export function fitCrabMarkerLabelFontSize(r, type = 'T') {
  const pad = 0.32;
  const inner = Math.max(0.15, r * 2 - pad);
  const widthRatio = CRAB_LABEL_WIDTH_RATIO[type] || CRAB_LABEL_WIDTH_RATIO.T;
  const byHeight = inner / (CRAB_LABEL_CAP_RATIO * PT_TO_MM);
  const byWidth = inner / (widthRatio * PT_TO_MM);
  return Math.max(1.8, Math.min(byHeight, byWidth));
}

function drawPdfCrabMarker(doc, px, py, type, box, options = {}) {
  if (px < box.x - 1 || px > box.x + box.w + 1 || py < box.y - 1 || py > box.y + box.h + 1) return;
  const color = CRAB_COLORS[type] || CRAB_COLORS.T;
  const label = CRAB_LABELS[type] || type;
  const variant = options.variant ?? (type === 'G' ? 'square' : 'circle');
  const r = options.radius ?? (variant === 'square' ? 1.6 : 1.4);
  const fontSize = options.fitLabel
    ? fitCrabMarkerLabelFontSize(r, type)
    : (options.fontSize ?? 4.8);
  doc.setFillColor(...color);
  doc.setDrawColor(40);
  doc.setLineWidth(options.lineWidth ?? 0.25);
  if (variant === 'square') {
    doc.rect(px - r, py - r, r * 2, r * 2, 'FD');
  } else {
    doc.circle(px, py, r, 'FD');
  }
  doc.setFontSize(fontSize);
  doc.setTextColor(...COLORS.dim);
  if (options.fitLabel) {
    doc.text(label, px, py, { align: 'center', baseline: 'middle' });
  } else {
    doc.text(label, px, py + r * 0.28, { align: 'center' });
  }
}

/** Зоны вида сверху: чертёж, размеры и легенда внутри одной рамки */
/** Маркеры крабов на изометрии — все коннекторы, крупный размер */
export function resolveIsoCrabMarkerOptions(sw, connectorCount = 0) {
  let r = Math.min(1.3, Math.max(0.56, sw * 0.96));
  if (connectorCount > 48) r *= 0.85;
  else if (connectorCount > 24) r *= 0.92;
  return { radius: r, lineWidth: 0.3 };
}

export function collectCrabLegendTypes(connectors) {
  const types = new Set((connectors || []).map((c) => c.type));
  return ['G', 'T', 'X'].filter((t) => types.has(t));
}

/** Крабы на плане: стойки + T в точках пересечения поперечин с продольными балками */
export function collectTopViewPlanConnectors(geom, topLevel) {
  const topConnectors = (geom.connectors || []).filter(
    (c) => Math.abs(c.z - topLevel) < 0.01,
  );

  const postConnectors = topConnectors.filter((c) => c.axis === 'post');
  const byXY = new Map();

  for (const c of postConnectors) {
    const key = `${Math.round(c.x)}|${Math.round(c.y)}`;
    const list = byXY.get(key) || [];
    list.push(c);
    byXY.set(key, list);
  }

  const postPlan = [...byXY.values()].map((list) => {
    const endCap = list.find((c) => c.endCap);
    if (endCap) return endCap;
    return list[0];
  });

  const crossBeams = (geom.crossBeams || []).filter((b) => Math.abs(b.z - topLevel) < 0.01);
  const junctionPlan = [];
  for (const b of crossBeams) {
    junctionPlan.push({ x: b.x, y: b.y - b.length / 2, z: topLevel, type: 'T', axis: 'cross' });
    if (b.length > 0.01) {
      junctionPlan.push({ x: b.x, y: b.y + b.length / 2, z: topLevel, type: 'T', axis: 'cross' });
    }
  }

  const merged = new Map();
  for (const c of [...postPlan, ...junctionPlan]) {
    const key = `${Math.round(c.x)}|${Math.round(c.y)}`;
    const prev = merged.get(key);
    if (!prev || c.type === 'G') merged.set(key, c);
  }
  return [...merged.values()];
}

/** Отступы под размерные линии вида сверху (мм PDF) */
export function measureTopViewDimMargins(params, geom, dimRowCount = 1) {
  const layout = geom.beamLayouts?.[geom.beamLayouts.length - 1];
  const beamCount = layout?.xPositions?.length || 0;
  const summaryMode = beamCount > 6;
  const depthMm = geom.dimensions?.depthMm ?? params.depthMm;
  const aspect = params.lengthMm / Math.max(1, depthMm);
  let bottom = summaryMode ? 15 : 12;
  if (!summaryMode) {
    bottom += Math.max(0, dimRowCount - 1) * 2;
  } else {
    bottom += Math.max(0, dimRowCount - 1) * 4;
  }
  const right = aspect > 4 ? 12 : 10;
  return { top: 7, bottom, left: 9, right };
}

export function topViewLayoutAreas(box, { hasLegend = true, legendTypes = ['G', 'T'], dimMargins = null, beamNote = null } = {}) {
  const dm = dimMargins || { top: 7, bottom: 10, left: 9, right: 10 };
  const hasFooter = hasLegend || beamNote;
  const legendH = hasFooter ? 6 : 0;
  const titleH = 5;
  return {
    frame: box,
    drawing: {
      x: box.x + dm.left,
      y: box.y + titleH + dm.top,
      w: Math.max(20, box.w - dm.left - dm.right),
      h: Math.max(20, box.h - titleH - dm.top - dm.bottom - legendH),
    },
    legend: {
      x: box.x + 2,
      y: box.y + box.h - legendH,
      w: box.w - 4,
      h: legendH,
    },
    dimMargins: dm,
  };
}

function drawCrabLegend(doc, legendBox, legendTypes) {
  if (!legendBox || legendBox.h <= 0 || !legendTypes?.length) return;
  const labels = {
    G: 'Г — Г образный краб',
    T: 'T — Т образный краб',
    X: 'X — Икс образный краб',
    A4: '4 — угол на 4 стороны',
    A6: '6 — угол на 6 сторон',
  };
  let ly = legendBox.y + legendBox.h - 2;
  doc.setFontSize(4.5);
  legendTypes.forEach((type) => {
    const color = CRAB_COLORS[type];
    doc.setFillColor(...color);
    if (type === 'G') {
      doc.rect(legendBox.x + 2, ly - 0.9, 1.8, 1.8, 'F');
    } else {
      doc.circle(legendBox.x + 3, ly, 0.9, 'F');
    }
    doc.setTextColor(50);
    doc.text(labels[type] || type, legendBox.x + 6, ly + 0.5);
    ly -= 3.5;
  });
}

function drawTopViewFooterStrip(doc, legendBox, legendTypes, beamNote) {
  if (!legendBox || legendBox.h <= 0) return;
  const y = legendBox.y + legendBox.h - 1.5;
  let x = legendBox.x + 2;
  doc.setFontSize(4.2);
  const labels = {
    G: 'Г-краб',
    T: 'T-краб',
    X: 'X-краб',
  };
  (legendTypes || []).forEach((type) => {
    const color = CRAB_COLORS[type];
    doc.setFillColor(...color);
    if (type === 'G') {
      doc.rect(x, y - 1.1, 1.6, 1.6, 'F');
    } else {
      doc.circle(x + 0.8, y - 0.3, 0.8, 'F');
    }
    doc.setTextColor(50);
    doc.text(labels[type] || type, x + 2.4, y + 0.2);
    x += 18;
  });
  if (beamNote) {
    doc.setTextColor(70);
    doc.text(beamNote, legendBox.x + legendBox.w - 2, y + 0.2, { align: 'right', maxWidth: legendBox.w - x - 4 });
  }
}

function renderDepthMm(params, geom) {
  return geom?.dimensions?.depthMm ?? params.depthMm;
}

function drawTopViewDimensions(doc, box, params, geom, transform, beamDimPlan, drawingBox) {
  const { lengthMm, tubeWidthMm } = params;
  const depthMm = renderDepthMm(params, geom);
  const innerLength = frameInnerLengthMm(lengthMm, tubeWidthMm);
  const innerDepth = depthMm - 2 * tubeWidthMm;
  const baseY = transform.toY(0);
  const topY = transform.toY(depthMm);
  const posts = geom.posts ?? [];
  const inlineClip = drawingBox || box;
  let outerDimOffset = 10;

  // На плане: шаг поперечин при ≤6
  if (beamDimPlan?.mode === 'chain' && beamDimPlan.chainItems.length) {
    const planned = assignCrossBeamDimRows(beamDimPlan.chainItems, transform);
    const inlineBaseY = transform.toY(depthMm * 0.38);
    const rowStep = 3.2;
    planned.forEach(({ seg, label, row }) => {
      drawDimHInline(
        doc,
        transform.toX(seg.x1),
        inlineBaseY - row * rowStep,
        transform.toX(seg.x2),
        label,
        inlineClip,
      );
    });
  }

  // Снизу снаружи: сжатая цепочка при >6 поперечинах
  if (beamDimPlan?.mode === 'summary' && beamDimPlan.chainItems.length) {
    const planned = assignCrossBeamDimRows(beamDimPlan.chainItems, transform);
    const chainOffset = 5;
    const rowStep = 4.5;
    let maxRow = 0;
    planned.forEach(({ seg, label, row }) => {
      maxRow = Math.max(maxRow, row);
      const labelMm = pickDimLabelCoord(seg.x1, seg.x2, posts, tubeWidthMm, 'x');
      drawDimH(
        doc,
        transform.toX(seg.x1),
        baseY,
        transform.toX(seg.x2),
        baseY,
        label,
        chainOffset + row * rowStep,
        box,
        1.7,
        transform.toX(labelMm),
        4.5,
      );
    });
    outerDimOffset = chainOffset + (maxRow + 1) * rowStep + 4;
  }

  // Снаружи снизу: общая длина
  drawDimH(
    doc,
    transform.toX(0),
    baseY,
    transform.toX(lengthMm),
    baseY,
    frameOuterLengthMm(lengthMm),
    outerDimOffset,
    box,
    -1.6,
    transform.toX(pickDimLabelCoord(0, lengthMm, posts, tubeWidthMm, 'x')),
  );

  // Сверху: внутренняя длина
  const innerX1 = tubeWidthMm;
  const innerX2 = lengthMm - tubeWidthMm;
  drawDimH(
    doc,
    transform.toX(innerX1),
    topY,
    transform.toX(innerX2),
    topY,
    innerLength,
    -8,
    box,
    -1.8,
    transform.toX(pickDimLabelCoord(innerX1, innerX2, posts, tubeWidthMm, 'x')),
  );

  // Слева: общая глубина
  const depthLabelY = pickDimLabelCoord(0, depthMm, posts, tubeWidthMm, 'y');
  drawDimV(
    doc,
    transform.toX(0),
    transform.toY(0),
    transform.toX(0),
    transform.toY(depthMm),
    depthMm,
    7,
    box,
    'left',
    1.2,
    transform.toY(depthLabelY),
  );

  // Справа: внутренняя глубина
  const innerY1 = tubeWidthMm;
  const innerY2 = depthMm - tubeWidthMm;
  drawDimV(
    doc,
    transform.toX(lengthMm),
    transform.toY(innerY1),
    transform.toX(lengthMm),
    transform.toY(innerY2),
    innerDepth,
    9,
    box,
    'right',
    3,
    transform.toY(pickDimLabelCoord(innerY1, innerY2, posts, tubeWidthMm, 'y')),
  );
}

/** Pure plan for tests — front view uses stroke tubes only, never full-frame fill. */
export function collectFrontViewStrokes(params, geom, box) {
  const { lengthMm, tubeWidthMm } = params;
  const postHeight = geom.postHeight;
  const transform = createViewTransform(box, lengthMm, postHeight, 12);
  const strokes = [];
  const frontY = tubeWidthMm / 2;

  geom.posts
    .filter((p) => Math.abs(p.y - frontY) < 0.01)
    .forEach((p) => {
      strokes.push({
        type: 'stroke',
        role: 'post',
        x1: transform.toX(p.x),
        y1: transform.toY(0),
        x2: transform.toX(p.x),
        y2: transform.toY(postHeight),
      });
    });

  geom.longitudinalBeams
    .filter((b) => Math.abs(b.y - frontY) < 0.01)
    .forEach((b) => {
      strokes.push({
        type: 'stroke',
        role: 'longitudinal',
        x1: transform.toX(b.x - b.length / 2),
        y1: transform.toY(b.z),
        x2: transform.toX(b.x + b.length / 2),
        y2: transform.toY(b.z),
      });
    });

  return strokes;
}

function drawFrontView(doc, box, params, geom) {
  const { lengthMm, tubeWidthMm, tubeHeightMm, bottomOffsetMm, tierSpacingMm, tierCount } = params;
  const postHeight = geom.postHeight;
  const transform = createViewTransform(box, lengthMm, postHeight, 12);
  const frontY = tubeWidthMm / 2;

  collectFrontViewStrokes(params, geom, box).forEach((s) => {
    drawPdfTube(doc, s.x1, s.y1, s.x2, s.y2, {
      color: s.role === 'post' ? COLORS.post : COLORS.longitudinal,
      strokeWidth: visualTubeWidth(tubeWidthMm, transform.scale),
      box,
    });
  });

  if (params.connectionType === 'crab' && params.showConnectors !== false && geom.connectors?.length) {
    geom.connectors
      .filter((c) => Math.abs(c.y - frontY) < tubeWidthMm)
      .forEach((c) => {
        const levelIdx = geom.levels.findIndex((z) => Math.abs(z - c.z) < 0.01);
        const centerY = levelCenterMm(Math.max(0, levelIdx), bottomOffsetMm, tierSpacingMm);
        drawPdfCrabMarker(doc, transform.toX(c.x), transform.toY(centerY), c.type, box);
      });
  }

  const dimY = transform.toY(0);
  const innerLength = frameInnerLengthMm(lengthMm, tubeWidthMm);

  drawDimH(doc, transform.toX(0), dimY, transform.toX(lengthMm), dimY, frameOuterLengthMm(lengthMm), 10, box);

  const frontPosts = geom.posts
    .filter((p) => Math.abs(p.y - frontY) < 0.01)
    .sort((a, b) => a.x - b.x);

  // Для 2 стоек по X (подтопление, рассада) — один размер пролёта, без дубля «внутренней длины»
  if (frontPosts.length >= 2 && geom.spanX > 0) {
    const spanX1 = frontPosts[0].x + tubeWidthMm / 2;
    const spanX2 = frontPosts[frontPosts.length - 1].x - tubeWidthMm / 2;
    drawDimH(
      doc,
      transform.toX(spanX1),
      transform.toY(postHeight * 0.88),
      transform.toX(spanX2),
      transform.toY(postHeight * 0.88),
      params.postCountX > 2 ? innerLength : frameInnerBayMm(geom.spanX),
      -7,
      box,
      -1.8,
      transform.toX(pickDimLabelCoord(spanX1, spanX2, frontPosts, tubeWidthMm, 'x')),
    );
  }

  if (params.postCountX > 2 && frontPosts.length >= 2 && geom.spanX > 0) {
    const bayX1 = frontPosts[0].x + tubeWidthMm / 2;
    const bayX2 = frontPosts[1].x - tubeWidthMm / 2;
    drawDimH(
      doc,
      transform.toX(bayX1),
      transform.toY(postHeight * 0.78),
      transform.toX(bayX2),
      transform.toY(postHeight * 0.78),
      frameInnerBayMm(geom.spanX),
      -7,
      box,
      -1.8,
      transform.toX(pickDimLabelCoord(bayX1, bayX2, frontPosts, tubeWidthMm, 'x')),
    );
  }

  drawDimV(doc, transform.toX(0), transform.toY(0), transform.toX(0), transform.toY(postHeight), postHeight, 10, box, 'left');

  const tierDimOffset = 12;
  const tierLabelGap = 4.5;
  for (let i = 0; i < tierCount; i++) {
    if (i === 0) {
      drawDimV(
        doc,
        transform.toX(lengthMm),
        transform.toY(0),
        transform.toX(lengthMm),
        transform.toY(levelCenterMm(0, bottomOffsetMm, tierSpacingMm)),
        bottomOffsetMm,
        tierDimOffset,
        box,
        'right',
        tierLabelGap,
      );
      continue;
    }
    const yPrev = tierTopMm(i - 1, bottomOffsetMm, tierSpacingMm, tubeHeightMm);
    const yTop = tierTopMm(i, bottomOffsetMm, tierSpacingMm, tubeHeightMm);
    drawDimV(
      doc,
      transform.toX(lengthMm),
      transform.toY(yPrev),
      transform.toX(lengthMm),
      transform.toY(yTop),
      tierSpacingMm,
      tierDimOffset,
      box,
      'right',
      tierLabelGap,
    );
  }

  doc.setFontSize(5);
  doc.setTextColor(80);
  doc.text(`Профиль ${tubeWidthMm}×${tubeHeightMm}`, box.x + 2, box.y + box.h - 2);
}

function drawSideView(doc, box, params, geom) {
  const { tubeWidthMm, tubeHeightMm, bottomOffsetMm, tierSpacingMm, tierCount } = params;
  const depthMm = renderDepthMm(params, geom);
  const postHeight = geom.postHeight;
  const transform = createViewTransform(box, depthMm, postHeight, 12);
  const sideX = tubeWidthMm / 2;

  geom.posts
    .filter((p) => Math.abs(p.x - sideX) < 0.01)
    .forEach((p) => {
      drawPdfTubeV(doc, transform, p.y, 0, postHeight, tubeWidthMm, COLORS.post, box);
    });

  const refX = geom.crossBeams[0]?.x;
  geom.crossBeams
    .filter((b) => refX == null || Math.abs(b.x - refX) < 0.01)
    .forEach((b) => {
      const renderZ = beamElevationCenterZ(b.z, geom, tubeHeightMm);
      drawPdfTubeH(doc, transform, renderZ, b.y - b.length / 2, b.y + b.length / 2, tubeWidthMm, COLORS.cross, box);
    });

  if (shouldDrawPdfTrays(params) && geom.trays?.length) {
    const trayH = Math.min(visualTubeWidth(tubeWidthMm, transform.scale) * 1.5, 2.5);
    geom.trays.forEach((t) => {
      const left = transform.toX(t.y - t.width / 2);
      const right = transform.toX(t.y + t.width / 2);
      const cy = transform.toY(t.z);
      const top = cy - trayH / 2;
      const bottom = cy + trayH / 2;
      if (bottom < box.y || top > box.y + box.h) return;
      doc.setDrawColor(...COLORS.trayStroke);
      doc.setFillColor(...COLORS.tray);
      doc.setLineWidth(0.25);
      const cl = Math.max(box.x, left);
      const cr = Math.min(box.x + box.w, right);
      const ct = Math.max(box.y, top);
      const cb = Math.min(box.y + box.h, bottom);
      if (cr > cl && cb > ct) {
        doc.rect(cl, ct, cr - cl, cb - ct, 'FD');
      }
    });
  }

  drawDimH(doc, transform.toX(0), transform.toY(0), transform.toX(depthMm), transform.toY(0), depthMm, 8, box);
  drawDimV(doc, transform.toX(0), transform.toY(0), transform.toX(0), transform.toY(postHeight), postHeight, 8, box, 'left');

  const tierDimOffset = 12;
  const tierLabelGap = 4.5;
  for (let i = 0; i < tierCount; i++) {
    if (i === 0) {
      drawDimV(
        doc,
        transform.toX(depthMm),
        transform.toY(0),
        transform.toX(depthMm),
        transform.toY(levelCenterMm(0, bottomOffsetMm, tierSpacingMm)),
        bottomOffsetMm,
        tierDimOffset,
        box,
        'right',
        tierLabelGap,
      );
      continue;
    }
    const yPrev = tierTopMm(i - 1, bottomOffsetMm, tierSpacingMm, tubeHeightMm);
    const yTop = tierTopMm(i, bottomOffsetMm, tierSpacingMm, tubeHeightMm);
    drawDimV(
      doc,
      transform.toX(depthMm),
      transform.toY(yPrev),
      transform.toX(depthMm),
      transform.toY(yTop),
      tierSpacingMm,
      tierDimOffset,
      box,
      'right',
      tierLabelGap,
    );
  }

  if (geom.crossBeamLength > 0) {
    const midY = transform.toY(postHeight * 0.45);
    drawDimH(
      doc,
      transform.toX(tubeWidthMm),
      midY,
      transform.toX(depthMm - tubeWidthMm),
      midY,
      geom.crossBeamLength,
      -6,
      box,
    );
  }
}

function drawTopView(doc, box, params, geom) {
  const { lengthMm, tubeWidthMm } = params;
  const depthMm = renderDepthMm(params, geom);
  const topLevel = geom.levels[geom.levels.length - 1];
  const showCrabs = params.connectionType === 'crab' && params.showConnectors !== false;
  const planConnectors = showCrabs ? collectTopViewPlanConnectors(geom, topLevel) : [];
  const topGConnectors = showCrabs
    ? (geom.connectors || []).filter((c) => c.type === 'G' && Math.abs(c.z - topLevel) < 0.01)
    : [];
  const legendTypes = showCrabs
    ? collectCrabLegendTypes([...planConnectors, ...topGConnectors])
    : [];
  const layout = geom.beamLayouts?.[geom.beamLayouts.length - 1];
  const beamDimPlan = layout?.xPositions?.length
    ? planTopViewCrossBeamDims(layout.xPositions, lengthMm, tubeWidthMm)
    : { mode: 'none', chainItems: [], note: null };
  const dimRowCount = estimateCrossBeamDimRowCount(params, geom);
  const dimMargins = measureTopViewDimMargins(params, geom, dimRowCount);
  const areas = topViewLayoutAreas(box, {
    hasLegend: legendTypes.length > 0,
    legendTypes,
    dimMargins,
    beamNote: beamDimPlan.note,
  });
  const beamCount = layout?.xPositions?.length || 0;
  const transform = createViewTransform(areas.drawing, lengthMm, depthMm, 2);
  const vw = topViewVisualTubeWidth(tubeWidthMm, transform.scale);
  const crabMarkerOpts = resolveTopViewCrabMarkerOptions(
    transform.scale,
    planConnectors.length,
    beamCount,
  );
  const drawBox = areas.drawing;

  // 1. Поддон — только контур, под балками
  if (shouldDrawPdfTrays(params) && geom.trays?.length) {
    geom.trays.forEach((t) => {
      const rect = computeTrayTopViewPdfRect(t, transform);
      const cl = Math.max(box.x, rect.left);
      const cr = Math.min(box.x + box.w, rect.right);
      const ct = Math.max(box.y, rect.top);
      const cb = Math.min(box.y + box.h, rect.bottom);
      if (cr > cl && cb > ct) {
        doc.setDrawColor(...COLORS.trayStroke);
        doc.setLineWidth(0.35);
        doc.rect(cl, ct, cr - cl, cb - ct, 'S');
      }
    });
  }

  // 2. Балки и стойки поверх поддона
  geom.longitudinalBeams
    .filter((b) => Math.abs(b.z - topLevel) < 0.01)
    .forEach((b) => {
      drawPdfTubeH(doc, transform, b.y, b.x - b.length / 2, b.x + b.length / 2, tubeWidthMm, COLORS.longitudinal, drawBox);
    });

  geom.crossBeams
    .filter((b) => Math.abs(b.z - topLevel) < 0.01)
    .forEach((b) => {
      const x = transform.toX(b.x);
      drawPdfTube(doc, x, transform.toY(b.y - b.length / 2), x, transform.toY(b.y + b.length / 2), {
        color: COLORS.cross,
        strokeWidth: vw,
        box: drawBox,
      });
    });

  const gPostKeys = new Set(
    topGConnectors.map((c) => `${Math.round(c.x)}|${Math.round(c.y)}`),
  );

  geom.posts.forEach((p) => {
    const cx = transform.toX(p.x);
    const cy = transform.toY(p.y);
    const isGCorner = gPostKeys.has(`${Math.round(p.x)}|${Math.round(p.y)}`);
    if (isGCorner) {
      const gr = Math.min(crabMarkerOpts.radius, vw * 1.1);
      doc.setFillColor(...CRAB_COLORS.G);
      doc.setDrawColor(40);
      doc.setLineWidth(0.25);
      doc.rect(cx - gr, cy - gr, gr * 2, gr * 2, 'FD');
      doc.setFontSize(fitCrabMarkerLabelFontSize(gr, 'G'));
      doc.setTextColor(...COLORS.dim);
      doc.text('Г', cx, cy, { align: 'center', baseline: 'middle' });
    } else {
      doc.setDrawColor(...COLORS.post);
      doc.setLineWidth(0.3);
      doc.rect(cx - vw / 2, cy - vw / 2, vw, vw, 'S');
    }
  });

  if (planConnectors.length) {
    planConnectors
      .filter((c) => c.type !== 'G')
      .forEach((c) => {
        drawPdfCrabMarker(doc, transform.toX(c.x), transform.toY(c.y), c.type, drawBox, crabMarkerOpts);
      });
  }
  drawTopViewFooterStrip(doc, areas.legend, legendTypes, beamDimPlan.note);

  // 4. Размеры
  drawTopViewDimensions(doc, areas.frame, params, geom, transform, beamDimPlan, drawBox);
}

function isoProject(x, y, z, cx, cy, scale) {
  const sx = (x - z) * 0.866 * scale;
  const sy = (-y + (x + z) * 0.5) * scale;
  return [cx + sx, cy + sy];
}

function drawIsoWireframe(doc, box, params, geom) {
  const { lengthMm, tubeWidthMm } = params;
  const depthMm = renderDepthMm(params, geom);
  const postHeight = geom.postHeight;
  const projW = lengthMm + depthMm;
  const projH = postHeight + (lengthMm + depthMm) * 0.5;
  const fit = fitToBox(projW, projH, box, 6);
  const scale = fit.scale;
  const cx = fit.originX + fit.drawW / 2;
  const cy = fit.originY - fit.drawH / 2;
  const ox = lengthMm / 2;
  const oy = postHeight / 2;
  const oz = depthMm / 2;
  const sw = visualTubeWidth(tubeWidthMm, scale);
  const boxClip = box;

  const isoLine = (x1, y1, z1, x2, y2, z2, color, lineW = sw) => {
    const a = isoProject(x1 - ox, y1 - oy, z1 - oz, cx, cy, scale);
    const b = isoProject(x2 - ox, y2 - oy, z2 - oz, cx, cy, scale);
    drawPdfTube(doc, a[0], a[1], b[0], b[1], { color, strokeWidth: lineW, box: boxClip });
  };

  geom.posts.forEach((p) => {
    isoLine(p.x, 0, p.y, p.x, postHeight, p.y, COLORS.post);
  });

  geom.longitudinalBeams.forEach((b) => {
    isoLine(b.x - b.length / 2, b.z, b.y, b.x + b.length / 2, b.z, b.y, COLORS.longitudinal);
  });

  geom.crossBeams.forEach((b) => {
    isoLine(b.x, b.z, b.y - b.length / 2, b.x, b.z, b.y + b.length / 2, COLORS.cross);
  });

  if (params.connectionType === 'crab' && params.showConnectors !== false && geom.connectors?.length) {
    const isoConnectors = geom.connectors;
    const legendTypes = collectCrabLegendTypes(isoConnectors);
    const isoCrab = resolveIsoCrabMarkerOptions(sw, isoConnectors.length);

    isoConnectors.forEach((c) => {
      const pt = isoProject(c.x - ox, c.z - oy, c.y - oz, cx, cy, scale);
      const markerR = c.type === 'G' ? isoCrab.radius * 1.05 : isoCrab.radius;
      drawPdfCrabMarker(doc, pt[0], pt[1], c.type, boxClip, {
        variant: c.type === 'G' ? 'square' : 'circle',
        radius: markerR,
        lineWidth: isoCrab.lineWidth,
        fitLabel: true,
      });
    });

    if (isoConnectors.length) {
      const legendH = Math.max(13, legendTypes.length * 3.5 + 4);
      drawCrabLegend(doc, { x: box.x, y: box.y + box.h - legendH, w: box.w, h: legendH }, legendTypes);
    }
  }

  if (shouldDrawPdfTrays(params) && geom.trays?.length) {
    geom.trays.forEach((t) => {
      const corners = [
        [t.x - t.length / 2, t.z, t.y - t.width / 2],
        [t.x + t.length / 2, t.z, t.y - t.width / 2],
        [t.x + t.length / 2, t.z, t.y + t.width / 2],
        [t.x - t.length / 2, t.z, t.y + t.width / 2],
      ].map(([x, y, z]) => isoProject(x - ox, y - oy, z - oz, cx, cy, scale));
      doc.setDrawColor(...COLORS.trayStroke);
      doc.setLineWidth(0.25);
      for (let i = 0; i < 4; i++) {
        const n = (i + 1) % 4;
        drawPdfTube(doc, corners[i][0], corners[i][1], corners[n][0], corners[n][1], {
          color: COLORS.tray,
          strokeWidth: 0.35,
          box: boxClip,
        });
      }
    });
  }
}

function drawIsoView(doc, box, params, geom, isoImageDataUrl, preferVector = true) {
  if (!preferVector && isoImageDataUrl) {
    try {
      doc.addImage(isoImageDataUrl, 'PNG', box.x + 2, box.y + 8, box.w - 4, box.h - 12);
      return;
    } catch {
      /* fallback */
    }
  }
  drawIsoWireframe(doc, box, params, geom);
}

function clampPdfRect(box, left, top, width, height) {
  const cl = Math.max(box.x, left);
  const cr = Math.min(box.x + box.w, left + width);
  const ct = Math.max(box.y, top);
  const cb = Math.min(box.y + box.h, top + height);
  if (cr <= cl || cb <= ct) return null;
  return { left: cl, top: ct, w: cr - cl, h: cb - ct };
}

function drawPdfChannelFill(doc, box, left, top, width, height) {
  const rect = clampPdfRect(box, left, top, width, height);
  if (!rect) return;
  doc.setDrawColor(...COLORS.channelStroke);
  doc.setFillColor(...COLORS.channel);
  doc.setLineWidth(0.3);
  doc.rect(rect.left, rect.top, rect.w, rect.h, 'FD');
}

function drawPdfChannelDropFill(doc, box, left, top, width, height) {
  const rect = clampPdfRect(box, left, top, width, height);
  if (!rect) return;
  doc.setDrawColor(...COLORS.channelStroke);
  doc.setFillColor(...COLORS.channelDrop);
  doc.setLineWidth(0.35);
  doc.rect(rect.left, rect.top, rect.w, rect.h, 'FD');
}

function drawPdfChannelSleeveFill(doc, box, left, top, width, height) {
  const rect = clampPdfRect(box, left, top, width, height);
  if (!rect) return;
  doc.setDrawColor(...COLORS.channelSleeveStroke);
  doc.setFillColor(...COLORS.channelSleeve);
  doc.setLineWidth(0.3);
  doc.rect(rect.left, rect.top, rect.w, rect.h, 'FD');
}

function drawPdfChannelElbowTop(doc, box, cx, cy, channelW, side, withOuterRect) {
  const sq = Math.max(channelW, 0.85);
  const half = sq / 2;
  const rectLen = sq * 0.5;
  doc.setDrawColor(...COLORS.channelStroke);
  doc.setFillColor(...COLORS.channelDrop);
  doc.setLineWidth(0.3);
  const square = clampPdfRect(box, cx - half, cy - half, sq, sq);
  if (square) doc.rect(square.left, square.top, square.w, square.h, 'FD');
  if (!withOuterRect) return;
  const rectTop = cy - channelW / 2;
  if (side === 'left') {
    const outer = clampPdfRect(box, cx - half - rectLen, rectTop, rectLen, channelW);
    if (outer) doc.rect(outer.left, outer.top, outer.w, outer.h, 'FD');
  } else {
    const outer = clampPdfRect(box, cx + half, rectTop, rectLen, channelW);
    if (outer) doc.rect(outer.left, outer.top, outer.w, outer.h, 'FD');
  }
}

/** Вид сверху: со стороны змейки — квадрат + прямоугольник, с другой — только квадрат */
function drawPdfElbowsBothEndsTop(doc, box, transform, run, crossMm, thickness) {
  const startX = run.x - run.length / 2;
  const endX = run.x + run.length / 2;
  const cy = transform.toY(crossMm);
  const snakeSide = run.tierIndex > 0 ? tierSnakeConnectSide(run.tierIndex - 1) : null;
  drawPdfChannelElbowTop(doc, box, transform.toX(startX), cy, thickness, 'left', snakeSide === 'left');
  drawPdfChannelElbowTop(doc, box, transform.toX(endX), cy, thickness, 'right', snakeSide === 'right');
}

/** Вид спереди: Г внутри угла канала (не выходит за контур, линия ровная) */
function drawPdfChannelElbowFrontG(doc, box, cornerX, cy, channelH, side) {
  const h = Math.max(channelH, 0.85);
  const arm = h * 0.46;
  doc.setDrawColor(...COLORS.channelStroke);
  doc.setFillColor(...COLORS.channelDrop);
  doc.setLineWidth(0.25);
  if (side === 'left') {
    const vertical = clampPdfRect(box, cornerX, cy - h / 2, arm, h);
    const horizontal = clampPdfRect(box, cornerX, cy + h / 2 - arm, h, arm);
    if (vertical) doc.rect(vertical.left, vertical.top, vertical.w, vertical.h, 'FD');
    if (horizontal) doc.rect(horizontal.left, horizontal.top, horizontal.w, horizontal.h, 'FD');
  } else {
    const vertical = clampPdfRect(box, cornerX - arm, cy - h / 2, arm, h);
    const horizontal = clampPdfRect(box, cornerX - h, cy + h / 2 - arm, h, arm);
    if (vertical) doc.rect(vertical.left, vertical.top, vertical.w, vertical.h, 'FD');
    if (horizontal) doc.rect(horizontal.left, horizontal.top, horizontal.w, horizontal.h, 'FD');
  }
}

function drawPdfElbowsBothEndsFront(doc, box, transform, run, crossMm, thickness) {
  const startX = run.x - run.length / 2;
  const endX = run.x + run.length / 2;
  const cy = transform.toY(crossMm);
  drawPdfChannelElbowFrontG(doc, box, transform.toX(startX), cy, thickness, 'left');
  drawPdfChannelElbowFrontG(doc, box, transform.toX(endX), cy, thickness, 'right');
}

/** Горизонтальный канал вдоль X: сегменты 2 м + муфта (чуть уже колена) */
function drawPdfChannelHorizontalRun(doc, box, transform, run, crossMm, thickness) {
  const startMm = run.x - run.length / 2;
  const segments = channelSegmentLengthsMm(run.length);
  const cy = transform.toY(crossMm);
  const elbowSize = Math.max(thickness * 0.92, 0.85);
  const sleeveAlong = Math.max(0.65, elbowSize * 0.82);
  let offsetMm = 0;

  segments.forEach((segLen, idx) => {
    const left = transform.toX(startMm + offsetMm);
    const width = segLen * transform.scale;
    drawPdfChannelFill(doc, box, left, cy - thickness / 2, width, thickness);
    offsetMm += segLen;

    if (idx < segments.length - 1 && channelNeedsSleeves(run.length)) {
      const jx = transform.toX(startMm + offsetMm);
      drawPdfChannelSleeveFill(
        doc,
        box,
        jx - sleeveAlong / 2,
        cy - thickness / 2,
        sleeveAlong,
        thickness,
      );
    }
  });
}

/** Вид спереди: змейка — все ярусы, сегменты, муфты, колена с двух сторон, вертикальные переходы */
function drawChannelsFrontView(doc, box, params, geom) {
  const nft = geom.nftChannels;
  if (!nft?.runs?.length) return;

  const postHeight = geom.postHeight;
  const transform = createViewTransform(box, params.lengthMm, postHeight, 12);
  const minH = Math.max(0.9, NFT_CHANNEL_HEIGHT_MM * transform.scale * 0.88);

  const tierRuns = new Map();
  nft.runs.forEach((run) => {
    if (!tierRuns.has(run.tierIndex)) tierRuns.set(run.tierIndex, run);
  });

  tierRuns.forEach((run) => {
    drawPdfChannelHorizontalRun(doc, box, transform, run, run.z, minH);
    drawPdfElbowsBothEndsFront(doc, box, transform, run, run.z, minH);
  });

  nft.drops.forEach((drop) => {
    const cx = transform.toX(drop.x);
    const yTop = transform.toY(drop.z + drop.length / 2);
    const yBottom = transform.toY(drop.z - drop.length / 2);
    const w = Math.max(0.75, minH * 0.92);
    drawPdfChannelFill(doc, box, cx - w / 2, yTop, w, yBottom - yTop);
  });
}

/** Вид сбоку: каналы одного размера + межярусные соединители (как горизонтальные) */
function drawChannelsSideView(doc, box, params, geom) {
  const nft = geom.nftChannels;
  if (!nft?.runs?.length) return;

  const depthMm = renderDepthMm(params, geom);
  const postHeight = geom.postHeight;
  const transform = createViewTransform(box, depthMm, postHeight, 12);
  const channelW = Math.max(0.95, NFT_CHANNEL_WIDTH_MM * transform.scale * 1.08);
  const channelH = Math.max(0.85, NFT_CHANNEL_HEIGHT_MM * transform.scale * 1.05);

  nft.drops.forEach((drop) => {
    const cx = transform.toX(drop.y);
    const yTop = transform.toY(drop.z + drop.length / 2);
    const yBottom = transform.toY(drop.z - drop.length / 2);
    drawPdfChannelFill(doc, box, cx - channelW / 2, yTop, channelW, yBottom - yTop);
  });

  nft.runs.forEach((run) => {
    const cx = transform.toX(run.y);
    const cy = transform.toY(run.z);
    drawPdfChannelFill(doc, box, cx - channelW / 2, cy - channelH / 2, channelW, channelH);
  });
}

/** Вид сверху: сегменты, муфты на ширину канала, колена с двух сторон */
function drawChannelsTopView(doc, box, params, geom) {
  const nft = geom.nftChannels;
  if (!nft?.runs?.length) return;

  const depthMm = renderDepthMm(params, geom);
  const topTier = Math.max(0, params.tierCount - 1);
  const runs = nft.runs.filter((r) => r.tierIndex === topTier);
  const transform = createViewTransform(box, params.lengthMm, depthMm, 10);
  const minW = Math.max(0.68, NFT_CHANNEL_WIDTH_MM * transform.scale * 0.95);

  runs.forEach((run) => {
    drawPdfChannelHorizontalRun(doc, box, transform, run, run.y, minW);
    drawPdfElbowsBothEndsTop(doc, box, transform, run, run.y, minW);
  });

  doc.setFontSize(5);
  doc.setTextColor(80);
  doc.text('Верхний ярус', box.x + 2, box.y + box.h - 2);
}

function drawChannelsInfoBlock(doc, box, pdfData) {
  const summary = pdfData.channelsSummary;
  if (!summary) return;

  doc.setDrawColor(...COLORS.frame);
  doc.setLineWidth(0.25);
  doc.rect(box.x, box.y, box.w, box.h);

  let y = box.y + 7;
  doc.setFontSize(8);
  doc.setTextColor(20);
  doc.setFont(undefined, 'bold');
  doc.text('NFT-каналы', box.x + 4, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  doc.setFontSize(7);
  const s = summary;
  const lines = [
    `Профиль: ${NFT_CHANNEL_WIDTH_MM} × ${NFT_CHANNEL_HEIGHT_MM} мм (ширина × высота)`,
    `Длина канала: ${s.channelRunLengthMm ?? '—'} мм (как стеллаж)`,
    `Каналов в ряд: ${s.perRow ?? s.channelsPerRow} × ${NFT_CHANNEL_WIDTH_MM} мм`,
    `Ярусов с каналами: ${s.tierCount}`,
    `Горизонтальных участков: ${s.horizontalLines ?? s.totalRuns}${s.horizontalBreakdownDesc ? ` (${s.horizontalBreakdownDesc})` : ''}`,
    `Вертикальных участков: ${s.verticalLines ?? 0}${s.verticalBreakdownDesc ? ` (${s.verticalBreakdownDesc})` : ''}`,
    `Итого заготовок 2 м: ${formatNftQtyWithMargin(s.stockTotalQty ?? 0, s.totalStockPieces ?? 0, s.channelMarginPct ?? 8)}`,
    `Колена: ${formatNftQtyWithMargin(s.elbowQty ?? 0, s.elbowCount ?? 0, s.elbowMarginPct ?? 8)}`,
    `Муфты: ${formatNftQtyWithMargin(s.sleeveQty ?? 0, s.sleeveCount ?? 0, s.sleeveMarginPct ?? 8)}`,
    `Соединение змейкой: чётный ярус → справа, нечётный → слева`,
  ];
  lines.forEach((line) => {
    doc.text(line, box.x + 4, y, { maxWidth: box.w - 8 });
    y += 3.8;
  });

  y += 1;
  doc.setFillColor(...COLORS.channel);
  doc.rect(box.x + 4, y - 2.5, 3, 2, 'F');
  doc.text('— горизонтальный канал', box.x + 9, y);
  y += 4;
  doc.setFillColor(...COLORS.channelDrop);
  doc.rect(box.x + 4, y - 2.5, 3, 2, 'F');
  doc.text('— колено', box.x + 9, y);

  const needsSleeves = channelNeedsSleeves(summary.channelRunLengthMm ?? 0)
    || (summary.sleeveCount ?? 0) > 0;
  if (needsSleeves && y + 4 <= box.y + box.h - 2) {
    y += 4;
    doc.setFillColor(...COLORS.channelSleeve);
    doc.rect(box.x + 4, y - 2.5, 3, 2, 'F');
    doc.text('— муфта соединительная', box.x + 9, y);
  }
}

function drawChannelsPage(doc, pdfData, branding, logoDataUrl, dateStr, pageNo, totalPages) {
  drawPageChrome(doc, branding, logoDataUrl, 'NFT-каналы — схема прокладки', pageNo, totalPages);

  const { config, geometry } = pdfData;
  const { frontBox, sideBox, topBox, infoBox, stampBox } = PDF_CHANNELS_LAYOUT;

  drawViewFrame(doc, frontBox, 'Вид спереди');
  drawViewFrame(doc, sideBox, 'Вид сбоку');
  drawViewFrame(doc, topBox, 'Вид сверху (верхний ярус)');
  drawChannelsInfoBlock(doc, infoBox, pdfData);

  drawChannelsFrontView(doc, frontBox, config, geometry);
  drawChannelsSideView(doc, sideBox, config, geometry);
  drawChannelsTopView(doc, topBox, config, geometry);

  drawStamp(doc, pdfData.stamp, stampBox, pageNo, totalPages, dateStr);
}

function drawSheetBorder(doc) {
  doc.setDrawColor(0);
  doc.setLineWidth(0.35);
  doc.rect(10, 10, PAGE_W - 20, PAGE_H - 20);
}

function drawPageChrome(doc, branding, logoDataUrl, pageTitle, pageNo, totalPages) {
  drawSheetBorder(doc);
  drawFramePdfBrandHeader(doc, branding, logoDataUrl, pageTitle, PAGE_W);
  drawFramePdfBrandFooter(doc, branding, pageNo, totalPages, PAGE_W, PAGE_H);
}

function drawStamp(doc, stamp, stampBox, pageNo, totalPages, dateStr) {
  const { x, y, w, h } = stampBox;
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  doc.rect(x, y, w, h);

  const rows = [
    [stamp.company || 'Daogreen', ''],
    [stamp.title, ''],
    ['Тип', stamp.rackType],
    ['Габариты', stamp.size],
    ['Ярусы', `${stamp.tiers} / ${stamp.tierSpacing} мм`],
    ['Профиль', stamp.profile],
    ['Соед.', stamp.connection],
    [`Лист ${pageNo}/${totalPages}`, dateStr],
  ];

  let rowY = y + 4;
  doc.setFontSize(5.5);
  rows.forEach(([label, value], idx) => {
    if (idx === 0 || idx === 1) {
      doc.setFont(undefined, 'bold');
      doc.setFontSize(idx === 0 ? 5.5 : 6);
      doc.text(label, x + 2, rowY);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(5.5);
      rowY += 4;
      return;
    }

    if (idx === rows.length - 1) {
      doc.setTextColor(60);
      doc.text(label, x + 2, rowY);
      doc.setTextColor(0);
      doc.text(String(value), x + w - 2, rowY, { align: 'right' });
      return;
    }

    doc.setTextColor(60);
    doc.text(`${label}:`, x + 2, rowY);
    doc.setTextColor(0);
    const val = String(value).length > 22 ? `${String(value).slice(0, 20)}…` : value;
    doc.text(val, x + 24, rowY);
    rowY += 3.5;
  });
}

function drawAssemblyPage(doc, pdfData, branding, logoDataUrl, isoImageDataUrl, dateStr, pageNo, totalPages) {
  drawPageChrome(doc, branding, logoDataUrl, 'Сборочный чертёж', pageNo, totalPages);
  doc.setTextColor(0);

  const { config, geometry } = pdfData;
  const params = { ...config, showDimensions: true, showConnectors: true, showTrays: true };
  const { frontBox, sideBox, topBox, isoBox, stampBox } = PDF_LAYOUT;

  drawViewFrame(doc, frontBox, 'Вид спереди');
  drawViewFrame(doc, sideBox, 'Вид сбоку');
  drawViewFrame(doc, topBox, 'Вид сверху');
  drawViewFrame(doc, isoBox, 'Изометрия');

  drawFrontView(doc, frontBox, params, geometry);
  drawSideView(doc, sideBox, params, geometry);
  drawTopView(doc, topBox, params, geometry);
  drawIsoView(doc, isoBox, params, geometry, isoImageDataUrl, true);

  drawStamp(doc, pdfData.stamp, stampBox, pageNo, totalPages, dateStr);
}

function imageFormatFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return 'PNG';
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return 'PNG';
}

function drawHardwareTable(doc, hardwareRows, startY, leftMargin, rightCol, autoTable, tableStyles) {
  const imgSize = 16;
  const rowPad = 2;
  const minRowH = imgSize + rowPad * 2;

  autoTable(doc, {
    startY,
    margin: { left: leftMargin, right: rightCol },
    head: [['Фото', 'Позиция', 'Кол-во', 'Примечание']],
    body: hardwareRows.map((r) => ['', r.name, r.qty, r.note]),
    styles: { fontSize: 7, cellPadding: 1.8, minCellHeight: minRowH, ...tableStyles.body },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, ...tableStyles.head },
    columnStyles: {
      0: { cellWidth: imgSize + 4, halign: 'center', valign: 'middle' },
      2: { halign: 'right' },
    },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 0) return;
      const row = hardwareRows[data.row.index];
      if (!row?.imageDataUrl) return;
      const fmt = imageFormatFromDataUrl(row.imageDataUrl);
      const x = data.cell.x + (data.cell.width - imgSize) / 2;
      const y = data.cell.y + (data.cell.height - imgSize) / 2;
      doc.addImage(row.imageDataUrl, fmt, x, y, imgSize, imgSize);
    },
    theme: 'grid',
  });
  return doc.lastAutoTable.finalY + 8;
}

function drawSpecPage(doc, pdfData, branding, logoDataUrl, dateStr, autoTable, tableStyles, pageNo, totalPages) {
  drawPageChrome(doc, branding, logoDataUrl, 'Спецификация реза и крепежа', pageNo, totalPages);

  const leftMargin = 18;
  const rightCol = PAGE_W / 2 + 6;
  const rightMargin = 18;
  const tableStartY = 32;

  const cutBody = pdfData.cutTableRows.map((row) => [
    row.no,
    row.name,
    row.profile,
    row.length,
    row.qty,
    row.cut,
    row.note,
  ]);

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: leftMargin, right: rightCol },
    head: [['№', 'Позиция', 'Профиль', 'Длина, мм', 'Кол-во, шт', 'Рез', 'Примечание']],
    body: cutBody,
    styles: { fontSize: 7, cellPadding: 1.8, ...tableStyles.body },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, ...tableStyles.head },
    theme: 'grid',
  });

  let y = doc.lastAutoTable.finalY + 8;

  if (pdfData.tubeStock?.options) {
    const { recommended, options } = pdfData.tubeStock;
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.setFont('Roboto', 'bold');
    doc.text(`Закупка профильной трубы ${pdfData.dimensions.profile}`, leftMargin, y);
    doc.setFont('Roboto', 'normal');
    y += 5;

    doc.setFontSize(8);
    doc.setTextColor(80);
    doc.text(`Самый экономичный по отходу: ${recommended.title}`, leftMargin, y);
    doc.setTextColor(0);
    y += 6;

    for (const opt of options) {
      if (y > PAGE_H - 40) {
        doc.addPage('a3', 'landscape');
        y = 20;
      }
      
      doc.setFont('Roboto', 'bold');
      if (opt.key === 'only_6000') {
        doc.text(`Если есть труба 6 м:`, leftMargin, y);
      } else if (opt.key === 'only_3000') {
        doc.text(`Если есть только труба 3 м:`, leftMargin, y);
      } else {
        doc.text(`Смешанный вариант:`, leftMargin, y);
      }
      doc.setFont('Roboto', 'normal');
      y += 4;
      
      if (opt.stockCounts[6000] > 0) doc.text(`6 м — ${opt.stockCounts[6000]} шт`, leftMargin + 2, y), y += 4;
      if (opt.stockCounts[3000] > 0) doc.text(`3 м — ${opt.stockCounts[3000]} шт`, leftMargin + 2, y), y += 4;
      
      doc.text(`Закупить — ${(opt.totalStockLengthMm / 1000).toFixed(1)} м`, leftMargin + 2, y);
      y += 4;
      doc.text(`Остаток — ${(opt.wasteMm / 1000).toFixed(1)} м`, leftMargin + 2, y);
      y += 4;
      
      if (opt.warnings && opt.warnings.length > 0) {
        doc.setTextColor(200, 0, 0);
        for (const w of opt.warnings) {
          const splitWarning = doc.splitTextToSize(`Предупреждение: ${w}`, rightCol - leftMargin - 10);
          doc.text(splitWarning, leftMargin + 2, y);
          y += 4 * splitWarning.length;
        }
        doc.setTextColor(0);
      }
      y += 2;
    }
    
    y += 4;
  }

  if (pdfData.hardwareRows.length > 0) {
    doc.setFontSize(9);
    doc.text('Крепёж', leftMargin, y);
    y += 5;
    y = drawHardwareTable(doc, pdfData.hardwareRows, y, leftMargin, rightCol, autoTable, tableStyles);
  } else if (pdfData.weldedNote) {
    doc.setFontSize(8);
    doc.setTextColor(80);
    doc.text(pdfData.weldedNote, leftMargin, y);
    y += 8;
  }

  if (pdfData.channelTableRows?.length > 0) {
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.text('NFT-каналы (заготовки 2 м, с запасом)', leftMargin, y);
    y += 5;
    autoTable(doc, {
      startY: y,
      margin: { left: leftMargin, right: rightCol },
      head: [['№', 'Позиция', 'Профиль', 'Длина, мм', 'Кол-во, шт', 'Примечание']],
      body: pdfData.channelTableRows.map((row) => [
        row.no,
        row.name,
        row.profile,
        row.length,
        row.qty,
        row.note,
      ]),
      styles: { fontSize: 7, cellPadding: 1.8, ...tableStyles.body },
      headStyles: { fillColor: [220, 240, 248], textColor: 20, ...tableStyles.head },
      theme: 'grid',
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: rightCol, right: rightMargin },
    head: [['Параметр', 'Значение']],
    body: pdfData.paramsList,
    styles: { fontSize: 7, cellPadding: 1.8, ...tableStyles.body },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, ...tableStyles.head },
    theme: 'grid',
  });

  doc.setFontSize(8);
  doc.setTextColor(40);
  let noteY = Math.max(y, doc.lastAutoTable.finalY + 10);
  doc.text('Примечания:', leftMargin, noteY);
  noteY += 5;
  pdfData.notes.forEach((note) => {
    doc.text(`• ${note}`, leftMargin + 2, noteY);
    noteY += 4.5;
  });

  drawStamp(doc, pdfData.stamp, PDF_LAYOUT.stampBox, pageNo, totalPages, dateStr);
}

/**
 * @param {{ config: object, geometry: object, cutList: object[], isoImageDataUrl?: string|null, preferVectorIso?: boolean }} opts
 * @returns {Promise<{ doc: import('jspdf').jsPDF, filename: string, pdfData: object }>}
 */
export async function buildFramePdfDocument({
  config,
  geometry,
  cutList,
  isoImageDataUrl = null,
  preferVectorIso = true,
  branding = null,
}) {
  if (!canExportFramePdf(geometry)) {
    throw new Error('PDF export blocked: geometry validation errors');
  }

  const [{ jsPDF }, autoTableMod, { setupPdfFonts, pdfTableFontStyles, pdfTableHeadFontStyles }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('../lib/pdfFontSetup.js'),
  ]);
  const autoTable = autoTableMod.default;

  const pdfBranding = normalizeFramePdfBranding(branding);
  const logoDataUrl = await loadFramePdfLogoDataUrl(pdfBranding);

  const pdfData = prepareFramePdfData(config, geometry, cutList);
  pdfData.stamp = {
    ...pdfData.stamp,
    company: pdfBranding.companyName || 'Daogreen',
  };
  if (pdfData.hardwareRows.length > 0) {
    pdfData.hardwareRows = await loadHardwareRowImages(pdfData.hardwareRows);
  }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  await setupPdfFonts(doc);

  const dateStr = new Date().toLocaleDateString('ru-RU');
  const tableStyles = {
    body: pdfTableFontStyles(),
    head: pdfTableHeadFontStyles(),
  };

  const totalPages = pdfData.hasChannelsPage ? 3 : 2;
  let pageNo = 1;

  drawAssemblyPage(doc, pdfData, pdfBranding, logoDataUrl, preferVectorIso ? null : isoImageDataUrl, dateStr, pageNo, totalPages);
  pageNo += 1;

  if (pdfData.hasChannelsPage) {
    doc.addPage('a3', 'landscape');
    drawChannelsPage(doc, pdfData, pdfBranding, logoDataUrl, dateStr, pageNo, totalPages);
    pageNo += 1;
  }

  doc.addPage('a3', 'landscape');
  drawSpecPage(doc, pdfData, pdfBranding, logoDataUrl, dateStr, autoTable, tableStyles, pageNo, totalPages);

  return { doc, filename: pdfData.filename, pdfData };
}

/**
 * @param {{ config: object, geometry: object, cutList: object[], isoImageDataUrl?: string|null, preferVectorIso?: boolean }} opts
 */
export async function exportFrameToPdf(opts) {
  const { doc, filename } = await buildFramePdfDocument(opts);
  doc.save(filename);
  return filename;
}

/** @returns {Promise<{ blob: Blob, filename: string }>} */
export async function exportFrameToPdfBlob(opts) {
  const { doc, filename } = await buildFramePdfDocument(opts);
  return { blob: doc.output('blob'), filename };
}
