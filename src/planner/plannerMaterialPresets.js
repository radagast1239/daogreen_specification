/**
 * Типовые размеры материалов планировщика (мм): каталог, варианты инструментов, стены, конструкции.
 * Сохраняется в localStorage.
 */
import { CATALOG, catalogByKind, RACK_PRESETS, WALL_THK_PRESETS, layerById } from "./catalog.js";
import { TANK_SIZE_PRESETS } from "./tankProperties.js";
import { STRUCTURAL_KINDS } from "./structuralTypes.js";
import { TOOL_REGISTRY } from "./plannerTools.js";
import { isRackKind } from "./rackProperties.js";
import { isTankKind } from "./tankProperties.js";

export const MATERIAL_PREFS_KEY = "daogreen-planner-material-presets";

export const MATERIAL_PRESET_GROUPS = [
  { id: "racks", label: "Стеллажи", match: (k) => isRackKind(k) },
  { id: "water", label: "Вода и полив", match: (k) => ["tank", "pump", "osmosis", "water_prep", "tank_waste"].includes(k) },
  { id: "climate", label: "Климат", match: (k) => ["fridge", "freezer", "recirc", "ac_indoor", "ac_outdoor", "ac_floor", "ac_duct"].includes(k) },
  { id: "furn", label: "Мебель", match: (k) => catalogByKind(k)?.layer === "furn" },
  { id: "sanitary", label: "Санитария", match: (k) => catalogByKind(k)?.layer === "sanitary" },
  { id: "power", label: "Электрика", match: (k) => ["panel", "socket", "light_panel"].includes(k) },
  { id: "vent", label: "Вентиляция", match: (k) => ["vent_unit", "blade_fan"].includes(k) },
  { id: "doors", label: "Двери и проёмы", match: (k) => k.startsWith("door") || k.startsWith("opening") || k === "window" },
  { id: "other", label: "Прочее", match: () => true },
];

let cachedPrefs = null;

