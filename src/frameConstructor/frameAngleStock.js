import { extractTubeCutsFromCutList } from './frameTubeStock.js';

export function perforatedAngleProfileLabel(angleProfile = '30×30') {
  return `перфорированный уголок ${angleProfile}`;
}

export function perforatedAngleProfileShort(angleProfile = '30×30') {
  return angleProfile;
}

/**
 * Packs a single angle stock plan, accounting for overlap.
 * @param {Array<{lengthMm: number}>} rawCuts
 * @param {Object} options
 */
export function calculateAngleStockPlan(rawCuts, options = {}) {
  const stockLengthsMm = [...(options.stockLengthsMm || [2000])].sort((a, b) => b - a);
  const maxStock = stockLengthsMm[0];
  const overlapMm = Math.max(0, typeof options.overlapMm === 'number' ? options.overlapMm : 150);
  const kerfMm = options.kerfMm || 0;

  const warnings = [];
  let totalSpliceCount = 0;
  let overlapMaterialMm = 0;

  const processedCuts = [];
  let hasLongCuts = false;

  for (const cut of rawCuts) {
    const L = cut.lengthMm;
    if (L <= maxStock) {
      processedCuts.push({ ...cut, originalLengthMm: L });
    } else {
      hasLongCuts = true;
      const effectiveOverlap = overlapMm > 0 ? overlapMm : 0;
      const divisor = maxStock - effectiveOverlap;
      const n = divisor > 0 ? Math.ceil((L - effectiveOverlap) / divisor) : 1;
      const spliceCount = n - 1;
      totalSpliceCount += spliceCount;
      overlapMaterialMm += spliceCount * effectiveOverlap;

      for (let i = 0; i < n - 1; i++) {
        processedCuts.push({
          id: cut.id,
          name: `${cut.name || 'Деталь'} (сегмент ${i + 1})`,
          lengthMm: maxStock,
          originalLengthMm: L,
          isSegment: true,
        });
      }
      const lastLen = L - (maxStock - effectiveOverlap) * (n - 1);
      processedCuts.push({
        id: cut.id,
        name: `${cut.name || 'Деталь'} (сегмент ${n})`,
        lengthMm: lastLen,
        originalLengthMm: L,
        isSegment: true,
      });
    }
  }

  if (hasLongCuts) {
    if (overlapMm > 0) {
      warnings.push(`Есть детали длиннее стандартного уголка. Для них добавлен нахлёст ${overlapMm} мм. Проверьте жёсткость конструкции.`);
    } else {
      warnings.push('Есть детали длиннее стандартного уголка. Для них потребуется стыковка без нахлёста.');
    }
  }

  const cuts = [...processedCuts].filter(c => c.lengthMm > 0).sort((a, b) => b.lengthMm - a.lengthMm);
  const bars = [];
  const stockCounts = {};
  for (const len of stockLengthsMm) {
    stockCounts[len] = 0;
  }

  let remainingCuts = [];
  for (const cut of cuts) {
    if (cut.lengthMm > maxStock) {
      warnings.push(`Есть резы длиннее ${maxStock} мм (например, ${cut.lengthMm} мм).`);
      bars.push({ lengthMm: maxStock, cuts: [cut], usedMm: cut.lengthMm });
      stockCounts[maxStock]++;
    } else {
      remainingCuts.push(cut);
    }
  }

  function packOneBar(cutsToPack, targetLen) {
    const C = targetLen + kerfMm;
    const n = cutsToPack.length;
    
    const dp = new Int32Array(C + 1).fill(-1);
    const keep = Array.from({ length: n }, () => new Uint8Array(C + 1));
    
    dp[0] = 0;
    
    for (let i = 0; i < n; i++) {
      const cut = cutsToPack[i];
      const w = cut.lengthMm + kerfMm;
      if (w > C) continue;
      
      for (let j = C; j >= w; j--) {
        if (dp[j - w] !== -1) {
          const newVal = dp[j - w] + cut.lengthMm;
          if (newVal > dp[j]) {
            dp[j] = newVal;
            keep[i][j] = 1;
          }
        }
      }
    }
    
    let bestJ = 0;
    for (let j = 0; j <= C; j++) {
      if (dp[j] > dp[bestJ]) {
        bestJ = j;
      }
    }
    
    const packedIndices = [];
    let currW = bestJ;
    for (let i = n - 1; i >= 0; i--) {
      if (keep[i][currW]) {
        packedIndices.push(i);
        currW -= (cutsToPack[i].lengthMm + kerfMm);
      }
    }
    
    return packedIndices;
  }

  while (remainingCuts.length > 0) {
    const firstCut = remainingCuts[0];
    const restCuts = remainingCuts.slice(1);
    
    let bestStock = maxStock;
    let bestIndices = [];
    let bestRatio = -1;

    for (const stock of stockLengthsMm) {
      if (firstCut.lengthMm > stock) continue;
      
      const capacityForRest = stock - firstCut.lengthMm - kerfMm;
      let indices = [];
      if (capacityForRest >= 0) {
        indices = packOneBar(restCuts, capacityForRest);
      }
      
      const totalCutsCount = 1 + indices.length;
      let sumL = firstCut.lengthMm;
      for (const idx of indices) {
        sumL += restCuts[idx].lengthMm;
      }
      
      const exactUsedWithKerf = sumL + (totalCutsCount - 1) * kerfMm;
      const ratio = exactUsedWithKerf / stock;
      
      if (ratio > bestRatio + 0.0001 || (Math.abs(ratio - bestRatio) <= 0.0001 && stock > bestStock)) {
        bestRatio = ratio;
        bestStock = stock;
        bestIndices = indices;
      }
    }
    
    if (bestRatio === -1) {
       bestStock = maxStock;
       bestIndices = [];
    }
    
    const packedCuts = [firstCut];
    for (const idx of bestIndices) {
      packedCuts.push(restCuts[idx]);
    }
    
    const usedMm = packedCuts.reduce((sum, c) => sum + c.lengthMm, 0) + (packedCuts.length > 0 ? (packedCuts.length - 1) * kerfMm : 0);
    
    bars.push({ lengthMm: bestStock, cuts: packedCuts, usedMm });
    stockCounts[bestStock]++;
    
    const idxSet = new Set(bestIndices);
    remainingCuts = restCuts.filter((_, i) => !idxSet.has(i));
  }
  
  const cleanCutLengthMm = rawCuts.reduce((sum, c) => sum + c.lengthMm, 0);
  const totalCutLengthMm = cleanCutLengthMm + overlapMaterialMm;
  const totalStockLengthMm = bars.reduce((sum, b) => sum + b.lengthMm, 0);
  const wasteMm = totalStockLengthMm - totalCutLengthMm;
  const utilizationRatio = totalStockLengthMm > 0 ? totalCutLengthMm / totalStockLengthMm : 0;
  
  return {
    stockLengthsMm,
    stockCounts,
    totalCutLengthMm,
    totalStockLengthMm,
    wasteMm,
    utilizationRatio,
    bars,
    warnings,
    totalSpliceCount,
    overlapMaterialMm,
    cleanCutLengthMm,
    requiredCutLengthMm: totalCutLengthMm,
  };
}

