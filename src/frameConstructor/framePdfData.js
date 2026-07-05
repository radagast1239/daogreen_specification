import { normalizeFrameConfig } from './frameConfig.js';
import { supportsTrays, totalFrameDepthMm } from './frameCrabRules.js';
import { countNftChannelsAcrossDepth, calculateNftChannelBill, shouldShowNftChannels, formatNftQtyWithMargin } from './frameNftChannels.js';

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
    (item) => !item.id.startsWith('connector') && !item.id.startsWith('nft-channel'),
  );
}

function channelItems(cutList) {
  return cutList.filter((item) => item.id.startsWith('nft-channel'));
}

function hardwareItems(cutList, connectionType) {
  if (connectionType === 'welded') return [];
  return cutList.filter((item) => item.id.startsWith('connector'));
}

function profileLabel(config) {
  const c = normalizeFrameConfig(config);
  return `${c.tubeWidthMm}×${c.tubeHeightMm}`;
}

function rackTypeLabel(rackType) {
  return RACK_TYPE_LABELS[rackType] || rackType || '—';
}

function connectionLabel(connectionType) {
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
  const hardware = hardwareItems(cutList, normalized.connectionType);
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

  const hardwareRows = hardware.map((item) => ({
    name: item.name,
    qty: item.qty,
    note: item.note || '',
  }));

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

  const paramsList = [
    ['Длина, мм', normalized.lengthMm],
    ['Глубина модуля, мм', normalized.depthMm],
    ['Полная глубина, мм', totalDepth],
    ['Высота, мм', height],
    ['Тип стеллажа', rackTypeLabel(normalized.rackType)],
    ['Количество ярусов', normalized.tierCount],
    ['Количество уровней', geometry?.levelCount ?? normalized.tierCount + 1],
    ['Шаг ярусов, мм', normalized.tierSpacingMm],
    ['Нижний отступ, мм', normalized.bottomOffsetMm],
    ['Профиль трубы', profileLabel(normalized)],
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
    ['Тип соединения', connectionLabel(normalized.connectionType)],
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
      connection: connectionLabel(normalized.connectionType),
    },
    cutTableRows,
    hardwareRows,
    channelTableRows,
    paramsList,
    notes: FRAME_PDF_NOTES,
    weldedNote,
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
