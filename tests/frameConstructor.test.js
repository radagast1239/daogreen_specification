import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculateFrameGeometry } from '../src/frameConstructor/frameGeometry.js';
import { generateCutList } from '../src/frameConstructor/frameCutList.js';
import { normalizeFrameConfig } from '../src/frameConstructor/frameConfig.js';
import { defaultFrameParams, framePresets } from '../src/frameConstructor/framePresets.js';
import {
  buildFramePdfFilename,
  canExportFramePdf,
  prepareFramePdfData,
} from '../src/frameConstructor/framePdfData.js';
import {
  fitToBox,
  visualTubeWidth,
  shouldDrawPdfTrays,
  shouldDrawPdfChannels,
  PDF_CHANNELS_LAYOUT,
  computeTrayTopViewPdfRect,
  PDF_LAYOUT,
  collectFrontViewStrokes,
  edgeBasedCrossBeamSegments,
  pickDimLabelCoord,
  collectCrabLegendTypes,
  collectTopViewPlanConnectors,
  measureTopViewDimMargins,
  resolveIsoCrabMarkerOptions,
  fitCrabMarkerLabelFontSize,
  topViewLayoutAreas,
  CRAB_COLORS,
  CRAB_LABELS,
  levelCenterMm,
  tierTopMm,
  beamElevationCenterZ,
} from '../src/frameConstructor/framePdfExport.js';
import { computeFrameOrthoZoom } from '../src/frameConstructor/frameViewFit.js';
import {
  generateNftChannels,
  countNftChannelsAcrossDepth,
  nftChannelYPositions,
  NFT_CHANNEL_WIDTH_MM,
  NFT_CHANNEL_HEIGHT_MM,
  NFT_CHANNEL_STOCK_MM,
  NFT_ELBOWS_PER_TIER_JOINT,
  calculateNftChannelBill,
  countNftChannelElbows,
  nftChannelStockPieces,
  nftChannelSegmentsForRun,
  nftChannelSleevesForRun,
  channelNeedsSleeves,
  channelSegmentLengthsMm,
  formatChannelSegmentsDesc,
  buildLineSegmentBreakdown,
  formatNftQtyWithMargin,
  tierSnakeConnectSide,
  nftChannelQtyWithMargin,
  shouldShowNftChannels,
  supportsNftChannels,
} from '../src/frameConstructor/frameNftChannels.js';
import {
  supportsTrays,
  getRackTypeDefaults,
  getPostGridDefaults,
  suggestedTraySize,
  crossBayLengthMm,
  postYPosition,
  totalFrameDepthMm,
  isInternalPost,
  endCapBeamXPositions,
  normalizeEndCapBeamLevelMask,
  normalizeEndCapBeamDropByLevel,
  resolveEndCapBeamZ,
} from '../src/frameConstructor/frameCrabRules.js';
import {
  FRAME_PRESETS_STORAGE_KEY,
  deleteSavedFramePreset,
  getSavedFramePreset,
  listSavedFramePresets,
  saveFramePreset,
} from '../src/frameConstructor/frameSavedPresets.js';