/**
 * Calculates different angle stock options.
 * @param {Array<{lengthMm: number}>} cutList 
 * @param {Object} options 
 */
export function calculateAngleStockOptions(cutList, options = {}) {
  const overlapMm = typeof options.overlapMm === 'number' ? options.overlapMm : 150;
  const kerfMm = options.kerfMm || 0;
  
  const rawCuts = extractTubeCutsFromCutList(cutList);
  
  if (rawCuts.length === 0) {
    return {
      recommended: null,
      options: []
    };
  }
  
  const opts = [];
  
  const only2000 = calculateAngleStockPlan(rawCuts, { stockLengthsMm: [2000], overlapMm, kerfMm });
  only2000.key = "only_2000";
  only2000.title = "Только 2 м";
  opts.push(only2000);
  
  const only2500 = calculateAngleStockPlan(rawCuts, { stockLengthsMm: [2500], overlapMm, kerfMm });
  only2500.key = "only_2500";
  only2500.title = "Только 2.5 м";
  opts.push(only2500);
  
  const auto2000_2500 = calculateAngleStockPlan(rawCuts, { stockLengthsMm: [2500, 2000], overlapMm, kerfMm });
  auto2000_2500.key = "auto_2000_2500";
  auto2000_2500.title = "Автоподбор 2 м / 2.5 м";
  auto2000_2500.description = "Алгоритм сам выбирает 2 м и 2.5 м по минимальному отходу.";
  opts.push(auto2000_2500);

  only2000.warnings = [...new Set(only2000.warnings)];
  only2500.warnings = [...new Set(only2500.warnings)];
  auto2000_2500.warnings = [...new Set(auto2000_2500.warnings)];
  
  let recommended = null;
  const validOpts = opts.filter(o => o.warnings.length === 0);
  const candidateOpts = validOpts.length > 0 ? validOpts : opts;
  
  let best = candidateOpts[0];
  for (let i = 1; i < candidateOpts.length; i++) {
    const current = candidateOpts[i];
    if (current.warnings.length < best.warnings.length) {
      best = current;
    } else if (current.warnings.length === best.warnings.length) {
      if (current.wasteMm < best.wasteMm) {
        best = current;
      } else if (current.wasteMm === best.wasteMm) {
        if (current.totalStockLengthMm < best.totalStockLengthMm) {
          best = current;
        } else if (current.totalStockLengthMm === best.totalStockLengthMm) {
          if (current.bars.length < best.bars.length) {
            best = current;
          } else if (current.bars.length === best.bars.length) {
            if (current.key === 'auto_2000_2500') {
              best = current;
            }
          }
        }
      }
    }
  }
  
  recommended = best;
  
  return {
    recommended,
    options: opts
  };
}

