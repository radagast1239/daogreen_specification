import { describe, it, expect } from 'vitest';
import { calculateTubeStockPlan, calculateTubeStockOptions, extractTubeCutsFromCutList } from '../src/frameConstructor/frameTubeStock.js';

describe('frameTubeStock', () => {
  it('calculateTubeStockPlan only_6000', () => {
    const cuts = [
      { lengthMm: 3200 },
      { lengthMm: 3200 },
      { lengthMm: 1470 },
      { lengthMm: 1470 },
    ];
    const plan = calculateTubeStockPlan(cuts, { stockLengthsMm: [6000] });
    expect(plan.bars.length).toBe(2);
    expect(plan.totalCutLengthMm).toBe(9340);
    expect(plan.totalStockLengthMm).toBe(12000);
    expect(plan.wasteMm).toBe(2660);
    expect(plan.stockCounts[6000]).toBe(2);
    expect(plan.warnings.length).toBe(0);
  });

  it('packs base frame into 15 six-meter tubes', () => {
    // 6x3200, 32x1470, 48x460
    const cuts = [];
    for (let i = 0; i < 6; i++) cuts.push({ lengthMm: 3200 });
    for (let i = 0; i < 32; i++) cuts.push({ lengthMm: 1470 });
    for (let i = 0; i < 48; i++) cuts.push({ lengthMm: 460 });

    const plan = calculateTubeStockPlan(cuts, { stockLengthsMm: [6000], kerfMm: 0 });
    
    console.log(plan.bars.map(b => b.cuts.map(c => c.lengthMm)));
    
    expect(plan.stockCounts[6000]).toBe(15);
    expect(plan.totalStockLengthMm).toBe(90000);
    expect(plan.totalCutLengthMm).toBe(88320);
    expect(plan.wasteMm).toBe(1680);
    expect(plan.warnings.length).toBe(0);
  });

  it('keeps only_3000 option with warning when cuts exceed 3000', () => {
    const cuts = [{ lengthMm: 3200 }];
    const result = calculateTubeStockOptions(cuts);
    const only3000 = result.options.find(o => o.key === 'only_3000');
    expect(only3000).toBeTruthy();
    expect(only3000.warnings.length).toBeGreaterThan(0);
    expect(only3000.warnings[0]).toContain('3200 мм');
    expect(only3000.warnings[0]).toContain('Из трубы 3 м их нельзя сделать цельными');
  });

  it('keeps mixed option but does not recommend it when only_6000 has lower waste', () => {
    // 6x3200, 32x1470, 48x460
    const cuts = [];
    for (let i = 0; i < 6; i++) cuts.push({ lengthMm: 3200 });
    for (let i = 0; i < 32; i++) cuts.push({ lengthMm: 1470 });
    for (let i = 0; i < 48; i++) cuts.push({ lengthMm: 460 });

    const result = calculateTubeStockOptions(cuts);
    const mixed = result.options.find(o => o.key === 'mixed_3000_6000');
    expect(mixed).toBeTruthy();
    expect(result.recommended.key).not.toBe('mixed_3000_6000');
  });

  it('recommended is only_6000 for base 3000x500x7 frame', () => {
    const cuts = [];
    for (let i = 0; i < 6; i++) cuts.push({ lengthMm: 3200 });
    for (let i = 0; i < 32; i++) cuts.push({ lengthMm: 1470 });
    for (let i = 0; i < 48; i++) cuts.push({ lengthMm: 460 });

    const result = calculateTubeStockOptions(cuts);
    expect(result.recommended.key).toBe('only_6000');
    expect(result.recommended.wasteMm).toBe(1680);
  });

  it('all options are still returned', () => {
    const cuts = [{ lengthMm: 1470 }];
    const result = calculateTubeStockOptions(cuts);
    expect(result.options.map(o => o.key)).toEqual(['only_6000', 'only_3000', 'mixed_3000_6000']);
    expect(result.recommended).toBeTruthy();
  });
});
