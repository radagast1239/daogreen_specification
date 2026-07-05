import { calculateFrameGeometry } from './frameGeometry.js';
import { crabHalvesFromSets, countConnectorsByType } from './frameCrabRules.js';
import { calculateNftChannelBill, NFT_CHANNEL_STOCK_MM, supportsNftChannels, formatNftQtyWithMargin } from './frameNftChannels.js';

export function generateCutList(params) {
  const geom = calculateFrameGeometry(params);
  if (geom.validationErrors && geom.validationErrors.length > 0) {
    return [];
  }

  const { tubeWidthMm, tubeHeightMm, connectionType } = params;

  const profile = `${tubeWidthMm}×${tubeHeightMm}`;

  const list = [];

  if (geom.postHeight > 0) {
    list.push({
      id: 'post',
      name: 'Стойка',
      profile,
      length: Math.round(geom.postHeight),
      qty: geom.posts.length,
      cut: 'Прямой',
      note: '',
    });
  }

  if (geom.spanX > 0) {
    list.push({
      id: 'longitudinal',
      name: 'Продольная труба',
      profile,
      length: Math.round(geom.spanX),
      qty: geom.longitudinalBeams.length,
      cut: 'Прямой',
      note: '',
    });
  }

  if (geom.crossBeamLength > 0) {
    list.push({
      id: 'cross',
      name: 'Поперечная труба',
      profile,
      length: Math.round(geom.crossBeamLength),
      qty: geom.crossBeams.length,
      cut: 'Прямой',
      note: '',
    });
  }

  if (connectionType === 'crab' && geom.connectors.length > 0) {
    const { G: gCount, T: tCount, X: xCount } = countConnectorsByType(geom.connectors);

    const finalG = params.crabGQtyManual !== '' && params.crabGQtyManual !== undefined
      ? params.crabGQtyManual
      : gCount;
    const finalT = params.crabTQtyManual !== '' && params.crabTQtyManual !== undefined
      ? params.crabTQtyManual
      : tCount;
    const finalX = params.crabXQtyManual !== '' && params.crabXQtyManual !== undefined
      ? params.crabXQtyManual
      : xCount;

    if (finalG > 0) {
      list.push({
        id: 'connector-g',
        name: 'Краб-система Г-образная',
        profile: '-',
        length: '-',
        qty: crabHalvesFromSets(finalG),
        cut: '-',
        note: `${finalG} комплектов (половинки)`,
      });
    }

    if (finalT > 0) {
      list.push({
        id: 'connector-t',
        name: 'Краб-система T-образная',
        profile: '-',
        length: '-',
        qty: crabHalvesFromSets(finalT),
        cut: '-',
        note: `${finalT} комплектов (половинки)`,
      });
    }

    if (finalX > 0) {
      list.push({
        id: 'connector-x',
        name: 'Краб-система X-образная',
        profile: '-',
        length: '-',
        qty: crabHalvesFromSets(finalX),
        cut: '-',
        note: `${finalX} комплектов (половинки)`,
      });
    }
  }

  const channelBill = calculateNftChannelBill(params, geom);
  if (channelBill) {
    list.push({
      id: 'nft-channel-horizontal',
      name: 'NFT-канал (горизонтальный участок)',
      profile: channelBill.profile,
      length: NFT_CHANNEL_STOCK_MM,
      qty: channelBill.horizontalStockQty,
      note: `${formatNftQtyWithMargin(channelBill.stockTotalQty, channelBill.totalStockPieces, channelBill.channelMarginPct)}; гориз. ${channelBill.horizontalBreakdownDesc}, верт. ${channelBill.verticalLines}×${channelBill.verticalDropLengthMm} мм`,
    });
    if (channelBill.sleeveQty > 0) {
      list.push({
        id: 'nft-channel-sleeve',
        name: 'Муфта соединительная для каналов',
        profile: channelBill.profile,
        length: '-',
        qty: channelBill.sleeveQty,
        note: formatNftQtyWithMargin(channelBill.sleeveQty, channelBill.sleeveCount, channelBill.sleeveMarginPct),
      });
    }
    if (channelBill.elbowQty > 0) {
      list.push({
        id: 'nft-channel-elbow',
        name: 'Колено NFT-канала',
        profile: channelBill.profile,
        length: '-',
        qty: channelBill.elbowQty,
        note: `${formatNftQtyWithMargin(channelBill.elbowQty, channelBill.elbowCount, channelBill.elbowMarginPct)}; 2 на канал × ${channelBill.tierJoints} стыков`,
      });
    }
  }

  return list;
}