/**
 * Calculates fasteners for perforated angle construction.
 * @param {Array|Object} frameDataOrCutList 
 * @param {Object} options 
 */
export function calculateAngleFasteners(frameDataOrCutList, options = {}) {
  let postCount = 0;
  let longitudinalBeamCount = 0;
  let crossBeamCount = 0;

  if (Array.isArray(frameDataOrCutList)) {
    for (const item of frameDataOrCutList) {
      if (item.id === 'post') postCount += item.qty;
      if (item.id === 'longitudinal') longitudinalBeamCount += item.qty;
      if (item.id === 'cross') crossBeamCount += item.qty;
    }
  } else if (frameDataOrCutList && typeof frameDataOrCutList === 'object') {
    if (frameDataOrCutList.posts) postCount = frameDataOrCutList.posts.length;
    else if (frameDataOrCutList.postCount) postCount = frameDataOrCutList.postCount;

    if (frameDataOrCutList.longitudinalBeams) longitudinalBeamCount = frameDataOrCutList.longitudinalBeams.length;
    else if (frameDataOrCutList.longitudinalBeamCount) longitudinalBeamCount = frameDataOrCutList.longitudinalBeamCount;

    if (frameDataOrCutList.crossBeams) crossBeamCount = frameDataOrCutList.crossBeams.length;
    else if (frameDataOrCutList.crossBeamCount) crossBeamCount = frameDataOrCutList.crossBeamCount;
  }

  const crossBeamFasteningMode = options.crossBeamFasteningMode || 'bolts_only';

  const longitudinalJointCount = longitudinalBeamCount * 2;
  const longitudinalFasteningAngles = longitudinalJointCount;
  const longitudinalBoltsM6x20 = longitudinalJointCount * 3;
  const longitudinalNutsM6 = longitudinalJointCount * 3;
  const longitudinalGrowersM6 = longitudinalJointCount * 3;

  let crossBeamFasteningAngles = 0;
  let crossBeamBolts = 0;
  let crossBeamNuts = 0;
  let crossBeamGrowers = 0;

  if (crossBeamFasteningMode === 'brackets') {
    const crossBeamBracketJointCount = crossBeamCount * 2;
    crossBeamFasteningAngles = crossBeamBracketJointCount;
    crossBeamBolts = crossBeamBracketJointCount * 3;
    crossBeamNuts = crossBeamBracketJointCount * 3;
    crossBeamGrowers = crossBeamBracketJointCount * 3;
  } else {
    crossBeamFasteningAngles = 0;
    crossBeamBolts = crossBeamCount * 2;
    crossBeamNuts = crossBeamCount * 2;
    crossBeamGrowers = crossBeamCount * 2;
  }

  const fasteningAngles = longitudinalFasteningAngles + crossBeamFasteningAngles;
  const boltsM6x20 = longitudinalBoltsM6x20 + crossBeamBolts;
  const nutsM6 = longitudinalNutsM6 + crossBeamNuts;
  const growersM6 = longitudinalGrowersM6 + crossBeamGrowers;
  const footPlates = postCount;

  return {
    postCount,
    longitudinalBeamCount,
    crossBeamCount,
    crossBeamFasteningMode,
    fasteningAngles,
    boltsM6x20,
    nutsM6,
    growersM6,
    footPlates,
  };
}

