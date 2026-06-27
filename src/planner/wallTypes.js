/** Типы и визуальные стили стен. */

export const WALL_KINDS = {
  existing: { label: "Существующая", color: "#4b504d", dash: null },
  new: { label: "Новая", color: "#2f3431", dash: null },
  demolish: { label: "Демонтируемая", color: "#a5371f", dash: "10 6 2 6" },
  technical: { label: "Техническая", color: "#5a5f5c", dash: "6 4" },
  sandwich: { label: "Сэндвич-панель", color: "#3d5a4c", dash: null },
  brick: { label: "Кирпич", color: "#6b4a3a", dash: null },
  drywall: { label: "Гипсокартон", color: "#5c6b62", dash: "8 4" },
  cold_panel: { label: "Холодильная панель", color: "#1f6f8b", dash: null },
};

export const THICKNESS_SIDES = [
  { id: "center", label: "По центру" },
  { id: "in", label: "Внутрь" },
  { id: "out", label: "Наружу" },
];

export function defaultWallFields(role = "partition", room = null) {
  return {
    role,
    thk: role === "outer" ? (room?.wallThk || 120) : 100,
    height: room?.height || 3000,
    kind: role === "outer" ? "existing" : "new",
    thicknessSide: "center",
    material: role === "outer" ? "Кирпич / блок" : "ГКЛ / профиль",
  };
}

export function wallVisualStyle(wall) {
  const kind = WALL_KINDS[wall?.kind] || WALL_KINDS.new;
  const outer = wall?.role === "outer";
  return {
    color: kind.color,
    dash: kind.dash,
    strokeMul: outer ? 1.2 : 1,
    minStroke: outer ? 120 : 60,
    label: kind.label,
  };
}

export function displayWallThickness(wall) {
  const vs = wallVisualStyle(wall);
  return Math.max((wall?.thk || 100) * vs.strokeMul, vs.minStroke);
}

/** Толщина линии грани стены на экране (мм плана), стабильная при zoom. */
export function wallFaceStrokeWidth(k, wall) {
  const outer = wall?.role === "outer";
  return (outer ? 1.35 : 1.15) * k;
}
