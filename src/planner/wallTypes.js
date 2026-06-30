/** Типы и визуальные стили стен. */

export const WALL_KINDS = {
  existing: { label: "Существующая", color: "#4b504d", dash: null },
  new: { label: "Новая", color: "#2f3431", dash: null },
  demolish: { label: "Демонтируемая", color: "#a5371f", dash: "10 6 2 6" },
  technical: { label: "Техническая", color: "#5a5f5c", dash: "6 4" },
  sandwich: { label: "Сэндвич-панель PIR/PUR", color: "#3d6b52", dash: null },
  food_panel: { label: "Пищевая моющаяся панель", color: "#2f8f6a", dash: null },
  cold_panel: { label: "Холодильная панель", color: "#1f6f8b", dash: null },
  pvc_panel: { label: "ПВХ / санитарная облицовка", color: "#5a7a9e", dash: null },
  brick: { label: "Кирпичная перегородка", color: "#8b5a42", dash: null },
  drywall: { label: "ГКЛ влагостойкий", color: "#7a8478", dash: "8 4" },
  glass: { label: "Стеклянная перегородка", color: "#4a9eb5", dash: "5 7" },
  light_mesh: { label: "Лёгкая перегородка / сетка", color: "#9aa89e", dash: "6 5 2 5" },
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

/** Толщина контура грани в координатах плана → ~const px на экране (группа scale(z), k=1/z). */
export function wallFaceStrokeWidth(k, wall) {
  const outer = wall?.role === "outer";
  const base = outer ? 2.35 : 2.1;
  return base * k;
}

/** Толщина внутреннего контура относительно внешнего. */
export function wallInnerFaceStrokeWidth(outerW) {
  return Math.max(outerW * 0.86, outerW - 0.35 * (outerW / 2.1));
}

/** Толщина стены на экране, px (для упрощения отрисовки вдали). */
export function wallScreenThicknessPx(wall, k) {
  return (wall?.thk || 100) / Math.max(k, 0.001);
}
