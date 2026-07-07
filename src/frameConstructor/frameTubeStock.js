/**
 * @typedef {Object} CutItem
 * @property {string} id
 * @property {number} lengthMm
 */

/**
 * Calculates a single tube stock plan using first-fit decreasing algorithm.
 * @param {Array<{lengthMm: number}>} rawCuts - Array of individual cuts.
 * @param {Object} options 
 * @param {number[]} options.stockLengthsMm - Available stock lengths (e.g. [6000] or [3000]).
 * @param {number} options.kerfMm - Kerf thickness.
 * @returns {Object}
 */
export function calculateTubeStockPlan(rawCuts, options = {}) {
  const stockLengthsMm = [...(options.stockLengthsMm || [6000])].sort((a, b) => b - a);
  const kerfMm = options.kerfMm || 0;
  
  const cuts = [...rawCuts].filter(c => c.lengthMm > 0).sort((a, b) => b.lengthMm - a.lengthMm);
  
  const bars = [];
  const warnings = [];
  const stockCounts = {};
  for (const len of stockLengthsMm) {
    stockCounts[len] = 0;
  }
  
  const maxStock = stockLengthsMm[0];
  
  let remainingCuts = [];
  for (const cut of cuts) {
    if (cut.lengthMm > maxStock) {
      warnings.push(`Есть резы длиннее ${maxStock} мм (например, ${cut.lengthMm} мм). Из трубы ${maxStock / 1000} м их нельзя сделать цельными. Нужна стыковка, изменение конструкции или более длинная труба.`);
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
    let bestWaste = Infinity;

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
      const waste = stock - exactUsedWithKerf;
      const ratio = exactUsedWithKerf / stock;
      
      if (ratio > bestRatio + 0.0001 || (Math.abs(ratio - bestRatio) <= 0.0001 && stock > bestStock)) {
        bestRatio = ratio;
        bestWaste = waste;
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
  
  const totalCutLengthMm = rawCuts.reduce((sum, c) => sum + c.lengthMm, 0);
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
    warnings
  };
}

/**
 * Calculates different tube stock options.
 * @param {Array<{lengthMm: number}>} rawCuts 
 * @param {Object} options 
 */
export function calculateTubeStockOptions(rawCuts, options = {}) {
  const stockLengthsMm = options.stockLengthsMm || [3000, 6000];
  const kerfMm = options.kerfMm || 0;
  
  if (rawCuts.length === 0) {
    return {
      recommended: null,
      options: []
    };
  }
  
  const opts = [];
  
  const only6000 = calculateTubeStockPlan(rawCuts, { stockLengthsMm: [6000], kerfMm });
  only6000.key = "only_6000";
  only6000.title = "Только 6 м";
  opts.push(only6000);
  
  const only3000 = calculateTubeStockPlan(rawCuts, { stockLengthsMm: [3000], kerfMm });
  only3000.key = "only_3000";
  only3000.title = "Только 3 м";
  opts.push(only3000);
  
  // Mixed: first try to group into 3000s, then 6000s
  const mixed = calculateTubeStockPlan(rawCuts, { stockLengthsMm: [6000, 3000], kerfMm });
  mixed.key = "mixed_3000_6000";
  mixed.title = "Автоподбор 3 м / 6 м";
  mixed.description = "Алгоритм сам выбирает 3 м и 6 м по минимальному отходу. В этом варианте он может выбрать только 6 м, если так выгоднее.";
  opts.push(mixed);

  // Deduplicate warnings
  only6000.warnings = [...new Set(only6000.warnings)];
  only3000.warnings = [...new Set(only3000.warnings)];
  mixed.warnings = [...new Set(mixed.warnings)];
  
  // Determine recommended option
  let recommended = null;
  
  const validOpts = opts.filter(o => o.warnings.length === 0);
  const candidateOpts = validOpts.length > 0 ? validOpts : opts; // fallback if all have warnings
  
  // Find the one with minimum waste
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
            // prefer 6m over mixed if identical
            if (current.key === 'only_6000') {
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

export function extractTubeCutsFromCutList(cutList) {
  const cuts = [];
  for (const item of cutList) {
    if (!item.id || item.id.startsWith('connector') || item.id.startsWith('nft-channel')) {
      continue;
    }
    const len = Number(item.length);
    const qty = Number(item.qty);
    if (!isNaN(len) && len > 0 && !isNaN(qty) && qty > 0) {
      for (let i = 0; i < qty; i++) {
        cuts.push({ id: item.id, lengthMm: len, name: item.name });
      }
    }
  }
  return cuts;
}