describe('Frame Constructor Geometry', () => {
  it('normalizeFrameConfig replaces invalid values with defaults', () => {
    const invalidConfig = { ...defaultFrameParams, lengthMm: 0, depthMm: -100, tierCount: 0 };
    const normalized = normalizeFrameConfig(invalidConfig);
    expect(normalized.lengthMm).toBe(3000);
    expect(normalized.depthMm).toBe(500);
    expect(normalized.tierCount).toBe(7);
  });

  it('generateFrameGeometry does not create negative tubes and returns validation error', () => {
    const params = { ...defaultFrameParams, lengthMm: 0, postCountX: 3, tubeWidthMm: 20 };
    // lengthMm: 0 will be normalized to 500. 
    // spanX = (500 - 3*20) / 2 = 440 / 2 = 220. This is positive.
    // Let's pass a config that even after normalization is invalid, or test with a valid config but too many posts.
    const invalidParams = { ...defaultFrameParams, lengthMm: 500, postCountX: 30, tubeWidthMm: 20 };
    const geom = calculateFrameGeometry(invalidParams);
    expect(geom.validationErrors).toBeDefined();
    expect(geom.validationErrors.length).toBeGreaterThan(0);
  });

  it('cutList does not contain items if geometry is invalid', () => {
    const params = { ...defaultFrameParams, lengthMm: 500, postCountX: 30 };
    const cutList = generateCutList(params);
    expect(cutList.length).toBe(0);
  });
  it('calculates post height correctly', () => {
    const params = { ...defaultFrameParams, bottomOffsetMm: 400, tierCount: 7, tierSpacingMm: 400 };
    const geom = calculateFrameGeometry(params);
    expect(geom.postHeight).toBe(400 + 7 * 400); // 3200
  });

  it('calculates level count correctly', () => {
    const params = { ...defaultFrameParams, tierCount: 7 };
    const geom = calculateFrameGeometry(params);
    expect(geom.levelCount).toBe(8); // 7 tiers + 1 bottom level
  });

  it('calculates post count correctly', () => {
    const params = { ...defaultFrameParams, postCountX: 3, postCountY: 2 };
    const geom = calculateFrameGeometry(params);
    expect(geom.posts.length).toBe(6);
  });

  it('calculates longitudinal beams correctly', () => {
    const params = { ...defaultFrameParams, postCountX: 3, postCountY: 2, tierCount: 7 };
    const geom = calculateFrameGeometry(params);
    // (postCountX - 1) * postCountY * levelCount = 2 * 2 * 8 = 32
    expect(geom.longitudinalBeams.length).toBe(32);
  });

  it('normalizeFrameConfig converts string numbers like "08" to 8', () => {
    const config = { ...defaultFrameParams, crossBeamsPerLevel: '08' };
    const normalized = normalizeFrameConfig(config);
    expect(normalized.crossBeamsPerLevel).toBe(8);
  });

  it('calculates cross beams correctly for 8 beams on 8 levels', () => {
    const params = { ...defaultFrameParams, crossBeamsPerLevel: 8, tierCount: 7 };
    const geom = calculateFrameGeometry(params);
    // crossBeamsPerLevel * levelCount = 8 * 8 = 64
    expect(geom.crossBeams.length).toBe(64);
  });

  it('calculates cross beams correctly for 6 beams on 8 levels', () => {
    const params = { ...defaultFrameParams, crossBeamsPerLevel: 6, tierCount: 7 };
    const geom = calculateFrameGeometry(params);
    // crossBeamsPerLevel * yBayCount * levelCount = 6 * 1 * 8 = 48
    expect(geom.crossBeams.length).toBe(48);
  });

  it('endCapBeamsEnabled adds cross beams on post axes for selected levels only', () => {
    const levelCount = defaultFrameParams.tierCount + 1;
    const mask = Array(levelCount).fill(false);
    mask[0] = true;
    mask[levelCount - 1] = true;
    const params = {
      ...defaultFrameParams,
      crossBeamsPerLevel: 6,
      endCapBeamsEnabled: true,
      endCapBeamLevelMask: mask,
    };
    const geom = calculateFrameGeometry(params);
    const torzecX = endCapBeamXPositions(params.postCountX, geom.spanX, params.tubeWidthMm);

    expect(torzecX).toEqual([10, 2990]);
    expect(geom.crossBeams.filter((b) => b.endCap).length).toBe(2 * 1 * 2);
    expect(geom.endCapBeamLayouts[0].enabled).toBe(true);
    expect(geom.endCapBeamLayouts[1].enabled).toBe(false);
    expect(geom.endCapBeamLayouts[levelCount - 1].enabled).toBe(true);
  });

  it('endCapBeamXPositions align with outer post columns', () => {
    const geom = calculateFrameGeometry(defaultFrameParams);
    expect(endCapBeamXPositions(3, geom.spanX, 20)).toEqual([10, 2990]);
    expect(endCapBeamXPositions(2, geom.spanX, 20)).toEqual([10, 1500]);
  });

  it('end cap connectors are always T and use dropped height', () => {
    const levelCount = defaultFrameParams.tierCount + 1;
    const topIdx = levelCount - 1;
    const mask = Array(levelCount).fill(false);
    mask[topIdx] = true;
    const drops = Array(levelCount).fill(0);
    drops[topIdx] = 40;
    const params = {
      ...defaultFrameParams,
      endCapBeamsEnabled: true,
      endCapBeamLevelMask: mask,
      endCapBeamDropByLevel: drops,
    };
    const geom = calculateFrameGeometry(params);
    const topZ = geom.levels[topIdx];
    const endCapConnectors = geom.connectors.filter((c) => c.endCap);
    expect(endCapConnectors.length).toBe(4);
    expect(endCapConnectors.every((c) => c.type === 'T')).toBe(true);
    expect(endCapConnectors.every((c) => Math.abs(c.z - resolveEndCapBeamZ(topZ, 40)) < 0.01)).toBe(true);
    expect(geom.endCapBeamLayouts[topIdx].z).toBe(topZ - 40);
    expect(geom.crossBeams.filter((b) => b.endCap && Math.abs(b.z - (topZ - 40)) < 0.01).length).toBe(2);
  });

  it('end cap on top level replaces corner G with T at same height', () => {
    const levelCount = defaultFrameParams.tierCount + 1;
    const topIdx = levelCount - 1;
    const mask = Array(levelCount).fill(false);
    mask[topIdx] = true;
    const geom = calculateFrameGeometry({
      ...defaultFrameParams,
      endCapBeamsEnabled: true,
      endCapBeamLevelMask: mask,
      endCapBeamDropByLevel: Array(levelCount).fill(0),
    });
    const topZ = geom.levels[topIdx];
    const topEndCap = geom.connectors.filter((c) => c.endCap && Math.abs(c.z - topZ) < 0.01);
    expect(topEndCap.length).toBe(4);
    expect(topEndCap.every((c) => c.type === 'T')).toBe(true);
    expect(geom.connectors.filter((c) => c.type === 'G' && Math.abs(c.z - topZ) < 0.01).length).toBe(0);
  });

  it('end cap T connectors increase total T count', () => {
    const levelCount = defaultFrameParams.tierCount + 1;
    const without = calculateFrameGeometry(defaultFrameParams);
    const withCap = calculateFrameGeometry({
      ...defaultFrameParams,
      endCapBeamsEnabled: true,
      endCapBeamLevelMask: Array(levelCount).fill(true),
    });
    expect(withCap.connectors.filter((c) => c.type === 'T').length)
      .toBeGreaterThan(without.connectors.filter((c) => c.type === 'T').length);
  });

  it('end cap beams skip duplicates already present in main grid', () => {
    const inset = defaultFrameParams.tubeWidthMm / 2;
    const levelCount = defaultFrameParams.tierCount + 1;
    const params = {
      ...defaultFrameParams,
      crossBeamsPerLevel: 6,
      beamSpacingMode: 'custom',
      customBeamLayoutByLevel: Array.from({ length: levelCount }, (_, i) => ({
        levelIndex: i,
        startInsetMm: inset,
        spacingsMm: [2980],
      })),
      endCapBeamsEnabled: true,
      endCapBeamLevelMask: Array(levelCount).fill(true),
    };
    const withoutEndCap = calculateFrameGeometry({ ...params, endCapBeamsEnabled: false });
    const withEndCap = calculateFrameGeometry(params);
    expect(withEndCap.crossBeams.length).toBe(withoutEndCap.crossBeams.length);
  });

  it('adds cross beams per Y bay when postCountY increases (modules attach outside)', () => {
    const params = {
      ...defaultFrameParams,
      postCountY: 3,
      crossBeamsPerLevel: 12,
      tierCount: 7,
    };
    const geom = calculateFrameGeometry(params);
    expect(geom.crossBeams.length).toBe(96);
    expect(crossBayLengthMm(500, 20)).toBe(460);
    expect(geom.crossBeams[0].length).toBe(460);
    expect(geom.dimensions.depthMm).toBe(980);
    expect(postYPosition(2, 500, 20)).toBe(970);
  });

  it('getPostGridDefaults scales cross beams; tray width stays per module', () => {
    const base = { ...defaultFrameParams, rackType: 'seedling', postCountY: 2, crossBeamsPerLevel: 6 };
    const next = getPostGridDefaults(base, 3);
    expect(next.postCountY).toBe(3);
    expect(next.crossBeamsPerLevel).toBe(12);
    expect(next.trayWidthMm).toBe(440);
  });

  it('seedling rack generates one tray per tier and Y bay', () => {
    const params = {
      ...defaultFrameParams,
      rackType: 'seedling',
      postCountX: 2,
      postCountY: 3,
      tierCount: 7,
      crossBeamsPerLevel: 6,
      trayEnabled: true,
      trayLengthMm: 1300,
      trayWidthMm: 440,
    };
    const geom = calculateFrameGeometry(params);
    expect(geom.trays.length).toBe(14);
    expect(postYPosition(0, 500, 20)).toBe(10);
    expect(postYPosition(2, 500, 20)).toBe(970);
  });

  it('valid custom lengthMm is not replaced by default', () => {
    const params = { ...defaultFrameParams, lengthMm: 1340 };
    const normalized = normalizeFrameConfig(params);
    expect(normalized.lengthMm).toBe(1340);
  });

  it('calculates default 3000x500x7 correctly', () => {
    const params = {
      ...defaultFrameParams,
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
      connectionType: 'crab'
    };
    
    const cutList = generateCutList(params);
    
    const posts = cutList.find(c => c.id === 'post');
    expect(posts.qty).toBe(6);
    expect(posts.length).toBe(3200);
    
    const longs = cutList.find(c => c.id === 'longitudinal');
    expect(longs.qty).toBe(32);
    // spanX = (3000 - 3*20) / 2 = 2940 / 2 = 1470
    expect(longs.length).toBe(1470);
    
    const cross = cutList.find(c => c.id === 'cross');
    expect(cross.qty).toBe(48);
    // crossBeamLength = 500 - 2*20 = 460
    expect(cross.length).toBe(460);
  });

  it('compact rack (seedling) uses G on top corners and T elsewhere', () => {
    const params = {
      ...defaultFrameParams,
      rackType: 'seedling',
      postCountX: 2,
      postCountY: 2,
      crossBeamsPerLevel: 3,
      connectionType: 'crab'
    };
    const geom = calculateFrameGeometry(params);
    expect(geom.connectors.filter(c => c.type === 'G').length).toBe(4);
    expect(geom.connectors.some(c => c.type === 'T')).toBe(true);
    expect(geom.connectors.some(c => c.type === 'X')).toBe(false);
  });

  it('every rack has exactly 4 G connectors on top level', () => {
    const geom = calculateFrameGeometry({ ...defaultFrameParams, connectionType: 'crab' });
    expect(geom.connectors.filter(c => c.type === 'G').length).toBe(4);
    const topZ = geom.levels[geom.levels.length - 1];
    expect(geom.connectors.filter(c => c.type === 'G' && Math.abs(c.z - topZ) < 0.01).length).toBe(4);
  });

  it('cut list counts crab halves (2 pieces per set)', () => {
    const params = { ...defaultFrameParams, connectionType: 'crab' };
    const geom = calculateFrameGeometry(params);
    const cutList = generateCutList(params);
    const tSets = geom.connectors.filter(c => c.type === 'T').length;
    const gSets = geom.connectors.filter(c => c.type === 'G').length;
    const tRow = cutList.find(c => c.id === 'connector-t');
    const gRow = cutList.find(c => c.id === 'connector-g');
    expect(gRow.qty).toBe(gSets * 2);
    expect(tRow.qty).toBe(tSets * 2);
    expect(tRow.note).toMatch(/комплектов \(половинки\)/);
  });

  it('internal posts use X crabs below top level, T on top level', () => {
    const params = {
      ...defaultFrameParams,
      rackType: 'nft',
      postCountX: 3,
      postCountY: 2,
      connectionType: 'crab',
    };
    const geom = calculateFrameGeometry(params);
    const topZ = geom.levels[geom.levels.length - 1];
    const postConnectors = geom.connectors.filter((c) => c.axis === 'post');
    const xInternal = postConnectors.filter((c) => c.type === 'X');
    const internalCount = 2;
    expect(xInternal.length).toBe((geom.levelCount - 1) * internalCount);
    const topMiddle = postConnectors.filter(
      (c) => Math.abs(c.z - topZ) < 0.01 && c.px === 1,
    );
    expect(topMiddle.every((c) => c.type === 'T')).toBe(true);
    expect(topMiddle.some((c) => c.type === 'X')).toBe(false);
    expect(isInternalPost(1, 0, 3, 2)).toBe(true);
    expect(isInternalPost(0, 0, 3, 2)).toBe(false);
  });

  it('more internal posts increase X crab count', () => {
    const geom3 = calculateFrameGeometry({ ...defaultFrameParams, postCountX: 3, connectionType: 'crab' });
    const geom4 = calculateFrameGeometry({ ...defaultFrameParams, postCountX: 4, connectionType: 'crab' });
    const x3 = geom3.connectors.filter((c) => c.type === 'X').length;
    const x4 = geom4.connectors.filter((c) => c.type === 'X').length;
    expect(x4).toBeGreaterThan(x3);
  });

  it('includes connectors in cut list when connectionType is crab', () => {
    const params = { ...defaultFrameParams, connectionType: 'crab' };
    const cutList = generateCutList(params);
    const tConnectors = cutList.find(c => c.id === 'connector-t');
    const xConnectors = cutList.find(c => c.id === 'connector-x');
    expect(tConnectors || xConnectors).toBeDefined();
  });

  it('excludes connectors from cut list when connectionType is welded', () => {
    const params = { ...defaultFrameParams, connectionType: 'welded' };
    const cutList = generateCutList(params);
    const connectors = cutList.find(c => c.id === 'connector');
    expect(connectors).toBeUndefined();
  });

  it('custom beam layout creates xPositions according to spacings', () => {
    const params = {
      ...defaultFrameParams,
      lengthMm: 3000,
      crossBeamsPerLevel: 6,
      beamSpacingMode: 'custom',
      customBeamLayoutByLevel: [
        {
          levelIndex: 0,
          startInsetMm: 100,
          spacingsMm: [560, 560, 560, 560, 560]
        }
      ]
    };
    const geom = calculateFrameGeometry(params);
    const layout = geom.beamLayouts[0];
    expect(layout.xPositions).toEqual([100, 660, 1220, 1780, 2340, 2900]);
    expect(layout.endInsetMm).toBe(100);
  });

  it('equal mode maintains old behavior', () => {
    const params = {
      ...defaultFrameParams,
      lengthMm: 3000,
      crossBeamsPerLevel: 6,
      beamSpacingMode: 'equal',
      trayEndInsetMm: 100
    };
    const geom = calculateFrameGeometry(params);
    const layout = geom.beamLayouts[0];
    expect(layout.xPositions.length).toBe(6);
    expect(layout.xPositions[0]).toBe(100);
    expect(layout.xPositions[5]).toBe(2900);
  });

  it('wide preset has correct depth and cross beam length', () => {
    const preset = framePresets.find(p => p.id === 'nft-wide-2000-1090');
    const geom = calculateFrameGeometry(preset.params);
    expect(geom.dimensions.depthMm).toBe(1090);
    expect(geom.crossBeamLength).toBe(1050); // 1090 - 2 * 20
  });

  it('narrow preset has correct depth and cross beam length', () => {
    const preset = framePresets.find(p => p.id === 'nft-narrow-2000-740');
    const geom = calculateFrameGeometry(preset.params);
    expect(geom.dimensions.depthMm).toBe(740);
    expect(geom.crossBeamLength).toBe(700); // 740 - 2 * 20
  });
});