function uidVariant() {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function kindEntryFromCatalog(c) {
  return { w: c.w, h: c.h, label: c.label, variants: [] };
}

export function buildDefaultMaterialPresets() {
  const kinds = {};
  CATALOG.forEach((c) => {
    kinds[c.kind] = kindEntryFromCatalog(c);
  });

  kinds.rack.variants = RACK_PRESETS.map((p) => ({
    id: `rack-${p.w}x${p.h}`,
    label: `${p.w}×${p.h}`,
    w: p.w,
    h: p.h,
  }));

  if (!kinds.rack.variants.some((v) => v.w === 2000 && v.h === 740)) {
    kinds.rack.variants.push({ id: "rack-2000x740", label: "2000×740", w: 2000, h: 740 });
  }

  kinds.tank.variants = TANK_SIZE_PRESETS.map((p) => ({
    id: `tank-${p.w}x${p.h}`,
    label: p.label || `${p.w}×${p.h}`,
    w: p.w,
    h: p.h,
  }));

  const tools = {};
  Object.values(TOOL_REGISTRY).forEach((t) => {
    if (t?.mode === "add" && t.size?.w != null) {
      tools[t.id] = {
        kind: t.kind,
        label: t.label,
        w: t.size.w,
        h: t.size.h,
        icon: t.icon || null,
        defaultLabel: t.defaultLabel || null,
        farmPresetId: t.farmPresetId || null,
        params: t.params ? { ...t.params } : null,
      };
    }
  });

  const structural = {};
  Object.keys(STRUCTURAL_KINDS).forEach((k) => {
    structural[k] = STRUCTURAL_KINDS[k].defaultWidth;
  });

  return {
    version: 1,
    kinds,
    tools,
    wallThk: [...WALL_THK_PRESETS],
    structural,
  };
}

function mergeKindEntry(base, saved) {
  if (!saved) return base;
  return {
    w: saved.w ?? base.w,
    h: saved.h ?? base.h,
    label: saved.label ?? base.label,
    variants: Array.isArray(saved.variants) ? saved.variants.map((v) => ({ ...v })) : [...base.variants],
  };
}

export function loadMaterialPresets() {
  if (cachedPrefs) return cachedPrefs;
  const defaults = buildDefaultMaterialPresets();
  try {
    const raw = localStorage.getItem(MATERIAL_PREFS_KEY);
    if (!raw) {
      cachedPrefs = defaults;
      return cachedPrefs;
    }
    const saved = JSON.parse(raw);
    const kinds = { ...defaults.kinds };
    Object.keys(defaults.kinds).forEach((kind) => {
      kinds[kind] = mergeKindEntry(defaults.kinds[kind], saved.kinds?.[kind]);
    });
    const tools = { ...defaults.tools, ...(saved.tools || {}) };
    Object.keys(defaults.tools).forEach((tid) => {
      tools[tid] = { ...defaults.tools[tid], ...(saved.tools?.[tid] || {}) };
    });
    cachedPrefs = {
      ...defaults,
      ...saved,
      kinds,
      tools,
      wallThk: Array.isArray(saved.wallThk) && saved.wallThk.length ? saved.wallThk : defaults.wallThk,
      structural: { ...defaults.structural, ...(saved.structural || {}) },
    };
  } catch {
    cachedPrefs = defaults;
  }
  return cachedPrefs;
}

export function saveMaterialPresets(prefs) {
  cachedPrefs = prefs;
  try {
    localStorage.setItem(MATERIAL_PREFS_KEY, JSON.stringify(prefs));
  } catch (_) { /* ignore quota */ }
}

export function invalidateMaterialPresetsCache() {
  cachedPrefs = null;
}

export function resetMaterialPresets() {
  localStorage.removeItem(MATERIAL_PREFS_KEY);
  invalidateMaterialPresetsCache();
  return loadMaterialPresets();
}

/** Каталог с учётом сохранённых типовых размеров. */
export function resolveCatalogKind(kind) {
  const base = catalogByKind(kind);
  const prefs = loadMaterialPresets();
  const k = prefs.kinds[kind];
  if (!k) return base;
  return {
    ...base,
    w: k.w ?? base.w,
    h: k.h ?? base.h,
    label: k.label || base.label,
  };
}

/** Размер при выборе инструмента из меню листа. */
export function resolveToolPendingSize(tool) {
  if (!tool || tool.mode !== "add") return null;
  const prefs = loadMaterialPresets();
  const stored = prefs.tools[tool.id];
  const base = stored || (tool.size ? {
    w: tool.size.w,
    h: tool.size.h,
    icon: tool.icon || null,
    defaultLabel: tool.defaultLabel || null,
  } : null);
  if (!base) return null;
  return {
    w: base.w,
    h: base.h,
    ...(base.icon || tool.icon ? { icon: base.icon || tool.icon } : {}),
    ...(base.defaultLabel || tool.defaultLabel ? { label: base.defaultLabel || tool.defaultLabel } : {}),
    ...(base.farmPresetId || tool.farmPresetId ? { farmPresetId: base.farmPresetId || tool.farmPresetId } : {}),
    ...(base.params || tool.params ? { params: { ...(base.params || {}), ...(tool.params || {}) } } : {}),
  };
}

export function getKindSizeVariants(kind) {
  const prefs = loadMaterialPresets();
  return prefs.kinds[kind]?.variants || [];
}

/** Кнопки типовых размеров стеллажей (панель свойств + палитра). */
export function getRackFootprintPresets() {
  const prefs = loadMaterialPresets();
  const rackVars = prefs.kinds.rack?.variants || [];
  const seedVars = prefs.kinds.seed_rack?.variants || [];
  const seen = new Set();
  const out = [];
  [...rackVars, ...seedVars, ...RACK_PRESETS].forEach((p) => {
    const key = `${p.w}_${p.h}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ w: p.w, h: p.h, label: p.label || `${p.w}×${p.h}` });
  });
  return out;
}

/** Кнопки типовых размеров ёмкостей. */
export function getTankFootprintPresets() {
  const prefs = loadMaterialPresets();
  const vars = prefs.kinds.tank?.variants || [];
  if (vars.length) {
    return vars.map((p) => ({
      w: p.w,
      h: p.h,
      label: p.label || `${Math.round(p.w / 10)}×${Math.round(p.h / 10)}`,
    }));
  }
  return TANK_SIZE_PRESETS.map((p) => ({ ...p }));
}

/** Универсальные пресеты для вида (не rack/tank). */
export function getFootprintPresetsForKind(kind) {
  if (isRackKind(kind)) return getRackFootprintPresets();
  if (isTankKind(kind)) return getTankFootprintPresets();
  return getKindSizeVariants(kind);
}

export function getWallThkPresets() {
  return loadMaterialPresets().wallThk || [...WALL_THK_PRESETS];
}

export function getStructuralDefaultWidth(kind) {
  const prefs = loadMaterialPresets();
  return prefs.structural?.[kind] ?? STRUCTURAL_KINDS[kind]?.defaultWidth ?? 200;
}

export function updateKindPreset(kind, patch) {
  const prefs = loadMaterialPresets();
  const base = prefs.kinds[kind] || kindEntryFromCatalog(catalogByKind(kind));
  prefs.kinds[kind] = { ...base, ...patch };
  saveMaterialPresets(prefs);
  return prefs.kinds[kind];
}

export function setKindVariants(kind, variants) {
  return updateKindPreset(kind, { variants });
}

export function addKindVariant(kind, { label, w, h }) {
  const prefs = loadMaterialPresets();
  const entry = prefs.kinds[kind] || kindEntryFromCatalog(catalogByKind(kind));
  const variants = [...(entry.variants || []), { id: uidVariant(), label: label || `${w}×${h}`, w, h }];
  prefs.kinds[kind] = { ...entry, variants };
  saveMaterialPresets(prefs);
  return variants;
}

export function removeKindVariant(kind, variantId) {
  const prefs = loadMaterialPresets();
  const entry = prefs.kinds[kind];
  if (!entry) return;
  entry.variants = (entry.variants || []).filter((v) => v.id !== variantId);
  saveMaterialPresets(prefs);
}

export function updateToolPreset(toolId, patch) {
  const prefs = loadMaterialPresets();
  const base = prefs.tools[toolId] || {};
  prefs.tools[toolId] = { ...base, ...patch };
  saveMaterialPresets(prefs);
}

export function updateWallThkPresets(list) {
  const prefs = loadMaterialPresets();
  prefs.wallThk = list.filter((n) => Number.isFinite(n) && n > 0);
  saveMaterialPresets(prefs);
}

export function updateStructuralWidth(kind, width) {
  const prefs = loadMaterialPresets();
  prefs.structural = { ...prefs.structural, [kind]: Math.max(50, +width || 0) };
  saveMaterialPresets(prefs);
}

export function listEditableKinds() {
  return CATALOG.map((c) => ({
    kind: c.kind,
    label: loadMaterialPresets().kinds[c.kind]?.label || c.label,
    layer: c.layer,
    layerName: layerById(c.layer)?.name || c.layer,
    w: loadMaterialPresets().kinds[c.kind]?.w ?? c.w,
    h: loadMaterialPresets().kinds[c.kind]?.h ?? c.h,
    variants: loadMaterialPresets().kinds[c.kind]?.variants || [],
    wall: !!c.wall,
  }));
}

export function listEditableTools() {
  const prefs = loadMaterialPresets();
  return Object.entries(prefs.tools).map(([id, t]) => ({
    id,
    ...t,
    registryLabel: TOOL_REGISTRY[id]?.label || id,
  }));
}
