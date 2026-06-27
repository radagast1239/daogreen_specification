/**
 * Пресеты стен по активному инструменту (лист «Перегородки» / «Исходный план»).
 */
export const WALL_TOOL_PRESETS = {
  wall_draw: { kind: "new", material: "ГКЛ / профиль" },
  wall_outline: { role: "outer", kind: "existing", material: "Кирпич / блок" },
  wall_sandwich: { kind: "sandwich", material: "Сэндвич PIR/PUR", thk: 100 },
  wall_food: { kind: "sandwich", material: "Пищевая моющаяся панель", thk: 80 },
  wall_cold: { kind: "cold_panel", material: "Холодильная панель", thk: 120 },
  wall_pvc: { kind: "sandwich", material: "ПВХ / санитарная облицовка", thk: 60 },
  wall_brick: { kind: "brick", material: "Кирпич", thk: 120 },
  wall_gkl: { kind: "drywall", material: "ГКЛ влагостойкий", thk: 100 },
  wall_glass: { kind: "new", material: "Стеклянная перегородка", thk: 50 },
  wall_light: { kind: "drywall", material: "Лёгкая перегородка / сетка", thk: 60, dash: true },
};

export function wallFieldsFromTool(toolId, role, room, wallThk) {
  const preset = WALL_TOOL_PRESETS[toolId] || {};
  const resolvedRole = preset.role || role;
  return {
    role: resolvedRole,
    kind: preset.kind || (resolvedRole === "outer" ? "existing" : "new"),
    material: preset.material || (resolvedRole === "outer" ? "Кирпич / блок" : "ГКЛ / профиль"),
    thk: preset.thk ?? (resolvedRole === "outer" ? (room?.wallThk || wallThk) : wallThk),
    thicknessSide: preset.thicknessSide || "center",
  };
}
