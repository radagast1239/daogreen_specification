/** Frame BOM → purchase draft mapping (pure functions, no DB writes). */

export const FRAME_BOM_MATERIALS = {
  profile_tube_20x20: {
    materialId: "m036",
    name: "Труба профильная 20/20/1,5 мм",
    unit: "м",
    mode: "pipe_cuts",
  },
  perforated_angle_30x30_2000: {
    materialId: "m_ohPQJOXcD2",
    name: "Перфорированный уголок 30×30, 2 м",
    unit: "шт",
    mode: "stock_piece",
  },
  perforated_angle_30x30_2500: {
    materialId: "m_9CA2mrfCes",
    name: "Перфорированный уголок 30×30, 2.5 м",
    unit: "шт",
    mode: "stock_piece",
  },
  fastening_angle: {
    materialId: "m_kD_04AXymn",
    name: "Крепёжный уголок",
    unit: "шт",
  },
  bolt_m6x20: {
    materialId: "m073",
    name: "Болт М6×20",
    unit: "шт",
  },
  nut_m6: {
    materialId: "m074",
    name: "Гайка М6",
    unit: "шт",
  },
  spring_washer_m6: {
    materialId: "m075",
    name: "Шайба гроверная М6",
    unit: "шт",
  },
  foot_plate: {
    materialId: "m_XnLhEmrLio",
    name: "Подпятник / заглушка опоры",
    unit: "шт",
  },
  crab_g: {
    materialId: "m072",
    name: "Краб-система Г-образная 20×20, 1.2 мм",
    unit: "шт",
  },
  crab_t: {
    materialId: "m071",
    name: "Краб-система Т-образная 20×20, 1.2 мм",
    unit: "шт",
  },
  crab_x: {
    materialId: "m003",
    name: "Краб-система X-образная 20×20, 1,2 мм",
    unit: "шт",
  },
  crab_a4: {
    materialId: "m_Vsbox6xIlT",
    name: "Краб-система A4",
    unit: "компл.",
  },
  crab_a6: {
    materialId: "m__aFEHKzJpe",
    name: "Краб-система A6",
    unit: "шт",
  },
};

const TUBE_CUT_IDS = new Set(["post", "longitudinal", "cross"]);

const CONNECTOR_TO_KEY = {
  "connector-g": "crab_g",
  "connector-t": "crab_t",
  "connector-x": "crab_x",
  "connector-a4": "crab_a4",
  "connector-a6": "crab_a6",
};

const EXCLUDED_TUBE_MATERIAL_IDS = new Set(["m_duCvR9Oz2Q", "m_W4-F6fVebH"]);

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function formatSegmentsNote(pipeCuts) {
  if (!pipeCuts?.length) return "";
  return pipeCuts.map((c) => `${c.lengthMm} мм × ${c.qty} шт`).join(", ");
}

function baseDraft(key, overrides = {}) {
  const spec = FRAME_BOM_MATERIALS[key];
  if (!spec) return null;
  return {
    key,
    materialId: spec.materialId,
    name: spec.name,
    unit: spec.unit,
    qty: 0,
    pipeCuts: [],
    techNote: "",
    source: "frame_bom",
    sourceType: "frame_bom",
    sourceFrameDrawingId: "",
    sourceRackKey: "",
    ...overrides,
  };
}

function withSource(overrides, frameData) {
  return {
    ...overrides,
    sourceFrameDrawingId: frameData.sourceFrameDrawingId || "",
    sourceRackKey: frameData.sourceRackKey || "",
  };
}

function formatTubeStockTechNote(tubeStock) {
  const rec = tubeStock?.recommended;
  if (!rec) return "";
  const parts = [];
  if (rec.title) parts.push(`Рекомендованный хлыст: ${rec.title}`);
  const counts = rec.stockCounts || {};
  for (const len of Object.keys(counts).map(Number).sort((a, b) => b - a)) {
    const qty = counts[len];
    if (qty > 0) parts.push(`${len / 1000} м — ${qty} шт`);
  }
  if (rec.warnings?.length) parts.push(rec.warnings.join("; "));
  return parts.join(". ");
}

/**
 * @param {Array<{id: string, length?: number, qty?: number}>} cutList
 * @returns {Array<{lengthMm: number, qty: number}>}
 */
export function normalizeFrameCutSegments(cutList) {
  const byLen = new Map();
  for (const item of cutList || []) {
    if (!TUBE_CUT_IDS.has(item.id)) continue;
    const lengthMm = Math.round(Number(item.length));
    const qty = Number(item.qty) || 0;
    if (!lengthMm || qty <= 0) continue;
    byLen.set(lengthMm, (byLen.get(lengthMm) || 0) + qty);
  }
  return [...byLen.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([lengthMm, qty]) => ({ lengthMm, qty }));
}

export function totalPipeCutMeters(pipeCuts) {
  const totalMm = (pipeCuts || []).reduce((sum, c) => sum + c.lengthMm * c.qty, 0);
  return round2(totalMm / 1000);
}

/**
 * @param {{ cutList?: object[], tubeStock?: object, sourceFrameDrawingId?: string, sourceRackKey?: string }} frameData
 */
