export const defaultFrameParams = {
  name: 'Новый каркас',
  rackType: 'nft',
  lengthMm: 3000,
  depthMm: 500,
  tierCount: 7,
  tierSpacingMm: 400,
  bottomOffsetMm: 400,
  tubeWidthMm: 20,
  tubeHeightMm: 20,
  postCountX: 3,
  postCountY: 2,
  crossBeamsPerLevel: 6,
  beamSpacingMode: 'equal', // 'equal' | 'custom'
  customBeamLayoutByLevel: [],
  endCapBeamsEnabled: false,
  endCapBeamLevelMask: [],
  endCapBeamDropByLevel: [],
  connectionType: 'crab',
  trayEnabled: false,
  trayLengthMm: 1200,
  trayWidthMm: 450,
  trayHeightMm: 50,
  trayEndInsetMm: 100,
  channelsEnabled: true,
  showChannels: true,
  channelStockMarginPct: 8,
  channelSleeveMarginPct: 8,
  channelElbowMarginPct: 8,
  showDimensions: true,
  showConnectors: true,
  showTrays: true,
  crabPostOverrides: {},
};

export const framePresets = [
  {
    id: 'nft-3000-500',
    name: 'Стеллаж проточка 3000×500, 7 ярусов, 400 мм, 6 балок',
    params: {
      ...defaultFrameParams,
      lengthMm: 3000,
      depthMm: 500,
      tierCount: 7,
      tierSpacingMm: 400,
      bottomOffsetMm: 400,
      crossBeamsPerLevel: 6,
      beamSpacingMode: 'equal',
      trayEnabled: false,
      trayEndInsetMm: 100
    }
  },
  {
    id: 'nft-wide-2000-1090',
    name: 'Стеллаж проточка широкий 2000×1090, 7 ярусов, 400 мм, 6 балок',
    params: {
      ...defaultFrameParams,
      lengthMm: 2000,
      depthMm: 1090,
      tierCount: 7,
      tierSpacingMm: 400,
      bottomOffsetMm: 400,
      crossBeamsPerLevel: 6,
      beamSpacingMode: 'custom',
      trayEnabled: false,
      customBeamLayoutByLevel: Array.from({ length: 8 }, (_, i) => ({
        levelIndex: i,
        startInsetMm: 160,
        spacingsMm: [336, 336, 336, 336, 336]
      })),
      trayLengthMm: 1800,
      trayWidthMm: 1050,
      trayEndInsetMm: 160
    }
  },
  {
    id: 'nft-narrow-2000-740',
    name: 'Стеллаж проточка узкий 2000×740, 7 ярусов, 400 мм, 6 балок',
    params: {
      ...defaultFrameParams,
      lengthMm: 2000,
      depthMm: 740,
      tierCount: 7,
      tierSpacingMm: 400,
      bottomOffsetMm: 400,
      crossBeamsPerLevel: 6,
      beamSpacingMode: 'custom',
      trayEnabled: false,
      customBeamLayoutByLevel: Array.from({ length: 8 }, (_, i) => ({
        levelIndex: i,
        startInsetMm: 160,
        spacingsMm: [336, 336, 336, 336, 336]
      })),
      trayLengthMm: 1800,
      trayWidthMm: 700,
      trayEndInsetMm: 160
    }
  },
  {
    id: 'seedling-1340-701',
    name: 'Рассада / подтопление 1340×701, 7 ярусов, 3 балки',
    params: {
      ...defaultFrameParams,
      rackType: 'seedling',
      name: 'Стеллаж рассада 1340×701',
      lengthMm: 1340,
      depthMm: 701,
      tierCount: 7,
      tierSpacingMm: 300,
      bottomOffsetMm: 400,
      postCountX: 2,
      postCountY: 2,
      crossBeamsPerLevel: 3,
      beamSpacingMode: 'equal',
      trayEnabled: true,
      trayLengthMm: 1300,
      trayWidthMm: 641,
      trayEndInsetMm: 20
    }
  }
];
