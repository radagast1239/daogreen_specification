import { normalizeFrameConfig } from './frameConfig.js';
import { crabCatalogByConnectorId } from './frameCrabCatalog.js';
import { supportsTrays, totalFrameDepthMm } from './frameCrabRules.js';
import { countNftChannelsAcrossDepth, calculateNftChannelBill, shouldShowNftChannels, formatNftQtyWithMargin } from './frameNftChannels.js';
import { extractTubeCutsFromCutList, calculateTubeStockOptions } from './frameTubeStock.js';
import { calculateAngleStockOptions, calculateAngleFastenerVariants, perforatedAngleProfileLabel } from './frameAngleStock.js';

const ANGLE_PDF_NOTES = [
  'Размеры указаны в мм.',
  'Рез уголков прямой / 90°.',
  'Перед изготовлением проверить размеры под фактический поддон.',
  'PDF сформирован автоматически из конструктора каркасов Daogreen.',
];

function isPerforatedAngle(config) {
  return config?.constructionType === 'perforated_angle';
}

function angleConstructionTitle(config) {
  return `Перфорированный уголок ${config?.angleProfile || '30×30'}`;
}

function angleProfileLongLabel(config) {
  return `L-образный перфорированный уголок ${config?.angleProfile || '30×30'}`;
}

const RACK_TYPE_LABELS = {
  nft: 'NFT проточная гидропоника',
  dwc: 'DWC глубоководная',
  ebb: 'Периодическое подтопление',
  seedling: 'Рассада',
  flood: 'Подтопление',
  strawberry: 'Клубника',
  custom: 'Свой вариант',
};

const CONNECTION_LABELS = {
  crab: 'Краб-система',
  welded: 'Сварка',
};

export const FRAME_PDF_NOTES = [
  'Размеры указаны в мм.',
  'Рез труб прямой / 90°.',
  'Перед изготовлением проверить размеры под фактический поддон.',
  'PDF сформирован автоматически из конструктора каркасов Daogreen.',
];

/** @param {object} config */
export function buildFramePdfFilename(config) {
  const c = normalizeFrameConfig(config);
  const height = Math.round(c.bottomOffsetMm + c.tierCount * c.tierSpacingMm);
  const depth = totalFrameDepthMm(c.depthMm, c.tubeWidthMm, c.postCountY);
  return `frame-${c.lengthMm}x${depth}x${height}-${c.tierCount}tiers.pdf`;
}

/** @param {object|null|undefined} geometry */
export function canExportFramePdf(geometry) {
  return Boolean(geometry && !geometry.validationErrors?.length && geometry.posts?.length);
}

function tubeItems(cutList) {
  return cutList.filter(
    (item) => item.id === 'post' || item.id === 'longitudinal' || item.id === 'cross',
  );
}

function channelItems(cutList) {
  return cutList.filter((item) => item.id.startsWith('nft-channel'));
}

function hardwareItems(cutList, connectionType, constructionType) {
  if (constructionType === 'perforated_angle') {
    return cutList.filter(
      (item) => item.id === 'angle-bracket' || item.id === 'bolt-m6' || item.id === 'nut-m6' || item.id === 'grower-m6' || item.id === 'foot-plate',
    );
  }
  if (connectionType === 'welded') return [];
  return cutList.filter((item) => item.id.startsWith('connector'));
}

function profileLabel(config) {
  const c = normalizeFrameConfig(config);
  if (c.constructionType === 'perforated_angle') {
    return perforatedAngleProfileLabel(c.angleProfile);
  }
  return `${c.tubeWidthMm}×${c.tubeHeightMm}`;
}

function rackTypeLabel(rackType) {
  return RACK_TYPE_LABELS[rackType] || rackType || '—';
}

function connectionLabel(connectionType, constructionType) {
  if (constructionType === 'perforated_angle') {
    return 'Болтовое (перфоуг.) · болты М6×20';
  }
  return CONNECTION_LABELS[connectionType] || connectionType || '—';
}

