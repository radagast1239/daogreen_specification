import { calculateFrameGeometry } from './frameGeometry.js';
import { countConnectorsByTypeForBom, crabCutListQty, crabSpecNote, resolveManualCrabSets } from './frameCrabRules.js';
import { calculateNftChannelBill, NFT_CHANNEL_STOCK_MM, supportsNftChannels, formatNftQtyWithMargin } from './frameNftChannels.js';
import { perforatedAngleProfileShort } from './frameAngleStock.js';

export function generateCutList(params) {
  const geom = calculateFrameGeometry(params);
  if (geom.validationErrors && geom.validationErrors.length > 0) {
    return [];
  }

  const { tubeWidthMm, tubeHeightMm, connectionType, constructionType, angleProfile } = params;

  const isAngle = constructionType === 'perforated_angle';
  const profile = isAngle
    ? perforatedAngleProfileShort(angleProfile)
    : `${tubeWidthMm}×${tubeHeightMm}`;

  const list = [];

  if (geom.postHeight > 0) {
    list.push({
      id: 'post',
      name: isAngle ? 'Стойка (уголок)' : 'Стойка',
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
      name: isAngle ? 'Продольный уголок' : 'Продольная труба',
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
      name: isAngle ? 'Поперечный уголок' : 'Поперечная труба',
      profile,
      length: Math.round(geom.crossBeamLength),
      qty: geom.crossBeams.length,
      cut: 'Прямой',
      note: '',
    });
  }

  if (!isAngle && connectionType === 'crab' && geom.connectors.length > 0) {
    const { G: gCount, T: tCount, X: xCount, A4: a4Count, A6: a6Count } = countConnectorsByTypeForBom(
      geom.connectors,
      geom.zLevels ?? geom.levels,
      params.postCountY,
    );

    const finalG = resolveManualCrabSets(params.crabGQtyManual, 'G', gCount);
    const finalT = resolveManualCrabSets(params.crabTQtyManual, 'T', tCount);
    const finalX = resolveManualCrabSets(params.crabXQtyManual, 'X', xCount);
    const finalA4 = resolveManualCrabSets(params.crabA4QtyManual, 'A4', a4Count);

    if (finalG > 0) {
      list.push({
        id: 'connector-g',
        name: 'Краб-система Г-образная',
        profile: '-',
        length: '-',
        qty: crabCutListQty(finalG, 'G'),
        cut: '-',
        note: crabSpecNote(finalG, 'G'),
      });
    }

    if (finalT > 0) {
      list.push({
        id: 'connector-t',
        name: 'Краб-система T-образная',
        profile: '-',
        length: '-',
        qty: crabCutListQty(finalT, 'T'),
        cut: '-',
        note: crabSpecNote(finalT, 'T'),
      });
    }

    if (finalX > 0) {
      list.push({
        id: 'connector-x',
        name: 'Краб-система X-образная',
        profile: '-',
        length: '-',
        qty: crabCutListQty(finalX, 'X'),
        cut: '-',
        note: crabSpecNote(finalX, 'X'),
      });
    }

    if (finalA4 > 0) {
      list.push({
        id: 'connector-a4',
        name: 'Краб система угол на 4 стороны',
        profile: '-',
        length: '-',
        qty: crabCutListQty(finalA4, 'A4'),
        cut: '-',
        note: crabSpecNote(finalA4, 'A4'),
      });
    }

    const finalA6 = resolveManualCrabSets(params.crabA6QtyManual, 'A6', a6Count);

    if (finalA6 > 0) {
      list.push({
        id: 'connector-a6',
        name: 'Краб система угол на 6 сторон',
        profile: '-',
        length: '-',
        qty: crabCutListQty(finalA6, 'A6'),
        cut: '-',
        note: crabSpecNote(finalA6, 'A6'),
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