export function buildTubeCrabBomPurchaseDraft(frameData = {}) {
  const items = [];
  const pipeCuts = normalizeFrameCutSegments(frameData.cutList);

  if (pipeCuts.length > 0) {
    const techParts = [`Резы профтрубы: ${formatSegmentsNote(pipeCuts)}`];
    const stockNote = formatTubeStockTechNote(frameData.tubeStock);
    if (stockNote) techParts.push(stockNote);

    items.push(
      baseDraft(
        "profile_tube_20x20",
        withSource(
          {
            qty: totalPipeCutMeters(pipeCuts),
            pipeCuts,
            techNote: techParts.join(". "),
          },
          frameData,
        ),
      ),
    );
  }

  for (const row of frameData.cutList || []) {
    const key = CONNECTOR_TO_KEY[row.id];
    if (!key) continue;
    const qty = Number(row.qty) || 0;
    if (qty <= 0) continue;
    items.push(
      baseDraft(
        key,
        withSource(
          {
            qty,
            techNote: row.note ? String(row.note) : "",
          },
          frameData,
        ),
      ),
    );
  }

  return items.filter(Boolean);
}

/**
 * @param {{ cutList?: object[], angleStock?: object, overlapMm?: number }} params
 */
export function formatAngleStockTechNote({ cutList, angleStock, overlapMm = 150 }) {
  const segments = normalizeFrameCutSegments(cutList);
  const rec = angleStock?.recommended;
  const parts = [];

  if (segments.length) {
    parts.push(`Список резов: ${formatSegmentsNote(segments)}`);
  }
  if (rec) {
    parts.push(`Вариант закупки: ${rec.title || rec.key || "—"}`);
    if (rec.cleanCutLengthMm != null) {
      parts.push(`Чистый рез: ${round2(rec.cleanCutLengthMm / 1000)} м`);
    }
    if (rec.overlapMaterialMm > 0) {
      parts.push(`Добавка на нахлёст: ${rec.overlapMaterialMm} мм`);
    }
    if (rec.totalSpliceCount > 0) {
      parts.push(`Стыков с нахлёстом ${overlapMm} мм: ${rec.totalSpliceCount}`);
    }
    const stockParts = [];
    const counts = rec.stockCounts || {};
    if (counts[2000] > 0) stockParts.push(`2 м — ${counts[2000]} шт`);
    if (counts[2500] > 0) stockParts.push(`2.5 м — ${counts[2500]} шт`);
    if (stockParts.length) parts.push(`Хлысты: ${stockParts.join(", ")}`);
  }

  return parts.join(". ");
}

/**
 * @param {{ cutList?: object[], angleStock?: object, fasteners?: object, crossBeamFasteningMode?: string, overlapMm?: number, sourceFrameDrawingId?: string, sourceRackKey?: string }} frameData
 */
export function buildPerforatedAngleBomPurchaseDraft(frameData = {}) {
  const items = [];
  const rec = frameData.angleStock?.recommended;
  const stockCounts = rec?.stockCounts || {};
  const angleTech = formatAngleStockTechNote({
    cutList: frameData.cutList,
    angleStock: frameData.angleStock,
    overlapMm: frameData.overlapMm ?? 150,
  });

  if ((stockCounts[2000] || 0) > 0) {
    items.push(
      baseDraft(
        "perforated_angle_30x30_2000",
        withSource({ qty: stockCounts[2000], techNote: angleTech }, frameData),
      ),
    );
  }
  if ((stockCounts[2500] || 0) > 0) {
    items.push(
      baseDraft(
        "perforated_angle_30x30_2500",
        withSource({ qty: stockCounts[2500], techNote: angleTech }, frameData),
      ),
    );
  }

  const fasteners = frameData.fasteners;
  if (fasteners) {
    const mode = fasteners.crossBeamFasteningMode || frameData.crossBeamFasteningMode || "bolts_only";
    const modeNote = `Режим поперечин: ${mode === "brackets" ? "крепёжные уголки" : "болты"}`;
    const fastenerRows = [
      ["fasteningAngles", "fastening_angle"],
      ["boltsM6x20", "bolt_m6x20"],
      ["nutsM6", "nut_m6"],
      ["growersM6", "spring_washer_m6"],
      ["footPlates", "foot_plate"],
    ];
    for (const [field, key] of fastenerRows) {
      const qty = Number(fasteners[field]) || 0;
      if (qty <= 0) continue;
      items.push(
        baseDraft(key, withSource({ qty, techNote: modeNote }, frameData)),
      );
    }
  }

  return items.filter(Boolean);
}

/**
 * @param {{ constructionType?: string, config?: object }} frameData
 */
export function buildFrameBomPurchaseDraft(frameData = {}) {
  const constructionType =
    frameData.constructionType || frameData.config?.constructionType || "tube_crab";
  if (constructionType === "perforated_angle") {
    return buildPerforatedAngleBomPurchaseDraft(frameData);
  }
  return buildTubeCrabBomPurchaseDraft(frameData);
}

/**
 * @param {Array<{ id?: string, materialId?: string }>} materials
 */
export function validateFrameBomMaterialMap(materials = []) {
  const ids = new Set(
    (materials || []).map((m) => m.id || m.materialId).filter(Boolean),
  );
  const missing = [];
  for (const entry of Object.values(FRAME_BOM_MATERIALS)) {
    if (!ids.has(entry.materialId)) missing.push(entry.materialId);
  }
  return { ok: missing.length === 0, missing };
}

/** Guard helper: ensure excluded tube stock materials never appear in drafts. */
export function assertNoExcludedTubeMaterials(items) {
  return (items || []).every((it) => !EXCLUDED_TUBE_MATERIAL_IDS.has(it.materialId));
}