describe('Frame Constructor PDF export', () => {
  function pdfFixture(overrides = {}) {
    const params = { ...defaultFrameParams, connectionType: 'crab', ...overrides };
    const geom = calculateFrameGeometry(params);
    const cutList = generateCutList(params);
    return { params, geom, cutList };
  }

  it('buildFramePdfFilename uses current form dimensions', () => {
    expect(buildFramePdfFilename({ ...defaultFrameParams, lengthMm: 1340, depthMm: 500, tierCount: 7 }))
      .toBe('frame-1340x500x3200-7tiers.pdf');
    expect(buildFramePdfFilename({ ...defaultFrameParams, lengthMm: 3000, depthMm: 500, tierCount: 7 }))
      .toBe('frame-3000x500x3200-7tiers.pdf');
  });

  it('prepareFramePdfData keeps lengthMm from config without preset substitution', () => {
    const { params, geom, cutList } = pdfFixture({ lengthMm: 1340 });
    const data = prepareFramePdfData(params, geom, cutList);
    expect(data.dimensions.lengthMm).toBe(1340);
    expect(data.filename).toContain('1340');
    expect(data.filename).not.toContain('3000');
  });

  it('prepareFramePdfData outputs 3000 when lengthMm is 3000', () => {
    const { params, geom, cutList } = pdfFixture({ lengthMm: 3000 });
    const data = prepareFramePdfData(params, geom, cutList);
    expect(data.dimensions.lengthMm).toBe(3000);
    expect(data.filename).toContain('3000');
  });

  it('cut list for 6 cross beams per level is reflected in PDF data', () => {
    const { params, geom, cutList } = pdfFixture({ crossBeamsPerLevel: 6, tierCount: 7 });
    const data = prepareFramePdfData(params, geom, cutList);
    const cross = data.cutTableRows.find((r) => r.name === 'Поперечная труба');
    expect(cross.qty).toBe(48);
    expect(data.dimensions.crossBeamsPerLevel).toBe(6);
  });

  it('cut list for 8 cross beams per level is reflected in PDF data', () => {
    const { params, geom, cutList } = pdfFixture({ crossBeamsPerLevel: 8, tierCount: 7 });
    const data = prepareFramePdfData(params, geom, cutList);
    const cross = data.cutTableRows.find((r) => r.name === 'Поперечная труба');
    expect(cross.qty).toBe(64);
    expect(data.dimensions.crossBeamsPerLevel).toBe(8);
  });

  it('welded connection excludes crabs from PDF hardware data', () => {
    const { params, geom, cutList } = pdfFixture({ connectionType: 'welded' });
    const data = prepareFramePdfData(params, geom, cutList);
    expect(data.hardwareRows.length).toBe(0);
    expect(data.weldedNote).toMatch(/сварка/i);
    expect(data.cutTableRows.some((r) => r.name.includes('Краб'))).toBe(false);
  });

  it('crab connection includes T/X/G crabs in PDF hardware data', () => {
    const { params, geom, cutList } = pdfFixture({ connectionType: 'crab' });
    const data = prepareFramePdfData(params, geom, cutList);
    expect(data.hardwareRows.length).toBeGreaterThan(0);
    expect(data.hardwareRows.some((r) => r.name.includes('Г-образная'))).toBe(true);
    expect(data.hardwareRows.some((r) => r.name.includes('T-образная'))).toBe(true);
    expect(data.hardwareRows.some((r) => r.name.includes('X-образная'))).toBe(true);
    const tRow = data.hardwareRows.find((r) => r.name.includes('T-образная'));
    expect(tRow.qty % 2).toBe(0);
    expect(data.weldedNote).toBeNull();
  });

  it('canExportFramePdf is false when geometry has validation errors', async () => {
    const geom = calculateFrameGeometry({ ...defaultFrameParams, lengthMm: 500, postCountX: 30 });
    expect(canExportFramePdf(geom)).toBe(false);
    const { exportFrameToPdf } = await import('../src/frameConstructor/framePdfExport.js');
    await expect(exportFrameToPdf({
      config: defaultFrameParams,
      geometry: geom,
      cutList: [],
    })).rejects.toThrow(/validation errors/i);
  });

  it('canExportFramePdf is true for valid geometry', () => {
    const { geom } = pdfFixture();
    expect(canExportFramePdf(geom)).toBe(true);
    const data = prepareFramePdfData(defaultFrameParams, geom, generateCutList(defaultFrameParams));
    expect(data.canExport).toBe(true);
  });

  it('supportsTrays is true only for flood, seedling, strawberry', () => {
    expect(supportsTrays('flood')).toBe(true);
    expect(supportsTrays('seedling')).toBe(true);
    expect(supportsTrays('strawberry')).toBe(true);
    expect(supportsTrays('nft')).toBe(false);
    expect(supportsTrays('custom')).toBe(false);
  });

  it('NFT rack does not generate trays even if trayEnabled is true', () => {
    const params = { ...defaultFrameParams, rackType: 'nft', trayEnabled: true, trayLengthMm: 2800, trayWidthMm: 460 };
    const geom = calculateFrameGeometry(params);
    expect(geom.trays.length).toBe(0);
  });

  it('countNftChannelsAcrossDepth packs 110 mm channels into module depth', () => {
    expect(countNftChannelsAcrossDepth(700)).toBe(6);
    expect(countNftChannelsAcrossDepth(1000)).toBe(9);
    expect(countNftChannelsAcrossDepth(500)).toBe(4);
    expect(nftChannelYPositions(700).length).toBe(6);
    expect(nftChannelYPositions(1000).length).toBe(9);
  });

  it('NFT rack generates multiple channel runs per tier and snake drops', () => {
    const params = { ...defaultFrameParams, rackType: 'nft', channelsEnabled: true, depthMm: 700, tierCount: 7, postCountY: 2 };
    const geom = calculateFrameGeometry(params);
    const perTier = countNftChannelsAcrossDepth(700);
    expect(perTier).toBe(6);
    expect(geom.nftChannels.runs.length).toBe(7 * perTier);
    expect(geom.nftChannels.drops.length).toBe(6 * perTier);
    expect(geom.nftChannels.elbows.length).toBe(geom.nftChannels.drops.length * NFT_ELBOWS_PER_TIER_JOINT);
    expect(geom.nftChannels.runs[0].width).toBe(NFT_CHANNEL_WIDTH_MM);
    expect(geom.nftChannels.runs[0].height).toBe(NFT_CHANNEL_HEIGHT_MM);
    expect(geom.nftChannels.runs[0].length).toBe(3000);
    expect(geom.nftChannels.drops[0].connectSide).toBe('right');
    expect(geom.nftChannels.drops[6].connectSide).toBe('left');
  });

  it('shouldShowNftChannels respects toggles', () => {
    expect(shouldShowNftChannels({ rackType: 'nft', channelsEnabled: true, showChannels: true })).toBe(true);
    expect(shouldShowNftChannels({ rackType: 'nft', channelsEnabled: true, showChannels: false })).toBe(false);
    expect(shouldShowNftChannels({ rackType: 'seedling', channelsEnabled: true, showChannels: true })).toBe(false);
    expect(supportsNftChannels('nft')).toBe(true);
  });

  it('channelSegmentLengthsMm splits at 2 m boundaries', () => {
    expect(channelSegmentLengthsMm(1500)).toEqual([1500]);
    expect(channelSegmentLengthsMm(2000)).toEqual([2000]);
    expect(channelSegmentLengthsMm(3000)).toEqual([2000, 1000]);
    expect(formatChannelSegmentsDesc(3000)).toBe('2 м + 1 м');
    expect(buildLineSegmentBreakdown(3000, 28)).toBe('28×2 м + 28×1 м');
    expect(channelNeedsSleeves(2000)).toBe(false);
    expect(channelNeedsSleeves(2001)).toBe(true);
    expect(tierSnakeConnectSide(0)).toBe('right');
    expect(tierSnakeConnectSide(1)).toBe('left');
  });

  it('nftChannelStockPieces rounds up to 2 m blanks with margin', () => {
    expect(nftChannelStockPieces(0)).toBe(0);
    expect(nftChannelStockPieces(2000)).toBe(2);
    expect(nftChannelStockPieces(2000, 0)).toBe(1);
    expect(nftChannelStockPieces(4000, 0)).toBe(2);
  });

  it('nftChannelQtyWithMargin applies pct reserve to piece count', () => {
    expect(nftChannelQtyWithMargin(28, 8)).toBe(31);
    expect(nftChannelQtyWithMargin(28, 0)).toBe(28);
    expect(nftChannelQtyWithMargin(0, 8)).toBe(0);
  });

  it('nftChannelSegmentsForRun splits long lines into 2 m + sleeve pattern', () => {
    expect(nftChannelSegmentsForRun(1500)).toBe(1);
    expect(nftChannelSleevesForRun(1500)).toBe(0);
    expect(nftChannelSegmentsForRun(2000)).toBe(1);
    expect(nftChannelSleevesForRun(2000)).toBe(0);
    expect(nftChannelSegmentsForRun(3000)).toBe(2);
    expect(nftChannelSleevesForRun(3000)).toBe(1);
    expect(nftChannelSegmentsForRun(4500)).toBe(3);
    expect(nftChannelSleevesForRun(4500)).toBe(2);
  });

  it('calculateNftChannelBill counts 2 m segments, sleeves and elbows separately', () => {
    const params = { ...defaultFrameParams, rackType: 'nft', channelsEnabled: true, depthMm: 700, tierCount: 7, postCountY: 2 };
    const geom = calculateFrameGeometry(params);
    const bill = calculateNftChannelBill(params, geom);
    expect(bill).not.toBeNull();
    expect(bill.stockLengthMm).toBe(NFT_CHANNEL_STOCK_MM);
    expect(bill.horizontalLines).toBe(geom.nftChannels.runs.length);
    expect(bill.elbowCount).toBe(countNftChannelElbows(params, geom));
    expect(bill.elbowCount).toBe(geom.nftChannels.elbows.length);
    expect(bill.elbowCount).toBe(geom.nftChannels.drops.length * NFT_ELBOWS_PER_TIER_JOINT);
    expect(bill.horizontalSegments).toBe(geom.nftChannels.runs.length * 2);
    expect(bill.sleeveCount).toBe(geom.nftChannels.runs.length);
    expect(bill.horizontalStockQty).toBe(bill.stockTotalQty);
    expect(bill.totalStockPieces).toBe(Math.ceil(bill.totalChannelLengthMm / NFT_CHANNEL_STOCK_MM));
    expect(bill.stockTotalQty).toBe(nftChannelQtyWithMargin(bill.totalStockPieces, bill.channelMarginPct));
    expect(bill.horizontalBreakdownDesc).toMatch(/×2 м/);
    expect(bill.verticalLines).toBe(geom.nftChannels.drops.length);
    expect(bill.sleeveQty).toBe(nftChannelQtyWithMargin(bill.sleeveCount, bill.sleeveMarginPct));
    expect(bill.elbowQty).toBe(nftChannelQtyWithMargin(bill.elbowCount, bill.elbowMarginPct));
  });

  it('calculateNftChannelBill uses separate margin pct for stock, sleeves and elbows', () => {
    const params = {
      ...defaultFrameParams,
      rackType: 'nft',
      channelsEnabled: true,
      depthMm: 500,
      tierCount: 7,
      channelStockMarginPct: 10,
      channelSleeveMarginPct: 0,
      channelElbowMarginPct: 5,
    };
    const geom = calculateFrameGeometry(params);
    const bill = calculateNftChannelBill(params, geom);
    expect(bill.sleeveCount).toBe(28);
    expect(bill.sleeveQty).toBe(28);
    expect(bill.sleeveMarginPct).toBe(0);
    expect(bill.channelMarginPct).toBe(10);
    expect(bill.elbowMarginPct).toBe(5);
  });

  it('generateCutList adds channel stock, sleeves and elbows', () => {
    const params = { ...defaultFrameParams, rackType: 'nft', channelsEnabled: true, depthMm: 700 };
    const geom = calculateFrameGeometry(params);
    const cutList = generateCutList(params);
    const bill = calculateNftChannelBill(params, geom);
    const horizontal = cutList.find((i) => i.id === 'nft-channel-horizontal');
    const sleeve = cutList.find((i) => i.id === 'nft-channel-sleeve');
    const elbow = cutList.find((i) => i.id === 'nft-channel-elbow');
    expect(horizontal).toBeTruthy();
    expect(sleeve).toBeTruthy();
    expect(elbow).toBeTruthy();
    expect(horizontal.length).toBe(NFT_CHANNEL_STOCK_MM);
    expect(horizontal.qty).toBe(bill.horizontalStockQty);
    expect(sleeve.qty).toBe(bill.sleeveQty);
    expect(elbow.qty).toBe(bill.elbowQty);
  });

  it('generateNftChannels returns empty for non-NFT rack', () => {
    const empty = generateNftChannels({
      rackType: 'seedling',
      channelsEnabled: true,
      lengthMm: 3000,
      depthMm: 500,
      tubeWidthMm: 20,
      tubeHeightMm: 20,
      tierCount: 3,
      zLevels: [400, 800, 1200, 1600],
      postCountY: 2,
    });
    expect(empty.runs.length).toBe(0);
    expect(empty.drops.length).toBe(0);
    expect(empty.elbows.length).toBe(0);
  });

  it('seedling rack generates trays when enabled', () => {
    const params = {
      ...defaultFrameParams,
      rackType: 'seedling',
      postCountX: 2,
      postCountY: 2,
      lengthMm: 1340,
      depthMm: 701,
      trayEnabled: true,
      trayLengthMm: 1300,
      trayWidthMm: 641,
    };
    const geom = calculateFrameGeometry(params);
    expect(geom.trays.length).toBe(7);
    expect(geom.trays[0].length).toBe(1300);
    expect(geom.trays[0].width).toBe(641);
  });

  it('normalizeFrameConfig clamps tray size to frame dimensions', () => {
    const normalized = normalizeFrameConfig({
      ...defaultFrameParams,
      lengthMm: 2000,
      depthMm: 500,
      postCountY: 2,
      tubeWidthMm: 20,
      trayLengthMm: 5000,
      trayWidthMm: 900,
    });
    expect(normalized.trayLengthMm).toBe(1980);
    expect(normalized.trayWidthMm).toBe(450);
  });

  it('getRackTypeDefaults enables trays for seedling and disables for nft', () => {
    const seedling = getRackTypeDefaults('seedling', { lengthMm: 1340, depthMm: 701, tubeWidthMm: 20 });
    expect(seedling.trayEnabled).toBe(true);
    expect(seedling.trayLengthMm).toBe(1300);
    expect(seedling.trayWidthMm).toBe(641);

    const nft = getRackTypeDefaults('nft', { lengthMm: 3000, depthMm: 500, tubeWidthMm: 20 });
    expect(nft.trayEnabled).toBe(false);
    expect(nft.channelsEnabled).toBe(true);
  });

  it('suggestedTraySize fits inside frame module', () => {
    const tray = suggestedTraySize(3000, 500, 20);
    expect(tray.trayLengthMm).toBe(2960);
    expect(tray.trayWidthMm).toBe(440);
  });

  it('totalFrameDepthMm grows when modules attach along Y', () => {
    expect(totalFrameDepthMm(500, 20, 2)).toBe(500);
    expect(totalFrameDepthMm(500, 20, 3)).toBe(980);
    expect(totalFrameDepthMm(500, 20, 4)).toBe(1460);
  });

  it('fitToBox scales model to fit inside view box', () => {
    const fit = fitToBox(3000, 3200, PDF_LAYOUT.frontBox, 8);
    expect(fit.scale).toBeGreaterThan(0);
    expect(fit.originX + 3000 * fit.scale).toBeLessThanOrEqual(PDF_LAYOUT.frontBox.x + PDF_LAYOUT.frontBox.w + 0.5);
    expect(fit.originY - 3200 * fit.scale).toBeGreaterThanOrEqual(PDF_LAYOUT.frontBox.y - 0.5);
  });

  it('visualTubeWidth is clamped between 0.8 and 2.2 mm', () => {
    expect(visualTubeWidth(20, 0.01)).toBe(0.8);
    expect(visualTubeWidth(20, 1)).toBe(2.2);
    expect(visualTubeWidth(20, 0.05)).toBeLessThanOrEqual(2.2);
    expect(visualTubeWidth(20, 0.05)).toBeGreaterThanOrEqual(0.8);
  });

  it('shouldDrawPdfTrays respects rack type and trayEnabled', () => {
    expect(shouldDrawPdfTrays({ rackType: 'nft', trayEnabled: true, showTrays: true })).toBe(false);
    expect(shouldDrawPdfTrays({ rackType: 'custom', trayEnabled: false, showTrays: true })).toBe(false);
    expect(shouldDrawPdfTrays({ rackType: 'seedling', trayEnabled: true, showTrays: true })).toBe(true);
    expect(shouldDrawPdfTrays({ rackType: 'flood', trayEnabled: true, showTrays: true })).toBe(true);
    expect(shouldDrawPdfTrays({ rackType: 'strawberry', trayEnabled: true, showTrays: true })).toBe(true);
  });

  it('tray top view rect stays inside topBox', () => {
    const params = {
      ...defaultFrameParams,
      rackType: 'seedling',
      postCountX: 2,
      postCountY: 2,
      lengthMm: 1340,
      depthMm: 701,
      trayEnabled: true,
      trayLengthMm: 1300,
      trayWidthMm: 641,
    };
    const geom = calculateFrameGeometry(params);
    const box = PDF_LAYOUT.topBox;
    const fit = fitToBox(params.lengthMm, params.depthMm, box, 8);
    const transform = {
      ...fit,
      toX: (x) => fit.originX + x * fit.scale,
      toY: (y) => fit.originY - y * fit.scale,
    };
    const rect = computeTrayTopViewPdfRect(geom.trays[0], transform);
    expect(rect.left).toBeGreaterThanOrEqual(box.x - 1);
    expect(rect.right).toBeLessThanOrEqual(box.x + box.w + 1);
    expect(rect.top).toBeGreaterThanOrEqual(box.y - 1);
    expect(rect.bottom).toBeLessThanOrEqual(box.y + box.h + 1);
  });

  it('front view uses stroke tubes only, not full-frame fill', () => {
    const { params, geom } = pdfFixture({ lengthMm: 3000, crossBeamsPerLevel: 6 });
    const strokes = collectFrontViewStrokes(params, geom, PDF_LAYOUT.frontBox);
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((s) => s.type === 'stroke')).toBe(true);
    expect(strokes.some((s) => s.type === 'filledRect')).toBe(false);
    const longBeams = strokes.filter((s) => s.role === 'longitudinal');
    expect(longBeams.length).toBeGreaterThan(0);
    longBeams.forEach((s) => {
      expect(Math.abs(s.y2 - s.y1)).toBeLessThan(3);
    });
    expect(strokes.filter((s) => s.role === 'post').length).toBe(3);
  });

  it('prepareFramePdfData hides trays for NFT rack type', () => {
    const { params, geom, cutList } = pdfFixture({ rackType: 'nft', trayEnabled: true });
    const data = prepareFramePdfData(params, geom, cutList);
    const trayRow = data.paramsList.find(([k]) => k === 'Поддоны');
    expect(trayRow[1]).toBe('выключены');
  });

  it('prepareFramePdfData adds channels page for NFT with channels enabled', () => {
    const params = { ...defaultFrameParams, rackType: 'nft', channelsEnabled: true, showChannels: true, depthMm: 700 };
    const geom = calculateFrameGeometry(params);
    const cutList = generateCutList(params, geom);
    const data = prepareFramePdfData(params, geom, cutList);
    expect(data.hasChannelsPage).toBe(true);
    expect(data.channelsSummary.perRow).toBe(6);
    expect(data.channelsSummary.totalRuns).toBeGreaterThan(0);
    expect(data.channelsSummary.stockTotalQty).toBeGreaterThan(0);
    expect(data.channelTableRows.length).toBe(3);
    expect(data.cutTableRows.some((r) => r.name.includes('NFT'))).toBe(false);
    const chRow = data.paramsList.find(([k]) => k === 'NFT-каналы');
    expect(chRow[1]).toBe('включены');
    const stockRow = data.paramsList.find(([k]) => k === 'Заготовки NFT 2 м');
    expect(stockRow[1]).toMatch(/шт/);
    expect(shouldDrawPdfChannels(params, geom)).toBe(true);
    expect(shouldDrawPdfChannels({ ...params, showChannels: false }, geom)).toBe(false);
    expect(PDF_CHANNELS_LAYOUT.frontBox.w).toBeGreaterThan(100);
  });

  it('edgeBasedCrossBeamSegments measures from pipe edge not center', () => {
    const segments = edgeBasedCrossBeamSegments([100, 660, 1220, 1780, 2340, 2900], 3000, 20);
    expect(segments[0].value).toBe(90);
    expect(segments[1].value).toBe(540);
    expect(segments[segments.length - 1].value).toBe(90);
    expect(segments[0].x2 - segments[0].x1).toBe(90);
  });

  it('pickDimLabelCoord avoids post centers for inner length and depth labels', () => {
    const tubeWidthMm = 20;
    const params = { ...defaultFrameParams, lengthMm: 3000, depthMm: 500, postCountX: 3, postCountY: 3 };
    const geom = calculateFrameGeometry(params);
    const innerX1 = tubeWidthMm;
    const innerX2 = params.lengthMm - tubeWidthMm;
    const innerY1 = tubeWidthMm;
    const innerY2 = geom.dimensions.depthMm - tubeWidthMm;

    const labelX = pickDimLabelCoord(innerX1, innerX2, geom.posts, tubeWidthMm, 'x');
    const labelY = pickDimLabelCoord(innerY1, innerY2, geom.posts, tubeWidthMm, 'y');

    const middlePostX = geom.posts.find((p) => p.x > innerX1 && p.x < innerX2 && p.y <= tubeWidthMm)?.x;
    const middlePostY = geom.posts.find((p) => p.y > innerY1 && p.y < innerY2)?.y;

    expect(middlePostX).toBeDefined();
    expect(middlePostY).toBeDefined();
    expect(Math.abs(labelX - middlePostX)).toBeGreaterThan(tubeWidthMm * 2);
    expect(Math.abs(labelY - middlePostY)).toBeGreaterThan(tubeWidthMm * 2);
  });

  it('resolveIsoCrabMarkerOptions keeps iso marker radius scaled to tube width', () => {
    const sparse = resolveIsoCrabMarkerOptions(1.2, 8);
    const dense = resolveIsoCrabMarkerOptions(1.2, 60);
    expect(sparse.radius).toBeGreaterThan(0.9);
    expect(sparse.radius).toBeLessThanOrEqual(1.3);
    expect(dense.radius).toBeLessThan(sparse.radius);
    expect(sparse.lineWidth).toBe(0.3);
  });

  it('fitCrabMarkerLabelFontSize keeps letter inside iso crab marker', () => {
    const ptToMm = 0.352778;
    const capRatio = 0.72;
    const widthRatio = { G: 0.82, T: 0.55, X: 0.68 };
    for (const type of ['G', 'T', 'X']) {
      for (const r of [0.5, 0.85, 1.3]) {
        const fs = fitCrabMarkerLabelFontSize(r, type);
        const inner = r * 2 - 0.32;
        const capMm = fs * ptToMm * capRatio;
        const widthMm = fs * ptToMm * widthRatio[type];
        expect(capMm).toBeLessThanOrEqual(inner + 0.06);
        expect(widthMm).toBeLessThanOrEqual(inner + 0.06);
      }
    }
  });

  it('iso PDF crabs include post and cross connectors', () => {
    const geom = calculateFrameGeometry({ ...defaultFrameParams, connectionType: 'crab', postCountX: 3 });
    const posts = geom.connectors.filter((c) => c.axis === 'post');
    const cross = geom.connectors.filter((c) => c.axis === 'cross');
    expect(posts.length).toBeGreaterThan(0);
    expect(cross.length).toBeGreaterThan(0);
    expect(collectCrabLegendTypes(geom.connectors)).toEqual(expect.arrayContaining(['G', 'T', 'X']));
  });

  it('collectCrabLegendTypes lists only connector types present on view', () => {
    expect(collectCrabLegendTypes([{ type: 'G' }, { type: 'T' }])).toEqual(['G', 'T']);
    expect(collectCrabLegendTypes([{ type: 'T' }, { type: 'X' }])).toEqual(['T', 'X']);
    expect(collectCrabLegendTypes([{ type: 'G' }, { type: 'T' }, { type: 'X' }])).toEqual(['G', 'T', 'X']);
  });

  it('collectTopViewPlanConnectors uses top level only and keeps T crabs', () => {
    const geom = calculateFrameGeometry({ ...defaultFrameParams, postCountX: 3, connectionType: 'crab' });
    const topLevel = geom.levels[geom.levels.length - 1];
    const plan = collectTopViewPlanConnectors(geom, topLevel);
    const middlePost = plan.find((c) => Math.abs(c.x - 1500) < 1 && c.axis === 'post');
    expect(middlePost?.type).toBe('T');
    expect(plan.some((c) => c.type === 'T')).toBe(true);
    expect(plan.every((c) => Math.abs(c.z - topLevel) < 0.01)).toBe(true);
    expect(plan.some((c) => c.axis === 'cross' && c.type === 'T')).toBe(true);
  });

  it('measureTopViewDimMargins grows bottom inset for many beam segments', () => {
    const geom = calculateFrameGeometry({ ...defaultFrameParams, crossBeamsPerLevel: 8 });
    const small = measureTopViewDimMargins({ ...defaultFrameParams, crossBeamsPerLevel: 6 }, geom);
    const large = measureTopViewDimMargins({ ...defaultFrameParams, crossBeamsPerLevel: 8 }, geom);
    expect(large.bottom).toBeGreaterThanOrEqual(small.bottom);
    const areas = topViewLayoutAreas(PDF_LAYOUT.topBox, {
      hasLegend: true,
      legendTypes: ['G', 'T', 'X'],
      dimMargins: large,
    });
    expect(areas.drawing.h).toBeLessThan(PDF_LAYOUT.topBox.h - 20);
  });

  it('computeFrameOrthoZoom fits tall front view into wide viewport', () => {
    const size = [3000, 3200, 500];
    const zoom = computeFrameOrthoZoom('front', size, 900, 480);
    const visibleH = 480 / zoom;
    const visibleW = 900 / zoom;
    expect(visibleH).toBeGreaterThanOrEqual(3200 * 1.04);
    expect(visibleH).toBeLessThanOrEqual(3200 * 1.1);
    expect(visibleW).toBeGreaterThanOrEqual(3000 * 1.04);
    expect(zoom).toBeGreaterThan(0.08);
  });

  it('CRAB_COLORS defines distinct colors for G, T, X', () => {
    expect(CRAB_COLORS.G).not.toEqual(CRAB_COLORS.T);
    expect(CRAB_COLORS.T).not.toEqual(CRAB_COLORS.X);
    expect(CRAB_LABELS.G).toBe('Г');
  });

  it('tierTopMm returns top edge of tube for dimension anchors', () => {
    expect(levelCenterMm(0, 400, 400)).toBe(400);
    expect(tierTopMm(0, 400, 400, 20)).toBe(410);
    expect(tierTopMm(2, 400, 400, 20)).toBe(1210);
    expect(tierTopMm(2, 400, 400, 20) - tierTopMm(1, 400, 400, 20)).toBe(400);
  });

  it('beamElevationCenterZ aligns top closing tier with post top on side view', () => {
    const geom = calculateFrameGeometry(defaultFrameParams);
    const topZ = geom.levels[geom.levels.length - 1];
    expect(beamElevationCenterZ(topZ, geom, 20)).toBe(topZ - 10);
    expect(beamElevationCenterZ(geom.levels[0], geom, 20)).toBe(geom.levels[0]);
    expect(beamElevationCenterZ(topZ, geom, 20) + 10).toBe(topZ);
  });
});