function frameHeight(config, geometry) {
  if (geometry?.postHeight) return Math.round(geometry.postHeight);
  const c = normalizeFrameConfig(config);
  return Math.round(c.bottomOffsetMm + c.tierCount * c.tierSpacingMm);
}

/**
 * Чистая подготовка данных для PDF и тестов.
 * @param {object} config
 * @param {object} geometry
 * @param {object[]} cutList
 */
export function prepareFramePdfData(config, geometry, cutList) {
  const normalized = normalizeFrameConfig(config);
  const height = frameHeight(normalized, geometry);
  const tubes = tubeItems(cutList);
  const hardware = hardwareItems(cutList, normalized.connectionType, normalized.constructionType);
  const channels = channelItems(cutList);
  const channelBill = calculateNftChannelBill(normalized, geometry);

  const cutTableRows = tubes.map((item, idx) => ({
    no: idx + 1,
    name: item.name,
    profile: item.profile,
    length: item.length,
    qty: item.qty,
    cut: item.cut,
    note: item.note || '',
  }));

  const hardwareRows = hardware.map((item) => {
    const crab = crabCatalogByConnectorId(item.id);
    return {
      name: item.name,
      qty: item.qty,
      note: item.note || '',
      crabKey: crab?.key ?? null,
      crabFile: crab?.file ?? null,
    };
  });

  const channelTableRows = channels.map((item, idx) => ({
    no: idx + 1,
    name: item.name,
    profile: item.profile,
    length: item.length,
    qty: item.qty,
    note: item.note || '',
  }));

  const traysActive = supportsTrays(normalized.rackType) && normalized.trayEnabled;
  const channelsActive = shouldShowNftChannels(normalized);
  const channelsPerRow = channelsActive ? countNftChannelsAcrossDepth(normalized.depthMm) : 0;
  const totalDepth = geometry?.dimensions?.depthMm
    ?? totalFrameDepthMm(normalized.depthMm, normalized.tubeWidthMm, normalized.postCountY);
    
  // Calculate stock options
  let tubeStock = null;
  let angleStock = null;
  let angleFasteners = null;

  if (normalized.constructionType === 'perforated_angle') {
    angleStock = calculateAngleStockOptions(cutList, { overlapMm: normalized.angleOverlapMm });
    angleFasteners = calculateAngleFastenerVariants(geometry || normalized);
  } else {
    const tubeCuts = extractTubeCutsFromCutList(cutList);
    tubeStock = calculateTubeStockOptions(tubeCuts);
  }

  const paramsList = [
    ['Длина, мм', normalized.lengthMm],
    ['Глубина модуля, мм', normalized.depthMm],
    ['Полная глубина, мм', totalDepth],
    ['Высота, мм', height],
    ['Тип стеллажа', rackTypeLabel(normalized.rackType)],
    ...(isPerforatedAngle(normalized)
      ? [
        ['Тип конструкции', angleConstructionTitle(normalized)],
        ['Профиль', angleProfileLongLabel(normalized)],
        ['Поперечины', 'вар. А — болт+гайка; вар. Б — крепёжные уголки'],
      ]
      : []),
    ['Количество ярусов', normalized.tierCount],
    ['Количество уровней', geometry?.levelCount ?? normalized.tierCount + 1],
    ['Шаг ярусов, мм', normalized.tierSpacingMm],
    ['Нижний отступ, мм', normalized.bottomOffsetMm],
    [normalized.constructionType === 'perforated_angle' ? 'Профиль уголка' : 'Профиль трубы', profileLabel(normalized)],
    ['Количество стоек по X', normalized.postCountX],
    ['Количество стоек по Y', normalized.postCountY],
    ['Поперечных балок на уровень', normalized.crossBeamsPerLevel],
    ['Торцевые балки', normalized.endCapBeamsEnabled
      ? (normalized.endCapBeamLevelMask || [])
          .map((on, i) => {
            if (!on) return null;
            const drop = normalized.endCapBeamDropByLevel?.[i] || 0;
            return drop > 0 ? `ур.${i + 1} (−${drop} мм)` : `ур.${i + 1}`;
          })
          .filter((v) => v != null)
          .join(', ') || 'нет уровней'
      : 'выключены'],
    ['Тип соединения', connectionLabel(normalized.connectionType, normalized.constructionType)],
    ['Поддоны', traysActive ? 'включены' : 'выключены'],
    [
      'Размер поддона',
      traysActive
        ? `${normalized.trayLengthMm} × ${normalized.trayWidthMm} × ${normalized.trayHeightMm} мм`
        : '—',
    ],
    ['NFT-каналы', channelsActive ? 'включены' : 'выключены'],
    ['Каналов в ряд', channelsActive ? channelsPerRow : '—'],
    ['Профиль канала', channelsActive ? '110 × 55 мм' : '—'],
    [
      'Заготовки NFT 2 м',
      channelsActive && channelBill
        ? `${formatNftQtyWithMargin(channelBill.stockTotalQty, channelBill.totalStockPieces, channelBill.channelMarginPct)}, муфты ${formatNftQtyWithMargin(channelBill.sleeveQty, channelBill.sleeveCount, channelBill.sleeveMarginPct)}, колена ${formatNftQtyWithMargin(channelBill.elbowQty, channelBill.elbowCount, channelBill.elbowMarginPct)}`
        : '—',
    ],
  ];

  const weldedNote =
    normalized.connectionType === 'welded'
      ? 'Соединение: сварка. Краб-система не применяется.'
      : null;

  return {
    filename: buildFramePdfFilename(normalized),
    config: normalized,
    geometry,
    dimensions: {
      lengthMm: normalized.lengthMm,
      depthMm: totalDepth,
      moduleDepthMm: normalized.depthMm,
      heightMm: height,
      tierCount: normalized.tierCount,
      tierSpacingMm: normalized.tierSpacingMm,
      bottomOffsetMm: normalized.bottomOffsetMm,
      crossBeamsPerLevel: normalized.crossBeamsPerLevel,
      crossBeamLength: geometry?.crossBeamLength ?? null,
      spanX: geometry?.spanX ?? null,
      profile: profileLabel(normalized),
    },
    stamp: {
      title: 'Каркас гидропонного стеллажа',
      rackType: rackTypeLabel(normalized.rackType),
      size: `${normalized.lengthMm} × ${totalDepth} × ${height}`,
      tiers: normalized.tierCount,
      tierSpacing: normalized.tierSpacingMm,
      profile: profileLabel(normalized),
      connection: connectionLabel(normalized.connectionType, normalized.constructionType),
    },
    cutTableRows,
    hardwareRows,
    channelTableRows,
    paramsList,
    notes: isPerforatedAngle(normalized) ? ANGLE_PDF_NOTES : FRAME_PDF_NOTES,
    constructionType: normalized.constructionType,
    constructionLabel: isPerforatedAngle(normalized)
      ? angleConstructionTitle(normalized)
      : 'Профильная труба + краб-система',
    profileKind: isPerforatedAngle(normalized) ? 'angle' : 'tube',
    showAngleVisual: isPerforatedAngle(normalized),
    weldedNote,
    tubeStock,
    angleStock,
    angleFasteners,
    hasChannelsPage: channelsActive && (geometry?.nftChannels?.runs?.length ?? 0) > 0,
    channelsSummary: channelsActive && channelBill
      ? {
          perRow: channelsPerRow,
          tierCount: normalized.tierCount,
          totalRuns: geometry?.nftChannels?.runs?.length ?? 0,
          ...channelBill,
        }
      : null,
    canExport: canExportFramePdf(geometry),
  };
}