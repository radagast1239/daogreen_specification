import { buildFrameBomPurchaseDraft } from "../../shared/frameBomMaterialMap.js";
import { calculateAngleFasteners } from "./frameAngleStock.js";
import { calculateFrameGeometry } from "./frameGeometry.js";
import { generateCutList } from "./frameCutList.js";
import { extractTubeCutsFromCutList, calculateTubeStockOptions } from "./frameTubeStock.js";
import { calculateAngleStockOptions } from "./frameAngleStock.js";
import { parseFrameBomDecimal } from "../../shared/frameBomUnits.js";

export const PREVIEW_BANNER_TEXT = "Предпросмотр. В закупку ещё не добавлено.";
export const PREVIEW_FUTURE_NOTE =
  "Повторное нажатие заменит BOM только этого стеллажа, ручные позиции проекта не трогаются.";

export const CRAB_PREVIEW_LABELS = {
  crab_g: "Краб G",
  crab_t: "Краб T",
  crab_x: "Краб X",
  crab_a4: "Краб A4",
  crab_a6: "Краб A6",
};

const TUBE_KEYS = new Set(["profile_tube_20x20"]);
const ANGLE_STOCK_KEYS = new Set([
  "perforated_angle_30x30_2000",
  "perforated_angle_30x30_2500",
]);
const FASTENER_KEYS = new Set([
  "fastening_angle",
  "bolt_m6x20",
  "nut_m6",
  "spring_washer_m6",
  "foot_plate",
]);
const CRAB_KEYS = new Set(Object.keys(CRAB_PREVIEW_LABELS));
const NFT_KEYS = new Set([
  "air_duct_55x110_2000",
  "air_duct_connector_55x110",
  "air_duct_elbow_55x110_90",
]);

/** @param {Array<{ qty?: number }>} draft */
export function visiblePurchaseDraftItems(draft) {
  return (draft || []).filter((item) => parseFrameBomDecimal(item.qty, 0) > 0);
}

/** @param {Array<{ materialId?: string, key?: string, name?: string }>} draft */
export function findMissingMaterialIds(draft) {
  return visiblePurchaseDraftItems(draft)
    .filter((item) => !item.materialId)
    .map((item) => item.key || item.name || "unknown");
}

/**
 * @param {{ params: object, cutList: object[], geom?: object|null, stockOptions?: object|null }} ctx
 */
export function buildFramePurchaseDraftFromContext({ params, cutList, geom, stockOptions }) {
  if (!cutList?.length) return [];

  const isAngle = params.constructionType === "perforated_angle";
  const base = {
    constructionType: isAngle ? "perforated_angle" : "tube_crab",
    cutList,
  };

  if (isAngle) {
    const mode = params.crossBeamFasteningMode || "bolts_only";
    const fasteners = geom
      ? calculateAngleFasteners(geom, { crossBeamFasteningMode: mode })
      : null;
    return buildFrameBomPurchaseDraft({
      ...base,
      angleStock: stockOptions,
      fasteners,
      crossBeamFasteningMode: mode,
      overlapMm: params.angleOverlapMm,
    });
  }

  return buildFrameBomPurchaseDraft({
    ...base,
    tubeStock: stockOptions,
  });
}

/**
 * Rebuild purchase draft from saved frameConfig (saved drawing JSON).
 * @param {object|null|undefined} frameConfig
 */
export function buildFramePurchaseDraftFromFrameConfig(frameConfig) {
  const params = frameConfig && typeof frameConfig === "object" ? frameConfig : null;
  if (!params) return [];

  const geom = calculateFrameGeometry(params);
  const hasErrors = geom.validationErrors?.length > 0;
  const geomOk = !hasErrors && geom.posts;
  if (!geomOk) return [];

  const cutList = generateCutList(params);
  const isAngle = params.constructionType === "perforated_angle";
  let stockOptions = null;
  if (cutList.length) {
    if (isAngle) {
      stockOptions = calculateAngleStockOptions(cutList, { overlapMm: params.angleOverlapMm });
    } else {
      stockOptions = calculateTubeStockOptions(extractTubeCutsFromCutList(cutList));
    }
  }

  return buildFramePurchaseDraftFromContext({
    params,
    cutList,
    geom: isAngle ? geom : geom,
    stockOptions,
  });
}

export function groupPurchasePreviewItems(draft) {
  const visible = visiblePurchaseDraftItems(draft);
  return {
    tube: visible.filter((item) => TUBE_KEYS.has(item.key)),
    angleStock: visible.filter((item) => ANGLE_STOCK_KEYS.has(item.key)),
    fasteners: visible.filter((item) => FASTENER_KEYS.has(item.key)),
    crabs: visible.filter((item) => CRAB_KEYS.has(item.key)),
    channels: visible.filter((item) => NFT_KEYS.has(item.key)),
    other: visible.filter(
      (item) =>
        !TUBE_KEYS.has(item.key) &&
        !ANGLE_STOCK_KEYS.has(item.key) &&
        !FASTENER_KEYS.has(item.key) &&
        !CRAB_KEYS.has(item.key) &&
        !NFT_KEYS.has(item.key),
    ),
  };
}

export function formatTubeStockLines(recommended, isAngle = false) {
  if (!recommended?.stockCounts) return [];
  const counts = recommended.stockCounts;
  const lines = [];
  if (isAngle) {
    if (counts[2500] > 0) lines.push(`2.5 м — ${counts[2500]} шт`);
    if (counts[2000] > 0) lines.push(`2 м — ${counts[2000]} шт`);
  } else {
    if (counts[6000] > 0) lines.push(`6 м — ${counts[6000]} шт`);
    if (counts[3000] > 0) lines.push(`3 м — ${counts[3000]} шт`);
    const wasteM = recommended.wasteMm > 0 ? (recommended.wasteMm / 1000).toFixed(2) : null;
    if (wasteM) lines.push(`остаток — ${wasteM} м`);
  }
  return lines;
}