/**
 * Returns both fastener calculation variants for UI/PDF.
 * @param {Array|Object} frameDataOrCutList
 */
export function calculateAngleFastenerVariants(frameDataOrCutList) {
  return {
    variantA: calculateAngleFasteners(frameDataOrCutList, { crossBeamFasteningMode: 'bolts_only' }),
    variantB: calculateAngleFasteners(frameDataOrCutList, { crossBeamFasteningMode: 'brackets' }),
  };
}

/**
 * Builds compact fastener table rows for UI/PDF/tests.
 * @param {Object} fasteners
 * @param {string} angleProfile
 */
export function buildAngleFastenerTableRows(fasteners, angleProfile = '30×30') {
  const rows = [];
  if (fasteners.fasteningAngles > 0) {
    rows.push({ name: 'Крепёжный уголок', profile: angleProfile, qty: fasteners.fasteningAngles, note: 'Оцинкованный крепёжный уголок' });
  }
  if (fasteners.boltsM6x20 > 0) {
    rows.push({ name: 'Болт М6×20', profile: 'М6', qty: fasteners.boltsM6x20, note: 'Для сборки каркаса' });
  }
  if (fasteners.nutsM6 > 0) {
    rows.push({ name: 'Гайка М6', profile: 'М6', qty: fasteners.nutsM6, note: 'Для сборки каркаса' });
  }
  if (fasteners.growersM6 > 0) {
    rows.push({ name: 'Гровер М6', profile: 'М6', qty: fasteners.growersM6, note: 'Для сборки каркаса' });
  }
  if (fasteners.footPlates > 0) {
    rows.push({ name: 'Подпятник пластиковый', profile: angleProfile, qty: fasteners.footPlates, note: 'Заглушка/подпятник для стоек' });
  }
  return rows;
}

/**
 * Expands cuts by adding overlap when they are longer than standard stock.
 * @param {Array<{lengthMm: number}>} cuts 
 * @param {Object} options 
 */
export function expandAngleCutsWithOverlap(cuts, options = {}) {
  const stockLengthMm = options.stockLengthMm || 2000;
  const overlapMm = Math.max(0, typeof options.overlapMm === 'number' ? options.overlapMm : 150);

  let totalSpliceCount = 0;
  const expandedCuts = cuts.map(cut => {
    const L = cut.lengthMm;
    if (L <= stockLengthMm) {
      return {
        ...cut,
        rawCutLength: L,
        spliceCount: 0,
      };
    } else {
      const effectiveOverlap = overlapMm > 0 ? overlapMm : 0;
      const divisor = stockLengthMm - effectiveOverlap;
      const n = divisor > 0 ? Math.ceil((L - effectiveOverlap) / divisor) : 1;
      const spliceCount = n - 1;
      const rawCutLength = L + effectiveOverlap * spliceCount;
      totalSpliceCount += spliceCount;
      return {
        ...cut,
        lengthMm: rawCutLength,
        rawCutLength,
        spliceCount,
        originalLengthMm: L,
      };
    }
  });

  return {
    cuts: expandedCuts,
    totalSpliceCount,
  };
}