describe('Frame saved presets', () => {
  let storage;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => {
        storage[key] = String(value);
      },
      removeItem: (key) => {
        delete storage[key];
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves, updates and deletes named presets in localStorage', () => {
    const created = saveFramePreset({
      name: 'Мой NFT 3000',
      params: { ...defaultFrameParams, lengthMm: 2800, name: 'Мой NFT 3000' },
    });

    expect(created.id).toMatch(/^frame_/);
    expect(created.name).toBe('Мой NFT 3000');
    expect(created.params.lengthMm).toBe(2800);

    const listed = listSavedFramePresets();
    expect(listed).toHaveLength(1);
    expect(getSavedFramePreset(created.id)?.name).toBe('Мой NFT 3000');

    const updated = saveFramePreset({
      id: created.id,
      name: 'Мой NFT 3200',
      params: { ...created.params, lengthMm: 3200, name: 'Мой NFT 3200' },
    });
    expect(updated.params.lengthMm).toBe(3200);
    expect(listSavedFramePresets()).toHaveLength(1);
    expect(getSavedFramePreset(created.id)?.name).toBe('Мой NFT 3200');

    deleteSavedFramePreset(created.id);
    expect(listSavedFramePresets()).toHaveLength(0);
    expect(storage[FRAME_PRESETS_STORAGE_KEY]).toBe('[]');
  });
});
