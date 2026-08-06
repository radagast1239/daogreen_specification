/** Визуальные настройки планировщика: сетка, размеры, стены, подписи. */

export const VISUAL_PREFS_KEY = "daogreen-planner-visual-prefs";

export const DEFAULT_VISUAL = {
  gridOpacity: 1,
  gridStrokeMul: 1,
  dimScale: 1.32,
  dimOffsetMul: 1.28,
  dimOpacity: 1,
  wallHatchSpacing: 48,
  wallHatchOpacity: 0.52,
  wallStrokeMul: 1.28,
  labelScale: 1.12,
};

export const VISUAL_PRESETS = [
  {
    id: "light",
    label: "Лёгкий",
    values: {
      gridOpacity: 0.55,
      gridStrokeMul: 1.0,
      dimScale: 1.05,
      dimOffsetMul: 1.0,
      dimOpacity: 0.85,
      wallHatchSpacing: 72,
      wallHatchOpacity: 0.32,
      wallStrokeMul: 0.95,
      labelScale: 1.0,
    },
  },
  {
    id: "standard",
    label: "Стандарт",
    values: { ...DEFAULT_VISUAL },
  },
  {
    id: "draft",
    label: "Чертёж",
    values: {
      gridOpacity: 0.95,
      gridStrokeMul: 1.65,
      dimScale: 1.45,
      dimOffsetMul: 1.4,
      dimOpacity: 1,
      wallHatchSpacing: 58,
      wallHatchOpacity: 0.55,
      wallStrokeMul: 1.15,
      labelScale: 1.2,
    },
  },
];

export const VISUAL_PREF_KEYS = Object.keys(DEFAULT_VISUAL);

export function clampVisual(key, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VISUAL[key];
  switch (key) {
    case "gridOpacity":
    case "dimOpacity":
    case "wallHatchOpacity":
      return Math.min(1, Math.max(0.15, n));
    case "gridStrokeMul":
    case "dimScale":
    case "dimOffsetMul":
    case "wallStrokeMul":
    case "labelScale":
      return Math.min(2.5, Math.max(0.5, n));
    case "wallHatchSpacing":
      return Math.min(120, Math.max(36, Math.round(n)));
    default:
      return n;
  }
}

export function normalizeVisualPrefs(raw = {}) {
  const out = { ...DEFAULT_VISUAL };
  VISUAL_PREF_KEYS.forEach((key) => {
    if (raw[key] != null) out[key] = clampVisual(key, raw[key]);
  });
  return out;
}

export function pickVisualPrefs(display = {}) {
  const out = {};
  VISUAL_PREF_KEYS.forEach((key) => {
    if (display[key] != null) out[key] = display[key];
  });
  return out;
}

export function loadVisualPrefs() {
  try {
    const raw = localStorage.getItem(VISUAL_PREFS_KEY);
    if (!raw) return {};
    return normalizeVisualPrefs(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveVisualPrefs(display) {
  try {
    localStorage.setItem(VISUAL_PREFS_KEY, JSON.stringify(pickVisualPrefs(display)));
  } catch {
    /* ignore */
  }
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Цвет и толщина линии сетки с учётом display. */
export function resolveGridLineStyle(level, baseColor, baseStroke, display = {}) {
  const vis = normalizeVisualPrefs(display);
  const strokeWidth = baseStroke * vis.gridStrokeMul;
  if (typeof baseColor === "string" && baseColor.startsWith("rgba(")) {
    const m = baseColor.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
    if (m) {
      const alpha = parseFloat(m[4]) * vis.gridOpacity;
      return {
        stroke: `rgba(${m[1]},${m[2]},${m[3]},${alpha})`,
        strokeWidth,
      };
    }
    return { stroke: baseColor, strokeWidth };
  }
  return {
    stroke: hexToRgba(baseColor, vis.gridOpacity),
    strokeWidth,
  };
}

export function dimEffectiveK(k, display = {}) {
  return k * normalizeVisualPrefs(display).dimScale;
}

export function dimEffectiveOffset(offset, display = {}) {
  return offset * normalizeVisualPrefs(display).dimOffsetMul;
}

export function dimEffectiveOpacity(display = {}) {
  return normalizeVisualPrefs(display).dimOpacity;
}

export function wallVisualFromDisplay(display = {}) {
  const vis = normalizeVisualPrefs(display);
  return {
    hatchSpacing: vis.wallHatchSpacing,
    hatchOpacity: vis.wallHatchOpacity,
    strokeMul: vis.wallStrokeMul,
  };
}

export function labelScaleFromDisplay(display = {}) {
  return normalizeVisualPrefs(display).labelScale;
}
