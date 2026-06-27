/** Блок 9 — свойства стеллажей: типы, нумерация, ряды, площадь, нагрузки, связи. */

import { itemHasLinkOfType } from "./linkGeometry.js";

export const RACK_KINDS = new Set(["rack", "seed_rack", "shelf_cons", "shelf_inv"]);

export const RACK_TYPES = [
  { id: "nft", label: "NFT / проточка" },
  { id: "flood", label: "Подтопление (ebb-flow)" },
  { id: "seedling", label: "Рассадный" },
  { id: "strawberry", label: "Клубничный" },
  { id: "aeroponic", label: "Аэропоника" },
  { id: "shelf", label: "Полочный / хранение" },
  { id: "storage", label: "Хранение расходников" },
];

export const RACK_PURPOSES = [
  { id: "production", label: "Производство" },
  { id: "seedling", label: "Рассада" },
  { id: "storage", label: "Хранение" },
  { id: "quarantine", label: "Карантин" },
  { id: "test", label: "Тестовый" },
];

export const RACK_TYPE_ICONS = {
  nft: "rack_nft",
  flood: "rack_flood",
  seedling: "rack_seedling",
  strawberry: "rack_strawberry",
  aeroponic: "rack_aero",
  shelf: "rack_shelf",
  storage: "rack_shelf",
};

const PRODUCTION_RACK_TYPES = new Set(["nft", "flood", "strawberry", "aeroponic"]);
const FLOOR_LOAD_WARN_KG_M2 = 450;

export function isRackKind(kind) {
  return RACK_KINDS.has(kind);
}

export function rackIconForType(rackType) {
  return RACK_TYPE_ICONS[rackType] || "rack_nft";
}

export function nextRackNumber(items, excludeId = null, rowNum = null) {
  let max = 0;
  (items || []).forEach((it) => {
    if (!isRackKind(it.kind) || it.id === excludeId) return;
    if (rowNum != null && String(it.rowNum || "").toUpperCase() !== String(rowNum).toUpperCase()) return;
    const m = /^R?(\d+)/i.exec(String(it.rackNum || ""));
    if (m) max = Math.max(max, +m[1]);
  });
  return `R${String(max + 1).padStart(2, "0")}`;
}

export function nextRowLabel(items) {
  const rows = new Set();
  (items || []).forEach((it) => {
    if (it.rowNum) rows.add(String(it.rowNum).toUpperCase());
  });
  let i = 0;
  while (rows.has(String.fromCharCode(65 + i))) i += 1;
  return String.fromCharCode(65 + i);
}

export function defaultRackType(kind) {
  if (kind === "seed_rack") return "seedling";
  if (kind === "shelf_cons") return "storage";
  if (kind === "shelf_inv") return "shelf";
  return "nft";
}

export function defaultRackPurpose(kind) {
  if (kind === "seed_rack") return "seedling";
  if (kind === "shelf_cons" || kind === "shelf_inv") return "storage";
  return "production";
}

export function defaultRackHeightMm(kind) {
  if (kind === "seed_rack") return 2000;
  if (kind === "shelf_cons" || kind === "shelf_inv") return 1800;
  return 2400;
}

export function defaultRackFields(kind, items = []) {
  const tiers = kind === "seed_rack" ? 4 : 5;
  const rackType = defaultRackType(kind);
  return {
    rackNum: nextRackNumber(items),
    rowNum: "",
    rackType,
    icon: rackIconForType(rackType),
    tierCount: tiers,
    tierSpacingMm: 400,
    channelCount: 4,
    plantCount: "",
    growAreaM2: "",
    culture: "",
    rackPurpose: defaultRackPurpose(kind),
    rackHeightMm: defaultRackHeightMm(kind),
    waterFlowLh: "",
    lightPowerW: kind === "seed_rack" ? 600 : 900,
    weightKg: "",
    params: { tiers, levels: 4 },
  };
}

export function computeGrowAreaM2(it) {
  if (it.growAreaM2 != null && it.growAreaM2 !== "") return (+it.growAreaM2).toFixed(2);
  const tiers = it.tierCount || it.params?.tiers || 1;
  const channels = it.channelCount || it.params?.levels || 1;
  return ((it.w / 1000) * (it.h / 1000) * tiers * channels).toFixed(2);
}

/** Вес с водой, кг (оценка). */
export function computeRackWeightKg(it) {
  if (it.weightKg != null && it.weightKg !== "") return Math.round(+it.weightKg || 0);
  const footprint = (it.w / 1000) * (it.h / 1000);
  const heightM = (it.rackHeightMm || defaultRackHeightMm(it.kind)) / 1000;
  const frame = footprint * 35;
  const water = footprint * heightM * 80;
  return Math.round(frame + water);
}

