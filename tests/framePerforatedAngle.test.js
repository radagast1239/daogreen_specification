import { describe, it, expect } from 'vitest';
import {
  calculateAngleStockPlan,
  calculateAngleStockOptions,
  calculateAngleFasteners,
  calculateAngleFastenerVariants,
  expandAngleCutsWithOverlap,
  buildAngleFastenerTableRows,
  perforatedAngleProfileLabel,
} from '../src/frameConstructor/frameAngleStock.js';
import { prepareFramePdfData } from '../src/frameConstructor/framePdfData.js';
import { generateCutList } from '../src/frameConstructor/frameCutList.js';
import { calculateFrameGeometry } from '../src/frameConstructor/frameGeometry.js';

function makeCutList(items) {
  return items.map(({ id, length, qty }) => ({ id, name: id, length, qty }));
}

function expandCuts(items) {
  const cuts = [];
  for (const { length, qty } of items) {
    for (let i = 0; i < qty; i++) cuts.push({ lengthMm: length });
  }
  return cuts;
}

describe('framePerforatedAngle', () => {
  it('Returns angle purchase options: only_2000, only_2500, auto_2000_2500', () => {
    const cuts = makeCutList([
      { id: 'post', length: 1500, qty: 1 },
      { id: 'longitudinal', length: 1470, qty: 1 },
    ]);
    const result = calculateAngleStockOptions(cuts, { overlapMm: 150 });

    expect(result.options.map(o => o.key)).toContain('only_2000');
    expect(result.options.map(o => o.key)).toContain('only_2500');
    expect(result.options.map(o => o.key)).toContain('auto_2000_2500');
  });

  it('does not add overlap when all angle cuts fit 2000', () => {
    const cutList = makeCutList([
      { id: 'post', length: 1900, qty: 4 },
      { id: 'longitudinal', length: 1260, qty: 12 },
      { id: 'cross', length: 660, qty: 18 },
    ]);
    const result = calculateAngleStockOptions(cutList, { overlapMm: 150 });
    const only2000 = result.options.find(o => o.key === 'only_2000');

    expect(only2000.cleanCutLengthMm).toBe(34600);
    expect(only2000.totalSpliceCount).toBe(0);
    expect(only2000.overlapMaterialMm).toBe(0);
    expect(only2000.requiredCutLengthMm).toBe(34600);
    expect(only2000.stockCounts[2000]).toBe(18);
    expect(only2000.totalStockLengthMm).toBe(36000);
    expect(only2000.wasteMm).toBe(1400);
    expect(only2000.warnings).toEqual([]);
  });

  it('packs 1900/1260/660 angle scenario into 18 two-meter angles', () => {
    const rawCuts = expandCuts([
      { length: 1900, qty: 4 },
      { length: 1260, qty: 12 },
      { length: 660, qty: 18 },
    ]);
    const plan = calculateAngleStockPlan(rawCuts, { stockLengthsMm: [2000], overlapMm: 150 });

    expect(plan.stockCounts[2000]).toBe(18);
    expect(plan.totalStockLengthMm).toBe(36000);
    expect(plan.cleanCutLengthMm).toBe(34600);
    expect(plan.overlapMaterialMm).toBe(0);
    expect(plan.requiredCutLengthMm).toBe(34600);
    expect(plan.wasteMm).toBe(1400);
    expect(plan.warnings).toEqual([]);
  });

  it('adds overlap only for cuts longer than selected stock', () => {
    const cutList = makeCutList([
      { id: 'post', length: 3200, qty: 4 },
      { id: 'longitudinal', length: 1260, qty: 16 },
      { id: 'cross', length: 660, qty: 24 },
    ]);
    const result = calculateAngleStockOptions(cutList, { overlapMm: 150 });
    const only2000 = result.options.find(o => o.key === 'only_2000');

    expect(only2000.cleanCutLengthMm).toBe(48800);
    expect(only2000.totalSpliceCount).toBe(4);
    expect(only2000.overlapMaterialMm).toBe(600);
    expect(only2000.requiredCutLengthMm).toBe(49400);
    expect(only2000.warnings.length).toBeGreaterThan(0);
  });

  it('Adds overlap for 3200 mm post: spliceCount = 1, rawCutLength = 3350 mm at overlap 150', () => {
    const cuts = [{ lengthMm: 3200 }];
    const expanded = expandAngleCutsWithOverlap(cuts, { stockLengthMm: 2500, overlapMm: 150 });

    expect(expanded.cuts[0].spliceCount).toBe(1);
    expect(expanded.cuts[0].rawCutLength).toBe(3350);
    expect(expanded.totalSpliceCount).toBe(1);

    const plan2500 = calculateAngleStockPlan(cuts, { stockLengthsMm: [2500], overlapMm: 150 });
    expect(plan2500.totalSpliceCount).toBe(1);
    expect(plan2500.warnings.length).toBeGreaterThan(0);
  });

  it('allows overlap 0 for long posts without overlap material', () => {
    const cuts = [{ lengthMm: 3200 }];
    const plan = calculateAngleStockPlan(cuts, { stockLengthsMm: [2000], overlapMm: 0 });
    expect(plan.totalSpliceCount).toBe(1);
    expect(plan.overlapMaterialMm).toBe(0);
    expect(plan.requiredCutLengthMm).toBe(3200);
  });

  it('returns both fastener variants for 3200×4 / 1260×16 / 660×24', () => {
    const frameData = {
      postCount: 4,
      longitudinalBeamCount: 16,
      crossBeamCount: 24,
    };
    const variants = calculateAngleFastenerVariants(frameData);

    expect(variants.variantA.fasteningAngles).toBe(32);
    expect(variants.variantA.boltsM6x20).toBe(144);
    expect(variants.variantA.nutsM6).toBe(144);
    expect(variants.variantA.growersM6).toBe(144);
    expect(variants.variantA.footPlates).toBe(4);

    expect(variants.variantB.fasteningAngles).toBe(80);
    expect(variants.variantB.boltsM6x20).toBe(240);
    expect(variants.variantB.nutsM6).toBe(240);
    expect(variants.variantB.growersM6).toBe(240);
    expect(variants.variantB.footPlates).toBe(4);
  });

  it('returns both fastener variants for 1900×4 / 1260×12 / 660×18', () => {
    const frameData = {
      postCount: 4,
      longitudinalBeamCount: 12,
      crossBeamCount: 18,
    };
    const variants = calculateAngleFastenerVariants(frameData);

    expect(variants.variantA.fasteningAngles).toBe(24);
    expect(variants.variantA.boltsM6x20).toBe(108);
    expect(variants.variantA.footPlates).toBe(4);

    expect(variants.variantB.fasteningAngles).toBe(60);
    expect(variants.variantB.boltsM6x20).toBe(180);
    expect(variants.variantB.footPlates).toBe(4);
  });

  it('Base scenario 3000×500×7: posts = 6, longitudinalBeams = 32, crossBeams = 48', () => {
    const frameData = {
      postCount: 6,
      longitudinalBeamCount: 32,
      crossBeamCount: 48,
    };

    const fastenersNoBrackets = calculateAngleFasteners(frameData, { crossBeamFasteningMode: 'bolts_only' });
    expect(fastenersNoBrackets.fasteningAngles).toBe(64);
    expect(fastenersNoBrackets.boltsM6x20).toBe(288);
    expect(fastenersNoBrackets.nutsM6).toBe(288);
    expect(fastenersNoBrackets.growersM6).toBe(288);
    expect(fastenersNoBrackets.footPlates).toBe(6);

    const fastenersWithBrackets = calculateAngleFasteners(frameData, { crossBeamFasteningMode: 'brackets' });
    expect(fastenersWithBrackets.fasteningAngles).toBe(160);
    expect(fastenersWithBrackets.boltsM6x20).toBe(480);
    expect(fastenersWithBrackets.nutsM6).toBe(480);
    expect(fastenersWithBrackets.growersM6).toBe(480);
    expect(fastenersWithBrackets.footPlates).toBe(6);
  });

  it('compact fastener table rows do not include photo column', () => {
    const rows = buildAngleFastenerTableRows({
      fasteningAngles: 32,
      boltsM6x20: 144,
      nutsM6: 144,
      growersM6: 144,
      footPlates: 4,
    }, '30×30');

    expect(rows.length).toBe(5);
    expect(rows.every(r => 'name' in r && 'qty' in r && !('photo' in r))).toBe(true);
    expect(rows[0].name).toBe('Крепёжный уголок');
  });

  it('profile label is not duplicated', () => {
    expect(perforatedAngleProfileLabel('30×30')).toBe('перфорированный уголок 30×30');
    expect(perforatedAngleProfileLabel('30×30')).not.toContain('уголок уголок');
  });

  it('constructionType=tube_crab does not break old logic', () => {
    const params = {
      name: 'Тест крабы',
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
      connectionType: 'crab',
      constructionType: 'tube_crab',
    };

    const geom = calculateFrameGeometry(params);
    const cutList = generateCutList(params);

    const crabsInCutlist = cutList.filter(item => item.id?.startsWith('connector-'));
    expect(crabsInCutlist.length).toBeGreaterThan(0);

    const pdfData = prepareFramePdfData(params, geom, cutList);
    expect(pdfData.hardwareRows.length).toBeGreaterThan(0);
    expect(pdfData.angleStock).toBeNull();
  });

  it('constructionType=perforated_angle hides crab BOM and shows angle BOM', () => {
    const params = {
      name: 'Тест уголок',
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
      connectionType: 'crab',
      constructionType: 'perforated_angle',
    };

    const geom = calculateFrameGeometry(params);
    const cutList = generateCutList(params);

    const crabsInCutlist = cutList.filter(item => item.id?.startsWith('connector-'));
    expect(crabsInCutlist.length).toBe(0);

    const bolts = cutList.filter(item => item.id === 'bolt-m6');
    expect(bolts.length).toBe(0);

    const pdfData = prepareFramePdfData(params, geom, cutList);
    expect(pdfData.angleStock).not.toBeNull();
    expect(pdfData.angleFasteners.variantA).toBeTruthy();
    expect(pdfData.angleFasteners.variantB).toBeTruthy();
    expect(pdfData.tubeStock).toBeNull();
    expect(pdfData.dimensions.profile).toBe('перфорированный уголок 30×30');
    expect(pdfData.dimensions.profile).not.toContain('уголок уголок');
    expect(pdfData.constructionLabel).toBe('Перфорированный уголок 30×30');
    expect(pdfData.profileKind).toBe('angle');
    expect(pdfData.showAngleVisual).toBe(true);
    expect(pdfData.hardwareRows.length).toBe(0);
    expect(pdfData.notes.some((n) => n.includes('уголков'))).toBe(true);
    expect(pdfData.paramsList.some(([k]) => k === 'Тип конструкции')).toBe(true);
  });

  it('tube_crab pdf data does not expose angle visual mode', () => {
    const params = {
      name: 'Тест крабы',
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
      connectionType: 'crab',
      constructionType: 'tube_crab',
    };
    const geom = calculateFrameGeometry(params);
    const cutList = generateCutList(params);
    const pdfData = prepareFramePdfData(params, geom, cutList);
    expect(pdfData.profileKind).toBe('tube');
    expect(pdfData.showAngleVisual).toBe(false);
    expect(pdfData.constructionLabel).not.toContain('Перфорированный уголок');
  });

  it('angle visual helpers detect perforated angle mode', () => {
    const angleParams = { constructionType: 'perforated_angle', angleProfile: '30×30' };
    const tubeParams = { constructionType: 'tube_crab' };
    expect(angleParams.constructionType).toBe('perforated_angle');
    expect(tubeParams.constructionType).not.toBe('perforated_angle');
  });
});
