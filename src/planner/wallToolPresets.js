import { wallMaterialById } from "./catalog.js";

/**
 * Пресеты стен по активному инструменту (лист «Перегородки» / «Исходный план»).
 * material → WALL_MATERIALS; thk — начальное значение, редактируется вручную.
 */
export const WALL_TOOL_PRESETS = {
  wall_draw: { material: "drywall", thk: 100 },
  wall_bearing: { material: "bearing", thk: 250, role: "outer" },
  wall_pgb: { material: "pgb", thk: 120 },
  wall_foam: { material: "foam", thk: 120 },
  wall_brick: { material: "brick", thk: 120 },
  wall_gkl: { material: "drywall", thk: 100 },
  wall_glass: { material: "glass", thk: 40 },
  wall_lath: { material: "lath", thk: 60 },
  wall_box: { material: "box", thk: 100 },
  wall_outline: { material: "bearing", thk: 250, role: "outer" },
  wall_sandwich: { kind: "sandwich", material: "drywall", thk: 100 },
  wall_food: { kind: "food_panel", material: "drywall", thk: 80 },
  wall_cold: { kind: "cold_panel", material: "drywall", thk: 120 },
  wall_pvc: { kind: "pvc_panel", material: "drywall", thk: 60 },
  wall_light: { kind: "light_mesh", material: "lath", thk: 60 },
};

export function wallFieldsFromTool(toolId, role, room, wallThk) {
  const preset = WALL_TOOL_PRESETS[toolId] || {};
  const mat = wallMaterialById(preset.material || "drywall");
  const resolvedRole = preset.role || role;
  return {
    role: resolvedRole,
    kind: preset.kind || mat.kind || (resolvedRole === "outer" ? "existing" : "new"),
    material: preset.material || mat.id,
    materialLabel: mat.label,
    thk: preset.thk ?? mat.thk ?? (resolvedRole === "outer" ? (room?.wallThk || wallThk) : wallThk),
    thicknessSide: preset.thicknessSide || "center",
    height: room?.height || 2700,
  };
}

export function defaultWallThkForTool(toolId, fallback = 100) {
  const preset = WALL_TOOL_PRESETS[toolId];
  if (preset?.thk != null) return preset.thk;
  const mat = wallMaterialById(preset?.material);
  return mat?.thk ?? fallback;
}

export function wallMaterialForTool(toolId) {
  const preset = WALL_TOOL_PRESETS[toolId];
  return wallMaterialById(preset?.material || "drywall");
}