export function computeFloorLoadKgM2(it) {
  const footprint = (it.w / 1000) * (it.h / 1000);
  if (!footprint) return "0";
  return (computeRackWeightKg(it) / footprint).toFixed(0);
}

export function formatRackCaption(it) {
  if (!isRackKind(it.kind)) return null;
  const num = it.rackNum ? String(it.rackNum).replace(/^R/i, "") : "";
  const rackLabel = num ? `стеллаж ${num.padStart(2, "0")}` : null;
  if (it.rowNum && rackLabel) return `Ряд ${it.rowNum} · ${rackLabel}`;
  if (it.rowNum) return `Ряд ${it.rowNum}`;
  if (it.rackNum) return it.rackNum;
  return null;
}

export function rackSpecNote(obj) {
  if (!isRackKind(obj.kind)) return "";
  const parts = [];
  if (obj.rowNum) parts.push(`ряд ${obj.rowNum}`);
  if (obj.rackNum) parts.push(obj.rackNum);
  const type = RACK_TYPES.find((t) => t.id === obj.rackType);
  if (type) parts.push(type.label);
  if (obj.culture) parts.push(obj.culture);
  const area = computeGrowAreaM2(obj);
  if (area && +area > 0) parts.push(`S ${area} м²`);
  const tiers = obj.tierCount || obj.params?.tiers;
  if (tiers) parts.push(`${tiers} яр.`);
  return parts.join(" · ");
}

/** Позиции стеллажей в сетке (без id). */
export function buildRackGrid(source, opts = {}) {
  const cols = Math.max(1, opts.cols || 4);
  const rows = Math.max(1, opts.rows || 1);
  const gapMm = opts.gapMm ?? 800;
  const rowGapMm = opts.rowGapMm ?? 1200;
  const horizontal = opts.direction !== "v";
  const startRow = source.rowNum || nextRowLabel([]);
  const out = [];

  for (let r = 0; r < rows; r++) {
    const rowNum = rows > 1
      ? String.fromCharCode(startRow.charCodeAt(0) + r)
      : startRow;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x = horizontal
        ? source.x + c * (source.w + gapMm)
        : source.x + r * (source.w + rowGapMm);
      const y = horizontal
        ? source.y + r * (source.h + rowGapMm)
        : source.y + c * (source.h + gapMm);
      out.push({ ...source, x, y, rowNum, _gridIdx: idx });
    }
  }
  return out;
}

/** Пронумеровать стеллажи в каждом ряду отдельно (A-01, A-02…). */
export function autoNumberRacks(items) {
  const racks = items
    .filter((it) => isRackKind(it.kind))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const counters = new Map();
  const map = new Map();
  racks.forEach((r) => {
    const row = String(r.rowNum || "_").toUpperCase();
    const n = (counters.get(row) || 0) + 1;
    counters.set(row, n);
    map.set(r.id, `R${String(n).padStart(2, "0")}`);
  });
  return items.map((it) => (map.has(it.id) ? { ...it, rackNum: map.get(it.id) } : it));
}

/** Предупреждения по стеллажам: связи, нагрузка на пол. */
export function collectRackWarnings(plan) {
  const warnings = [];
  const items = plan.items || [];
  const links = plan.links || [];

  items.filter((it) => isRackKind(it.kind)).forEach((r) => {
    const load = +computeFloorLoadKgM2(r);
    if (load > FLOOR_LOAD_WARN_KG_M2) {
      warnings.push({
        id: `rack-load-${r.id}`,
        severity: "warning",
        objectIds: [r.id],
        text: `${r.label} (${r.rackNum || "?"}): нагрузка на пол ~${load} кг/м² (рекомендуется ≤ ${FLOOR_LOAD_WARN_KG_M2})`,
      });
    }

    if (!PRODUCTION_RACK_TYPES.has(r.rackType) && r.rackPurpose !== "production") return;

    if (!itemHasLinkOfType(links, r.id, "irrigation")) {
      warnings.push({
        id: `rack-irr-${r.id}`,
        severity: "warning",
        objectIds: [r.id],
        text: `${formatRackCaption(r) || r.label}: нет связи полива с баком/насосом`,
      });
    }
    if (!itemHasLinkOfType(links, r.id, "power")) {
      warnings.push({
        id: `rack-pwr-${r.id}`,
        severity: "warning",
        objectIds: [r.id],
        text: `${formatRackCaption(r) || r.label}: нет связи с электрикой (розетка/щит)`,
      });
    }

    if (!itemHasLinkOfType(links, r.id, "light") && (r.lightPowerW || 0) > 0) {
      warnings.push({
        id: `rack-light-${r.id}`,
        severity: "warning",
        objectIds: [r.id],
        text: `${formatRackCaption(r) || r.label}: нет связи с освещением`,
      });
    }
  });

  return warnings;
}
